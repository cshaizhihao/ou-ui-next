import type { DeployTask } from './task';
import {
  applySubscriptionClientTask,
  applySubscriptionExportProfileTask,
  applySubscriptionSourceTask,
  createSubscriptionClientFromTask,
  createSubscriptionExportFilesFromClients,
  createSubscriptionExportProfileFromTask,
  selectSubscriptionExportProfileForClient
} from './subscription';

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

  it('creates and deletes persisted export profiles from audited subscription profile tasks', () => {
    const upsertTask = createSubscriptionTask({
      profileId: 'profile-mihomo-premium',
      name: 'Mihomo Premium',
      client: 'mihomo',
      sourceIds: ['source-premium-sync'],
      includeFilter: 'premium|streaming',
      excludeFilter: 'expired|test',
      regionFilter: ['hk', 'sg'],
      outputFormats: ['mihomo', 'clash', 'uri'],
      templateName: 'mihomo-compatible.yaml',
      includeTrafficHeaders: true,
      proxyGroups: [
        {
          id: 'proxy-group-premium-auto',
          name: 'Premium Auto',
          strategy: 'url-test',
          filterTags: ['premium', 'streaming']
        }
      ]
    });
    upsertTask.operation = 'subscription.profile.upsert';
    upsertTask.targetId = 'profile-mihomo-premium';
    upsertTask.targetLabel = 'Mihomo Premium';

    const profile = createSubscriptionExportProfileFromTask(upsertTask);

    expect(profile).toMatchObject({
      id: 'profile-mihomo-premium',
      client: 'mihomo',
      outputFormats: ['mihomo', 'clash', 'uri'],
      proxyGroups: [
        expect.objectContaining({
          name: 'Premium Auto',
          strategy: 'url-test',
          filterTags: ['premium', 'streaming']
        })
      ]
    });

    const profiles = applySubscriptionExportProfileTask([], upsertTask);
    const deleteTask = createSubscriptionTask({
      profileId: 'profile-mihomo-premium'
    });
    deleteTask.operation = 'subscription.profile.delete';
    deleteTask.targetId = 'profile-mihomo-premium';

    expect(applySubscriptionExportProfileTask(profiles, deleteTask)).toEqual([]);
  });

  it('creates profile-scoped export files and avoids ambiguous template profile matches', () => {
    const client = createSubscriptionClientFromTask(
      createSubscriptionTask({
        subscriptionClientId: 'sub-client-hk-premium',
        displayName: 'HK Premium',
        subId: 'sub_hk_premium',
        protocol: 'vless',
        sourceIds: ['source-hk-premium'],
        formats: ['plain', 'mihomo'],
        outputFormats: ['uri', 'mihomo'],
        templateName: 'mihomo-compatible.yaml'
      })
    );

    if (!client) {
      throw new Error('expected subscription client read model');
    }

    const profile = {
      id: 'profile-hk-premium',
      name: 'HK Premium Profile',
      client: 'mihomo' as const,
      sourceIds: ['source-hk-premium'],
      includeFilter: 'premium',
      excludeFilter: 'expired',
      regionFilter: ['hk'],
      outputFormats: ['mihomo' as const],
      templateName: 'mihomo-compatible.yaml',
      proxyGroups: [],
      includeTrafficHeaders: true,
      updatedAt: '2026-06-04T00:00:00.000Z'
    };
    const exportFiles = createSubscriptionExportFilesFromClients(
      [client],
      [
        {
          id: 'provider-source-hk-premium',
          name: 'HK Premium Provider',
          externalSubscriptionId: 'source-hk-premium',
          filter: 'premium',
          excludeFilter: 'expired',
          geoIpFilter: 'HK',
          processMode: 'server',
          overrideRule: 'source:source-hk-premium'
        },
        {
          id: 'provider-source-sg-standard',
          name: 'SG Standard Provider',
          externalSubscriptionId: 'source-sg-standard',
          filter: 'standard',
          excludeFilter: '',
          geoIpFilter: 'SG',
          processMode: 'server',
          overrideRule: 'source:source-sg-standard'
        }
      ],
      [profile]
    );

    expect(exportFiles).toEqual([
      expect.objectContaining({
        id: 'export-sub-client-hk-premium-profile-hk-premium',
        subscriptionClientId: 'sub-client-hk-premium',
        exportProfileId: 'profile-hk-premium',
        exportProfileName: 'HK Premium Profile',
        selectedProviderIds: ['provider-source-hk-premium']
      })
    ]);
    expect(selectSubscriptionExportProfileForClient([profile], client, 'mihomo')?.id).toBe('profile-hk-premium');
    expect(
      selectSubscriptionExportProfileForClient(
        [
          { ...profile, id: 'profile-a' },
          { ...profile, id: 'profile-b' }
        ],
        client,
        'mihomo'
      )
    ).toBeUndefined();
  });
});
