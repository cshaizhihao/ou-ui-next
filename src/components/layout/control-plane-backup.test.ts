import { describe, expect, it } from 'vitest';
import { preflightControlPlaneBackupPackage } from './control-plane-backup';

describe('preflightControlPlaneBackupPackage', () => {
  it('accepts the standard redaction summary used by generated backups', () => {
    const backupText = JSON.stringify({
      kind: 'ou-ui-next.control-plane.backup',
      schemaVersion: 1,
      generatedAt: '2026-06-14T00:00:00.000Z',
      generatedBy: {
        loginUsername: 'operator',
        controlPlaneMode: 'mock',
        operatorGroupId: 'owner',
        resourceGroupId: 'group-premium'
      },
      restorePlan: {
        command: 'sudo ou-ui restore-control-plane-backup --stdin',
        includes: ['inventory', 'runtimeEvidence', 'audit', 'security'],
        redaction:
          'Login passwords, Telegram bot tokens, webhook secrets, proxy credentials, and Agent token hashes are not included.'
      },
      inventory: {
        agents: [],
        hosts: [],
        customerNodes: [],
        customers: [],
        forwardingRules: [],
        quotaPolicies: [],
        rateLimitPolicies: [],
        subscriptionSources: [],
        subscriptionInventoryNodes: [],
        subscriptionClients: [],
        subscriptionExportProfiles: [],
        routingPolicies: [],
        tuningProfiles: [],
        permissionGrants: [],
        agentLogRetentionPolicy: {},
        trafficRollupRetentionPolicy: {}
      },
      runtimeEvidence: {
        configRevisions: [],
        preflightPlans: [],
        runtimeSnapshots: [],
        failedTasks: []
      },
      audit: {
        logCount: 0
      },
      security: {
        agentCredentials: [],
        operatorSessions: [],
        telegramBotSettings: {
          id: 'telegram-bot-settings',
          enabled: false,
          mode: 'disabled',
          botTokenSet: false,
          botTokenPreview: 'bot_***',
          webhookSecretPathSet: false,
          webhookSecretPathPreview: '/tmp/***',
          adminChatIds: [],
          adminTelegramUserIds: [],
          schedules: [],
          defaultPolicyId: 'telegram-policy-default',
          updatedAt: '2026-06-14T00:00:00.000Z',
          updatedBy: 'system'
        },
        telegramBindings: [],
        telegramNotificationPolicies: []
      }
    });

    const result = preflightControlPlaneBackupPackage(backupText, undefined);

    expect(result.status).toBe('ready');
    expect(result.redactionPassed).toBe(true);
    expect(result.notes).toContain('redaction.ok');
  });

  it('rejects backups that still contain password or secret fields', () => {
    const backupText = JSON.stringify({
      kind: 'ou-ui-next.control-plane.backup',
      schemaVersion: 1,
      generatedAt: '2026-06-14T00:00:00.000Z',
      generatedBy: {
        loginUsername: 'operator',
        controlPlaneMode: 'mock',
        operatorGroupId: 'owner',
        resourceGroupId: 'group-premium'
      },
      restorePlan: {
        command: 'sudo ou-ui restore-control-plane-backup --stdin',
        includes: ['inventory', 'runtimeEvidence', 'audit', 'security'],
        redaction: 'redacted'
      },
      inventory: {
        agents: [],
        hosts: [],
        customerNodes: [],
        customers: [],
        forwardingRules: [],
        quotaPolicies: [],
        rateLimitPolicies: [],
        subscriptionSources: [],
        subscriptionInventoryNodes: [],
        subscriptionClients: [],
        subscriptionExportProfiles: [],
        routingPolicies: [],
        tuningProfiles: [],
        permissionGrants: [],
        agentLogRetentionPolicy: {},
        trafficRollupRetentionPolicy: {}
      },
      runtimeEvidence: {
        configRevisions: [],
        preflightPlans: [],
        runtimeSnapshots: [],
        failedTasks: []
      },
      audit: {
        logCount: 0
      },
      security: {
        agentCredentials: [],
        operatorSessions: [],
        telegramBotSettings: {
          id: 'telegram-bot-settings',
          enabled: false,
          mode: 'disabled',
          botTokenSet: false,
          webhookSecretPathSet: false,
          adminChatIds: [],
          adminTelegramUserIds: [],
          schedules: [],
          defaultPolicyId: 'telegram-policy-default',
          updatedAt: '2026-06-14T00:00:00.000Z',
          updatedBy: 'system'
        },
        telegramBindings: [],
        telegramNotificationPolicies: [],
        databasePassword: 'hunter2',
        apiSecret: 'topsecret'
      }
    });

    const result = preflightControlPlaneBackupPackage(backupText, undefined);

    expect(result.status).toBe('invalid');
    expect(result.redactionPassed).toBe(false);
    expect(result.notes).toContain('redaction.failed');
  });
});
