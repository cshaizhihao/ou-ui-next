import {
  createHttpControlPlaneServer,
  type CreateHttpControlPlaneServerOptions
} from '../../services/api/http-control-plane-server';
import { createServiceBackedControlPlaneApi } from '../../services/api/service-backed-control-plane-api';
import type {
  CommandTimeoutSweepResult,
  ControlPlaneApi
} from '../../services/api/control-plane-api';
import type {
  SystemAlertNotificationRetryResult,
  SystemAlertNotifier
} from '../../services/api/system-alert-notifications';
import type { AgentLogRetentionPolicy } from './agent-log-retention';
import type { ControlPlaneRepository, ControlPlaneRepositoryState } from './control-plane-repository';
import { createControlPlaneService } from './control-plane-service';
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
  subscriptionSourceEgress?: Parameters<typeof createServiceBackedControlPlaneApi>[0]['subscriptionSourceEgress'];
  subscriptionSourceProviderBudget?: Parameters<typeof createServiceBackedControlPlaneApi>[0]['subscriptionSourceProviderBudget'];
  subscriptionSourceSyncBudget?: Parameters<typeof createServiceBackedControlPlaneApi>[0]['subscriptionSourceSyncBudget'];
  systemAlertNotifier?: SystemAlertNotifier;
  systemAlertNotificationRetry?: Parameters<typeof createServiceBackedControlPlaneApi>[0]['systemAlertNotificationRetry'];
  systemAlertNotificationRetryJob?: SystemAlertNotificationRetryJobOptions;
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

export async function createServiceBackedControlPlane(options: CreateServiceBackedControlPlaneOptions = {}) {
  const seed = createDefaultSeed(options.seed);
  const repository =
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
  await ensureBootstrapPermissionGrants(repository, seed.permissionGrants);
  const service = createControlPlaneService({
    repository,
    agentLogRetention: options.agentLogRetention,
    trafficRollupRetention: options.trafficRollupRetention,
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
    ...(options.subscriptionSourceEgress ? { subscriptionSourceEgress: options.subscriptionSourceEgress } : {}),
    ...(options.subscriptionSourceProviderBudget
      ? { subscriptionSourceProviderBudget: options.subscriptionSourceProviderBudget }
      : {}),
    ...(options.subscriptionSourceSyncBudget ? { subscriptionSourceSyncBudget: options.subscriptionSourceSyncBudget } : {}),
    ...(options.systemAlertNotifier ? { systemAlertNotifier: options.systemAlertNotifier } : {}),
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
  const stopAllBackgroundJobs = () => {
    stopCommandTimeoutSweepJob();
    stopSystemAlertNotificationRetryJob();
  };
  server.on('close', stopAllBackgroundJobs);

  return {
    api,
    repository,
    service,
    server,
    stopBackgroundJobs: stopAllBackgroundJobs
  };
}
