import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, vi } from 'vitest';
import type { Agent, QuotaPolicy, XrayInbound } from '../../domain';
import { NodesPage } from './nodes-page';

const GB = 1024 ** 3;
const UUID_IN_LINK = '[0-9a-f-]{36}';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function createAgent(): Agent {
  return {
    id: 'agent-metered-01',
    name: 'Metered Host',
    status: 'online',
    region: 'custom',
    publicAddress: '198.51.100.30',
    connectionMode: 'pull',
    version: '1.0.0-runtime',
    platform: 'linux/amd64',
    capabilities: ['host-agent', 'xray', 'port-forwarding'],
    maxTrafficBytes: 100 * GB,
    monthlyTrafficLimitBytes: 20 * GB,
    expiresAt: '2026-12-31T23:59:59.000Z',
    probeConfig: {
      pingTarget: '1.1.1.1',
      pingIntervalSeconds: 30,
      latencyGreenMaxMs: 100,
      latencyYellowMaxMs: 200
    },
    trafficPolicy: {
      accountingMode: 'both',
      monthlyResetDay: 7,
      manualUsedTrafficBytes: 5 * GB,
      telemetrySource: 'agent'
    },
    hardware: {},
    lastHeartbeatAt: '2026-06-04T04:00:00.000Z',
    telemetry: {
      cpuPercent: 10,
      cpuCores: 2,
      memoryPercent: 20,
      memoryUsedBytes: 2 * GB,
      memoryTotalBytes: 8 * GB,
      diskUsedBytes: 10 * GB,
      diskTotalBytes: 64 * GB,
      txBytes: 0,
      rxBytes: 0,
      monthlyIngressBytes: 1 * GB,
      monthlyEgressBytes: 2 * GB,
      uploadSpeedBps: 0,
      downloadSpeedBps: 0,
      uploadTotalBytes: 0,
      downloadTotalBytes: 0,
      monthlyTrafficUsedBytes: 0,
      latencyMs: 42,
      latencySamplesMs: [42],
      packetLossPercent: 0,
      packetLossSamplesPercent: [0],
      onlineDays: 1,
      reportedAt: '2026-06-04T04:00:00.000Z'
    }
  };
}

function createInbound(overrides: Partial<XrayInbound> = {}): XrayInbound {
  return {
    id: 'inbound-premium-vless',
    nodeId: 'node-metered-01',
    agentId: 'agent-metered-01',
    customerName: 'Acme Premium',
    serverAddress: '198.51.100.30',
    clientIdentity: 'client-acme-premium',
    remainingDays: 30,
    subscriptionRule: 'premium-hk',
    protocol: 'vless',
    label: 'Acme Premium VLESS',
    listenAddress: '0.0.0.0',
    listenPort: 443,
    status: 'enabled',
    clients: [
      {
        id: 'client-acme-premium',
        email: 'acme-premium@example.com',
        enabled: true,
        trafficLimitBytes: 100 * GB,
        usedTrafficBytes: 12 * GB,
        expiresAt: '2026-12-31T23:59:59.000Z',
        ipLimit: 3
      }
    ],
    streamSettings: {
      network: 'tcp',
      security: 'reality',
      sni: 'acme.example.com',
      fingerprint: 'chrome'
    },
    tls: {
      enabled: false,
      alpn: []
    },
    reality: {
      enabled: true,
      publicKey: 'public-key',
      shortIds: ['a1b2c3d4'],
      serverNames: ['acme.example.com']
    },
    fallbacks: [],
    sniffingEnabled: true,
    configVersion: 'cfg-test-inbound-001',
    ...overrides
  };
}

function createCustomerNodeQuotaPolicy(overrides: Partial<QuotaPolicy> = {}): QuotaPolicy {
  return {
    id: 'customer-node:inbound-premium-vless:client-acme-premium',
    name: 'Acme Premium VLESS quota',
    scope: 'customer-node',
    limitBytes: 100 * GB,
    usedBytes: 12 * GB,
    resetWindow: 'monthly',
    billingDirection: 'both',
    enforcementState: 'disabled_by_quota',
    resourceId: 'inbound-premium-vless:client-acme-premium',
    detail: 'Acme Premium',
    resetDay: 1,
    reportedAt: '2026-06-05T10:10:00.000Z',
    ...overrides
  };
}

function createBetaInbound(overrides: Partial<XrayInbound> = {}): XrayInbound {
  return createInbound({
    id: 'inbound-beta-vless',
    label: 'Beta VLESS Edge',
    customerName: 'Beta Team',
    listenPort: 8443,
    clientIdentity: 'client-beta',
    subscriptionRule: 'beta-hk',
    clients: [
      {
        ...createInbound().clients[0],
        id: 'client-beta',
        email: 'beta@example.com'
      }
    ],
    ...overrides
  });
}

describe('NodesPage', () => {
  it('shows provisioning hosts with registration version, platform, and capabilities before telemetry arrives', () => {
    render(
      <NodesPage
        agents={[
          {
            ...createAgent(),
            id: 'agent-provisioning-01',
            name: 'Provisioning Host',
            status: 'provisioning',
            version: '1.2.3-agent',
            platform: 'linux-x64',
            capabilities: ['host-agent', 'xray', 'port-forwarding'],
            runtimeHostName: 'edge-hkg-01',
            telemetry: {
              ...createAgent().telemetry,
              latencyMs: 0,
              latencySamplesMs: [],
              onlineDays: 0,
              reportedAt: undefined
            }
          }
        ]}
        inbounds={[]}
        language="zh"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    const hostCard = screen.getByRole('heading', { name: 'Provisioning Host' }).closest('article');

    expect(hostCard).not.toBeNull();
    expect(within(hostCard as HTMLElement).getByText('纳管中')).toBeInTheDocument();
    expect(within(hostCard as HTMLElement).getByText('edge-hkg-01')).toBeInTheDocument();
    expect(within(hostCard as HTMLElement).getByText('1.2.3-agent')).toBeInTheDocument();
    expect(within(hostCard as HTMLElement).getByText('linux-x64')).toBeInTheDocument();
    expect(within(hostCard as HTMLElement).getByText('host-agent')).toBeInTheDocument();
    expect(within(hostCard as HTMLElement).getByText('xray')).toBeInTheDocument();
    expect(within(hostCard as HTMLElement).getByText('port-forwarding')).toBeInTheDocument();
    expect(screen.getAllByText('等待 Agent 遥测').length).toBeGreaterThan(0);
  });

  it('normalizes an empty host expiry before saving a poll-only Agent profile', async () => {
    const user = userEvent.setup();
    const onSaveHostConfig = vi.fn();

    render(
      <NodesPage
        agents={[
          {
            ...createAgent(),
            id: 'agent-poll-only-01',
            name: 'Poll Only Host',
            expiresAt: '',
            telemetry: {
              ...createAgent().telemetry,
              reportedAt: undefined
            }
          }
        ]}
        inbounds={[]}
        language="zh"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={onSaveHostConfig}
      />
    );

    await user.click(screen.getByRole('button', { name: '编辑主机' }));
    await user.clear(screen.getByLabelText('主机别名'));
    await user.type(screen.getByLabelText('主机别名'), 'poll-only-renamed');
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(onSaveHostConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-poll-only-01',
          displayName: 'poll-only-renamed',
          expiresAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
        })
      );
    });
  });

  it('offers a copyable runtime upgrade command for poll-only hosts', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    const onPreviewAgentUpgradeCommand = vi.fn().mockResolvedValue({
      agentId: 'agent-poll-only-01',
      command: 'sudo ou-agent update',
      issuedAt: '2026-06-07T10:00:00.000Z',
      mode: 'update-runtime',
      requiresExistingRuntimeCredential: true,
      scriptUrl: 'https://raw.githubusercontent.com/cshaizhihao/ou-ui-next/main/public/install/ou-agent.sh'
    });

    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });

    render(
      <NodesPage
        agents={[
          {
            ...createAgent(),
            id: 'agent-poll-only-01',
            name: 'Poll Only Host',
            telemetry: {
              ...createAgent().telemetry,
              reportedAt: undefined
            }
          }
        ]}
        inbounds={[]}
        language="zh"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onPreviewAgentUpgradeCommand={onPreviewAgentUpgradeCommand}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: '复制升级命令' }));

    await waitFor(() => {
      expect(onPreviewAgentUpgradeCommand).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'agent-poll-only-01' }),
        'no_telemetry_sample'
      );
      expect(writeText).toHaveBeenCalledWith('sudo ou-agent update');
    });
    expect(screen.getByText('升级命令已生成并复制')).toBeInTheDocument();
    expect(screen.getByText('sudo ou-agent update')).toBeInTheDocument();
  });

  it('offers one-click remote recovery for Agents with self-update capability', async () => {
    const user = userEvent.setup();
    const onRemoteAgentUpgrade = vi.fn();
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);

    render(
      <NodesPage
        agents={[
          {
            ...createAgent(),
            id: 'agent-self-update-01',
            name: 'Self Update Host',
            capabilities: ['host-agent', 'xray', 'self-update'],
            telemetry: {
              ...createAgent().telemetry,
              sampleGapDetected: true,
              sampleGapReason: 'stale_telemetry_sample',
              sampleGapSeconds: 300,
              expectedSamplingIntervalSeconds: 30
            }
          }
        ]}
        inbounds={[]}
        language="zh"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onRemoteAgentUpgrade={onRemoteAgentUpgrade}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: '远程升级 Agent' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('确认远程升级 Agent Self Update Host'));
    expect(onRemoteAgentUpgrade).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: '远程升级 Agent' }));

    expect(onRemoteAgentUpgrade).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'agent-self-update-01' }),
      'stale_telemetry_sample'
    );
    expect(screen.queryByRole('button', { name: '复制升级命令' })).not.toBeInTheDocument();
  });

  it('shows monthly host usage as manual backfill plus Agent metered traffic', () => {
    render(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[]}
        language="zh"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    expect(screen.getByText('8.0 GB / 20GB')).toBeInTheDocument();
  });

  it('surfaces telemetry sampling gaps on managed host cards', () => {
    render(
      <NodesPage
        agents={[
          {
            ...createAgent(),
            telemetry: {
              ...createAgent().telemetry,
              sampleGapDetected: true,
              sampleGapSeconds: 300,
              expectedSamplingIntervalSeconds: 30,
              sampleGapReason: 'stale_telemetry_sample'
            }
          }
        ]}
        inbounds={[]}
        language="en"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    expect(screen.getByText('Gap 5.0min')).toBeInTheDocument();
  });

  it('surfaces Agent load average and runtime service health from telemetry', async () => {
    const user = userEvent.setup();
    render(
      <NodesPage
        agents={[
          {
            ...createAgent(),
            telemetry: {
              ...createAgent().telemetry,
              loadAverage1m: 0.42,
              loadAverage5m: 0.35,
              loadAverage15m: 0.31,
              runtimeServices: [
                {
                  name: 'ou-ui-agent.service',
                  moduleKind: 'agent',
                  status: 'active',
                  enabled: true,
                  required: true,
                  checkedAt: '2026-06-04T04:00:00.000Z'
                },
                {
                  name: 'ou-ui-xray.service',
                  moduleKind: 'xray',
                  status: 'missing',
                  enabled: false,
                  required: true,
                  checkedAt: '2026-06-04T04:00:00.000Z'
                },
                {
                  name: 'ou-ui-forwarding.service',
                  moduleKind: 'port-forwarding',
                  status: 'active',
                  enabled: true,
                  required: true,
                  checkedAt: '2026-06-04T04:00:00.000Z'
                }
              ],
              hostGuardrailStoppedUnits: ['ou-forward-forward-custom-2443-agent-edge-01-tcp.service'],
              hostGuardrailRestoredUnits: ['ou-forward-forward-custom-2443-agent-edge-01-udp.service']
            }
          }
        ]}
        inbounds={[]}
        language="en"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    expect(screen.getByText('1 Issues / 3')).toBeInTheDocument();
    expect(screen.getByText('Agent')).toBeInTheDocument();
    expect(screen.getByText('Xray')).toBeInTheDocument();
    expect(screen.getByText('Forwarding')).toBeInTheDocument();
    expect(screen.getByText('Missing')).toBeInTheDocument();

    await user.click(screen.getByText('Metered Host'));

    expect(screen.getAllByText('0.42 / 0.35 / 0.31').length).toBeGreaterThan(0);
    expect(screen.getByText(/ou-ui-xray\.service: Missing/)).toBeInTheDocument();
    expect(screen.getByText('Guardrail Stopped')).toBeInTheDocument();
    expect(screen.getByText('ou-forward-forward-custom-2443-agent-edge-01-tcp.service')).toBeInTheDocument();
    expect(screen.getByText('Guardrail Restored')).toBeInTheDocument();
    expect(screen.getByText('ou-forward-forward-custom-2443-agent-edge-01-udp.service')).toBeInTheDocument();
  });

  it('filters managed hosts by search text, status, capability, and runtime service issues before opening diagnostics', async () => {
    const user = userEvent.setup();
    const brokenXrayHost: Agent = {
      ...createAgent(),
      id: 'agent-xray-broken-01',
      name: 'Broken Xray Edge',
      status: 'degraded',
      publicAddress: '203.0.113.10',
      capabilities: ['host-agent', 'xray', 'telemetry', 'command-channel'],
      telemetry: {
        ...createAgent().telemetry,
        latencyMs: 230,
        latencyStatus: 'red',
        runtimeServices: [
          {
            name: 'ou-ui-agent.service',
            moduleKind: 'agent',
            status: 'active',
            enabled: true,
            required: true,
            checkedAt: '2026-06-04T04:00:00.000Z'
          },
          {
            name: 'ou-ui-xray.service',
            moduleKind: 'xray',
            status: 'failed',
            enabled: true,
            required: true,
            checkedAt: '2026-06-04T04:00:00.000Z',
            detail: 'exit status 1'
          }
        ]
      }
    };
    const healthyForwardingHost: Agent = {
      ...createAgent(),
      id: 'agent-forwarding-healthy-01',
      name: 'Healthy Forwarding Edge',
      capabilities: ['host-agent', 'port-forwarding', 'telemetry', 'command-channel']
    };

    render(
      <NodesPage
        agents={[brokenXrayHost, healthyForwardingHost]}
        inbounds={[]}
        language="en"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    await user.type(screen.getByRole('searchbox', { name: 'Search Hosts' }), 'xray');
    await user.selectOptions(screen.getByLabelText('Host Status'), 'degraded');
    await user.selectOptions(screen.getByLabelText('Capability'), 'xray');
    await user.selectOptions(screen.getByLabelText('Runtime Health'), 'issues');

    expect(screen.getByText('Matching 1 / 2')).toBeInTheDocument();
    expect(screen.getByText('Broken Xray Edge')).toBeInTheDocument();
    expect(screen.queryByText('Healthy Forwarding Edge')).not.toBeInTheDocument();

    await user.click(screen.getByText('Broken Xray Edge'));

    expect(screen.getByRole('dialog', { name: 'Edit Host' })).toBeInTheDocument();
    expect(screen.getByText(/ou-ui-xray\.service: Failed/)).toBeInTheDocument();
  });

  it('filters customer nodes by search text, protocol, host, and status before editing an inbound', async () => {
    const user = userEvent.setup();
    const meteredHost = createAgent();
    const backupHost = {
      ...createAgent(),
      id: 'agent-backup-02',
      name: 'Backup Host',
      publicAddress: '198.51.100.31'
    };

    render(
      <NodesPage
        agents={[meteredHost, backupHost]}
        inbounds={[
          createInbound(),
          createInbound({
            id: 'inbound-beta-trojan',
            agentId: 'agent-backup-02',
            customerName: 'Beta Team',
            label: 'Beta Trojan Backup',
            protocol: 'trojan',
            listenPort: 8443,
            status: 'disabled',
            subscriptionRule: 'beta-backup',
            clients: [
              {
                ...createInbound().clients[0],
                id: 'client-beta',
                email: 'beta@example.com',
                enabled: false
              }
            ],
            streamSettings: {
              network: 'ws',
              security: 'tls',
              sni: 'beta.example.com',
              path: '/beta'
            },
            reality: {
              enabled: false,
              shortIds: [],
              serverNames: []
            },
            tls: {
              enabled: true,
              certificateId: 'cert-beta',
              alpn: ['h2']
            }
          })
        ]}
        language="en"
        workspaceMode="customerNodes"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    await user.type(screen.getByRole('searchbox', { name: 'Search Customer Nodes' }), 'beta');
    await user.selectOptions(screen.getByLabelText('Protocol'), 'trojan');
    await user.selectOptions(screen.getByLabelText('Assigned Host'), 'agent-backup-02');
    await user.selectOptions(screen.getByLabelText('Node Status'), 'disabled');

    expect(screen.getByText('Matching 1 / 2')).toBeInTheDocument();
    expect(screen.getByText('Beta Trojan Backup')).toBeInTheDocument();
    expect(screen.queryByText('Acme Premium VLESS')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Edit Customer Node' }));

    const dialog = screen.getByRole('dialog', { name: 'Edit Customer Node' });
    expect(within(dialog).getAllByLabelText('Inbound Port')[0]).toHaveValue(8443);
    expect(within(dialog).getByLabelText('Customer Node Name')).toHaveValue('Beta Trojan Backup');
  });

  it('copies customer node single-node and subscription links from the inbound row', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });

    render(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[createInbound()]}
        language="en"
        workspaceMode="customerNodes"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Copy Single-node Link' }));

    expect(writeText).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^vless://${UUID_IN_LINK}@198\\.51\\.100\\.30:443\\?`))
    );
    expect(writeText).not.toHaveBeenCalledWith(expect.stringContaining('vless://client-acme-premium@'));

    await user.click(screen.getByRole('button', { name: 'Copy Subscription Link' }));

    expect(writeText).toHaveBeenCalledWith(
      expect.stringMatching(/\/sub\/[a-z0-9]+\/clash\/premium-hk$/)
    );
  });

  it('bulk copies selected customer node links from the filtered inbound table', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });

    render(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[
          createInbound(),
          createBetaInbound()
        ]}
        language="en"
        workspaceMode="customerNodes"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    await user.click(screen.getByRole('checkbox', { name: 'Select Acme Premium VLESS' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Beta VLESS Edge' }));
    await user.click(screen.getByRole('button', { name: 'Bulk Copy Links' }));

    const copiedLinks = writeText.mock.calls[0]?.[0] as string;
    expect(copiedLinks).toMatch(new RegExp(`Acme Premium VLESS\\nvless://${UUID_IN_LINK}@198\\.51\\.100\\.30:443\\?`, 's'));
    expect(copiedLinks).toMatch(new RegExp(`Beta VLESS Edge\\nvless://${UUID_IN_LINK}@198\\.51\\.100\\.30:8443\\?`, 's'));
    expect(copiedLinks).not.toContain('vless://client-');
  });

  it('shows a bulk impact preflight for selected customer nodes before risky actions', async () => {
    const user = userEvent.setup();
    const backupHost = {
      ...createAgent(),
      id: 'agent-backup-02',
      name: 'Backup Host',
      publicAddress: '198.51.100.31'
    };

    render(
      <NodesPage
        agents={[createAgent(), backupHost]}
        inbounds={[
          createInbound(),
          createBetaInbound({
            agentId: 'agent-backup-02',
            clients: [
              {
                ...createBetaInbound().clients[0],
                enabled: false,
                expiresAt: '2026-06-10T00:00:00.000Z',
                trafficLimitBytes: 50 * GB,
                usedTrafficBytes: 55 * GB
              }
            ],
            remainingDays: 2,
            status: 'disabled'
          })
        ]}
        language="zh"
        workspaceMode="customerNodes"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    await user.click(screen.getByRole('checkbox', { name: '选择 Acme Premium VLESS' }));
    await user.click(screen.getByRole('checkbox', { name: '选择 Beta VLESS Edge' }));

    const preflight = screen.getByRole('region', { name: '客户节点批量影响预检' });
    expect(within(preflight).getByText('受影响客户 2')).toBeInTheDocument();
    expect(within(preflight).getByText('受控主机 2')).toBeInTheDocument();
    expect(within(preflight).getByText('入站端口 2')).toBeInTheDocument();
    expect(within(preflight).getByText('守护风险 1')).toBeInTheDocument();
    expect(within(preflight).getByText('已过期/即将到期 1')).toBeInTheDocument();
    expect(within(preflight).getByText('已停用 1')).toBeInTheDocument();

    const customerPreview = within(preflight).getByText('客户预览').closest('div');
    const nodePreview = within(preflight).getByText('节点预览').closest('div');
    const riskPreview = within(preflight).getByText('风险提示').closest('div');
    expect(customerPreview).not.toBeNull();
    expect(nodePreview).not.toBeNull();
    expect(riskPreview).not.toBeNull();
    expect(within(customerPreview as HTMLElement).getByText('Acme Premium')).toBeInTheDocument();
    expect(within(customerPreview as HTMLElement).getByText('Beta Team')).toBeInTheDocument();
    expect(within(nodePreview as HTMLElement).getByText('Acme Premium VLESS')).toBeInTheDocument();
    expect(within(nodePreview as HTMLElement).getByText('Beta VLESS Edge')).toBeInTheDocument();
    expect(within(riskPreview as HTMLElement).getByText(/Beta VLESS Edge/)).toBeInTheDocument();
  });

  it('confirms before bulk resetting selected customer node traffic policies from the filtered inbound table', async () => {
    const user = userEvent.setup();
    const onResetCustomerNodeTraffic = vi.fn();
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    const acmeQuotaPolicy = createCustomerNodeQuotaPolicy();
    const betaQuotaPolicy = createCustomerNodeQuotaPolicy({
      id: 'customer-node:inbound-beta-vless:client-beta',
      name: 'Beta VLESS Edge quota',
      resourceId: 'inbound-beta-vless:client-beta',
      detail: 'Beta Team'
    });

    render(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[
          createInbound(),
          createBetaInbound()
        ]}
        language="en"
        quotaPolicies={[acmeQuotaPolicy, betaQuotaPolicy]}
        workspaceMode="customerNodes"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onResetCustomerNodeTraffic={onResetCustomerNodeTraffic}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    await user.click(screen.getByRole('checkbox', { name: 'Select Visible Customer Nodes' }));
    await user.click(screen.getByRole('button', { name: 'Bulk Reset Traffic' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Reset traffic for 2 selected customer nodes'));
    expect(onResetCustomerNodeTraffic).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Bulk Reset Traffic' }));

    expect(onResetCustomerNodeTraffic).toHaveBeenCalledTimes(2);
    expect(onResetCustomerNodeTraffic).toHaveBeenNthCalledWith(1, acmeQuotaPolicy);
    expect(onResetCustomerNodeTraffic).toHaveBeenNthCalledWith(2, betaQuotaPolicy);
  });

  it('confirms before bulk updating selected customer node enabled state, traffic quota, and remaining days', async () => {
    const user = userEvent.setup();
    const onSaveCustomerNode = vi.fn();
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);

    render(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[createInbound(), createBetaInbound()]}
        language="en"
        workspaceMode="customerNodes"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={onSaveCustomerNode}
        onSaveHostConfig={vi.fn()}
      />
    );

    await user.click(screen.getByRole('checkbox', { name: 'Select Visible Customer Nodes' }));
    await user.click(screen.getByRole('button', { name: 'Bulk Disable' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Disable 2 selected customer nodes'));
    expect(onSaveCustomerNode).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Bulk Disable' }));
    await user.clear(screen.getByRole('spinbutton', { name: 'Bulk Add Traffic GB' }));
    await user.type(screen.getByRole('spinbutton', { name: 'Bulk Add Traffic GB' }), '50');
    await user.click(screen.getByRole('button', { name: 'Bulk Add Traffic' }));
    await user.clear(screen.getByRole('spinbutton', { name: 'Bulk Renew Days' }));
    await user.type(screen.getByRole('spinbutton', { name: 'Bulk Renew Days' }), '15');
    await user.click(screen.getByRole('button', { name: 'Bulk Renew' }));
    await user.click(screen.getByRole('button', { name: 'Bulk Enable' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Add 50 GB to 2 selected customer nodes'));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Renew 2 selected customer nodes by 15 days'));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Enable 2 selected customer nodes'));
    expect(onSaveCustomerNode).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: 'inbound-premium-vless',
        enabled: false
      }),
      'update'
    );
    expect(onSaveCustomerNode).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: 'inbound-premium-vless',
        trafficLimitGb: 150
      }),
      'update'
    );
    expect(onSaveCustomerNode).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: 'inbound-premium-vless',
        remainingDays: 45
      }),
      'update'
    );
    expect(onSaveCustomerNode).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: 'inbound-premium-vless',
        enabled: true
      }),
      'update'
    );
    expect(onSaveCustomerNode.mock.calls.filter((call) => call[0].nodeId === 'inbound-beta-vless')).toHaveLength(4);
  });

  it('updates a single customer node from the simplified row actions', async () => {
    const user = userEvent.setup();
    const onSaveCustomerNode = vi.fn();
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);

    render(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[createInbound()]}
        language="en"
        workspaceMode="customerNodes"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={onSaveCustomerNode}
        onSaveHostConfig={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Add Traffic' }));
    await user.click(screen.getByRole('button', { name: 'Renew' }));
    await user.click(screen.getByRole('button', { name: 'Disable Node' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Disable Node 1 selected customer node'));
    expect(onSaveCustomerNode).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: 'inbound-premium-vless',
        trafficLimitGb: 200
      }),
      'update'
    );
    expect(onSaveCustomerNode).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: 'inbound-premium-vless',
        remainingDays: 60
      }),
      'update'
    );
    expect(onSaveCustomerNode).not.toHaveBeenCalledWith(expect.objectContaining({ enabled: false }), 'update');

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Disable Node' }));

    expect(onSaveCustomerNode).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: 'inbound-premium-vless',
        enabled: false
      }),
      'update'
    );
  });

  it('confirms before bulk resetting used traffic and changing reset policy for selected customer nodes', async () => {
    const user = userEvent.setup();
    const onSaveCustomerNode = vi.fn();
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);

    render(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[createInbound(), createBetaInbound()]}
        language="en"
        workspaceMode="customerNodes"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={onSaveCustomerNode}
        onSaveHostConfig={vi.fn()}
      />
    );

    await user.click(screen.getByRole('checkbox', { name: 'Select Visible Customer Nodes' }));
    await user.click(screen.getByRole('button', { name: 'Bulk Reset Used Traffic' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Reset used traffic for 2 selected customer nodes'));
    expect(onSaveCustomerNode).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Bulk Reset Used Traffic' }));
    await user.selectOptions(screen.getByLabelText('Bulk Reset Policy'), 'monthly');
    await user.click(screen.getByRole('button', { name: 'Apply Reset Policy' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Apply monthly reset policy to 2 selected customer nodes'));
    expect(onSaveCustomerNode).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: 'inbound-premium-vless',
        currentUsedTrafficGb: 0
      }),
      'update'
    );
    expect(onSaveCustomerNode).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: 'inbound-premium-vless',
        resetPolicy: 'monthly'
      }),
      'update'
    );
    expect(onSaveCustomerNode.mock.calls.filter((call) => call[0].nodeId === 'inbound-beta-vless')).toHaveLength(2);
  });

  it('requires confirmation before bulk deleting selected customer nodes', async () => {
    const user = userEvent.setup();
    const onDeleteCustomerNode = vi.fn();

    render(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[createInbound(), createBetaInbound()]}
        language="en"
        workspaceMode="customerNodes"
        onDeleteCustomerNode={onDeleteCustomerNode}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    await user.click(screen.getByRole('checkbox', { name: 'Select Visible Customer Nodes' }));
    await user.click(screen.getByRole('button', { name: 'Bulk Delete' }));

    expect(onDeleteCustomerNode).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Confirm Delete 2 Nodes' }));

    expect(onDeleteCustomerNode).toHaveBeenCalledTimes(2);
    expect(onDeleteCustomerNode).toHaveBeenNthCalledWith(1, expect.objectContaining({ nodeId: 'inbound-premium-vless' }));
    expect(onDeleteCustomerNode).toHaveBeenNthCalledWith(2, expect.objectContaining({ nodeId: 'inbound-beta-vless' }));
  });

  it('confirms before deleting a single customer node row', async () => {
    const user = userEvent.setup();
    const onDeleteCustomerNode = vi.fn();
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);

    render(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[createInbound(), createBetaInbound()]}
        language="en"
        workspaceMode="customerNodes"
        onDeleteCustomerNode={onDeleteCustomerNode}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    await user.click(screen.getAllByRole('button', { name: 'Delete Customer Node' })[0]);

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Delete customer node Acme Premium VLESS'));
    expect(onDeleteCustomerNode).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(screen.getAllByRole('button', { name: 'Delete Customer Node' })[0]);

    expect(onDeleteCustomerNode).toHaveBeenCalledTimes(1);
    expect(onDeleteCustomerNode).toHaveBeenCalledWith(expect.objectContaining({ nodeId: 'inbound-premium-vless' }));
  });

  it('opens customer node link details with QR code from the inbound row', async () => {
    const user = userEvent.setup();

    render(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[createInbound()]}
        language="en"
        workspaceMode="customerNodes"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'View Links & QR' }));

    const dialog = screen.getByRole('dialog', { name: 'Customer Node Links' });
    expect(within(dialog).getByText('Acme Premium VLESS')).toBeInTheDocument();
    expect(within(dialog).getByText('Single-node Share Link')).toBeInTheDocument();
    expect(within(dialog).getByText('Subscription Link')).toBeInTheDocument();
    expect(
      within(dialog).getByText((value) => new RegExp(`vless://${UUID_IN_LINK}@198\\.51\\.100\\.30:443\\?`).test(value))
    ).toBeInTheDocument();
    expect(within(dialog).queryByText((value) => value.includes('vless://client-acme-premium@'))).not.toBeInTheDocument();
    expect(within(dialog).getByText((value) => value.includes('/sub/') && value.includes('/clash/premium-hk'))).toBeInTheDocument();
    expect(await within(dialog).findByAltText('Subscription QR Code')).toBeInTheDocument();
  });

  it('clones a customer node into a new create task without reusing the inbound id', async () => {
    const user = userEvent.setup();
    const onSaveCustomerNode = vi.fn();

    render(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[createInbound()]}
        language="en"
        workspaceMode="customerNodes"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={onSaveCustomerNode}
        onSaveHostConfig={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Clone Customer Node' }));

    const dialog = screen.getByRole('dialog', { name: 'Add Customer Node' });

    expect(within(dialog).getAllByLabelText('Inbound Port')[0]).toHaveValue(444);
    expect(within(dialog).getByLabelText('Customer Name')).toHaveValue('Acme Premium');
    expect(within(dialog).getByLabelText('Customer Node Name')).toHaveValue('Acme Premium VLESS Copy');
    expect(within(dialog).getByLabelText('Subscription Rule')).toHaveValue('premium-hk-copy');

    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(onSaveCustomerNode).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-metered-01',
          customerNodeName: 'Acme Premium VLESS Copy',
          customerName: 'Acme Premium',
          listenPort: 444,
          subscriptionRule: 'premium-hk-copy',
          xrayProtocol: 'vless'
        }),
        'create'
      );
    });
    expect(onSaveCustomerNode.mock.calls[0][0].nodeId).not.toBe('inbound-premium-vless');
  });

  it('confirms before resetting customer node traffic from the inbound row when a quota policy is available', async () => {
    const user = userEvent.setup();
    const onResetCustomerNodeTraffic = vi.fn();
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    const quotaPolicy = createCustomerNodeQuotaPolicy();

    render(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[createInbound()]}
        language="en"
        quotaPolicies={[quotaPolicy]}
        workspaceMode="customerNodes"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onResetCustomerNodeTraffic={onResetCustomerNodeTraffic}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Reset Traffic' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Reset traffic for Acme Premium VLESS'));
    expect(onResetCustomerNodeTraffic).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Reset Traffic' }));

    expect(onResetCustomerNodeTraffic).toHaveBeenCalledWith(quotaPolicy);
  });

  it('does not show customer node traffic reset when no quota policy matches the inbound client', () => {
    render(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[createInbound()]}
        language="en"
        quotaPolicies={[
          createCustomerNodeQuotaPolicy({
            id: 'customer-node:other-node:other-client',
            resourceId: 'other-node:other-client'
          })
        ]}
        workspaceMode="customerNodes"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onResetCustomerNodeTraffic={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: 'Reset Traffic' })).not.toBeInTheDocument();
  });

  it('only offers executable Xray inbound protocols for customer nodes', async () => {
    const user = userEvent.setup();
    render(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[]}
        language="en"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Customer Nodes' }));
    await user.click(screen.getByRole('button', { name: 'Add Customer Node' }));
    await user.click(screen.getByText('Advanced Config'));

    const protocolOptions = within(screen.getByLabelText('Xray Protocol'));

    expect(protocolOptions.getByRole('option', { name: 'VLESS' })).toBeInTheDocument();
    expect(protocolOptions.getByRole('option', { name: 'VMess' })).toBeInTheDocument();
    expect(protocolOptions.getByRole('option', { name: 'Trojan' })).toBeInTheDocument();
    expect(protocolOptions.getByRole('option', { name: 'Shadowsocks' })).toBeInTheDocument();
    expect(protocolOptions.queryByRole('option', { name: 'Hysteria2' })).not.toBeInTheDocument();
  });

  it('generates both single-node import and public subscription links for customer nodes', async () => {
    const user = userEvent.setup();
    render(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[]}
        language="en"
        workspaceMode="customerNodes"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Add Customer Node' }));

    expect(screen.getByText('Single-node Share Link')).toBeInTheDocument();
    expect(screen.getByText('Subscription Link')).toBeInTheDocument();
    expect(screen.getByText(/vless:\/\//)).toBeInTheDocument();
    expect(
      screen.getByText((value) => value.includes('/sub/') && value.includes('/clash/'))
    ).toBeInTheDocument();
    expect(await screen.findByAltText('Subscription QR Code')).toBeInTheDocument();
  });

  it('opens customer node creation in a centered modal with protocol internals hidden by default', async () => {
    const user = userEvent.setup();
    render(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[]}
        language="en"
        workspaceMode="customerNodes"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Add Customer Node' }));

    const dialog = screen.getByRole('dialog', { name: 'Add Customer Node' });

    expect(dialog).toHaveClass('modal-panel', 'open');
    expect(dialog.parentElement).toHaveClass('overlay', 'open', 'items-center', 'justify-center');
    expect(screen.getByText('Generated Result')).toBeInTheDocument();
    expect(screen.queryByLabelText('Reality Private Key')).not.toBeInTheDocument();

    await user.click(screen.getByText('Advanced Config'));

    expect(screen.getByLabelText('Reality Private Key')).toBeInTheDocument();
  });

  it('auto-generates Reality material when advanced security is switched to Reality', async () => {
    const user = userEvent.setup();
    render(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[]}
        language="en"
        workspaceMode="customerNodes"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Add Customer Node' }));
    await user.click(screen.getByText('Advanced Config'));
    await user.selectOptions(screen.getByLabelText('Protocol Template'), 'vless-tls-ws');

    expect(screen.queryByLabelText('Reality Private Key')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Security'), 'reality');

    const publicKeyInput = screen.getByLabelText('Reality Public Key') as HTMLInputElement;
    const privateKeyInput = screen.getByLabelText('Reality Private Key') as HTMLInputElement;
    const shortIdInput = screen.getByLabelText('Reality Short ID') as HTMLInputElement;

    expect(publicKeyInput.value).toMatch(/\S+/);
    expect(privateKeyInput.value).toMatch(/\S+/);
    expect(shortIdInput.value).toMatch(/^[a-f0-9]{8}$/);
    expect(
      screen.getByText((value) => value.includes('security=reality') && value.includes('pbk=') && value.includes('sid='))
    ).toBeInTheDocument();
  });

  it('uses secure random bytes for customer-node credential fallback without Math.random', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => {
        for (let index = 0; index < bytes.length; index += 1) {
          bytes[index] = index + 1;
        }
        return bytes;
      }
    });
    vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random must not be used for customer-node credentials');
    });

    render(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[]}
        language="en"
        workspaceMode="customerNodes"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Add Customer Node' }));
    await user.click(screen.getByText('Advanced Config'));

    expect(screen.getByLabelText('Client Identity')).toHaveValue('01020304-0506-4708-890a-0b0c0d0e0f10');
  });

  it('locks the standalone customer node page without host tabs or install actions', () => {
    render(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[]}
        language="en"
        workspaceMode="customerNodes"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    expect(screen.getByRole('heading', { level: 3, name: 'Customer Nodes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Customer Node' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Managed Hosts' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Customer Nodes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generate Install Command' })).not.toBeInTheDocument();
  });
});
