import { readFileSync } from 'node:fs';
import { AGENT_INSTALL_PROFILE, composeAgentInstallCommand } from './agent-install';

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
    expect(script).toContain('def assert_port_available');
    expect(script).toContain('def update_monthly_traffic_baseline');
    expect(script).toContain('def calculate_accounted_traffic');
    expect(script).toContain('def evaluate_host_guardrails');
    expect(script).toContain('def enforce_host_guardrails');
    expect(script).toContain('def forwarding_rule_billed_bytes');
    expect(script).toContain('def enforce_forwarding_rule_guardrails');
    expect(script).toContain('rule_monthly_quota_exceeded');
    expect(script).toContain('port-forwarding-guardrails.json');
    expect(script).toContain('monthlyTrafficLimitBytes');
    expect(script).toContain('runtimeDisabledByPolicy');
    expect(script).toContain('monthly_traffic_quota_exceeded');
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
    expect(script).toContain('def forwarding_runtime_args');
    expect(script).toContain('def assert_supported_forwarding_controls');
    expect(script).toContain('unsupported port-forwarding runtime controls');
    expect(script).toContain('limiter.in');
    expect(script).toContain('GOST is required for rate-limited port forwarding');
    expect(script).toContain('nftables');
    expect(script).toContain('def configure_forwarding_counters');
    expect(script).toContain('def collect_forwarding_counters');
    expect(script).toContain('forwardingCounters');
    expect(script).toContain('forwardingGuardrails');
    expect(script).toContain('trafficCounterRuntime');
    expect(script).toContain('def pending_events_path');
    expect(script).toContain('def flush_pending_events');
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
});
