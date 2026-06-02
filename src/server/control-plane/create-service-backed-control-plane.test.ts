import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServiceBackedControlPlane } from './create-service-backed-control-plane';

async function withControlPlane<T>(run: (baseUrl: string) => Promise<T>) {
  const { server } = await createServiceBackedControlPlane();

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('Service-backed control plane did not bind to a TCP port');
  }

  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

describe('createServiceBackedControlPlane', () => {
  it('starts a service-backed HTTP control plane with empty durable state and seeded inventory', async () => {
    await withControlPlane(async (baseUrl) => {
      const boundaryResponse = await fetch(`${baseUrl}/api/v1/boundary`);
      const boundaryEnvelope = await boundaryResponse.json();
      const snapshotResponse = await fetch(`${baseUrl}/api/v1/snapshot`);
      const snapshotEnvelope = await snapshotResponse.json();

      expect(boundaryResponse.status).toBe(200);
      expect(boundaryEnvelope.data).toMatchObject({
        version: 'v1',
        restBasePath: '/api/v1'
      });
      expect(snapshotResponse.status).toBe(200);
      expect(snapshotEnvelope.data).toMatchObject({
        tasks: [],
        auditLogs: []
      });
      expect(snapshotEnvelope.data.agents).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: 'agent-hkg-01' })])
      );
    });
  });

  it('persists service-backed HTTP mutation state when file storage is selected', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ou-ui-next-service-backed-'));
    const stateFilePath = join(directory, 'control-plane-state.json');

    try {
      const firstControlPlane = await createServiceBackedControlPlane({
        storage: 'file',
        stateFilePath
      });

      await new Promise<void>((resolve) => {
        firstControlPlane.server.listen(0, '127.0.0.1', resolve);
      });

      const firstAddress = firstControlPlane.server.address();

      if (!firstAddress || typeof firstAddress === 'string') {
        throw new Error('File-backed control plane did not bind to a TCP port');
      }

      const firstBaseUrl = `http://127.0.0.1:${firstAddress.port}`;

      const createResponse = await fetch(`${firstBaseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Actor': 'admin',
          'X-Operator-Group-Id': 'owner',
          'X-Resource-Group-Id': 'group-premium',
          'X-Request-Id': 'req-file-factory-forward-001',
          'Idempotency-Key': 'idem-file-factory-forward-001',
          'If-Match': 'forward-forward-hkg-443-v1'
        },
        body: JSON.stringify({
          operation: 'forward.apply',
          targetId: 'forward-hkg-443',
          targetLabel: 'FLVX Tunnel Fabric',
          summary: 'Apply file-backed forwarding policy'
        })
      });
      const createEnvelope = await createResponse.json();

      await new Promise<void>((resolve, reject) => {
        firstControlPlane.server.close((error) => (error ? reject(error) : resolve()));
      });

      const secondControlPlane = await createServiceBackedControlPlane({
        storage: 'file',
        stateFilePath
      });

      await new Promise<void>((resolve) => {
        secondControlPlane.server.listen(0, '127.0.0.1', resolve);
      });

      const secondAddress = secondControlPlane.server.address();

      if (!secondAddress || typeof secondAddress === 'string') {
        throw new Error('Restored file-backed control plane did not bind to a TCP port');
      }

      try {
        const snapshotResponse = await fetch(`http://127.0.0.1:${secondAddress.port}/api/v1/snapshot`);
        const snapshotEnvelope = await snapshotResponse.json();
        const outboxResponse = await fetch(`http://127.0.0.1:${secondAddress.port}/api/v1/command-outbox`);
        const outboxEnvelope = await outboxResponse.json();

        expect(createResponse.status).toBe(201);
        expect(snapshotEnvelope.data).toMatchObject({
          tasks: [expect.objectContaining({ id: createEnvelope.data.id })],
          auditLogs: [expect.objectContaining({ taskId: createEnvelope.data.id })]
        });
        expect(outboxEnvelope.data).toEqual([expect.objectContaining({ taskId: createEnvelope.data.id })]);
      } finally {
        await new Promise<void>((resolve, reject) => {
          secondControlPlane.server.close((error) => (error ? reject(error) : resolve()));
        });
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
