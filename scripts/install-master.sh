#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_VERSION="1.0.0"
APP_NAME="OU-UI Next"
DEFAULT_REPO_URL="${OU_UI_REPO_URL:-https://github.com/cshaizhihao/ou-ui-next.git}"
DEFAULT_REPO_REF="${OU_UI_REPO_REF:-main}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_REPO_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
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
BASIC_AUTH_FILE="${CONFIG_DIR}/.htpasswd"
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
REDIRECT_PORT_SUFFIX=""
PACKAGE_MANAGER=""
NGINX_WORKER_USER=""

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
      apt-get install -y curl git nginx cron openssl ca-certificates rsync tar gzip apache2-utils jq
      ;;
    dnf)
      dnf install -y curl git nginx cronie openssl ca-certificates rsync tar gzip httpd-tools jq
      ;;
    yum)
      yum install -y curl git nginx cronie openssl ca-certificates rsync tar gzip httpd-tools jq
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
    read -r -p "请输入 Master 面板监听端口 [默认 443]： " input
    input="${input:-443}"

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
    read -r -p "请重新输入 HTTPS 面板监听端口 [默认 443]： " input
    input="${input:-443}"

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
  ADMIN_USER="admin_$(random_string 8)"
  ADMIN_PASSWORD="$(random_string 22)"
  OPERATOR_TOKEN="$(random_string 48)"
  AGENT_BOOTSTRAP_TOKEN="$(random_string 48)"
}

prepare_directories() {
  mkdir -p "${INSTALL_ROOT}" "${CONFIG_DIR}" "${STATE_DIR}" "${WEB_ROOT}" "${ACME_WEBROOT}" "${SSL_DIR}"
  chown -R "${SERVICE_USER}:${SERVICE_USER}" "${STATE_DIR}"
}

sync_repository() {
  log "同步 OU-UI Next 仓库源码..."

  if [[ -f "${SOURCE_REPO_DIR}/package.json" ]]; then
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
      "${SOURCE_REPO_DIR}/" "${APP_DIR}/"
    return
  fi

  if [[ -d "${APP_DIR}/.git" ]]; then
    git -C "${APP_DIR}" fetch --prune origin
    git -C "${APP_DIR}" checkout "${DEFAULT_REPO_REF}"
    git -C "${APP_DIR}" reset --hard "origin/${DEFAULT_REPO_REF}"
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
VITE_DISABLE_IN_APP_LOGIN=true
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
OU_UI_CONTROL_PLANE_RESOURCE_GROUP_ID=group-master
OU_UI_CONTROL_PLANE_AGENT_TOKENS_JSON={"${AGENT_BOOTSTRAP_ID}":"${AGENT_BOOTSTRAP_TOKEN}"}
EOF

  chmod 600 "${BACKEND_ENV_FILE}"
}

install_dependencies_and_build() {
  log "安装项目依赖并构建前端产物..."
  cd "${APP_DIR}"
  npm install
  npm run build
}

deploy_frontend_bundle() {
  mkdir -p "${WEB_ROOT}/${SECURE_PATH}"
  rsync -a --delete "${APP_DIR}/dist/" "${WEB_ROOT}/${SECURE_PATH}/"
}

detect_nginx_worker_user() {
  local configured_user=""

  configured_user="$(awk '/^[[:space:]]*user[[:space:]]+/ { gsub(";", "", $2); print $2; exit }' /etc/nginx/nginx.conf 2>/dev/null || true)"

  if [[ -n "${configured_user}" ]] && id -u "${configured_user}" >/dev/null 2>&1; then
    NGINX_WORKER_USER="${configured_user}"
    return
  fi

  if id -u www-data >/dev/null 2>&1; then
    NGINX_WORKER_USER="www-data"
    return
  fi

  if id -u nginx >/dev/null 2>&1; then
    NGINX_WORKER_USER="nginx"
    return
  fi

  NGINX_WORKER_USER="root"
}

write_basic_auth() {
  htpasswd -cbB "${BASIC_AUTH_FILE}" "${ADMIN_USER}" "${ADMIN_PASSWORD}" >/dev/null
  detect_nginx_worker_user
  chown "root:${NGINX_WORKER_USER}" "${BASIC_AUTH_FILE}"
  chmod 640 "${BASIC_AUTH_FILE}"
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

write_nginx_config_http() {
  cat >"${NGINX_CONF}" <<EOF
server {
    listen ${PANEL_PORT};
    server_name _;

    auth_basic "OU-UI Next Master";
    auth_basic_user_file ${BASIC_AUTH_FILE};

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
        auth_basic off;
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

    ssl_certificate ${SSL_DIR}/fullchain.cer;
    ssl_certificate_key ${SSL_DIR}/${DOMAIN}.key;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:10m;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;

    auth_basic "OU-UI Next Master";
    auth_basic_user_file ${BASIC_AUTH_FILE};

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
        auth_basic off;
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
  printf "%b管理员账号：%b %s\n" "${BOLD}" "${RESET}" "${ADMIN_USER}"
  printf "%b管理员密码：%b %s\n" "${BOLD}" "${RESET}" "${ADMIN_PASSWORD}"
  printf "%bAgent 引导令牌：%b 已写入 %s（仅用于后端校验，不在前端明文展示）\n" "${BOLD}" "${RESET}" "${BACKEND_ENV_FILE}"
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
  sync_repository
  write_frontend_env
  write_backend_env
  install_dependencies_and_build
  deploy_frontend_bundle
  write_basic_auth
  write_systemd_service
  configure_nginx
  success "后端服务与静态资源部署完成。"
  print_summary
}

main "$@"
