import {
  createHttpControlPlaneServer,
  type CreateHttpControlPlaneServerOptions
} from '../../services/api/http-control-plane-server';
import { createServiceBackedControlPlaneApi } from '../../services/api/service-backed-control-plane-api';
import type { CommandTimeoutSweepResult } from '../../services/api/control-plane-api';
import type { AgentLogRetentionPolicy } from './agent-log-retention';
import type { ControlPlaneRepository, ControlPlaneRepositoryState } from './control-plane-repository';
import { createControlPlaneService } from './control-plane-service';
import { createFileControlPlaneRepository } from './file-control-plane-repository';
import { createInMemoryControlPlaneRepository } from './in-memory-control-plane-repository';

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

type CreateServiceBackedControlPlaneOptions = (
  | {
      storage?: 'memory';
    }
  | {
      storage: 'file';
      stateFilePath: string;
  }
) & {
  seed?: Partial<ControlPlaneRepositoryState>;
  auth?: CreateHttpControlPlaneServerOptions['auth'];
  agentLogRetention?: Partial<AgentLogRetentionPolicy>;
  commandTimeoutSweep?: CommandTimeoutSweepJobOptions;
  inventory?: Parameters<typeof createServiceBackedControlPlaneApi>[0]['inventory'];
  fetcher?: Parameters<typeof createServiceBackedControlPlaneApi>[0]['fetcher'];
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
    subscriptionInventoryNodes: seed.subscriptionInventoryNodes
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

export async function createServiceBackedControlPlane(options: CreateServiceBackedControlPlaneOptions = {}) {
  const seed = createDefaultSeed(options.seed);
  const repository =
    options.storage === 'file'
      ? await createFileControlPlaneRepository({
          filePath: options.stateFilePath,
          seed
        })
      : createInMemoryControlPlaneRepository(seed);
  await ensureBootstrapPermissionGrants(repository, seed.permissionGrants);
  const service = createControlPlaneService({
    repository,
    agentLogRetention: options.agentLogRetention
  });
  const api = createServiceBackedControlPlaneApi({
    repository,
    service,
    ...(options.fetcher ? { fetcher: options.fetcher } : {}),
    ...(options.inventory ? { inventory: options.inventory } : {})
  });
  const server = createHttpControlPlaneServer(api, {
    auth: {
      ...options.auth,
      agentTokenResolver: (token) => service.resolveAgentToken(token)
    }
  });
  const stopBackgroundJobs = startCommandTimeoutSweepJob(service, options.commandTimeoutSweep);
  server.on('close', stopBackgroundJobs);

  return {
    api,
    repository,
    service,
    server,
    stopBackgroundJobs
  };
}
