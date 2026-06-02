import { createHash } from 'node:crypto';
import type { AgentCredentialRecord } from './control-plane-repository';

export function createAgentCredentialTokenHash(token: string) {
  return `sha256:${createHash('sha256').update(token).digest('hex')}`;
}

export function createAgentCredentialTokenPrefix(token: string) {
  return `${token.slice(0, 8)}...${token.slice(-6)}`;
}

export function isAgentCredentialActive(record: AgentCredentialRecord, now = new Date().toISOString()) {
  return record.status === 'active' && Date.parse(record.expiresAt) > Date.parse(now);
}
