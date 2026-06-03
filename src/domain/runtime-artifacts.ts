import { AGENT_TRAFFIC_ACCOUNTING_MODES, type AgentTrafficAccountingMode } from './agent';
import type { DeployTask } from './task';
import type { RuntimeModuleKind } from './module';
import type { BillingDirection } from './quota';
import type { ForwardProtocol, ForwardStrategy, TunnelMode } from './forwarding';
import type { XrayProtocol, XrayStreamSettings } from './protocol';

type RuntimeArtifactInput = {
  task: DeployTask;
  agentId: string;
  moduleKind: RuntimeModuleKind;
};

type XrayRuntimeProtocol = Extract<
  XrayProtocol,
  'vmess' | 'vless' | 'trojan' | 'shadowsocks' | 'http' | 'mixed' | 'hysteria' | 'wireguard'
>;

const XAY_RUNTIME_PROTOCOLS = new Set<XrayProtocol>([
  'vmess',
  'vless',
  'trojan',
  'shadowsocks',
  'http',
  'mixed',
  'hysteria',
  'wireguard'
]);

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

  const strings = value.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
  return strings.length > 0 ? strings.map((item) => item.trim()) : fallback;
}

function readProtocol(metadata: Record<string, unknown> | undefined): XrayRuntimeProtocol {
  const protocol = readString(metadata, 'xrayProtocol', 'vless') as XrayProtocol;
  return XAY_RUNTIME_PROTOCOLS.has(protocol) ? (protocol as XrayRuntimeProtocol) : 'vless';
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

function readTunnelMode(metadata: Record<string, unknown> | undefined): TunnelMode {
  const tunnelMode = readString(metadata, 'tunnelMode', 'direct');
  return ['direct', 'relay', 'encrypted'].includes(tunnelMode) ? (tunnelMode as TunnelMode) : 'direct';
}

function readBillingDirection(metadata: Record<string, unknown> | undefined): BillingDirection {
  const billingDirection = readString(metadata, 'billingDirection', 'both');
  return ['ingress', 'egress', 'both'].includes(billingDirection) ? (billingDirection as BillingDirection) : 'both';
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
  const accountingMode = readString(metadata, 'trafficAccountingMode', fallback);
  return AGENT_TRAFFIC_ACCOUNTING_MODES.includes(accountingMode as AgentTrafficAccountingMode)
    ? (accountingMode as AgentTrafficAccountingMode)
    : fallback;
}

function expiryFromRemainingDays(createdAt: string, remainingDays: number) {
  const createdMs = Date.parse(createdAt);
  const safeBase = Number.isNaN(createdMs) ? Date.now() : createdMs;
  return new Date(safeBase + Math.max(Math.round(remainingDays), 0) * 24 * 60 * 60 * 1000).toISOString();
}

function stableHex(input: string) {
  let first = 0x811c9dc5;
  let second = 0x01000193;

  for (let index = 0; index < input.length; index += 1) {
    first ^= input.charCodeAt(index);
    first = Math.imul(first, 0x01000193);
    second ^= input.charCodeAt(input.length - index - 1);
    second = Math.imul(second, 0x811c9dc5);
  }

  const seed = `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
  return seed.repeat(3).slice(0, 32);
}

function stableUuid(input: string) {
  const hex = stableHex(input);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function stableSecret(input: string) {
  return `ou-${stableHex(input).slice(0, 24)}`;
}

function encodeQuery(input: Record<string, string | number | boolean | undefined>) {
  return Object.entries(input)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
}

function buildStreamSettings(metadata: Record<string, unknown> | undefined) {
  const network = readStreamNetwork(metadata);
  const security = readSecurity(metadata);
  const sni = readString(metadata, 'sni', '');
  const path = readString(metadata, 'path', '');

  return {
    network,
    security,
    tlsSettings:
      security === 'tls'
        ? {
            serverName: sni,
            allowInsecure: false,
            alpn: ['h2', 'http/1.1']
          }
        : undefined,
    realitySettings:
      security === 'reality'
        ? {
            serverNames: sni ? [sni] : [],
            shortIds: [stableHex(`${sni}:${path}`).slice(0, 8)]
          }
        : undefined,
    wsSettings:
      network === 'ws'
        ? {
            path: path || '/',
            headers: sni ? { Host: sni } : {}
          }
        : undefined,
    grpcSettings:
      network === 'grpc'
        ? {
            serviceName: path.replace(/^\//, '') || 'ou-ui-next'
          }
        : undefined,
    httpupgradeSettings:
      network === 'httpupgrade'
        ? {
            path: path || '/'
          }
        : undefined,
    splithttpSettings:
      network === 'splithttp'
        ? {
            path: path || '/'
          }
        : undefined
  };
}

function buildXraySettings(input: {
  protocol: XrayRuntimeProtocol;
  clientId: string;
  password: string;
  clientEmail: string;
  flow: string;
  ipLimit: number;
}) {
  if (input.protocol === 'vless') {
    return {
      clients: [
        {
          id: input.clientId,
          email: input.clientEmail,
          flow: input.flow || undefined,
          level: 0,
          limitIp: input.ipLimit
        }
      ],
      decryption: 'none',
      fallbacks: []
    };
  }

  if (input.protocol === 'vmess') {
    return {
      clients: [
        {
          id: input.clientId,
          email: input.clientEmail,
          alterId: 0,
          level: 0,
          limitIp: input.ipLimit
        }
      ]
    };
  }

  if (input.protocol === 'trojan') {
    return {
      clients: [
        {
          password: input.password,
          email: input.clientEmail,
          flow: input.flow || undefined,
          level: 0,
          limitIp: input.ipLimit
        }
      ],
      fallbacks: []
    };
  }

  if (input.protocol === 'shadowsocks') {
    return {
      method: '2022-blake3-aes-128-gcm',
      password: input.password,
      network: 'tcp,udp'
    };
  }

  if (input.protocol === 'http' || input.protocol === 'mixed') {
    return {
      accounts: [
        {
          user: input.clientEmail,
          pass: input.password
        }
      ],
      allowTransparent: false
    };
  }

  if (input.protocol === 'hysteria') {
    return {
      clients: [
        {
          password: input.password,
          email: input.clientEmail
        }
      ],
      up_mbps: 100,
      down_mbps: 100
    };
  }

  return {
    clients: [
      {
        id: input.clientId,
        email: input.clientEmail
      }
    ],
    network: 'tcp,udp'
  };
}

function buildShareUri(input: {
  protocol: XrayRuntimeProtocol;
  clientId: string;
  password: string;
  serverAddress: string;
  listenPort: number;
  security: XrayStreamSettings['security'];
  network: XrayStreamSettings['network'];
  sni: string;
  path: string;
  label: string;
}) {
  const encodedLabel = encodeURIComponent(input.label);

  if (input.protocol === 'vless') {
    const query = encodeQuery({
      encryption: 'none',
      security: input.security,
      type: input.network,
      host: input.sni,
      sni: input.sni,
      path: input.path
    });
    return `vless://${input.clientId}@${input.serverAddress}:${input.listenPort}?${query}#${encodedLabel}`;
  }

  if (input.protocol === 'trojan') {
    const query = encodeQuery({
      security: input.security,
      type: input.network,
      sni: input.sni,
      path: input.path
    });
    return `trojan://${input.password}@${input.serverAddress}:${input.listenPort}?${query}#${encodedLabel}`;
  }

  if (input.protocol === 'shadowsocks') {
    return `ss://2022-blake3-aes-128-gcm:${input.password}@${input.serverAddress}:${input.listenPort}#${encodedLabel}`;
  }

  return `${input.protocol}://${input.clientId}@${input.serverAddress}:${input.listenPort}#${encodedLabel}`;
}

function buildHostAgentArtifact({ task, agentId }: RuntimeArtifactInput) {
  const metadata = task.metadata;
  const hostName = readString(metadata, 'hostName', task.targetLabel || agentId);
  const maxTrafficGb = readNumber(metadata, 'maxTrafficGb', 0);
  const monthlyTrafficGb = readNumber(metadata, 'monthlyTrafficGb', maxTrafficGb);
  const trafficAccountingMode = readTrafficAccountingMode(metadata, 'both');
  const monthlyResetDay = clampResetDay(readNumber(metadata, 'monthlyResetDay', 1));
  const currentUsedTrafficGb = readNumber(metadata, 'currentUsedTrafficGb', 0);
  const expiresAt = readString(metadata, 'expiresAt', '');
  const pingTarget = readString(metadata, 'pingTarget', '1.1.1.1');
  const pingIntervalSeconds = 30;
  const installProfile = readStringArray(metadata, 'installProfile', []);
  const action =
    task.operation === 'agent.delete' ? 'deregister_host' : task.operation === 'agent.deploy' ? 'enroll_host' : 'update_host_profile';

  return {
    artifactVersion: 'ou-ui.runtime.host-agent.v1',
    generatedBy: 'ou-ui-next-control-plane',
    operation: task.operation,
    moduleKind: 'host-agent',
    action,
    agentId,
    targetId: task.targetId,
    targetLabel: task.targetLabel,
    desiredState: task.operation === 'agent.delete' ? 'removed' : 'managed',
    hostProfile: {
      agentId,
      hostName,
      maxTrafficGb,
      maxTrafficBytes: bytesFromGb(maxTrafficGb),
      monthlyTrafficGb,
      monthlyTrafficBytes: bytesFromGb(monthlyTrafficGb),
      monthlyTrafficLimitBytes: bytesFromGb(monthlyTrafficGb),
      trafficPolicy: {
        accountingMode: trafficAccountingMode,
        monthlyResetDay,
        manualUsedTrafficGb: currentUsedTrafficGb,
        manualUsedTrafficBytes: bytesFromGb(currentUsedTrafficGb),
        telemetrySource: 'agent'
      },
      expiresAt: expiresAt || undefined,
      probeConfig: {
        pingTarget,
        pingIntervalSeconds,
        latencyGreenMaxMs: 100,
        latencyYellowMaxMs: 200
      },
      installProfile
    },
    probeConfig: {
      pingTarget,
      pingIntervalSeconds,
      latencyGreenMaxMs: 100,
      latencyYellowMaxMs: 200
    }
  };
}

function buildXrayArtifact({ task, agentId }: RuntimeArtifactInput) {
  const metadata = task.metadata;
  const protocol = readProtocol(metadata);
  const listenAddress = readString(metadata, 'listenAddress', '0.0.0.0');
  const listenPort = readNumber(metadata, 'listenPort', 443);
  const customerNodeName = readString(metadata, 'customerNodeName', task.targetLabel);
  const customerName = readString(metadata, 'customerName', 'default-customer');
  const serverAddress = readString(metadata, 'serverAddress', '127.0.0.1');
  const clientIdentity = readString(metadata, 'clientIdentity', `${customerName}-${task.targetId}`);
  const clientEmail = `${clientIdentity}@ou-ui.local`;
  const flow = readString(metadata, 'flow', '');
  const ipLimit = readNumber(metadata, 'ipLimit', 0);
  const trafficLimitGb = readNumber(metadata, 'trafficLimitGb', 0);
  const remainingDays = readNumber(metadata, 'remainingDays', 30);
  const subscriptionRule = readString(metadata, 'subscriptionRule', '');
  const streamSettings = buildStreamSettings(metadata);
  const clientId = stableUuid(`${task.targetId}:${clientIdentity}:${protocol}`);
  const password = stableSecret(`${task.targetId}:${clientIdentity}:${protocol}`);
  const expiresAt = expiryFromRemainingDays(task.createdAt, remainingDays);

  return {
    artifactVersion: 'ou-ui.runtime.xray-inbound.v1',
    generatedBy: 'ou-ui-next-control-plane',
    operation: task.operation,
    moduleKind: 'xray',
    action: task.operation === 'inbound.delete' ? 'remove_inbound' : 'upsert_inbound',
    agentId,
    targetId: task.targetId,
    targetLabel: task.targetLabel,
    customer: {
      name: customerName,
      nodeName: customerNodeName,
      subscriptionRule
    },
    clientPolicy: {
      clientIdentity,
      clientId,
      password,
      ipLimit,
      trafficLimitGb,
      trafficLimitBytes: bytesFromGb(trafficLimitGb),
      remainingDays,
      expiresAt
    },
    xray: {
      inbound: {
        tag: `ou-${task.targetId}`,
        listen: listenAddress,
        port: listenPort,
        protocol,
        settings: buildXraySettings({
          protocol,
          clientId,
          password,
          clientEmail,
          flow,
          ipLimit
        }),
        streamSettings,
        sniffing: {
          enabled: true,
          destOverride: ['http', 'tls', 'quic']
        }
      }
    },
    subscription: {
      serverAddress,
      shareUri: buildShareUri({
        protocol,
        clientId,
        password,
        serverAddress,
        listenPort,
        security: streamSettings.security,
        network: streamSettings.network,
        sni: readString(metadata, 'sni', ''),
        path: readString(metadata, 'path', ''),
        label: customerNodeName
      }),
      formats: ['plain', 'json', 'clash']
    }
  };
}

function buildForwardingArtifact({ task, agentId }: RuntimeArtifactInput) {
  const metadata = task.metadata;
  const listenAddress = readString(metadata, 'listenAddress', '0.0.0.0');
  const listenPort = readNumber(metadata, 'listenPort', 0);
  const targetAddress = readString(metadata, 'targetAddress', '127.0.0.1');
  const targetPort = readNumber(metadata, 'targetPort', 0);
  const entryAgentIds = readStringArray(metadata, 'entryNodeIds', readStringArray(metadata, 'agentIds', [agentId]));
  const quotaGb = readNumber(metadata, 'quotaGb', 0);
  const protocol = readForwardProtocol(metadata);
  const serviceName = `ou-forward-${task.targetId}-${agentId}`.replace(/[^a-zA-Z0-9_.@-]/g, '-');

  return {
    artifactVersion: 'ou-ui.runtime.port-forwarding.v1',
    generatedBy: 'ou-ui-next-control-plane',
    operation: task.operation,
    moduleKind: 'flvx',
    action:
      task.operation === 'forward.delete'
        ? 'remove_forward_rule'
        : task.operation === 'forward.update' || task.operation === 'forward.apply'
          ? 'apply_forward_rule'
          : 'create_forward_rule',
    agentId,
    targetId: task.targetId,
    targetLabel: task.targetLabel,
    rule: {
      id: task.targetId,
      name: readString(metadata, 'name', task.targetLabel),
      ownerName: readString(metadata, 'ownerName', 'default-owner'),
      tunnelId: readString(metadata, 'tunnelId', ''),
      enabled: true,
      strategy: readForwardStrategy(metadata),
      tunnelMode: readTunnelMode(metadata),
      protocol,
      entryAgentIds,
      binding: {
        agentId,
        listenAddress,
        listenPort,
        targetAddress,
        targetPort,
        protocol,
        serviceName
      },
      limits: {
        quotaGb,
        quotaBytes: bytesFromGb(quotaGb),
        rateLimitMbps: readNumber(metadata, 'rateLimitMbps', 0),
        ipRateLimitMbps: readNumber(metadata, 'ipRateLimitMbps', 0),
        maxConnections: readNumber(metadata, 'maxConnections', 0),
        maxConnectionsPerIp: readNumber(metadata, 'maxConnectionsPerIp', 0)
      },
      billing: {
        direction: readBillingDirection(metadata),
        trafficMultiplier: readNumber(metadata, 'trafficMultiplier', 1),
        pricePerGb: readNumber(metadata, 'pricePerGb', 0)
      },
      proxyProtocol: readBoolean(metadata, 'proxyProtocol', false)
    },
    servicePlan: {
      serviceName,
      bind: `${listenAddress}:${listenPort}`,
      upstream: `${targetAddress}:${targetPort}`,
      transport: protocol,
      reload: 'graceful_restart'
    }
  };
}

function buildSystemArtifact({ task, agentId, moduleKind }: RuntimeArtifactInput) {
  return {
    artifactVersion: 'ou-ui.runtime.system.v1',
    generatedBy: 'ou-ui-next-control-plane',
    operation: task.operation,
    moduleKind,
    agentId,
    targetId: task.targetId,
    targetLabel: task.targetLabel,
    action: task.operation === 'system.tune' ? 'apply_kernel_tuning' : 'apply_runtime_config',
    metadata: task.metadata ?? {}
  };
}

export function buildRuntimeArtifact(input: RuntimeArtifactInput): Record<string, unknown> {
  if (input.moduleKind === 'host-agent') {
    return buildHostAgentArtifact(input);
  }

  if (input.moduleKind === 'xray') {
    return buildXrayArtifact(input);
  }

  if (input.moduleKind === 'flvx') {
    return buildForwardingArtifact(input);
  }

  return buildSystemArtifact(input);
}
