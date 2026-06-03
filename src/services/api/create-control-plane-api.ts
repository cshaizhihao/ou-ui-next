import { createMockApi } from '../mock/mock-api';
import type { ControlPlaneApi } from './control-plane-api';
import { createHttpControlPlaneClient } from './http-control-plane-client';

export type ControlPlaneApiMode = 'mock' | 'http';

type ControlPlaneApiEnv = Record<string, string | boolean | undefined> & {
  VITE_CONTROL_PLANE_MODE?: string;
  VITE_CONTROL_PLANE_BASE_URL?: string;
  VITE_CONTROL_PLANE_AGENT_ID?: string;
  VITE_CONTROL_PLANE_OPERATOR_TOKEN?: string;
  VITE_CONTROL_PLANE_AGENT_TOKEN?: string;
};

type CreateControlPlaneApiOptions = {
  env?: ControlPlaneApiEnv;
  fetcher?: typeof fetch;
};

export function resolveControlPlaneApiMode(env: ControlPlaneApiEnv): ControlPlaneApiMode {
  if (env.VITE_CONTROL_PLANE_MODE === 'http') {
    return 'http';
  }

  if (typeof env.VITE_CONTROL_PLANE_BASE_URL === 'string' && env.VITE_CONTROL_PLANE_BASE_URL.trim() !== '') {
    return 'http';
  }

  return 'mock';
}

export function createControlPlaneApi(options: CreateControlPlaneApiOptions = {}): ControlPlaneApi {
  const env = options.env ?? import.meta.env;
  const mode = resolveControlPlaneApiMode(env);

  if (mode === 'mock') {
    return createMockApi();
  }

  if (!env.VITE_CONTROL_PLANE_BASE_URL) {
    throw new Error('VITE_CONTROL_PLANE_BASE_URL is required when VITE_CONTROL_PLANE_MODE=http.');
  }

  return createHttpControlPlaneClient({
    baseUrl: env.VITE_CONTROL_PLANE_BASE_URL,
    defaultAgentId: env.VITE_CONTROL_PLANE_AGENT_ID,
    operatorBearerToken: env.VITE_CONTROL_PLANE_OPERATOR_TOKEN,
    agentBearerToken: env.VITE_CONTROL_PLANE_AGENT_TOKEN,
    fetcher: options.fetcher
  });
}
