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
const telemetrySourceSchema = z.enum(['agent']);
const xrayProtocolSchema = z.enum(['vmess', 'vless', 'trojan', 'shadowsocks', 'http', 'mixed', 'tunnel', 'hysteria', 'wireguard', 'tun']);
const xrayStreamNetworkSchema = z.enum(['tcp', 'udp', 'ws', 'grpc', 'httpupgrade', 'splithttp']);
const xraySecuritySchema = z.enum(['none', 'tls', 'reality']);
const subscriptionSourceKindSchema = z.enum(['clash', 'mihomo-provider', 'v2ray-uri', 'sing-box', 'manual']);
const subscriptionDedupeKeySchema = z.enum(['server-port', 'uuid', 'name-region']);

const checksumSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/i);
const runtimeModuleKindSchema = z.enum(['host-agent', 'xray', 'gost', 'hysteria2', 'flvx', 'bbr', 'system']);
const reloadModeSchema = z.enum(['hot_reload', 'graceful_restart', 'staged_only']);
const forwardProtocolSchema = z.enum(['tcp', 'udp', 'tcp+udp']);
const forwardStrategySchema = z.enum(['fifo', 'round-robin', 'least-latency', 'weighted']);
const billingDirectionSchema = z.enum(['ingress', 'egress', 'both']);
const tunnelModeSchema = z.enum(['direct', 'relay', 'encrypted']);
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
    xrayProtocol: xrayProtocolSchema.optional(),
    clientIdentity: z.string().trim().min(1).max(255).optional(),
    streamNetwork: xrayStreamNetworkSchema.optional(),
    security: xraySecuritySchema.optional(),
    sni: z.string().trim().max(255).optional(),
    path: z.string().trim().max(255).optional(),
    flow: z.string().trim().max(80).optional(),
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
    tunnelId: z.string().trim().min(1).optional(),
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
  hostName: z.string().trim().min(1).max(120),
  installProfile: agentInstallProfileSchema,
  publicBaseUrl: z.string().trim().min(1).url().optional()
});

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

    if (hasHostOnboardingMetadata && !metadata.installProfile) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Agent host onboarding requires the complete install profile.',
        path: ['metadata', 'installProfile']
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
    uploadSpeedBps: z.number().nonnegative().optional(),
    downloadSpeedBps: z.number().nonnegative().optional(),
    uploadTotalBytes: z.number().nonnegative().optional(),
    downloadTotalBytes: z.number().nonnegative().optional(),
    monthlyTrafficUsedBytes: z.number().nonnegative().optional(),
    latencyMs: z.number().nonnegative().optional(),
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
    hardwareTelemetrySource: telemetrySourceSchema.optional()
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
