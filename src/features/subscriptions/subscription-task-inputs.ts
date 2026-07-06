import type { SubscriptionSource } from '../../domain';
import type { CreateTaskInput } from '../../domain/task';
import type {
  SubscriptionClientRuleMetadata,
  SubscriptionExportProfileMetadata,
  SubscriptionSourceImportMetadata
} from './subscription-mixer-page';

export type SubscriptionClientSaveAction = 'create' | 'update';

export type SubscriptionExportTaskTarget = {
  subscriptionClientId: string;
  name: string;
};

function createStableSlug(value: string, fallback: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || fallback;
}

function createIdentityKey(scope: string, value: Record<string, unknown>) {
  return [scope, JSON.stringify(value)].join(':');
}

function createSubscriptionSourceImportMetadata(metadata: SubscriptionSourceImportMetadata) {
  const sourceId = createSubscriptionSourceImportTargetId(metadata);

  return {
    ...metadata,
    sourceId
  };
}

export function createSubscriptionClientGenerateTaskInput(
  metadata: SubscriptionClientRuleMetadata,
  action: SubscriptionClientSaveAction,
  summaries: { create: string; update: string }
): CreateTaskInput {
  return {
    operation: 'subscription.generate',
    resourceType: 'subscription',
    targetId: metadata.subscriptionClientId,
    targetLabel: metadata.displayName,
    summary: action === 'create' ? summaries.create : summaries.update,
    metadata
  };
}

export function createSubscriptionClientGenerateIdempotencyKey(
  metadata: SubscriptionClientRuleMetadata,
  action: SubscriptionClientSaveAction
) {
  return createIdentityKey(`ui:subscription.generate:${metadata.subscriptionClientId}`, {
    action,
    subId: metadata.subId,
    email: metadata.email,
    protocol: metadata.protocol,
    group: metadata.group,
    trafficLimitGb: metadata.trafficLimitGb,
    usedTrafficGb: metadata.usedTrafficGb,
    remainingDays: metadata.remainingDays,
    ipLimit: metadata.ipLimit,
    requestLimitPerHour: metadata.requestLimitPerHour,
    sourceIds: metadata.sourceIds,
    selectedTags: metadata.selectedTags,
    includeFilter: metadata.includeFilter,
    excludeFilter: metadata.excludeFilter,
    regionFilter: metadata.regionFilter,
    routingRule: metadata.routingRule,
    trafficFilter: metadata.trafficFilter,
    maxLatencyMs: metadata.maxLatencyMs,
    sortStrategy: metadata.sortStrategy,
    formats: metadata.formats,
    outputFormats: metadata.outputFormats,
    templateName: metadata.templateName,
    enabled: metadata.enabled
  });
}

export function createSubscriptionClientDeleteTaskInput(
  metadata: SubscriptionClientRuleMetadata,
  summary: string,
  extraMetadata?: Record<string, unknown>
): CreateTaskInput {
  return {
    operation: 'subscription.delete',
    resourceType: 'subscription',
    targetId: metadata.subscriptionClientId,
    targetLabel: metadata.displayName,
    summary,
    metadata: {
      ...metadata,
      ...extraMetadata
    },
    riskConfirmation: {
      operation: 'subscription.delete',
      targetId: metadata.subscriptionClientId
    }
  };
}

export function createSubscriptionClientDeleteIdempotencyKey(
  metadata: Pick<SubscriptionClientRuleMetadata, 'subscriptionClientId'>,
  scope = 'client'
) {
  if (scope === 'client') {
    return ['ui', 'subscription.delete', metadata.subscriptionClientId].join(':');
  }

  if (scope.startsWith('customer-node:')) {
    return ['ui', 'subscription.delete.customer-node', scope.replace(/^customer-node:/, ''), metadata.subscriptionClientId].join(
      ':'
    );
  }

  return ['ui', 'subscription.delete', scope, metadata.subscriptionClientId].join(':');
}

export function createSubscriptionSourceImportTargetId(metadata: SubscriptionSourceImportMetadata) {
  return metadata.sourceId || `subscription-source-${createStableSlug(metadata.name, 'external-source')}`;
}

export function createSubscriptionSourceImportTaskInput(
  metadata: SubscriptionSourceImportMetadata,
  summary: string
): CreateTaskInput {
  const targetId = createSubscriptionSourceImportTargetId(metadata);
  const taskMetadata = createSubscriptionSourceImportMetadata(metadata);

  return {
    operation: 'subscription.import',
    resourceType: 'subscription',
    targetId,
    targetLabel: metadata.name,
    summary,
    metadata: taskMetadata
  };
}

export function createSubscriptionSourceImportIdempotencyKey(metadata: SubscriptionSourceImportMetadata) {
  return ['ui', 'subscription.import', metadata.kind, metadata.url].join(':');
}

export function createSubscriptionSourceImportSyncTaskInput(
  metadata: SubscriptionSourceImportMetadata,
  summary: string
): CreateTaskInput {
  const targetId = createSubscriptionSourceImportTargetId(metadata);
  const taskMetadata = createSubscriptionSourceImportMetadata(metadata);

  return {
    operation: 'subscription.sync',
    resourceType: 'subscription',
    targetId,
    targetLabel: metadata.name,
    summary,
    metadata: taskMetadata
  };
}

export function createSubscriptionSourceSyncTaskInput(source: SubscriptionSource, summary: string): CreateTaskInput {
  return {
    operation: 'subscription.sync',
    resourceType: 'subscription',
    targetId: source.id,
    targetLabel: source.name,
    summary,
    metadata: {
      sourceId: source.id,
      name: source.name,
      url: source.url,
      kind: source.kind,
      includeFilter: source.includeFilter ?? '',
      excludeFilter: source.excludeFilter ?? '',
      dedupeKey: source.dedupeKey,
      refreshIntervalMinutes: source.refreshIntervalMinutes ?? source.rateLimitPerMinute
    }
  };
}

export function createSubscriptionSourceSyncIdempotencyKey(
  sourceId: string,
  scope: 'import' | 'manual',
  nonce: number | string
) {
  return ['ui', scope === 'manual' ? 'subscription.sync.manual' : 'subscription.sync', sourceId, nonce].join(':');
}

export function createSubscriptionSourceDeleteTaskInput(source: SubscriptionSource, summary: string): CreateTaskInput {
  return {
    operation: 'subscription.delete',
    resourceType: 'subscription',
    targetId: source.id,
    targetLabel: source.name,
    summary,
    metadata: {
      sourceId: source.id,
      name: source.name,
      url: source.url
    },
    riskConfirmation: {
      operation: 'subscription.delete',
      targetId: source.id
    }
  };
}

export function createSubscriptionSourceDeleteIdempotencyKey(sourceId: string) {
  return ['ui', 'subscription.delete', 'source', sourceId].join(':');
}

export function createSubscriptionExportProfileUpsertTaskInput(
  metadata: SubscriptionExportProfileMetadata,
  summary: string
): CreateTaskInput {
  const targetId = metadata.profileId || `subscription-profile-${createStableSlug(metadata.name, 'export-profile')}`;

  return {
    operation: 'subscription.profile.upsert',
    resourceType: 'subscription',
    targetId,
    targetLabel: metadata.name,
    summary,
    metadata: {
      ...metadata,
      profileId: targetId
    }
  };
}

export function createSubscriptionExportProfileUpsertIdempotencyKey(
  metadata: SubscriptionExportProfileMetadata,
  action: SubscriptionClientSaveAction
) {
  const targetId = metadata.profileId || `subscription-profile-${createStableSlug(metadata.name, 'export-profile')}`;

  return createIdentityKey(`ui:subscription.profile.upsert:${targetId}`, {
    action,
    client: metadata.client,
    templateName: metadata.templateName,
    outputFormats: metadata.outputFormats,
    sourceIds: metadata.sourceIds,
    includeFilter: metadata.includeFilter,
    excludeFilter: metadata.excludeFilter,
    regionFilter: metadata.regionFilter,
    proxyGroups: metadata.proxyGroups.map((group) => ({
      name: group.name,
      strategy: group.strategy,
      filterTags: group.filterTags
    })),
    includeTrafficHeaders: metadata.includeTrafficHeaders
  });
}

export function createSubscriptionExportProfileDeleteTaskInput(
  metadata: SubscriptionExportProfileMetadata,
  summary: string
): CreateTaskInput {
  return {
    operation: 'subscription.profile.delete',
    resourceType: 'subscription',
    targetId: metadata.profileId,
    targetLabel: metadata.name,
    summary,
    metadata: {
      profileId: metadata.profileId,
      name: metadata.name
    },
    riskConfirmation: {
      operation: 'subscription.profile.delete',
      targetId: metadata.profileId
    }
  };
}

export function createSubscriptionExportProfileDeleteIdempotencyKey(profileId: string) {
  return ['ui', 'subscription.profile.delete', profileId].join(':');
}

export function createSubscriptionExportTaskInput(
  target: SubscriptionExportTaskTarget,
  metadata: SubscriptionClientRuleMetadata,
  summary: string
): CreateTaskInput {
  return {
    operation: 'subscription.export',
    resourceType: 'subscription',
    targetId: target.subscriptionClientId,
    targetLabel: target.name,
    summary,
    metadata
  };
}

export function createSubscriptionExportIdempotencyKey(
  target: { subscriptionClientId: string; templateName: string; formats: string[] },
  metadata: SubscriptionClientRuleMetadata & { profileId?: string }
) {
  return createIdentityKey(`ui:subscription.export:${target.subscriptionClientId}`, {
    templateName: target.templateName,
    formats: target.formats,
    exportProfileId: metadata.profileId ?? 'default',
    sourceIds: metadata.sourceIds,
    selectedTags: metadata.selectedTags,
    includeFilter: metadata.includeFilter,
    excludeFilter: metadata.excludeFilter,
    regionFilter: metadata.regionFilter,
    outputFormats: metadata.outputFormats,
    trafficFilter: metadata.trafficFilter,
    sortStrategy: metadata.sortStrategy
  });
}
