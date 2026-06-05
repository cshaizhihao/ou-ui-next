import { createMockApi } from '../mock/mock-api';
import type { ControlPlaneApi } from './control-plane-api';
import { createHttpControlPlaneClient } from './http-control-plane-client';

export type ControlPlaneApiMode = 'mock' | 'http';

type ControlPlaneApiEnv = Record<string, string | boolean | undefined> & {
  MODE?: string;
  PROD?: boolean;
  VITE_CONTROL_PLANE_MODE?: string;
  VITE_CONTROL_PLANE_BASE_URL?: string;
  VITE_CONTROL_PLANE_AGENT_ID?: string;
  VITE_CONTROL_PLANE_OPERATOR_TOKEN?: string;
  VITE_CONTROL_PLANE_AGENT_TOKEN?: string;
  VITE_CONTROL_PLANE_MOCK_SEEDED?: string | boolean;
};

type CreateControlPlaneApiOptions = {
  env?: ControlPlaneApiEnv;
  fetcher?: typeof fetch;
  getCsrfToken?: () => string | undefined;
};

export function resolveControlPlaneApiMode(env: ControlPlaneApiEnv): ControlPlaneApiMode {
  if (env.PROD) {
    return 'http';
  }

  if (env.VITE_CONTROL_PLANE_MODE === 'http') {
    return 'http';
  }

  if (typeof env.VITE_CONTROL_PLANE_BASE_URL === 'string' && env.VITE_CONTROL_PLANE_BASE_URL.trim() !== '') {
    return 'http';
  }

  return 'mock';
}

function parseBooleanFlag(value: string | boolean | undefined) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value !== 'string') {
    return false;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

export function createControlPlaneApi(options: CreateControlPlaneApiOptions = {}): ControlPlaneApi {
  const env = options.env ?? import.meta.env;
  const mode = resolveControlPlaneApiMode(env);

  if (mode === 'mock') {
    const seededInventory = parseBooleanFlag(env.VITE_CONTROL_PLANE_MOCK_SEEDED);
    return createMockApi({ seedInventory: seededInventory });
  }

  if (!env.VITE_CONTROL_PLANE_BASE_URL) {
    throw new Error('VITE_CONTROL_PLANE_BASE_URL is required when VITE_CONTROL_PLANE_MODE=http.');
  }

  return createHttpControlPlaneClient({
    baseUrl: env.VITE_CONTROL_PLANE_BASE_URL,
    defaultAgentId: env.VITE_CONTROL_PLANE_AGENT_ID,
    operatorBearerToken: env.VITE_CONTROL_PLANE_OPERATOR_TOKEN,
    agentBearerToken: env.VITE_CONTROL_PLANE_AGENT_TOKEN,
    getCsrfToken: options.getCsrfToken,
    fetcher: options.fetcher
  });
}
