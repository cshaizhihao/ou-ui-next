import { scryptSync } from 'node:crypto';
import { createMockApi } from '../mock/mock-api';
import {
  createHttpControlPlaneServer,
  type ControlPlaneStructuredLogEvent,
  type CreateHttpControlPlaneServerOptions
} from './http-control-plane-server';

function createTestScryptPasswordHash(password: string) {
  const salt = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
  const key = scryptSync(password, salt, 32);

  return `scrypt:v1:${salt.toString('hex')}:${key.toString('hex')}`;
}

async function withAuthenticatedServer<T>(
  run: (baseUrl: string) => Promise<T>,
  options: Omit<CreateHttpControlPlaneServerOptions, 'auth'> = {}
) {
  const server = createHttpControlPlaneServer(createMockApi({ seedInventory: true }), {
    ...options,
    auth: {
      operatorTokens: {
        'operator-token-001': {
          actor: 'admin',
          operatorGroupId: 'owner',
          resourceGroupId: 'group-premium'
        }
      },
      operatorSession: {
        username: 'operator_001',
        password: 'operator-password-001',
        sessionSecret: 'operator-session-secret-001',
        actor: 'operator:alice',
        operatorGroupId: 'owner',
        resourceGroupId: 'group-premium',
        ttlMs: 3_600_000
      },
      agentTokens: {
        'agent-token-hkg-001': {
          agentId: 'agent-hkg-01'
        }
      }
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('Authenticated HTTP control-plane test server did not bind to a TCP port');
  }

  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

describe('HTTP control-plane authentication boundary', () => {
  it('rejects protected mutations without an operator bearer token', async () => {
    await withAuthenticatedServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Actor': 'admin',
          'X-Operator-Group-Id': 'owner',
          'X-Request-Id': 'req-auth-missing-token',
          'Idempotency-Key': 'idem-auth-missing-token'
        },
        body: JSON.stringify({
          operation: 'forward.apply',
          targetId: 'forward-hkg-443',
          targetLabel: 'Port Forwarding Fabric',
          summary: 'Attempt unauthenticated forwarding policy'
        })
      });
      const envelope = await response.json();

      expect(response.status).toBe(401);
      expect(envelope.error).toMatchObject({
        code: 'unauthorized'
      });

      const auditResponse = await fetch(`${baseUrl}/api/v1/audit-logs`, {
        headers: {
          Authorization: 'Bearer operator-token-001'
        }
      });
      const auditEnvelope = await auditResponse.json();
      const operatorDenials = auditEnvelope.data.filter(
        (log: { action: string; operation: string }) => log.action === 'audit.denied' && log.operation === 'operator.auth'
      );

      expect(operatorDenials).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            actor: 'operator:unauthenticated',
            targetId: 'POST /api/v1/tasks',
            requestId: 'req-auth-missing-token',
            denialCode: 'unauthorized',
            after: {
              method: 'POST',
              path: '/api/v1/tasks',
              tokenPresented: false
            }
          })
        ])
      );
      expect(JSON.stringify(operatorDenials)).not.toContain('operator-token-001');
    });
  });

  it('issues an HttpOnly operator session cookie and accepts it on protected routes', async () => {
    await withAuthenticatedServer(async (baseUrl) => {
      const loginResponse = await fetch(`${baseUrl}/api/v1/auth/session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': 'req-operator-session-login',
          'X-Forwarded-Prefix': '/secure-panel',
          'X-Forwarded-Proto': 'https'
        },
        body: JSON.stringify({
          username: 'operator_001',
          password: 'operator-password-001'
        })
      });
      const loginEnvelope = await loginResponse.json();
      const setCookie = loginResponse.headers.get('set-cookie') ?? '';
      const sessionCookie = setCookie.split(';')[0];
      const csrfToken = loginEnvelope.data.csrfToken;

      expect(loginResponse.status).toBe(201);
      expect(loginEnvelope.data).toMatchObject({
        authenticated: true,
        sessionId: expect.any(String),
        username: 'operator_001',
        actor: 'operator:alice',
        operatorGroupId: 'owner',
        resourceGroupId: 'group-premium'
      });
      expect(csrfToken).toEqual(expect.any(String));
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('SameSite=Lax');
      expect(setCookie).toContain('Secure');
      expect(setCookie).toContain('Path=/secure-panel');
      expect(sessionCookie).toContain('ou_ui_next_operator_session=');

      const sessionResponse = await fetch(`${baseUrl}/api/v1/auth/session`, {
        headers: {
          Cookie: sessionCookie
        }
      });
      const snapshotResponse = await fetch(`${baseUrl}/api/v1/snapshot`, {
        headers: {
          Cookie: sessionCookie
        }
      });
      const taskResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
          'X-CSRF-Token': csrfToken,
          'X-Request-Id': 'req-operator-session-task',
          'Idempotency-Key': 'idem-operator-session-task'
        },
        body: JSON.stringify({
          operation: 'forward.apply',
          targetId: 'forward-hkg-443',
          targetLabel: 'Port Forwarding Fabric',
          summary: 'Apply forwarding policy with session cookie'
        })
      });
      const taskEnvelope = await taskResponse.json();

      expect(sessionResponse.status).toBe(200);
      expect(snapshotResponse.status).toBe(200);
      expect(taskResponse.status).toBe(201);
      expect(taskEnvelope.data).toMatchObject({
        actor: 'operator:alice'
      });
      expect(JSON.stringify(loginEnvelope)).not.toContain('operator-password-001');
      expect(setCookie).not.toContain('operator-password-001');
    });
  });

  it('issues operator sessions from a scrypt password hash without plaintext server config', async () => {
    const server = createHttpControlPlaneServer(createMockApi({ seedInventory: true }), {
      auth: {
        operatorSession: {
          username: 'operator_hash',
          passwordHash: createTestScryptPasswordHash('operator-password-hash-001'),
          sessionSecret: 'operator-session-secret-hash-001',
          actor: 'operator:hash',
          operatorGroupId: 'owner',
          resourceGroupId: 'group-premium'
        }
      }
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address();

    if (!address || typeof address === 'string') {
      throw new Error('Hash-auth HTTP control-plane test server did not bind to a TCP port');
    }

    try {
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const deniedResponse = await fetch(`${baseUrl}/api/v1/auth/session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': 'req-operator-session-hash-denied'
        },
        body: JSON.stringify({
          username: 'operator_hash',
          password: 'wrong-password'
        })
      });
      const loginResponse = await fetch(`${baseUrl}/api/v1/auth/session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': 'req-operator-session-hash-login'
        },
        body: JSON.stringify({
          username: 'operator_hash',
          password: 'operator-password-hash-001'
        })
      });
      const cookie = loginResponse.headers.get('set-cookie')?.split(';')[0] ?? '';
      const snapshotResponse = await fetch(`${baseUrl}/api/v1/snapshot`, {
        headers: {
          Cookie: cookie
        }
      });

      expect(deniedResponse.status).toBe(401);
      expect(loginResponse.status).toBe(201);
      expect(cookie).toContain('ou_ui_next_operator_session=');
      expect(snapshotResponse.status).toBe(200);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('lists and revokes persisted operator sessions through the protected session routes', async () => {
    await withAuthenticatedServer(async (baseUrl) => {
      const loginResponse = await fetch(`${baseUrl}/api/v1/auth/session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': 'req-operator-session-revoke-login'
        },
        body: JSON.stringify({
          username: 'operator_001',
          password: 'operator-password-001'
        })
      });
      const loginEnvelope = await loginResponse.json();
      const sessionCookie = (loginResponse.headers.get('set-cookie') ?? '').split(';')[0];
      const csrfToken = loginEnvelope.data.csrfToken;
      const sessionId = loginEnvelope.data.sessionId;

      const listResponse = await fetch(`${baseUrl}/api/v1/operator-sessions`, {
        headers: {
          Cookie: sessionCookie
        }
      });
      const listEnvelope = await listResponse.json();

      expect(listResponse.status).toBe(200);
      expect(listEnvelope.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: sessionId,
            status: 'active',
            username: 'operator_001'
          })
        ])
      );

      const revokeResponse = await fetch(`${baseUrl}/api/v1/operator-sessions/${sessionId}/revoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
          'X-CSRF-Token': csrfToken,
          'X-Request-Id': 'req-operator-session-revoke'
        },
        body: JSON.stringify({
          reason: 'security rotation'
        })
      });
      const revokeEnvelope = await revokeResponse.json();

      expect(revokeResponse.status).toBe(202);
      expect(revokeEnvelope.data).toMatchObject({
        id: sessionId,
        status: 'revoked',
        revokedReason: 'security rotation'
      });

      const sessionResponse = await fetch(`${baseUrl}/api/v1/auth/session`, {
        headers: {
          Cookie: sessionCookie
        }
      });

      expect(sessionResponse.status).toBe(401);
    });
  });

  it('rejects and audits session-backed mutations without a CSRF token', async () => {
    await withAuthenticatedServer(async (baseUrl) => {
      const loginResponse = await fetch(`${baseUrl}/api/v1/auth/session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': 'req-operator-session-csrf-login'
        },
        body: JSON.stringify({
          username: 'operator_001',
          password: 'operator-password-001'
        })
      });
      const sessionCookie = (loginResponse.headers.get('set-cookie') ?? '').split(';')[0];

      const deniedResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
          'X-Request-Id': 'req-operator-session-csrf-denied',
          'Idempotency-Key': 'idem-operator-session-csrf-denied'
        },
        body: JSON.stringify({
          operation: 'forward.apply',
          targetId: 'forward-hkg-443',
          targetLabel: 'Port Forwarding Fabric',
          summary: 'Attempt session mutation without CSRF token'
        })
      });
      const deniedEnvelope = await deniedResponse.json();

      expect(deniedResponse.status).toBe(403);
      expect(deniedEnvelope.error).toMatchObject({
        code: 'csrf.required'
      });

      const bearerDeniedResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer operator-token-001',
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
          'X-Request-Id': 'req-operator-session-bearer-csrf-denied',
          'Idempotency-Key': 'idem-operator-session-bearer-csrf-denied'
        },
        body: JSON.stringify({
          operation: 'forward.apply',
          targetId: 'forward-hkg-443',
          targetLabel: 'Port Forwarding Fabric',
          summary: 'Attempt session mutation with injected bearer but without CSRF token'
        })
      });
      const bearerDeniedEnvelope = await bearerDeniedResponse.json();

      expect(bearerDeniedResponse.status).toBe(403);
      expect(bearerDeniedEnvelope.error).toMatchObject({
        code: 'csrf.required'
      });

      const auditResponse = await fetch(`${baseUrl}/api/v1/audit-logs`, {
        headers: {
          Authorization: 'Bearer operator-token-001'
        }
      });
      const auditEnvelope = await auditResponse.json();
      const csrfDenials = auditEnvelope.data.filter(
        (log: { action: string; operation: string; targetId: string; requestId: string }) =>
          log.action === 'audit.denied' &&
          log.operation === 'operator.auth' &&
          log.targetId === 'POST /api/v1/tasks' &&
          (log.requestId === 'req-operator-session-csrf-denied' ||
            log.requestId === 'req-operator-session-bearer-csrf-denied')
      );

      expect(csrfDenials).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            requestId: 'req-operator-session-csrf-denied',
            denialCode: 'csrf.required',
            denialReason: 'A valid CSRF token is required for session-backed mutations.'
          }),
          expect.objectContaining({
            requestId: 'req-operator-session-bearer-csrf-denied',
            denialCode: 'csrf.required',
            denialReason: 'A valid CSRF token is required for session-backed mutations.'
          })
        ])
      );
      expect(JSON.stringify(csrfDenials)).not.toContain('operator-password-001');
    });
  });

  it('does not throttle or audit anonymous session-check misses on the auth/session probe route', async () => {
    await withAuthenticatedServer(async (baseUrl) => {
      const responses = [];

      for (let index = 1; index <= 3; index += 1) {
        responses.push(
          await fetch(`${baseUrl}/api/v1/auth/session`, {
            headers: {
              'X-Forwarded-For': '203.0.113.44',
              'X-Request-Id': `req-operator-session-check-miss-${index}`
            }
          })
        );
      }

      expect(responses.map((response) => response.status)).toEqual([401, 401, 401]);

      const auditResponse = await fetch(`${baseUrl}/api/v1/audit-logs`, {
        headers: {
          Authorization: 'Bearer operator-token-001'
        }
      });
      const auditEnvelope = await auditResponse.json();
      const sessionCheckDenials = auditEnvelope.data.filter(
        (log: { action: string; targetId: string; requestId: string }) =>
          log.action === 'audit.denied' &&
          log.targetId === 'GET /api/v1/auth/session' &&
          log.requestId.startsWith('req-operator-session-check-miss-')
      );

      expect(sessionCheckDenials).toEqual([]);
    });
  });

  it('audits denied operator session login without exposing submitted passwords', async () => {
    await withAuthenticatedServer(async (baseUrl) => {
      const deniedResponse = await fetch(`${baseUrl}/api/v1/auth/session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': 'req-operator-session-denied'
        },
        body: JSON.stringify({
          username: 'operator_001',
          password: 'wrong-password'
        })
      });

      expect(deniedResponse.status).toBe(401);

      const auditResponse = await fetch(`${baseUrl}/api/v1/audit-logs`, {
        headers: {
          Authorization: 'Bearer operator-token-001'
        }
      });
      const auditEnvelope = await auditResponse.json();
      const loginDenials = auditEnvelope.data.filter(
        (log: { action: string; operation: string; targetId: string; requestId: string }) =>
          log.action === 'audit.denied' &&
          log.operation === 'operator.auth' &&
          log.targetId === 'POST /api/v1/auth/session' &&
          log.requestId === 'req-operator-session-denied'
      );

      expect(loginDenials).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            denialCode: 'unauthorized',
            denialReason: 'Operator login credentials are invalid.',
            after: {
              method: 'POST',
              path: '/api/v1/auth/session',
              tokenPresented: false
            }
          })
        ])
      );
      expect(JSON.stringify(loginDenials)).not.toContain('wrong-password');
      expect(JSON.stringify(loginDenials)).not.toContain('operator-password-001');
    });
  });

  it('protects sensitive read routes when operator tokens are configured', async () => {
    await withAuthenticatedServer(async (baseUrl) => {
      const openBoundaryResponse = await fetch(`${baseUrl}/api/v1/boundary`);
      const protectedSnapshotResponse = await fetch(`${baseUrl}/api/v1/snapshot`);
      const protectedMetricsResponse = await fetch(`${baseUrl}/api/v1/observability-metrics`);
      const protectedPrometheusMetricsResponse = await fetch(`${baseUrl}/metrics`);
      const protectedAgentLogRetentionResponse = await fetch(`${baseUrl}/api/v1/agent-log-retention-policy`);
      const protectedTrafficRollupRetentionResponse = await fetch(`${baseUrl}/api/v1/traffic-rollup-retention-policy`);
      const protectedAgentLogExportResponse = await fetch(`${baseUrl}/api/v1/agent-log-chunks:export`);
      const protectedAgentLogArchivesResponse = await fetch(`${baseUrl}/api/v1/agent-log-archives`);
      const protectedAgentLogArchiveExportResponse = await fetch(`${baseUrl}/api/v1/agent-log-archives:export`);
      const protectedTrafficRollupExportResponse = await fetch(`${baseUrl}/api/v1/traffic-rollups:export`);
      const protectedTrafficRollupCompactionsResponse = await fetch(`${baseUrl}/api/v1/traffic-rollup-compactions`);
      const protectedTrafficRollupCompactionExportResponse = await fetch(
        `${baseUrl}/api/v1/traffic-rollup-compactions:export`
      );
      const protectedAgentLogRetentionPatchResponse = await fetch(`${baseUrl}/api/v1/agent-log-retention-policy`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          maxAgeDays: 30,
          maxEventsPerAgent: 1000
        })
      });
      const protectedTrafficRollupRetentionPatchResponse = await fetch(
        `${baseUrl}/api/v1/traffic-rollup-retention-policy`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            maxAgeDays: 30,
            maxRecordsPerScope: 1000
          })
        }
      );
      const protectedOutboxResponse = await fetch(`${baseUrl}/api/v1/command-outbox`);
      const protectedSubscriptionNodesResponse = await fetch(`${baseUrl}/api/v1/subscription-nodes`);
      const protectedRevisionsResponse = await fetch(`${baseUrl}/api/v1/config-revisions`);
      const authorizedSnapshotResponse = await fetch(`${baseUrl}/api/v1/snapshot`, {
        headers: {
          Authorization: 'Bearer operator-token-001'
        }
      });

      expect(openBoundaryResponse.status).toBe(200);
      expect(protectedSnapshotResponse.status).toBe(401);
      expect(protectedMetricsResponse.status).toBe(401);
      expect(protectedPrometheusMetricsResponse.status).toBe(401);
      expect(protectedAgentLogRetentionResponse.status).toBe(401);
      expect(protectedTrafficRollupRetentionResponse.status).toBe(401);
      expect(protectedAgentLogExportResponse.status).toBe(401);
      expect(protectedAgentLogArchivesResponse.status).toBe(401);
      expect(protectedAgentLogArchiveExportResponse.status).toBe(401);
      expect(protectedTrafficRollupExportResponse.status).toBe(401);
      expect(protectedTrafficRollupCompactionsResponse.status).toBe(401);
      expect(protectedTrafficRollupCompactionExportResponse.status).toBe(401);
      expect(protectedAgentLogRetentionPatchResponse.status).toBe(401);
      expect(protectedTrafficRollupRetentionPatchResponse.status).toBe(401);
      expect(protectedOutboxResponse.status).toBe(401);
      expect(protectedSubscriptionNodesResponse.status).toBe(401);
      expect(protectedRevisionsResponse.status).toBe(401);
      expect(authorizedSnapshotResponse.status).toBe(200);

      const auditResponse = await fetch(`${baseUrl}/api/v1/audit-logs`, {
        headers: {
          Authorization: 'Bearer operator-token-001'
        }
      });
      const auditEnvelope = await auditResponse.json();
      const operatorDenials = auditEnvelope.data.filter(
        (log: { action: string; operation: string }) => log.action === 'audit.denied' && log.operation === 'operator.auth'
      );

      expect(operatorDenials).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            targetId: 'GET /api/v1/snapshot',
            denialCode: 'unauthorized',
            after: expect.objectContaining({
              method: 'GET',
              path: '/api/v1/snapshot',
              tokenPresented: false
            })
          }),
          expect.objectContaining({
            targetId: 'GET /metrics',
            denialCode: 'unauthorized',
            after: expect.objectContaining({
              method: 'GET',
              path: '/metrics',
              tokenPresented: false
            })
          })
        ])
      );
      expect(JSON.stringify(operatorDenials)).not.toContain('operator-token-001');
    });
  });

  it('keeps the original operator auth response when denied-audit writes fail and exposes the failure count', async () => {
    const api = createMockApi({ seedInventory: true });
    const structuredLogs: ControlPlaneStructuredLogEvent[] = [];
    const server = createHttpControlPlaneServer(
      {
        ...api,
        async recordOperatorRequestDenied() {
          throw new Error('audit append unavailable');
        }
      },
      {
        auth: {
          operatorTokens: {
            'operator-token-001': {
              actor: 'admin',
              operatorGroupId: 'owner',
              resourceGroupId: 'group-premium'
            }
          }
        },
        logger: {
          write(event) {
            structuredLogs.push(event);
          }
        }
      }
    );

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address();

    if (!address || typeof address === 'string') {
      throw new Error('Authenticated HTTP control-plane test server did not bind to a TCP port');
    }

    try {
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const deniedResponse = await fetch(`${baseUrl}/api/v1/snapshot`, {
        headers: {
          'X-Request-Id': 'req-auth-denied-audit-write-failure'
        }
      });
      const deniedEnvelope = await deniedResponse.json();

      expect(deniedResponse.status).toBe(401);
      expect(deniedEnvelope.error).toMatchObject({
        code: 'unauthorized'
      });

      const metricsResponse = await fetch(`${baseUrl}/api/v1/observability-metrics`, {
        headers: {
          Authorization: 'Bearer operator-token-001'
        }
      });
      const metricsEnvelope = await metricsResponse.json();
      const alertsResponse = await fetch(`${baseUrl}/api/v1/system-alerts`, {
        headers: {
          Authorization: 'Bearer operator-token-001'
        }
      });
      const alertsEnvelope = await alertsResponse.json();
      const prometheusResponse = await fetch(`${baseUrl}/metrics`, {
        headers: {
          Authorization: 'Bearer operator-token-001'
        }
      });
      const prometheusText = await prometheusResponse.text();

      expect(metricsResponse.status).toBe(200);
      expect(metricsEnvelope.data.audit).toMatchObject({
        denied: 0,
        writeFailures: 1
      });
      expect(metricsEnvelope.data.systemAlerts.byKind).toMatchObject({
        'audit.write_failed': 1
      });
      expect(alertsResponse.status).toBe(200);
      expect(alertsEnvelope.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'audit.write_failed',
            severity: 'critical',
            resourceType: 'audit',
            resourceId: 'audit-ledger',
            metadata: expect.objectContaining({
              writeFailures: 1
            })
          })
        ])
      );
      expect(prometheusResponse.status).toBe(200);
      expect(prometheusText).toContain('ou_ui_audit_write_failures_total 1');
      expect(prometheusText).toContain('ou_ui_system_alerts_by_kind{kind="audit.write_failed"} 1');
      expect(structuredLogs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'audit.write_failed',
            level: 'error',
            requestId: 'req-auth-denied-audit-write-failure',
            auditKind: 'operator.denied'
          })
        ])
      );
      expect(JSON.stringify(structuredLogs)).not.toContain('operator-token-001');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('rate limits repeated operator authentication failures and caps denied audit writes', async () => {
    await withAuthenticatedServer(
      async (baseUrl) => {
        const responses = [];

        for (let index = 1; index <= 4; index += 1) {
          responses.push(
            await fetch(`${baseUrl}/api/v1/snapshot`, {
              headers: {
                'X-Forwarded-For': '203.0.113.10',
                'X-Request-Id': `req-operator-auth-throttle-${index}`
              }
            })
          );
        }

        const envelopes = await Promise.all(responses.map((response) => response.json()));

        expect(responses.map((response) => response.status)).toEqual([401, 401, 429, 429]);
        expect(responses[2]?.headers.get('retry-after')).toBe('60');
        expect(envelopes[2]).toMatchObject({
          error: {
            code: 'operator_auth.rate_limited',
            details: {
              maxFailures: 2,
              windowMs: 60_000
            }
          },
          requestId: 'req-operator-auth-throttle-3'
        });
        expect(envelopes[3]).toMatchObject({
          error: {
            code: 'operator_auth.rate_limited'
          },
          requestId: 'req-operator-auth-throttle-4'
        });

        const auditResponse = await fetch(`${baseUrl}/api/v1/audit-logs`, {
          headers: {
            Authorization: 'Bearer operator-token-001'
          }
        });
        const auditEnvelope = await auditResponse.json();
        const throttledDenials = auditEnvelope.data.filter(
          (log: { action: string; operation: string; targetId: string; sourceIp: string }) =>
            log.action === 'audit.denied' &&
            log.operation === 'operator.auth' &&
            log.targetId === 'GET /api/v1/snapshot' &&
            log.sourceIp === '203.0.113.10'
        );

        expect(throttledDenials).toHaveLength(3);
        expect(throttledDenials).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              requestId: 'req-operator-auth-throttle-1',
              denialCode: 'unauthorized',
              after: {
                method: 'GET',
                path: '/api/v1/snapshot',
                tokenPresented: false
              }
            }),
            expect.objectContaining({
              requestId: 'req-operator-auth-throttle-2',
              denialCode: 'unauthorized'
            }),
            expect.objectContaining({
              requestId: 'req-operator-auth-throttle-3',
              denialCode: 'operator_auth.rate_limited',
              denialReason: 'Too many failed operator authentication attempts.'
            })
          ])
        );
        expect(throttledDenials).not.toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              requestId: 'req-operator-auth-throttle-4'
            })
          ])
        );
        expect(JSON.stringify(throttledDenials)).not.toContain('operator-token-001');
      },
      {
        operatorAuthFailureThrottle: {
          maxFailures: 2,
          windowMs: 60_000
        }
      }
    );
  });

  it('derives mutation actor and groups from the operator bearer token instead of spoofable headers', async () => {
    await withAuthenticatedServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer operator-token-001',
          'X-Actor': 'operator:bob',
          'X-Operator-Group-Id': 'ops-viewer',
          'X-Resource-Group-Id': 'group-lab',
          'X-Request-Id': 'req-auth-token-derived',
          'Idempotency-Key': 'idem-auth-token-derived',
          'If-Match': 'forward-forward-hkg-443-v1'
        },
        body: JSON.stringify({
          operation: 'forward.apply',
          targetId: 'forward-hkg-443',
          targetLabel: 'Port Forwarding Fabric',
          summary: 'Apply authenticated forwarding policy'
        })
      });
      const envelope = await response.json();

      expect(response.status).toBe(201);
      expect(envelope.data).toMatchObject({
        actor: 'admin',
        status: 'queued'
      });
    });
  });

  it('requires Agent bearer tokens and binds them to the requested agentId', async () => {
    await withAuthenticatedServer(async (baseUrl) => {
      const missingTokenResponse = await fetch(`${baseUrl}/agent/v1/poll`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': 'req-agent-auth-missing-http'
        },
        body: JSON.stringify({
          agentId: 'agent-hkg-01',
          requestId: 'req-agent-auth-missing'
        })
      });
      const missingTokenEnvelope = await missingTokenResponse.json();

      const mismatchResponse = await fetch(`${baseUrl}/agent/v1/poll`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer agent-token-hkg-001'
        },
        body: JSON.stringify({
          agentId: 'agent-sin-01',
          requestId: 'req-agent-auth-mismatch'
        })
      });
      const mismatchEnvelope = await mismatchResponse.json();

      const validResponse = await fetch(`${baseUrl}/agent/v1/poll`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer agent-token-hkg-001'
        },
        body: JSON.stringify({
          agentId: 'agent-hkg-01',
          requestId: 'req-agent-auth-valid'
        })
      });
      const validEnvelope = await validResponse.json();

      expect(missingTokenResponse.status).toBe(401);
      expect(missingTokenEnvelope.error).toMatchObject({
        code: 'unauthorized'
      });
      expect(mismatchResponse.status).toBe(403);
      expect(mismatchEnvelope.error).toMatchObject({
        code: 'identity.mismatch'
      });
      expect(validResponse.status).toBe(200);
      expect(validEnvelope.data).toMatchObject({
        commands: [],
        nextPollAfterMs: 1000
      });

      const auditResponse = await fetch(`${baseUrl}/api/v1/audit-logs`, {
        headers: {
          Authorization: 'Bearer operator-token-001'
        }
      });
      const auditEnvelope = await auditResponse.json();
      const agentPollDenials = auditEnvelope.data.filter(
        (log: { action: string; operation: string }) => log.action === 'audit.denied' && log.operation === 'agent.poll'
      );

      expect(agentPollDenials).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            actor: 'agent:unauthenticated',
            targetId: 'agent-authentication',
            requestId: 'req-agent-auth-missing-http',
            denialCode: 'unauthorized',
            after: expect.objectContaining({
              endpoint: 'poll',
              tokenPresented: false
            })
          }),
          expect.objectContaining({
            actor: 'agent:agent-hkg-01',
            targetId: 'agent-sin-01',
            requestId: 'req-agent-auth-mismatch',
            denialCode: 'identity.mismatch',
            before: {
              authenticatedAgent: expect.objectContaining({
                agentId: 'agent-hkg-01'
              })
            },
            after: expect.objectContaining({
              endpoint: 'poll',
              agentIds: ['agent-sin-01'],
              tokenPresented: true
            })
          })
        ])
      );
      expect(JSON.stringify(agentPollDenials)).not.toContain('agent-token-hkg-001');
      expect(JSON.stringify(agentPollDenials)).not.toContain('operator-token-001');
    });
  });

  it('audits denied Agent event ingestion without exposing bearer tokens', async () => {
    await withAuthenticatedServer(async (baseUrl) => {
      const event = {
        eventId: 'event-auth-mismatch-001',
        agentId: 'agent-sin-01',
        seq: 1,
        sessionId: 'sess-agent-sin-01',
        observedAt: '2026-06-02T00:00:01.000Z',
        type: 'heartbeat',
        payload: {
          version: '0.1.0-test'
        }
      };
      const missingTokenResponse = await fetch(`${baseUrl}/agent/v1/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': 'req-agent-events-auth-missing-http'
        },
        body: JSON.stringify({
          events: [event]
        })
      });
      const mismatchResponse = await fetch(`${baseUrl}/agent/v1/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer agent-token-hkg-001',
          'X-Request-Id': 'req-agent-events-auth-mismatch-http'
        },
        body: JSON.stringify({
          events: [event]
        })
      });

      expect(missingTokenResponse.status).toBe(401);
      expect(mismatchResponse.status).toBe(403);

      const auditResponse = await fetch(`${baseUrl}/api/v1/audit-logs`, {
        headers: {
          Authorization: 'Bearer operator-token-001'
        }
      });
      const auditEnvelope = await auditResponse.json();
      const agentEventDenials = auditEnvelope.data.filter(
        (log: { action: string; operation: string }) => log.action === 'audit.denied' && log.operation === 'agent.events'
      );

      expect(agentEventDenials).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            actor: 'agent:unauthenticated',
            targetId: 'agent-authentication',
            requestId: 'req-agent-events-auth-missing-http',
            denialCode: 'unauthorized',
            after: expect.objectContaining({
              endpoint: 'events',
              tokenPresented: false
            })
          }),
          expect.objectContaining({
            actor: 'agent:agent-hkg-01',
            targetId: 'agent-sin-01',
            requestId: 'req-agent-events-auth-mismatch-http',
            denialCode: 'identity.mismatch',
            before: {
              authenticatedAgent: expect.objectContaining({
                agentId: 'agent-hkg-01'
              })
            },
            after: expect.objectContaining({
              endpoint: 'events',
              agentIds: ['agent-sin-01'],
              sessionIds: ['sess-agent-sin-01'],
              tokenPresented: true
            })
          })
        ])
      );
      expect(JSON.stringify(agentEventDenials)).not.toContain('agent-token-hkg-001');
      expect(JSON.stringify(agentEventDenials)).not.toContain('operator-token-001');
    });
  });

  it('does not allow operator and Agent tokens to cross runtime boundaries', async () => {
    await withAuthenticatedServer(async (baseUrl) => {
      const agentTokenMutationResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer agent-token-hkg-001',
          'X-Request-Id': 'req-auth-agent-token-mutation',
          'Idempotency-Key': 'idem-auth-agent-token-mutation'
        },
        body: JSON.stringify({
          operation: 'forward.apply',
          targetId: 'forward-hkg-443',
          targetLabel: 'Port Forwarding Fabric',
          summary: 'Attempt Agent token mutation'
        })
      });

      const operatorTokenPollResponse = await fetch(`${baseUrl}/agent/v1/poll`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer operator-token-001'
        },
        body: JSON.stringify({
          agentId: 'agent-hkg-01',
          requestId: 'req-auth-operator-token-poll'
        })
      });

      expect(agentTokenMutationResponse.status).toBe(401);
      expect(operatorTokenPollResponse.status).toBe(401);
    });
  });
});
