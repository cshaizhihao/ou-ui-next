#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

APP_NAME="OU-UI Agent"
INSTALL_ROOT="${OU_AGENT_INSTALL_ROOT:-/opt/ou-ui-agent}"
CONFIG_DIR="${OU_AGENT_CONFIG_DIR:-/etc/ou-ui-agent}"
STATE_DIR="${OU_AGENT_STATE_DIR:-/var/lib/ou-ui-agent}"
SERVICE_NAME="${OU_AGENT_SERVICE_NAME:-ou-ui-agent}"
SERVICE_USER="${OU_AGENT_SERVICE_USER:-ouui-agent}"
AGENT_VERSION="${OU_AGENT_VERSION:-0.1.0-scaffold}"

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

create_session_id() {
  local suffix
  suffix="$(od -An -N6 -tx1 /dev/urandom 2>/dev/null | tr -d ' \n')"
  printf 'sess_%s_%s_%s' "${OU_AGENT_ID//[^A-Za-z0-9]/_}" "$(date +%s)" "${suffix:-local}"
}

extract_json_string() {
  local key="$1"
  sed -n "s/.*\"${key}\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p"
}

json_escape() {
  sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
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

register_agent() {
  local register_endpoint="${OU_AGENT_REGISTER_ENDPOINT:-${OU_MASTER%/poll}/register}"
  local request_id="agent-register-${OU_AGENT_ID}-$(date +%s)"
  local platform
  local agent_id_json
  local request_id_json
  local session_id_json
  local version_json
  local platform_json
  local response

  OU_AGENT_SESSION_ID="${OU_AGENT_SESSION_ID:-$(create_session_id)}"
  platform="$(uname -s 2>/dev/null || printf 'linux')-$(uname -m 2>/dev/null || printf 'unknown')"
  agent_id_json="$(printf '%s' "${OU_AGENT_ID}" | json_escape)"
  request_id_json="$(printf '%s' "${request_id}" | json_escape)"
  session_id_json="$(printf '%s' "${OU_AGENT_SESSION_ID}" | json_escape)"
  version_json="$(printf '%s' "${AGENT_VERSION}" | json_escape)"
  platform_json="$(printf '%s' "${platform}" | json_escape)"
  log "Registering Agent runtime credential with Master."
  response="$(
    curl -fsS \
      --max-time 30 \
      -H "Authorization: Bearer ${OU_INSTALL_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "{\"agentId\":\"${agent_id_json}\",\"requestId\":\"${request_id_json}\",\"sessionId\":\"${session_id_json}\",\"version\":\"${version_json}\",\"platform\":\"${platform_json}\"}" \
      "${register_endpoint}" 2>&1
  )" || die "Agent registration failed: ${response}"

  OU_AGENT_TOKEN="$(printf '%s' "${response}" | extract_json_string agentToken)"
  OU_AGENT_TOKEN_EXPIRES_AT="$(printf '%s' "${response}" | extract_json_string expiresAt)"
  OU_AGENT_CREDENTIAL_ID="$(printf '%s' "${response}" | extract_json_string credentialId)"

  [[ -n "${OU_AGENT_TOKEN}" ]] || die "Agent registration response did not include agentToken."
  [[ -n "${OU_AGENT_CREDENTIAL_ID}" ]] || die "Agent registration response did not include credentialId."
  export OU_AGENT_TOKEN OU_AGENT_TOKEN_EXPIRES_AT OU_AGENT_CREDENTIAL_ID OU_AGENT_SESSION_ID
}

write_agent_env() {
  cat >"${CONFIG_DIR}/agent.env" <<EOF
OU_MASTER=${OU_MASTER}
OU_AGENT_ID=${OU_AGENT_ID}
OU_AGENT_TOKEN=${OU_AGENT_TOKEN}
OU_AGENT_TOKEN_EXPIRES_AT=${OU_AGENT_TOKEN_EXPIRES_AT}
OU_AGENT_CREDENTIAL_ID=${OU_AGENT_CREDENTIAL_ID}
OU_AGENT_SESSION_ID=${OU_AGENT_SESSION_ID}
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
  last_seen_command_seq="0"
  if [[ -f "${OU_AGENT_STATE_DIR}/last-seen-command-seq" ]]; then
    last_seen_command_seq="$(cat "${OU_AGENT_STATE_DIR}/last-seen-command-seq" 2>/dev/null || printf '0')"
  fi
  if ! [[ "${last_seen_command_seq}" =~ ^[0-9]+$ ]]; then
    last_seen_command_seq="0"
  fi
  response="$(
    curl -fsS \
      --max-time 20 \
      -H "Authorization: Bearer ${OU_AGENT_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "{\"agentId\":\"${OU_AGENT_ID}\",\"requestId\":\"${request_id}\",\"sessionId\":\"${OU_AGENT_SESSION_ID}\",\"lastSeenCommandSeq\":${last_seen_command_seq}}" \
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
  register_agent
  write_agent_env
  prepare_modules
  write_runner
  write_systemd_service
  log "Agent scaffold installed. Replace the runner with the production Agent binary when available."
}

main "$@"
