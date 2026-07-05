import YAML from 'yaml';
import type { SubscriptionInventoryNode, SubscriptionSource, SubscriptionSourceSyncResult } from '../../domain';
import { applySubscriptionSourceRulesWithStats } from '../../domain/subscription-rules';

type ParseSubscriptionSourceInput = {
  source: SubscriptionSource;
  body: string;
  syncedAt?: string;
  trafficHeader?: string | null;
};

type ParsedSourceNodes = {
  nodes: SubscriptionInventoryNode[];
  unsupportedProtocolNodeCount: number;
  invalidNodeCount: number;
};

const supportedSubscriptionProtocols = new Set(['vless', 'vmess', 'trojan', 'shadowsocks', 'hysteria']);
const supportedUriSchemes = new Set(['vless', 'vmess', 'trojan', 'ss', 'hysteria', 'hysteria2']);
const singBoxUtilityOutboundTypes = new Set([
  'block',
  'direct',
  'dns',
  'selector',
  'urltest',
  'url-test',
  'fallback',
  'load-balance'
]);

function createEmptyParsedSourceNodes(): ParsedSourceNodes {
  return {
    nodes: [],
    unsupportedProtocolNodeCount: 0,
    invalidNodeCount: 0
  };
}

function isSupportedSubscriptionProtocol(protocol: string) {
  return supportedSubscriptionProtocols.has(normalizeProtocol(protocol));
}

function decodeBase64(value: string) {
  const normalized = value.trim().replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64').toString('utf8');
}

function decodeMaybeBase64Subscription(body: string) {
  const trimmed = body.trim();

  if (!trimmed || trimmed.includes('://')) {
    return body;
  }

  try {
    const decoded = decodeBase64(trimmed);
    return decoded.includes('://') ? decoded : body;
  } catch {
    return body;
  }
}

function readNumber(value: unknown, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

function readString(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeProtocol(value: string) {
  if (value === 'ss') return 'shadowsocks';
  return value === 'hysteria2' ? 'hysteria' : value;
}

const regionAliasRules: Array<{ pattern: RegExp; tag: string }> = [
  { pattern: /香港|HK|Hong Kong/i, tag: 'region:hk' },
  { pattern: /新加坡|SG|Singapore/i, tag: 'region:sg' },
  { pattern: /日本|JP|Japan/i, tag: 'region:jp' },
  { pattern: /美国|US|USA|United States/i, tag: 'region:us' }
];

function createTags(source: SubscriptionSource, protocol: string, name: string) {
  const regionTags = regionAliasRules
    .filter((rule) => rule.pattern.test(name))
    .map((rule) => rule.tag);

  return [
    'external-subscription',
    `source:${source.id}`,
    source.kind,
    protocol,
    ...regionTags
  ];
}

function createNodeId(source: SubscriptionSource, protocol: string, server: string, port: number, name: string, index: number) {
  const stable = `${source.id}:${protocol}:${server}:${port}:${name || index}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120);
  return stable || `${source.id}-node-${index + 1}`;
}

function readTrafficHeaderNumber(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? Math.max(Math.round(parsed), 0) : undefined;
}

export function parseSubscriptionTrafficHeader(sourceId: string, header: string | null | undefined) {
  if (!header?.trim()) {
    return undefined;
  }

  const entries = Object.fromEntries(
    header
      .split(';')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const [rawKey, ...rawValueParts] = item.split('=');
        return [rawKey.trim().toLowerCase(), rawValueParts.join('=').trim()];
      })
      .filter(([key]) => key)
  );
  const uploadBytes = readTrafficHeaderNumber(entries.upload);
  const downloadBytes = readTrafficHeaderNumber(entries.download);
  const totalBytes = readTrafficHeaderNumber(entries.total);
  const expireSeconds = readTrafficHeaderNumber(entries.expire);

  if (
    uploadBytes === undefined &&
    downloadBytes === undefined &&
    totalBytes === undefined &&
    expireSeconds === undefined
  ) {
    return undefined;
  }

  return {
    sourceId,
    uploadBytes: uploadBytes ?? 0,
    downloadBytes: downloadBytes ?? 0,
    totalBytes: totalBytes ?? 0,
    expiresAt: expireSeconds && expireSeconds > 0 ? new Date(expireSeconds * 1000).toISOString() : undefined
  };
}

function createUriNode(source: SubscriptionSource, rawUrl: string, index: number): SubscriptionInventoryNode | undefined {
  const scheme = rawUrl.slice(0, rawUrl.indexOf('://')).toLowerCase();

  if (scheme === 'vmess') {
    try {
      const config = JSON.parse(decodeBase64(rawUrl.replace(/^vmess:\/\//i, ''))) as Record<string, unknown>;
      const name = readString(config.ps, `VMess ${index + 1}`);
      const server = readString(config.add);
      const port = readNumber(config.port);

      if (!server || !port) {
        return undefined;
      }

      const clashConfig = {
        name,
        type: 'vmess',
        server,
        port,
        uuid: readString(config.id),
        alterId: readNumber(config.aid),
        cipher: readString(config.scy, 'auto'),
        network: readString(config.net, 'tcp'),
        tls: Boolean(readString(config.tls)),
        servername: readString(config.sni)
      };

      return {
        id: createNodeId(source, 'vmess', server, port, name, index),
        sourceId: source.id,
        name,
        protocol: 'vmess',
        server,
        port,
        latencyMs: 0,
        tags: createTags(source, 'vmess', name),
        rawUrl,
        clashConfig
      };
    } catch {
      return undefined;
    }
  }

  if (scheme === 'ss') {
    return createShadowsocksNode(source, rawUrl, index);
  }

  try {
    const url = new URL(rawUrl);
    const protocol = normalizeProtocol(scheme);
    const name = decodeURIComponent(url.hash.replace(/^#/, '')) || `${protocol.toUpperCase()} ${index + 1}`;
    const server = url.hostname;
    const port = Number(url.port);

    if (!server || !port) {
      return undefined;
    }

    const credential = decodeURIComponent(url.username);
    const security = url.searchParams.get('security') ?? '';
    const network = url.searchParams.get('type') ?? 'tcp';
    const clashConfig: Record<string, unknown> = {
      name,
      type: scheme === 'hysteria2' ? 'hysteria2' : protocol,
      server,
      port,
      udp: true,
      network
    };

    if (protocol === 'vless' || protocol === 'vmess') {
      clashConfig.uuid = credential;
    } else {
      clashConfig.password = credential;
    }

    if (security && security !== 'none') {
      clashConfig.tls = true;
      clashConfig.servername = url.searchParams.get('sni') ?? url.searchParams.get('host') ?? undefined;
    }

    return {
      id: createNodeId(source, protocol, server, port, name, index),
      sourceId: source.id,
      name,
      protocol,
      server,
      port,
      latencyMs: 0,
      tags: createTags(source, protocol, name),
      rawUrl,
      clashConfig
    };
  } catch {
    return undefined;
  }
}

function createShadowsocksNode(source: SubscriptionSource, rawUrl: string, index: number): SubscriptionInventoryNode | undefined {
  try {
    const hashIndex = rawUrl.indexOf('#');
    const name = hashIndex >= 0 ? decodeURIComponent(rawUrl.slice(hashIndex + 1)) : `Shadowsocks ${index + 1}`;
    const body = rawUrl.slice('ss://'.length, hashIndex >= 0 ? hashIndex : undefined);
    const atIndex = body.lastIndexOf('@');
    const decoded = atIndex >= 0 ? undefined : decodeBase64(body);
    const decodedAtIndex = decoded?.lastIndexOf('@') ?? -1;
    const userInfo = atIndex >= 0 ? body.slice(0, atIndex) : decodedAtIndex >= 0 ? decoded?.slice(0, decodedAtIndex) ?? '' : '';
    const hostInfo = atIndex >= 0 ? body.slice(atIndex + 1) : decodedAtIndex >= 0 ? decoded?.slice(decodedAtIndex + 1) ?? '' : '';
    const decodedUserInfo = userInfo.includes(':') ? userInfo : decodeBase64(userInfo);
    const [method, password] = decodedUserInfo.split(':');
    const [server, rawPort] = hostInfo.split(':');
    const port = Number(rawPort);

    if (!server || !port || !method || !password) {
      return undefined;
    }

    return {
      id: createNodeId(source, 'shadowsocks', server, port, name, index),
      sourceId: source.id,
      name,
      protocol: 'shadowsocks',
      server,
      port,
      latencyMs: 0,
      tags: createTags(source, 'shadowsocks', name),
      rawUrl,
      clashConfig: {
        name,
        type: 'ss',
        server,
        port,
        cipher: method,
        password,
        udp: true
      }
    };
  } catch {
    return undefined;
  }
}

function parseUriNodes(source: SubscriptionSource, body: string): ParsedSourceNodes {
  const result = createEmptyParsedSourceNodes();
  const lines = decodeMaybeBase64Subscription(body)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[a-z0-9+.-]+:\/\//i.test(line));

  lines.forEach((line, index) => {
    const scheme = line.slice(0, line.indexOf('://')).toLowerCase();

    if (!supportedUriSchemes.has(scheme)) {
      result.unsupportedProtocolNodeCount += 1;
      return;
    }

    const node = createUriNode(source, line, index);

    if (node) {
      result.nodes.push(node);
    } else {
      result.invalidNodeCount += 1;
    }
  });

  return result;
}

function parseClashNodes(source: SubscriptionSource, body: string): ParsedSourceNodes {
  const result = createEmptyParsedSourceNodes();
  const document = YAML.parse(body) as unknown;
  const proxies = Array.isArray(document)
    ? document
    : document && typeof document === 'object' && Array.isArray((document as { proxies?: unknown }).proxies)
      ? (document as { proxies: unknown[] }).proxies
      : [];

  proxies.forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      result.invalidNodeCount += 1;
      return;
    }

    const proxy = item as Record<string, unknown>;
    const name = readString(proxy.name, `Proxy ${index + 1}`);
    const protocol = normalizeProtocol(readString(proxy.type, 'unknown'));
    const server = readString(proxy.server);
    const port = readNumber(proxy.port);

    if (!isSupportedSubscriptionProtocol(protocol)) {
      result.unsupportedProtocolNodeCount += 1;
      return;
    }

    if (!server || !port) {
      result.invalidNodeCount += 1;
      return;
    }

    result.nodes.push({
      id: createNodeId(source, protocol, server, port, name, index),
      sourceId: source.id,
      name,
      protocol,
      server,
      port,
      latencyMs: 0,
      tags: createTags(source, protocol, name),
      clashConfig: proxy
    });
  });

  return result;
}

function readNestedRecord(value: unknown, key: string) {
  return isRecord(value) && isRecord(value[key]) ? value[key] as Record<string, unknown> : undefined;
}

function readSingBoxCredential(outbound: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = readString(outbound[key]);

    if (value) {
      return value;
    }
  }

  return '';
}

function createSingBoxNode(
  source: SubscriptionSource,
  outbound: Record<string, unknown>,
  index: number
): SubscriptionInventoryNode | undefined {
  const rawType = readString(outbound.type).toLowerCase();
  const protocol = normalizeProtocol(rawType);
  const name = readString(outbound.tag, `${protocol.toUpperCase()} ${index + 1}`);
  const server = readString(outbound.server);
  const port = readNumber(outbound.server_port ?? outbound.port);

  if (!server || !port) {
    return undefined;
  }

  const tls = readNestedRecord(outbound, 'tls');
  const transport = readNestedRecord(outbound, 'transport');
  const reality = readNestedRecord(tls, 'reality');
  const clashConfig: Record<string, unknown> = {
    name,
    type: rawType === 'hysteria2' ? 'hysteria2' : protocol === 'shadowsocks' ? 'ss' : protocol,
    server,
    port,
    udp: true
  };

  if (protocol === 'vless' || protocol === 'vmess') {
    clashConfig.uuid = readSingBoxCredential(outbound, 'uuid');
  } else if (protocol === 'shadowsocks') {
    clashConfig.cipher = readSingBoxCredential(outbound, 'method');
    clashConfig.password = readSingBoxCredential(outbound, 'password');
  } else {
    clashConfig.password = readSingBoxCredential(outbound, 'password', 'auth');
  }

  if (protocol === 'vless') {
    const flow = readString(outbound.flow);
    if (flow) clashConfig.flow = flow;
  }

  if (tls && (tls.enabled === true || readString(tls.server_name) || reality)) {
    clashConfig.tls = true;
    clashConfig.servername = readString(tls.server_name);

    if (reality) {
      clashConfig['reality-opts'] = {
        'public-key': readString(reality.public_key),
        'short-id': readString(reality.short_id)
      };
    }
  }

  if (transport) {
    const network = readString(transport.type);
    if (network) clashConfig.network = network;

    const path = readString(transport.path);
    if (network === 'ws' && path) {
      clashConfig['ws-opts'] = {
        path,
        headers: isRecord(transport.headers) ? transport.headers : undefined
      };
    }
  }

  return {
    id: createNodeId(source, protocol, server, port, name, index),
    sourceId: source.id,
    name,
    protocol,
    server,
    port,
    latencyMs: 0,
    tags: createTags(source, protocol, name),
    clashConfig
  };
}

function parseSingBoxNodes(source: SubscriptionSource, body: string): ParsedSourceNodes {
  const result = createEmptyParsedSourceNodes();
  const document = JSON.parse(body) as unknown;
  const outbounds = Array.isArray(document)
    ? document
    : isRecord(document) && Array.isArray(document.outbounds)
      ? document.outbounds
      : [];

  outbounds.forEach((item, index) => {
    if (!isRecord(item)) {
      result.invalidNodeCount += 1;
      return;
    }

    const rawType = readString(item.type).toLowerCase();
    const protocol = normalizeProtocol(rawType);

    if (singBoxUtilityOutboundTypes.has(rawType)) {
      return;
    }

    if (!isSupportedSubscriptionProtocol(protocol)) {
      result.unsupportedProtocolNodeCount += 1;
      return;
    }

    const node = createSingBoxNode(source, item, index);

    if (node) {
      result.nodes.push(node);
    } else {
      result.invalidNodeCount += 1;
    }
  });

  return result;
}

function parseSourceNodes(source: SubscriptionSource, body: string) {
  if (source.kind === 'v2ray-uri') {
    return parseUriNodes(source, body);
  }

  if (source.kind === 'sing-box') {
    return parseSingBoxNodes(source, body);
  }

  return parseClashNodes(source, body);
}

function appendCountWarning(warnings: string[], code: string, count: number) {
  if (count > 0) {
    warnings.push(`${code}:${count}`);
  }
}

export function parseSubscriptionSourceContent({
  source,
  body,
  syncedAt = new Date().toISOString(),
  trafficHeader
}: ParseSubscriptionSourceInput): SubscriptionSourceSyncResult {
  const parsed = parseSourceNodes(source, body);
  const ruleResult = applySubscriptionSourceRulesWithStats(parsed.nodes, {
    includeFilter: source.includeFilter,
    excludeFilter: source.excludeFilter,
    dedupeKey: source.dedupeKey
  });
  const nodes = ruleResult.nodes;
  const warnings: string[] = [];
  const hasParseIssues = parsed.unsupportedProtocolNodeCount > 0 || parsed.invalidNodeCount > 0;

  appendCountWarning(warnings, 'subscription_source.unsupported_protocol_nodes', parsed.unsupportedProtocolNodeCount);
  appendCountWarning(warnings, 'subscription_source.invalid_nodes', parsed.invalidNodeCount);

  if (hasParseIssues || nodes.length === 0) {
    appendCountWarning(warnings, 'subscription_source.filtered_nodes', ruleResult.filteredNodeCount);
    appendCountWarning(warnings, 'subscription_source.deduped_nodes', ruleResult.dedupedNodeCount);
  }

  if (parsed.nodes.length === 0 && parsed.unsupportedProtocolNodeCount === 0 && parsed.invalidNodeCount === 0) {
    warnings.push('subscription_source.empty_or_unsupported');
  }

  const hasActionableParseWarnings = hasParseIssues || nodes.length === 0;
  const traffic = parseSubscriptionTrafficHeader(source.id, trafficHeader);

  return {
    sourceId: source.id,
    status: nodes.length > 0 && !hasActionableParseWarnings ? 'synced' : 'warning',
    nodeCount: nodes.length,
    syncedAt,
    nodes,
    traffic,
    warnings
  };
}
