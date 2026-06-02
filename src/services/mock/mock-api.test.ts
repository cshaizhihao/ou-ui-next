import { createMockApi } from './mock-api';
import { AGENT_INSTALL_PROFILE } from '../../domain';

describe('mock API contract', () => {
  it('returns typed Master-to-Any agent and node inventory', async () => {
    const api = createMockApi();

    const agents = await api.listAgents();
    const nodes = await api.listNodes();

    expect(agents[0]).toMatchObject({
      id: 'agent-hkg-01',
      name: '香港入口 Agent',
      status: 'online',
      connectionMode: 'websocket'
    });
    expect(agents[0].capabilities).toEqual(expect.arrayContaining(['xray', 'gost', 'flvx']));
    expect(nodes[0].modules.map((module) => module.kind)).toEqual(expect.arrayContaining(['xray', 'gost', 'flvx']));
  });

  it('generates one-click Agent install commands from the control plane without placeholder domains', async () => {
    const api = createMockApi();

    const command = await api.createAgentInstallCommand({
      hostName: 'edge-custom-01',
      installProfile: [...AGENT_INSTALL_PROFILE],
      publicBaseUrl: 'https://panel.example.com/x7K2mP9vL4qR1wDz'
    });

    expect(command).toMatchObject({
      agentId: 'agent-edge-custom-01',
      masterEndpoint: 'https://panel.example.com/x7K2mP9vL4qR1wDz/agent/v1/poll',
      scriptUrl: 'https://raw.githubusercontent.com/cshaizhihao/ou-ui-next/main/public/install/ou-agent.sh'
    });
    expect(command.installToken).toMatch(/^oit_[a-f0-9]{48}$/);
    expect(command.command).toContain("OU_INSTALL_PROFILE='host-agent,xray,port-forwarding,telemetry,command-channel'");
    expect(command.command).toContain("OU_MASTER='https://panel.example.com/x7K2mP9vL4qR1wDz/agent/v1/poll'");
    expect(command.command).toContain(
      "curl -fsSL 'https://raw.githubusercontent.com/cshaizhihao/ou-ui-next/main/public/install/ou-agent.sh'"
    );
    expect(command.command).not.toContain('master.example.com');
  });

  it('exposes protocol, subscription, forwarding, quota and permission inventories', async () => {
    const api = createMockApi();

    const [
      inbounds,
      subscriptionSources,
      tunnels,
      forwardRules,
      quotaPolicies,
      permissionGrants,
      routingPolicies,
      tuningProfiles,
      subscriptionBundles,
      rateLimitPolicies
    ] =
      await Promise.all([
        api.listInbounds(),
        api.listSubscriptionSources(),
        api.listTunnels(),
        api.listForwardRules(),
        api.listQuotaPolicies(),
        api.listPermissionGrants(),
        api.listRoutingPolicies(),
        api.listTuningProfiles(),
        api.listSubscriptionBundles(),
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
    expect(tunnels[0].chain[0]).toMatchObject({
      agentId: 'agent-hkg-01',
      protocol: 'tcp+udp'
    });
    expect(forwardRules[0]).toMatchObject({
      billingDirection: 'both',
      portStatus: 'allocated'
    });
    expect(quotaPolicies[0]).toMatchObject({
      scope: 'tunnel-account',
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
    expect(rateLimitPolicies[0]).toMatchObject({
      id: 'rate-tunnel-01',
      mode: 'bi-directional'
    });
  });

  it('creates risky operation tasks and appends audit events', async () => {
    const api = createMockApi();

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
    const api = createMockApi();

    const task = await api.createTask({
      operation: 'permission.grant',
      targetId: 'grant-admin-tunnel',
      targetLabel: 'operator:admin → group-premium',
      summary: '提交隧道分组权限变更'
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
    const api = createMockApi();
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
    const api = createMockApi();

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
      {
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
      },
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

  it('exposes the v1 API boundary and preserves mutation request context', async () => {
    const api = createMockApi();

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
    const api = createMockApi();
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
    const api = createMockApi();

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

  it('maintains an append-only audit hash chain and detects exported log tampering', async () => {
    const api = createMockApi();

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
    const api = createMockApi();

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
    const api = createMockApi();

    const task = await api.createTask(
      {
        operation: 'agent.deploy',
        resourceType: 'agent',
        targetId: 'agent-hkg-01',
        targetLabel: 'Agent-A 棣欐腐鍏ュ彛',
        summary: '缂栬瘧骞舵敞鍏?Universal Agent 閰嶇疆'
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

  it('creates mock host-agent commands for managed host profile updates', async () => {
    const api = createMockApi();

    const task = await api.createTask({
      operation: 'agent.update',
      resourceType: 'agent',
      targetId: 'agent-hkg-01',
      targetLabel: 'edge-renamed-01',
      summary: 'Update managed host profile',
      metadata: {
        agentId: 'agent-hkg-01',
        hostName: 'edge-renamed-01',
        maxTrafficGb: 2048
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
  });

  it('fans out multi-host forwarding creation into one mock Agent command per target host', async () => {
    const api = createMockApi();

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
  });

  it('creates mock Xray apply commands for customer node inbound changes', async () => {
    const api = createMockApi();

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
        moduleKind: 'xray'
      })
    ]);
  });

  it('keeps mock multi-host forwarding tasks running until every target Agent reports success', async () => {
    const api = createMockApi();

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
      rollbackAvailable: true
    });
  });

  it('maps module install tasks to module resources when resourceType is omitted', async () => {
    const api = createMockApi();

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
