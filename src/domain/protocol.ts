import type { AgentRuntimeDeploymentProof } from './task';

export type XrayProtocol =
  | 'vmess'
  | 'vless'
  | 'trojan'
  | 'shadowsocks'
  | 'http'
  | 'mixed'
  | 'tunnel'
  | 'hysteria'
  | 'wireguard'
  | 'tun';

export const XRAY_RUNTIME_PROTOCOLS = ['vmess', 'vless', 'trojan', 'shadowsocks'] as const;

export type XrayRuntimeProtocol = (typeof XRAY_RUNTIME_PROTOCOLS)[number];

export function isXrayRuntimeProtocol(protocol: unknown): protocol is XrayRuntimeProtocol {
  return typeof protocol === 'string' && XRAY_RUNTIME_PROTOCOLS.includes(protocol as XrayRuntimeProtocol);
}

export type XrayInboundStatus = 'enabled' | 'disabled' | 'applying' | 'error';

export type XrayClientCredentialType = 'uuid' | 'password' | 'auth' | 'userpass';

export type XrayClientResetPolicy = 'never' | 'daily' | 'weekly' | 'monthly';

export type XrayStreamSettings = {
  network: 'tcp' | 'udp' | 'ws' | 'grpc' | 'httpupgrade' | 'splithttp';
  security: 'none' | 'tls' | 'reality';
  sni?: string;
  host?: string;
  path?: string;
  serviceName?: string;
  fingerprint?: string;
};

export type XrayRuntimeDiagnosisState = 'ready' | 'waiting' | 'degraded' | 'blocked' | 'failed';

export type XrayRuntimeDiagnosisReason =
  | 'deploying'
  | 'releasing'
  | 'no-active-client'
  | 'operator-disabled'
  | 'quota-exceeded'
  | 'client-expired'
  | 'runtime-disabled-by-policy'
  | 'guardrail'
  | 'multi-client'
  | 'tls'
  | 'reality'
  | 'fallback'
  | 'xray-config-preflight';

export type XrayRuntimeDiagnosisAction =
  | 'apply'
  | 'inspect-agent'
  | 'renew-client'
  | 'reset-quota'
  | 'enable-client'
  | 'review-security'
  | 'rollback'
  | 'remove-runtime';

export type TlsSettings = {
  enabled: boolean;
  certificateId?: string;
  alpn: string[];
};

export type RealitySettings = {
  enabled: boolean;
  publicKey?: string;
  privateKey?: string;
  target?: string;
  fingerprint?: string;
  shortIds: string[];
  serverNames: string[];
};

export type InboundFallbackRule = {
  name: string;
  path?: string;
  destination: string;
  xver: number;
};

export type XrayClient = {
  id: string;
  email: string;
  enabled: boolean;
  credentialType?: XrayClientCredentialType;
  password?: string;
  auth?: string;
  method?: string;
  security?: string;
  flow?: string;
  subId?: string;
  level?: number;
  comment?: string;
  tgId?: string;
  resetPolicy?: XrayClientResetPolicy;
  trafficMultiplier?: 0.5 | 1 | 1.5 | 2;
  trafficLimitBytes: number;
  usedTrafficBytes: number;
  monthlyResetDay?: number;
  manualUsedTrafficBytes?: number;
  uplinkBytes?: number;
  downlinkBytes?: number;
  lastTrafficSampleAt?: string;
  trafficBillingPeriod?: string;
  quotaExceeded?: boolean;
  clientExpired?: boolean;
  runtimeDisabledByPolicy?: boolean;
  guardrailReason?: string;
  expiresAt: string;
  ipLimit: number;
};

export type XrayInbound = {
  id: string;
  nodeId: string;
  agentId?: string;
  customerName?: string;
  serverAddress?: string;
  clientIdentity?: string;
  remainingDays?: number;
  subscriptionRule?: string;
  path?: string;
  flow?: string;
  protocol: XrayProtocol;
  label: string;
  listenAddress: string;
  listenPort: number;
  status: XrayInboundStatus;
  clients: XrayClient[];
  streamSettings: XrayStreamSettings;
  tls: TlsSettings;
  reality: RealitySettings;
  fallbacks: InboundFallbackRule[];
  sniffingEnabled: boolean;
  configVersion: string;
  runtimeDeployment?: AgentRuntimeDeploymentProof;
};
