#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

APP_NAME="OU-UI Agent"
INSTALL_ROOT="${OU_AGENT_INSTALL_ROOT:-/opt/ou-ui-agent}"
CONFIG_DIR="${OU_AGENT_CONFIG_DIR:-/etc/ou-ui-agent}"
STATE_DIR="${OU_AGENT_STATE_DIR:-/var/lib/ou-ui-agent}"
SERVICE_NAME="${OU_AGENT_SERVICE_NAME:-ou-ui-agent}"
SERVICE_USER="${OU_AGENT_SERVICE_USER:-ouui-agent}"

log() {
  printf '[%s] %s\n' "${APP_NAME}" "$1"
}

die() {
  printf '[%s] %s\n' "${APP_NAME}" "$1" >&2
  exit 1
}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    die "Please run the install command as root."
  fi
}

require_env() {
  local name="$1"
  [[ -n "${!name:-}" ]] || die "Missing required environment variable: ${name}"
}

ensure_service_user() {
  if ! id -u "${SERVICE_USER}" >/dev/null 2>&1; then
    useradd --system --home "${INSTALL_ROOT}" --shell /usr/sbin/nologin "${SERVICE_USER}"
  fi
}

prepare_directories() {
  mkdir -p "${INSTALL_ROOT}/bin" "${INSTALL_ROOT}/modules" "${CONFIG_DIR}" "${STATE_DIR}" "${STATE_DIR}/logs"
  chown -R "${SERVICE_USER}:${SERVICE_USER}" "${INSTALL_ROOT}" "${STATE_DIR}"
  chmod 750 "${CONFIG_DIR}" "${STATE_DIR}"
}

write_agent_env() {
  cat >"${CONFIG_DIR}/agent.env" <<EOF
OU_MASTER=${OU_MASTER}
OU_AGENT_ID=${OU_AGENT_ID}
OU_INSTALL_TOKEN=${OU_INSTALL_TOKEN}
OU_AGENT_TOKEN=${OU_INSTALL_TOKEN}
OU_HOST_NAME=${OU_HOST_NAME}
OU_MAX_TRAFFIC_GB=${OU_MAX_TRAFFIC_GB:-0}
OU_CUSTOMER_NODE=${OU_CUSTOMER_NODE:-}
OU_CUSTOMER_NAME=${OU_CUSTOMER_NAME:-}
OU_REMAINING_DAYS=${OU_REMAINING_DAYS:-0}
OU_INSTALL_PROFILE=${OU_INSTALL_PROFILE}
OU_AGENT_STATE_DIR=${STATE_DIR}
EOF

  chown root:"${SERVICE_USER}" "${CONFIG_DIR}/agent.env"
  chmod 640 "${CONFIG_DIR}/agent.env"
}

prepare_modules() {
  local component=""
  IFS=',' read -r -a components <<<"${OU_INSTALL_PROFILE}"

  for component in "${components[@]}"; do
    component="${component// /}"
    [[ -n "${component}" ]] || continue
    mkdir -p "${INSTALL_ROOT}/modules/${component}"
    chown -R "${SERVICE_USER}:${SERVICE_USER}" "${INSTALL_ROOT}/modules/${component}"
  done
}

write_runner() {
  cat >"${INSTALL_ROOT}/bin/ou-agent-runner" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail

source /etc/ou-ui-agent/agent.env

mkdir -p "${OU_AGENT_STATE_DIR}/logs"
printf '[OU-UI Agent] started agent_id=%s master=%s profile=%s\n' "${OU_AGENT_ID}" "${OU_MASTER}" "${OU_INSTALL_PROFILE}" >>"${OU_AGENT_STATE_DIR}/logs/agent.log"

while true; do
  request_id="agent-${OU_AGENT_ID}-$(date +%s)"
  response="$(
    curl -fsS \
      --max-time 20 \
      -H "Authorization: Bearer ${OU_AGENT_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "{\"agentId\":\"${OU_AGENT_ID}\",\"requestId\":\"${request_id}\"}" \
      "${OU_MASTER}" 2>&1 || true
  )"
  printf '[OU-UI Agent] poll %s request_id=%s response=%s\n' "$(date -u +%FT%TZ)" "${request_id}" "${response}" >>"${OU_AGENT_STATE_DIR}/logs/agent.log"
  sleep 30
done
EOF

  chmod 750 "${INSTALL_ROOT}/bin/ou-agent-runner"
  chown "${SERVICE_USER}:${SERVICE_USER}" "${INSTALL_ROOT}/bin/ou-agent-runner"
}

write_systemd_service() {
  cat >"/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=OU-UI Universal Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
EnvironmentFile=${CONFIG_DIR}/agent.env
ExecStart=${INSTALL_ROOT}/bin/ou-agent-runner
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable --now "${SERVICE_NAME}"
  systemctl is-active --quiet "${SERVICE_NAME}" || die "OU-UI Agent service failed to start."
}

main() {
  require_root
  require_env OU_MASTER
  require_env OU_AGENT_ID
  require_env OU_INSTALL_TOKEN
  require_env OU_HOST_NAME
  require_env OU_INSTALL_PROFILE
  ensure_service_user
  prepare_directories
  write_agent_env
  prepare_modules
  write_runner
  write_systemd_service
  log "Agent scaffold installed. Replace the runner with the production Agent binary when available."
}

main "$@"
