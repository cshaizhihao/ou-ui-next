import type { AppRuntimeConfig } from '../../app/runtime-config';
import type { OperatorSessionSummary } from '../../domain';
import type { ControlPlaneBackupPreflightResult, ControlPlaneBackupSummary } from '../../features/admin/admin-account-settings-page';
import type { ControlPlaneSnapshot } from '../../services/api/use-control-plane-snapshot';

export type ControlPlaneBackupPackage = {
  kind: 'ou-ui-next.control-plane.backup';
  schemaVersion: 1;
  generatedAt: string;
  generatedBy: {
    loginUsername: string;
    controlPlaneMode: AppRuntimeConfig['controlPlaneMode'];
    operatorGroupId: string;
    resourceGroupId: string;
  };
  restorePlan: {
    command: 'sudo ou-ui restore-control-plane-backup --stdin';
    includes: Array<'inventory' | 'runtimeEvidence' | 'audit' | 'security'>;
    redaction: string;
  };
  inventory: {
    agents: ControlPlaneSnapshot['agents'];
    hosts: ControlPlaneSnapshot['nodes'];
    customerNodes: ControlPlaneSnapshot['inbounds'];
    customers: ControlPlaneSnapshot['customers'];
    forwardingRules: ControlPlaneSnapshot['forwardRules'];
    quotaPolicies: ControlPlaneSnapshot['quotaPolicies'];
    rateLimitPolicies: ControlPlaneSnapshot['rateLimitPolicies'];
    subscriptionSources: ControlPlaneSnapshot['subscriptionSources'];
    subscriptionInventoryNodes: ControlPlaneSnapshot['subscriptionInventoryNodes'];
    subscriptionClients: ControlPlaneSnapshot['subscriptionClients'];
    subscriptionExportProfiles: ControlPlaneSnapshot['subscriptionExportProfiles'];
    routingPolicies: ControlPlaneSnapshot['routingPolicies'];
    tuningProfiles: ControlPlaneSnapshot['tuningProfiles'];
    permissionGrants: ControlPlaneSnapshot['permissionGrants'];
    agentLogRetentionPolicy: ControlPlaneSnapshot['agentLogRetentionPolicy'];
    trafficRollupRetentionPolicy: ControlPlaneSnapshot['trafficRollupRetentionPolicy'];
  };
  runtimeEvidence: {
    configRevisions: ControlPlaneSnapshot['configRevisions'];
    preflightPlans: ControlPlaneSnapshot['preflightPlans'];
    runtimeSnapshots: ControlPlaneSnapshot['runtimeSnapshots'];
    failedTasks: Array<{
      id: string;
      operation: string;
      resourceType: string;
      targetId: string;
      targetLabel: string;
      status: string;
      failureReason?: string;
      rollbackTaskId?: string;
      updatedAt: string;
    }>;
  };
  audit: {
    logCount: number;
    firstLogId?: string;
    firstHash?: string;
    latestLogId?: string;
    latestHash?: string;
  };
  security: {
    agentCredentials: ControlPlaneSnapshot['agentCredentials'];
    operatorSessions: OperatorSessionSummary[];
    telegramBotSettings: {
      id: ControlPlaneSnapshot['telegramBotSettings']['id'];
      enabled: boolean;
      mode: ControlPlaneSnapshot['telegramBotSettings']['mode'];
      botTokenSet: boolean;
      botTokenPreview?: string;
      webhookSecretPathSet: boolean;
      webhookSecretPathPreview?: string;
      adminChatIds: string[];
      adminTelegramUserIds: string[];
      schedules: ControlPlaneSnapshot['telegramBotSettings']['schedules'];
      defaultPolicyId: string;
      updatedAt: string;
      updatedBy: string;
    };
    telegramBindings: ControlPlaneSnapshot['telegramBindings'];
    telegramNotificationPolicies: ControlPlaneSnapshot['telegramNotificationPolicies'];
  };
};

function redactBackupSecrets<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => redactBackupSecrets(item)) as T;
  }

  const record = asRecord(value);
  if (!record) {
    return value;
  }

  const redacted: Record<string, unknown> = {};

  for (const [key, nestedValue] of Object.entries(record)) {
    if (isSensitiveBackupField(key)) {
      continue;
    }

    redacted[key] = redactBackupSecrets(nestedValue);
  }

  return redacted as T;
}

export function createControlPlaneBackupPackage({
  generatedAt,
  operatorSessions,
  runtimeConfig,
  snapshot
}: {
  generatedAt: string;
  operatorSessions: OperatorSessionSummary[];
  runtimeConfig: AppRuntimeConfig;
  snapshot: ControlPlaneSnapshot;
}): ControlPlaneBackupPackage {
  const auditTimeline = [...snapshot.auditLogs].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const firstAuditLog = auditTimeline[0];
  const latestAuditLog = auditTimeline[auditTimeline.length - 1];

  return redactBackupSecrets({
    kind: 'ou-ui-next.control-plane.backup',
    schemaVersion: 1,
    generatedAt,
    generatedBy: {
      loginUsername: runtimeConfig.loginUsername,
      controlPlaneMode: runtimeConfig.controlPlaneMode,
      operatorGroupId: runtimeConfig.operatorGroupId,
      resourceGroupId: runtimeConfig.resourceGroupId
    },
    restorePlan: {
      command: 'sudo ou-ui restore-control-plane-backup --stdin',
      includes: ['inventory', 'runtimeEvidence', 'audit', 'security'],
      redaction:
        'Login passwords, Telegram bot tokens, webhook secrets, proxy credentials, Agent token hashes, and subscription access token hashes are not included.'
    },
    inventory: {
      agents: snapshot.agents,
      hosts: snapshot.nodes,
      customerNodes: snapshot.inbounds,
      customers: snapshot.customers,
      forwardingRules: snapshot.forwardRules,
      quotaPolicies: snapshot.quotaPolicies,
      rateLimitPolicies: snapshot.rateLimitPolicies,
      subscriptionSources: snapshot.subscriptionSources,
      subscriptionInventoryNodes: snapshot.subscriptionInventoryNodes,
      subscriptionClients: snapshot.subscriptionClients,
      subscriptionExportProfiles: snapshot.subscriptionExportProfiles,
      routingPolicies: snapshot.routingPolicies,
      tuningProfiles: snapshot.tuningProfiles,
      permissionGrants: snapshot.permissionGrants,
      agentLogRetentionPolicy: snapshot.agentLogRetentionPolicy,
      trafficRollupRetentionPolicy: snapshot.trafficRollupRetentionPolicy
    },
    runtimeEvidence: {
      configRevisions: snapshot.configRevisions,
      preflightPlans: snapshot.preflightPlans,
      runtimeSnapshots: snapshot.runtimeSnapshots,
      failedTasks: snapshot.tasks
        .filter((task) => task.status === 'failed' || Boolean(task.failureReason))
        .map((task) => ({
          id: task.id,
          operation: task.operation,
          resourceType: task.resourceType,
          targetId: task.targetId,
          targetLabel: task.targetLabel,
          status: task.status,
          failureReason: task.failureReason,
          rollbackTaskId: task.rollbackTaskId,
          updatedAt: task.updatedAt
        }))
    },
    audit: {
      logCount: snapshot.auditLogs.length,
      firstLogId: firstAuditLog?.id,
      firstHash: firstAuditLog?.hash,
      latestLogId: latestAuditLog?.id,
      latestHash: latestAuditLog?.hash
    },
    security: {
      agentCredentials: snapshot.agentCredentials,
      operatorSessions,
      telegramBotSettings: {
        id: snapshot.telegramBotSettings.id,
        enabled: snapshot.telegramBotSettings.enabled,
        mode: snapshot.telegramBotSettings.mode,
        botTokenSet: snapshot.telegramBotSettings.botTokenSet,
        botTokenPreview: snapshot.telegramBotSettings.botTokenPreview,
        webhookSecretPathSet: snapshot.telegramBotSettings.webhookSecretPathSet,
        webhookSecretPathPreview: snapshot.telegramBotSettings.webhookSecretPathPreview,
        adminChatIds: snapshot.telegramBotSettings.adminChatIds,
        adminTelegramUserIds: snapshot.telegramBotSettings.adminTelegramUserIds,
        schedules: snapshot.telegramBotSettings.schedules,
        defaultPolicyId: snapshot.telegramBotSettings.defaultPolicyId,
        updatedAt: snapshot.telegramBotSettings.updatedAt,
        updatedBy: snapshot.telegramBotSettings.updatedBy
      },
      telegramBindings: snapshot.telegramBindings,
      telegramNotificationPolicies: snapshot.telegramNotificationPolicies
    }
  });
}

export function createControlPlaneBackupSummary(backup: ControlPlaneBackupPackage): ControlPlaneBackupSummary {
  return {
    inventoryResources:
      backup.inventory.agents.length +
      backup.inventory.hosts.length +
      backup.inventory.customerNodes.length +
      backup.inventory.customers.length +
      backup.inventory.forwardingRules.length +
      backup.inventory.subscriptionClients.length +
      backup.inventory.subscriptionSources.length +
      backup.inventory.routingPolicies.length +
      backup.inventory.tuningProfiles.length +
      backup.inventory.permissionGrants.length,
    runtimeArtifacts:
      backup.runtimeEvidence.configRevisions.length +
      backup.runtimeEvidence.preflightPlans.length +
      backup.runtimeEvidence.runtimeSnapshots.length,
    failedTasks: backup.runtimeEvidence.failedTasks.length,
    auditLogCount: backup.audit.logCount,
    latestAuditHash: backup.audit.latestHash,
    operatorSessionCount: backup.security.operatorSessions.length
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function readArrayFromRecord(record: Record<string, unknown> | undefined, key: string): unknown[] {
  const value = record?.[key];
  return Array.isArray(value) ? value : [];
}

function readIdValues(values: unknown[]) {
  return values.flatMap((value) => {
    const record = asRecord(value);
    const id = record?.id;

    return typeof id === 'string' && id.trim().length > 0 ? [id.trim()] : [];
  });
}

function countBackupInventoryResources(inventory: Record<string, unknown> | undefined) {
  return (
    readArrayFromRecord(inventory, 'agents').length +
    readArrayFromRecord(inventory, 'hosts').length +
    readArrayFromRecord(inventory, 'customerNodes').length +
    readArrayFromRecord(inventory, 'customers').length +
    readArrayFromRecord(inventory, 'forwardingRules').length +
    readArrayFromRecord(inventory, 'subscriptionClients').length +
    readArrayFromRecord(inventory, 'subscriptionSources').length +
    readArrayFromRecord(inventory, 'routingPolicies').length +
    readArrayFromRecord(inventory, 'tuningProfiles').length +
    readArrayFromRecord(inventory, 'permissionGrants').length
  );
}

function countBackupRuntimeArtifacts(runtimeEvidence: Record<string, unknown> | undefined) {
  return (
    readArrayFromRecord(runtimeEvidence, 'configRevisions').length +
    readArrayFromRecord(runtimeEvidence, 'preflightPlans').length +
    readArrayFromRecord(runtimeEvidence, 'runtimeSnapshots').length
  );
}

function collectCurrentControlPlaneResourceIds(snapshot: ControlPlaneSnapshot) {
  return new Set([
    ...snapshot.agents.map((item) => item.id),
    ...snapshot.nodes.map((item) => item.id),
    ...snapshot.inbounds.map((item) => item.id),
    ...snapshot.customers.map((item) => item.id),
    ...snapshot.forwardRules.map((item) => item.id),
    ...snapshot.subscriptionClients.map((item) => item.id),
    ...snapshot.subscriptionSources.map((item) => item.id),
    ...snapshot.routingPolicies.map((item) => item.id),
    ...snapshot.tuningProfiles.map((item) => item.id),
    ...snapshot.permissionGrants.map((item) => item.id)
  ]);
}

function collectBackupInventoryResourceIds(inventory: Record<string, unknown> | undefined) {
  return [
    ...readIdValues(readArrayFromRecord(inventory, 'agents')),
    ...readIdValues(readArrayFromRecord(inventory, 'hosts')),
    ...readIdValues(readArrayFromRecord(inventory, 'customerNodes')),
    ...readIdValues(readArrayFromRecord(inventory, 'customers')),
    ...readIdValues(readArrayFromRecord(inventory, 'forwardingRules')),
    ...readIdValues(readArrayFromRecord(inventory, 'subscriptionClients')),
    ...readIdValues(readArrayFromRecord(inventory, 'subscriptionSources')),
    ...readIdValues(readArrayFromRecord(inventory, 'routingPolicies')),
    ...readIdValues(readArrayFromRecord(inventory, 'tuningProfiles')),
    ...readIdValues(readArrayFromRecord(inventory, 'permissionGrants'))
  ];
}

function containsPotentialBackupSecret(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => containsPotentialBackupSecret(item));
  }

  const record = asRecord(value);
  if (!record) {
    return false;
  }

  return Object.entries(record).some(([key, nestedValue]) => {
    if (isSensitiveBackupField(key)) {
      return true;
    }

    return containsPotentialBackupSecret(nestedValue);
  });
}

function isSensitiveBackupField(key: string): boolean {
  if (/(?:Preview|Set|Enabled|Present)$/i.test(key)) {
    return false;
  }

  return /(password|tokenHash|accessTokenHash|accessTokenRaw|agentToken|botToken|webhookSecretPath|proxyUrl|secret)/i.test(key);
}

function createInvalidBackupPreflightResult(message: string): ControlPlaneBackupPreflightResult {
  return {
    status: 'invalid',
    schemaLabel: 'invalid',
    inventoryResources: 0,
    runtimeArtifacts: 0,
    auditLogCount: 0,
    conflictCount: 0,
    conflictPreview: [],
    redactionPassed: false,
    notes: [message]
  };
}

export function preflightControlPlaneBackupPackage(
  backupText: string,
  snapshot: ControlPlaneSnapshot | undefined
): ControlPlaneBackupPreflightResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(backupText);
  } catch {
    return createInvalidBackupPreflightResult('backup_json.invalid');
  }

  const backup = asRecord(parsed);

  if (!backup || backup.kind !== 'ou-ui-next.control-plane.backup') {
    return createInvalidBackupPreflightResult('backup_kind.invalid');
  }

  const schemaVersion = typeof backup.schemaVersion === 'number' ? backup.schemaVersion : 0;
  const inventory = asRecord(backup.inventory);
  const runtimeEvidence = asRecord(backup.runtimeEvidence);
  const audit = asRecord(backup.audit);
  const restorePlan = asRecord(backup.restorePlan);
  const restoreCommand = typeof restorePlan?.command === 'string' ? restorePlan.command : undefined;
  const backupResourceIds = collectBackupInventoryResourceIds(inventory);
  const currentResourceIds = snapshot ? collectCurrentControlPlaneResourceIds(snapshot) : new Set<string>();
  const conflicts = backupResourceIds.filter((id) => currentResourceIds.has(id));
  const uniqueConflicts = [...new Set(conflicts)];
  const redactionPassed = !containsPotentialBackupSecret(backup);
  const inventoryResources = countBackupInventoryResources(inventory);
  const runtimeArtifacts = countBackupRuntimeArtifacts(runtimeEvidence);
  const auditLogCount = typeof audit?.logCount === 'number' ? audit.logCount : 0;
  const status: ControlPlaneBackupPreflightResult['status'] =
    schemaVersion !== 1 || !restoreCommand || !redactionPassed
      ? 'invalid'
      : uniqueConflicts.length > 0
        ? 'warning'
        : 'ready';
  const notes = [
    ...(schemaVersion === 1 ? ['schema.ok'] : ['schema.unsupported']),
    ...(restoreCommand ? ['restore_command.present'] : ['restore_command.missing']),
    ...(redactionPassed ? ['redaction.ok'] : ['redaction.failed']),
    ...(uniqueConflicts.length > 0 ? ['resource_conflicts.require_confirmation'] : ['resource_conflicts.none'])
  ];

  return {
    status,
    schemaLabel: `Schema v${schemaVersion}`,
    inventoryResources,
    runtimeArtifacts,
    auditLogCount,
    conflictCount: uniqueConflicts.length,
    conflictPreview: uniqueConflicts.slice(0, 8),
    redactionPassed,
    restoreCommand,
    notes
  };
}
