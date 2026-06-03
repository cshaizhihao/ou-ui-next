import type {
  Agent,
  AuditLog,
  DeployTask,
  ForwardRule,
  ManagedNode,
  PermissionGrant,
  QuotaPolicy,
  RateLimitPolicy,
  RoutingPolicy,
  RuntimeModule,
  SubscriptionBundle,
  SubscriptionSource,
  Tunnel,
  TuningProfile,
  XrayInbound
} from '../../domain';

const timestamp = '2026-06-02T00:00:00.000Z';

const runtimeModules: RuntimeModule[] = [
  {
    id: 'module-xray-hkg-01',
    kind: 'xray',
    label: 'Xray Protocol Runtime',
    version: '25.1.1',
    state: 'running',
    configVersion: 'cfg-20260602-001',
    hotReload: true,
    lastReloadAt: timestamp
  },
  {
    id: 'module-gost-hkg-01',
    kind: 'gost',
    label: 'GOST Relay Runtime',
    version: '3.1.0',
    state: 'running',
    configVersion: 'cfg-20260602-002',
    hotReload: true,
    lastReloadAt: timestamp
  },
  {
    id: 'module-flvx-hkg-01',
    kind: 'flvx',
    label: '端口转发运行时',
    version: '2.1.9',
    state: 'running',
    configVersion: 'cfg-20260602-003',
    hotReload: true,
    lastReloadAt: timestamp
  }
];

export const seedAgents: Agent[] = [
  {
    id: 'agent-hkg-01',
    name: '香港入口 Agent',
    status: 'online',
    region: 'ap-east-1',
    publicAddress: '103.45.12.xxx',
    connectionMode: 'websocket',
    version: '1.0.0-canary.3',
    platform: 'linux/amd64',
    capabilities: ['xray', 'gost', 'flvx'],
    maxTrafficBytes: 8 * 1024 * 1024 * 1024 * 1024,
    monthlyTrafficLimitBytes: 800 * 1024 * 1024 * 1024,
    expiresAt: '2026-09-08T23:59:59.000Z',
    probeConfig: {
      pingTarget: '1.1.1.1',
      pingIntervalSeconds: 30,
      latencyGreenMaxMs: 100,
      latencyYellowMaxMs: 200
    },
    trafficPolicy: {
      accountingMode: 'both',
      monthlyResetDay: 1,
      manualUsedTrafficBytes: 320 * 1024 * 1024 * 1024,
      telemetrySource: 'agent'
    },
    hardware: {
      cpuModel: 'AMD EPYC 7B13',
      kernelVersion: '6.8.0-31-generic',
      virtualization: 'KVM',
      primaryNetworkInterface: 'eth0',
      detectedAt: timestamp
    },
    lastHeartbeatAt: timestamp,
    telemetry: {
      cpuPercent: 18,
      cpuCores: 4,
      memoryPercent: 42,
      memoryUsedBytes: 1720 * 1024 * 1024,
      memoryTotalBytes: 4096 * 1024 * 1024,
      diskPercent: 39,
      diskUsedBytes: 49 * 1024 * 1024 * 1024,
      diskTotalBytes: 128 * 1024 * 1024 * 1024,
      txBytes: 1529000000000,
      rxBytes: 4135000000000,
      monthlyEgressBytes: 122 * 1024 * 1024 * 1024,
      monthlyIngressBytes: 260 * 1024 * 1024 * 1024,
      uploadSpeedBps: 20_190,
      downloadSpeedBps: 24_530,
      uploadTotalBytes: 5.91 * 1024 * 1024 * 1024,
      downloadTotalBytes: 6.2 * 1024 * 1024 * 1024,
      monthlyTrafficUsedBytes: 382 * 1024 * 1024 * 1024,
      latencyMs: 42,
      latencySamplesMs: [42, 45, 47, 51, 58, 61, 49, 44, 39, 42],
      packetLossPercent: 0.2,
      packetLossSamplesPercent: [0, 0, 0.2, 0, 0, 0.4, 0, 0, 0.1, 0],
      onlineDays: 15,
      uptimeSeconds: 15 * 24 * 60 * 60,
      reportedAt: timestamp
    }
  },
  {
    id: 'agent-sin-02',
    name: '新加坡转发 Agent',
    status: 'online',
    region: 'ap-southeast-1',
    publicAddress: '45.76.188.xxx',
    connectionMode: 'websocket',
    version: '1.0.0-canary.3',
    platform: 'linux/amd64',
    capabilities: ['xray', 'flvx'],
    maxTrafficBytes: 6 * 1024 * 1024 * 1024 * 1024,
    monthlyTrafficLimitBytes: 600 * 1024 * 1024 * 1024,
    expiresAt: '2026-08-20T23:59:59.000Z',
    probeConfig: {
      pingTarget: '8.8.8.8',
      pingIntervalSeconds: 30,
      latencyGreenMaxMs: 100,
      latencyYellowMaxMs: 200
    },
    trafficPolicy: {
      accountingMode: 'single',
      monthlyResetDay: 5,
      manualUsedTrafficBytes: 180 * 1024 * 1024 * 1024,
      telemetrySource: 'agent'
    },
    hardware: {
      cpuModel: 'Intel Xeon Platinum 8272CL',
      kernelVersion: '6.1.0-26-cloud-amd64',
      virtualization: 'KVM',
      primaryNetworkInterface: 'ens5',
      detectedAt: timestamp
    },
    lastHeartbeatAt: timestamp,
    telemetry: {
      cpuPercent: 24,
      cpuCores: 2,
      memoryPercent: 38,
      memoryUsedBytes: 1556 * 1024 * 1024,
      memoryTotalBytes: 4096 * 1024 * 1024,
      diskPercent: 46,
      diskUsedBytes: 58 * 1024 * 1024 * 1024,
      diskTotalBytes: 128 * 1024 * 1024 * 1024,
      txBytes: 892000000000,
      rxBytes: 1935000000000,
      monthlyEgressBytes: 93 * 1024 * 1024 * 1024,
      monthlyIngressBytes: 128 * 1024 * 1024 * 1024,
      uploadSpeedBps: 18_420,
      downloadSpeedBps: 27_120,
      uploadTotalBytes: 4.8 * 1024 * 1024 * 1024,
      downloadTotalBytes: 7.4 * 1024 * 1024 * 1024,
      monthlyTrafficUsedBytes: 221 * 1024 * 1024 * 1024,
      latencyMs: 142,
      latencySamplesMs: [88, 94, 101, 116, 128, 142, 153, 165, 138, 142],
      packetLossPercent: 1.1,
      packetLossSamplesPercent: [0, 0.4, 0, 1.2, 0, 0.8, 0, 2.2, 0, 0],
      onlineDays: 11,
      uptimeSeconds: 11 * 24 * 60 * 60,
      reportedAt: timestamp
    }
  },
  {
    id: 'agent-tyo-03',
    name: '东京备用 Agent',
    status: 'online',
    region: 'ap-northeast-1',
    publicAddress: '154.31.42.xxx',
    connectionMode: 'pull',
    version: '1.0.0-canary.3',
    platform: 'linux/amd64',
    capabilities: ['xray', 'flvx', 'hysteria2'],
    maxTrafficBytes: 4 * 1024 * 1024 * 1024 * 1024,
    monthlyTrafficLimitBytes: 400 * 1024 * 1024 * 1024,
    expiresAt: '2026-07-18T23:59:59.000Z',
    probeConfig: {
      pingTarget: 'www.cloudflare.com',
      pingIntervalSeconds: 30,
      latencyGreenMaxMs: 100,
      latencyYellowMaxMs: 200
    },
    trafficPolicy: {
      accountingMode: 'egress',
      monthlyResetDay: 10,
      manualUsedTrafficBytes: 96 * 1024 * 1024 * 1024,
      telemetrySource: 'agent'
    },
    hardware: {
      cpuModel: 'Intel Xeon E5-2686 v4',
      kernelVersion: '5.15.0-1057-aws',
      virtualization: 'Nitro',
      primaryNetworkInterface: 'eth0',
      detectedAt: timestamp
    },
    lastHeartbeatAt: timestamp,
    telemetry: {
      cpuPercent: 12,
      cpuCores: 2,
      memoryPercent: 31,
      memoryUsedBytes: 1269 * 1024 * 1024,
      memoryTotalBytes: 4096 * 1024 * 1024,
      diskPercent: 33,
      diskUsedBytes: 42 * 1024 * 1024 * 1024,
      diskTotalBytes: 128 * 1024 * 1024 * 1024,
      txBytes: 512000000000,
      rxBytes: 1120000000000,
      monthlyEgressBytes: 146 * 1024 * 1024 * 1024,
      monthlyIngressBytes: 84 * 1024 * 1024 * 1024,
      uploadSpeedBps: 12_900,
      downloadSpeedBps: 19_600,
      uploadTotalBytes: 2.9 * 1024 * 1024 * 1024,
      downloadTotalBytes: 5.2 * 1024 * 1024 * 1024,
      monthlyTrafficUsedBytes: 146 * 1024 * 1024 * 1024,
      latencyMs: 236,
      latencySamplesMs: [168, 182, 205, 214, 236, 248, 259, 224, 210, 236],
      packetLossPercent: 2.4,
      packetLossSamplesPercent: [0, 0.8, 0, 1.2, 2.8, 0, 1.6, 0, 0.4, 0],
      onlineDays: 7,
      uptimeSeconds: 7 * 24 * 60 * 60,
      reportedAt: timestamp
    }
  }
];

export const seedNodes: ManagedNode[] = [
  {
    id: 'node-hkg-edge-01',
    agentId: 'agent-hkg-01',
    name: '香港边缘接入节点',
    status: 'healthy',
    entrypoint: '103.45.12.xxx:443',
    activeInboundCount: 4,
    activeForwardCount: 7,
    updatedAt: timestamp,
    modules: runtimeModules
  },
  {
    id: 'node-sin-forward-02',
    agentId: 'agent-sin-02',
    name: '新加坡转发节点',
    status: 'healthy',
    entrypoint: '45.76.188.xxx:443',
    activeInboundCount: 2,
    activeForwardCount: 5,
    updatedAt: timestamp,
    modules: runtimeModules.filter((module) => module.kind !== 'gost')
  },
  {
    id: 'node-tyo-standby-03',
    agentId: 'agent-tyo-03',
    name: '东京备用节点',
    status: 'healthy',
    entrypoint: '154.31.42.xxx:443',
    activeInboundCount: 1,
    activeForwardCount: 3,
    updatedAt: timestamp,
    modules: runtimeModules.filter((module) => module.kind !== 'gost')
  }
];

export const seedInbounds: XrayInbound[] = [
  {
    id: 'inbound-vless-hkg-443',
    nodeId: 'node-hkg-edge-01',
    protocol: 'vless',
    label: 'Primary VLESS Gateway',
    listenAddress: '0.0.0.0',
    listenPort: 443,
    status: 'enabled',
    clients: [
      {
        id: 'client-ops-hkg',
        email: 'ops-hkg',
        enabled: true,
        trafficLimitBytes: 5 * 1024 * 1024 * 1024 * 1024,
        usedTrafficBytes: 1.2 * 1024 * 1024 * 1024 * 1024,
        expiresAt: '2026-12-31T23:59:59.000Z',
        ipLimit: 3
      }
    ],
    streamSettings: {
      network: 'tcp',
      security: 'reality',
      sni: 'hk.example.com',
      fingerprint: 'chrome'
    },
    tls: {
      enabled: true,
      certificateId: 'cert-hkg-01',
      alpn: ['h2', 'http/1.1']
    },
    reality: {
      enabled: true,
      publicKey: 'reality-public-key-preview',
      shortIds: ['a1b2c3d4'],
      serverNames: ['hk.example.com']
    },
    fallbacks: [
      {
        name: 'nginx-fallback',
        destination: '127.0.0.1:8443',
        xver: 0
      }
    ],
    sniffingEnabled: true,
    configVersion: 'cfg-20260602-inbound-001'
  }
];

export const seedSubscriptionSources: SubscriptionSource[] = [
  {
    id: 'source-mihomo-hkg',
    kind: 'mihomo-provider',
    name: 'Mihomo Provider / HKG',
    url: 'https://provider.example.com/hkg.yaml',
    status: 'synced',
    nodeCount: 84,
    dedupeKey: 'server-port',
    lastSyncAt: timestamp,
    rateLimitPerMinute: 60
  },
  {
    id: 'source-v2ray-eu',
    kind: 'v2ray-uri',
    name: 'V2Ray URI / EU',
    url: 'https://provider.example.com/eu.txt',
    status: 'warning',
    nodeCount: 41,
    dedupeKey: 'uuid',
    lastSyncAt: '2026-06-01T23:42:00.000Z',
    rateLimitPerMinute: 45
  }
];

export const seedTunnels: Tunnel[] = [
  {
    id: 'tunnel-global-premium',
    name: 'Global Premium Tunnel',
    accountId: 'acct-tunnel-01',
    type: 'relay-chain',
    status: 'active',
    entryAgentIds: ['agent-hkg-01'],
    exitAgentIds: ['agent-hkg-01'],
    chain: [
      {
        agentId: 'agent-hkg-01',
        region: 'ap-east-1',
        protocol: 'tcp+udp',
        address: '103.45.12.xxx:443',
        latencyMs: 42
      }
    ],
    trafficRatio: 1,
    protocol: 'tcp+udp',
    inAddress: '0.0.0.0',
    ipPreference: 'auto',
    probeTargetHost: 'www.cloudflare.com',
    probeTargetPort: 443,
    quotaPolicyId: 'quota-tunnel-01',
    rateLimitPolicyId: 'rate-tunnel-01'
  }
];

export const seedForwardRules: ForwardRule[] = [
  {
    id: 'forward-hkg-443',
    tunnelId: 'tunnel-global-premium',
    name: '端口转发隧道网络',
    ownerName: 'Acme Team',
    strategy: 'round-robin',
    resourceVersion: 'forward-forward-hkg-443-v1',
    enabled: true,
    ports: [
      {
        agentId: 'agent-hkg-01',
        listenAddress: '0.0.0.0',
        listenPort: 443,
        targetAddress: '10.12.0.8',
        targetPort: 8443,
        protocol: 'tcp+udp',
        status: 'allocated',
        runtimeServiceNames: ['forward-hkg-443_tcp', 'forward-hkg-443_udp']
      }
    ],
    portStatus: 'allocated',
    billingDirection: 'both',
    trafficMultiplier: 1,
    quotaPolicyId: 'quota-tunnel-01',
    rateLimitPolicyId: 'rate-tunnel-01',
    ipRateLimitPolicyId: 'rate-tunnel-01',
    maxConnections: 2048,
    maxConnectionsPerIp: 32,
    proxyProtocol: false,
    tunnelMode: 'encrypted',
    pricePerGb: 0.08,
    inboundBytes: 920000000000,
    outboundBytes: 1480000000000
  }
];

export const seedQuotaPolicies: QuotaPolicy[] = [
  {
    id: 'quota-tunnel-01',
    name: 'Tunnel Account Premium Cap',
    scope: 'tunnel-account',
    limitBytes: 8 * 1024 * 1024 * 1024 * 1024,
    usedBytes: 2.4 * 1024 * 1024 * 1024 * 1024,
    resetWindow: 'monthly',
    billingDirection: 'both',
    enforcementState: 'active'
  }
];

export const seedRateLimitPolicies: RateLimitPolicy[] = [
  {
    id: 'rate-tunnel-01',
    name: 'Premium Tunnel Bi-Directional Guard',
    inboundMbps: 600,
    outboundMbps: 600,
    mode: 'bi-directional'
  }
];

export const seedSubscriptionBundles: SubscriptionBundle[] = [
  {
    id: 'sub-global-premium',
    name: 'Global Premium Aggregation',
    enabled: true,
    strategy: 'balanced',
    sources: [
      {
        id: 'source-mihomo-hkg',
        name: 'Mihomo Provider / HKG',
        url: 'https://provider.example.com/hkg.yaml',
        nodeCount: 84,
        lastSyncAt: timestamp,
        status: 'ok'
      },
      {
        id: 'source-v2ray-eu',
        name: 'V2Ray URI / EU',
        url: 'https://provider.example.com/eu.txt',
        nodeCount: 41,
        lastSyncAt: '2026-06-01T23:42:00.000Z',
        status: 'warning'
      }
    ],
    exportTargets: ['Clash', 'Sing-box'],
    dedupe: true,
    healthScore: 88,
    generatedNodeCount: 125
  }
];

export const seedRoutingPolicies: RoutingPolicy[] = [
  {
    id: 'route-cn-direct',
    name: 'CN GeoIP Direct',
    enabled: true,
    match: 'geoip:cn OR geosite:cn',
    action: 'direct',
    priority: 10,
    targetGroup: 'DIRECT',
    hitCount: 184209,
    riskLevel: 'low'
  },
  {
    id: 'route-streaming-proxy',
    name: 'Streaming Proxy Group',
    enabled: true,
    match: 'geosite:netflix OR geosite:disney',
    action: 'proxy',
    priority: 20,
    targetGroup: 'Premium Media',
    hitCount: 38214,
    riskLevel: 'medium'
  }
];

export const seedTuningProfiles: TuningProfile[] = [
  {
    id: 'tune-bbr-edge',
    name: 'BBR Edge Throughput',
    enabled: true,
    target: 'kernel',
    riskLevel: 'medium',
    parameters: [
      { key: 'net.ipv4.tcp_congestion_control', value: 'bbr', status: 'backend_required' },
      { key: 'net.core.default_qdisc', value: 'fq', status: 'backend_required' }
    ]
  },
  {
    id: 'tune-runtime-reload',
    name: 'Runtime Hot Reload Guard',
    enabled: true,
    target: 'runtime',
    riskLevel: 'low',
    parameters: [
      { key: 'xray.reload.mode', value: 'graceful', status: 'pending' },
      { key: 'flvx.service.diff', value: 'enabled', status: 'pending' }
    ]
  }
];

export const seedPermissionGrants: PermissionGrant[] = [
  {
    id: 'grant-admin-tunnel',
    subjectType: 'user',
    subjectId: 'admin',
    resourceType: 'tunnel-group',
    resourceId: 'group-premium',
    permissions: ['read', 'operate', 'configure', 'grant'],
    grantedBy: 'system:bootstrap',
    reason: 'bootstrap owner permissions',
    resourceVersion: 'permv-0001',
    createdAt: timestamp,
    updatedAt: timestamp
  }
];

export const seedTasks: DeployTask[] = [];

export const seedAuditLogs: AuditLog[] = [];
