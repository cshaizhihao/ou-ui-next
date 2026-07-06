import type { DeployTask } from './task';
import {
  applySubscriptionClientTask,
  applySubscriptionExportProfileTask,
  applySubscriptionSourceTask,
  createSubscriptionBundlesFromInventory,
  createSubscriptionClientFromTask,
  createSubscriptionExportFilesFromClients,
  createSubscriptionExportProfileFromTask,
  createSubscriptionSourceFromTask,
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

  it('keeps explicitly rotated subscription access material stable in the client read model', () => {
    const client = createSubscriptionClientFromTask(
      createSubscriptionTask({
        subscriptionClientId: 'sub-client-rotated',
        displayName: 'Rotated Client Subscription',
        subId: 'sub_rotated_client',
        protocol: 'vless',
        accessTokenPreview: 'ou_rotat...9Lm3',
        securePathPreview: '/R1b2C3d4E5f6G7h8J9k2Lm3n'
      })
    );

    expect(client).toMatchObject({
      id: 'sub-client-rotated',
      accessTokenPreview: 'ou_rotat...9Lm3',
      securePathPreview: '/R1b2C3d4E5f6G7h8J9k2Lm3n'
    });
  });

  it('keeps only valid subscription access token hashes in the client read model', () => {
    const validClient = createSubscriptionClientFromTask(
      createSubscriptionTask({
        subscriptionClientId: 'sub-client-token-hash',
        displayName: 'Token Hash Client Subscription',
        subId: 'sub_token_hash_client',
        protocol: 'vless',
        accessTokenHash: `sha256:${'A'.repeat(64)}`
      })
    );
    const invalidClient = createSubscriptionClientFromTask(
      createSubscriptionTask({
        subscriptionClientId: 'sub-client-token-hash-invalid',
        displayName: 'Invalid Token Hash Client Subscription',
        subId: 'sub_token_hash_client_invalid',
        protocol: 'vless',
        accessTokenHash: 'raw-token-should-not-be-kept'
      })
    );

    expect(validClient?.accessTokenHash).toBe(`sha256:${'a'.repeat(64)}`);
    expect(invalidClient?.accessTokenHash).toBeUndefined();
  });

  it('preserves subscription access token hashes when an update omits accessTokenHash metadata', () => {
    const [updatedClient] = applySubscriptionClientTask(
      [
        {
          ...createSubscriptionClientFromTask(
            createSubscriptionTask({
              subscriptionClientId: 'sub-client-token-hash',
              displayName: 'Token Hash Client Subscription',
              subId: 'sub_token_hash_client',
              protocol: 'vless',
              accessTokenHash: `sha256:${'b'.repeat(64)}`
            })
          )!
        }
      ],
      createSubscriptionTask({
        subscriptionClientId: 'sub-client-token-hash',
        displayName: 'Updated Token Hash Client Subscription',
        subId: 'sub_token_hash_client',
        protocol: 'vless'
      })
    );

    expect(updatedClient).toMatchObject({
      displayName: 'Updated Token Hash Client Subscription',
      accessTokenHash: `sha256:${'b'.repeat(64)}`
    });
  });

  it('clears subscription access token hashes when an update explicitly submits an empty hash', () => {
    const [updatedClient] = applySubscriptionClientTask(
      [
        {
          ...createSubscriptionClientFromTask(
            createSubscriptionTask({
              subscriptionClientId: 'sub-client-token-hash',
              displayName: 'Token Hash Client Subscription',
              subId: 'sub_token_hash_client',
              protocol: 'vless',
              accessTokenHash: `sha256:${'c'.repeat(64)}`
            })
          )!
        }
      ],
      createSubscriptionTask({
        subscriptionClientId: 'sub-client-token-hash',
        displayName: 'Cleared Token Hash Client Subscription',
        subId: 'sub_token_hash_client',
        protocol: 'vless',
        accessTokenHash: ''
      })
    );

    expect(updatedClient).toMatchObject({
      displayName: 'Cleared Token Hash Client Subscription'
    });
    expect(updatedClient?.accessTokenHash).toBeUndefined();
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

  it('maps external subscription source fetch policy into the source read model', () => {
    const task = createSubscriptionTask({
      sourceId: 'source-fetch-policy',
      kind: 'clash',
      name: 'Fetch Policy Source',
      url: 'https://provider.example.com/policy.yaml',
      refreshIntervalMinutes: 30,
      fetchTimeoutSeconds: 12,
      maxBodyBytes: 8 * 1024 * 1024,
      providerAccountId: 'provider-account-premium',
      syncBudgetMaxFetchesPerDay: 6,
      syncBudgetMaxBytesPerDay: 32 * 1024 * 1024
    });
    task.operation = 'subscription.import';
    task.targetId = 'source-fetch-policy';
    task.targetLabel = 'Fetch Policy Source';

    expect(createSubscriptionSourceFromTask(task)).toMatchObject({
      id: 'source-fetch-policy',
      fetchTimeoutSeconds: 12,
      maxBodyBytes: 8 * 1024 * 1024,
      providerAccountId: 'provider-account-premium',
      syncBudget: {
        maxFetchesPerDay: 6,
        maxBytesPerDay: 32 * 1024 * 1024,
        windowStartedAt: '2026-06-04T00:00:00.000Z',
        windowEndsAt: '2026-06-05T00:00:00.000Z',
        usedFetches: 0,
        usedBytes: 0
      }
    });
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

  it('projects subscription bundles from synced sources, inventory nodes and export profiles', () => {
    const sources = [
      {
        id: 'source-hk-premium',
        kind: 'clash' as const,
        name: 'HK Premium',
        url: 'https://provider.example.com/hk.yaml',
        status: 'synced' as const,
        nodeCount: 3,
        dedupeKey: 'server-port' as const,
        lastSyncAt: '2026-06-04T00:00:00.000Z',
        rateLimitPerMinute: 60
      },
      {
        id: 'source-sg-standard',
        kind: 'v2ray-uri' as const,
        name: 'SG Standard',
        url: 'https://provider.example.com/sg.txt',
        status: 'warning' as const,
        nodeCount: 1,
        dedupeKey: 'uuid' as const,
        lastSyncAt: '2026-06-04T00:00:00.000Z',
        rateLimitPerMinute: 60
      }
    ];
    const inventoryNodes = [
      {
        id: 'node-hk-premium-01',
        sourceId: 'source-hk-premium',
        name: 'HK Premium 01',
        protocol: 'vless',
        server: 'hk.example.com',
        port: 443,
        latencyMs: 70,
        tags: ['premium', 'region:hk']
      },
      {
        id: 'node-sg-standard-01',
        sourceId: 'source-sg-standard',
        name: 'SG Standard 01',
        protocol: 'trojan',
        server: 'sg.example.com',
        port: 443,
        latencyMs: 90,
        tags: ['standard', 'region:sg']
      }
    ];
    const profile = {
      id: 'profile-hk-premium',
      name: 'HK Premium Profile',
      client: 'mihomo' as const,
      sourceIds: ['source-hk-premium'],
      includeFilter: 'premium',
      excludeFilter: 'expired',
      regionFilter: ['hk'],
      outputFormats: ['mihomo' as const, 'sing-box' as const],
      templateName: 'hk-premium.yaml',
      proxyGroups: [
        {
          id: 'proxy-group-auto',
          name: 'AUTO',
          strategy: 'url-test' as const,
          filterTags: ['premium']
        }
      ],
      includeTrafficHeaders: true,
      updatedAt: '2026-06-04T00:00:00.000Z'
    };

    expect(createSubscriptionBundlesFromInventory(sources, inventoryNodes, [profile])).toEqual([
      expect.objectContaining({
        id: 'sub-global-premium',
        sources: [
          expect.objectContaining({ id: 'source-hk-premium', nodeCount: 1, status: 'ok' }),
          expect.objectContaining({ id: 'source-sg-standard', nodeCount: 1, status: 'warning' })
        ],
        exportTargets: ['Clash', 'Sing-box'],
        generatedNodeCount: 2,
        healthScore: 83
      }),
      expect.objectContaining({
        id: 'sub-bundle-profile-hk-premium',
        name: 'HK Premium Profile',
        strategy: 'latency',
        sources: [expect.objectContaining({ id: 'source-hk-premium', nodeCount: 1, status: 'ok' })],
        exportTargets: ['Clash', 'Sing-box'],
        generatedNodeCount: 1,
        healthScore: 100
      })
    ]);
  });
});
