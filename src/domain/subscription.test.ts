import type { DeployTask } from './task';
import { applySubscriptionClientTask, applySubscriptionSourceTask, createSubscriptionClientFromTask } from './subscription';

function createSubscriptionTask(metadata: DeployTask['metadata']): DeployTask {
  return {
    id: 'task-subscription-secure-path',
    operation: 'subscription.generate',
    resourceType: 'subscription',
    resourceId: 'sub-client-secure',
    status: 'queued',
    targetId: 'sub-client-secure',
    targetLabel: 'Secure Client Subscription',
    summary: 'Create secure client subscription',
    createdAt: '2026-06-04T00:00:00.000Z',
    updatedAt: '2026-06-04T00:00:00.000Z',
    actor: 'operator_001',
    requestedBy: 'operator_001',
    requestId: 'req-subscription-secure-path',
    sourceIp: '127.0.0.1',
    rollbackAvailable: false,
    attempts: 0,
    steps: [],
    metadata
  };
}

describe('subscription read models', () => {
  it('creates a non-empty secure public path when direct API metadata omits one', () => {
    const client = createSubscriptionClientFromTask(
      createSubscriptionTask({
        subscriptionClientId: 'sub-client-secure',
        displayName: 'Secure Client Subscription',
        subId: 'sub_secure_client',
        protocol: 'vless'
      })
    );

    expect(client?.securePathPreview).toMatch(/^\/[A-Za-z0-9]{24}$/);
  });

  it('keeps an explicitly generated secure path stable when metadata provides one', () => {
    const client = createSubscriptionClientFromTask(
      createSubscriptionTask({
        subscriptionClientId: 'sub-client-secure',
        displayName: 'Secure Client Subscription',
        subId: 'sub_secure_client',
        protocol: 'vless',
        securePathPreview: '/A1b2C3d4E5f6G7h8J9k2Lm3n'
      })
    );

    expect(client?.securePathPreview).toBe('/A1b2C3d4E5f6G7h8J9k2Lm3n');
  });

  it('maps subscription request limits into the public client read model', () => {
    const client = createSubscriptionClientFromTask(
      createSubscriptionTask({
        subscriptionClientId: 'sub-client-limited',
        displayName: 'Limited Client Subscription',
        subId: 'sub_limited_client',
        protocol: 'vless',
        requestLimitPerHour: 120
      })
    );

    expect(client?.requestLimitPerHour).toBe(120);
  });

  it('deletes external subscription sources without deleting customer subscription identities', () => {
    const deleteSourceTask = createSubscriptionTask({
      sourceId: 'source-premium-sync'
    });
    deleteSourceTask.operation = 'subscription.delete';
    deleteSourceTask.targetId = 'source-premium-sync';

    expect(
      applySubscriptionSourceTask(
        [
          {
            id: 'source-premium-sync',
            kind: 'clash',
            name: 'Premium Source',
            url: 'https://provider.example.com/premium.yaml',
            status: 'synced',
            nodeCount: 2,
            dedupeKey: 'server-port',
            lastSyncAt: '2026-06-04T00:00:00.000Z',
            rateLimitPerMinute: 30
          }
        ],
        deleteSourceTask
      )
    ).toEqual([]);
    expect(
      applySubscriptionClientTask(
        [
          {
            id: 'sub-client-premium',
            displayName: 'Premium Client',
            subId: 'sub_premium',
            email: 'ops@example.com',
            enabled: true,
            protocol: 'vless',
            group: 'premium',
            trafficLimitBytes: 0,
            usedTrafficBytes: 0,
            expiresAt: '2026-07-04T00:00:00.000Z',
            ipLimit: 0,
            requestLimitPerHour: 120,
            sourceIds: ['source-premium-sync'],
            selectedTags: [],
            includeFilter: '',
            excludeFilter: '',
            regionFilter: [],
            routingRule: '',
            maxLatencyMs: 0,
            sortStrategy: 'latency',
            formats: ['plain'],
            outputFormats: ['uri'],
            templateName: 'mihomo-compatible.yaml',
            accessTokenPreview: 'ou_prem...sync',
            securePathPreview: '/A1b2C3d4E5f6G7h8J9k2Lm3n',
            generatedNodeCount: 2,
            lastOnlineAt: '',
            lastGeneratedAt: '2026-06-04T00:00:00.000Z'
          }
        ],
        deleteSourceTask
      )
    ).toHaveLength(1);
  });
});
