import { createInMemoryControlPlaneRepository } from './in-memory-control-plane-repository';
import { createRepositoryBackedOperatorSessionStore } from './operator-session-store';

describe('operator session store', () => {
  it('persists issued and revoked operator sessions while appending audit evidence', async () => {
    let now = '2026-06-05T00:00:00.000Z';
    const repository = createInMemoryControlPlaneRepository();
    const store = createRepositoryBackedOperatorSessionStore(repository, () => now);

    const issued = await store.issue({
      sessionId: 'operator-session-store-001',
      username: 'operator_001',
      actor: 'operator:alice',
      operatorGroupId: 'owner',
      resourceGroupId: 'group-premium',
      expiresAt: '2026-06-05T08:00:00.000Z',
      sourceIp: '203.0.113.10',
      userAgent: 'vitest-session-store',
      requestId: 'req-operator-session-issue'
    });

    expect(issued).toMatchObject({
      id: 'operator-session-store-001',
      status: 'active'
    });
    await expect(repository.listOperatorSessions()).resolves.toEqual([
      expect.objectContaining({
        id: 'operator-session-store-001',
        status: 'active',
        requestId: 'req-operator-session-issue'
      })
    ]);
    await expect(repository.listAuditLogs()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'operator.session.issued',
          operation: 'operator.session.issue',
          targetId: 'operator-session-store-001',
          result: 'succeeded'
        })
      ])
    );

    now = '2026-06-05T00:05:00.000Z';

    const revoked = await store.revoke('operator-session-store-001', {
      actor: 'operator:alice',
      operatorGroupId: 'owner',
      resourceGroupId: 'group-premium',
      sourceIp: '203.0.113.10',
      userAgent: 'vitest-session-store',
      requestId: 'req-operator-session-revoke',
      reason: 'security rotation'
    });

    expect(revoked).toMatchObject({
      id: 'operator-session-store-001',
      status: 'revoked',
      revokedBy: 'operator:alice',
      revokedReason: 'security rotation'
    });
    await expect(repository.listOperatorSessions()).resolves.toEqual([
      expect.objectContaining({
        id: 'operator-session-store-001',
        status: 'revoked',
        revokedBy: 'operator:alice',
        revokedReason: 'security rotation'
      })
    ]);
    await expect(repository.listAuditLogs()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'operator.session.revoked',
          operation: 'operator.session.revoke',
          targetId: 'operator-session-store-001',
          requestId: 'req-operator-session-revoke',
          before: {
            session: expect.objectContaining({
              id: 'operator-session-store-001',
              status: 'active'
            })
          },
          after: {
            session: expect.objectContaining({
              id: 'operator-session-store-001',
              status: 'revoked'
            })
          }
        })
      ])
    );
  });

  it('marks expired operator sessions when they are read back from the repository', async () => {
    let now = '2026-06-05T00:00:00.000Z';
    const repository = createInMemoryControlPlaneRepository();
    const store = createRepositoryBackedOperatorSessionStore(repository, () => now);

    await store.issue({
      sessionId: 'operator-session-expired-001',
      username: 'operator_001',
      actor: 'operator:alice',
      expiresAt: '2026-06-05T00:10:00.000Z',
      sourceIp: '203.0.113.10',
      requestId: 'req-operator-session-expired'
    });

    now = '2026-06-05T00:15:00.000Z';

    await expect(store.get('operator-session-expired-001')).resolves.toMatchObject({
      id: 'operator-session-expired-001',
      status: 'expired'
    });
    await expect(repository.listOperatorSessions()).resolves.toEqual([
      expect.objectContaining({
        id: 'operator-session-expired-001',
        status: 'expired'
      })
    ]);
  });
});
