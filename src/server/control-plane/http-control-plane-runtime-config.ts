import type { HttpControlPlaneAuthOptions } from '../../services/api/http-control-plane-server';

export type HttpControlPlaneRuntimeConfig = {
  host: string;
  port: number;
  initialState: 'seeded' | 'empty';
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
          actor: env.OU_UI_CONTROL_PLANE_OPERATOR_ACTOR ?? 'admin',
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
  const auth = resolveAuth(env);

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('OU_UI_CONTROL_PLANE_PORT must be an integer between 1 and 65535.');
  }

  if (storage === 'memory') {
    return {
      host,
      port,
      initialState,
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
      storage: {
        type: 'file',
        stateFilePath
      },
      ...(auth ? { auth } : {})
    };
  }

  throw new Error('OU_UI_CONTROL_PLANE_STORAGE must be either "memory" or "file".');
}
