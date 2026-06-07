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
CREDENTIALS_FILE="${CONFIG_DIR}/credentials.env"
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
OPERATOR_SESSION_SECRET=""
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
   - /etc/fstab（仅低内存构建需要临时 swap 时）
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
        read -r -p "请输入接收 SSL 续期通知的邮箱 [默认 ops@${DOMAIN}]： " ACME_EMAIL
        ACME_EMAIL="${ACME_EMAIL:-ops@${DOMAIN}}"
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
  OPERATOR_SESSION_SECRET="$(random_string 64)"
  AGENT_BOOTSTRAP_TOKEN="$(random_string 48)"
}

read_install_env_value() {
  local file="$1"
  local key="$2"

  if [[ -f "${file}" ]]; then
    awk -F= -v key="${key}" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "${file}"
  fi
}

read_existing_secure_path() {
  local base_url
  base_url="$(read_install_env_value "${APP_DIR}/.env.production.local" VITE_CONTROL_PLANE_BASE_URL)"
  base_url="${base_url#/}"
  base_url="${base_url%/}"
  printf '%s' "${base_url}"
}

read_existing_agent_bootstrap_token() {
  local tokens_json
  tokens_json="$(read_install_env_value "${BACKEND_ENV_FILE}" OU_UI_CONTROL_PLANE_AGENT_TOKENS_JSON)"
  printf '%s' "${tokens_json}" | sed -n 's/.*"'"${AGENT_BOOTSTRAP_ID}"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1
}

preserve_existing_install_identity_if_needed() {
  [[ "${OU_UI_PRESERVE_STATE:-0}" == "1" ]] || return 0

  local existing_secure_path existing_admin_user existing_admin_password existing_operator_token existing_session_secret existing_agent_token

  existing_secure_path="$(read_existing_secure_path)"
  existing_admin_user="$(read_install_env_value "${BACKEND_ENV_FILE}" OU_UI_CONTROL_PLANE_OPERATOR_USERNAME)"
  existing_admin_user="${existing_admin_user:-$(read_install_env_value "${CREDENTIALS_FILE}" OU_UI_CONTROL_PLANE_OPERATOR_USERNAME)}"
  existing_admin_password="$(read_install_env_value "${CREDENTIALS_FILE}" OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD)"
  existing_admin_password="${existing_admin_password:-$(read_install_env_value "${BACKEND_ENV_FILE}" OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD)}"
  existing_operator_token="$(read_install_env_value "${BACKEND_ENV_FILE}" OU_UI_CONTROL_PLANE_OPERATOR_TOKEN)"
  existing_session_secret="$(read_install_env_value "${BACKEND_ENV_FILE}" OU_UI_CONTROL_PLANE_OPERATOR_SESSION_SECRET)"
  existing_agent_token="$(read_existing_agent_bootstrap_token)"

  [[ -n "${existing_secure_path}" ]] && SECURE_PATH="${existing_secure_path}"
  [[ -n "${existing_admin_user}" ]] && ADMIN_USER="${existing_admin_user}"
  [[ -n "${existing_admin_password}" ]] && ADMIN_PASSWORD="${existing_admin_password}"
  [[ -n "${existing_operator_token}" ]] && OPERATOR_TOKEN="${existing_operator_token}"
  [[ -n "${existing_session_secret}" ]] && OPERATOR_SESSION_SECRET="${existing_session_secret}"
  [[ -n "${existing_agent_token}" ]] && AGENT_BOOTSTRAP_TOKEN="${existing_agent_token}"

  log "检测到重配模式：保留现有面板安全路径、登录凭据和后端认证令牌。"
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
  mkdir -p "${INSTALL_ROOT}" "${CONFIG_DIR}" "${STATE_DIR}" "${STATE_DIR}/npm-cache" "${STATE_DIR}/external-archives" "${WEB_ROOT}" "${ACME_WEBROOT}" "${SSL_DIR}"
  chown -R "${SERVICE_USER}:${SERVICE_USER}" "${STATE_DIR}"
  chmod 700 "${STATE_DIR}" "${STATE_DIR}/npm-cache" "${STATE_DIR}/external-archives" 2>/dev/null || true
}

reset_control_plane_state_if_needed() {
  if [[ "${OU_UI_PRESERVE_STATE:-0}" == "1" ]]; then
    log "检测到更新模式，保留现有控制面状态。"
    return
  fi

  if [[ -f "${STATE_DIR}/control-plane-state.json" ]] ||
    [[ -f "${STATE_DIR}/control-plane.sqlite" ]] ||
    [[ -f "${STATE_DIR}/control-plane.sqlite-shm" ]] ||
    [[ -f "${STATE_DIR}/control-plane.sqlite-wal" ]]; then
    log "检测到旧的控制面持久化状态，按全新安装流程重置。"
    rm -f \
      "${STATE_DIR}/control-plane-state.json" \
      "${STATE_DIR}/control-plane.sqlite" \
      "${STATE_DIR}/control-plane.sqlite-shm" \
      "${STATE_DIR}/control-plane.sqlite-wal"
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
VITE_CONTROL_PLANE_OPERATOR_GROUP_ID=owner
VITE_CONTROL_PLANE_RESOURCE_GROUP_ID=group-premium
EOF
}

generate_operator_password_hash() {
  local password="$1"

  printf '%s' "${password}" | node -e '
const { randomBytes, scryptSync } = require("node:crypto");
const chunks = [];
process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("end", () => {
  const password = Buffer.concat(chunks);
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 32);
  process.stdout.write(`scrypt:v1:${salt.toString("hex")}:${key.toString("hex")}`);
});
'
}

write_operator_credentials() {
  local username="$1"
  local password="$2"

  mkdir -p "${CONFIG_DIR}"
  cat >"${CREDENTIALS_FILE}" <<EOF
OU_UI_CONTROL_PLANE_OPERATOR_USERNAME=${username}
OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD=${password}
EOF
  chmod 600 "${CREDENTIALS_FILE}"
}

write_backend_env() {
  local operator_password_hash
  operator_password_hash="$(generate_operator_password_hash "${ADMIN_PASSWORD}")"
  write_operator_credentials "${ADMIN_USER}" "${ADMIN_PASSWORD}"

  cat >"${BACKEND_ENV_FILE}" <<EOF
OU_UI_CONTROL_PLANE_HOST=${BACKEND_HOST}
OU_UI_CONTROL_PLANE_PORT=${BACKEND_PORT}
OU_UI_CONTROL_PLANE_STORAGE=sqlite
OU_UI_CONTROL_PLANE_SQLITE_FILE=${STATE_DIR}/control-plane.sqlite
OU_UI_CONTROL_PLANE_OPERATOR_TOKEN=${OPERATOR_TOKEN}
OU_UI_CONTROL_PLANE_OPERATOR_USERNAME=${ADMIN_USER}
OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD_HASH=${operator_password_hash}
OU_UI_CONTROL_PLANE_OPERATOR_SESSION_SECRET=${OPERATOR_SESSION_SECRET}
OU_UI_CONTROL_PLANE_OPERATOR_SESSION_TTL_MS=28800000
OU_UI_CONTROL_PLANE_OPERATOR_ACTOR=${ADMIN_USER}
OU_UI_CONTROL_PLANE_OPERATOR_GROUP_ID=owner
OU_UI_CONTROL_PLANE_RESOURCE_GROUP_ID=group-premium
OU_UI_CONTROL_PLANE_AGENT_TOKENS_JSON={"${AGENT_BOOTSTRAP_ID}":"${AGENT_BOOTSTRAP_TOKEN}"}
OU_UI_CONTROL_PLANE_INITIAL_STATE=empty
OU_UI_AGENT_LOG_RETENTION_DAYS=7
OU_UI_AGENT_LOG_MAX_EVENTS_PER_AGENT=5000
OU_UI_EXTERNAL_ARCHIVE_DIRECTORY=${STATE_DIR}/external-archives
OU_UI_COMMAND_TIMEOUT_SWEEP_ENABLED=true
OU_UI_COMMAND_TIMEOUT_SWEEP_INTERVAL_MS=30000
OU_UI_COMMAND_ACK_TIMEOUT_MS=15000
OU_UI_COMMAND_RESULT_TIMEOUT_MS=120000
OU_UI_COMMAND_TIMEOUT_SWEEP_MAX_COMMANDS=500
OU_UI_SUBSCRIPTION_SOURCE_EGRESS_ALLOWLIST=
EOF

  chmod 600 "${BACKEND_ENV_FILE}"
}

link_management_cli_alias() {
  local alias_path="$1"

  if [[ -e "${alias_path}" && ! -L "${alias_path}" ]]; then
    warn "跳过快捷入口 ${alias_path}：该路径已存在且不是符号链接。"
    return
  fi

  ln -sf "/usr/local/bin/ou-ui-next" "${alias_path}"
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
CREDENTIALS_FILE="${CREDENTIALS_FILE}"
BACKEND_HOST_DEFAULT="${BACKEND_HOST}"
BACKEND_PORT_DEFAULT="${BACKEND_PORT}"
REPO_URL="${DEFAULT_REPO_URL}"
REPO_REF="${DEFAULT_REPO_REF}"
SCRIPT_VERSION="${SCRIPT_VERSION}"
INSTALL_SCRIPT_URL="https://raw.githubusercontent.com/cshaizhihao/ou-ui-next/main/scripts/install-master.sh"
EOF

    cat <<'EOF'

log() {
  printf "[%s] %s\n" "${APP_NAME}" "$1"
}

warn() {
  printf "[警告] %s\n" "$1"
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

read_operator_username() {
  local username
  username="$(read_backend_env_value OU_UI_CONTROL_PLANE_OPERATOR_USERNAME)"
  username="${username:-$(read_credentials_env_value OU_UI_CONTROL_PLANE_OPERATOR_USERNAME)}"
  username="${username:-$(read_frontend_env_value VITE_CONTROL_PLANE_LOGIN_USERNAME)}"
  printf '%s' "${username}"
}

read_operator_password() {
  local password
  password="$(read_credentials_env_value OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD)"
  password="${password:-$(read_backend_env_value OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD)}"
  password="${password:-$(read_frontend_env_value VITE_CONTROL_PLANE_LOGIN_PASSWORD)}"
  printf '%s' "${password}"
}

is_default_operator_credential() {
  local username password
  username="$(read_operator_username)"
  password="$(read_operator_password)"

  [[ "${username}" == "admin" || "${password}" == "admin" || "${password}" == "local-password" || "${password}" == "password" ]]
}

show_credentials() {
  local url username password
  url="$(panel_url)"
  username="$(read_operator_username)"
  password="$(read_operator_password)"

  if [[ -z "${username}" || -z "${password}" ]]; then
    fail "登录凭据不可用。请重新运行安装脚本，或检查后端运行环境文件。"
  fi

  cat <<EOT
OU-UI Next 登录信息
  面板地址: ${url}
  账号: ${username}
  密码: ${password}
EOT
}

run_production_smoke() {
  local base_url
  base_url="$(panel_url)"

  [[ -n "${base_url}" && "${base_url}" != "暂不可用" ]] || fail "无法运行生产烟测：面板地址不可用。请先运行 ou d 查看诊断。"
  [[ -f "${APP_DIR}/scripts/production-smoke.cjs" ]] || fail "无法运行生产烟测：未找到 ${APP_DIR}/scripts/production-smoke.cjs。请先运行 ou u 更新源码。"

  (
    cd "${APP_DIR}"
    OU_UI_SMOKE_BASE_URL="${base_url}" \
      OU_UI_SMOKE_CREDENTIALS_FILE="${CREDENTIALS_FILE}" \
      node "${APP_DIR}/scripts/production-smoke.cjs" "$@"
  )
}

run_production_browser_smoke() {
  local base_url
  base_url="$(panel_url)"

  [[ -n "${base_url}" && "${base_url}" != "暂不可用" ]] || fail "无法运行浏览器烟测：面板地址不可用。请先运行 ou d 查看诊断。"
  [[ -f "${APP_DIR}/scripts/production-browser-smoke.cjs" ]] || fail "无法运行浏览器烟测：未找到 ${APP_DIR}/scripts/production-browser-smoke.cjs。请先运行 ou u 更新源码。"

  (
    cd "${APP_DIR}"
    OU_UI_BROWSER_SMOKE_BASE_URL="${base_url}" \
      OU_UI_BROWSER_SMOKE_CREDENTIALS_FILE="${CREDENTIALS_FILE}" \
      node "${APP_DIR}/scripts/production-browser-smoke.cjs" "$@"
  )
}

run_production_notification_smoke() {
  local base_url
  base_url="$(panel_url)"

  [[ -n "${base_url}" && "${base_url}" != "暂不可用" ]] || fail "无法运行通知烟测：面板地址不可用。请先运行 ou d 查看诊断。"
  [[ -f "${APP_DIR}/scripts/production-notification-smoke.cjs" ]] || fail "无法运行通知烟测：未找到 ${APP_DIR}/scripts/production-notification-smoke.cjs。请先运行 ou u 更新源码。"

  (
    cd "${APP_DIR}"
    OU_UI_NOTIFICATION_SMOKE_BASE_URL="${base_url}" \
      OU_UI_NOTIFICATION_SMOKE_CREDENTIALS_FILE="${CREDENTIALS_FILE}" \
      node "${APP_DIR}/scripts/production-notification-smoke.cjs" "$@"
  )
}

run_production_webhook_smoke() {
  [[ -f "${APP_DIR}/scripts/production-webhook-smoke.cjs" ]] || fail "无法运行 webhook 烟测：未找到 ${APP_DIR}/scripts/production-webhook-smoke.cjs。请先运行 ou u 更新源码。"

  (
    cd "${APP_DIR}"
    OU_UI_WEBHOOK_SMOKE_ENV_FILE="${BACKEND_ENV_FILE}" \
      node "${APP_DIR}/scripts/production-webhook-smoke.cjs" "$@"
  )
}

run_production_archive_smoke() {
  [[ -f "${APP_DIR}/scripts/production-archive-smoke.ts" ]] || fail "无法运行归档烟测：未找到 ${APP_DIR}/scripts/production-archive-smoke.ts。请先运行 ou u 更新源码。"
  [[ -x "${APP_DIR}/node_modules/.bin/tsx" ]] || fail "无法运行归档烟测：未找到 ${APP_DIR}/node_modules/.bin/tsx。请先运行 ou u 更新依赖。"

  (
    cd "${APP_DIR}"
    OU_UI_ARCHIVE_SMOKE_ENV_FILE="${BACKEND_ENV_FILE}" \
      "${APP_DIR}/node_modules/.bin/tsx" "${APP_DIR}/scripts/production-archive-smoke.ts" "$@"
  )
}

validate_production_acceptance_smoke_args() {
  local arg

  while (($# > 0)); do
    arg="$1"
    case "${arg}" in
      --report|--base-url|--credentials-file|--screenshot-dir|--env-file)
        fail "acceptance 会固定使用当前面板 URL、root-only 凭据文件和证据包内 smoke-report.json；请不要传入 ${arg}。"
        ;;
      --report=*|--base-url=*|--credentials-file=*|--screenshot-dir=*|--env-file=*)
        fail "acceptance 会固定使用当前面板 URL、root-only 凭据文件和证据包内 smoke-report.json；请不要传入 ${arg%%=*}。"
        ;;
      --timeout-ms)
        [[ -n "${2:-}" ]] || fail "acceptance 参数 --timeout-ms 需要数值。"
        shift 2
        continue
        ;;
      --external-receipt|--receipt-file|--archive-provider-evidence|--timestamp-evidence|--agent-evidence|--install-evidence)
        [[ -n "${2:-}" ]] || fail "acceptance 参数 ${arg} 需要值。"
        shift 2
        continue
        ;;
      --telegram-admin-chat-id|--telegram-binding-id|--notification-language)
        [[ -n "${2:-}" ]] || fail "acceptance 参数 ${arg} 需要值。"
        shift 2
        continue
        ;;
      --webhook-url|--webhook-urls|--webhook-bearer-token|--webhook-bearer-token-file)
        [[ -n "${2:-}" ]] || fail "acceptance 参数 ${arg} 需要值。"
        shift 2
        continue
        ;;
      --insecure-tls|--skip-csrf-probe|--skip-browser-smoke|--require-runtime-evidence|--include-notification-smoke|--include-webhook-smoke|--include-archive-smoke|--allow-local-webhook|--webhook-allow-local|--require-archive-provider-evidence|--require-timestamp-evidence|--require-clean-install-evidence)
        shift
        continue
        ;;
      --)
        shift
        if (($# > 0)); then
          fail "acceptance 不接受位置参数；面板地址由安装器自动推导。"
        fi
        break
        ;;
      -*)
        fail "acceptance 不支持参数 ${arg}；可透传 --timeout-ms、--insecure-tls、--skip-csrf-probe、--skip-browser-smoke、--require-runtime-evidence、--include-notification-smoke、--telegram-admin-chat-id、--telegram-binding-id、--notification-language、--include-webhook-smoke、--webhook-url、--webhook-urls、--webhook-bearer-token、--webhook-bearer-token-file、--allow-local-webhook、--include-archive-smoke、--external-receipt、--archive-provider-evidence、--timestamp-evidence、--install-evidence、--agent-evidence、--require-archive-provider-evidence、--require-timestamp-evidence、--require-clean-install-evidence。"
        ;;
      *)
        fail "acceptance 不接受位置参数；面板地址由安装器自动推导。"
        ;;
    esac
  done
}

collect_production_acceptance_webhook_smoke_args() {
  local arg
  ACCEPTANCE_WEBHOOK_SMOKE_ARGS=()
  ACCEPTANCE_INCLUDE_WEBHOOK_SMOKE=0

  while (($# > 0)); do
    arg="$1"
    case "${arg}" in
      --include-webhook-smoke)
        ACCEPTANCE_INCLUDE_WEBHOOK_SMOKE=1
        shift
        ;;
      --timeout-ms)
        ACCEPTANCE_WEBHOOK_SMOKE_ARGS+=("${arg}" "${2:-}")
        shift 2
        ;;
      --webhook-url)
        ACCEPTANCE_WEBHOOK_SMOKE_ARGS+=("--url" "${2:-}")
        shift 2
        ;;
      --webhook-urls)
        ACCEPTANCE_WEBHOOK_SMOKE_ARGS+=("--urls" "${2:-}")
        shift 2
        ;;
      --webhook-bearer-token)
        ACCEPTANCE_WEBHOOK_SMOKE_ARGS+=("--bearer-token" "${2:-}")
        shift 2
        ;;
      --webhook-bearer-token-file)
        ACCEPTANCE_WEBHOOK_SMOKE_ARGS+=("--bearer-token-file" "${2:-}")
        shift 2
        ;;
      --allow-local-webhook|--webhook-allow-local)
        ACCEPTANCE_WEBHOOK_SMOKE_ARGS+=("--allow-local")
        shift
        ;;
      --telegram-admin-chat-id|--telegram-binding-id|--notification-language|--external-receipt|--receipt-file|--archive-provider-evidence|--timestamp-evidence|--agent-evidence|--install-evidence)
        shift 2
        ;;
      --)
        break
        ;;
      *)
        shift
        ;;
    esac
  done
}

collect_production_acceptance_archive_smoke_args() {
  local arg
  ACCEPTANCE_ARCHIVE_SMOKE_ARGS=()
  ACCEPTANCE_INCLUDE_ARCHIVE_SMOKE=0

  while (($# > 0)); do
    arg="$1"
    case "${arg}" in
      --include-archive-smoke)
        ACCEPTANCE_INCLUDE_ARCHIVE_SMOKE=1
        shift
        ;;
      --timeout-ms|--telegram-admin-chat-id|--telegram-binding-id|--notification-language|--webhook-url|--webhook-urls|--webhook-bearer-token|--webhook-bearer-token-file|--external-receipt|--receipt-file|--archive-provider-evidence|--timestamp-evidence|--agent-evidence|--install-evidence)
        shift 2
        ;;
      --insecure-tls|--skip-csrf-probe|--skip-browser-smoke|--require-runtime-evidence|--include-notification-smoke|--include-webhook-smoke|--allow-local-webhook|--webhook-allow-local|--require-archive-provider-evidence|--require-timestamp-evidence|--require-clean-install-evidence)
        shift
        ;;
      --)
        break
        ;;
      *)
        shift
        ;;
    esac
  done
}

collect_production_acceptance_external_receipt_args() {
  local arg
  ACCEPTANCE_EXTERNAL_RECEIPT_FILES=()
  ACCEPTANCE_ARCHIVE_PROVIDER_EVIDENCE_FILES=()
  ACCEPTANCE_TIMESTAMP_EVIDENCE_FILES=()

  while (($# > 0)); do
    arg="$1"
    case "${arg}" in
      --external-receipt|--receipt-file)
        ACCEPTANCE_EXTERNAL_RECEIPT_FILES+=("${2:-}")
        shift 2
        ;;
      --archive-provider-evidence)
        ACCEPTANCE_EXTERNAL_RECEIPT_FILES+=("${2:-}")
        ACCEPTANCE_ARCHIVE_PROVIDER_EVIDENCE_FILES+=("${2:-}")
        shift 2
        ;;
      --timestamp-evidence)
        ACCEPTANCE_EXTERNAL_RECEIPT_FILES+=("${2:-}")
        ACCEPTANCE_TIMESTAMP_EVIDENCE_FILES+=("${2:-}")
        shift 2
        ;;
      --timeout-ms|--telegram-admin-chat-id|--telegram-binding-id|--notification-language|--webhook-url|--webhook-urls|--webhook-bearer-token|--webhook-bearer-token-file|--agent-evidence|--install-evidence)
        shift 2
        ;;
      --insecure-tls|--skip-csrf-probe|--skip-browser-smoke|--require-runtime-evidence|--include-notification-smoke|--include-webhook-smoke|--include-archive-smoke|--allow-local-webhook|--webhook-allow-local|--require-archive-provider-evidence|--require-timestamp-evidence|--require-clean-install-evidence)
        shift
        ;;
      --)
        break
        ;;
      *)
        shift
        ;;
    esac
  done
}

collect_production_acceptance_install_evidence_args() {
  local arg
  ACCEPTANCE_INSTALL_EVIDENCE_FILES=()

  while (($# > 0)); do
    arg="$1"
    case "${arg}" in
      --install-evidence)
        ACCEPTANCE_INSTALL_EVIDENCE_FILES+=("${2:-}")
        shift 2
        ;;
      --timeout-ms|--telegram-admin-chat-id|--telegram-binding-id|--notification-language|--webhook-url|--webhook-urls|--webhook-bearer-token|--webhook-bearer-token-file|--external-receipt|--receipt-file|--archive-provider-evidence|--timestamp-evidence|--agent-evidence)
        shift 2
        ;;
      --insecure-tls|--skip-csrf-probe|--skip-browser-smoke|--require-runtime-evidence|--include-notification-smoke|--include-webhook-smoke|--include-archive-smoke|--allow-local-webhook|--webhook-allow-local|--require-archive-provider-evidence|--require-timestamp-evidence|--require-clean-install-evidence)
        shift
        ;;
      --)
        break
        ;;
      *)
        shift
        ;;
    esac
  done
}

collect_production_acceptance_agent_evidence_args() {
  local arg
  ACCEPTANCE_AGENT_EVIDENCE_PATHS=()

  while (($# > 0)); do
    arg="$1"
    case "${arg}" in
      --agent-evidence)
        ACCEPTANCE_AGENT_EVIDENCE_PATHS+=("${2:-}")
        shift 2
        ;;
      --timeout-ms|--telegram-admin-chat-id|--telegram-binding-id|--notification-language|--webhook-url|--webhook-urls|--webhook-bearer-token|--webhook-bearer-token-file|--external-receipt|--receipt-file|--archive-provider-evidence|--timestamp-evidence|--install-evidence)
        shift 2
        ;;
      --insecure-tls|--skip-csrf-probe|--skip-browser-smoke|--require-runtime-evidence|--include-notification-smoke|--include-webhook-smoke|--include-archive-smoke|--allow-local-webhook|--webhook-allow-local|--require-archive-provider-evidence|--require-timestamp-evidence|--require-clean-install-evidence)
        shift
        ;;
      --)
        break
        ;;
      *)
        shift
        ;;
    esac
  done
}

collect_production_acceptance_notification_smoke_args() {
  local arg
  ACCEPTANCE_NOTIFICATION_SMOKE_ARGS=()
  ACCEPTANCE_INCLUDE_NOTIFICATION_SMOKE=0

  while (($# > 0)); do
    arg="$1"
    case "${arg}" in
      --include-notification-smoke)
        ACCEPTANCE_INCLUDE_NOTIFICATION_SMOKE=1
        shift
        ;;
      --timeout-ms)
        ACCEPTANCE_NOTIFICATION_SMOKE_ARGS+=("${arg}" "${2:-}")
        shift 2
        ;;
      --insecure-tls)
        ACCEPTANCE_NOTIFICATION_SMOKE_ARGS+=("${arg}")
        shift
        ;;
      --telegram-admin-chat-id|--telegram-binding-id)
        ACCEPTANCE_NOTIFICATION_SMOKE_ARGS+=("${arg}" "${2:-}")
        shift 2
        ;;
      --notification-language)
        ACCEPTANCE_NOTIFICATION_SMOKE_ARGS+=("--language" "${2:-}")
        shift 2
        ;;
      --webhook-url|--webhook-urls|--webhook-bearer-token|--webhook-bearer-token-file|--external-receipt|--receipt-file|--archive-provider-evidence|--timestamp-evidence|--agent-evidence|--install-evidence)
        shift 2
        ;;
      --include-webhook-smoke|--include-archive-smoke|--allow-local-webhook|--webhook-allow-local|--require-archive-provider-evidence|--require-timestamp-evidence|--require-clean-install-evidence)
        shift
        ;;
      --)
        break
        ;;
      *)
        shift
        ;;
    esac
  done
}

collect_production_acceptance_http_smoke_args() {
  local arg
  ACCEPTANCE_HTTP_SMOKE_ARGS=()

  while (($# > 0)); do
    arg="$1"
    case "${arg}" in
      --timeout-ms)
        ACCEPTANCE_HTTP_SMOKE_ARGS+=("${arg}" "${2:-}")
        shift 2
        ;;
      --insecure-tls|--skip-csrf-probe|--require-runtime-evidence)
        ACCEPTANCE_HTTP_SMOKE_ARGS+=("${arg}")
        shift
        ;;
      --skip-browser-smoke|--include-notification-smoke|--include-webhook-smoke|--include-archive-smoke|--allow-local-webhook|--webhook-allow-local|--require-archive-provider-evidence|--require-timestamp-evidence|--require-clean-install-evidence)
        shift
        ;;
      --telegram-admin-chat-id|--telegram-binding-id|--notification-language|--webhook-url|--webhook-urls|--webhook-bearer-token|--webhook-bearer-token-file|--external-receipt|--receipt-file|--archive-provider-evidence|--timestamp-evidence|--agent-evidence|--install-evidence)
        shift 2
        ;;
      --)
        break
        ;;
      *)
        shift
        ;;
    esac
  done
}

collect_production_acceptance_browser_smoke_args() {
  local arg
  ACCEPTANCE_BROWSER_SMOKE_ARGS=()
  ACCEPTANCE_SKIP_BROWSER_SMOKE=0

  while (($# > 0)); do
    arg="$1"
    case "${arg}" in
      --timeout-ms)
        ACCEPTANCE_BROWSER_SMOKE_ARGS+=("${arg}" "${2:-}")
        shift 2
        ;;
      --insecure-tls)
        ACCEPTANCE_BROWSER_SMOKE_ARGS+=("${arg}")
        shift
        ;;
      --skip-browser-smoke)
        ACCEPTANCE_SKIP_BROWSER_SMOKE=1
        shift
        ;;
      --skip-csrf-probe)
        shift
        ;;
      --require-runtime-evidence)
        shift
        ;;
      --include-notification-smoke)
        shift
        ;;
      --include-webhook-smoke|--include-archive-smoke|--allow-local-webhook|--webhook-allow-local|--require-archive-provider-evidence|--require-timestamp-evidence|--require-clean-install-evidence)
        shift
        ;;
      --telegram-admin-chat-id|--telegram-binding-id|--notification-language|--webhook-url|--webhook-urls|--webhook-bearer-token|--webhook-bearer-token-file|--external-receipt|--receipt-file|--archive-provider-evidence|--timestamp-evidence|--agent-evidence|--install-evidence)
        shift 2
        ;;
      --)
        break
        ;;
      *)
        shift
        ;;
    esac
  done
}

production_acceptance_file_manifest_json() {
  local file_path="$1"
  local escaped_file_path file_size file_sha

  escaped_file_path="$(json_escape_string "${file_path}")"

  if [[ ! -f "${file_path}" ]]; then
    printf '{"path":"%s","missing":true}' "${escaped_file_path}"
    return
  fi

  file_size="$(wc -c <"${file_path}" | tr -d '[:space:]')"
  file_sha="$(sha256_file "${file_path}")"
  printf '{"path":"%s","sizeBytes":%s,"sha256":"%s"}' "${escaped_file_path}" "${file_size:-0}" "${file_sha}"
}

sanitize_production_acceptance_receipt_basename() {
  local raw_name="$1" sanitized_name
  sanitized_name="$(printf '%s' "${raw_name}" | tr -c 'A-Za-z0-9._-' '_' | sed 's/^_*//; s/_*$//')"
  [[ -n "${sanitized_name}" ]] || sanitized_name="receipt"
  printf '%s' "${sanitized_name:0:96}"
}

write_production_acceptance_external_receipts_manifest() {
  local started_at="$1" receipts_dir="$2" receipts_manifest="$3"
  shift 3

  local receipt_count=0 receipts_json="" separator="" source_file source_basename safe_basename target_name target_path
  local escaped_source_basename escaped_relative_path file_manifest

  mkdir -p "${receipts_dir}"
  chmod 700 "${receipts_dir}" 2>/dev/null || true

  for source_file in "$@"; do
    [[ -f "${source_file}" ]] || fail "外部回执文件不存在或不是普通文件：${source_file}"
    [[ -r "${source_file}" ]] || fail "外部回执文件不可读取：${source_file}"

    receipt_count=$((receipt_count + 1))
    source_basename="$(basename -- "${source_file}")"
    safe_basename="$(sanitize_production_acceptance_receipt_basename "${source_basename}")"
    target_name="$(printf '%03d-%s' "${receipt_count}" "${safe_basename}")"
    target_path="${receipts_dir}/${target_name}"

    cp -- "${source_file}" "${target_path}" || fail "无法复制外部回执文件：${source_file}"
    chmod 600 "${target_path}" 2>/dev/null || true

    escaped_source_basename="$(json_escape_string "${safe_basename}")"
    escaped_relative_path="$(json_escape_string "external-receipts/${target_name}")"
    file_manifest="$(production_acceptance_file_manifest_json "${target_path}")"
    receipts_json="${receipts_json}${separator}{\"sourceBasename\":\"${escaped_source_basename}\",\"relativePath\":\"${escaped_relative_path}\",\"file\":${file_manifest}}"
    separator=","
  done

  printf '{"schemaVersion":"ou-ui-next.production-external-receipts.v1","createdAt":"%s","receiptCount":%s,"receipts":[%s]}\n' "${started_at}" "${receipt_count}" "${receipts_json}" >"${receipts_manifest}"
  chmod 600 "${receipts_manifest}" 2>/dev/null || true
  PRODUCTION_ACCEPTANCE_EXTERNAL_RECEIPT_COUNT="${receipt_count}"
}

write_production_acceptance_install_evidence_manifest() {
  local started_at="$1" install_evidence_dir="$2" install_evidence_manifest="$3"
  shift 3

  local evidence_count=0 evidence_json="" separator="" source_file source_basename safe_basename target_name target_path
  local escaped_source_basename escaped_relative_path file_manifest

  mkdir -p "${install_evidence_dir}"
  chmod 700 "${install_evidence_dir}" 2>/dev/null || true

  for source_file in "$@"; do
    [[ -f "${source_file}" ]] || fail "安装证据文件不存在或不是普通文件：${source_file}"
    [[ -r "${source_file}" ]] || fail "安装证据文件不可读取：${source_file}"

    evidence_count=$((evidence_count + 1))
    source_basename="$(basename -- "${source_file}")"
    safe_basename="$(sanitize_production_acceptance_receipt_basename "${source_basename}")"
    target_name="$(printf '%03d-%s' "${evidence_count}" "${safe_basename}")"
    target_path="${install_evidence_dir}/${target_name}"

    cp -- "${source_file}" "${target_path}" || fail "无法复制安装证据文件：${source_file}"
    chmod 600 "${target_path}" 2>/dev/null || true

    escaped_source_basename="$(json_escape_string "${safe_basename}")"
    escaped_relative_path="$(json_escape_string "install-evidence/${target_name}")"
    file_manifest="$(production_acceptance_file_manifest_json "${target_path}")"
    evidence_json="${evidence_json}${separator}{\"sourceBasename\":\"${escaped_source_basename}\",\"relativePath\":\"${escaped_relative_path}\",\"file\":${file_manifest}}"
    separator=","
  done

  printf '{"schemaVersion":"ou-ui-next.production-install-evidence.v1","createdAt":"%s","installEvidenceCount":%s,"evidence":[%s]}\n' "${started_at}" "${evidence_count}" "${evidence_json}" >"${install_evidence_manifest}"
  chmod 600 "${install_evidence_manifest}" 2>/dev/null || true
  PRODUCTION_ACCEPTANCE_INSTALL_EVIDENCE_COUNT="${evidence_count}"
}

write_production_acceptance_agent_evidence_manifest() {
  local started_at="$1" agent_evidence_dir="$2" agent_evidence_manifest="$3"
  shift 3

  local evidence_count=0 bundles_json="" separator="" source_path source_dir source_manifest source_basename safe_basename target_name target_dir
  local escaped_source_basename escaped_relative_dir files_json file_manifest relative_file

  mkdir -p "${agent_evidence_dir}"
  chmod 700 "${agent_evidence_dir}" 2>/dev/null || true

  for source_path in "$@"; do
    if [[ -d "${source_path}" ]]; then
      source_dir="${source_path%/}"
      source_manifest="${source_dir}/manifest.json"
    else
      source_manifest="${source_path}"
      source_dir="$(dirname -- "${source_manifest}")"
    fi

    [[ -f "${source_manifest}" ]] || fail "Agent 证据 manifest 不存在：${source_manifest}"
    [[ -f "${source_dir}/runtime-summary.json" ]] || fail "Agent 证据缺少 runtime-summary.json：${source_dir}"

    evidence_count=$((evidence_count + 1))
    source_basename="$(basename -- "${source_dir}")"
    safe_basename="$(sanitize_production_acceptance_receipt_basename "${source_basename}")"
    target_name="$(printf '%03d-%s' "${evidence_count}" "${safe_basename}")"
    target_dir="${agent_evidence_dir}/${target_name}"
    mkdir -p "${target_dir}"
    chmod 700 "${target_dir}" 2>/dev/null || true

    cp -- "${source_manifest}" "${target_dir}/manifest.json" || fail "无法复制 Agent 证据 manifest：${source_manifest}"
    cp -- "${source_dir}/runtime-summary.json" "${target_dir}/runtime-summary.json" || fail "无法复制 Agent runtime-summary.json：${source_dir}"
    chmod 600 "${target_dir}/manifest.json" "${target_dir}/runtime-summary.json" 2>/dev/null || true

    files_json="\"manifest\":$(production_acceptance_file_manifest_json "${target_dir}/manifest.json"),\"runtimeSummary\":$(production_acceptance_file_manifest_json "${target_dir}/runtime-summary.json")"
    if [[ -f "${source_dir}/final-acceptance-summary.json" ]]; then
      cp -- "${source_dir}/final-acceptance-summary.json" "${target_dir}/final-acceptance-summary.json" || fail "无法复制 Agent final-acceptance-summary.json：${source_dir}"
      chmod 600 "${target_dir}/final-acceptance-summary.json" 2>/dev/null || true
      files_json="${files_json},\"finalSummary\":$(production_acceptance_file_manifest_json "${target_dir}/final-acceptance-summary.json")"
    fi
    if [[ -f "${source_dir}/final-acceptance-verify.txt" ]]; then
      cp -- "${source_dir}/final-acceptance-verify.txt" "${target_dir}/final-acceptance-verify.txt" || fail "无法复制 Agent final-acceptance-verify.txt：${source_dir}"
      chmod 600 "${target_dir}/final-acceptance-verify.txt" 2>/dev/null || true
      files_json="${files_json},\"finalVerifyLog\":$(production_acceptance_file_manifest_json "${target_dir}/final-acceptance-verify.txt")"
    fi

    escaped_source_basename="$(json_escape_string "${safe_basename}")"
    relative_file="agent-evidence/${target_name}"
    escaped_relative_dir="$(json_escape_string "${relative_file}")"
    bundles_json="${bundles_json}${separator}{\"sourceBasename\":\"${escaped_source_basename}\",\"relativeDirectory\":\"${escaped_relative_dir}\",\"files\":{${files_json}}}"
    separator=","
  done

  printf '{"schemaVersion":"ou-ui-next.production-agent-evidence.v1","createdAt":"%s","agentEvidenceCount":%s,"bundles":[%s]}\n' "${started_at}" "${evidence_count}" "${bundles_json}" >"${agent_evidence_manifest}"
  chmod 600 "${agent_evidence_manifest}" 2>/dev/null || true
  PRODUCTION_ACCEPTANCE_AGENT_EVIDENCE_COUNT="${evidence_count}"
}

production_acceptance_directory() {
  echo "${STATE_DIR}/acceptance"
}

write_clean_install_evidence() {
  require_root

  local output_path="" transcript_path="" install_source="github" installer_exit_code="0"
  local clean_server_confirmed=0 fresh_install_confirmed=0 service_active_confirmed=0 management_cli_confirmed=0 panel_reachable_confirmed=0 frontend_login_confirmed=0
  local arg

  while (($# > 0)); do
    arg="$1"
    case "${arg}" in
      --output|-o)
        [[ -n "${2:-}" ]] || fail "clean-install-evidence 参数 ${arg} 需要路径。"
        output_path="${2:-}"
        shift 2
        ;;
      --transcript)
        [[ -n "${2:-}" ]] || fail "clean-install-evidence 参数 --transcript 需要路径。"
        transcript_path="${2:-}"
        shift 2
        ;;
      --source)
        [[ -n "${2:-}" ]] || fail "clean-install-evidence 参数 --source 需要值。"
        install_source="${2:-}"
        shift 2
        ;;
      --installer-exit-code)
        [[ -n "${2:-}" ]] || fail "clean-install-evidence 参数 --installer-exit-code 需要数值。"
        installer_exit_code="${2:-}"
        shift 2
        ;;
      --clean-server-confirmed)
        clean_server_confirmed=1
        shift
        ;;
      --fresh-install-confirmed)
        fresh_install_confirmed=1
        shift
        ;;
      --service-active-confirmed)
        service_active_confirmed=1
        shift
        ;;
      --management-cli-confirmed)
        management_cli_confirmed=1
        shift
        ;;
      --panel-reachable-confirmed)
        panel_reachable_confirmed=1
        shift
        ;;
      --frontend-login-confirmed)
        frontend_login_confirmed=1
        shift
        ;;
      --)
        shift
        if (($# > 0)); then
          fail "clean-install-evidence 不接受位置参数；请使用 --output 或 --transcript。"
        fi
        break
        ;;
      -*)
        fail "clean-install-evidence 不支持参数 ${arg}；可用 --output、--transcript、--source、--installer-exit-code、--clean-server-confirmed、--fresh-install-confirmed、--service-active-confirmed、--management-cli-confirmed、--panel-reachable-confirmed、--frontend-login-confirmed。"
        ;;
      *)
        fail "clean-install-evidence 不接受位置参数；请使用 --output 或 --transcript。"
        ;;
    esac
  done

  (( clean_server_confirmed == 1 )) || fail "生成严格安装证据需要显式确认干净服务器：请传入 --clean-server-confirmed。"
  (( fresh_install_confirmed == 1 )) || fail "生成严格安装证据需要显式确认 fresh install：请传入 --fresh-install-confirmed。"
  [[ "${installer_exit_code}" =~ ^[0-9]+$ ]] || fail "--installer-exit-code 必须是非负整数。"
  [[ "${installer_exit_code}" == "0" ]] || fail "严格安装证据要求 installer exit code 为 0。"
  [[ "${install_source}" =~ ^[A-Za-z0-9._+-]{1,64}$ ]] || fail "--source 只能是 1-64 位脱敏来源标签，可用字母、数字、点、下划线、加号或连字符。"

  if [[ -n "${transcript_path}" ]]; then
    [[ -f "${transcript_path}" ]] || fail "安装 transcript 不存在或不是普通文件：${transcript_path}"
    [[ -r "${transcript_path}" ]] || fail "安装 transcript 不可读取：${transcript_path}"
  fi

  local created_at file_stamp acceptance_root output_dir base_url app_commit deployed_commit
  local os_name arch service_active management_cli_installed panel_reachable frontend_login_page_verified
  local panel_headers panel_status panel_body transcript_json transcript_basename transcript_size transcript_sha
  local escaped_created_at escaped_install_source escaped_os_name escaped_arch escaped_app_commit escaped_deployed_commit escaped_transcript_basename

  created_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  file_stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  acceptance_root="$(production_acceptance_directory)"
  if [[ -z "${output_path}" ]]; then
    output_path="${acceptance_root}/clean-install-evidence-${file_stamp}.json"
  fi
  output_dir="$(dirname -- "${output_path}")"
  mkdir -p "${output_dir}"
  chmod 700 "${acceptance_root}" "${output_dir}" 2>/dev/null || true

  base_url="$(panel_url)"
  app_commit="$(current_app_commit)"
  deployed_commit=""
  if [[ -n "${base_url}" && "${base_url}" != "暂不可用" ]]; then
    deployed_commit="$(read_deployed_build_commit "${base_url}")"
  fi
  os_name="$(
    if [[ -r /etc/os-release ]]; then
      . /etc/os-release
      printf '%s' "${PRETTY_NAME:-${ID:-linux}}"
    else
      uname -s
    fi
  )"
  arch="$(uname -m 2>/dev/null || true)"

  service_active=false
  if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet "${SERVICE_NAME}"; then
    service_active=true
  elif (( service_active_confirmed == 1 )); then
    service_active=true
  else
    fail "后端服务未确认运行；请先修复服务，或在已有外部证据时传入 --service-active-confirmed。"
  fi

  management_cli_installed=false
  if [[ -x /usr/local/bin/ou-ui-next || -x /usr/bin/ou-ui-next ]]; then
    management_cli_installed=true
  elif (( management_cli_confirmed == 1 )); then
    management_cli_installed=true
  else
    fail "未确认管理 CLI 已安装；请先运行安装/修复，或在已有外部证据时传入 --management-cli-confirmed。"
  fi

  panel_reachable=false
  frontend_login_page_verified=false
  if [[ -n "${base_url}" && "${base_url}" != "暂不可用" ]]; then
    panel_headers="$(curl -k -sSIL --max-time 10 "${base_url}" 2>/dev/null || true)"
    panel_status="$(printf '%s\n' "${panel_headers}" | awk '/^HTTP\// { code = $2 } END { print code }')"
    case "${panel_status}" in
      2*|3*) panel_reachable=true ;;
    esac

    panel_body="$(curl -k -sSL --max-time 10 "${base_url}" 2>/dev/null || true)"
    if printf '%s\n' "${panel_body}" | grep -q '<title>OU-UI Next 控制面板</title>' &&
      printf '%s\n' "${panel_body}" | grep -q 'id="root"'; then
      frontend_login_page_verified=true
      panel_reachable=true
    fi
  fi
  (( panel_reachable_confirmed == 1 )) && panel_reachable=true
  (( frontend_login_confirmed == 1 )) && frontend_login_page_verified=true

  if [[ "${panel_reachable}" != "true" && "${frontend_login_page_verified}" != "true" ]]; then
    fail "未确认面板可访问；请先修复面板入口，或在已有外部证据时传入 --panel-reachable-confirmed / --frontend-login-confirmed。"
  fi

  transcript_json="null"
  if [[ -n "${transcript_path}" ]]; then
    transcript_basename="$(sanitize_production_acceptance_receipt_basename "$(basename -- "${transcript_path}")")"
    transcript_size="$(wc -c <"${transcript_path}" | tr -d '[:space:]')"
    transcript_sha="$(sha256_file "${transcript_path}")"
    escaped_transcript_basename="$(json_escape_string "${transcript_basename}")"
    transcript_json="{\"sourceBasename\":\"${escaped_transcript_basename}\",\"sizeBytes\":${transcript_size:-0},\"sha256\":\"${transcript_sha}\"}"
  fi

  escaped_created_at="$(json_escape_string "${created_at}")"
  escaped_install_source="$(json_escape_string "${install_source}")"
  escaped_os_name="$(json_escape_string "${os_name:-linux}")"
  escaped_arch="$(json_escape_string "${arch:-unknown}")"
  escaped_app_commit="$(json_escape_string "${app_commit:-unknown}")"
  escaped_deployed_commit="$(json_escape_string "${deployed_commit:-unknown}")"

  cat >"${output_path}" <<CLEAN_INSTALL_EVIDENCE_EOF
{"schemaVersion":"ou-ui-next.clean-install-evidence.v1","status":"passed","collectedAt":"${escaped_created_at}","installation":{"mode":"fresh","source":"${escaped_install_source}","exitCode":${installer_exit_code},"installerExitCode":${installer_exit_code},"scriptVersion":"${SCRIPT_VERSION}"},"environment":{"cleanServer":true,"preExistingOuUi":false,"os":"${escaped_os_name}","arch":"${escaped_arch}"},"results":{"managementCliInstalled":${management_cli_installed},"serviceActive":${service_active},"panelReachable":${panel_reachable},"frontendLoginPageVerified":${frontend_login_page_verified}},"artifacts":{"transcript":${transcript_json}},"runtime":{"appCommit":"${escaped_app_commit}","deployedCommit":"${escaped_deployed_commit}"}}
CLEAN_INSTALL_EVIDENCE_EOF
  chmod 600 "${output_path}" 2>/dev/null || true

  printf '干净服务器安装证据摘要: %s\n' "${output_path}"
  printf '  schema: ou-ui-next.clean-install-evidence.v1\n'
  printf '  可纳入验收包: sudo ou qa --install-evidence %s\n' "${output_path}"
  printf '  严格校验示例: sudo ou qv --require-clean-install-evidence <验收证据包目录>\n'
}

write_archive_provider_evidence() {
  require_root

  local output_path="" report_path="" provider="object-storage" endpoint="" bucket="" object_count=""
  local retention_mode="" retention_days="" retention_until="" legal_hold_enabled=""
  local object_storage_delivery_confirmed=0 bucket_object_lock_confirmed=0 retention_policy_confirmed=0
  local arg

  while (($# > 0)); do
    arg="$1"
    case "${arg}" in
      --output|-o)
        [[ -n "${2:-}" ]] || fail "archive-provider-evidence 参数 ${arg} 需要路径。"
        output_path="${2:-}"
        shift 2
        ;;
      --archive-smoke-report|--report)
        [[ -n "${2:-}" ]] || fail "archive-provider-evidence 参数 ${arg} 需要路径。"
        report_path="${2:-}"
        shift 2
        ;;
      --provider)
        [[ -n "${2:-}" ]] || fail "archive-provider-evidence 参数 --provider 需要脱敏标签。"
        provider="${2:-}"
        shift 2
        ;;
      --endpoint)
        [[ -n "${2:-}" ]] || fail "archive-provider-evidence 参数 --endpoint 需要 URL origin。"
        endpoint="${2:-}"
        shift 2
        ;;
      --bucket)
        [[ -n "${2:-}" ]] || fail "archive-provider-evidence 参数 --bucket 需要 bucket 名。"
        bucket="${2:-}"
        shift 2
        ;;
      --object-count)
        [[ -n "${2:-}" ]] || fail "archive-provider-evidence 参数 --object-count 需要正整数。"
        object_count="${2:-}"
        shift 2
        ;;
      --retention-mode)
        [[ -n "${2:-}" ]] || fail "archive-provider-evidence 参数 --retention-mode 需要 GOVERNANCE 或 COMPLIANCE。"
        retention_mode="${2:-}"
        shift 2
        ;;
      --retention-days)
        [[ -n "${2:-}" ]] || fail "archive-provider-evidence 参数 --retention-days 需要正整数。"
        retention_days="${2:-}"
        shift 2
        ;;
      --retention-until)
        [[ -n "${2:-}" ]] || fail "archive-provider-evidence 参数 --retention-until 需要时间。"
        retention_until="${2:-}"
        shift 2
        ;;
      --legal-hold-enabled)
        [[ -n "${2:-}" ]] || fail "archive-provider-evidence 参数 --legal-hold-enabled 需要 true 或 false。"
        legal_hold_enabled="${2:-}"
        shift 2
        ;;
      --object-storage-delivery-confirmed)
        object_storage_delivery_confirmed=1
        shift
        ;;
      --bucket-object-lock-confirmed)
        bucket_object_lock_confirmed=1
        shift
        ;;
      --retention-policy-confirmed)
        retention_policy_confirmed=1
        shift
        ;;
      --)
        shift
        if (($# > 0)); then
          fail "archive-provider-evidence 不接受位置参数；请使用 --archive-smoke-report 或显式字段参数。"
        fi
        break
        ;;
      -*)
        fail "archive-provider-evidence 不支持参数 ${arg}；查看帮助请运行 'ou archive-provider-evidence --help'。"
        ;;
      *)
        fail "archive-provider-evidence 不接受位置参数；请使用 --archive-smoke-report 或显式字段参数。"
        ;;
    esac
  done

  (( object_storage_delivery_confirmed == 1 )) || fail "生成归档 provider 侧证据需要显式确认对象存储已投递：请传入 --object-storage-delivery-confirmed。"
  (( bucket_object_lock_confirmed == 1 )) || fail "生成归档 provider 侧证据需要显式确认 bucket Object Lock 已启用：请传入 --bucket-object-lock-confirmed。"
  (( retention_policy_confirmed == 1 )) || fail "生成归档 provider 侧证据需要显式确认 provider 侧 retention 策略：请传入 --retention-policy-confirmed。"

  if [[ -n "${report_path}" ]]; then
    [[ -f "${report_path}" ]] || fail "归档 smoke report 不存在或不是普通文件：${report_path}"
    [[ -r "${report_path}" ]] || fail "归档 smoke report 不可读取：${report_path}"
  fi

  local created_at file_stamp acceptance_root output_dir
  created_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  file_stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  acceptance_root="$(production_acceptance_directory)"
  if [[ -z "${output_path}" ]]; then
    output_path="${acceptance_root}/archive-provider-evidence-${file_stamp}.json"
  fi
  output_dir="$(dirname -- "${output_path}")"
  mkdir -p "${output_dir}"
  chmod 700 "${acceptance_root}" "${output_dir}" 2>/dev/null || true

  command -v node >/dev/null 2>&1 || fail "当前系统缺少 node，无法生成归档 provider 侧证据。"

  ARCHIVE_PROVIDER_EVIDENCE_OUTPUT="${output_path}" \
    ARCHIVE_PROVIDER_EVIDENCE_REPORT="${report_path}" \
    ARCHIVE_PROVIDER_EVIDENCE_PROVIDER="${provider}" \
    ARCHIVE_PROVIDER_EVIDENCE_ENDPOINT="${endpoint}" \
    ARCHIVE_PROVIDER_EVIDENCE_BUCKET="${bucket}" \
    ARCHIVE_PROVIDER_EVIDENCE_OBJECT_COUNT="${object_count}" \
    ARCHIVE_PROVIDER_EVIDENCE_RETENTION_MODE="${retention_mode}" \
    ARCHIVE_PROVIDER_EVIDENCE_RETENTION_DAYS="${retention_days}" \
    ARCHIVE_PROVIDER_EVIDENCE_RETENTION_UNTIL="${retention_until}" \
    ARCHIVE_PROVIDER_EVIDENCE_LEGAL_HOLD_ENABLED="${legal_hold_enabled}" \
    ARCHIVE_PROVIDER_EVIDENCE_CREATED_AT="${created_at}" \
    ARCHIVE_PROVIDER_EVIDENCE_SCRIPT_VERSION="${SCRIPT_VERSION}" \
    node <<'ARCHIVE_PROVIDER_EVIDENCE_NODE'
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function fail(message) {
  process.stderr.write(`[OU-UI Next] ${message}\n`);
  process.exit(1);
}

function readEnv(name) {
  return process.env[name] || '';
}

function sanitizeBasename(value) {
  const basename = path.basename(value || 'receipt');
  const sanitized = basename.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 96);
  return sanitized || 'receipt';
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function parsePositiveInteger(value, label, allowEmpty = false) {
  if (!value) {
    if (allowEmpty) {
      return undefined;
    }
    fail(`${label} 必须是正整数。`);
  }
  if (!/^[0-9]+$/.test(value)) {
    fail(`${label} 必须是正整数。`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    fail(`${label} 必须是正整数。`);
  }
  return parsed;
}

function parseBoolean(value, label, allowEmpty = false) {
  if (!value) {
    if (allowEmpty) {
      return undefined;
    }
    fail(`${label} 必须是 true 或 false。`);
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  fail(`${label} 必须是 true 或 false。`);
}

function normalizeProviderLabel(value) {
  if (!/^[A-Za-z0-9._+-]{1,64}$/.test(value)) {
    fail('--provider 只能是 1-64 位脱敏来源标签，可用字母、数字、点、下划线、加号或连字符。');
  }
  if (/access|secret|token|password|credential|authorization|cookie/i.test(value)) {
    fail('--provider 不能包含疑似敏感词。');
  }
  return value;
}

function normalizeBucket(value) {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(value)) {
    fail('--bucket 只能包含字母、数字、点、下划线或连字符，最长 128 位。');
  }
  if (/access|secret|token|password|credential|authorization|cookie/i.test(value)) {
    fail('--bucket 不能包含疑似敏感词。');
  }
  return value;
}

function normalizeEndpoint(value) {
  if (!value) {
    return undefined;
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch (error) {
    fail('--endpoint 必须是有效 URL origin。');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
    fail('--endpoint 只能保留 URL origin，不能包含 credentials、path、query 或 fragment。');
  }
  return parsed.origin;
}

function normalizeRetentionMode(value) {
  if (value !== 'GOVERNANCE' && value !== 'COMPLIANCE') {
    fail('--retention-mode 必须是 GOVERNANCE 或 COMPLIANCE。');
  }
  return value;
}

function readArchiveSmokeReport(reportPath) {
  if (!reportPath) {
    return undefined;
  }
  let report;
  try {
    report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch (error) {
    fail('归档 smoke report 不是可解析 JSON。');
  }
  if (report?.schemaVersion !== 'ou-ui-next.production-archive-smoke.v1') {
    fail('归档 smoke report schemaVersion 不匹配。');
  }
  if (report.status !== 'passed') {
    fail('归档 smoke report status 必须是 passed。');
  }
  const objectStorage = report.externalArchiveSink?.objectStorage;
  if (!objectStorage || typeof objectStorage !== 'object' || Array.isArray(objectStorage)) {
    fail('归档 smoke report 未记录 objectStorage sink。');
  }
  return report;
}

function countDeliveredObjects(report, bucket) {
  if (!report) {
    return undefined;
  }
  const deliveries = Array.isArray(report.deliveries) ? report.deliveries : [];
  const delivered = deliveries.filter((delivery) => {
    return (
      typeof delivery?.event === 'string' &&
      delivery.event.endsWith('.object_storage.delivered') &&
      (!bucket || delivery.bucket === bucket)
    );
  });
  return delivered.length > 0 ? delivered.length : undefined;
}

const outputPath = readEnv('ARCHIVE_PROVIDER_EVIDENCE_OUTPUT');
const reportPath = readEnv('ARCHIVE_PROVIDER_EVIDENCE_REPORT');
const report = readArchiveSmokeReport(reportPath);
const reportObjectStorage = report?.externalArchiveSink?.objectStorage;
const reportObjectLock = reportObjectStorage?.objectLock;

const provider = normalizeProviderLabel(readEnv('ARCHIVE_PROVIDER_EVIDENCE_PROVIDER') || 'object-storage');
const endpoint = normalizeEndpoint(readEnv('ARCHIVE_PROVIDER_EVIDENCE_ENDPOINT') || reportObjectStorage?.endpoint || '');
const bucket = normalizeBucket(readEnv('ARCHIVE_PROVIDER_EVIDENCE_BUCKET') || reportObjectStorage?.bucket || '');
const objectCount =
  parsePositiveInteger(readEnv('ARCHIVE_PROVIDER_EVIDENCE_OBJECT_COUNT'), '--object-count', true) ??
  countDeliveredObjects(report, bucket);
if (!objectCount) {
  fail('--object-count 缺失，且归档 smoke report 没有 object storage delivered 记录。');
}

const retentionMode = normalizeRetentionMode(
  readEnv('ARCHIVE_PROVIDER_EVIDENCE_RETENTION_MODE') || reportObjectLock?.retentionMode || reportObjectLock?.mode || ''
);
const retentionDays = parsePositiveInteger(
  readEnv('ARCHIVE_PROVIDER_EVIDENCE_RETENTION_DAYS') || (reportObjectLock?.retentionDays ? String(reportObjectLock.retentionDays) : ''),
  '--retention-days',
  true
);
const retentionUntil = readEnv('ARCHIVE_PROVIDER_EVIDENCE_RETENTION_UNTIL');
if (!retentionDays && !retentionUntil) {
  fail('必须提供 --retention-days 或 --retention-until，或在归档 smoke report 中记录 retentionDays。');
}
if (retentionUntil && Number.isNaN(Date.parse(retentionUntil))) {
  fail('--retention-until 必须是可解析时间。');
}
const legalHoldEnabled =
  parseBoolean(readEnv('ARCHIVE_PROVIDER_EVIDENCE_LEGAL_HOLD_ENABLED'), '--legal-hold-enabled', true) ??
  (typeof reportObjectLock?.legalHoldEnabled === 'boolean' ? reportObjectLock.legalHoldEnabled : undefined);
if (typeof legalHoldEnabled !== 'boolean') {
  fail('必须提供 --legal-hold-enabled true|false，或在归档 smoke report 中记录 legalHoldEnabled。');
}

const evidence = {
  schemaVersion: 'ou-ui-next.archive-provider-evidence.v1',
  status: 'passed',
  provider,
  collectedAt: readEnv('ARCHIVE_PROVIDER_EVIDENCE_CREATED_AT'),
  objectStorage: {
    ...(endpoint ? { endpoint } : {}),
    bucket,
    deliveryStatus: 'delivered',
    objectCount,
    objectLock: {
      mode: retentionMode,
      ...(retentionDays ? { retentionDays } : {}),
      ...(retentionUntil ? { retentionUntil } : {}),
      legalHoldEnabled,
      bucketObjectLockEnabled: true,
      retentionPolicyVerified: true
    }
  },
  artifacts: {
    archiveSmokeReport: reportPath
      ? {
          sourceBasename: sanitizeBasename(reportPath),
          sizeBytes: fs.statSync(reportPath).size,
          sha256: sha256File(reportPath)
        }
      : null
  },
  confirmations: {
    objectStorageDeliveryConfirmed: true,
    bucketObjectLockConfirmed: true,
    retentionPolicyConfirmed: true
  },
  runtime: {
    scriptVersion: readEnv('ARCHIVE_PROVIDER_EVIDENCE_SCRIPT_VERSION')
  }
};

fs.writeFileSync(outputPath, `${JSON.stringify(evidence)}\n`, { mode: 0o600 });
try {
  fs.chmodSync(outputPath, 0o600);
} catch (error) {
  // Best effort for non-POSIX filesystems.
}
ARCHIVE_PROVIDER_EVIDENCE_NODE

  printf '归档 provider 侧证据摘要: %s\n' "${output_path}"
  printf '  schema: ou-ui-next.archive-provider-evidence.v1\n'
  printf '  可纳入验收包: sudo ou qa --archive-provider-evidence %s\n' "${output_path}"
  printf '  严格校验示例: sudo ou qv --require-archive-provider-evidence <验收证据包目录>\n'
}

write_timestamp_evidence() {
  require_root

  local output_path="" artifact_path="" receipt_path="" provider="timestamp-authority" proof_type="rfc3161"
  local timestamped_at="" verified_at=""
  local third_party_timestamp_confirmed=0 receipt_sanitized=0 verification_confirmed=0
  local arg

  while (($# > 0)); do
    arg="$1"
    case "${arg}" in
      --output|-o)
        [[ -n "${2:-}" ]] || fail "timestamp-evidence 参数 ${arg} 需要路径。"
        output_path="${2:-}"
        shift 2
        ;;
      --artifact)
        [[ -n "${2:-}" ]] || fail "timestamp-evidence 参数 --artifact 需要路径。"
        artifact_path="${2:-}"
        shift 2
        ;;
      --receipt)
        [[ -n "${2:-}" ]] || fail "timestamp-evidence 参数 --receipt 需要路径。"
        receipt_path="${2:-}"
        shift 2
        ;;
      --provider)
        [[ -n "${2:-}" ]] || fail "timestamp-evidence 参数 --provider 需要值。"
        provider="${2:-}"
        shift 2
        ;;
      --proof-type)
        [[ -n "${2:-}" ]] || fail "timestamp-evidence 参数 --proof-type 需要值。"
        proof_type="${2:-}"
        shift 2
        ;;
      --timestamped-at)
        [[ -n "${2:-}" ]] || fail "timestamp-evidence 参数 --timestamped-at 需要时间。"
        timestamped_at="${2:-}"
        shift 2
        ;;
      --verified-at)
        [[ -n "${2:-}" ]] || fail "timestamp-evidence 参数 --verified-at 需要时间。"
        verified_at="${2:-}"
        shift 2
        ;;
      --third-party-timestamp-confirmed)
        third_party_timestamp_confirmed=1
        shift
        ;;
      --receipt-sanitized)
        receipt_sanitized=1
        shift
        ;;
      --verification-confirmed)
        verification_confirmed=1
        shift
        ;;
      --)
        shift
        if (($# > 0)); then
          fail "timestamp-evidence 不接受位置参数；请使用 --artifact、--receipt 和 --output。"
        fi
        break
        ;;
      -*)
        fail "timestamp-evidence 不支持参数 ${arg}；可用 --artifact、--receipt、--provider、--proof-type、--timestamped-at、--verified-at、--third-party-timestamp-confirmed、--receipt-sanitized、--verification-confirmed、--output。"
        ;;
      *)
        fail "timestamp-evidence 不接受位置参数；请使用 --artifact、--receipt 和 --output。"
        ;;
    esac
  done

  [[ -n "${artifact_path}" ]] || fail "生成第三方时间戳证据需要 --artifact <path>。"
  [[ -n "${receipt_path}" ]] || fail "生成第三方时间戳证据需要 --receipt <path>。"
  [[ -f "${artifact_path}" ]] || fail "时间戳 artifact 不存在或不是普通文件：${artifact_path}"
  [[ -r "${artifact_path}" ]] || fail "时间戳 artifact 不可读取：${artifact_path}"
  [[ -f "${receipt_path}" ]] || fail "时间戳 receipt 不存在或不是普通文件：${receipt_path}"
  [[ -r "${receipt_path}" ]] || fail "时间戳 receipt 不可读取：${receipt_path}"
  [[ "${provider}" =~ ^[A-Za-z0-9._+-]{1,64}$ ]] || fail "--provider 只能是 1-64 位脱敏来源标签，可用字母、数字、点、下划线、加号或连字符。"
  [[ "${proof_type}" =~ ^[A-Za-z0-9._+-]{1,64}$ ]] || fail "--proof-type 只能是 1-64 位脱敏标签，可用字母、数字、点、下划线、加号或连字符。"
  if [[ "${provider}" =~ access|secret|token|password|credential|authorization|cookie ]] ||
    [[ "${provider}" =~ Access|Secret|Token|Password|Credential|Authorization|Cookie ]]; then
    fail "--provider 不能包含疑似敏感词。"
  fi
  if [[ "${proof_type}" =~ access|secret|token|password|credential|authorization|cookie ]] ||
    [[ "${proof_type}" =~ Access|Secret|Token|Password|Credential|Authorization|Cookie ]]; then
    fail "--proof-type 不能包含疑似敏感词。"
  fi
  [[ -n "${timestamped_at}" ]] || fail "生成第三方时间戳证据需要 --timestamped-at <time>。"
  command -v node >/dev/null 2>&1 || fail "生成第三方时间戳证据需要 node。"
  node -e 'if (Number.isNaN(Date.parse(process.argv[1]))) process.exit(1)' "${timestamped_at}" || fail "--timestamped-at 必须是可解析时间。"
  if [[ -n "${verified_at}" ]]; then
    node -e 'if (Number.isNaN(Date.parse(process.argv[1]))) process.exit(1)' "${verified_at}" || fail "--verified-at 必须是可解析时间。"
  fi
  (( third_party_timestamp_confirmed == 1 )) || fail "生成第三方时间戳证据需要显式确认：请传入 --third-party-timestamp-confirmed。"
  (( receipt_sanitized == 1 )) || fail "生成第三方时间戳证据需要确认 receipt 已脱敏：请传入 --receipt-sanitized。"
  (( verification_confirmed == 1 )) || fail "生成第三方时间戳证据需要确认 receipt 已验证：请传入 --verification-confirmed。"

  local created_at file_stamp acceptance_root output_dir
  local artifact_basename artifact_size artifact_sha receipt_basename receipt_size receipt_sha
  local escaped_created_at escaped_provider escaped_proof_type escaped_timestamped_at escaped_verified_at
  local escaped_artifact_basename escaped_receipt_basename verified_at_json

  created_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  file_stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  acceptance_root="$(production_acceptance_directory)"
  if [[ -z "${output_path}" ]]; then
    output_path="${acceptance_root}/timestamp-evidence-${file_stamp}.json"
  fi
  output_dir="$(dirname -- "${output_path}")"
  mkdir -p "${output_dir}"
  chmod 700 "${acceptance_root}" "${output_dir}" 2>/dev/null || true

  artifact_basename="$(sanitize_production_acceptance_receipt_basename "$(basename -- "${artifact_path}")")"
  artifact_size="$(wc -c <"${artifact_path}" | tr -d '[:space:]')"
  artifact_sha="$(sha256_file "${artifact_path}")"
  receipt_basename="$(sanitize_production_acceptance_receipt_basename "$(basename -- "${receipt_path}")")"
  receipt_size="$(wc -c <"${receipt_path}" | tr -d '[:space:]')"
  receipt_sha="$(sha256_file "${receipt_path}")"

  escaped_created_at="$(json_escape_string "${created_at}")"
  escaped_provider="$(json_escape_string "${provider}")"
  escaped_proof_type="$(json_escape_string "${proof_type}")"
  escaped_timestamped_at="$(json_escape_string "${timestamped_at}")"
  escaped_artifact_basename="$(json_escape_string "${artifact_basename}")"
  escaped_receipt_basename="$(json_escape_string "${receipt_basename}")"
  verified_at_json=""
  if [[ -n "${verified_at}" ]]; then
    escaped_verified_at="$(json_escape_string "${verified_at}")"
    verified_at_json=",\"verifiedAt\":\"${escaped_verified_at}\""
  fi

  cat >"${output_path}" <<TIMESTAMP_EVIDENCE_EOF
{"schemaVersion":"ou-ui-next.timestamp-evidence.v1","status":"passed","provider":"${escaped_provider}","collectedAt":"${escaped_created_at}","artifact":{"sourceBasename":"${escaped_artifact_basename}","sizeBytes":${artifact_size:-0},"sha256":"${artifact_sha}"},"timestamp":{"proofType":"${escaped_proof_type}","receiptBasename":"${escaped_receipt_basename}","receiptSizeBytes":${receipt_size:-0},"receiptSha256":"${receipt_sha}","timestampedAt":"${escaped_timestamped_at}"${verified_at_json},"verificationStatus":"verified"},"confirmations":{"thirdPartyTimestampConfirmed":true,"receiptSanitized":true,"verificationConfirmed":true},"runtime":{"scriptVersion":"${SCRIPT_VERSION}"}}
TIMESTAMP_EVIDENCE_EOF
  chmod 600 "${output_path}" 2>/dev/null || true

  printf '第三方时间戳证据摘要: %s\n' "${output_path}"
  printf '  schema: ou-ui-next.timestamp-evidence.v1\n'
  printf '  可纳入验收包: sudo ou qa --timestamp-evidence %s\n' "${output_path}"
  printf '  严格校验示例: sudo ou qv --require-timestamp-evidence <验收证据包目录>\n'
}

run_production_acceptance() {
  validate_production_acceptance_smoke_args "$@"
  require_root
  collect_production_acceptance_http_smoke_args "$@"
  collect_production_acceptance_browser_smoke_args "$@"
  collect_production_acceptance_notification_smoke_args "$@"
  collect_production_acceptance_webhook_smoke_args "$@"
  collect_production_acceptance_archive_smoke_args "$@"
  collect_production_acceptance_external_receipt_args "$@"
  collect_production_acceptance_install_evidence_args "$@"
  collect_production_acceptance_agent_evidence_args "$@"

  local started_at acceptance_root bundle_dir doctor_log smoke_log smoke_report browser_smoke_log browser_smoke_report browser_screenshot_dir browser_screenshot_archive notification_smoke_log notification_smoke_report webhook_smoke_log webhook_smoke_report archive_smoke_log archive_smoke_report external_receipts_dir external_receipts_manifest install_evidence_dir install_evidence_manifest agent_evidence_dir agent_evidence_manifest manifest_path
  local doctor_status smoke_status browser_smoke_status notification_smoke_status webhook_smoke_status archive_smoke_status base_url app_commit browser_smoke_skipped notification_smoke_skipped webhook_smoke_skipped archive_smoke_skipped external_receipt_count install_evidence_count agent_evidence_count
  local escaped_bundle_dir escaped_doctor_log escaped_smoke_log escaped_smoke_report escaped_browser_smoke_log escaped_browser_smoke_report escaped_browser_screenshot_archive escaped_notification_smoke_log escaped_notification_smoke_report escaped_webhook_smoke_log escaped_webhook_smoke_report escaped_archive_smoke_log escaped_archive_smoke_report escaped_external_receipts_manifest escaped_install_evidence_manifest escaped_agent_evidence_manifest escaped_base_url escaped_app_commit
  local doctor_file_manifest smoke_log_file_manifest smoke_report_file_manifest browser_smoke_log_file_manifest browser_smoke_report_file_manifest browser_screenshot_archive_file_manifest notification_smoke_log_file_manifest notification_smoke_report_file_manifest webhook_smoke_log_file_manifest webhook_smoke_report_file_manifest archive_smoke_log_file_manifest archive_smoke_report_file_manifest external_receipts_manifest_file_manifest install_evidence_manifest_file_manifest agent_evidence_manifest_file_manifest

  started_at="$(date -u +%Y%m%dT%H%M%SZ)"
  acceptance_root="$(production_acceptance_directory)"
  bundle_dir="${acceptance_root}/${started_at}"
  PRODUCTION_ACCEPTANCE_LAST_BUNDLE_DIR="${bundle_dir}"
  doctor_log="${bundle_dir}/doctor.txt"
  smoke_log="${bundle_dir}/smoke.txt"
  smoke_report="${bundle_dir}/smoke-report.json"
  browser_smoke_log="${bundle_dir}/browser-smoke.txt"
  browser_smoke_report="${bundle_dir}/browser-smoke-report.json"
  browser_screenshot_dir="${bundle_dir}/browser-screenshots"
  browser_screenshot_archive="${bundle_dir}/browser-screenshots.tar.gz"
  notification_smoke_log="${bundle_dir}/notification-smoke.txt"
  notification_smoke_report="${bundle_dir}/notification-smoke-report.json"
  webhook_smoke_log="${bundle_dir}/webhook-smoke.txt"
  webhook_smoke_report="${bundle_dir}/webhook-smoke-report.json"
  archive_smoke_log="${bundle_dir}/archive-smoke.txt"
  archive_smoke_report="${bundle_dir}/archive-smoke-report.json"
  external_receipts_dir="${bundle_dir}/external-receipts"
  external_receipts_manifest="${bundle_dir}/external-receipts-manifest.json"
  install_evidence_dir="${bundle_dir}/install-evidence"
  install_evidence_manifest="${bundle_dir}/install-evidence-manifest.json"
  agent_evidence_dir="${bundle_dir}/agent-evidence"
  agent_evidence_manifest="${bundle_dir}/agent-evidence-manifest.json"
  manifest_path="${bundle_dir}/manifest.json"

  mkdir -p "${bundle_dir}"
  chmod 700 "${acceptance_root}" "${bundle_dir}" 2>/dev/null || true

  if show_doctor >"${doctor_log}" 2>&1; then
    doctor_status=0
  else
    doctor_status=$?
  fi

  if run_production_smoke --report "${smoke_report}" "${ACCEPTANCE_HTTP_SMOKE_ARGS[@]}" >"${smoke_log}" 2>&1; then
    smoke_status=0
  else
    smoke_status=$?
  fi

  browser_smoke_skipped=false
  if (( ACCEPTANCE_SKIP_BROWSER_SMOKE == 1 )); then
    browser_smoke_status=0
    browser_smoke_skipped=true
    printf 'browser smoke skipped by --skip-browser-smoke\n' >"${browser_smoke_log}"
    printf '{"schemaVersion":"ou-ui-next.production-browser-smoke.v1","status":"skipped","createdAt":"%s","reason":"--skip-browser-smoke"}\n' "${started_at}" >"${browser_smoke_report}"
  elif run_production_browser_smoke --report "${browser_smoke_report}" --screenshot-dir "${browser_screenshot_dir}" "${ACCEPTANCE_BROWSER_SMOKE_ARGS[@]}" >"${browser_smoke_log}" 2>&1; then
    browser_smoke_status=0
  else
    browser_smoke_status=$?
  fi

  notification_smoke_skipped=true
  if (( ACCEPTANCE_INCLUDE_NOTIFICATION_SMOKE == 1 )); then
    notification_smoke_skipped=false
    if run_production_notification_smoke --report "${notification_smoke_report}" "${ACCEPTANCE_NOTIFICATION_SMOKE_ARGS[@]}" >"${notification_smoke_log}" 2>&1; then
      notification_smoke_status=0
    else
      notification_smoke_status=$?
    fi
  else
    notification_smoke_status=0
    printf 'notification smoke skipped; pass --include-notification-smoke with --telegram-admin-chat-id or --telegram-binding-id to send a real Telegram test notification\n' >"${notification_smoke_log}"
    printf '{"schemaVersion":"ou-ui-next.production-notification-smoke.v1","status":"skipped","createdAt":"%s","reason":"--include-notification-smoke not set"}\n' "${started_at}" >"${notification_smoke_report}"
  fi

  webhook_smoke_skipped=true
  if (( ACCEPTANCE_INCLUDE_WEBHOOK_SMOKE == 1 )); then
    webhook_smoke_skipped=false
    if run_production_webhook_smoke --report "${webhook_smoke_report}" "${ACCEPTANCE_WEBHOOK_SMOKE_ARGS[@]}" >"${webhook_smoke_log}" 2>&1; then
      webhook_smoke_status=0
    else
      webhook_smoke_status=$?
    fi
  else
    webhook_smoke_status=0
    printf 'webhook smoke skipped; pass --include-webhook-smoke to send a real external webhook test payload\n' >"${webhook_smoke_log}"
    printf '{"schemaVersion":"ou-ui-next.production-webhook-smoke.v1","status":"skipped","createdAt":"%s","reason":"--include-webhook-smoke not set"}\n' "${started_at}" >"${webhook_smoke_report}"
  fi

  archive_smoke_skipped=true
  if (( ACCEPTANCE_INCLUDE_ARCHIVE_SMOKE == 1 )); then
    archive_smoke_skipped=false
    if run_production_archive_smoke --report "${archive_smoke_report}" "${ACCEPTANCE_ARCHIVE_SMOKE_ARGS[@]}" >"${archive_smoke_log}" 2>&1; then
      archive_smoke_status=0
    else
      archive_smoke_status=$?
    fi
  else
    archive_smoke_status=0
    printf 'archive smoke skipped; pass --include-archive-smoke to write real external archive smoke evidence\n' >"${archive_smoke_log}"
    printf '{"schemaVersion":"ou-ui-next.production-archive-smoke.v1","status":"skipped","createdAt":"%s","reason":"--include-archive-smoke not set"}\n' "${started_at}" >"${archive_smoke_report}"
  fi

  write_production_acceptance_external_receipts_manifest "${started_at}" "${external_receipts_dir}" "${external_receipts_manifest}" "${ACCEPTANCE_EXTERNAL_RECEIPT_FILES[@]}"
  external_receipt_count="${PRODUCTION_ACCEPTANCE_EXTERNAL_RECEIPT_COUNT:-0}"
  write_production_acceptance_install_evidence_manifest "${started_at}" "${install_evidence_dir}" "${install_evidence_manifest}" "${ACCEPTANCE_INSTALL_EVIDENCE_FILES[@]}"
  install_evidence_count="${PRODUCTION_ACCEPTANCE_INSTALL_EVIDENCE_COUNT:-0}"
  write_production_acceptance_agent_evidence_manifest "${started_at}" "${agent_evidence_dir}" "${agent_evidence_manifest}" "${ACCEPTANCE_AGENT_EVIDENCE_PATHS[@]}"
  agent_evidence_count="${PRODUCTION_ACCEPTANCE_AGENT_EVIDENCE_COUNT:-0}"

  if [[ -d "${browser_screenshot_dir}" && -n "$(find "${browser_screenshot_dir}" -type f -print -quit 2>/dev/null)" ]]; then
    tar -C "${bundle_dir}" -czf "${browser_screenshot_archive}" "browser-screenshots" 2>/dev/null || true
  fi

  chmod 600 "${doctor_log}" "${smoke_log}" "${smoke_report}" "${browser_smoke_log}" "${browser_smoke_report}" "${browser_screenshot_archive}" "${notification_smoke_log}" "${notification_smoke_report}" "${webhook_smoke_log}" "${webhook_smoke_report}" "${archive_smoke_log}" "${archive_smoke_report}" "${external_receipts_manifest}" "${install_evidence_manifest}" "${agent_evidence_manifest}" 2>/dev/null || true

  base_url="$(panel_url)"
  app_commit="$(current_app_commit)"
  escaped_bundle_dir="$(json_escape_string "${bundle_dir}")"
  escaped_doctor_log="$(json_escape_string "${doctor_log}")"
  escaped_smoke_log="$(json_escape_string "${smoke_log}")"
  escaped_smoke_report="$(json_escape_string "${smoke_report}")"
  escaped_browser_smoke_log="$(json_escape_string "${browser_smoke_log}")"
  escaped_browser_smoke_report="$(json_escape_string "${browser_smoke_report}")"
  escaped_browser_screenshot_archive="$(json_escape_string "${browser_screenshot_archive}")"
  escaped_notification_smoke_log="$(json_escape_string "${notification_smoke_log}")"
  escaped_notification_smoke_report="$(json_escape_string "${notification_smoke_report}")"
  escaped_webhook_smoke_log="$(json_escape_string "${webhook_smoke_log}")"
  escaped_webhook_smoke_report="$(json_escape_string "${webhook_smoke_report}")"
  escaped_archive_smoke_log="$(json_escape_string "${archive_smoke_log}")"
  escaped_archive_smoke_report="$(json_escape_string "${archive_smoke_report}")"
  escaped_external_receipts_manifest="$(json_escape_string "${external_receipts_manifest}")"
  escaped_install_evidence_manifest="$(json_escape_string "${install_evidence_manifest}")"
  escaped_agent_evidence_manifest="$(json_escape_string "${agent_evidence_manifest}")"
  escaped_base_url="$(json_escape_string "${base_url}")"
  escaped_app_commit="$(json_escape_string "${app_commit:-unknown}")"
  doctor_file_manifest="$(production_acceptance_file_manifest_json "${doctor_log}")"
  smoke_log_file_manifest="$(production_acceptance_file_manifest_json "${smoke_log}")"
  smoke_report_file_manifest="$(production_acceptance_file_manifest_json "${smoke_report}")"
  browser_smoke_log_file_manifest="$(production_acceptance_file_manifest_json "${browser_smoke_log}")"
  browser_smoke_report_file_manifest="$(production_acceptance_file_manifest_json "${browser_smoke_report}")"
  browser_screenshot_archive_file_manifest="$(production_acceptance_file_manifest_json "${browser_screenshot_archive}")"
  notification_smoke_log_file_manifest="$(production_acceptance_file_manifest_json "${notification_smoke_log}")"
  notification_smoke_report_file_manifest="$(production_acceptance_file_manifest_json "${notification_smoke_report}")"
  webhook_smoke_log_file_manifest="$(production_acceptance_file_manifest_json "${webhook_smoke_log}")"
  webhook_smoke_report_file_manifest="$(production_acceptance_file_manifest_json "${webhook_smoke_report}")"
  archive_smoke_log_file_manifest="$(production_acceptance_file_manifest_json "${archive_smoke_log}")"
  archive_smoke_report_file_manifest="$(production_acceptance_file_manifest_json "${archive_smoke_report}")"
  external_receipts_manifest_file_manifest="$(production_acceptance_file_manifest_json "${external_receipts_manifest}")"
  install_evidence_manifest_file_manifest="$(production_acceptance_file_manifest_json "${install_evidence_manifest}")"
  agent_evidence_manifest_file_manifest="$(production_acceptance_file_manifest_json "${agent_evidence_manifest}")"

  cat >"${manifest_path}" <<ACCEPTANCE_MANIFEST_EOF
{"schemaVersion":"ou-ui-next.production-acceptance-bundle.v1","createdAt":"${started_at}","bundleDirectory":"${escaped_bundle_dir}","panelUrl":"${escaped_base_url}","appCommit":"${escaped_app_commit}","doctorStatus":${doctor_status},"smokeStatus":${smoke_status},"browserSmokeStatus":${browser_smoke_status},"browserSmokeSkipped":${browser_smoke_skipped},"notificationSmokeStatus":${notification_smoke_status},"notificationSmokeSkipped":${notification_smoke_skipped},"webhookSmokeStatus":${webhook_smoke_status},"webhookSmokeSkipped":${webhook_smoke_skipped},"archiveSmokeStatus":${archive_smoke_status},"archiveSmokeSkipped":${archive_smoke_skipped},"externalReceiptCount":${external_receipt_count},"installEvidenceCount":${install_evidence_count},"agentEvidenceCount":${agent_evidence_count},"doctorLog":"${escaped_doctor_log}","smokeLog":"${escaped_smoke_log}","smokeReport":"${escaped_smoke_report}","browserSmokeLog":"${escaped_browser_smoke_log}","browserSmokeReport":"${escaped_browser_smoke_report}","browserScreenshotArchive":"${escaped_browser_screenshot_archive}","notificationSmokeLog":"${escaped_notification_smoke_log}","notificationSmokeReport":"${escaped_notification_smoke_report}","webhookSmokeLog":"${escaped_webhook_smoke_log}","webhookSmokeReport":"${escaped_webhook_smoke_report}","archiveSmokeLog":"${escaped_archive_smoke_log}","archiveSmokeReport":"${escaped_archive_smoke_report}","externalReceiptsManifest":"${escaped_external_receipts_manifest}","installEvidenceManifest":"${escaped_install_evidence_manifest}","agentEvidenceManifest":"${escaped_agent_evidence_manifest}","evidence":{"doctorLog":${doctor_file_manifest},"smokeLog":${smoke_log_file_manifest},"smokeReport":${smoke_report_file_manifest},"browserSmokeLog":${browser_smoke_log_file_manifest},"browserSmokeReport":${browser_smoke_report_file_manifest},"browserScreenshotArchive":${browser_screenshot_archive_file_manifest},"notificationSmokeLog":${notification_smoke_log_file_manifest},"notificationSmokeReport":${notification_smoke_report_file_manifest},"webhookSmokeLog":${webhook_smoke_log_file_manifest},"webhookSmokeReport":${webhook_smoke_report_file_manifest},"archiveSmokeLog":${archive_smoke_log_file_manifest},"archiveSmokeReport":${archive_smoke_report_file_manifest},"externalReceiptsManifest":${external_receipts_manifest_file_manifest},"installEvidenceManifest":${install_evidence_manifest_file_manifest},"agentEvidenceManifest":${agent_evidence_manifest_file_manifest}}}
ACCEPTANCE_MANIFEST_EOF
  chmod 600 "${manifest_path}" 2>/dev/null || true

  printf '生产验收证据包: %s\n' "${bundle_dir}"
  printf '  doctor: %s\n' "${doctor_log}"
  printf '  smoke log: %s\n' "${smoke_log}"
  printf '  smoke report: %s\n' "${smoke_report}"
  printf '  browser smoke log: %s\n' "${browser_smoke_log}"
  printf '  browser smoke report: %s\n' "${browser_smoke_report}"
  printf '  browser screenshots: %s\n' "${browser_screenshot_archive}"
  printf '  notification smoke log: %s\n' "${notification_smoke_log}"
  printf '  notification smoke report: %s\n' "${notification_smoke_report}"
  printf '  webhook smoke log: %s\n' "${webhook_smoke_log}"
  printf '  webhook smoke report: %s\n' "${webhook_smoke_report}"
  printf '  archive smoke log: %s\n' "${archive_smoke_log}"
  printf '  archive smoke report: %s\n' "${archive_smoke_report}"
  printf '  external receipts manifest: %s\n' "${external_receipts_manifest}"
  printf '  install evidence manifest: %s\n' "${install_evidence_manifest}"
  printf '  agent evidence manifest: %s\n' "${agent_evidence_manifest}"
  printf '  manifest: %s\n' "${manifest_path}"

  if (( doctor_status != 0 || smoke_status != 0 || browser_smoke_status != 0 || notification_smoke_status != 0 || webhook_smoke_status != 0 || archive_smoke_status != 0 )); then
    printf '[%s] 生产验收证据包已生成，但检查未全部通过：doctor=%s smoke=%s browserSmoke=%s notificationSmoke=%s webhookSmoke=%s archiveSmoke=%s\n' "${APP_NAME}" "${doctor_status}" "${smoke_status}" "${browser_smoke_status}" "${notification_smoke_status}" "${webhook_smoke_status}" "${archive_smoke_status}" >&2
    return 1
  fi

  log "生产验收证据包生成完成。"
}

verify_production_acceptance() {
  local input_path="" manifest_path arg
  local require_runtime_evidence=0
  local require_browser_smoke=0
  local require_notification_smoke=0
  local require_webhook_smoke=0
  local require_archive_smoke=0
  local require_external_receipts=0
  local require_archive_provider_evidence=0
  local require_timestamp_evidence=0
  local require_clean_install_evidence=0
  local require_agent_evidence=0
  local require_agent_final_summary=0
  local require_final_summary=0
  local require_release_summary=0

  while (($# > 0)); do
    arg="$1"
    case "${arg}" in
      --require-runtime-evidence)
        require_runtime_evidence=1
        shift
        ;;
      --require-browser-smoke)
        require_browser_smoke=1
        shift
        ;;
      --require-notification-smoke)
        require_notification_smoke=1
        shift
        ;;
      --require-webhook-smoke)
        require_webhook_smoke=1
        shift
        ;;
      --require-archive-smoke)
        require_archive_smoke=1
        shift
        ;;
      --require-external-receipts)
        require_external_receipts=1
        shift
        ;;
      --require-archive-provider-evidence)
        require_archive_provider_evidence=1
        shift
        ;;
      --require-timestamp-evidence)
        require_timestamp_evidence=1
        shift
        ;;
      --require-clean-install-evidence)
        require_clean_install_evidence=1
        shift
        ;;
      --require-agent-evidence)
        require_agent_evidence=1
        shift
        ;;
      --require-agent-final-summary)
        require_agent_final_summary=1
        shift
        ;;
      --require-final-summary)
        require_final_summary=1
        shift
        ;;
      --require-release-summary)
        require_release_summary=1
        shift
        ;;
      --)
        shift
        ;;
      -*)
        fail "acceptance-verify 不支持参数 ${arg}；可用 --require-runtime-evidence、--require-browser-smoke、--require-notification-smoke、--require-webhook-smoke、--require-archive-smoke、--require-external-receipts、--require-archive-provider-evidence、--require-timestamp-evidence、--require-clean-install-evidence、--require-agent-evidence、--require-agent-final-summary、--require-final-summary、--require-release-summary。"
        ;;
      *)
        [[ -z "${input_path}" ]] || fail "acceptance-verify 只接受一个证据包目录或 manifest.json 路径。"
        input_path="$1"
        shift
        ;;
    esac
  done

  [[ -n "${input_path}" ]] || fail "acceptance-verify 需要一个证据包目录或 manifest.json 路径。"

  if [[ -d "${input_path}" ]]; then
    manifest_path="${input_path%/}/manifest.json"
  else
    manifest_path="${input_path}"
  fi

  [[ -f "${manifest_path}" ]] || fail "未找到生产验收证据 manifest：${manifest_path}"
  command -v node >/dev/null 2>&1 || fail "验收证据校验需要 node。"

  node - "${manifest_path}" "${require_runtime_evidence}" "${require_browser_smoke}" "${require_notification_smoke}" "${require_webhook_smoke}" "${require_archive_smoke}" "${require_external_receipts}" "${require_archive_provider_evidence}" "${require_timestamp_evidence}" "${require_clean_install_evidence}" "${require_agent_evidence}" "${require_agent_final_summary}" "${require_final_summary}" "${require_release_summary}" <<'ACCEPTANCE_VERIFY_NODE'
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const manifestPath = path.resolve(process.argv[2] || '');
const requirements = {
  runtimeEvidence: process.argv[3] === '1',
  browserSmoke: process.argv[4] === '1',
  notificationSmoke: process.argv[5] === '1',
  webhookSmoke: process.argv[6] === '1',
  archiveSmoke: process.argv[7] === '1',
  externalReceipts: process.argv[8] === '1',
  archiveProviderEvidence: process.argv[9] === '1',
  timestampEvidence: process.argv[10] === '1',
  cleanInstallEvidence: process.argv[11] === '1',
  agentEvidence: process.argv[12] === '1',
  agentFinalSummary: process.argv[13] === '1',
  finalSummary: process.argv[14] === '1',
  releaseSummary: process.argv[15] === '1'
};
const finalSummaryOptionalGates = [
  {
    key: 'archiveSmoke',
    requirementKey: 'archiveSmoke',
    marker: '[OK] archive smoke gate: passed'
  },
  {
    key: 'externalReceipts',
    requirementKey: 'externalReceipts',
    marker: '[OK] external receipt gate: passed'
  },
  {
    key: 'archiveProviderEvidence',
    requirementKey: 'archiveProviderEvidence',
    marker: '[OK] archive provider evidence gate: passed'
  },
  {
    key: 'timestampEvidence',
    requirementKey: 'timestampEvidence',
    marker: '[OK] timestamp evidence gate: passed'
  },
  {
    key: 'cleanInstallEvidence',
    requirementKey: 'cleanInstallEvidence',
    marker: '[OK] clean install evidence gate: passed'
  },
  {
    key: 'agentEvidence',
    requirementKey: 'agentEvidence',
    marker: '[OK] agent evidence gate: passed'
  },
  {
    key: 'agentFinalSummary',
    requirementKey: 'agentFinalSummary',
    marker: '[OK] agent final summary gate: passed'
  }
];
const releaseSummaryRequiredGates = [
  {
    key: 'runtimeEvidence',
    requirementKey: 'runtimeEvidence',
    marker: '[OK] runtime evidence gate: passed'
  },
  {
    key: 'browserSmoke',
    requirementKey: 'browserSmoke',
    marker: '[OK] browser smoke gate: passed'
  },
  {
    key: 'notificationSmoke',
    requirementKey: 'notificationSmoke',
    marker: '[OK] notification smoke gate: passed'
  },
  {
    key: 'webhookSmoke',
    requirementKey: 'webhookSmoke',
    marker: '[OK] webhook smoke gate: passed'
  },
  {
    key: 'archiveSmoke',
    requirementKey: 'archiveSmoke',
    marker: '[OK] archive smoke gate: passed'
  },
  {
    key: 'externalReceipts',
    requirementKey: 'externalReceipts',
    marker: '[OK] external receipt gate: passed'
  },
  {
    key: 'archiveProviderEvidence',
    requirementKey: 'archiveProviderEvidence',
    marker: '[OK] archive provider evidence gate: passed'
  },
  {
    key: 'timestampEvidence',
    requirementKey: 'timestampEvidence',
    marker: '[OK] timestamp evidence gate: passed'
  },
  {
    key: 'cleanInstallEvidence',
    requirementKey: 'cleanInstallEvidence',
    marker: '[OK] clean install evidence gate: passed'
  },
  {
    key: 'agentEvidence',
    requirementKey: 'agentEvidence',
    marker: '[OK] agent evidence gate: passed'
  },
  {
    key: 'agentFinalSummary',
    requirementKey: 'agentFinalSummary',
    marker: '[OK] agent final summary gate: passed'
  },
  {
    key: 'finalSummary',
    requirementKey: 'finalSummary',
    marker: '[OK] final acceptance summary gate: passed'
  }
];

function fail(message) {
  process.stderr.write(`[OU-UI Next] ${message}\n`);
  process.exit(1);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    fail(`无法读取或解析 manifest：${filePath}`);
  }
}

function readEvidenceJson(bundleDirectory, fileName, label) {
  const filePath = path.join(bundleDirectory, fileName);

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    fail(`无法读取或解析 ${label}：${filePath}`);
  }
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function findReportCheck(report, name) {
  return Array.isArray(report?.checks) ? report.checks.find((check) => check?.name === name) : undefined;
}

function verifySummaryFileEntry(bundleDirectory, entry, fileName, label) {
  if (!entry || typeof entry !== 'object') {
    fail(`${label} 缺少文件摘要。`);
  }
  if (typeof entry.path !== 'string' || path.basename(entry.path) !== fileName) {
    fail(`${label}.path 文件名必须是 ${fileName}`);
  }
  if (!Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes < 0) {
    fail(`${label}.sizeBytes 无效`);
  }
  if (typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(entry.sha256)) {
    fail(`${label}.sha256 无效`);
  }

  const evidencePath = path.join(bundleDirectory, fileName);
  if (!fs.existsSync(evidencePath)) {
    fail(`${label} 指向的文件不存在：${evidencePath}`);
  }

  const stat = fs.statSync(evidencePath);
  if (!stat.isFile()) {
    fail(`${label} 指向的路径不是普通文件：${evidencePath}`);
  }

  const expectedSha = entry.sha256.toLowerCase();
  const actualSha = sha256File(evidencePath);
  if (stat.size !== entry.sizeBytes) {
    fail(`${label} 大小不匹配：summary=${entry.sizeBytes} actual=${stat.size}`);
  }
  if (actualSha !== expectedSha) {
    fail(`${label} SHA-256 不匹配：summary=${expectedSha} actual=${actualSha}`);
  }
}

function normalizeReceiptRelativePath(relativePath, label) {
  if (typeof relativePath !== 'string' || relativePath.length < 1) {
    fail(`${label}.relativePath 缺失。`);
  }
  if (path.isAbsolute(relativePath)) {
    fail(`${label}.relativePath 不能是绝对路径。`);
  }
  const normalized = path.posix.normalize(relativePath.replace(/\\/g, '/'));
  if (
    normalized === '.' ||
    normalized.startsWith('../') ||
    normalized.includes('/../') ||
    !normalized.startsWith('external-receipts/')
  ) {
    fail(`${label}.relativePath 必须位于 external-receipts/ 下。`);
  }
  return normalized;
}

function verifyReceiptFileEntry(bundleDirectory, receipt, index) {
  const label = `external receipt ${index + 1}`;
  if (!receipt || typeof receipt !== 'object') {
    fail(`${label} 缺少记录。`);
  }
  const relativePath = normalizeReceiptRelativePath(receipt.relativePath, label);
  const entry = receipt.file;
  if (!entry || typeof entry !== 'object') {
    fail(`${label}.file 缺少文件摘要。`);
  }
  if (typeof entry.path !== 'string' || path.basename(entry.path) !== path.basename(relativePath)) {
    fail(`${label}.file.path 文件名必须是 ${path.basename(relativePath)}`);
  }
  if (!Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes < 0) {
    fail(`${label}.file.sizeBytes 无效`);
  }
  if (typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(entry.sha256)) {
    fail(`${label}.file.sha256 无效`);
  }

  const evidencePath = path.join(bundleDirectory, relativePath);
  if (!fs.existsSync(evidencePath)) {
    fail(`${label} 指向的文件不存在：${evidencePath}`);
  }

  const stat = fs.statSync(evidencePath);
  if (!stat.isFile()) {
    fail(`${label} 指向的路径不是普通文件：${evidencePath}`);
  }

  const expectedSha = entry.sha256.toLowerCase();
  const actualSha = sha256File(evidencePath);
  if (stat.size !== entry.sizeBytes) {
    fail(`${label} 大小不匹配：summary=${entry.sizeBytes} actual=${stat.size}`);
  }
  if (actualSha !== expectedSha) {
    fail(`${label} SHA-256 不匹配：summary=${expectedSha} actual=${actualSha}`);
  }

  process.stdout.write(`[OK] externalReceipt: ${relativePath} ${stat.size} bytes ${actualSha}\n`);
}

function normalizeInstallEvidenceRelativePath(relativePath, label) {
  if (typeof relativePath !== 'string' || relativePath.length < 1) {
    fail(`${label}.relativePath 缺失。`);
  }
  if (path.isAbsolute(relativePath)) {
    fail(`${label}.relativePath 不能是绝对路径。`);
  }
  const normalized = path.posix.normalize(relativePath.replace(/\\/g, '/'));
  if (
    normalized === '.' ||
    normalized.startsWith('../') ||
    normalized.includes('/../') ||
    !normalized.startsWith('install-evidence/')
  ) {
    fail(`${label}.relativePath 必须位于 install-evidence/ 下。`);
  }
  return normalized;
}

function verifyInstallEvidenceFileEntry(bundleDirectory, evidence, index) {
  const label = `install evidence ${index + 1}`;
  if (!evidence || typeof evidence !== 'object') {
    fail(`${label} 缺少记录。`);
  }
  const relativePath = normalizeInstallEvidenceRelativePath(evidence.relativePath, label);
  const entry = evidence.file;
  if (!entry || typeof entry !== 'object') {
    fail(`${label}.file 缺少文件摘要。`);
  }
  if (typeof entry.path !== 'string' || path.basename(entry.path) !== path.basename(relativePath)) {
    fail(`${label}.file.path 文件名必须是 ${path.basename(relativePath)}`);
  }
  if (!Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes < 0) {
    fail(`${label}.file.sizeBytes 无效`);
  }
  if (typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(entry.sha256)) {
    fail(`${label}.file.sha256 无效`);
  }

  const evidencePath = path.join(bundleDirectory, relativePath);
  if (!fs.existsSync(evidencePath)) {
    fail(`${label} 指向的文件不存在：${evidencePath}`);
  }

  const stat = fs.statSync(evidencePath);
  if (!stat.isFile()) {
    fail(`${label} 指向的路径不是普通文件：${evidencePath}`);
  }

  const expectedSha = entry.sha256.toLowerCase();
  const actualSha = sha256File(evidencePath);
  if (stat.size !== entry.sizeBytes) {
    fail(`${label} 大小不匹配：summary=${entry.sizeBytes} actual=${stat.size}`);
  }
  if (actualSha !== expectedSha) {
    fail(`${label} SHA-256 不匹配：summary=${expectedSha} actual=${actualSha}`);
  }

  process.stdout.write(`[OK] installEvidence: ${relativePath} ${stat.size} bytes ${actualSha}\n`);
  return { relativePath, evidencePath };
}

function validateNoSensitiveInstallEvidenceKeys(value, label, failures) {
  const blockedKeyPattern = /access[-_]?key|secret|token|password|credential|authorization|cookie|csrf|bearer/i;
  const urlKeyPattern = /(^|[-_])(url|uri|endpoint)($|[-_])|(url|uri|endpoint)$/i;

  if (Array.isArray(value)) {
    value.forEach((item, index) => validateNoSensitiveInstallEvidenceKeys(item, `${label}[${index}]`, failures));
    return;
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    const nestedLabel = `${label}.${key}`;
    if (blockedKeyPattern.test(key)) {
      failures.push(`${nestedLabel} 使用了疑似敏感字段名`);
    }
    if (urlKeyPattern.test(key) && typeof nestedValue === 'string') {
      try {
        const parsedUrl = new URL(nestedValue);
        if (parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash) {
          failures.push(`${nestedLabel} 暴露了 credentials、query 或 fragment`);
        }
      } catch (error) {
        failures.push(`${nestedLabel} 不是有效 URL`);
      }
    }
    validateNoSensitiveInstallEvidenceKeys(nestedValue, nestedLabel, failures);
  }
}

function inspectCleanInstallEvidenceFile(evidencePath, relativePath, index) {
  const label = `clean install evidence ${index + 1}`;
  let evidence;

  try {
    evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  } catch (error) {
    return {
      matchesSchema: false,
      relativePath,
      failures: ['安装证据不是可解析 JSON']
    };
  }

  if (evidence?.schemaVersion !== 'ou-ui-next.clean-install-evidence.v1') {
    return {
      matchesSchema: false,
      relativePath,
      failures: [`schemaVersion=${evidence?.schemaVersion ?? 'missing'}`]
    };
  }

  const failures = [];
  validateNoSensitiveInstallEvidenceKeys(evidence, label, failures);

  if (evidence.status !== 'passed') {
    failures.push(`status=${evidence.status ?? 'missing'}`);
  }

  const installation = evidence.installation;
  if (!installation || typeof installation !== 'object' || Array.isArray(installation)) {
    failures.push('installation 缺失');
  } else {
    if (installation.mode !== 'fresh') {
      failures.push('installation.mode 必须是 fresh');
    }
    if (installation.exitCode !== 0 && installation.installerExitCode !== 0) {
      failures.push('installation.exitCode 必须是 0');
    }
  }

  const environment = evidence.environment ?? evidence.host;
  if (!environment || typeof environment !== 'object' || Array.isArray(environment)) {
    failures.push('environment 缺失');
  } else {
    if (environment.cleanServer !== true) {
      failures.push('environment.cleanServer 必须是 true');
    }
    if (environment.preExistingOuUi !== false && environment.preExistingOuUiNext !== false) {
      failures.push('environment.preExistingOuUi 必须是 false');
    }
  }

  const results = evidence.results ?? evidence.verification;
  if (!results || typeof results !== 'object' || Array.isArray(results)) {
    failures.push('results 缺失');
  } else {
    if (results.managementCliInstalled !== true) {
      failures.push('results.managementCliInstalled 必须是 true');
    }
    if (results.serviceActive !== true) {
      failures.push('results.serviceActive 必须是 true');
    }
    if (results.panelReachable !== true && results.frontendLoginPageVerified !== true) {
      failures.push('results.panelReachable 或 frontendLoginPageVerified 必须是 true');
    }
  }

  return {
    matchesSchema: true,
    relativePath,
    failures
  };
}

function validateNoSensitiveProviderEvidenceKeys(value, label, failures) {
  const blockedKeyPattern = /access[-_]?key|secret|token|password|credential|authorization|cookie/i;

  if (Array.isArray(value)) {
    value.forEach((item, index) => validateNoSensitiveProviderEvidenceKeys(item, `${label}[${index}]`, failures));
    return;
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    const nestedLabel = `${label}.${key}`;
    if (blockedKeyPattern.test(key)) {
      failures.push(`${nestedLabel} 使用了疑似敏感字段名`);
    }
    validateNoSensitiveProviderEvidenceKeys(nestedValue, nestedLabel, failures);
  }
}

function inspectArchiveProviderEvidenceReceipt(bundleDirectory, receipt, index) {
  const label = `archive provider evidence ${index + 1}`;
  const relativePath = normalizeReceiptRelativePath(receipt.relativePath, label);
  const evidencePath = path.join(bundleDirectory, relativePath);
  let evidence;

  try {
    evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  } catch (error) {
    return {
      matchesSchema: false,
      relativePath,
      failures: ['回执不是可解析 JSON']
    };
  }

  if (evidence?.schemaVersion !== 'ou-ui-next.archive-provider-evidence.v1') {
    return {
      matchesSchema: false,
      relativePath,
      failures: [`schemaVersion=${evidence?.schemaVersion ?? 'missing'}`]
    };
  }

  const failures = [];
  validateNoSensitiveProviderEvidenceKeys(evidence, label, failures);

  if (evidence.status !== 'passed') {
    failures.push(`status=${evidence.status ?? 'missing'}`);
  }
  if (typeof evidence.provider !== 'string' || evidence.provider.trim().length < 1) {
    failures.push('provider 缺失');
  }

  const objectStorage = evidence.objectStorage;
  if (!objectStorage || typeof objectStorage !== 'object' || Array.isArray(objectStorage)) {
    failures.push('objectStorage 缺失');
  } else {
    if (objectStorage.deliveryStatus !== 'delivered' && objectStorage.delivered !== true) {
      failures.push('objectStorage.deliveryStatus 必须是 delivered，或 delivered=true');
    }
    if (typeof objectStorage.bucket !== 'string' || objectStorage.bucket.trim().length < 1) {
      failures.push('objectStorage.bucket 缺失');
    }
    if (!Number.isSafeInteger(objectStorage.objectCount) || objectStorage.objectCount < 1) {
      failures.push('objectStorage.objectCount 必须是正整数');
    }

    const endpoint = objectStorage.endpoint;
    if (endpoint !== undefined) {
      try {
        const endpointUrl = new URL(endpoint);
        if (endpointUrl.username || endpointUrl.password || endpointUrl.search || endpointUrl.hash) {
          failures.push('objectStorage.endpoint 暴露了 credentials、query 或 fragment');
        }
        if (endpointUrl.pathname !== '/') {
          failures.push('objectStorage.endpoint 必须只保留 origin，不能包含 path');
        }
      } catch (error) {
        failures.push('objectStorage.endpoint 不是有效 URL');
      }
    }

    const objectLock = objectStorage.objectLock;
    if (!objectLock || typeof objectLock !== 'object' || Array.isArray(objectLock)) {
      failures.push('objectStorage.objectLock 缺失');
    } else {
      const mode = objectLock.mode ?? objectLock.retentionMode;
      if (mode !== 'GOVERNANCE' && mode !== 'COMPLIANCE') {
        failures.push('objectStorage.objectLock.mode 必须是 GOVERNANCE 或 COMPLIANCE');
      }
      if (
        objectLock.retentionDays !== undefined &&
        (!Number.isSafeInteger(objectLock.retentionDays) || objectLock.retentionDays <= 0)
      ) {
        failures.push('objectStorage.objectLock.retentionDays 必须是正整数');
      }
      const retentionUntil = objectLock.retentionUntil ?? objectLock.retainUntil;
      if (retentionUntil !== undefined && Number.isNaN(Date.parse(retentionUntil))) {
        failures.push('objectStorage.objectLock.retentionUntil 不是有效时间');
      }
      if (objectLock.retentionDays === undefined && retentionUntil === undefined) {
        failures.push('objectStorage.objectLock 必须包含 retentionDays 或 retentionUntil');
      }
      if (typeof objectLock.legalHoldEnabled !== 'boolean') {
        failures.push('objectStorage.objectLock.legalHoldEnabled 必须是 boolean');
      }
      if (objectLock.bucketObjectLockEnabled !== true) {
        failures.push('objectStorage.objectLock.bucketObjectLockEnabled 必须是 true');
      }
      if (objectLock.retentionPolicyVerified !== true) {
        failures.push('objectStorage.objectLock.retentionPolicyVerified 必须是 true');
      }
    }
  }

  return {
    matchesSchema: true,
    relativePath,
    failures
  };
}

function validateNoSensitiveTimestampEvidenceKeys(value, label, failures) {
  const blockedKeyPattern = /access[-_]?key|secret|token|password|credential|authorization|cookie|csrf|bearer/i;
  const urlKeyPattern = /(^|[-_])(url|uri|endpoint)($|[-_])|(url|uri|endpoint)$/i;

  if (Array.isArray(value)) {
    value.forEach((item, index) => validateNoSensitiveTimestampEvidenceKeys(item, `${label}[${index}]`, failures));
    return;
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    const nestedLabel = `${label}.${key}`;
    if (blockedKeyPattern.test(key)) {
      failures.push(`${nestedLabel} 使用了疑似敏感字段名`);
    }
    if (urlKeyPattern.test(key) && typeof nestedValue === 'string') {
      try {
        const parsedUrl = new URL(nestedValue);
        if (parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash || parsedUrl.pathname !== '/') {
          failures.push(`${nestedLabel} 只能保留 URL origin，不能包含 credentials、path、query 或 fragment`);
        }
      } catch (error) {
        failures.push(`${nestedLabel} 不是有效 URL`);
      }
    }
    validateNoSensitiveTimestampEvidenceKeys(nestedValue, nestedLabel, failures);
  }
}

function validateTimestampEvidenceSafeLabel(value, label, failures) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._+-]{1,64}$/.test(value)) {
    failures.push(`${label} 必须是 1-64 位脱敏标签`);
    return;
  }
  if (/access|secret|token|password|credential|authorization|cookie|csrf|bearer/i.test(value)) {
    failures.push(`${label} 包含疑似敏感词`);
  }
}

function validateTimestampEvidenceSafeBasename(value, label, failures) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._-]{1,96}$/.test(value)) {
    failures.push(`${label} 必须是 1-96 位脱敏 basename`);
    return;
  }
  if (/access|secret|token|password|credential|authorization|cookie|csrf|bearer/i.test(value)) {
    failures.push(`${label} 包含疑似敏感词`);
  }
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function inspectTimestampEvidenceReceipt(bundleDirectory, receipt, index) {
  const label = `timestamp evidence ${index + 1}`;
  const relativePath = normalizeReceiptRelativePath(receipt.relativePath, label);
  const evidencePath = path.join(bundleDirectory, relativePath);
  let evidence;

  try {
    evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  } catch (error) {
    return {
      matchesSchema: false,
      relativePath,
      failures: ['时间戳证据不是可解析 JSON']
    };
  }

  if (evidence?.schemaVersion !== 'ou-ui-next.timestamp-evidence.v1') {
    return {
      matchesSchema: false,
      relativePath,
      failures: [`schemaVersion=${evidence?.schemaVersion ?? 'missing'}`]
    };
  }

  const failures = [];
  validateNoSensitiveTimestampEvidenceKeys(evidence, label, failures);

  if (evidence.status !== 'passed') {
    failures.push(`status=${evidence.status ?? 'missing'}`);
  }
  validateTimestampEvidenceSafeLabel(evidence.provider, 'provider', failures);

  const artifact = evidence.artifact;
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
    failures.push('artifact 缺失');
  } else {
    validateTimestampEvidenceSafeBasename(artifact.sourceBasename, 'artifact.sourceBasename', failures);
    if (!isSha256(artifact.sha256)) {
      failures.push('artifact.sha256 必须是 SHA-256');
    }
    if (!Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes < 1) {
      failures.push('artifact.sizeBytes 必须是正整数');
    }
  }

  const timestamp = evidence.timestamp;
  if (!timestamp || typeof timestamp !== 'object' || Array.isArray(timestamp)) {
    failures.push('timestamp 缺失');
  } else {
    validateTimestampEvidenceSafeLabel(timestamp.proofType, 'timestamp.proofType', failures);
    validateTimestampEvidenceSafeBasename(timestamp.receiptBasename, 'timestamp.receiptBasename', failures);
    if (!Number.isSafeInteger(timestamp.receiptSizeBytes) || timestamp.receiptSizeBytes < 1) {
      failures.push('timestamp.receiptSizeBytes 必须是正整数');
    }
    if (!isSha256(timestamp.receiptSha256)) {
      failures.push('timestamp.receiptSha256 必须是 SHA-256');
    }
    if (Number.isNaN(Date.parse(timestamp.timestampedAt))) {
      failures.push('timestamp.timestampedAt 不是有效时间');
    }
    if (timestamp.verifiedAt !== undefined && Number.isNaN(Date.parse(timestamp.verifiedAt))) {
      failures.push('timestamp.verifiedAt 不是有效时间');
    }
    if (timestamp.verificationStatus !== 'verified' && timestamp.verified !== true) {
      failures.push('timestamp.verificationStatus 必须是 verified，或 verified=true');
    }
  }

  const confirmations = evidence.confirmations;
  if (!confirmations || typeof confirmations !== 'object' || Array.isArray(confirmations)) {
    failures.push('confirmations 缺失');
  } else {
    if (confirmations.thirdPartyTimestampConfirmed !== true) {
      failures.push('confirmations.thirdPartyTimestampConfirmed 必须是 true');
    }
    if (confirmations.receiptSanitized !== true) {
      failures.push('confirmations.receiptSanitized 必须是 true');
    }
    if (confirmations.verificationConfirmed !== true) {
      failures.push('confirmations.verificationConfirmed 必须是 true');
    }
  }

  return {
    matchesSchema: true,
    relativePath,
    failures
  };
}

function normalizeAgentEvidenceDirectory(relativeDirectory, label) {
  if (typeof relativeDirectory !== 'string' || relativeDirectory.length < 1) {
    fail(`${label}.relativeDirectory 缺失。`);
  }
  if (path.isAbsolute(relativeDirectory)) {
    fail(`${label}.relativeDirectory 不能是绝对路径。`);
  }
  const normalized = path.posix.normalize(relativeDirectory.replace(/\\/g, '/'));
  if (
    normalized === '.' ||
    normalized.startsWith('../') ||
    normalized.includes('/../') ||
    !normalized.startsWith('agent-evidence/')
  ) {
    fail(`${label}.relativeDirectory 必须位于 agent-evidence/ 下。`);
  }
  return normalized;
}

function verifyAgentEvidenceFileEntry(bundleDirectory, entry, relativePath, label) {
  if (!entry || typeof entry !== 'object') {
    fail(`${label} 缺少文件摘要。`);
  }
  if (typeof entry.path !== 'string' || path.basename(entry.path) !== path.basename(relativePath)) {
    fail(`${label}.path 文件名必须是 ${path.basename(relativePath)}`);
  }
  if (!Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes < 0) {
    fail(`${label}.sizeBytes 无效`);
  }
  if (typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(entry.sha256)) {
    fail(`${label}.sha256 无效`);
  }

  const evidencePath = path.join(bundleDirectory, relativePath);
  if (!fs.existsSync(evidencePath)) {
    fail(`${label} 指向的文件不存在：${evidencePath}`);
  }
  const stat = fs.statSync(evidencePath);
  if (!stat.isFile()) {
    fail(`${label} 指向的路径不是普通文件：${evidencePath}`);
  }

  const expectedSha = entry.sha256.toLowerCase();
  const actualSha = sha256File(evidencePath);
  if (stat.size !== entry.sizeBytes) {
    fail(`${label} 大小不匹配：summary=${entry.sizeBytes} actual=${stat.size}`);
  }
  if (actualSha !== expectedSha) {
    fail(`${label} SHA-256 不匹配：summary=${expectedSha} actual=${actualSha}`);
  }

  process.stdout.write(`[OK] agentEvidence: ${relativePath} ${stat.size} bytes ${actualSha}\n`);
}

function readEvidenceJsonByRelativePath(bundleDirectory, relativePath, label) {
  try {
    return JSON.parse(fs.readFileSync(path.join(bundleDirectory, relativePath), 'utf8'));
  } catch (error) {
    fail(`无法读取或解析 ${label}：${path.join(bundleDirectory, relativePath)}`);
  }
}

function validateAttachedAgentRuntimeSummary(summary) {
  const failures = [];
  if (summary?.schemaVersion !== 'ou-ui-agent.runtime-summary.v1') {
    failures.push('runtime-summary.json schemaVersion 不匹配');
  }
  if (summary?.status !== 'ok') {
    failures.push(`runtime-summary.json status=${summary?.status ?? 'missing'}`);
  }

  const modules = Array.isArray(summary?.modules) ? summary.modules : [];
  const xray = modules.find((item) => item?.moduleKind === 'xray');
  if (!xray?.present || xray?.runtime !== 'running' || (xray?.inboundCount ?? 0) < 1) {
    failures.push('缺少运行中的 Xray inbound 证据');
  }
  const forwarding = modules.find((item) => item?.moduleKind === 'port-forwarding');
  if (!forwarding?.present || forwarding?.runtime !== 'running' || (forwarding?.serviceCount ?? 0) < 1) {
    failures.push('缺少运行中的端口转发 service 证据');
  }
  if ((summary?.pendingEvents?.count ?? 0) !== 0) {
    failures.push('Agent pending event queue 非空');
  }
  if (summary?.guardrails?.host?.parseError) {
    failures.push('host guardrail 证据解析失败');
  }
  if ((summary?.guardrails?.portForwarding?.enforcementErrorCount ?? 0) > 0) {
    failures.push('端口转发 guardrail 存在 enforcement error');
  }
  if ((summary?.guardrails?.xrayClients?.enforcementErrorCount ?? 0) > 0) {
    failures.push('Xray client guardrail 存在 enforcement error');
  }
  return failures;
}

function validateRuntimeAcceptanceSummary(summary) {
  const failures = [];
  const activeSessionCount = (summary?.agents?.sessionsByStatus?.online ?? 0) + (summary?.agents?.sessionsByStatus?.degraded ?? 0);

  if ((summary?.agents?.total ?? 0) < 1) {
    failures.push('缺少已注册 Agent');
  }
  if (activeSessionCount < 1) {
    failures.push('缺少在线或降级可见的 Agent session');
  }
  if ((summary?.runtime?.xrayInbounds ?? 0) < 1) {
    failures.push('缺少 Xray inbound 现场读模型');
  }
  if ((summary?.runtime?.forwardingRules ?? 0) < 1 || (summary?.runtime?.forwardingPorts ?? 0) < 1) {
    failures.push('缺少端口转发规则或监听端口现场读模型');
  }
  if ((summary?.alerts?.bySeverity?.critical ?? 0) > 0) {
    failures.push('存在 critical 系统告警');
  }
  if ((summary?.commandOutbox?.deadLetters ?? 0) > 0) {
    failures.push('存在命令死信');
  }

  return failures;
}

const manifest = readJson(manifestPath);
if (manifest.schemaVersion !== 'ou-ui-next.production-acceptance-bundle.v1') {
  fail(`manifest schemaVersion 不匹配：${manifest.schemaVersion || 'missing'}`);
}

if (!manifest.evidence || typeof manifest.evidence !== 'object') {
  fail('manifest 缺少 evidence 对象，无法校验证据文件完整性。');
}

const bundleDirectory = path.dirname(manifestPath);
const requiresStrictEvidence = Object.values(requirements).some(Boolean);
if (requiresStrictEvidence && (typeof manifest.bundleDirectory !== 'string' || manifest.bundleDirectory.trim() === '')) {
  fail('严格验收要求 manifest.bundleDirectory 缺失或为空。');
}
function normalizeBundleDirectoryValue(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return '';
  }
  return path.resolve(value.trim());
}

const currentBundleDirectory = path.resolve(bundleDirectory);
const manifestBundleDirectory = normalizeBundleDirectoryValue(manifest.bundleDirectory);

function requireBundleDirectoryMatchesManifest(value, label) {
  const recordedBundleDirectory = normalizeBundleDirectoryValue(value);
  if (recordedBundleDirectory === '') {
    fail(`${label} bundleDirectory 缺失或为空。`);
  }
  if (recordedBundleDirectory !== manifestBundleDirectory) {
    fail(`${label} bundleDirectory 与 manifest.bundleDirectory 不匹配。`);
  }
}

function requireBundleDirectoryMatchesManifestOrCurrent(value, label) {
  const recordedBundleDirectory = normalizeBundleDirectoryValue(value);
  if (recordedBundleDirectory === '') {
    fail(`${label} bundleDirectory 缺失或为空。`);
  }
  if (recordedBundleDirectory !== manifestBundleDirectory && recordedBundleDirectory !== currentBundleDirectory) {
    fail(`${label} bundleDirectory 与 manifest.bundleDirectory 或当前证据包目录不匹配。`);
  }
}

function requireIsoUtcTimestamp(value, label) {
  const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
  if (
    typeof value !== 'string' ||
    !timestampPattern.test(value)
  ) {
    fail(`${label} createdAt 无效。`);
  }
  const parsedTimestamp = Date.parse(value);
  if (Number.isNaN(parsedTimestamp)) {
    fail(`${label} createdAt 无效。`);
  }
  const canonicalTimestamp = new Date(parsedTimestamp).toISOString();
  const expectedTimestamp = value.includes('.') ? value : value.replace(/Z$/, '.000Z');
  if (canonicalTimestamp !== expectedTimestamp) {
    fail(`${label} createdAt 无效。`);
  }
}

let releaseSummaryForVerification = null;
if (requirements.releaseSummary) {
  releaseSummaryForVerification = readEvidenceJson(
    bundleDirectory,
    'release-acceptance-summary.json',
    'release-acceptance-summary.json'
  );
  if (releaseSummaryForVerification.schemaVersion !== 'ou-ui-next.release-acceptance-summary.v1') {
    fail(`要求发布验收摘要，但 release-acceptance-summary.json schemaVersion=${releaseSummaryForVerification.schemaVersion ?? 'missing'}`);
  }
  if (releaseSummaryForVerification.status !== 'passed') {
    fail(`要求发布验收摘要，但 release-acceptance-summary.json status=${releaseSummaryForVerification.status ?? 'missing'}`);
  }
  requireIsoUtcTimestamp(releaseSummaryForVerification.createdAt, '要求发布验收摘要，但 release-acceptance-summary.json');
  if (
    typeof releaseSummaryForVerification.bundleDirectory !== 'string' ||
    releaseSummaryForVerification.bundleDirectory.trim() === ''
  ) {
    fail('要求发布验收摘要，但 release-acceptance-summary.json bundleDirectory 缺失或为空。');
  }
  requireBundleDirectoryMatchesManifestOrCurrent(
    releaseSummaryForVerification.bundleDirectory,
    '要求发布验收摘要，但 release-acceptance-summary.json'
  );
  const releaseSummaryStrictGates = releaseSummaryForVerification.strictGates;
  if (!releaseSummaryStrictGates || typeof releaseSummaryStrictGates !== 'object') {
    fail('要求发布验收摘要，但 release-acceptance-summary.json strictGates 不完整。');
  }
  for (const gate of releaseSummaryRequiredGates) {
    if (releaseSummaryStrictGates[gate.key] !== true) {
      fail(`要求发布验收摘要，但 release-acceptance-summary.json strictGates.${gate.key} 未记录为 true。`);
    }
    requirements[gate.requirementKey] = true;
  }
}

let finalSummaryForVerification = null;
if (requirements.finalSummary) {
  finalSummaryForVerification = readEvidenceJson(
    bundleDirectory,
    'final-acceptance-summary.json',
    'final-acceptance-summary.json'
  );
  if (finalSummaryForVerification.schemaVersion !== 'ou-ui-next.final-acceptance-summary.v1') {
    fail(`要求最终验收摘要，但 final-acceptance-summary.json schemaVersion=${finalSummaryForVerification.schemaVersion ?? 'missing'}`);
  }
  if (finalSummaryForVerification.status !== 'passed') {
    fail(`要求最终验收摘要，但 final-acceptance-summary.json status=${finalSummaryForVerification.status ?? 'missing'}`);
  }
  requireIsoUtcTimestamp(finalSummaryForVerification.createdAt, '要求最终验收摘要，但 final-acceptance-summary.json');
  if (
    typeof finalSummaryForVerification.bundleDirectory !== 'string' ||
    finalSummaryForVerification.bundleDirectory.trim() === ''
  ) {
    fail('要求最终验收摘要，但 final-acceptance-summary.json bundleDirectory 缺失或为空。');
  }
  requireBundleDirectoryMatchesManifest(
    finalSummaryForVerification.bundleDirectory,
    '要求最终验收摘要，但 final-acceptance-summary.json'
  );
  const finalSummaryStrictGates = finalSummaryForVerification.strictGates;
  if (
    !finalSummaryStrictGates ||
    typeof finalSummaryStrictGates !== 'object' ||
    finalSummaryStrictGates.runtimeEvidence !== true ||
    finalSummaryStrictGates.browserSmoke !== true ||
    finalSummaryStrictGates.notificationSmoke !== true ||
    finalSummaryStrictGates.webhookSmoke !== true
  ) {
    fail('要求最终验收摘要，但 final-acceptance-summary.json strictGates 不完整。');
  }
  if (
    (finalSummaryStrictGates.archiveProviderEvidence === true || finalSummaryStrictGates.timestampEvidence === true) &&
    finalSummaryStrictGates.externalReceipts !== true
  ) {
    fail('要求最终验收摘要，但 final-acceptance-summary.json strictGates.externalReceipts 未记录为 true。');
  }
  if (finalSummaryStrictGates.agentFinalSummary === true && finalSummaryStrictGates.agentEvidence !== true) {
    fail('要求最终验收摘要，但 final-acceptance-summary.json strictGates.agentEvidence 未记录为 true。');
  }
  for (const gate of finalSummaryOptionalGates) {
    const value = finalSummaryStrictGates[gate.key];
    if (value === true) {
      requirements[gate.requirementKey] = true;
      continue;
    }
    if (value !== undefined && typeof value !== 'boolean') {
      fail(`要求最终验收摘要，但 final-acceptance-summary.json strictGates.${gate.key} 无效。`);
    }
  }
}

const requiredFiles = {
  doctorLog: 'doctor.txt',
  smokeLog: 'smoke.txt',
  smokeReport: 'smoke-report.json'
};
const optionalFiles = {
  browserSmokeLog: 'browser-smoke.txt',
  browserSmokeReport: 'browser-smoke-report.json',
  browserScreenshotArchive: 'browser-screenshots.tar.gz',
  notificationSmokeLog: 'notification-smoke.txt',
  notificationSmokeReport: 'notification-smoke-report.json',
  webhookSmokeLog: 'webhook-smoke.txt',
  webhookSmokeReport: 'webhook-smoke-report.json',
  archiveSmokeLog: 'archive-smoke.txt',
  archiveSmokeReport: 'archive-smoke-report.json',
  externalReceiptsManifest: 'external-receipts-manifest.json',
  installEvidenceManifest: 'install-evidence-manifest.json',
  agentEvidenceManifest: 'agent-evidence-manifest.json'
};
const expectedFiles = { ...requiredFiles };

for (const [key, fileName] of Object.entries(optionalFiles)) {
  if (manifest.evidence[key] || manifest[key]) {
    expectedFiles[key] = fileName;
  }
}

process.stdout.write(`验收证据 manifest: ${manifestPath}\n`);
process.stdout.write(`原始检查状态: doctor=${manifest.doctorStatus ?? 'unknown'} smoke=${manifest.smokeStatus ?? 'unknown'} browserSmoke=${manifest.browserSmokeStatus ?? 'not-recorded'} notificationSmoke=${manifest.notificationSmokeStatus ?? 'not-recorded'} webhookSmoke=${manifest.webhookSmokeStatus ?? 'not-recorded'} archiveSmoke=${manifest.archiveSmokeStatus ?? 'not-recorded'} externalReceipts=${manifest.externalReceiptCount ?? 'not-recorded'} installEvidence=${manifest.installEvidenceCount ?? 'not-recorded'} agentEvidence=${manifest.agentEvidenceCount ?? 'not-recorded'}\n`);

for (const [key, fileName] of Object.entries(expectedFiles)) {
  const entry = manifest.evidence[key];
  if (!entry || typeof entry !== 'object') {
    fail(`manifest 缺少 evidence.${key}`);
  }

  if (typeof entry.path !== 'string' || path.basename(entry.path) !== fileName) {
    fail(`evidence.${key}.path 文件名必须是 ${fileName}`);
  }

  const evidencePath = path.join(bundleDirectory, fileName);
  const exists = fs.existsSync(evidencePath);

  if (entry.missing === true) {
    if (exists) {
      fail(`evidence.${key} 标记 missing，但当前证据包内存在 ${fileName}`);
    }
    process.stdout.write(`[OK] ${key}: missing\n`);
    continue;
  }

  if (!exists) {
    fail(`证据文件不存在：${evidencePath}`);
  }

  const stat = fs.statSync(evidencePath);
  if (!stat.isFile()) {
    fail(`证据路径不是普通文件：${evidencePath}`);
  }

  if (!Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes < 0) {
    fail(`evidence.${key}.sizeBytes 无效`);
  }
  if (typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(entry.sha256)) {
    fail(`evidence.${key}.sha256 无效`);
  }

  const expectedSha = entry.sha256.toLowerCase();
  const actualSha = sha256File(evidencePath);

  if (stat.size !== entry.sizeBytes) {
    fail(`${key} 大小不匹配：manifest=${entry.sizeBytes} actual=${stat.size}`);
  }
  if (actualSha !== expectedSha) {
    fail(`${key} SHA-256 不匹配：manifest=${expectedSha} actual=${actualSha}`);
  }

  process.stdout.write(`[OK] ${key}: ${fileName} ${stat.size} bytes ${actualSha}\n`);
}

if (
  manifest.evidence.externalReceiptsManifest ||
  manifest.externalReceiptsManifest ||
  requirements.externalReceipts ||
  requirements.archiveProviderEvidence ||
  requirements.timestampEvidence
) {
  if (!manifest.evidence.externalReceiptsManifest) {
    fail('manifest 缺少 evidence.externalReceiptsManifest');
  }

  const receiptsManifest = readEvidenceJson(
    bundleDirectory,
    'external-receipts-manifest.json',
    'external-receipts-manifest.json'
  );
  if (receiptsManifest.schemaVersion !== 'ou-ui-next.production-external-receipts.v1') {
    fail(`external-receipts-manifest.json schemaVersion 不匹配：${receiptsManifest.schemaVersion ?? 'missing'}`);
  }
  if (!Array.isArray(receiptsManifest.receipts)) {
    fail('external-receipts-manifest.json receipts 必须是数组。');
  }
  if (receiptsManifest.receiptCount !== receiptsManifest.receipts.length) {
    fail('external-receipts-manifest.json receiptCount 与 receipts 数量不匹配。');
  }
  if (Number.isSafeInteger(manifest.externalReceiptCount) && manifest.externalReceiptCount !== receiptsManifest.receipts.length) {
    fail('manifest.externalReceiptCount 与 external-receipts-manifest.json receipts 数量不匹配。');
  }

  let archiveProviderEvidenceCount = 0;
  let timestampEvidenceCount = 0;
  receiptsManifest.receipts.forEach((receipt, index) => {
    verifyReceiptFileEntry(bundleDirectory, receipt, index);

    const providerEvidence = inspectArchiveProviderEvidenceReceipt(bundleDirectory, receipt, index);
    if (providerEvidence.matchesSchema) {
      if (providerEvidence.failures.length > 0) {
        if (requirements.archiveProviderEvidence) {
          fail(`归档 provider 侧不可变证据未通过：${providerEvidence.relativePath}: ${providerEvidence.failures.join('; ')}`);
        }
      } else {
        archiveProviderEvidenceCount += 1;
        process.stdout.write(`[OK] archiveProviderEvidence: ${providerEvidence.relativePath}\n`);
      }
    }

    const timestampEvidence = inspectTimestampEvidenceReceipt(bundleDirectory, receipt, index);
    if (timestampEvidence.matchesSchema) {
      if (timestampEvidence.failures.length > 0) {
        if (requirements.timestampEvidence) {
          fail(`第三方时间戳证据未通过：${timestampEvidence.relativePath}: ${timestampEvidence.failures.join('; ')}`);
        }
      } else {
        timestampEvidenceCount += 1;
        process.stdout.write(`[OK] timestampEvidence: ${timestampEvidence.relativePath}\n`);
      }
    }
  });

  if (requirements.externalReceipts) {
    if (receiptsManifest.receipts.length < 1) {
      fail('要求外部 provider 回执证据，但 external-receipts-manifest.json 没有记录任何回执文件。');
    }
    process.stdout.write('[OK] external receipt gate: passed\n');
  }
  if (requirements.archiveProviderEvidence) {
    if (archiveProviderEvidenceCount < 1) {
      fail('要求归档 provider 侧不可变证据，但 external-receipts-manifest.json 没有符合 ou-ui-next.archive-provider-evidence.v1 的通过回执。');
    }
    process.stdout.write('[OK] archive provider evidence gate: passed\n');
  }
  if (requirements.timestampEvidence) {
    if (timestampEvidenceCount < 1) {
      fail('要求第三方时间戳证据，但 external-receipts-manifest.json 没有符合 ou-ui-next.timestamp-evidence.v1 的通过回执。');
    }
    process.stdout.write('[OK] timestamp evidence gate: passed\n');
  }
} else if (requirements.externalReceipts || requirements.archiveProviderEvidence || requirements.timestampEvidence) {
  fail(`要求外部 provider 回执证据，但 manifest.externalReceiptCount=${manifest.externalReceiptCount ?? 'not-recorded'}`);
}

if (manifest.evidence.installEvidenceManifest || manifest.installEvidenceManifest || requirements.cleanInstallEvidence) {
  if (!manifest.evidence.installEvidenceManifest) {
    fail('manifest 缺少 evidence.installEvidenceManifest');
  }

  const installEvidenceManifest = readEvidenceJson(
    bundleDirectory,
    'install-evidence-manifest.json',
    'install-evidence-manifest.json'
  );
  if (installEvidenceManifest.schemaVersion !== 'ou-ui-next.production-install-evidence.v1') {
    fail(`install-evidence-manifest.json schemaVersion 不匹配：${installEvidenceManifest.schemaVersion ?? 'missing'}`);
  }
  if (!Array.isArray(installEvidenceManifest.evidence)) {
    fail('install-evidence-manifest.json evidence 必须是数组。');
  }
  if (installEvidenceManifest.installEvidenceCount !== installEvidenceManifest.evidence.length) {
    fail('install-evidence-manifest.json installEvidenceCount 与 evidence 数量不匹配。');
  }
  if (
    Number.isSafeInteger(manifest.installEvidenceCount) &&
    manifest.installEvidenceCount !== installEvidenceManifest.evidence.length
  ) {
    fail('manifest.installEvidenceCount 与 install-evidence-manifest.json evidence 数量不匹配。');
  }

  let cleanInstallEvidenceCount = 0;
  installEvidenceManifest.evidence.forEach((evidence, index) => {
    const verifiedFile = verifyInstallEvidenceFileEntry(bundleDirectory, evidence, index);
    const cleanInstallEvidence = inspectCleanInstallEvidenceFile(
      verifiedFile.evidencePath,
      verifiedFile.relativePath,
      index
    );
    if (!cleanInstallEvidence.matchesSchema) {
      return;
    }
    if (cleanInstallEvidence.failures.length > 0) {
      if (requirements.cleanInstallEvidence) {
        fail(`干净服务器安装证据未通过：${cleanInstallEvidence.relativePath}: ${cleanInstallEvidence.failures.join('; ')}`);
      }
      return;
    }

    cleanInstallEvidenceCount += 1;
    process.stdout.write(`[OK] cleanInstallEvidence: ${cleanInstallEvidence.relativePath}\n`);
  });

  if (requirements.cleanInstallEvidence) {
    if (installEvidenceManifest.evidence.length < 1) {
      fail('要求干净服务器安装证据，但 install-evidence-manifest.json 没有记录任何安装证据文件。');
    }
    if (cleanInstallEvidenceCount < 1) {
      fail('要求干净服务器安装证据，但 install-evidence-manifest.json 没有符合 ou-ui-next.clean-install-evidence.v1 的通过摘要。');
    }
    process.stdout.write('[OK] clean install evidence gate: passed\n');
  }
} else if (requirements.cleanInstallEvidence) {
  fail(`要求干净服务器安装证据，但 manifest.installEvidenceCount=${manifest.installEvidenceCount ?? 'not-recorded'}`);
}

if (
  manifest.evidence.agentEvidenceManifest ||
  manifest.agentEvidenceManifest ||
  requirements.agentEvidence ||
  requirements.agentFinalSummary
) {
  if (!manifest.evidence.agentEvidenceManifest) {
    fail('manifest 缺少 evidence.agentEvidenceManifest');
  }

  const agentEvidenceManifest = readEvidenceJson(
    bundleDirectory,
    'agent-evidence-manifest.json',
    'agent-evidence-manifest.json'
  );
  if (agentEvidenceManifest.schemaVersion !== 'ou-ui-next.production-agent-evidence.v1') {
    fail(`agent-evidence-manifest.json schemaVersion 不匹配：${agentEvidenceManifest.schemaVersion ?? 'missing'}`);
  }
  if (!Array.isArray(agentEvidenceManifest.bundles)) {
    fail('agent-evidence-manifest.json bundles 必须是数组。');
  }
  if (agentEvidenceManifest.agentEvidenceCount !== agentEvidenceManifest.bundles.length) {
    fail('agent-evidence-manifest.json agentEvidenceCount 与 bundles 数量不匹配。');
  }
  if (Number.isSafeInteger(manifest.agentEvidenceCount) && manifest.agentEvidenceCount !== agentEvidenceManifest.bundles.length) {
    fail('manifest.agentEvidenceCount 与 agent-evidence-manifest.json bundles 数量不匹配。');
  }

  let agentFinalSummaryCount = 0;
  agentEvidenceManifest.bundles.forEach((bundle, index) => {
    const label = `agent evidence ${index + 1}`;
    if (!bundle || typeof bundle !== 'object') {
      fail(`${label} 缺少记录。`);
    }
    const relativeDirectory = normalizeAgentEvidenceDirectory(bundle.relativeDirectory, label);
    const files = bundle.files;
    if (!files || typeof files !== 'object') {
      fail(`${label}.files 缺少文件摘要。`);
    }

    const agentManifestPath = `${relativeDirectory}/manifest.json`;
    const runtimeSummaryPath = `${relativeDirectory}/runtime-summary.json`;
    const finalSummaryPath = `${relativeDirectory}/final-acceptance-summary.json`;
    const finalVerifyLogPath = `${relativeDirectory}/final-acceptance-verify.txt`;
    if (requirements.agentFinalSummary && !files.finalSummary) {
      fail(`${label}.files.finalSummary 缺失；生产发布复核要求附加 ou-agent qf 最终验收摘要。`);
    }
    if (requirements.agentFinalSummary && !files.finalVerifyLog) {
      fail(`${label}.files.finalVerifyLog 缺失；生产发布复核要求附加 ou-agent qf 校验 transcript。`);
    }
    verifyAgentEvidenceFileEntry(bundleDirectory, files.manifest, agentManifestPath, `${label}.manifest`);
    verifyAgentEvidenceFileEntry(
      bundleDirectory,
      files.runtimeSummary,
      runtimeSummaryPath,
      `${label}.runtimeSummary`
    );
    if (files.finalSummary) {
      verifyAgentEvidenceFileEntry(
        bundleDirectory,
        files.finalSummary,
        finalSummaryPath,
        `${label}.finalSummary`
      );
    }
    if (files.finalVerifyLog) {
      verifyAgentEvidenceFileEntry(
        bundleDirectory,
        files.finalVerifyLog,
        finalVerifyLogPath,
        `${label}.finalVerifyLog`
      );
    }

    const attachedAgentManifest = readEvidenceJsonByRelativePath(bundleDirectory, agentManifestPath, `${label} manifest.json`);
    if (attachedAgentManifest.schemaVersion !== 'ou-ui-agent.acceptance-bundle.v1') {
      fail(`${label} manifest.json schemaVersion 不匹配。`);
    }
    if (
      (requirements.agentEvidence || requirements.agentFinalSummary) &&
      (typeof attachedAgentManifest.bundleDirectory !== 'string' || attachedAgentManifest.bundleDirectory.trim() === '')
    ) {
      fail(`${label} manifest.json bundleDirectory 缺失或为空。`);
    }
    const attachedAgentBundleDirectory =
      normalizeBundleDirectoryValue(attachedAgentManifest.bundleDirectory);
    if ((requirements.agentEvidence || requirements.agentFinalSummary) && attachedAgentManifest.serviceStatus !== 0) {
      fail(`${label} manifest.json serviceStatus=${attachedAgentManifest.serviceStatus ?? 'not-recorded'}`);
    }
    if (
      (requirements.agentEvidence || requirements.agentFinalSummary) &&
      attachedAgentManifest.runtimeSummaryStatus !== 0
    ) {
      fail(`${label} manifest.json runtimeSummaryStatus=${attachedAgentManifest.runtimeSummaryStatus ?? 'not-recorded'}`);
    }
    const runtimeSummary = readEvidenceJsonByRelativePath(bundleDirectory, runtimeSummaryPath, `${label} runtime-summary.json`);
    const runtimeFailures = validateAttachedAgentRuntimeSummary(runtimeSummary);
    if ((requirements.agentEvidence || requirements.agentFinalSummary) && runtimeFailures.length > 0) {
      fail(`Agent 现场证据门槛未通过：${runtimeFailures.join('; ')}`);
    }

    if (files.finalSummary) {
      const agentFinalSummary = readEvidenceJsonByRelativePath(
        bundleDirectory,
        finalSummaryPath,
        `${label} final-acceptance-summary.json`
      );
      if (agentFinalSummary.schemaVersion !== 'ou-ui-agent.final-acceptance-summary.v1') {
        fail(`${label} final-acceptance-summary.json schemaVersion 不匹配。`);
      }
      if ((requirements.agentEvidence || requirements.agentFinalSummary) && agentFinalSummary.status !== 'passed') {
        fail(`${label} final-acceptance-summary.json status=${agentFinalSummary.status ?? 'missing'}`);
      }
      if (requirements.agentFinalSummary) {
        requireIsoUtcTimestamp(agentFinalSummary.createdAt, `${label} final-acceptance-summary.json`);
        if (typeof agentFinalSummary.bundleDirectory !== 'string' || agentFinalSummary.bundleDirectory.trim() === '') {
          fail(`${label} final-acceptance-summary.json bundleDirectory 缺失或为空。`);
        }
        if (normalizeBundleDirectoryValue(agentFinalSummary.bundleDirectory) !== attachedAgentBundleDirectory) {
          fail(`${label} final-acceptance-summary.json bundleDirectory 与 manifest.json bundleDirectory 不匹配。`);
        }
        if (agentFinalSummary.strictGates?.runtimeEvidence !== true) {
          fail(`${label} final-acceptance-summary.json strictGates.runtimeEvidence 未记录为 true。`);
        }
        verifyAgentEvidenceFileEntry(
          bundleDirectory,
          agentFinalSummary.manifest,
          agentManifestPath,
          `${label}.finalSummary.manifest`
        );
        verifyAgentEvidenceFileEntry(
          bundleDirectory,
          agentFinalSummary.finalVerifyLog,
          finalVerifyLogPath,
          `${label}.finalSummary.finalVerifyLog`
        );
        const agentFinalVerifyLog = fs.readFileSync(path.join(bundleDirectory, finalVerifyLogPath), 'utf8');
        if (!agentFinalVerifyLog.includes('[OK] Agent runtime evidence gate: passed')) {
          fail(`${label} final-acceptance-verify.txt 缺少 Agent runtime evidence gate 通过标记。`);
        }
        agentFinalSummaryCount += 1;
      }
    }
  });

  if (requirements.agentEvidence || requirements.agentFinalSummary) {
    if (agentEvidenceManifest.bundles.length < 1) {
      fail('要求 Agent 主机证据，但 agent-evidence-manifest.json 没有记录任何 Agent 证据包。');
    }
  }
  if (requirements.agentEvidence) {
    process.stdout.write('[OK] agent evidence gate: passed\n');
  }
  if (requirements.agentFinalSummary) {
    if (agentFinalSummaryCount < 1) {
      fail('要求 Agent 最终验收摘要，但 agent-evidence-manifest.json 没有符合 ou-agent qf 的通过摘要。');
    }
    process.stdout.write('[OK] agent final summary gate: passed\n');
  }
} else if (requirements.agentEvidence || requirements.agentFinalSummary) {
  fail(`要求 Agent 主机证据，但 manifest.agentEvidenceCount=${manifest.agentEvidenceCount ?? 'not-recorded'}`);
}

if (requirements.runtimeEvidence) {
  if (manifest.smokeStatus !== 0) {
    fail(`要求 runtime 现场证据，但 manifest.smokeStatus=${manifest.smokeStatus ?? 'not-recorded'}`);
  }

  const smokeReport = readEvidenceJson(bundleDirectory, 'smoke-report.json', 'smoke-report.json');
  if (smokeReport.status !== 'passed') {
    fail(`要求 runtime 现场证据，但 smoke-report.json status=${smokeReport.status ?? 'missing'}`);
  }

  const runtimeCheck = findReportCheck(smokeReport, 'runtime acceptance summary');
  if (!runtimeCheck?.summary) {
    fail('要求 runtime 现场证据，但 smoke-report.json 缺少 runtime acceptance summary。');
  }

  const runtimeFailures = validateRuntimeAcceptanceSummary(runtimeCheck.summary);
  if (runtimeFailures.length > 0) {
    fail(`runtime 现场证据门槛未通过：${runtimeFailures.join('; ')}`);
  }

  process.stdout.write('[OK] runtime evidence gate: passed\n');
}

if (requirements.browserSmoke) {
  if (manifest.browserSmokeSkipped === true) {
    fail('要求浏览器烟测证据，但 manifest 标记 browserSmokeSkipped=true。');
  }
  if (manifest.browserSmokeStatus !== 0) {
    fail(`要求浏览器烟测证据，但 manifest.browserSmokeStatus=${manifest.browserSmokeStatus ?? 'not-recorded'}`);
  }
  if (!manifest.evidence.browserSmokeReport || !manifest.evidence.browserSmokeLog) {
    fail('要求浏览器烟测证据，但 manifest 缺少浏览器烟测 evidence。');
  }
  if (!manifest.evidence.browserScreenshotArchive) {
    fail('要求浏览器烟测证据，但 manifest 缺少 browserScreenshotArchive evidence。');
  }
  if (manifest.evidence.browserScreenshotArchive.missing === true) {
    fail('要求浏览器烟测证据，但 browser-screenshots.tar.gz 缺失。');
  }
  if (
    !Number.isSafeInteger(manifest.evidence.browserScreenshotArchive.sizeBytes) ||
    manifest.evidence.browserScreenshotArchive.sizeBytes <= 0
  ) {
    fail('要求浏览器烟测证据，但 browser-screenshots.tar.gz 为空或大小无效。');
  }

  const browserReport = readEvidenceJson(bundleDirectory, 'browser-smoke-report.json', 'browser-smoke-report.json');
  if (browserReport.status !== 'passed') {
    fail(`要求浏览器烟测证据，但 browser-smoke-report.json status=${browserReport.status ?? 'missing'}`);
  }
  if (browserReport.screenshotsEnabled !== true) {
    fail('要求浏览器烟测证据，但 browser-smoke-report.json 未启用截图。');
  }
  const browserScreenshotChecks = Array.isArray(browserReport.checks)
    ? browserReport.checks.filter((check) => typeof check?.screenshot === 'string' && check.screenshot.length > 0)
    : [];
  if (browserScreenshotChecks.length < 1) {
    fail('要求浏览器烟测证据，但 browser-smoke-report.json 缺少截图记录。');
  }

  process.stdout.write('[OK] browser smoke gate: passed\n');
}

if (requirements.notificationSmoke) {
  if (manifest.notificationSmokeSkipped === true) {
    fail('要求通知烟测证据，但 manifest 标记 notificationSmokeSkipped=true。');
  }
  if (manifest.notificationSmokeStatus !== 0) {
    fail(`要求通知烟测证据，但 manifest.notificationSmokeStatus=${manifest.notificationSmokeStatus ?? 'not-recorded'}`);
  }
  if (!manifest.evidence.notificationSmokeReport || !manifest.evidence.notificationSmokeLog) {
    fail('要求通知烟测证据，但 manifest 缺少通知烟测 evidence。');
  }

  const notificationReport = readEvidenceJson(bundleDirectory, 'notification-smoke-report.json', 'notification-smoke-report.json');
  if (notificationReport.status !== 'passed') {
    fail(`要求通知烟测证据，但 notification-smoke-report.json status=${notificationReport.status ?? 'missing'}`);
  }

  const notificationCheck = findReportCheck(notificationReport, 'telegram test notification');
  if (notificationCheck?.delivery?.status !== 'delivered') {
    fail('要求通知烟测证据，但 notification-smoke-report.json 缺少 delivered 测试通知记录。');
  }

  process.stdout.write('[OK] notification smoke gate: passed\n');
}

if (requirements.webhookSmoke) {
  if (manifest.webhookSmokeSkipped === true) {
    fail('要求 webhook 烟测证据，但 manifest 标记 webhookSmokeSkipped=true。');
  }
  if (manifest.webhookSmokeStatus !== 0) {
    fail(`要求 webhook 烟测证据，但 manifest.webhookSmokeStatus=${manifest.webhookSmokeStatus ?? 'not-recorded'}`);
  }
  if (!manifest.evidence.webhookSmokeReport || !manifest.evidence.webhookSmokeLog) {
    fail('要求 webhook 烟测证据，但 manifest 缺少 webhook 烟测 evidence。');
  }

  const webhookReport = readEvidenceJson(bundleDirectory, 'webhook-smoke-report.json', 'webhook-smoke-report.json');
  if (webhookReport.status !== 'passed') {
    fail(`要求 webhook 烟测证据，但 webhook-smoke-report.json status=${webhookReport.status ?? 'missing'}`);
  }
  if (!Array.isArray(webhookReport.targets) || webhookReport.targets.length < 1) {
    fail('要求 webhook 烟测证据，但 webhook-smoke-report.json 缺少目标记录。');
  }

  for (const target of webhookReport.targets) {
    if (target?.status !== 'passed') {
      fail('要求 webhook 烟测证据，但 webhook-smoke-report.json 存在未通过目标。');
    }
    if (typeof target.url !== 'string' || target.url.length < 1) {
      fail('要求 webhook 烟测证据，但 webhook-smoke-report.json 目标缺少脱敏 URL。');
    }

    let sanitizedUrl;
    try {
      sanitizedUrl = new URL(target.url);
    } catch (error) {
      fail('要求 webhook 烟测证据，但 webhook-smoke-report.json 目标脱敏 URL 无效。');
    }

    if (sanitizedUrl.username || sanitizedUrl.password) {
      fail('要求 webhook 烟测证据，但 webhook-smoke-report.json 目标 URL 暴露了认证信息。');
    }
    if (sanitizedUrl.pathname !== '/' && sanitizedUrl.pathname !== '/[redacted-path]') {
      fail('要求 webhook 烟测证据，但 webhook-smoke-report.json 目标 URL 未脱敏 path。');
    }
    if (sanitizedUrl.search && sanitizedUrl.search !== '?[redacted]') {
      fail('要求 webhook 烟测证据，但 webhook-smoke-report.json 目标 URL 未脱敏 query。');
    }
  }

  process.stdout.write('[OK] webhook smoke gate: passed\n');
}

if (requirements.archiveSmoke) {
  if (manifest.archiveSmokeSkipped === true) {
    fail('要求归档烟测证据，但 manifest 标记 archiveSmokeSkipped=true。');
  }
  if (manifest.archiveSmokeStatus !== 0) {
    fail(`要求归档烟测证据，但 manifest.archiveSmokeStatus=${manifest.archiveSmokeStatus ?? 'not-recorded'}`);
  }
  if (!manifest.evidence.archiveSmokeReport || !manifest.evidence.archiveSmokeLog) {
    fail('要求归档烟测证据，但 manifest 缺少归档烟测 evidence。');
  }

  const archiveReport = readEvidenceJson(bundleDirectory, 'archive-smoke-report.json', 'archive-smoke-report.json');
  if (archiveReport.schemaVersion !== 'ou-ui-next.production-archive-smoke.v1') {
    fail(`要求归档烟测证据，但 archive-smoke-report.json schemaVersion=${archiveReport.schemaVersion ?? 'missing'}`);
  }
  if (archiveReport.status !== 'passed') {
    fail(`要求归档烟测证据，但 archive-smoke-report.json status=${archiveReport.status ?? 'missing'}`);
  }

  for (const checkName of [
    'audit anchor archive smoke',
    'agent log archive smoke',
    'traffic rollup compaction archive smoke'
  ]) {
    const check = findReportCheck(archiveReport, checkName);
    if (check?.status !== 'passed') {
      fail(`要求归档烟测证据，但 archive-smoke-report.json ${checkName} 未通过。`);
    }
  }

  const sink = archiveReport.externalArchiveSink;
  const hasFileSink = sink?.directoryConfigured === true;
  const hasWebhookSink = Array.isArray(sink?.webhookTargets) && sink.webhookTargets.length > 0;
  const hasObjectStorageSink = Boolean(sink?.objectStorage);
  if (!hasFileSink && !hasWebhookSink && !hasObjectStorageSink) {
    fail('要求归档烟测证据，但 archive-smoke-report.json 未记录任何外部归档 sink。');
  }

  for (const target of sink?.webhookTargets ?? []) {
    if (typeof target?.url !== 'string' || target.url.length < 1) {
      fail('要求归档烟测证据，但 archive-smoke-report.json webhook 目标缺少脱敏 URL。');
    }

    let sanitizedUrl;
    try {
      sanitizedUrl = new URL(target.url);
    } catch (error) {
      fail('要求归档烟测证据，但 archive-smoke-report.json webhook 脱敏 URL 无效。');
    }

    if (sanitizedUrl.username || sanitizedUrl.password) {
      fail('要求归档烟测证据，但 archive-smoke-report.json webhook URL 暴露了认证信息。');
    }
    if (sanitizedUrl.pathname !== '/' && sanitizedUrl.pathname !== '/[redacted-path]') {
      fail('要求归档烟测证据，但 archive-smoke-report.json webhook URL 未脱敏 path。');
    }
    if (sanitizedUrl.search && sanitizedUrl.search !== '?[redacted]') {
      fail('要求归档烟测证据，但 archive-smoke-report.json webhook URL 未脱敏 query。');
    }
  }

  if (sink?.objectStorage) {
    let endpoint;
    try {
      endpoint = new URL(sink.objectStorage.endpoint);
    } catch (error) {
      fail('要求归档烟测证据，但 archive-smoke-report.json objectStorage.endpoint 无效。');
    }
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
      fail('要求归档烟测证据，但 archive-smoke-report.json objectStorage.endpoint 暴露了敏感信息。');
    }
    if (endpoint.pathname !== '/') {
      fail('要求归档烟测证据，但 archive-smoke-report.json objectStorage.endpoint 未脱敏 path。');
    }
    if (sink.objectStorage.objectLock !== undefined) {
      const objectLock = sink.objectStorage.objectLock;
      if (!objectLock || typeof objectLock !== 'object') {
        fail('要求归档烟测证据，但 archive-smoke-report.json objectStorage.objectLock 无效。');
      }
      if (
        objectLock.retentionMode !== undefined &&
        objectLock.retentionMode !== 'GOVERNANCE' &&
        objectLock.retentionMode !== 'COMPLIANCE'
      ) {
        fail('要求归档烟测证据，但 archive-smoke-report.json objectStorage.objectLock.retentionMode 无效。');
      }
      if (
        objectLock.retentionDays !== undefined &&
        (!Number.isSafeInteger(objectLock.retentionDays) || objectLock.retentionDays <= 0)
      ) {
        fail('要求归档烟测证据，但 archive-smoke-report.json objectStorage.objectLock.retentionDays 无效。');
      }
      if (typeof objectLock.legalHoldEnabled !== 'boolean') {
        fail('要求归档烟测证据，但 archive-smoke-report.json objectStorage.objectLock.legalHoldEnabled 无效。');
      }
    }
  }

  process.stdout.write('[OK] archive smoke gate: passed\n');
}

if (requirements.finalSummary) {
  const finalSummary = finalSummaryForVerification;
  if (finalSummary.schemaVersion !== 'ou-ui-next.final-acceptance-summary.v1') {
    fail(`要求最终验收摘要，但 final-acceptance-summary.json schemaVersion=${finalSummary.schemaVersion ?? 'missing'}`);
  }
  if (finalSummary.status !== 'passed') {
    fail(`要求最终验收摘要，但 final-acceptance-summary.json status=${finalSummary.status ?? 'missing'}`);
  }
  requireIsoUtcTimestamp(finalSummary.createdAt, '要求最终验收摘要，但 final-acceptance-summary.json');
  if (typeof finalSummary.bundleDirectory !== 'string' || finalSummary.bundleDirectory.trim() === '') {
    fail('要求最终验收摘要，但 final-acceptance-summary.json bundleDirectory 缺失或为空。');
  }
  requireBundleDirectoryMatchesManifest(
    finalSummary.bundleDirectory,
    '要求最终验收摘要，但 final-acceptance-summary.json'
  );
  if (
    finalSummary.strictGates?.runtimeEvidence !== true ||
    finalSummary.strictGates?.browserSmoke !== true ||
    finalSummary.strictGates?.notificationSmoke !== true ||
    finalSummary.strictGates?.webhookSmoke !== true
  ) {
    fail('要求最终验收摘要，但 final-acceptance-summary.json strictGates 不完整。');
  }

  verifySummaryFileEntry(bundleDirectory, finalSummary.manifest, 'manifest.json', 'final summary manifest');
  verifySummaryFileEntry(
    bundleDirectory,
    finalSummary.finalVerifyLog,
    'final-acceptance-verify.txt',
    'final summary verifier transcript'
  );

  const finalVerifyLog = fs.readFileSync(path.join(bundleDirectory, 'final-acceptance-verify.txt'), 'utf8');
  const requiredFinalSummaryMarkers = [
    '[OK] runtime evidence gate: passed',
    '[OK] browser smoke gate: passed',
    '[OK] notification smoke gate: passed',
    '[OK] webhook smoke gate: passed'
  ];

  for (const gate of finalSummaryOptionalGates) {
    const value = finalSummary.strictGates?.[gate.key];
    if (value === true) {
      requiredFinalSummaryMarkers.push(gate.marker);
      continue;
    }
    if (value !== undefined && typeof value !== 'boolean') {
      fail(`要求最终验收摘要，但 final-acceptance-summary.json strictGates.${gate.key} 无效。`);
    }
    if (requirements[gate.requirementKey]) {
      fail(`要求最终验收摘要，但 final-acceptance-summary.json strictGates.${gate.key} 未记录为 true。`);
    }
  }

  for (const marker of requiredFinalSummaryMarkers) {
    if (!finalVerifyLog.includes(marker)) {
      fail(`要求最终验收摘要，但 final-acceptance-verify.txt 缺少 ${marker}`);
    }
  }

  process.stdout.write('[OK] final acceptance summary gate: passed\n');
}

if (requirements.releaseSummary) {
  const releaseSummary = releaseSummaryForVerification;
  if (releaseSummary.schemaVersion !== 'ou-ui-next.release-acceptance-summary.v1') {
    fail(`要求发布验收摘要，但 release-acceptance-summary.json schemaVersion=${releaseSummary.schemaVersion ?? 'missing'}`);
  }
  if (releaseSummary.status !== 'passed') {
    fail(`要求发布验收摘要，但 release-acceptance-summary.json status=${releaseSummary.status ?? 'missing'}`);
  }
  requireIsoUtcTimestamp(releaseSummary.createdAt, '要求发布验收摘要，但 release-acceptance-summary.json');
  if (typeof releaseSummary.bundleDirectory !== 'string' || releaseSummary.bundleDirectory.trim() === '') {
    fail('要求发布验收摘要，但 release-acceptance-summary.json bundleDirectory 缺失或为空。');
  }
  requireBundleDirectoryMatchesManifestOrCurrent(
    releaseSummary.bundleDirectory,
    '要求发布验收摘要，但 release-acceptance-summary.json'
  );

  const requiredReleaseSummaryMarkers = [];
  for (const gate of releaseSummaryRequiredGates) {
    if (releaseSummary.strictGates?.[gate.key] !== true) {
      fail(`要求发布验收摘要，但 release-acceptance-summary.json strictGates.${gate.key} 未记录为 true。`);
    }
    requiredReleaseSummaryMarkers.push(gate.marker);
  }

  verifySummaryFileEntry(bundleDirectory, releaseSummary.manifest, 'manifest.json', 'release summary manifest');
  verifySummaryFileEntry(
    bundleDirectory,
    releaseSummary.finalAcceptanceSummary,
    'final-acceptance-summary.json',
    'release summary final acceptance summary'
  );
  verifySummaryFileEntry(
    bundleDirectory,
    releaseSummary.releaseVerifyLog,
    'release-acceptance-verify.txt',
    'release summary verifier transcript'
  );

  const releaseVerifyLog = fs.readFileSync(path.join(bundleDirectory, 'release-acceptance-verify.txt'), 'utf8');
  for (const marker of requiredReleaseSummaryMarkers) {
    if (!releaseVerifyLog.includes(marker)) {
      fail(`要求发布验收摘要，但 release-acceptance-verify.txt 缺少 ${marker}`);
    }
  }

  process.stdout.write('[OK] release acceptance summary gate: passed\n');
}

process.stdout.write('生产验收证据包完整性校验通过。\n');
ACCEPTANCE_VERIFY_NODE
}

verify_final_production_acceptance_bundle() {
  verify_production_acceptance \
    --require-runtime-evidence \
    --require-browser-smoke \
    --require-notification-smoke \
    --require-webhook-smoke \
    --require-final-summary \
    "$@"
}

verify_production_release_acceptance_bundle() {
  local input_path="" release_summary_path="" arg
  local release_summary_args=()

  for arg in "$@"; do
    if [[ "${arg}" != -* ]]; then
      input_path="${arg}"
    fi
  done
  if [[ -n "${input_path}" ]]; then
    if [[ -d "${input_path}" ]]; then
      release_summary_path="${input_path%/}/release-acceptance-summary.json"
    else
      release_summary_path="$(dirname -- "${input_path}")/release-acceptance-summary.json"
    fi
  fi
  if [[ "${PRODUCTION_ACCEPTANCE_SKIP_EXISTING_RELEASE_SUMMARY:-0}" != "1" && -n "${release_summary_path}" && -f "${release_summary_path}" ]]; then
    release_summary_args=(--require-release-summary)
  fi

  verify_production_acceptance \
    --require-runtime-evidence \
    --require-browser-smoke \
    --require-notification-smoke \
    --require-webhook-smoke \
    --require-archive-smoke \
    --require-external-receipts \
    --require-archive-provider-evidence \
    --require-timestamp-evidence \
    --require-clean-install-evidence \
    --require-agent-evidence \
    --require-agent-final-summary \
    --require-final-summary \
    "${release_summary_args[@]}" \
    "$@"
}

run_production_release_verify() {
  local write_summary=0 input_path="" arg bundle_dir manifest_path final_summary_path release_verify_log release_summary_path release_status

  while (($# > 0)); do
    arg="$1"
    case "${arg}" in
      --write-summary)
        write_summary=1
        shift
        ;;
      --)
        shift
        ;;
      -*)
        fail "production-release-verify 不支持参数 ${arg}；可用 --write-summary。"
        ;;
      *)
        [[ -z "${input_path}" ]] || fail "production-release-verify 只接受一个证据包目录或 manifest.json 路径。"
        input_path="$1"
        shift
        ;;
    esac
  done

  [[ -n "${input_path}" ]] || fail "production-release-verify 需要一个证据包目录或 manifest.json 路径。"

  if (( write_summary == 0 )); then
    verify_production_release_acceptance_bundle "${input_path}"
    return "$?"
  fi

  if [[ -d "${input_path}" ]]; then
    bundle_dir="${input_path%/}"
    manifest_path="${bundle_dir}/manifest.json"
  else
    manifest_path="${input_path}"
    bundle_dir="$(dirname -- "${manifest_path}")"
  fi
  [[ -f "${manifest_path}" ]] || fail "未找到生产验收证据 manifest：${manifest_path}"

  final_summary_path="${bundle_dir}/final-acceptance-summary.json"
  release_verify_log="${bundle_dir}/release-acceptance-verify.txt"
  release_summary_path="${bundle_dir}/release-acceptance-summary.json"
  PRODUCTION_ACCEPTANCE_LAST_BUNDLE_DIR="${bundle_dir}"

  if PRODUCTION_ACCEPTANCE_SKIP_EXISTING_RELEASE_SUMMARY=1 verify_production_release_acceptance_bundle "${manifest_path}" >"${release_verify_log}" 2>&1; then
    chmod 600 "${release_verify_log}" 2>/dev/null || true
    write_release_acceptance_summary "${release_summary_path}" "passed" "${manifest_path}" "${final_summary_path}" "${release_verify_log}"
    cat "${release_verify_log}"
    printf '生产发布全量复核记录: %s\n' "${release_verify_log}"
    printf '生产发布验收摘要: %s\n' "${release_summary_path}"
    printf '生产发布全量复核通过: %s\n' "${bundle_dir}"
  else
    release_status=$?
    chmod 600 "${release_verify_log}" 2>/dev/null || true
    write_release_acceptance_summary "${release_summary_path}" "failed" "${manifest_path}" "${final_summary_path}" "${release_verify_log}"
    cat "${release_verify_log}" >&2 || true
    printf '[%s] 生产发布全量复核记录已保存：%s\n' "${APP_NAME}" "${release_verify_log}" >&2
    printf '[%s] 生产发布验收摘要已保存：%s\n' "${APP_NAME}" "${release_summary_path}" >&2
    printf '[%s] 生产发布全量复核失败：%s\n' "${APP_NAME}" "${bundle_dir}" >&2
    return "${release_status}"
  fi
}

write_final_acceptance_summary() {
  local summary_path="$1"
  local status="$2"
  local manifest_path="$3"
  local verify_log_path="$4"
  local archive_smoke_gate="${5:-false}"
  local external_receipts_gate="${6:-false}"
  local archive_provider_evidence_gate="${7:-false}"
  local timestamp_evidence_gate="${8:-false}"
  local clean_install_evidence_gate="${9:-false}"
  local agent_evidence_gate="${10:-false}"
  local agent_final_summary_gate="${11:-false}"
  local created_at escaped_bundle_dir escaped_status manifest_file_manifest verify_log_file_manifest

  created_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  escaped_bundle_dir="$(json_escape_string "${PRODUCTION_ACCEPTANCE_LAST_BUNDLE_DIR:-}")"
  escaped_status="$(json_escape_string "${status}")"
  manifest_file_manifest="$(production_acceptance_file_manifest_json "${manifest_path}")"
  verify_log_file_manifest="$(production_acceptance_file_manifest_json "${verify_log_path}")"

  cat >"${summary_path}" <<FINAL_ACCEPTANCE_SUMMARY_EOF
{"schemaVersion":"ou-ui-next.final-acceptance-summary.v1","status":"${escaped_status}","createdAt":"${created_at}","bundleDirectory":"${escaped_bundle_dir}","strictGates":{"runtimeEvidence":true,"browserSmoke":true,"notificationSmoke":true,"webhookSmoke":true,"archiveSmoke":${archive_smoke_gate},"externalReceipts":${external_receipts_gate},"archiveProviderEvidence":${archive_provider_evidence_gate},"timestampEvidence":${timestamp_evidence_gate},"cleanInstallEvidence":${clean_install_evidence_gate},"agentEvidence":${agent_evidence_gate},"agentFinalSummary":${agent_final_summary_gate}},"manifest":${manifest_file_manifest},"finalVerifyLog":${verify_log_file_manifest}}
FINAL_ACCEPTANCE_SUMMARY_EOF
  chmod 600 "${summary_path}" 2>/dev/null || true
}

write_release_acceptance_summary() {
  local summary_path="$1"
  local status="$2"
  local manifest_path="$3"
  local final_summary_path="$4"
  local verify_log_path="$5"
  local created_at escaped_bundle_dir escaped_status manifest_file_manifest final_summary_file_manifest verify_log_file_manifest

  created_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  escaped_bundle_dir="$(json_escape_string "${PRODUCTION_ACCEPTANCE_LAST_BUNDLE_DIR:-}")"
  escaped_status="$(json_escape_string "${status}")"
  manifest_file_manifest="$(production_acceptance_file_manifest_json "${manifest_path}")"
  final_summary_file_manifest="$(production_acceptance_file_manifest_json "${final_summary_path}")"
  verify_log_file_manifest="$(production_acceptance_file_manifest_json "${verify_log_path}")"

  cat >"${summary_path}" <<RELEASE_ACCEPTANCE_SUMMARY_EOF
{"schemaVersion":"ou-ui-next.release-acceptance-summary.v1","status":"${escaped_status}","createdAt":"${created_at}","bundleDirectory":"${escaped_bundle_dir}","strictGates":{"runtimeEvidence":true,"browserSmoke":true,"notificationSmoke":true,"webhookSmoke":true,"archiveSmoke":true,"externalReceipts":true,"archiveProviderEvidence":true,"timestampEvidence":true,"cleanInstallEvidence":true,"agentEvidence":true,"agentFinalSummary":true,"finalSummary":true},"manifest":${manifest_file_manifest},"finalAcceptanceSummary":${final_summary_file_manifest},"releaseVerifyLog":${verify_log_file_manifest}}
RELEASE_ACCEPTANCE_SUMMARY_EOF
  chmod 600 "${summary_path}" 2>/dev/null || true
}

validate_final_production_acceptance_args() {
  local arg has_notification_target=0

  validate_production_acceptance_smoke_args "$@"

  while (($# > 0)); do
    arg="$1"
    case "${arg}" in
      --skip-browser-smoke)
        fail "final-acceptance 要求真实浏览器烟测；请不要传入 --skip-browser-smoke。"
        ;;
      --telegram-admin-chat-id|--telegram-binding-id)
        has_notification_target=1
        shift 2
        ;;
      --timeout-ms|--notification-language|--webhook-url|--webhook-urls|--webhook-bearer-token|--webhook-bearer-token-file|--external-receipt|--receipt-file|--archive-provider-evidence|--timestamp-evidence|--install-evidence|--agent-evidence)
        shift 2
        ;;
      --insecure-tls|--skip-csrf-probe|--require-runtime-evidence|--include-notification-smoke|--include-webhook-smoke|--include-archive-smoke|--allow-local-webhook|--webhook-allow-local|--require-archive-provider-evidence|--require-timestamp-evidence|--require-clean-install-evidence)
        shift
        ;;
      --)
        break
        ;;
      *)
        shift
        ;;
    esac
  done

  if (( has_notification_target != 1 )); then
    fail "final-acceptance 要求显式 Telegram 测试目标：请传入 --telegram-admin-chat-id 或 --telegram-binding-id。"
  fi
}

require_production_release_acceptance_file() {
  local file_path="$1" label="$2"

  [[ -n "${file_path}" ]] || fail "production-release-acceptance ${label}路径不能为空。"
  [[ -f "${file_path}" ]] || fail "production-release-acceptance ${label}不存在或不是普通文件：${file_path}"
  [[ -r "${file_path}" ]] || fail "production-release-acceptance ${label}不可读取：${file_path}"
}

preflight_production_release_acceptance_evidence_content() {
  local kind="$1" file_path="$2" label verify_output verify_summary

  case "${kind}" in
    archive-provider)
      label="provider 侧不可变证据"
      ;;
    timestamp)
      label="第三方时间戳证据"
      ;;
    clean-install)
      label="干净服务器安装证据"
      ;;
    agent-runtime)
      label="Agent runtime-summary"
      ;;
    *)
      fail "production-release-acceptance 未知证据预检类型：${kind}"
      ;;
  esac

  if ! verify_output="$(
    {
      local temp_root temp_bundle started_at escaped_bundle_dir
      local doctor_log smoke_log smoke_report manifest_path evidence_extra=""
      local external_receipt_count=0 install_evidence_count=0 agent_evidence_count=0
      local doctor_file_manifest smoke_log_file_manifest smoke_report_file_manifest
      local -a verify_args

      command -v node >/dev/null 2>&1 || fail "production-release-acceptance 内容预检需要 node。"
      temp_root="$(mktemp -d)"
      trap 'rm -rf "${temp_root}"' EXIT

      temp_bundle="${temp_root}/bundle"
      mkdir -p "${temp_bundle}"
      started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      doctor_log="${temp_bundle}/doctor.txt"
      smoke_log="${temp_bundle}/smoke.txt"
      smoke_report="${temp_bundle}/smoke-report.json"
      manifest_path="${temp_bundle}/manifest.json"

      printf 'production-release-acceptance evidence preflight\n' >"${doctor_log}"
      printf 'production-release-acceptance evidence preflight\n' >"${smoke_log}"
      printf '{"schemaVersion":"ou-ui-next.production-smoke.v1","status":"passed","checks":[]}\n' >"${smoke_report}"

      case "${kind}" in
        archive-provider)
          write_production_acceptance_external_receipts_manifest "${started_at}" "${temp_bundle}/external-receipts" "${temp_bundle}/external-receipts-manifest.json" "${file_path}"
          external_receipt_count="${PRODUCTION_ACCEPTANCE_EXTERNAL_RECEIPT_COUNT:-1}"
          evidence_extra="${evidence_extra},\"externalReceiptsManifest\":$(production_acceptance_file_manifest_json "${temp_bundle}/external-receipts-manifest.json")"
          verify_args=(--require-archive-provider-evidence)
          ;;
        timestamp)
          write_production_acceptance_external_receipts_manifest "${started_at}" "${temp_bundle}/external-receipts" "${temp_bundle}/external-receipts-manifest.json" "${file_path}"
          external_receipt_count="${PRODUCTION_ACCEPTANCE_EXTERNAL_RECEIPT_COUNT:-1}"
          evidence_extra="${evidence_extra},\"externalReceiptsManifest\":$(production_acceptance_file_manifest_json "${temp_bundle}/external-receipts-manifest.json")"
          verify_args=(--require-timestamp-evidence)
          ;;
        clean-install)
          write_production_acceptance_install_evidence_manifest "${started_at}" "${temp_bundle}/install-evidence" "${temp_bundle}/install-evidence-manifest.json" "${file_path}"
          install_evidence_count="${PRODUCTION_ACCEPTANCE_INSTALL_EVIDENCE_COUNT:-1}"
          evidence_extra="${evidence_extra},\"installEvidenceManifest\":$(production_acceptance_file_manifest_json "${temp_bundle}/install-evidence-manifest.json")"
          verify_args=(--require-clean-install-evidence)
          ;;
        agent-runtime)
          write_production_acceptance_agent_evidence_manifest "${started_at}" "${temp_bundle}/agent-evidence" "${temp_bundle}/agent-evidence-manifest.json" "${file_path}"
          agent_evidence_count="${PRODUCTION_ACCEPTANCE_AGENT_EVIDENCE_COUNT:-1}"
          evidence_extra="${evidence_extra},\"agentEvidenceManifest\":$(production_acceptance_file_manifest_json "${temp_bundle}/agent-evidence-manifest.json")"
          verify_args=(--require-agent-evidence --require-agent-final-summary)
          ;;
      esac

      escaped_bundle_dir="$(json_escape_string "${temp_bundle}")"
      doctor_file_manifest="$(production_acceptance_file_manifest_json "${doctor_log}")"
      smoke_log_file_manifest="$(production_acceptance_file_manifest_json "${smoke_log}")"
      smoke_report_file_manifest="$(production_acceptance_file_manifest_json "${smoke_report}")"

      cat >"${manifest_path}" <<PREFLIGHT_MANIFEST_EOF
{"schemaVersion":"ou-ui-next.production-acceptance-bundle.v1","createdAt":"${started_at}","bundleDirectory":"${escaped_bundle_dir}","doctorStatus":0,"smokeStatus":0,"externalReceiptCount":${external_receipt_count},"installEvidenceCount":${install_evidence_count},"agentEvidenceCount":${agent_evidence_count},"doctorLog":"${doctor_log}","smokeLog":"${smoke_log}","smokeReport":"${smoke_report}","evidence":{"doctorLog":${doctor_file_manifest},"smokeLog":${smoke_log_file_manifest},"smokeReport":${smoke_report_file_manifest}${evidence_extra}}}
PREFLIGHT_MANIFEST_EOF

      verify_production_acceptance "${verify_args[@]}" "${temp_bundle}"
    } 2>&1
  )"; then
    verify_summary="$(printf '%s\n' "${verify_output}" | awk 'NF { sub(/^\[OU-UI Next\] /, ""); printf "%s%s", sep, $0; sep="; " } END { if (sep != "") printf "\n" }')"
    [[ -n "${verify_summary}" ]] || verify_summary="verifier 返回失败"
    fail "production-release-acceptance ${label}未通过预检：${verify_summary}"
  fi
}

require_production_release_acceptance_agent_evidence() {
  local source_path="$1" source_dir source_manifest source_runtime_summary

  [[ -n "${source_path}" ]] || fail "production-release-acceptance Agent 证据路径不能为空。"
  if [[ -d "${source_path}" ]]; then
    source_dir="${source_path%/}"
    source_manifest="${source_dir}/manifest.json"
  else
    source_manifest="${source_path}"
    source_dir="$(dirname -- "${source_manifest}")"
  fi
  source_runtime_summary="${source_dir}/runtime-summary.json"

  [[ -f "${source_manifest}" ]] || fail "production-release-acceptance Agent 证据 manifest 不存在或不是普通文件：${source_manifest}"
  [[ -r "${source_manifest}" ]] || fail "production-release-acceptance Agent 证据 manifest 不可读取：${source_manifest}"
  [[ -f "${source_runtime_summary}" ]] || fail "production-release-acceptance Agent 证据缺少 runtime-summary.json：${source_dir}"
  [[ -r "${source_runtime_summary}" ]] || fail "production-release-acceptance Agent runtime-summary.json 不可读取：${source_runtime_summary}"
  preflight_production_release_acceptance_evidence_content "agent-runtime" "${source_dir}"
}

validate_production_release_acceptance_args() {
  local arg has_archive_smoke=0 has_archive_provider_evidence=0 has_timestamp_evidence=0 has_clean_install_evidence=0 has_agent_evidence=0

  validate_final_production_acceptance_args "$@"

  while (($# > 0)); do
    arg="$1"
    case "${arg}" in
      --include-archive-smoke)
        has_archive_smoke=1
        shift
        ;;
      --archive-provider-evidence)
        has_archive_provider_evidence=1
        require_production_release_acceptance_file "${2:-}" "provider 侧不可变证据文件"
        preflight_production_release_acceptance_evidence_content "archive-provider" "${2:-}"
        shift 2
        ;;
      --timestamp-evidence)
        has_timestamp_evidence=1
        require_production_release_acceptance_file "${2:-}" "第三方时间戳证据文件"
        preflight_production_release_acceptance_evidence_content "timestamp" "${2:-}"
        shift 2
        ;;
      --install-evidence)
        has_clean_install_evidence=1
        require_production_release_acceptance_file "${2:-}" "干净服务器安装证据文件"
        preflight_production_release_acceptance_evidence_content "clean-install" "${2:-}"
        shift 2
        ;;
      --agent-evidence)
        has_agent_evidence=1
        require_production_release_acceptance_agent_evidence "${2:-}"
        shift 2
        ;;
      --timeout-ms|--telegram-admin-chat-id|--telegram-binding-id|--notification-language|--webhook-url|--webhook-urls|--webhook-bearer-token|--webhook-bearer-token-file|--external-receipt|--receipt-file)
        shift 2
        ;;
      --insecure-tls|--skip-csrf-probe|--require-runtime-evidence|--include-notification-smoke|--include-webhook-smoke|--allow-local-webhook|--webhook-allow-local|--require-archive-provider-evidence|--require-timestamp-evidence|--require-clean-install-evidence)
        shift
        ;;
      --)
        break
        ;;
      *)
        shift
        ;;
    esac
  done

  (( has_archive_smoke == 1 )) || fail "production-release-acceptance 要求真实外部归档烟测：请传入 --include-archive-smoke。"
  (( has_archive_provider_evidence == 1 )) || fail "production-release-acceptance 要求 provider 侧不可变证据：请传入 --archive-provider-evidence <path>。"
  (( has_timestamp_evidence == 1 )) || fail "production-release-acceptance 要求第三方时间戳证据：请传入 --timestamp-evidence <path>。"
  (( has_clean_install_evidence == 1 )) || fail "production-release-acceptance 要求干净服务器安装证据：请传入 --install-evidence <path>。"
  (( has_agent_evidence == 1 )) || fail "production-release-acceptance 要求 Agent 主机证据：请传入 --agent-evidence <bundle>。"
}

run_final_production_acceptance() {
  local acceptance_status final_summary_path final_verify_log manifest_path verify_status
  local archive_smoke_gate=false external_receipts_gate=false archive_provider_evidence_gate=false timestamp_evidence_gate=false clean_install_evidence_gate=false agent_evidence_gate=false agent_final_summary_gate=false
  local arg
  local -a final_verify_args

  validate_final_production_acceptance_args "$@"
  require_root

  PRODUCTION_ACCEPTANCE_LAST_BUNDLE_DIR=""

  acceptance_status=0
  run_production_acceptance --require-runtime-evidence --include-notification-smoke --include-webhook-smoke "$@" || acceptance_status=$?
  if (( acceptance_status != 0 )); then
    return "${acceptance_status}"
  fi

  if (( ${ACCEPTANCE_INCLUDE_ARCHIVE_SMOKE:-0} == 1 )); then
    archive_smoke_gate=true
  fi
  if (( ${#ACCEPTANCE_EXTERNAL_RECEIPT_FILES[@]} > 0 )); then
    external_receipts_gate=true
  fi
  if (( ${#ACCEPTANCE_ARCHIVE_PROVIDER_EVIDENCE_FILES[@]} > 0 )); then
    external_receipts_gate=true
    archive_provider_evidence_gate=true
  fi
  if (( ${#ACCEPTANCE_TIMESTAMP_EVIDENCE_FILES[@]} > 0 )); then
    external_receipts_gate=true
    timestamp_evidence_gate=true
  fi
  for arg in "$@"; do
    if [[ "${arg}" == "--require-archive-provider-evidence" ]]; then
      archive_provider_evidence_gate=true
    fi
    if [[ "${arg}" == "--require-timestamp-evidence" ]]; then
      timestamp_evidence_gate=true
    fi
    if [[ "${arg}" == "--require-clean-install-evidence" ]]; then
      clean_install_evidence_gate=true
    fi
  done
  if (( ${#ACCEPTANCE_INSTALL_EVIDENCE_FILES[@]} > 0 )); then
    clean_install_evidence_gate=true
  fi
  if (( ${#ACCEPTANCE_AGENT_EVIDENCE_PATHS[@]} > 0 )); then
    agent_evidence_gate=true
  fi
  if [[ "${PRODUCTION_ACCEPTANCE_REQUIRE_AGENT_FINAL_SUMMARY:-0}" == "1" ]]; then
    agent_final_summary_gate=true
  fi

  [[ -n "${PRODUCTION_ACCEPTANCE_LAST_BUNDLE_DIR:-}" ]] || fail "最终验收无法确认证据包路径。"
  manifest_path="${PRODUCTION_ACCEPTANCE_LAST_BUNDLE_DIR}/manifest.json"
  final_verify_log="${PRODUCTION_ACCEPTANCE_LAST_BUNDLE_DIR}/final-acceptance-verify.txt"
  final_summary_path="${PRODUCTION_ACCEPTANCE_LAST_BUNDLE_DIR}/final-acceptance-summary.json"

  final_verify_args=(
    --require-runtime-evidence \
    --require-browser-smoke \
    --require-notification-smoke \
    --require-webhook-smoke
  )
  if [[ "${archive_smoke_gate}" == "true" ]]; then
    final_verify_args+=(--require-archive-smoke)
  fi
  if [[ "${external_receipts_gate}" == "true" ]]; then
    final_verify_args+=(--require-external-receipts)
  fi
  if [[ "${archive_provider_evidence_gate}" == "true" ]]; then
    final_verify_args+=(--require-archive-provider-evidence)
  fi
  if [[ "${timestamp_evidence_gate}" == "true" ]]; then
    final_verify_args+=(--require-timestamp-evidence)
  fi
  if [[ "${clean_install_evidence_gate}" == "true" ]]; then
    final_verify_args+=(--require-clean-install-evidence)
  fi
  if [[ "${agent_evidence_gate}" == "true" ]]; then
    final_verify_args+=(--require-agent-evidence)
  fi
  if [[ "${agent_final_summary_gate}" == "true" ]]; then
    final_verify_args+=(--require-agent-final-summary)
  fi

  if verify_production_acceptance "${final_verify_args[@]}" "${PRODUCTION_ACCEPTANCE_LAST_BUNDLE_DIR}" >"${final_verify_log}" 2>&1; then
    chmod 600 "${final_verify_log}" 2>/dev/null || true
    write_final_acceptance_summary "${final_summary_path}" "passed" "${manifest_path}" "${final_verify_log}" "${archive_smoke_gate}" "${external_receipts_gate}" "${archive_provider_evidence_gate}" "${timestamp_evidence_gate}" "${clean_install_evidence_gate}" "${agent_evidence_gate}" "${agent_final_summary_gate}"
    cat "${final_verify_log}"
    printf '最终现场验收校验记录: %s\n' "${final_verify_log}"
    printf '最终现场验收摘要: %s\n' "${final_summary_path}"
  else
    verify_status=$?
    chmod 600 "${final_verify_log}" 2>/dev/null || true
    write_final_acceptance_summary "${final_summary_path}" "failed" "${manifest_path}" "${final_verify_log}" "${archive_smoke_gate}" "${external_receipts_gate}" "${archive_provider_evidence_gate}" "${timestamp_evidence_gate}" "${clean_install_evidence_gate}" "${agent_evidence_gate}" "${agent_final_summary_gate}"
    cat "${final_verify_log}" >&2 || true
    printf '[%s] 最终现场验收严格校验失败，校验记录已保存：%s\n' "${APP_NAME}" "${final_verify_log}" >&2
    printf '[%s] 最终现场验收摘要已保存：%s\n' "${APP_NAME}" "${final_summary_path}" >&2
    return "${verify_status}"
  fi
}

run_production_release_acceptance() {
  local release_status manifest_path final_summary_path release_verify_log release_summary_path

  validate_production_release_acceptance_args "$@"

  PRODUCTION_ACCEPTANCE_REQUIRE_AGENT_FINAL_SUMMARY=1 run_final_production_acceptance "$@" || return "$?"
  [[ -n "${PRODUCTION_ACCEPTANCE_LAST_BUNDLE_DIR:-}" ]] || fail "生产发布验收无法确认证据包路径。"
  manifest_path="${PRODUCTION_ACCEPTANCE_LAST_BUNDLE_DIR}/manifest.json"
  final_summary_path="${PRODUCTION_ACCEPTANCE_LAST_BUNDLE_DIR}/final-acceptance-summary.json"
  release_verify_log="${PRODUCTION_ACCEPTANCE_LAST_BUNDLE_DIR}/release-acceptance-verify.txt"
  release_summary_path="${PRODUCTION_ACCEPTANCE_LAST_BUNDLE_DIR}/release-acceptance-summary.json"

  if verify_production_release_acceptance_bundle "${PRODUCTION_ACCEPTANCE_LAST_BUNDLE_DIR}" >"${release_verify_log}" 2>&1; then
    chmod 600 "${release_verify_log}" 2>/dev/null || true
    write_release_acceptance_summary "${release_summary_path}" "passed" "${manifest_path}" "${final_summary_path}" "${release_verify_log}"
    cat "${release_verify_log}"
    printf '生产发布全量复核记录: %s\n' "${release_verify_log}"
    printf '生产发布验收摘要: %s\n' "${release_summary_path}"
    printf '生产发布全量复核通过: %s\n' "${PRODUCTION_ACCEPTANCE_LAST_BUNDLE_DIR}"
  else
    release_status=$?
    chmod 600 "${release_verify_log}" 2>/dev/null || true
    write_release_acceptance_summary "${release_summary_path}" "failed" "${manifest_path}" "${final_summary_path}" "${release_verify_log}"
    cat "${release_verify_log}" >&2 || true
    printf '[%s] 生产发布全量复核记录已保存：%s\n' "${APP_NAME}" "${release_verify_log}" >&2
    printf '[%s] 生产发布验收摘要已保存：%s\n' "${APP_NAME}" "${release_summary_path}" >&2
    printf '[%s] 生产发布全量复核失败：%s\n' "${APP_NAME}" "${PRODUCTION_ACCEPTANCE_LAST_BUNDLE_DIR}" >&2
    return "${release_status}"
  fi
}

read_backend_env_value() {
  local key="$1"

  if [[ -f "${BACKEND_ENV_FILE}" ]]; then
    awk -F= -v key="${key}" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "${BACKEND_ENV_FILE}"
  fi
}

read_credentials_env_value() {
  local key="$1"

  if [[ -f "${CREDENTIALS_FILE}" ]]; then
    awk -F= -v key="${key}" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "${CREDENTIALS_FILE}"
  fi
}

generate_cli_secret() {
  local length="$1"
  local raw=""
  raw="$(openssl rand -hex "${length}")"
  printf '%s' "${raw:0:length}"
}

generate_operator_password_hash() {
  local password="$1"

  printf '%s' "${password}" | node -e '
const { randomBytes, scryptSync } = require("node:crypto");
const chunks = [];
process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("end", () => {
  const password = Buffer.concat(chunks);
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 32);
  process.stdout.write(`scrypt:v1:${salt.toString("hex")}:${key.toString("hex")}`);
});
'
}

write_operator_credentials() {
  local username="$1"
  local password="$2"

  mkdir -p "${CONFIG_DIR}"
  cat >"${CREDENTIALS_FILE}" <<CREDENTIALS_EOF
OU_UI_CONTROL_PLANE_OPERATOR_USERNAME=${username}
OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD=${password}
CREDENTIALS_EOF
  chmod 600 "${CREDENTIALS_FILE}"
}

should_preserve_backend_operator_password_for_legacy_update() {
  [[ "${OU_UI_NEXT_CLI_UPDATE_FROM_TEMP:-0}" == "1" ]] || return 1
  [[ -n "${OU_UI_NEXT_CLI_UPDATE_TEMP_PATH:-}" && -f "${OU_UI_NEXT_CLI_UPDATE_TEMP_PATH}" ]] || return 1
  ! grep -q 'read_credentials_env_value' "${OU_UI_NEXT_CLI_UPDATE_TEMP_PATH}"
}

write_operator_login_payload() {
  local username="$1"
  local password="$2"

  OU_UI_LOGIN_USERNAME="${username}" OU_UI_LOGIN_PASSWORD="${password}" node <<'NODE'
process.stdout.write(JSON.stringify({
  username: process.env.OU_UI_LOGIN_USERNAME ?? '',
  password: process.env.OU_UI_LOGIN_PASSWORD ?? ''
}));
NODE
}

create_panel_session_cookie_file() {
  local base_url username password cookie_file response status body csrf_token attempt
  base_url="$(panel_url)"
  username="$(read_backend_env_value OU_UI_CONTROL_PLANE_OPERATOR_USERNAME)"
  password="$(read_credentials_env_value OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD)"
  username="${username:-$(read_credentials_env_value OU_UI_CONTROL_PLANE_OPERATOR_USERNAME)}"
  password="${password:-$(read_backend_env_value OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD)}"
  username="${username:-$(read_frontend_env_value VITE_CONTROL_PLANE_LOGIN_USERNAME)}"
  password="${password:-$(read_frontend_env_value VITE_CONTROL_PLANE_LOGIN_PASSWORD)}"

  [[ -n "${base_url}" && "${base_url}" != "暂不可用" ]] || fail "无法创建面板会话：面板地址不可用。"
  [[ -n "${username}" && -n "${password}" ]] || fail "无法创建面板会话：登录凭据不可用。"

  cookie_file="$(mktemp)"
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    response="$(
      write_operator_login_payload "${username}" "${password}" | curl -k -sS --max-time 15 \
        -c "${cookie_file}" \
        -w '\n%{http_code}' \
        -H 'Content-Type: application/json' \
        --data-binary @- \
        "${base_url%/}/api/v1/auth/session" 2>/dev/null || true
    )"
    status="$(printf '%s\n' "${response}" | tail -n 1)"
    body="$(printf '%s\n' "${response}" | sed '$d')"

    if [[ "${status}" == "201" ]]; then
      csrf_token="$(printf '%s\n' "${body}" | jq -er '.data.csrfToken // empty' 2>/dev/null || true)"
      if [[ -z "${csrf_token}" ]]; then
        rm -f "${cookie_file}" "${cookie_file}.csrf"
        fail "无法创建面板会话：登录响应缺少 CSRF token。请运行 ou d 查看诊断。"
      fi
      printf '%s' "${csrf_token}" >"${cookie_file}.csrf"
      printf '%s\n' "${cookie_file}"
      return
    fi

    case "${status:-000}" in
      000|502|503|504)
        sleep 1
        ;;
      *)
        rm -f "${cookie_file}" "${cookie_file}.csrf"
        fail "无法创建面板会话：HTTP ${status:-无响应}。请运行 ou d 查看诊断。"
        ;;
    esac
  done

  rm -f "${cookie_file}" "${cookie_file}.csrf"
  fail "无法创建面板会话：HTTP ${status:-无响应}。请运行 ou d 查看诊断。"
}

read_session_csrf_token() {
  local cookie_file="$1"
  local csrf_file="${cookie_file}.csrf"

  if [[ -s "${csrf_file}" ]]; then
    cat "${csrf_file}"
  fi
}

remove_session_cookie_file() {
  local cookie_file="$1"

  rm -f "${cookie_file}" "${cookie_file}.csrf"
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

remove_env_line() {
  local file="$1"
  local key="$2"

  [[ -f "${file}" ]] || return 0
  sed -i "/^${key}=.*/d" "${file}"
}

rotate_operator_credentials() {
  require_root

  local username password password_hash
  username="operator_$(generate_cli_secret 8)"
  password="$(generate_cli_secret 22)"
  password_hash="$(generate_operator_password_hash "${password}")"

  write_operator_credentials "${username}" "${password}"
  set_env_line "${BACKEND_ENV_FILE}" OU_UI_CONTROL_PLANE_OPERATOR_USERNAME "${username}"
  set_env_line "${BACKEND_ENV_FILE}" OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD_HASH "${password_hash}"
  remove_env_line "${BACKEND_ENV_FILE}" OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD
  set_env_line "${BACKEND_ENV_FILE}" OU_UI_CONTROL_PLANE_OPERATOR_SESSION_SECRET "$(generate_cli_secret 64)"
  set_env_line "${BACKEND_ENV_FILE}" OU_UI_CONTROL_PLANE_OPERATOR_ACTOR "${username}"
  ensure_env_line "${BACKEND_ENV_FILE}" OU_UI_CONTROL_PLANE_OPERATOR_SESSION_TTL_MS 28800000
  ensure_env_line "${BACKEND_ENV_FILE}" OU_UI_CONTROL_PLANE_OPERATOR_GROUP_ID owner
  ensure_env_line "${BACKEND_ENV_FILE}" OU_UI_CONTROL_PLANE_RESOURCE_GROUP_ID group-premium
  remove_env_line "${APP_DIR}/.env.production.local" VITE_CONTROL_PLANE_LOGIN_USERNAME
  remove_env_line "${APP_DIR}/.env.production.local" VITE_CONTROL_PLANE_LOGIN_PASSWORD
  remove_env_line "${APP_DIR}/.env.production.local" VITE_CONTROL_PLANE_OPERATOR_TOKEN

  systemctl restart "${SERVICE_NAME}"
  refresh_nginx_panel_config
  check_panel_surface
  log "操作员登录凭据已轮换，旧浏览器会话已失效。"
  show_credentials
}

ensure_runtime_env_defaults() {
  require_root

  local username password password_hash state_file sqlite_file
  username="$(read_backend_env_value OU_UI_CONTROL_PLANE_OPERATOR_USERNAME)"
  username="${username:-$(read_credentials_env_value OU_UI_CONTROL_PLANE_OPERATOR_USERNAME)}"
  username="${username:-$(read_frontend_env_value VITE_CONTROL_PLANE_LOGIN_USERNAME)}"
  username="${username:-operator}"
  password="$(read_credentials_env_value OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD)"
  password="${password:-$(read_backend_env_value OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD)}"
  password="${password:-$(read_frontend_env_value VITE_CONTROL_PLANE_LOGIN_PASSWORD)}"
  password_hash="$(read_backend_env_value OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD_HASH)"
  if [[ -n "${password}" ]]; then
    password_hash="$(generate_operator_password_hash "${password}")"
    write_operator_credentials "${username}" "${password}"
  elif [[ -z "${password_hash}" ]]; then
    password="local-password"
    password_hash="$(generate_operator_password_hash "${password}")"
    write_operator_credentials "${username}" "${password}"
  fi
  state_file="$(read_backend_env_value OU_UI_CONTROL_PLANE_STATE_FILE)"
  state_file="${state_file:-${STATE_DIR}/control-plane-state.json}"
  sqlite_file="$(read_backend_env_value OU_UI_CONTROL_PLANE_SQLITE_FILE)"
  sqlite_file="${sqlite_file:-${STATE_DIR}/control-plane.sqlite}"

  remove_env_line "${APP_DIR}/.env.production.local" VITE_CONTROL_PLANE_OPERATOR_TOKEN
  remove_env_line "${APP_DIR}/.env.production.local" VITE_CONTROL_PLANE_LOGIN_USERNAME
  remove_env_line "${APP_DIR}/.env.production.local" VITE_CONTROL_PLANE_LOGIN_PASSWORD
  ensure_env_line "${APP_DIR}/.env.production.local" VITE_CONTROL_PLANE_OPERATOR_GROUP_ID owner
  ensure_env_line "${APP_DIR}/.env.production.local" VITE_CONTROL_PLANE_RESOURCE_GROUP_ID group-premium
  ensure_env_line "${BACKEND_ENV_FILE}" OU_UI_CONTROL_PLANE_HOST "${BACKEND_HOST_DEFAULT}"
  ensure_env_line "${BACKEND_ENV_FILE}" OU_UI_CONTROL_PLANE_PORT "${BACKEND_PORT_DEFAULT}"
  ensure_env_line "${BACKEND_ENV_FILE}" OU_UI_CONTROL_PLANE_OPERATOR_USERNAME "${username}"
  set_env_line "${BACKEND_ENV_FILE}" OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD_HASH "${password_hash}"
  if [[ -n "${password}" ]] && should_preserve_backend_operator_password_for_legacy_update; then
    ensure_env_line "${BACKEND_ENV_FILE}" OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD "${password}"
  else
    remove_env_line "${BACKEND_ENV_FILE}" OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD
  fi
  ensure_env_line "${BACKEND_ENV_FILE}" OU_UI_CONTROL_PLANE_OPERATOR_SESSION_SECRET "$(generate_cli_secret 64)"
  ensure_env_line "${BACKEND_ENV_FILE}" OU_UI_CONTROL_PLANE_OPERATOR_SESSION_TTL_MS 28800000
  ensure_env_line "${BACKEND_ENV_FILE}" OU_UI_CONTROL_PLANE_OPERATOR_ACTOR "${username}"
  ensure_env_line "${BACKEND_ENV_FILE}" OU_UI_CONTROL_PLANE_OPERATOR_GROUP_ID owner
  ensure_env_line "${BACKEND_ENV_FILE}" OU_UI_CONTROL_PLANE_RESOURCE_GROUP_ID group-premium
  ensure_env_line "${BACKEND_ENV_FILE}" OU_UI_CONTROL_PLANE_INITIAL_STATE empty
  set_env_line "${BACKEND_ENV_FILE}" OU_UI_CONTROL_PLANE_STORAGE sqlite
  set_env_line "${BACKEND_ENV_FILE}" OU_UI_CONTROL_PLANE_SQLITE_FILE "${sqlite_file}"
  ensure_env_line "${BACKEND_ENV_FILE}" OU_UI_AGENT_LOG_RETENTION_DAYS 7
  ensure_env_line "${BACKEND_ENV_FILE}" OU_UI_AGENT_LOG_MAX_EVENTS_PER_AGENT 5000
  ensure_env_line "${BACKEND_ENV_FILE}" OU_UI_EXTERNAL_ARCHIVE_DIRECTORY "${STATE_DIR}/external-archives"
  ensure_env_line "${BACKEND_ENV_FILE}" OU_UI_COMMAND_TIMEOUT_SWEEP_ENABLED true
  ensure_env_line "${BACKEND_ENV_FILE}" OU_UI_COMMAND_TIMEOUT_SWEEP_INTERVAL_MS 30000
  ensure_env_line "${BACKEND_ENV_FILE}" OU_UI_COMMAND_ACK_TIMEOUT_MS 15000
  ensure_env_line "${BACKEND_ENV_FILE}" OU_UI_COMMAND_RESULT_TIMEOUT_MS 120000
  ensure_env_line "${BACKEND_ENV_FILE}" OU_UI_COMMAND_TIMEOUT_SWEEP_MAX_COMMANDS 500
  ensure_env_line "${BACKEND_ENV_FILE}" OU_UI_SUBSCRIPTION_SOURCE_EGRESS_ALLOWLIST ""
  if [[ -f "${state_file}" ]]; then
    set_env_line "${BACKEND_ENV_FILE}" OU_UI_CONTROL_PLANE_LEGACY_STATE_FILE "${state_file}"
  else
    remove_env_line "${BACKEND_ENV_FILE}" OU_UI_CONTROL_PLANE_LEGACY_STATE_FILE
  fi
  chmod 600 "${BACKEND_ENV_FILE}"
}

ensure_runtime_filesystem_permissions() {
  require_root

  local archive_directory npm_cache state_file runtime_path
  archive_directory="$(read_backend_env_value OU_UI_EXTERNAL_ARCHIVE_DIRECTORY)"
  npm_cache="${STATE_DIR}/npm-cache"
  state_file="$(control_plane_state_file)"

  mkdir -p "${STATE_DIR}" "${npm_cache}"
  if [[ -n "${archive_directory}" ]]; then
    mkdir -p "${archive_directory}"
  fi

  chown "${SERVICE_USER}:${SERVICE_USER}" "${STATE_DIR}" "${npm_cache}" 2>/dev/null || true
  chmod 700 "${STATE_DIR}" "${npm_cache}" 2>/dev/null || true

  if [[ -n "${archive_directory}" ]]; then
    chown "${SERVICE_USER}:${SERVICE_USER}" "${archive_directory}" 2>/dev/null || true
    chmod 700 "${archive_directory}" 2>/dev/null || true
  fi

  for runtime_path in "${state_file}" "${state_file}-wal" "${state_file}-shm"; do
    if [[ -e "${runtime_path}" ]]; then
      chown "${SERVICE_USER}:${SERVICE_USER}" "${runtime_path}" 2>/dev/null || true
      chmod 600 "${runtime_path}" 2>/dev/null || true
    fi
  done

  [[ -f "${BACKEND_ENV_FILE}" ]] && chmod 600 "${BACKEND_ENV_FILE}" 2>/dev/null || true
  [[ -f "${CREDENTIALS_FILE}" ]] && chmod 600 "${CREDENTIALS_FILE}" 2>/dev/null || true
}

control_plane_storage_mode() {
  local storage_mode
  storage_mode="$(read_backend_env_value OU_UI_CONTROL_PLANE_STORAGE)"
  echo "${storage_mode:-sqlite}"
}

control_plane_state_file() {
  local state_file storage_mode
  storage_mode="$(control_plane_storage_mode)"

  if [[ "${storage_mode}" == "sqlite" ]]; then
    state_file="$(read_backend_env_value OU_UI_CONTROL_PLANE_SQLITE_FILE)"
    echo "${state_file:-${STATE_DIR}/control-plane.sqlite}"
    return
  fi

  state_file="$(read_backend_env_value OU_UI_CONTROL_PLANE_STATE_FILE)"
  echo "${state_file:-${STATE_DIR}/control-plane-state.json}"
}

control_plane_legacy_state_file() {
  local state_file
  state_file="$(read_backend_env_value OU_UI_CONTROL_PLANE_LEGACY_STATE_FILE)"
  if [[ -n "${state_file}" ]]; then
    echo "${state_file}"
  fi
}

count_csv_env_values() {
  local value="$1"
  local count=0
  local item
  local -a items=()

  IFS=',' read -ra items <<<"${value}"
  for item in "${items[@]}"; do
    item="${item#"${item%%[![:space:]]*}"}"
    item="${item%"${item##*[![:space:]]}"}"
    [[ -n "${item}" ]] && count=$((count + 1))
  done

  echo "${count}"
}

external_archive_url_has_unsupported_parts() {
  local url="$1"
  local authority

  [[ "${url}" == *"?"* || "${url}" == *"#"* ]] && return 0
  [[ "${url}" == *"://"* ]] || return 1
  authority="${url#*://}"
  authority="${authority%%/*}"
  [[ "${authority}" == *"@"* ]]
}

external_archive_url_hostname() {
  local url="$1"

  printf '%s' "${url}" |
    sed -E 's#^[A-Za-z][A-Za-z0-9+.-]*://([^/@]+@)?(\[[^]]+\]|[^/:?#]+).*#\2#' |
    sed 's/^\[//; s/\]$//' |
    tr '[:upper:]' '[:lower:]'
}

external_archive_host_is_private_or_local() {
  local host="$1"

  [[ -n "${host}" ]] || return 1
  [[ "${host}" == "localhost" || "${host}" == *.localhost ]] && return 0
  [[ "${host}" =~ ^0\. ]] && return 0
  [[ "${host}" =~ ^10\. ]] && return 0
  [[ "${host}" =~ ^127\. ]] && return 0
  [[ "${host}" =~ ^169\.254\. ]] && return 0
  [[ "${host}" =~ ^172\.1[6-9]\. || "${host}" =~ ^172\.2[0-9]\. || "${host}" =~ ^172\.3[0-1]\. ]] && return 0
  [[ "${host}" =~ ^192\.168\. ]] && return 0
  [[ "${host}" =~ ^22[4-9]\. || "${host}" =~ ^23[0-9]\. ]] && return 0
  [[ "${host}" == "::1" || "${host}" == "0:0:0:0:0:0:0:1" ]] && return 0
  [[ "${host}" =~ ^fe80: || "${host}" =~ ^fc || "${host}" =~ ^fd || "${host}" =~ ^ff ]] && return 0
  return 1
}

append_missing_env_name() {
  local current="$1"
  local env_name="$2"

  if [[ -n "${current}" ]]; then
    printf '%s, %s' "${current}" "${env_name}"
  else
    printf '%s' "${env_name}"
  fi
}

show_systemd_service_health() {
  local unit_file missing_base missing_hardening

  unit_file="${SYSTEMD_SERVICE_FILE:-/etc/systemd/system/${SERVICE_NAME}.service}"
  if [[ ! -f "${unit_file}" ]]; then
    echo "  Systemd 服务单元: 未找到 ${unit_file}"
    return
  fi

  missing_base=""
  grep -qxF "User=${SERVICE_USER}" "${unit_file}" || missing_base="$(append_missing_env_name "${missing_base}" "User=${SERVICE_USER}")"
  grep -qxF "Group=${SERVICE_USER}" "${unit_file}" || missing_base="$(append_missing_env_name "${missing_base}" "Group=${SERVICE_USER}")"
  grep -qxF "WorkingDirectory=${APP_DIR}" "${unit_file}" || missing_base="$(append_missing_env_name "${missing_base}" "WorkingDirectory=${APP_DIR}")"
  grep -qxF "EnvironmentFile=${BACKEND_ENV_FILE}" "${unit_file}" || missing_base="$(append_missing_env_name "${missing_base}" "EnvironmentFile=${BACKEND_ENV_FILE}")"
  grep -qxF "Environment=NPM_CONFIG_CACHE=${STATE_DIR}/npm-cache" "${unit_file}" || missing_base="$(append_missing_env_name "${missing_base}" "NPM_CONFIG_CACHE")"
  grep -qxF "ExecStart=/usr/bin/env npm run start:control-plane" "${unit_file}" || missing_base="$(append_missing_env_name "${missing_base}" "ExecStart")"
  grep -qxF "Restart=always" "${unit_file}" || missing_base="$(append_missing_env_name "${missing_base}" "Restart=always")"

  if [[ -n "${missing_base}" ]]; then
    echo "  Systemd 服务单元: 配置不完整，缺少 ${missing_base}"
  else
    echo "  Systemd 服务单元: 基础配置完整"
  fi

  missing_hardening=""
  grep -qxF "UMask=0077" "${unit_file}" || missing_hardening="$(append_missing_env_name "${missing_hardening}" "UMask=0077")"
  grep -qxF "NoNewPrivileges=true" "${unit_file}" || missing_hardening="$(append_missing_env_name "${missing_hardening}" "NoNewPrivileges=true")"
  grep -qxF "PrivateTmp=true" "${unit_file}" || missing_hardening="$(append_missing_env_name "${missing_hardening}" "PrivateTmp=true")"
  grep -qxF "ProtectSystem=strict" "${unit_file}" || missing_hardening="$(append_missing_env_name "${missing_hardening}" "ProtectSystem=strict")"
  grep -qxF "ProtectHome=true" "${unit_file}" || missing_hardening="$(append_missing_env_name "${missing_hardening}" "ProtectHome=true")"
  grep -qxF "ReadWritePaths=${STATE_DIR} ${CONFIG_DIR}" "${unit_file}" || missing_hardening="$(append_missing_env_name "${missing_hardening}" "ReadWritePaths")"
  grep -qxF "CapabilityBoundingSet=" "${unit_file}" || missing_hardening="$(append_missing_env_name "${missing_hardening}" "CapabilityBoundingSet=")"
  grep -qxF "RestrictSUIDSGID=true" "${unit_file}" || missing_hardening="$(append_missing_env_name "${missing_hardening}" "RestrictSUIDSGID=true")"
  grep -qxF "LockPersonality=true" "${unit_file}" || missing_hardening="$(append_missing_env_name "${missing_hardening}" "LockPersonality=true")"

  if [[ -n "${missing_hardening}" ]]; then
    echo "  Systemd 服务加固: 配置不完整，缺少 ${missing_hardening}"
  else
    echo "  Systemd 服务加固: 已启用"
  fi
}

mode_has_group_or_world_bits() {
  local mode="$1"

  [[ "${mode}" =~ ^[0-7]+$ ]] || return 1
  (( (8#${mode} & 8#077) != 0 ))
}

mode_has_owner_write() {
  local mode="$1"

  [[ "${mode}" =~ ^[0-7]+$ ]] || return 1
  (( (8#${mode} & 8#200) != 0 ))
}

show_service_directory_permission_health() {
  local label="$1"
  local path="$2"
  local mode owner_group owner_user

  if [[ ! -d "${path}" ]]; then
    echo "  ${label}: 未创建 (${path})"
    return
  fi

  mode="$(stat -c '%a' "${path}" 2>/dev/null || true)"
  owner_group="$(stat -c '%U:%G' "${path}" 2>/dev/null || true)"
  owner_user="${owner_group%%:*}"

  if [[ "${owner_user}" != "${SERVICE_USER}" ]] || ! mode_has_owner_write "${mode}"; then
    echo "  ${label}: 服务用户可能不可写 owner=${owner_group:-无法确认} mode=${mode:-无法确认} (${path})"
    return
  fi

  if mode_has_group_or_world_bits "${mode}"; then
    echo "  ${label}: 可写但权限过宽 owner=${owner_group} mode=${mode}，建议 chmod 700"
    return
  fi

  echo "  ${label}: 可写且权限收敛 owner=${owner_group} mode=${mode}"
}

show_sensitive_file_permission_health() {
  local label="$1"
  local path="$2"
  local mode owner_group

  if [[ ! -f "${path}" ]]; then
    echo "  ${label}: 未找到 (${path})"
    return
  fi

  mode="$(stat -c '%a' "${path}" 2>/dev/null || true)"
  owner_group="$(stat -c '%U:%G' "${path}" 2>/dev/null || true)"

  if mode_has_group_or_world_bits "${mode}"; then
    echo "  ${label}: 权限过宽 owner=${owner_group:-无法确认} mode=${mode:-无法确认}，建议 chmod 600"
    return
  fi

  echo "  ${label}: 权限已收敛 owner=${owner_group:-无法确认} mode=${mode:-无法确认}"
}

show_service_file_permission_health() {
  local label="$1"
  local path="$2"
  local mode owner_group owner_user

  if [[ ! -f "${path}" ]]; then
    echo "  ${label}: 尚未生成 (${path})"
    return
  fi

  mode="$(stat -c '%a' "${path}" 2>/dev/null || true)"
  owner_group="$(stat -c '%U:%G' "${path}" 2>/dev/null || true)"
  owner_user="${owner_group%%:*}"

  if [[ "${owner_user}" != "${SERVICE_USER}" ]] || ! mode_has_owner_write "${mode}"; then
    echo "  ${label}: 服务用户可能不可写 owner=${owner_group:-无法确认} mode=${mode:-无法确认} (${path})"
    return
  fi

  if mode_has_group_or_world_bits "${mode}"; then
    echo "  ${label}: 权限过宽 owner=${owner_group} mode=${mode}，建议 chmod 600"
    return
  fi

  echo "  ${label}: 权限收敛 owner=${owner_group} mode=${mode}"
}

show_runtime_filesystem_health() {
  local state_file archive_directory npm_cache

  state_file="$(control_plane_state_file)"
  archive_directory="$(read_backend_env_value OU_UI_EXTERNAL_ARCHIVE_DIRECTORY)"
  npm_cache="${STATE_DIR}/npm-cache"

  if id -u "${SERVICE_USER}" >/dev/null 2>&1; then
    echo "  服务用户账号: 存在 (${SERVICE_USER})"
  else
    echo "  服务用户账号: 不存在 (${SERVICE_USER}，systemd 服务会启动失败)"
  fi

  show_service_directory_permission_health "状态目录" "${STATE_DIR}"
  show_service_directory_permission_health "npm cache 目录" "${npm_cache}"
  if [[ -n "${archive_directory}" ]]; then
    show_service_directory_permission_health "外部归档目录" "${archive_directory}"
  fi
  show_service_file_permission_health "控制面存储文件" "${state_file}"
  if [[ "${state_file}" == *.sqlite ]]; then
    [[ -f "${state_file}-wal" ]] && show_service_file_permission_health "SQLite WAL 文件" "${state_file}-wal"
    [[ -f "${state_file}-shm" ]] && show_service_file_permission_health "SQLite SHM 文件" "${state_file}-shm"
  fi
  show_sensitive_file_permission_health "后端环境文件" "${BACKEND_ENV_FILE}"
  show_sensitive_file_permission_health "root-only 凭据文件" "${CREDENTIALS_FILE}"
}

show_external_archive_webhook_target_health() {
  local target_label="$1"
  local url="$2"
  local host

  [[ -n "${url}" ]] || return 0

  if [[ ! "${url}" =~ ^https?:// ]]; then
    echo "  外部归档 webhook: ${target_label} 不是 http/https URL，后端会拒绝启动"
    return
  fi

  host="$(external_archive_url_hostname "${url}")"
  if [[ -z "${host}" || "${host}" == *"://"* ]]; then
    echo "  外部归档 webhook: ${target_label} host 无法解析，后端会拒绝启动"
    return
  fi

  if external_archive_host_is_private_or_local "${host}"; then
    echo "  外部归档 webhook: ${target_label} host=${host} 属于本机/私网/保留地址，投递时会被拦截"
    return
  fi

  echo "  外部归档 webhook ${target_label}: host=${host}"
}

show_external_archive_health() {
  local archive_directory webhook_url webhook_urls webhook_count webhook_extra_count webhook_allowlist webhook_bearer_token webhook_timeout
  local object_endpoint object_bucket object_region object_access_key object_secret_key object_session_token object_prefix object_timeout object_force_path_style object_allowlist object_lock_mode object_lock_days object_lock_legal_hold
  local object_input_count object_missing object_host index item
  local -a webhook_items=()
  local -a webhook_items_extra=()

  archive_directory="$(read_backend_env_value OU_UI_EXTERNAL_ARCHIVE_DIRECTORY)"
  webhook_url="$(read_backend_env_value OU_UI_EXTERNAL_ARCHIVE_WEBHOOK_URL)"
  webhook_urls="$(read_backend_env_value OU_UI_EXTERNAL_ARCHIVE_WEBHOOK_URLS)"
  webhook_allowlist="$(read_backend_env_value OU_UI_EXTERNAL_ARCHIVE_WEBHOOK_EGRESS_ALLOWLIST)"
  webhook_bearer_token="$(read_backend_env_value OU_UI_EXTERNAL_ARCHIVE_WEBHOOK_BEARER_TOKEN)"
  webhook_timeout="$(read_backend_env_value OU_UI_EXTERNAL_ARCHIVE_WEBHOOK_TIMEOUT_MS)"
  object_endpoint="$(read_backend_env_value OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_ENDPOINT)"
  object_bucket="$(read_backend_env_value OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_BUCKET)"
  object_region="$(read_backend_env_value OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_REGION)"
  object_access_key="$(read_backend_env_value OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_ACCESS_KEY_ID)"
  object_secret_key="$(read_backend_env_value OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_SECRET_ACCESS_KEY)"
  object_session_token="$(read_backend_env_value OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_SESSION_TOKEN)"
  object_prefix="$(read_backend_env_value OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_PREFIX)"
  object_timeout="$(read_backend_env_value OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_TIMEOUT_MS)"
  object_force_path_style="$(read_backend_env_value OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_FORCE_PATH_STYLE)"
  object_allowlist="$(read_backend_env_value OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_EGRESS_ALLOWLIST)"
  object_lock_mode="$(read_backend_env_value OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_OBJECT_LOCK_MODE)"
  object_lock_days="$(read_backend_env_value OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_OBJECT_LOCK_RETENTION_DAYS)"
  object_lock_legal_hold="$(read_backend_env_value OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_OBJECT_LOCK_LEGAL_HOLD)"

  if [[ -n "${archive_directory}" ]]; then
    echo "  外部归档目录: 已配置 (${archive_directory})"
  else
    echo "  外部归档目录: 未配置"
  fi

  webhook_count=0
  [[ -n "${webhook_url}" ]] && webhook_count=1
  webhook_extra_count="$(count_csv_env_values "${webhook_urls}")"
  webhook_count=$((webhook_count + webhook_extra_count))
  if (( webhook_count > 0 )); then
    echo "  外部归档 webhook: 已配置 ${webhook_count} 个目标"
    [[ -n "${webhook_allowlist}" ]] && echo "  外部归档 webhook allowlist: ${webhook_allowlist}"
    [[ -n "${webhook_bearer_token}" ]] && echo "  外部归档 webhook bearer: 已配置"
    show_positive_integer_config_health "外部归档 webhook timeout" "${webhook_timeout}" "ms"

    [[ -n "${webhook_url}" ]] && webhook_items+=("${webhook_url}")
    IFS=',' read -ra webhook_items_extra <<<"${webhook_urls}"
    for item in "${webhook_items_extra[@]}"; do
      item="${item#"${item%%[![:space:]]*}"}"
      item="${item%"${item##*[![:space:]]}"}"
      [[ -n "${item}" ]] && webhook_items+=("${item}")
    done

    index=1
    for item in "${webhook_items[@]}"; do
      show_external_archive_webhook_target_health "target-${index}" "${item}"
      index=$((index + 1))
    done
  else
    echo "  外部归档 webhook: 未配置"
  fi

  object_input_count=0
  for value in "${object_endpoint}" "${object_bucket}" "${object_region}" "${object_access_key}" "${object_secret_key}" "${object_session_token}" "${object_prefix}" "${object_timeout}" "${object_force_path_style}" "${object_allowlist}" "${object_lock_mode}" "${object_lock_days}" "${object_lock_legal_hold}"; do
    [[ -n "${value}" ]] && object_input_count=$((object_input_count + 1))
  done

  if (( object_input_count == 0 )); then
    echo "  外部归档对象存储: 未配置"
    return
  fi

  object_missing=""
  [[ -z "${object_endpoint}" ]] && object_missing="$(append_missing_env_name "${object_missing}" OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_ENDPOINT)"
  [[ -z "${object_bucket}" ]] && object_missing="$(append_missing_env_name "${object_missing}" OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_BUCKET)"
  [[ -z "${object_region}" ]] && object_missing="$(append_missing_env_name "${object_missing}" OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_REGION)"
  [[ -z "${object_access_key}" ]] && object_missing="$(append_missing_env_name "${object_missing}" OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_ACCESS_KEY_ID)"
  [[ -z "${object_secret_key}" ]] && object_missing="$(append_missing_env_name "${object_missing}" OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_SECRET_ACCESS_KEY)"

  if [[ -n "${object_missing}" ]]; then
    echo "  外部归档对象存储: 配置不完整，缺少 ${object_missing}"
    return
  fi

  if [[ ! "${object_endpoint}" =~ ^https?:// ]]; then
    echo "  外部归档对象存储: endpoint 不是 http/https URL，后端会拒绝启动"
    return
  fi

  if external_archive_url_has_unsupported_parts "${object_endpoint}"; then
    echo "  外部归档对象存储: endpoint 含 credentials、query 或 fragment，后端会拒绝启动"
    return
  fi

  object_host="$(external_archive_url_hostname "${object_endpoint}")"
  if [[ -z "${object_host}" || "${object_host}" == *"://"* ]]; then
    echo "  外部归档对象存储: endpoint host 无法解析，后端会拒绝启动"
    return
  fi

  if external_archive_host_is_private_or_local "${object_host}"; then
    echo "  外部归档对象存储: endpoint host=${object_host} 属于本机/私网/保留地址，后端会拒绝远端投递"
    return
  fi

  show_positive_integer_config_health "外部归档对象存储 timeout" "${object_timeout}" "ms"
  show_boolean_config_health "外部归档对象存储 forcePathStyle" "${object_force_path_style}"
  if [[ -n "${object_lock_mode}" || -n "${object_lock_days}" ]]; then
    if [[ -z "${object_lock_mode}" || -z "${object_lock_days}" ]]; then
      echo "  外部归档对象存储 Object Lock: mode 与 retentionDays 必须同时配置；后端会拒绝启动"
    else
      case "${object_lock_mode^^}" in
        GOVERNANCE|COMPLIANCE)
          echo "  外部归档对象存储 Object Lock mode: ${object_lock_mode^^}"
          ;;
        *)
          echo "  外部归档对象存储 Object Lock mode: ${object_lock_mode}（无效，必须是 GOVERNANCE 或 COMPLIANCE；后端会拒绝启动）"
          ;;
      esac
      show_positive_integer_config_health "外部归档对象存储 Object Lock retentionDays" "${object_lock_days}"
    fi
  fi
  show_boolean_config_health "外部归档对象存储 Object Lock legalHold" "${object_lock_legal_hold}"
  echo "  外部归档对象存储: 已配置 endpointHost=${object_host} bucket=${object_bucket} region=${object_region} pathStyle=${object_force_path_style:-true}"
  [[ -n "${object_prefix}" ]] && echo "  外部归档对象存储 prefix: ${object_prefix}"
  [[ -n "${object_allowlist}" ]] && echo "  外部归档对象存储 allowlist: ${object_allowlist}"
  return 0
}

show_system_alert_webhook_target_health() {
  local target_label="$1"
  local url="$2"
  local host

  [[ -n "${url}" ]] || return 0

  if [[ ! "${url}" =~ ^https?:// ]]; then
    echo "  系统告警 webhook: ${target_label} 不是 http/https URL，后端会拒绝启动"
    return
  fi

  host="$(external_archive_url_hostname "${url}")"
  if [[ -z "${host}" || "${host}" == *"://"* ]]; then
    echo "  系统告警 webhook: ${target_label} host 无法解析，后端会拒绝启动"
    return
  fi

  if external_archive_host_is_private_or_local "${host}"; then
    echo "  系统告警 webhook: ${target_label} host=${host} 属于本机/私网/保留地址，投递时会被拦截"
    return
  fi

  echo "  系统告警 webhook ${target_label}: host=${host}"
}

show_positive_integer_config_health() {
  local label="$1"
  local value="$2"
  local suffix="${3:-}"

  [[ -n "${value}" ]] || return 0

  if [[ "${value}" =~ ^[1-9][0-9]*$ ]]; then
    echo "  ${label}: ${value}${suffix}"
  else
    echo "  ${label}: ${value}（无效，必须是正整数；后端会拒绝启动）"
  fi
}

show_positive_number_config_health() {
  local label="$1"
  local value="$2"
  local suffix="${3:-}"

  [[ -n "${value}" ]] || return 0

  if [[ "${value}" =~ ^[+]?(([0-9]+([.][0-9]*)?)|([.][0-9]+))([eE][+-]?[0-9]+)?$ ]] &&
    awk -v candidate="${value}" 'BEGIN { exit !(candidate + 0 > 0) }'; then
    echo "  ${label}: ${value}${suffix}"
  else
    echo "  ${label}: ${value}（无效，必须是正数；后端会拒绝启动）"
  fi
}

show_non_negative_integer_config_health() {
  local label="$1"
  local value="$2"
  local suffix="${3:-}"

  [[ -n "${value}" ]] || return 0

  if [[ "${value}" =~ ^[0-9]+$ ]]; then
    echo "  ${label}: ${value}${suffix}"
  else
    echo "  ${label}: ${value}（无效，必须是非负整数；后端会拒绝启动）"
  fi
}

show_boolean_config_health() {
  local label="$1"
  local value="$2"
  local normalized

  [[ -n "${value}" ]] || return 0

  normalized="$(printf '%s' "${value}" | tr '[:upper:]' '[:lower:]')"
  case "${normalized}" in
    1|true|yes|on|0|false|no|off)
      echo "  ${label}: ${value}"
      ;;
    *)
      echo "  ${label}: ${value}（无效，必须是 true/false/1/0/yes/no/on/off；后端会拒绝启动）"
      ;;
  esac
}

show_agent_log_retention_health() {
  local retention_days max_events_per_agent

  retention_days="$(read_backend_env_value OU_UI_AGENT_LOG_RETENTION_DAYS)"
  max_events_per_agent="$(read_backend_env_value OU_UI_AGENT_LOG_MAX_EVENTS_PER_AGENT)"

  if [[ -n "${retention_days}" ]]; then
    show_positive_number_config_health "Agent 日志留存天数" "${retention_days}" " 天"
  else
    echo "  Agent 日志留存天数: 默认 7 天"
  fi

  if [[ -n "${max_events_per_agent}" ]]; then
    show_non_negative_integer_config_health "Agent 日志每台 Agent 最大事件数" "${max_events_per_agent}"
  else
    echo "  Agent 日志每台 Agent 最大事件数: 默认 5000"
  fi
}

show_traffic_rollup_retention_health() {
  local retention_days max_records_per_scope

  retention_days="$(read_backend_env_value OU_UI_TRAFFIC_ROLLUP_RETENTION_DAYS)"
  max_records_per_scope="$(read_backend_env_value OU_UI_TRAFFIC_ROLLUP_MAX_RECORDS_PER_SCOPE)"

  if [[ -n "${retention_days}" ]]; then
    show_positive_number_config_health "流量历史留存天数" "${retention_days}" " 天"
  else
    echo "  流量历史留存天数: 默认 62 天"
  fi

  if [[ -n "${max_records_per_scope}" ]]; then
    show_non_negative_integer_config_health "流量历史每个 scope 最大记录数" "${max_records_per_scope}"
  else
    echo "  流量历史每个 scope 最大记录数: 默认 200000"
  fi
}

show_command_timeout_sweep_health() {
  local enabled interval_ms ack_timeout_ms result_timeout_ms max_commands

  enabled="$(read_backend_env_value OU_UI_COMMAND_TIMEOUT_SWEEP_ENABLED)"
  interval_ms="$(read_backend_env_value OU_UI_COMMAND_TIMEOUT_SWEEP_INTERVAL_MS)"
  ack_timeout_ms="$(read_backend_env_value OU_UI_COMMAND_ACK_TIMEOUT_MS)"
  result_timeout_ms="$(read_backend_env_value OU_UI_COMMAND_RESULT_TIMEOUT_MS)"
  max_commands="$(read_backend_env_value OU_UI_COMMAND_TIMEOUT_SWEEP_MAX_COMMANDS)"

  if [[ -n "${enabled}" ]]; then
    show_boolean_config_health "Agent 命令超时扫描" "${enabled}"
  else
    echo "  Agent 命令超时扫描: 默认启用"
  fi

  if [[ -n "${interval_ms}" ]]; then
    show_positive_integer_config_health "Agent 命令超时扫描间隔" "${interval_ms}" "ms"
  else
    echo "  Agent 命令超时扫描间隔: 默认 30000ms"
  fi

  if [[ -n "${ack_timeout_ms}" ]]; then
    show_positive_integer_config_health "Agent 命令 ACK 超时" "${ack_timeout_ms}" "ms"
  else
    echo "  Agent 命令 ACK 超时: 默认 15000ms"
  fi

  if [[ -n "${result_timeout_ms}" ]]; then
    show_positive_integer_config_health "Agent 命令 result 超时" "${result_timeout_ms}" "ms"
  else
    echo "  Agent 命令 result 超时: 默认 120000ms"
  fi

  if [[ -n "${max_commands}" ]]; then
    show_positive_integer_config_health "Agent 命令超时扫描每轮上限" "${max_commands}"
  else
    echo "  Agent 命令超时扫描每轮上限: 默认 500"
  fi
}

show_operator_auth_throttle_health() {
  local window_ms max_failures

  window_ms="$(read_backend_env_value OU_UI_CONTROL_PLANE_OPERATOR_AUTH_FAILURE_WINDOW_MS)"
  max_failures="$(read_backend_env_value OU_UI_CONTROL_PLANE_OPERATOR_AUTH_FAILURE_LIMIT)"

  if [[ -n "${window_ms}" ]]; then
    show_positive_integer_config_health "Operator 登录失败限流窗口" "${window_ms}" "ms"
  else
    echo "  Operator 登录失败限流窗口: 默认 60000ms"
  fi

  if [[ -n "${max_failures}" ]]; then
    show_positive_integer_config_health "Operator 登录失败限流阈值" "${max_failures}"
  else
    echo "  Operator 登录失败限流阈值: 默认 20"
  fi
}

show_operator_session_health() {
  local username password_plain password_hash session_secret ttl_ms has_session_input missing

  username="$(read_backend_env_value OU_UI_CONTROL_PLANE_OPERATOR_USERNAME)"
  password_plain="$(read_backend_env_value OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD)"
  password_hash="$(read_backend_env_value OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD_HASH)"
  session_secret="$(read_backend_env_value OU_UI_CONTROL_PLANE_OPERATOR_SESSION_SECRET)"
  ttl_ms="$(read_backend_env_value OU_UI_CONTROL_PLANE_OPERATOR_SESSION_TTL_MS)"

  has_session_input=0
  for value in "${username}" "${password_plain}" "${password_hash}" "${session_secret}" "${ttl_ms}"; do
    [[ -n "${value}" ]] && has_session_input=1
  done

  if (( has_session_input == 0 )); then
    echo "  Operator session: 未配置"
    return
  fi

  missing=""
  [[ -z "${username}" ]] && missing="$(append_missing_env_name "${missing}" OU_UI_CONTROL_PLANE_OPERATOR_USERNAME)"
  if [[ -z "${password_plain}" && -z "${password_hash}" ]]; then
    missing="$(append_missing_env_name "${missing}" OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD/OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD_HASH)"
  fi
  [[ -z "${session_secret}" ]] && missing="$(append_missing_env_name "${missing}" OU_UI_CONTROL_PLANE_OPERATOR_SESSION_SECRET)"

  if [[ -n "${missing}" ]]; then
    echo "  Operator session: 配置不完整，缺少 ${missing}（后端会拒绝启动）"
    return
  fi

  echo "  Operator session: 已配置"
  echo "  Operator session secret: 已配置（不输出 secret）"
  if [[ -n "${ttl_ms}" ]]; then
    show_positive_integer_config_health "Operator session TTL" "${ttl_ms}" "ms"
  else
    echo "  Operator session TTL: 默认 28800000ms"
  fi
}

show_operator_identity_health() {
  local username actor operator_group resource_group

  username="$(read_backend_env_value OU_UI_CONTROL_PLANE_OPERATOR_USERNAME)"
  actor="$(read_backend_env_value OU_UI_CONTROL_PLANE_OPERATOR_ACTOR)"
  operator_group="$(read_backend_env_value OU_UI_CONTROL_PLANE_OPERATOR_GROUP_ID)"
  resource_group="$(read_backend_env_value OU_UI_CONTROL_PLANE_RESOURCE_GROUP_ID)"

  if [[ -n "${actor}" ]]; then
    echo "  Operator 身份 actor: ${actor}"
  elif [[ -n "${username}" ]]; then
    echo "  Operator 身份 actor: 默认 ${username}"
  else
    echo "  Operator 身份 actor: 默认 local-operator"
  fi

  if [[ -n "${operator_group}" ]]; then
    echo "  Operator 身份 group: ${operator_group}"
  else
    echo "  Operator 身份 group: 默认 owner（未显式配置）"
  fi

  if [[ -n "${resource_group}" ]]; then
    echo "  Operator 资源组: ${resource_group}"
  else
    echo "  Operator 资源组: 默认 group-premium（未显式配置）"
  fi
}

show_operator_bearer_token_health() {
  local operator_token frontend_operator_token

  operator_token="$(read_backend_env_value OU_UI_CONTROL_PLANE_OPERATOR_TOKEN)"
  frontend_operator_token="$(read_frontend_env_value VITE_CONTROL_PLANE_OPERATOR_TOKEN)"

  if [[ -n "${operator_token}" ]]; then
    echo "  Operator bearer token: 已配置（不输出 token）"
  else
    echo "  Operator bearer token: 未配置（Nginx 反代 API/SSE/metrics 会失败）"
  fi

  if [[ -n "${frontend_operator_token}" ]]; then
    echo "  前端 operator token: 仍存在（请运行 ou f 清理，避免浏览器侧泄露）"
  else
    echo "  前端 operator token: 未写入"
  fi
}

show_nginx_auth_proxy_health() {
  local session_gate_count operator_injection_count agent_passthrough_count

  if [[ ! -f "${NGINX_CONF}" ]]; then
    echo "  Nginx 认证反代链路: 跳过（配置文件不存在）"
    return
  fi

  session_gate_count="$(awk '/auth_request[[:space:]]+\/[^;]*\/api\/v1\/auth\/session\/check;/ { count++ } END { print count + 0 }' "${NGINX_CONF}")"
  operator_injection_count="$(awk '/proxy_set_header[[:space:]]+Authorization[[:space:]]+"Bearer[[:space:]]/ { count++ } END { print count + 0 }' "${NGINX_CONF}")"
  agent_passthrough_count="$(awk '/proxy_set_header[[:space:]]+Authorization[[:space:]]+\$http_authorization;/ { count++ } END { print count + 0 }' "${NGINX_CONF}")"

  if (( session_gate_count >= 3 )); then
    echo "  Nginx session gate: 已配置 ${session_gate_count} 处"
  else
    echo "  Nginx session gate: 配置不足（${session_gate_count}/3，API/SSE/metrics 可能未受 HttpOnly session 保护）"
  fi

  if (( operator_injection_count >= 3 )); then
    echo "  Nginx operator bearer 注入: 已配置 ${operator_injection_count} 处"
  else
    echo "  Nginx operator bearer 注入: 配置不足（${operator_injection_count}/3，API/SSE/metrics 反代可能无法认证后端）"
  fi

  if (( agent_passthrough_count >= 1 )); then
    echo "  Nginx Agent bearer 透传: 已配置"
  else
    echo "  Nginx Agent bearer 透传: 未检测到（Agent API 可能无法认证）"
  fi
}

show_frontend_static_secret_health() {
  local panel_path static_dir operator_token session_secret operator_password scan_result

  panel_path="$(read_panel_path)"
  if [[ -z "${panel_path}" ]]; then
    echo "  前端静态密钥扫描: 跳过（面板路径不可用）"
    return
  fi

  static_dir="${WEB_ROOT}/${panel_path}"
  if [[ ! -d "${static_dir}" ]]; then
    echo "  前端静态密钥扫描: 跳过（静态目录不存在）"
    return
  fi

  if ! command -v node >/dev/null 2>&1; then
    echo "  前端静态密钥扫描: 跳过（node 不可用）"
    return
  fi

  operator_token="$(read_backend_env_value OU_UI_CONTROL_PLANE_OPERATOR_TOKEN)"
  session_secret="$(read_backend_env_value OU_UI_CONTROL_PLANE_OPERATOR_SESSION_SECRET)"
  operator_password="$(read_credentials_env_value OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD)"
  operator_password="${operator_password:-$(read_backend_env_value OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD)}"

  if ! scan_result="$(
    OU_UI_STATIC_SECRET_SCAN_DIR="${static_dir}" \
    OU_UI_STATIC_SECRET_OPERATOR_TOKEN="${operator_token}" \
    OU_UI_STATIC_SECRET_SESSION_SECRET="${session_secret}" \
    OU_UI_STATIC_SECRET_OPERATOR_PASSWORD="${operator_password}" \
    node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const root = process.env.OU_UI_STATIC_SECRET_SCAN_DIR ?? '';
const candidates = [
  ['operator bearer token', process.env.OU_UI_STATIC_SECRET_OPERATOR_TOKEN ?? ''],
  ['operator session secret', process.env.OU_UI_STATIC_SECRET_SESSION_SECRET ?? ''],
  ['operator login password', process.env.OU_UI_STATIC_SECRET_OPERATOR_PASSWORD ?? '']
].filter(([, value]) => value.length >= 8);

const found = new Set();

function scanFile(filePath) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size > 10 * 1024 * 1024) {
    return;
  }
  const content = fs.readFileSync(filePath);
  for (const [label, value] of candidates) {
    if (content.includes(Buffer.from(value))) {
      found.add(label);
    }
  }
}

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
    } else if (entry.isFile()) {
      scanFile(fullPath);
    }
  }
}

if (root && fs.existsSync(root) && candidates.length > 0) {
  walk(root);
}

process.stdout.write([...found].join(', '));
NODE
  )"; then
    echo "  前端静态密钥扫描: 跳过（扫描失败）"
    return
  fi

  if [[ -n "${scan_result}" ]]; then
    echo "  前端静态密钥扫描: 发现已知 operator secret（${scan_result}，请运行 ou f 重建清理）"
  else
    echo "  前端静态密钥扫描: 未发现已知 operator secret"
  fi
}

show_browser_smoke_runtime_health() {
  local browser_script="${APP_DIR}/scripts/production-browser-smoke.cjs"

  if [[ -f "${browser_script}" ]]; then
    echo "  浏览器烟测脚本: 已安装 (${browser_script})"
  else
    echo "  浏览器烟测脚本: 未找到 (${browser_script})"
  fi

  if [[ ! -d "${APP_DIR}" ]]; then
    echo "  浏览器烟测运行时: 安装目录不存在 (${APP_DIR})"
    return
  fi

  if ! command -v node >/dev/null 2>&1; then
    echo "  浏览器烟测运行时: node 不可用"
    return
  fi

  (
    cd "${APP_DIR}" || exit 0
    node <<'NODE'
const fs = require('fs');

try {
  const playwright = require('playwright');
  const packageJson = require('playwright/package.json');
  const executablePath = playwright.chromium?.executablePath?.();

  process.stdout.write(`  Playwright: 已安装 version=${packageJson.version || 'unknown'}\n`);

  if (executablePath && fs.existsSync(executablePath)) {
    process.stdout.write(`  Chromium 浏览器: 已安装 (${executablePath})\n`);
  } else {
    process.stdout.write(`  Chromium 浏览器: 未安装 (${executablePath || '路径未知'}，可在安装目录运行 npx playwright install chromium)\n`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stdout.write(`  Playwright: 未可用（${message}，可在安装目录运行 npm install 后重试）\n`);
}
NODE
  )
}

show_agent_token_config_health() {
  local tokens_json token_summary token_status valid_count ignored_count restore_errexit

  tokens_json="$(read_backend_env_value OU_UI_CONTROL_PLANE_AGENT_TOKENS_JSON)"

  if [[ -z "${tokens_json}" ]]; then
    echo "  Agent 静态认证凭证: 未配置"
    return
  fi

  if ! command -v node >/dev/null 2>&1; then
    echo "  Agent 静态认证凭证: 已配置（未校验 JSON，node 不可用）"
    return
  fi

  [[ $- == *e* ]] && restore_errexit=1 || restore_errexit=""
  set +e
  token_summary="$(OU_UI_AGENT_TOKENS_JSON_VALUE="${tokens_json}" node -e '
const raw = process.env.OU_UI_AGENT_TOKENS_JSON_VALUE ?? "";
try {
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    process.exit(2);
  }

  const entries = Object.entries(parsed);
  const valid = entries.filter(
    ([agentId, token]) => agentId.trim().length > 0 && typeof token === "string" && token.trim().length > 0
  ).length;
  console.log(`${valid}:${entries.length - valid}`);
} catch {
  process.exit(1);
}
' 2>/dev/null)"
  token_status=$?
  [[ -n "${restore_errexit}" ]] && set -e

  if (( token_status != 0 )) || [[ "${token_summary}" != *:* ]]; then
    echo "  Agent 静态认证凭证: JSON 无效或不是 object（后端会拒绝启动）"
    return
  fi

  valid_count="${token_summary%%:*}"
  ignored_count="${token_summary#*:}"
  if [[ "${ignored_count}" == "0" ]]; then
    echo "  Agent 静态认证凭证: 有效 ${valid_count} 个"
  else
    echo "  Agent 静态认证凭证: 有效 ${valid_count} 个，忽略 ${ignored_count} 个空/非字符串条目"
  fi
}

show_system_alert_webhook_health() {
  local webhook_url webhook_urls webhook_allowlist webhook_bearer_token webhook_timeout webhook_retry_delay webhook_max_attempts webhook_retry_sweep_interval webhook_max_deliveries
  local webhook_count webhook_extra_count index item
  local -a webhook_items=()
  local -a webhook_items_extra=()

  webhook_url="$(read_backend_env_value OU_UI_SYSTEM_ALERT_WEBHOOK_URL)"
  webhook_urls="$(read_backend_env_value OU_UI_SYSTEM_ALERT_WEBHOOK_URLS)"
  webhook_allowlist="$(read_backend_env_value OU_UI_SYSTEM_ALERT_WEBHOOK_EGRESS_ALLOWLIST)"
  webhook_bearer_token="$(read_backend_env_value OU_UI_SYSTEM_ALERT_WEBHOOK_BEARER_TOKEN)"
  webhook_timeout="$(read_backend_env_value OU_UI_SYSTEM_ALERT_WEBHOOK_TIMEOUT_MS)"
  webhook_retry_delay="$(read_backend_env_value OU_UI_SYSTEM_ALERT_WEBHOOK_RETRY_DELAY_MS)"
  webhook_max_attempts="$(read_backend_env_value OU_UI_SYSTEM_ALERT_WEBHOOK_MAX_ATTEMPTS)"
  webhook_retry_sweep_interval="$(read_backend_env_value OU_UI_SYSTEM_ALERT_WEBHOOK_RETRY_SWEEP_INTERVAL_MS)"
  webhook_max_deliveries="$(read_backend_env_value OU_UI_SYSTEM_ALERT_WEBHOOK_MAX_DELIVERIES_PER_SWEEP)"

  webhook_count=0
  [[ -n "${webhook_url}" ]] && webhook_count=1
  webhook_extra_count="$(count_csv_env_values "${webhook_urls}")"
  webhook_count=$((webhook_count + webhook_extra_count))

  if (( webhook_count == 0 )); then
    echo "  系统告警 webhook: 未配置"
    return
  fi

  echo "  系统告警 webhook: 已配置 ${webhook_count} 个目标"
  [[ -n "${webhook_allowlist}" ]] && echo "  系统告警 webhook allowlist: ${webhook_allowlist}"
  [[ -n "${webhook_bearer_token}" ]] && echo "  系统告警 webhook bearer: 已配置"
  show_positive_integer_config_health "系统告警 webhook timeout" "${webhook_timeout}" "ms"
  show_positive_integer_config_health "系统告警 webhook retryDelay" "${webhook_retry_delay}" "ms"
  show_positive_integer_config_health "系统告警 webhook maxAttempts" "${webhook_max_attempts}"
  show_positive_integer_config_health "系统告警 webhook retrySweepInterval" "${webhook_retry_sweep_interval}" "ms"
  show_positive_integer_config_health "系统告警 webhook maxDeliveriesPerSweep" "${webhook_max_deliveries}"

  [[ -n "${webhook_url}" ]] && webhook_items+=("${webhook_url}")
  IFS=',' read -ra webhook_items_extra <<<"${webhook_urls}"
  for item in "${webhook_items_extra[@]}"; do
    item="${item#"${item%%[![:space:]]*}"}"
    item="${item%"${item##*[![:space:]]}"}"
    [[ -n "${item}" ]] && webhook_items+=("${item}")
  done

  index=1
  for item in "${webhook_items[@]}"; do
    show_system_alert_webhook_target_health "target-${index}" "${item}"
    index=$((index + 1))
  done
}

show_subscription_source_health() {
  local allowlist provider_max_concurrent max_fetches_per_day max_bytes_per_day

  allowlist="$(read_backend_env_value OU_UI_SUBSCRIPTION_SOURCE_EGRESS_ALLOWLIST)"
  provider_max_concurrent="$(read_backend_env_value OU_UI_SUBSCRIPTION_SOURCE_PROVIDER_MAX_CONCURRENT_FETCHES_PER_HOST)"
  max_fetches_per_day="$(read_backend_env_value OU_UI_SUBSCRIPTION_SOURCE_SYNC_BUDGET_MAX_FETCHES_PER_DAY)"
  max_bytes_per_day="$(read_backend_env_value OU_UI_SUBSCRIPTION_SOURCE_SYNC_BUDGET_MAX_BYTES_PER_DAY)"

  if [[ -n "${allowlist}" ]]; then
    echo "  订阅源远程拉取 allowlist: ${allowlist}"
  else
    echo "  订阅源远程拉取 allowlist: 未配置（仍会拦截 localhost/私网/本机目标）"
  fi

  if [[ -n "${provider_max_concurrent}" ]]; then
    show_positive_integer_config_health "订阅源 provider host 并发上限" "${provider_max_concurrent}"
  else
    echo "  订阅源 provider host 并发上限: 默认 2"
  fi

  if [[ -n "${max_fetches_per_day}" || -n "${max_bytes_per_day}" ]]; then
    show_positive_integer_config_health "订阅源每日同步次数上限" "${max_fetches_per_day}"
    show_positive_integer_config_health "订阅源每日同步字节上限" "${max_bytes_per_day}" " bytes"
  else
    echo "  订阅源每日同步预算: 未配置全局上限"
  fi
}

control_plane_backup_directory() {
  echo "${STATE_DIR}/backups"
}

control_plane_backup_manifest_path() {
  local backup_path="$1"
  echo "${backup_path}.manifest.json"
}

sha256_file() {
  local file_path="$1"

  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "${file_path}" | awk '{print $1}'
    return
  fi

  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "${file_path}" | awk '{print $1}'
    return
  fi

  fail "当前系统缺少 sha256sum 或 shasum，无法校验控制面备份。"
}

json_escape_string() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

write_control_plane_backup_manifest() {
  local backup_path="$1"
  local storage_mode="$2"
  local source_file="$3"
  local manifest_path backup_sha backup_size created_at app_commit
  local escaped_backup_path escaped_source_file escaped_storage_mode escaped_app_commit
  local sqlite_migrations_json

  manifest_path="$(control_plane_backup_manifest_path "${backup_path}")"
  backup_sha="$(sha256_file "${backup_path}")"
  backup_size="$(wc -c <"${backup_path}" | tr -d '[:space:]')"
  created_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  app_commit="$(current_app_commit)"
  sqlite_migrations_json="[]"

  if [[ "${storage_mode}" == "sqlite" && -f "${manifest_path}" ]] && command -v node >/dev/null 2>&1; then
    sqlite_migrations_json="$(node -e 'const fs=require("fs"); const manifestPath=process.argv[1]; let manifest; try { manifest=JSON.parse(fs.readFileSync(manifestPath,"utf8")); } catch { manifest={}; } const migrations=Array.isArray(manifest.sqliteMigrations) ? manifest.sqliteMigrations : []; const safe=migrations.filter((item)=>item && Number.isSafeInteger(item.version) && typeof item.name==="string" && typeof item.checksum==="string" && /^sha256:[a-f0-9]{64}$/i.test(item.checksum) && typeof item.appliedAt==="string").map((item)=>({version:item.version,name:item.name,checksum:item.checksum,appliedAt:item.appliedAt})); process.stdout.write(JSON.stringify(safe));' "${manifest_path}" 2>/dev/null || printf '[]')"
  fi

  escaped_backup_path="$(json_escape_string "${backup_path}")"
  escaped_source_file="$(json_escape_string "${source_file}")"
  escaped_storage_mode="$(json_escape_string "${storage_mode}")"
  escaped_app_commit="$(json_escape_string "${app_commit:-unknown}")"

  cat >"${manifest_path}" <<MANIFEST_EOF
{"schemaVersion":"ou-ui-next.control-plane-backup.v1","createdAt":"${created_at}","storageMode":"${escaped_storage_mode}","sourceFile":"${escaped_source_file}","backupFile":"${escaped_backup_path}","sizeBytes":${backup_size},"sha256":"${backup_sha}","appCommit":"${escaped_app_commit}","sqliteMigrations":${sqlite_migrations_json}}
MANIFEST_EOF
  chmod 600 "${manifest_path}" 2>/dev/null || true
  printf '%s\n' "${manifest_path}"
}

validate_control_plane_backup_manifest() {
  local backup_file="$1"
  local manifest_path expected_sha expected_size actual_sha actual_size
  manifest_path="$(control_plane_backup_manifest_path "${backup_file}")"

  if [[ ! -f "${manifest_path}" ]]; then
    warn "未找到备份 manifest，跳过 SHA-256 校验：${manifest_path}"
    return
  fi

  expected_sha="$(node -e 'const fs=require("fs"); const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(m.schemaVersion!=="ou-ui-next.control-plane-backup.v1") process.exit(2); if(typeof m.sha256!=="string" || !/^[a-f0-9]{64}$/i.test(m.sha256)) process.exit(3); console.log(m.sha256.toLowerCase());' "${manifest_path}")" ||
    fail "备份 manifest 无效或缺少 SHA-256：${manifest_path}"
  expected_size="$(node -e 'const fs=require("fs"); const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(m.schemaVersion!=="ou-ui-next.control-plane-backup.v1") process.exit(2); if(!Number.isSafeInteger(m.sizeBytes) || m.sizeBytes < 0) process.exit(3); console.log(String(m.sizeBytes));' "${manifest_path}")" ||
    fail "备份 manifest 无效或缺少文件大小：${manifest_path}"
  actual_sha="$(sha256_file "${backup_file}")"
  actual_size="$(wc -c <"${backup_file}" | tr -d '[:space:]')"

  [[ "${actual_sha}" == "${expected_sha}" ]] || fail "备份 SHA-256 校验失败：${backup_file}"
  [[ "${actual_size}" == "${expected_size}" ]] || fail "备份大小校验失败：${backup_file}"
}

default_control_plane_backup_path() {
  local storage_mode timestamp extension
  storage_mode="$(control_plane_storage_mode)"
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  extension="json"

  if [[ "${storage_mode}" == "sqlite" ]]; then
    extension="sqlite"
  fi

  echo "$(control_plane_backup_directory)/control-plane-${storage_mode}-${timestamp}.${extension}"
}

resolve_control_plane_backup_path() {
  local requested_path="${1:-}"

  if [[ -z "${requested_path}" ]]; then
    default_control_plane_backup_path
    return
  fi

  if [[ -d "${requested_path}" ]]; then
    local basename
    basename="$(basename "$(default_control_plane_backup_path)")"
    echo "${requested_path%/}/${basename}"
    return
  fi

  echo "${requested_path}"
}

remove_control_plane_storage_files() {
  local state_file legacy_state_file
  state_file="$(control_plane_state_file)"
  legacy_state_file="$(control_plane_legacy_state_file)"

  rm -f "${state_file}" "${state_file}-shm" "${state_file}-wal"

  if [[ -n "${legacy_state_file}" ]] && [[ "${legacy_state_file}" != "${state_file}" ]]; then
    rm -f "${legacy_state_file}"
  fi
}

backup_control_plane_state_to_path() {
  local backup_path="$1"
  local storage_mode state_file
  storage_mode="$(control_plane_storage_mode)"
  state_file="$(control_plane_state_file)"

  [[ -n "${backup_path}" ]] || fail "备份路径不能为空。"
  [[ -f "${state_file}" ]] || fail "当前控制面存储不存在，无法创建备份：${state_file}"

  mkdir -p "$(dirname "${backup_path}")"
  rm -f "${backup_path}"

  if [[ "${storage_mode}" == "sqlite" ]]; then
    (cd "${APP_DIR}" && node "${APP_DIR}/scripts/control-plane-sqlite-tool.cjs" backup "${state_file}" "${backup_path}")
  else
    cp "${state_file}" "${backup_path}"
  fi

  chmod 600 "${backup_path}" 2>/dev/null || true
  write_control_plane_backup_manifest "${backup_path}" "${storage_mode}" "${state_file}" >/dev/null
  printf '%s\n' "${backup_path}"
}

backup_control_plane_state() {
  require_root

  local backup_path manifest_path
  backup_path="$(resolve_control_plane_backup_path "${1:-}")"
  backup_control_plane_state_to_path "${backup_path}" >/dev/null
  manifest_path="$(control_plane_backup_manifest_path "${backup_path}")"
  log "控制面状态备份完成：${backup_path}"
  log "控制面备份 manifest 已写入：${manifest_path}"
}

restore_control_plane_state() {
  require_root

  local backup_file="${1:-}"
  local answer="${2:-}"
  local storage_mode state_file extension pre_restore_backup restore_staging_path

  [[ -n "${backup_file}" ]] || fail "请提供控制面备份文件路径。"
  [[ -f "${backup_file}" ]] || fail "未找到控制面备份文件：${backup_file}"

  storage_mode="$(control_plane_storage_mode)"
  state_file="$(control_plane_state_file)"
  extension="json"

  validate_control_plane_backup_manifest "${backup_file}"

  if [[ "${storage_mode}" == "sqlite" ]]; then
    extension="sqlite"
  fi

  pre_restore_backup="$(control_plane_backup_directory)/pre-restore-${storage_mode}-$(date -u +%Y%m%dT%H%M%SZ).${extension}"
  restore_staging_path="${state_file}.restore-$(date -u +%Y%m%dT%H%M%SZ)-$$"

  cat <<EOT
此操作会用备份覆盖当前控制面存储：
  当前存储: ${state_file}
  备份文件: ${backup_file}

执行前会自动创建恢复前快照：
  ${pre_restore_backup}
EOT

  if [[ "${answer}" != "yes" ]]; then
    read -r -p "请输入 yes 继续恢复：" answer
  fi
  [[ "${answer}" == "yes" ]] || exit 0

  mkdir -p "$(dirname "${restore_staging_path}")"
  rm -f "${restore_staging_path}" "${restore_staging_path}-shm" "${restore_staging_path}-wal"

  if [[ "${storage_mode}" == "sqlite" ]]; then
    (cd "${APP_DIR}" && node "${APP_DIR}/scripts/control-plane-sqlite-tool.cjs" restore "${backup_file}" "${restore_staging_path}")
  else
    install -D -m 600 "${backup_file}" "${restore_staging_path}"
  fi

  backup_control_plane_state_to_path "${pre_restore_backup}" >/dev/null

  systemctl stop "${SERVICE_NAME}" >/dev/null 2>&1 || true
  rm -f "${state_file}" "${state_file}-shm" "${state_file}-wal"
  mv "${restore_staging_path}" "${state_file}"
  chown "${SERVICE_USER}:${SERVICE_USER}" "${state_file}" 2>/dev/null || true
  chmod 600 "${state_file}" 2>/dev/null || true
  systemctl start "${SERVICE_NAME}"

  log "控制面状态已从备份恢复：${backup_file}"
  log "恢复前快照已保存：${pre_restore_backup}"
}

show_doctor() {
  require_root

  local url state_file storage_mode legacy_state_file auth_lines panel_headers panel_status panel_auth panel_final_url app_commit deployed_commit sqlite_validate_output
  local operator_password_plain operator_password_hash credentials_password credentials_mode
  url="$(panel_url)"
  state_file="$(control_plane_state_file)"
  storage_mode="$(control_plane_storage_mode)"
  legacy_state_file="$(control_plane_legacy_state_file)"
  app_commit="$(current_app_commit)"
  operator_password_plain="$(read_backend_env_value OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD)"
  operator_password_hash="$(read_backend_env_value OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD_HASH)"
  credentials_password="$(read_credentials_env_value OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD)"
  credentials_mode="$(stat -c '%a' "${CREDENTIALS_FILE}" 2>/dev/null || true)"
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
  deployed_commit="$(read_deployed_build_commit "${url}")"

  cat <<EOT
OU-UI Next 安装诊断
  面板地址: ${url}
  面板 HTTP 状态: ${panel_status:-无法访问}
  面板最终地址: ${panel_final_url:-无法确认}
  源码提交: ${app_commit:-无法确认}
  前端构建提交: ${deployed_commit:-无法确认}
  WWW-Authenticate: ${panel_auth:-未返回}
  Nginx 配置: ${NGINX_CONF}
  后端环境: ${BACKEND_ENV_FILE}
  控制面存储: ${storage_mode} (${state_file})
EOT

  if [[ -n "${legacy_state_file}" ]]; then
    echo "  JSON 迁移源: ${legacy_state_file}"
  fi

  show_systemd_service_health
  show_runtime_filesystem_health
  show_external_archive_health
  show_agent_log_retention_health
  show_traffic_rollup_retention_health
  show_command_timeout_sweep_health
  show_operator_auth_throttle_health
  show_operator_session_health
  show_operator_identity_health
  show_operator_bearer_token_health
  show_nginx_auth_proxy_health
  show_frontend_static_secret_health
  show_browser_smoke_runtime_health
  show_agent_token_config_health
  show_system_alert_webhook_health
  show_subscription_source_health

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

  if [[ -n "${operator_password_hash}" && -z "${operator_password_plain}" ]]; then
    echo "  登录凭据存储: 后端 hash 已启用，后端环境未保存明文密码"
  elif [[ -n "${operator_password_hash}" && -n "${operator_password_plain}" ]]; then
    echo "  登录凭据存储: 后端 hash 已启用，但旧明文密码仍在后端环境中；运行 ou-ui repair-nginx 可清理"
  elif [[ -n "${operator_password_plain}" ]]; then
    echo "  登录凭据存储: 后端仍使用明文密码兼容旧配置，建议运行 ou-ui repair-nginx 迁移为 hash"
  else
    echo "  登录凭据存储: 未找到后端登录密码或 hash，请检查安装环境"
  fi

  if [[ -n "${credentials_password}" ]]; then
    if [[ "${credentials_mode}" == "600" || "${credentials_mode}" == "400" ]]; then
      echo "  root-only 凭据文件: 已保存，权限 ${credentials_mode}"
    else
      echo "  root-only 凭据文件: 已保存，但权限 ${credentials_mode:-无法确认}，建议 chmod 600"
    fi
  else
    echo "  root-only 凭据文件: 未找到明文登录密码，ou c 可能无法显示登录密码"
  fi

  if is_default_operator_credential; then
    echo "  登录凭据强度: 检测到默认/弱凭据，建议运行 ou-ui rotate-credentials 立即轮换"
  else
    echo "  登录凭据强度: 未发现默认凭据"
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

  if [[ "${storage_mode}" == "file" ]] && [[ -f "${state_file}" ]] && command -v jq >/dev/null 2>&1; then
    echo "  状态文件任务数: $(jq '.tasks | length' "${state_file}" 2>/dev/null || echo '无法读取')"
    echo "  Agent 凭据数: $(jq '.agentCredentials | length' "${state_file}" 2>/dev/null || echo '无法读取')"
  elif [[ "${storage_mode}" == "file" ]] && [[ -f "${state_file}" ]]; then
    echo "  状态文件: 已存在（安装 jq 后可显示任务和 Agent 凭据数量）"
  elif [[ "${storage_mode}" == "sqlite" ]] && [[ -f "${state_file}" ]]; then
    if ! command -v node >/dev/null 2>&1; then
      echo "  SQLite 数据库: 已存在（缺少 node，无法执行 schema 校验）"
    elif [[ ! -f "${APP_DIR}/scripts/control-plane-sqlite-tool.cjs" ]]; then
      echo "  SQLite 数据库: 已存在（缺少 sqlite 校验工具，无法执行 schema 校验）"
    elif sqlite_validate_output="$(cd "${APP_DIR}" && node "${APP_DIR}/scripts/control-plane-sqlite-tool.cjs" validate "${state_file}" 2>&1)"; then
      echo "  SQLite 数据库: 已存在，schema 校验通过"
    else
      echo "  SQLite 数据库: 已存在，但 schema 校验失败"
      printf '%s\n' "${sqlite_validate_output}" | awk 'NR <= 5 { print "    " $0 }'
    fi
  elif [[ -f "${state_file}" ]]; then
    echo "  控制面存储: 已存在"
  else
    echo "  控制面存储: 尚未生成，后端启动后会自动创建"
  fi

  warn_demo_inventory_residue
}

reconfigure_installation() {
  require_root

  if [[ ! -f "${APP_DIR}/scripts/install-master.sh" ]]; then
    fail "未找到可复用的安装脚本，请先确认 ${APP_DIR} 是完整安装目录。"
  fi

  log "将重新打开安装向导，以便修改端口、证书和 Nginx 相关配置。"
  export OU_UI_PRESERVE_STATE=1
  exec bash "${APP_DIR}/scripts/install-master.sh"
}

reset_control_plane_state() {
  require_root

  local answer

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
  remove_control_plane_storage_files
  systemctl start "${SERVICE_NAME}"
  log "控制面状态已重置。"
  show_credentials
}

force_reset_control_plane_state() {
  require_root

  systemctl stop "${SERVICE_NAME}" >/dev/null 2>&1 || true
  remove_control_plane_storage_files
  systemctl start "${SERVICE_NAME}"
  log "控制面运行状态已清理，下一次打开面板会回到真实空环境。"
}

read_empty_inventory_snapshot_residue() {
  local payload="$1"

  printf '%s\n' "${payload}" | jq -er '
    if type != "object" then empty
    elif (.data | type) != "object" then empty
    else
    . as $snapshot
    |
    def array_count($key):
      ($snapshot.data[$key] // [] | if type == "array" then length else -1 end);
    [
      "agents",
      "nodes",
      "inbounds",
      "subscriptionSources",
      "subscriptionInventoryNodes",
      "subscriptionBundles",
      "subscriptionClients",
      "subscriptionExportProfiles",
      "proxyProviders",
      "subscriptionExportFiles",
      "forwardRules",
      "quotaPolicies",
      "rateLimitPolicies",
      "routingPolicies",
      "tuningProfiles",
      "configRevisions",
      "preflightPlans",
      "runtimeSnapshots",
      "tasks"
    ]
    | map({ key: ., count: array_count(.) })
    | map(select(.count != 0))
    | if length == 0 then "OK" else map("\(.key)=\(.count)") | join(", ") end
    end
  ' 2>/dev/null || true
}

poll_empty_inventory_snapshot_residue() {
  local api_url="$1"
  local cookie_file="${2:-}"
  local payload residue attempt

  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    if [[ -n "${cookie_file}" ]]; then
      payload="$(curl -k -sS --max-time 10 -b "${cookie_file}" "${api_url}" 2>/dev/null || true)"
    else
      payload="$(curl -k -sS --max-time 10 "${api_url}" 2>/dev/null || true)"
    fi
    residue="$(read_empty_inventory_snapshot_residue "${payload}")"

    if [[ -n "${residue}" ]]; then
      printf '%s\n' "${residue}"
      return 0
    fi

    sleep 1
  done

  return 1
}

read_demo_inventory_snapshot_residue() {
  local payload="$1"

  printf '%s\n' "${payload}" | jq -er '
    def display_id:
      if . == "grant-admin-tunnel" then "legacy-bootstrap-owner-tunnel"
      elif . == "grant-admin-agent-enrollment" then "legacy-bootstrap-owner-agent-enrollment"
      else . end;
    def ids($key):
      (.data[$key] // [] | if type == "array" then map(.id? // empty) else [] end);
    def picked($key; $known):
      ids($key) | map(select(. as $id | $known | index($id)) | display_id);
    [
      { key: "agents", matches: picked("agents"; ["agent-hkg-01", "agent-sin-02", "agent-tyo-03"]) },
      { key: "nodes", matches: picked("nodes"; ["node-hkg-edge-01", "node-sin-forward-02", "node-tyo-standby-03"]) },
      { key: "inbounds", matches: picked("inbounds"; ["inbound-vless-hkg-443"]) },
      { key: "subscriptionSources", matches: picked("subscriptionSources"; ["source-mihomo-hkg", "source-v2ray-eu"]) },
      { key: "subscriptionClients", matches: picked("subscriptionClients"; ["sub-client-acme-hkg"]) },
      { key: "subscriptionBundles", matches: picked("subscriptionBundles"; ["sub-global-premium"]) },
      { key: "forwardRules", matches: picked("forwardRules"; ["forward-hkg-443"]) },
      { key: "quotaPolicies", matches: picked("quotaPolicies"; ["quota-forwarding-01"]) },
      { key: "rateLimitPolicies", matches: picked("rateLimitPolicies"; ["rate-forwarding-01"]) },
      { key: "routingPolicies", matches: picked("routingPolicies"; ["route-cn-direct", "route-streaming-proxy"]) },
      { key: "tuningProfiles", matches: picked("tuningProfiles"; ["tune-bbr-edge", "tune-runtime-reload"]) },
      { key: "permissionGrants", matches: picked("permissionGrants"; ["grant-bootstrap-owner-tunnel", "grant-bootstrap-owner-agent-enrollment", "grant-admin-tunnel", "grant-admin-agent-enrollment"]) }
    ]
    | map(select(.matches | length > 0))
    | if length == 0 then "OK" else map("\(.key)=\(.matches | join("|"))") | join(", ") end
  ' 2>/dev/null || true
}

poll_demo_inventory_snapshot_residue() {
  local api_url="$1"
  local cookie_file="${2:-}"
  local payload residue attempt

  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    if [[ -n "${cookie_file}" ]]; then
      payload="$(curl -k -sS --max-time 10 -b "${cookie_file}" "${api_url}" 2>/dev/null || true)"
    else
      payload="$(curl -k -sS --max-time 10 "${api_url}" 2>/dev/null || true)"
    fi
    residue="$(read_demo_inventory_snapshot_residue "${payload}")"

    if [[ -n "${residue}" ]]; then
      printf '%s\n' "${residue}"
      return 0
    fi

    sleep 1
  done

  return 1
}

warn_demo_inventory_residue() {
  local base_url api_url residue state_file cookie_file
  base_url="$(panel_url)"

  if [[ -z "${base_url}" || "${base_url}" == "暂不可用" ]]; then
    warn "无法检查演示库存残留：面板地址不可用。"
    return 0
  fi

  cookie_file="$(create_panel_session_cookie_file)"
  trap 'remove_session_cookie_file "${cookie_file}"; trap - RETURN' RETURN
  api_url="${base_url%/}/api/v1/snapshot"
  if ! residue="$(poll_demo_inventory_snapshot_residue "${api_url}" "${cookie_file}")"; then
    warn "无法检查演示库存残留：${api_url} 未返回标准控制面快照。请运行 ou d 查看诊断。"
    return 0
  fi

  if [[ "${residue}" == "OK" ]]; then
    log "演示库存残留检查通过：未发现内置 seed ID。"
    return 0
  fi

  state_file="$(control_plane_state_file)"
  warn "检测到旧演示/种子数据残留：${residue}"
  warn "如果这是刚安装后看到的默认节点或 mutation denied，请运行 sudo ou f --force 清理旧状态；清理前可备份 ${state_file}。"
}

check_empty_control_plane_inventory() {
  local base_url api_url residue cookie_file
  base_url="$(panel_url)"

  if [[ -z "${base_url}" || "${base_url}" == "暂不可用" ]]; then
    fail "无法验证控制面空库存：面板地址不可用。"
  fi

  cookie_file="$(create_panel_session_cookie_file)"
  trap 'remove_session_cookie_file "${cookie_file}"; trap - RETURN' RETURN
  api_url="${base_url%/}/api/v1/snapshot"
  if ! residue="$(poll_empty_inventory_snapshot_residue "${api_url}" "${cookie_file}")"; then
    fail "无法验证控制面空库存：${api_url} 未返回标准控制面快照，请运行 ou d 查看诊断。"
  fi

  if [[ "${residue}" != "OK" ]]; then
    fail "控制面空库存自检失败：刚安装或强制重置后仍发现业务库存残留：${residue}。请运行 ou f --force 清理旧状态，或检查是否命中了旧后端实例。"
  fi

  log "控制面空库存自检通过：未发现默认/演示主机、节点、入站、端口转发、订阅源、订阅库存、订阅身份、代理集合、导出文件或旧任务。"
}

check_agent_install_command_surface() {
  local base_url api_url payload request_id response status body command username cookie_file csrf_token
  base_url="$(panel_url)"

  if [[ -z "${base_url}" || "${base_url}" == "暂不可用" ]]; then
    fail "无法验证 Agent 安装命令 API：面板地址不可用。"
  fi

  username="$(read_frontend_env_value VITE_CONTROL_PLANE_LOGIN_USERNAME)"
  username="${username:-operator}"
  cookie_file="$(create_panel_session_cookie_file)"
  trap 'remove_session_cookie_file "${cookie_file}"; trap - RETURN' RETURN
  csrf_token="$(read_session_csrf_token "${cookie_file}")"
  [[ -n "${csrf_token}" ]] || fail "Agent 安装命令 API 自检失败：面板会话缺少 CSRF token。"
  api_url="${base_url%/}/api/v1/agents/install-command"
  request_id="install-selfcheck-agent-command-$(date +%s)-$$"
  payload='{"installProfile":["host-agent","xray","port-forwarding","telemetry","command-channel"]}'

  response="$(
    curl -k -sS --max-time 15 \
      -w '\n%{http_code}' \
      -b "${cookie_file}" \
      -H 'Content-Type: application/json' \
      -H "X-Actor: ${username}" \
      -H "X-Request-Id: ${request_id}" \
      -H "X-CSRF-Token: ${csrf_token}" \
      -H "Idempotency-Key: ${request_id}" \
      -H "X-Forwarded-For: installer-selfcheck" \
      -H "X-Operator-Group-Id: owner" \
      -H "X-Resource-Group-Id: group-premium" \
      --data "${payload}" \
      "${api_url}" 2>/dev/null || true
  )"
  status="$(printf '%s\n' "${response}" | tail -n 1)"
  body="$(printf '%s\n' "${response}" | sed '$d')"

  if [[ "${status}" != "201" ]]; then
    fail "Agent 安装命令 API 自检失败：HTTP ${status:-无响应}。这通常说明 Nginx session gate、operator token 注入或 bootstrap 权限链路异常。响应：${body:-空}"
  fi

  command="$(printf '%s\n' "${body}" | jq -er '.data.command // empty' 2>/dev/null || true)"
  if [[ -z "${command}" ]] ||
    [[ "${command}" != *"public/install/ou-agent.sh"* ]] ||
    [[ "${command}" != *"OU_MASTER="* ]] ||
    [[ "${command}" != *"OU_AGENT_ID="* ]] ||
    [[ "${command}" != *"OU_INSTALL_TOKEN="* ]]; then
    fail "Agent 安装命令 API 自检失败：返回内容不是有效的一键安装命令。"
  fi

  log "Agent 安装命令 API 自检通过：可生成真实一键命令，且未把主机名/客户名写入安装命令。"
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

remove_build_swap() {
  local swap_file="${STATE_DIR}/ou-ui-next.swap"
  local fstab_tmp=""

  if swapon --show=NAME 2>/dev/null | awk 'NR>1 { print $1 }' | grep -qx "${swap_file}"; then
    swapoff "${swap_file}" >/dev/null 2>&1 || true
  fi

  if [[ -f /etc/fstab ]] && grep -qF "${swap_file} none swap sw 0 0" /etc/fstab; then
    fstab_tmp="$(mktemp)"
    awk -v swap_line="${swap_file} none swap sw 0 0" '$0 != swap_line { print }' /etc/fstab >"${fstab_tmp}"
    cat "${fstab_tmp}" >/etc/fstab
    rm -f "${fstab_tmp}"
  fi

  rm -f "${swap_file}"
}

do_uninstall() {
  require_root
  read -r -p "确认卸载 OU-UI Next？请输入 yes 继续：" answer
  [[ "${answer}" == "yes" ]] || exit 0

  systemctl disable --now "${SERVICE_NAME}" >/dev/null 2>&1 || true
  remove_build_swap
  rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
  rm -f "${NGINX_CONF}"
  rm -f "${BACKEND_ENV_FILE}"
  rm -f "${APP_DIR}/.env.production.local"
  rm -rf "${INSTALL_ROOT}" "${CONFIG_DIR}" "${STATE_DIR}" "${WEB_ROOT}" "${ACME_WEBROOT}"
  rm -f "/usr/local/bin/ou-ui-next" "/usr/local/bin/ouui" "/usr/local/bin/ou-ui" "/usr/local/bin/ou"
  rm -f "/usr/bin/ou-ui-next" "/usr/bin/ouui" "/usr/bin/ou-ui" "/usr/bin/ou"
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

current_app_commit() {
  git -C "${APP_DIR}" rev-parse HEAD 2>/dev/null || true
}

write_frontend_build_info() {
  local target_dir="$1"
  local commit built_at
  commit="$(current_app_commit)"
  built_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  [[ -n "${commit}" ]] || commit="unknown"
  cat >"${target_dir}/build-info.json" <<BUILD_INFO_EOF
{"commit":"${commit}","builtAt":"${built_at}","scriptVersion":"${SCRIPT_VERSION}"}
BUILD_INFO_EOF
}

read_deployed_build_commit() {
  local base_url="$1"
  local build_info
  build_info="$(curl -k -sSL --max-time 10 "${base_url%/}/build-info.json" 2>/dev/null || true)"
  printf '%s\n' "${build_info}" | sed -n 's/.*"commit"[[:space:]]*:[[:space:]]*"\([0-9a-f][0-9a-f]*\)".*/\1/p' | head -n 1
}

frontend_static_matches_current_dist() {
  local target_dir="$1"
  local changes

  [[ -f "${APP_DIR}/dist/index.html" ]] || return 1
  [[ -f "${target_dir}/index.html" ]] || return 1

  if ! changes="$(rsync -rcni --delete --exclude build-info.json "${APP_DIR}/dist/" "${target_dir}/" 2>/dev/null)"; then
    return 1
  fi

  [[ -z "${changes}" ]]
}

repair_missing_frontend_build_info() {
  local panel_path target_dir
  panel_path="$(read_panel_path)"
  [[ -n "${panel_path}" ]] || return 0

  target_dir="${WEB_ROOT}/${panel_path}"
  frontend_static_matches_current_dist "${target_dir}" || return 0

  write_frontend_build_info "${target_dir}"
  log "前端构建指纹缺失，已为当前静态目录补写。"
}

check_frontend_build_fingerprint() {
  local base_url="$1"
  local expected_commit deployed_commit
  expected_commit="$(current_app_commit)"
  [[ -n "${expected_commit}" ]] || return

  deployed_commit="$(read_deployed_build_commit "${base_url}")"
  if [[ -z "${deployed_commit}" ]]; then
    repair_missing_frontend_build_info
    deployed_commit="$(read_deployed_build_commit "${base_url}")"
  fi

  if [[ -z "${deployed_commit}" ]]; then
    fail "前端构建指纹缺失：${base_url%/}/build-info.json 不可用。请重新运行 ou-ui update。"
  fi

  if [[ "${deployed_commit}" != "${expected_commit}" ]]; then
    fail "前端构建指纹不匹配：当前源码 ${expected_commit:0:12}，已部署静态资源 ${deployed_commit:0:12}。请重新运行 ou-ui update。"
  fi

  log "前端构建指纹自检通过：${deployed_commit:0:12}"
}

deploy_frontend_bundle() {
  local panel_path
  panel_path="$(read_panel_path)"

  [[ -n "${panel_path}" ]] || fail "面板安全路径不可用，请检查 ${APP_DIR}/.env.production.local。"
  mkdir -p "${WEB_ROOT}/${panel_path}"
  rsync -a --delete "${APP_DIR}/dist/" "${WEB_ROOT}/${panel_path}/"
  write_frontend_build_info "${WEB_ROOT}/${panel_path}"
}

read_panel_domain() {
  if [[ -f "${NGINX_CONF}" ]] && ! grep -qE 'server_name[[:space:]]+_[[:space:]]*;' "${NGINX_CONF}" 2>/dev/null; then
    awk '/^[[:space:]]*server_name[[:space:]]+/ && $2 != "_" { print $2; exit }' "${NGINX_CONF}" 2>/dev/null | tr -d ';'
  fi
}

nginx_supports_standalone_http2() {
  local version major minor patch
  version="$(nginx -v 2>&1 | sed -n 's#.*nginx/\([0-9][0-9.]*\).*#\1#p')"
  IFS=. read -r major minor patch <<<"${version}"
  major="${major:-0}"
  minor="${minor:-0}"
  patch="${patch:-0}"

  (( major > 1 || (major == 1 && (minor > 25 || (minor == 25 && patch >= 1))) ))
}

nginx_http2_listen_suffix() {
  if nginx_supports_standalone_http2; then
    printf ''
    return
  fi

  printf ' http2'
}

nginx_http2_directive_line() {
  if nginx_supports_standalone_http2; then
    printf '    http2 on;'
  fi
}

write_managed_nginx_http() {
  local panel_path listen backend_host backend_port operator_token
  panel_path="$(read_panel_path)"
  listen="$(read_listen_port)"
  backend_host="$(read_backend_env_value OU_UI_CONTROL_PLANE_HOST)"
  backend_port="$(read_backend_env_value OU_UI_CONTROL_PLANE_PORT)"
  operator_token="$(read_backend_env_value OU_UI_CONTROL_PLANE_OPERATOR_TOKEN)"

  [[ -n "${panel_path}" ]] || fail "无法刷新 Nginx：面板安全路径不可用。"
  [[ -n "${listen}" ]] || fail "无法刷新 Nginx：面板监听端口不可用。"
  [[ -n "${backend_host}" ]] || backend_host="127.0.0.1"
  [[ -n "${backend_port}" ]] || backend_port="${BACKEND_PORT_DEFAULT}"
  [[ -n "${operator_token}" ]] || fail "无法刷新 Nginx：后端 operator token 不可用。"

  cat >"${NGINX_CONF}" <<NGINX_EOF
server {
    listen ${listen} default_server;
    server_name _;
    auth_basic off;

    root ${WEB_ROOT};
    index index.html;

    location = / {
        return 302 /${panel_path}/;
    }

    location = /${panel_path} {
        return 302 /${panel_path}/;
    }

    location = /${panel_path}/api/v1/auth/session {
        rewrite ^/${panel_path}/(.*)$ /\$1 break;
        proxy_pass http://${backend_host}:${backend_port};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Prefix /${panel_path};
    }

    location = /${panel_path}/api/v1/auth/session/check {
        internal;
        rewrite ^/${panel_path}/api/v1/auth/session/check$ /api/v1/auth/session break;
        proxy_pass http://${backend_host}:${backend_port};
        proxy_method GET;
        proxy_pass_request_body off;
        proxy_set_header Content-Length "";
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Prefix /${panel_path};
    }

    location ^~ /${panel_path}/api/ {
        auth_request /${panel_path}/api/v1/auth/session/check;
        rewrite ^/${panel_path}/(.*)$ /\$1 break;
        proxy_pass http://${backend_host}:${backend_port};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Prefix /${panel_path};
        proxy_set_header Authorization "Bearer ${operator_token}";
    }

    location = /${panel_path}/metrics {
        auth_request /${panel_path}/api/v1/auth/session/check;
        rewrite ^/${panel_path}/metrics$ /metrics break;
        proxy_pass http://${backend_host}:${backend_port};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Prefix /${panel_path};
        proxy_set_header Authorization "Bearer ${operator_token}";
    }

    location ^~ /${panel_path}/events/ {
        auth_request /${panel_path}/api/v1/auth/session/check;
        rewrite ^/${panel_path}/(.*)$ /\$1 break;
        proxy_pass http://${backend_host}:${backend_port};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Prefix /${panel_path};
        proxy_set_header Authorization "Bearer ${operator_token}";
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 1h;
        proxy_hide_header Content-Type;
        add_header Content-Type "text/event-stream; charset=utf-8" always;
        add_header Cache-Control "no-cache" always;
        gzip off;
    }

    location ^~ /${panel_path}/agent/ {
        rewrite ^/${panel_path}/(.*)$ /\$1 break;
        proxy_pass http://${backend_host}:${backend_port};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Prefix /${panel_path};
        proxy_set_header Authorization \$http_authorization;
    }

    location ^~ /sub/ {
        proxy_pass http://${backend_host}:${backend_port};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location ^~ /${panel_path}/ {
        try_files \$uri \$uri/ /${panel_path}/index.html;
    }

    location / {
        return 404;
    }
}
NGINX_EOF
}

write_managed_nginx_https() {
  local panel_path listen domain backend_host backend_port operator_token ssl_dir redirect_port http2_listen_suffix http2_directive
  panel_path="$(read_panel_path)"
  listen="$(read_listen_port)"
  domain="$(read_panel_domain)"
  backend_host="$(read_backend_env_value OU_UI_CONTROL_PLANE_HOST)"
  backend_port="$(read_backend_env_value OU_UI_CONTROL_PLANE_PORT)"
  operator_token="$(read_backend_env_value OU_UI_CONTROL_PLANE_OPERATOR_TOKEN)"
  ssl_dir="${CONFIG_DIR}/ssl"
  redirect_port=""

  [[ -n "${panel_path}" ]] || fail "无法刷新 Nginx：面板安全路径不可用。"
  [[ -n "${listen}" ]] || fail "无法刷新 Nginx：面板监听端口不可用。"
  [[ -n "${domain}" ]] || fail "无法刷新 Nginx：域名不可用。"
  [[ -f "${ssl_dir}/fullchain.cer" && -f "${ssl_dir}/${domain}.key" ]] || fail "无法刷新 Nginx：证书文件不可用。"
  [[ -n "${backend_host}" ]] || backend_host="127.0.0.1"
  [[ -n "${backend_port}" ]] || backend_port="${BACKEND_PORT_DEFAULT}"
  [[ -n "${operator_token}" ]] || fail "无法刷新 Nginx：后端 operator token 不可用。"

  if [[ "${listen}" != "443" ]]; then
    redirect_port=":${listen}"
  fi
  http2_listen_suffix="$(nginx_http2_listen_suffix)"
  http2_directive="$(nginx_http2_directive_line)"

  cat >"${NGINX_CONF}" <<NGINX_EOF
server {
    listen 80;
    server_name ${domain};
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
    listen ${listen} ssl${http2_listen_suffix} default_server;
${http2_directive}
    server_name ${domain};
    auth_basic off;

    ssl_certificate ${ssl_dir}/fullchain.cer;
    ssl_certificate_key ${ssl_dir}/${domain}.key;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:10m;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;

    root ${WEB_ROOT};
    index index.html;

    location = / {
        return 302 /${panel_path}/;
    }

    location = /${panel_path} {
        return 302 /${panel_path}/;
    }

    location = /${panel_path}/api/v1/auth/session {
        rewrite ^/${panel_path}/(.*)$ /\$1 break;
        proxy_pass http://${backend_host}:${backend_port};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Prefix /${panel_path};
    }

    location = /${panel_path}/api/v1/auth/session/check {
        internal;
        rewrite ^/${panel_path}/api/v1/auth/session/check$ /api/v1/auth/session break;
        proxy_pass http://${backend_host}:${backend_port};
        proxy_method GET;
        proxy_pass_request_body off;
        proxy_set_header Content-Length "";
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Prefix /${panel_path};
    }

    location ^~ /${panel_path}/api/ {
        auth_request /${panel_path}/api/v1/auth/session/check;
        rewrite ^/${panel_path}/(.*)$ /\$1 break;
        proxy_pass http://${backend_host}:${backend_port};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Prefix /${panel_path};
        proxy_set_header Authorization "Bearer ${operator_token}";
    }

    location = /${panel_path}/metrics {
        auth_request /${panel_path}/api/v1/auth/session/check;
        rewrite ^/${panel_path}/metrics$ /metrics break;
        proxy_pass http://${backend_host}:${backend_port};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Prefix /${panel_path};
        proxy_set_header Authorization "Bearer ${operator_token}";
    }

    location ^~ /${panel_path}/events/ {
        auth_request /${panel_path}/api/v1/auth/session/check;
        rewrite ^/${panel_path}/(.*)$ /\$1 break;
        proxy_pass http://${backend_host}:${backend_port};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Prefix /${panel_path};
        proxy_set_header Authorization "Bearer ${operator_token}";
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 1h;
        proxy_hide_header Content-Type;
        add_header Content-Type "text/event-stream; charset=utf-8" always;
        add_header Cache-Control "no-cache" always;
        gzip off;
    }

    location ^~ /${panel_path}/agent/ {
        rewrite ^/${panel_path}/(.*)$ /\$1 break;
        proxy_pass http://${backend_host}:${backend_port};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Prefix /${panel_path};
        proxy_set_header Authorization \$http_authorization;
    }

    location ^~ /sub/ {
        proxy_pass http://${backend_host}:${backend_port};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location ^~ /${panel_path}/ {
        try_files \$uri \$uri/ /${panel_path}/index.html;
    }

    location / {
        return 404;
    }
}
NGINX_EOF
}

refresh_nginx_panel_config() {
  require_root

  local domain
  domain="$(read_panel_domain)"

  if [[ -n "${domain}" && -f "${CONFIG_DIR}/ssl/fullchain.cer" && -f "${CONFIG_DIR}/ssl/${domain}.key" ]]; then
    write_managed_nginx_https
  else
    write_managed_nginx_http
  fi

  nginx -t
  systemctl reload nginx
  log "Nginx 面板站点已刷新，并强制关闭 Basic Auth。"
}

check_panel_surface() {
  local url headers status auth_header body attempt
  url="$(panel_url)"

  for attempt in 1 2 3 4 5; do
    headers="$(curl -k -sSIL --max-time 10 "${url}" 2>/dev/null || true)"
    [[ -n "${headers}" ]] && break
    sleep 1
  done

  if [[ -z "${headers}" ]]; then
    fail "面板 URL 自检连续 5 次未取到响应。请运行 ou d 查看诊断，检查 Nginx、端口冲突、DNS/证书和后端服务状态。"
  fi

  status="$(printf '%s\n' "${headers}" | awk '/^HTTP\// { code = $2 } END { print code }')"
  auth_header="$(printf '%s\n' "${headers}" | awk 'BEGIN { IGNORECASE=1 } /^WWW-Authenticate:/ { print; exit }')"

  if [[ "${auth_header}" =~ [Bb]asic ]] || [[ "${status}" == "401" ]]; then
    fail "面板 URL 仍返回 Basic Auth。请运行 ou d 查看冲突配置；如 443 被其它站点占用，建议重新配置到 8443/9443。"
  fi

  body="$(curl -k -sSL --max-time 10 "${url}" 2>/dev/null || true)"
  if ! printf '%s\n' "${body}" | grep -q '<title>OU-UI Next 控制面板</title>' ||
    ! printf '%s\n' "${body}" | grep -q 'id="root"'; then
    fail "面板 URL 没有返回 OU-UI Next 前端登录页。当前地址可能命中了旧站点、旧静态目录或错误 Nginx server block，请运行 ou d 查看诊断。"
  fi

  check_frontend_build_fingerprint "${url}"
  log "面板 URL 自检通过：已命中 OU-UI Next 前端登录页，未发现浏览器 Basic Auth 响应。"
}

do_update() {
  require_root

  if [[ "${OU_UI_NEXT_CLI_UPDATE_FROM_TEMP:-0}" != "1" ]]; then
    local temp_cli
    temp_cli="$(mktemp)"
    cp "$0" "${temp_cli}"
    chmod 700 "${temp_cli}"
    OU_UI_NEXT_CLI_UPDATE_FROM_TEMP=1 OU_UI_NEXT_CLI_UPDATE_TEMP_PATH="${temp_cli}" exec bash "${temp_cli}" update
  fi

  if [[ -n "${OU_UI_NEXT_CLI_UPDATE_TEMP_PATH:-}" ]]; then
    trap 'rm -f "${OU_UI_NEXT_CLI_UPDATE_TEMP_PATH}"' EXIT
  fi

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
  ensure_runtime_filesystem_permissions
  install_dependencies_and_build
  deploy_frontend_bundle
  if [[ -f "${APP_DIR}/scripts/install-master.sh" ]]; then
    bash "${APP_DIR}/scripts/install-master.sh" repair-cli
  fi
  systemctl restart "${SERVICE_NAME}"
  if [[ -x "/usr/local/bin/ou-ui-next" ]]; then
    /usr/local/bin/ou-ui-next repair-nginx
  else
    refresh_nginx_panel_config
    check_panel_surface
  fi
  warn_demo_inventory_residue
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
    check_empty_control_plane_inventory
    check_agent_install_command_surface
  elif [[ "${reset_answer}" != "--keep-state" && "${reset_answer}" != "keep-state" ]]; then
    read -r -p "是否清理旧运行状态/旧假数据？刚安装后看到演示主机时请输入 yes：" reset_answer
    if [[ "${reset_answer}" == "yes" ]]; then
      force_reset_control_plane_state
      check_empty_control_plane_inventory
      check_agent_install_command_surface
    fi
  fi

  nginx -t
  systemctl reload nginx
  check_panel_surface
  show_doctor
  show_credentials
}

run_clean_install_evidence_menu() {
  require_root

  local clean_answer fresh_answer
  read -r -p "请确认这台服务器在安装 OU-UI Next 前是干净服务器；输入 yes 继续：" clean_answer
  [[ "${clean_answer}" == "yes" ]] || fail "已取消生成干净服务器安装证据：未确认干净服务器。"

  read -r -p "请确认本次证据来自 fresh install，而非更新/修复；输入 yes 继续：" fresh_answer
  [[ "${fresh_answer}" == "yes" ]] || fail "已取消生成干净服务器安装证据：未确认 fresh install。"

  write_clean_install_evidence --clean-server-confirmed --fresh-install-confirmed
}

run_archive_provider_evidence_menu() {
  require_root

  local report_path delivery_answer object_lock_answer retention_answer
  read -r -p "请输入已通过的 archive-smoke-report.json 路径：" report_path
  [[ -n "${report_path}" ]] || fail "已取消生成归档 provider 侧证据：缺少 archive smoke report。"

  read -r -p "请确认 provider 侧对象存储已收到这些归档对象；输入 yes 继续：" delivery_answer
  [[ "${delivery_answer}" == "yes" ]] || fail "已取消生成归档 provider 侧证据：未确认对象存储投递。"

  read -r -p "请确认 provider 侧 bucket 已启用 Object Lock；输入 yes 继续：" object_lock_answer
  [[ "${object_lock_answer}" == "yes" ]] || fail "已取消生成归档 provider 侧证据：未确认 bucket Object Lock。"

  read -r -p "请确认 provider 侧 retention 策略已生效；输入 yes 继续：" retention_answer
  [[ "${retention_answer}" == "yes" ]] || fail "已取消生成归档 provider 侧证据：未确认 retention 策略。"

  write_archive_provider_evidence \
    --archive-smoke-report "${report_path}" \
    --object-storage-delivery-confirmed \
    --bucket-object-lock-confirmed \
    --retention-policy-confirmed
}

run_timestamp_evidence_menu() {
  require_root

  local artifact_path receipt_path timestamped_at timestamp_answer sanitize_answer verify_answer
  read -r -p "请输入被第三方时间戳锚定的脱敏 artifact 路径：" artifact_path
  [[ -n "${artifact_path}" ]] || fail "已取消生成第三方时间戳证据：缺少 artifact。"

  read -r -p "请输入已脱敏的第三方时间戳 receipt 路径：" receipt_path
  [[ -n "${receipt_path}" ]] || fail "已取消生成第三方时间戳证据：缺少 receipt。"

  read -r -p "请输入第三方 receipt 记录的 timestampedAt 时间：" timestamped_at
  [[ -n "${timestamped_at}" ]] || fail "已取消生成第三方时间戳证据：缺少 timestampedAt。"

  read -r -p "请确认 receipt 来自第三方时间戳服务；输入 yes 继续：" timestamp_answer
  [[ "${timestamp_answer}" == "yes" ]] || fail "已取消生成第三方时间戳证据：未确认第三方时间戳。"

  read -r -p "请确认 receipt 已脱敏且不包含 token/secret/完整私密 URL；输入 yes 继续：" sanitize_answer
  [[ "${sanitize_answer}" == "yes" ]] || fail "已取消生成第三方时间戳证据：未确认 receipt 脱敏。"

  read -r -p "请确认 receipt 已完成验证；输入 yes 继续：" verify_answer
  [[ "${verify_answer}" == "yes" ]] || fail "已取消生成第三方时间戳证据：未确认 receipt 验证。"

  write_timestamp_evidence \
    --artifact "${artifact_path}" \
    --receipt "${receipt_path}" \
    --timestamped-at "${timestamped_at}" \
    --third-party-timestamp-confirmed \
    --receipt-sanitized \
    --verification-confirmed
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
  9) 备份控制面状态
  10) 从备份恢复控制面状态
  11) 重置控制面状态
  12) 轮换登录凭据
  13) 卸载面板
  14) 一键修复安装异常
  15) 运行生产烟测
  16) 运行浏览器烟测
  17) 运行通知烟测
  18) 生成生产验收证据包
  19) 校验生产验收证据包
  20) 运行 webhook 烟测
  21) 运行最终现场验收
  22) 复核最终现场验收证据包
  23) 运行外部归档烟测
  24) 生成干净服务器安装证据摘要
  25) 生成归档 provider 侧不可变证据摘要
  26) 全量生产发布复核
  27) 运行全量生产发布验收
  0) 退出
EOT
    echo "快捷键：p=面板信息 c=登录信息 rc=轮换登录凭据 s=服务状态 l=实时日志 rs=重启服务 u=更新 b=备份 rb=恢复 r=重置状态 m=改端口/证书 d=诊断 sm=生产烟测 bs=浏览器烟测 ns=通知烟测 ws=webhook烟测 as=归档烟测 ape=归档provider证据 te=时间戳证据 cie=干净安装证据 qa=验收证据 qv=校验证据 qf=最终验收 qvf=最终复核 qvr=发布复核 qfa=发布验收 f=一键修复 x=卸载"
    read -r -p "请选择操作: " choice

    case "${choice}" in
      1|p|P) panel_url ;;
      2|c|C) show_credentials ;;
      3|s|S) systemctl status "${SERVICE_NAME}" --no-pager ;;
      4|l|L) journalctl -u "${SERVICE_NAME}" -f ;;
      5|rs|RS)
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
      9|b|B) backup_control_plane_state ;;
      10|rb|RB|restore|RESTORE) read -r -p "请输入备份文件路径： " backup_file; restore_control_plane_state "${backup_file}" ;;
      11|r|R) reset_control_plane_state ;;
      12|rc|RC|rotate|ROTATE) rotate_operator_credentials ;;
      14|f|F|fix|FIX|repair|REPAIR) do_quick_fix ;;
      15|sm|SM|smoke|SMOKE) run_production_smoke ;;
      16|bs|BS|browser-smoke|BROWSER-SMOKE|smoke-browser|SMOKE-BROWSER) run_production_browser_smoke ;;
      17|ns|NS|notification-smoke|NOTIFICATION-SMOKE|smoke-notification|SMOKE-NOTIFICATION) run_production_notification_smoke ;;
      18|qa|QA|acceptance|ACCEPTANCE|accept|ACCEPT) run_production_acceptance ;;
      19|qv|QV|verify-acceptance|VERIFY-ACCEPTANCE|acceptance-verify|ACCEPTANCE-VERIFY)
        read -r -p "请输入验收证据包目录或 manifest.json 路径：" acceptance_path
        verify_production_acceptance "${acceptance_path}"
        ;;
      20|ws|WS|webhook-smoke|WEBHOOK-SMOKE|smoke-webhook|SMOKE-WEBHOOK) run_production_webhook_smoke ;;
      21|qf|QF|final-acceptance|FINAL-ACCEPTANCE|acceptance-final|ACCEPTANCE-FINAL|field-acceptance|FIELD-ACCEPTANCE) run_final_production_acceptance ;;
      22|qvf|QVF|final-acceptance-verify|FINAL-ACCEPTANCE-VERIFY|verify-final-acceptance|VERIFY-FINAL-ACCEPTANCE|field-acceptance-verify|FIELD-ACCEPTANCE-VERIFY)
        read -r -p "请输入最终验收证据包目录或 manifest.json 路径：" final_acceptance_path
        verify_final_production_acceptance_bundle "${final_acceptance_path}"
        ;;
      23|as|AS|archive-smoke|ARCHIVE-SMOKE|smoke-archive|SMOKE-ARCHIVE|external-archive-smoke|EXTERNAL-ARCHIVE-SMOKE) run_production_archive_smoke ;;
      24|cie|CIE|clean-install-evidence|CLEAN-INSTALL-EVIDENCE|install-evidence-summary|INSTALL-EVIDENCE-SUMMARY|clean-install-summary|CLEAN-INSTALL-SUMMARY) run_clean_install_evidence_menu ;;
      25|ape|APE|archive-provider-evidence|ARCHIVE-PROVIDER-EVIDENCE|provider-evidence|PROVIDER-EVIDENCE|archive-provider-summary|ARCHIVE-PROVIDER-SUMMARY) run_archive_provider_evidence_menu ;;
      26|te|TE|timestamp-evidence|TIMESTAMP-EVIDENCE|timestamp-summary|TIMESTAMP-SUMMARY|timestamp-proof|TIMESTAMP-PROOF) run_timestamp_evidence_menu ;;
      27|qvr|QVR|production-release-verify|PRODUCTION-RELEASE-VERIFY|release-verify|RELEASE-VERIFY|field-release-verify|FIELD-RELEASE-VERIFY)
        read -r -p "请输入最终验收证据包目录或 manifest.json 路径：" release_acceptance_path
        verify_production_release_acceptance_bundle "${release_acceptance_path}"
        ;;
      28|qfa|QFA|production-release-acceptance|PRODUCTION-RELEASE-ACCEPTANCE|release-acceptance|RELEASE-ACCEPTANCE|field-release-acceptance|FIELD-RELEASE-ACCEPTANCE)
        log "全量生产发布验收需要命令行传入 Telegram、archive/provider/timestamp/clean-install/Agent 证据参数；请运行 'ou qfa --help' 查看用法。"
        ;;
      13|x|X) do_uninstall ;;
      0|q|Q) break ;;
      *) log "未知选项。" ;;
    esac
  done
}

is_help_flag() {
  case "${1:-}" in
    help|--help|-h) return 0 ;;
    *) return 1 ;;
  esac
}

show_credentials_help() {
  cat <<'EOT'
用法: ou-ui-next credentials

打印完整面板地址、登录账号和登录密码。该命令不接受额外参数；需要查看帮助时可运行 credentials --help，本帮助不会读取或输出任何登录凭据。
别名: credential, login, info, c, i
EOT
}

show_smoke_help() {
  cat <<'EOT'
用法: ou-ui-next smoke [生产烟测参数]

运行生产入口烟测，验证当前面板 URL、登录 session、CSRF 防护、受保护 API、SSE 和 /metrics。命令会自动使用安装器生成的面板地址，并默认读取 root-only 凭据文件；不会打印登录密码、cookie、CSRF token 或后端 bearer token。

常用参数:
  --report <path>     写入脱敏 JSON 烟测报告，便于归档现场验收证据
  --skip-csrf-probe  跳过缺 CSRF 的拒绝探针，执行只读烟测
  --insecure-tls     允许自签名 HTTPS 证书
  --require-runtime-evidence
                      要求报告中存在 Agent session、Xray inbound、端口转发规则，且无 critical 告警/命令死信

非 root 用户可通过 OU_UI_SMOKE_USERNAME / OU_UI_SMOKE_PASSWORD 显式提供凭据。
别名: smoke-production, production-smoke, sm
EOT
}

show_browser_smoke_help() {
  cat <<'EOT'
用法: ou-ui-next browser-smoke [浏览器烟测参数]

运行真实浏览器业务流烟测，使用安装器生成的面板地址和 root-only 凭据文件完成登录、关键页面导航、截图取证和退出登录。报告不会写入登录密码、cookie、CSRF token 或 bearer token。

常用参数:
  --report <path>          写入脱敏 JSON 浏览器烟测报告
  --screenshot-dir <path>  保存每一步通过后的浏览器截图
  --timeout-ms <ms>        页面操作超时
  --insecure-tls           允许自签名 HTTPS 证书
  --headed                 使用有界面浏览器，默认 headless

如果提示缺少浏览器二进制或系统依赖，可在安装目录运行 npx playwright install chromium 后重试。
别名: smoke-browser, bs
EOT
}

show_notification_smoke_help() {
  cat <<'EOT'
用法: ou-ui-next notification-smoke [通知烟测参数]

运行真实外部通知烟测，使用安装器生成的面板地址和 root-only 凭据文件登录面板，并调用 Telegram 测试通知 API。该命令会真实发送一条 Telegram 测试通知，报告不会写入登录密码、cookie、CSRF token、bot token 或 chat id。

常用参数:
  --telegram-admin-chat-id <id>  向管理员 chat 发送测试通知
  --telegram-binding-id <id>     向已绑定客户发送测试通知
  --report <path>                写入脱敏 JSON 通知烟测报告
  --timeout-ms <ms>              单请求超时
  --insecure-tls                 允许自签名 HTTPS 证书
  --language <zh|en>             覆盖测试通知语言

别名: smoke-notification, notifications, ns
EOT
}

show_webhook_smoke_help() {
  cat <<'EOT'
用法: ou-ui-next webhook-smoke [webhook 烟测参数]

运行真实外部 webhook 烟测，默认读取后端 env 中的 OU_UI_SYSTEM_ALERT_WEBHOOK_URL / OU_UI_SYSTEM_ALERT_WEBHOOK_URLS 和 bearer token，向每个目标发送一条脱敏测试 JSON。报告不会写入 bearer token、完整 URL path 或 query。

常用参数:
  --url <url>                  指定一个 webhook 目标，可重复
  --urls <csv>                 指定逗号分隔的多个 webhook 目标
  --report <path>              写入脱敏 JSON webhook 烟测报告
  --timeout-ms <ms>            单目标超时
  --bearer-token-file <path>   从 root-only 文件读取 bearer token
  --allow-local                允许本机/私网目标，仅用于实验室测试

别名: smoke-webhook, webhooks, ws
EOT
}

show_archive_smoke_help() {
  cat <<'EOT'
用法: ou-ui-next archive-smoke [归档烟测参数]

运行真实外部归档 smoke，默认读取后端 env 中的 OU_UI_EXTERNAL_ARCHIVE_DIRECTORY、OU_UI_EXTERNAL_ARCHIVE_WEBHOOK_URL(S) 和 S3 兼容对象存储配置，写入一条脱敏审计锚点、一条 Agent 日志归档摘要和一条流量压缩归档桶。该命令会真实写本地归档目录、外部归档 webhook 和对象存储；报告不会写入 webhook token、对象存储密钥或完整 URL path/query。

常用参数:
  --report <path>              写入脱敏 JSON 归档 smoke 报告
  --env-file <path>            读取指定后端 env 文件，默认使用当前安装的 master.env

别名: smoke-archive, external-archive-smoke, as
EOT
}

show_archive_provider_evidence_help() {
  cat <<'EOT'
用法: ou-ui-next archive-provider-evidence [证据参数]

生成脱敏的归档 provider 侧不可变/保留策略证据 JSON，默认写入 /var/lib/ou-ui-next/acceptance/archive-provider-evidence-<UTC>.json。该摘要可用 `ou qa --archive-provider-evidence <文件>` 纳入验收包并自动接入 provider strict gate；仍可用通用 `--external-receipt` 附加其他脱敏回执。

常用:
  sudo ou archive-provider-evidence --archive-smoke-report /var/lib/ou-ui-next/acceptance/archive-smoke.json --object-storage-delivery-confirmed --bucket-object-lock-confirmed --retention-policy-confirmed
  sudo ou archive-provider-evidence --bucket archive-bucket --object-count 3 --retention-mode GOVERNANCE --retention-days 30 --legal-hold-enabled true --object-storage-delivery-confirmed --bucket-object-lock-confirmed --retention-policy-confirmed
  sudo ou archive-provider-evidence --archive-smoke-report /var/lib/ou-ui-next/acceptance/archive-smoke.json --output /root/ou-ui-receipts/archive-provider-evidence.json --object-storage-delivery-confirmed --bucket-object-lock-confirmed --retention-policy-confirmed
  sudo ou qv --require-archive-provider-evidence /var/lib/ou-ui-next/acceptance/20260606T120000Z

参数:
  --archive-smoke-report <path>        读取已通过的脱敏 archive-smoke-report.json，复用 endpoint/bucket/objectLock/delivery 摘要
  --output <path>                      指定输出 JSON 路径
  --provider <label>                   记录脱敏 provider 标签，默认 object-storage；仅允许短标签
  --endpoint <origin>                  记录脱敏对象存储 URL origin；不能包含 credentials、path、query 或 fragment
  --bucket <name>                      记录脱敏 bucket 名
  --object-count <count>               记录 provider 侧对象数量；未传时尝试从 archive smoke object_storage delivered 记录推导
  --retention-mode <mode>              GOVERNANCE 或 COMPLIANCE；未传时尝试从 archive smoke objectLock 摘要推导
  --retention-days <days>              记录保留天数；也可用 --retention-until
  --retention-until <time>             记录 provider 侧 retain-until 时间
  --legal-hold-enabled <true|false>    记录 legal hold 状态；未传时尝试从 archive smoke objectLock 摘要推导
  --object-storage-delivery-confirmed  明确确认 provider 侧对象存储已收到归档对象
  --bucket-object-lock-confirmed       明确确认 provider 侧 bucket Object Lock 已启用
  --retention-policy-confirmed         明确确认 provider 侧 retention 策略已生效

别名: provider-evidence, archive-provider-summary, ape
EOT
}

show_timestamp_evidence_help() {
  cat <<'EOT'
用法: ou-ui-next timestamp-evidence [证据参数]

生成脱敏的第三方时间戳证据 JSON，默认写入 /var/lib/ou-ui-next/acceptance/timestamp-evidence-<UTC>.json。该摘要只记录被锚定 artifact 和第三方时间戳 receipt 的 basename、大小、SHA-256 以及显式 operator 确认，不复制 receipt 原文；可用 `ou qa --timestamp-evidence <文件>` 纳入验收包，并用 `ou qv --require-timestamp-evidence` 作为严格门槛复核。

常用:
  sudo ou timestamp-evidence --artifact /root/ou-ui-receipts/archive-provider-evidence.json --receipt /root/ou-ui-receipts/archive-provider-evidence.tsr.redacted --timestamped-at 2026-06-07T12:00:00Z --third-party-timestamp-confirmed --receipt-sanitized --verification-confirmed
  sudo ou timestamp-evidence --artifact /root/ou-ui-receipts/archive-provider-evidence.json --receipt /root/ou-ui-receipts/archive-provider-evidence.ots.redacted --provider opentimestamps --proof-type ots --timestamped-at 2026-06-07T12:00:00Z --verified-at 2026-06-07T12:05:00Z --output /root/ou-ui-receipts/timestamp-evidence.json --third-party-timestamp-confirmed --receipt-sanitized --verification-confirmed
  sudo ou qv --require-timestamp-evidence /var/lib/ou-ui-next/acceptance/20260606T120000Z

参数:
  --artifact <path>                     被第三方时间戳锚定的脱敏 artifact；只记录 basename/size/SHA-256
  --receipt <path>                      已脱敏的第三方时间戳 receipt；只记录 basename/size/SHA-256
  --output <path>                       指定输出 JSON 路径
  --provider <label>                    记录脱敏 provider 标签，默认 timestamp-authority；仅允许短标签
  --proof-type <label>                  记录脱敏证明类型，默认 rfc3161；例如 rfc3161 / ots
  --timestamped-at <time>               第三方 receipt 记录的时间戳时间
  --verified-at <time>                  可选，operator 复核 receipt 的时间
  --third-party-timestamp-confirmed     明确确认 receipt 来自第三方时间戳服务
  --receipt-sanitized                   明确确认 receipt 文件已经脱敏
  --verification-confirmed              明确确认 receipt 已被 operator 或工具验证

别名: timestamp-summary, timestamp-proof, te
EOT
}

show_clean_install_evidence_help() {
  cat <<'EOT'
用法: ou-ui-next clean-install-evidence [证据参数]

生成脱敏的干净服务器安装证据摘要 JSON，默认写入 /var/lib/ou-ui-next/acceptance/clean-install-evidence-<UTC>.json。该摘要可用 `ou qa --install-evidence <文件>` 纳入验收包，并用 `ou qv --require-clean-install-evidence` 作为严格门槛复核。

常用:
  sudo ou clean-install-evidence --clean-server-confirmed --fresh-install-confirmed
  sudo ou clean-install-evidence --clean-server-confirmed --fresh-install-confirmed --transcript /root/ou-ui-receipts/install-transcript.redacted.txt
  sudo ou clean-install-evidence --clean-server-confirmed --fresh-install-confirmed --output /root/ou-ui-receipts/clean-install-summary.json

参数:
  --clean-server-confirmed       明确确认本次证据来自干净服务器
  --fresh-install-confirmed      明确确认本次证据来自 fresh install，而非更新/修复
  --transcript <path>            记录已脱敏安装 transcript 的 basename、大小和 SHA-256，不复制原文
  --output <path>                指定输出 JSON 路径
  --source <label>               记录脱敏安装来源标签，默认 github；仅允许短标签，不允许 URL/路径
  --installer-exit-code <code>    记录安装器退出码；严格安装证据要求为 0
  --service-active-confirmed     在已有外部证据时确认后端服务已运行
  --management-cli-confirmed     在已有外部证据时确认管理 CLI 已安装
  --panel-reachable-confirmed    在已有外部证据时确认面板入口可访问
  --frontend-login-confirmed     在已有外部证据时确认前端登录页可访问

别名: install-evidence-summary, clean-install-summary, cie
EOT
}

show_acceptance_help() {
  cat <<'EOT'
用法: ou-ui-next acceptance [生产烟测参数]

生成生产验收证据包，默认写入 /var/lib/ou-ui-next/acceptance/<UTC 时间>/。证据包包含安装诊断输出、HTTP 生产烟测、浏览器业务流烟测、通知/webhook/归档烟测跳过或执行记录、可选外部 provider 回执/第三方时间戳附件、可选干净服务器安装证据附件、可选 Agent 主机证据附件、脱敏 JSON 报告、截图归档和带文件大小/SHA-256 的 manifest，可直接用于真实部署验收归档。该命令需要 root 权限。

常用:
  sudo ou qa
  sudo ou qa --skip-csrf-probe
  sudo ou qa --skip-browser-smoke
  sudo ou qa --require-runtime-evidence
  sudo ou qa --include-notification-smoke --telegram-admin-chat-id 123456
  sudo ou qa --include-webhook-smoke --webhook-url https://hooks.example.com/ou-ui-alerts
  sudo ou qa --include-archive-smoke
  sudo ou qa --external-receipt /root/ou-ui-receipts/provider-receipt.json
  sudo ou qa --archive-provider-evidence /root/ou-ui-receipts/archive-provider-evidence.json
  sudo ou qa --timestamp-evidence /root/ou-ui-receipts/timestamp-evidence.json
  sudo ou qa --install-evidence /root/ou-ui-receipts/clean-install-summary.json
  sudo ou qa --agent-evidence /var/lib/ou-agent/acceptance/20260606T120000Z
  sudo ou qa --timeout-ms 30000

可透传参数: --timeout-ms、--insecure-tls、--skip-csrf-probe、--skip-browser-smoke、--require-runtime-evidence、--include-notification-smoke、--telegram-admin-chat-id、--telegram-binding-id、--notification-language、--include-webhook-smoke、--webhook-url、--webhook-urls、--webhook-bearer-token、--webhook-bearer-token-file、--allow-local-webhook、--include-archive-smoke、--external-receipt、--archive-provider-evidence、--timestamp-evidence、--install-evidence、--agent-evidence、--require-archive-provider-evidence、--require-timestamp-evidence、--require-clean-install-evidence
说明: --archive-provider-evidence 会复制到 external-receipts/，并在最终验收 qf 中自动启用 --require-external-receipts 与 --require-archive-provider-evidence；--timestamp-evidence 同样复制到 external-receipts/，并自动启用 --require-external-receipts 与 --require-timestamp-evidence；--external-receipt 保持通用附件语义，不会自动声明 provider 不可变策略或第三方时间戳已通过。
保留参数: --report、--base-url、--credentials-file、--screenshot-dir、--env-file 由证据包命令固定管理，避免 manifest 与现场证据不一致。

别名: accept, qa, evidence, evidence-bundle
EOT
}

show_acceptance_verify_help() {
  cat <<'EOT'
用法: ou-ui-next acceptance-verify [校验参数] <证据包目录或 manifest.json>

校验 `ou qa` 生成的生产验收证据包，读取 manifest 中记录的文件大小和 SHA-256，并核对当前证据包目录内的 doctor.txt、smoke.txt、smoke-report.json、浏览器烟测报告、通知烟测报告、webhook 烟测报告、外部回执附件、安装证据附件、Agent 主机证据附件和截图归档是否未被改动。旧证据包没有浏览器、通知、webhook、外部回执、安装证据或 Agent 证据条目时仍会按旧三件套校验。默认只校验证据完整性，不要求后端服务在线；显式追加 require 参数时，会对已归档报告内容执行生产验收门槛检查。

常用:
  sudo ou qv /var/lib/ou-ui-next/acceptance/20260606T120000Z
  sudo ou qv /var/lib/ou-ui-next/acceptance/20260606T120000Z/manifest.json
  sudo ou qv --require-runtime-evidence --require-browser-smoke /var/lib/ou-ui-next/acceptance/20260606T120000Z
  sudo ou qv --require-runtime-evidence --require-browser-smoke --require-notification-smoke --require-webhook-smoke /var/lib/ou-ui-next/acceptance/20260606T120000Z
  sudo ou qv --require-archive-smoke /var/lib/ou-ui-next/acceptance/20260606T120000Z
  sudo ou qv --require-external-receipts /var/lib/ou-ui-next/acceptance/20260606T120000Z
  sudo ou qv --require-archive-provider-evidence /var/lib/ou-ui-next/acceptance/20260606T120000Z
  sudo ou qv --require-timestamp-evidence /var/lib/ou-ui-next/acceptance/20260606T120000Z
  sudo ou qv --require-clean-install-evidence /var/lib/ou-ui-next/acceptance/20260606T120000Z
  sudo ou qv --require-agent-evidence /var/lib/ou-ui-next/acceptance/20260606T120000Z
  sudo ou qv --require-agent-final-summary /var/lib/ou-ui-next/acceptance/20260606T120000Z
  sudo ou qv --require-final-summary /var/lib/ou-ui-next/acceptance/20260606T120000Z
  sudo ou qv --require-release-summary /var/lib/ou-ui-next/acceptance/20260606T120000Z

校验参数:
  --require-runtime-evidence     要求 manifest.bundleDirectory 非空，且 smoke-report.json 中 runtime acceptance summary 满足 Agent/Xray/端口转发现场门槛
  --require-browser-smoke        要求浏览器烟测未跳过、browser-smoke-report.json status=passed 且截图归档存在
  --require-notification-smoke   要求通知烟测未跳过且 notification-smoke-report.json status=passed/delivered
  --require-webhook-smoke        要求 webhook 烟测未跳过且 webhook-smoke-report.json status=passed/目标 URL 已脱敏
  --require-archive-smoke        要求归档烟测未跳过且 archive-smoke-report.json status=passed/目标已脱敏
  --require-external-receipts    要求 external-receipts-manifest.json 至少包含一个外部 provider 回执文件且 SHA-256 匹配
  --require-archive-provider-evidence 要求外部回执中至少一个脱敏 JSON 符合 ou-ui-next.archive-provider-evidence.v1，并证明对象存储投递和 provider 侧 Object Lock/retention 策略
  --require-timestamp-evidence 要求外部回执中至少一个脱敏 JSON 符合 ou-ui-next.timestamp-evidence.v1，并证明第三方时间戳 receipt 已脱敏、已验证且 hash 匹配
  --require-clean-install-evidence 要求 install-evidence-manifest.json 至少包含一个脱敏 JSON 符合 ou-ui-next.clean-install-evidence.v1，并证明干净服务器 fresh install 已通过
  --require-agent-evidence       要求 agent-evidence-manifest.json 至少包含一个 Agent 主机证据包、Agent manifest.bundleDirectory 非空、serviceStatus=0、runtimeSummaryStatus=0 且 runtime-summary 满足 Xray/端口转发门槛
  --require-agent-final-summary  要求 Agent 主机证据包包含 ou-agent qf 生成的 final-acceptance-summary.json、有效 UTC createdAt、与 Agent manifest.bundleDirectory 一致的非空 bundleDirectory 和校验 transcript
  --require-final-summary        要求 final-acceptance-summary.json 记录有效 UTC createdAt、与 manifest.bundleDirectory 一致的非空 bundleDirectory，且和 final-acceptance-verify.txt 完整匹配
  --require-release-summary      要求 release-acceptance-summary.json 记录有效 UTC createdAt、与 manifest.bundleDirectory 或当前证据包目录一致的非空 bundleDirectory，且和 release-acceptance-verify.txt 完整匹配，并把全量发布复核 gate 标记提升为本次内容校验

别名: verify-acceptance, qa-verify, qv, evidence-verify
EOT
}

show_final_acceptance_help() {
  cat <<'EOT'
用法: ou-ui-next final-acceptance [生产验收参数]

运行最终现场验收：先生成 `ou qa` 证据包，再立即执行严格 `ou qv --require-runtime-evidence --require-browser-smoke --require-notification-smoke --require-webhook-smoke`；若本次显式传入 --include-archive-smoke、--external-receipt、--archive-provider-evidence、--timestamp-evidence、--require-archive-provider-evidence、--require-timestamp-evidence、--install-evidence、--require-clean-install-evidence 或 --agent-evidence，会自动追加对应 strict gate。生产发布编排 `ou qfa` 还会要求 Agent final summary，并把 agentFinalSummary 写入 Master final summary。随后保存可用 `ou qv --require-final-summary` 复核的 final-acceptance-summary.json。该命令不会降级或伪造通过；缺少真实 Agent/Xray/端口转发现场证据、浏览器烟测、Telegram 测试目标、webhook 目标或显式要求的外部证据时会失败并保留失败报告。

常用:
  sudo ou qf --telegram-admin-chat-id 123456
  sudo ou qf --telegram-binding-id telegram-binding-001 --notification-language en
  sudo ou qf --telegram-admin-chat-id 123456 --webhook-url https://hooks.example.com/ou-ui-alerts
  sudo ou qf --telegram-admin-chat-id 123456 --include-archive-smoke --external-receipt /root/ou-ui-receipts/provider-receipt.json --require-archive-provider-evidence
  sudo ou qf --telegram-admin-chat-id 123456 --archive-provider-evidence /root/ou-ui-receipts/archive-provider-evidence.json
  sudo ou qf --telegram-admin-chat-id 123456 --timestamp-evidence /root/ou-ui-receipts/timestamp-evidence.json
  sudo ou qf --telegram-admin-chat-id 123456 --install-evidence /root/ou-ui-receipts/clean-install-summary.json
  sudo ou qf --telegram-admin-chat-id 123456 --agent-evidence /var/lib/ou-agent/acceptance/20260606T120000Z

要求:
  - 必须提供 --telegram-admin-chat-id 或 --telegram-binding-id
  - 自动启用 --require-runtime-evidence、--include-notification-smoke 和 --include-webhook-smoke
  - 显式传入 --include-archive-smoke、--external-receipt、--archive-provider-evidence、--timestamp-evidence、--require-archive-provider-evidence、--require-timestamp-evidence、--install-evidence、--require-clean-install-evidence 或 --agent-evidence 时，会自动把对应 strict gate 写入 final summary；通过 qfa 运行时还会写入 agentFinalSummary gate
  - --archive-provider-evidence 会自动启用 external receipt 与 archive provider evidence 两个 strict gate；它只接线脱敏证据，不替代真实 provider 控制台/API 证明
  - --timestamp-evidence 会自动启用 external receipt 与 timestamp evidence 两个 strict gate；它只接线脱敏 receipt 摘要，不替代真实第三方时间戳服务回执
  - 禁止 --skip-browser-smoke
  - webhook 目标可来自后端 env 的 OU_UI_SYSTEM_ALERT_WEBHOOK_URL(S)，也可用 --webhook-url/--webhook-urls 显式提供

别名: acceptance-final, field-acceptance, qf
EOT
}

show_production_release_acceptance_help() {
  cat <<'EOT'
用法: ou-ui-next production-release-acceptance [生产发布验收参数]

运行全量生产发布验收：先执行严格 `ou qf` 生成最终现场验收证据包，再立即对同一证据包执行 `ou qvr` 全量生产发布复核，并把发布复核 transcript 保存为 release-acceptance-verify.txt、机器摘要保存为 release-acceptance-summary.json。该命令要求真实 archive smoke、provider evidence、第三方时间戳 evidence、干净安装 evidence 和 Agent evidence 都显式接入；缺少任一项都会失败，不会把普通最终验收误认为生产发布完成。

常用:
  sudo ou qfa --telegram-admin-chat-id 123456 --include-archive-smoke --archive-provider-evidence /root/ou-ui-receipts/archive-provider-evidence.json --timestamp-evidence /root/ou-ui-receipts/timestamp-evidence.json --install-evidence /root/ou-ui-receipts/clean-install-summary.json --agent-evidence /var/lib/ou-agent/acceptance/20260606T120000Z

要求:
  - 必须提供 --telegram-admin-chat-id 或 --telegram-binding-id
  - 必须提供 --include-archive-smoke
  - 必须提供 --archive-provider-evidence <path>
  - 必须提供 --timestamp-evidence <path>
  - 必须提供 --install-evidence <path>
  - 必须提供 --agent-evidence <bundle>
  - 在触发 qf/smoke 前预检 provider、timestamp、clean-install 和 Agent 证据路径与内容
  - Agent 证据必须包含 ou-agent qf 生成的 final-acceptance-summary.json 和校验 transcript
  - 自动启用 qf 的 runtime/通知/webhook/browser strict gate，要求 Master final summary 记录 agentFinalSummary gate，并在 qf 通过后自动执行 qvr 全量复核，保存 release-acceptance-verify.txt 和 release-acceptance-summary.json

别名: release-acceptance, field-release-acceptance, qfa
EOT
}

show_final_acceptance_verify_help() {
  cat <<'EOT'
用法: ou-ui-next final-acceptance-verify <证据包目录或 manifest.json>

复核 `ou qf` 生成的最终现场验收证据包，相当于一次性执行 `ou qv --require-runtime-evidence --require-browser-smoke --require-notification-smoke --require-webhook-smoke --require-final-summary`。若 final summary 记录了 archive smoke、external receipts、archive provider evidence、timestamp evidence、clean install evidence、Agent evidence 或 Agent final summary strict gate，会自动把这些记录提升为本次 strict gate，重新校验对应归档内容，要求 final summary 的 createdAt 是有效 UTC ISO 时间、bundleDirectory 与 manifest.bundleDirectory 保持一致，并要求 final-acceptance-verify.txt 保留对应通过标记。用于归档、传输或交付后确认 runtime、浏览器、Telegram、webhook、可选外部证据、可选干净安装证据、可选 Agent 证据和 final summary 证据仍完整匹配。

常用:
  sudo ou qvf /var/lib/ou-ui-next/acceptance/20260606T120000Z
  sudo ou qvf /var/lib/ou-ui-next/acceptance/20260606T120000Z/manifest.json

别名: verify-final-acceptance, field-acceptance-verify, qvf
EOT
}

show_production_release_verify_help() {
  cat <<'EOT'
用法: ou-ui-next production-release-verify [--write-summary] <证据包目录或 manifest.json>

执行全量生产发布复核，相当于一次性执行 `ou qv --require-runtime-evidence --require-browser-smoke --require-notification-smoke --require-webhook-smoke --require-archive-smoke --require-external-receipts --require-archive-provider-evidence --require-timestamp-evidence --require-clean-install-evidence --require-agent-evidence --require-agent-final-summary --require-final-summary`。该入口要求最终验收摘要也记录 archive smoke、外部回执、provider evidence、timestamp evidence、干净安装、Agent evidence 和 Agent final summary strict gate，并要求 Agent 证据来自 `ou-agent qf` 最终主机验收输出，不会因为 `ou qf` 当时漏传可选证据而放宽发布门槛。若证据包已包含 `release-acceptance-summary.json`，还会自动复核 release summary 与 `release-acceptance-verify.txt` 的哈希，要求 release summary 的 createdAt 是有效 UTC ISO 时间、bundleDirectory 与 manifest.bundleDirectory 或当前证据包目录保持一致，并把 release summary 记录的全量 gate 提升为本次内容校验。

常用:
  sudo ou qvr /var/lib/ou-ui-next/acceptance/20260606T120000Z
  sudo ou qvr /var/lib/ou-ui-next/acceptance/20260606T120000Z/manifest.json
  sudo ou qvr --write-summary /var/lib/ou-ui-next/acceptance/20260606T120000Z

参数:
  --write-summary  将本次 qvr transcript 写入 release-acceptance-verify.txt，并写入/覆盖 release-acceptance-summary.json

别名: release-verify, field-release-verify, qvr
EOT
}

show_cli_help() {
  cat <<'EOT'
用法: ou-ui-next <命令>

不带参数时会直接打开快捷菜单。涉及更新、重配、重启、重置和卸载时请使用 root 执行，例如：sudo ou f。
常用快捷: ou p=面板信息, ou c=登录信息, ou rc=轮换登录凭据, ou rs=重启服务, ou u=更新, ou b=备份状态, ou r=重置状态, ou m=改端口/证书, ou d=诊断, ou sm=生产烟测, ou bs=浏览器烟测, ou ns=通知烟测, ou ws=webhook烟测, ou as=归档烟测, ou ape=归档provider证据, ou te=时间戳证据, ou cie=干净安装证据, ou qa=验收证据, ou qv=校验证据, ou qf=最终验收, ou qvf=最终复核, ou qvr=发布复核, ou qfa=发布验收, ou f=一键修复, ou x=卸载。

命令:
  status      查看服务状态
  logs        查看实时日志
  start       启动服务
  stop        停止服务
  restart     重启服务
  rs          restart 的快捷别名
  enable      设置开机自启
  disable     取消开机自启
  panel       打印面板地址
  credentials 打印面板地址、账号和密码；credentials --help 只显示用法，不会输出凭据
  rotate-credentials 生成新的随机操作员账号密码，更新后端 hash，并让旧浏览器会话失效
  login       credentials 的别名
  info        credentials 的别名
  update      从 GitHub 重新拉取并更新
  fix         一键修复安装异常；刚安装后看到旧假数据时可运行 ou fix --force
  repair-nginx 重新写入面板 Nginx 配置并检查 Basic Auth 残留
  reconfigure 修改端口/证书并重新运行安装向导
  doctor      诊断 Nginx、Basic Auth、服务状态和控制面存储
  smoke       运行生产入口烟测，覆盖登录、CSRF、受保护 API、SSE 和 /metrics
  browser-smoke 运行真实浏览器业务流烟测，覆盖登录、关键页面导航、截图和退出登录
  notification-smoke 运行真实 Telegram 测试通知烟测，输出脱敏报告
  webhook-smoke 运行真实外部 webhook 连通性烟测，输出脱敏报告
  archive-smoke 运行真实外部归档 sink 烟测，输出脱敏报告
  archive-provider-evidence 生成脱敏 provider 侧 Object Lock/retention 证据摘要，供 qa --archive-provider-evidence / qv --require-archive-provider-evidence 使用
  timestamp-evidence 生成脱敏第三方时间戳证据摘要，供 qa --timestamp-evidence / qv --require-timestamp-evidence 使用
  clean-install-evidence 生成脱敏干净服务器 fresh install 证据摘要，供 qa --install-evidence / qv --require-clean-install-evidence 使用
  acceptance  生成生产验收证据包，包含 doctor、HTTP smoke、browser smoke、通知/webhook/归档 smoke、报告、截图归档和带 SHA-256 的 manifest
  acceptance-verify 校验生产验收证据包 manifest 中记录的文件大小和 SHA-256
  final-acceptance 生成最终现场验收证据包并立即执行严格 qv 校验
  production-release-acceptance 生成最终现场验收证据包并立即执行全部生产发布 strict gate
  final-acceptance-verify 一次性复核最终验收包的 runtime、浏览器、通知、webhook 和 final summary strict gate
  production-release-verify 强制复核最终验收包的全部生产发布 strict gate
  backup-state 创建当前控制面存储备份，可选自定义输出路径，并写入 .manifest.json
  restore-state 用备份文件覆盖当前控制面存储，调用时传入备份路径；有 manifest 时会先校验，追加 yes 可跳过交互确认
  reset-state 清空控制面运行状态，用于刚安装后清除旧假数据
  uninstall   卸载部署
  menu        打开快捷菜单
EOT
}

show_command_help() {
  local command="${1:-help}"

  case "${command}" in
    credentials|credential|login|info|c|i)
      show_credentials_help
      ;;
    smoke|smoke-production|production-smoke|sm)
      show_smoke_help
      ;;
    browser-smoke|smoke-browser|browser|bs)
      show_browser_smoke_help
      ;;
    notification-smoke|smoke-notification|notifications|notification|ns)
      show_notification_smoke_help
      ;;
    webhook-smoke|smoke-webhook|webhooks|webhook|ws)
      show_webhook_smoke_help
      ;;
    archive-smoke|smoke-archive|archive|external-archive-smoke|as)
      show_archive_smoke_help
      ;;
    archive-provider-evidence|provider-evidence|archive-provider-summary|ape)
      show_archive_provider_evidence_help
      ;;
    timestamp-evidence|timestamp-summary|timestamp-proof|te)
      show_timestamp_evidence_help
      ;;
    clean-install-evidence|install-evidence-summary|clean-install-summary|cie)
      show_clean_install_evidence_help
      ;;
    acceptance|accept|qa|evidence|evidence-bundle)
      show_acceptance_help
      ;;
    acceptance-verify|verify-acceptance|qa-verify|qv|evidence-verify)
      show_acceptance_verify_help
      ;;
    final-acceptance|acceptance-final|field-acceptance|qf)
      show_final_acceptance_help
      ;;
    production-release-acceptance|release-acceptance|field-release-acceptance|qfa)
      show_production_release_acceptance_help
      ;;
    final-acceptance-verify|verify-final-acceptance|field-acceptance-verify|qvf)
      show_final_acceptance_verify_help
      ;;
    production-release-verify|release-verify|field-release-verify|qvr)
      show_production_release_verify_help
      ;;
    *)
      show_cli_help
      ;;
  esac
}

if is_help_flag "${1:-}" && [[ -n "${2:-}" ]]; then
  show_command_help "${2}"
  exit 0
fi

if is_help_flag "${2:-}"; then
  show_command_help "${1:-help}"
  exit 0
fi

case "${1:-menu}" in
  status|s)
    systemctl status "${SERVICE_NAME}" --no-pager
    ;;
  logs|l)
    journalctl -u "${SERVICE_NAME}" -f
    ;;
  start|stop|restart|rs|restart-service|enable|disable)
    require_root
    if [[ "${1}" == "rs" || "${1}" == "restart-service" ]]; then
      systemctl restart "${SERVICE_NAME}"
    else
      systemctl "${1}" "${SERVICE_NAME}"
    fi
    ;;
  panel|p)
    panel_url
    ;;
  credentials|credential|login|info|c|i)
    if [[ -n "${2:-}" ]]; then
      fail "credentials 不接受额外参数；查看帮助请运行 'ou-ui-next credentials --help'。"
    fi
    show_credentials
    ;;
  rotate-credentials|rotate-login|credential-rotate|password-reset|rc)
    rotate_operator_credentials
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
  repair-nginx|nginx-repair)
    ensure_runtime_env_defaults
    ensure_runtime_filesystem_permissions
    systemctl restart "${SERVICE_NAME}"
    refresh_nginx_panel_config
    check_panel_surface
    ;;
  doctor|diagnose|d)
    show_doctor
    ;;
  smoke|smoke-production|production-smoke|sm)
    run_production_smoke "${@:2}"
    ;;
  browser-smoke|smoke-browser|browser|bs)
    run_production_browser_smoke "${@:2}"
    ;;
  notification-smoke|smoke-notification|notifications|notification|ns)
    run_production_notification_smoke "${@:2}"
    ;;
  webhook-smoke|smoke-webhook|webhooks|webhook|ws)
    run_production_webhook_smoke "${@:2}"
    ;;
  archive-smoke|smoke-archive|archive|external-archive-smoke|as)
    run_production_archive_smoke "${@:2}"
    ;;
  archive-provider-evidence|provider-evidence|archive-provider-summary|ape)
    write_archive_provider_evidence "${@:2}"
    ;;
  timestamp-evidence|timestamp-summary|timestamp-proof|te)
    write_timestamp_evidence "${@:2}"
    ;;
  clean-install-evidence|install-evidence-summary|clean-install-summary|cie)
    write_clean_install_evidence "${@:2}"
    ;;
  acceptance|accept|qa|evidence|evidence-bundle)
    run_production_acceptance "${@:2}"
    ;;
  acceptance-verify|verify-acceptance|qa-verify|qv|evidence-verify)
    verify_production_acceptance "${@:2}"
    ;;
  final-acceptance-verify|verify-final-acceptance|field-acceptance-verify|qvf)
    verify_final_production_acceptance_bundle "${@:2}"
    ;;
  production-release-verify|release-verify|field-release-verify|qvr)
    run_production_release_verify "${@:2}"
    ;;
  production-release-acceptance|release-acceptance|field-release-acceptance|qfa)
    run_production_release_acceptance "${@:2}"
    ;;
  final-acceptance|acceptance-final|field-acceptance|qf)
    run_final_production_acceptance "${@:2}"
    ;;
  backup-state|backup|b)
    backup_control_plane_state "${2:-}"
    ;;
  restore-state|restore)
    restore_control_plane_state "${2:-}" "${3:-}"
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
    show_cli_help
    ;;
  *)
    fail "未知命令，请运行 'ou-ui-next help'。"
    ;;
esac
EOF
  } >"/usr/local/bin/ou-ui-next"
  chmod 755 "/usr/local/bin/ou-ui-next"
  link_management_cli_alias "/usr/local/bin/ouui"
  link_management_cli_alias "/usr/local/bin/ou-ui"
  link_management_cli_alias "/usr/local/bin/ou"

  if [[ -d "/usr/bin" ]]; then
    link_management_cli_alias "/usr/bin/ou-ui-next"
    link_management_cli_alias "/usr/bin/ouui"
    link_management_cli_alias "/usr/bin/ou-ui"
    link_management_cli_alias "/usr/bin/ou"
  fi
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

current_app_commit() {
  git -C "${APP_DIR}" rev-parse HEAD 2>/dev/null || true
}

write_frontend_build_info() {
  local target_dir="$1"
  local commit built_at
  commit="$(current_app_commit)"
  built_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  [[ -n "${commit}" ]] || commit="unknown"
  cat >"${target_dir}/build-info.json" <<BUILD_INFO_EOF
{"commit":"${commit}","builtAt":"${built_at}","scriptVersion":"${SCRIPT_VERSION}"}
BUILD_INFO_EOF
}

read_deployed_build_commit() {
  local base_url="$1"
  local build_info
  build_info="$(curl -k -sSL --max-time 10 "${base_url%/}/build-info.json" 2>/dev/null || true)"
  printf '%s\n' "${build_info}" | sed -n 's/.*"commit"[[:space:]]*:[[:space:]]*"\([0-9a-f][0-9a-f]*\)".*/\1/p' | head -n 1
}

frontend_static_matches_current_dist() {
  local target_dir="$1"
  local changes

  [[ -f "${APP_DIR}/dist/index.html" ]] || return 1
  [[ -f "${target_dir}/index.html" ]] || return 1

  if ! changes="$(rsync -rcni --delete --exclude build-info.json "${APP_DIR}/dist/" "${target_dir}/" 2>/dev/null)"; then
    return 1
  fi

  [[ -z "${changes}" ]]
}

repair_missing_frontend_build_info() {
  local target_dir
  target_dir="${WEB_ROOT}/${SECURE_PATH}"
  frontend_static_matches_current_dist "${target_dir}" || return 0

  write_frontend_build_info "${target_dir}"
  log "前端构建指纹缺失，已为当前静态目录补写。"
}

check_frontend_build_fingerprint() {
  local base_url="$1"
  local expected_commit deployed_commit
  expected_commit="$(current_app_commit)"
  [[ -n "${expected_commit}" ]] || return

  deployed_commit="$(read_deployed_build_commit "${base_url}")"
  if [[ -z "${deployed_commit}" ]]; then
    repair_missing_frontend_build_info
    deployed_commit="$(read_deployed_build_commit "${base_url}")"
  fi

  if [[ -z "${deployed_commit}" ]]; then
    die "前端构建指纹缺失：${base_url%/}/build-info.json 不可用。请重新运行安装或 ou-ui update。"
  fi

  if [[ "${deployed_commit}" != "${expected_commit}" ]]; then
    die "前端构建指纹不匹配：当前源码 ${expected_commit:0:12}，已部署静态资源 ${deployed_commit:0:12}。请重新运行安装或 ou-ui update。"
  fi

  success "前端构建指纹自检通过：${deployed_commit:0:12}"
}

deploy_frontend_bundle() {
  mkdir -p "${WEB_ROOT}/${SECURE_PATH}"
  rsync -a --delete "${APP_DIR}/dist/" "${WEB_ROOT}/${SECURE_PATH}/"
  write_frontend_build_info "${WEB_ROOT}/${SECURE_PATH}"
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
Environment=NPM_CONFIG_CACHE=${STATE_DIR}/npm-cache
ExecStart=/usr/bin/env npm run start:control-plane
Restart=always
RestartSec=5
TimeoutStartSec=60
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${STATE_DIR} ${CONFIG_DIR}
CapabilityBoundingSet=
RestrictSUIDSGID=true
LockPersonality=true

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable "${SERVICE_NAME}"
  systemctl restart "${SERVICE_NAME}"
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

nginx_server_block_has_port_directive() {
  local candidate_conf="$1"
  local required_directive="${2:-}"

  awk -v port="${PANEL_PORT}" -v required_directive="${required_directive}" '
    function reset_block() {
      in_server = 0
      depth = 0
      has_port = 0
      has_directive = 0
    }
    function count_open(value, copy) {
      copy = value
      return gsub(/\{/, "{", copy)
    }
    function count_close(value, copy) {
      copy = value
      return gsub(/\}/, "}", copy)
    }
    BEGIN {
      reset_block()
    }
    {
      line = $0
      sub(/[[:space:]]*#.*/, "", line)

      if (!in_server && line ~ /^[[:space:]]*server[[:space:]]*\{/) {
        reset_block()
        in_server = 1
      }

      if (in_server) {
        if (line ~ ("listen[[:space:]]+([^;]*:)?" port "([^0-9;]|;)[^;]*")) {
          has_port = 1
          if (required_directive == "" || line ~ required_directive) {
            has_directive = 1
          }
        }

        depth += count_open(line) - count_close(line)

        if (depth <= 0) {
          if (has_port && (required_directive == "" || has_directive)) {
            found = 1
            exit
          }
          reset_block()
        }
      }
    }
    END {
      exit found ? 0 : 1
    }
  ' "${candidate_conf}"
}

nginx_server_block_has_port_basic_auth() {
  local candidate_conf="$1"

  awk -v port="${PANEL_PORT}" '
    function reset_block() {
      in_server = 0
      depth = 0
      has_port = 0
      has_basic_auth = 0
    }
    function count_open(value, copy) {
      copy = value
      return gsub(/\{/, "{", copy)
    }
    function count_close(value, copy) {
      copy = value
      return gsub(/\}/, "}", copy)
    }
    BEGIN {
      reset_block()
    }
    {
      line = $0
      sub(/[[:space:]]*#.*/, "", line)

      if (!in_server && line ~ /^[[:space:]]*server[[:space:]]*\{/) {
        reset_block()
        in_server = 1
      }

      if (in_server) {
        lower_line = tolower(line)

        if (line ~ ("listen[[:space:]]+([^;]*:)?" port "([^0-9;]|;)[^;]*")) {
          has_port = 1
        }

        if (lower_line ~ /auth_basic[[:space:]]+[^;]+;/ && lower_line !~ /auth_basic[[:space:]]+off[[:space:]]*;/) {
          has_basic_auth = 1
        }

        depth += count_open(line) - count_close(line)

        if (depth <= 0) {
          if (has_port && has_basic_auth) {
            found = 1
            exit
          }
          reset_block()
        }
      }
    }
    END {
      exit found ? 0 : 1
    }
  ' "${candidate_conf}"
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

    if nginx_server_block_has_port_directive "${candidate_conf}" default_server; then
      die "检测到 Nginx 已有 ${PANEL_PORT} 端口 default_server，浏览器可能会打开其它站点或 Basic Auth 弹窗。冲突配置：${candidate_conf}。请换一个面板端口，或先清理旧的 Nginx 默认站点后重试。"
    fi

    if nginx_server_block_has_port_basic_auth "${candidate_conf}"; then
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

    location = /${SECURE_PATH}/api/v1/auth/session {
        rewrite ^/${SECURE_PATH}/(.*)$ /\$1 break;
        proxy_pass http://${BACKEND_HOST}:${BACKEND_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Prefix /${SECURE_PATH};
    }

    location = /${SECURE_PATH}/api/v1/auth/session/check {
        internal;
        rewrite ^/${SECURE_PATH}/api/v1/auth/session/check$ /api/v1/auth/session break;
        proxy_pass http://${BACKEND_HOST}:${BACKEND_PORT};
        proxy_method GET;
        proxy_pass_request_body off;
        proxy_set_header Content-Length "";
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Prefix /${SECURE_PATH};
    }

    location ^~ /${SECURE_PATH}/api/ {
        auth_request /${SECURE_PATH}/api/v1/auth/session/check;
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

    location = /${SECURE_PATH}/metrics {
        auth_request /${SECURE_PATH}/api/v1/auth/session/check;
        rewrite ^/${SECURE_PATH}/metrics$ /metrics break;
        proxy_pass http://${BACKEND_HOST}:${BACKEND_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Prefix /${SECURE_PATH};
        proxy_set_header Authorization "Bearer ${OPERATOR_TOKEN}";
    }

    location ^~ /${SECURE_PATH}/events/ {
        auth_request /${SECURE_PATH}/api/v1/auth/session/check;
        rewrite ^/${SECURE_PATH}/(.*)$ /\$1 break;
        proxy_pass http://${BACKEND_HOST}:${BACKEND_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Prefix /${SECURE_PATH};
        proxy_set_header Authorization "Bearer ${OPERATOR_TOKEN}";
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 1h;
        proxy_hide_header Content-Type;
        add_header Content-Type "text/event-stream; charset=utf-8" always;
        add_header Cache-Control "no-cache" always;
        gzip off;
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
  local redirect_port="" http2_listen_suffix http2_directive

  if [[ "${PANEL_PORT}" != "443" ]]; then
    redirect_port=":${PANEL_PORT}"
  fi
  http2_listen_suffix="$(nginx_http2_listen_suffix)"
  http2_directive="$(nginx_http2_directive_line)"

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
    listen ${PANEL_PORT} ssl${http2_listen_suffix} default_server;
${http2_directive}
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

    location = /${SECURE_PATH}/api/v1/auth/session {
        rewrite ^/${SECURE_PATH}/(.*)$ /\$1 break;
        proxy_pass http://${BACKEND_HOST}:${BACKEND_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Prefix /${SECURE_PATH};
    }

    location = /${SECURE_PATH}/api/v1/auth/session/check {
        internal;
        rewrite ^/${SECURE_PATH}/api/v1/auth/session/check$ /api/v1/auth/session break;
        proxy_pass http://${BACKEND_HOST}:${BACKEND_PORT};
        proxy_method GET;
        proxy_pass_request_body off;
        proxy_set_header Content-Length "";
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Prefix /${SECURE_PATH};
    }

    location ^~ /${SECURE_PATH}/api/ {
        auth_request /${SECURE_PATH}/api/v1/auth/session/check;
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

    location = /${SECURE_PATH}/metrics {
        auth_request /${SECURE_PATH}/api/v1/auth/session/check;
        rewrite ^/${SECURE_PATH}/metrics$ /metrics break;
        proxy_pass http://${BACKEND_HOST}:${BACKEND_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Prefix /${SECURE_PATH};
        proxy_set_header Authorization "Bearer ${OPERATOR_TOKEN}";
    }

    location ^~ /${SECURE_PATH}/events/ {
        auth_request /${SECURE_PATH}/api/v1/auth/session/check;
        rewrite ^/${SECURE_PATH}/(.*)$ /\$1 break;
        proxy_pass http://${BACKEND_HOST}:${BACKEND_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Prefix /${SECURE_PATH};
        proxy_set_header Authorization "Bearer ${OPERATOR_TOKEN}";
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 1h;
        proxy_hide_header Content-Type;
        add_header Content-Type "text/event-stream; charset=utf-8" always;
        add_header Cache-Control "no-cache" always;
        gzip off;
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
  local url headers status auth_header body attempt
  url="$(panel_redirect_target)"

  for attempt in 1 2 3 4 5; do
    headers="$(curl -k -sSIL --max-time 10 "${url}" 2>/dev/null || true)"
    [[ -n "${headers}" ]] && break
    sleep 1
  done

  if [[ -z "${headers}" ]]; then
    die "面板 URL 自检连续 5 次未取到响应。请运行 ou d 查看诊断，检查 Nginx、端口冲突、DNS/证书和后端服务状态。"
  fi

  status="$(printf '%s\n' "${headers}" | awk '/^HTTP\// { code = $2 } END { print code }')"
  auth_header="$(printf '%s\n' "${headers}" | awk 'BEGIN { IGNORECASE=1 } /^WWW-Authenticate:/ { print; exit }')"

  if [[ "${auth_header}" =~ [Bb]asic ]] || [[ "${status}" == "401" ]]; then
    die "面板 URL 自检发现浏览器 Basic Auth 响应。当前地址可能命中了旧站点、同端口 Nginx 配置或错误 server_name。请运行 ou d 查看冲突路径，或重新安装时选择 8443/9443 等独立端口。"
  fi

  body=""
  for attempt in 1 2 3 4 5; do
    body="$(curl -k -sSL --max-time 10 "${url}" 2>/dev/null || true)"
    if printf '%s\n' "${body}" | grep -q '<title>OU-UI Next 控制面板</title>' &&
      printf '%s\n' "${body}" | grep -q 'id="root"'; then
      break
    fi
    sleep 1
  done

  if ! printf '%s\n' "${body}" | grep -q '<title>OU-UI Next 控制面板</title>' ||
    ! printf '%s\n' "${body}" | grep -q 'id="root"'; then
    die "面板 URL 自检没有拿到 OU-UI Next 前端登录页。当前地址可能命中了旧站点、旧静态目录或错误 Nginx server block，请运行 ou d 查看诊断。"
  fi

  check_frontend_build_fingerprint "${url}"
  success "面板 URL 自检通过：已命中 OU-UI Next 前端登录页，未发现 WWW-Authenticate: Basic。"
}

read_empty_inventory_snapshot_residue() {
  local payload="$1"

  printf '%s\n' "${payload}" | jq -er '
    if type != "object" then empty
    elif (.data | type) != "object" then empty
    else
    . as $snapshot
    |
    def array_count($key):
      ($snapshot.data[$key] // [] | if type == "array" then length else -1 end);
    [
      "agents",
      "nodes",
      "inbounds",
      "subscriptionSources",
      "subscriptionInventoryNodes",
      "subscriptionBundles",
      "subscriptionClients",
      "subscriptionExportProfiles",
      "proxyProviders",
      "subscriptionExportFiles",
      "forwardRules",
      "quotaPolicies",
      "rateLimitPolicies",
      "routingPolicies",
      "tuningProfiles",
      "configRevisions",
      "preflightPlans",
      "runtimeSnapshots",
      "tasks"
    ]
    | map({ key: ., count: array_count(.) })
    | map(select(.count != 0))
    | if length == 0 then "OK" else map("\(.key)=\(.count)") | join(", ") end
    end
  ' 2>/dev/null || true
}

write_operator_login_payload() {
  local username="$1"
  local password="$2"

  OU_UI_LOGIN_USERNAME="${username}" OU_UI_LOGIN_PASSWORD="${password}" node <<'NODE'
process.stdout.write(JSON.stringify({
  username: process.env.OU_UI_LOGIN_USERNAME ?? '',
  password: process.env.OU_UI_LOGIN_PASSWORD ?? ''
}));
NODE
}

create_install_session_cookie_file() {
  local base_url cookie_file response status body csrf_token attempt
  base_url="$(panel_redirect_target)"

  [[ -n "${base_url}" ]] || die "无法创建面板会话：面板地址不可用。"
  [[ -n "${ADMIN_USER}" && -n "${ADMIN_PASSWORD}" ]] || die "无法创建面板会话：登录凭据不可用。"

  cookie_file="$(mktemp)"
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    response="$(
      write_operator_login_payload "${ADMIN_USER}" "${ADMIN_PASSWORD}" | curl -k -sS --max-time 15 \
        -c "${cookie_file}" \
        -w '\n%{http_code}' \
        -H 'Content-Type: application/json' \
        --data-binary @- \
        "${base_url%/}/api/v1/auth/session" 2>/dev/null || true
    )"
    status="$(printf '%s\n' "${response}" | tail -n 1)"
    body="$(printf '%s\n' "${response}" | sed '$d')"

    if [[ "${status}" == "201" ]]; then
      csrf_token="$(printf '%s\n' "${body}" | jq -er '.data.csrfToken // empty' 2>/dev/null || true)"
      if [[ -z "${csrf_token}" ]]; then
        rm -f "${cookie_file}" "${cookie_file}.csrf"
        die "无法创建面板会话：登录响应缺少 CSRF token。请检查 Nginx session gate 和后端登录配置。"
      fi
      printf '%s' "${csrf_token}" >"${cookie_file}.csrf"
      printf '%s\n' "${cookie_file}"
      return
    fi

    case "${status:-000}" in
      000|502|503|504)
        sleep 1
        ;;
      *)
        rm -f "${cookie_file}" "${cookie_file}.csrf"
        die "无法创建面板会话：HTTP ${status:-无响应}。请检查 Nginx session gate 和后端登录配置。"
        ;;
    esac
  done

  rm -f "${cookie_file}" "${cookie_file}.csrf"
  die "无法创建面板会话：HTTP ${status:-无响应}。请检查 Nginx session gate 和后端登录配置。"
}

poll_empty_inventory_snapshot_residue() {
  local api_url="$1"
  local cookie_file="${2:-}"
  local payload residue attempt

  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    if [[ -n "${cookie_file}" ]]; then
      payload="$(curl -k -sS --max-time 10 -b "${cookie_file}" "${api_url}" 2>/dev/null || true)"
    else
      payload="$(curl -k -sS --max-time 10 "${api_url}" 2>/dev/null || true)"
    fi
    residue="$(read_empty_inventory_snapshot_residue "${payload}")"

    if [[ -n "${residue}" ]]; then
      printf '%s\n' "${residue}"
      return 0
    fi

    sleep 1
  done

  return 1
}

check_fresh_install_empty_inventory() {
  local base_url api_url residue cookie_file
  base_url="$(panel_redirect_target)"
  api_url="${base_url%/}/api/v1/snapshot"
  cookie_file="$(create_install_session_cookie_file)"
  trap 'remove_session_cookie_file "${cookie_file}"; trap - RETURN' RETURN

  if ! residue="$(poll_empty_inventory_snapshot_residue "${api_url}" "${cookie_file}")"; then
    die "无法验证全新安装空库存：${api_url} 未返回标准控制面快照，请运行 ou d 查看诊断。"
  fi

  if [[ "${residue}" != "OK" ]]; then
    die "全新安装空库存自检失败：仍发现业务库存残留：${residue}。安装不应带任何默认节点、入站、端口转发、订阅源、代理集合、导出文件或旧任务，请运行 ou f --force 清理旧状态，或检查是否命中了旧后端实例。"
  fi

  success "控制面空库存自检通过：全新安装没有默认/演示主机、节点、入站、端口转发、订阅源、订阅库存、订阅身份、代理集合、导出文件或旧任务。"
}

check_agent_install_command_surface() {
  local base_url api_url payload request_id response status body command cookie_file csrf_token
  base_url="$(panel_redirect_target)"
  api_url="${base_url%/}/api/v1/agents/install-command"
  request_id="install-selfcheck-agent-command-$(date +%s)-$$"
  payload='{"installProfile":["host-agent","xray","port-forwarding","telemetry","command-channel"]}'
  cookie_file="$(create_install_session_cookie_file)"
  trap 'remove_session_cookie_file "${cookie_file}"; trap - RETURN' RETURN
  csrf_token="$(read_session_csrf_token "${cookie_file}")"
  [[ -n "${csrf_token}" ]] || die "Agent 安装命令 API 自检失败：面板会话缺少 CSRF token。"

  response="$(
    curl -k -sS --max-time 15 \
      -w '\n%{http_code}' \
      -b "${cookie_file}" \
      -H 'Content-Type: application/json' \
      -H "X-Actor: ${ADMIN_USER}" \
      -H "X-Request-Id: ${request_id}" \
      -H "X-CSRF-Token: ${csrf_token}" \
      -H "Idempotency-Key: ${request_id}" \
      -H "X-Forwarded-For: installer-selfcheck" \
      -H "X-Operator-Group-Id: owner" \
      -H "X-Resource-Group-Id: group-premium" \
      --data "${payload}" \
      "${api_url}" 2>/dev/null || true
  )"
  status="$(printf '%s\n' "${response}" | tail -n 1)"
  body="$(printf '%s\n' "${response}" | sed '$d')"

  if [[ "${status}" != "201" ]]; then
    die "Agent 安装命令 API 自检失败：HTTP ${status:-无响应}。这通常说明 Nginx session gate、operator token 注入、bootstrap 权限或旧状态修复异常。响应：${body:-空}"
  fi

  command="$(printf '%s\n' "${body}" | jq -er '.data.command // empty' 2>/dev/null || true)"
  if [[ -z "${command}" ]] ||
    [[ "${command}" != *"public/install/ou-agent.sh"* ]] ||
    [[ "${command}" != *"OU_MASTER="* ]] ||
    [[ "${command}" != *"OU_AGENT_ID="* ]] ||
    [[ "${command}" != *"OU_INSTALL_TOKEN="* ]]; then
    die "Agent 安装命令 API 自检失败：返回内容不是有效的一键安装命令。"
  fi

  success "Agent 安装命令 API 自检通过：可生成真实一键命令，且未把主机名/客户名写入安装命令。"
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
  preserve_existing_install_identity_if_needed
  install_system_packages
  ensure_service_enabled cron || ensure_service_enabled crond
  ensure_nodejs
  ensure_service_user
  prepare_directories
  reset_control_plane_state_if_needed
  sync_repository
  write_frontend_env
  write_backend_env
  install_management_cli
  install_dependencies_and_build
  deploy_frontend_bundle
  install_management_cli
  write_systemd_service
  configure_nginx
  check_panel_http_surface
  check_fresh_install_empty_inventory
  check_agent_install_command_surface
  success "后端服务与静态资源部署完成。"
  print_summary
}

if [[ "${1:-}" == "repair-cli" ]]; then
  require_root
  install_management_cli
  if [[ -f "${APP_DIR}/.env.production.local" && -f "${BACKEND_ENV_FILE}" && -f "${NGINX_CONF}" ]]; then
    /usr/local/bin/ou-ui-next repair-nginx || warn "Nginx 面板配置自动修复未完成，请运行 ou d 查看诊断。"
  fi
  success "管理命令已刷新：ou-ui / ou / ouui / ou-ui-next"
  exit 0
fi

main "$@"
