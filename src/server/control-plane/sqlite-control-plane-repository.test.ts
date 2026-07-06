// @vitest-environment node

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { AGENT_INSTALL_PROFILE } from '../../domain';
import { createControlPlaneTestClock } from '../../test/control-plane-clock';
import { createAgentCredentialTokenHash } from './agent-credentials';
import { createControlPlaneService } from './control-plane-service';
import { createSqliteControlPlaneRepository } from './sqlite-control-plane-repository';
import { createEmptyControlPlaneRepositoryState } from './stateful-control-plane-repository';

async function withDatabaseFile<T>(run: (databaseFilePath: string, legacyStateFilePath: string) => Promise<T>) {
  const directory = await mkdtemp(join(tmpdir(), 'ou-ui-next-control-plane-sqlite-'));
  const databaseFilePath = join(directory, 'control-plane.sqlite');
  const legacyStateFilePath = join(directory, 'control-plane-state.json');

  try {
    return await run(databaseFilePath, legacyStateFilePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function writeControlPlaneDatabaseMetadataFixture(databaseFilePath: string, schemaVersion: string) {
  const database = new Database(databaseFilePath);

  try {
    database.exec(`
      CREATE TABLE control_plane_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE control_plane_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    database.prepare('INSERT INTO control_plane_meta (key, value) VALUES (?, ?)').run('schema_version', schemaVersion);
    database.prepare('INSERT INTO control_plane_meta (key, value) VALUES (?, ?)').run('state_format', 'json-state-v1');
    database
      .prepare('INSERT INTO control_plane_state (id, payload, updated_at) VALUES (?, ?, ?)')
      .run(1, JSON.stringify(createEmptyControlPlaneRepositoryState(), null, 2), '2026-06-05T00:00:00.000Z');
  } finally {
    database.close();
  }
}

function readSchemaVersion(databaseFilePath: string) {
  const database = new Database(databaseFilePath, { readonly: true });

  try {
    const row = database
      .prepare("SELECT value FROM control_plane_meta WHERE key = 'schema_version'")
      .get() as { value: string };

    return row.value;
  } finally {
    database.close();
  }
}

function readMigrationRows(databaseFilePath: string) {
  const database = new Database(databaseFilePath, { readonly: true });

  try {
    return database
      .prepare('SELECT version, name, checksum, applied_at FROM control_plane_migrations ORDER BY version ASC')
      .all() as Array<{ version: number; name: string; checksum: string; applied_at: string }>;
  } finally {
    database.close();
  }
}

function readEntityIndexRows(databaseFilePath: string) {
  const database = new Database(databaseFilePath, { readonly: true });

  try {
    return database
      .prepare(
        `SELECT entity_type, entity_id, parent_id, status, label, payload
         FROM control_plane_entity_index
         ORDER BY entity_type ASC, entity_id ASC`
      )
      .all() as Array<{
        entity_type: string;
        entity_id: string;
        parent_id: string;
        status: string;
        label: string;
        payload: string;
      }>;
  } finally {
    database.close();
  }
}

function installEntityIndexFullRebuildFailureTrigger(databaseFilePath: string) {
  const database = new Database(databaseFilePath);

  try {
    database.exec(`
      CREATE TRIGGER fail_entity_index_full_rebuild
      BEFORE DELETE ON control_plane_entity_index
      BEGIN
        SELECT RAISE(FAIL, 'entity index full rebuild is not allowed in this test');
      END;
    `);
  } finally {
    database.close();
  }
}

function installEntityIndexFullRebuildFailureTriggerExceptTrafficRollups(databaseFilePath: string) {
  const database = new Database(databaseFilePath);

  try {
    database.exec(`
      CREATE TRIGGER fail_entity_index_full_rebuild_except_traffic_rollups
      BEFORE DELETE ON control_plane_entity_index
      WHEN OLD.entity_type <> 'traffic-rollup'
      BEGIN
        SELECT RAISE(FAIL, 'entity index full rebuild is not allowed in this test');
      END;
    `);
  } finally {
    database.close();
  }
}

function installStatePayloadUpdateFailureTrigger(databaseFilePath: string) {
  const database = new Database(databaseFilePath);

  try {
    database.exec(`
      CREATE TRIGGER fail_control_plane_state_update
      BEFORE UPDATE ON control_plane_state
      BEGIN
        SELECT RAISE(FAIL, 'control_plane_state update is not allowed in this test');
      END;
    `);
  } finally {
    database.close();
  }
}

function createIndexedTask(taskId = 'task-sqlite-index-stable') {
  return {
    id: taskId,
    operation: 'agent.update' as const,
    resourceType: 'agent' as const,
    resourceId: 'agent-sqlite-index-stable',
    status: 'queued' as const,
    targetId: 'agent-sqlite-index-stable',
    targetLabel: 'SQLite stable indexed task',
    summary: 'Update sqlite stable indexed task',
    createdAt: '2026-06-05T00:00:00.000Z',
    updatedAt: '2026-06-05T00:00:00.000Z',
    actor: 'admin',
    requestedBy: 'admin',
    requestId: `req-${taskId}`,
    sourceIp: '203.0.113.10',
    rollbackAvailable: false,
    attempts: 0,
    progressPercent: 0,
    steps: []
  };
}

describe('sqlite control-plane repository', () => {
  it('records a migration ledger when initializing a new sqlite database', async () => {
    await withDatabaseFile(async (databaseFilePath) => {
      await createSqliteControlPlaneRepository({ databaseFilePath });

      expect(readSchemaVersion(databaseFilePath)).toBe('2');
      expect(readMigrationRows(databaseFilePath)).toEqual([
        expect.objectContaining({
          version: 1,
          name: '001_json_state_v1',
          checksum: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
          applied_at: expect.stringMatching(/^20/)
        }),
        expect.objectContaining({
          version: 2,
          name: '002_domain_entity_index_v1',
          checksum: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
          applied_at: expect.stringMatching(/^20/)
        })
      ]);
    });
  });

  it('opens an existing current sqlite database without rewriting state or rebuilding the entity index', async () => {
    await withDatabaseFile(async (databaseFilePath) => {
      const repository = await createSqliteControlPlaneRepository({ databaseFilePath });

      await repository.transaction(async (transaction) => {
        await transaction.insertTask(createIndexedTask('task-sqlite-existing-open'));
      });

      installStatePayloadUpdateFailureTrigger(databaseFilePath);
      installEntityIndexFullRebuildFailureTrigger(databaseFilePath);

      const reopenedRepository = await createSqliteControlPlaneRepository({ databaseFilePath });

      await expect(reopenedRepository.listTasks()).resolves.toEqual([
        expect.objectContaining({
          id: 'task-sqlite-existing-open'
        })
      ]);
      expect(readEntityIndexRows(databaseFilePath)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            entity_type: 'task',
            entity_id: 'task-sqlite-existing-open'
          })
        ])
      );
    });
  });

  it('increments a lightweight state version only when sqlite state changes', async () => {
    await withDatabaseFile(async (databaseFilePath) => {
      const repository = await createSqliteControlPlaneRepository({ databaseFilePath });
      const initialVersion = await repository.readStateVersion();

      await repository.transaction(async (transaction) => {
        await transaction.listTasks();
      });
      await expect(repository.readStateVersion()).resolves.toEqual(initialVersion);

      await repository.transaction(async (transaction) => {
        await transaction.insertTask(createIndexedTask('task-sqlite-state-version'));
      });

      const nextVersion = await repository.readStateVersion();

      expect(nextVersion.revision).not.toBe(initialVersion.revision);
      expect(Number(nextVersion.revision)).toBe(Number(initialVersion.revision) + 1);
      expect(nextVersion.payloadBytes).toBeGreaterThan(initialVersion.payloadBytes ?? 0);
    });
  });

  it('compacts high-frequency Agent heartbeat and telemetry events before sqlite persistence', async () => {
    await withDatabaseFile(async (databaseFilePath) => {
      const repository = await createSqliteControlPlaneRepository({ databaseFilePath });

      await repository.transaction(async (transaction) => {
        for (let index = 0; index < 130; index += 1) {
          const observedAt = new Date(Date.parse('2026-06-05T00:00:00.000Z') + index * 1000).toISOString();

          await transaction.insertAgentEvent({
            agentId: 'agent-retention-01',
            eventId: `evt-heartbeat-${index}`,
            observedAt,
            payload: {
              capabilities: ['host-agent', 'xray']
            },
            seq: index,
            sessionId: 'sess-agent-retention',
            type: 'heartbeat'
          });
          await transaction.insertAgentEvent({
            agentId: 'agent-retention-01',
            eventId: `evt-telemetry-${index}`,
            observedAt,
            payload: {
              cpuPercent: index,
              reportedAt: observedAt
            },
            seq: 1_000 + index,
            sessionId: 'sess-agent-retention',
            type: 'telemetry_sample'
          });
        }

        await transaction.insertAgentEvent({
          agentId: 'agent-retention-01',
          commandId: 'cmd-retention-01',
          eventId: 'evt-result-retention-01',
          observedAt: '2026-06-05T00:03:00.000Z',
          payload: {
            appliedConfigRevision: 'cfg-retention-01',
            status: 'succeeded'
          },
          seq: 2_000,
          sessionId: 'sess-agent-retention',
          taskId: 'task-retention-01',
          type: 'result'
        });
      });

      const events = await repository.listAgentEvents();

      expect(events.filter((event) => event.type === 'heartbeat')).toHaveLength(30);
      expect(events.filter((event) => event.type === 'telemetry_sample')).toHaveLength(30);
      expect(events.some((event) => event.eventId === 'evt-heartbeat-129')).toBe(true);
      expect(events.some((event) => event.eventId === 'evt-heartbeat-100')).toBe(true);
      expect(events.some((event) => event.eventId === 'evt-heartbeat-99')).toBe(false);
      expect(events.some((event) => event.eventId === 'evt-heartbeat-0')).toBe(false);
      expect(events.some((event) => event.eventId === 'evt-telemetry-129')).toBe(true);
      expect(events.some((event) => event.eventId === 'evt-telemetry-100')).toBe(true);
      expect(events.some((event) => event.eventId === 'evt-telemetry-99')).toBe(false);
      expect(events.some((event) => event.eventId === 'evt-telemetry-0')).toBe(false);
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            eventId: 'evt-result-retention-01',
            type: 'result'
          })
        ])
      );
    });
  });

  it('persists high-frequency Agent events without rebuilding the sqlite entity index', async () => {
    await withDatabaseFile(async (databaseFilePath) => {
      const repository = await createSqliteControlPlaneRepository({ databaseFilePath });

      await repository.transaction(async (transaction) => {
        await transaction.insertTask(createIndexedTask());
      });

      const rowsBeforeHighFrequencyEvents = readEntityIndexRows(databaseFilePath);
      installEntityIndexFullRebuildFailureTrigger(databaseFilePath);

      await repository.transaction(async (transaction) => {
        await transaction.insertAgentEvent({
          agentId: 'agent-fast-events-01',
          eventId: 'evt-fast-heartbeat-001',
          observedAt: '2026-06-05T00:01:00.000Z',
          payload: {
            capabilities: ['host-agent', 'xray']
          },
          seq: 1,
          sessionId: 'sess-fast-events',
          type: 'heartbeat'
        });
        await transaction.insertAgentEvent({
          agentId: 'agent-fast-events-01',
          eventId: 'evt-fast-telemetry-001',
          observedAt: '2026-06-05T00:01:01.000Z',
          payload: {
            cpuPercent: 12,
            memoryPercent: 30,
            reportedAt: '2026-06-05T00:01:01.000Z'
          },
          seq: 2,
          sessionId: 'sess-fast-events',
          type: 'telemetry_sample'
        });
        await transaction.upsertAgentSession({
          agentId: 'agent-fast-events-01',
          sessionId: 'sess-fast-events',
          status: 'online',
          lastSeq: 2,
          capabilities: ['host-agent', 'xray'],
          lastHeartbeatAt: '2026-06-05T00:01:00.000Z',
          updatedAt: '2026-06-05T00:01:01.000Z'
        });
      });

      expect(readEntityIndexRows(databaseFilePath)).toEqual(rowsBeforeHighFrequencyEvents);
      await expect(repository.listAgentEvents()).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ eventId: 'evt-fast-heartbeat-001', type: 'heartbeat' }),
          expect.objectContaining({ eventId: 'evt-fast-telemetry-001', type: 'telemetry_sample' })
        ])
      );
      await expect(repository.listAgentSessions()).resolves.toEqual([
        expect.objectContaining({
          agentId: 'agent-fast-events-01',
          sessionId: 'sess-fast-events',
          status: 'online'
        })
      ]);
    });
  });

  it('skips sqlite state writes for unsampled routine Agent heartbeats', async () => {
    await withDatabaseFile(async (databaseFilePath) => {
      const repository = await createSqliteControlPlaneRepository({ databaseFilePath });
      const service = createControlPlaneService({
        repository,
        now: createControlPlaneTestClock(),
        highFrequencyAgentEventPersistence: {
          persistEvery: 3
        }
      });

      await service.receiveAgentEvent({
        type: 'heartbeat',
        eventId: 'evt-sqlite-sampled-heartbeat-001',
        agentId: 'agent-sqlite-sampled',
        seq: 1,
        sessionId: 'sess-sqlite-sampled',
        observedAt: '2026-06-05T00:01:00.000Z',
        payload: {
          version: '1.0.0',
          capabilities: ['host-agent', 'xray'],
          lastSeenCommandSeq: 0
        }
      });

      installStatePayloadUpdateFailureTrigger(databaseFilePath);

      await expect(
        service.receiveAgentEvent({
          type: 'heartbeat',
          eventId: 'evt-sqlite-sampled-heartbeat-002',
          agentId: 'agent-sqlite-sampled',
          seq: 2,
          sessionId: 'sess-sqlite-sampled',
          observedAt: '2026-06-05T00:01:01.000Z',
          payload: {
            version: '1.0.1',
            capabilities: ['host-agent', 'xray', 'telemetry'],
            lastSeenCommandSeq: 1
          }
        })
      ).resolves.toBeUndefined();

      await expect(repository.listAgentEvents()).resolves.toEqual([
        expect.objectContaining({
          eventId: 'evt-sqlite-sampled-heartbeat-001',
          seq: 1
        })
      ]);
      await expect(repository.listAgentSessions()).resolves.toEqual([
        expect.objectContaining({
          agentId: 'agent-sqlite-sampled',
          sessionId: 'sess-sqlite-sampled',
          lastSeq: 1,
          lastSeenCommandSeq: 0,
          version: '1.0.0'
        })
      ]);
    });
  });

  it('upserts traffic rollup entity index rows incrementally without a full sqlite index rebuild', async () => {
    await withDatabaseFile(async (databaseFilePath) => {
      const repository = await createSqliteControlPlaneRepository({ databaseFilePath });

      await repository.transaction(async (transaction) => {
        await transaction.insertTask(createIndexedTask('task-sqlite-traffic-rollup-anchor'));
      });

      installEntityIndexFullRebuildFailureTrigger(databaseFilePath);

      await repository.transaction(async (transaction) => {
        await transaction.insertTrafficRollup({
          id: 'traffic-rollup-fast-agent-001',
          dimension: 'agent',
          subjectId: 'agent-fast-events-01',
          subjectLabel: 'Fast Agent',
          agentId: 'agent-fast-events-01',
          observedAt: '2026-06-05T00:02:00.000Z',
          sampledAt: '2026-06-05T00:02:00.000Z',
          periodKey: '2026-06',
          monthlyResetDay: 1,
          accountingMode: 'both',
          ingressBytes: 1024,
          egressBytes: 2048,
          meteredBytes: 3072,
          source: 'agent-telemetry'
        });
      });

      const rows = readEntityIndexRows(databaseFilePath);

      expect(rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            entity_type: 'task',
            entity_id: 'task-sqlite-traffic-rollup-anchor'
          }),
          expect.objectContaining({
            entity_type: 'traffic-rollup',
            entity_id: 'traffic-rollup-fast-agent-001',
            parent_id: 'agent-fast-events-01',
            status: 'agent',
            label: 'Fast Agent'
          })
        ])
      );
      expect(JSON.parse(rows.find((row) => row.entity_id === 'traffic-rollup-fast-agent-001')?.payload ?? '{}')).toEqual({
        agentId: 'agent-fast-events-01',
        meteredBytes: 3072,
        periodKey: '2026-06',
        source: 'agent-telemetry'
      });
      await expect(repository.listTrafficRollups()).resolves.toEqual([
        expect.objectContaining({
          id: 'traffic-rollup-fast-agent-001',
          meteredBytes: 3072
        })
      ]);
    });
  });

  it('prunes traffic rollup entity index rows incrementally without a full sqlite index rebuild', async () => {
    await withDatabaseFile(async (databaseFilePath) => {
      const repository = await createSqliteControlPlaneRepository({ databaseFilePath });

      await repository.transaction(async (transaction) => {
        await transaction.insertTask(createIndexedTask('task-sqlite-traffic-prune-anchor'));
        await transaction.insertTrafficRollup({
          id: 'traffic-rollup-prune-old',
          dimension: 'agent',
          subjectId: 'agent-fast-events-01',
          subjectLabel: 'Fast Agent',
          agentId: 'agent-fast-events-01',
          observedAt: '2026-06-05T00:02:00.000Z',
          sampledAt: '2026-06-05T00:02:00.000Z',
          periodKey: '2026-06',
          monthlyResetDay: 1,
          accountingMode: 'both',
          ingressBytes: 1024,
          egressBytes: 2048,
          meteredBytes: 3072,
          source: 'agent-telemetry'
        });
        await transaction.insertTrafficRollup({
          id: 'traffic-rollup-prune-new',
          dimension: 'agent',
          subjectId: 'agent-fast-events-01',
          subjectLabel: 'Fast Agent',
          agentId: 'agent-fast-events-01',
          observedAt: '2026-06-05T00:03:00.000Z',
          sampledAt: '2026-06-05T00:03:00.000Z',
          periodKey: '2026-06',
          monthlyResetDay: 1,
          accountingMode: 'both',
          ingressBytes: 4096,
          egressBytes: 8192,
          meteredBytes: 12288,
          source: 'agent-telemetry'
        });
      });

      installEntityIndexFullRebuildFailureTriggerExceptTrafficRollups(databaseFilePath);

      await repository.transaction(async (transaction) => {
        const result = await transaction.pruneTrafficRollups(
          {
            maxAgeMs: 62 * 24 * 60 * 60 * 1000,
            maxRecordsPerScope: 1
          },
          '2026-06-05T00:04:00.000Z'
        );

        expect(result).toEqual(expect.objectContaining({ removed: 1, retained: 1 }));
      });

      const rows = readEntityIndexRows(databaseFilePath);

      expect(rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            entity_type: 'task',
            entity_id: 'task-sqlite-traffic-prune-anchor'
          }),
          expect.objectContaining({
            entity_type: 'traffic-rollup',
            entity_id: 'traffic-rollup-prune-new'
          })
        ])
      );
      expect(rows).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            entity_type: 'traffic-rollup',
            entity_id: 'traffic-rollup-prune-old'
          })
        ])
      );
      await expect(repository.listTrafficRollups()).resolves.toEqual([
        expect.objectContaining({
          id: 'traffic-rollup-prune-new',
          meteredBytes: 12288
        })
      ]);
    });
  });

  it('backfills the migration ledger when opening an existing v1 sqlite database', async () => {
    await withDatabaseFile(async (databaseFilePath) => {
      writeControlPlaneDatabaseMetadataFixture(databaseFilePath, '1');

      await createSqliteControlPlaneRepository({ databaseFilePath });

      expect(readSchemaVersion(databaseFilePath)).toBe('2');
      expect(readMigrationRows(databaseFilePath)).toEqual([
        expect.objectContaining({
          version: 1,
          name: '001_json_state_v1',
          checksum: expect.stringMatching(/^sha256:[a-f0-9]{64}$/)
        }),
        expect.objectContaining({
          version: 2,
          name: '002_domain_entity_index_v1',
          checksum: expect.stringMatching(/^sha256:[a-f0-9]{64}$/)
        })
      ]);
    });
  });

  it('rejects sqlite databases with tampered migration ledger entries', async () => {
    await withDatabaseFile(async (databaseFilePath) => {
      await createSqliteControlPlaneRepository({ databaseFilePath });

      const database = new Database(databaseFilePath);

      try {
        database
          .prepare('UPDATE control_plane_migrations SET checksum = ? WHERE version = ?')
          .run(`sha256:${'f'.repeat(64)}`, 1);
      } finally {
        database.close();
      }

      await expect(createSqliteControlPlaneRepository({ databaseFilePath })).rejects.toThrow(
        'Invalid control-plane sqlite migration 1'
      );
    });
  });

  it('persists Agent credentials as digests without writing raw tokens into the sqlite database', async () => {
    await withDatabaseFile(async (databaseFilePath) => {
      const token = 'oit_sqlite_repository_secret_token_001';
      const repository = await createSqliteControlPlaneRepository({ databaseFilePath });

      await repository.transaction(async (transaction) => {
        await transaction.upsertAgentCredential({
          id: 'agent-credential-sqlite-001',
          agentId: 'agent-edge-sqlite-01',
          tokenHash: createAgentCredentialTokenHash(token),
          tokenPrefix: 'oit_sqlit...001',
          status: 'active',
          purpose: 'install',
          issuedAt: '2026-06-05T00:00:00.000Z',
          expiresAt: '2026-06-05T00:15:00.000Z',
          issuedBy: 'admin',
          sourceIp: '203.0.113.10',
          requestId: 'req-sqlite-agent-credential',
          metadata: {
            installProfile: [...AGENT_INSTALL_PROFILE]
          }
        });
      });

      const restoredRepository = await createSqliteControlPlaneRepository({ databaseFilePath });
      const rawDatabase = await readFile(databaseFilePath);

      await expect(
        restoredRepository.findAgentCredentialByTokenHash(createAgentCredentialTokenHash(token))
      ).resolves.toEqual(
        expect.objectContaining({
          agentId: 'agent-edge-sqlite-01',
          tokenHash: createAgentCredentialTokenHash(token),
          status: 'active'
        })
      );
      await expect(restoredRepository.listAgentCredentials()).resolves.toEqual([
        expect.objectContaining({
          id: 'agent-credential-sqlite-001'
        })
      ]);
      expect(rawDatabase.toString('utf8')).not.toContain(token);
    });
  });

  it('rebuilds a safe domain entity index alongside the json state payload', async () => {
    await withDatabaseFile(async (databaseFilePath) => {
      const token = 'oit_sqlite_index_secret_token_001';
      const repository = await createSqliteControlPlaneRepository({ databaseFilePath });

      await repository.transaction(async (transaction) => {
        await transaction.insertTask({
          id: 'task-sqlite-index-forward',
          operation: 'forward.create',
          resourceType: 'forward',
          resourceId: 'forward-sqlite-index',
          status: 'queued',
          targetId: 'forward-sqlite-index',
          targetLabel: 'SQLite indexed forward',
          summary: 'Create sqlite indexed forwarding rule',
          createdAt: '2026-06-05T00:00:00.000Z',
          updatedAt: '2026-06-05T00:00:00.000Z',
          actor: 'admin',
          requestedBy: 'admin',
          requestId: 'req-sqlite-index-forward',
          sourceIp: '203.0.113.10',
          rollbackAvailable: false,
          attempts: 0,
          progressPercent: 0,
          steps: [],
          metadata: {
            clientCredential: token
          }
        });
        await transaction.upsertSubscriptionClient({
          id: 'sub-client-sqlite-index',
          displayName: 'SQLite Indexed Subscription',
          subId: 'sub_sqlite_index',
          email: 'sqlite-index@example.com',
          enabled: true,
          protocol: 'vless',
          group: 'premium',
          trafficLimitBytes: 10 * 1024 ** 3,
          usedTrafficBytes: 0,
          expiresAt: '2026-12-31T23:59:59.000Z',
          ipLimit: 2,
          requestLimitPerHour: 60,
          sourceIds: [],
          selectedTags: ['premium'],
          includeFilter: '',
          excludeFilter: '',
          regionFilter: [],
          routingRule: '',
          maxLatencyMs: 0,
          sortStrategy: 'latency',
          formats: ['plain'],
          outputFormats: ['uri'],
          templateName: 'default',
          accessTokenPreview: 'ou_sqlit...ndex',
          securePathPreview: '/sqliteIndexPath001',
          generatedNodeCount: 1
        });
        await transaction.replaceSubscriptionInventoryNodesForSource('source-sqlite-index', [
          {
            id: 'node-sqlite-index',
            sourceId: 'source-sqlite-index',
            name: 'SQLite Indexed Node',
            protocol: 'vless',
            server: 'node-sqlite-index.example.com',
            port: 443,
            latencyMs: 42,
            tags: ['premium'],
            status: 'online',
            customerName: 'Acme',
            hostId: 'agent-sqlite-index',
            rawUrl: `vless://${token}@node-sqlite-index.example.com:443`,
            clashConfig: {
              password: token
            }
          }
        ]);
        await transaction.insertConfigRevision({
          id: 'runtime-revision-sqlite-index',
          taskId: 'task-sqlite-index-forward',
          operation: 'forward.create',
          targetId: 'forward-sqlite-index',
          targetLabel: 'SQLite indexed forward',
          agentId: 'agent-sqlite-index',
          moduleKind: 'port-forwarding',
          artifactUri: 'sqlite://runtime/revision/runtime-revision-sqlite-index',
          checksum: 'sha256:runtime-revision-sqlite-index',
          signature: 'sig-runtime-revision-sqlite-index',
          preflightPlanId: 'preflight-sqlite-index',
          snapshotBeforeId: 'snapshot-sqlite-index',
          status: 'compiled',
          createdAt: '2026-06-05T00:01:00.000Z',
          createdBy: 'admin',
          diffSummary: {
            added: 1,
            changed: 0,
            removed: 0
          },
          artifact: {
            runtimeSecret: token
          }
        });
        await transaction.insertPreflightPlan({
          id: 'preflight-sqlite-index',
          taskId: 'task-sqlite-index-forward',
          configRevisionId: 'runtime-revision-sqlite-index',
          targetId: 'forward-sqlite-index',
          agentId: 'agent-sqlite-index',
          moduleKind: 'port-forwarding',
          status: 'failed',
          checks: [
            {
              id: 'check-port-conflict',
              label: 'Port conflict',
              status: 'failed',
              severity: 'critical'
            }
          ],
          createdAt: '2026-06-05T00:01:10.000Z',
          completedAt: '2026-06-05T00:01:20.000Z',
          failureReason: `preflight failed ${token}`
        });
        await transaction.insertRuntimeSnapshot({
          id: 'snapshot-sqlite-index',
          taskId: 'task-sqlite-index-forward',
          targetId: 'forward-sqlite-index',
          targetLabel: 'SQLite indexed forward',
          agentId: 'agent-sqlite-index',
          moduleKind: 'port-forwarding',
          reason: 'pre_apply',
          status: 'captured',
          checksum: 'sha256:snapshot-sqlite-index',
          capturedAt: '2026-06-05T00:01:05.000Z',
          capturedBy: 'admin',
          state: {
            previousRuntimeSecret: token
          }
        });
      });

      const rows = readEntityIndexRows(databaseFilePath);
      const rawIndex = JSON.stringify(rows);

      expect(rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            entity_type: 'task',
            entity_id: 'task-sqlite-index-forward',
            parent_id: 'forward-sqlite-index',
            status: 'queued',
            label: 'SQLite indexed forward'
          }),
          expect.objectContaining({
            entity_type: 'subscription-client',
            entity_id: 'sub-client-sqlite-index',
            parent_id: 'sub_sqlite_index',
            status: 'enabled',
            label: 'SQLite Indexed Subscription'
          }),
          expect.objectContaining({
            entity_type: 'subscription-inventory-node',
            entity_id: 'source-sqlite-index:node-sqlite-index',
            parent_id: 'source-sqlite-index',
            status: 'online',
            label: 'SQLite Indexed Node'
          }),
          expect.objectContaining({
            entity_type: 'runtime-config-revision',
            entity_id: 'runtime-revision-sqlite-index',
            parent_id: 'task-sqlite-index-forward',
            status: 'compiled',
            label: 'SQLite indexed forward'
          }),
          expect.objectContaining({
            entity_type: 'runtime-preflight-plan',
            entity_id: 'preflight-sqlite-index',
            parent_id: 'runtime-revision-sqlite-index',
            status: 'failed',
            label: 'forward-sqlite-index'
          }),
          expect.objectContaining({
            entity_type: 'runtime-snapshot',
            entity_id: 'snapshot-sqlite-index',
            parent_id: 'task-sqlite-index-forward',
            status: 'captured',
            label: 'SQLite indexed forward'
          })
        ])
      );
      expect(JSON.parse(rows.find((row) => row.entity_id === 'task-sqlite-index-forward')?.payload ?? '{}')).toEqual({
        actor: 'admin',
        operation: 'forward.create',
        requestId: 'req-sqlite-index-forward',
        resourceType: 'forward',
        targetId: 'forward-sqlite-index'
      });
      expect(JSON.parse(rows.find((row) => row.entity_id === 'preflight-sqlite-index')?.payload ?? '{}')).toEqual({
        agentId: 'agent-sqlite-index',
        checkCount: 1,
        criticalFailureCount: 1,
        moduleKind: 'port-forwarding',
        targetId: 'forward-sqlite-index',
        taskId: 'task-sqlite-index-forward'
      });
      expect(rawIndex).not.toContain(token);
      expect(rawIndex).not.toContain('clientCredential');
      expect(rawIndex).not.toContain('runtimeSecret');
      expect(rawIndex).not.toContain('previousRuntimeSecret');
      expect(rawIndex).not.toContain('rawUrl');
      expect(rawIndex).not.toContain('clashConfig');
    });
  });

  it('imports legacy json state into sqlite when the database does not exist yet', async () => {
    await withDatabaseFile(async (databaseFilePath, legacyStateFilePath) => {
      await writeFile(
        legacyStateFilePath,
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
            subscriptionSources: [],
            subscriptionClients: [],
            subscriptionExportProfiles: [],
            subscriptionInventoryNodes: [],
            permissionGrants: [
              {
                id: 'grant-bootstrap-owner-operator_legacy',
                subjectType: 'user',
                subjectId: 'operator_legacy',
                resourceType: 'tunnel-group',
                resourceId: 'group-premium',
                permissions: ['read', 'operate', 'configure', 'grant'],
                grantedBy: 'system:bootstrap',
                reason: 'bootstrap owner permissions'
              }
            ],
            configRevisions: [],
            preflightPlans: [],
            runtimeSnapshots: [],
            trafficRollups: []
          },
          null,
          2
        )}\n`,
        'utf8'
      );

      const repository = await createSqliteControlPlaneRepository({
        databaseFilePath,
        legacyStateFilePath
      });

      await expect(repository.listPermissionGrants()).resolves.toEqual([
        expect.objectContaining({
          id: 'grant-bootstrap-owner-operator_legacy',
          subjectId: 'operator_legacy',
          resourceId: 'group-premium'
        })
      ]);
    });
  });

  it('rejects future sqlite schema versions without downgrading metadata', async () => {
    await withDatabaseFile(async (databaseFilePath) => {
      writeControlPlaneDatabaseMetadataFixture(databaseFilePath, '3');

      await expect(createSqliteControlPlaneRepository({ databaseFilePath })).rejects.toThrow(
        'Unsupported control-plane sqlite schema_version 3'
      );
      expect(readSchemaVersion(databaseFilePath)).toBe('3');
    });
  });

  it('persists runtime Agent log retention policy overrides', async () => {
    await withDatabaseFile(async (databaseFilePath) => {
      const repository = await createSqliteControlPlaneRepository({ databaseFilePath });

      await repository.transaction(async (transaction) => {
        await transaction.setAgentLogRetentionPolicy({
          maxAgeMs: 3 * 24 * 60 * 60 * 1000,
          maxEventsPerAgent: 300
        });
      });

      const restoredRepository = await createSqliteControlPlaneRepository({ databaseFilePath });

      await expect(restoredRepository.getAgentLogRetentionPolicy()).resolves.toEqual({
        maxAgeMs: 3 * 24 * 60 * 60 * 1000,
        maxEventsPerAgent: 300
      });
    });
  });

  it('persists runtime traffic rollup retention policy overrides', async () => {
    await withDatabaseFile(async (databaseFilePath) => {
      const repository = await createSqliteControlPlaneRepository({ databaseFilePath });

      await repository.transaction(async (transaction) => {
        await transaction.setTrafficRollupRetentionPolicy({
          maxAgeMs: 45 * 24 * 60 * 60 * 1000,
          maxRecordsPerScope: 8000
        });
      });

      const restoredRepository = await createSqliteControlPlaneRepository({ databaseFilePath });

      await expect(restoredRepository.getTrafficRollupRetentionPolicy()).resolves.toEqual({
        maxAgeMs: 45 * 24 * 60 * 60 * 1000,
        maxRecordsPerScope: 8000
      });
    });
  });
});
