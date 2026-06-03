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

find_python() {
  if command -v python3 >/dev/null 2>&1; then
    command -v python3
    return
  fi

  if command -v python >/dev/null 2>&1; then
    command -v python
    return
  fi

  die "python3 or python is required by the lightweight Agent executor."
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
  mkdir -p \
    "${INSTALL_ROOT}/bin" \
    "${INSTALL_ROOT}/modules" \
    "${CONFIG_DIR}" \
    "${STATE_DIR}/artifacts" \
    "${STATE_DIR}/config-revisions" \
    "${STATE_DIR}/logs" \
    "${STATE_DIR}/runtime"
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
  local python_bin
  python_bin="$(find_python)"

  cat >"${CONFIG_DIR}/agent.env" <<EOF
OU_MASTER=${OU_MASTER}
OU_AGENT_ID=${OU_AGENT_ID}
OU_AGENT_TOKEN=${OU_AGENT_TOKEN}
OU_AGENT_TOKEN_EXPIRES_AT=${OU_AGENT_TOKEN_EXPIRES_AT}
OU_AGENT_CREDENTIAL_ID=${OU_AGENT_CREDENTIAL_ID}
OU_AGENT_SESSION_ID=${OU_AGENT_SESSION_ID}
OU_HOST_NAME=${OU_HOST_NAME}
OU_MAX_TRAFFIC_GB=${OU_MAX_TRAFFIC_GB:-0}
OU_INSTALL_PROFILE=${OU_INSTALL_PROFILE}
OU_AGENT_STATE_DIR=${STATE_DIR}
OU_AGENT_EXECUTOR_PATH=${INSTALL_ROOT}/bin/ou-agent-executor.py
OU_AGENT_PYTHON_BIN=${OU_AGENT_PYTHON_BIN:-${python_bin}}
OU_AGENT_POLL_INTERVAL_SECONDS=${OU_AGENT_POLL_INTERVAL_SECONDS:-10}
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
  cat >"${INSTALL_ROOT}/bin/ou-agent-executor.py" <<'PY'
#!/usr/bin/env python3
import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path


def utc_now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def log(state_dir, message):
    logs = Path(state_dir) / "logs"
    logs.mkdir(parents=True, exist_ok=True)
    with (logs / "agent.log").open("a", encoding="utf-8") as handle:
        handle.write(f"[OU-UI Agent] {utc_now()} {message}\n")


def request_json(url, token, body, timeout=20):
    payload = json.dumps(body, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(path.suffix + ".tmp")
    temp_path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp_path.replace(path)


def send_event(master_poll_url, token, event):
    events_url = master_poll_url.rstrip("/").rsplit("/", 1)[0] + "/events"
    return request_json(events_url, token, {"events": [event]}, timeout=20)


def build_event(command, event_type, seq, payload):
    return {
        "type": event_type,
        "eventId": f"evt-{event_type}-{command['commandId']}-{seq}",
        "commandId": command["commandId"],
        "taskId": command["taskId"],
        "agentId": command["agentId"],
        "seq": seq,
        "sessionId": command.get("sessionId") or os.environ["OU_AGENT_SESSION_ID"],
        "observedAt": utc_now(),
        "payload": payload,
    }


def apply_command(state_dir, command):
    payload = command.get("payload", {})
    revision = payload.get("configRevision", f"cfg-{command['commandId']}")
    module_kind = payload.get("moduleKind", "system")
    artifact = payload.get("artifact") or {
        "artifactUri": payload.get("artifactUri"),
        "moduleKind": module_kind,
        "configRevision": revision,
    }
    revision_path = Path(state_dir) / "config-revisions" / f"{revision}.json"
    module_path = Path(state_dir) / "runtime" / f"{module_kind}.json"

    write_json(
        revision_path,
        {
            "commandId": command["commandId"],
            "taskId": command["taskId"],
            "agentId": command["agentId"],
            "moduleKind": module_kind,
            "configRevision": revision,
            "artifact": artifact,
            "appliedAt": utc_now(),
        },
    )
    write_json(
        module_path,
        {
            "moduleKind": module_kind,
            "activeConfigRevision": revision,
            "lastCommandId": command["commandId"],
            "lastAppliedAt": utc_now(),
        },
    )

    return {
        "changedFiles": [str(revision_path), str(module_path)],
        "healthSummary": {
            "moduleKind": module_kind,
            "activeConfigRevision": revision,
            "artifactVersion": artifact.get("artifactVersion") if isinstance(artifact, dict) else None,
            "runtime": "applied",
        },
    }


def process_command(state_dir, master_poll_url, token, outbox_item):
    command = outbox_item.get("command", outbox_item)
    seq = int(command.get("seq", outbox_item.get("seq", 0)))
    send_event(master_poll_url, token, build_event(command, "ack", seq + 1, {"duplicate": False}))

    try:
        if command.get("type") == "apply":
            result = apply_command(state_dir, command)
            payload = {
                "status": "succeeded",
                "appliedConfigRevision": command.get("payload", {}).get("configRevision"),
                "changedFiles": result["changedFiles"],
                "healthSummary": result["healthSummary"],
            }
        elif command.get("type") == "reload":
            payload = {
                "status": "succeeded",
                "appliedConfigRevision": command.get("payload", {}).get("configRevision"),
                "healthSummary": {
                    "moduleKind": command.get("payload", {}).get("moduleKind"),
                    "reloadMode": command.get("payload", {}).get("reloadMode"),
                    "runtime": "reloaded",
                },
            }
        elif command.get("type") == "rollback":
            payload = {
                "status": "rolled_back",
                "appliedConfigRevision": command.get("payload", {}).get("targetConfigRevision"),
                "healthSummary": {
                    "snapshotId": command.get("payload", {}).get("snapshotId"),
                    "runtime": "rolled_back",
                },
            }
        else:
            payload = {
                "status": "succeeded",
                "healthSummary": {
                    "runtime": "acknowledged",
                    "commandType": command.get("type"),
                },
            }
    except Exception as error:
        payload = {
            "status": "failed",
            "failureReason": str(error),
            "retryable": True,
        }

    send_event(master_poll_url, token, build_event(command, "result", seq + 2, payload))
    return seq


def main():
    master = os.environ["OU_MASTER"]
    agent_id = os.environ["OU_AGENT_ID"]
    token = os.environ["OU_AGENT_TOKEN"]
    session_id = os.environ["OU_AGENT_SESSION_ID"]
    state_dir = os.environ["OU_AGENT_STATE_DIR"]
    seq_path = Path(state_dir) / "last-seen-command-seq"
    last_seen = 0

    if seq_path.exists():
        try:
            last_seen = int(seq_path.read_text(encoding="utf-8").strip() or "0")
        except ValueError:
            last_seen = 0

    request_id = f"agent-{agent_id}-{int(time.time())}"
    response = request_json(
        master,
        token,
        {
            "agentId": agent_id,
            "requestId": request_id,
            "sessionId": session_id,
            "lastSeenCommandSeq": last_seen,
        },
        timeout=20,
    )
    commands = response.get("data", {}).get("commands", [])
    log(state_dir, f"poll request_id={request_id} commands={len(commands)}")

    for item in commands:
        last_seen = max(last_seen, process_command(state_dir, master, token, item))

    seq_path.write_text(str(last_seen), encoding="utf-8")


if __name__ == "__main__":
    main()
PY

  cat >"${INSTALL_ROOT}/bin/ou-agent-runner" <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail

source "${CONFIG_DIR}/agent.env"

mkdir -p "\${OU_AGENT_STATE_DIR}/logs"
printf '[OU-UI Agent] started agent_id=%s master=%s profile=%s\n' "\${OU_AGENT_ID}" "\${OU_MASTER}" "\${OU_INSTALL_PROFILE}" >>"\${OU_AGENT_STATE_DIR}/logs/agent.log"

while true; do
  if ! "\${OU_AGENT_PYTHON_BIN}" "\${OU_AGENT_EXECUTOR_PATH}" >>"\${OU_AGENT_STATE_DIR}/logs/agent.log" 2>&1; then
    printf '[OU-UI Agent] executor failed at %s\n' "\$(date -u +%FT%TZ)" >>"\${OU_AGENT_STATE_DIR}/logs/agent.log"
  fi
  sleep "\${OU_AGENT_POLL_INTERVAL_SECONDS}"
done
EOF

  chmod 750 "${INSTALL_ROOT}/bin/ou-agent-executor.py"
  chmod 750 "${INSTALL_ROOT}/bin/ou-agent-runner"
  chown "${SERVICE_USER}:${SERVICE_USER}" "${INSTALL_ROOT}/bin/ou-agent-executor.py" "${INSTALL_ROOT}/bin/ou-agent-runner"
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
