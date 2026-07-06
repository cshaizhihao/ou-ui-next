import { describe, expect, it } from 'vitest';
import type { SubscriptionSource } from '../../domain';
import { createTaskRequestSchema } from '../../services/api/api-contract';
import type {
  SubscriptionClientRuleMetadata,
  SubscriptionExportProfileMetadata,
  SubscriptionSourceImportMetadata
} from './subscription-mixer-page';
import {
  createSubscriptionClientDeleteIdempotencyKey,
  createSubscriptionClientDeleteTaskInput,
  createSubscriptionClientGenerateIdempotencyKey,
  createSubscriptionClientGenerateTaskInput,
  createSubscriptionExportIdempotencyKey,
  createSubscriptionExportProfileDeleteTaskInput,
  createSubscriptionExportProfileUpsertIdempotencyKey,
  createSubscriptionExportProfileUpsertTaskInput,
  createSubscriptionExportTaskInput,
  createSubscriptionSourceDeleteTaskInput,
  createSubscriptionSourceImportSyncTaskInput,
  createSubscriptionSourceImportTaskInput,
  createSubscriptionSourceSyncIdempotencyKey,
  createSubscriptionSourceSyncTaskInput
} from './subscription-task-inputs';

const clientMetadata: SubscriptionClientRuleMetadata = {
  subscriptionClientId: 'sub-client-acme',
  customerName: 'Acme',
  ruleName: 'Acme subscription',
  displayName: 'Acme subscription',
  subId: 'acme-sub',
  email: 'ops@acme.example',
  protocol: 'vless',
  group: 'agent-hkg-01',
  trafficLimitGb: 100,
  usedTrafficGb: 10,
  remainingDays: 20,
  ipLimit: 2,
  requestLimitPerHour: 360,
  sourceIds: ['source-a'],
  selectedTags: ['premium'],
  includeFilter: 'hk',
  excludeFilter: 'trial',
  regionFilter: ['HK'],
  routingRule: 'tag:premium',
  trafficFilter: 'available',
  maxLatencyMs: 200,
  sortStrategy: 'latency',
  formats: ['plain', 'clash', 'mihomo'],
  outputFormats: ['uri', 'clash', 'mihomo'],
  templateName: 'mihomo-compatible.yaml',
  enabled: true,
  generatedNodeCount: 3,
  accessTokenPreview: 'ou_preview',
  securePathPreview: '/secure-path',
  subscriptionUrlPreview: {
    clash: 'https://panel.example/sub/secure-path/clash/acme-sub',
    mihomo: 'https://panel.example/sub/secure-path/mihomo/acme-sub',
    v2ray: 'https://panel.example/sub/secure-path/v2ray/acme-sub',
    'sing-box': 'https://panel.example/sub/secure-path/sing-box/acme-sub',
    uri: 'https://panel.example/sub/secure-path/uri/acme-sub',
    shadowrocket: 'https://panel.example/sub/secure-path/shadowrocket/acme-sub',
    stash: 'https://panel.example/sub/secure-path/stash/acme-sub'
  },
  clientRule: {
    protocolFilter: 'vless',
    sourceIds: ['source-a'],
    tagFilter: ['premium'],
    regionFilter: ['HK'],
    includeFilter: 'hk',
    excludeFilter: 'trial',
    routingRule: 'tag:premium',
    trafficFilter: 'available',
    maxLatencyMs: 200,
    sortStrategy: 'latency',
    outputFormats: ['uri', 'clash', 'mihomo'],
    trafficConstraint: {
      limitGb: 100,
      usedGb: 10,
      remainingDays: 20,
      ipLimit: 2,
      requestLimitPerHour: 360
    },
    access: {
      subId: 'acme-sub',
      tokenPreview: 'ou_preview',
      securePathPreview: '/secure-path'
    }
  }
};

const sourceImportMetadata: SubscriptionSourceImportMetadata = {
  sourceId: '',
  kind: 'clash',
  name: 'Acme upstream',
  url: 'https://provider.example/sub.yaml',
  providerAccountId: 'provider-acme',
  userAgent: 'ou-ui-next-test',
  refreshIntervalMinutes: 60,
  fetchTimeoutSeconds: 20,
  maxBodyBytes: 1_000_000,
  syncBudgetMaxFetchesPerDay: 24,
  syncBudgetMaxBytesPerDay: 20_000_000,
  includeFilter: 'HK',
  excludeFilter: 'trial',
  dedupeKey: 'server-port',
  syncPolicy: {
    userAgent: 'ou-ui-next-test',
    refreshIntervalMinutes: 60,
    fetchTimeoutSeconds: 20,
    maxBodyBytes: 1_000_000
  },
  syncBudget: {
    providerAccountId: 'provider-acme',
    maxFetchesPerDay: 24,
    maxBytesPerDay: 20_000_000
  },
  sourceRule: {
    includeFilter: 'HK',
    excludeFilter: 'trial',
    dedupeKey: 'server-port'
  }
};

const source: SubscriptionSource = {
  id: 'source-acme',
  kind: 'clash',
  name: 'Acme upstream',
  url: 'https://provider.example/sub.yaml',
  status: 'synced',
  nodeCount: 12,
  dedupeKey: 'server-port',
  lastSyncAt: '2026-07-01T00:00:00.000Z',
  rateLimitPerMinute: 2,
  refreshIntervalMinutes: 60,
  includeFilter: 'HK',
  excludeFilter: 'trial'
};

const profileMetadata: SubscriptionExportProfileMetadata = {
  profileId: '',
  name: 'Mihomo premium',
  client: 'mihomo',
  sourceIds: ['source-a'],
  includeFilter: 'HK',
  excludeFilter: 'trial',
  regionFilter: ['HK'],
  outputFormats: ['mihomo'],
  templateName: 'mihomo-compatible.yaml',
  proxyGroups: [
    {
      id: 'proxy-auto',
      name: 'Auto',
      strategy: 'url-test',
      filterTags: ['premium']
    }
  ],
  includeTrafficHeaders: true
};

describe('subscription task inputs', () => {
  it('creates API-valid generate tasks and makes idempotency sensitive to runtime-affecting fields', () => {
    const input = createSubscriptionClientGenerateTaskInput(clientMetadata, 'create', {
      create: 'Create subscription client',
      update: 'Update subscription client'
    });

    expect(createTaskRequestSchema.safeParse(input).success).toBe(true);
    expect(input).toMatchObject({
      operation: 'subscription.generate',
      resourceType: 'subscription',
      targetId: 'sub-client-acme',
      targetLabel: 'Acme subscription'
    });

    const enabledKey = createSubscriptionClientGenerateIdempotencyKey(clientMetadata, 'update');
    const disabledKey = createSubscriptionClientGenerateIdempotencyKey({ ...clientMetadata, enabled: false }, 'update');
    const filterKey = createSubscriptionClientGenerateIdempotencyKey(
      { ...clientMetadata, includeFilter: 'SG' },
      'update'
    );

    expect(enabledKey).not.toBe(disabledKey);
    expect(enabledKey).not.toBe(filterKey);
  });

  it('creates API-valid delete tasks with risk confirmation', () => {
    const input = createSubscriptionClientDeleteTaskInput(clientMetadata, 'Delete subscription client', {
      deletedWithCustomerNodeId: 'inbound-acme'
    });

    expect(createTaskRequestSchema.safeParse(input).success).toBe(true);
    expect(input.riskConfirmation).toEqual({
      operation: 'subscription.delete',
      targetId: 'sub-client-acme'
    });
    expect(createSubscriptionClientDeleteIdempotencyKey(clientMetadata)).toBe('ui:subscription.delete:sub-client-acme');
    expect(input.metadata).toEqual(expect.objectContaining({ deletedWithCustomerNodeId: 'inbound-acme' }));
  });

  it('creates API-valid source import, sync, and delete tasks', () => {
    const importInput = createSubscriptionSourceImportTaskInput(sourceImportMetadata, 'Import subscription source');
    const importSyncInput = createSubscriptionSourceImportSyncTaskInput(sourceImportMetadata, 'Sync subscription source');
    const syncInput = createSubscriptionSourceSyncTaskInput(source, 'Sync subscription source');
    const deleteInput = createSubscriptionSourceDeleteTaskInput(source, 'Delete subscription source');

    expect(createTaskRequestSchema.safeParse(importInput).success).toBe(true);
    expect(createTaskRequestSchema.safeParse(importSyncInput).success).toBe(true);
    expect(createTaskRequestSchema.safeParse(syncInput).success).toBe(true);
    expect(createTaskRequestSchema.safeParse(deleteInput).success).toBe(true);
    expect(importInput.targetId).toBe('subscription-source-acme-upstream');
    expect(syncInput.metadata).toEqual(
      expect.objectContaining({
        sourceId: 'source-acme',
        includeFilter: 'HK',
        excludeFilter: 'trial',
        refreshIntervalMinutes: 60
      })
    );
    expect(deleteInput.riskConfirmation).toEqual({
      operation: 'subscription.delete',
      targetId: 'source-acme'
    });
    expect(createSubscriptionSourceSyncIdempotencyKey('source-acme', 'manual', 123)).toBe(
      'ui:subscription.sync.manual:source-acme:123'
    );
  });

  it('creates API-valid export profile and export tasks', () => {
    const upsertInput = createSubscriptionExportProfileUpsertTaskInput(profileMetadata, 'Save profile');
    const deleteInput = createSubscriptionExportProfileDeleteTaskInput(
      { ...profileMetadata, profileId: 'subscription-profile-mihomo-premium' },
      'Delete profile'
    );
    const exportInput = createSubscriptionExportTaskInput(
      { subscriptionClientId: 'sub-client-acme', name: 'Acme mihomo' },
      clientMetadata,
      'Generate subscription'
    );

    expect(createTaskRequestSchema.safeParse(upsertInput).success).toBe(true);
    expect(createTaskRequestSchema.safeParse(deleteInput).success).toBe(true);
    expect(createTaskRequestSchema.safeParse(exportInput).success).toBe(true);
    expect(upsertInput.targetId).toBe('subscription-profile-mihomo-premium');
    expect(upsertInput.metadata).toEqual(expect.objectContaining({ profileId: 'subscription-profile-mihomo-premium' }));
    expect(deleteInput.riskConfirmation).toEqual({
      operation: 'subscription.profile.delete',
      targetId: 'subscription-profile-mihomo-premium'
    });

    const baseKey = createSubscriptionExportProfileUpsertIdempotencyKey(profileMetadata, 'create');
    const changedGroupKey = createSubscriptionExportProfileUpsertIdempotencyKey(
      {
        ...profileMetadata,
        proxyGroups: [{ id: 'proxy-fallback', name: 'Fallback', strategy: 'fallback', filterTags: ['backup'] }]
      },
      'create'
    );
    const exportKey = createSubscriptionExportIdempotencyKey(
      { subscriptionClientId: 'sub-client-acme', templateName: 'mihomo-compatible.yaml', formats: ['mihomo'] },
      clientMetadata
    );

    expect(baseKey).not.toBe(changedGroupKey);
    expect(exportKey).toContain('ui:subscription.export');
  });
});
