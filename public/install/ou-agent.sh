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

json_array_from_csv() {
  local value="$1"
  local output="["
  local first=1
  local item
  local item_json
  local -a items
  IFS=',' read -r -a items <<<"${value}"

  for item in "${items[@]}"; do
    item="$(printf '%s' "${item}" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
    [[ -n "${item}" ]] || continue
    item_json="$(printf '%s' "${item}" | json_escape)"

    if [[ "${first}" == "1" ]]; then
      first=0
    else
      output+=","
    fi
    output+="\"${item_json}\""
  done

  output+="]"
  printf '%s' "${output}"
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
  local capabilities_json
  local response

  OU_AGENT_SESSION_ID="${OU_AGENT_SESSION_ID:-$(create_session_id)}"
  platform="$(uname -s 2>/dev/null || printf 'linux')-$(uname -m 2>/dev/null || printf 'unknown')"
  agent_id_json="$(printf '%s' "${OU_AGENT_ID}" | json_escape)"
  request_id_json="$(printf '%s' "${request_id}" | json_escape)"
  session_id_json="$(printf '%s' "${OU_AGENT_SESSION_ID}" | json_escape)"
  version_json="$(printf '%s' "${AGENT_VERSION}" | json_escape)"
  platform_json="$(printf '%s' "${platform}" | json_escape)"
  capabilities_json="$(json_array_from_csv "${OU_INSTALL_PROFILE}")"
  log "Registering Agent runtime credential with Master."
  response="$(
    curl -fsS \
      --max-time 30 \
      -H "Authorization: Bearer ${OU_INSTALL_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "{\"agentId\":\"${agent_id_json}\",\"requestId\":\"${request_id_json}\",\"sessionId\":\"${session_id_json}\",\"version\":\"${version_json}\",\"platform\":\"${platform_json}\",\"capabilities\":${capabilities_json}}" \
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
OU_AGENT_MAX_PENDING_EVENTS=${OU_AGENT_MAX_PENDING_EVENTS:-1000}
OU_AGENT_LOG_MAX_BYTES=${OU_AGENT_LOG_MAX_BYTES:-5242880}
OU_AGENT_LOG_BACKUP_COUNT=${OU_AGENT_LOG_BACKUP_COUNT:-3}
OU_AGENT_COMMAND_LOG_MAX_CHUNKS=${OU_AGENT_COMMAND_LOG_MAX_CHUNKS:-20}
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


def read_positive_int_env(name, fallback, lower=1, upper=100000):
    try:
        value = int(os.environ.get(name, fallback))
    except Exception:
        value = fallback
    return max(lower, min(upper, value))


def rotate_agent_log_file(log_path):
    max_bytes = read_positive_int_env("OU_AGENT_LOG_MAX_BYTES", 5 * 1024 * 1024, lower=0, upper=1024 * 1024 * 1024)
    backup_count = read_positive_int_env("OU_AGENT_LOG_BACKUP_COUNT", 3, lower=0, upper=20)
    if max_bytes <= 0:
        return

    try:
        if not log_path.exists() or log_path.stat().st_size < max_bytes:
            return
        if backup_count <= 0:
            log_path.write_text("", encoding="utf-8")
            return
        for index in range(backup_count, 0, -1):
            source = log_path if index == 1 else log_path.with_name(f"{log_path.name}.{index - 1}")
            target = log_path.with_name(f"{log_path.name}.{index}")
            if source.exists():
                if target.exists():
                    target.unlink()
                source.replace(target)
    except Exception:
        return


def log(state_dir, message):
    logs = Path(state_dir) / "logs"
    logs.mkdir(parents=True, exist_ok=True)
    log_path = logs / "agent.log"
    rotate_agent_log_file(log_path)
    with log_path.open("a", encoding="utf-8") as handle:
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


NON_RETRYABLE_AGENT_EVENT_ERROR_CODES = {
    "agent_event.command_deadline_expired",
    "agent_event.command_task_mismatch",
    "agent_event.sequence_replay",
}
COMMAND_OUTPUT_LOGS = []
COMMAND_LOG_CHUNK_MAX_CHARS = 60_000


def read_http_error_code(error):
    if not isinstance(error, urllib.error.HTTPError):
        return ""

    try:
        body = error.read().decode("utf-8")
        envelope = json.loads(body)
        return str(envelope.get("error", {}).get("code") or "")
    except Exception:
        return ""


def is_non_retryable_agent_event_error(error):
    return (
        isinstance(error, urllib.error.HTTPError)
        and error.code == 409
        and read_http_error_code(error) in NON_RETRYABLE_AGENT_EVENT_ERROR_CODES
    )


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


def pending_event_drop_rank(event):
    event_type = str(event.get("type") or "")
    if event_type in ("heartbeat", "telemetry_sample"):
        return 0
    if event_type == "log_chunk":
        return 1
    if event_type == "ack":
        return 2
    if event_type == "result":
        return 3
    return 1


def trim_pending_events(events, limit):
    if len(events) <= limit:
        return events, 0

    drop_count = len(events) - limit
    drop_indices = {
        index
        for index, _event in sorted(
            enumerate(events),
            key=lambda item: (pending_event_drop_rank(item[1]), item[0]),
        )[:drop_count]
    }
    return [event for index, event in enumerate(events) if index not in drop_indices], drop_count


def enqueue_pending_event(state_dir, event):
    events = load_pending_events(state_dir)
    event_ids = {item.get("eventId") for item in events if isinstance(item, dict)}
    if event.get("eventId") not in event_ids:
        events.append(event)
    max_events = read_positive_int_env("OU_AGENT_MAX_PENDING_EVENTS", 1000, lower=1, upper=100000)
    events, dropped = trim_pending_events(events, max_events)
    if dropped:
        log(state_dir, f"pruned {dropped} pending Agent events after queue reached max={max_events}")
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
            if is_non_retryable_agent_event_error(error):
                log(state_dir, f"dropped non-retryable pending Agent event {event.get('eventId')}: {error}")
                remaining.pop(0)
                save_pending_events(state_dir, remaining)
                continue
            save_pending_events(state_dir, remaining)
            raise RuntimeError(f"pending Agent event delivery failed: {error}") from error


def send_event_or_queue(state_dir, master_poll_url, token, event, queue_on_failure=False):
    try:
        send_event(master_poll_url, token, event)
        return True
    except Exception as error:
        if is_non_retryable_agent_event_error(error):
            log(state_dir, f"dropped non-retryable Agent event {event.get('eventId')}: {error}")
            return True
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


def reset_command_log_buffer():
    COMMAND_OUTPUT_LOGS.clear()


def record_command_log(stream, content):
    text = str(content or "")
    if not text:
        return
    COMMAND_OUTPUT_LOGS.append({"stream": stream, "content": text})


def consume_command_log_buffer():
    entries = list(COMMAND_OUTPUT_LOGS)
    COMMAND_OUTPUT_LOGS.clear()
    return entries


def split_log_content(content):
    text = str(content or "")
    if not text:
        return []
    return [text[index:index + COMMAND_LOG_CHUNK_MAX_CHARS] for index in range(0, len(text), COMMAND_LOG_CHUNK_MAX_CHARS)]


def create_command_result_log_summary(command, payload, output_truncated):
    summary = {
        "commandType": command.get("type"),
        "status": payload.get("status"),
        "appliedConfigRevision": payload.get("appliedConfigRevision"),
        "changedFileCount": len(payload.get("changedFiles", [])) if isinstance(payload.get("changedFiles"), list) else 0,
        "retryable": bool(payload.get("retryable")),
        "outputTruncated": output_truncated,
    }
    if payload.get("failureReason"):
        summary["failureReason"] = str(payload.get("failureReason"))[:500]
    return "command result " + json.dumps(summary, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def send_command_log_chunks(state_dir, master_poll_url, token, command, minimum_seq, payload):
    max_chunks = read_positive_int_env("OU_AGENT_COMMAND_LOG_MAX_CHUNKS", 20, lower=1, upper=200)
    output_limit = max(0, max_chunks - 1)
    output_entries = []
    output_truncated = False

    for entry in consume_command_log_buffer():
        stream = entry.get("stream")
        if stream not in ("stdout", "stderr", "agent", "runtime"):
            stream = "runtime"
        for part in split_log_content(entry.get("content")):
            if len(output_entries) >= output_limit:
                output_truncated = True
                break
            output_entries.append({"stream": stream, "content": part})
        if output_truncated:
            break

    entries = [
        *output_entries,
        {
            "stream": "agent",
            "content": create_command_result_log_summary(command, payload, output_truncated),
        },
    ]

    for chunk_seq, entry in enumerate(entries, start=1):
        event = build_command_event(
            state_dir,
            command,
            "log_chunk",
            {
                "chunkSeq": chunk_seq,
                "stream": entry["stream"],
                "content": entry["content"],
            },
            minimum_seq=minimum_seq,
        )
        send_event_or_queue(state_dir, master_poll_url, token, event, queue_on_failure=True)


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


def days_in_month(year, month):
    if month == 12:
        next_month = datetime.date(year + 1, 1, 1)
    else:
        next_month = datetime.date(year, month + 1, 1)
    return (next_month - datetime.timedelta(days=1)).day


def effective_monthly_reset_day(year, month, reset_day):
    return min(clamp_reset_day(reset_day), days_in_month(year, month))


def billing_period_key(reset_day):
    now = time.gmtime()
    reset_day = clamp_reset_day(reset_day)
    year = now.tm_year
    month = now.tm_mon

    if now.tm_mday < effective_monthly_reset_day(year, month, reset_day):
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


def forwarding_listener_probe_from_artifact(artifact, unit_protocol):
    if unit_protocol != "tcp":
        return None

    rule = artifact.get("rule") if isinstance(artifact.get("rule"), dict) else {}
    binding = rule.get("binding") if isinstance(rule.get("binding"), dict) else {}
    try:
        listen_port = int(binding.get("listenPort") or 0)
    except Exception:
        listen_port = 0

    if listen_port <= 0:
        return None

    listen_address = str(binding.get("listenAddress") or "0.0.0.0").strip()
    if listen_address in ("", "0.0.0.0", "*"):
        listen_address = "127.0.0.1"
    elif listen_address in ("::", "[::]"):
        listen_address = "::1"
    elif listen_address.startswith("[") and listen_address.endswith("]"):
        listen_address = listen_address[1:-1]

    return {
        "protocol": "tcp",
        "host": listen_address,
        "port": listen_port,
    }


def forwarding_rule_service_entries():
    entries = []
    rules_dir = config_dir() / "port-forwarding" / "rules.d"
    if not rules_dir.exists():
        return entries

    for rule_path in sorted(rules_dir.glob("*.json")):
        artifact = read_json(rule_path, {})
        if not isinstance(artifact, dict):
            continue

        rule = artifact.get("rule") if isinstance(artifact.get("rule"), dict) else {}
        binding = rule.get("binding") if isinstance(rule.get("binding"), dict) else {}
        if rule.get("enabled") is False:
            continue

        service_plan = artifact.get("servicePlan") if isinstance(artifact.get("servicePlan"), dict) else {}
        service_name = sanitize_service_name(service_plan.get("serviceName") or binding.get("serviceName") or artifact.get("targetId"))
        protocol = binding.get("protocol") or rule.get("protocol") or service_plan.get("transport") or "tcp"

        try:
            unit_protocols = forward_protocols(protocol)
        except Exception:
            unit_protocols = [None]

        for unit_protocol in unit_protocols:
            entries.append({
                "unit": service_unit_name(service_name, unit_protocol),
                "listener": forwarding_listener_probe_from_artifact(artifact, unit_protocol),
            })

    return entries


def expected_runtime_service_units(state_dir):
    entries = []

    def add(unit, module_kind, required, metadata=None):
        if not unit:
            return
        normalized = service_unit_name(unit)
        existing = next((item for item in entries if item["name"] == normalized), None)
        if existing:
            existing["required"] = bool(existing.get("required")) or bool(required)
            if metadata:
                existing.update(metadata)
            return

        entries.append({
            "name": normalized,
            "moduleKind": module_kind,
            "required": bool(required),
            **(metadata or {}),
        })

    add(os.environ.get("OU_AGENT_SERVICE_NAME", "ou-ui-agent"), "agent", True)

    inbound_root = config_dir() / "xray" / "inbounds.d"
    has_xray_inbounds = inbound_root.exists() and any(inbound_root.glob("*.json"))
    if has_xray_inbounds or (systemd_unit_dir() / "ou-ui-xray.service").exists():
        add("ou-ui-xray.service", "xray", has_xray_inbounds)

    for entry in forwarding_rule_service_entries():
        add(entry["unit"], "port-forwarding", True, {"listener": entry.get("listener")})

    for unit in managed_runtime_units(state_dir):
        module_kind = "xray" if unit == "ou-ui-xray.service" else "port-forwarding" if unit.startswith(("ou-forward-", "ou-tunnel-")) else "agent"
        add(unit, module_kind, False)

    return entries


def normalize_service_active_state(value, unit_path):
    status = str(value or "").strip().splitlines()[0] if value else ""
    if not unit_path.exists():
        return "missing"
    if status == "active":
        return "active"
    if status == "failed":
        return "failed"
    if status in ("inactive", "deactivating", "activating", "reloading"):
        return "inactive"
    return "unknown"


def read_runtime_service_health(state_dir, entry, checked_at):
    unit = entry["name"]
    unit_path = systemd_unit_dir() / unit
    detail = None
    enabled = False

    try:
        active_result = systemctl(state_dir, "is-active", unit, check=False)
        status = normalize_service_active_state(active_result.stdout, unit_path)
        enabled = systemctl(state_dir, "is-enabled", unit, check=False).returncode == 0
        if status != "active":
            detail = (active_result.stderr or active_result.stdout or "").strip()[:400] or None
        elif entry["moduleKind"] == "xray":
            api_ok, api_detail = probe_xray_stats_api(state_dir)
            if not api_ok:
                status = "unknown"
                detail = api_detail
        elif entry["moduleKind"] == "port-forwarding":
            listener_ok, listener_detail = probe_forwarding_listener(entry.get("listener"))
            if not listener_ok:
                status = "unknown"
                detail = listener_detail
    except Exception as error:
        status = "missing" if not unit_path.exists() else "unknown"
        detail = str(error)[:400]

    return {
        "name": unit,
        "moduleKind": entry["moduleKind"],
        "status": status,
        "enabled": enabled,
        "required": bool(entry.get("required")),
        "checkedAt": checked_at,
        **({"detail": detail} if detail else {}),
    }


def collect_runtime_service_health(state_dir):
    checked_at = utc_now()
    return [
        read_runtime_service_health(state_dir, entry, checked_at)
        for entry in expected_runtime_service_units(state_dir)
    ]


def stop_managed_runtime_units(state_dir, reason):
    stopped = []
    for unit in managed_runtime_units(state_dir):
        result = systemctl(state_dir, "disable", "--now", unit, check=False)
        if result.returncode == 0:
            stopped.append(unit)
    if stopped:
        log(state_dir, f"host guardrail disabled runtime units reason={reason} units={','.join(stopped)}")
    return stopped


def restore_host_guardrail_units(state_dir, units):
    current_managed_units = set(managed_runtime_units(state_dir))
    restored = []

    for unit in units:
        if not isinstance(unit, str) or not unit.endswith(".service") or unit not in current_managed_units:
            continue
        result = systemctl(state_dir, "enable", "--now", unit, check=False)
        if result.returncode == 0:
            restored.append(unit)

    if restored:
        log(state_dir, f"host guardrail restored runtime units units={','.join(restored)}")
    return restored


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
    state_path = runtime_dir(state_dir) / "host-guardrails.json"
    previous_state = read_json(state_path, {})
    previous_stopped_units = previous_state.get("stoppedUnits", []) if isinstance(previous_state, dict) else []
    state = evaluate_host_guardrails(state_dir, monthly_traffic)
    state["stoppedUnits"] = []
    state["restoredUnits"] = []
    state["evaluatedAt"] = utc_now()

    if state["runtimeDisabledByPolicy"]:
        try:
            state["stoppedUnits"] = stop_managed_runtime_units(state_dir, state["guardrailReason"])
        except Exception as error:
            state["enforcementError"] = str(error)
    else:
        try:
            state["restoredUnits"] = restore_host_guardrail_units(state_dir, previous_stopped_units)
        except Exception as error:
            state["enforcementError"] = str(error)

    write_json(state_path, state)
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


def forwarding_rule_monthly_reset_day(rule):
    limits = rule.get("limits") if isinstance(rule.get("limits"), dict) else {}
    return clamp_reset_day(limits.get("monthlyResetDay", 1))


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


def read_forwarding_counter_baselines(state_dir):
    baseline_path = runtime_dir(state_dir) / "forwarding-traffic-baselines.json"
    baselines = read_json(baseline_path, {})
    return baselines if isinstance(baselines, dict) else {}


def write_forwarding_counter_baselines(state_dir, baselines):
    write_json(runtime_dir(state_dir) / "forwarding-traffic-baselines.json", baselines)


def update_forwarding_counter_baseline(baselines, service_name, counter, reset_day):
    period_key = billing_period_key(reset_day)
    current_inbound = read_int(counter.get("inboundBytes"), 0)
    current_outbound = read_int(counter.get("outboundBytes"), 0)
    baseline = baselines.get(service_name, {})

    if not isinstance(baseline, dict) or baseline.get("periodKey") != period_key:
        baseline = {
            "periodKey": period_key,
            "inboundBase": current_inbound,
            "outboundBase": current_outbound,
            "inboundCarry": 0,
            "outboundCarry": 0,
            "lastInbound": current_inbound,
            "lastOutbound": current_outbound,
            "resetAt": utc_now(),
        }

    inbound_base = int(baseline.get("inboundBase", current_inbound))
    outbound_base = int(baseline.get("outboundBase", current_outbound))
    inbound_carry = int(baseline.get("inboundCarry", 0))
    outbound_carry = int(baseline.get("outboundCarry", 0))
    last_inbound = int(baseline.get("lastInbound", current_inbound))
    last_outbound = int(baseline.get("lastOutbound", current_outbound))

    if current_inbound < last_inbound:
        inbound_carry += max(0, last_inbound - inbound_base)
        inbound_base = current_inbound

    if current_outbound < last_outbound:
        outbound_carry += max(0, last_outbound - outbound_base)
        outbound_base = current_outbound

    monthly_inbound = inbound_carry + max(0, current_inbound - inbound_base)
    monthly_outbound = outbound_carry + max(0, current_outbound - outbound_base)
    baseline.update(
        {
            "periodKey": period_key,
            "inboundBase": inbound_base,
            "outboundBase": outbound_base,
            "inboundCarry": inbound_carry,
            "outboundCarry": outbound_carry,
            "lastInbound": current_inbound,
            "lastOutbound": current_outbound,
            "updatedAt": utc_now(),
        }
    )
    baselines[service_name] = baseline

    return {
        "inboundBytes": monthly_inbound,
        "outboundBytes": monthly_outbound,
        "trafficBillingPeriod": period_key,
    }


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
    baselines = read_forwarding_counter_baselines(state_dir)

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
        monthly_counter = update_forwarding_counter_baseline(
            baselines,
            service_name,
            counter,
            forwarding_rule_monthly_reset_day(rule),
        )
        quota_bytes = forwarding_rule_quota_bytes(rule)
        billed_bytes = forwarding_rule_billed_bytes(rule, monthly_counter)
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
                "trafficBillingPeriod": monthly_counter["trafficBillingPeriod"],
            }
        )

    write_forwarding_counter_baselines(state_dir, baselines)
    write_json(runtime_dir(state_dir) / "port-forwarding-guardrails.json", {"evaluatedAt": evaluated_at, "rules": evaluations})
    return evaluations


def collect_forwarding_counters(state_dir):
    rules_dir = config_dir() / "port-forwarding" / "rules.d"
    if not rules_dir.exists():
        return []

    totals = read_forwarding_counter_totals()
    baselines = read_forwarding_counter_baselines(state_dir)
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
        monthly_counter = update_forwarding_counter_baseline(
            baselines,
            service_name,
            counter,
            forwarding_rule_monthly_reset_day(rule),
        )

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
                "inboundBytes": monthly_counter["inboundBytes"],
                "outboundBytes": monthly_counter["outboundBytes"],
                "sampledAt": sampled_at,
                "source": "nftables",
                "trafficBillingPeriod": monthly_counter["trafficBillingPeriod"],
            }
        )

    write_forwarding_counter_baselines(state_dir, baselines)
    return samples


def parse_xray_stats_output(output):
    stats = {}

    try:
        document = json.loads(output)

        def visit(value):
            if isinstance(value, dict):
                name = value.get("name")
                stat_value = value.get("value")
                if isinstance(name, str):
                    stats[name] = read_int(stat_value, 0)
                for child in value.values():
                    visit(child)
            elif isinstance(value, list):
                for child in value:
                    visit(child)

        visit(document)
    except Exception:
        pass

    for match in re.finditer(r'name:\s*"([^"]+)"\s+value:\s*([0-9]+)', output):
        stats[match.group(1)] = int(match.group(2))

    return stats


def query_xray_stats(state_dir):
    xray_bin = shutil.which("xray")
    if not xray_bin:
        return None

    result = run_command(
        state_dir,
        [xray_bin, "api", "statsquery", "--server", f"127.0.0.1:{xray_api_port()}"],
        timeout=8,
        check=False,
    )
    output = f"{result.stdout}\n{result.stderr}"
    if result.returncode != 0:
        return None

    return parse_xray_stats_output(output)


def probe_xray_stats_api(state_dir):
    xray_bin = shutil.which("xray")
    if not xray_bin:
        return False, "xray_binary_missing"

    try:
        result = run_command(
            state_dir,
            [xray_bin, "api", "statsquery", "--server", f"127.0.0.1:{xray_api_port()}"],
            timeout=5,
            check=False,
        )
    except Exception as error:
        return False, f"xray_stats_api_probe_error: {str(error)[:300]}"

    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()[:320]
        return False, f"xray_stats_api_unavailable{': ' + detail if detail else ''}"

    return True, None


def read_xray_client_profiles():
    profile_root = config_dir() / "xray" / "profiles.d"
    if not profile_root.exists():
        return []

    profiles = []
    for path in sorted(profile_root.glob("*.json")):
        profile = read_json(path, {})
        if isinstance(profile, dict):
            profiles.append(profile)
    return profiles


def read_xray_client_baselines(state_dir):
    baselines = read_json(runtime_dir(state_dir) / "xray-client-traffic-baselines.json", {})
    return baselines if isinstance(baselines, dict) else {}


def write_xray_client_baselines(state_dir, baselines):
    write_json(runtime_dir(state_dir) / "xray-client-traffic-baselines.json", baselines)


def update_xray_client_counter_baseline(baselines, key, raw_counter, reset_day, manual_used_bytes):
    period_key = billing_period_key(reset_day)
    current_uplink = read_int(raw_counter.get("uplinkBytes"), 0)
    current_downlink = read_int(raw_counter.get("downlinkBytes"), 0)
    baseline = baselines.get(key, {})

    if not isinstance(baseline, dict) or baseline.get("periodKey") != period_key:
        baseline = {
            "periodKey": period_key,
            "uplinkBase": current_uplink,
            "downlinkBase": current_downlink,
            "uplinkCarry": 0,
            "downlinkCarry": 0,
            "lastUplink": current_uplink,
            "lastDownlink": current_downlink,
            "resetAt": utc_now(),
        }

    uplink_base = int(baseline.get("uplinkBase", current_uplink))
    downlink_base = int(baseline.get("downlinkBase", current_downlink))
    uplink_carry = int(baseline.get("uplinkCarry", 0))
    downlink_carry = int(baseline.get("downlinkCarry", 0))
    last_uplink = int(baseline.get("lastUplink", current_uplink))
    last_downlink = int(baseline.get("lastDownlink", current_downlink))

    if current_uplink < last_uplink:
        uplink_carry += max(0, last_uplink - uplink_base)
        uplink_base = current_uplink

    if current_downlink < last_downlink:
        downlink_carry += max(0, last_downlink - downlink_base)
        downlink_base = current_downlink

    monthly_uplink = uplink_carry + max(0, current_uplink - uplink_base)
    monthly_downlink = downlink_carry + max(0, current_downlink - downlink_base)
    baseline.update(
        {
            "periodKey": period_key,
            "uplinkBase": uplink_base,
            "downlinkBase": downlink_base,
            "uplinkCarry": uplink_carry,
            "downlinkCarry": downlink_carry,
            "lastUplink": current_uplink,
            "lastDownlink": current_downlink,
            "updatedAt": utc_now(),
        }
    )
    baselines[key] = baseline

    return {
        "uplinkBytes": monthly_uplink,
        "downlinkBytes": monthly_downlink,
        "usedTrafficBytes": max(0, manual_used_bytes + monthly_uplink + monthly_downlink),
        "trafficBillingPeriod": period_key,
    }


def is_iso_datetime_expired(value):
    if not value:
        return False

    try:
        normalized = str(value).replace("Z", "+00:00")
        expires_at = datetime.datetime.fromisoformat(normalized)
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=datetime.timezone.utc)
        return expires_at <= datetime.datetime.now(datetime.timezone.utc)
    except Exception:
        return False


def xray_client_email_from_item(client):
    if not isinstance(client, dict):
        return ""
    return str(client.get("email") or "")


def filter_xray_inbound_clients(inbound, disabled_emails):
    next_inbound = json.loads(json.dumps(inbound))
    settings = next_inbound.get("settings") if isinstance(next_inbound.get("settings"), dict) else {}
    clients = settings.get("clients") if isinstance(settings.get("clients"), list) else []
    settings["clients"] = [
        client
        for client in clients
        if xray_client_email_from_item(client) not in disabled_emails
    ]
    next_inbound["settings"] = settings
    return next_inbound


def write_json_if_changed(path, value):
    if read_json(path, None) == value:
        return False
    write_json(path, value)
    return True


def restart_xray_runtime_after_guardrail(state_dir, inbounds):
    xray_root = config_dir() / "xray"
    log_root = Path("/var/log/ou-ui-xray")
    config_path = write_xray_runtime_config(xray_root, log_root, inbounds)
    xray_bin = shutil.which("xray")

    if not inbounds:
        stop_and_remove_unit(state_dir, "ou-ui-xray.service")
        return

    if not xray_bin or not (systemd_unit_dir() / "ou-ui-xray.service").exists():
        return

    test_xray_config(state_dir, xray_bin, config_path)
    systemctl(state_dir, "restart", "ou-ui-xray.service")


def enforce_xray_client_guardrails(state_dir, profiles, samples):
    sample_by_key = {
        f"{sample.get('inboundId', '')}:{sample.get('clientEmail', '')}": sample
        for sample in samples
    }
    disabled_by_tag = {}
    evaluations = []

    for profile in profiles:
        client_policy = profile.get("clientPolicy") if isinstance(profile.get("clientPolicy"), dict) else {}
        client_email = str(client_policy.get("clientEmail") or "")
        inbound_id = str(profile.get("targetId") or "")
        inbound_tag = str(profile.get("inboundTag") or "")
        if not client_email or not inbound_tag:
            continue

        sample = sample_by_key.get(f"{inbound_id}:{client_email}", {})
        monthly_reset_day = clamp_reset_day(client_policy.get("monthlyResetDay", sample.get("monthlyResetDay", 1)))
        traffic_limit = read_int(client_policy.get("trafficLimitBytes"), read_int(sample.get("trafficLimitBytes"), 0))
        used_traffic = read_int(sample.get("usedTrafficBytes"), read_int(client_policy.get("manualUsedTrafficBytes"), 0))
        quota_exceeded = traffic_limit > 0 and used_traffic >= traffic_limit
        client_expired = is_iso_datetime_expired(client_policy.get("expiresAt"))
        disabled = quota_exceeded or client_expired
        reason = (
            "xray_client_monthly_quota_exceeded"
            if quota_exceeded
            else "xray_client_expired"
            if client_expired
            else "ok"
        )

        if disabled:
            disabled_by_tag.setdefault(inbound_tag, set()).add(client_email)

        evaluations.append(
            {
                "inboundId": inbound_id,
                "inboundTag": inbound_tag,
                "agentId": str(profile.get("agentId") or os.environ.get("OU_AGENT_ID", "")),
                "clientEmail": client_email,
                "clientId": str(client_policy.get("clientId") or ""),
                "trafficLimitBytes": traffic_limit,
                "usedTrafficBytes": used_traffic,
                "monthlyResetDay": monthly_reset_day,
                "quotaExceeded": quota_exceeded,
                "clientExpired": client_expired,
                "runtimeDisabledByPolicy": disabled,
                "guardrailReason": reason,
                "trafficBillingPeriod": str(sample.get("trafficBillingPeriod") or billing_period_key(monthly_reset_day)),
                "evaluatedAt": utc_now(),
            }
        )

    changed = False
    inbound_root = config_dir() / "xray" / "inbounds.d"
    for profile in profiles:
        inbound = profile.get("inbound") if isinstance(profile.get("inbound"), dict) else None
        inbound_tag = str(profile.get("inboundTag") or "")
        if not inbound or not inbound_tag:
            continue
        runtime_inbound = filter_xray_inbound_clients(inbound, disabled_by_tag.get(inbound_tag, set()))
        path = inbound_root / f"{sanitize_service_name(inbound_tag)}.json"
        changed = write_json_if_changed(path, runtime_inbound) or changed

    inbounds = read_inbound_fragments(inbound_root)
    enforcement_error = None
    if changed:
        try:
            restart_xray_runtime_after_guardrail(state_dir, inbounds)
        except Exception as error:
            enforcement_error = str(error)
            log(state_dir, f"xray client guardrail enforcement failed: {error}")

    if enforcement_error:
        for evaluation in evaluations:
            evaluation["enforcementError"] = enforcement_error

    write_json(runtime_dir(state_dir) / "xray-client-guardrails.json", {"rules": evaluations, "evaluatedAt": utc_now()})
    return evaluations


def xray_guardrail_evaluations_to_samples(evaluations, sampled_at):
    samples = []
    for evaluation in evaluations:
        inbound_id = str(evaluation.get("inboundId") or "")
        inbound_tag = str(evaluation.get("inboundTag") or "")
        client_email = str(evaluation.get("clientEmail") or "")
        client_id = str(evaluation.get("clientId") or "")

        if (not inbound_id and not inbound_tag) or (not client_email and not client_id):
            continue

        samples.append(
            {
                "inboundId": inbound_id,
                "inboundTag": inbound_tag,
                "agentId": str(evaluation.get("agentId") or os.environ.get("OU_AGENT_ID", "")),
                "clientEmail": client_email,
                "clientId": client_id,
                "trafficLimitBytes": read_int(evaluation.get("trafficLimitBytes"), 0),
                "monthlyResetDay": clamp_reset_day(evaluation.get("monthlyResetDay", 1)),
                "quotaExceeded": bool(evaluation.get("quotaExceeded")),
                "clientExpired": bool(evaluation.get("clientExpired")),
                "runtimeDisabledByPolicy": bool(evaluation.get("runtimeDisabledByPolicy")),
                "guardrailReason": str(evaluation.get("guardrailReason") or "ok"),
                "sampledAt": sampled_at,
                "trafficBillingPeriod": str(evaluation.get("trafficBillingPeriod") or ""),
                "source": "xray-guardrail",
            }
        )
    return samples


def collect_xray_client_counters(state_dir):
    profiles = read_xray_client_profiles()
    if not profiles:
        return []

    stats = query_xray_stats(state_dir)
    if stats is None:
        sampled_at = utc_now()
        evaluations = enforce_xray_client_guardrails(state_dir, profiles, [])
        return xray_guardrail_evaluations_to_samples(evaluations, sampled_at)

    baselines = read_xray_client_baselines(state_dir)
    sampled_at = utc_now()
    samples = []

    for profile in profiles:
        client_policy = profile.get("clientPolicy") if isinstance(profile.get("clientPolicy"), dict) else {}
        client_email = str(client_policy.get("clientEmail") or "")
        if not client_email:
            continue

        inbound_id = str(profile.get("targetId") or "")
        inbound_tag = str(profile.get("inboundTag") or "")
        agent_id = str(profile.get("agentId") or os.environ.get("OU_AGENT_ID", ""))
        reset_day = clamp_reset_day(client_policy.get("monthlyResetDay", 1))
        manual_used = read_int(client_policy.get("manualUsedTrafficBytes"), 0)
        traffic_limit = read_int(client_policy.get("trafficLimitBytes"), 0)
        raw_counter = {
            "uplinkBytes": stats.get(f"user>>>{client_email}>>>traffic>>>uplink", 0),
            "downlinkBytes": stats.get(f"user>>>{client_email}>>>traffic>>>downlink", 0),
        }
        monthly_counter = update_xray_client_counter_baseline(
            baselines,
            f"{inbound_id}:{client_email}",
            raw_counter,
            reset_day,
            manual_used,
        )
        quota_exceeded = traffic_limit > 0 and monthly_counter["usedTrafficBytes"] >= traffic_limit

        samples.append(
            {
                "inboundId": inbound_id,
                "inboundTag": inbound_tag,
                "agentId": agent_id,
                "clientEmail": client_email,
                "clientId": str(client_policy.get("clientId") or ""),
                "uplinkBytes": monthly_counter["uplinkBytes"],
                "downlinkBytes": monthly_counter["downlinkBytes"],
                "usedTrafficBytes": monthly_counter["usedTrafficBytes"],
                "trafficLimitBytes": traffic_limit,
                "monthlyResetDay": reset_day,
                "quotaExceeded": quota_exceeded,
                "sampledAt": sampled_at,
                "trafficBillingPeriod": monthly_counter["trafficBillingPeriod"],
                "source": "xray-stats",
            }
        )

    evaluations = enforce_xray_client_guardrails(state_dir, profiles, samples)
    evaluation_by_key = {
        f"{evaluation.get('inboundId', '')}:{evaluation.get('clientEmail', '')}": evaluation
        for evaluation in evaluations
    }
    for sample in samples:
        evaluation = evaluation_by_key.get(f"{sample.get('inboundId', '')}:{sample.get('clientEmail', '')}", {})
        if evaluation:
            sample["clientExpired"] = evaluation["clientExpired"]
            sample["runtimeDisabledByPolicy"] = evaluation["runtimeDisabledByPolicy"]
            sample["guardrailReason"] = evaluation["guardrailReason"]

    write_xray_client_baselines(state_dir, baselines)
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


def collect_load_average():
    try:
        one, five, fifteen = os.getloadavg()
    except Exception:
        return {}

    return {
        "loadAverage1m": round(one, 2),
        "loadAverage5m": round(five, 2),
        "loadAverage15m": round(fifteen, 2),
    }


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
        **collect_load_average(),
        **memory,
        **disk,
        **network,
        "monthlyTrafficLimitBytes": guardrail["monthlyTrafficLimitBytes"],
        "quotaExceeded": guardrail["quotaExceeded"],
        "hostExpired": guardrail["hostExpired"],
        "runtimeDisabledByPolicy": guardrail["runtimeDisabledByPolicy"],
        "guardrailReason": guardrail["guardrailReason"],
        "hostGuardrailStoppedUnits": guardrail.get("stoppedUnits", []),
        "hostGuardrailRestoredUnits": guardrail.get("restoredUnits", []),
        "latencyMs": ping["latencyMs"],
        "latencyStatus": classify_latency_status(ping["latencyMs"], ping["packetLossPercent"], latency_thresholds),
        "latencySamplesMs": append_sample(state_dir, "latencySamplesMs", ping["latencyMs"]),
        "packetLossPercent": ping["packetLossPercent"],
        "packetLossSamplesPercent": append_sample(state_dir, "packetLossSamplesPercent", ping["packetLossPercent"]),
        "onlineDays": uptime_seconds // 86400,
        "uptimeSeconds": uptime_seconds,
        "runtimeServices": collect_runtime_service_health(state_dir),
        "reportedAt": now,
        "cpuModel": read_cpu_model(),
        "kernelVersion": os.uname().release if hasattr(os, "uname") else None,
        "virtualization": read_virtualization(),
        "primaryNetworkInterface": read_primary_nic(),
        "hardwareDetectedAt": now,
        "trafficTelemetrySource": "agent",
        "hardwareTelemetrySource": "agent",
        "xrayClientCounters": collect_xray_client_counters(state_dir),
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


RUNTIME_CREDENTIAL_ROTATE_WINDOW_SECONDS = 72 * 60 * 60
RUNTIME_CREDENTIAL_ROTATE_RETRY_SECONDS = 60 * 60
AGENT_ENV_KEYS = [
    "OU_MASTER",
    "OU_AGENT_ID",
    "OU_AGENT_TOKEN",
    "OU_AGENT_TOKEN_EXPIRES_AT",
    "OU_AGENT_CREDENTIAL_ID",
    "OU_AGENT_SESSION_ID",
    "OU_AGENT_VERSION",
    "OU_MAX_TRAFFIC_GB",
    "OU_INSTALL_PROFILE",
    "OU_AGENT_STATE_DIR",
    "OU_AGENT_CONFIG_DIR",
    "OU_AGENT_EXECUTOR_PATH",
    "OU_AGENT_PYTHON_BIN",
    "OU_AGENT_POLL_INTERVAL_SECONDS",
    "OU_AGENT_TELEMETRY_INTERVAL_SECONDS",
    "OU_AGENT_MAX_PENDING_EVENTS",
    "OU_AGENT_LOG_MAX_BYTES",
    "OU_AGENT_LOG_BACKUP_COUNT",
    "OU_AGENT_COMMAND_LOG_MAX_CHUNKS",
    "OU_AGENT_INSTALL_SCRIPT_URL",
]


def shell_env_quote(value):
    return "'" + str(value).replace("'", "'\"'\"'") + "'"


def write_agent_env_file(updates):
    env_path = config_dir() / "agent.env"
    values = {key: os.environ.get(key, "") for key in AGENT_ENV_KEYS}
    values.update({key: str(value) for key, value in updates.items()})
    content = "\n".join(f"{key}={shell_env_quote(values[key])}" for key in AGENT_ENV_KEYS) + "\n"
    temp_path = env_path.with_suffix(env_path.suffix + ".tmp")
    stat_result = None

    try:
        stat_result = env_path.stat()
    except OSError:
        pass

    temp_path.write_text(content, encoding="utf-8")
    if stat_result:
        os.chown(temp_path, stat_result.st_uid, stat_result.st_gid)
        os.chmod(temp_path, stat_result.st_mode & 0o777)
    else:
        os.chmod(temp_path, 0o640)
    temp_path.replace(env_path)


def runtime_credential_rotation_attempt_path(state_dir):
    return runtime_dir(state_dir) / "credential-rotation-attempt.json"


def runtime_credential_rotation_due(state_dir, expires_at):
    expires_epoch = parse_utc_epoch(expires_at)
    if expires_epoch is None:
        return False

    now = time.time()
    if expires_epoch - now > RUNTIME_CREDENTIAL_ROTATE_WINDOW_SECONDS:
        return False

    attempt = read_json(runtime_credential_rotation_attempt_path(state_dir), {})
    last_attempt = read_float(attempt.get("attemptedAtEpoch"), 0.0) if isinstance(attempt, dict) else 0.0
    return now - last_attempt >= RUNTIME_CREDENTIAL_ROTATE_RETRY_SECONDS


def mark_runtime_credential_rotation_attempt(state_dir):
    write_json(
        runtime_credential_rotation_attempt_path(state_dir),
        {
            "attemptedAt": utc_now(),
            "attemptedAtEpoch": time.time(),
        },
    )


def maybe_rotate_runtime_credential(state_dir, master_poll_url, token, agent_id, session_id):
    expires_at = os.environ.get("OU_AGENT_TOKEN_EXPIRES_AT", "")
    if not runtime_credential_rotation_due(state_dir, expires_at):
        return token

    mark_runtime_credential_rotation_attempt(state_dir)
    rotate_url = master_poll_url.rstrip("/").rsplit("/", 1)[0] + "/credentials/rotate"
    request_id = f"agent-credential-rotate-{agent_id}-{int(time.time())}"
    body = {
        "agentId": agent_id,
        "requestId": request_id,
        "reason": "agent.runtime_credential_renewal",
    }
    if session_id:
        body["sessionId"] = session_id

    try:
        response = request_json(rotate_url, token, body, timeout=20)
        data = response.get("data", {})
        next_token = str(data.get("agentToken") or "")
        next_expires_at = str(data.get("expiresAt") or "")
        next_credential_id = str(data.get("credentialId") or "")

        if not next_token or not next_expires_at or not next_credential_id:
            raise RuntimeError("runtime credential rotation response was incomplete")

        updates = {
            "OU_AGENT_TOKEN": next_token,
            "OU_AGENT_TOKEN_EXPIRES_AT": next_expires_at,
            "OU_AGENT_CREDENTIAL_ID": next_credential_id,
        }
        write_agent_env_file(updates)
        os.environ.update(updates)
        log(state_dir, f"rotated Agent runtime credential request_id={request_id} credential_id={next_credential_id}")
        return next_token
    except Exception as error:
        log(state_dir, f"runtime credential rotation skipped request_id={request_id}: {error}")
        return token


def runtime_dir(state_dir):
    return Path(state_dir) / "runtime"


def snapshot_dir(state_dir):
    return Path(state_dir) / "snapshots"


def run_command(state_dir, args, timeout=30, check=True):
    command_line = " ".join(shlex.quote(str(arg)) for arg in args)
    log(state_dir, "exec " + command_line)

    try:
        result = subprocess.run(args, text=True, capture_output=True, timeout=timeout, check=False)
    except Exception as error:
        record_command_log("runtime", f"$ {command_line}\nerror={error}")
        raise

    record_command_log("runtime", f"$ {command_line}\nexitCode={result.returncode}")
    record_command_log("stdout", result.stdout)
    record_command_log("stderr", result.stderr)

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
        xray_root / "profiles.d" / f"{tag}.json",
        systemd_unit_dir() / "ou-ui-xray.service",
    ]


def forwarding_snapshot_paths(artifact):
    rule = artifact.get("rule") if isinstance(artifact.get("rule"), dict) else {}
    binding = rule.get("binding") if isinstance(rule.get("binding"), dict) else {}
    service_plan = artifact.get("servicePlan") if isinstance(artifact.get("servicePlan"), dict) else {}
    service_name = sanitize_service_name(service_plan.get("serviceName") or binding.get("serviceName") or artifact.get("targetId"))
    return [
        config_dir() / "port-forwarding" / "rules.d" / f"{service_name}.json",
        *[systemd_unit_dir() / unit for unit in forwarding_service_units(service_name)],
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


def xray_api_port():
    return 62789


def xray_stats_policy_for_levels(inbounds):
    stats_policy = {"statsUserUplink": True, "statsUserDownlink": True}
    levels = {"0": stats_policy}

    for inbound in inbounds:
        settings = inbound.get("settings") if isinstance(inbound.get("settings"), dict) else {}
        clients = settings.get("clients") if isinstance(settings.get("clients"), list) else []
        for client in clients:
            if not isinstance(client, dict):
                continue
            level = str(read_int(client.get("level"), 0))
            levels[level] = stats_policy

    return levels


def build_xray_runtime_config(inbounds, log_root):
    if not inbounds:
        return {
            "log": {
                "access": str(log_root / "access.log"),
                "error": str(log_root / "error.log"),
                "loglevel": "warning",
            },
            "inbounds": [],
            "outbounds": [
                {"tag": "direct", "protocol": "freedom"},
                {"tag": "blocked", "protocol": "blackhole"},
            ],
        }

    api_inbound = {
        "tag": "ou-api-in",
        "listen": "127.0.0.1",
        "port": xray_api_port(),
        "protocol": "dokodemo-door",
        "settings": {"address": "127.0.0.1"},
    }
    return {
        "log": {
            "access": str(log_root / "access.log"),
            "error": str(log_root / "error.log"),
            "loglevel": "warning",
        },
        "api": {"tag": "ou-api", "services": ["StatsService"]},
        "stats": {},
        "policy": {
            "levels": xray_stats_policy_for_levels(inbounds),
            "system": {
                "statsInboundUplink": True,
                "statsInboundDownlink": True,
                "statsOutboundUplink": True,
                "statsOutboundDownlink": True,
            },
        },
        "inbounds": [*inbounds, api_inbound],
        "outbounds": [
            {"tag": "direct", "protocol": "freedom"},
            {"tag": "blocked", "protocol": "blackhole"},
        ],
        "routing": {
            "rules": [
                {
                    "type": "field",
                    "inboundTag": ["ou-api-in"],
                    "outboundTag": "ou-api",
                }
            ]
        },
    }


def write_xray_runtime_config(xray_root, log_root, inbounds):
    config_path = xray_root / "config.json"
    write_json(config_path, build_xray_runtime_config(inbounds, log_root))
    return config_path


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
    profile_root = xray_root / "profiles.d"
    log_root = Path("/var/log/ou-ui-xray")
    inbound_root.mkdir(parents=True, exist_ok=True)
    profile_root.mkdir(parents=True, exist_ok=True)
    log_root.mkdir(parents=True, exist_ok=True)

    inbound = ((artifact.get("xray") or {}).get("inbound") or {}) if isinstance(artifact.get("xray"), dict) else {}
    tag = sanitize_service_name(inbound.get("tag") or artifact.get("targetId") or command["taskId"])
    inbound_path = inbound_root / f"{tag}.json"
    profile_path = profile_root / f"{tag}.json"
    changed = []

    if action == "remove_inbound":
        if inbound_path.exists():
            inbound_path.unlink()
            changed.append(str(inbound_path))
        if profile_path.exists():
            profile_path.unlink()
            changed.append(str(profile_path))
    else:
        if not inbound:
            raise RuntimeError("xray artifact does not contain xray.inbound")
        write_json(inbound_path, inbound)
        changed.append(str(inbound_path))
        write_json(
            profile_path,
            {
                "targetId": artifact.get("targetId"),
                "targetLabel": artifact.get("targetLabel"),
                "agentId": artifact.get("agentId"),
                "inboundTag": inbound.get("tag"),
                "inbound": inbound,
                "customer": artifact.get("customer") if isinstance(artifact.get("customer"), dict) else {},
                "clientPolicy": artifact.get("clientPolicy") if isinstance(artifact.get("clientPolicy"), dict) else {},
            },
        )
        changed.append(str(profile_path))

    inbounds = read_inbound_fragments(inbound_root)
    config_path = write_xray_runtime_config(xray_root, log_root, inbounds)
    changed.append(str(config_path))

    xray_bin = shutil.which("xray")
    if not inbounds:
        unit_path = systemd_unit_dir() / "ou-ui-xray.service"
        unit_existed = unit_path.exists()
        stop_and_remove_unit(state_dir, "ou-ui-xray.service")
        if unit_existed:
            changed.append(str(unit_path))
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


def forwarding_service_units(service_name, protocol=None):
    protocols = forward_protocols(protocol) if protocol else ["tcp", "udp"]
    return [service_unit_name(service_name, item) for item in protocols]


def stop_and_remove_forwarding_units(state_dir, service_name, protocol=None):
    changed = []

    for unit in forwarding_service_units(service_name, protocol):
        unit_path = systemd_unit_dir() / unit
        existed = unit_path.exists()
        stop_and_remove_unit(state_dir, unit)
        if existed:
            changed.append(str(unit_path))

    return changed


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


def gost_rate_limiter_query(rate_limit_mbps, rate_limit_mode, rate_limit_direction):
    query = {}
    bandwidth_limit = mbps_to_gost_limit(rate_limit_mbps)

    if bandwidth_limit:
        mode = str(rate_limit_mode or "bi-directional")
        direction = str(rate_limit_direction or "both")
        if mode == "one-way":
            if direction == "egress":
                query["limiter.out"] = bandwidth_limit
            else:
                query["limiter.in"] = bandwidth_limit
        else:
            query["limiter.in"] = bandwidth_limit
            query["limiter.out"] = bandwidth_limit

    return query


def gost_forward_url(
    protocol,
    listen_address,
    listen_port,
    target_address,
    target_port,
    rate_limit_mbps,
    rate_limit_mode,
    rate_limit_direction,
):
    query = gost_rate_limiter_query(rate_limit_mbps, rate_limit_mode, rate_limit_direction)

    encoded_query = urllib.parse.urlencode(query)
    base_url = (
        f"{protocol}://{format_host_port(listen_address, listen_port)}/"
        f"{format_host_port(target_address, target_port)}"
    )
    return f"{base_url}?{encoded_query}" if encoded_query else base_url


def gost_args(
    gost_bin,
    protocol,
    listen_address,
    listen_port,
    target_address,
    target_port,
    rate_limit_mbps,
    rate_limit_mode,
    rate_limit_direction,
):
    return [
        gost_bin,
        "-L",
        gost_forward_url(
            protocol,
            listen_address,
            listen_port,
            target_address,
            target_port,
            rate_limit_mbps,
            rate_limit_mode,
            rate_limit_direction,
        ),
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
    rate_limit_mode,
    rate_limit_direction,
):
    if gost_bin:
        return (
            gost_args(
                gost_bin,
                protocol,
                listen_address,
                listen_port,
                target_address,
                target_port,
                rate_limit_mbps,
                rate_limit_mode,
                rate_limit_direction,
            ),
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
            + ". Current Agent runtime supports listen/target TCP/UDP forwarding, rule-level GOST rateLimitMbps with one-way or bi-directional modes, and nftables traffic counters."
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
    units = forwarding_service_units(service_name, protocol)
    changed = []

    if artifact.get("action") == "remove_forward_rule":
        changed.extend(stop_and_remove_forwarding_units(state_dir, service_name))
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

    if rule.get("enabled") is False:
        changed.extend(stop_and_remove_forwarding_units(state_dir, service_name))
        delete_forwarding_counter_rules(service_name)
        rule_path = config_dir() / "port-forwarding" / "rules.d" / f"{service_name}.json"
        write_json(rule_path, artifact)
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
                "runtime": "disabled",
                "services": units,
            },
        )

    gost_bin = shutil.which("gost")
    socat_bin = shutil.which("socat")
    limits = rule.get("limits") if isinstance(rule.get("limits"), dict) else {}
    assert_supported_forwarding_controls(rule)
    rate_limit = int_limit(limits.get("rateLimitMbps"))
    rate_limit_mode = str(limits.get("rateLimitMode") or "bi-directional")
    rate_limit_direction = str(limits.get("rateLimitDirection") or "both")

    listen_address = str(binding.get("listenAddress") or "0.0.0.0")
    listen_port = int(binding.get("listenPort") or 0)
    target_address = str(binding.get("targetAddress") or "127.0.0.1")
    target_port = int(binding.get("targetPort") or 0)

    if listen_port <= 0 or target_port <= 0:
        raise RuntimeError("port-forwarding artifact requires listenPort and targetPort")

    changed.extend(stop_and_remove_forwarding_units(state_dir, service_name))

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
                rate_limit_mode,
                rate_limit_direction,
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
            "rateLimitMode": rate_limit_mode,
            "rateLimitDirection": rate_limit_direction,
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


def forwarding_runtime_service_units(state_dir):
    port_forwarding_state = read_json(runtime_dir(state_dir) / "port-forwarding.json", {})
    legacy_forwarding_state = read_json(runtime_dir(state_dir) / "flvx.json", {})
    services = []
    if isinstance(port_forwarding_state, dict):
        services.extend(port_forwarding_state.get("services", []))
    if isinstance(legacy_forwarding_state, dict):
        services.extend(legacy_forwarding_state.get("services", []))

    return sorted(set(service_unit_name(unit) for unit in services if isinstance(unit, str)))


def forwarding_health_checks(state_dir, required=False):
    checks = []
    checked_units = set()

    for entry in forwarding_rule_service_entries():
        unit = service_unit_name(entry.get("unit") or entry.get("name"))
        checked_units.add(unit)
        checks.append(forwarding_service_check(state_dir, entry, required=True))

    for unit in forwarding_runtime_service_units(state_dir):
        if unit in checked_units:
            continue
        checked_units.add(unit)
        checks.append(systemd_service_check(state_dir, "port-forwarding", unit, required=True))

    if not checks:
        return [
            {
                "name": "port-forwarding",
                "status": "failed" if required else "skipped",
                "reason": "no_forwarding_units",
            }
        ]

    return checks


def probe_forwarding_listener(listener):
    if not isinstance(listener, dict):
        return True, None

    try:
        port = int(listener.get("port") or 0)
    except Exception:
        port = 0
    host = str(listener.get("host") or "127.0.0.1")

    if port <= 0:
        return True, None

    try:
        connection = socket.create_connection((host, port), timeout=2)
        connection.close()
        return True, None
    except Exception as error:
        return False, f"forwarding_listener_unavailable: {host}:{port} {str(error)[:240]}"


def forwarding_service_check(state_dir, entry, required=True):
    unit = entry.get("unit") or entry.get("name")
    check = systemd_service_check(state_dir, "port-forwarding", unit, required=required)

    if check.get("status") != "passed":
        return check

    listener_ok, listener_detail = probe_forwarding_listener(entry.get("listener"))
    if listener_ok:
        return {
            **check,
            **({"listener": entry.get("listener")} if entry.get("listener") else {}),
        }

    return {
        **check,
        "status": "failed",
        "reason": "forwarding_listener_unavailable",
        "detail": listener_detail,
        **({"listener": entry.get("listener")} if entry.get("listener") else {}),
    }


def xray_api_health_check(state_dir, required=False):
    unit = "ou-ui-xray.service"
    unit_path = systemd_unit_dir() / unit
    if not unit_path.exists():
        return {
            "name": "xray-api",
            "status": "failed" if required else "skipped",
            "unit": unit,
            "reason": "unit_missing",
        }

    if not service_active(state_dir, unit):
        return {
            "name": "xray-api",
            "status": "failed",
            "unit": unit,
            "reason": "unit_inactive",
        }

    api_ok, api_detail = probe_xray_stats_api(state_dir)
    return {
        "name": "xray-api",
        "status": "passed" if api_ok else "failed",
        "unit": unit,
        **({} if api_ok else {"reason": "xray_stats_api_unavailable", "detail": api_detail}),
    }


def module_api_health_checks(state_dir):
    checks = []
    xray_unit = "ou-ui-xray.service"
    if (systemd_unit_dir() / xray_unit).exists():
        checks.append(systemd_service_check(state_dir, "xray", xray_unit, required=True))
        checks.append(xray_api_health_check(state_dir, required=True))
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
            checks.append(xray_api_health_check(state_dir, required=True))
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
    reset_command_log_buffer()
    ack_event = build_command_event(state_dir, command, "ack", {"duplicate": False}, minimum_seq=command_seq)
    try:
        send_event(master_poll_url, token, ack_event)
    except Exception as error:
        if is_non_retryable_agent_event_error(error):
            log(state_dir, f"dropped expired Agent command {command.get('commandId')} after ACK rejection: {error}")
            return command_seq
        raise

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
            "healthSummary": {
                "runtime": "command_failed",
                "commandType": command.get("type"),
                "checkedAt": utc_now(),
                "failureReason": str(error),
            },
        }

    send_command_log_chunks(state_dir, master_poll_url, token, command, ack_event["seq"], payload)
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

    token = maybe_rotate_runtime_credential(state_dir, master, token, agent_id, session_id)
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

rotate_agent_log() {
  local log_file="\${OU_AGENT_STATE_DIR}/logs/agent.log"
  local max_bytes="\${OU_AGENT_LOG_MAX_BYTES:-5242880}"
  local backup_count="\${OU_AGENT_LOG_BACKUP_COUNT:-3}"
  local current_size="0"
  local idx
  local src
  local dst

  [[ "\${max_bytes}" =~ ^[0-9]+$ ]] || max_bytes="5242880"
  [[ "\${backup_count}" =~ ^[0-9]+$ ]] || backup_count="3"
  (( max_bytes > 0 )) || return 0
  [[ -f "\${log_file}" ]] || return 0

  current_size="\$(wc -c <"\${log_file}" 2>/dev/null || printf '0')"
  [[ "\${current_size}" =~ ^[0-9]+$ ]] || current_size="0"
  (( current_size >= max_bytes )) || return 0

  if (( backup_count <= 0 )); then
    : >"\${log_file}"
    return 0
  fi

  for (( idx=backup_count; idx>=1; idx-- )); do
    if (( idx == 1 )); then
      src="\${log_file}"
    else
      src="\${log_file}.\$((idx - 1))"
    fi
    dst="\${log_file}.\${idx}"
    if [[ -e "\${src}" ]]; then
      mv -f "\${src}" "\${dst}"
    fi
  done
}

mkdir -p "\${OU_AGENT_STATE_DIR}/logs"
rotate_agent_log
printf '[OU-UI Agent] started agent_id=%s master=%s profile=%s\n' "\${OU_AGENT_ID}" "\${OU_MASTER}" "\${OU_INSTALL_PROFILE}" >>"\${OU_AGENT_STATE_DIR}/logs/agent.log"

while true; do
  # shellcheck disable=SC1091
  source "${CONFIG_DIR}/agent.env"

  rotate_agent_log
  if ! "\${OU_AGENT_PYTHON_BIN}" "\${OU_AGENT_EXECUTOR_PATH}" >>"\${OU_AGENT_STATE_DIR}/logs/agent.log" 2>&1; then
    rotate_agent_log
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

service_active_summary() {
  local unit="$1"
  if ! command -v systemctl >/dev/null 2>&1; then
    printf 'systemctl unavailable'
    return
  fi
  systemctl is-active "${unit}" 2>/dev/null || printf 'unknown'
}

service_enabled_summary() {
  local unit="$1"
  if ! command -v systemctl >/dev/null 2>&1; then
    printf 'systemctl unavailable'
    return
  fi
  systemctl is-enabled "${unit}" 2>/dev/null || printf 'unknown'
}

file_size_summary() {
  local file_path="$1"
  if [[ -f "${file_path}" ]]; then
    printf '%s bytes' "$(wc -c <"${file_path}" | tr -d '[:space:]')"
  else
    printf 'missing'
  fi
}

file_present_summary() {
  local file_path="$1"
  if [[ -f "${file_path}" ]]; then
    printf 'present'
  else
    printf 'missing'
  fi
}

command_path_summary() {
  local command_name="$1"
  command -v "${command_name}" 2>/dev/null || printf 'missing'
}

read_runtime_marker() {
  local file_path="$1"
  local fallback="${2:-missing}"
  if [[ -f "${file_path}" ]]; then
    head -c 200 "${file_path}" 2>/dev/null | tr -d '\n' || printf '%s' "${fallback}"
  else
    printf '%s' "${fallback}"
  fi
}

json_array_length_summary() {
  local file_path="$1"
  local python_bin="${OU_AGENT_PYTHON_BIN:-}"

  [[ -f "${file_path}" ]] || {
    printf '0'
    return
  }

  if [[ -z "${python_bin}" || ! -x "${python_bin}" ]]; then
    python_bin="$(command -v python3 2>/dev/null || command -v python 2>/dev/null || true)"
  fi

  if [[ -z "${python_bin}" ]]; then
    printf 'unknown'
    return
  fi

  "${python_bin}" - "${file_path}" <<'PY' 2>/dev/null || printf 'unreadable'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    value = json.load(handle)
print(len(value) if isinstance(value, list) else "invalid")
PY
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

show_doctor() {
  if [[ ! -f "${CONFIG_DIR}/agent.env" ]]; then
    fail "Agent env file not found: ${CONFIG_DIR}/agent.env"
  fi

  # shellcheck disable=SC1091
  source "${CONFIG_DIR}/agent.env"

  local env_summary token_state log_file pending_file runtime_dir
  local event_seq last_seen_seq next_poll pending_count
  env_summary="$(stat -c '%U:%G %a' "${CONFIG_DIR}/agent.env" 2>/dev/null || printf 'unknown')"
  token_state="missing"
  [[ -n "${OU_AGENT_TOKEN:-}" ]] && token_state="configured"
  log_file="${OU_AGENT_STATE_DIR:-${STATE_DIR}}/logs/agent.log"
  runtime_dir="${OU_AGENT_STATE_DIR:-${STATE_DIR}}/runtime"
  pending_file="${runtime_dir}/pending-events.json"
  pending_count="$(json_array_length_summary "${pending_file}")"
  event_seq="$(read_runtime_marker "${OU_AGENT_STATE_DIR:-${STATE_DIR}}/event-seq" "missing")"
  last_seen_seq="$(read_runtime_marker "${OU_AGENT_STATE_DIR:-${STATE_DIR}}/last-seen-command-seq" "missing")"
  next_poll="$(read_runtime_marker "${runtime_dir}/next-poll-after-seconds" "default")"

  cat <<EOT
OU-UI Agent 本机诊断
  Agent ID: ${OU_AGENT_ID:-unknown}
  Master: ${OU_MASTER:-unknown}
  Profile: ${OU_INSTALL_PROFILE:-unknown}
  Version: ${OU_AGENT_VERSION:-unknown}
  Credential: ${OU_AGENT_CREDENTIAL_ID:-unknown}
  Session: ${OU_AGENT_SESSION_ID:-unknown}
  Token: ${token_state}
  Token expires at: ${OU_AGENT_TOKEN_EXPIRES_AT:-unknown}
  Env file: ${CONFIG_DIR}/agent.env (${env_summary})
  Install root: ${INSTALL_ROOT}
  State dir: ${OU_AGENT_STATE_DIR:-${STATE_DIR}}
  Service active: $(service_active_summary "${SERVICE_NAME}")
  Service enabled: $(service_enabled_summary "${SERVICE_NAME}")
  Executor: $(file_present_summary "${OU_AGENT_EXECUTOR_PATH:-${INSTALL_ROOT}/bin/ou-agent-executor.py}")
  Runner: $(file_present_summary "${INSTALL_ROOT}/bin/ou-agent-runner")
  Python: ${OU_AGENT_PYTHON_BIN:-unknown}
  Xray binary: $(command_path_summary xray)
  GOST binary: $(command_path_summary gost)
  Agent log: ${log_file} ($(file_size_summary "${log_file}"))
  Pending events: ${pending_count} (${pending_file})
  Event seq: ${event_seq}
  Last seen command seq: ${last_seen_seq}
  Next poll interval: ${next_poll}
  Host runtime state: $(file_present_summary "${runtime_dir}/host-agent.json")
  Xray runtime state: $(file_present_summary "${runtime_dir}/xray.json")
  Port-forwarding runtime state: $(file_present_summary "${runtime_dir}/port-forwarding.json")
  Host guardrails: $(file_present_summary "${runtime_dir}/host-guardrails.json")
  Port-forwarding guardrails: $(file_present_summary "${runtime_dir}/port-forwarding-guardrails.json")
  Xray guardrails: $(file_present_summary "${runtime_dir}/xray-client-guardrails.json")
EOT
}

json_escape_string() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
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

  fail "当前系统缺少 sha256sum 或 shasum，无法计算 SHA-256。"
}

agent_acceptance_file_manifest_json() {
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

redact_agent_evidence_stream() {
  sed -E \
    -e 's/(OU_AGENT_TOKEN=)[^[:space:]]+/\1[redacted]/g' \
    -e 's/([Bb]earer )[A-Za-z0-9._~+\/=-]+/\1[redacted]/g' \
    -e 's/("agentToken"[[:space:]]*:[[:space:]]*")[^"]+/\1[redacted]/g'
}

write_agent_runtime_summary() {
  local output_path="$1"
  local state_dir_path="${OU_AGENT_STATE_DIR:-${STATE_DIR}}"
  local python_bin

  python_bin="$(command -v python3 2>/dev/null || command -v python 2>/dev/null || true)"
  if [[ -z "${python_bin}" ]]; then
    printf '{"schemaVersion":"ou-ui-agent.runtime-summary.v1","status":"unavailable","reason":"python_missing"}\n' >"${output_path}"
    return 1
  fi

  "${python_bin}" - "${state_dir_path}" "${output_path}" <<'PY'
import hashlib
import json
import sys
from pathlib import Path


state_dir = Path(sys.argv[1])
output_path = Path(sys.argv[2])
runtime_dir = state_dir / "runtime"


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_json_file(path):
    try:
        return json.loads(path.read_text(encoding="utf-8")), None
    except FileNotFoundError:
        return None, "missing"
    except Exception as error:
        return None, f"invalid_json:{type(error).__name__}"


def file_summary(name, relative_path):
    path = state_dir / relative_path
    result = {
        "name": name,
        "path": str(relative_path),
        "present": path.is_file(),
    }
    if path.is_file():
        result.update(
            {
                "sizeBytes": path.stat().st_size,
                "sha256": sha256_file(path),
            }
        )
    return result


def module_summary(module_kind, file_name):
    path = runtime_dir / file_name
    value, error = read_json_file(path)
    summary = {
        "moduleKind": module_kind,
        "present": path.is_file(),
    }
    if error and error != "missing":
        summary["parseError"] = error
    if not isinstance(value, dict):
        return summary

    health_keys = [
        "artifactVersion",
        "runtime",
        "desiredState",
        "inboundCount",
        "rateLimitRuntime",
        "rateLimitMode",
        "rateLimitDirection",
        "trafficCounterRuntime",
        "snapshotFileCount",
        "lastAppliedAt",
    ]
    for key in health_keys:
        if key in value and value[key] is not None:
            summary[key] = value[key]
    services = value.get("services")
    if isinstance(services, list):
        summary["serviceCount"] = len([item for item in services if isinstance(item, str)])
    engines = value.get("runtimeEngines")
    if isinstance(engines, list):
        summary["runtimeEngines"] = sorted(str(item) for item in engines if isinstance(item, str))
    return summary


def host_guardrail_summary():
    value, error = read_json_file(runtime_dir / "host-guardrails.json")
    summary = {"present": (runtime_dir / "host-guardrails.json").is_file()}
    if error and error != "missing":
        summary["parseError"] = error
    if not isinstance(value, dict):
        return summary
    for key in ["quotaExceeded", "hostExpired", "runtimeDisabledByPolicy", "guardrailReason", "trafficBillingPeriod"]:
        if key in value:
            summary[key] = value[key]
    for key in ["stoppedUnits", "restoredUnits"]:
        items = value.get(key)
        if isinstance(items, list):
            summary[f"{key}Count"] = len(items)
    return summary


def rule_guardrail_summary(file_name, rule_key):
    value, error = read_json_file(runtime_dir / file_name)
    summary = {"present": (runtime_dir / file_name).is_file(), "ruleCount": 0}
    if error and error != "missing":
        summary["parseError"] = error
    if not isinstance(value, dict):
        return summary
    rules = value.get("rules")
    if not isinstance(rules, list):
        return summary
    summary["ruleCount"] = len(rules)
    summary["quotaExceededCount"] = sum(1 for item in rules if isinstance(item, dict) and item.get("quotaExceeded") is True)
    summary["runtimeDisabledByPolicyCount"] = sum(
        1 for item in rules if isinstance(item, dict) and item.get("runtimeDisabledByPolicy") is True
    )
    summary["clientExpiredCount"] = sum(1 for item in rules if isinstance(item, dict) and item.get("clientExpired") is True)
    summary["enforcementErrorCount"] = sum(1 for item in rules if isinstance(item, dict) and item.get("enforcementError"))
    summary["stoppedUnitCount"] = sum(
        len(item.get("stoppedUnits", []))
        for item in rules
        if isinstance(item, dict) and isinstance(item.get("stoppedUnits"), list)
    )
    summary["kind"] = rule_key
    return summary


def pending_events_count():
    value, _error = read_json_file(runtime_dir / "pending-events.json")
    return len(value) if isinstance(value, list) else 0


summary = {
    "schemaVersion": "ou-ui-agent.runtime-summary.v1",
    "status": "ok",
    "runtimeFiles": [
        file_summary("host-agent", Path("runtime/host-agent.json")),
        file_summary("xray", Path("runtime/xray.json")),
        file_summary("port-forwarding", Path("runtime/port-forwarding.json")),
        file_summary("host-guardrails", Path("runtime/host-guardrails.json")),
        file_summary("port-forwarding-guardrails", Path("runtime/port-forwarding-guardrails.json")),
        file_summary("xray-client-guardrails", Path("runtime/xray-client-guardrails.json")),
        file_summary("pending-events", Path("runtime/pending-events.json")),
    ],
    "modules": [
        module_summary("host-agent", "host-agent.json"),
        module_summary("xray", "xray.json"),
        module_summary("port-forwarding", "port-forwarding.json"),
    ],
    "guardrails": {
        "host": host_guardrail_summary(),
        "portForwarding": rule_guardrail_summary("port-forwarding-guardrails.json", "port-forwarding"),
        "xrayClients": rule_guardrail_summary("xray-client-guardrails.json", "xray-client"),
    },
    "pendingEvents": {
        "count": pending_events_count(),
    },
}

output_path.parent.mkdir(parents=True, exist_ok=True)
output_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
}

run_agent_acceptance() {
  require_root

  if [[ ! -f "${CONFIG_DIR}/agent.env" ]]; then
    fail "Agent env file not found: ${CONFIG_DIR}/agent.env"
  fi

  # shellcheck disable=SC1091
  source "${CONFIG_DIR}/agent.env"

  local started_at acceptance_root bundle_dir doctor_log service_status_log agent_log_tail runtime_summary manifest_path agent_log
  local doctor_status service_status runtime_summary_status
  local escaped_bundle_dir escaped_agent_id escaped_master escaped_profile escaped_version escaped_runtime_summary
  local doctor_file_manifest service_status_file_manifest agent_log_tail_file_manifest runtime_summary_file_manifest

  started_at="$(date -u +%Y%m%dT%H%M%SZ)"
  acceptance_root="${OU_AGENT_STATE_DIR:-${STATE_DIR}}/acceptance"
  bundle_dir="${acceptance_root}/${started_at}"
  AGENT_ACCEPTANCE_LAST_BUNDLE_DIR="${bundle_dir}"
  doctor_log="${bundle_dir}/doctor.txt"
  service_status_log="${bundle_dir}/service-status.txt"
  agent_log_tail="${bundle_dir}/agent-log-tail.txt"
  runtime_summary="${bundle_dir}/runtime-summary.json"
  manifest_path="${bundle_dir}/manifest.json"
  agent_log="${OU_AGENT_STATE_DIR:-${STATE_DIR}}/logs/agent.log"

  mkdir -p "${bundle_dir}"
  chmod 700 "${acceptance_root}" "${bundle_dir}" 2>/dev/null || true

  if show_doctor >"${doctor_log}" 2>&1; then
    doctor_status=0
  else
    doctor_status=$?
  fi

  if command -v systemctl >/dev/null 2>&1; then
    if systemctl status "${SERVICE_NAME}" --no-pager >"${service_status_log}" 2>&1; then
      service_status=0
    else
      service_status=$?
    fi
  else
    service_status=0
    printf 'systemctl unavailable\n' >"${service_status_log}"
  fi

  if [[ -f "${agent_log}" ]]; then
    tail -n 300 "${agent_log}" | redact_agent_evidence_stream >"${agent_log_tail}"
  else
    printf 'Agent log not found: %s\n' "${agent_log}" >"${agent_log_tail}"
  fi

  if write_agent_runtime_summary "${runtime_summary}" >/dev/null 2>&1; then
    runtime_summary_status=0
  else
    runtime_summary_status=$?
    if [[ ! -f "${runtime_summary}" ]]; then
      printf '{"schemaVersion":"ou-ui-agent.runtime-summary.v1","status":"failed"}\n' >"${runtime_summary}"
    fi
  fi

  chmod 600 "${doctor_log}" "${service_status_log}" "${agent_log_tail}" "${runtime_summary}" 2>/dev/null || true

  escaped_bundle_dir="$(json_escape_string "${bundle_dir}")"
  escaped_agent_id="$(json_escape_string "${OU_AGENT_ID:-unknown}")"
  escaped_master="$(json_escape_string "${OU_MASTER:-unknown}")"
  escaped_profile="$(json_escape_string "${OU_INSTALL_PROFILE:-unknown}")"
  escaped_version="$(json_escape_string "${OU_AGENT_VERSION:-unknown}")"
  escaped_runtime_summary="$(json_escape_string "${runtime_summary}")"
  doctor_file_manifest="$(agent_acceptance_file_manifest_json "${doctor_log}")"
  service_status_file_manifest="$(agent_acceptance_file_manifest_json "${service_status_log}")"
  agent_log_tail_file_manifest="$(agent_acceptance_file_manifest_json "${agent_log_tail}")"
  runtime_summary_file_manifest="$(agent_acceptance_file_manifest_json "${runtime_summary}")"

  cat >"${manifest_path}" <<AGENT_ACCEPTANCE_MANIFEST_EOF
{"schemaVersion":"ou-ui-agent.acceptance-bundle.v1","createdAt":"${started_at}","bundleDirectory":"${escaped_bundle_dir}","agentId":"${escaped_agent_id}","master":"${escaped_master}","profile":"${escaped_profile}","version":"${escaped_version}","doctorStatus":${doctor_status},"serviceStatus":${service_status},"runtimeSummaryStatus":${runtime_summary_status},"runtimeSummary":"${escaped_runtime_summary}","evidence":{"doctorLog":${doctor_file_manifest},"serviceStatus":${service_status_file_manifest},"agentLogTail":${agent_log_tail_file_manifest},"runtimeSummary":${runtime_summary_file_manifest}}}
AGENT_ACCEPTANCE_MANIFEST_EOF
  chmod 600 "${manifest_path}" 2>/dev/null || true

  printf 'Agent 验收证据包: %s\n' "${bundle_dir}"
  printf '  doctor: %s\n' "${doctor_log}"
  printf '  service status: %s\n' "${service_status_log}"
  printf '  agent log tail: %s\n' "${agent_log_tail}"
  printf '  runtime summary: %s\n' "${runtime_summary}"
  printf '  manifest: %s\n' "${manifest_path}"

  if (( doctor_status != 0 || service_status != 0 || runtime_summary_status != 0 )); then
    printf '[%s] Agent 验收证据包已生成，但检查未全部通过：doctor=%s service=%s runtimeSummary=%s\n' "${APP_NAME}" "${doctor_status}" "${service_status}" "${runtime_summary_status}" >&2
    return 1
  fi

  log "Agent 验收证据包生成完成。"
}

verify_agent_acceptance() {
  local input_path="" manifest_path arg python_bin
  local require_runtime_evidence=0

  while (($# > 0)); do
    arg="$1"
    case "${arg}" in
      --require-runtime-evidence)
        require_runtime_evidence=1
        shift
        ;;
      --)
        shift
        ;;
      -*)
        fail "acceptance-verify 不支持参数 ${arg}；可用 --require-runtime-evidence。"
        ;;
      *)
        [[ -z "${input_path}" ]] || fail "acceptance-verify 只接受一个 Agent 证据包目录或 manifest.json 路径。"
        input_path="$1"
        shift
        ;;
    esac
  done

  [[ -n "${input_path}" ]] || fail "acceptance-verify 需要一个 Agent 证据包目录或 manifest.json 路径。"

  if [[ -d "${input_path}" ]]; then
    manifest_path="${input_path%/}/manifest.json"
  else
    manifest_path="${input_path}"
  fi

  [[ -f "${manifest_path}" ]] || fail "未找到 Agent 验收证据 manifest：${manifest_path}"

  python_bin="$(command -v python3 2>/dev/null || command -v python 2>/dev/null || true)"
  [[ -n "${python_bin}" ]] || fail "Agent 验收证据校验需要 python3 或 python。"

  "${python_bin}" - "${manifest_path}" "${require_runtime_evidence}" <<'PY'
import hashlib
import json
import os
import sys
from pathlib import Path

manifest_path = Path(sys.argv[1]).resolve()
require_runtime_evidence = len(sys.argv) > 2 and sys.argv[2] == "1"


def fail(message):
    sys.stderr.write(f"[OU-UI Agent] {message}\n")
    raise SystemExit(1)


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_evidence_json(bundle_directory, file_name, label):
    path = bundle_directory / file_name
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        fail(f"无法读取或解析 {label}：{path}")


def find_module(summary, module_kind):
    modules = summary.get("modules")
    if not isinstance(modules, list):
        return None
    for module in modules:
        if isinstance(module, dict) and module.get("moduleKind") == module_kind:
            return module
    return None


def read_int(value):
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


def has_parse_errors(summary):
    for module in summary.get("modules", []):
        if isinstance(module, dict) and module.get("parseError"):
            return True
    guardrails = summary.get("guardrails")
    if isinstance(guardrails, dict):
        for value in guardrails.values():
            if isinstance(value, dict) and value.get("parseError"):
                return True
    return False


def validate_runtime_summary(summary):
    failures = []

    if summary.get("schemaVersion") != "ou-ui-agent.runtime-summary.v1":
        failures.append("runtime-summary.json schemaVersion 不匹配")
    if summary.get("status") != "ok":
        failures.append(f"runtime-summary.json status={summary.get('status') or 'missing'}")
    if has_parse_errors(summary):
        failures.append("runtime-summary.json 存在 runtime/guardrail parseError")

    xray = find_module(summary, "xray")
    if not isinstance(xray, dict) or xray.get("present") is not True:
        failures.append("缺少 xray runtime 模块证据")
    else:
        if xray.get("runtime") != "running":
            failures.append(f"xray runtime={xray.get('runtime') or 'missing'}")
        if read_int(xray.get("inboundCount")) < 1:
            failures.append("xray inboundCount 小于 1")

    port_forwarding = find_module(summary, "port-forwarding")
    if not isinstance(port_forwarding, dict) or port_forwarding.get("present") is not True:
        failures.append("缺少 port-forwarding runtime 模块证据")
    else:
        if port_forwarding.get("runtime") != "running":
            failures.append(f"port-forwarding runtime={port_forwarding.get('runtime') or 'missing'}")
        if read_int(port_forwarding.get("serviceCount")) < 1:
            failures.append("port-forwarding serviceCount 小于 1")

    pending_events = summary.get("pendingEvents")
    if isinstance(pending_events, dict) and read_int(pending_events.get("count")) > 0:
        failures.append(f"pendingEvents.count={pending_events.get('count')}")

    guardrails = summary.get("guardrails")
    if isinstance(guardrails, dict):
        host = guardrails.get("host")
        if isinstance(host, dict):
            for key in ["quotaExceeded", "hostExpired", "runtimeDisabledByPolicy"]:
                if host.get(key) is True:
                    failures.append(f"host guardrail {key}=true")
        for key in ["portForwarding", "xrayClients"]:
            value = guardrails.get(key)
            if isinstance(value, dict) and read_int(value.get("enforcementErrorCount")) > 0:
                failures.append(f"{key} enforcementErrorCount={value.get('enforcementErrorCount')}")

    return failures


try:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
except Exception:
    fail(f"无法读取或解析 manifest：{manifest_path}")

if manifest.get("schemaVersion") != "ou-ui-agent.acceptance-bundle.v1":
    fail(f"manifest schemaVersion 不匹配：{manifest.get('schemaVersion') or 'missing'}")

evidence = manifest.get("evidence")
if not isinstance(evidence, dict):
    fail("manifest 缺少 evidence 对象，无法校验证据文件完整性。")

required_files = {
    "doctorLog": "doctor.txt",
    "serviceStatus": "service-status.txt",
    "agentLogTail": "agent-log-tail.txt",
}
optional_files = {
    "runtimeSummary": "runtime-summary.json",
}
expected_files = dict(required_files)
for key, file_name in optional_files.items():
    if key in evidence or key in manifest:
        expected_files[key] = file_name

bundle_directory = manifest_path.parent

print(f"Agent 验收证据 manifest: {manifest_path}")
print(
    "原始检查状态: "
    f"doctor={manifest.get('doctorStatus', 'unknown')} "
    f"service={manifest.get('serviceStatus', 'unknown')} "
    f"runtimeSummary={manifest.get('runtimeSummaryStatus', 'not-recorded')}"
)

for key, file_name in expected_files.items():
    entry = evidence.get(key)
    if not isinstance(entry, dict):
        fail(f"manifest 缺少 evidence.{key}")

    entry_path = entry.get("path")
    if not isinstance(entry_path, str) or os.path.basename(entry_path) != file_name:
        fail(f"evidence.{key}.path 文件名必须是 {file_name}")

    evidence_path = bundle_directory / file_name
    exists = evidence_path.exists()

    if entry.get("missing") is True:
        if exists:
            fail(f"evidence.{key} 标记 missing，但当前证据包内存在 {file_name}")
        print(f"[OK] {key}: missing")
        continue

    if not exists:
        fail(f"证据文件不存在：{evidence_path}")
    if not evidence_path.is_file():
        fail(f"证据路径不是普通文件：{evidence_path}")

    size = entry.get("sizeBytes")
    expected_sha = entry.get("sha256")
    if not isinstance(size, int) or size < 0:
        fail(f"evidence.{key}.sizeBytes 无效")
    if not isinstance(expected_sha, str) or not len(expected_sha) == 64 or any(ch not in "0123456789abcdefABCDEF" for ch in expected_sha):
        fail(f"evidence.{key}.sha256 无效")

    actual_size = evidence_path.stat().st_size
    actual_sha = sha256_file(evidence_path)
    expected_sha = expected_sha.lower()

    if actual_size != size:
        fail(f"{key} 大小不匹配：manifest={size} actual={actual_size}")
    if actual_sha != expected_sha:
        fail(f"{key} SHA-256 不匹配：manifest={expected_sha} actual={actual_sha}")

    print(f"[OK] {key}: {file_name} {actual_size} bytes {actual_sha}")

if require_runtime_evidence:
    if manifest.get("serviceStatus") != 0:
        fail(f"要求 Agent runtime 现场证据，但 manifest.serviceStatus={manifest.get('serviceStatus', 'not-recorded')}")
    if manifest.get("runtimeSummaryStatus") != 0:
        fail(
            "要求 Agent runtime 现场证据，但 "
            f"manifest.runtimeSummaryStatus={manifest.get('runtimeSummaryStatus', 'not-recorded')}"
        )
    if "runtimeSummary" not in evidence:
        fail("要求 Agent runtime 现场证据，但 manifest 缺少 runtimeSummary evidence。")

    runtime_summary = read_evidence_json(bundle_directory, "runtime-summary.json", "runtime-summary.json")
    runtime_failures = validate_runtime_summary(runtime_summary)
    if runtime_failures:
        fail(f"Agent runtime 现场证据门槛未通过：{'; '.join(runtime_failures)}")

    print("[OK] Agent runtime evidence gate: passed")

print("Agent 验收证据包完整性校验通过。")
PY
}

write_agent_final_acceptance_summary() {
  local summary_path="$1"
  local status="$2"
  local manifest_path="$3"
  local verify_log_path="$4"
  local created_at escaped_bundle_dir escaped_status manifest_file_manifest verify_log_file_manifest

  created_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  escaped_bundle_dir="$(json_escape_string "${AGENT_ACCEPTANCE_LAST_BUNDLE_DIR:-}")"
  escaped_status="$(json_escape_string "${status}")"
  manifest_file_manifest="$(agent_acceptance_file_manifest_json "${manifest_path}")"
  verify_log_file_manifest="$(agent_acceptance_file_manifest_json "${verify_log_path}")"

  cat >"${summary_path}" <<AGENT_FINAL_ACCEPTANCE_SUMMARY_EOF
{"schemaVersion":"ou-ui-agent.final-acceptance-summary.v1","status":"${escaped_status}","createdAt":"${created_at}","bundleDirectory":"${escaped_bundle_dir}","strictGates":{"runtimeEvidence":true},"manifest":${manifest_file_manifest},"finalVerifyLog":${verify_log_file_manifest}}
AGENT_FINAL_ACCEPTANCE_SUMMARY_EOF
  chmod 600 "${summary_path}" 2>/dev/null || true
}

run_agent_final_acceptance() {
  local acceptance_status final_summary_path final_verify_log manifest_path verify_status

  require_root

  AGENT_ACCEPTANCE_LAST_BUNDLE_DIR=""

  acceptance_status=0
  run_agent_acceptance || acceptance_status=$?
  if (( acceptance_status != 0 )); then
    return "${acceptance_status}"
  fi

  [[ -n "${AGENT_ACCEPTANCE_LAST_BUNDLE_DIR:-}" ]] || fail "Agent 最终验收无法确认证据包路径。"
  manifest_path="${AGENT_ACCEPTANCE_LAST_BUNDLE_DIR}/manifest.json"
  final_verify_log="${AGENT_ACCEPTANCE_LAST_BUNDLE_DIR}/final-acceptance-verify.txt"
  final_summary_path="${AGENT_ACCEPTANCE_LAST_BUNDLE_DIR}/final-acceptance-summary.json"

  if verify_agent_acceptance --require-runtime-evidence "${AGENT_ACCEPTANCE_LAST_BUNDLE_DIR}" >"${final_verify_log}" 2>&1; then
    chmod 600 "${final_verify_log}" 2>/dev/null || true
    write_agent_final_acceptance_summary "${final_summary_path}" "passed" "${manifest_path}" "${final_verify_log}"
    cat "${final_verify_log}"
    printf 'Agent 最终现场验收校验记录: %s\n' "${final_verify_log}"
    printf 'Agent 最终现场验收摘要: %s\n' "${final_summary_path}"
  else
    verify_status=$?
    chmod 600 "${final_verify_log}" 2>/dev/null || true
    write_agent_final_acceptance_summary "${final_summary_path}" "failed" "${manifest_path}" "${final_verify_log}"
    cat "${final_verify_log}" >&2 || true
    printf '[%s] Agent 最终现场验收严格校验失败，校验记录已保存：%s\n' "${APP_NAME}" "${final_verify_log}" >&2
    printf '[%s] Agent 最终现场验收摘要已保存：%s\n' "${APP_NAME}" "${final_summary_path}" >&2
    return "${verify_status}"
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
  7) 运行 Agent 本机诊断
  8) 生成 Agent 验收证据包
  9) 校验 Agent 验收证据包
  10) 运行 Agent 最终现场验收
  0) 退出
EOT
    echo "Shortcuts: i=info s=status l=logs r=restart u=update d=doctor qa=evidence qv=verify qf=final x=uninstall"
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
      7|d|D|doctor|DOCTOR) show_doctor ;;
      8|qa|QA|acceptance|ACCEPTANCE|evidence|EVIDENCE) run_agent_acceptance ;;
      9|qv|QV|acceptance-verify|ACCEPTANCE-VERIFY|qa-verify|QA-VERIFY|evidence-verify|EVIDENCE-VERIFY)
        read -r -p "请输入 Agent 证据包目录或 manifest.json 路径：" agent_acceptance_path
        verify_agent_acceptance "${agent_acceptance_path}"
        ;;
      10|qf|QF|final-acceptance|FINAL-ACCEPTANCE|acceptance-final|ACCEPTANCE-FINAL|field-acceptance|FIELD-ACCEPTANCE) run_agent_final_acceptance ;;
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
  doctor|diagnose|d)
    show_doctor
    ;;
  acceptance|qa|evidence|evidence-bundle)
    run_agent_acceptance
    ;;
  acceptance-verify|qa-verify|qv|evidence-verify)
    verify_agent_acceptance "${@:2}"
    ;;
  final-acceptance|acceptance-final|field-acceptance|qf)
    run_agent_final_acceptance
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
  doctor     运行本机诊断，不输出 Agent token
  acceptance 生成 Agent 验收证据包，包含 doctor、服务状态、脱敏日志尾部、脱敏 runtime 摘要和 SHA-256 manifest
  acceptance-verify 校验 Agent 验收证据包 manifest 中记录的文件大小和 SHA-256；追加 --require-runtime-evidence 可强制校验 runtime-summary.json 中的 Xray/端口转发现场证据
  final-acceptance 生成 Agent 验收证据包并立即执行严格 runtime qv 校验，保存 final-acceptance-verify.txt 和 final-acceptance-summary.json
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
