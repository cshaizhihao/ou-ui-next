import { z } from 'zod';

const deployTaskOperations = [
  'agent.deploy',
  'agent.upgrade',
  'agent.update',
  'agent.delete',
  'agent.rollback',
  'module.install',
  'inbound.create',
  'inbound.update',
  'inbound.delete',
  'config.compile',
  'config.apply',
  'runtime.reload',
  'forward.create',
  'forward.update',
  'forward.apply',
  'forward.delete',
  'forward.pause',
  'forward.resume',
  'tunnel.create',
  'tunnel.update',
  'tunnel.redeploy',
  'subscription.import',
  'subscription.sync',
  'subscription.export',
  'subscription.profile.upsert',
  'subscription.profile.delete',
  'subscription.generate',
  'subscription.delete',
  'quota.reset',
  'permission.grant',
  'permission.revoke',
  'system.tune'
] as const;

const deployResourceTypes = [
  'agent',
  'node',
  'module',
  'inbound',
  'subscription',
  'tunnel',
  'forward',
  'quota',
  'permission'
] as const;

const deployTaskStatuses = ['queued', 'running', 'succeeded', 'failed', 'retrying', 'rolled_back', 'canceled'] as const;
const resourcePermissions = ['read', 'operate', 'configure', 'grant'] as const;
const permissionResourceTypes = ['agent', 'node', 'tunnel', 'tunnel-group', 'subscription', 'forward-rule'] as const;
const agentInstallProfileComponents = ['host-agent', 'xray', 'port-forwarding', 'telemetry', 'command-channel'] as const;
const completeAgentInstallProfile = [...agentInstallProfileComponents];
const agentTrafficAccountingModeSchema = z.enum(['both', 'single', 'ingress', 'egress']);
const agentLatencyStatusSchema = z.enum(['green', 'yellow', 'red']);
const telemetrySourceSchema = z.enum(['agent']);
const xrayProtocolSchema = z.enum(['vmess', 'vless', 'trojan', 'shadowsocks', 'hysteria']);
const xrayInboundProtocolSchema = z.enum(['vmess', 'vless', 'trojan', 'shadowsocks']);
const xrayStreamNetworkSchema = z.enum(['tcp', 'udp', 'ws', 'grpc', 'httpupgrade', 'splithttp']);
const xraySecuritySchema = z.enum(['none', 'tls', 'reality']);
const xrayClientResetPolicySchema = z.enum(['never', 'daily', 'weekly', 'monthly']);
const subscriptionSourceKindSchema = z.enum(['clash', 'mihomo-provider', 'v2ray-uri', 'sing-box', 'manual']);
const subscriptionDedupeKeySchema = z.enum(['server-port', 'uuid', 'name-region']);
const subscriptionClientFormatSchema = z.enum(['plain', 'json', 'clash', 'mihomo', 'sing-box']);
const subscriptionClientOutputFormatSchema = z.enum(['uri', 'v2ray', 'clash', 'mihomo', 'sing-box']);
const subscriptionExportProfileClientSchema = z.enum(['clash', 'mihomo', 'surge', 'sing-box']);
const proxyGroupStrategySchema = z.enum(['select', 'url-test', 'fallback', 'load-balance']);

const checksumSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/i);
const runtimeModuleKindSchema = z.preprocess(
  (value) => (value === 'flvx' ? 'port-forwarding' : value),
  z.enum(['host-agent', 'xray', 'gost', 'hysteria2', 'port-forwarding', 'bbr', 'system'])
);
const reloadModeSchema = z.enum(['hot_reload', 'graceful_restart', 'staged_only']);
const forwardProtocolSchema = z.enum(['tcp', 'udp', 'tcp+udp']);
const forwardStrategySchema = z.enum(['fifo', 'round-robin', 'least-latency', 'weighted']);
const billingDirectionSchema = z.enum(['both', 'single', 'ingress', 'egress']);
const tunnelModeSchema = z.enum(['direct']);
const tunnelTypeSchema = z.enum(['port-forward']);
const tunnelStatusSchema = z.enum(['active', 'paused', 'degraded', 'deploying']);
const tunnelIpPreferenceSchema = z.enum(['ipv4', 'ipv6', 'auto']);
const agentInstallProfileSchema = z
  .array(z.enum(agentInstallProfileComponents))
  .length(completeAgentInstallProfile.length)
  .superRefine((profile, context) => {
    const uniqueProfile = new Set(profile);

    if (uniqueProfile.size !== profile.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Agent install profile components must be unique.'
      });
      return;
    }

    const missingComponent = completeAgentInstallProfile.find((component) => !uniqueProfile.has(component));

    if (missingComponent) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Agent install profile is missing ${missingComponent}.`
      });
    }
  });
const taskMetadataSchema = z
  .object({
    hostName: z.string().trim().min(1).max(120).optional(),
    runtimeHostName: z.string().trim().min(1).max(120).optional(),
    maxTrafficGb: z.number().int().nonnegative().optional(),
    monthlyTrafficGb: z.number().int().nonnegative().optional(),
    trafficAccountingMode: agentTrafficAccountingModeSchema.optional(),
    monthlyResetDay: z.number().int().min(1).max(31).optional(),
    currentUsedTrafficGb: z.number().nonnegative().optional(),
    expiresAt: z.string().datetime().optional(),
    pingTarget: z.string().trim().min(1).max(255).optional(),
    pingIntervalSeconds: z.literal(30).optional(),
    customerNodeName: z.string().trim().min(1).max(160).optional(),
    customerName: z.string().trim().min(1).max(160).optional(),
    remainingDays: z.number().int().nonnegative().optional(),
    nodeId: z.string().trim().min(1).max(160).optional(),
    agentId: z.string().trim().min(1).max(160).optional(),
    serverAddress: z.string().trim().min(1).max(255).optional(),
    xrayProtocol: xrayInboundProtocolSchema.optional(),
    clientIdentity: z.string().trim().min(1).max(255).optional(),
    clientEmail: z.string().trim().min(1).max(255).optional(),
    clientCredential: z.string().trim().min(1).max(255).optional(),
    clientLevel: z.number().int().nonnegative().max(65_535).optional(),
    clientComment: z.string().trim().max(500).optional(),
    telegramId: z.string().trim().max(120).optional(),
    resetPolicy: xrayClientResetPolicySchema.optional(),
    vmessSecurity: z.string().trim().min(1).max(80).optional(),
    shadowsocksMethod: z.string().trim().min(1).max(120).optional(),
    hysteriaAuth: z.string().trim().min(1).max(255).optional(),
    streamNetwork: xrayStreamNetworkSchema.optional(),
    security: xraySecuritySchema.optional(),
    sni: z.string().trim().max(255).optional(),
    path: z.string().trim().max(255).optional(),
    flow: z.string().trim().max(80).optional(),
    fingerprint: z.string().trim().max(80).optional(),
    alpn: z.array(z.string().trim().min(1).max(40)).optional(),
    realityPublicKey: z.string().trim().max(255).optional(),
    realityShortId: z.string().trim().max(32).optional(),
    fallbackName: z.string().trim().max(120).optional(),
    fallbackDestination: z.string().trim().max(255).optional(),
    fallbackXver: z.number().int().nonnegative().max(2).optional(),
    sniffingEnabled: z.boolean().optional(),
    ipLimit: z.number().int().nonnegative().optional(),
    trafficLimitGb: z.number().int().nonnegative().optional(),
    subscriptionRule: z.string().trim().min(1).max(500).optional(),
    installProfile: agentInstallProfileSchema.optional(),
    name: z.string().trim().min(1).max(160).optional(),
    ownerName: z.string().trim().min(1).max(160).optional(),
    sourceId: z.string().trim().min(1).max(160).optional(),
    kind: subscriptionSourceKindSchema.optional(),
    url: z.string().trim().min(1).url().optional(),
    userAgent: z.string().trim().min(1).max(255).optional(),
    refreshIntervalMinutes: z.number().int().positive().max(43_200).optional(),
    includeFilter: z.string().trim().max(500).optional(),
    excludeFilter: z.string().trim().max(500).optional(),
    dedupeKey: subscriptionDedupeKeySchema.optional(),
    formats: z.array(subscriptionClientFormatSchema).min(1).optional(),
    outputFormats: z.array(subscriptionClientOutputFormatSchema).min(1).optional(),
    templateName: z.string().trim().min(1).max(160).optional(),
    profileId: z.string().trim().min(1).max(160).optional(),
    client: subscriptionExportProfileClientSchema.optional(),
    proxyGroups: z
      .array(
        z.object({
          id: z.string().trim().min(1).max(160),
          name: z.string().trim().min(1).max(160),
          strategy: proxyGroupStrategySchema,
          filterTags: z.array(z.string().trim().min(1).max(120)).optional()
        })
      )
      .optional(),
    includeTrafficHeaders: z.boolean().optional(),
    tunnelId: z.string().trim().min(1).optional(),
    accountId: z.string().trim().min(1).max(160).optional(),
    type: tunnelTypeSchema.optional(),
    status: tunnelStatusSchema.optional(),
    entryAgentIds: z.array(z.string().trim().min(1)).min(1).optional(),
    exitAgentIds: z.array(z.string().trim().min(1)).min(1).optional(),
    chain: z
      .array(
        z.object({
          agentId: z.string().trim().min(1),
          region: z.string().trim().min(1).max(120),
          protocol: forwardProtocolSchema,
          address: z.string().trim().min(1).max(255),
          latencyMs: z.number().nonnegative()
        })
      )
      .optional(),
    trafficRatio: z.number().positive().optional(),
    inAddress: z.string().trim().min(1).max(255).optional(),
    ipPreference: tunnelIpPreferenceSchema.optional(),
    probeTargetHost: z.string().trim().min(1).max(255).optional(),
    probeTargetPort: z.number().int().min(1).max(65_535).optional(),
    quotaPolicyId: z.string().trim().min(1).max(160).optional(),
    rateLimitPolicyId: z.string().trim().min(1).max(160).optional(),
    listenAddress: z.string().trim().min(1).max(255).optional(),
    listenPort: z.number().int().min(1).max(65_535).optional(),
    targetAddress: z.string().trim().min(1).max(255).optional(),
    targetPort: z.number().int().min(1).max(65_535).optional(),
    protocol: z.union([forwardProtocolSchema, xrayProtocolSchema]).optional(),
    entryNodeIds: z.array(z.string().trim().min(1)).min(1).optional(),
    agentIds: z.array(z.string().trim().min(1)).min(1).optional(),
    strategy: forwardStrategySchema.optional(),
    quotaGb: z.number().int().nonnegative().optional(),
    rateLimitMbps: z.number().int().nonnegative().optional(),
    ipRateLimitMbps: z.number().int().nonnegative().optional(),
    maxConnections: z.number().int().nonnegative().optional(),
    maxConnectionsPerIp: z.number().int().nonnegative().optional(),
    proxyProtocol: z.boolean().optional(),
    billingDirection: billingDirectionSchema.optional(),
    tunnelMode: tunnelModeSchema.optional()
  })
  .catchall(z.unknown());

export const agentInstallCommandRequestSchema = z.object({
  installProfile: agentInstallProfileSchema,
  publicBaseUrl: z.string().trim().min(1).url().optional()
}).strict();

const agentCommandEnvelopeBaseSchema = z.object({
  commandId: z.string().trim().min(1).max(160),
  requestId: z.string().trim().min(1).max(160),
  taskId: z.string().trim().min(1).max(160),
  agentId: z.string().trim().min(1),
  sessionId: z.string().trim().min(1).max(160).optional(),
  seq: z.number().int().nonnegative(),
  issuedAt: z.string().datetime(),
  deadlineAt: z.string().datetime()
});

export const createTaskRequestSchema = z
  .object({
    operation: z.enum(deployTaskOperations),
    resourceType: z.enum(deployResourceTypes).optional(),
    targetId: z.string().trim().min(1),
    targetLabel: z.string().trim().min(1),
    summary: z.string().trim().min(1).max(240),
    metadata: taskMetadataSchema.optional(),
    permissionChange: z
      .object({
        subjectType: z.enum(['user', 'group']),
        subjectId: z.string().trim().min(1),
        resourceType: z.enum(permissionResourceTypes),
        resourceId: z.string().trim().min(1),
        permissions: z.array(z.enum(resourcePermissions)).min(1),
        reason: z.string().trim().min(1).max(500).optional(),
        expiresAt: z.string().datetime().optional()
      })
      .optional()
  })
  .superRefine((request, context) => {
    const metadata = request.metadata;
    const hasHostOnboardingMetadata =
      request.operation === 'agent.deploy' &&
      metadata !== undefined &&
      'hostName' in metadata;
    const requiresForwardingRuntimeMetadata =
      request.operation === 'forward.create' ||
      request.operation === 'forward.update';
    const requiresTunnelRuntimeMetadata =
      request.operation === 'tunnel.create' ||
      request.operation === 'tunnel.update' ||
      request.operation === 'tunnel.redeploy';
    const validatesForwardingRuntimeMetadata =
      requiresForwardingRuntimeMetadata ||
      requiresTunnelRuntimeMetadata ||
      (request.operation === 'forward.apply' && metadata !== undefined);

    if (hasHostOnboardingMetadata && !metadata.installProfile) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Agent host onboarding requires the complete install profile.',
        path: ['metadata', 'installProfile']
      });
    }

    if (validatesForwardingRuntimeMetadata) {
      if (!metadata) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: requiresTunnelRuntimeMetadata
            ? 'Port forwarding tunnel operations require runtime metadata.'
            : 'Port forwarding operations require runtime metadata.',
          path: ['metadata']
        });
        return;
      }

      if (metadata.listenPort === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: requiresTunnelRuntimeMetadata
            ? 'Port forwarding tunnel requires a listen port.'
            : 'Port forwarding requires a listen port.',
          path: ['metadata', 'listenPort']
        });
      }

      if (!metadata.targetAddress) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: requiresTunnelRuntimeMetadata
            ? 'Port forwarding tunnel requires a target address.'
            : 'Port forwarding requires a target address.',
          path: ['metadata', 'targetAddress']
        });
      }

      if (metadata.targetPort === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: requiresTunnelRuntimeMetadata
            ? 'Port forwarding tunnel requires a target port.'
            : 'Port forwarding requires a target port.',
          path: ['metadata', 'targetPort']
        });
      }

      if (requiresTunnelRuntimeMetadata && !metadata.entryAgentIds && !metadata.agentIds) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Port forwarding tunnel requires at least one entry host.',
          path: ['metadata', 'entryAgentIds']
        });
      }

      if (!requiresTunnelRuntimeMetadata && !metadata.entryNodeIds && !metadata.agentIds) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Port forwarding requires at least one entry host.',
          path: ['metadata', 'entryNodeIds']
        });
      }

      [
        ['ipRateLimitMbps', metadata.ipRateLimitMbps],
        ['maxConnections', metadata.maxConnections],
        ['maxConnectionsPerIp', metadata.maxConnectionsPerIp],
        ['proxyProtocol', metadata.proxyProtocol]
      ].forEach(([field, value]) => {
        const enabled = typeof value === 'number' ? value > 0 : value === true;

        if (enabled) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              'This port forwarding control is not supported by the current Agent runtime. Use rule-level rateLimitMbps, traffic quota, and billing counters instead.',
            path: ['metadata', field as string]
          });
        }
      });
    }
  });

export const transitionTaskRequestSchema = z.object({
  status: z.enum(deployTaskStatuses)
});

export const mutationContextSchema = z.object({
  actor: z.string().trim().min(1),
  operatorGroupId: z.string().trim().min(1).optional(),
  resourceGroupId: z.string().trim().min(1).optional(),
  sourceIp: z.string().trim().min(1),
  userAgent: z.string().trim().min(1).optional(),
  requestId: z.string().trim().min(1).max(160),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
  ifMatch: z.string().trim().min(1).max(200).optional()
});

export const agentApplyCommandPayloadSchema = z.object({
  configRevision: z.string().trim().min(1),
  moduleKind: runtimeModuleKindSchema,
  artifactUri: z.string().trim().min(1).optional(),
  checksum: checksumSchema,
  signature: z.string().trim().min(1).optional(),
  artifact: z.record(z.unknown()).optional(),
  preflightPlanId: z.string().trim().min(1).optional(),
  snapshotBeforeId: z.string().trim().min(1).optional(),
  applyMode: reloadModeSchema.optional(),
  dryRun: z.boolean().default(false),
  rollbackTaskId: z.string().trim().min(1).nullable().optional()
});

export const agentRollbackCommandPayloadSchema = z.object({
  snapshotId: z.string().trim().min(1),
  targetConfigRevision: z.string().trim().min(1),
  rollbackReason: z.string().trim().min(1).max(500),
  rollbackMode: z.enum(['hot_reload', 'graceful_restart'])
});

export const agentReloadCommandPayloadSchema = z.object({
  moduleKind: runtimeModuleKindSchema,
  moduleId: z.string().trim().min(1),
  configRevision: z.string().trim().min(1),
  reloadMode: reloadModeSchema
});

export const agentHealthCommandPayloadSchema = z
  .object({
    checks: z
      .array(z.enum(['process', 'port_bind', 'config_version', 'module_api', 'traffic_counter']))
      .min(1)
      .optional(),
    timeoutMs: z.number().int().positive().max(120_000).optional()
  })
  .default({});

export const agentTelemetryCommandPayloadSchema = z
  .object({
    intervalSeconds: z.number().int().positive().max(3600).optional(),
    includeRuntimeCounters: z.boolean().optional(),
    includeFlowSamples: z.boolean().optional(),
    scope: z.string().trim().min(1).optional()
  })
  .default({});

export const agentTelemetrySampleEventPayloadSchema = z
  .object({
    cpuPercent: z.number().min(0).optional(),
    cpuCores: z.number().int().positive().optional(),
    memoryPercent: z.number().min(0).optional(),
    memoryUsedBytes: z.number().nonnegative().optional(),
    memoryTotalBytes: z.number().nonnegative().optional(),
    diskPercent: z.number().min(0).optional(),
    diskUsedBytes: z.number().nonnegative().optional(),
    diskTotalBytes: z.number().nonnegative().optional(),
    txBytes: z.number().nonnegative().optional(),
    rxBytes: z.number().nonnegative().optional(),
    monthlyEgressBytes: z.number().nonnegative().optional(),
    monthlyIngressBytes: z.number().nonnegative().optional(),
    monthlyTrafficLimitBytes: z.number().nonnegative().optional(),
    quotaExceeded: z.boolean().optional(),
    hostExpired: z.boolean().optional(),
    runtimeDisabledByPolicy: z.boolean().optional(),
    guardrailReason: z.string().trim().min(1).max(160).optional(),
    trafficAccountingMode: agentTrafficAccountingModeSchema.optional(),
    monthlyResetDay: z.number().int().min(1).max(31).optional(),
    manualUsedTrafficBytes: z.number().nonnegative().optional(),
    uploadSpeedBps: z.number().nonnegative().optional(),
    downloadSpeedBps: z.number().nonnegative().optional(),
    uploadTotalBytes: z.number().nonnegative().optional(),
    downloadTotalBytes: z.number().nonnegative().optional(),
    monthlyTrafficUsedBytes: z.number().nonnegative().optional(),
    trafficBillingPeriod: z.string().regex(/^\d{4}-\d{2}-reset-\d{2}$/).optional(),
    latencyMs: z.number().nonnegative().optional(),
    latencyStatus: agentLatencyStatusSchema.optional(),
    latencySamplesMs: z.array(z.number().nonnegative()).optional(),
    packetLossPercent: z.number().min(0).optional(),
    packetLossSamplesPercent: z.array(z.number().min(0)).optional(),
    onlineDays: z.number().int().nonnegative().optional(),
    uptimeSeconds: z.number().int().nonnegative().optional(),
    reportedAt: z.string().datetime().optional(),
    cpuModel: z.string().trim().min(1).max(160).optional(),
    kernelVersion: z.string().trim().min(1).max(160).optional(),
    virtualization: z.string().trim().min(1).max(120).optional(),
    primaryNetworkInterface: z.string().trim().min(1).max(120).optional(),
    hardwareDetectedAt: z.string().datetime().optional(),
    trafficTelemetrySource: telemetrySourceSchema.optional(),
    hardwareTelemetrySource: telemetrySourceSchema.optional(),
    xrayClientCounters: z
      .array(
        z.object({
          inboundId: z.string().trim().min(1).optional(),
          inboundTag: z.string().trim().min(1).optional(),
          agentId: z.string().trim().min(1).optional(),
          clientEmail: z.string().trim().min(1).optional(),
          clientId: z.string().trim().min(1).optional(),
          uplinkBytes: z.number().nonnegative().optional(),
          downlinkBytes: z.number().nonnegative().optional(),
          usedTrafficBytes: z.number().nonnegative().optional(),
          trafficLimitBytes: z.number().nonnegative().optional(),
          monthlyResetDay: z.number().int().min(1).max(31).optional(),
          quotaExceeded: z.boolean().optional(),
          clientExpired: z.boolean().optional(),
          runtimeDisabledByPolicy: z.boolean().optional(),
          guardrailReason: z.string().trim().min(1).max(160).optional(),
          sampledAt: z.string().datetime().optional(),
          trafficBillingPeriod: z.string().regex(/^\d{4}-\d{2}-reset-\d{2}$/).optional(),
          source: z.enum(['xray-stats', 'agent']).optional()
        })
      )
      .optional(),
    forwardingCounters: z
      .array(
        z.object({
          ruleId: z.string().trim().min(1).optional(),
          agentId: z.string().trim().min(1).optional(),
          serviceName: z.string().trim().min(1).optional(),
          listenAddress: z.string().trim().min(1).optional(),
          listenPort: z.number().int().positive().optional(),
          targetAddress: z.string().trim().min(1).optional(),
          targetPort: z.number().int().positive().optional(),
          protocol: z.enum(['tcp', 'udp', 'tcp+udp']).optional(),
          inboundBytes: z.number().nonnegative().optional(),
          outboundBytes: z.number().nonnegative().optional(),
          sampledAt: z.string().datetime().optional(),
          source: z.enum(['agent', 'nftables', 'gost']).optional(),
          trafficBillingPeriod: z.string().regex(/^\d{4}-\d{2}-reset-\d{2}$/).optional()
        })
      )
      .optional(),
    forwardingGuardrails: z
      .array(
        z.object({
          ruleId: z.string().trim().min(1),
          serviceName: z.string().trim().min(1).optional(),
          quotaBytes: z.number().nonnegative().optional(),
          billedTrafficBytes: z.number().nonnegative().optional(),
          quotaExceeded: z.boolean().optional(),
          runtimeDisabledByPolicy: z.boolean().optional(),
          guardrailReason: z.string().trim().min(1).max(160).optional(),
          stoppedUnits: z.array(z.string().trim().min(1)).optional(),
          evaluatedAt: z.string().datetime().optional(),
          trafficBillingPeriod: z.string().regex(/^\d{4}-\d{2}-reset-\d{2}$/).optional()
        })
      )
      .optional()
  })
  .passthrough();

export const agentCommandEnvelopeSchema = z.discriminatedUnion('type', [
  agentCommandEnvelopeBaseSchema.extend({
    type: z.literal('apply'),
    payload: agentApplyCommandPayloadSchema
  }),
  agentCommandEnvelopeBaseSchema.extend({
    type: z.literal('rollback'),
    payload: agentRollbackCommandPayloadSchema
  }),
  agentCommandEnvelopeBaseSchema.extend({
    type: z.literal('reload'),
    payload: agentReloadCommandPayloadSchema
  }),
  agentCommandEnvelopeBaseSchema.extend({
    type: z.literal('health'),
    payload: agentHealthCommandPayloadSchema
  }),
  agentCommandEnvelopeBaseSchema.extend({
    type: z.literal('telemetry'),
    payload: agentTelemetryCommandPayloadSchema
  })
]);

const agentEventEnvelopeBaseSchema = z.object({
  eventId: z.string().trim().min(1).max(160),
  agentId: z.string().trim().min(1),
  seq: z.number().int().nonnegative(),
  sessionId: z.string().trim().min(1).max(160),
  observedAt: z.string().datetime()
});

const commandScopedAgentEventSchema = agentEventEnvelopeBaseSchema.extend({
  commandId: z.string().trim().min(1).max(160),
  taskId: z.string().trim().min(1).max(160)
});

export const agentEventEnvelopeSchema = z.discriminatedUnion('type', [
  commandScopedAgentEventSchema.extend({
    type: z.literal('ack'),
    payload: z
      .object({
        duplicate: z.boolean().optional()
      })
      .default({})
  }),
  agentEventEnvelopeBaseSchema.extend({
    type: z.literal('heartbeat'),
    payload: z.object({
      version: z.string().trim().min(1).optional(),
      uptimeSeconds: z.number().int().nonnegative().optional(),
      capabilities: z.array(runtimeModuleKindSchema).optional(),
      lastSeenCommandSeq: z.number().int().nonnegative().optional()
    })
  }),
  commandScopedAgentEventSchema.extend({
    type: z.literal('result'),
    payload: z.object({
      status: z.enum(['succeeded', 'failed', 'rolled_back']),
      appliedConfigRevision: z.string().trim().min(1).optional(),
      healthSummary: z.record(z.unknown()).optional(),
      changedFiles: z.array(z.string().trim().min(1)).optional(),
      failureReason: z.string().trim().min(1).max(500).optional(),
      exitCode: z.number().int().optional(),
      retryable: z.boolean().optional()
    })
  }),
  commandScopedAgentEventSchema.extend({
    type: z.literal('log_chunk'),
    payload: z.object({
      chunkSeq: z.number().int().positive(),
      stream: z.enum(['stdout', 'stderr', 'agent', 'runtime']),
      content: z.string().max(65_536)
    })
  }),
  agentEventEnvelopeBaseSchema.extend({
    type: z.literal('telemetry_sample'),
    payload: agentTelemetrySampleEventPayloadSchema
  })
]);

export const agentPollRequestSchema = z.object({
  agentId: z.string().trim().min(1),
  requestId: z.string().trim().min(1).max(160),
  sessionId: z.string().trim().min(1).max(160).optional(),
  lastSeenCommandSeq: z.number().int().nonnegative().optional()
});

export const agentRegistrationRequestSchema = z.object({
  agentId: z.string().trim().min(1),
  requestId: z.string().trim().min(1).max(160),
  sessionId: z.string().trim().min(1).max(160).optional(),
  version: z.string().trim().min(1).max(80).optional(),
  platform: z.string().trim().min(1).max(160).optional(),
  capabilities: z.array(z.enum(agentInstallProfileComponents)).optional()
});

export const agentCredentialRevokeRequestSchema = z.object({
  reason: z.string().trim().min(1).max(500)
});

export const agentCredentialRotateRequestSchema = z.object({
  reason: z.string().trim().min(1).max(500)
});

export const agentEventsRequestSchema = z.object({
  events: z.array(agentEventEnvelopeSchema).min(1)
});

export type CreateTaskRequestDto = z.infer<typeof createTaskRequestSchema>;
export type AgentInstallCommandRequestDto = z.infer<typeof agentInstallCommandRequestSchema>;
export type TransitionTaskRequestDto = z.infer<typeof transitionTaskRequestSchema>;
export type MutationContextDto = z.infer<typeof mutationContextSchema>;
export type AgentCommandEnvelope = z.infer<typeof agentCommandEnvelopeSchema>;
export type AgentEventEnvelope = z.infer<typeof agentEventEnvelopeSchema>;
export type AgentPollRequestDto = z.infer<typeof agentPollRequestSchema>;
export type AgentRegistrationRequestDto = z.infer<typeof agentRegistrationRequestSchema>;
export type AgentCredentialRevokeRequestDto = z.infer<typeof agentCredentialRevokeRequestSchema>;
export type AgentCredentialRotateRequestDto = z.infer<typeof agentCredentialRotateRequestSchema>;
export type AgentEventsRequestDto = z.infer<typeof agentEventsRequestSchema>;

export function parseCreateTaskRequest(value: unknown): CreateTaskRequestDto {
  const result = createTaskRequestSchema.safeParse(value);

  if (!result.success) {
    throw new Error(`Invalid create task request: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`);
  }

  return result.data;
}

export function parseAgentInstallCommandRequest(value: unknown): AgentInstallCommandRequestDto {
  const result = agentInstallCommandRequestSchema.safeParse(value);

  if (!result.success) {
    throw new Error(`Invalid Agent install command request: ${result.error.message}`);
  }

  return result.data;
}

export function parseMutationContext(value: unknown): MutationContextDto {
  const result = mutationContextSchema.safeParse(value);

  if (!result.success) {
    throw new Error(`Invalid mutation context: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`);
  }

  return result.data;
}

export function parseTransitionTaskRequest(value: unknown): TransitionTaskRequestDto {
  const result = transitionTaskRequestSchema.safeParse(value);

  if (!result.success) {
    throw new Error(`Invalid transition task request: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`);
  }

  return result.data;
}

export function parseAgentEventEnvelope(value: unknown): AgentEventEnvelope {
  const result = agentEventEnvelopeSchema.safeParse(value);

  if (!result.success) {
    throw new Error(`Invalid agent event envelope: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`);
  }

  return result.data;
}

export function parseAgentPollRequest(value: unknown): AgentPollRequestDto {
  const result = agentPollRequestSchema.safeParse(value);

  if (!result.success) {
    throw new Error(`Invalid agent poll request: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`);
  }

  return result.data;
}

export function parseAgentRegistrationRequest(value: unknown): AgentRegistrationRequestDto {
  const result = agentRegistrationRequestSchema.safeParse(value);

  if (!result.success) {
    throw new Error(`Invalid agent registration request: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`);
  }

  return result.data;
}

export function parseAgentCredentialRevokeRequest(value: unknown): AgentCredentialRevokeRequestDto {
  const result = agentCredentialRevokeRequestSchema.safeParse(value);

  if (!result.success) {
    throw new Error(`Invalid agent credential revoke request: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`);
  }

  return result.data;
}

export function parseAgentCredentialRotateRequest(value: unknown): AgentCredentialRotateRequestDto {
  const result = agentCredentialRotateRequestSchema.safeParse(value);

  if (!result.success) {
    throw new Error(`Invalid agent credential rotate request: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`);
  }

  return result.data;
}

export function parseAgentEventsRequest(value: unknown): AgentEventsRequestDto {
  const result = agentEventsRequestSchema.safeParse(value);

  if (!result.success) {
    throw new Error(`Invalid agent events request: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`);
  }

  return result.data;
}
