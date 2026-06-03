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
    expect(script).toContain('OU_AGENT_PYTHON_BIN=${OU_AGENT_PYTHON_BIN:-${python_bin}}');
    expect(script).toContain('OU_INSTALL_PROFILE="${OU_INSTALL_PROFILE:-host-agent,xray,port-forwarding,telemetry,command-channel}"');
    expect(script).toContain('if ! "\\${OU_AGENT_PYTHON_BIN}" "\\${OU_AGENT_EXECUTOR_PATH}"');
    expect(script).not.toContain('require_env OU_HOST_NAME');
    expect(script).not.toContain('require_env OU_INSTALL_PROFILE');
    expect(script).not.toContain('/opt/ou-ui-agent/bin/ou-agent-executor.py');
    expect(script).not.toMatch(/OU_CUSTOMER_NODE|OU_CUSTOMER_NAME|OU_REMAINING_DAYS/);
  });
});
