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

prompt_port() {
  local input=""

  while true; do
    read -r -p "请输入 Master 面板监听端口 [默认 8443]： " input
    input="${input:-8443}"

    if [[ "${input}" =~ ^[0-9]+$ ]] && (( input >= 1 && input <= 65535 )); then
      PANEL_PORT="${input}"
      return
    fi

    warn "端口必须是 1 到 65535 之间的整数。"
  done
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
      PANEL_PORT="${input}"
      return
    fi

    warn "域名 HTTPS 模式请使用 443、8443 等非 80 端口。"
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

  log "检测到可用内存较低，正在创建 2G 临时 swap 以稳定构建..."
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
  cat >"/usr/local/bin/ou-ui-next" <<EOF
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

log() {
  printf "[%s] %s\n" "${APP_NAME}" "$1"
}

fail() {
  printf "[%s] %s\n" "${APP_NAME}" "$1" >&2
  exit 1
}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    fail "Please run this command as root."
  fi
}

read_panel_path() {
  if [[ -f "${APP_DIR}/.env.production.local" ]]; then
    awk -F= '/^VITE_CONTROL_PLANE_BASE_URL=/ { print $2; exit }' "${APP_DIR}/.env.production.local" | sed 's#^/##; s#/$##'
  fi
}

read_listen_port() {
  if [[ -f "${NGINX_CONF}" ]]; then
    awk '/^[[:space:]]*listen[[:space:]]+/ { gsub(";", "", $2); print $2; exit }' "${NGINX_CONF}"
  fi
}

panel_url() {
  local path domain listen
  path="$(read_panel_path)"
  listen="$(read_listen_port)"

  if [[ -z "${path}" || -z "${listen}" ]]; then
    echo "Unavailable"
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
    echo "Unavailable"
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
    fail "Login credentials are unavailable. Re-run the installer or check ${APP_DIR}/.env.production.local."
  fi

  cat <<EOT
OU-UI Next 登录信息
  面板地址: ${url}
  账号: ${username}
  密码: ${password}
EOT
}

do_uninstall() {
  require_root
  read -r -p "Confirm uninstall OU-UI Next? Type yes to continue: " answer
  [[ "${answer}" == "yes" ]] || exit 0

  systemctl disable --now "${SERVICE_NAME}" >/dev/null 2>&1 || true
  rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
  rm -f "${NGINX_CONF}"
  rm -f "${BACKEND_ENV_FILE}"
  rm -f "${APP_DIR}/.env.production.local"
  rm -rf "${INSTALL_ROOT}" "${CONFIG_DIR}" "${STATE_DIR}" "${WEB_ROOT}" "${ACME_WEBROOT}"
  rm -f "/usr/local/bin/ou-ui-next" "/usr/local/bin/ouui" "/usr/local/bin/ou-ui"
  systemctl daemon-reload >/dev/null 2>&1 || true
  systemctl reload nginx >/dev/null 2>&1 || true
  log "Uninstall complete."
}

show_menu() {
  while true; do
    cat <<'EOT'
OU-UI Next 快捷菜单
  1) 查看面板地址
  2) 查看登录信息
  3) 查看服务状态
  4) 查看实时日志
  5) 重启服务
  6) 从 GitHub 更新
  7) 卸载面板
  0) 退出
EOT
    read -r -p "请选择操作: " choice

    case "${choice}" in
      1) panel_url ;;
      2) show_credentials ;;
      3) systemctl status "${SERVICE_NAME}" --no-pager ;;
      4) journalctl -u "${SERVICE_NAME}" -f ;;
      5)
        require_root
        systemctl restart "${SERVICE_NAME}"
        ;;
      6)
        require_root
        exec bash <(curl -fsSL "${INSTALL_SCRIPT_URL}")
        ;;
      7) do_uninstall ;;
      0|q|Q) break ;;
      *) log "未知选项。" ;;
    esac
  done
}

case "${1:-menu}" in
  status)
    systemctl status "${SERVICE_NAME}" --no-pager
    ;;
  logs)
    journalctl -u "${SERVICE_NAME}" -f
    ;;
  start|stop|restart|enable|disable)
    require_root
    systemctl "${1}" "${SERVICE_NAME}"
    ;;
  panel)
    panel_url
    ;;
  credentials|credential|login|info)
    show_credentials
    ;;
  update)
    require_root
    log "Re-running the latest GitHub install script..."
    exec bash <(curl -fsSL "${INSTALL_SCRIPT_URL}")
    ;;
  uninstall)
    do_uninstall
    ;;
  menu)
    show_menu
    ;;
  help|--help|-h)
    cat <<'EOT'
用法: ou-ui-next <命令>

不带参数时会直接打开快捷菜单。

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
  uninstall   卸载部署
  menu        打开快捷菜单
EOT
    ;;
  *)
    fail "未知命令，请运行 'ou-ui-next help'。"
    ;;
esac
EOF
  chmod 755 "/usr/local/bin/ou-ui-next"
  ln -sf "/usr/local/bin/ou-ui-next" "/usr/local/bin/ouui"
  ln -sf "/usr/local/bin/ou-ui-next" "/usr/local/bin/ou-ui"
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

  if [[ -f package-lock.json ]]; then
    if ! npm ci --no-audit --no-fund; then
      warn "默认依赖安装失败，正在切换低内存重试..."
      export NODE_OPTIONS="--max-old-space-size=384"
      npm ci --no-audit --no-fund
    fi
  else
    npm install --no-audit --no-fund
  fi

  ensure_swap_for_build

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

nginx_port_conflict_preflight() {
  if ! command -v nginx >/dev/null 2>&1; then
    return
  fi

  local nginx_dump=""
  nginx_dump="$(nginx -T 2>/dev/null || true)"

  if [[ -z "${nginx_dump}" ]]; then
    return
  fi

  if printf '%s\n' "${nginx_dump}" | grep -Eq "listen[[:space:]]+([^;]*:)?${PANEL_PORT}([^0-9;]|;)[^;]*default_server"; then
    die "检测到 Nginx 已有 ${PANEL_PORT} 端口 default_server，浏览器可能会打开其它站点或 Basic Auth 弹窗。请换一个面板端口，或先清理旧的 Nginx 默认站点后重试。"
  fi

  if [[ "${HAS_DOMAIN}" == "yes" ]] && printf '%s\n' "${nginx_dump}" | grep -Eq "server_name[[:space:]][^;]*\\b${DOMAIN}\\b"; then
    warn "检测到 Nginx 中已有 ${DOMAIN} 的 server_name。脚本会写入 OU-UI Next 配置；如仍打开旧站点，请检查重复站点配置。"
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
    listen ${PANEL_PORT} ssl http2;
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

    location ^~ /${SECURE_PATH}/ {
        try_files \$uri \$uri/ /${SECURE_PATH}/index.html;
    }

    location / {
        return 404;
    }
}
EOF
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
  printf "%bOU-UI Next Master 瀹夎瀹屾垚%b\n" "${BOLD}${GREEN}" "${RESET}"
  printf "%b============================================================%b\n" "${GREEN}" "${RESET}"
  printf "%b璁块棶閾炬帴锛?b %s\n" "${BOLD}" "${RESET}" "${PUBLIC_ENDPOINT}"
  printf "%b瀹夊叏璺緞锛?b /%s\n" "${BOLD}" "${RESET}" "${SECURE_PATH}"
  printf "%b操作员账号：%b %s\n" "${BOLD}" "${RESET}" "${ADMIN_USER}"
  printf "%b操作员密码：%b %s\n" "${BOLD}" "${RESET}" "${ADMIN_PASSWORD}"
  printf "%b前端登录页：%b 已启用（不会再弹系统认证框）\n" "${BOLD}" "${RESET}"
  printf "%bAgent 寮曞浠ょ墝锛?b 宸插啓鍏?%s锛堜粎鐢ㄤ簬鍚庣鏍￠獙锛屼笉鍦ㄥ墠绔槑鏂囧睍绀猴級\n" "${BOLD}" "${RESET}" "${BACKEND_ENV_FILE}"
  printf "%b管理命令：%b ou-ui-next menu\n" "${BOLD}" "${RESET}" "${BLUE}"
  if [[ "${HAS_DOMAIN}" == "yes" ]]; then
    printf "%bSSL 璇佷功锛?b Let's Encrypt 鑷姩绛惧彂涓庤嚜鍔ㄧ画鏈熷凡鍚敤\n" "${BOLD}" "${RESET}"
  else
    printf "%bSSL 璇佷功锛?b 褰撳墠涓?IP + 绔彛妯″紡锛屾湭鍚敤 HTTPS\n" "${BOLD}" "${RESET}"
  fi
  printf "%b鍚庣鏈嶅姟锛?b systemctl status %s\n" "${BOLD}" "${RESET}" "${SERVICE_NAME}"
  printf "%bNginx 閰嶇疆锛?b %s\n" "${BOLD}" "${RESET}" "${NGINX_CONF}"
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
  sync_repository
  write_frontend_env
  write_backend_env
  install_dependencies_and_build
  deploy_frontend_bundle
  install_management_cli
  write_systemd_service
  configure_nginx
  success "后端服务与静态资源部署完成。"
  print_summary
}

main "$@"
