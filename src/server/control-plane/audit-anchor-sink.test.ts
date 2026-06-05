// @vitest-environment node

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AuditLog } from '../../domain';
import { createFileControlPlaneAuditAnchorSink, withAuditAnchorSink } from './audit-anchor-sink';
import { createInMemoryControlPlaneRepository } from './in-memory-control-plane-repository';

function createAuditLog(overrides: Partial<AuditLog> = {}): AuditLog {
  return {
    id: 'audit-anchor-test',
    action: 'task.created',
    actor: 'operator:anchor-test',
    operatorGroupId: 'owner',
    resourceGroupId: 'group-premium',
    scope: 'control-plane:task',
    resourceType: 'agent',
    operation: 'agent.deploy',
    result: 'accepted',
    targetId: 'agent-anchor-test',
    targetLabel: 'Agent Anchor Test',
    taskId: 'task-anchor-test',
    severity: 'info',
    message: 'Task created',
    createdAt: '2026-06-06T00:00:00.000Z',
    sourceIp: '127.0.0.1',
    requestId: 'req-audit-anchor-test',
    prevHash: `sha256:${'0'.repeat(64)}`,
    hash: `sha256:${'1'.repeat(64)}`,
    before: {
      shouldNotBeAnchored: true
    },
    after: {
      shouldNotBeAnchored: true
    },
    ...overrides
  };
}

describe('audit anchor sink', () => {
  it('appends sanitized audit hash anchors as JSONL envelopes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ou-ui-next-audit-anchor-'));
    const sink = createFileControlPlaneAuditAnchorSink({ directory });
    const auditLog = createAuditLog();

    try {
      await sink.writeAuditAnchors([auditLog], { anchoredAt: '2026-06-06T00:00:01.000Z' });

      const [line] = (await readFile(join(directory, 'audit-anchors.jsonl'), 'utf8')).trim().split('\n');
      const envelope = JSON.parse(line) as {
        schemaVersion: string;
        anchoredAt: string;
        audit: Record<string, unknown>;
      };

      expect(envelope).toEqual({
        schemaVersion: 'ou-ui-next.audit-anchor.v1',
        anchoredAt: '2026-06-06T00:00:01.000Z',
        audit: {
          auditLogId: auditLog.id,
          action: auditLog.action,
          operation: auditLog.operation,
          result: auditLog.result,
          severity: auditLog.severity,
          actor: auditLog.actor,
          scope: auditLog.scope,
          resourceType: auditLog.resourceType,
          targetId: auditLog.targetId,
          taskId: auditLog.taskId,
          requestId: auditLog.requestId,
          createdAt: auditLog.createdAt,
          hash: auditLog.hash,
          prevHash: auditLog.prevHash
        }
      });
      expect(JSON.stringify(envelope)).not.toContain('shouldNotBeAnchored');
      expect(JSON.stringify(envelope)).not.toContain('127.0.0.1');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not reject committed repository transactions when the anchor sink fails', async () => {
    const sink = {
      writeAuditAnchors: vi.fn(async () => {
        throw new Error('anchor sink unavailable');
      })
    };
    const onError = vi.fn();
    const repository = withAuditAnchorSink(createInMemoryControlPlaneRepository({}), {
      sink,
      onError,
      now: () => '2026-06-06T00:00:02.000Z'
    });
    const auditLog = createAuditLog({ id: 'audit-anchor-failure-test' });

    await expect(
      repository.transaction(async (transaction) => {
        await transaction.insertAuditLog(auditLog);
      })
    ).resolves.toBeUndefined();

    await expect(repository.listAuditLogs()).resolves.toEqual([auditLog]);
    expect(sink.writeAuditAnchors).toHaveBeenCalledWith([auditLog], {
      anchoredAt: '2026-06-06T00:00:02.000Z'
    });
    expect(onError).toHaveBeenCalledWith(expect.any(Error), {
      auditLogs: [auditLog],
      anchoredAt: '2026-06-06T00:00:02.000Z'
    });
  });
});
