import type { DeployTask } from './task';
import { buildRuntimeArtifact } from './runtime-artifacts';

function createHostUpdateTask(metadata: DeployTask['metadata']): DeployTask {
  return {
    id: 'task-host-display-name',
    operation: 'agent.update',
    resourceType: 'agent',
    resourceId: 'agent-hkg-01',
    status: 'queued',
    targetId: 'agent-hkg-01',
    targetLabel: '香港展示名',
    summary: 'Update managed host profile',
    createdAt: '2026-06-04T00:00:00.000Z',
    updatedAt: '2026-06-04T00:00:00.000Z',
    actor: 'operator_001',
    requestedBy: 'operator_001',
    requestId: 'req-host-display-name',
    sourceIp: '127.0.0.1',
    rollbackAvailable: false,
    attempts: 0,
    steps: [],
    metadata
  };
}

describe('runtime artifacts', () => {
  it('keeps managed host display names separate from runtime host identity', () => {
    const artifact = buildRuntimeArtifact({
      task: createHostUpdateTask({
        agentId: 'agent-hkg-01',
        displayName: '香港展示名',
        maxTrafficGb: 2048
      }),
      agentId: 'agent-hkg-01',
      moduleKind: 'host-agent'
    });

    expect(artifact).toMatchObject({
      hostProfile: {
        agentId: 'agent-hkg-01',
        displayName: '香港展示名',
        hostName: 'agent-hkg-01',
        maxTrafficGb: 2048
      }
    });
  });

  it('keeps legacy hostName metadata as a display name only', () => {
    const artifact = buildRuntimeArtifact({
      task: createHostUpdateTask({
        agentId: 'agent-hkg-01',
        hostName: 'legacy-renamed-host'
      }),
      agentId: 'agent-hkg-01',
      moduleKind: 'host-agent'
    });

    expect(artifact).toMatchObject({
      hostProfile: {
        displayName: 'legacy-renamed-host',
        hostName: 'agent-hkg-01'
      }
    });
  });
});
