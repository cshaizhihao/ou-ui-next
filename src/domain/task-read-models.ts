import { AGENT_TRAFFIC_ACCOUNTING_MODES, type Agent, type AgentTrafficAccountingMode } from './agent';
import type { BillingDirection } from './quota';
import { hasAgentRuntimeDeploymentProof, type DeployTask } from './task';
import type {
  ForwardProtocol,
  ForwardPortBinding,
  ForwardRule,
  ForwardStrategy,
  PortAllocationStatus,
  Tunnel,
  TunnelChainHop,
  TunnelMode,
  TunnelType
} from './forwarding';
import type { XrayClientResetPolicy, XrayInbound, XrayProtocol, XrayStreamSettings } from './protocol';
import { normalizeXrayClientCredentials } from './protocol-credentials';

function readString(metadata: Record<string, unknown> | undefined, key: string, fallback: string) {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

function readNumber(metadata: Record<string, unknown> | undefined, key: string, fallback: number) {
  const value = metadata?.[key];

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

function readBoolean(metadata: Record<string, unknown> | undefined, key: string, fallback: boolean) {
  const value = metadata?.[key];
  return typeof value === 'boolean' ? value : fallback;
}

function readStringArray(metadata: Record<string, unknown> | undefined, key: string, fallback: string[] = []) {
  const value = metadata?.[key];

  if (!Array.isArray(value)) {
    return fallback;
  }

  const next = value.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
  return next.length > 0 ? next.map((item) => item.trim()) : fallback;
}

function readResetPolicy(metadata: Record<string, unknown> | undefined): XrayClientResetPolicy {
  const resetPolicy = readString(metadata, 'resetPolicy', 'never');
  return ['never', 'daily', 'weekly', 'monthly'].includes(resetPolicy) ? (resetPolicy as XrayClientResetPolicy) : 'never';
}

function bytesFromGb(gb: number) {
  return Math.max(Number.isFinite(gb) ? gb : 0, 0) * 1024 * 1024 * 1024;
}

function clampResetDay(day: number) {
  return Math.min(Math.max(Math.round(day), 1), 31);
}

function readTrafficAccountingMode(
  metadata: Record<string, unknown> | undefined,
  fallback: AgentTrafficAccountingMode
): AgentTrafficAccountingMode {
  const value = readString(metadata, 'trafficAccountingMode', fallback);
  return AGENT_TRAFFIC_ACCOUNTING_MODES.includes(value as AgentTrafficAccountingMode)
    ? (value as AgentTrafficAccountingMode)
    : fallback;
}

function expiresAtFromTask(task: DeployTask, remainingDays: number) {
  const baseMs = Date.parse(task.createdAt);
  return new Date((Number.isNaN(baseMs) ? Date.now() : baseMs) + Math.max(remainingDays, 0) * 24 * 60 * 60 * 1000).toISOString();
}

function readXrayProtocol(metadata: Record<string, unknown> | undefined): XrayProtocol {
  const protocol = readString(metadata, 'xrayProtocol', 'vless');
  return ['vmess', 'vless', 'trojan', 'shadowsocks', 'hysteria'].includes(protocol)
    ? (protocol as XrayProtocol)
    : 'vless';
}

function readStreamNetwork(metadata: Record<string, unknown> | undefined): XrayStreamSettings['network'] {
  const network = readString(metadata, 'streamNetwork', 'tcp');
  return ['tcp', 'udp', 'ws', 'grpc', 'httpupgrade', 'splithttp'].includes(network)
    ? (network as XrayStreamSettings['network'])
    : 'tcp';
}

function readSecurity(metadata: Record<string, unknown> | undefined): XrayStreamSettings['security'] {
  const security = readString(metadata, 'security', 'none');
  return ['none', 'tls', 'reality'].includes(security) ? (security as XrayStreamSettings['security']) : 'none';
}

function readForwardProtocol(metadata: Record<string, unknown> | undefined): ForwardProtocol {
  const protocol = readString(metadata, 'protocol', 'tcp');
  return ['tcp', 'udp', 'tcp+udp'].includes(protocol) ? (protocol as ForwardProtocol) : 'tcp';
}

function readForwardStrategy(metadata: Record<string, unknown> | undefined): ForwardStrategy {
  const strategy = readString(metadata, 'strategy', 'fifo');
  return ['fifo', 'round-robin', 'least-latency', 'weighted'].includes(strategy) ? (strategy as ForwardStrategy) : 'fifo';
}

function readTunnelMode(): TunnelMode {
  return 'direct';
}

function readTunnelType(metadata: Record<string, unknown> | undefined, fallback: TunnelType): TunnelType {
  const tunnelType = readString(metadata, 'type', fallback);
  return ['port-forward', 'relay-chain'].includes(tunnelType) ? (tunnelType as TunnelType) : fallback;
}

function readTunnelStatus(metadata: Record<string, unknown> | undefined, fallback: Tunnel['status']): Tunnel['status'] {
  const status = readString(metadata, 'status', fallback);
  return ['active', 'paused', 'degraded', 'deploying'].includes(status) ? (status as Tunnel['status']) : fallback;
}

function readIpPreference(
  metadata: Record<string, unknown> | undefined,
  fallback: Tunnel['ipPreference']
): Tunnel['ipPreference'] {
  const ipPreference = readString(metadata, 'ipPreference', fallback);
  return ['ipv4', 'ipv6', 'auto'].includes(ipPreference) ? (ipPreference as Tunnel['ipPreference']) : fallback;
}

function readBillingDirection(metadata: Record<string, unknown> | undefined): BillingDirection {
  const billingDirection = readString(metadata, 'billingDirection', 'both');
  return ['both', 'single', 'ingress', 'egress'].includes(billingDirection)
    ? (billingDirection as BillingDirection)
    : 'both';
}

function readForwardPortStatusFromTask(task: DeployTask): PortAllocationStatus {
  if (task.status === 'succeeded') {
    if (hasAgentRuntimeDeploymentProof(task)) {
      return 'allocated';
    }

    return task.operation === 'forward.delete' ? 'releasing' : 'deploying';
  }

  if (task.status === 'failed' || task.status === 'canceled' || task.status === 'rolled_back') {
    return 'failed';
  }

  if (task.operation === 'forward.delete') {
    return 'releasing';
  }

  return 'deploying';
}

function updateForwardRulePortStatus(rule: ForwardRule, portStatus: PortAllocationStatus): ForwardRule {
  return {
    ...rule,
    portStatus,
    ports: rule.ports.map(
      (port): ForwardPortBinding => ({
        ...port,
        status: portStatus
      })
    )
  };
}

function readTunnelChain(
  metadata: Record<string, unknown> | undefined,
  input: {
    entryAgentIds: string[];
    exitAgentIds: string[];
    protocol: ForwardProtocol;
    inAddress: string;
    existingChain?: TunnelChainHop[];
  }
): TunnelChainHop[] {
  const value = metadata?.chain;

  if (Array.isArray(value)) {
    const parsed = value
      .map((item): TunnelChainHop | undefined => {
        if (!item || typeof item !== 'object') {
          return undefined;
        }

        const record = item as Record<string, unknown>;
        const agentId = typeof record.agentId === 'string' ? record.agentId.trim() : '';

        if (!agentId) {
          return undefined;
        }

        return {
          agentId,
          region: typeof record.region === 'string' && record.region.trim() ? record.region.trim() : 'unassigned',
          protocol: ['tcp', 'udp', 'tcp+udp'].includes(String(record.protocol))
            ? (record.protocol as ForwardProtocol)
            : input.protocol,
          address:
            typeof record.address === 'string' && record.address.trim()
              ? record.address.trim()
              : `${input.inAddress}:0`,
          latencyMs: typeof record.latencyMs === 'number' && Number.isFinite(record.latencyMs) ? record.latencyMs : 0
        };
      })
      .filter((item): item is TunnelChainHop => Boolean(item));

    if (parsed.length > 0) {
      return parsed;
    }
  }

  const hopAgentIds = [...new Set([...input.entryAgentIds, ...input.exitAgentIds])];

  if (hopAgentIds.length > 0) {
    return hopAgentIds.map((agentId) => ({
      agentId,
      region: 'unassigned',
      protocol: input.protocol,
      address: `${input.inAddress}:0`,
      latencyMs: 0
    }));
  }

  return input.existingChain ?? [];
}

export function createXrayInboundFromTask(task: DeployTask): XrayInbound | undefined {
  if (task.operation !== 'inbound.create' && task.operation !== 'inbound.update') {
    return undefined;
  }

  const metadata = task.metadata;
  const customerName = readString(metadata, 'customerName', 'customer');
  const clientIdentity = readString(metadata, 'clientIdentity', customerName);
  const trafficLimitGb = readNumber(metadata, 'trafficLimitGb', 0);
  const monthlyResetDay = clampResetDay(readNumber(metadata, 'monthlyResetDay', 1));
  const currentUsedTrafficGb = readNumber(metadata, 'currentUsedTrafficGb', 0);
  const remainingDays = readNumber(metadata, 'remainingDays', 30);
  const security = readSecurity(metadata);
  const sni = readString(metadata, 'sni', '');
  const protocol = readXrayProtocol(metadata);
  const clientEmail = readString(metadata, 'clientEmail', customerName);
  const clientCredential = readString(metadata, 'clientCredential', clientIdentity);
  const fallbackDestination = readString(metadata, 'fallbackDestination', '');
  const alpn = readStringArray(metadata, 'alpn', ['h2', 'http/1.1']);
  const normalizedCredentials = normalizeXrayClientCredentials({
    protocol,
    clientIdentity,
    clientCredential,
    hysteriaAuth: readString(metadata, 'hysteriaAuth', clientCredential),
    fallbackSeed: `${task.targetId}:${readString(metadata, 'agentId', '')}:${customerName}`
  });

  return {
    id: task.targetId,
    nodeId: readString(metadata, 'nodeId', readString(metadata, 'agentId', task.targetId)),
    agentId: readString(metadata, 'agentId', ''),
    customerName,
    serverAddress: readString(metadata, 'serverAddress', ''),
    clientIdentity: normalizedCredentials.clientIdentity,
    remainingDays,
    subscriptionRule: readString(metadata, 'subscriptionRule', 'manual'),
    path: readString(metadata, 'path', ''),
    flow: readString(metadata, 'flow', ''),
    protocol,
    label: readString(metadata, 'customerNodeName', task.targetLabel),
    listenAddress: readString(metadata, 'listenAddress', '0.0.0.0'),
    listenPort: readNumber(metadata, 'listenPort', 443),
    status: 'applying',
    clients: [
      {
        id: normalizedCredentials.clientId,
        email: clientEmail,
        enabled: true,
        credentialType: normalizedCredentials.credentialType,
        password: protocol === 'trojan' || protocol === 'shadowsocks' ? normalizedCredentials.password : undefined,
        auth: protocol === 'hysteria' ? normalizedCredentials.auth : undefined,
        method: protocol === 'shadowsocks' ? readString(metadata, 'shadowsocksMethod', '2022-blake3-aes-128-gcm') : undefined,
        security: protocol === 'vmess' ? readString(metadata, 'vmessSecurity', 'auto') : undefined,
        flow: readString(metadata, 'flow', ''),
        subId: readString(metadata, 'subscriptionRule', 'manual'),
        level: readNumber(metadata, 'clientLevel', 0),
        comment: readString(metadata, 'clientComment', ''),
        tgId: readString(metadata, 'telegramId', ''),
        resetPolicy: readResetPolicy(metadata),
        trafficLimitBytes: bytesFromGb(trafficLimitGb),
        usedTrafficBytes: bytesFromGb(currentUsedTrafficGb),
        monthlyResetDay,
        manualUsedTrafficBytes: bytesFromGb(currentUsedTrafficGb),
        uplinkBytes: 0,
        downlinkBytes: 0,
        expiresAt: expiresAtFromTask(task, remainingDays),
        ipLimit: readNumber(metadata, 'ipLimit', 0)
      }
    ],
    streamSettings: {
      network: readStreamNetwork(metadata),
      security,
      sni: sni || undefined,
      host: readString(metadata, 'host', sni) || undefined,
      path: readString(metadata, 'path', '') || undefined,
      serviceName:
        readStreamNetwork(metadata) === 'grpc'
          ? readString(metadata, 'path', '').replace(/^\//, '') || 'ou-ui-next'
          : undefined,
      fingerprint: readString(metadata, 'fingerprint', security === 'reality' ? 'chrome' : '')
    },
    tls: {
      enabled: security === 'tls',
      alpn
    },
    reality: {
      enabled: security === 'reality',
      publicKey: readString(metadata, 'realityPublicKey', ''),
      fingerprint: readString(metadata, 'fingerprint', security === 'reality' ? 'chrome' : ''),
      shortIds: security === 'reality' ? [readString(metadata, 'realityShortId', 'ouui')] : [],
      serverNames: sni ? [sni] : []
    },
    fallbacks: fallbackDestination
      ? [
          {
            name: readString(metadata, 'fallbackName', 'fallback'),
            destination: fallbackDestination,
            xver: readNumber(metadata, 'fallbackXver', 0)
          }
        ]
      : [],
    sniffingEnabled: readBoolean(metadata, 'sniffingEnabled', true),
    configVersion: `cfg-${task.id}`
  };
}

export function applyXrayInboundTask(inbounds: XrayInbound[], task: DeployTask) {
  if (task.operation === 'inbound.delete') {
    return inbounds.filter((inbound) => inbound.id !== task.targetId);
  }

  const nextInbound = createXrayInboundFromTask(task);

  if (!nextInbound) {
    return inbounds;
  }

  return [nextInbound, ...inbounds.filter((inbound) => inbound.id !== nextInbound.id)];
}

export function createForwardRuleFromTask(task: DeployTask): ForwardRule | undefined {
  const isForwardTask = task.operation === 'forward.create' || task.operation === 'forward.update';
  const isTunnelTask =
    task.operation === 'tunnel.create' || task.operation === 'tunnel.update' || task.operation === 'tunnel.redeploy';

  if (!isForwardTask && !isTunnelTask) {
    return undefined;
  }

  const metadata = task.metadata;
  const entryAgentIds = isTunnelTask
    ? readStringArray(metadata, 'entryAgentIds', readStringArray(metadata, 'agentIds', []))
    : readStringArray(metadata, 'entryNodeIds', readStringArray(metadata, 'agentIds', []));
  const protocol = readForwardProtocol(metadata);
  const quotaGb = readNumber(metadata, 'quotaGb', 0);
  const rateLimitMbps = readNumber(metadata, 'rateLimitMbps', 0);
  const currentUsedTrafficGb = readNumber(metadata, 'currentUsedTrafficGb', 0);
  const runtimeServicePrefix = isTunnelTask ? 'ou-tunnel' : 'ou-forward';
  const portStatus = readForwardPortStatusFromTask(task);

  return {
    id: task.targetId,
    tunnelId: readString(metadata, 'tunnelId', isTunnelTask ? task.targetId : ''),
    name: readString(metadata, 'name', task.targetLabel),
    ownerName: readString(metadata, 'ownerName', readString(metadata, 'accountId', 'customer')),
    strategy: readForwardStrategy(metadata),
    resourceVersion: `forward-${task.targetId}-${task.id}`,
    enabled: true,
    ports: entryAgentIds.map((agentId) => ({
      agentId,
      listenAddress: readString(metadata, 'listenAddress', '0.0.0.0'),
      listenPort: readNumber(metadata, 'listenPort', 1),
      targetAddress: readString(metadata, 'targetAddress', '127.0.0.1'),
      targetPort: readNumber(metadata, 'targetPort', 1),
      protocol,
      status: portStatus,
      runtimeServiceNames: [`${runtimeServicePrefix}-${task.targetId}-${agentId}`.replace(/[^a-zA-Z0-9_.@-]/g, '-')]
    })),
    portStatus,
    billingDirection: readBillingDirection(metadata),
    trafficMultiplier: readNumber(metadata, 'trafficMultiplier', 1),
    monthlyResetDay: clampResetDay(readNumber(metadata, 'monthlyResetDay', 1)),
    manualUsedBytes: bytesFromGb(currentUsedTrafficGb),
    quotaBytes: bytesFromGb(quotaGb),
    rateLimitMbps,
    ipRateLimitMbps: readNumber(metadata, 'ipRateLimitMbps', 0),
    quotaPolicyId: `quota-${task.targetId}-${quotaGb}gb`,
    rateLimitPolicyId: `rate-${task.targetId}-${rateLimitMbps}mbps`,
    ipRateLimitPolicyId: `ip-rate-${task.targetId}-${readNumber(metadata, 'ipRateLimitMbps', 0)}mbps`,
    maxConnections: readNumber(metadata, 'maxConnections', 0),
    maxConnectionsPerIp: readNumber(metadata, 'maxConnectionsPerIp', 0),
    proxyProtocol: readBoolean(metadata, 'proxyProtocol', false),
    tunnelMode: readTunnelMode(),
    pricePerGb: readNumber(metadata, 'pricePerGb', 0),
    inboundBytes: 0,
    outboundBytes: 0
  };
}

export function applyForwardRuleTask(forwardRules: ForwardRule[], task: DeployTask) {
  const existingRule = forwardRules.find((rule) => rule.id === task.targetId);

  if (task.operation === 'forward.delete') {
    if (task.status === 'succeeded' && hasAgentRuntimeDeploymentProof(task)) {
      return forwardRules.filter((rule) => rule.id !== task.targetId);
    }

    if (!existingRule) {
      return forwardRules;
    }

    const nextRule = updateForwardRulePortStatus(existingRule, readForwardPortStatusFromTask(task));
    return [nextRule, ...forwardRules.filter((rule) => rule.id !== nextRule.id)];
  }

  if (task.operation === 'forward.apply') {
    if (!existingRule) {
      return forwardRules;
    }

    const nextRule = updateForwardRulePortStatus(existingRule, readForwardPortStatusFromTask(task));
    return [nextRule, ...forwardRules.filter((rule) => rule.id !== nextRule.id)];
  }

  const nextRule = createForwardRuleFromTask(task);

  if (!nextRule) {
    return forwardRules;
  }

  return [nextRule, ...forwardRules.filter((rule) => rule.id !== nextRule.id)];
}

export function createTunnelFromTask(task: DeployTask, existing?: Tunnel): Tunnel | undefined {
  if (task.operation !== 'tunnel.create' && task.operation !== 'tunnel.update' && task.operation !== 'tunnel.redeploy') {
    return undefined;
  }

  const metadata = task.metadata;
  const protocol =
    metadata && 'protocol' in metadata ? readForwardProtocol(metadata) : (existing?.protocol ?? 'tcp+udp');
  const fallbackEntryAgentIds = existing?.entryAgentIds ?? [];
  const entryAgentIds = readStringArray(metadata, 'entryAgentIds', fallbackEntryAgentIds);
  const exitAgentIds = readStringArray(metadata, 'exitAgentIds', existing?.exitAgentIds ?? entryAgentIds);
  const inAddress = readString(metadata, 'inAddress', existing?.inAddress ?? '0.0.0.0');
  const nextProtocol = protocol;
  const status =
    task.operation === 'tunnel.redeploy' ? 'deploying' : readTunnelStatus(metadata, existing?.status ?? 'deploying');

  return {
    id: task.targetId,
    name: readString(metadata, 'name', existing?.name ?? task.targetLabel),
    accountId: readString(metadata, 'accountId', existing?.accountId ?? `acct-${task.targetId}`),
    type: readTunnelType(metadata, existing?.type ?? 'relay-chain'),
    status,
    resourceVersion: `tunnel-${task.targetId}-${task.id}`,
    entryAgentIds,
    exitAgentIds,
    chain: readTunnelChain(metadata, {
      entryAgentIds,
      exitAgentIds,
      protocol: nextProtocol,
      inAddress,
      existingChain: existing?.chain
    }),
    trafficRatio: readNumber(metadata, 'trafficRatio', existing?.trafficRatio ?? 1),
    protocol: nextProtocol,
    inAddress,
    ipPreference: readIpPreference(metadata, existing?.ipPreference ?? 'auto'),
    probeTargetHost: readString(metadata, 'probeTargetHost', existing?.probeTargetHost ?? 'www.cloudflare.com'),
    probeTargetPort: readNumber(metadata, 'probeTargetPort', existing?.probeTargetPort ?? 443),
    quotaPolicyId: readString(metadata, 'quotaPolicyId', existing?.quotaPolicyId ?? `quota-${task.targetId}`),
    rateLimitPolicyId: readString(metadata, 'rateLimitPolicyId', existing?.rateLimitPolicyId ?? `rate-${task.targetId}`)
  };
}

export function applyTunnelTask(tunnels: Tunnel[], task: DeployTask) {
  const existing = tunnels.find((tunnel) => tunnel.id === task.targetId);
  const nextTunnel = createTunnelFromTask(task, existing);

  if (!nextTunnel) {
    return tunnels;
  }

  return [nextTunnel, ...tunnels.filter((tunnel) => tunnel.id !== nextTunnel.id)];
}

export function applyAgentTask(agents: Agent[], task: DeployTask) {
  const agentId = readString(task.metadata, 'agentId', task.targetId);

  if (task.operation === 'agent.delete') {
    return agents.filter((agent) => agent.id !== agentId);
  }

  if (task.operation !== 'agent.update') {
    return agents;
  }

  const metadata = task.metadata;

  return agents.map((agent) => {
    if (agent.id !== agentId) {
      return agent;
    }

    const maxTrafficGb = readNumber(metadata, 'maxTrafficGb', Math.round(agent.maxTrafficBytes / 1024 / 1024 / 1024));
    const monthlyTrafficGb = readNumber(
      metadata,
      'monthlyTrafficGb',
      Math.round((agent.monthlyTrafficLimitBytes ?? agent.maxTrafficBytes) / 1024 / 1024 / 1024)
    );
    const pingTarget = readString(metadata, 'pingTarget', agent.probeConfig?.pingTarget ?? agent.publicAddress);
    const expiresAt = readString(metadata, 'expiresAt', agent.expiresAt ?? '');
    const trafficPolicy = agent.trafficPolicy ?? {
      accountingMode: 'both' as const,
      monthlyResetDay: 1,
      manualUsedTrafficBytes: 0,
      telemetrySource: 'agent' as const
    };
    const currentUsedTrafficGb = readNumber(
      metadata,
      'currentUsedTrafficGb',
      Math.round((trafficPolicy.manualUsedTrafficBytes ?? 0) / 1024 / 1024 / 1024)
    );

    return {
      ...agent,
      name: readString(metadata, 'displayName', readString(metadata, 'hostName', agent.name)),
      runtimeHostName: readString(metadata, 'runtimeHostName', agent.runtimeHostName ?? agent.id),
      maxTrafficBytes: bytesFromGb(maxTrafficGb),
      monthlyTrafficLimitBytes: bytesFromGb(monthlyTrafficGb),
      expiresAt: expiresAt || agent.expiresAt,
      probeConfig: {
        pingTarget,
        pingIntervalSeconds: 30,
        latencyGreenMaxMs: 100,
        latencyYellowMaxMs: 200
      },
      trafficPolicy: {
        accountingMode: readTrafficAccountingMode(metadata, trafficPolicy.accountingMode),
        monthlyResetDay: clampResetDay(readNumber(metadata, 'monthlyResetDay', trafficPolicy.monthlyResetDay)),
        manualUsedTrafficBytes: bytesFromGb(currentUsedTrafficGb),
        telemetrySource: 'agent' as const
      }
    };
  });
}
