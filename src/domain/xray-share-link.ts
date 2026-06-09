import type { XrayProtocol, XrayStreamSettings } from './protocol';
import { normalizeXrayClientCredentials } from './protocol-credentials';

type ShareableXrayProtocol = Extract<XrayProtocol, 'vmess' | 'vless' | 'trojan' | 'shadowsocks' | 'hysteria'>;

export type XrayShareLinkInput = {
  protocol: ShareableXrayProtocol;
  clientIdentity: string;
  clientCredential: string;
  hysteriaAuth?: string;
  fallbackSeed: string;
  serverAddress: string;
  listenPort: number;
  security: XrayStreamSettings['security'];
  network: XrayStreamSettings['network'];
  sni: string;
  path: string;
  flow: string;
  fingerprint: string;
  realityPublicKey: string;
  realityShortId: string;
  vmessSecurity: string;
  shadowsocksMethod: string;
  label: string;
};

function encodeUtf8Base64(value: string) {
  if (typeof btoa === 'function' && typeof TextEncoder !== 'undefined') {
    const bytes = new TextEncoder().encode(value);
    let binary = '';

    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });

    return btoa(binary);
  }

  return Buffer.from(value, 'utf8').toString('base64');
}

export function extractShareHostLabel(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return '';
  }

  const withoutScheme = trimmed.replace(/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//, '');
  const withoutPath = withoutScheme.split(/[/?#]/, 1)[0];
  const hostWithPort = withoutPath.includes('@') ? withoutPath.split('@').pop() ?? '' : withoutPath;

  return hostWithPort.replace(/:\d+$/, '');
}

function encodeQuery(input: Record<string, string | number | boolean | undefined>) {
  return Object.entries(input)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
}

export function normalizeGrpcServiceName(path: string) {
  return path.replace(/^\/+/, '') || 'ou-ui-next';
}

export function buildXrayShareLink(input: XrayShareLinkInput) {
  const normalizedCredentials = normalizeXrayClientCredentials({
    protocol: input.protocol,
    clientIdentity: input.clientIdentity,
    clientCredential: input.clientCredential,
    hysteriaAuth: input.hysteriaAuth,
    fallbackSeed: input.fallbackSeed
  });
  const server = extractShareHostLabel(input.serverAddress) || input.serverAddress.trim();
  const port = Math.max(Math.round(input.listenPort) || 1, 1);
  const tag = encodeURIComponent(input.label.trim() || normalizedCredentials.clientIdentity || 'node');
  const sni = input.sni.trim();
  const path = input.path.trim();
  const serviceName = normalizeGrpcServiceName(path);
  const transportQuery =
    input.network === 'grpc'
      ? {
          serviceName
        }
      : ['ws', 'httpupgrade', 'splithttp'].includes(input.network)
        ? {
            path: path || '/'
          }
        : {};
  const realityQuery =
    input.security === 'reality'
      ? {
          pbk: input.realityPublicKey.trim(),
          fp: input.fingerprint.trim() || 'chrome',
          sid: input.realityShortId.trim()
        }
      : {};

  if (input.protocol === 'vmess') {
    return `vmess://${encodeUtf8Base64(
      JSON.stringify({
        v: '2',
        ps: input.label.trim() || 'OU-UI Next',
        add: server,
        port: String(port),
        id: normalizedCredentials.clientId,
        aid: '0',
        scy: input.vmessSecurity.trim() || 'auto',
        net: input.network,
        type: 'none',
        host: sni,
        path,
        tls: input.security === 'none' ? '' : input.security,
        sni,
        fp: input.security === 'reality' ? input.fingerprint.trim() || 'chrome' : undefined
      })
    )}`;
  }

  if (input.protocol === 'shadowsocks') {
    const method = input.shadowsocksMethod.trim() || '2022-blake3-aes-128-gcm';
    return `ss://${encodeUtf8Base64(`${method}:${normalizedCredentials.password}`)}@${server}:${port}#${tag}`;
  }

  const baseQuery = {
    security: input.security === 'none' ? undefined : input.security,
    type: input.network,
    host: sni || undefined,
    sni: sni || undefined,
    ...transportQuery,
    ...realityQuery
  };

  if (input.protocol === 'trojan') {
    const query = encodeQuery(baseQuery);
    return `trojan://${encodeURIComponent(normalizedCredentials.password)}@${server}:${port}${query ? `?${query}` : ''}#${tag}`;
  }

  if (input.protocol === 'hysteria') {
    const query = encodeQuery({
      ...baseQuery,
      auth: normalizedCredentials.auth || undefined
    });
    return `hysteria2://${encodeURIComponent(normalizedCredentials.auth)}@${server}:${port}${query ? `?${query}` : ''}#${tag}`;
  }

  const query = encodeQuery({
    encryption: 'none',
    ...baseQuery,
    flow: input.flow.trim() || undefined
  });

  return `vless://${normalizedCredentials.clientId}@${server}:${port}${query ? `?${query}` : ''}#${tag}`;
}
