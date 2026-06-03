import { readFileSync } from 'node:fs';
import { AGENT_INSTALL_PROFILE, composeAgentInstallCommand } from './agent-install';

describe('agent install command', () => {
  it('keeps one-click installation focused on host enrollment only', () => {
    const command = composeAgentInstallCommand({
      hostName: 'edge-hkg-01',
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
    expect(script).toContain('install_gost_runtime');
    expect(script).toContain('def gost_forward_url');
    expect(script).toContain('def forwarding_runtime_args');
    expect(script).toContain('limiter.in');
    expect(script).toContain('GOST is required for rate-limited port forwarding');
    expect(script).toContain('nftables');
    expect(script).toContain('def configure_forwarding_counters');
    expect(script).toContain('def collect_forwarding_counters');
    expect(script).toContain('forwardingCounters');
    expect(script).toContain('trafficCounterRuntime');
    expect(script).toContain('ou-ui-xray.service');
    expect(script).toContain('socat');
    expect(script).not.toContain('require_env OU_HOST_NAME');
    expect(script).not.toContain('require_env OU_INSTALL_PROFILE');
    expect(script).not.toContain('/opt/ou-ui-agent/bin/ou-agent-executor.py');
    expect(script).not.toMatch(/OU_CUSTOMER_NODE|OU_CUSTOMER_NAME|OU_REMAINING_DAYS/);
  });
});
