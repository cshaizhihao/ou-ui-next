import { describe, expect, it } from 'vitest';
import { createTaskRequestSchema } from '../../services/api/api-contract';
import type { ForwardingCreateMetadata, ForwardingRuleView } from './forwarding-page';
import {
  createForwardingDeleteIdempotencyKey,
  createForwardingDeleteTaskInput,
  createForwardingIdempotencyKey,
  createForwardingMetadataFromRule,
  createForwardingRunTaskInput,
  createForwardingTargetId,
  createForwardingUpsertTaskInput
} from './forwarding-task-inputs';

const createMetadata: ForwardingCreateMetadata = {
  name: 'Acme HTTPS relay',
  ownerName: 'Acme',
  tunnelId: 'tunnel-acme',
  listenAddress: '0.0.0.0',
  listenPort: 2443,
  targetAddress: '10.0.0.10',
  targetPort: 443,
  protocol: 'tcp',
  entryNodeIds: ['agent-hkg-01'],
  strategy: 'fifo',
  quotaGb: 100,
  monthlyResetDay: 1,
  currentUsedTrafficGb: 5,
  rateLimitMbps: 50,
  rateLimitMode: 'bi-directional',
  rateLimitDirection: 'both',
  ipRateLimitMbps: 0,
  maxConnections: 0,
  maxConnectionsPerIp: 0,
  proxyProtocol: false,
  billingDirection: 'both',
  tunnelMode: 'direct',
  enabled: true
};

const rule: ForwardingRuleView = {
  id: 'forward-acme-2443',
  name: 'Acme HTTPS relay',
  ownerName: 'Acme',
  protocol: 'tcp',
  tunnelId: 'tunnel-acme',
  tunnelName: 'tunnel-acme',
  sourceAgentId: 'agent-hkg-01',
  entryNodeIds: ['agent-hkg-01', 'agent-sin-01'],
  sourceAddress: '203.0.113.10',
  listenAddress: '0.0.0.0',
  listenPort: 2443,
  targetAddress: '10.0.0.10',
  targetPort: 443,
  enabled: true,
  portStatus: 'allocated',
  bindings: [
    {
      agentId: 'agent-hkg-01',
      listenAddress: '0.0.0.0',
      listenPort: 2443,
      targetAddress: '10.0.0.10',
      targetPort: 443,
      protocol: 'tcp',
      status: 'allocated',
      runtimeServiceNames: ['ou-forward-acme-2443-tcp.service']
    }
  ],
  bindingCount: 1,
  quotaBytes: 100 * 1024 ** 3,
  usedBytes: 5 * 1024 ** 3,
  monthlyResetDay: 1,
  currentUsedTrafficGb: 5,
  rateLimitMbps: 50,
  rateLimitMode: 'bi-directional',
  rateLimitDirection: 'both',
  ipRateLimitMbps: 80,
  billingDirection: 'both',
  pricePerGb: 0,
  tunnelMode: 'direct',
  strategy: 'fifo',
  maxConnections: 2048,
  maxConnectionsPerIp: 32,
  proxyProtocol: true
};

describe('forwarding task inputs', () => {
  it('creates API-valid upsert tasks with stable target ids and runtime-sensitive idempotency', () => {
    const input = createForwardingUpsertTaskInput(createMetadata, 'create', {
      createSummary: 'Create forwarding rule',
      updateSummary: 'Update forwarding rule',
      defaultTargetLabel: 'Forward 2443'
    });
    const key = createForwardingIdempotencyKey('forward.create', input.targetId, createMetadata);
    const changedKey = createForwardingIdempotencyKey('forward.create', input.targetId, {
      ...createMetadata,
      enabled: false
    });

    expect(createTaskRequestSchema.safeParse(input).success).toBe(true);
    expect(input).toMatchObject({
      operation: 'forward.create',
      resourceType: 'forward',
      targetId: 'forward-custom-2443',
      targetLabel: 'Acme HTTPS relay'
    });
    expect(createForwardingTargetId(createMetadata, 'forward-existing')).toBe('forward-existing');
    expect(key).toContain('ui:forward.create:forward-custom-2443');
    expect(key).not.toBe(changedKey);
    expect(key.length).toBeLessThan(190);
  });

  it('preserves blocked runtime controls from existing rules for runtime diagnosis', () => {
    const metadata = createForwardingMetadataFromRule(rule);
    const applyInput = createForwardingRunTaskInput('forward-acme-2443', rule, 'apply', {
      apply: 'Apply forwarding rule',
      pause: 'Pause forwarding rule',
      resume: 'Resume forwarding rule',
      defaultTargetLabel: 'Forwarding rule'
    });

    expect(createTaskRequestSchema.safeParse(applyInput).success).toBe(true);
    expect(metadata).toEqual(
      expect.objectContaining({
        entryNodeIds: ['agent-hkg-01', 'agent-sin-01'],
        ipRateLimitMbps: 0,
        maxConnections: 0,
        maxConnectionsPerIp: 0,
        proxyProtocol: false,
        blockedRuntimeControls: ['ipRateLimitMbps', 'maxConnections', 'maxConnectionsPerIp', 'proxyProtocol'],
        blockedRuntimeControlValues: {
          ipRateLimitMbps: 80,
          maxConnections: 2048,
          maxConnectionsPerIp: 32,
          proxyProtocol: true
        }
      })
    );
    expect(applyInput.metadata).toEqual(expect.objectContaining(metadata));
  });

  it('creates risk-confirmed pause, resume, and delete tasks', () => {
    const pauseInput = createForwardingRunTaskInput('forward-acme-2443', rule, 'pause', {
      apply: 'Apply forwarding rule',
      pause: 'Pause forwarding rule',
      resume: 'Resume forwarding rule',
      defaultTargetLabel: 'Forwarding rule'
    });
    const resumeInput = createForwardingRunTaskInput('forward-acme-2443', { ...rule, enabled: false }, 'resume', {
      apply: 'Apply forwarding rule',
      pause: 'Pause forwarding rule',
      resume: 'Resume forwarding rule',
      defaultTargetLabel: 'Forwarding rule'
    });
    const deleteInput = createForwardingDeleteTaskInput(rule, 'Delete forwarding rule');

    expect(createTaskRequestSchema.safeParse(pauseInput).success).toBe(true);
    expect(createTaskRequestSchema.safeParse(resumeInput).success).toBe(true);
    expect(createTaskRequestSchema.safeParse(deleteInput).success).toBe(true);
    expect(pauseInput.riskConfirmation).toEqual({
      operation: 'forward.pause',
      targetId: 'forward-acme-2443'
    });
    expect(pauseInput.metadata).toEqual(expect.objectContaining({ enabled: false }));
    expect(resumeInput.riskConfirmation).toEqual({
      operation: 'forward.resume',
      targetId: 'forward-acme-2443'
    });
    expect(resumeInput.metadata).toEqual(expect.objectContaining({ enabled: true }));
    expect(deleteInput.riskConfirmation).toEqual({
      operation: 'forward.delete',
      targetId: 'forward-acme-2443'
    });
    expect(createForwardingDeleteIdempotencyKey(rule)).toBe(
      'ui:forward.delete:forward-acme-2443:agent-hkg-01,agent-sin-01'
    );
  });
});
