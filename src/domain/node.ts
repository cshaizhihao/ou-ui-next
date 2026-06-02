import type { RuntimeModule } from './module';

export type ManagedNodeStatus = 'healthy' | 'warning' | 'offline' | 'applying';

export type ManagedNode = {
  id: string;
  agentId: string;
  name: string;
  status: ManagedNodeStatus;
  entrypoint: string;
  modules: RuntimeModule[];
  activeInboundCount: number;
  activeForwardCount: number;
  updatedAt: string;
};
