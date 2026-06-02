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

export type XrayInboundStatus = 'enabled' | 'disabled' | 'applying' | 'error';

export type XrayStreamSettings = {
  network: 'tcp' | 'udp' | 'ws' | 'grpc' | 'httpupgrade' | 'splithttp';
  security: 'none' | 'tls' | 'reality';
  sni?: string;
  fingerprint?: string;
};

export type TlsSettings = {
  enabled: boolean;
  certificateId?: string;
  alpn: string[];
};

export type RealitySettings = {
  enabled: boolean;
  publicKey?: string;
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
  trafficLimitBytes: number;
  usedTrafficBytes: number;
  expiresAt: string;
  ipLimit: number;
};

export type XrayInbound = {
  id: string;
  nodeId: string;
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
};
