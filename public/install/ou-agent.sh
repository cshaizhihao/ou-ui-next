#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

APP_NAME="OU-UI Agent"
INSTALL_ROOT="${OU_AGENT_INSTALL_ROOT:-/opt/ou-ui-agent}"
CONFIG_DIR="${OU_AGENT_CONFIG_DIR:-/etc/ou-ui-agent}"
STATE_DIR="${OU_AGENT_STATE_DIR:-/var/lib/ou-ui-agent}"
SERVICE_NAME="${OU_AGENT_SERVICE_NAME:-ou-ui-agent}"
SERVICE_USER="${OU_AGENT_SERVICE_USER:-ouui-agent}"
AGENT_VERSION="${OU_AGENT_VERSION:-1.0.0-runtime}"
GOST_VERSION="${OU_GOST_VERSION:-3.2.6}"
OU_INSTALL_PROFILE="${OU_INSTALL_PROFILE:-host-agent,xray,port-forwarding,telemetry,command-channel}"
DEFAULT_AGENT_SCRIPT_URL="${OU_AGENT_INSTALL_SCRIPT_URL:-https://raw.githubusercontent.com/cshaizhihao/ou-ui-next/main/public/install/ou-agent.sh}"

log() {
  printf '[%s] %s\n' "${APP_NAME}" "$1"
}

die() {
  printf '[%s] %s\n' "${APP_NAME}" "$1" >&2
  exit 1
}

warn() {
  printf '[%s] %s\n' "${APP_NAME}" "$1" >&2
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

detect_package_manager() {
  if command -v apt-get >/dev/null 2>&1; then
    printf 'apt'
    return
  fi

  if command -v dnf >/dev/null 2>&1; then
    printf 'dnf'
    return
  fi

  if command -v yum >/dev/null 2>&1; then
    printf 'yum'
    return
  fi

  printf ''
}

install_runtime_dependencies() {
  local missing="no"
  command -v python3 >/dev/null 2>&1 || command -v python >/dev/null 2>&1 || missing="yes"
  command -v socat >/dev/null 2>&1 || missing="yes"
  command -v ping >/dev/null 2>&1 || missing="yes"
  command -v ip >/dev/null 2>&1 || missing="yes"
  command -v tar >/dev/null 2>&1 || missing="yes"
  command -v nft >/dev/null 2>&1 || missing="yes"

  [[ "${missing}" == "yes" ]] || return

  local package_manager
  package_manager="$(detect_package_manager)"

  if [[ -z "${package_manager}" ]]; then
    warn "未识别到 apt/dnf/yum，跳过自动依赖安装；请确认 python3、socat、ping、ip、tar、nft 命令已可用。"
    return
  fi

  log "安装 Agent 运行时依赖：python3、socat、ping、iproute、tar、nftables。"
  case "${package_manager}" in
    apt)
      export DEBIAN_FRONTEND=noninteractive
      apt-get update -y
      apt-get install -y python3 curl ca-certificates iproute2 iputils-ping socat tar nftables
      ;;
    dnf)
      dnf install -y python3 curl ca-certificates iproute iputils socat tar nftables
      ;;
    yum)
      yum install -y python3 curl ca-certificates iproute iputils socat tar nftables
      ;;
  esac
}

install_gost_runtime() {
  if command -v gost >/dev/null 2>&1; then
    return
  fi

  if ! command -v curl >/dev/null 2>&1 || ! command -v tar >/dev/null 2>&1; then
    warn "缺少 curl 或 tar，无法自动安装 GOST；带限速的端口转发下发会明确失败。"
    return
  fi

  local arch
  arch="$(uname -m 2>/dev/null || printf 'unknown')"
  case "${arch}" in
    x86_64|amd64)
      arch="amd64"
      ;;
    aarch64|arm64)
      arch="arm64"
      ;;
    armv7l)
      arch="armv7"
      ;;
    *)
      warn "暂不支持自动安装当前架构的 GOST：${arch}。"
      return
      ;;
  esac

  local tmp_dir
  local archive
  local url
  tmp_dir="$(mktemp -d)"
  archive="${tmp_dir}/gost.tar.gz"
  url="https://github.com/go-gost/gost/releases/download/v${GOST_VERSION}/gost_${GOST_VERSION}_linux_${arch}.tar.gz"

  log "安装 GOST ${GOST_VERSION}（用于端口转发与带宽限速）。"
  if ! curl -fsSL "${url}" -o "${archive}"; then
    warn "GOST 下载失败：${url}"
    rm -rf "${tmp_dir}"
    return
  fi

  if ! tar -xzf "${archive}" -C "${tmp_dir}"; then
    warn "GOST 解压失败。"
    rm -rf "${tmp_dir}"
    return
  fi

  local gost_bin
  gost_bin="$(find "${tmp_dir}" -type f -name gost | head -n 1 || true)"
  if [[ -z "${gost_bin}" ]]; then
    warn "GOST 安装包内未找到 gost 可执行文件。"
    rm -rf "${tmp_dir}"
    return
  fi

  install -m 755 "${gost_bin}" /usr/local/bin/gost
  rm -rf "${tmp_dir}"
}

install_xray_runtime() {
  if command -v xray >/dev/null 2>&1; then
    return
  fi

  if ! command -v curl >/dev/null 2>&1; then
    warn "未找到 curl，无法自动安装 Xray；Xray 入站下发会在运行时明确失败。"
    return
  fi

  log "安装 Xray 运行时（用于客户节点协议入站）。"
  if ! bash -c "$(curl -fsSL https://github.com/XTLS/Xray-install/raw/main/install-release.sh)" @ install; then
    warn "Xray 自动安装失败；Agent 仍会接入主控端，但客户节点协议下发会提示缺少 xray。"
  fi
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
OU_AGENT_VERSION=${AGENT_VERSION}
OU_MAX_TRAFFIC_GB=${OU_MAX_TRAFFIC_GB:-0}
OU_INSTALL_PROFILE=${OU_INSTALL_PROFILE}
OU_AGENT_STATE_DIR=${STATE_DIR}
OU_AGENT_CONFIG_DIR=${CONFIG_DIR}
OU_AGENT_EXECUTOR_PATH=${INSTALL_ROOT}/bin/ou-agent-executor.py
OU_AGENT_PYTHON_BIN=${OU_AGENT_PYTHON_BIN:-${python_bin}}
OU_AGENT_POLL_INTERVAL_SECONDS=${OU_AGENT_POLL_INTERVAL_SECONDS:-10}
OU_AGENT_TELEMETRY_INTERVAL_SECONDS=${OU_AGENT_TELEMETRY_INTERVAL_SECONDS:-30}
OU_AGENT_INSTALL_SCRIPT_URL=${DEFAULT_AGENT_SCRIPT_URL}
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
import hashlib
import datetime
import ipaddress
import os
import re
import shlex
import shutil
import socket
import subprocess
import time
import urllib.error
import urllib.parse
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


def write_text_file(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(path.suffix + ".tmp")
    temp_path.write_text(value, encoding="utf-8")
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


def pending_events_path(state_dir):
    return Path(state_dir) / "runtime" / "pending-events.json"


def load_pending_events(state_dir):
    events = read_json(pending_events_path(state_dir), [])
    return events if isinstance(events, list) else []


def save_pending_events(state_dir, events):
    write_json(pending_events_path(state_dir), events)


def enqueue_pending_event(state_dir, event):
    events = load_pending_events(state_dir)
    event_ids = {item.get("eventId") for item in events if isinstance(item, dict)}
    if event.get("eventId") not in event_ids:
        events.append(event)
    save_pending_events(state_dir, events)


def flush_pending_events(state_dir, master_poll_url, token):
    events = load_pending_events(state_dir)
    if not events:
        return

    remaining = list(events)
    while remaining:
        event = remaining[0]
        try:
            send_event(master_poll_url, token, event)
            remaining.pop(0)
            save_pending_events(state_dir, remaining)
        except Exception as error:
            save_pending_events(state_dir, remaining)
            raise RuntimeError(f"pending Agent event delivery failed: {error}") from error


def send_event_or_queue(state_dir, master_poll_url, token, event, queue_on_failure=False):
    try:
        send_event(master_poll_url, token, event)
        return True
    except Exception as error:
        if not queue_on_failure:
            raise
        enqueue_pending_event(state_dir, event)
        log(state_dir, f"queued Agent event {event.get('eventId')} for retry: {error}")
        return False


def next_event_seq(state_dir, minimum=0):
    seq_path = Path(state_dir) / "event-seq"
    try:
        current = int(seq_path.read_text(encoding="utf-8").strip() or "0")
    except ValueError:
        current = 0
    seq = max(current + 1, int(minimum) + 1)
    seq_path.write_text(str(seq), encoding="utf-8")
    return seq


def build_agent_event(state_dir, agent_id, session_id, event_type, payload, minimum_seq=0):
    seq = next_event_seq(state_dir, minimum_seq)
    return {
        "type": event_type,
        "eventId": f"evt-{event_type}-{agent_id}-{seq}",
        "agentId": agent_id,
        "seq": seq,
        "sessionId": session_id,
        "observedAt": utc_now(),
        "payload": payload,
    }


def build_command_event(state_dir, command, event_type, payload, minimum_seq=0):
    seq = next_event_seq(state_dir, minimum_seq)
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


def read_host_agent_artifact(state_dir):
    module_state = read_json(Path(state_dir) / "runtime" / "host-agent.json", {})
    artifact = module_state.get("artifact", {}) if isinstance(module_state, dict) else {}

    if isinstance(artifact, dict) and artifact:
        return artifact

    config_profile = read_json(config_dir() / "host-agent.json", {})
    return config_profile if isinstance(config_profile, dict) else {}


def read_host_profile(state_dir):
    artifact = read_host_agent_artifact(state_dir)
    host_profile = artifact.get("hostProfile", {}) if isinstance(artifact, dict) else {}

    if isinstance(host_profile, dict) and host_profile:
        return host_profile

    return {}


def read_telemetry_plan(state_dir):
    artifact = read_host_agent_artifact(state_dir)
    telemetry_plan = artifact.get("telemetryPlan", {}) if isinstance(artifact, dict) else {}
    return telemetry_plan if isinstance(telemetry_plan, dict) else {}


def clamp_reset_day(value):
    try:
        day = int(value)
    except Exception:
        day = 1
    return max(1, min(31, day))


def read_traffic_policy(state_dir):
    telemetry_plan = read_telemetry_plan(state_dir)
    counters = telemetry_plan.get("trafficCounters", {}) if isinstance(telemetry_plan, dict) else {}
    host_profile = read_host_profile(state_dir)
    policy = host_profile.get("trafficPolicy", {}) if isinstance(host_profile, dict) else {}
    mode = counters.get("accountingMode") if isinstance(counters, dict) else None
    if not mode:
        mode = policy.get("accountingMode") if isinstance(policy, dict) else "both"

    if mode not in ("both", "single", "ingress", "egress"):
        mode = "both"

    try:
        manual_used = int(
            counters.get("manualUsedTrafficBytes")
            if isinstance(counters, dict) and counters.get("manualUsedTrafficBytes") is not None
            else policy.get("manualUsedTrafficBytes", 0)
        )
    except Exception:
        manual_used = 0

    return {
        "accountingMode": mode,
        "monthlyResetDay": clamp_reset_day(
            counters.get("monthlyResetDay")
            if isinstance(counters, dict) and counters.get("monthlyResetDay") is not None
            else policy.get("monthlyResetDay", 1) if isinstance(policy, dict) else 1
        ),
        "manualUsedTrafficBytes": max(0, manual_used),
    }


def billing_period_key(reset_day):
    now = time.gmtime()
    year = now.tm_year
    month = now.tm_mon

    if now.tm_mday < reset_day:
        month -= 1
        if month == 0:
            month = 12
            year -= 1

    return f"{year:04d}-{month:02d}-reset-{reset_day:02d}"


def calculate_accounted_traffic(mode, ingress_bytes, egress_bytes, manual_used_bytes):
    if mode == "single":
        metered = max(ingress_bytes, egress_bytes)
    elif mode == "ingress":
        metered = ingress_bytes
    elif mode == "egress":
        metered = egress_bytes
    else:
        metered = ingress_bytes + egress_bytes

    return max(0, manual_used_bytes + metered)


def read_int(value, fallback=0):
    try:
        return int(value)
    except Exception:
        return fallback


def read_float(value, fallback=0.0):
    try:
        return float(value)
    except Exception:
        return fallback


def parse_utc_epoch(value):
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=datetime.timezone.utc)
        return parsed.timestamp()
    except Exception:
        return None


def read_host_guardrail_limits(state_dir):
    host_profile = read_host_profile(state_dir)
    telemetry_plan = read_telemetry_plan(state_dir)
    counters = telemetry_plan.get("trafficCounters", {}) if isinstance(telemetry_plan, dict) else {}
    monthly_limit = 0

    for value in (
        counters.get("monthlyTrafficLimitBytes") if isinstance(counters, dict) else None,
        counters.get("monthlyTrafficBytes") if isinstance(counters, dict) else None,
        host_profile.get("monthlyTrafficLimitBytes") if isinstance(host_profile, dict) else None,
        host_profile.get("monthlyTrafficBytes") if isinstance(host_profile, dict) else None,
    ):
        monthly_limit = read_int(value, 0)
        if monthly_limit > 0:
            break

    return {
        "monthlyTrafficLimitBytes": max(0, monthly_limit),
        "expiresAt": host_profile.get("expiresAt") if isinstance(host_profile, dict) else None,
    }


def managed_runtime_units(state_dir):
    units = []
    xray_unit = systemd_unit_dir() / "ou-ui-xray.service"
    if xray_unit.exists():
        units.append(xray_unit.name)

    for state_name in ("port-forwarding.json", "flvx.json"):
        state = read_json(runtime_dir(state_dir) / state_name, {})
        services = state.get("services", []) if isinstance(state, dict) else []
        for unit in services:
            if isinstance(unit, str) and unit.endswith(".service"):
                units.append(unit)

    for pattern in ("ou-forward-*.service", "ou-tunnel-*.service"):
        for path in systemd_unit_dir().glob(pattern):
            units.append(path.name)

    return sorted(dict.fromkeys(units))


def stop_managed_runtime_units(state_dir, reason):
    stopped = []
    for unit in managed_runtime_units(state_dir):
        result = systemctl(state_dir, "disable", "--now", unit, check=False)
        if result.returncode == 0:
            stopped.append(unit)
    if stopped:
        log(state_dir, f"host guardrail disabled runtime units reason={reason} units={','.join(stopped)}")
    return stopped


def evaluate_host_guardrails(state_dir, monthly_traffic):
    limits = read_host_guardrail_limits(state_dir)
    monthly_limit = limits["monthlyTrafficLimitBytes"]
    monthly_used = read_int(monthly_traffic.get("monthlyTrafficUsedBytes"), 0)
    expires_at = limits.get("expiresAt")
    expires_epoch = parse_utc_epoch(expires_at)
    host_expired = expires_epoch is not None and time.time() >= expires_epoch
    quota_exceeded = monthly_limit > 0 and monthly_used >= monthly_limit
    reasons = []

    if host_expired:
        reasons.append("host_expired")
    if quota_exceeded:
        reasons.append("monthly_traffic_quota_exceeded")

    return {
        "monthlyTrafficLimitBytes": monthly_limit,
        "quotaExceeded": quota_exceeded,
        "hostExpired": host_expired,
        "runtimeDisabledByPolicy": bool(reasons),
        "guardrailReason": ",".join(reasons) if reasons else "ok",
    }


def enforce_host_guardrails(state_dir, monthly_traffic):
    state = evaluate_host_guardrails(state_dir, monthly_traffic)
    state["stoppedUnits"] = []
    state["evaluatedAt"] = utc_now()

    if state["runtimeDisabledByPolicy"]:
        try:
            state["stoppedUnits"] = stop_managed_runtime_units(state_dir, state["guardrailReason"])
        except Exception as error:
            state["enforcementError"] = str(error)

    write_json(runtime_dir(state_dir) / "host-guardrails.json", state)
    return state


def update_monthly_traffic_baseline(state_dir, current, traffic_policy):
    baseline_path = Path(state_dir) / "runtime" / "monthly-traffic-baseline.json"
    period_key = billing_period_key(traffic_policy["monthlyResetDay"])
    baseline = read_json(baseline_path, {})

    if baseline.get("periodKey") != period_key:
        baseline = {
            "periodKey": period_key,
            "rxBase": current["rxBytes"],
            "txBase": current["txBytes"],
            "rxCarry": 0,
            "txCarry": 0,
            "lastRx": current["rxBytes"],
            "lastTx": current["txBytes"],
            "resetAt": utc_now(),
        }

    rx_base = int(baseline.get("rxBase", current["rxBytes"]))
    tx_base = int(baseline.get("txBase", current["txBytes"]))
    rx_carry = int(baseline.get("rxCarry", 0))
    tx_carry = int(baseline.get("txCarry", 0))
    last_rx = int(baseline.get("lastRx", current["rxBytes"]))
    last_tx = int(baseline.get("lastTx", current["txBytes"]))

    if current["rxBytes"] < last_rx:
        rx_carry += max(0, last_rx - rx_base)
        rx_base = current["rxBytes"]

    if current["txBytes"] < last_tx:
        tx_carry += max(0, last_tx - tx_base)
        tx_base = current["txBytes"]

    monthly_ingress = rx_carry + max(0, current["rxBytes"] - rx_base)
    monthly_egress = tx_carry + max(0, current["txBytes"] - tx_base)
    baseline.update(
        {
            "rxBase": rx_base,
            "txBase": tx_base,
            "rxCarry": rx_carry,
            "txCarry": tx_carry,
            "lastRx": current["rxBytes"],
            "lastTx": current["txBytes"],
            "updatedAt": utc_now(),
        }
    )
    write_json(baseline_path, baseline)

    return {
        "monthlyIngressBytes": monthly_ingress,
        "monthlyEgressBytes": monthly_egress,
        "monthlyTrafficUsedBytes": calculate_accounted_traffic(
            traffic_policy["accountingMode"],
            monthly_ingress,
            monthly_egress,
            traffic_policy["manualUsedTrafficBytes"],
        ),
        "trafficAccountingMode": traffic_policy["accountingMode"],
        "monthlyResetDay": traffic_policy["monthlyResetDay"],
        "manualUsedTrafficBytes": traffic_policy["manualUsedTrafficBytes"],
        "trafficBillingPeriod": period_key,
    }


def collect_network(state_dir):
    current = read_network_counters()
    traffic_policy = read_traffic_policy(state_dir)
    monthly_traffic = update_monthly_traffic_baseline(state_dir, current, traffic_policy)
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
        **monthly_traffic,
        "uploadSpeedBps": upload_speed,
        "downloadSpeedBps": download_speed,
        "uploadTotalBytes": current["txBytes"],
        "downloadTotalBytes": current["rxBytes"],
    }


def nft_bin():
    return shutil.which("nft")


def nft_exec(args, check=True):
    nft = nft_bin()
    if not nft:
        raise RuntimeError("nftables is required for rule-level port forwarding traffic counters")

    result = subprocess.run([nft, *args], text=True, capture_output=True, timeout=15, check=False)

    if check and result.returncode != 0:
        output = (result.stderr or result.stdout or "").strip()
        raise RuntimeError(f"nft command failed: {' '.join(args)} {output}")

    return result


def nft_chain_exists(chain):
    return nft_exec(["list", "chain", "inet", "ou_ui_forwarding", chain], check=False).returncode == 0


def ensure_forwarding_counter_table():
    nft_exec(["add", "table", "inet", "ou_ui_forwarding"], check=False)

    if not nft_chain_exists("ou_ingress"):
        nft_exec(
            [
                "add",
                "chain",
                "inet",
                "ou_ui_forwarding",
                "ou_ingress",
                "{",
                "type",
                "filter",
                "hook",
                "input",
                "priority",
                "0",
                ";",
                "policy",
                "accept",
                ";",
                "}",
            ]
        )

    if not nft_chain_exists("ou_egress"):
        nft_exec(
            [
                "add",
                "chain",
                "inet",
                "ou_ui_forwarding",
                "ou_egress",
                "{",
                "type",
                "filter",
                "hook",
                "output",
                "priority",
                "0",
                ";",
                "policy",
                "accept",
                ";",
                "}",
            ]
        )


def nft_address_match(address, field):
    if not address or address in ("0.0.0.0", "::", "*"):
        return []

    try:
        parsed = ipaddress.ip_address(str(address))
    except ValueError:
        return []

    family = "ip6" if parsed.version == 6 else "ip"
    return [family, field, str(parsed)]


def nft_port_match(protocol, port):
    return ["meta", "l4proto", protocol, protocol, "dport", str(port)]


def forwarding_counter_comment(service_name, direction, protocol):
    return f"ou-ui:{service_name}:{direction}:{protocol}"


def parse_nft_counter_handles(output, service_name):
    handles = []
    marker = f'comment "ou-ui:{service_name}:'

    for line in output.splitlines():
        if marker not in line:
            continue

        match = re.search(r"# handle ([0-9]+)", line)
        if match:
            handles.append(match.group(1))

    return handles


def delete_forwarding_counter_rules(service_name):
    if not nft_bin():
        return

    for chain in ("ou_ingress", "ou_egress"):
        listed = nft_exec(["-a", "list", "chain", "inet", "ou_ui_forwarding", chain], check=False)
        if listed.returncode != 0:
            continue

        for handle in parse_nft_counter_handles(listed.stdout, service_name):
            nft_exec(["delete", "rule", "inet", "ou_ui_forwarding", chain, "handle", handle], check=False)


def add_forwarding_counter_rule(chain, service_name, direction, protocol, address_match, port):
    nft_exec(
        [
            "add",
            "rule",
            "inet",
            "ou_ui_forwarding",
            chain,
            *address_match,
            *nft_port_match(protocol, port),
            "counter",
            "comment",
            forwarding_counter_comment(service_name, direction, protocol),
        ]
    )


def configure_forwarding_counters(service_name, protocol, listen_address, listen_port, target_address, target_port):
    ensure_forwarding_counter_table()
    delete_forwarding_counter_rules(service_name)

    for unit_protocol in forward_protocols(protocol):
        add_forwarding_counter_rule(
            "ou_ingress",
            service_name,
            "ingress",
            unit_protocol,
            nft_address_match(listen_address, "daddr"),
            listen_port,
        )
        add_forwarding_counter_rule(
            "ou_egress",
            service_name,
            "egress",
            unit_protocol,
            nft_address_match(target_address, "daddr"),
            target_port,
        )

    return "nftables"


def parse_nft_counter_totals(output):
    totals = {}

    for line in output.splitlines():
        match = re.search(
            r"counter packets [0-9]+ bytes ([0-9]+).*comment \"ou-ui:([^:\"]+):(ingress|egress):([^:\"]+)\"",
            line,
        )
        if not match:
            continue

        byte_count = int(match.group(1))
        service_name = match.group(2)
        direction = match.group(3)
        current = totals.setdefault(service_name, {"inboundBytes": 0, "outboundBytes": 0})
        if direction == "ingress":
            current["inboundBytes"] += byte_count
        else:
            current["outboundBytes"] += byte_count

    return totals


def read_forwarding_counter_totals():
    if not nft_bin():
        return {}

    totals = {}
    for chain in ("ou_ingress", "ou_egress"):
        listed = nft_exec(["list", "chain", "inet", "ou_ui_forwarding", chain], check=False)
        if listed.returncode != 0:
            continue

        for service_name, values in parse_nft_counter_totals(listed.stdout).items():
            current = totals.setdefault(service_name, {"inboundBytes": 0, "outboundBytes": 0})
            current["inboundBytes"] += values["inboundBytes"]
            current["outboundBytes"] += values["outboundBytes"]

    return totals


def bytes_from_gb(value):
    return round(max(0.0, read_float(value, 0.0)) * 1024 * 1024 * 1024)


def forwarding_rule_quota_bytes(rule):
    limits = rule.get("limits") if isinstance(rule.get("limits"), dict) else {}
    quota_bytes = read_int(limits.get("quotaBytes"), 0)

    if quota_bytes <= 0:
        quota_bytes = bytes_from_gb(limits.get("quotaGb"))

    return max(0, quota_bytes)


def forwarding_rule_manual_used_bytes(rule):
    limits = rule.get("limits") if isinstance(rule.get("limits"), dict) else {}
    manual_used = read_int(limits.get("manualUsedTrafficBytes"), 0)

    if manual_used <= 0:
        manual_used = bytes_from_gb(limits.get("manualUsedTrafficGb"))

    return max(0, manual_used)


def forwarding_rule_billed_bytes(rule, counter):
    billing = rule.get("billing") if isinstance(rule.get("billing"), dict) else {}
    direction = billing.get("direction") or "both"
    if direction not in ("both", "single", "ingress", "egress"):
        direction = "both"

    inbound = read_int(counter.get("inboundBytes"), 0)
    outbound = read_int(counter.get("outboundBytes"), 0)
    if direction == "single":
        metered = max(inbound, outbound)
    elif direction == "ingress":
        metered = inbound
    elif direction == "egress":
        metered = outbound
    else:
        metered = inbound + outbound

    multiplier = max(0.0, read_float(billing.get("trafficMultiplier"), 1.0))
    return max(0, round(forwarding_rule_manual_used_bytes(rule) + metered * multiplier))


def stop_forwarding_rule_units(state_dir, service_name, protocol, reason):
    stopped = []
    for unit_protocol in forward_protocols(protocol):
        unit = service_unit_name(service_name, unit_protocol)
        result = systemctl(state_dir, "disable", "--now", unit, check=False)
        if result.returncode == 0:
            stopped.append(unit)

    if stopped:
        log(state_dir, f"port-forwarding guardrail disabled rule reason={reason} service={service_name} units={','.join(stopped)}")

    return stopped


def enforce_forwarding_rule_guardrails(state_dir):
    rules_dir = config_dir() / "port-forwarding" / "rules.d"
    evaluated_at = utc_now()
    evaluations = []

    if not rules_dir.exists():
        write_json(runtime_dir(state_dir) / "port-forwarding-guardrails.json", {"evaluatedAt": evaluated_at, "rules": []})
        return []

    totals = read_forwarding_counter_totals()

    for rule_path in sorted(rules_dir.glob("*.json")):
        artifact = read_json(rule_path, {})
        if not isinstance(artifact, dict):
            continue

        rule = artifact.get("rule") if isinstance(artifact.get("rule"), dict) else {}
        binding = rule.get("binding") if isinstance(rule.get("binding"), dict) else {}
        service_plan = artifact.get("servicePlan") if isinstance(artifact.get("servicePlan"), dict) else {}
        service_name = sanitize_service_name(service_plan.get("serviceName") or binding.get("serviceName") or artifact.get("targetId"))
        protocol = str(binding.get("protocol") or rule.get("protocol") or "tcp")
        counter = totals.get(service_name, {"inboundBytes": 0, "outboundBytes": 0})
        quota_bytes = forwarding_rule_quota_bytes(rule)
        billed_bytes = forwarding_rule_billed_bytes(rule, counter)
        quota_exceeded = quota_bytes > 0 and billed_bytes >= quota_bytes
        stopped_units = []

        if quota_exceeded:
            stopped_units = stop_forwarding_rule_units(state_dir, service_name, protocol, "rule_monthly_quota_exceeded")

        evaluations.append(
            {
                "ruleId": str(rule.get("id") or artifact.get("targetId") or rule_path.stem),
                "serviceName": service_name,
                "quotaBytes": quota_bytes,
                "billedTrafficBytes": billed_bytes,
                "quotaExceeded": quota_exceeded,
                "runtimeDisabledByPolicy": quota_exceeded,
                "guardrailReason": "rule_monthly_quota_exceeded" if quota_exceeded else "ok",
                "stoppedUnits": stopped_units,
                "evaluatedAt": evaluated_at,
            }
        )

    write_json(runtime_dir(state_dir) / "port-forwarding-guardrails.json", {"evaluatedAt": evaluated_at, "rules": evaluations})
    return evaluations


def collect_forwarding_counters(state_dir):
    rules_dir = config_dir() / "port-forwarding" / "rules.d"
    if not rules_dir.exists():
        return []

    totals = read_forwarding_counter_totals()
    samples = []
    sampled_at = utc_now()

    for rule_path in sorted(rules_dir.glob("*.json")):
        artifact = read_json(rule_path, {})
        if not isinstance(artifact, dict):
            continue

        rule = artifact.get("rule") if isinstance(artifact.get("rule"), dict) else {}
        binding = rule.get("binding") if isinstance(rule.get("binding"), dict) else {}
        service_plan = artifact.get("servicePlan") if isinstance(artifact.get("servicePlan"), dict) else {}
        service_name = sanitize_service_name(service_plan.get("serviceName") or binding.get("serviceName") or artifact.get("targetId"))
        counter = totals.get(service_name)

        if counter is None:
            continue

        samples.append(
            {
                "ruleId": str(rule.get("id") or artifact.get("targetId") or rule_path.stem),
                "agentId": str(binding.get("agentId") or os.environ.get("OU_AGENT_ID", "")),
                "serviceName": service_name,
                "listenAddress": str(binding.get("listenAddress") or "0.0.0.0"),
                "listenPort": int(binding.get("listenPort") or 0),
                "targetAddress": str(binding.get("targetAddress") or ""),
                "targetPort": int(binding.get("targetPort") or 0),
                "protocol": str(binding.get("protocol") or rule.get("protocol") or "tcp"),
                "inboundBytes": counter["inboundBytes"],
                "outboundBytes": counter["outboundBytes"],
                "sampledAt": sampled_at,
                "source": "nftables",
            }
        )

    return samples


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
    telemetry_plan = read_telemetry_plan(state_dir)
    ping_probe = telemetry_plan.get("pingProbe") if isinstance(telemetry_plan, dict) else {}
    host_profile = read_host_profile(state_dir)
    probe_config = host_profile.get("probeConfig") if isinstance(host_profile, dict) else {}
    return (
        ping_probe.get("target") if isinstance(ping_probe, dict) else None
    ) or (
        probe_config.get("pingTarget")
        or os.environ.get("OU_PING_TARGET")
        or "1.1.1.1"
    )


def read_telemetry_interval_seconds(state_dir):
    telemetry_plan = read_telemetry_plan(state_dir)
    ping_probe = telemetry_plan.get("pingProbe") if isinstance(telemetry_plan, dict) else {}
    candidates = [
        telemetry_plan.get("sampleIntervalSeconds") if isinstance(telemetry_plan, dict) else None,
        ping_probe.get("intervalSeconds") if isinstance(ping_probe, dict) else None,
        os.environ.get("OU_AGENT_TELEMETRY_INTERVAL_SECONDS"),
        30,
    ]

    for candidate in candidates:
        try:
            interval = int(candidate)
        except Exception:
            continue
        if interval > 0:
            return max(5, min(3600, interval))

    return 30


def read_latency_thresholds(state_dir):
    telemetry_plan = read_telemetry_plan(state_dir)
    ping_probe = telemetry_plan.get("pingProbe") if isinstance(telemetry_plan, dict) else {}
    host_profile = read_host_profile(state_dir)
    probe_config = host_profile.get("probeConfig") if isinstance(host_profile, dict) else {}

    def read_threshold(key, fallback):
        candidates = [
            ping_probe.get(key) if isinstance(ping_probe, dict) else None,
            probe_config.get(key) if isinstance(probe_config, dict) else None,
            fallback,
        ]
        for candidate in candidates:
            try:
                value = int(candidate)
            except Exception:
                continue
            if value > 0:
                return value
        return fallback

    green = read_threshold("latencyGreenMaxMs", 100)
    yellow = max(read_threshold("latencyYellowMaxMs", 200), green)
    return {"green": green, "yellow": yellow}


def classify_latency_status(latency_ms, packet_loss_percent, thresholds):
    try:
        latency = int(latency_ms)
    except Exception:
        latency = 0
    try:
        loss = float(packet_loss_percent)
    except Exception:
        loss = 100

    if latency <= 0 or loss >= 100:
        return "red"
    if latency <= int(thresholds.get("green", 100)):
        return "green"
    if latency <= int(thresholds.get("yellow", 200)):
        return "yellow"
    return "red"


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
    guardrail = enforce_host_guardrails(state_dir, network)
    forwarding_guardrails = enforce_forwarding_rule_guardrails(state_dir)
    ping = collect_ping(read_probe_target(state_dir))
    latency_thresholds = read_latency_thresholds(state_dir)
    uptime_seconds = read_uptime_seconds()

    return {
        "cpuPercent": collect_cpu_percent(state_dir),
        "cpuCores": os.cpu_count() or 1,
        **memory,
        **disk,
        **network,
        "monthlyTrafficLimitBytes": guardrail["monthlyTrafficLimitBytes"],
        "quotaExceeded": guardrail["quotaExceeded"],
        "hostExpired": guardrail["hostExpired"],
        "runtimeDisabledByPolicy": guardrail["runtimeDisabledByPolicy"],
        "guardrailReason": guardrail["guardrailReason"],
        "latencyMs": ping["latencyMs"],
        "latencyStatus": classify_latency_status(ping["latencyMs"], ping["packetLossPercent"], latency_thresholds),
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
        "forwardingCounters": collect_forwarding_counters(state_dir),
        "forwardingGuardrails": forwarding_guardrails,
    }


def send_heartbeat(state_dir, master_poll_url, token, agent_id, session_id, last_seen):
    payload = {
        "version": os.environ.get("OU_AGENT_VERSION", "1.0.0-runtime"),
        "uptimeSeconds": read_uptime_seconds(),
        "lastSeenCommandSeq": last_seen,
    }
    heartbeat_event = build_agent_event(
        state_dir,
        agent_id,
        session_id,
        "heartbeat",
        payload,
        minimum_seq=last_seen + 2,
    )
    send_event_or_queue(
        state_dir,
        master_poll_url,
        token,
        heartbeat_event,
        queue_on_failure=True,
    )


def maybe_send_telemetry(state_dir, master_poll_url, token, agent_id, session_id):
    interval = read_telemetry_interval_seconds(state_dir)
    marker_path = Path(state_dir) / "runtime" / "last-telemetry-at"
    now = time.time()
    try:
        last_sent_at = float(marker_path.read_text(encoding="utf-8").strip() or "0")
    except Exception:
        last_sent_at = 0

    if now - last_sent_at < interval:
        return

    payload = collect_telemetry(state_dir)
    telemetry_event = build_agent_event(state_dir, agent_id, session_id, "telemetry_sample", payload)
    send_event_or_queue(state_dir, master_poll_url, token, telemetry_event, queue_on_failure=True)
    marker_path.parent.mkdir(parents=True, exist_ok=True)
    marker_path.write_text(str(now), encoding="utf-8")


def write_next_poll_interval(state_dir, next_poll_after_ms):
    try:
        interval_seconds = max(1, min(300, int(next_poll_after_ms) // 1000))
    except Exception:
        return

    marker_path = Path(state_dir) / "runtime" / "next-poll-after-seconds"
    marker_path.parent.mkdir(parents=True, exist_ok=True)
    marker_path.write_text(str(interval_seconds), encoding="utf-8")


def config_dir():
    return Path(os.environ.get("OU_AGENT_CONFIG_DIR", "/etc/ou-ui-agent"))


def runtime_dir(state_dir):
    return Path(state_dir) / "runtime"


def snapshot_dir(state_dir):
    return Path(state_dir) / "snapshots"


def run_command(state_dir, args, timeout=30, check=True):
    log(state_dir, "exec " + " ".join(shlex.quote(str(arg)) for arg in args))
    result = subprocess.run(args, text=True, capture_output=True, timeout=timeout, check=False)

    if check and result.returncode != 0:
        output = (result.stderr or result.stdout or "").strip()
        raise RuntimeError(f"command failed ({result.returncode}): {' '.join(args)} {output}")

    return result


def systemctl(state_dir, *args, check=True):
    if not shutil.which("systemctl"):
        raise RuntimeError("systemctl is required to apply runtime services")
    return run_command(state_dir, ["systemctl", *args], timeout=45, check=check)


def systemd_unit_dir():
    return Path("/etc/systemd/system")


def sanitize_service_name(value):
    clean = re.sub(r"[^A-Za-z0-9_.@-]+", "-", str(value or "ou-ui-runtime")).strip("-")
    if not clean:
        clean = "ou-ui-runtime"
    return clean[:180]


def service_unit_name(base_name, protocol=None):
    suffix = f"-{protocol}" if protocol else ""
    name = sanitize_service_name(f"{base_name}{suffix}")
    return name if name.endswith(".service") else f"{name}.service"


def service_active(state_dir, unit):
    result = systemctl(state_dir, "is-active", unit, check=False)
    return result.returncode == 0


def write_systemd_unit(state_dir, unit, content):
    path = systemd_unit_dir() / unit
    write_text_file(path, content)
    systemctl(state_dir, "daemon-reload")
    return path


def stop_and_remove_unit(state_dir, unit):
    path = systemd_unit_dir() / unit
    systemctl(state_dir, "disable", "--now", unit, check=False)
    if path.exists():
        path.unlink()
    systemctl(state_dir, "daemon-reload")
    systemctl(state_dir, "reset-failed", unit, check=False)


def backup_path_for(snapshot_root, path):
    safe_name = re.sub(r"[^A-Za-z0-9_.@-]+", "_", str(path).lstrip("/"))
    return snapshot_root / "files" / safe_name


def create_local_snapshot(state_dir, snapshot_id, paths):
    snapshot_root = snapshot_dir(state_dir) / sanitize_service_name(snapshot_id)
    files = []
    unique_paths = []

    for path in paths:
        path = Path(path)
        if path not in unique_paths:
            unique_paths.append(path)

    for path in unique_paths:
        backup_path = backup_path_for(snapshot_root, path)
        exists = path.exists()
        entry = {
            "path": str(path),
            "exists": exists,
            "backupPath": str(backup_path) if exists else None,
        }
        if path.parent == systemd_unit_dir() and path.name.endswith(".service"):
            entry["serviceUnit"] = path.name
            entry["serviceActive"] = service_active(state_dir, path.name) if exists else False
            entry["serviceEnabled"] = systemctl(state_dir, "is-enabled", path.name, check=False).returncode == 0 if exists else False
        if exists:
            backup_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, backup_path)
        files.append(entry)

    manifest = {
        "snapshotId": snapshot_id,
        "createdAt": utc_now(),
        "files": files,
    }
    write_json(snapshot_root / "manifest.json", manifest)
    return manifest


def restore_local_snapshot(state_dir, snapshot_id):
    manifest_path = snapshot_dir(state_dir) / sanitize_service_name(snapshot_id) / "manifest.json"
    manifest = read_json(manifest_path, None)

    if not isinstance(manifest, dict):
        raise RuntimeError(f"local snapshot is not available on this Agent: {snapshot_id}")

    changed = []
    service_entries = []
    for entry in manifest.get("files", []):
        path = Path(entry.get("path", ""))
        backup_path = Path(entry["backupPath"]) if entry.get("backupPath") else None
        if entry.get("serviceUnit"):
            service_entries.append(entry)

        if entry.get("exists") and backup_path and backup_path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(backup_path, path)
            changed.append(str(path))
        elif path.exists():
            path.unlink()
            changed.append(str(path))

    systemctl(state_dir, "daemon-reload", check=False)
    for entry in service_entries:
        unit = entry.get("serviceUnit")
        if not unit:
            continue

        if entry.get("exists"):
            if entry.get("serviceEnabled"):
                systemctl(state_dir, "enable", unit, check=False)
            if entry.get("serviceActive"):
                systemctl(state_dir, "restart", unit, check=False)
        else:
            systemctl(state_dir, "disable", "--now", unit, check=False)
            systemctl(state_dir, "reset-failed", unit, check=False)

    return changed


def xray_snapshot_paths(artifact):
    xray_root = config_dir() / "xray"
    inbound = ((artifact.get("xray") or {}).get("inbound") or {}) if isinstance(artifact.get("xray"), dict) else {}
    tag = sanitize_service_name(inbound.get("tag") or artifact.get("targetId") or "xray-inbound")
    return [
        xray_root / "config.json",
        xray_root / "inbounds.d" / f"{tag}.json",
        systemd_unit_dir() / "ou-ui-xray.service",
    ]


def forwarding_snapshot_paths(artifact):
    rule = artifact.get("rule") if isinstance(artifact.get("rule"), dict) else {}
    binding = rule.get("binding") if isinstance(rule.get("binding"), dict) else {}
    service_plan = artifact.get("servicePlan") if isinstance(artifact.get("servicePlan"), dict) else {}
    service_name = sanitize_service_name(service_plan.get("serviceName") or binding.get("serviceName") or artifact.get("targetId"))
    protocol = binding.get("protocol") or rule.get("protocol") or service_plan.get("transport") or "tcp"
    return [
        config_dir() / "port-forwarding" / "rules.d" / f"{service_name}.json",
        *[systemd_unit_dir() / service_unit_name(service_name, item) for item in forward_protocols(protocol)],
    ]


def snapshot_paths_for_artifact(artifact):
    version = artifact.get("artifactVersion") if isinstance(artifact, dict) else None

    if version == "ou-ui.runtime.host-agent.v1":
        return [config_dir() / "host-agent.json"]
    if version == "ou-ui.runtime.xray-inbound.v1":
        return xray_snapshot_paths(artifact)
    if version == "ou-ui.runtime.port-forwarding.v1":
        return forwarding_snapshot_paths(artifact)

    return []


def local_snapshot_id(command):
    payload = command.get("payload", {})
    return payload.get("snapshotBeforeId") or f"snapshot-before-{command['commandId']}"


def normalize_module_kind(module_kind):
    if module_kind == "flvx":
        return "port-forwarding"
    return module_kind or "system"


def normalize_for_hash(value):
    if isinstance(value, dict):
        return {
            key: normalize_for_hash(value[key])
            for key in sorted(value)
            if value[key] is not None
        }
    if isinstance(value, list):
        return [normalize_for_hash(item) for item in value]
    return value


def checksum_json(value):
    normalized = json.dumps(normalize_for_hash(value), sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return "sha256:" + hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def expected_signature(checksum):
    return "sig-v1:" + str(checksum).replace("sha256:", "", 1)[:32]


def verify_artifact_integrity(command, artifact):
    payload = command.get("payload", {})
    expected_checksum = payload.get("checksum")
    if not expected_checksum:
        raise RuntimeError("apply command payload must include an artifact checksum")

    actual_checksum = checksum_json(artifact)
    if actual_checksum != expected_checksum:
        raise RuntimeError(f"runtime artifact checksum mismatch: expected {expected_checksum}, got {actual_checksum}")

    signature = payload.get("signature")
    if signature and signature != expected_signature(expected_checksum):
        raise RuntimeError("runtime artifact signature does not match checksum")


def write_revision_state(state_dir, command, module_kind, revision, artifact, changed_files, health_summary):
    revision_path = Path(state_dir) / "config-revisions" / f"{revision}.json"
    module_path = runtime_dir(state_dir) / f"{module_kind}.json"
    applied_at = utc_now()

    write_json(
        revision_path,
        {
            "commandId": command["commandId"],
            "taskId": command["taskId"],
            "agentId": command["agentId"],
            "moduleKind": module_kind,
            "configRevision": revision,
            "artifact": artifact,
            "appliedAt": applied_at,
            "healthSummary": health_summary,
        },
    )
    write_json(
        module_path,
        {
            "moduleKind": module_kind,
            "activeConfigRevision": revision,
            "lastCommandId": command["commandId"],
            "lastAppliedAt": applied_at,
            "artifact": artifact,
            **health_summary,
        },
    )
    return [str(revision_path), str(module_path), *changed_files]


def apply_host_agent_artifact(state_dir, command, revision, artifact):
    path = config_dir() / "host-agent.json"
    write_json(path, artifact)
    return write_revision_state(
        state_dir,
        command,
        "host-agent",
        revision,
        artifact,
        [str(path)],
        {
            "moduleKind": "host-agent",
            "activeConfigRevision": revision,
            "artifactVersion": artifact.get("artifactVersion"),
            "desiredState": artifact.get("desiredState"),
            "runtime": "host_profile_applied",
        },
    )


def read_inbound_fragments(root):
    inbounds = []
    for path in sorted(root.glob("*.json")):
        value = read_json(path, {})
        if isinstance(value, dict) and value.get("port") and value.get("protocol"):
            inbounds.append(value)
    return inbounds


def write_xray_service_unit(state_dir, xray_bin, config_path):
    unit = "ou-ui-xray.service"
    content = f"""[Unit]
Description=OU-UI managed Xray runtime
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart={shlex.quote(xray_bin)} run -config {shlex.quote(str(config_path))}
Restart=on-failure
RestartSec=3
LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
"""
    return unit, write_systemd_unit(state_dir, unit, content)


def test_xray_config(state_dir, xray_bin, config_path):
    result = run_command(state_dir, [xray_bin, "run", "-test", "-config", str(config_path)], timeout=30, check=False)
    if result.returncode == 0:
        return

    fallback = run_command(state_dir, [xray_bin, "-test", "-config", str(config_path)], timeout=30, check=False)
    if fallback.returncode == 0:
        return

    output = (fallback.stderr or fallback.stdout or result.stderr or result.stdout or "").strip()
    raise RuntimeError(f"xray config preflight failed: {output}")


def apply_xray_artifact(state_dir, command, revision, artifact):
    action = artifact.get("action")
    xray_root = config_dir() / "xray"
    inbound_root = xray_root / "inbounds.d"
    log_root = Path("/var/log/ou-ui-xray")
    inbound_root.mkdir(parents=True, exist_ok=True)
    log_root.mkdir(parents=True, exist_ok=True)

    inbound = ((artifact.get("xray") or {}).get("inbound") or {}) if isinstance(artifact.get("xray"), dict) else {}
    tag = sanitize_service_name(inbound.get("tag") or artifact.get("targetId") or command["taskId"])
    inbound_path = inbound_root / f"{tag}.json"
    changed = []

    if action == "remove_inbound":
        if inbound_path.exists():
            inbound_path.unlink()
            changed.append(str(inbound_path))
    else:
        if not inbound:
            raise RuntimeError("xray artifact does not contain xray.inbound")
        write_json(inbound_path, inbound)
        changed.append(str(inbound_path))

    inbounds = read_inbound_fragments(inbound_root)
    config_path = xray_root / "config.json"
    write_json(
        config_path,
        {
            "log": {
                "access": str(log_root / "access.log"),
                "error": str(log_root / "error.log"),
                "loglevel": "warning",
            },
            "inbounds": inbounds,
            "outbounds": [
                {"tag": "direct", "protocol": "freedom"},
                {"tag": "blocked", "protocol": "blackhole"},
            ],
        },
    )
    changed.append(str(config_path))

    xray_bin = shutil.which("xray")
    if not inbounds:
        stop_and_remove_unit(state_dir, "ou-ui-xray.service")
        service_state = "stopped_no_inbounds"
    else:
        if not xray_bin:
            raise RuntimeError("xray binary is not installed; rerun the Agent installer or install Xray before applying customer nodes")
        test_xray_config(state_dir, xray_bin, config_path)
        unit, unit_path = write_xray_service_unit(state_dir, xray_bin, config_path)
        changed.append(str(unit_path))
        systemctl(state_dir, "enable", "--now", unit)
        systemctl(state_dir, "restart", unit)
        if not service_active(state_dir, unit):
            raise RuntimeError("ou-ui-xray.service did not become active")
        service_state = "running"

    return write_revision_state(
        state_dir,
        command,
        "xray",
        revision,
        artifact,
        changed,
        {
            "moduleKind": "xray",
            "activeConfigRevision": revision,
            "artifactVersion": artifact.get("artifactVersion"),
            "inboundCount": len(inbounds),
            "runtime": service_state,
        },
    )


def forward_protocols(protocol):
    if protocol == "tcp+udp":
        return ["tcp", "udp"]
    if protocol in ("tcp", "udp"):
        return [protocol]
    raise RuntimeError(f"unsupported forwarding protocol: {protocol}")


def assert_port_available(protocol, listen_address, listen_port):
    family = socket.AF_INET6 if ":" in listen_address and listen_address != "0.0.0.0" else socket.AF_INET
    sock_type = socket.SOCK_STREAM if protocol == "tcp" else socket.SOCK_DGRAM
    sock = socket.socket(family, sock_type)
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind((listen_address, listen_port))
    except OSError as error:
        raise RuntimeError(f"{protocol.upper()} listen port is not available: {listen_address}:{listen_port} ({error})")
    finally:
        sock.close()


def socat_args(protocol, listen_address, listen_port, target_address, target_port):
    if protocol == "tcp":
        return [
            "socat",
            f"TCP-LISTEN:{listen_port},bind={listen_address},reuseaddr,fork",
            f"TCP:{target_address}:{target_port}",
        ]
    return [
        "socat",
        f"UDP-RECVFROM:{listen_port},bind={listen_address},reuseaddr,fork",
        f"UDP-SENDTO:{target_address}:{target_port}",
    ]


def format_host_port(address, port):
    if address in ("0.0.0.0", "::", ""):
        return f":{port}"

    if ":" in address and not address.startswith("["):
        return f"[{address}]:{port}"

    return f"{address}:{port}"


def mbps_to_gost_limit(rate_limit_mbps):
    try:
        mbps = float(rate_limit_mbps)
    except Exception:
        mbps = 0

    if mbps <= 0:
        return None

    return f"{max(1, round(mbps * 125))}KB"


def gost_forward_url(protocol, listen_address, listen_port, target_address, target_port, rate_limit_mbps):
    query = {}
    bandwidth_limit = mbps_to_gost_limit(rate_limit_mbps)

    if bandwidth_limit:
        query["limiter.in"] = bandwidth_limit
        query["limiter.out"] = bandwidth_limit

    encoded_query = urllib.parse.urlencode(query)
    base_url = (
        f"{protocol}://{format_host_port(listen_address, listen_port)}/"
        f"{format_host_port(target_address, target_port)}"
    )
    return f"{base_url}?{encoded_query}" if encoded_query else base_url


def gost_args(gost_bin, protocol, listen_address, listen_port, target_address, target_port, rate_limit_mbps):
    return [
        gost_bin,
        "-L",
        gost_forward_url(protocol, listen_address, listen_port, target_address, target_port, rate_limit_mbps),
    ]


def forwarding_runtime_args(
    gost_bin,
    socat_bin,
    protocol,
    listen_address,
    listen_port,
    target_address,
    target_port,
    rate_limit_mbps,
):
    if gost_bin:
        return (
            gost_args(gost_bin, protocol, listen_address, listen_port, target_address, target_port, rate_limit_mbps),
            "gost",
        )

    if rate_limit_mbps:
        raise RuntimeError("GOST is required for rate-limited port forwarding; rerun the Agent installer before applying this rule")

    if not socat_bin:
        raise RuntimeError("neither GOST nor socat is installed; rerun the Agent installer before applying port forwarding")

    args = socat_args(protocol, listen_address, listen_port, target_address, target_port)
    args[0] = socat_bin
    return args, "socat"


def int_limit(value):
    try:
        return int(value or 0)
    except Exception:
        return 0


def assert_supported_forwarding_controls(rule):
    limits = rule.get("limits") if isinstance(rule.get("limits"), dict) else {}
    unsupported = []

    if int_limit(limits.get("ipRateLimitMbps")) > 0:
        unsupported.append("ipRateLimitMbps")
    if int_limit(limits.get("maxConnections")) > 0:
        unsupported.append("maxConnections")
    if int_limit(limits.get("maxConnectionsPerIp")) > 0:
        unsupported.append("maxConnectionsPerIp")
    if rule.get("proxyProtocol") is True:
        unsupported.append("proxyProtocol")

    if unsupported:
        raise RuntimeError(
            "unsupported port-forwarding runtime controls: "
            + ", ".join(unsupported)
            + ". Current Agent runtime supports listen/target TCP/UDP forwarding, rule-level GOST rateLimitMbps, and nftables traffic counters."
        )


def write_forward_unit(state_dir, unit, args):
    exec_start = " ".join(shlex.quote(str(arg)) for arg in args)
    content = f"""[Unit]
Description=OU-UI managed port forwarding {unit}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart={exec_start}
Restart=always
RestartSec=2
LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
"""
    return write_systemd_unit(state_dir, unit, content)


def apply_forwarding_artifact(state_dir, command, revision, artifact):
    rule = artifact.get("rule") if isinstance(artifact.get("rule"), dict) else {}
    binding = rule.get("binding") if isinstance(rule.get("binding"), dict) else {}
    service_plan = artifact.get("servicePlan") if isinstance(artifact.get("servicePlan"), dict) else {}
    service_name = sanitize_service_name(service_plan.get("serviceName") or binding.get("serviceName") or artifact.get("targetId"))
    protocol = binding.get("protocol") or rule.get("protocol") or service_plan.get("transport") or "tcp"
    units = [service_unit_name(service_name, item) for item in forward_protocols(protocol)]
    changed = []

    if artifact.get("action") == "remove_forward_rule":
        for unit in units:
            stop_and_remove_unit(state_dir, unit)
        delete_forwarding_counter_rules(service_name)
        rule_path = config_dir() / "port-forwarding" / "rules.d" / f"{service_name}.json"
        if rule_path.exists():
            rule_path.unlink()
            changed.append(str(rule_path))
        return write_revision_state(
            state_dir,
            command,
            "port-forwarding",
            revision,
            artifact,
            changed,
            {
                "moduleKind": "port-forwarding",
                "activeConfigRevision": revision,
                "artifactVersion": artifact.get("artifactVersion"),
                "runtime": "removed",
                "services": units,
            },
        )

    gost_bin = shutil.which("gost")
    socat_bin = shutil.which("socat")
    limits = rule.get("limits") if isinstance(rule.get("limits"), dict) else {}
    assert_supported_forwarding_controls(rule)
    rate_limit = int_limit(limits.get("rateLimitMbps"))

    listen_address = str(binding.get("listenAddress") or "0.0.0.0")
    listen_port = int(binding.get("listenPort") or 0)
    target_address = str(binding.get("targetAddress") or "127.0.0.1")
    target_port = int(binding.get("targetPort") or 0)

    if listen_port <= 0 or target_port <= 0:
        raise RuntimeError("port-forwarding artifact requires listenPort and targetPort")

    for unit in units:
        systemctl(state_dir, "stop", unit, check=False)

    for unit_protocol in forward_protocols(protocol):
        assert_port_available(unit_protocol, listen_address, listen_port)

    forward_root = config_dir() / "port-forwarding"
    rule_path = forward_root / "rules.d" / f"{service_name}.json"
    write_json(rule_path, artifact)
    changed.append(str(rule_path))
    runtime_engines = set()

    try:
        for unit_protocol in forward_protocols(protocol):
            unit = service_unit_name(service_name, unit_protocol)
            args, runtime_engine = forwarding_runtime_args(
                gost_bin,
                socat_bin,
                unit_protocol,
                listen_address,
                listen_port,
                target_address,
                target_port,
                rate_limit,
            )
            runtime_engines.add(runtime_engine)
            unit_path = write_forward_unit(state_dir, unit, args)
            changed.append(str(unit_path))
            systemctl(state_dir, "enable", "--now", unit)
            systemctl(state_dir, "restart", unit)
            if not service_active(state_dir, unit):
                raise RuntimeError(f"{unit} did not become active")

        counter_source = configure_forwarding_counters(
            service_name,
            protocol,
            listen_address,
            listen_port,
            target_address,
            target_port,
        )
    except Exception:
        delete_forwarding_counter_rules(service_name)
        raise

    return write_revision_state(
        state_dir,
        command,
        "port-forwarding",
        revision,
        artifact,
        changed,
        {
            "moduleKind": "port-forwarding",
            "activeConfigRevision": revision,
            "artifactVersion": artifact.get("artifactVersion"),
            "runtime": "running",
            "services": units,
            "runtimeEngines": sorted(runtime_engines),
            "bind": f"{listen_address}:{listen_port}",
            "upstream": f"{target_address}:{target_port}",
            "rateLimitRuntime": "gost_limiter" if rate_limit and "gost" in runtime_engines else "not_configured",
            "trafficCounterRuntime": counter_source,
        },
    )


def apply_artifact(state_dir, command, revision, artifact):
    version = artifact.get("artifactVersion") if isinstance(artifact, dict) else None

    if version == "ou-ui.runtime.host-agent.v1":
        return apply_host_agent_artifact(state_dir, command, revision, artifact)
    if version == "ou-ui.runtime.xray-inbound.v1":
        return apply_xray_artifact(state_dir, command, revision, artifact)
    if version == "ou-ui.runtime.port-forwarding.v1":
        return apply_forwarding_artifact(state_dir, command, revision, artifact)

    raise RuntimeError(f"unsupported runtime artifactVersion: {version}")


def apply_command(state_dir, command):
    payload = command.get("payload", {})
    revision = payload.get("configRevision", f"cfg-{command['commandId']}")
    module_kind = normalize_module_kind(payload.get("moduleKind", "system"))
    artifact = payload.get("artifact") or {
        "artifactUri": payload.get("artifactUri"),
        "moduleKind": module_kind,
        "configRevision": revision,
    }
    if not isinstance(artifact, dict):
        raise RuntimeError("apply command payload must include a runtime artifact object")

    verify_artifact_integrity(command, artifact)

    snapshot_id = local_snapshot_id(command)
    snapshot_manifest = create_local_snapshot(state_dir, snapshot_id, snapshot_paths_for_artifact(artifact))

    try:
        changed_files = apply_artifact(state_dir, command, revision, artifact)
    except Exception:
        restore_local_snapshot(state_dir, snapshot_id)
        raise

    module_state = read_json(runtime_dir(state_dir) / f"{module_kind}.json", {})
    if isinstance(module_state, dict):
        module_state = {
            **module_state,
            "snapshotBeforeId": snapshot_id,
            "snapshotFileCount": len(snapshot_manifest.get("files", [])),
        }

    return {
        "changedFiles": changed_files,
        "healthSummary": module_state if isinstance(module_state, dict) else {},
    }


def reload_command(state_dir, command):
    payload = command.get("payload", {})
    module_kind = normalize_module_kind(payload.get("moduleKind", "system"))
    restarted = []

    if module_kind in ("xray", "system"):
        if (systemd_unit_dir() / "ou-ui-xray.service").exists():
            systemctl(state_dir, "restart", "ou-ui-xray.service")
            restarted.append("ou-ui-xray.service")

    if module_kind in ("port-forwarding", "system"):
        port_forwarding_state = read_json(runtime_dir(state_dir) / "port-forwarding.json", {})
        legacy_forwarding_state = read_json(runtime_dir(state_dir) / "flvx.json", {})
        forwarding_services = []
        if isinstance(port_forwarding_state, dict):
            forwarding_services.extend(port_forwarding_state.get("services", []))
        if isinstance(legacy_forwarding_state, dict):
            forwarding_services.extend(legacy_forwarding_state.get("services", []))
        for unit in sorted(set(unit for unit in forwarding_services if isinstance(unit, str))):
            if (systemd_unit_dir() / unit).exists():
                systemctl(state_dir, "restart", unit)
                restarted.append(unit)

    return {
        "changedFiles": [],
        "healthSummary": {
            "moduleKind": module_kind,
            "reloadMode": payload.get("reloadMode"),
            "runtime": "reloaded",
            "services": restarted,
        },
    }


def rollback_command(state_dir, command):
    payload = command.get("payload", {})
    snapshot_id = payload.get("snapshotId")
    if snapshot_id:
        changed_files = restore_local_snapshot(state_dir, snapshot_id)
        return {
            "changedFiles": changed_files,
            "healthSummary": {
                "snapshotId": snapshot_id,
                "runtime": "rolled_back",
                "source": "local_snapshot",
            },
        }

    target_revision = payload.get("targetConfigRevision")
    if not target_revision:
        raise RuntimeError("rollback command requires targetConfigRevision")

    revision_state = read_json(Path(state_dir) / "config-revisions" / f"{target_revision}.json", None)
    if not isinstance(revision_state, dict) or not isinstance(revision_state.get("artifact"), dict):
        raise RuntimeError(f"rollback target revision is not available on this Agent: {target_revision}")

    changed_files = apply_artifact(state_dir, command, target_revision, revision_state["artifact"])
    return {
        "changedFiles": changed_files,
        "healthSummary": {
            "snapshotId": payload.get("snapshotId"),
            "runtime": "rolled_back",
            "targetConfigRevision": target_revision,
        },
    }


def systemd_service_check(state_dir, name, unit, required=False):
    unit_path = systemd_unit_dir() / unit
    if not shutil.which("systemctl"):
        return {
            "name": name,
            "status": "failed",
            "unit": unit,
            "reason": "systemctl_unavailable",
        }

    if not unit_path.exists():
        return {
            "name": name,
            "status": "failed" if required else "skipped",
            "unit": unit,
            "reason": "unit_missing",
        }

    active = service_active(state_dir, unit)
    return {
        "name": name,
        "status": "passed" if active else "failed",
        "unit": unit,
        "active": active,
        **({} if active else {"reason": "unit_inactive"}),
    }


def forwarding_health_checks(state_dir, required=False):
    port_forwarding_state = read_json(runtime_dir(state_dir) / "port-forwarding.json", {})
    legacy_forwarding_state = read_json(runtime_dir(state_dir) / "flvx.json", {})
    services = []
    if isinstance(port_forwarding_state, dict):
        services.extend(port_forwarding_state.get("services", []))
    if isinstance(legacy_forwarding_state, dict):
        services.extend(legacy_forwarding_state.get("services", []))

    units = sorted(set(unit for unit in services if isinstance(unit, str)))
    if not units:
        return [
            {
                "name": "port-forwarding",
                "status": "failed" if required else "skipped",
                "reason": "no_forwarding_units",
            }
        ]

    return [systemd_service_check(state_dir, "port-forwarding", unit, required=True) for unit in units]


def module_api_health_checks(state_dir):
    checks = []
    xray_unit = "ou-ui-xray.service"
    if (systemd_unit_dir() / xray_unit).exists():
        checks.append(systemd_service_check(state_dir, "xray", xray_unit, required=True))
    checks.extend(forwarding_health_checks(state_dir, required=False))

    if not checks:
        return [
            {
                "name": "module_api",
                "status": "skipped",
                "reason": "no_runtime_modules_configured",
            }
        ]

    return checks


def health_command(state_dir, command):
    payload = command.get("payload", {})
    requested_checks = payload.get("checks")
    if not isinstance(requested_checks, list) or not requested_checks:
        requested_checks = ["process", "module_api"]

    checks = []
    for check in requested_checks:
        if check == "process":
            agent_unit = service_unit_name(os.environ.get("OU_AGENT_SERVICE_NAME", "ou-ui-agent"))
            checks.append(systemd_service_check(state_dir, "process", agent_unit, required=True))
        elif check == "module_api":
            checks.extend(module_api_health_checks(state_dir))
        elif check == "xray":
            checks.append(systemd_service_check(state_dir, "xray", "ou-ui-xray.service", required=True))
        elif check == "port-forwarding":
            checks.extend(forwarding_health_checks(state_dir, required=True))
        else:
            checks.append({
                "name": str(check),
                "status": "failed",
                "reason": "unsupported_health_check",
            })

    failed_checks = [item for item in checks if item.get("status") == "failed"]
    return {
        "changedFiles": [],
        "succeeded": not failed_checks,
        "failureReason": ", ".join(f"{item.get('name')}:{item.get('reason', 'failed')}" for item in failed_checks),
        "healthSummary": {
            "runtime": "healthy" if not failed_checks else "unhealthy",
            "commandType": "health",
            "checkedAt": utc_now(),
            "checks": checks,
        },
    }


def telemetry_command(state_dir, command):
    telemetry = collect_telemetry(state_dir)
    return {
        "changedFiles": [],
        "succeeded": True,
        "telemetry": telemetry,
        "healthSummary": {
            "runtime": "telemetry_collected",
            "commandType": "telemetry",
            "configRevision": command.get("payload", {}).get("configRevision"),
            "telemetry": telemetry,
        },
    }


def process_command(state_dir, master_poll_url, token, outbox_item):
    command = outbox_item.get("command", outbox_item)
    command_seq = int(command.get("seq", outbox_item.get("seq", 0)))
    ack_event = build_command_event(state_dir, command, "ack", {"duplicate": False}, minimum_seq=command_seq)
    send_event(master_poll_url, token, ack_event)

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
            result = reload_command(state_dir, command)
            payload = {
                "status": "succeeded",
                "appliedConfigRevision": command.get("payload", {}).get("configRevision"),
                "changedFiles": result["changedFiles"],
                "healthSummary": result["healthSummary"],
            }
        elif command.get("type") == "rollback":
            result = rollback_command(state_dir, command)
            payload = {
                "status": "rolled_back",
                "appliedConfigRevision": command.get("payload", {}).get("targetConfigRevision"),
                "changedFiles": result["changedFiles"],
                "healthSummary": result["healthSummary"],
            }
        elif command.get("type") == "health":
            result = health_command(state_dir, command)
            payload = {
                "status": "succeeded" if result["succeeded"] else "failed",
                "changedFiles": result["changedFiles"],
                "healthSummary": result["healthSummary"],
            }
            if not result["succeeded"]:
                payload["failureReason"] = result["failureReason"] or "health check failed"
                payload["retryable"] = True
        elif command.get("type") == "telemetry":
            result = telemetry_command(state_dir, command)
            telemetry_agent_id = command.get("agentId") or os.environ.get("OU_AGENT_ID")
            telemetry_session_id = command.get("sessionId") or os.environ.get("OU_AGENT_SESSION_ID")
            if telemetry_agent_id and telemetry_session_id:
                telemetry_event = build_agent_event(
                    state_dir,
                    telemetry_agent_id,
                    telemetry_session_id,
                    "telemetry_sample",
                    result["telemetry"],
                    minimum_seq=ack_event["seq"],
                )
                send_event_or_queue(state_dir, master_poll_url, token, telemetry_event, queue_on_failure=True)
            payload = {
                "status": "succeeded",
                "changedFiles": result["changedFiles"],
                "healthSummary": result["healthSummary"],
            }
        else:
            raise RuntimeError(f"unsupported Agent command type: {command.get('type')}")
    except Exception as error:
        payload = {
            "status": "failed",
            "failureReason": str(error),
            "retryable": True,
        }

    result_event = build_command_event(state_dir, command, "result", payload, minimum_seq=ack_event["seq"])
    if not send_event_or_queue(state_dir, master_poll_url, token, result_event, queue_on_failure=True):
        raise RuntimeError(f"result event queued for retry: {result_event['eventId']}")
    return command_seq


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

    flush_pending_events(state_dir, master, token)

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
    response_data = response.get("data", {})
    commands = response_data.get("commands", [])
    write_next_poll_interval(state_dir, response_data.get("nextPollAfterMs"))
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

  poll_interval="\${OU_AGENT_POLL_INTERVAL_SECONDS}"
  dynamic_poll_interval_file="\${OU_AGENT_STATE_DIR}/runtime/next-poll-after-seconds"
  if [[ -f "\${dynamic_poll_interval_file}" ]]; then
    dynamic_poll_interval="\$(cat "\${dynamic_poll_interval_file}" 2>/dev/null || true)"
    if [[ "\${dynamic_poll_interval}" =~ ^[0-9]+$ ]] && (( dynamic_poll_interval >= 1 && dynamic_poll_interval <= 300 )); then
      poll_interval="\${dynamic_poll_interval}"
    fi
  fi
  sleep "\${poll_interval}"
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

install_management_cli() {
  {
    cat <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="OU-UI Agent"
SERVICE_NAME="${SERVICE_NAME}"
INSTALL_ROOT="${INSTALL_ROOT}"
CONFIG_DIR="${CONFIG_DIR}"
STATE_DIR="${STATE_DIR}"
DEFAULT_AGENT_SCRIPT_URL="${DEFAULT_AGENT_SCRIPT_URL}"
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
    fail "Please run this command as root."
  fi
}

show_info() {
  if [[ -f "${CONFIG_DIR}/agent.env" ]]; then
    # shellcheck disable=SC1091
    source "${CONFIG_DIR}/agent.env"
    cat <<EOT
OU-UI Agent
  Agent ID: ${OU_AGENT_ID:-unknown}
  Master: ${OU_MASTER:-unknown}
  Profile: ${OU_INSTALL_PROFILE:-unknown}
  Credential: ${OU_AGENT_CREDENTIAL_ID:-unknown}
EOT
  else
    fail "Agent env file not found: ${CONFIG_DIR}/agent.env"
  fi
}

do_uninstall() {
  require_root
  read -r -p "Confirm uninstall OU-UI Agent? Type yes to continue: " answer
  [[ "${answer}" == "yes" ]] || exit 0

  systemctl disable --now "${SERVICE_NAME}" >/dev/null 2>&1 || true
  rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
  rm -rf "${INSTALL_ROOT}" "${CONFIG_DIR}" "${STATE_DIR}"
  rm -f "/usr/local/bin/ou-agent" "/usr/local/bin/ouagent"
  systemctl daemon-reload >/dev/null 2>&1 || true
  log "Uninstall complete."
}

do_update() {
  require_root

  if [[ ! -f "${CONFIG_DIR}/agent.env" ]]; then
    fail "Agent env file not found: ${CONFIG_DIR}/agent.env"
  fi

  # shellcheck disable=SC1091
  source "${CONFIG_DIR}/agent.env"

  local script_url="${OU_AGENT_INSTALL_SCRIPT_URL:-${DEFAULT_AGENT_SCRIPT_URL}}"
  local tmp_script
  tmp_script="$(mktemp)"

  log "正在从 GitHub 更新 Agent 运行时脚本：${script_url}"
  if ! curl -fsSL "${script_url}" -o "${tmp_script}"; then
    rm -f "${tmp_script}"
    fail "Agent update failed: cannot download ${script_url}"
  fi

  chmod 700 "${tmp_script}"
  OU_AGENT_UPDATE_MODE=1 \
  OU_AGENT_INSTALL_ROOT="${INSTALL_ROOT}" \
  OU_AGENT_CONFIG_DIR="${CONFIG_DIR}" \
  OU_AGENT_STATE_DIR="${STATE_DIR}" \
  OU_AGENT_SERVICE_NAME="${SERVICE_NAME}" \
  OU_AGENT_INSTALL_SCRIPT_URL="${script_url}" \
  bash "${tmp_script}"
  rm -f "${tmp_script}"
}

show_menu() {
  while true; do
    cat <<'EOT'
OU-UI Agent 快捷菜单
  1) 查看 Agent 信息
  2) 查看服务状态
  3) 查看实时日志
  4) 重启 Agent
  5) 从 GitHub 更新 Agent
  6) 卸载 Agent
  0) 退出
EOT
    echo "Shortcuts: i=info s=status l=logs r=restart u=update x=uninstall"
    read -r -p "请选择操作: " choice

    case "${choice}" in
      1|i|I) show_info ;;
      2|s|S) systemctl status "${SERVICE_NAME}" --no-pager ;;
      3|l|L) journalctl -u "${SERVICE_NAME}" -f ;;
      4|r|R)
        require_root
        systemctl restart "${SERVICE_NAME}"
        ;;
      5|u|U) do_update ;;
      6|x|X) do_uninstall ;;
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
  restart|r|start|stop)
    require_root
    action="${1}"
    [[ "${action}" == "r" ]] && action="restart"
    systemctl "${action}" "${SERVICE_NAME}"
    ;;
  info|i)
    show_info
    ;;
  update|upgrade|u)
    do_update
    ;;
  uninstall|remove|x)
    do_uninstall
    ;;
  menu)
    show_menu
    ;;
  help|--help|-h)
    cat <<'EOT'
用法: ou-agent <命令>

命令:
  menu       打开快捷菜单
  info       查看 Agent 信息
  status     查看服务状态
  logs       查看实时日志
  restart    重启 Agent
  start      启动 Agent
  stop       停止 Agent
  update     从 GitHub 更新 Agent 运行时，不重新注册、不消耗安装 Token
  uninstall  卸载 Agent
EOT
    ;;
  *)
    fail "未知命令，请运行 'ou-agent help'。"
    ;;
esac
EOF
  } >"/usr/local/bin/ou-agent"

  chmod 755 "/usr/local/bin/ou-agent"
  ln -sf "/usr/local/bin/ou-agent" "/usr/local/bin/ouagent"
}

update_existing_agent_runtime() {
  require_root

  if [[ ! -f "${CONFIG_DIR}/agent.env" ]]; then
    die "Agent env file not found: ${CONFIG_DIR}/agent.env"
  fi

  # shellcheck disable=SC1091
  source "${CONFIG_DIR}/agent.env"

  require_env OU_MASTER
  require_env OU_AGENT_ID
  require_env OU_AGENT_TOKEN
  require_env OU_AGENT_SESSION_ID

  install_runtime_dependencies
  install_xray_runtime
  install_gost_runtime
  ensure_service_user
  prepare_directories
  write_agent_env
  prepare_modules
  write_runner
  write_systemd_service
  install_management_cli
  systemctl restart "${SERVICE_NAME}"
  log "Agent runtime updated from GitHub without re-registering or consuming an install token."
}

main() {
  require_root
  if [[ "${OU_AGENT_UPDATE_MODE:-}" == "1" || "${1:-}" == "update-runtime" ]]; then
    update_existing_agent_runtime
    return
  fi

  require_env OU_MASTER
  require_env OU_AGENT_ID
  require_env OU_INSTALL_TOKEN
  install_runtime_dependencies
  install_xray_runtime
  install_gost_runtime
  ensure_service_user
  prepare_directories
  register_agent
  write_agent_env
  prepare_modules
  write_runner
  write_systemd_service
  install_management_cli
  log "Agent installed. It will poll the Master, report telemetry, and apply Xray / port-forwarding runtime commands."
  log "Management shortcut: ou-agent menu"
}

main "$@"
