import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AGENT_INSTALL_PROFILE, type PermissionGrant } from '../../domain';
import { seedForwardRules, seedPermissionGrants } from '../../services/mock/mock-data';
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
  it('starts a service-backed HTTP control plane with empty durable state and empty production inventory', async () => {
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
        auditLogs: [],
        agents: [],
        nodes: []
      });
    });
  });

  it('can boot with an empty operator inventory while preserving bootstrap task permissions', async () => {
    const auth = {
      operatorTokens: {
        'operator-token-empty': {
          actor: 'operator_001',
          operatorGroupId: 'owner',
          resourceGroupId: 'group-premium'
        }
      },
      agentTokens: {}
    };

    const controlPlane = await createServiceBackedControlPlane({
      auth,
      seed: {
        tasks: [],
        auditLogs: [],
        forwardRules: [],
        permissionGrants: [
          {
            id: 'grant-bootstrap-operator_001',
            subjectType: 'user',
            subjectId: 'operator_001',
            resourceType: 'tunnel-group',
            resourceId: 'group-premium',
            permissions: ['read', 'operate', 'configure', 'grant'],
            grantedBy: 'system:bootstrap',
            reason: 'bootstrap owner permissions'
          }
        ]
      },
      inventory: {
        agents: [],
        nodes: [],
        inbounds: [],
        subscriptionSources: [],
        subscriptionBundles: [],
        subscriptionClients: [],
        quotaPolicies: [],
        rateLimitPolicies: [],
        routingPolicies: [],
        tuningProfiles: []
      }
    });

    await new Promise<void>((resolve) => {
      controlPlane.server.listen(0, '127.0.0.1', resolve);
    });

    const address = controlPlane.server.address();

    if (!address || typeof address === 'string') {
      throw new Error('Empty-inventory control plane did not bind to a TCP port');
    }

    try {
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const snapshotResponse = await fetch(`${baseUrl}/api/v1/snapshot`, {
        headers: {
          Authorization: 'Bearer operator-token-empty'
        }
      });
      const snapshotEnvelope = await snapshotResponse.json();

      expect(snapshotResponse.status).toBe(200);
      expect(snapshotEnvelope.data.agents).toEqual([]);
      expect(snapshotEnvelope.data.nodes).toEqual([]);
      expect(snapshotEnvelope.data.permissionGrants).toHaveLength(1);

      const commandResponse = await fetch(`${baseUrl}/api/v1/agents/install-command`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer operator-token-empty',
          'Content-Type': 'application/json',
          'X-Request-Id': 'req-empty-inventory-install-command',
          'Idempotency-Key': 'idem-empty-inventory-install-command'
        },
        body: JSON.stringify({
          installProfile: [...AGENT_INSTALL_PROFILE],
          publicBaseUrl: 'https://panel.example.com/x7K2mP9vL4qR1wDz'
        })
      });
      const commandEnvelope = await commandResponse.json();

      expect(commandResponse.status).toBe(201);
      expect(commandEnvelope.data.command).toContain('public/install/ou-agent.sh');
      expect(commandEnvelope.data.command).toContain("OU_AGENT_ID='");
      expect(commandEnvelope.data.command).toContain("OU_INSTALL_TOKEN='");
      expect(commandEnvelope.data.command).not.toContain('OU_HOST_NAME=');
      expect(commandEnvelope.data.command).not.toContain('OU_CUSTOMER_NODE');
      expect(commandEnvelope.data.command).not.toContain('OU_INSTALL_PROFILE=');
      expect(commandEnvelope.data.command).not.toContain('master.example.com');

      const registerResponse = await fetch(`${baseUrl}/agent/v1/register`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${commandEnvelope.data.installToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          agentId: commandEnvelope.data.agentId,
          requestId: 'req-empty-inventory-register',
          sessionId: 'sess-empty-inventory-register',
          version: '1.0.0-runtime',
          platform: 'linux-x64',
          capabilities: [...AGENT_INSTALL_PROFILE]
        })
      });
      const registerEnvelope = await registerResponse.json();

      expect(registerResponse.status).toBe(201);
      expect(registerEnvelope.data.agentId).toBe(commandEnvelope.data.agentId);

      const agentsResponse = await fetch(`${baseUrl}/api/v1/agents`, {
        headers: {
          Authorization: 'Bearer operator-token-empty'
        }
      });
      const agentsEnvelope = await agentsResponse.json();

      expect(agentsResponse.status).toBe(200);
      expect(agentsEnvelope.data).toEqual([
        expect.objectContaining({
          id: commandEnvelope.data.agentId,
          name: commandEnvelope.data.agentId,
          status: 'provisioning',
          capabilities: expect.arrayContaining(['host-agent', 'xray', 'port-forwarding'])
        })
      ]);

      const taskResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer operator-token-empty',
          'Content-Type': 'application/json',
          'X-Request-Id': 'req-empty-inventory-task',
          'Idempotency-Key': 'idem-empty-inventory-task'
        },
        body: JSON.stringify({
          operation: 'agent.deploy',
          resourceType: 'agent',
          targetId: 'agent-edge-empty-01',
          targetLabel: 'Edge Empty 01',
          summary: 'Generate one-click host enrollment command',
          metadata: {
            hostName: 'edge-empty-01',
            installProfile: ['host-agent', 'xray', 'port-forwarding', 'telemetry', 'command-channel']
          }
        })
      });
      const taskEnvelope = await taskResponse.json();

      expect(taskResponse.status).toBe(201);
      expect(taskEnvelope.data).toMatchObject({
        operation: 'agent.deploy',
        status: 'queued',
        targetId: 'agent-edge-empty-01'
      });

      const updateResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer operator-token-empty',
          'Content-Type': 'application/json',
          'X-Request-Id': 'req-empty-inventory-host-update',
          'Idempotency-Key': 'idem-empty-inventory-host-update'
        },
        body: JSON.stringify({
          operation: 'agent.update',
          resourceType: 'agent',
          targetId: commandEnvelope.data.agentId,
          targetLabel: '自定义主机名称',
          summary: 'Update managed host profile',
          metadata: {
            agentId: commandEnvelope.data.agentId,
            hostName: '自定义主机名称',
            maxTrafficGb: 1024,
            monthlyTrafficGb: 1024,
            trafficAccountingMode: 'both',
            monthlyResetDay: 1,
            currentUsedTrafficGb: 0,
            expiresAt: '2026-12-31T00:00:00.000Z',
            pingTarget: '1.1.1.1',
            pingIntervalSeconds: 30
          }
        })
      });
      const updateEnvelope = await updateResponse.json();

      expect(updateResponse.status).toBe(201);
      expect(updateEnvelope.data).toMatchObject({
        operation: 'agent.update',
        status: 'queued',
        targetId: commandEnvelope.data.agentId,
        targetLabel: '自定义主机名称'
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        controlPlane.server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('repairs bootstrap operator permissions when an update preserves an older empty state file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ou-ui-next-old-state-'));
    const stateFilePath = join(directory, 'control-plane-state.json');
    const bootstrapPermissionGrant: PermissionGrant = {
      id: 'grant-bootstrap-owner-operator_legacy',
      subjectType: 'user' as const,
      subjectId: 'operator_legacy',
      resourceType: 'tunnel-group' as const,
      resourceId: 'group-premium',
      permissions: ['read', 'operate', 'configure', 'grant'],
      grantedBy: 'system:bootstrap',
      reason: 'bootstrap owner permissions'
    };

    await writeFile(
      stateFilePath,
      `${JSON.stringify(
        {
          tasks: [],
          auditLogs: [],
          commandOutbox: [],
          agentEvents: [],
          agentSessions: [],
          agentCredentials: [],
          idempotencyRecords: [],
          forwardRules: [],
          permissionGrants: [],
          configRevisions: [],
          preflightPlans: [],
          runtimeSnapshots: []
        },
        null,
        2
      )}\n`,
      'utf8'
    );

    const controlPlane = await createServiceBackedControlPlane({
      storage: 'file',
      stateFilePath,
      auth: {
        operatorTokens: {
          'operator-token-legacy': {
            actor: 'operator_legacy',
            operatorGroupId: 'owner',
            resourceGroupId: 'group-premium'
          }
        },
        agentTokens: {}
      },
      seed: {
        tasks: [],
        auditLogs: [],
        forwardRules: [],
        permissionGrants: [bootstrapPermissionGrant]
      },
      inventory: {
        agents: [],
        nodes: [],
        inbounds: [],
        subscriptionSources: [],
        subscriptionBundles: [],
        subscriptionClients: [],
        quotaPolicies: [],
        rateLimitPolicies: [],
        routingPolicies: [],
        tuningProfiles: []
      }
    });

    await new Promise<void>((resolve) => {
      controlPlane.server.listen(0, '127.0.0.1', resolve);
    });

    const address = controlPlane.server.address();

    if (!address || typeof address === 'string') {
      throw new Error('Legacy-state control plane did not bind to a TCP port');
    }

    try {
      await expect(controlPlane.repository.listPermissionGrants()).resolves.toEqual([
        expect.objectContaining({
          id: bootstrapPermissionGrant.id,
          subjectId: 'operator_legacy',
          resourceId: 'group-premium',
          permissions: ['read', 'operate', 'configure', 'grant']
        })
      ]);

      const taskResponse = await fetch(`http://127.0.0.1:${address.port}/api/v1/tasks`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer operator-token-legacy',
          'Content-Type': 'application/json',
          'X-Request-Id': 'req-legacy-state-agent-install',
          'Idempotency-Key': 'idem-legacy-state-agent-install'
        },
        body: JSON.stringify({
          operation: 'agent.deploy',
          resourceType: 'agent',
          targetId: 'agent-legacy-install',
          targetLabel: 'Agent one-click installer',
          summary: 'Generate one-click host enrollment command',
          metadata: {
            installProfile: ['host-agent', 'xray', 'port-forwarding', 'telemetry', 'command-channel']
          }
        })
      });
      const taskEnvelope = await taskResponse.json();

      expect(taskResponse.status).toBe(201);
      expect(taskEnvelope.data).toMatchObject({
        operation: 'agent.deploy',
        status: 'queued',
        targetId: 'agent-legacy-install'
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        controlPlane.server.close((error) => (error ? reject(error) : resolve()));
      });
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('persists Agent install credentials so enrolled hosts can poll after a file-backed restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ou-ui-next-agent-credential-'));
    const stateFilePath = join(directory, 'control-plane-state.json');
    const auth = {
      operatorTokens: {
        'operator-token-001': {
          actor: 'admin',
          operatorGroupId: 'owner',
          resourceGroupId: 'group-premium'
        }
      },
      agentTokens: {}
    };

    try {
      const firstControlPlane = await createServiceBackedControlPlane({
        storage: 'file',
        stateFilePath,
        auth
      });

      await new Promise<void>((resolve) => {
        firstControlPlane.server.listen(0, '127.0.0.1', resolve);
      });

      const firstAddress = firstControlPlane.server.address();

      if (!firstAddress || typeof firstAddress === 'string') {
        throw new Error('File-backed control plane did not bind to a TCP port');
      }

      const firstBaseUrl = `http://127.0.0.1:${firstAddress.port}`;
      const commandResponse = await fetch(`${firstBaseUrl}/api/v1/agents/install-command`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer operator-token-001',
          'Content-Type': 'application/json',
          'X-Request-Id': 'req-file-backed-install-command',
          'Idempotency-Key': 'idem-file-backed-install-command'
        },
        body: JSON.stringify({
          installProfile: [...AGENT_INSTALL_PROFILE],
          publicBaseUrl: 'https://panel.example.com/x7K2mP9vL4qR1wDz'
        })
      });
      const commandEnvelope = await commandResponse.json();
      const registerResponse = await fetch(`${firstBaseUrl}/agent/v1/register`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${commandEnvelope.data.installToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          agentId: commandEnvelope.data.agentId,
          requestId: 'req-file-backed-agent-register',
          sessionId: 'sess-file-backed-agent-register',
          version: '0.1.0-test',
          platform: 'linux-x64',
          capabilities: [...AGENT_INSTALL_PROFILE]
        })
      });
      const registerEnvelope = await registerResponse.json();

      await new Promise<void>((resolve, reject) => {
        firstControlPlane.server.close((error) => (error ? reject(error) : resolve()));
      });

      const secondControlPlane = await createServiceBackedControlPlane({
        storage: 'file',
        stateFilePath,
        auth
      });

      await new Promise<void>((resolve) => {
        secondControlPlane.server.listen(0, '127.0.0.1', resolve);
      });

      const secondAddress = secondControlPlane.server.address();

      if (!secondAddress || typeof secondAddress === 'string') {
        throw new Error('Restored file-backed control plane did not bind to a TCP port');
      }

      try {
        const pollResponse = await fetch(`http://127.0.0.1:${secondAddress.port}/agent/v1/poll`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${registerEnvelope.data.agentToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            agentId: commandEnvelope.data.agentId,
            requestId: 'req-file-backed-agent-poll-after-restart',
            sessionId: 'sess-file-backed-agent-register',
            lastSeenCommandSeq: 0
          })
        });
        const pollEnvelope = await pollResponse.json();
        const mismatchedSessionResponse = await fetch(`http://127.0.0.1:${secondAddress.port}/agent/v1/poll`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${registerEnvelope.data.agentToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            agentId: commandEnvelope.data.agentId,
            requestId: 'req-file-backed-agent-poll-session-mismatch',
            sessionId: 'sess-file-backed-agent-mismatch',
            lastSeenCommandSeq: 0
          })
        });
        const mismatchedSessionEnvelope = await mismatchedSessionResponse.json();
        const mismatchedEventSessionResponse = await fetch(`http://127.0.0.1:${secondAddress.port}/agent/v1/events`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${registerEnvelope.data.agentToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            events: [
              {
                type: 'heartbeat',
                eventId: 'evt-file-backed-session-mismatch',
                agentId: commandEnvelope.data.agentId,
                seq: 1,
                sessionId: 'sess-file-backed-agent-mismatch',
                observedAt: new Date().toISOString(),
                payload: {
                  version: '0.1.0-test',
                  uptimeSeconds: 30,
                  capabilities: ['xray'],
                  lastSeenCommandSeq: 0
                }
              }
            ]
          })
        });
        const mismatchedEventSessionEnvelope = await mismatchedEventSessionResponse.json();
        const listCredentialsResponse = await fetch(`http://127.0.0.1:${secondAddress.port}/api/v1/agent-credentials`, {
          headers: {
            Authorization: 'Bearer operator-token-001'
          }
        });
        const listCredentialsEnvelope = await listCredentialsResponse.json();
        const revokeResponse = await fetch(
          `http://127.0.0.1:${secondAddress.port}/api/v1/agent-credentials/${encodeURIComponent(registerEnvelope.data.credentialId)}/revoke`,
          {
            method: 'POST',
            headers: {
              Authorization: 'Bearer operator-token-001',
              'Content-Type': 'application/json',
              'X-Request-Id': 'req-file-backed-agent-credential-revoke',
              'Idempotency-Key': 'idem-file-backed-agent-credential-revoke'
            },
            body: JSON.stringify({
              reason: 'operator initiated runtime credential rotation'
            })
          }
        );
        const revokeEnvelope = await revokeResponse.json();
        const pollAfterRevokeResponse = await fetch(`http://127.0.0.1:${secondAddress.port}/agent/v1/poll`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${registerEnvelope.data.agentToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            agentId: commandEnvelope.data.agentId,
            requestId: 'req-file-backed-agent-poll-after-revoke',
            sessionId: 'sess-file-backed-agent-register',
            lastSeenCommandSeq: 0
          })
        });
        const credentials = await secondControlPlane.repository.listAgentCredentials();
        const auditLogs = await secondControlPlane.repository.listAuditLogs();

        expect(commandResponse.status).toBe(201);
        expect(registerResponse.status).toBe(201);
        expect(pollResponse.status).toBe(200);
        expect(pollEnvelope.data).toMatchObject({
          commands: [],
          nextPollAfterMs: expect.any(Number)
        });
        expect(mismatchedSessionResponse.status).toBe(403);
        expect(mismatchedSessionEnvelope.error).toMatchObject({
          code: 'identity.mismatch'
        });
        expect(mismatchedEventSessionResponse.status).toBe(403);
        expect(mismatchedEventSessionEnvelope.error).toMatchObject({
          code: 'identity.mismatch'
        });
        expect(listCredentialsResponse.status).toBe(200);
        expect(JSON.stringify(listCredentialsEnvelope.data)).not.toContain('tokenHash');
        expect(revokeResponse.status).toBe(202);
        expect(revokeEnvelope.data).toEqual(
          expect.objectContaining({
            id: registerEnvelope.data.credentialId,
            status: 'revoked',
            revokedReason: 'operator initiated runtime credential rotation'
          })
        );
        expect(pollAfterRevokeResponse.status).toBe(401);
        expect(JSON.stringify(credentials)).not.toContain(commandEnvelope.data.installToken);
        expect(JSON.stringify(credentials)).not.toContain(registerEnvelope.data.agentToken);
        expect(credentials).toEqual([
          expect.objectContaining({
            agentId: commandEnvelope.data.agentId,
            purpose: 'runtime',
            lastUsedAt: expect.any(String),
            sessionId: 'sess-file-backed-agent-register',
            status: 'revoked'
          }),
          expect.objectContaining({
            agentId: commandEnvelope.data.agentId,
            purpose: 'install',
            status: 'revoked',
            replacedByCredentialId: registerEnvelope.data.credentialId
          })
        ]);
        expect(auditLogs).toEqual([
          expect.objectContaining({
            action: 'agent.credential.revoked',
            requestId: 'req-file-backed-agent-credential-revoke'
          })
        ]);
      } finally {
        await new Promise<void>((resolve, reject) => {
          secondControlPlane.server.close((error) => (error ? reject(error) : resolve()));
        });
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('persists service-backed HTTP mutation state when file storage is selected', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ou-ui-next-service-backed-'));
    const stateFilePath = join(directory, 'control-plane-state.json');

    try {
      const firstControlPlane = await createServiceBackedControlPlane({
        storage: 'file',
        stateFilePath,
        seed: {
          forwardRules: seedForwardRules,
          permissionGrants: seedPermissionGrants
        }
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
          targetLabel: 'Port Forwarding Fabric',
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
