import {
  createHttpRuntimeMetrics,
  createHttpControlPlaneServer,
  recordExternalArchiveSinkFailure,
  type HttpRuntimeMetrics,
  type CreateHttpControlPlaneServerOptions
} from '../../services/api/http-control-plane-server';
import { createServiceBackedControlPlaneApi } from '../../services/api/service-backed-control-plane-api';
import type {
  CommandTimeoutSweepResult,
  ControlPlaneApi
} from '../../services/api/control-plane-api';
import type {
  SystemAlertNotificationChannel,
  SystemAlertNotificationRetryResult,
  SystemAlertNotifier
} from '../../services/api/system-alert-notifications';
import {
  withAuditAnchorSink,
  type ControlPlaneAuditAnchorSink,
  type ControlPlaneAuditAnchorSinkErrorHandler
} from './audit-anchor-sink';
import type { ControlPlaneArchiveSink } from './archive-sink';
import type { AgentLogRetentionPolicy } from './agent-log-retention';
import type { ControlPlaneRepository, ControlPlaneRepositoryState } from './control-plane-repository';
import { createControlPlaneService, type ControlPlaneArchiveSinkErrorHandler } from './control-plane-service';
import { createFileControlPlaneRepository } from './file-control-plane-repository';
import { createInMemoryControlPlaneRepository } from './in-memory-control-plane-repository';
import { createRepositoryBackedOperatorSessionStore } from './operator-session-store';
import { createSqliteControlPlaneRepository } from './sqlite-control-plane-repository';
import type { TrafficRollupRetentionPolicy } from './traffic-rollup-retention';

type CommandTimeoutSweepJobOptions = {
  enabled?: boolean;
  intervalMs?: number;
  ackTimeoutMs?: number;
  resultTimeoutMs?: number;
  maxCommands?: number;
  now?: () => string;
  onSweep?: (result: CommandTimeoutSweepResult) => void;
  onError?: (error: unknown) => void;
};

type SystemAlertNotificationRetryJobOptions = {
  enabled?: boolean;
  intervalMs?: number;
  maxDeliveries?: number;
  now?: () => string;
  onSweep?: (result: SystemAlertNotificationRetryResult) => void;
  onError?: (error: unknown) => void;
};

type TelegramLongPollingJobOptions = {
  enabled?: boolean;
  intervalMs?: number;
  onPoll?: (result: Awaited<ReturnType<ControlPlaneApi['pollTelegramBotUpdates']>>) => void;
  onError?: (error: unknown) => void;
};

type TelegramNotificationDeliveryRetryJobOptions = {
  enabled?: boolean;
  intervalMs?: number;
  maxDeliveries?: number;
  now?: () => string;
  onSweep?: (result: Awaited<ReturnType<NonNullable<ControlPlaneApi['retryTelegramNotificationDeliveries']>>>) => void;
  onError?: (error: unknown) => void;
};

type CreateServiceBackedControlPlaneOptions = (
  | {
      storage?: 'memory';
    }
  | {
      storage: 'file';
      stateFilePath: string;
    }
  | {
      storage: 'sqlite';
      databaseFilePath: string;
      legacyStateFilePath?: string;
    }
) & {
  seed?: Partial<ControlPlaneRepositoryState>;
  auth?: CreateHttpControlPlaneServerOptions['auth'];
  logger?: CreateHttpControlPlaneServerOptions['logger'];
  operatorAuthFailureThrottle?: CreateHttpControlPlaneServerOptions['operatorAuthFailureThrottle'];
  agentLogRetention?: Partial<AgentLogRetentionPolicy>;
  trafficRollupRetention?: Partial<TrafficRollupRetentionPolicy>;
  commandTimeoutSweep?: CommandTimeoutSweepJobOptions;
  now?: () => string;
  inventory?: Parameters<typeof createServiceBackedControlPlaneApi>[0]['inventory'];
  fetcher?: Parameters<typeof createServiceBackedControlPlaneApi>[0]['fetcher'];
  telegramBotHostResolver?: Parameters<typeof createServiceBackedControlPlaneApi>[0]['telegramBotHostResolver'];
  telegramBotEgressEnforcement?: Parameters<typeof createServiceBackedControlPlaneApi>[0]['telegramBotEgressEnforcement'];
  subscriptionSourceEgress?: Parameters<typeof createServiceBackedControlPlaneApi>[0]['subscriptionSourceEgress'];
  subscriptionSourceProviderBudget?: Parameters<typeof createServiceBackedControlPlaneApi>[0]['subscriptionSourceProviderBudget'];
  subscriptionSourceSyncBudget?: Parameters<typeof createServiceBackedControlPlaneApi>[0]['subscriptionSourceSyncBudget'];
  systemAlertNotifier?: SystemAlertNotifier;
  systemAlertNotificationChannels?: SystemAlertNotificationChannel[];
  systemAlertNotificationRetry?: Parameters<typeof createServiceBackedControlPlaneApi>[0]['systemAlertNotificationRetry'];
  systemAlertNotificationRetryJob?: SystemAlertNotificationRetryJobOptions;
  telegramLongPollingJob?: TelegramLongPollingJobOptions;
  telegramNotificationDeliveryRetryJob?: TelegramNotificationDeliveryRetryJobOptions;
  archiveSink?: ControlPlaneArchiveSink;
  onArchiveSinkError?: ControlPlaneArchiveSinkErrorHandler;
  auditAnchorSink?: ControlPlaneAuditAnchorSink;
  onAuditAnchorSinkError?: ControlPlaneAuditAnchorSinkErrorHandler;
  runtimeMetrics?: HttpRuntimeMetrics;
  readModelNow?: Parameters<typeof createServiceBackedControlPlaneApi>[0]['readModelNow'];
};

function createDefaultSeed(seed: Partial<ControlPlaneRepositoryState> = {}): Partial<ControlPlaneRepositoryState> {
  return {
    tasks: seed.tasks ?? [],
    auditLogs: seed.auditLogs ?? [],
    forwardRules: seed.forwardRules ?? [],
    permissionGrants: seed.permissionGrants ?? [],
    commandOutbox: seed.commandOutbox,
    agentEvents: seed.agentEvents,
    agentLogArchives: seed.agentLogArchives,
    agentSessions: seed.agentSessions,
    agentCredentials: seed.agentCredentials,
    idempotencyRecords: seed.idempotencyRecords,
    subscriptionSources: seed.subscriptionSources,
    subscriptionClients: seed.subscriptionClients,
    subscriptionExportProfiles: seed.subscriptionExportProfiles,
    subscriptionInventoryNodes: seed.subscriptionInventoryNodes,
    systemAlerts: seed.systemAlerts,
    systemAlertNotificationDeliveries: seed.systemAlertNotificationDeliveries,
    trafficRollups: seed.trafficRollups,
    trafficRollupCompactions: seed.trafficRollupCompactions,
    agentLogRetentionPolicy: seed.agentLogRetentionPolicy,
    trafficRollupRetentionPolicy: seed.trafficRollupRetentionPolicy
  };
}

async function ensureBootstrapPermissionGrants(
  repository: ControlPlaneRepository,
  grants: ControlPlaneRepositoryState['permissionGrants'] | undefined
) {
  if (!grants || grants.length === 0) {
    return;
  }

  await repository.transaction(async (transaction) => {
    for (const grant of grants) {
      await transaction.upsertPermissionGrant(grant);
    }
  });
}

function startCommandTimeoutSweepJob(
  service: ReturnType<typeof createControlPlaneService>,
  options: CommandTimeoutSweepJobOptions | undefined
) {
  if (!options?.enabled) {
    return () => undefined;
  }

  const intervalMs = Math.max(1, Math.round(options.intervalMs ?? 30_000));
  let running = false;

  const run = async () => {
    if (running) {
      return;
    }

    running = true;

    try {
      const result = await service.sweepCommandTimeouts({
        requestId: `system-command-timeout-sweep-${Date.now()}`,
        now: options.now?.() ?? new Date().toISOString(),
        ackTimeoutMs: options.ackTimeoutMs,
        resultTimeoutMs: options.resultTimeoutMs,
        maxCommands: options.maxCommands
      });
      options.onSweep?.(result);
    } catch (error) {
      if (options.onError) {
        options.onError(error);
      } else {
        console.error('OU-UI Next command timeout sweep failed:', error);
      }
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void run();
  }, intervalMs);
  timer.unref?.();
  void run();

  return () => {
    clearInterval(timer);
  };
}

function startSystemAlertNotificationRetryJob(
  api: ControlPlaneApi,
  options: SystemAlertNotificationRetryJobOptions | undefined
) {
  if (!options?.enabled || !api.retrySystemAlertNotifications) {
    return () => undefined;
  }

  const intervalMs = Math.max(1, Math.round(options.intervalMs ?? 30_000));
  let running = false;

  const run = async () => {
    if (running || !api.retrySystemAlertNotifications) {
      return;
    }

    running = true;

    try {
      const result = await api.retrySystemAlertNotifications({
        now: options.now?.() ?? new Date().toISOString(),
        maxDeliveries: options.maxDeliveries
      });
      options.onSweep?.(result);
    } catch (error) {
      if (options.onError) {
        options.onError(error);
      } else {
        console.error('OU-UI Next system alert notification retry failed:', error);
      }
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void run();
  }, intervalMs);
  timer.unref?.();
  void run();

  return () => {
    clearInterval(timer);
  };
}

function startTelegramLongPollingJob(api: ControlPlaneApi, options: TelegramLongPollingJobOptions | undefined) {
  if (!options?.enabled) {
    return () => undefined;
  }

  const intervalMs = Math.max(1, Math.round(options.intervalMs ?? 30_000));
  let running = false;

  const run = async () => {
    if (running) {
      return;
    }

    running = true;

    try {
      const result = await api.pollTelegramBotUpdates();
      options.onPoll?.(result);
    } catch (error) {
      if (options.onError) {
        options.onError(error);
      } else {
        console.error('OU-UI Next Telegram long-polling failed:', error);
      }
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void run();
  }, intervalMs);
  timer.unref?.();
  void run();

  return () => {
    clearInterval(timer);
  };
}

function startTelegramNotificationDeliveryRetryJob(
  api: ControlPlaneApi,
  options: TelegramNotificationDeliveryRetryJobOptions | undefined
) {
  if (!options?.enabled || !api.retryTelegramNotificationDeliveries) {
    return () => undefined;
  }

  const intervalMs = Math.max(1, Math.round(options.intervalMs ?? 30_000));
  let running = false;

  const run = async () => {
    if (running || !api.retryTelegramNotificationDeliveries) {
      return;
    }

    running = true;

    try {
      const result = await api.retryTelegramNotificationDeliveries({
        now: options.now?.() ?? new Date().toISOString(),
        maxDeliveries: options.maxDeliveries
      });
      options.onSweep?.(result);
    } catch (error) {
      if (options.onError) {
        options.onError(error);
      } else {
        console.error('OU-UI Next Telegram notification delivery retry failed:', error);
      }
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void run();
  }, intervalMs);
  timer.unref?.();
  void run();

  return () => {
    clearInterval(timer);
  };
}

export async function createServiceBackedControlPlane(options: CreateServiceBackedControlPlaneOptions = {}) {
  const seed = createDefaultSeed(options.seed);
  const runtimeMetrics = options.runtimeMetrics ?? createHttpRuntimeMetrics();
  const onArchiveSinkError: ControlPlaneArchiveSinkErrorHandler | undefined =
    options.archiveSink || options.onArchiveSinkError
      ? (error, batch) => {
          recordExternalArchiveSinkFailure(runtimeMetrics, {
            kind: batch.kind,
            recordCount: batch.records.length,
            observedAt: batch.exportedAt
          });
          options.onArchiveSinkError?.(error, batch);
        }
      : undefined;
  const onAuditAnchorSinkError: ControlPlaneAuditAnchorSinkErrorHandler | undefined =
    options.auditAnchorSink || options.onAuditAnchorSinkError
      ? (error, batch) => {
          recordExternalArchiveSinkFailure(runtimeMetrics, {
            kind: 'audit-anchor',
            recordCount: batch.auditLogs.length,
            observedAt: batch.anchoredAt
          });
          options.onAuditAnchorSinkError?.(error, batch);
        }
      : undefined;
  let repository =
    options.storage === 'file'
      ? await createFileControlPlaneRepository({
          filePath: options.stateFilePath,
          seed
        })
      : options.storage === 'sqlite'
        ? await createSqliteControlPlaneRepository({
            databaseFilePath: options.databaseFilePath,
            legacyStateFilePath: options.legacyStateFilePath,
            seed
          })
      : createInMemoryControlPlaneRepository(seed);

  if (options.auditAnchorSink) {
    repository = withAuditAnchorSink(repository, {
      sink: options.auditAnchorSink,
      now: options.now,
      onError: onAuditAnchorSinkError
    });
  }

  await ensureBootstrapPermissionGrants(repository, seed.permissionGrants);
  const service = createControlPlaneService({
    repository,
    agentLogRetention: options.agentLogRetention,
    trafficRollupRetention: options.trafficRollupRetention,
    ...(options.archiveSink ? { archiveSink: options.archiveSink } : {}),
    ...(onArchiveSinkError ? { onArchiveSinkError } : {}),
    now: options.now
  });
  const operatorSessionStore = createRepositoryBackedOperatorSessionStore(repository, options.now);
  const api = createServiceBackedControlPlaneApi({
    repository,
    service,
    operatorSessionStore,
    agentLogRetention: options.agentLogRetention,
    trafficRollupRetention: options.trafficRollupRetention,
    ...(options.fetcher ? { fetcher: options.fetcher } : {}),
    ...(options.telegramBotHostResolver ? { telegramBotHostResolver: options.telegramBotHostResolver } : {}),
    ...(options.telegramBotEgressEnforcement !== undefined
      ? { telegramBotEgressEnforcement: options.telegramBotEgressEnforcement }
      : {}),
    ...(options.subscriptionSourceEgress ? { subscriptionSourceEgress: options.subscriptionSourceEgress } : {}),
    ...(options.subscriptionSourceProviderBudget
      ? { subscriptionSourceProviderBudget: options.subscriptionSourceProviderBudget }
      : {}),
    ...(options.subscriptionSourceSyncBudget ? { subscriptionSourceSyncBudget: options.subscriptionSourceSyncBudget } : {}),
    ...(options.systemAlertNotifier ? { systemAlertNotifier: options.systemAlertNotifier } : {}),
    ...(options.systemAlertNotificationChannels
      ? { systemAlertNotificationChannels: options.systemAlertNotificationChannels }
      : {}),
    ...(options.systemAlertNotificationRetry
      ? { systemAlertNotificationRetry: options.systemAlertNotificationRetry }
      : {}),
    ...(options.readModelNow ? { readModelNow: options.readModelNow } : {}),
    ...(options.inventory ? { inventory: options.inventory } : {})
  });
  const server = createHttpControlPlaneServer(api, {
    logger: options.logger,
    operatorAuthFailureThrottle: options.operatorAuthFailureThrottle,
    operatorSessionStore,
    runtimeMetrics,
    auth: {
      ...options.auth,
      agentTokenResolver: (token) => service.resolveAgentToken(token)
    }
  });
  const stopCommandTimeoutSweepJob = startCommandTimeoutSweepJob(service, options.commandTimeoutSweep);
  const stopSystemAlertNotificationRetryJob = startSystemAlertNotificationRetryJob(
    api,
    options.systemAlertNotificationRetryJob
  );
  const stopTelegramLongPollingJob = startTelegramLongPollingJob(api, options.telegramLongPollingJob);
  const stopTelegramNotificationDeliveryRetryJob = startTelegramNotificationDeliveryRetryJob(
    api,
    options.telegramNotificationDeliveryRetryJob
  );
  const stopAllBackgroundJobs = () => {
    stopCommandTimeoutSweepJob();
    stopSystemAlertNotificationRetryJob();
    stopTelegramLongPollingJob();
    stopTelegramNotificationDeliveryRetryJob();
  };
  server.on('close', stopAllBackgroundJobs);

  return {
    api,
    repository,
    service,
    server,
    runtimeMetrics,
    stopBackgroundJobs: stopAllBackgroundJobs
  };
}
