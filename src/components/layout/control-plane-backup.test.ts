import { describe, expect, it } from 'vitest';
import { createControlPlaneBackupPackage, preflightControlPlaneBackupPackage } from './control-plane-backup';

describe('preflightControlPlaneBackupPackage', () => {
  it('redacts subscription and agent token hashes while generating backup packages', () => {
    const backup = createControlPlaneBackupPackage({
      generatedAt: '2026-06-14T00:00:00.000Z',
      operatorSessions: [],
      runtimeConfig: {
        loginUsername: 'operator',
        controlPlaneMode: 'mock',
        operatorGroupId: 'owner',
        resourceGroupId: 'group-premium'
      } as Parameters<typeof createControlPlaneBackupPackage>[0]['runtimeConfig'],
      snapshot: {
        agents: [],
        nodes: [],
        inbounds: [],
        customers: [],
        forwardRules: [],
        quotaPolicies: [],
        rateLimitPolicies: [],
        subscriptionSources: [],
        subscriptionInventoryNodes: [],
        subscriptionClients: [
          {
            id: 'sub-client-secret',
            displayName: 'Secret Subscription',
            accessTokenHash: `sha256:${'a'.repeat(64)}`,
            accessTokenRaw: 'raw-token-should-not-export',
            tokenHash: 'legacy-token-hash-should-not-export'
          }
        ],
        subscriptionExportProfiles: [],
        routingPolicies: [],
        tuningProfiles: [],
        permissionGrants: [],
        agentLogRetentionPolicy: {},
        trafficRollupRetentionPolicy: {},
        configRevisions: [],
        preflightPlans: [],
        runtimeSnapshots: [],
        tasks: [],
        auditLogs: [],
        agentCredentials: [
          {
            id: 'agent-credential-secret',
            tokenPrefix: 'agent...',
            tokenHash: 'agent-token-hash-should-not-export'
          }
        ],
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
      } as unknown as Parameters<typeof createControlPlaneBackupPackage>[0]['snapshot']
    });
    const backupText = JSON.stringify(backup);

    expect(backup.inventory.subscriptionClients).toEqual([
      expect.objectContaining({
        id: 'sub-client-secret',
        displayName: 'Secret Subscription'
      })
    ]);
    expect(backupText).not.toContain('accessTokenHash');
    expect(backupText).not.toContain('accessTokenRaw');
    expect(backupText).not.toContain('tokenHash');
    expect(backupText).not.toContain('raw-token-should-not-export');
    expect(backupText).not.toContain('agent-token-hash-should-not-export');
  });

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
          'Login passwords, Telegram bot tokens, webhook secrets, proxy credentials, Agent token hashes, and subscription access token hashes are not included.'
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
