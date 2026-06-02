export const AGENT_INSTALL_PROFILE = ['probe', 'xray', 'flvx', 'forwarding', 'telemetry', 'command-channel'] as const;

export type AgentInstallProfileComponent = (typeof AGENT_INSTALL_PROFILE)[number];

export type AgentInstallMetadata = {
  hostName: string;
  maxTrafficGb: number;
  customerNodeName: string;
  customerName: string;
  remainingDays: number;
  installProfile: AgentInstallProfileComponent[];
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

export function createAgentIdFromHostName(hostName: string) {
  const hostSlug = hostName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `agent-${hostSlug || 'new-host'}`;
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
    expiresAt?: string;
    installToken?: string;
    issuedAt?: string;
  } = {}
): AgentInstallCommand {
  const publicBaseUrl = normalizePublicBaseUrl(input.publicBaseUrl);
  const agentId = createAgentIdFromHostName(input.hostName);
  const installToken = options.installToken ?? createRuntimeInstallToken();
  const issuedAt = options.issuedAt ?? new Date().toISOString();
  const expiresAt = options.expiresAt ?? new Date(Date.parse(issuedAt) + 15 * 60_000).toISOString();
  const scriptUrl = `${publicBaseUrl}/install/ou-agent.sh`;
  const masterEndpoint = createMasterEndpoint(publicBaseUrl);
  const command = [
    `curl -fsSL ${shellQuote(scriptUrl)} |`,
    `OU_MASTER=${shellQuote(masterEndpoint)}`,
    `OU_AGENT_ID=${shellQuote(agentId)}`,
    `OU_INSTALL_TOKEN=${shellQuote(installToken)}`,
    `OU_HOST_NAME=${shellQuote(input.hostName)}`,
    `OU_MAX_TRAFFIC_GB=${shellQuote(input.maxTrafficGb)}`,
    `OU_CUSTOMER_NODE=${shellQuote(input.customerNodeName)}`,
    `OU_CUSTOMER_NAME=${shellQuote(input.customerName)}`,
    `OU_REMAINING_DAYS=${shellQuote(input.remainingDays)}`,
    `OU_INSTALL_PROFILE=${shellQuote(input.installProfile.join(','))}`,
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
