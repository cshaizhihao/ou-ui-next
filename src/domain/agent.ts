import type { RuntimeModuleKind } from './module';

export type AgentStatus = 'online' | 'offline' | 'degraded' | 'provisioning';

export type AgentConnectionMode = 'websocket' | 'http' | 'pull' | 'ssh-bootstrap';

export type AgentTelemetry = {
  cpuPercent: number;
  memoryPercent: number;
  txBytes: number;
  rxBytes: number;
  latencyMs: number;
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
  lastHeartbeatAt: string;
  telemetry: AgentTelemetry;
};
