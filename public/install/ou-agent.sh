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
OU_INSTALL_PROFILE="${OU_INSTALL_PROFILE:-host-agent,xray,port-forwarding,telemetry,command-channel}"

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
  local detected_host_name
  python_bin="$(find_python)"
  detected_host_name="${OU_HOST_NAME:-$(hostname -f 2>/dev/null || hostname 2>/dev/null || printf '%s' "${OU_AGENT_ID}")}"

  cat >"${CONFIG_DIR}/agent.env" <<EOF
OU_MASTER=${OU_MASTER}
OU_AGENT_ID=${OU_AGENT_ID}
OU_AGENT_TOKEN=${OU_AGENT_TOKEN}
OU_AGENT_TOKEN_EXPIRES_AT=${OU_AGENT_TOKEN_EXPIRES_AT}
OU_AGENT_CREDENTIAL_ID=${OU_AGENT_CREDENTIAL_ID}
OU_AGENT_SESSION_ID=${OU_AGENT_SESSION_ID}
OU_HOST_NAME=${detected_host_name}
OU_MAX_TRAFFIC_GB=${OU_MAX_TRAFFIC_GB:-0}
OU_INSTALL_PROFILE=${OU_INSTALL_PROFILE}
OU_AGENT_STATE_DIR=${STATE_DIR}
OU_AGENT_EXECUTOR_PATH=${INSTALL_ROOT}/bin/ou-agent-executor.py
OU_AGENT_PYTHON_BIN=${OU_AGENT_PYTHON_BIN:-${python_bin}}
OU_AGENT_POLL_INTERVAL_SECONDS=${OU_AGENT_POLL_INTERVAL_SECONDS:-10}
OU_AGENT_TELEMETRY_INTERVAL_SECONDS=${OU_AGENT_TELEMETRY_INTERVAL_SECONDS:-30}
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
import re
import shutil
import subprocess
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


def read_json(path, fallback):
    try:
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return fallback
    return fallback


def send_event(master_poll_url, token, event):
    events_url = master_poll_url.rstrip("/").rsplit("/", 1)[0] + "/events"
    return request_json(events_url, token, {"events": [event]}, timeout=20)


def next_event_seq(state_dir):
    seq_path = Path(state_dir) / "event-seq"
    try:
        seq = int(seq_path.read_text(encoding="utf-8").strip() or "0") + 1
    except ValueError:
        seq = 1
    seq_path.write_text(str(seq), encoding="utf-8")
    return seq


def build_agent_event(state_dir, agent_id, session_id, event_type, payload):
    seq = next_event_seq(state_dir)
    return {
        "type": event_type,
        "eventId": f"evt-{event_type}-{agent_id}-{seq}",
        "agentId": agent_id,
        "seq": seq,
        "sessionId": session_id,
        "observedAt": utc_now(),
        "payload": payload,
    }


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


def read_cpu_times():
    try:
        with Path("/proc/stat").open("r", encoding="utf-8") as handle:
            parts = handle.readline().split()
    except OSError:
        return None

    if len(parts) < 5 or parts[0] != "cpu":
        return None

    values = [int(value) for value in parts[1:] if value.isdigit()]
    idle = values[3] + (values[4] if len(values) > 4 else 0)
    return {"idle": idle, "total": sum(values), "sampledAt": time.time()}


def collect_cpu_percent(state_dir):
    current = read_cpu_times()
    if not current:
        return 0

    sample_path = Path(state_dir) / "runtime" / "cpu-sample.json"
    previous = read_json(sample_path, {})
    write_json(sample_path, current)

    total_delta = current["total"] - int(previous.get("total", current["total"]))
    idle_delta = current["idle"] - int(previous.get("idle", current["idle"]))
    if total_delta <= 0:
        return 0

    return max(0, min(100, round((1 - idle_delta / total_delta) * 100, 2)))


def collect_memory():
    values = {}
    try:
        with Path("/proc/meminfo").open("r", encoding="utf-8") as handle:
            for line in handle:
                key, raw_value = line.split(":", 1)
                values[key] = int(raw_value.strip().split()[0]) * 1024
    except OSError:
        return {"memoryUsedBytes": 0, "memoryTotalBytes": 0, "memoryPercent": 0}

    total = values.get("MemTotal", 0)
    available = values.get("MemAvailable", 0)
    used = max(total - available, 0)
    percent = round((used / total) * 100, 2) if total else 0
    return {"memoryUsedBytes": used, "memoryTotalBytes": total, "memoryPercent": percent}


def collect_disk():
    try:
        disk = shutil.disk_usage("/")
    except OSError:
        return {"diskUsedBytes": 0, "diskTotalBytes": 0, "diskPercent": 0}

    used = disk.total - disk.free
    percent = round((used / disk.total) * 100, 2) if disk.total else 0
    return {"diskUsedBytes": used, "diskTotalBytes": disk.total, "diskPercent": percent}


def read_network_counters():
    rx_bytes = 0
    tx_bytes = 0
    try:
        lines = Path("/proc/net/dev").read_text(encoding="utf-8").splitlines()[2:]
    except OSError:
        return {"rxBytes": 0, "txBytes": 0, "sampledAt": time.time()}

    for line in lines:
        if ":" not in line:
            continue
        iface, raw_fields = line.split(":", 1)
        if iface.strip() == "lo":
            continue
        fields = raw_fields.split()
        if len(fields) >= 16:
            rx_bytes += int(fields[0])
            tx_bytes += int(fields[8])

    return {"rxBytes": rx_bytes, "txBytes": tx_bytes, "sampledAt": time.time()}


def collect_network(state_dir):
    current = read_network_counters()
    sample_path = Path(state_dir) / "runtime" / "net-sample.json"
    previous = read_json(sample_path, {})
    write_json(sample_path, current)

    elapsed = current["sampledAt"] - float(previous.get("sampledAt", current["sampledAt"]))
    if elapsed <= 0:
        upload_speed = 0
        download_speed = 0
    else:
        upload_speed = max(0, round((current["txBytes"] - int(previous.get("txBytes", current["txBytes"]))) / elapsed))
        download_speed = max(0, round((current["rxBytes"] - int(previous.get("rxBytes", current["rxBytes"]))) / elapsed))

    return {
        "txBytes": current["txBytes"],
        "rxBytes": current["rxBytes"],
        "monthlyEgressBytes": current["txBytes"],
        "monthlyIngressBytes": current["rxBytes"],
        "monthlyTrafficUsedBytes": current["txBytes"] + current["rxBytes"],
        "uploadSpeedBps": upload_speed,
        "downloadSpeedBps": download_speed,
        "uploadTotalBytes": current["txBytes"],
        "downloadTotalBytes": current["rxBytes"],
    }


def read_cpu_model():
    try:
        for line in Path("/proc/cpuinfo").read_text(encoding="utf-8", errors="ignore").splitlines():
            if line.lower().startswith(("model name", "hardware")) and ":" in line:
                return line.split(":", 1)[1].strip()
    except OSError:
        return None
    return None


def read_primary_nic():
    try:
        for line in Path("/proc/net/route").read_text(encoding="utf-8").splitlines()[1:]:
            fields = line.split()
            if len(fields) >= 2 and fields[1] == "00000000":
                return fields[0]
    except OSError:
        pass

    try:
        for line in Path("/proc/net/dev").read_text(encoding="utf-8").splitlines()[2:]:
            if ":" in line:
                iface = line.split(":", 1)[0].strip()
                if iface != "lo":
                    return iface
    except OSError:
        return None
    return None


def read_virtualization():
    detector = shutil.which("systemd-detect-virt")
    if not detector:
        return None
    try:
        result = subprocess.run([detector], text=True, capture_output=True, timeout=2, check=False)
    except Exception:
        return None
    value = result.stdout.strip()
    return value if value and value != "none" else None


def read_uptime_seconds():
    try:
        return int(float(Path("/proc/uptime").read_text(encoding="utf-8").split()[0]))
    except Exception:
        return 0


def read_probe_target(state_dir):
    module_state = read_json(Path(state_dir) / "runtime" / "host-agent.json", {})
    artifact = module_state.get("artifact", {}) if isinstance(module_state, dict) else {}
    host_profile = artifact.get("hostProfile", {}) if isinstance(artifact, dict) else {}
    probe_config = host_profile.get("probeConfig") or artifact.get("probeConfig") or {}
    return (
        probe_config.get("pingTarget")
        or os.environ.get("OU_PING_TARGET")
        or "1.1.1.1"
    )


def collect_ping(target):
    ping_bin = shutil.which("ping")
    if not ping_bin or not target:
        return {"latencyMs": 0, "packetLossPercent": 0}

    try:
        result = subprocess.run(
            [ping_bin, "-c", "3", "-W", "2", target],
            text=True,
            capture_output=True,
            timeout=8,
            check=False,
        )
    except Exception:
        return {"latencyMs": 0, "packetLossPercent": 100}

    output = f"{result.stdout}\n{result.stderr}"
    latency = 0
    loss = 100 if result.returncode else 0
    loss_match = re.search(r"([0-9.]+)% packet loss", output)
    rtt_match = re.search(r"(?:rtt|round-trip).* = [0-9.]+/([0-9.]+)/", output)
    time_match = re.search(r"time=([0-9.]+) ?ms", output)

    if loss_match:
        loss = float(loss_match.group(1))
    if rtt_match:
        latency = round(float(rtt_match.group(1)))
    elif time_match:
        latency = round(float(time_match.group(1)))

    return {"latencyMs": latency, "packetLossPercent": loss}


def append_sample(state_dir, key, value):
    history_path = Path(state_dir) / "runtime" / "telemetry-history.json"
    history = read_json(history_path, {"latencySamplesMs": [], "packetLossSamplesPercent": []})
    samples = history.get(key, [])
    samples = [item for item in samples if isinstance(item, (int, float))]
    samples.append(value)
    history[key] = samples[-10:]
    write_json(history_path, history)
    return history[key]


def collect_telemetry(state_dir):
    now = utc_now()
    memory = collect_memory()
    disk = collect_disk()
    network = collect_network(state_dir)
    ping = collect_ping(read_probe_target(state_dir))
    uptime_seconds = read_uptime_seconds()

    return {
        "cpuPercent": collect_cpu_percent(state_dir),
        "cpuCores": os.cpu_count() or 1,
        **memory,
        **disk,
        **network,
        "latencyMs": ping["latencyMs"],
        "latencySamplesMs": append_sample(state_dir, "latencySamplesMs", ping["latencyMs"]),
        "packetLossPercent": ping["packetLossPercent"],
        "packetLossSamplesPercent": append_sample(state_dir, "packetLossSamplesPercent", ping["packetLossPercent"]),
        "onlineDays": uptime_seconds // 86400,
        "uptimeSeconds": uptime_seconds,
        "reportedAt": now,
        "cpuModel": read_cpu_model(),
        "kernelVersion": os.uname().release if hasattr(os, "uname") else None,
        "virtualization": read_virtualization(),
        "primaryNetworkInterface": read_primary_nic(),
        "hardwareDetectedAt": now,
        "trafficTelemetrySource": "agent",
        "hardwareTelemetrySource": "agent",
    }


def send_heartbeat(state_dir, master_poll_url, token, agent_id, session_id, last_seen):
    payload = {
        "version": os.environ.get("OU_AGENT_VERSION", "0.1.0-scaffold"),
        "uptimeSeconds": read_uptime_seconds(),
        "lastSeenCommandSeq": last_seen,
    }
    send_event(master_poll_url, token, build_agent_event(state_dir, agent_id, session_id, "heartbeat", payload))


def maybe_send_telemetry(state_dir, master_poll_url, token, agent_id, session_id):
    interval = int(os.environ.get("OU_AGENT_TELEMETRY_INTERVAL_SECONDS", "30"))
    marker_path = Path(state_dir) / "runtime" / "last-telemetry-at"
    now = time.time()
    try:
        last_sent_at = float(marker_path.read_text(encoding="utf-8").strip() or "0")
    except Exception:
        last_sent_at = 0

    if now - last_sent_at < interval:
        return

    payload = collect_telemetry(state_dir)
    send_event(master_poll_url, token, build_agent_event(state_dir, agent_id, session_id, "telemetry_sample", payload))
    marker_path.write_text(str(now), encoding="utf-8")


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

    try:
        send_heartbeat(state_dir, master, token, agent_id, session_id, last_seen)
        maybe_send_telemetry(state_dir, master, token, agent_id, session_id)
    except Exception as error:
        log(state_dir, f"telemetry event failed: {error}")

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
