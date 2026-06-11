import type { RuntimeModuleKind } from './module';

export type AgentStatus = 'online' | 'offline' | 'degraded' | 'provisioning';

export type AgentConnectionMode = 'websocket' | 'http' | 'pull' | 'ssh-bootstrap';

export type AgentRuntimeCapability = RuntimeModuleKind | 'telemetry' | 'command-channel' | 'self-update';

export type AgentSessionRuntimeCapability = AgentRuntimeCapability | 'system';

export const DEFAULT_AGENT_TELEMETRY_SAMPLE_INTERVAL_SECONDS = 1;

export const AGENT_TRAFFIC_ACCOUNTING_MODES = ['both', 'single', 'ingress', 'egress'] as const;

export type AgentTrafficAccountingMode = (typeof AGENT_TRAFFIC_ACCOUNTING_MODES)[number];

export type AgentLatencyStatus = 'green' | 'yellow' | 'red';

export type AgentTelemetrySampleGapReason =
  | 'no_telemetry_sample'
  | 'stale_telemetry_sample'
  | 'invalid_telemetry_timestamp';

export type AgentRuntimeServiceHealth = {
  name: string;
  moduleKind: RuntimeModuleKind | 'agent';
  status: 'active' | 'inactive' | 'failed' | 'missing' | 'unknown';
  enabled?: boolean;
  required: boolean;
  checkedAt: string;
  detail?: string;
};

export type AgentProbeConfig = {
  pingTarget: string;
  pingIntervalSeconds: number;
  latencyGreenMaxMs: number;
  latencyYellowMaxMs: number;
};

export type AgentTrafficPolicy = {
  accountingMode: AgentTrafficAccountingMode;
  monthlyResetDay: number;
  manualUsedTrafficBytes: number;
  telemetrySource: 'agent';
};

export type AgentHardwareProfile = {
  cpuModel?: string;
  kernelVersion?: string;
  virtualization?: string;
  primaryNetworkInterface?: string;
  detectedAt?: string;
};

export type AgentTelemetry = {
  cpuPercent: number;
  cpuCores?: number;
  loadAverage1m?: number;
  loadAverage5m?: number;
  loadAverage15m?: number;
  memoryPercent: number;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  diskPercent?: number;
  diskUsedBytes: number;
  diskTotalBytes: number;
  txBytes: number;
  rxBytes: number;
  monthlyEgressBytes?: number;
  monthlyIngressBytes?: number;
  monthlyTrafficLimitBytes?: number;
  quotaExceeded?: boolean;
  hostExpired?: boolean;
  runtimeDisabledByPolicy?: boolean;
  guardrailReason?: string;
  hostGuardrailStoppedUnits?: string[];
  hostGuardrailRestoredUnits?: string[];
  uploadSpeedBps: number;
  downloadSpeedBps: number;
  uploadTotalBytes: number;
  downloadTotalBytes: number;
  monthlyTrafficUsedBytes: number;
  trafficBillingPeriod?: string;
  latencyMs: number;
  latencyStatus?: AgentLatencyStatus;
  latencySamplesMs: number[];
  jitterMs?: number;
  jitterSamplesMs?: number[];
  packetLossPercent: number;
  packetLossSamplesPercent: number[];
  onlineDays: number;
  uptimeSeconds?: number;
  runtimeServices?: AgentRuntimeServiceHealth[];
  reportedAt?: string;
  samplingExpectedSince?: string;
  sampleIntervalSeconds?: number;
  sampleGapDetected?: boolean;
  sampleGapSeconds?: number;
  expectedSamplingIntervalSeconds?: number;
  sampleGapReason?: AgentTelemetrySampleGapReason;
};

export type Agent = {
  id: string;
  name: string;
  runtimeHostName?: string;
  status: AgentStatus;
  region: string;
  publicAddress: string;
  connectionMode: AgentConnectionMode;
  version: string;
  platform: string;
  capabilities: AgentRuntimeCapability[];
  maxTrafficBytes: number;
  monthlyTrafficLimitBytes: number;
  expiresAt: string;
  probeConfig: AgentProbeConfig;
  trafficPolicy: AgentTrafficPolicy;
  hardware: AgentHardwareProfile;
  lastHeartbeatAt: string;
  telemetry: AgentTelemetry;
};

export type AgentSessionSummary = {
  agentId: string;
  sessionId: string;
  status: Extract<AgentStatus, 'online' | 'degraded' | 'offline'>;
  lastSeq: number;
  lastSeenCommandSeq?: number;
  version?: string;
  capabilities?: AgentSessionRuntimeCapability[];
  lastHeartbeatAt?: string;
  updatedAt: string;
};
