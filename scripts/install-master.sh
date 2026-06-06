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
  mkdir -p "${INSTALL_ROOT}" "${CONFIG_DIR}" "${STATE_DIR}" "${WEB_ROOT}" "${ACME_WEBROOT}" "${SSL_DIR}"
  chown -R "${SERVICE_USER}:${SERVICE_USER}" "${STATE_DIR}"
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
  local object_endpoint object_bucket object_region object_access_key object_secret_key object_session_token object_prefix object_timeout object_force_path_style object_allowlist
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
  for value in "${object_endpoint}" "${object_bucket}" "${object_region}" "${object_access_key}" "${object_secret_key}" "${object_session_token}" "${object_prefix}" "${object_timeout}" "${object_force_path_style}" "${object_allowlist}"; do
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

  show_external_archive_health
  show_agent_log_retention_health
  show_traffic_rollup_retention_health
  show_command_timeout_sweep_health
  show_operator_auth_throttle_health
  show_operator_session_health
  show_operator_identity_health
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
  0) 退出
EOT
    echo "快捷键：p=面板信息 c=登录信息 rc=轮换登录凭据 s=服务状态 l=实时日志 rs=重启服务 u=更新 b=备份 rb=恢复 r=重置状态 m=改端口/证书 d=诊断 f=一键修复 x=卸载"
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

show_cli_help() {
  cat <<'EOT'
用法: ou-ui-next <命令>

不带参数时会直接打开快捷菜单。涉及更新、重配、重启、重置和卸载时请使用 root 执行，例如：sudo ou f。
常用快捷: ou p=面板信息, ou c=登录信息, ou rc=轮换登录凭据, ou rs=重启服务, ou u=更新, ou b=备份状态, ou r=重置状态, ou m=改端口/证书, ou d=诊断, ou f=一键修复, ou x=卸载。

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
    systemctl restart "${SERVICE_NAME}"
    refresh_nginx_panel_config
    check_panel_surface
    ;;
  doctor|diagnose|d)
    show_doctor
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
ExecStart=/usr/bin/env npm run start:control-plane
Restart=always
RestartSec=5
TimeoutStartSec=60

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
