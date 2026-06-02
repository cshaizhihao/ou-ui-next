import {
  createHttpControlPlaneServer,
  type CreateHttpControlPlaneServerOptions
} from '../../services/api/http-control-plane-server';
import { createServiceBackedControlPlaneApi } from '../../services/api/service-backed-control-plane-api';
import type { ControlPlaneRepositoryState } from './control-plane-repository';
import {
  seedForwardRules,
  seedPermissionGrants,
  seedTasks,
  seedAuditLogs
} from '../../services/mock/mock-data';
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
};

function createDefaultSeed(seed: Partial<ControlPlaneRepositoryState> = {}): Partial<ControlPlaneRepositoryState> {
  return {
    tasks: seed.tasks ?? seedTasks,
    auditLogs: seed.auditLogs ?? seedAuditLogs,
    forwardRules: seed.forwardRules ?? seedForwardRules,
    permissionGrants: seed.permissionGrants ?? seedPermissionGrants,
    commandOutbox: seed.commandOutbox,
    agentEvents: seed.agentEvents,
    agentSessions: seed.agentSessions,
    idempotencyRecords: seed.idempotencyRecords
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
  const service = createControlPlaneService({ repository });
  const api = createServiceBackedControlPlaneApi({
    repository,
    service
  });
  const server = createHttpControlPlaneServer(api, {
    auth: options.auth
  });

  return {
    api,
    repository,
    service,
    server
  };
}
