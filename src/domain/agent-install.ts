export const AGENT_INSTALL_PROFILE = ['host-agent', 'xray', 'port-forwarding', 'telemetry', 'command-channel'] as const;
export const DEFAULT_AGENT_INSTALL_SCRIPT_URL =
  'https://raw.githubusercontent.com/cshaizhihao/ou-ui-next/main/public/install/ou-agent.sh';

export type AgentInstallProfileComponent = (typeof AGENT_INSTALL_PROFILE)[number];

export type AgentInstallMetadata = {
  installProfile: AgentInstallProfileComponent[];
  registrationVersion?: string;
  registrationPlatform?: string;
  registrationCapabilities?: AgentInstallProfileComponent[];
};

export type AgentInstallCommandRequest = AgentInstallMetadata & {
  publicBaseUrl?: string;
};

export type AgentInstallCommand = {
  agentId: string;
  command: string;
  expiresAt: string;
  installToken: string;
  masterEndpoint: string;
  scriptUrl: string;
};

export type AgentRegistrationRequest = {
  agentId: string;
  requestId: string;
  sessionId?: string;
  version?: string;
  platform?: string;
  capabilities?: AgentInstallProfileComponent[];
};

export type AgentRuntimeCredential = {
  agentId: string;
  agentToken: string;
  tokenPrefix: string;
  credentialId: string;
  issuedAt: string;
  expiresAt: string;
  sessionId?: string;
};

export type AgentCredentialSummary = {
  id: string;
  agentId: string;
  tokenPrefix: string;
  status: 'active' | 'revoked' | 'expired';
  purpose: 'install' | 'runtime';
  issuedAt: string;
  expiresAt: string;
  issuedBy: string;
  sourceIp: string;
  requestId: string;
  lastUsedAt?: string;
  sessionId?: string;
  revokedAt?: string;
  revokedBy?: string;
  revokedReason?: string;
  replacedByCredentialId?: string;
  metadata: AgentInstallMetadata;
};

export type AgentCredentialRevokeRequest = {
  reason: string;
};

export type AgentCredentialRotateRequest = {
  reason: string;
};

export function createRuntimeAgentId() {
  return `agent-${createSecureToken('').slice(0, 12)}`;
}

export function normalizePublicBaseUrl(publicBaseUrl: string | undefined) {
  return (publicBaseUrl && publicBaseUrl.trim().length > 0 ? publicBaseUrl : 'http://127.0.0.1:4010').replace(/\/+$/, '');
}

function createSecureToken(prefix: string) {
  const bytes = new Uint8Array(24);

  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  return `${prefix}${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function createRuntimeInstallToken() {
  return createSecureToken('oit_');
}

export function createRuntimeAgentToken() {
  return createSecureToken('oat_');
}

function shellQuote(value: string | number) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function createMasterEndpoint(publicBaseUrl: string) {
  const baseUrl = new URL(publicBaseUrl);
  baseUrl.pathname = `${baseUrl.pathname.replace(/\/+$/, '')}/agent/v1/poll`;
  baseUrl.search = '';
  baseUrl.hash = '';
  return baseUrl.toString();
}

export function composeAgentInstallCommand(
  input: AgentInstallCommandRequest,
  options: {
    agentId?: string;
    expiresAt?: string;
    installToken?: string;
    issuedAt?: string;
  } = {}
): AgentInstallCommand {
  const publicBaseUrl = normalizePublicBaseUrl(input.publicBaseUrl);
  const agentId = options.agentId ?? createRuntimeAgentId();
  const installToken = options.installToken ?? createRuntimeInstallToken();
  const issuedAt = options.issuedAt ?? new Date().toISOString();
  const expiresAt = options.expiresAt ?? new Date(Date.parse(issuedAt) + 15 * 60_000).toISOString();
  const scriptUrl = DEFAULT_AGENT_INSTALL_SCRIPT_URL;
  const masterEndpoint = createMasterEndpoint(publicBaseUrl);
  const command = [
    `curl -fsSL ${shellQuote(scriptUrl)} |`,
    `OU_MASTER=${shellQuote(masterEndpoint)}`,
    `OU_AGENT_ID=${shellQuote(agentId)}`,
    `OU_INSTALL_TOKEN=${shellQuote(installToken)}`,
    'bash'
  ].join(' ');

  return {
    agentId,
    command,
    expiresAt,
    installToken,
    masterEndpoint,
    scriptUrl
  };
}
