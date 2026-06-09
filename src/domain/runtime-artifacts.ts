import { AGENT_TRAFFIC_ACCOUNTING_MODES, type AgentTrafficAccountingMode } from './agent';
import type { DeployTask } from './task';
import type { RuntimeModuleKind } from './module';
import type { BillingDirection, RateLimitDirection, RateLimitMode } from './quota';
import type { ForwardProtocol, ForwardStrategy, TunnelMode, TunnelType } from './forwarding';
import type { XrayProtocol, XrayStreamSettings } from './protocol';
import { normalizeXrayClientCredentials } from './protocol-credentials';
import { buildXrayShareLink, normalizeGrpcServiceName } from './xray-share-link';

type RuntimeArtifactInput = {
  task: DeployTask;
  agentId: string;
  moduleKind: RuntimeModuleKind;
};

type XrayRuntimeProtocol = Extract<
  XrayProtocol,
  'vmess' | 'vless' | 'trojan' | 'shadowsocks'
>;

const XAY_RUNTIME_PROTOCOLS = new Set<XrayProtocol>([
  'vmess',
  'vless',
  'trojan',
  'shadowsocks'
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

  if (!XAY_RUNTIME_PROTOCOLS.has(protocol)) {
    throw new Error(`Unsupported Xray inbound protocol: ${protocol}`);
  }

  return protocol as XrayRuntimeProtocol;
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

function readBillingDirection(metadata: Record<string, unknown> | undefined): BillingDirection {
  const billingDirection = readString(metadata, 'billingDirection', 'both');
  return ['both', 'single', 'ingress', 'egress'].includes(billingDirection)
    ? (billingDirection as BillingDirection)
    : 'both';
}

function readRateLimitMode(metadata: Record<string, unknown> | undefined): RateLimitMode {
  const mode = readString(metadata, 'rateLimitMode', 'bi-directional');
  return mode === 'one-way' ? 'one-way' : 'bi-directional';
}

function readRateLimitDirection(
  metadata: Record<string, unknown> | undefined,
  mode: RateLimitMode,
  billingDirection: BillingDirection
): RateLimitDirection {
  if (mode === 'bi-directional') {
    return 'both';
  }

  const explicitDirection = readString(metadata, 'rateLimitDirection', '');
  if (explicitDirection === 'ingress' || explicitDirection === 'egress') {
    return explicitDirection;
  }

  return billingDirection === 'egress' ? 'egress' : 'ingress';
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

function trafficCounterDirections(accountingMode: AgentTrafficAccountingMode) {
  if (accountingMode === 'ingress') return ['ingress'];
  if (accountingMode === 'egress') return ['egress'];
  return ['ingress', 'egress'];
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

function buildStreamSettings(metadata: Record<string, unknown> | undefined) {
  const network = readStreamNetwork(metadata);
  const security = readSecurity(metadata);
  const sni = readString(metadata, 'sni', '');
  const path = readString(metadata, 'path', '');
  const fingerprint = readString(metadata, 'fingerprint', 'chrome');
  const alpn = readStringArray(metadata, 'alpn', ['h2', 'http/1.1']);
  const realityShortId = readString(metadata, 'realityShortId', stableHex(`${sni}:${path}`).slice(0, 8));
  const realityPrivateKey = readString(metadata, 'realityPrivateKey', '');
  const realityTarget = readString(metadata, 'realityTarget', sni ? `${sni}:443` : '');
  const host = readString(metadata, 'host', sni);

  return {
    network,
    security,
    sni: sni || undefined,
    host: host || undefined,
    path: path || undefined,
    serviceName: network === 'grpc' ? normalizeGrpcServiceName(path) : undefined,
    fingerprint,
    tlsSettings:
      security === 'tls'
        ? {
            serverName: sni,
            allowInsecure: false,
            alpn
          }
        : undefined,
    realitySettings:
      security === 'reality'
        ? {
            target: realityTarget || undefined,
            serverNames: sni ? [sni] : [],
            privateKey: realityPrivateKey || undefined,
            shortIds: [realityShortId]
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
            serviceName: normalizeGrpcServiceName(path)
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
  auth: string;
  clientEmail: string;
  flow: string;
  ipLimit: number;
  level: number;
  vmessSecurity: string;
  shadowsocksMethod: string;
}) {
  if (input.protocol === 'vless') {
    return {
      clients: [
        {
          id: input.clientId,
          email: input.clientEmail,
          flow: input.flow || undefined,
          level: input.level,
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
          security: input.vmessSecurity,
          level: input.level,
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
          level: input.level,
          limitIp: input.ipLimit
        }
      ],
      fallbacks: []
    };
  }

  if (input.protocol === 'shadowsocks') {
    return {
      method: input.shadowsocksMethod,
      password: input.password,
      network: 'tcp,udp'
    };
  }

  throw new Error(`Unsupported Xray inbound protocol: ${input.protocol}`);
}

function buildHostAgentArtifact({ task, agentId }: RuntimeArtifactInput) {
  const metadata = task.metadata;
  const displayName = readString(metadata, 'displayName', readString(metadata, 'hostName', task.targetLabel || agentId));
  const hostName = readString(metadata, 'runtimeHostName', agentId);
  const maxTrafficGb = readNumber(metadata, 'maxTrafficGb', 0);
  const monthlyTrafficGb = readNumber(metadata, 'monthlyTrafficGb', maxTrafficGb);
  const monthlyTrafficBytes = bytesFromGb(monthlyTrafficGb);
  const trafficAccountingMode = readTrafficAccountingMode(metadata, 'both');
  const monthlyResetDay = clampResetDay(readNumber(metadata, 'monthlyResetDay', 1));
  const currentUsedTrafficGb = readNumber(metadata, 'currentUsedTrafficGb', 0);
  const manualUsedTrafficBytes = bytesFromGb(currentUsedTrafficGb);
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
      displayName,
      hostName,
      maxTrafficGb,
      maxTrafficBytes: bytesFromGb(maxTrafficGb),
      monthlyTrafficGb,
      monthlyTrafficBytes,
      monthlyTrafficLimitBytes: monthlyTrafficBytes,
      trafficPolicy: {
        accountingMode: trafficAccountingMode,
        monthlyResetDay,
        manualUsedTrafficGb: currentUsedTrafficGb,
        manualUsedTrafficBytes,
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
    },
    telemetryPlan: {
      source: 'agent',
      sampleIntervalSeconds: pingIntervalSeconds,
      pingProbe: {
        target: pingTarget,
        intervalSeconds: pingIntervalSeconds,
        latencyGreenMaxMs: 100,
        latencyYellowMaxMs: 200,
        statusBands: [
          { status: 'green', minMs: 1, maxMs: 100 },
          { status: 'yellow', minMs: 101, maxMs: 200 },
          { status: 'red', minMs: 201 }
        ]
      },
      trafficCounters: {
        enabled: true,
        accountingMode: trafficAccountingMode,
        counterDirections: trafficCounterDirections(trafficAccountingMode),
        monthlyResetDay,
        monthlyTrafficGb,
        monthlyTrafficBytes,
        monthlyTrafficLimitBytes: monthlyTrafficBytes,
        manualUsedTrafficGb: currentUsedTrafficGb,
        manualUsedTrafficBytes
      },
      hardwareProbe: {
        enabled: true,
        intervalSeconds: pingIntervalSeconds,
        fields: ['cpu', 'memory', 'disk', 'network', 'kernel', 'virtualization', 'primaryNetworkInterface']
      }
    }
  };
}

function buildXrayArtifact({ task, agentId }: RuntimeArtifactInput) {
  const metadata = task.metadata;
  const enabled = readBoolean(metadata, 'enabled', true);
  const protocol = readProtocol(metadata);
  const listenAddress = readString(metadata, 'listenAddress', '0.0.0.0');
  const listenPort = readNumber(metadata, 'listenPort', 443);
  const customerNodeName = readString(metadata, 'customerNodeName', task.targetLabel);
  const customerName = readString(metadata, 'customerName', 'default-customer');
  const serverAddress = readString(metadata, 'serverAddress', '127.0.0.1');
  const clientIdentity = readString(metadata, 'clientIdentity', `${customerName}-${task.targetId}`);
  const clientEmail = readString(metadata, 'clientEmail', `${clientIdentity}@ou-ui.local`);
  const clientCredential = readString(metadata, 'clientCredential', clientIdentity);
  const flow = readString(metadata, 'flow', '');
  const ipLimit = readNumber(metadata, 'ipLimit', 0);
  const clientLevel = readNumber(metadata, 'clientLevel', 0);
  const trafficLimitGb = readNumber(metadata, 'trafficLimitGb', 0);
  const monthlyResetDay = clampResetDay(readNumber(metadata, 'monthlyResetDay', 1));
  const currentUsedTrafficGb = readNumber(metadata, 'currentUsedTrafficGb', 0);
  const remainingDays = readNumber(metadata, 'remainingDays', 30);
  const subscriptionRule = readString(metadata, 'subscriptionRule', '');
  const vmessSecurity = readString(metadata, 'vmessSecurity', 'auto');
  const shadowsocksMethod = readString(metadata, 'shadowsocksMethod', '2022-blake3-aes-128-gcm');
  const hysteriaAuth = readString(metadata, 'hysteriaAuth', clientCredential);
  const sniffingEnabled = readBoolean(metadata, 'sniffingEnabled', true);
  const fallbackDestination = readString(metadata, 'fallbackDestination', '');
  const streamSettings = buildStreamSettings(metadata);
  const realityPublicKey = readString(metadata, 'realityPublicKey', '');
  const realityShortId = readString(metadata, 'realityShortId', '');
  const fingerprint = readString(metadata, 'fingerprint', streamSettings.security === 'reality' ? 'chrome' : '');
  const normalizedCredentials = normalizeXrayClientCredentials({
    protocol,
    clientIdentity,
    clientCredential,
    hysteriaAuth,
    fallbackSeed: `${task.targetId}:${agentId}:${customerName}`
  });
  const clientId = normalizedCredentials.clientId;
  const password = normalizedCredentials.password;
  const expiresAt = expiryFromRemainingDays(task.createdAt, remainingDays);

  return {
    artifactVersion: 'ou-ui.runtime.xray-inbound.v1',
    generatedBy: 'ou-ui-next-control-plane',
    operation: task.operation,
    moduleKind: 'xray',
    action: task.operation === 'inbound.delete' || !enabled ? 'remove_inbound' : 'upsert_inbound',
    agentId,
    targetId: task.targetId,
    targetLabel: task.targetLabel,
    customer: {
      name: customerName,
      nodeName: customerNodeName,
      subscriptionRule
    },
    clientPolicy: {
      clientIdentity: normalizedCredentials.clientIdentity,
      clientId,
      password,
      auth: normalizedCredentials.auth,
      clientEmail,
      enabled,
      ipLimit,
      level: clientLevel,
      trafficLimitGb,
      trafficLimitBytes: bytesFromGb(trafficLimitGb),
      monthlyResetDay,
      manualUsedTrafficGb: currentUsedTrafficGb,
      manualUsedTrafficBytes: bytesFromGb(currentUsedTrafficGb),
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
          auth: normalizedCredentials.auth,
          clientEmail,
          flow,
          ipLimit,
          level: clientLevel,
          vmessSecurity,
          shadowsocksMethod
        }),
        streamSettings,
        sniffing: {
          enabled: sniffingEnabled,
          destOverride: ['http', 'tls', 'quic']
        },
        fallbacks: fallbackDestination
          ? [
              {
                name: readString(metadata, 'fallbackName', 'fallback'),
                dest: fallbackDestination,
                xver: readNumber(metadata, 'fallbackXver', 0)
              }
            ]
          : []
      }
    },
    subscription: {
      serverAddress,
      shareUri: buildXrayShareLink({
        protocol,
        clientIdentity,
        clientCredential,
        hysteriaAuth,
        fallbackSeed: `${task.targetId}:${agentId}:${customerName}`,
        serverAddress,
        listenPort,
        security: streamSettings.security,
        network: streamSettings.network,
        sni: readString(metadata, 'sni', ''),
        path: readString(metadata, 'path', ''),
        flow,
        fingerprint,
        realityPublicKey,
        realityShortId,
        vmessSecurity,
        shadowsocksMethod,
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
  const monthlyResetDay = clampResetDay(readNumber(metadata, 'monthlyResetDay', 1));
  const currentUsedTrafficGb = readNumber(metadata, 'currentUsedTrafficGb', 0);
  const protocol = readForwardProtocol(metadata);
  const serviceName = `ou-forward-${task.targetId}-${agentId}`.replace(/[^a-zA-Z0-9_.@-]/g, '-');
  const enabled = task.operation === 'forward.pause' ? false : task.operation === 'forward.resume' ? true : readBoolean(metadata, 'enabled', true);
  const billingDirection = readBillingDirection(metadata);
  const rateLimitMode = readRateLimitMode(metadata);

  return {
    artifactVersion: 'ou-ui.runtime.port-forwarding.v1',
    generatedBy: 'ou-ui-next-control-plane',
    operation: task.operation,
    moduleKind: 'port-forwarding',
    action:
      task.operation === 'forward.delete'
        ? 'remove_forward_rule'
        : task.operation === 'forward.update' ||
            task.operation === 'forward.apply' ||
            task.operation === 'forward.pause' ||
            task.operation === 'forward.resume'
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
      enabled,
      strategy: readForwardStrategy(metadata),
      tunnelMode: readTunnelMode(),
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
        monthlyResetDay,
        manualUsedTrafficGb: currentUsedTrafficGb,
        manualUsedTrafficBytes: bytesFromGb(currentUsedTrafficGb),
        rateLimitMbps: readNumber(metadata, 'rateLimitMbps', 0),
        rateLimitMode,
        rateLimitDirection: readRateLimitDirection(metadata, rateLimitMode, billingDirection),
        ipRateLimitMbps: readNumber(metadata, 'ipRateLimitMbps', 0),
        maxConnections: readNumber(metadata, 'maxConnections', 0),
        maxConnectionsPerIp: readNumber(metadata, 'maxConnectionsPerIp', 0)
      },
      billing: {
        direction: billingDirection,
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

function buildTunnelForwardingArtifact({ task, agentId }: RuntimeArtifactInput) {
  const metadata = task.metadata;
  const listenAddress = readString(metadata, 'listenAddress', readString(metadata, 'inAddress', '0.0.0.0'));
  const listenPort = readNumber(metadata, 'listenPort', 0);
  const targetAddress = readString(metadata, 'targetAddress', readString(metadata, 'probeTargetHost', '127.0.0.1'));
  const targetPort = readNumber(metadata, 'targetPort', readNumber(metadata, 'probeTargetPort', 0));
  const entryAgentIds = readStringArray(metadata, 'entryAgentIds', readStringArray(metadata, 'agentIds', [agentId]));
  const exitAgentIds = readStringArray(metadata, 'exitAgentIds', entryAgentIds);
  const quotaGb = readNumber(metadata, 'quotaGb', 0);
  const monthlyResetDay = clampResetDay(readNumber(metadata, 'monthlyResetDay', 1));
  const currentUsedTrafficGb = readNumber(metadata, 'currentUsedTrafficGb', 0);
  const protocol = readForwardProtocol(metadata);
  const tunnelType = readTunnelType(metadata, 'port-forward');
  const tunnelId = readString(metadata, 'tunnelId', task.targetId);
  const serviceName = `ou-tunnel-${task.targetId}-${agentId}`.replace(/[^a-zA-Z0-9_.@-]/g, '-');
  const billingDirection = readBillingDirection(metadata);
  const rateLimitMode = readRateLimitMode(metadata);

  return {
    artifactVersion: 'ou-ui.runtime.port-forwarding.v1',
    generatedBy: 'ou-ui-next-control-plane',
    operation: task.operation,
    moduleKind: 'port-forwarding',
    action: task.operation === 'tunnel.create' ? 'create_forward_rule' : 'apply_forward_rule',
    agentId,
    targetId: task.targetId,
    targetLabel: task.targetLabel,
    rule: {
      id: task.targetId,
      name: readString(metadata, 'name', task.targetLabel),
      ownerName: readString(metadata, 'ownerName', readString(metadata, 'accountId', 'default-owner')),
      tunnelId,
      enabled: readBoolean(metadata, 'enabled', true),
      strategy: readForwardStrategy(metadata),
      tunnelMode: readTunnelMode(),
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
        monthlyResetDay,
        manualUsedTrafficGb: currentUsedTrafficGb,
        manualUsedTrafficBytes: bytesFromGb(currentUsedTrafficGb),
        rateLimitMbps: readNumber(metadata, 'rateLimitMbps', 0),
        rateLimitMode,
        rateLimitDirection: readRateLimitDirection(metadata, rateLimitMode, billingDirection),
        ipRateLimitMbps: readNumber(metadata, 'ipRateLimitMbps', 0),
        maxConnections: readNumber(metadata, 'maxConnections', 0),
        maxConnectionsPerIp: readNumber(metadata, 'maxConnectionsPerIp', 0)
      },
      billing: {
        direction: billingDirection,
        trafficMultiplier: readNumber(metadata, 'trafficMultiplier', 1),
        pricePerGb: readNumber(metadata, 'pricePerGb', 0)
      },
      proxyProtocol: readBoolean(metadata, 'proxyProtocol', false),
      tunnel: {
        id: tunnelId,
        accountId: readString(metadata, 'accountId', `acct-${task.targetId}`),
        type: tunnelType,
        entryAgentIds,
        exitAgentIds,
        chain: Array.isArray(metadata?.chain) ? metadata.chain : [],
        probe: {
          targetHost: readString(metadata, 'probeTargetHost', targetAddress),
          targetPort: readNumber(metadata, 'probeTargetPort', targetPort)
        }
      }
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

  if (input.moduleKind === 'port-forwarding') {
    return input.task.operation.startsWith('tunnel.')
      ? buildTunnelForwardingArtifact(input)
      : buildForwardingArtifact(input);
  }

  return buildSystemArtifact(input);
}
