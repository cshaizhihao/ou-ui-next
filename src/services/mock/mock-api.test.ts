import { createMockApi } from './mock-api';
import { AGENT_INSTALL_PROFILE, type CreateTaskInput } from '../../domain';

function withRiskConfirmation<T extends CreateTaskInput>(
  input: T
): T & { riskConfirmation: NonNullable<CreateTaskInput['riskConfirmation']> } {
  return {
    ...input,
    riskConfirmation: {
      operation: input.operation,
      targetId: input.targetId
    }
  };
}

describe('mock API contract', () => {
  it('returns typed Master-to-Any agent and node inventory', async () => {
    const api = createMockApi({ seedInventory: true, readModelNow: () => '2026-06-02T00:00:00.000Z' });

    const agents = await api.listAgents();
    const nodes = await api.listNodes();

    expect(agents[0]).toMatchObject({
      id: 'agent-hkg-01',
      name: '香港入口 Agent',
      status: 'online',
      connectionMode: 'websocket',
      monthlyTrafficLimitBytes: 800 * 1024 * 1024 * 1024,
      expiresAt: '2026-09-08T23:59:59.000Z',
      probeConfig: expect.objectContaining({
        pingTarget: '1.1.1.1',
        pingIntervalSeconds: 30
      }),
      trafficPolicy: expect.objectContaining({
        accountingMode: 'both',
        monthlyResetDay: 1,
        telemetrySource: 'agent'
      }),
      hardware: expect.objectContaining({
        cpuModel: 'AMD EPYC 7B13',
        primaryNetworkInterface: 'eth0'
      }),
      telemetry: expect.objectContaining({
        memoryUsedBytes: 1720 * 1024 * 1024,
        memoryTotalBytes: 4096 * 1024 * 1024,
        diskUsedBytes: 49 * 1024 * 1024 * 1024,
        diskTotalBytes: 128 * 1024 * 1024 * 1024,
        uploadSpeedBps: 20_190,
        downloadSpeedBps: 24_530,
        monthlyIngressBytes: 260 * 1024 * 1024 * 1024,
        monthlyEgressBytes: 122 * 1024 * 1024 * 1024,
        monthlyTrafficUsedBytes: 382 * 1024 * 1024 * 1024,
        latencySamplesMs: expect.any(Array),
        packetLossSamplesPercent: expect.any(Array),
        onlineDays: 15,
        reportedAt: '2026-06-02T00:00:00.000Z',
        sampleGapDetected: false,
        expectedSamplingIntervalSeconds: 30
      })
    });
    expect(agents[0].capabilities).toEqual(expect.arrayContaining(['xray', 'gost', 'port-forwarding']));
    expect(nodes[0].modules.map((module) => module.kind)).toEqual(expect.arrayContaining(['xray', 'gost', 'port-forwarding']));
  });

  it('can start with an empty inventory for fresh installations', async () => {
    const api = createMockApi({ seedInventory: false });

    await expect(api.listAgents()).resolves.toEqual([]);
    await expect(api.listNodes()).resolves.toEqual([]);
    await expect(api.listInbounds()).resolves.toEqual([]);
    await expect(api.listForwardRules()).resolves.toEqual([]);
  });

  it('defaults to an empty inventory so accidental mock fallback never shows fake hosts', async () => {
    const api = createMockApi();

    await expect(api.listAgents()).resolves.toEqual([]);
    await expect(api.listNodes()).resolves.toEqual([]);
  });

  it('does not synthesize a demo Agent command when a task has no explicit host target', async () => {
    const api = createMockApi({ seedInventory: false });

    await expect(
      api.createTask({
        operation: 'system.tune',
        targetId: 'tuning-bbr-default',
        targetLabel: 'BBR tuning',
        summary: 'Apply tuning without selected managed host'
      })
    ).rejects.toMatchObject({
      code: 'agent_target.required'
    });
    await expect(api.listCommandOutbox()).resolves.toEqual([]);
    await expect(api.listConfigRevisions()).resolves.toEqual([]);
  });

  it('generates one-click Agent install commands from the control plane without placeholder domains', async () => {
    const api = createMockApi({ seedInventory: true });

    const command = await api.createAgentInstallCommand({
      installProfile: [...AGENT_INSTALL_PROFILE],
      publicBaseUrl: 'https://panel.example.com/x7K2mP9vL4qR1wDz'
    });

    expect(command).toMatchObject({
      masterEndpoint: 'https://panel.example.com/x7K2mP9vL4qR1wDz/agent/v1/poll',
      scriptUrl: 'https://raw.githubusercontent.com/cshaizhihao/ou-ui-next/main/public/install/ou-agent.sh'
    });
    expect(command.agentId).toMatch(/^agent-[a-f0-9]{12}$/);
    expect(command.installToken).toMatch(/^oit_[a-f0-9]{48}$/);
    expect(command.command).toContain("OU_MASTER='https://panel.example.com/x7K2mP9vL4qR1wDz/agent/v1/poll'");
    expect(command.command).not.toContain('OU_HOST_NAME=');
    expect(command.command).not.toContain('OU_INSTALL_PROFILE=');
    expect(command.command).toContain(
      "curl -fsSL 'https://raw.githubusercontent.com/cshaizhihao/ou-ui-next/main/public/install/ou-agent.sh'"
    );
    expect(command.command).not.toContain('master.example.com');
    await expect(api.listAgentCredentials()).resolves.toEqual([
      expect.objectContaining({
        agentId: command.agentId,
        purpose: 'install',
        status: 'active'
      })
    ]);
    const registration = await api.registerAgent(
      {
        agentId: command.agentId,
        requestId: 'req-mock-agent-register',
        sessionId: 'sess-mock-agent-register',
        version: '1.2.3-agent',
        platform: 'linux-x64',
        capabilities: [...AGENT_INSTALL_PROFILE]
      },
      command.installToken
    );

    expect(registration).toEqual(
      expect.objectContaining({
        agentId: command.agentId,
        sessionId: 'sess-mock-agent-register'
      })
    );
    await expect(api.listAgents()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: command.agentId,
          status: 'provisioning',
          version: '1.2.3-agent',
          platform: 'linux-x64',
          capabilities: expect.arrayContaining(['host-agent', 'xray', 'port-forwarding'])
        })
      ])
    );
    await expect(api.listAgentCredentials()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agentId: command.agentId,
          purpose: 'runtime',
          metadata: expect.objectContaining({
            registrationVersion: '1.2.3-agent',
            registrationPlatform: 'linux-x64',
            registrationCapabilities: ['host-agent', 'xray', 'port-forwarding', 'telemetry', 'command-channel']
          })
        })
      ])
    );
    await expect(api.listAuditLogs()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'agent.credential.issued',
          operation: 'agent.credential.issue',
          resourceType: 'agent',
          targetId: command.agentId,
          after: expect.objectContaining({
            credential: expect.objectContaining({
              agentId: command.agentId
            })
          })
        })
      ])
    );
    expect(JSON.stringify(await api.listAgentCredentials())).not.toContain(command.installToken);
    expect(JSON.stringify(await api.listAuditLogs())).not.toContain(command.installToken);
  });

  it('denies one-click Agent install command issuance without Agent configure permission', async () => {
    const api = createMockApi({ seedInventory: false });

    await expect(
      api.createAgentInstallCommand(
        {
          installProfile: [...AGENT_INSTALL_PROFILE],
          publicBaseUrl: 'https://panel.example.com/x7K2mP9vL4qR1wDz'
        },
        {
          actor: 'operator:viewer',
          operatorGroupId: 'ops-viewer',
          resourceGroupId: 'group-premium',
          sourceIp: '203.0.113.55',
          requestId: 'req-mock-agent-install-denied',
          idempotencyKey: 'idem-mock-agent-install-denied'
        }
      )
    ).rejects.toMatchObject({
      code: 'permission.denied'
    });

    await expect(api.listAgentCredentials()).resolves.toEqual([]);
    await expect(api.listAuditLogs()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'audit.denied',
          operation: 'agent.credential.issue',
          resourceType: 'agent',
          requestId: 'req-mock-agent-install-denied',
          denialCode: 'permission.denied'
        })
      ])
    );
  });

  it('prevents idempotent Agent install command replays in the mock control plane', async () => {
    const api = createMockApi({ seedInventory: false });
    const input = {
      installProfile: [...AGENT_INSTALL_PROFILE],
      publicBaseUrl: 'https://panel.example.com/x7K2mP9vL4qR1wDz'
    };
    const context = {
      actor: 'admin',
      operatorGroupId: 'owner',
      resourceGroupId: 'group-premium',
      sourceIp: '203.0.113.56',
      requestId: 'req-mock-agent-install-idempotent',
      idempotencyKey: 'idem-mock-agent-install-idempotent'
    };

    const command = await api.createAgentInstallCommand(input, context);

    await expect(api.createAgentInstallCommand(input, context)).rejects.toMatchObject({
      code: 'idempotency.replay_unavailable'
    });
    await expect(
      api.createAgentInstallCommand(
        {
          ...input,
          publicBaseUrl: 'https://panel.example.com/anotherSecurePath'
        },
        context
      )
    ).rejects.toMatchObject({
      code: 'idempotency.conflict'
    });
    await expect(api.listAgentCredentials()).resolves.toEqual([
      expect.objectContaining({
        agentId: command.agentId,
        purpose: 'install',
        status: 'active'
      })
    ]);
    await expect(api.listAuditLogs()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'audit.denied',
          operation: 'agent.credential.issue',
          requestId: 'req-mock-agent-install-idempotent',
          denialCode: 'idempotency.conflict'
        }),
        expect.objectContaining({
          action: 'agent.credential.issued',
          operation: 'agent.credential.issue',
          targetId: command.agentId
        })
      ])
    );
    expect(JSON.stringify(await api.listAuditLogs())).not.toContain(command.installToken);
  });

  it('exposes protocol, subscription, forwarding, quota and permission inventories', async () => {
    const api = createMockApi({ seedInventory: true });

    const [
      inbounds,
      subscriptionSources,
      forwardRules,
      quotaPolicies,
      permissionGrants,
      routingPolicies,
      tuningProfiles,
      subscriptionBundles,
      subscriptionClients,
      rateLimitPolicies
    ] =
      await Promise.all([
        api.listInbounds(),
        api.listSubscriptionSources(),
        api.listForwardRules(),
        api.listQuotaPolicies(),
        api.listPermissionGrants(),
        api.listRoutingPolicies(),
        api.listTuningProfiles(),
        api.listSubscriptionBundles(),
        api.listSubscriptionClients(),
        api.listRateLimitPolicies()
      ]);

    expect(inbounds[0]).toMatchObject({
      id: 'inbound-vless-hkg-443',
      protocol: 'vless',
      listenPort: 443,
      status: 'enabled'
    });
    expect(inbounds[0].clients[0]).toMatchObject({
      email: 'ops-hkg',
      ipLimit: 3
    });

    expect(subscriptionSources[0]).toMatchObject({
      kind: 'mihomo-provider',
      status: 'synced'
    });
    expect('listTunnels' in api).toBe(false);
    expect(forwardRules[0]).toMatchObject({
      billingDirection: 'both',
      portStatus: 'allocated'
    });
    expect(quotaPolicies[0]).toMatchObject({
      scope: 'forwarding-account',
      enforcementState: 'active'
    });
    expect(permissionGrants[0].permissions).toEqual(expect.arrayContaining(['read', 'operate', 'configure']));
    expect(routingPolicies[0]).toMatchObject({
      action: 'direct',
      targetGroup: 'DIRECT'
    });
    expect(tuningProfiles[0]).toMatchObject({
      target: 'kernel',
      riskLevel: 'medium'
    });
    expect(subscriptionBundles[0]).toMatchObject({
      id: 'sub-global-premium',
      strategy: 'balanced',
      dedupe: true
    });
    expect(subscriptionClients[0]).toMatchObject({
      id: 'sub-client-acme-hkg',
      subId: 'sub_acme_hkg_premium',
      sourceIds: ['source-mihomo-hkg'],
      formats: ['plain', 'clash', 'mihomo']
    });
    expect(rateLimitPolicies[0]).toMatchObject({
      id: 'rate-forwarding-01',
      mode: 'bi-directional'
    });
  });

  it('persists imported subscription sources into the mock read model', async () => {
    const api = createMockApi({ seedInventory: true });

    await api.createTask({
      operation: 'subscription.import',
      resourceType: 'subscription',
      targetId: 'source-custom-hkg',
      targetLabel: 'Custom HKG Source',
      summary: 'Import custom subscription source',
      metadata: {
        sourceId: 'source-custom-hkg',
        kind: 'clash',
        name: 'Custom HKG Source',
        url: 'https://provider.example.com/hkg.yaml',
        userAgent: 'OU-UI-Next/1.0',
        refreshIntervalMinutes: 45,
        includeFilter: 'premium|streaming',
        excludeFilter: 'expired|test',
        dedupeKey: 'uuid'
      }
    });

    await expect(api.listSubscriptionSources()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'source-custom-hkg',
          kind: 'clash',
          name: 'Custom HKG Source',
          url: 'https://provider.example.com/hkg.yaml',
          status: 'syncing',
          dedupeKey: 'uuid',
          includeFilter: 'premium|streaming',
          excludeFilter: 'expired|test',
          refreshIntervalMinutes: 45,
          userAgent: 'OU-UI-Next/1.0'
        })
      ])
    );
    await expect(api.listProxyProviders()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'provider-source-custom-hkg',
          externalSubscriptionId: 'source-custom-hkg',
          filter: 'premium|streaming',
          excludeFilter: 'expired|test',
          processMode: 'server'
        })
      ])
    );
    await expect(api.syncSubscriptionSource('source-custom-hkg')).resolves.toMatchObject({
      status: 'warning',
      warnings: ['subscription_source.mock_sync_has_no_remote_fetch']
    });
    await expect(api.listAuditLogs()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'subscription.source.synced',
          operation: 'subscription.sync',
          targetId: 'source-custom-hkg',
          result: 'succeeded',
          severity: 'warning'
        })
      ])
    );
  });

  it('projects subscription bundles from imported source read models in mock mode', async () => {
    const api = createMockApi({ seedInventory: false });

    await api.createTask({
      operation: 'subscription.import',
      resourceType: 'subscription',
      targetId: 'source-runtime-hkg',
      targetLabel: 'Runtime HKG Source',
      summary: 'Import runtime-backed source',
      metadata: {
        sourceId: 'source-runtime-hkg',
        kind: 'clash',
        name: 'Runtime HKG Source',
        url: 'https://provider.example.com/runtime-hkg.yaml',
        refreshIntervalMinutes: 45,
        dedupeKey: 'server-port'
      }
    });

    await expect(api.listSubscriptionBundles()).resolves.toEqual([
      expect.objectContaining({
        id: 'sub-global-premium',
        sources: [expect.objectContaining({ id: 'source-runtime-hkg', nodeCount: 0, status: 'warning' })],
        generatedNodeCount: 0,
        healthScore: 80
      })
    ]);
  });

  it('deletes subscription sources and their inventory nodes through mock task read models', async () => {
    const api = createMockApi({ seedInventory: true });

    await api.createTask(withRiskConfirmation({
      operation: 'subscription.delete',
      resourceType: 'subscription',
      targetId: 'source-mihomo-hkg',
      targetLabel: 'Hong Kong Premium Source',
      summary: 'Delete external subscription source',
      metadata: {
        sourceId: 'source-mihomo-hkg'
      }
    }));

    await expect(api.listSubscriptionSources()).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'source-mihomo-hkg' })])
    );
    await expect(api.listSubscriptionInventoryNodes()).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceId: 'source-mihomo-hkg' })])
    );
  });

  it('persists generated client subscription rules into the mock read model', async () => {
    const api = createMockApi({ seedInventory: true });

    await api.createTask({
      operation: 'subscription.generate',
      resourceType: 'subscription',
      targetId: 'sub-client-custom-hkg',
      targetLabel: '客户自定义香港订阅',
      summary: '创建客户订阅规则',
      metadata: {
        subscriptionClientId: 'sub-client-custom-hkg',
        displayName: '客户自定义香港订阅',
        subId: 'sub_custom_hkg',
        email: 'customer@example.com',
        protocol: 'trojan',
        group: 'premium',
        trafficLimitGb: 512,
        usedTrafficGb: 64,
        remainingDays: 45,
        ipLimit: 2,
        sourceIds: ['source-mihomo-hkg'],
        selectedTags: ['premium'],
        includeFilter: '香港|HK',
        excludeFilter: 'test|expired',
        regionFilter: ['hk'],
        routingRule: 'tag:premium AND !tag:test',
        maxLatencyMs: 180,
        sortStrategy: 'latency',
        formats: ['plain', 'mihomo'],
        templateName: 'mihomo-compatible.yaml',
        enabled: true,
        generatedNodeCount: 6
      }
    });

    await expect(api.listSubscriptionClients()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'sub-client-custom-hkg',
          displayName: '客户自定义香港订阅',
          protocol: 'trojan',
          sourceIds: ['source-mihomo-hkg'],
          regionFilter: ['hk'],
          maxLatencyMs: 180,
          generatedNodeCount: 0,
          formats: ['plain', 'mihomo']
        })
      ])
    );
    await expect(api.listSubscriptionExportFiles()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'export-sub-client-custom-hkg',
          selectedProviderIds: ['provider-source-mihomo-hkg'],
          formats: ['plain', 'mihomo']
        })
      ])
    );

    await api.createTask(withRiskConfirmation({
      operation: 'subscription.delete',
      resourceType: 'subscription',
      targetId: 'sub-client-custom-hkg',
      targetLabel: '客户自定义香港订阅',
      summary: '删除客户订阅规则',
      metadata: {
        subscriptionClientId: 'sub-client-custom-hkg'
      }
    }));

    await expect(api.listSubscriptionClients()).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'sub-client-custom-hkg' })])
    );
  });

  it('projects mock subscription usage from selected Xray clients instead of static task metadata', async () => {
    const api = createMockApi({ seedInventory: true });

    await api.createTask({
      operation: 'subscription.generate',
      resourceType: 'subscription',
      targetId: 'sub-client-ops-hkg-runtime',
      targetLabel: 'Ops HKG Runtime Subscription',
      summary: 'Create runtime-backed subscription rule',
      metadata: {
        subscriptionClientId: 'sub-client-ops-hkg-runtime',
        displayName: 'Ops HKG Runtime Subscription',
        subId: 'sub_ops_hkg_runtime',
        email: 'ops-hkg',
        protocol: 'vless',
        group: 'premium',
        trafficLimitGb: 512,
        usedTrafficGb: 1,
        remainingDays: 45,
        sourceIds: [],
        selectedTags: [],
        routingRule: '',
        formats: ['plain', 'clash'],
        generatedNodeCount: 99
      }
    });

    await expect(api.listSubscriptionClients()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'sub-client-ops-hkg-runtime',
          usedTrafficBytes: 1.2 * 1024 * 1024 * 1024 * 1024,
          generatedNodeCount: 1
        })
      ])
    );
  });

  it('creates risky operation tasks and appends audit events', async () => {
    const api = createMockApi({ seedInventory: true });

    const task = await api.createTask({
      operation: 'agent.deploy',
      resourceType: 'agent',
      targetId: 'agent-hkg-01',
      targetLabel: 'Agent-A 香港入口',
      summary: '编译并注入 Universal Agent 配置'
    });

    expect(task).toMatchObject({
      operation: 'agent.deploy',
      resourceType: 'agent',
      resourceId: 'agent-hkg-01',
      status: 'queued',
      rollbackAvailable: false
    });

    await api.transitionTask(task.id, 'running');
    await api.transitionTask(task.id, 'succeeded');

    const tasks = await api.listTasks();
    const auditLogs = await api.listAuditLogs();

    expect(tasks.find((item) => item.id === task.id)?.status).toBe('succeeded');
    expect(auditLogs.map((log) => log.action)).toEqual(
      expect.arrayContaining(['task.created', 'task.running', 'task.succeeded'])
    );
    expect(auditLogs[0]).toMatchObject({
      actor: 'admin',
      targetId: 'agent-hkg-01',
      resourceType: 'agent',
      result: 'succeeded',
      severity: 'info'
    });
  });

  it('classifies permission grant tasks for the permission approval pipeline', async () => {
    const api = createMockApi({ seedInventory: true });

    const task = await api.createTask({
      operation: 'permission.grant',
      targetId: 'grant-admin-tunnel',
      targetLabel: 'operator:admin → group-premium',
      summary: '提交转发分组权限变更'
    });

    expect(task).toMatchObject({
      operation: 'permission.grant',
      resourceType: 'permission',
      resourceId: 'grant-admin-tunnel',
      status: 'queued'
    });

    const auditLogs = await api.listAuditLogs();

    expect(auditLogs[0]).toMatchObject({
      operation: 'permission.grant',
      resourceType: 'permission',
      result: 'accepted',
      targetLabel: 'operator:admin → group-premium'
    });
  });

  it('enforces permission grant guardrails and writes denied audit for overreach', async () => {
    const api = createMockApi({ seedInventory: true });
    const initialGrants = await api.listPermissionGrants();

    await expect(
      api.createTask(
        {
          operation: 'permission.grant',
          targetId: 'grant-ops-premium-configure',
          targetLabel: 'group:ops-hkg -> group-premium',
          summary: 'Grant configure permission to ops-hkg',
          permissionChange: {
            subjectType: 'group',
            subjectId: 'ops-hkg',
            resourceType: 'tunnel-group',
            resourceId: 'group-premium',
            permissions: ['configure'],
            reason: 'handoff premium tunnel operations'
          }
        },
        {
          actor: 'operator:bob',
          operatorGroupId: 'ops-viewer',
          resourceGroupId: 'group-premium',
          sourceIp: '203.0.113.20',
          requestId: 'req-permission-overreach'
        }
      )
    ).rejects.toThrow('permission.denied');

    expect(await api.listPermissionGrants()).toEqual(initialGrants);
    expect((await api.listAuditLogs())[0]).toMatchObject({
      action: 'audit.denied',
      result: 'denied',
      actor: 'operator:bob',
      operatorGroupId: 'ops-viewer',
      resourceGroupId: 'group-premium',
      targetId: 'grant-ops-premium-configure',
      denialCode: 'permission.denied'
    });

    const acceptedTask = await api.createTask(
      {
        operation: 'permission.grant',
        targetId: 'grant-ops-premium-operate',
        targetLabel: 'group:ops-hkg -> group-premium',
        summary: 'Grant operate permission to ops-hkg',
        permissionChange: {
          subjectType: 'group',
          subjectId: 'ops-hkg',
          resourceType: 'tunnel-group',
          resourceId: 'group-premium',
          permissions: ['read', 'operate'],
          reason: 'handoff premium tunnel operations'
        }
      },
      {
        actor: 'admin',
        operatorGroupId: 'owner',
        resourceGroupId: 'group-premium',
        sourceIp: '203.0.113.10',
        requestId: 'req-permission-allowed'
      }
    );

    expect(acceptedTask).toMatchObject({
      operation: 'permission.grant',
      status: 'queued'
    });
    expect(await api.listPermissionGrants()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'grant-ops-premium-operate',
          subjectType: 'group',
          subjectId: 'ops-hkg',
          resourceId: 'group-premium',
          permissions: ['read', 'operate'],
          grantedBy: 'admin',
          reason: 'handoff premium tunnel operations'
        })
      ])
    );
  });

  it('revokes permission grants and excludes revoked grants from mock authorization', async () => {
    const api = createMockApi({ seedInventory: true });

    await api.createTask(
      {
        operation: 'permission.grant',
        targetId: 'grant-ops-premium-operate',
        targetLabel: 'group:ops-hkg -> group-premium',
        summary: 'Grant operate permission to ops-hkg',
        permissionChange: {
          subjectType: 'group',
          subjectId: 'ops-hkg',
          resourceType: 'tunnel-group',
          resourceId: 'group-premium',
          permissions: ['read', 'operate'],
          reason: 'handoff premium tunnel operations'
        }
      },
      {
        actor: 'admin',
        operatorGroupId: 'owner',
        resourceGroupId: 'group-premium',
        sourceIp: '203.0.113.10',
        requestId: 'req-mock-permission-grant-before-revoke'
      }
    );

    await expect(
      api.createTask(
        {
          operation: 'forward.pause',
          targetId: 'forward-hkg-443',
          targetLabel: 'Port Forwarding Fabric',
          summary: 'Pause forwarding before mock permission revoke'
        },
        {
          actor: 'operator:bob',
          operatorGroupId: 'ops-hkg',
          resourceGroupId: 'group-premium',
          sourceIp: '203.0.113.20',
          requestId: 'req-mock-ops-hkg-before-revoke'
        }
      )
    ).resolves.toMatchObject({
      operation: 'forward.pause',
      status: 'queued'
    });

    await api.createTask(
      withRiskConfirmation({
        operation: 'permission.revoke',
        targetId: 'grant-ops-premium-operate',
        targetLabel: 'group:ops-hkg -> group-premium',
        summary: 'Revoke operate permission from ops-hkg',
        permissionChange: {
          subjectType: 'group',
          subjectId: 'ops-hkg',
          resourceType: 'tunnel-group',
          resourceId: 'group-premium',
          permissions: ['read', 'operate'],
          reason: 'ops-hkg offboarding'
        }
      }),
      {
        actor: 'admin',
        operatorGroupId: 'owner',
        resourceGroupId: 'group-premium',
        sourceIp: '203.0.113.10',
        requestId: 'req-mock-permission-revoke'
      }
    );

    expect(await api.listPermissionGrants()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'grant-ops-premium-operate',
          revokedAt: expect.any(String),
          revokedBy: 'admin',
          revokedReason: 'ops-hkg offboarding'
        })
      ])
    );

    await expect(
      api.createTask(
        {
          operation: 'forward.pause',
          targetId: 'forward-hkg-443',
          targetLabel: 'Port Forwarding Fabric',
          summary: 'Pause forwarding after mock permission revoke'
        },
        {
          actor: 'operator:bob',
          operatorGroupId: 'ops-hkg',
          resourceGroupId: 'group-premium',
          sourceIp: '203.0.113.20',
          requestId: 'req-mock-ops-hkg-after-revoke'
        }
      )
    ).rejects.toThrow('permission.denied');
  });

  it('keeps the final administrative permission path from being revoked in mock mode', async () => {
    const api = createMockApi({ seedInventory: false });

    await expect(
      api.createTask(
        withRiskConfirmation({
          operation: 'permission.revoke',
          targetId: 'grant-admin-tunnel',
          targetLabel: 'user:admin -> group-premium',
          summary: 'Revoke redundant user owner permission path',
          permissionChange: {
            subjectType: 'user',
            subjectId: 'admin',
            resourceType: 'tunnel-group',
            resourceId: 'group-premium',
            permissions: ['read', 'operate', 'configure', 'grant'],
            reason: 'owner user path replaced by owner group'
          }
        }),
        {
          actor: 'admin',
          operatorGroupId: 'owner',
          resourceGroupId: 'group-premium',
          sourceIp: '203.0.113.10',
          requestId: 'req-mock-permission-revoke-redundant-admin'
        }
      )
    ).resolves.toMatchObject({
      operation: 'permission.revoke',
      status: 'queued'
    });

    await expect(
      api.createTask(
        withRiskConfirmation({
          operation: 'permission.revoke',
          targetId: 'grant-owner-group-tunnel',
          targetLabel: 'group:owner -> group-premium',
          summary: 'Attempt to revoke final owner permission path',
          permissionChange: {
            subjectType: 'group',
            subjectId: 'owner',
            resourceType: 'tunnel-group',
            resourceId: 'group-premium',
            permissions: ['read', 'operate', 'configure', 'grant'],
            reason: 'dangerous owner offboarding'
          }
        }),
        {
          actor: 'admin',
          operatorGroupId: 'owner',
          resourceGroupId: 'group-premium',
          sourceIp: '203.0.113.10',
          requestId: 'req-mock-permission-revoke-final-admin'
        }
      )
    ).rejects.toMatchObject({
      code: 'permission_grant.last_admin_path',
      details: expect.objectContaining({
        denialReason: 'Permission revoke would remove the last administrative grant path for this resource.'
      })
    });

    const ownerGroupGrant = (await api.listPermissionGrants()).find((grant) => grant.id === 'grant-owner-group-tunnel');

    expect(ownerGroupGrant).toEqual(expect.objectContaining({ id: 'grant-owner-group-tunnel' }));
    expect(ownerGroupGrant?.revokedAt).toBeUndefined();
    await expect(api.listAuditLogs()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'audit.denied',
          denialCode: 'permission_grant.last_admin_path',
          targetId: 'grant-owner-group-tunnel'
        })
      ])
    );
  });

  it('exposes the v1 API boundary and preserves mutation request context', async () => {
    const api = createMockApi({ seedInventory: true });

    await expect(api.getApiBoundary()).resolves.toMatchObject({
      version: 'v1',
      restBasePath: '/api/v1',
      eventStreamPath: '/events/v1',
      agentStreamPath: '/agent/v1',
      supportsIdempotency: true,
      taskTransitions: {
        queued: ['running', 'failed', 'canceled'],
        succeeded: ['rolled_back']
      }
    });

    const task = await api.createTask(
      {
        operation: 'forward.apply',
        targetId: 'forward-hkg-443',
        targetLabel: 'Port Forwarding Fabric',
        summary: '应用端口转发策略'
      },
      {
        actor: 'sre:alice',
        sourceIp: '203.0.113.10',
        requestId: 'req-v1-forward-apply',
        idempotencyKey: 'idem-forward-apply'
      }
    );

    const duplicate = await api.createTask(
      {
        operation: 'forward.apply',
        targetId: 'forward-hkg-443',
        targetLabel: 'Port Forwarding Fabric',
        summary: '应用端口转发策略'
      },
      {
        actor: 'sre:alice',
        sourceIp: '203.0.113.10',
        requestId: 'req-v1-forward-apply',
        idempotencyKey: 'idem-forward-apply'
      }
    );

    const auditLogs = await api.listAuditLogs();

    expect(duplicate.id).toBe(task.id);
    expect(task).toMatchObject({
      actor: 'sre:alice',
      requestedBy: 'sre:alice',
      requestId: 'req-v1-forward-apply',
      idempotencyKey: 'idem-forward-apply'
    });
    expect(auditLogs[0]).toMatchObject({
      actor: 'sre:alice',
      sourceIp: '203.0.113.10',
      requestId: 'req-v1-forward-apply'
    });
  });

  it('rejects idempotency replay with a different request body and writes denied audit', async () => {
    const api = createMockApi({ seedInventory: true });
    const context = {
      actor: 'admin',
      operatorGroupId: 'owner',
      resourceGroupId: 'group-premium',
      sourceIp: '203.0.113.10',
      requestId: 'req-v1-idempotency-conflict',
      idempotencyKey: 'idem-forward-conflict'
    };

    const acceptedTask = await api.createTask(
      {
        operation: 'forward.apply',
        targetId: 'forward-hkg-443',
        targetLabel: 'Port Forwarding Fabric',
        summary: 'Apply baseline port forwarding policy'
      },
      context
    );

    await expect(
      api.createTask(
        {
          operation: 'forward.apply',
          targetId: 'forward-hkg-443',
          targetLabel: 'Port Forwarding Fabric',
          summary: 'Apply conflicting port forwarding policy'
        },
        context
      )
    ).rejects.toThrow('idempotency.conflict');

    const tasks = await api.listTasks();
    const auditLogs = await api.listAuditLogs();

    expect(tasks.map((task) => task.id)).toEqual([acceptedTask.id]);
    expect(auditLogs[0]).toMatchObject({
      action: 'audit.denied',
      result: 'denied',
      actor: 'admin',
      operatorGroupId: 'owner',
      resourceGroupId: 'group-premium',
      requestId: 'req-v1-idempotency-conflict',
      targetId: 'forward-hkg-443',
      denialCode: 'idempotency.conflict'
    });
    expect(auditLogs[0].requestBodyHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(auditLogs[0].before).toEqual(
      expect.objectContaining({
        existingTaskId: acceptedTask.id,
        requestBodyHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/)
      })
    );
    expect(auditLogs[0].after).toEqual(
      expect.objectContaining({
        requestBodyHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/)
      })
    );
  });

  it('rejects stale If-Match resource versions before task creation and writes denied audit', async () => {
    const api = createMockApi({ seedInventory: true });

    await expect(
      api.createTask(
        {
          operation: 'forward.apply',
          targetId: 'forward-hkg-443',
          targetLabel: 'Port Forwarding Fabric',
          summary: 'Apply stale forwarding policy revision'
        },
        {
          actor: 'sre:alice',
          operatorGroupId: 'owner',
          resourceGroupId: 'group-premium',
          sourceIp: '203.0.113.10',
          requestId: 'req-forward-stale-version',
          ifMatch: 'forward-version-stale'
        }
      )
    ).rejects.toThrow('resource_version.conflict');

    expect(await api.listTasks()).toHaveLength(0);
    expect((await api.listAuditLogs())[0]).toMatchObject({
      action: 'audit.denied',
      result: 'denied',
      denialCode: 'resource_version.conflict',
      actor: 'sre:alice',
      operatorGroupId: 'owner',
      resourceGroupId: 'group-premium',
      targetId: 'forward-hkg-443',
      before: {
        expectedResourceVersion: 'forward-version-stale'
      },
      after: {
        currentResourceVersion: 'forward-forward-hkg-443-v1'
      }
    });
  });

  it('requires matching high-risk confirmation in mock mode', async () => {
    const api = createMockApi({ seedInventory: true });
    const input: CreateTaskInput = {
      operation: 'agent.delete',
      resourceType: 'agent',
      targetId: 'agent-hkg-01',
      targetLabel: 'Agent-A 香港入口',
      summary: '移除受控主机'
    };

    await expect(
      api.createTask(input, {
        actor: 'admin',
        operatorGroupId: 'owner',
        resourceGroupId: 'group-premium',
        sourceIp: '203.0.113.10',
        requestId: 'req-mock-high-risk-missing'
      })
    ).rejects.toMatchObject({
      code: 'high_risk_confirmation.required'
    });

    await expect(
      api.createTask(
        {
          ...input,
          riskConfirmation: {
            operation: 'agent.rollback',
            targetId: 'agent-hkg-01'
          }
        },
        {
          actor: 'admin',
          operatorGroupId: 'owner',
          resourceGroupId: 'group-premium',
          sourceIp: '203.0.113.10',
          requestId: 'req-mock-high-risk-operation-mismatch'
        }
      )
    ).rejects.toMatchObject({
      code: 'high_risk_confirmation.required'
    });

    await expect(
      api.createTask(
        {
          ...input,
          riskConfirmation: {
            operation: 'agent.delete',
            targetId: 'agent-sin-02'
          }
        },
        {
          actor: 'admin',
          operatorGroupId: 'owner',
          resourceGroupId: 'group-premium',
          sourceIp: '203.0.113.10',
          requestId: 'req-mock-high-risk-target-mismatch'
        }
      )
    ).rejects.toMatchObject({
      code: 'high_risk_confirmation.required'
    });

    await expect(
      api.createTask(withRiskConfirmation(input), {
        actor: 'admin',
        operatorGroupId: 'owner',
        resourceGroupId: 'group-premium',
        sourceIp: '203.0.113.10',
        requestId: 'req-mock-high-risk-confirmed'
      })
    ).resolves.toMatchObject({
      operation: 'agent.delete',
      status: 'queued'
    });

    const auditLogs = await api.listAuditLogs();
    expect(auditLogs.filter((log) => log.action === 'audit.denied')).toHaveLength(3);
    expect(auditLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'audit.denied',
          denialCode: 'high_risk_confirmation.required',
          operation: 'agent.delete',
          targetId: 'agent-hkg-01'
        }),
        expect.objectContaining({
          action: 'task.created',
          operation: 'agent.delete',
          targetId: 'agent-hkg-01'
        })
      ])
    );
  });

  it('maintains an append-only audit hash chain and detects exported log tampering', async () => {
    const api = createMockApi({ seedInventory: true });

    const task = await api.createTask({
      operation: 'agent.deploy',
      resourceType: 'agent',
      targetId: 'agent-hkg-01',
      targetLabel: 'Agent-A HKG Gateway',
      summary: 'Deploy Universal Agent configuration'
    });

    await api.transitionTask(task.id, 'running');
    await api.transitionTask(task.id, 'succeeded');

    const auditLogs = await api.listAuditLogs();

    expect(auditLogs).toHaveLength(3);
    auditLogs.forEach((log, index) => {
      expect(log.hash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(log.prevHash).toMatch(/^sha256:[a-f0-9]{64}$/);

      if (index < auditLogs.length - 1) {
        expect(log.prevHash).toBe(auditLogs[index + 1].hash);
      }
    });
    await expect(api.verifyAuditLogChain()).resolves.toMatchObject({
      valid: true,
      checked: 3
    });

    const tamperedAuditLogs = auditLogs.map((log, index) =>
      index === 1 ? { ...log, actor: 'intruder:mallory' } : log
    );

    await expect(api.verifyAuditLogChain(tamperedAuditLogs)).resolves.toMatchObject({
      valid: false,
      brokenAt: auditLogs[1].id,
      reason: 'hash.mismatch'
    });
  });

  it('enforces the deploy task state machine and records before/after transitions', async () => {
    const api = createMockApi({ seedInventory: true });

    const task = await api.createTask({
      operation: 'agent.deploy',
      resourceType: 'agent',
      targetId: 'agent-hkg-01',
      targetLabel: 'Agent-A 香港入口',
      summary: '编译并注入 Universal Agent 配置'
    });

    await api.transitionTask(task.id, 'running');
    await api.transitionTask(task.id, 'succeeded');

    await expect(api.transitionTask(task.id, 'running')).rejects.toThrow('Invalid task transition: succeeded -> running');

    const auditLogs = await api.listAuditLogs();

    expect(auditLogs[0]).toMatchObject({
      action: 'task.succeeded',
      before: { status: 'running' },
      after: { status: 'succeeded', resourceId: 'agent-hkg-01' }
    });
    expect(auditLogs[1]).toMatchObject({
      action: 'task.running',
      before: { status: 'queued' },
      after: { status: 'running', resourceId: 'agent-hkg-01' }
    });
  });

  it('creates command outbox entries and lets Agent ACK/result events drive task state', async () => {
    const api = createMockApi({ seedInventory: true });

    const task = await api.createTask(
      {
        operation: 'agent.deploy',
        resourceType: 'agent',
        targetId: 'agent-hkg-01',
        targetLabel: 'Agent-A 香港入口',
        summary: '编译并注入 Universal Agent 配置'
      },
      {
        actor: 'sre:alice',
        sourceIp: '203.0.113.10',
        requestId: 'req-v1-agent-deploy',
        idempotencyKey: 'idem-agent-deploy'
      }
    );

    const [outboxItem] = await api.listCommandOutbox();
    const configRevision = outboxItem.command.type === 'apply' ? outboxItem.command.payload.configRevision : '';

    expect(outboxItem).toMatchObject({
      taskId: task.id,
      agentId: 'agent-hkg-01',
      status: 'pending',
      command: {
        type: 'apply',
        requestId: 'req-v1-agent-deploy',
        taskId: task.id,
        agentId: 'agent-hkg-01'
      }
    });
    expect(configRevision).toMatch(/^cfg-/);

    await api.receiveAgentEvent({
      type: 'ack',
      eventId: 'evt-agent-ack-001',
      commandId: outboxItem.commandId,
      taskId: task.id,
      agentId: 'agent-hkg-01',
      seq: outboxItem.seq + 1,
      sessionId: 'sess-agent-hkg-01',
      observedAt: '2026-06-02T00:00:05.000Z',
      payload: {
        duplicate: false
      }
    });

    expect((await api.listTasks()).find((item) => item.id === task.id)?.status).toBe('running');
    expect((await api.listCommandOutbox())[0]).toMatchObject({
      status: 'acknowledged',
      ackedAt: '2026-06-02T00:00:05.000Z'
    });

    await api.receiveAgentEvent({
      type: 'result',
      eventId: 'evt-agent-result-001',
      commandId: outboxItem.commandId,
      taskId: task.id,
      agentId: 'agent-hkg-01',
      seq: outboxItem.seq + 2,
      sessionId: 'sess-agent-hkg-01',
      observedAt: '2026-06-02T00:00:25.000Z',
      payload: {
        status: 'succeeded',
        appliedConfigRevision: configRevision,
        healthSummary: {
          runtime: 'healthy',
          probe: 'xray config version matched'
        }
      }
    });

    const tasks = await api.listTasks();
    const auditLogs = await api.listAuditLogs();

    expect(tasks.find((item) => item.id === task.id)).toMatchObject({
      status: 'succeeded',
      rollbackAvailable: true
    });
    expect((await api.listCommandOutbox())[0]).toMatchObject({
      status: 'completed',
      resultAt: '2026-06-02T00:00:25.000Z'
    });
    expect(auditLogs.map((log) => log.action)).toEqual(
      expect.arrayContaining(['task.created', 'task.running', 'task.succeeded'])
    );
  });

  it('fails mock Agent results that report the wrong applied config revision', async () => {
    const api = createMockApi({ seedInventory: true });

    const task = await api.createTask(
      {
        operation: 'agent.deploy',
        resourceType: 'agent',
        targetId: 'agent-hkg-01',
        targetLabel: 'Agent-A 香港入口',
        summary: '编译并注入 Universal Agent 配置'
      },
      {
        actor: 'sre:alice',
        sourceIp: '203.0.113.10',
        requestId: 'req-v1-agent-deploy-revision-mismatch',
        idempotencyKey: 'idem-agent-deploy-revision-mismatch'
      }
    );
    const [outboxItem] = await api.listCommandOutbox();
    const configRevision = outboxItem.command.type === 'apply' ? outboxItem.command.payload.configRevision : '';

    await api.receiveAgentEvent({
      type: 'ack',
      eventId: 'evt-agent-revision-mismatch-ack',
      commandId: outboxItem.commandId,
      taskId: task.id,
      agentId: 'agent-hkg-01',
      seq: outboxItem.seq + 1,
      sessionId: 'sess-agent-hkg-01',
      observedAt: '2026-06-02T00:00:05.000Z',
      payload: {
        duplicate: false
      }
    });

    await expect(
      api.receiveAgentEvent({
        type: 'result',
        eventId: 'evt-agent-revision-mismatch-result',
        commandId: outboxItem.commandId,
        taskId: task.id,
        agentId: 'agent-hkg-01',
        seq: outboxItem.seq + 2,
        sessionId: 'sess-agent-hkg-01',
        observedAt: '2026-06-02T00:00:25.000Z',
        payload: {
          status: 'succeeded',
          appliedConfigRevision: 'cfg-unexpected-runtime',
          healthSummary: {
            runtime: 'healthy'
          }
        }
      })
    ).resolves.toMatchObject({
      id: task.id,
      status: 'failed',
      failureReason: expect.stringContaining('agent_result.config_revision_mismatch')
    });

    await expect(api.listCommandOutbox()).resolves.toEqual([
      expect.objectContaining({
        status: 'failed',
        lastError: expect.stringContaining(`expected=${configRevision}`)
      })
    ]);
    await expect(api.listPreflightPlans()).resolves.toEqual([
      expect.objectContaining({
        status: 'failed',
        checks: expect.arrayContaining([
          expect.objectContaining({ id: 'result-verification', status: 'failed' })
        ])
      })
    ]);
  });

  it('creates mock host-agent commands for managed host profile updates', async () => {
    const api = createMockApi({ seedInventory: true });

    const task = await api.createTask({
      operation: 'agent.update',
      resourceType: 'agent',
      targetId: 'agent-hkg-01',
      targetLabel: 'edge-renamed-01',
      summary: 'Update managed host profile',
      metadata: {
        agentId: 'agent-hkg-01',
        hostName: 'edge-renamed-01',
        maxTrafficGb: 2048,
        monthlyTrafficGb: 512,
        trafficAccountingMode: 'egress',
        monthlyResetDay: 7,
        currentUsedTrafficGb: 256,
        expiresAt: '2026-12-31T23:59:59.000Z',
        pingTarget: 'www.cloudflare.com',
        pingIntervalSeconds: 30
      }
    });

    const [outboxItem] = await api.listCommandOutbox();

    expect(outboxItem).toMatchObject({
      taskId: task.id,
      agentId: 'agent-hkg-01',
      command: {
        type: 'apply',
        payload: expect.objectContaining({
          moduleKind: 'host-agent',
          configRevision: `cfg-${task.id}`
        })
      }
    });
    await expect(api.listConfigRevisions()).resolves.toEqual([
      expect.objectContaining({
        taskId: task.id,
        agentId: 'agent-hkg-01',
        moduleKind: 'host-agent',
        artifact: expect.objectContaining({
          artifactVersion: 'ou-ui.runtime.host-agent.v1',
          action: 'update_host_profile',
          hostProfile: expect.objectContaining({
            displayName: 'edge-renamed-01',
            hostName: 'agent-hkg-01',
            maxTrafficGb: 2048,
            monthlyTrafficGb: 512,
            monthlyTrafficLimitBytes: 512 * 1024 * 1024 * 1024,
            trafficPolicy: expect.objectContaining({
              accountingMode: 'egress',
              monthlyResetDay: 7,
              manualUsedTrafficGb: 256,
              manualUsedTrafficBytes: 256 * 1024 * 1024 * 1024
            }),
            expiresAt: '2026-12-31T23:59:59.000Z'
          }),
          probeConfig: expect.objectContaining({
            pingTarget: 'www.cloudflare.com',
            pingIntervalSeconds: 30,
            latencyGreenMaxMs: 100,
            latencyYellowMaxMs: 200
          }),
          telemetryPlan: expect.objectContaining({
            source: 'agent',
            sampleIntervalSeconds: 30,
            pingProbe: expect.objectContaining({
              target: 'www.cloudflare.com',
              intervalSeconds: 30
            }),
            trafficCounters: expect.objectContaining({
              accountingMode: 'egress',
              counterDirections: ['egress'],
              monthlyResetDay: 7,
              manualUsedTrafficBytes: 256 * 1024 * 1024 * 1024
            }),
            hardwareProbe: expect.objectContaining({
              enabled: true,
              fields: expect.arrayContaining(['cpu', 'memory', 'disk', 'network'])
            })
          })
        })
      })
    ]);
    await expect(api.listAgents()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'agent-hkg-01',
          name: 'edge-renamed-01',
          maxTrafficBytes: 2048 * 1024 * 1024 * 1024,
          monthlyTrafficLimitBytes: 512 * 1024 * 1024 * 1024,
          trafficPolicy: expect.objectContaining({
            accountingMode: 'egress',
            monthlyResetDay: 7,
            manualUsedTrafficBytes: 256 * 1024 * 1024 * 1024
          }),
          expiresAt: '2026-12-31T23:59:59.000Z',
          probeConfig: expect.objectContaining({
            pingTarget: 'www.cloudflare.com',
            pingIntervalSeconds: 30
          })
        })
      ])
    );
  });

  it('updates agent traffic and hardware read models from telemetry samples', async () => {
    const api = createMockApi({ seedInventory: true, readModelNow: () => '2026-06-02T00:01:00.000Z' });

    await api.receiveAgentEvent({
      type: 'telemetry_sample',
      eventId: 'evt-agent-hkg-telemetry-001',
      agentId: 'agent-hkg-01',
      seq: 101,
      sessionId: 'sess-agent-hkg-01',
      observedAt: '2026-06-02T00:01:00.000Z',
      payload: {
        cpuPercent: 29,
        monthlyIngressBytes: 300 * 1024 * 1024 * 1024,
        monthlyEgressBytes: 140 * 1024 * 1024 * 1024,
        uploadSpeedBps: 22_400,
        downloadSpeedBps: 31_200,
        latencyMs: 58,
        packetLossPercent: 0.4,
        cpuModel: 'AMD EPYC 7B13',
        kernelVersion: '6.8.0-36-generic',
        virtualization: 'KVM',
        primaryNetworkInterface: 'eth0',
        trafficTelemetrySource: 'agent',
        hardwareTelemetrySource: 'agent',
        reportedAt: '2026-06-02T00:01:00.000Z',
        hardwareDetectedAt: '2026-06-02T00:01:00.000Z'
      }
    });

    await expect(api.listAgents()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'agent-hkg-01',
          hardware: expect.objectContaining({
            kernelVersion: '6.8.0-36-generic',
            primaryNetworkInterface: 'eth0'
          }),
          telemetry: expect.objectContaining({
            cpuPercent: 29,
            monthlyIngressBytes: 300 * 1024 * 1024 * 1024,
            monthlyEgressBytes: 140 * 1024 * 1024 * 1024,
            monthlyTrafficUsedBytes: 440 * 1024 * 1024 * 1024,
            downloadSpeedBps: 31_200,
            latencyMs: 58,
            reportedAt: '2026-06-02T00:01:00.000Z',
            sampleGapDetected: false,
            sampleGapSeconds: 0
          })
        })
      ])
    );
    await expect(api.listTrafficRollups()).resolves.toEqual([
      expect.objectContaining({
        id: 'traffic-evt-agent-hkg-telemetry-001-agent',
        dimension: 'agent',
        subjectId: 'agent-hkg-01',
        ingressBytes: 300 * 1024 * 1024 * 1024,
        egressBytes: 140 * 1024 * 1024 * 1024,
        meteredBytes: 440 * 1024 * 1024 * 1024,
        source: 'agent-telemetry'
      })
    ]);
  });

  it('fans out multi-host forwarding creation into one mock Agent command per target host', async () => {
    const api = createMockApi({ seedInventory: true });

    const task = await api.createTask({
      operation: 'forward.create',
      resourceType: 'forward',
      targetId: 'forward-custom-2443',
      targetLabel: '多主机端口转发 2443',
      summary: '创建多主机端口转发',
      metadata: {
        name: 'mock forward',
        ownerName: 'Customer A',
        tunnelId: 'tunnel-relay-hkg',
        listenAddress: '0.0.0.0',
        listenPort: 2443,
        targetAddress: '172.20.8.10',
        targetPort: 9443,
        protocol: 'tcp+udp',
        agentIds: ['agent-hkg-01', 'agent-sin-02'],
        strategy: 'round-robin',
        quotaGb: 1024,
        rateLimitMbps: 600,
        billingDirection: 'single',
        monthlyResetDay: 15,
        currentUsedTrafficGb: 33.5,
        tunnelMode: 'direct'
      }
    });

    const outbox = await api.listCommandOutbox();

    expect(outbox).toHaveLength(2);
    expect(outbox).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: task.id,
          agentId: 'agent-hkg-01',
          commandId: `cmd-${task.id}-agent-hkg-01`
        }),
        expect.objectContaining({
          taskId: task.id,
          agentId: 'agent-sin-02',
          commandId: `cmd-${task.id}-agent-sin-02`
        })
      ])
    );
    await expect(api.listConfigRevisions()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `cfg-${task.id}-agent-hkg-01`,
          agentId: 'agent-hkg-01',
          moduleKind: 'port-forwarding',
          artifact: expect.objectContaining({
            artifactVersion: 'ou-ui.runtime.port-forwarding.v1',
            rule: expect.objectContaining({
              name: 'mock forward',
              ownerName: 'Customer A',
              protocol: 'tcp+udp',
              entryAgentIds: ['agent-hkg-01', 'agent-sin-02'],
              binding: expect.objectContaining({
                agentId: 'agent-hkg-01',
                listenAddress: '0.0.0.0',
                listenPort: 2443,
                targetAddress: '172.20.8.10',
                targetPort: 9443
              }),
              limits: expect.objectContaining({
                quotaGb: 1024,
                monthlyResetDay: 15,
                manualUsedTrafficGb: 33.5,
                manualUsedTrafficBytes: 33.5 * 1024 * 1024 * 1024,
                rateLimitMbps: 600
              }),
              billing: expect.objectContaining({
                direction: 'single'
              }),
              proxyProtocol: false
            }),
            servicePlan: expect.objectContaining({
              bind: '0.0.0.0:2443',
              upstream: '172.20.8.10:9443'
            })
          })
        })
      ])
    );
  });

  it('dispatches executable tunnel tasks as real port-forwarding artifacts', async () => {
    const api = createMockApi({ seedInventory: true });

    const task = await api.createTask({
      operation: 'tunnel.create',
      resourceType: 'tunnel',
      targetId: 'tunnel-customer-a',
      targetLabel: 'Customer A forwarding tunnel',
      summary: 'Create customer forwarding tunnel',
      metadata: {
        name: 'Customer A forwarding tunnel',
        accountId: 'acct-customer-a',
        type: 'port-forward',
        protocol: 'tcp+udp',
        entryAgentIds: ['agent-hkg-01'],
        exitAgentIds: ['agent-sin-02'],
        listenAddress: '0.0.0.0',
        listenPort: 2443,
        targetAddress: '172.20.8.10',
        targetPort: 9443,
        quotaGb: 1024,
        billingDirection: 'both'
      }
    });

    await expect(api.listCommandOutbox()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: task.id,
          agentId: 'agent-hkg-01',
          commandId: `cmd-${task.id}-agent-hkg-01`
        })
      ])
    );
    await expect(api.listCommandOutbox()).resolves.not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: task.id,
          agentId: 'agent-sin-02'
        })
      ])
    );
    await expect(api.listConfigRevisions()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `cfg-${task.id}-agent-hkg-01`,
          agentId: 'agent-hkg-01',
          moduleKind: 'port-forwarding',
          artifact: expect.objectContaining({
            artifactVersion: 'ou-ui.runtime.port-forwarding.v1',
            rule: expect.objectContaining({
              name: 'Customer A forwarding tunnel',
              ownerName: 'acct-customer-a',
              binding: expect.objectContaining({
                listenPort: 2443,
                targetAddress: '172.20.8.10',
                targetPort: 9443
              }),
              tunnel: expect.objectContaining({
                type: 'port-forward',
                entryAgentIds: ['agent-hkg-01'],
                exitAgentIds: ['agent-sin-02']
              })
            }),
            servicePlan: expect.objectContaining({
              serviceName: 'ou-tunnel-tunnel-customer-a-agent-hkg-01',
              bind: '0.0.0.0:2443',
              upstream: '172.20.8.10:9443'
            })
          })
        })
      ])
    );
  });

  it('rejects runtime tasks that cannot resolve a target Agent instead of leaving them queued', async () => {
    const api = createMockApi({ seedInventory: true });

    await expect(
      api.createTask({
        operation: 'forward.apply',
        resourceType: 'forward',
        targetId: 'forward-missing-target',
        targetLabel: 'Missing forwarding target',
        summary: 'Apply missing forwarding target'
      })
    ).rejects.toMatchObject({
      code: 'agent_target.required'
    });

    await expect(api.listTasks()).resolves.not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetId: 'forward-missing-target'
        })
      ])
    );
    await expect(api.listAuditLogs()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'audit.denied',
          denialCode: 'agent_target.required',
          targetId: 'forward-missing-target'
        })
      ])
    );
  });

  it('persists customer Xray inbound create and delete tasks into the mock read model', async () => {
    const api = createMockApi({ seedInventory: true });

    await api.createTask({
      operation: 'inbound.create',
      resourceType: 'inbound',
      targetId: 'customer-node-read-model',
      targetLabel: '客户节点读模型',
      summary: '创建客户 Xray 入站',
      metadata: {
        agentId: 'agent-hkg-01',
        customerNodeName: '客户节点读模型',
        customerName: 'Read Model Customer',
        serverAddress: 'edge.example.com',
        xrayProtocol: 'trojan',
        listenPort: 8443,
        clientIdentity: 'trojan-read-model-secret',
        streamNetwork: 'tcp',
        security: 'tls',
        sni: 'edge.example.com',
        path: '/read-model',
        ipLimit: 2,
        trafficLimitGb: 256,
        remainingDays: 14,
        subscriptionRule: 'tag:read-model'
      }
    });

    await expect(api.listInbounds()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'customer-node-read-model',
          agentId: 'agent-hkg-01',
          label: '客户节点读模型',
          customerName: 'Read Model Customer',
          protocol: 'trojan',
          listenPort: 8443,
          subscriptionRule: 'tag:read-model',
          clients: [
            expect.objectContaining({
              id: 'trojan-read-model-secret',
              trafficLimitBytes: 256 * 1024 * 1024 * 1024,
              ipLimit: 2
            })
          ]
        })
      ])
    );

    await api.createTask(withRiskConfirmation({
      operation: 'inbound.delete',
      resourceType: 'inbound',
      targetId: 'customer-node-read-model',
      targetLabel: '客户节点读模型',
      summary: '删除客户 Xray 入站',
      metadata: {
        agentId: 'agent-hkg-01',
        customerNodeName: '客户节点读模型'
      }
    }));

    await expect(api.listInbounds()).resolves.not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'customer-node-read-model'
        })
      ])
    );
  });

  it('persists port forwarding create and delete tasks into the mock read model', async () => {
    const api = createMockApi({ seedInventory: true });
    const readExpectedConfigRevision = (item: Awaited<ReturnType<typeof api.listCommandOutbox>>[number]) => {
      if (item.command.type === 'apply' || item.command.type === 'reload') {
        return item.command.payload.configRevision;
      }

      if (item.command.type === 'rollback') {
        return item.command.payload.targetConfigRevision;
      }

      return undefined;
    };
    const completeAgentCommands = async (taskId: string, eventPrefix: string) => {
      const outbox = (await api.listCommandOutbox())
        .filter((item) => item.taskId === taskId)
        .sort((left, right) => left.seq - right.seq);

      expect(outbox.length).toBeGreaterThan(0);

      for (const [index, item] of outbox.entries()) {
        const sessionId = `sess-${eventPrefix}-${item.agentId}`;
        const appliedConfigRevision = readExpectedConfigRevision(item);
        const ackObservedAt = new Date(Date.parse(item.deadlineAt) - 30_000 + index * 1000).toISOString();
        const resultObservedAt = new Date(Date.parse(item.deadlineAt) - 15_000 + index * 1000).toISOString();

        await api.receiveAgentEvent({
          type: 'ack',
          eventId: `evt-${eventPrefix}-${item.agentId}-ack`,
          commandId: item.commandId,
          taskId,
          agentId: item.agentId,
          seq: item.seq + 1,
          sessionId,
          observedAt: ackObservedAt,
          payload: {
            duplicate: false
          }
        });
        await api.receiveAgentEvent({
          type: 'result',
          eventId: `evt-${eventPrefix}-${item.agentId}-result`,
          commandId: item.commandId,
          taskId,
          agentId: item.agentId,
          seq: item.seq + 2,
          sessionId,
          observedAt: resultObservedAt,
          payload: {
            status: 'succeeded',
            ...(appliedConfigRevision ? { appliedConfigRevision } : {}),
            healthSummary: {
              runtime: 'healthy'
            }
          }
        });
      }
    };

    const createTask = await api.createTask({
      operation: 'forward.create',
      resourceType: 'forward',
      targetId: 'forward-read-model-2443',
      targetLabel: '读模型端口转发 2443',
      summary: '创建多主机端口转发',
      metadata: {
        name: '读模型端口转发 2443',
        ownerName: 'Read Model Customer',
        tunnelId: 'tunnel-relay-hkg',
        listenAddress: '0.0.0.0',
        listenPort: 2443,
        targetAddress: '172.20.8.10',
        targetPort: 9443,
        protocol: 'tcp+udp',
        entryNodeIds: ['agent-hkg-01', 'agent-sin-02'],
        strategy: 'round-robin',
        quotaGb: 1024,
        rateLimitMbps: 600,
        billingDirection: 'both',
        monthlyResetDay: 9,
        currentUsedTrafficGb: 12,
        tunnelMode: 'direct'
      }
    });

    await expect(api.listForwardRules()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'forward-read-model-2443',
          name: '读模型端口转发 2443',
          ownerName: 'Read Model Customer',
          billingDirection: 'both',
          monthlyResetDay: 9,
          manualUsedBytes: 12 * 1024 * 1024 * 1024,
          quotaBytes: 1024 * 1024 * 1024 * 1024,
          rateLimitMbps: 600,
          portStatus: 'deploying',
          ports: expect.arrayContaining([
            expect.objectContaining({
              agentId: 'agent-hkg-01',
              listenPort: 2443,
              targetAddress: '172.20.8.10',
              targetPort: 9443,
              protocol: 'tcp+udp'
            }),
            expect.objectContaining({
              agentId: 'agent-sin-02',
              listenPort: 2443
            })
          ])
        })
      ])
    );

    await expect(api.transitionTask(createTask.id, 'succeeded')).rejects.toMatchObject({
      code: 'agent_result.required'
    });
    await completeAgentCommands(createTask.id, 'mock-forward-create-read-model');
    await expect(api.listForwardRules()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'forward-read-model-2443',
          portStatus: 'allocated',
          ports: expect.arrayContaining([
            expect.objectContaining({
              agentId: 'agent-hkg-01',
              status: 'allocated'
            })
          ])
        })
      ])
    );

    const deleteTask = await api.createTask(withRiskConfirmation({
      operation: 'forward.delete',
      resourceType: 'forward',
      targetId: 'forward-read-model-2443',
      targetLabel: '读模型端口转发 2443',
      summary: '删除端口转发规则',
      metadata: {
        entryNodeIds: ['agent-hkg-01', 'agent-sin-02'],
        listenPort: 2443,
        targetAddress: '172.20.8.10',
        targetPort: 9443
      }
    }));

    await expect(api.listForwardRules()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'forward-read-model-2443',
          portStatus: 'releasing'
        })
      ])
    );

    await completeAgentCommands(deleteTask.id, 'mock-forward-delete-read-model');
    await expect(api.listForwardRules()).resolves.not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'forward-read-model-2443'
        })
      ])
    );
  });

  it('creates mock Xray apply commands for customer node inbound changes', async () => {
    const api = createMockApi({ seedInventory: true });

    const task = await api.createTask({
      operation: 'inbound.create',
      resourceType: 'inbound',
      targetId: 'customer-node-premium-01',
      targetLabel: 'Premium customer node',
      summary: 'Create customer Xray inbound',
      metadata: {
        nodeId: 'node-hkg-01',
        agentId: 'agent-sin-02',
        customerNodeName: 'Premium HK 01',
        customerName: 'Customer A',
        serverAddress: 'edge.example.com',
        xrayProtocol: 'vless',
        listenPort: 443,
        clientIdentity: 'customer-a-main',
        streamNetwork: 'ws',
        security: 'tls',
        sni: 'edge.example.com',
        path: '/customer-a',
        flow: 'xtls-rprx-vision',
        ipLimit: 3,
        trafficLimitGb: 500,
        remainingDays: 30,
        subscriptionRule: 'tag:premium-hkg'
      }
    });

    const [outboxItem] = await api.listCommandOutbox();

    expect(outboxItem).toMatchObject({
      taskId: task.id,
      agentId: 'agent-sin-02',
      command: {
        type: 'apply',
        agentId: 'agent-sin-02',
        payload: expect.objectContaining({
          moduleKind: 'xray',
          configRevision: `cfg-${task.id}`
        })
      }
    });
    await expect(api.listConfigRevisions()).resolves.toEqual([
      expect.objectContaining({
        taskId: task.id,
        agentId: 'agent-sin-02',
        moduleKind: 'xray',
        artifact: expect.objectContaining({
          artifactVersion: 'ou-ui.runtime.xray-inbound.v1',
          operation: 'inbound.create',
          action: 'upsert_inbound',
          customer: expect.objectContaining({
            name: 'Customer A',
            nodeName: 'Premium HK 01',
            subscriptionRule: 'tag:premium-hkg'
          }),
          clientPolicy: expect.objectContaining({
            clientIdentity: 'customer-a-main',
            ipLimit: 3,
            trafficLimitGb: 500
          }),
          xray: expect.objectContaining({
            inbound: expect.objectContaining({
              port: 443,
              protocol: 'vless',
              settings: expect.objectContaining({
                clients: [
                  expect.objectContaining({
                    email: 'customer-a-main@ou-ui.local',
                    flow: 'xtls-rprx-vision'
                  })
                ],
                decryption: 'none'
              }),
              streamSettings: expect.objectContaining({
                network: 'ws',
                security: 'tls'
              })
            })
          }),
          subscription: expect.objectContaining({
            serverAddress: 'edge.example.com',
            shareUri: expect.stringMatching(/^vless:\/\/.+@edge\.example\.com:443\?/)
          })
        })
      })
    ]);
  });

  it('keeps mock multi-host forwarding tasks running until every target Agent reports success', async () => {
    const api = createMockApi({ seedInventory: true });

    const task = await api.createTask({
      operation: 'forward.create',
      resourceType: 'forward',
      targetId: 'forward-custom-2443',
      targetLabel: '多主机端口转发 2443',
      summary: '创建多主机端口转发',
      metadata: {
        listenPort: 2443,
        targetAddress: '172.20.8.10',
        targetPort: 9443,
        agentIds: ['agent-hkg-01', 'agent-sin-02']
      }
    });
    const outbox = await api.listCommandOutbox();
    const hkgCommand = outbox.find((item) => item.agentId === 'agent-hkg-01');
    const sinCommand = outbox.find((item) => item.agentId === 'agent-sin-02');

    expect(hkgCommand).toBeDefined();
    expect(sinCommand).toBeDefined();

    await expect(api.transitionTask(task.id, 'running')).resolves.toMatchObject({
      id: task.id,
      status: 'running'
    });
    await expect(api.transitionTask(task.id, 'succeeded')).rejects.toMatchObject({
      code: 'agent_result.required'
    });

    await api.receiveAgentEvent({
      type: 'ack',
      eventId: 'evt-mock-forward-hkg-ack',
      commandId: hkgCommand!.commandId,
      taskId: task.id,
      agentId: 'agent-hkg-01',
      seq: hkgCommand!.seq + 1,
      sessionId: 'sess-mock-hkg-forward',
      observedAt: '2026-06-02T00:00:05.000Z',
      payload: {
        duplicate: false
      }
    });
    await api.receiveAgentEvent({
      type: 'ack',
      eventId: 'evt-mock-forward-sin-ack',
      commandId: sinCommand!.commandId,
      taskId: task.id,
      agentId: 'agent-sin-02',
      seq: sinCommand!.seq + 1,
      sessionId: 'sess-mock-sin-forward',
      observedAt: '2026-06-02T00:00:06.000Z',
      payload: {
        duplicate: false
      }
    });

    await expect(
      api.receiveAgentEvent({
        type: 'result',
        eventId: 'evt-mock-forward-hkg-result',
        commandId: hkgCommand!.commandId,
        taskId: task.id,
        agentId: 'agent-hkg-01',
        seq: hkgCommand!.seq + 2,
        sessionId: 'sess-mock-hkg-forward',
        observedAt: '2026-06-02T00:00:25.000Z',
        payload: {
          status: 'succeeded',
          appliedConfigRevision: hkgCommand!.command.type === 'apply' ? hkgCommand!.command.payload.configRevision : '',
          healthSummary: {
            runtime: 'healthy'
          }
        }
      })
    ).resolves.toMatchObject({
      id: task.id,
      status: 'running'
    });

    await expect(
      api.receiveAgentEvent({
        type: 'result',
        eventId: 'evt-mock-forward-sin-result',
        commandId: sinCommand!.commandId,
        taskId: task.id,
        agentId: 'agent-sin-02',
        seq: sinCommand!.seq + 2,
        sessionId: 'sess-mock-sin-forward',
        observedAt: '2026-06-02T00:00:30.000Z',
        payload: {
          status: 'succeeded',
          appliedConfigRevision: sinCommand!.command.type === 'apply' ? sinCommand!.command.payload.configRevision : '',
          healthSummary: {
            runtime: 'healthy'
          }
        }
      })
    ).resolves.toMatchObject({
      id: task.id,
      status: 'succeeded',
      rollbackAvailable: true,
      metadata: {
        runtimeDeployment: expect.objectContaining({
          source: 'agent-result',
          agentIds: ['agent-hkg-01', 'agent-sin-02'],
          commandIds: [hkgCommand!.commandId, sinCommand!.commandId]
        })
      }
    });
  });

  it('maps module install tasks to module resources when resourceType is omitted', async () => {
    const api = createMockApi({ seedInventory: true });

    const task = await api.createTask({
      operation: 'module.install',
      targetId: 'module-xray-hkg-01',
      targetLabel: 'Xray Protocol Runtime',
      summary: '安装 Xray Runtime 模块'
    });

    const auditLogs = await api.listAuditLogs();

    expect(task.resourceType).toBe('module');
    expect(auditLogs[0]).toMatchObject({
      operation: 'module.install',
      resourceType: 'module',
      scope: 'control-plane:module'
    });
  });
});
