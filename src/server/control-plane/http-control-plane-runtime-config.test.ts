import { resolveHttpControlPlaneRuntimeConfig } from './http-control-plane-runtime-config';
import {
  DEFAULT_AGENT_LOG_RETENTION_MAX_AGE_MS,
  DEFAULT_AGENT_LOG_RETENTION_MAX_EVENTS_PER_AGENT
} from './agent-log-retention';
import {
  DEFAULT_TRAFFIC_ROLLUP_RETENTION_MAX_AGE_MS,
  DEFAULT_TRAFFIC_ROLLUP_RETENTION_MAX_RECORDS_PER_SCOPE
} from './traffic-rollup-retention';

describe('resolveHttpControlPlaneRuntimeConfig', () => {
  it('defaults to localhost memory storage', () => {
    expect(resolveHttpControlPlaneRuntimeConfig({})).toEqual({
      host: '127.0.0.1',
      port: 4010,
      initialState: 'empty',
      agentLogRetention: {
        maxAgeMs: DEFAULT_AGENT_LOG_RETENTION_MAX_AGE_MS,
        maxEventsPerAgent: DEFAULT_AGENT_LOG_RETENTION_MAX_EVENTS_PER_AGENT
      },
      trafficRollupRetention: {
        maxAgeMs: DEFAULT_TRAFFIC_ROLLUP_RETENTION_MAX_AGE_MS,
        maxRecordsPerScope: DEFAULT_TRAFFIC_ROLLUP_RETENTION_MAX_RECORDS_PER_SCOPE
      },
      commandTimeoutSweep: {
        enabled: true,
        intervalMs: 30_000,
        ackTimeoutMs: 15_000,
        resultTimeoutMs: 120_000,
        maxCommands: 500
      },
      operatorAuthFailureThrottle: {
        windowMs: 60_000,
        maxFailures: 20
      },
      storage: {
        type: 'memory'
      }
    });
  });

  it('maps file storage environment variables', () => {
    expect(
      resolveHttpControlPlaneRuntimeConfig({
        OU_UI_CONTROL_PLANE_HOST: '0.0.0.0',
        OU_UI_CONTROL_PLANE_PORT: '4011',
        OU_UI_CONTROL_PLANE_STORAGE: 'file',
        OU_UI_CONTROL_PLANE_STATE_FILE: 'D:\\ou-ui\\control-plane-state.json',
        OU_UI_CONTROL_PLANE_INITIAL_STATE: 'empty',
        OU_UI_AGENT_LOG_RETENTION_DAYS: '3',
        OU_UI_AGENT_LOG_MAX_EVENTS_PER_AGENT: '250',
        OU_UI_TRAFFIC_ROLLUP_RETENTION_DAYS: '31',
        OU_UI_TRAFFIC_ROLLUP_MAX_RECORDS_PER_SCOPE: '5000',
        OU_UI_COMMAND_TIMEOUT_SWEEP_ENABLED: 'false',
        OU_UI_COMMAND_TIMEOUT_SWEEP_INTERVAL_MS: '10000',
        OU_UI_COMMAND_ACK_TIMEOUT_MS: '20000',
        OU_UI_COMMAND_RESULT_TIMEOUT_MS: '30000',
        OU_UI_COMMAND_TIMEOUT_SWEEP_MAX_COMMANDS: '50',
        OU_UI_CONTROL_PLANE_OPERATOR_AUTH_FAILURE_WINDOW_MS: '15000',
        OU_UI_CONTROL_PLANE_OPERATOR_AUTH_FAILURE_LIMIT: '5'
      })
    ).toEqual({
      host: '0.0.0.0',
      port: 4011,
      initialState: 'empty',
      agentLogRetention: {
        maxAgeMs: 3 * 24 * 60 * 60 * 1000,
        maxEventsPerAgent: 250
      },
      trafficRollupRetention: {
        maxAgeMs: 31 * 24 * 60 * 60 * 1000,
        maxRecordsPerScope: 5000
      },
      commandTimeoutSweep: {
        enabled: false,
        intervalMs: 10_000,
        ackTimeoutMs: 20_000,
        resultTimeoutMs: 30_000,
        maxCommands: 50
      },
      operatorAuthFailureThrottle: {
        windowMs: 15_000,
        maxFailures: 5
      },
      storage: {
        type: 'file',
        stateFilePath: 'D:\\ou-ui\\control-plane-state.json'
      }
    });
  });

  it('maps sqlite storage environment variables', () => {
    expect(
      resolveHttpControlPlaneRuntimeConfig({
        OU_UI_CONTROL_PLANE_STORAGE: 'sqlite',
        OU_UI_CONTROL_PLANE_SQLITE_FILE: '/var/lib/ou-ui-next/control-plane.sqlite',
        OU_UI_CONTROL_PLANE_LEGACY_STATE_FILE: '/var/lib/ou-ui-next/control-plane-state.json'
      })
    ).toMatchObject({
      storage: {
        type: 'sqlite',
        databaseFilePath: '/var/lib/ou-ui-next/control-plane.sqlite',
        legacyStateFilePath: '/var/lib/ou-ui-next/control-plane-state.json'
      }
    });
  });

  it('maps system alert webhook notification environment variables', () => {
    expect(
      resolveHttpControlPlaneRuntimeConfig({
        OU_UI_SYSTEM_ALERT_WEBHOOK_URL: 'https://alerts.example.com/ou-ui',
        OU_UI_SYSTEM_ALERT_WEBHOOK_TIMEOUT_MS: '2500',
        OU_UI_SYSTEM_ALERT_WEBHOOK_RETRY_DELAY_MS: '1500',
        OU_UI_SYSTEM_ALERT_WEBHOOK_MAX_ATTEMPTS: '4',
        OU_UI_SYSTEM_ALERT_WEBHOOK_RETRY_SWEEP_INTERVAL_MS: '500',
        OU_UI_SYSTEM_ALERT_WEBHOOK_MAX_DELIVERIES_PER_SWEEP: '8',
        OU_UI_SYSTEM_ALERT_WEBHOOK_BEARER_TOKEN: 'alert-webhook-token'
      })
    ).toMatchObject({
      systemAlertWebhook: {
        url: 'https://alerts.example.com/ou-ui',
        timeoutMs: 2500,
        retryDelayMs: 1500,
        maxAttempts: 4,
        retrySweepIntervalMs: 500,
        maxDeliveriesPerSweep: 8,
        bearerToken: 'alert-webhook-token'
      }
    });
  });

  it('maps operator and Agent bearer token environment variables', () => {
    expect(
      resolveHttpControlPlaneRuntimeConfig({
        OU_UI_CONTROL_PLANE_OPERATOR_TOKEN: 'operator-secret',
        OU_UI_CONTROL_PLANE_OPERATOR_USERNAME: 'operator_001',
        OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD: 'operator-password',
        OU_UI_CONTROL_PLANE_OPERATOR_SESSION_SECRET: 'operator-session-secret',
        OU_UI_CONTROL_PLANE_OPERATOR_SESSION_TTL_MS: '3600000',
        OU_UI_CONTROL_PLANE_OPERATOR_ACTOR: 'operator:alice',
        OU_UI_CONTROL_PLANE_OPERATOR_GROUP_ID: 'owner',
        OU_UI_CONTROL_PLANE_RESOURCE_GROUP_ID: 'group-premium',
        OU_UI_CONTROL_PLANE_AGENT_TOKENS_JSON: JSON.stringify({
          'agent-hkg-01': 'agent-hkg-secret'
        })
      })
    ).toEqual({
      host: '127.0.0.1',
      port: 4010,
      initialState: 'empty',
      agentLogRetention: {
        maxAgeMs: DEFAULT_AGENT_LOG_RETENTION_MAX_AGE_MS,
        maxEventsPerAgent: DEFAULT_AGENT_LOG_RETENTION_MAX_EVENTS_PER_AGENT
      },
      trafficRollupRetention: {
        maxAgeMs: DEFAULT_TRAFFIC_ROLLUP_RETENTION_MAX_AGE_MS,
        maxRecordsPerScope: DEFAULT_TRAFFIC_ROLLUP_RETENTION_MAX_RECORDS_PER_SCOPE
      },
      commandTimeoutSweep: {
        enabled: true,
        intervalMs: 30_000,
        ackTimeoutMs: 15_000,
        resultTimeoutMs: 120_000,
        maxCommands: 500
      },
      operatorAuthFailureThrottle: {
        windowMs: 60_000,
        maxFailures: 20
      },
      storage: {
        type: 'memory'
      },
      auth: {
        operatorTokens: {
          'operator-secret': {
            actor: 'operator:alice',
            operatorGroupId: 'owner',
            resourceGroupId: 'group-premium'
          }
        },
        operatorSession: {
          username: 'operator_001',
          password: 'operator-password',
          sessionSecret: 'operator-session-secret',
          actor: 'operator:alice',
          operatorGroupId: 'owner',
          resourceGroupId: 'group-premium',
          ttlMs: 3_600_000
        },
        agentTokens: {
          'agent-hkg-secret': {
            agentId: 'agent-hkg-01'
          }
        }
      }
    });
  });

  it('maps the subscription source egress allowlist environment variable', () => {
    expect(
      resolveHttpControlPlaneRuntimeConfig({
        OU_UI_SUBSCRIPTION_SOURCE_EGRESS_ALLOWLIST:
          'provider.example.com, *.trusted.example.com, , https://edge.example.net/sub.yaml'
      })
    ).toMatchObject({
      subscriptionSourceEgress: {
        allowedHosts: ['provider.example.com', '*.trusted.example.com', 'https://edge.example.net/sub.yaml']
      }
    });
  });

  it('maps the subscription source provider host fetch budget environment variable', () => {
    expect(
      resolveHttpControlPlaneRuntimeConfig({
        OU_UI_SUBSCRIPTION_SOURCE_PROVIDER_MAX_CONCURRENT_FETCHES_PER_HOST: '3'
      })
    ).toMatchObject({
      subscriptionSourceProviderBudget: {
        maxConcurrentFetchesPerHost: 3
      }
    });
  });

  it('rejects invalid subscription source provider host fetch budgets', () => {
    expect(() =>
      resolveHttpControlPlaneRuntimeConfig({
        OU_UI_SUBSCRIPTION_SOURCE_PROVIDER_MAX_CONCURRENT_FETCHES_PER_HOST: '0'
      })
    ).toThrow('OU_UI_SUBSCRIPTION_SOURCE_PROVIDER_MAX_CONCURRENT_FETCHES_PER_HOST must be a positive integer.');
  });

  it('rejects unknown storage modes', () => {
    expect(() =>
      resolveHttpControlPlaneRuntimeConfig({
        OU_UI_CONTROL_PLANE_STORAGE: 'postgres'
      })
    ).toThrow('OU_UI_CONTROL_PLANE_STORAGE must be either "memory", "file", or "sqlite".');
  });

  it('requires a state file path for file storage', () => {
    expect(() =>
      resolveHttpControlPlaneRuntimeConfig({
        OU_UI_CONTROL_PLANE_STORAGE: 'file'
      })
    ).toThrow('OU_UI_CONTROL_PLANE_STATE_FILE is required when OU_UI_CONTROL_PLANE_STORAGE=file.');
  });

  it('requires a database file path for sqlite storage', () => {
    expect(() =>
      resolveHttpControlPlaneRuntimeConfig({
        OU_UI_CONTROL_PLANE_STORAGE: 'sqlite'
      })
    ).toThrow('OU_UI_CONTROL_PLANE_SQLITE_FILE is required when OU_UI_CONTROL_PLANE_STORAGE=sqlite.');
  });

  it('rejects invalid ports', () => {
    expect(() =>
      resolveHttpControlPlaneRuntimeConfig({
        OU_UI_CONTROL_PLANE_PORT: '70000'
      })
    ).toThrow('OU_UI_CONTROL_PLANE_PORT must be an integer between 1 and 65535.');
  });

  it('rejects invalid Agent log retention settings', () => {
    expect(() =>
      resolveHttpControlPlaneRuntimeConfig({
        OU_UI_AGENT_LOG_RETENTION_DAYS: '0'
      })
    ).toThrow('OU_UI_AGENT_LOG_RETENTION_DAYS must be a positive number.');

    expect(() =>
      resolveHttpControlPlaneRuntimeConfig({
        OU_UI_AGENT_LOG_MAX_EVENTS_PER_AGENT: '-1'
      })
    ).toThrow('OU_UI_AGENT_LOG_MAX_EVENTS_PER_AGENT must be a non-negative integer.');
  });

  it('rejects invalid command timeout sweep settings', () => {
    expect(() =>
      resolveHttpControlPlaneRuntimeConfig({
        OU_UI_COMMAND_TIMEOUT_SWEEP_INTERVAL_MS: '0'
      })
    ).toThrow('OU_UI_COMMAND_TIMEOUT_SWEEP_INTERVAL_MS must be a positive integer.');

    expect(() =>
      resolveHttpControlPlaneRuntimeConfig({
        OU_UI_COMMAND_TIMEOUT_SWEEP_ENABLED: 'maybe'
      })
    ).toThrow('Boolean environment values must be one of true/false/1/0/yes/no/on/off.');
  });

  it('rejects invalid operator auth failure throttle settings', () => {
    expect(() =>
      resolveHttpControlPlaneRuntimeConfig({
        OU_UI_CONTROL_PLANE_OPERATOR_AUTH_FAILURE_WINDOW_MS: '0'
      })
    ).toThrow('OU_UI_CONTROL_PLANE_OPERATOR_AUTH_FAILURE_WINDOW_MS must be a positive integer.');

    expect(() =>
      resolveHttpControlPlaneRuntimeConfig({
        OU_UI_CONTROL_PLANE_OPERATOR_AUTH_FAILURE_LIMIT: '-1'
      })
    ).toThrow('OU_UI_CONTROL_PLANE_OPERATOR_AUTH_FAILURE_LIMIT must be a positive integer.');
  });

  it('requires complete operator session settings when session auth is enabled', () => {
    expect(() =>
      resolveHttpControlPlaneRuntimeConfig({
        OU_UI_CONTROL_PLANE_OPERATOR_USERNAME: 'operator_001',
        OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD: 'operator-password'
      })
    ).toThrow(
      'OU_UI_CONTROL_PLANE_OPERATOR_USERNAME, OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD, and OU_UI_CONTROL_PLANE_OPERATOR_SESSION_SECRET are required together.'
    );

    expect(() =>
      resolveHttpControlPlaneRuntimeConfig({
        OU_UI_CONTROL_PLANE_OPERATOR_USERNAME: 'operator_001',
        OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD: 'operator-password',
        OU_UI_CONTROL_PLANE_OPERATOR_SESSION_SECRET: 'operator-session-secret',
        OU_UI_CONTROL_PLANE_OPERATOR_SESSION_TTL_MS: '0'
      })
    ).toThrow('OU_UI_CONTROL_PLANE_OPERATOR_SESSION_TTL_MS must be a positive integer.');
  });

  it('rejects malformed Agent token JSON', () => {
    expect(() =>
      resolveHttpControlPlaneRuntimeConfig({
        OU_UI_CONTROL_PLANE_AGENT_TOKENS_JSON: '{bad-json'
      })
    ).toThrow('OU_UI_CONTROL_PLANE_AGENT_TOKENS_JSON must be a JSON object mapping agentId to token.');
  });
});
