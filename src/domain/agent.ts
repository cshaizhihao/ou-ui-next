import type { RuntimeModuleKind } from './module';

export type AgentStatus = 'online' | 'offline' | 'degraded' | 'provisioning';

export type AgentConnectionMode = 'websocket' | 'http' | 'pull' | 'ssh-bootstrap';

export type AgentProbeConfig = {
  pingTarget: string;
  pingIntervalSeconds: number;
  latencyGreenMaxMs: number;
  latencyYellowMaxMs: number;
};

export type AgentTelemetry = {
  cpuPercent: number;
  cpuCores?: number;
  memoryPercent: number;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  diskPercent?: number;
  diskUsedBytes: number;
  diskTotalBytes: number;
  txBytes: number;
  rxBytes: number;
  uploadSpeedBps: number;
  downloadSpeedBps: number;
  uploadTotalBytes: number;
  downloadTotalBytes: number;
  monthlyTrafficUsedBytes: number;
  latencyMs: number;
  latencySamplesMs: number[];
  packetLossPercent: number;
  packetLossSamplesPercent: number[];
  onlineDays: number;
};

export type Agent = {
  id: string;
  name: string;
  status: AgentStatus;
  region: string;
  publicAddress: string;
  connectionMode: AgentConnectionMode;
  version: string;
  platform: string;
  capabilities: RuntimeModuleKind[];
  maxTrafficBytes: number;
  monthlyTrafficLimitBytes: number;
  expiresAt: string;
  probeConfig: AgentProbeConfig;
  lastHeartbeatAt: string;
  telemetry: AgentTelemetry;
};
