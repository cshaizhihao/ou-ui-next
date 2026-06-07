import type {
  HttpControlPlaneAuthOptions,
  OperatorAuthFailureThrottleOptions
} from '../../services/api/http-control-plane-server';
import {
  DEFAULT_AGENT_LOG_RETENTION_MAX_AGE_MS,
  DEFAULT_AGENT_LOG_RETENTION_MAX_EVENTS_PER_AGENT,
  type AgentLogRetentionPolicy
} from './agent-log-retention';
import {
  DEFAULT_TRAFFIC_ROLLUP_RETENTION_MAX_AGE_MS,
  DEFAULT_TRAFFIC_ROLLUP_RETENTION_MAX_RECORDS_PER_SCOPE,
  type TrafficRollupRetentionPolicy
} from './traffic-rollup-retention';
import type { RuntimeObjectStorageSinkConfig } from './object-storage-sink';

export type HttpControlPlaneRuntimeConfig = {
  host: string;
  port: number;
  initialState: 'seeded' | 'empty';
  agentLogRetention: AgentLogRetentionPolicy;
  trafficRollupRetention: TrafficRollupRetentionPolicy;
  commandTimeoutSweep: {
    enabled: boolean;
    intervalMs: number;
    ackTimeoutMs: number;
    resultTimeoutMs: number;
    maxCommands: number;
  };
  operatorAuthFailureThrottle: Required<OperatorAuthFailureThrottleOptions>;
  subscriptionSourceEgress?: {
    allowedHosts: string[];
  };
  subscriptionSourceProviderBudget?: {
    maxConcurrentFetchesPerHost: number;
  };
  subscriptionSourceSyncBudget?: {
    maxFetchesPerDay?: number;
    maxBytesPerDay?: number;
  };
  systemAlertWebhook?: {
    url: string;
    targets: Array<{
      id: string;
      label: string;
      url: string;
    }>;
    timeoutMs: number;
    retryDelayMs: number;
    maxAttempts: number;
    retrySweepIntervalMs: number;
    maxDeliveriesPerSweep: number;
    egress?: {
      allowedHosts: string[];
    };
    bearerToken?: string;
  };
  externalArchiveSink?: {
    type: 'file' | 'webhook' | 'object-storage' | 'composite';
    directory?: string;
    webhook?: {
      url: string;
      targets: Array<{
        id: string;
        label: string;
        url: string;
      }>;
      timeoutMs: number;
      egress?: {
        allowedHosts: string[];
      };
      bearerToken?: string;
    };
    objectStorage?: RuntimeObjectStorageSinkConfig;
  };
  storage:
    | {
        type: 'memory';
      }
    | {
        type: 'file';
        stateFilePath: string;
      }
    | {
        type: 'sqlite';
        databaseFilePath: string;
        legacyStateFilePath?: string;
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

function parseOptionalPositiveInteger(value: string | undefined, envName: string) {
  if (!hasValue(value)) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${envName} must be a positive integer.`);
  }

  return parsed;
}

function parseObjectLockRetentionMode(value: string | undefined, envName: string) {
  if (!hasValue(value)) {
    return undefined;
  }

  const normalized = value.trim().toUpperCase();

  if (normalized === 'GOVERNANCE' || normalized === 'COMPLIANCE') {
    return normalized;
  }

  throw new Error(`${envName} must be GOVERNANCE or COMPLIANCE.`);
}

function parseCommaSeparatedList(value: string | undefined) {
  if (!hasValue(value)) {
    return [];
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseWebhookUrl(value: string | undefined, envName: string) {
  if (!hasValue(value)) {
    return undefined;
  }

  try {
    const url = new URL(value.trim());

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('unsupported protocol');
    }

    return url.toString();
  } catch {
    throw new Error(`${envName} must be a valid http or https URL.`);
  }
}

function parseObjectStorageEndpoint(value: string | undefined, envName: string) {
  if (!hasValue(value)) {
    return undefined;
  }

  try {
    const url = new URL(value.trim());

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('unsupported protocol');
    }

    if (url.username || url.password || url.search || url.hash) {
      throw new Error('unsupported endpoint values');
    }

    return url.toString();
  } catch {
    throw new Error(`${envName} must be a valid http or https URL without credentials, query, or fragment.`);
  }
}

function parseWebhookUrls(env: RuntimeConfigEnv, singleUrlEnvName: string, multipleUrlsEnvName: string) {
  const configuredUrls = [
    ...(hasValue(env[singleUrlEnvName])
      ? [{ value: env[singleUrlEnvName], envName: singleUrlEnvName }]
      : []),
    ...parseCommaSeparatedList(env[multipleUrlsEnvName]).map((value) => ({
      value,
      envName: multipleUrlsEnvName
    }))
  ];
  const urls: string[] = [];

  for (const { value, envName } of configuredUrls) {
    const parsedUrl = parseWebhookUrl(value, envName);

    if (parsedUrl && !urls.includes(parsedUrl)) {
      urls.push(parsedUrl);
    }
  }

  return urls;
}

function createWebhookTargets(urls: string[]) {
  return urls.map((url, index) => ({
    id: index === 0 ? 'default-webhook' : `webhook-${index + 1}`,
    label: index === 0 ? 'Default webhook' : `Webhook ${index + 1}`,
    url
  }));
}

function resolveExternalArchiveObjectStorage(env: RuntimeConfigEnv) {
  const requiredEnvNames = [
    'OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_ENDPOINT',
    'OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_BUCKET',
    'OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_REGION',
    'OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_ACCESS_KEY_ID',
    'OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_SECRET_ACCESS_KEY'
  ] as const;
  const optionalEnvNames = [
    'OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_SESSION_TOKEN',
    'OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_PREFIX',
    'OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_TIMEOUT_MS',
    'OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_FORCE_PATH_STYLE',
    'OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_EGRESS_ALLOWLIST',
    'OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_OBJECT_LOCK_MODE',
    'OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_OBJECT_LOCK_RETENTION_DAYS',
    'OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_OBJECT_LOCK_LEGAL_HOLD'
  ] as const;
  const hasObjectStorageInput = [...requiredEnvNames, ...optionalEnvNames].some((envName) => hasValue(env[envName]));

  if (!hasObjectStorageInput) {
    return undefined;
  }

  const missingEnvNames = requiredEnvNames.filter((envName) => !hasValue(env[envName]));

  if (missingEnvNames.length > 0) {
    throw new Error(
      `${missingEnvNames.join(', ')} are required when external archive object storage is enabled.`
    );
  }

  const endpoint = parseObjectStorageEndpoint(
    env.OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_ENDPOINT,
    'OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_ENDPOINT'
  );
  const allowedHosts = parseCommaSeparatedList(env.OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_EGRESS_ALLOWLIST);
  const objectLockRetentionMode = parseObjectLockRetentionMode(
    env.OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_OBJECT_LOCK_MODE,
    'OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_OBJECT_LOCK_MODE'
  );
  const objectLockRetentionDays = parseOptionalPositiveInteger(
    env.OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_OBJECT_LOCK_RETENTION_DAYS,
    'OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_OBJECT_LOCK_RETENTION_DAYS'
  );
  const objectLockLegalHold = hasValue(env.OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_OBJECT_LOCK_LEGAL_HOLD)
    ? parseBoolean(env.OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_OBJECT_LOCK_LEGAL_HOLD, false)
    : false;

  if (Boolean(objectLockRetentionMode) !== Boolean(objectLockRetentionDays)) {
    throw new Error(
      'OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_OBJECT_LOCK_MODE and OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_OBJECT_LOCK_RETENTION_DAYS must be configured together.'
    );
  }

  return {
    endpoint: endpoint as string,
    bucket: env.OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_BUCKET?.trim() as string,
    region: env.OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_REGION?.trim() as string,
    accessKeyId: env.OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_ACCESS_KEY_ID?.trim() as string,
    secretAccessKey: env.OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_SECRET_ACCESS_KEY?.trim() as string,
    ...(hasValue(env.OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_SESSION_TOKEN)
      ? { sessionToken: env.OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_SESSION_TOKEN.trim() }
      : {}),
    ...(hasValue(env.OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_PREFIX)
      ? { prefix: env.OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_PREFIX.trim() }
      : {}),
    timeoutMs: parsePositiveInteger(
      env.OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_TIMEOUT_MS,
      'OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_TIMEOUT_MS',
      5000
    ),
    forcePathStyle: parseBoolean(env.OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_FORCE_PATH_STYLE, true),
    ...(objectLockRetentionMode || objectLockLegalHold
      ? {
          objectLock: {
            ...(objectLockRetentionMode && objectLockRetentionDays
              ? {
                  retentionMode: objectLockRetentionMode,
                  retentionDays: objectLockRetentionDays
                }
              : {}),
            ...(objectLockLegalHold ? { legalHold: true } : {})
          }
        }
      : {}),
    ...(allowedHosts.length > 0
      ? {
          egress: {
            allowedHosts
          }
        }
      : {})
  } satisfies RuntimeObjectStorageSinkConfig;
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

function resolveOperatorSession(env: RuntimeConfigEnv): HttpControlPlaneAuthOptions['operatorSession'] | undefined {
  const username = env.OU_UI_CONTROL_PLANE_OPERATOR_USERNAME;
  const password = env.OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD;
  const passwordHash = env.OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD_HASH;
  const sessionSecret = env.OU_UI_CONTROL_PLANE_OPERATOR_SESSION_SECRET;
  const ttlMs = env.OU_UI_CONTROL_PLANE_OPERATOR_SESSION_TTL_MS;
  const hasSessionInput = [username, password, passwordHash, sessionSecret, ttlMs].some(hasValue);

  if (!hasSessionInput) {
    return undefined;
  }

  if (!hasValue(username) || (!hasValue(password) && !hasValue(passwordHash)) || !hasValue(sessionSecret)) {
    throw new Error(
      'OU_UI_CONTROL_PLANE_OPERATOR_USERNAME, OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD or OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD_HASH, and OU_UI_CONTROL_PLANE_OPERATOR_SESSION_SECRET are required together.'
    );
  }

  return {
    username,
    ...(hasValue(password) ? { password } : {}),
    ...(hasValue(passwordHash) ? { passwordHash } : {}),
    sessionSecret,
    actor: env.OU_UI_CONTROL_PLANE_OPERATOR_ACTOR ?? username,
    operatorGroupId: env.OU_UI_CONTROL_PLANE_OPERATOR_GROUP_ID,
    resourceGroupId: env.OU_UI_CONTROL_PLANE_RESOURCE_GROUP_ID,
    ttlMs: parsePositiveInteger(
      ttlMs,
      'OU_UI_CONTROL_PLANE_OPERATOR_SESSION_TTL_MS',
      8 * 60 * 60 * 1000
    )
  };
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
  const operatorSession = resolveOperatorSession(env);
  const agentTokens = parseAgentTokensJson(env.OU_UI_CONTROL_PLANE_AGENT_TOKENS_JSON);
  const hasAgentTokens = Boolean(agentTokens && Object.keys(agentTokens).length > 0);

  if (!operatorTokens && !operatorSession && !hasAgentTokens) {
    return undefined;
  }

  return {
    ...(operatorTokens ? { operatorTokens } : {}),
    ...(operatorSession ? { operatorSession } : {}),
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
  const trafficRollupRetentionDays = parsePositiveNumber(
    env.OU_UI_TRAFFIC_ROLLUP_RETENTION_DAYS,
    'OU_UI_TRAFFIC_ROLLUP_RETENTION_DAYS',
    DEFAULT_TRAFFIC_ROLLUP_RETENTION_MAX_AGE_MS / 24 / 60 / 60 / 1000
  );
  const trafficRollupRetention = {
    maxAgeMs: Math.round(trafficRollupRetentionDays * 24 * 60 * 60 * 1000),
    maxRecordsPerScope: parseNonNegativeInteger(
      env.OU_UI_TRAFFIC_ROLLUP_MAX_RECORDS_PER_SCOPE,
      'OU_UI_TRAFFIC_ROLLUP_MAX_RECORDS_PER_SCOPE',
      DEFAULT_TRAFFIC_ROLLUP_RETENTION_MAX_RECORDS_PER_SCOPE
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
  const operatorAuthFailureThrottle = {
    windowMs: parsePositiveInteger(
      env.OU_UI_CONTROL_PLANE_OPERATOR_AUTH_FAILURE_WINDOW_MS,
      'OU_UI_CONTROL_PLANE_OPERATOR_AUTH_FAILURE_WINDOW_MS',
      60_000
    ),
    maxFailures: parsePositiveInteger(
      env.OU_UI_CONTROL_PLANE_OPERATOR_AUTH_FAILURE_LIMIT,
      'OU_UI_CONTROL_PLANE_OPERATOR_AUTH_FAILURE_LIMIT',
      20
    )
  };
  const allowedSubscriptionSourceHosts = parseCommaSeparatedList(env.OU_UI_SUBSCRIPTION_SOURCE_EGRESS_ALLOWLIST);
  const subscriptionSourceEgress =
    allowedSubscriptionSourceHosts.length > 0
      ? {
          allowedHosts: allowedSubscriptionSourceHosts
        }
      : undefined;
  const configuredSubscriptionSourceProviderBudget = hasValue(
    env.OU_UI_SUBSCRIPTION_SOURCE_PROVIDER_MAX_CONCURRENT_FETCHES_PER_HOST
  )
    ? {
        maxConcurrentFetchesPerHost: parsePositiveInteger(
          env.OU_UI_SUBSCRIPTION_SOURCE_PROVIDER_MAX_CONCURRENT_FETCHES_PER_HOST,
          'OU_UI_SUBSCRIPTION_SOURCE_PROVIDER_MAX_CONCURRENT_FETCHES_PER_HOST',
          2
        )
      }
    : undefined;
  const configuredSubscriptionSourceSyncBudget =
    hasValue(env.OU_UI_SUBSCRIPTION_SOURCE_SYNC_BUDGET_MAX_FETCHES_PER_DAY) ||
    hasValue(env.OU_UI_SUBSCRIPTION_SOURCE_SYNC_BUDGET_MAX_BYTES_PER_DAY)
      ? {
          ...(hasValue(env.OU_UI_SUBSCRIPTION_SOURCE_SYNC_BUDGET_MAX_FETCHES_PER_DAY)
            ? {
                maxFetchesPerDay: parsePositiveInteger(
                  env.OU_UI_SUBSCRIPTION_SOURCE_SYNC_BUDGET_MAX_FETCHES_PER_DAY,
                  'OU_UI_SUBSCRIPTION_SOURCE_SYNC_BUDGET_MAX_FETCHES_PER_DAY',
                  24
                )
              }
            : {}),
          ...(hasValue(env.OU_UI_SUBSCRIPTION_SOURCE_SYNC_BUDGET_MAX_BYTES_PER_DAY)
            ? {
                maxBytesPerDay: parsePositiveInteger(
                  env.OU_UI_SUBSCRIPTION_SOURCE_SYNC_BUDGET_MAX_BYTES_PER_DAY,
                  'OU_UI_SUBSCRIPTION_SOURCE_SYNC_BUDGET_MAX_BYTES_PER_DAY',
                  256 * 1024 * 1024
                )
              }
            : {})
        }
      : undefined;
  const systemAlertWebhookUrls = parseWebhookUrls(
    env,
    'OU_UI_SYSTEM_ALERT_WEBHOOK_URL',
    'OU_UI_SYSTEM_ALERT_WEBHOOK_URLS'
  );
  const systemAlertWebhookTargets = createWebhookTargets(systemAlertWebhookUrls);
  const systemAlertWebhookAllowedHosts = parseCommaSeparatedList(env.OU_UI_SYSTEM_ALERT_WEBHOOK_EGRESS_ALLOWLIST);
  const systemAlertWebhook = systemAlertWebhookTargets.length > 0
    ? {
        url: systemAlertWebhookTargets[0].url,
        targets: systemAlertWebhookTargets,
        timeoutMs: parsePositiveInteger(
          env.OU_UI_SYSTEM_ALERT_WEBHOOK_TIMEOUT_MS,
          'OU_UI_SYSTEM_ALERT_WEBHOOK_TIMEOUT_MS',
          5000
        ),
        retryDelayMs: parsePositiveInteger(
          env.OU_UI_SYSTEM_ALERT_WEBHOOK_RETRY_DELAY_MS,
          'OU_UI_SYSTEM_ALERT_WEBHOOK_RETRY_DELAY_MS',
          60_000
        ),
        maxAttempts: parsePositiveInteger(
          env.OU_UI_SYSTEM_ALERT_WEBHOOK_MAX_ATTEMPTS,
          'OU_UI_SYSTEM_ALERT_WEBHOOK_MAX_ATTEMPTS',
          3
        ),
        retrySweepIntervalMs: parsePositiveInteger(
          env.OU_UI_SYSTEM_ALERT_WEBHOOK_RETRY_SWEEP_INTERVAL_MS,
          'OU_UI_SYSTEM_ALERT_WEBHOOK_RETRY_SWEEP_INTERVAL_MS',
          30_000
        ),
        maxDeliveriesPerSweep: parsePositiveInteger(
          env.OU_UI_SYSTEM_ALERT_WEBHOOK_MAX_DELIVERIES_PER_SWEEP,
          'OU_UI_SYSTEM_ALERT_WEBHOOK_MAX_DELIVERIES_PER_SWEEP',
          25
        ),
        ...(systemAlertWebhookAllowedHosts.length > 0
          ? {
              egress: {
                allowedHosts: systemAlertWebhookAllowedHosts
              }
            }
          : {}),
        ...(hasValue(env.OU_UI_SYSTEM_ALERT_WEBHOOK_BEARER_TOKEN)
          ? { bearerToken: env.OU_UI_SYSTEM_ALERT_WEBHOOK_BEARER_TOKEN.trim() }
          : {})
      }
    : undefined;
  const externalArchiveDirectory = hasValue(env.OU_UI_EXTERNAL_ARCHIVE_DIRECTORY)
    ? env.OU_UI_EXTERNAL_ARCHIVE_DIRECTORY.trim()
    : undefined;
  const externalArchiveWebhookUrls = parseWebhookUrls(
    env,
    'OU_UI_EXTERNAL_ARCHIVE_WEBHOOK_URL',
    'OU_UI_EXTERNAL_ARCHIVE_WEBHOOK_URLS'
  );
  const externalArchiveWebhookTargets = createWebhookTargets(externalArchiveWebhookUrls);
  const externalArchiveWebhookAllowedHosts = parseCommaSeparatedList(
    env.OU_UI_EXTERNAL_ARCHIVE_WEBHOOK_EGRESS_ALLOWLIST
  );
  const externalArchiveWebhook = externalArchiveWebhookTargets.length > 0
    ? {
        url: externalArchiveWebhookTargets[0].url,
        targets: externalArchiveWebhookTargets,
        timeoutMs: parsePositiveInteger(
          env.OU_UI_EXTERNAL_ARCHIVE_WEBHOOK_TIMEOUT_MS,
          'OU_UI_EXTERNAL_ARCHIVE_WEBHOOK_TIMEOUT_MS',
          5000
        ),
        ...(externalArchiveWebhookAllowedHosts.length > 0
          ? {
              egress: {
                allowedHosts: externalArchiveWebhookAllowedHosts
              }
            }
          : {}),
        ...(hasValue(env.OU_UI_EXTERNAL_ARCHIVE_WEBHOOK_BEARER_TOKEN)
          ? { bearerToken: env.OU_UI_EXTERNAL_ARCHIVE_WEBHOOK_BEARER_TOKEN.trim() }
          : {})
      }
    : undefined;
  const externalArchiveObjectStorage = resolveExternalArchiveObjectStorage(env);
  const externalArchiveSinkCount = [
    externalArchiveDirectory,
    externalArchiveWebhook,
    externalArchiveObjectStorage
  ].filter(Boolean).length;
  const externalArchiveSink =
    externalArchiveSinkCount > 0
      ? {
          type: externalArchiveSinkCount > 1
            ? ('composite' as const)
            : externalArchiveDirectory
              ? ('file' as const)
              : externalArchiveWebhook
                ? ('webhook' as const)
                : ('object-storage' as const),
          ...(externalArchiveDirectory ? { directory: externalArchiveDirectory } : {}),
          ...(externalArchiveWebhook ? { webhook: externalArchiveWebhook } : {}),
          ...(externalArchiveObjectStorage ? { objectStorage: externalArchiveObjectStorage } : {})
        }
      : undefined;
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
      trafficRollupRetention,
      commandTimeoutSweep,
      operatorAuthFailureThrottle,
      storage: {
        type: 'memory'
      },
      ...(subscriptionSourceEgress ? { subscriptionSourceEgress } : {}),
      ...(configuredSubscriptionSourceProviderBudget
        ? { subscriptionSourceProviderBudget: configuredSubscriptionSourceProviderBudget }
        : {}),
      ...(configuredSubscriptionSourceSyncBudget
        ? { subscriptionSourceSyncBudget: configuredSubscriptionSourceSyncBudget }
        : {}),
      ...(systemAlertWebhook ? { systemAlertWebhook } : {}),
      ...(externalArchiveSink ? { externalArchiveSink } : {}),
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
      trafficRollupRetention,
      commandTimeoutSweep,
      operatorAuthFailureThrottle,
      storage: {
        type: 'file',
        stateFilePath
      },
      ...(subscriptionSourceEgress ? { subscriptionSourceEgress } : {}),
      ...(configuredSubscriptionSourceProviderBudget
        ? { subscriptionSourceProviderBudget: configuredSubscriptionSourceProviderBudget }
        : {}),
      ...(configuredSubscriptionSourceSyncBudget
        ? { subscriptionSourceSyncBudget: configuredSubscriptionSourceSyncBudget }
        : {}),
      ...(systemAlertWebhook ? { systemAlertWebhook } : {}),
      ...(externalArchiveSink ? { externalArchiveSink } : {}),
      ...(auth ? { auth } : {})
    };
  }

  if (storage === 'sqlite') {
    const databaseFilePath = env.OU_UI_CONTROL_PLANE_SQLITE_FILE;

    if (!databaseFilePath) {
      throw new Error('OU_UI_CONTROL_PLANE_SQLITE_FILE is required when OU_UI_CONTROL_PLANE_STORAGE=sqlite.');
    }

    const legacyStateFilePath = env.OU_UI_CONTROL_PLANE_LEGACY_STATE_FILE;

    return {
      host,
      port,
      initialState,
      agentLogRetention,
      trafficRollupRetention,
      commandTimeoutSweep,
      operatorAuthFailureThrottle,
      storage: {
        type: 'sqlite',
        databaseFilePath,
        ...(hasValue(legacyStateFilePath) ? { legacyStateFilePath } : {})
      },
      ...(subscriptionSourceEgress ? { subscriptionSourceEgress } : {}),
      ...(configuredSubscriptionSourceProviderBudget
        ? { subscriptionSourceProviderBudget: configuredSubscriptionSourceProviderBudget }
        : {}),
      ...(configuredSubscriptionSourceSyncBudget
        ? { subscriptionSourceSyncBudget: configuredSubscriptionSourceSyncBudget }
        : {}),
      ...(systemAlertWebhook ? { systemAlertWebhook } : {}),
      ...(externalArchiveSink ? { externalArchiveSink } : {}),
      ...(auth ? { auth } : {})
    };
  }

  throw new Error('OU_UI_CONTROL_PLANE_STORAGE must be either "memory", "file", or "sqlite".');
}
