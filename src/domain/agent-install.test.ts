import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, vi } from 'vitest';
import { AGENT_INSTALL_PROFILE, composeAgentInstallCommand, composeAgentUpgradeCommand } from './agent-install';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function readEmbeddedAgentExecutor() {
  const script = readFileSync('public/install/ou-agent.sh', 'utf8');
  const match = script.match(/cat >"\$\{INSTALL_ROOT\}\/bin\/ou-agent-executor\.py" <<'PY'\n([\s\S]*?)\nPY\n/);

  if (!match) {
    throw new Error('Unable to locate embedded Agent executor in installer.');
  }

  return match[1].replace(/\nif __name__ == "__main__":\n {4}main\(\)\n?$/, '');
}

function runEmbeddedAgentExecutorSnippet(snippet: string) {
  const directory = mkdtempSync(join(tmpdir(), 'ou-agent-executor-test-'));
  const scriptPath = join(directory, 'snippet.py');

  try {
    writeFileSync(scriptPath, `${readEmbeddedAgentExecutor()}\n${snippet}`, 'utf8');

    return execFileSync(process.env.PYTHON ?? 'python3', [scriptPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('agent install command', () => {
  it('keeps one-click installation focused on host enrollment only', () => {
    const command = composeAgentInstallCommand({
      installProfile: [...AGENT_INSTALL_PROFILE],
      publicBaseUrl: 'https://panel.example.com/x7K2mP9vL4qR1wDz'
    });

    expect(command.command).toContain(
      "curl -fsSL 'https://raw.githubusercontent.com/cshaizhihao/ou-ui-next/main/public/install/ou-agent.sh'"
    );
    expect(command.agentId).toMatch(/^agent-[a-f0-9]{12}$/);
    expect(command.command).toContain("OU_MASTER='https://panel.example.com/x7K2mP9vL4qR1wDz/agent/v1/poll'");
    expect(command.command).toContain(`OU_AGENT_ID='${command.agentId}'`);
    expect(command.command).toContain(`OU_INSTALL_TOKEN='${command.installToken}'`);
    expect(command.command).not.toContain('OU_INSTALL_PROFILE=');
    expect(command.command).not.toContain('OU_HOST_NAME=');
    expect(command.command).not.toMatch(/OU_CUSTOMER|OU_REMAINING/);
  });

  it('composes runtime upgrade commands without re-registering or exposing Agent tokens', () => {
    const command = composeAgentUpgradeCommand(
      {
        agentId: 'agent-poll-only-01',
        reason: 'no_telemetry_sample'
      },
      {
        issuedAt: '2026-06-07T10:00:00.000Z'
      }
    );

    expect(command).toMatchObject({
      agentId: 'agent-poll-only-01',
      issuedAt: '2026-06-07T10:00:00.000Z',
      mode: 'update-runtime',
      requiresExistingRuntimeCredential: true,
      scriptUrl: 'https://raw.githubusercontent.com/cshaizhihao/ou-ui-next/main/public/install/ou-agent.sh'
    });
    expect(command.command).toContain('OU_AGENT_SUDO');
    expect(command.command).toContain('id -u');
    expect(command.command).toContain('ou-agent update');
    expect(command.command).toContain('OU_AGENT_UPDATE_MODE=1');
    expect(command.command).not.toContain('OU_INSTALL_TOKEN=');
    expect(command.command).not.toContain('OU_AGENT_TOKEN=');
    expect(command.command).not.toContain('/agent/v1/register');
  });

  it('fails closed instead of using weak randomness for Agent credentials', () => {
    vi.stubGlobal('crypto', undefined);
    vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random must not be used for Agent credentials');
    });

    expect(() =>
      composeAgentInstallCommand({
        installProfile: [...AGENT_INSTALL_PROFILE],
        publicBaseUrl: 'https://panel.example.com/x7K2mP9vL4qR1wDz'
      })
    ).toThrow('A secure random number generator is required to create Agent credentials.');
  });

  it('keeps the GitHub installer portable across custom install directories', () => {
    const script = readFileSync('public/install/ou-agent.sh', 'utf8');

    expect(script).toContain('OU_AGENT_EXECUTOR_PATH=${INSTALL_ROOT}/bin/ou-agent-executor.py');
    expect(script).toContain('OU_AGENT_CONFIG_DIR=${CONFIG_DIR}');
    expect(script).toContain('OU_AGENT_PYTHON_BIN=${OU_AGENT_PYTHON_BIN:-${python_bin}}');
    expect(script).toContain('OU_AGENT_INSTALL_SCRIPT_URL=${DEFAULT_AGENT_SCRIPT_URL}');
    expect(script).toContain('OU_INSTALL_PROFILE="${OU_INSTALL_PROFILE:-host-agent,xray,port-forwarding,telemetry,command-channel}"');
    expect(script).toContain('if ! "\\${OU_AGENT_PYTHON_BIN}" "\\${OU_AGENT_EXECUTOR_PATH}"');
    expect(script).toContain('def apply_xray_artifact');
    expect(script).toContain('def apply_forwarding_artifact');
    expect(script).toContain('def create_local_snapshot');
    expect(script).toContain('def restore_local_snapshot');
    expect(script).toContain('def test_xray_config');
    expect(script).toContain('def probe_xray_stats_api');
    expect(script).toContain('def xray_api_health_check');
    expect(script).toContain('xray_stats_api_unavailable');
    expect(script).toContain('def assert_port_available');
    expect(script).toContain('def update_monthly_traffic_baseline');
    expect(script).toContain('def calculate_accounted_traffic');
    expect(script).toContain('def evaluate_host_guardrails');
    expect(script).toContain('def enforce_host_guardrails');
    expect(script).toContain('def restore_host_guardrail_units');
    expect(script).toContain('def forwarding_rule_billed_bytes');
    expect(script).toContain('def enforce_forwarding_rule_guardrails');
    expect(script).toContain('rule_monthly_quota_exceeded');
    expect(script).toContain('port-forwarding-guardrails.json');
    expect(script).toContain('monthlyTrafficLimitBytes');
    expect(script).toContain('runtimeDisabledByPolicy');
    expect(script).toContain('monthly_traffic_quota_exceeded');
    expect(script).toContain('hostGuardrailStoppedUnits');
    expect(script).toContain('hostGuardrailRestoredUnits');
    expect(script).toContain('def read_telemetry_plan');
    expect(script).toContain('def read_telemetry_interval_seconds');
    expect(script).toContain('def read_latency_thresholds');
    expect(script).toContain('def classify_latency_status');
    expect(script).toContain('latencyGreenMaxMs');
    expect(script).toContain('latencyYellowMaxMs');
    expect(script).toContain('"latencyStatus"');
    expect(script).toContain('telemetry_plan.get("trafficCounters"');
    expect(script).toContain('telemetry_plan.get("pingProbe"');
    expect(script).toContain('return max(1, min(31, day))');
    expect(script).toContain('install_gost_runtime');
    expect(script).toContain('def gost_forward_url');
    expect(script).toContain('def gost_rate_limiter_query');
    expect(script).toContain('def forwarding_runtime_args');
    expect(script).toContain('def forwarding_rule_service_entries');
    expect(script).toContain('def probe_forwarding_listener');
    expect(script).toContain('forwarding_listener_unavailable');
    expect(script).toContain('def assert_supported_forwarding_controls');
    expect(script).toContain('unsupported port-forwarding runtime controls');
    expect(script).toContain('limiter.in');
    expect(script).toContain('limiter.out');
    expect(script).toContain('GOST is required for rate-limited port forwarding');
    expect(script).toContain('nftables');
    expect(script).toContain('def configure_forwarding_counters');
    expect(script).toContain('def collect_forwarding_counters');
    expect(script).toContain('forwardingCounters');
    expect(script).toContain('forwardingGuardrails');
    expect(script).toContain('trafficCounterRuntime');
    expect(script).toContain('def pending_events_path');
    expect(script).toContain('def flush_pending_events');
    expect(script).toContain('OU_AGENT_MAX_PENDING_EVENTS=${OU_AGENT_MAX_PENDING_EVENTS:-1000}');
    expect(script).toContain('OU_AGENT_LOG_MAX_BYTES=${OU_AGENT_LOG_MAX_BYTES:-5242880}');
    expect(script).toContain('OU_AGENT_LOG_BACKUP_COUNT=${OU_AGENT_LOG_BACKUP_COUNT:-3}');
    expect(script).toContain('OU_AGENT_COMMAND_LOG_MAX_CHUNKS=${OU_AGENT_COMMAND_LOG_MAX_CHUNKS:-20}');
    expect(script).toContain('def trim_pending_events(events, limit):');
    expect(script).toContain('def pending_event_drop_rank(event):');
    expect(script).toContain('def send_command_log_chunks(state_dir, master_poll_url, token, command, minimum_seq, payload):');
    expect(script).toContain('COMMAND_LOG_CHUNK_MAX_CHARS = 60_000');
    expect(script).toContain('record_command_log("stdout", result.stdout)');
    expect(script).toContain('record_command_log("stderr", result.stderr)');
    expect(script).toContain('if event_type in ("heartbeat", "telemetry_sample"):');
    expect(script).toContain('if event_type == "result":');
    expect(script).toContain('read_positive_int_env("OU_AGENT_MAX_PENDING_EVENTS", 1000');
    expect(script).toContain('pruned {dropped} pending Agent events after queue reached max={max_events}');
    expect(script).toContain('def rotate_agent_log_file(log_path):');
    expect(script).toContain('read_positive_int_env("OU_AGENT_LOG_MAX_BYTES", 5 * 1024 * 1024');
    expect(script).toContain('rotate_agent_log()');
    expect(script).toContain('src="\\${log_file}.\\$((idx - 1))"');
    expect(script).toContain('OU_AGENT_MAX_PENDING_EVENTS');
    expect(script).toContain('OU_AGENT_LOG_BACKUP_COUNT');
    expect(script).toContain('"agent_event.command_task_mismatch"');
    expect(script).toContain('def send_event_or_queue');
    expect(script).toContain('def next_event_seq(state_dir, minimum=0)');
    expect(script).toContain('build_command_event(state_dir, command, "ack"');
    expect(script).toContain('queue_on_failure=True');
    expect(script).toContain('result event queued for retry');
    expect(script).toContain('flush_pending_events(state_dir, master, token)');
    expect(script).toContain('def write_next_poll_interval');
    expect(script).toContain('next-poll-after-seconds');
    expect(script).toContain('dynamic_poll_interval_file');
    expect(script).toContain('ou-ui-xray.service');
    expect(script).toContain('socat');
    expect(script).toContain('do_update()');
    expect(script).toContain('OU_AGENT_UPDATE_MODE=1');
    expect(script).toContain('update_existing_agent_runtime()');
    expect(script).toContain('require_env OU_AGENT_TOKEN');
    expect(script).toContain('update|upgrade|u)');
    expect(script).toContain('Agent runtime updated from GitHub without re-registering or consuming an install token.');
    expect(script).toContain('update     从 GitHub 更新 Agent 运行时，不重新注册、不消耗安装 Token');
    expect(script).not.toContain('OU_HOST_NAME=');
    expect(script).not.toContain('require_env OU_HOST_NAME');
    expect(script).not.toContain('require_env OU_INSTALL_PROFILE');
    expect(script).not.toContain('Agent update requires a fresh one-click install command');
    expect(script).not.toContain('/opt/ou-ui-agent/bin/ou-agent-executor.py');
    expect(script).not.toMatch(/OU_CUSTOMER_NODE|OU_CUSTOMER_NAME|OU_REMAINING_DAYS/);
  });

  it('maps one-way and bi-directional forwarding rate limits to GOST limiter directions', () => {
    expect(
      runEmbeddedAgentExecutorSnippet(`
assert gost_rate_limiter_query(0, "bi-directional", "both") == {}
assert gost_rate_limiter_query(600, "bi-directional", "both") == {"limiter.in": "75000KB", "limiter.out": "75000KB"}
assert gost_rate_limiter_query(600, "one-way", "ingress") == {"limiter.in": "75000KB"}
assert gost_rate_limiter_query(600, "one-way", "egress") == {"limiter.out": "75000KB"}
print("ok")
`)
    ).toBe('ok\n');
  });

  it('keeps Agent result payloads and nft counter rules compatible with backend contracts', () => {
    expect(
      runEmbeddedAgentExecutorSnippet(`
import io
import urllib.error

payload = normalize_result_payload({"status": "failed", "failureReason": "x" * 700})
assert len(payload["failureReason"]) == 500
assert payload["failureReason"] == "x" * 500
assert bounded_failure_reason("", "fallback failed") == "fallback failed"

validation_error = urllib.error.HTTPError(
    "https://master.example.test/agent/v1/events",
    422,
    "Unprocessable Entity",
    {},
    io.BytesIO(b'{"error":{"code":"validation_error"}}'),
)
assert is_non_retryable_agent_event_error(validation_error) is True

calls = []

def fake_nft_exec(args, check=True):
    calls.append(args)

nft_exec = fake_nft_exec
add_forwarding_counter_rule("ou_ingress", "ou-forward-acme", "ingress", "tcp", [], 25102)
assert calls[0][-2:] == ["comment", '"ou-ui:ou-forward-acme:ingress:tcp"']
print("ok")
`)
    ).toBe('ok\n');
  });

  it('merges same-protocol Xray customers on one port while retaining independent client profiles', () => {
    expect(
      runEmbeddedAgentExecutorSnippet(`
import tempfile
from pathlib import Path

root = Path(tempfile.mkdtemp())
config_root = root / "config"
inbound_root = config_root / "xray" / "inbounds.d"
profile_root = config_root / "xray" / "profiles.d"
inbound_root.mkdir(parents=True, exist_ok=True)
profile_root.mkdir(parents=True, exist_ok=True)
os.environ["OU_AGENT_CONFIG_DIR"] = str(config_root)

stream_settings = {
    "network": "tcp",
    "security": "tls",
    "tlsSettings": {"serverName": "edge.example.com", "alpn": ["h2", "http/1.1"]},
}

write_json(inbound_root / "ou-customer-a.json", {
    "tag": "ou-customer-a",
    "listen": "0.0.0.0",
    "port": 24567,
    "protocol": "vless",
    "settings": {
        "clients": [{"id": "11111111-1111-4111-a111-111111111111", "email": "alice@example.com", "level": 0}],
        "decryption": "none",
        "fallbacks": [],
    },
    "streamSettings": stream_settings,
    "sniffing": {"enabled": True, "destOverride": ["http", "tls", "quic"]},
})
write_json(inbound_root / "ou-customer-b.json", {
    "tag": "ou-customer-b",
    "listen": "0.0.0.0",
    "port": 24567,
    "protocol": "vless",
    "settings": {
        "clients": [{"id": "22222222-2222-4222-a222-222222222222", "email": "bob@example.com", "level": 0}],
        "decryption": "none",
        "fallbacks": [],
    },
    "streamSettings": stream_settings,
    "sniffing": {"enabled": True, "destOverride": ["http", "tls", "quic"]},
})
write_json(profile_root / "ou-customer-a.json", {
    "targetId": "customer-node-a",
    "inboundTag": "ou-customer-a",
    "clientPolicy": {"clientEmail": "alice@example.com", "trafficLimitBytes": 1000, "expiresAt": "2026-12-31T00:00:00.000Z"},
})
write_json(profile_root / "ou-customer-b.json", {
    "targetId": "customer-node-b",
    "inboundTag": "ou-customer-b",
    "clientPolicy": {"clientEmail": "bob@example.com", "trafficLimitBytes": 2000, "expiresAt": "2026-11-30T00:00:00.000Z"},
})

inbounds = read_inbound_fragments(inbound_root)
assert len(inbounds) == 1
assert inbounds[0]["port"] == 24567
assert inbounds[0]["protocol"] == "vless"
assert inbounds[0]["tag"] == "ou-customer-a"
emails = [client["email"] for client in inbounds[0]["settings"]["clients"]]
assert emails == ["alice@example.com", "bob@example.com"]

profiles = read_xray_client_profiles()
assert [profile["targetId"] for profile in profiles] == ["customer-node-a", "customer-node-b"]
assert [profile["clientPolicy"]["clientEmail"] for profile in profiles] == ["alice@example.com", "bob@example.com"]
print("ok")
`)
    ).toBe('ok\n');
  });

  it('marks active Xray services unhealthy when the Stats API probe fails', () => {
    expect(
      runEmbeddedAgentExecutorSnippet(`
import tempfile
from pathlib import Path

state_dir = tempfile.mkdtemp()
unit_root = Path(state_dir) / "units"
unit_root.mkdir(parents=True, exist_ok=True)
(unit_root / "ou-ui-xray.service").write_text("[Service]\\n", encoding="utf-8")

class Result:
    def __init__(self, returncode=0, stdout="", stderr=""):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr

def fake_systemctl(state_dir, *args, check=True):
    if args[0] == "is-active":
        return Result(0, "active\\n", "")
    if args[0] == "is-enabled":
        return Result(0, "enabled\\n", "")
    return Result(0, "", "")

def fake_which(name):
    if name == "systemctl":
        return "/bin/systemctl"
    if name == "xray":
        return "/usr/local/bin/xray"
    return None

def fake_run_command(state_dir, args, timeout=0, check=True):
    return Result(1, "", "stats api refused")

systemd_unit_dir = lambda: unit_root
systemctl = fake_systemctl
service_active = lambda state_dir, unit: True
shutil.which = fake_which
run_command = fake_run_command

service = read_runtime_service_health(
    state_dir,
    {"name": "ou-ui-xray.service", "moduleKind": "xray", "required": True},
    "2026-06-06T00:00:00.000Z",
)
assert service["status"] == "unknown"
assert service["required"] is True
assert "xray_stats_api_unavailable" in service["detail"]

result = health_command(state_dir, {"payload": {"checks": ["xray"]}})
assert result["succeeded"] is False
assert any(item["name"] == "xray-api" and item["status"] == "failed" for item in result["healthSummary"]["checks"])
assert "xray-api:xray_stats_api_unavailable" in result["failureReason"]
print("ok")
`)
    ).toBe('ok\n');
  });

  it('marks active TCP forwarding services unhealthy when the listener probe fails', () => {
    expect(
      runEmbeddedAgentExecutorSnippet(`
import tempfile
from pathlib import Path

state_dir = tempfile.mkdtemp()
config_root = Path(state_dir) / "config"
unit_root = Path(state_dir) / "units"
(config_root / "port-forwarding" / "rules.d").mkdir(parents=True, exist_ok=True)
unit_root.mkdir(parents=True, exist_ok=True)
os.environ["OU_AGENT_CONFIG_DIR"] = str(config_root)

artifact = {
    "targetId": "forward-acme",
    "servicePlan": {"serviceName": "ou-forward-acme"},
    "rule": {
        "enabled": True,
        "binding": {
            "protocol": "tcp",
            "listenAddress": "0.0.0.0",
            "listenPort": 15432,
            "targetAddress": "127.0.0.1",
            "targetPort": 443,
        },
    },
}
write_json(config_root / "port-forwarding" / "rules.d" / "ou-forward-acme.json", artifact)
(unit_root / "ou-forward-acme-tcp.service").write_text("[Service]\\n", encoding="utf-8")

udp_artifact = {
    "targetId": "forward-dns",
    "servicePlan": {"serviceName": "ou-forward-dns"},
    "rule": {
        "enabled": True,
        "binding": {
            "protocol": "udp",
            "listenAddress": "0.0.0.0",
            "listenPort": 15353,
            "targetAddress": "127.0.0.1",
            "targetPort": 53,
        },
    },
}
write_json(config_root / "port-forwarding" / "rules.d" / "ou-forward-dns.json", udp_artifact)
(unit_root / "ou-forward-dns-udp.service").write_text("[Service]\\n", encoding="utf-8")

(Path(state_dir) / "runtime").mkdir(parents=True, exist_ok=True)
write_json(Path(state_dir) / "runtime" / "port-forwarding.json", {"services": ["ou-forward-legacy-tcp.service"]})
(unit_root / "ou-forward-legacy-tcp.service").write_text("[Service]\\n", encoding="utf-8")

class Result:
    def __init__(self, returncode=0, stdout="", stderr=""):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr

class Connection:
    def close(self):
        pass

def fake_systemctl(state_dir, *args, check=True):
    if args[0] == "is-active":
        return Result(0, "active\\n", "")
    if args[0] == "is-enabled":
        return Result(0, "enabled\\n", "")
    return Result(0, "", "")

def fake_which(name):
    return "/bin/systemctl" if name == "systemctl" else None

def failing_connection(address, timeout=0):
    raise OSError("connection refused")

systemd_unit_dir = lambda: unit_root
systemctl = fake_systemctl
service_active = lambda state_dir, unit: True
shutil.which = fake_which
socket.create_connection = failing_connection

entries = expected_runtime_service_units(state_dir)
forwarding = next(item for item in entries if item["name"] == "ou-forward-acme-tcp.service")
assert forwarding["listener"] == {"protocol": "tcp", "host": "127.0.0.1", "port": 15432}

service = read_runtime_service_health(state_dir, forwarding, "2026-06-06T00:00:00.000Z")
assert service["status"] == "unknown"
assert service["required"] is True
assert "forwarding_listener_unavailable" in service["detail"]

result = health_command(state_dir, {"payload": {"checks": ["port-forwarding"]}})
checks = result["healthSummary"]["checks"]
assert result["succeeded"] is False
assert any(item["reason"] == "forwarding_listener_unavailable" for item in checks)
assert any(item["unit"] == "ou-forward-dns-udp.service" and item["status"] == "passed" and "listener" not in item for item in checks)
assert any(item["unit"] == "ou-forward-legacy-tcp.service" and item["status"] == "passed" for item in checks)
assert "port-forwarding:forwarding_listener_unavailable" in result["failureReason"]
print("ok")
`)
    ).toBe('ok\n');
  });
});
