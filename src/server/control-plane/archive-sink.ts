import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentLogArchive, TrafficRollupCompaction } from '../../domain';

export type ExternalArchiveKind = 'agent-log-archive' | 'traffic-rollup-compaction';

export type ExternalArchiveEnvelope =
  | {
      schemaVersion: 'ou-ui-next.external-archive.v1';
      kind: 'agent-log-archive';
      exportedAt: string;
      recordId: string;
      record: AgentLogArchive;
    }
  | {
      schemaVersion: 'ou-ui-next.external-archive.v1';
      kind: 'traffic-rollup-compaction';
      exportedAt: string;
      recordId: string;
      record: TrafficRollupCompaction;
    };

export type ExternalArchiveSinkContext = {
  exportedAt: string;
};

export type ControlPlaneArchiveSink = {
  writeAgentLogArchives(archives: AgentLogArchive[], context: ExternalArchiveSinkContext): Promise<void>;
  writeTrafficRollupCompactions(
    compactions: TrafficRollupCompaction[],
    context: ExternalArchiveSinkContext
  ): Promise<void>;
};

export type FileControlPlaneArchiveSinkOptions = {
  directory: string;
};

function createJsonlContent(envelopes: ExternalArchiveEnvelope[]) {
  if (envelopes.length === 0) {
    return '';
  }

  return `${envelopes.map((envelope) => JSON.stringify(envelope)).join('\n')}\n`;
}

async function appendJsonl(directory: string, filename: string, envelopes: ExternalArchiveEnvelope[]) {
  if (envelopes.length === 0) {
    return;
  }

  await mkdir(directory, { recursive: true });
  await appendFile(join(directory, filename), createJsonlContent(envelopes), 'utf8');
}

export function createFileControlPlaneArchiveSink(
  options: FileControlPlaneArchiveSinkOptions
): ControlPlaneArchiveSink {
  const directory = options.directory.trim();

  if (!directory) {
    throw new Error('External archive sink directory must not be empty.');
  }

  return {
    async writeAgentLogArchives(archives, context) {
      await appendJsonl(
        directory,
        'agent-log-archives.jsonl',
        archives.map((archive) => ({
          schemaVersion: 'ou-ui-next.external-archive.v1',
          kind: 'agent-log-archive',
          exportedAt: context.exportedAt,
          recordId: archive.id,
          record: archive
        }))
      );
    },

    async writeTrafficRollupCompactions(compactions, context) {
      await appendJsonl(
        directory,
        'traffic-rollup-compactions.jsonl',
        compactions.map((compaction) => ({
          schemaVersion: 'ou-ui-next.external-archive.v1',
          kind: 'traffic-rollup-compaction',
          exportedAt: context.exportedAt,
          recordId: compaction.id,
          record: compaction
        }))
      );
    }
  };
}
