import type { HttpControlPlaneAuthOptions } from '../../services/api/http-control-plane-server';
import {
  DEFAULT_AGENT_LOG_RETENTION_MAX_AGE_MS,
  DEFAULT_AGENT_LOG_RETENTION_MAX_EVENTS_PER_AGENT,
  type AgentLogRetentionPolicy
} from './agent-log-retention';

export type HttpControlPlaneRuntimeConfig = {
  host: string;
  port: number;
  initialState: 'seeded' | 'empty';
  agentLogRetention: AgentLogRetentionPolicy;
  commandTimeoutSweep: {
    enabled: boolean;
    intervalMs: number;
    ackTimeoutMs: number;
    resultTimeoutMs: number;
    maxCommands: number;
  };
  storage:
    | {
        type: 'memory';
      }
    | {
        type: 'file';
        stateFilePath: string;
      };
  auth?: HttpControlPlaneAuthOptions;
};

type RuntimeConfigEnv = Record<string, string | undefined>;

function hasValue(value: string | undefined): value is string {
  return Boolean(value && value.trim().length > 0);
}

function parsePositiveNumber(value: string | undefined, envName: string, fallback: number) {
  if (!hasValue(value)) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${envName} must be a positive number.`);
  }

  return parsed;
}

function parseNonNegativeInteger(value: string | undefined, envName: string, fallback: number) {
  if (!hasValue(value)) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${envName} must be a non-negative integer.`);
  }

  return parsed;
}

function parsePositiveInteger(value: string | undefined, envName: string, fallback: number) {
  if (!hasValue(value)) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${envName} must be a positive integer.`);
  }

  return parsed;
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (!hasValue(value)) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();

  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  throw new Error('Boolean environment values must be one of true/false/1/0/yes/no/on/off.');
}

function parseAgentTokensJson(value: string | undefined): HttpControlPlaneAuthOptions['agentTokens'] | undefined {
  if (!hasValue(value)) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('agent token map must be an object');
    }

    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter(([agentId, token]) => hasValue(agentId) && typeof token === 'string' && hasValue(token))
        .map(([agentId, token]) => [
          token as string,
          {
            agentId
          }
        ])
    );
  } catch {
    throw new Error('OU_UI_CONTROL_PLANE_AGENT_TOKENS_JSON must be a JSON object mapping agentId to token.');
  }
}

function resolveAuth(env: RuntimeConfigEnv): HttpControlPlaneAuthOptions | undefined {
  const operatorToken = env.OU_UI_CONTROL_PLANE_OPERATOR_TOKEN;
  const operatorTokens = hasValue(operatorToken)
    ? {
      [operatorToken as string]: {
          actor: env.OU_UI_CONTROL_PLANE_OPERATOR_ACTOR ?? 'local-operator',
          operatorGroupId: env.OU_UI_CONTROL_PLANE_OPERATOR_GROUP_ID,
          resourceGroupId: env.OU_UI_CONTROL_PLANE_RESOURCE_GROUP_ID
        }
      }
    : undefined;
  const agentTokens = parseAgentTokensJson(env.OU_UI_CONTROL_PLANE_AGENT_TOKENS_JSON);
  const hasAgentTokens = Boolean(agentTokens && Object.keys(agentTokens).length > 0);

  if (!operatorTokens && !hasAgentTokens) {
    return undefined;
  }

  return {
    ...(operatorTokens ? { operatorTokens } : {}),
    ...(hasAgentTokens ? { agentTokens } : {})
  };
}

export function resolveHttpControlPlaneRuntimeConfig(env: RuntimeConfigEnv): HttpControlPlaneRuntimeConfig {
  const host = env.OU_UI_CONTROL_PLANE_HOST ?? '127.0.0.1';
  const port = Number(env.OU_UI_CONTROL_PLANE_PORT ?? 4010);
  const storage = env.OU_UI_CONTROL_PLANE_STORAGE ?? 'memory';
  const initialState = env.OU_UI_CONTROL_PLANE_INITIAL_STATE === 'seeded' ? 'seeded' : 'empty';
  const agentLogRetentionDays = parsePositiveNumber(
    env.OU_UI_AGENT_LOG_RETENTION_DAYS,
    'OU_UI_AGENT_LOG_RETENTION_DAYS',
    DEFAULT_AGENT_LOG_RETENTION_MAX_AGE_MS / 24 / 60 / 60 / 1000
  );
  const agentLogRetention = {
    maxAgeMs: Math.round(agentLogRetentionDays * 24 * 60 * 60 * 1000),
    maxEventsPerAgent: parseNonNegativeInteger(
      env.OU_UI_AGENT_LOG_MAX_EVENTS_PER_AGENT,
      'OU_UI_AGENT_LOG_MAX_EVENTS_PER_AGENT',
      DEFAULT_AGENT_LOG_RETENTION_MAX_EVENTS_PER_AGENT
    )
  };
  const commandTimeoutSweep = {
    enabled: parseBoolean(env.OU_UI_COMMAND_TIMEOUT_SWEEP_ENABLED, true),
    intervalMs: parsePositiveInteger(
      env.OU_UI_COMMAND_TIMEOUT_SWEEP_INTERVAL_MS,
      'OU_UI_COMMAND_TIMEOUT_SWEEP_INTERVAL_MS',
      30_000
    ),
    ackTimeoutMs: parsePositiveInteger(env.OU_UI_COMMAND_ACK_TIMEOUT_MS, 'OU_UI_COMMAND_ACK_TIMEOUT_MS', 15_000),
    resultTimeoutMs: parsePositiveInteger(
      env.OU_UI_COMMAND_RESULT_TIMEOUT_MS,
      'OU_UI_COMMAND_RESULT_TIMEOUT_MS',
      120_000
    ),
    maxCommands: parsePositiveInteger(
      env.OU_UI_COMMAND_TIMEOUT_SWEEP_MAX_COMMANDS,
      'OU_UI_COMMAND_TIMEOUT_SWEEP_MAX_COMMANDS',
      500
    )
  };
  const auth = resolveAuth(env);

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('OU_UI_CONTROL_PLANE_PORT must be an integer between 1 and 65535.');
  }

  if (storage === 'memory') {
    return {
      host,
      port,
      initialState,
      agentLogRetention,
      commandTimeoutSweep,
      storage: {
        type: 'memory'
      },
      ...(auth ? { auth } : {})
    };
  }

  if (storage === 'file') {
    const stateFilePath = env.OU_UI_CONTROL_PLANE_STATE_FILE;

    if (!stateFilePath) {
      throw new Error('OU_UI_CONTROL_PLANE_STATE_FILE is required when OU_UI_CONTROL_PLANE_STORAGE=file.');
    }

    return {
      host,
      port,
      initialState,
      agentLogRetention,
      commandTimeoutSweep,
      storage: {
        type: 'file',
        stateFilePath
      },
      ...(auth ? { auth } : {})
    };
  }

  throw new Error('OU_UI_CONTROL_PLANE_STORAGE must be either "memory" or "file".');
}
