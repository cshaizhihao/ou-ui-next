#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_VERSION="1.0.0"
APP_NAME="OU-UI Next"
DEFAULT_REPO_URL="${OU_UI_REPO_URL:-https://github.com/cshaizhihao/ou-ui-next.git}"
DEFAULT_REPO_REF="${OU_UI_REPO_REF:-main}"
LOCAL_SOURCE_DIR="${OU_UI_LOCAL_SOURCE_DIR:-}"
INSTALL_ROOT="/opt/ou-ui-next"
APP_DIR="${INSTALL_ROOT}/current"
CONFIG_DIR="/etc/ou-ui-next"
STATE_DIR="/var/lib/ou-ui-next"
WEB_ROOT="/var/www/ou-ui-next"
ACME_WEBROOT="/var/www/ou-ui-acme"
SERVICE_NAME="ou-ui-next-control-plane"
SERVICE_USER="ouui-next"
NGINX_CONF="/etc/nginx/conf.d/ou-ui-next.conf"
BACKEND_ENV_FILE="${CONFIG_DIR}/master.env"
SSL_DIR="${CONFIG_DIR}/ssl"
BACKEND_PORT="4010"
BACKEND_HOST="127.0.0.1"

RED='\033[31m'
GREEN='\033[32m'
YELLOW='\033[33m'
BLUE='\033[34m'
BOLD='\033[1m'
RESET='\033[0m'

PANEL_PORT=""
HAS_DOMAIN=""
DOMAIN=""
ACME_EMAIL=""
SECURE_PATH=""
ADMIN_USER=""
ADMIN_PASSWORD=""
OPERATOR_TOKEN=""
AGENT_BOOTSTRAP_ID="agent-bootstrap"
AGENT_BOOTSTRAP_TOKEN=""
PUBLIC_ENDPOINT=""
PACKAGE_MANAGER=""

log() {
  printf "%b[%s]%b %s\n" "$BLUE" "$APP_NAME" "$RESET" "$1"
}

warn() {
  printf "%b[警告]%b %s\n" "$YELLOW" "$RESET" "$1"
}

success() {
  printf "%b[完成]%b %s\n" "$GREEN" "$RESET" "$1"
}

die() {
  printf "%b[失败]%b %s\n" "$RED" "$RESET" "$1" >&2
  exit 1
}

on_error() {
  local line_no="$1"
  die "安装在第 ${line_no} 行附近中断，请检查上面的日志。"
}

trap 'on_error "$LINENO"' ERR

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    die "请使用 root 身份运行本脚本。"
  fi
}

require_linux() {
  if [[ "$(uname -s)" != "Linux" ]]; then
    die "当前脚本仅支持 Linux 宿主机。"
  fi
}

detect_package_manager() {
  if command -v apt-get >/dev/null 2>&1; then
    PACKAGE_MANAGER="apt"
    return
  fi

  if command -v dnf >/dev/null 2>&1; then
    PACKAGE_MANAGER="dnf"
    return
  fi

  if command -v yum >/dev/null 2>&1; then
    PACKAGE_MANAGER="yum"
    return
  fi

  die "未识别到支持的包管理器，仅支持 apt / dnf / yum。"
}

install_system_packages() {
  log "安装基础依赖..."

  case "${PACKAGE_MANAGER}" in
    apt)
      export DEBIAN_FRONTEND=noninteractive
      apt-get update -y
      apt-get install -y curl git nginx cron openssl ca-certificates rsync tar gzip jq
      ;;
    dnf)
      dnf install -y curl git nginx cronie openssl ca-certificates rsync tar gzip jq
      ;;
    yum)
      yum install -y curl git nginx cronie openssl ca-certificates rsync tar gzip jq
      ;;
  esac
}

ensure_service_enabled() {
  local unit="$1"
  systemctl enable "${unit}" >/dev/null 2>&1 || true
  systemctl start "${unit}"
}

ensure_nodejs() {
  local node_major=""

  if command -v node >/dev/null 2>&1; then
    node_major="$(node -p 'process.versions.node.split(`.`)[0]')"
    if [[ "${node_major}" -ge 20 ]]; then
      success "检测到可用的 Node.js $(node -v)"
      return
    fi
  fi

  log "安装 Node.js 22 LTS..."

  case "${PACKAGE_MANAGER}" in
    apt)
      curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
      apt-get install -y nodejs
      ;;
    dnf)
      curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
      dnf install -y nodejs
      ;;
    yum)
      curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
      yum install -y nodejs
      ;;
  esac
}

ensure_service_user() {
  if ! id -u "${SERVICE_USER}" >/dev/null 2>&1; then
    useradd --system --home "${INSTALL_ROOT}" --shell /usr/sbin/nologin "${SERVICE_USER}"
  fi
}

prompt_agreement() {
  clear || true
  cat <<'EOF'
============================================================
OU-UI Next Master 主控端一键安装协议
============================================================
1. 本脚本会自动安装 Node.js、Nginx、acme.sh 等依赖。
2. 本脚本会自动部署前端控制台、HTTP Control Plane 和 systemd 服务。
3. 如果你已解析域名到当前宿主机，脚本会自动申请并部署 Let's Encrypt 证书。
4. 本脚本会自动生成安全访问路径、管理员账号和密码，并在安装完成后高亮打印。
5. 安装继续前，请确认你拥有当前宿主机的管理权限，并理解脚本会修改：
   - /opt/ou-ui-next
   - /etc/ou-ui-next
   - /etc/nginx/conf.d/ou-ui-next.conf
   - /var/www/ou-ui-next
   - /var/lib/ou-ui-next
============================================================
EOF

  local answer=""
  read -r -p "请输入 yes 同意并继续安装： " answer
  [[ "${answer}" == "yes" ]] || die "你未同意安装协议，脚本已退出。"
}

warn_panel_port_collision_risk() {
  local port="$1"

  if [[ "${port}" == "443" ]]; then
    warn "443 最容易和现有网站、反向代理或旧面板冲突；只有确认该端口空闲时再继续。"
    return
  fi

  warn "如果该端口已被其他站点、容器或反向代理占用，安装会在 Nginx 自检阶段失败。"
}

prompt_port() {
  local input=""

  while true; do
    read -r -p "请输入 Master 面板监听端口 [默认 8443]： " input
    input="${input:-8443}"

    if [[ "${input}" =~ ^[0-9]+$ ]] && (( input >= 1 && input <= 65535 )); then
      if ! confirm_reserved_https_port "${input}"; then
        continue
      fi

      warn_panel_port_collision_risk "${input}"
      PANEL_PORT="${input}"
      return
    fi

    warn "端口必须是 1 到 65535 之间的整数。"
  done
}

confirm_reserved_https_port() {
  local port="$1"
  local answer=""

  if [[ "${port}" != "443" ]]; then
    return 0
  fi

  warn "443 是系统默认 HTTPS 端口，最容易与已有网站、反向代理或旧面板产生冲突。生产环境推荐使用 8443/9443 等独立端口。"
  read -r -p "确认仍然使用 443？请输入 yes 继续，其他输入将重新选择端口： " answer
  [[ "${answer}" == "yes" ]]
}

prompt_https_panel_port() {
  if [[ "${PANEL_PORT}" != "80" ]]; then
    return
  fi

  warn "域名 HTTPS 模式需要 80 端口用于 ACME 校验，面板监听端口不能继续使用 80。"

  local input=""
  while true; do
    read -r -p "请重新输入 HTTPS 面板监听端口 [默认 8443]： " input
    input="${input:-8443}"

    if [[ "${input}" =~ ^[0-9]+$ ]] && (( input >= 1 && input <= 65535 )) && [[ "${input}" != "80" ]]; then
      if ! confirm_reserved_https_port "${input}"; then
        continue
      fi

      warn_panel_port_collision_risk "${input}"
      PANEL_PORT="${input}"
      return
    fi

    warn "域名 HTTPS 模式请使用可用的 HTTPS 端口，80 仅用于 ACME 校验和跳转。"
  done
}

prompt_domain_mode() {
  local input=""

  while true; do
    read -r -p "你是否已有解析到本机的域名？[y/N]： " input
    input="${input:-N}"

    case "${input}" in
      y|Y)
        HAS_DOMAIN="yes"
        prompt_https_panel_port
        read -r -p "请输入已解析到本机的域名： " DOMAIN
        [[ -n "${DOMAIN}" ]] || die "域名不能为空。"
        [[ "${DOMAIN}" =~ ^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$ ]] || die "域名格式不合法。"
        read -r -p "请输入接收 SSL 续期通知的邮箱 [默认 admin@${DOMAIN}]： " ACME_EMAIL
        ACME_EMAIL="${ACME_EMAIL:-admin@${DOMAIN}}"
        return
        ;;
      n|N)
        HAS_DOMAIN="no"
        DOMAIN=""
        ACME_EMAIL=""
        return
        ;;
      *)
        warn "请输入 y 或 n。"
        ;;
    esac
  done
}

random_string() {
  local length="$1"
  local raw=""
  raw="$(openssl rand -hex "${length}")"
  printf '%s' "${raw:0:length}"
}

generate_secrets() {
  SECURE_PATH="$(random_string 16)"
  ADMIN_USER="operator_$(random_string 8)"
  ADMIN_PASSWORD="$(random_string 22)"
  OPERATOR_TOKEN="$(random_string 48)"
  AGENT_BOOTSTRAP_TOKEN="$(random_string 48)"
}

ensure_swap_for_build() {
  local mem_available_kb=""
  local swap_total_kb=""
  local swap_file="${STATE_DIR}/ou-ui-next.swap"

  mem_available_kb="$(awk '/^MemAvailable:/ { print $2; exit }' /proc/meminfo 2>/dev/null || echo 0)"
  swap_total_kb="$(awk '/^SwapTotal:/ { print $2; exit }' /proc/meminfo 2>/dev/null || echo 0)"

  if (( mem_available_kb >= 1500000 )) || (( swap_total_kb > 0 )); then
    return
  fi

  if swapon --show=NAME 2>/dev/null | awk 'NR>1 { print $1 }' | grep -qx "${swap_file}"; then
    return
  fi

  log "检测到可用内存较低，正在创建 2G 临时 swap 以稳定依赖安装和构建..."
  mkdir -p "${STATE_DIR}"
  rm -f "${swap_file}"

  if command -v fallocate >/dev/null 2>&1; then
    fallocate -l 2G "${swap_file}"
  else
    dd if=/dev/zero of="${swap_file}" bs=1M count=2048 status=none
  fi

  chmod 600 "${swap_file}"
  mkswap "${swap_file}" >/dev/null
  swapon "${swap_file}"

  if ! grep -qF "${swap_file} none swap sw 0 0" /etc/fstab; then
    printf '%s\n' "${swap_file} none swap sw 0 0" >> /etc/fstab
  fi
}

prepare_directories() {
  mkdir -p "${INSTALL_ROOT}" "${CONFIG_DIR}" "${STATE_DIR}" "${WEB_ROOT}" "${ACME_WEBROOT}" "${SSL_DIR}"
  chown -R "${SERVICE_USER}:${SERVICE_USER}" "${STATE_DIR}"
}

reset_control_plane_state_if_needed() {
  if [[ "${OU_UI_PRESERVE_STATE:-0}" == "1" ]]; then
    log "检测到更新模式，保留现有控制面状态。"
    return
  fi

  if [[ -f "${STATE_DIR}/control-plane-state.json" ]]; then
    log "检测到旧的控制面状态文件，按全新安装流程重置。"
    rm -f "${STATE_DIR}/control-plane-state.json"
  fi
}

sync_repository() {
  if [[ -n "${LOCAL_SOURCE_DIR}" ]]; then
    local source_dir=""
    source_dir="$(cd -- "${LOCAL_SOURCE_DIR}" && pwd)"
    [[ -f "${source_dir}/package.json" ]] || die "OU_UI_LOCAL_SOURCE_DIR 必须指向 OU-UI Next 仓库根目录。"

    log "使用显式指定的本地源码目录部署：${source_dir}"
    rm -rf "${APP_DIR}"
    mkdir -p "${APP_DIR}"
    rsync -a --delete \
      --exclude '.git' \
      --exclude 'node_modules' \
      --exclude 'dist' \
      --exclude 'coverage' \
      --exclude 'test-results' \
      --exclude 'diagnostics' \
      --exclude 'gcm-diagnose.log' \
      "${source_dir}/" "${APP_DIR}/"
    return
  fi

  log "从 GitHub 同步 OU-UI Next 仓库源码：${DEFAULT_REPO_URL} (${DEFAULT_REPO_REF})"

  if [[ -d "${APP_DIR}/.git" ]]; then
    git -C "${APP_DIR}" remote set-url origin "${DEFAULT_REPO_URL}" || true
    git -C "${APP_DIR}" fetch --depth 1 --prune origin "${DEFAULT_REPO_REF}"
    git -C "${APP_DIR}" checkout --detach FETCH_HEAD
    git -C "${APP_DIR}" reset --hard FETCH_HEAD
    git -C "${APP_DIR}" clean -fdx
    return
  fi

  rm -rf "${APP_DIR}"
  git clone --branch "${DEFAULT_REPO_REF}" --depth 1 "${DEFAULT_REPO_URL}" "${APP_DIR}"
}

write_frontend_env() {
  cat >"${APP_DIR}/.env.production.local" <<EOF
VITE_CONTROL_PLANE_MODE=http
VITE_CONTROL_PLANE_BASE_URL=/${SECURE_PATH}
VITE_ASSET_BASE=/${SECURE_PATH}/
VITE_DISABLE_IN_APP_LOGIN=false
VITE_CONTROL_PLANE_LOGIN_USERNAME=${ADMIN_USER}
VITE_CONTROL_PLANE_LOGIN_PASSWORD=${ADMIN_PASSWORD}
VITE_CONTROL_PLANE_OPERATOR_TOKEN=${OPERATOR_TOKEN}
VITE_CONTROL_PLANE_OPERATOR_GROUP_ID=owner
VITE_CONTROL_PLANE_RESOURCE_GROUP_ID=group-premium
EOF
}

write_backend_env() {
  cat >"${BACKEND_ENV_FILE}" <<EOF
OU_UI_CONTROL_PLANE_HOST=${BACKEND_HOST}
OU_UI_CONTROL_PLANE_PORT=${BACKEND_PORT}
OU_UI_CONTROL_PLANE_STORAGE=file
OU_UI_CONTROL_PLANE_STATE_FILE=${STATE_DIR}/control-plane-state.json
OU_UI_CONTROL_PLANE_OPERATOR_TOKEN=${OPERATOR_TOKEN}
OU_UI_CONTROL_PLANE_OPERATOR_ACTOR=${ADMIN_USER}
OU_UI_CONTROL_PLANE_OPERATOR_GROUP_ID=owner
OU_UI_CONTROL_PLANE_RESOURCE_GROUP_ID=group-premium
OU_UI_CONTROL_PLANE_AGENT_TOKENS_JSON={"${AGENT_BOOTSTRAP_ID}":"${AGENT_BOOTSTRAP_TOKEN}"}
OU_UI_CONTROL_PLANE_INITIAL_STATE=empty
EOF

  chmod 600 "${BACKEND_ENV_FILE}"
}

install_management_cli() {
  {
    cat <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="OU-UI Next"
SERVICE_NAME="${SERVICE_NAME}"
INSTALL_ROOT="${INSTALL_ROOT}"
APP_DIR="${APP_DIR}"
CONFIG_DIR="${CONFIG_DIR}"
WEB_ROOT="${WEB_ROOT}"
ACME_WEBROOT="${ACME_WEBROOT}"
STATE_DIR="${STATE_DIR}"
NGINX_CONF="${NGINX_CONF}"
BACKEND_ENV_FILE="${BACKEND_ENV_FILE}"
REPO_URL="${DEFAULT_REPO_URL}"
REPO_REF="${DEFAULT_REPO_REF}"
INSTALL_SCRIPT_URL="https://raw.githubusercontent.com/cshaizhihao/ou-ui-next/main/scripts/install-master.sh"
EOF

    cat <<'EOF'

log() {
  printf "[%s] %s\n" "${APP_NAME}" "$1"
}

fail() {
  printf "[%s] %s\n" "${APP_NAME}" "$1" >&2
  exit 1
}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    fail "请使用 root 身份运行此命令。"
  fi
}

read_panel_path() {
  if [[ -f "${APP_DIR}/.env.production.local" ]]; then
    awk -F= '/^VITE_CONTROL_PLANE_BASE_URL=/ { print $2; exit }' "${APP_DIR}/.env.production.local" | sed 's#^/##; s#/$##'
  fi
}

read_listen_port() {
  if [[ -f "${NGINX_CONF}" ]]; then
    awk '
      /^[[:space:]]*listen[[:space:]]+/ {
        port = $2
        gsub(";", "", port)
        if ($0 ~ /ssl/) {
          print port
          printed = 1
          exit
        }
        if (first == "") first = port
        if (port != "80" && non80 == "") non80 = port
      }
      END {
        if (!printed) {
          if (non80 != "") print non80
          else if (first != "") print first
        }
      }
    ' "${NGINX_CONF}"
  fi
}

panel_url() {
  local path domain listen
  path="$(read_panel_path)"
  listen="$(read_listen_port)"

  if [[ -z "${path}" || -z "${listen}" ]]; then
    echo "暂不可用"
    return
  fi

  if grep -qE 'server_name[[:space:]]+_[[:space:]]*;' "${NGINX_CONF}" 2>/dev/null; then
    local host
    host="$(hostname -I 2>/dev/null | awk '{print $1}')"
    host="${host:-127.0.0.1}"
    echo "http://${host}:${listen}/${path}/"
    return
  fi

  domain="$(awk '/^[[:space:]]*server_name[[:space:]]+/ { print $2; exit }' "${NGINX_CONF}" 2>/dev/null | tr -d ';')"
  if [[ -z "${domain}" ]]; then
    echo "暂不可用"
    return
  fi

  if [[ "${listen}" == "443" ]]; then
    echo "https://${domain}/${path}/"
  else
    echo "https://${domain}:${listen}/${path}/"
  fi
}

read_frontend_env_value() {
  local key="$1"

  if [[ -f "${APP_DIR}/.env.production.local" ]]; then
    awk -F= -v key="${key}" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "${APP_DIR}/.env.production.local"
  fi
}

show_credentials() {
  local url username password
  url="$(panel_url)"
  username="$(read_frontend_env_value VITE_CONTROL_PLANE_LOGIN_USERNAME)"
  password="$(read_frontend_env_value VITE_CONTROL_PLANE_LOGIN_PASSWORD)"

  if [[ -z "${username}" || -z "${password}" ]]; then
    fail "登录凭据不可用。请重新运行安装脚本，或检查 ${APP_DIR}/.env.production.local。"
  fi

  cat <<EOT
OU-UI Next 登录信息
  面板地址: ${url}
  账号: ${username}
  密码: ${password}
EOT
}

read_backend_env_value() {
  local key="$1"

  if [[ -f "${BACKEND_ENV_FILE}" ]]; then
    awk -F= -v key="${key}" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "${BACKEND_ENV_FILE}"
  fi
}

ensure_env_line() {
  local file="$1"
  local key="$2"
  local value="$3"

  touch "${file}"

  if grep -Eq "^${key}=.+" "${file}"; then
    return
  fi

  if grep -Eq "^${key}=" "${file}"; then
    sed -i "s#^${key}=.*#${key}=${value}#" "${file}"
    return
  fi

  printf '%s=%s\n' "${key}" "${value}" >>"${file}"
}

set_env_line() {
  local file="$1"
  local key="$2"
  local value="$3"

  touch "${file}"

  if grep -Eq "^${key}=" "${file}"; then
    sed -i "s#^${key}=.*#${key}=${value}#" "${file}"
    return
  fi

  printf '%s=%s\n' "${key}" "${value}" >>"${file}"
}

ensure_runtime_env_defaults() {
  require_root

  local username
  username="$(read_frontend_env_value VITE_CONTROL_PLANE_LOGIN_USERNAME)"
  username="${username:-admin}"

  local operator_token
  operator_token="$(read_backend_env_value OU_UI_CONTROL_PLANE_OPERATOR_TOKEN)"

  if [[ -n "${operator_token}" ]]; then
    set_env_line "${APP_DIR}/.env.production.local" VITE_CONTROL_PLANE_OPERATOR_TOKEN "${operator_token}"
  fi

  ensure_env_line "${APP_DIR}/.env.production.local" VITE_CONTROL_PLANE_OPERATOR_GROUP_ID owner
  ensure_env_line "${APP_DIR}/.env.production.local" VITE_CONTROL_PLANE_RESOURCE_GROUP_ID group-premium
  ensure_env_line "${BACKEND_ENV_FILE}" OU_UI_CONTROL_PLANE_OPERATOR_ACTOR "${username}"
  ensure_env_line "${BACKEND_ENV_FILE}" OU_UI_CONTROL_PLANE_OPERATOR_GROUP_ID owner
  ensure_env_line "${BACKEND_ENV_FILE}" OU_UI_CONTROL_PLANE_RESOURCE_GROUP_ID group-premium
  ensure_env_line "${BACKEND_ENV_FILE}" OU_UI_CONTROL_PLANE_INITIAL_STATE empty
  chmod 600 "${BACKEND_ENV_FILE}"
}

control_plane_state_file() {
  local state_file
  state_file="$(read_backend_env_value OU_UI_CONTROL_PLANE_STATE_FILE)"
  echo "${state_file:-${STATE_DIR}/control-plane-state.json}"
}

show_doctor() {
  require_root

  local url state_file auth_lines panel_headers panel_status panel_auth panel_final_url
  url="$(panel_url)"
  state_file="$(control_plane_state_file)"
  auth_lines="$(nginx -T 2>/dev/null | awk '
    /^# configuration file / {
      file = $3
      sub(/:$/, "", file)
    }
    tolower($0) ~ /auth_basic/ && tolower($0) !~ /auth_basic[[:space:]]+off[[:space:]]*;/ {
      print "  " file ": " $0
    }
  ' | head -20 || true)"
  panel_headers="$(curl -k -sSIL --max-time 10 "${url}" 2>/dev/null || true)"
  panel_status="$(printf '%s\n' "${panel_headers}" | awk '/^HTTP\// { code = $2 } END { print code }')"
  panel_auth="$(printf '%s\n' "${panel_headers}" | awk 'BEGIN { IGNORECASE=1 } /^WWW-Authenticate:/ { print; exit }')"
  panel_final_url="$(curl -k -sSLI -o /dev/null -w '%{url_effective}' --max-time 10 "${url}" 2>/dev/null || true)"

  cat <<EOT
OU-UI Next 安装诊断
  面板地址: ${url}
  面板 HTTP 状态: ${panel_status:-无法访问}
  面板最终地址: ${panel_final_url:-无法确认}
  WWW-Authenticate: ${panel_auth:-未返回}
  Nginx 配置: ${NGINX_CONF}
  后端环境: ${BACKEND_ENV_FILE}
  控制面状态: ${state_file}
EOT

  if systemctl is-active --quiet "${SERVICE_NAME}"; then
    echo "  后端服务: 运行中"
  else
    echo "  后端服务: 未运行或异常，请查看 ou-ui-next status / ou-ui-next logs"
  fi

  if [[ -f "${NGINX_CONF}" ]] && grep -q 'auth_basic off;' "${NGINX_CONF}"; then
    echo "  面板 Basic Auth: 已关闭，应该显示前端登录页"
  else
    echo "  面板 Basic Auth: 未确认关闭，请检查 ${NGINX_CONF}"
  fi

  if [[ -n "${auth_lines}" ]]; then
    echo "  检测到其它 Nginx 配置存在 Basic Auth，若浏览器弹系统账号密码框，通常是端口/域名命中了旧站点："
    printf '%s\n' "${auth_lines}"
    echo "  处理建议: 运行 ou d 查看冲突路径；若 443 被其它应用占用，请重新安装时选择 8443/9443 等独立端口。"
  elif [[ "${panel_auth}" =~ [Bb]asic ]]; then
    echo "  面板响应异常: 当前访问地址返回了 WWW-Authenticate: Basic，说明实际命中的不是 OU-UI 前端登录页。"
    echo "  处理建议: 检查 ${NGINX_CONF}、同端口 server_name/default_server 冲突，或重新安装时选择 8443/9443 等独立端口。"
  else
    echo "  其它 Nginx Basic Auth: 未发现启用项"
  fi

  if nginx -t >/dev/null 2>&1; then
    echo "  Nginx 配置检测: 通过"
  else
    echo "  Nginx 配置检测: 失败，请运行 nginx -t 查看详情"
  fi

  if [[ -f "${state_file}" ]] && command -v jq >/dev/null 2>&1; then
    echo "  状态文件任务数: $(jq '.tasks | length' "${state_file}" 2>/dev/null || echo '无法读取')"
    echo "  Agent 凭据数: $(jq '.agentCredentials | length' "${state_file}" 2>/dev/null || echo '无法读取')"
  elif [[ -f "${state_file}" ]]; then
    echo "  状态文件: 已存在（安装 jq 后可显示任务和 Agent 凭据数量）"
  else
    echo "  状态文件: 尚未生成，后端启动后会自动创建"
  fi
}

reconfigure_installation() {
  require_root

  if [[ ! -x "${APP_DIR}/scripts/install-master.sh" ]]; then
    fail "未找到可复用的安装脚本，请先确认 ${APP_DIR} 是完整安装目录。"
  fi

  log "将重新打开安装向导，以便修改端口、证书和 Nginx 相关配置。"
  export OU_UI_PRESERVE_STATE=1
  exec bash "${APP_DIR}/scripts/install-master.sh"
}

reset_control_plane_state() {
  require_root

  local state_file answer
  state_file="$(control_plane_state_file)"

  cat <<EOT
此操作会清空控制面运行状态：
  - 已生成的任务记录
  - Agent 注册凭据与会话
  - 端口转发运行状态

不会删除：
  - 面板访问地址
  - 安全路径
  - 登录账号和密码
  - Nginx 与 systemd 配置
EOT
  read -r -p "仅当你刚安装完成却看到旧假数据/旧任务时使用。请输入 yes 继续：" answer
  [[ "${answer}" == "yes" ]] || exit 0

  systemctl stop "${SERVICE_NAME}" >/dev/null 2>&1 || true
  rm -f "${state_file}"
  systemctl start "${SERVICE_NAME}"
  log "控制面状态已重置。"
  show_credentials
}

force_reset_control_plane_state() {
  require_root

  local state_file
  state_file="$(control_plane_state_file)"

  systemctl stop "${SERVICE_NAME}" >/dev/null 2>&1 || true
  rm -f "${state_file}"
  systemctl start "${SERVICE_NAME}"
  log "控制面运行状态已清理，下一次打开面板会回到真实空环境。"
}

ensure_swap_for_build() {
  local mem_available_kb=""
  local swap_total_kb=""
  local swap_file="${STATE_DIR}/ou-ui-next.swap"

  mem_available_kb="$(awk '/^MemAvailable:/ { print $2; exit }' /proc/meminfo 2>/dev/null || echo 0)"
  swap_total_kb="$(awk '/^SwapTotal:/ { print $2; exit }' /proc/meminfo 2>/dev/null || echo 0)"

  if (( mem_available_kb >= 1500000 )) || (( swap_total_kb > 0 )); then
    return
  fi

  if swapon --show=NAME 2>/dev/null | awk 'NR>1 { print $1 }' | grep -qx "${swap_file}"; then
    return
  fi

  log "检测到可用内存较低，正在创建 2G 临时 swap 以稳定依赖安装和构建..."
  mkdir -p "${STATE_DIR}"
  rm -f "${swap_file}"

  if command -v fallocate >/dev/null 2>&1; then
    fallocate -l 2G "${swap_file}"
  else
    dd if=/dev/zero of="${swap_file}" bs=1M count=2048 status=none
  fi

  chmod 600 "${swap_file}"
  mkswap "${swap_file}" >/dev/null
  swapon "${swap_file}"

  if ! grep -qF "${swap_file} none swap sw 0 0" /etc/fstab; then
    printf '%s\n' "${swap_file} none swap sw 0 0" >> /etc/fstab
  fi
}

do_uninstall() {
  require_root
  read -r -p "确认卸载 OU-UI Next？请输入 yes 继续：" answer
  [[ "${answer}" == "yes" ]] || exit 0

  systemctl disable --now "${SERVICE_NAME}" >/dev/null 2>&1 || true
  rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
  rm -f "${NGINX_CONF}"
  rm -f "${BACKEND_ENV_FILE}"
  rm -f "${APP_DIR}/.env.production.local"
  rm -rf "${INSTALL_ROOT}" "${CONFIG_DIR}" "${STATE_DIR}" "${WEB_ROOT}" "${ACME_WEBROOT}"
  rm -f "/usr/local/bin/ou-ui-next" "/usr/local/bin/ouui" "/usr/local/bin/ou-ui" "/usr/local/bin/ou"
  systemctl daemon-reload >/dev/null 2>&1 || true
  systemctl reload nginx >/dev/null 2>&1 || true
  log "卸载完成。"
}

install_dependencies_and_build() {
  log "正在安装依赖并构建 GitHub 最新版本..."
  cd "${APP_DIR}"

  export CI=1
  export npm_config_audit=false
  export npm_config_fund=false
  export npm_config_update_notifier=false
  export npm_config_prefer_offline=true
  export npm_config_cache="${STATE_DIR}/npm-cache"
  mkdir -p "${npm_config_cache}"

  if [[ -z "${NODE_OPTIONS:-}" ]]; then
    export NODE_OPTIONS="--max-old-space-size=512"
  fi

  ensure_swap_for_build

  if [[ -f package-lock.json ]]; then
    if ! npm ci --no-audit --no-fund; then
      log "默认依赖安装失败，正在切换低内存模式重试..."
      export NODE_OPTIONS="--max-old-space-size=384"
      npm ci --no-audit --no-fund
    fi
  else
    npm install --no-audit --no-fund
  fi

  npm run build:typecheck
  npm run build:client
  npm run build:server
}

deploy_frontend_bundle() {
  local panel_path
  panel_path="$(read_panel_path)"

  [[ -n "${panel_path}" ]] || fail "面板安全路径不可用，请检查 ${APP_DIR}/.env.production.local。"
  mkdir -p "${WEB_ROOT}/${panel_path}"
  rsync -a --delete "${APP_DIR}/dist/" "${WEB_ROOT}/${panel_path}/"
}

do_update() {
  require_root

  [[ -d "${APP_DIR}/.git" ]] || fail "${APP_DIR} 不是 Git 仓库，请重新运行 GitHub 安装脚本修复部署。"
  [[ -f "${APP_DIR}/.env.production.local" ]] || fail "缺少前端运行环境文件：${APP_DIR}/.env.production.local"
  [[ -f "${BACKEND_ENV_FILE}" ]] || fail "缺少后端运行环境文件：${BACKEND_ENV_FILE}"

  log "正在从 GitHub 拉取最新 OU-UI Next 源码，并保留现有账号、安全路径和数据..."
  git -C "${APP_DIR}" remote set-url origin "${REPO_URL}" || true
  git -C "${APP_DIR}" fetch --depth 1 --prune origin "${REPO_REF}"
  git -C "${APP_DIR}" checkout --detach FETCH_HEAD
  git -C "${APP_DIR}" reset --hard FETCH_HEAD
  git -C "${APP_DIR}" clean -fdx -e .env.production.local

  ensure_runtime_env_defaults
  install_dependencies_and_build
  deploy_frontend_bundle
  if [[ -x "${APP_DIR}/scripts/install-master.sh" ]]; then
    bash "${APP_DIR}/scripts/install-master.sh" repair-cli
  fi
  systemctl restart "${SERVICE_NAME}"
  nginx -t
  systemctl reload nginx
  log "更新完成。"
  show_credentials
}

do_quick_fix() {
  require_root

  local reset_answer="${1:-}"

  log "开始执行安装异常一键修复：从 GitHub 更新、重建前端、刷新快捷命令、重启服务并运行诊断。"
  do_update

  if [[ "${reset_answer}" == "--force" || "${reset_answer}" == "force" ]]; then
    force_reset_control_plane_state
  elif [[ "${reset_answer}" != "--keep-state" && "${reset_answer}" != "keep-state" ]]; then
    read -r -p "是否清理旧运行状态/旧假数据？刚安装后看到演示主机时请输入 yes：" reset_answer
    if [[ "${reset_answer}" == "yes" ]]; then
      force_reset_control_plane_state
    fi
  fi

  nginx -t
  systemctl reload nginx
  show_doctor
  show_credentials
}

show_menu() {
  while true; do
    cat <<'EOT'
OU-UI Next 快捷菜单
  1) 查看面板信息
  2) 查看登录信息
  3) 查看服务状态
  4) 查看实时日志
  5) 重启服务
  6) 从 GitHub 更新
  7) 修改端口/证书
  8) 运行安装诊断
  9) 重置控制面状态
  10) 卸载面板
  11) 一键修复安装异常
  0) 退出
EOT
    echo "快捷键：p=面板信息 c=登录信息 s=服务状态 l=实时日志 u=更新 r=重置状态 m=改端口/证书 d=诊断 f=一键修复 x=卸载"
    read -r -p "请选择操作: " choice

    case "${choice}" in
      1|p|P) panel_url ;;
      2|c|C) show_credentials ;;
      3|s|S) systemctl status "${SERVICE_NAME}" --no-pager ;;
      4|l|L) journalctl -u "${SERVICE_NAME}" -f ;;
      5)
        require_root
        systemctl restart "${SERVICE_NAME}"
        ;;
      6|u|U)
        do_update
        ;;
      7|m|M|port|PORT|cert|CERT|ssl|SSL|tls|TLS|reconfigure|RECONFIGURE|configure|CONFIGURE|config|CONFIG|reinstall|REINSTALL)
        reconfigure_installation
        ;;
      8|d|D) show_doctor ;;
      9|r|R) reset_control_plane_state ;;
      11|f|F|fix|FIX|repair|REPAIR) do_quick_fix ;;
      10|x|X) do_uninstall ;;
      0|q|Q) break ;;
      *) log "未知选项。" ;;
    esac
  done
}

case "${1:-menu}" in
  status|s)
    systemctl status "${SERVICE_NAME}" --no-pager
    ;;
  logs|l)
    journalctl -u "${SERVICE_NAME}" -f
    ;;
  start|stop|restart|enable|disable)
    require_root
    systemctl "${1}" "${SERVICE_NAME}"
    ;;
  panel|p)
    panel_url
    ;;
  credentials|credential|login|info|c|i)
    show_credentials
    ;;
  reconfigure|configure|config|port|cert|ssl|tls|m)
    reconfigure_installation
    ;;
  update|upgrade|u)
    do_update
    ;;
  fix|repair|f)
    do_quick_fix "${2:-}"
    ;;
  doctor|diagnose|d)
    show_doctor
    ;;
  reset-state|reset|r)
    reset_control_plane_state
    ;;
  uninstall|remove|x)
    do_uninstall
    ;;
  menu)
    show_menu
    ;;
  help|--help|-h)
    cat <<'EOT'
用法: ou-ui-next <命令>

不带参数时会直接打开快捷菜单。涉及更新、重配、重启、重置和卸载时请使用 root 执行，例如：sudo ou f。
常用快捷: ou p=面板信息, ou c=登录信息, ou u=更新, ou r=重置状态, ou m=改端口/证书, ou d=诊断, ou f=一键修复, ou x=卸载。

命令:
  status      查看服务状态
  logs        查看实时日志
  start       启动服务
  stop        停止服务
  restart     重启服务
  enable      设置开机自启
  disable     取消开机自启
  panel       打印面板地址
  credentials 打印面板地址、账号和密码
  login       credentials 的别名
  info        credentials 的别名
  update      从 GitHub 重新拉取并更新
  fix         一键修复安装异常；刚安装后看到旧假数据时可运行 ou fix --force
  reconfigure 修改端口/证书并重新运行安装向导
  doctor      诊断 Nginx、Basic Auth、服务状态和控制面状态文件
  reset-state 清空控制面运行状态，用于刚安装后清除旧假数据
  uninstall   卸载部署
  menu        打开快捷菜单
EOT
    ;;
  *)
    fail "未知命令，请运行 'ou-ui-next help'。"
    ;;
esac
EOF
  } >"/usr/local/bin/ou-ui-next"
  chmod 755 "/usr/local/bin/ou-ui-next"
  ln -sf "/usr/local/bin/ou-ui-next" "/usr/local/bin/ouui"
  ln -sf "/usr/local/bin/ou-ui-next" "/usr/local/bin/ou-ui"
  ln -sf "/usr/local/bin/ou-ui-next" "/usr/local/bin/ou"
}

install_dependencies_and_build() {
  log "安装项目依赖并构建前端产物..."
  cd "${APP_DIR}"

  export CI=1
  export npm_config_audit=false
  export npm_config_fund=false
  export npm_config_update_notifier=false
  export npm_config_prefer_offline=true
  export npm_config_cache="${STATE_DIR}/npm-cache"
  mkdir -p "${npm_config_cache}"

  if [[ -z "${NODE_OPTIONS:-}" ]]; then
    export NODE_OPTIONS="--max-old-space-size=512"
  fi

  ensure_swap_for_build

  if [[ -f package-lock.json ]]; then
    if ! npm ci --no-audit --no-fund; then
      warn "默认依赖安装失败，正在切换低内存重试..."
      export NODE_OPTIONS="--max-old-space-size=384"
      npm ci --no-audit --no-fund
    fi
  else
    npm install --no-audit --no-fund
  fi

  log "1/3 检查 TypeScript 类型..."
  npm run build:typecheck

  log "2/3 构建前端静态资源..."
  npm run build:client

  log "3/3 构建 SSR 控制面板..."
  npm run build:server
}

deploy_frontend_bundle() {
  mkdir -p "${WEB_ROOT}/${SECURE_PATH}"
  rsync -a --delete "${APP_DIR}/dist/" "${WEB_ROOT}/${SECURE_PATH}/"
}

write_systemd_service() {
  cat >"/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=OU-UI Next service-backed control plane
After=network.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${BACKEND_ENV_FILE}
Environment=NODE_ENV=production
ExecStart=/usr/bin/env npm run start:control-plane
Restart=always
RestartSec=5
TimeoutStartSec=60

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable --now "${SERVICE_NAME}"
  systemctl is-active --quiet "${SERVICE_NAME}" || {
    systemctl status "${SERVICE_NAME}" --no-pager || true
    die "Control Plane systemd 服务启动失败。"
  }
}

panel_redirect_target() {
  if [[ "${HAS_DOMAIN}" == "yes" ]]; then
    if [[ "${PANEL_PORT}" == "443" ]]; then
      printf 'https://%s/%s/' "${DOMAIN}" "${SECURE_PATH}"
    else
      printf 'https://%s:%s/%s/' "${DOMAIN}" "${PANEL_PORT}" "${SECURE_PATH}"
    fi
  else
    local ip
    ip="$(hostname -I | awk '{print $1}')"
    if [[ -z "${ip}" ]]; then
      ip="127.0.0.1"
    fi
    printf 'http://%s:%s/%s/' "${ip}" "${PANEL_PORT}" "${SECURE_PATH}"
  fi
}

system_port_conflict_preflight() {
  if ! command -v ss >/dev/null 2>&1; then
    return
  fi

  local listeners=""
  listeners="$(
    ss -H -ltnp 2>/dev/null |
      awk -v port="${PANEL_PORT}" '
        $4 ~ (":" port "$") || $4 ~ ("\\]:" port "$") { print }
      ' || true
  )"

  if [[ -z "${listeners}" ]]; then
    return
  fi

  if printf '%s\n' "${listeners}" | grep -Eq 'users:\(\("nginx"'; then
    return
  fi

  die "检测到 ${PANEL_PORT} 端口已经被非 Nginx 进程监听，面板无法绑定该端口。占用信息：${listeners}。请重新运行安装并选择 8443/9443 等空闲端口。"
}

nginx_port_conflict_preflight() {
  if ! command -v nginx >/dev/null 2>&1; then
    return
  fi

  local nginx_dump=""
  nginx_dump="$(nginx -T 2>/dev/null || true)"

  if [[ -z "${nginx_dump}" ]]; then
    return
  fi

  local resolved_ou_conf=""
  local candidate_conf=""
  resolved_ou_conf="$(readlink -f "${NGINX_CONF}" 2>/dev/null || printf '%s' "${NGINX_CONF}")"

  while IFS= read -r -d '' candidate_conf; do
    local resolved_candidate=""
    resolved_candidate="$(readlink -f "${candidate_conf}" 2>/dev/null || printf '%s' "${candidate_conf}")"

    if [[ "${resolved_candidate}" == "${resolved_ou_conf}" ]]; then
      continue
    fi

    if grep -Eq "listen[[:space:]]+([^;]*:)?${PANEL_PORT}([^0-9;]|;)[^;]*default_server" "${candidate_conf}"; then
      die "检测到 Nginx 已有 ${PANEL_PORT} 端口 default_server，浏览器可能会打开其它站点或 Basic Auth 弹窗。冲突配置：${candidate_conf}。请换一个面板端口，或先清理旧的 Nginx 默认站点后重试。"
    fi

    if grep -Eq "listen[[:space:]]+([^;]*:)?${PANEL_PORT}([^0-9;]|;)" "${candidate_conf}" &&
      grep -Eiv 'auth_basic[[:space:]]+off[[:space:]]*;' "${candidate_conf}" | grep -Eiq 'auth_basic[[:space:]]+[^;]+;'; then
      die "检测到 Nginx 已有配置监听 ${PANEL_PORT} 端口并启用了 Basic Auth，浏览器可能会弹出系统账号密码框。冲突配置：${candidate_conf}。请换一个面板端口，或先关闭旧站点的 Basic Auth 后重试。"
    fi
  done < <(find -L /etc/nginx -type f \( -name '*.conf' -o -path '*/sites-enabled/*' \) -print0 2>/dev/null)

  if [[ "${HAS_DOMAIN}" == "yes" ]]; then
    while IFS= read -r -d '' candidate_conf; do
      local resolved_candidate=""
      resolved_candidate="$(readlink -f "${candidate_conf}" 2>/dev/null || printf '%s' "${candidate_conf}")"

      if [[ "${resolved_candidate}" == "${resolved_ou_conf}" ]]; then
        continue
      fi

      if grep -Eq "server_name[[:space:]][^;]*\\b${DOMAIN}\\b" "${candidate_conf}"; then
        die "检测到 Nginx 已有 ${DOMAIN} 的 server_name，浏览器可能会打开旧站点或 Basic Auth 弹窗。冲突配置：${candidate_conf}。请更换域名/端口或先清理旧站点后重试。"
      fi
    done < <(find -L /etc/nginx -type f \( -name '*.conf' -o -path '*/sites-enabled/*' \) -print0 2>/dev/null)
  fi

}

write_nginx_config_http() {
  cat >"${NGINX_CONF}" <<EOF
server {
    listen ${PANEL_PORT} default_server;
    server_name _;
    auth_basic off;

    root ${WEB_ROOT};
    index index.html;

    location = / {
        return 302 /${SECURE_PATH}/;
    }

    location = /${SECURE_PATH} {
        return 302 /${SECURE_PATH}/;
    }

    location ^~ /${SECURE_PATH}/api/ {
        rewrite ^/${SECURE_PATH}/(.*)$ /\$1 break;
        proxy_pass http://${BACKEND_HOST}:${BACKEND_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Prefix /${SECURE_PATH};
        proxy_set_header Authorization "Bearer ${OPERATOR_TOKEN}";
    }

    location ^~ /${SECURE_PATH}/agent/ {
        rewrite ^/${SECURE_PATH}/(.*)$ /\$1 break;
        proxy_pass http://${BACKEND_HOST}:${BACKEND_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Prefix /${SECURE_PATH};
        proxy_set_header Authorization \$http_authorization;
    }

    location ^~ /sub/ {
        proxy_pass http://${BACKEND_HOST}:${BACKEND_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location ^~ /${SECURE_PATH}/ {
        try_files \$uri \$uri/ /${SECURE_PATH}/index.html;
    }

    location / {
        return 404;
    }
}
EOF
}

write_nginx_config_for_acme() {
  cat >"${NGINX_CONF}" <<EOF
server {
    listen 80;
    server_name ${DOMAIN};
    auth_basic off;

    location ^~ /.well-known/acme-challenge/ {
        root ${ACME_WEBROOT};
        default_type "text/plain";
    }

    location / {
        return 200 "OU-UI Next ACME bootstrap";
    }
}
EOF
}

write_nginx_config_https() {
  local redirect_port=""

  if [[ "${PANEL_PORT}" != "443" ]]; then
    redirect_port=":${PANEL_PORT}"
  fi

  cat >"${NGINX_CONF}" <<EOF
server {
    listen 80;
    server_name ${DOMAIN};
    auth_basic off;

    location ^~ /.well-known/acme-challenge/ {
        root ${ACME_WEBROOT};
        default_type "text/plain";
    }

    location / {
        return 301 https://\$host${redirect_port}\$request_uri;
    }
}

server {
    listen ${PANEL_PORT} ssl http2 default_server;
    server_name ${DOMAIN};
    auth_basic off;

    ssl_certificate ${SSL_DIR}/fullchain.cer;
    ssl_certificate_key ${SSL_DIR}/${DOMAIN}.key;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:10m;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;

    root ${WEB_ROOT};
    index index.html;

    location = / {
        return 302 /${SECURE_PATH}/;
    }

    location = /${SECURE_PATH} {
        return 302 /${SECURE_PATH}/;
    }

    location ^~ /${SECURE_PATH}/api/ {
        rewrite ^/${SECURE_PATH}/(.*)$ /\$1 break;
        proxy_pass http://${BACKEND_HOST}:${BACKEND_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Prefix /${SECURE_PATH};
        proxy_set_header Authorization "Bearer ${OPERATOR_TOKEN}";
    }

    location ^~ /${SECURE_PATH}/agent/ {
        rewrite ^/${SECURE_PATH}/(.*)$ /\$1 break;
        proxy_pass http://${BACKEND_HOST}:${BACKEND_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Prefix /${SECURE_PATH};
        proxy_set_header Authorization \$http_authorization;
    }

    location ^~ /sub/ {
        proxy_pass http://${BACKEND_HOST}:${BACKEND_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location ^~ /${SECURE_PATH}/ {
        try_files \$uri \$uri/ /${SECURE_PATH}/index.html;
    }

    location / {
        return 404;
    }
}
EOF
}

check_panel_http_surface() {
  local url headers status auth_header
  url="$(panel_redirect_target)"
  headers="$(curl -k -sSIL --max-time 10 "${url}" 2>/dev/null || true)"

  if [[ -z "${headers}" ]]; then
    warn "面板 URL 自检暂未取到响应，请稍后使用 ou d 查看诊断。"
    return
  fi

  status="$(printf '%s\n' "${headers}" | awk '/^HTTP\// { code = $2 } END { print code }')"
  auth_header="$(printf '%s\n' "${headers}" | awk 'BEGIN { IGNORECASE=1 } /^WWW-Authenticate:/ { print; exit }')"

  if [[ "${auth_header}" =~ [Bb]asic ]] || [[ "${status}" == "401" ]]; then
    die "面板 URL 自检发现浏览器 Basic Auth 响应。当前地址可能命中了旧站点、同端口 Nginx 配置或错误 server_name。请运行 ou d 查看冲突路径，或重新安装时选择 8443/9443 等独立端口。"
  fi

  success "面板 URL 自检通过：前端登录页可达，未发现 WWW-Authenticate: Basic。"
}

install_acme() {
  if [[ ! -x "${HOME}/.acme.sh/acme.sh" ]]; then
    log "安装 acme.sh..."
    curl -fsSL https://get.acme.sh | sh -s email="${ACME_EMAIL}"
  fi

  "${HOME}/.acme.sh/acme.sh" --set-default-ca --server letsencrypt >/dev/null
  "${HOME}/.acme.sh/acme.sh" --register-account -m "${ACME_EMAIL}" --server letsencrypt >/dev/null 2>&1 || true
  "${HOME}/.acme.sh/acme.sh" --install-cronjob >/dev/null 2>&1 || warn "acme.sh cron 续期任务未能自动安装，请检查 cron/crond 服务状态。"
}

validate_domain_preflight() {
  if [[ "${HAS_DOMAIN}" != "yes" ]]; then
    return
  fi

  local resolved_ips=""
  resolved_ips="$(getent ahosts "${DOMAIN}" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ' || true)"

  if [[ -z "${resolved_ips}" ]]; then
    die "域名 ${DOMAIN} 暂未解析到任何 A/AAAA 地址，无法自动签发证书。"
  fi

  local local_ips=""
  local_ips="$(hostname -I 2>/dev/null | tr ' ' '\n' | sed '/^$/d' | sort -u | tr '\n' ' ' || true)"

  if [[ -z "${local_ips}" ]]; then
    warn "无法自动读取本机 IP，将继续尝试 ACME HTTP-01 验证。"
    return
  fi

  local matched="no"
  local resolved_ip=""
  local local_ip=""

  for resolved_ip in ${resolved_ips}; do
    for local_ip in ${local_ips}; do
      if [[ "${resolved_ip}" == "${local_ip}" ]]; then
        matched="yes"
      fi
    done
  done

  if [[ "${matched}" != "yes" ]]; then
    warn "域名 ${DOMAIN} 当前解析到：${resolved_ips}；本机地址：${local_ips}。如服务器位于 NAT/CDN 后方，请确认 80 端口可被 CA 访问。"
  fi
}

issue_certificate() {
  log "准备通过 acme.sh 自动签发 SSL 证书..."

  write_nginx_config_for_acme
  nginx -t
  ensure_service_enabled nginx
  systemctl reload nginx

  install_acme

  "${HOME}/.acme.sh/acme.sh" --issue --webroot "${ACME_WEBROOT}" -d "${DOMAIN}" --server letsencrypt --keylength ec-256
  "${HOME}/.acme.sh/acme.sh" --install-cert -d "${DOMAIN}" --ecc \
    --fullchain-file "${SSL_DIR}/fullchain.cer" \
    --key-file "${SSL_DIR}/${DOMAIN}.key" \
    --reloadcmd "systemctl reload nginx"
}

configure_nginx() {
  system_port_conflict_preflight
  nginx_port_conflict_preflight

  if [[ "${HAS_DOMAIN}" == "yes" ]]; then
    validate_domain_preflight
    issue_certificate
    write_nginx_config_https
  else
    write_nginx_config_http
  fi

  nginx -t
  ensure_service_enabled nginx
  systemctl reload nginx
}

print_summary() {
  PUBLIC_ENDPOINT="$(panel_redirect_target)"

  printf "\n%b============================================================%b\n" "${GREEN}" "${RESET}"
  printf "%bOU-UI Next Master 安装完成%b\n" "${BOLD}${GREEN}" "${RESET}"
  printf "%b============================================================%b\n" "${GREEN}" "${RESET}"
  printf "%b访问链接：%b %s\n" "${BOLD}" "${RESET}" "${PUBLIC_ENDPOINT}"
  printf "%b安全路径：%b /%s\n" "${BOLD}" "${RESET}" "${SECURE_PATH}"
  printf "%b操作员账号：%b %s\n" "${BOLD}" "${RESET}" "${ADMIN_USER}"
  printf "%b操作员密码：%b %s\n" "${BOLD}" "${RESET}" "${ADMIN_PASSWORD}"
  printf "%b前端登录页：%b 已启用（不会再弹系统认证框）\n" "${BOLD}" "${RESET}"
  printf "%bAgent 引导令牌：%b 已写入 %s（仅用于后端校验，不在前端明文展示）\n" "${BOLD}" "${RESET}" "${BACKEND_ENV_FILE}"
  printf "%b管理命令：%b ou\n" "${BOLD}" "${RESET}"
  printf "%b快捷入口：%b ou-ui / ou / ouui / ou-ui-next\n" "${BOLD}" "${RESET}"
  if [[ "${HAS_DOMAIN}" == "yes" ]]; then
    printf "%bSSL 证书：%b Let's Encrypt 自动签发与自动续期已启用\n" "${BOLD}" "${RESET}"
  else
    printf "%bSSL 证书：%b 当前为 IP + 端口模式，未启用 HTTPS\n" "${BOLD}" "${RESET}"
  fi
  printf "%b后端服务：%b systemctl status %s\n" "${BOLD}" "${RESET}" "${SERVICE_NAME}"
  printf "%bNginx 配置：%b %s\n" "${BOLD}" "${RESET}" "${NGINX_CONF}"
  printf "%b============================================================%b\n\n" "${GREEN}" "${RESET}"
}

main() {
  require_root
  require_linux
  detect_package_manager
  prompt_agreement
  prompt_port
  prompt_domain_mode
  generate_secrets
  install_system_packages
  ensure_service_enabled cron || ensure_service_enabled crond
  ensure_nodejs
  ensure_service_user
  prepare_directories
  reset_control_plane_state_if_needed
  sync_repository
  write_frontend_env
  write_backend_env
  install_dependencies_and_build
  deploy_frontend_bundle
  install_management_cli
  write_systemd_service
  configure_nginx
  check_panel_http_surface
  success "后端服务与静态资源部署完成。"
  print_summary
}

if [[ "${1:-}" == "repair-cli" ]]; then
  require_root
  install_management_cli
  success "管理命令已刷新：ou-ui / ou / ouui / ou-ui-next"
  exit 0
fi

main "$@"
