import {
  createHttpControlPlaneServer,
  type CreateHttpControlPlaneServerOptions
} from '../../services/api/http-control-plane-server';
import { createServiceBackedControlPlaneApi } from '../../services/api/service-backed-control-plane-api';
import type { AgentLogRetentionPolicy } from './agent-log-retention';
import type { ControlPlaneRepository, ControlPlaneRepositoryState } from './control-plane-repository';
import { createControlPlaneService } from './control-plane-service';
import { createFileControlPlaneRepository } from './file-control-plane-repository';
import { createInMemoryControlPlaneRepository } from './in-memory-control-plane-repository';

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

  return {
    api,
    repository,
    service,
    server
  };
}
