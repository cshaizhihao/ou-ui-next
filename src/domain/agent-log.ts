export type AgentLogArchiveStream = 'stdout' | 'stderr' | 'agent' | 'runtime';

export type AgentLogArchiveSource = 'retention-prune';

export type AgentLogArchive = {
  id: string;
  agentId: string;
  sessionIds: string[];
  taskId: string;
  commandId: string;
  stream: AgentLogArchiveStream;
  bucketStartAt: string;
  bucketEndAt: string;
  firstObservedAt: string;
  lastObservedAt: string;
  firstSeq: number;
  lastSeq: number;
  firstChunkSeq: number;
  lastChunkSeq: number;
  chunkCount: number;
  contentBytes: number;
  contentSha256: string;
  archivedAt: string;
  source: AgentLogArchiveSource;
};
