import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type {
  ControlPlaneRepository,
  ControlPlaneRepositoryState,
  ControlPlaneTransaction
} from './control-plane-repository';
import {
  assertControlPlaneRepositoryState,
  clone,
  createControlPlaneTransaction,
  createEmptyControlPlaneRepositoryState
} from './stateful-control-plane-repository';

type CreateFileControlPlaneRepositoryInput = {
  filePath: string;
  seed?: Partial<ControlPlaneRepositoryState>;
};

async function pathExists(filePath: string) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

async function readStateFile(filePath: string): Promise<ControlPlaneRepositoryState> {
  const raw = await readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw) as unknown;

  assertControlPlaneRepositoryState(parsed, filePath);
  return clone(parsed);
}

async function writeStateFile(filePath: string, state: ControlPlaneRepositoryState) {
  const directory = dirname(filePath);
  await mkdir(directory, { recursive: true });

  const tempPath = join(directory, `.${basename(filePath)}.${randomUUID()}.tmp`);
  await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await rename(tempPath, filePath);
}

export async function createFileControlPlaneRepository(
  input: CreateFileControlPlaneRepositoryInput
): Promise<ControlPlaneRepository> {
  let state = (await pathExists(input.filePath))
    ? await readStateFile(input.filePath)
    : createEmptyControlPlaneRepositoryState(input.seed);

  if (!(await pathExists(input.filePath))) {
    await writeStateFile(input.filePath, state);
  }

  let transactionQueue: Promise<void> = Promise.resolve();

  return {
    async transaction<T>(run: (transaction: ControlPlaneTransaction) => Promise<T>) {
      const execute = async () => {
        const draft = clone(state);
        const result = await run(createControlPlaneTransaction(draft));

        await writeStateFile(input.filePath, draft);
        state = draft;

        return clone(result);
      };

      const pending = transactionQueue.then(execute, execute);
      transactionQueue = pending.then(
        () => undefined,
        () => undefined
      );

      return pending;
    },

    async listTasks() {
      return clone(state.tasks);
    },

    async listAuditLogs() {
      return clone(state.auditLogs);
    },

    async listCommandOutbox() {
      return clone(state.commandOutbox);
    },

    async listAgentEvents() {
      return clone(state.agentEvents);
    },

    async listAgentSessions() {
      return clone(state.agentSessions);
    },

    async listOperatorSessions() {
      return clone(state.operatorSessions);
    },

    async listAgentCredentials() {
      return clone(state.agentCredentials);
    },

    async findAgentCredentialById(id: string) {
      return clone(state.agentCredentials.find((record) => record.id === id));
    },

    async findAgentCredentialByTokenHash(tokenHash: string) {
      return clone(state.agentCredentials.find((record) => record.tokenHash === tokenHash));
    },

    async listForwardRules() {
      return clone(state.forwardRules);
    },

    async listSubscriptionSources() {
      return clone(state.subscriptionSources);
    },

    async listSubscriptionClients() {
      return clone(state.subscriptionClients);
    },

    async listSubscriptionExportProfiles() {
      return clone(state.subscriptionExportProfiles);
    },

    async listSubscriptionInventoryNodes() {
      return clone(state.subscriptionInventoryNodes);
    },

    async listPermissionGrants() {
      return clone(state.permissionGrants);
    },

    async listConfigRevisions() {
      return clone(state.configRevisions);
    },

    async listPreflightPlans() {
      return clone(state.preflightPlans);
    },

    async listRuntimeSnapshots() {
      return clone(state.runtimeSnapshots);
    },

    async listTrafficRollups() {
      return clone(state.trafficRollups);
    },

    async findIdempotencyRecord(key: string) {
      return clone(state.idempotencyRecords.find((record) => record.key === key));
    }
  };
}
