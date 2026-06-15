import type { SubscriptionClientIdentity, SubscriptionExportProfile, SubscriptionInventoryNode, XrayInbound } from '../../domain';
import { selectSubscriptionInventoryNodes } from '../../domain/subscription-rules';

export type PublicSubscriptionFormat = 'uri' | 'v2ray' | 'clash' | 'mihomo' | 'sing-box';

export type PublicSubscriptionOutput = {
  body: string;
  contentType: string;
  headers: Record<string, string>;
  nodeCount: number;
};

type RenderSubscriptionOutputInput = {
  client: SubscriptionClientIdentity;
  format: PublicSubscriptionFormat;
  inbounds: XrayInbound[];
  externalNodes?: SubscriptionInventoryNode[];
  exportProfile?: SubscriptionExportProfile;
};

type ProjectSubscriptionClientRuntimeStateInput = Omit<RenderSubscriptionOutputInput, 'format'> & {
  nowIso?: string;
  quotaResetBaseline?: {
    resetAt: string;
    baselineUsedTrafficBytes: number;
  };
};

export type SubscriptionClientRuntimeProjection = {
  client: SubscriptionClientIdentity;
  nodes: SubscriptionInventoryNode[];
  matchedXrayClientCount: number;
};

function encodeBase64(value: string) {
  return Buffer.from(value, 'utf8').toString('base64');
}

function encodeTag(value: string) {
  return encodeURIComponent(value).replace(/%20/g, '+');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function readProxyString(proxy: Record<string, unknown>, key: string, fallback = '') {
  const value = proxy[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

function readProxyNumber(proxy: Record<string, unknown>, key: string, fallback = 0) {
  const value = proxy[key];

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

function clampBytes(value: number | undefined) {
  return Number.isFinite(value) ? Math.max(value ?? 0, 0) : 0;
}

function subtractBaseline(value: number, baseline: number) {
  return Math.max(clampBytes(value) - clampBytes(baseline), 0);
}

function readClientQuotaResetBaseline(client: SubscriptionClientIdentity) {
  return client.quotaResetAt
    ? {
        resetAt: client.quotaResetAt,
        baselineUsedTrafficBytes: clampBytes(client.quotaResetBaselineUsedTrafficBytes)
      }
    : undefined;
}

function readProxyRecord(proxy: Record<string, unknown>, key: string) {
  const value = proxy[key];
  return isRecord(value) ? value : undefined;
}

function compactRecord(record: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined && value !== ''));
}

function normalizeProxyProtocol(value: string) {
  if (value === 'ss') return 'shadowsocks';
  if (value === 'hysteria2') return 'hysteria';
  return value;
}

function readServerAddress(inbound: XrayInbound) {
  const candidate = inbound.serverAddress?.trim() || inbound.streamSettings.sni?.trim() || inbound.listenAddress.trim();

  if (candidate === '0.0.0.0' || candidate === '::') {
    return inbound.agentId || inbound.nodeId;
  }

  return candidate;
}

function readCredential(inbound: XrayInbound, client = inbound.clients[0]) {
  if (inbound.protocol === 'vless' || inbound.protocol === 'vmess') {
    return client?.id || inbound.clientIdentity || '';
  }

  return client?.password || client?.auth || inbound.clientIdentity || client?.id || '';
}

function createTransportQuery(inbound: XrayInbound, client = inbound.clients[0]) {
  const query = new URLSearchParams();
  const sni = inbound.streamSettings.sni || inbound.streamSettings.host || inbound.reality.serverNames[0];
  const path = inbound.streamSettings.path || inbound.streamSettings.serviceName || inbound.path || '';

  if (inbound.protocol === 'vless') {
    query.set('encryption', 'none');
  }

  query.set('type', inbound.streamSettings.network);

  if (inbound.streamSettings.security !== 'none') {
    query.set('security', inbound.streamSettings.security);
  }

  if (sni) {
    query.set('sni', sni);
    query.set('host', sni);
  }

  if (path) {
    query.set(inbound.streamSettings.network === 'grpc' ? 'serviceName' : 'path', path);
  }

  if (inbound.protocol === 'vless') {
    const flow = client?.flow?.trim() || inbound.flow?.trim();

    if (flow) {
      query.set('flow', flow);
    }
  }

  if (inbound.reality.publicKey && inbound.streamSettings.security === 'reality') {
    query.set('pbk', inbound.reality.publicKey);
  }

  if (inbound.reality.shortIds[0] && inbound.streamSettings.security === 'reality') {
    query.set('sid', inbound.reality.shortIds[0]);
  }

  if (inbound.streamSettings.fingerprint || inbound.reality.fingerprint) {
    query.set('fp', inbound.streamSettings.fingerprint || inbound.reality.fingerprint || 'chrome');
  }

  return query.toString();
}

function createRawUrl(inbound: XrayInbound, client = inbound.clients[0], label = inbound.label) {
  const server = readServerAddress(inbound);
  const port = inbound.listenPort;
  const credential = readCredential(inbound, client);
  const tag = encodeTag(label);
  const query = createTransportQuery(inbound, client);

  if (!credential || !client?.enabled) {
    return undefined;
  }

  if (inbound.protocol === 'vmess') {
    return `vmess://${encodeBase64(
      JSON.stringify({
        v: '2',
        ps: label,
        add: server,
        port: String(port),
        id: credential,
        aid: '0',
        scy: client.security || 'auto',
        net: inbound.streamSettings.network,
        type: 'none',
        host: inbound.streamSettings.host || inbound.streamSettings.sni || '',
        path: inbound.streamSettings.path || inbound.path || '',
        tls: inbound.streamSettings.security === 'none' ? '' : inbound.streamSettings.security,
        sni: inbound.streamSettings.sni || ''
      })
    )}`;
  }

  if (inbound.protocol === 'shadowsocks') {
    const method = client.method || '2022-blake3-aes-128-gcm';
    return `ss://${encodeBase64(`${method}:${credential}`)}@${server}:${port}#${tag}`;
  }

  if (inbound.protocol === 'trojan') {
    return `trojan://${encodeURIComponent(credential)}@${server}:${port}${query ? `?${query}` : ''}#${tag}`;
  }

  if (inbound.protocol === 'hysteria') {
    return `hysteria2://${encodeURIComponent(credential)}@${server}:${port}${query ? `?${query}` : ''}#${tag}`;
  }

  return `vless://${credential}@${server}:${port}${query ? `?${query}` : ''}#${tag}`;
}

function resolveSubscriptionNodeStatus(
  inbound: XrayInbound,
  client = inbound.clients[0]
): SubscriptionInventoryNode['status'] {
  if (inbound.status === 'applying') return 'applying';
  if (inbound.status === 'error') return 'error';
  if (inbound.status === 'disabled' || !client?.enabled) return 'disabled';
  if (client.clientExpired) return 'expired';
  if (client.quotaExceeded || client.guardrailReason === 'xray_client_monthly_quota_exceeded') return 'quota-exceeded';
  return 'online';
}

function normalizeIdentity(value: string | undefined) {
  return (value ?? '').trim().toLowerCase();
}

function sameIdentity(left: string | undefined, right: string | undefined) {
  const normalizedLeft = normalizeIdentity(left);
  const normalizedRight = normalizeIdentity(right);

  return normalizedLeft !== '' && normalizedLeft === normalizedRight;
}

function protocolMatchesSubscriptionClient(client: SubscriptionClientIdentity, inbound: XrayInbound) {
  const protocol = normalizeIdentity(client.protocol);

  return !protocol || protocol === normalizeIdentity(inbound.protocol);
}

function isStrictSubscriptionClientMatch(
  client: SubscriptionClientIdentity,
  inboundClient: XrayInbound['clients'][number]
) {
  return (
    sameIdentity(client.email, inboundClient.email) ||
    sameIdentity(client.subId, inboundClient.subId) ||
    sameIdentity(client.subId, inboundClient.id) ||
    sameIdentity(client.id, inboundClient.id)
  );
}

function isFallbackSubscriptionClientMatch(
  client: SubscriptionClientIdentity,
  inbound: XrayInbound,
  selectedInboundIds: Set<string>
) {
  return (
    selectedInboundIds.has(inbound.id) &&
    inbound.clients.length === 1 &&
    sameIdentity(client.customerName, inbound.customerName)
  );
}

function collectSelectedXrayClients(
  client: SubscriptionClientIdentity,
  inbounds: XrayInbound[],
  selectedNodes: SubscriptionInventoryNode[]
) {
  const selectedInboundIds = new Set(
    selectedNodes
      .map((node) => node.inboundTag)
      .filter((inboundTag): inboundTag is string => Boolean(inboundTag))
  );

  return inbounds.flatMap((inbound) => {
    if (!protocolMatchesSubscriptionClient(client, inbound)) {
      return [];
    }

    const fallbackMatched = isFallbackSubscriptionClientMatch(client, inbound, selectedInboundIds);

    return inbound.clients.filter((inboundClient) => isStrictSubscriptionClientMatch(client, inboundClient) || fallbackMatched);
  });
}

function createExternalTransportQuery(protocol: string, proxy: Record<string, unknown>) {
  const query = new URLSearchParams();
  const network = readProxyString(proxy, 'network', 'tcp');
  const serverName = readProxyString(proxy, 'servername', readProxyString(proxy, 'sni'));
  const wsOptions = isRecord(proxy['ws-opts']) ? proxy['ws-opts'] : undefined;
  const grpcOptions = isRecord(proxy['grpc-opts']) ? proxy['grpc-opts'] : undefined;
  const realityOptions = isRecord(proxy['reality-opts']) ? proxy['reality-opts'] : undefined;

  if (protocol === 'vless') {
    query.set('encryption', 'none');
  }

  if (network) {
    query.set('type', network);
  }

  if (proxy.tls === true || serverName || realityOptions) {
    query.set('security', realityOptions ? 'reality' : 'tls');
  }

  if (serverName) {
    query.set('sni', serverName);
    query.set('host', serverName);
  }

  if (network === 'ws' && wsOptions) {
    const path = readProxyString(wsOptions, 'path');
    if (path) query.set('path', path);
  }

  if (network === 'grpc' && grpcOptions) {
    const serviceName = readProxyString(grpcOptions, 'grpc-service-name', readProxyString(grpcOptions, 'serviceName'));
    if (serviceName) query.set('serviceName', serviceName);
  }

  if (protocol === 'vless') {
    const flow = readProxyString(proxy, 'flow');
    if (flow) query.set('flow', flow);
  }

  if (realityOptions) {
    const publicKey = readProxyString(realityOptions, 'public-key');
    const shortId = readProxyString(realityOptions, 'short-id');
    const fingerprint = readProxyString(proxy, 'client-fingerprint', readProxyString(proxy, 'fingerprint', 'chrome'));

    if (publicKey) query.set('pbk', publicKey);
    if (shortId) query.set('sid', shortId);
    if (fingerprint) query.set('fp', fingerprint);
  }

  return query.toString();
}

function createRawUrlFromExternalNode(node: SubscriptionInventoryNode) {
  if (node.rawUrl) {
    return node.rawUrl;
  }

  const proxy = node.clashConfig;

  if (!proxy) {
    return undefined;
  }

  const protocol = normalizeProxyProtocol(readProxyString(proxy, 'type', node.protocol));
  const server = readProxyString(proxy, 'server', node.server);
  const port = readProxyNumber(proxy, 'port', node.port);
  const name = readProxyString(proxy, 'name', node.name);
  const tag = encodeTag(name);

  if (!server || !port) {
    return undefined;
  }

  if (protocol === 'vmess') {
    const uuid = readProxyString(proxy, 'uuid');
    if (!uuid) return undefined;

    return `vmess://${encodeBase64(
      JSON.stringify({
        v: '2',
        ps: name,
        add: server,
        port: String(port),
        id: uuid,
        aid: String(readProxyNumber(proxy, 'alterId', 0)),
        scy: readProxyString(proxy, 'cipher', 'auto'),
        net: readProxyString(proxy, 'network', 'tcp'),
        type: 'none',
        host: readProxyString(proxy, 'servername'),
        path: isRecord(proxy['ws-opts']) ? readProxyString(proxy['ws-opts'], 'path') : '',
        tls: proxy.tls === true ? 'tls' : '',
        sni: readProxyString(proxy, 'servername')
      })
    )}`;
  }

  if (protocol === 'shadowsocks') {
    const method = readProxyString(proxy, 'cipher');
    const password = readProxyString(proxy, 'password');
    if (!method || !password) return undefined;

    return `ss://${encodeBase64(`${method}:${password}`)}@${server}:${port}#${tag}`;
  }

  const credential =
    protocol === 'vless'
      ? readProxyString(proxy, 'uuid')
      : protocol === 'hysteria'
        ? readProxyString(proxy, 'password', readProxyString(proxy, 'auth'))
        : readProxyString(proxy, 'password');

  if (!credential) {
    return undefined;
  }

  const query = createExternalTransportQuery(protocol, proxy);

  if (protocol === 'trojan') {
    return `trojan://${encodeURIComponent(credential)}@${server}:${port}${query ? `?${query}` : ''}#${tag}`;
  }

  if (protocol === 'hysteria') {
    return `hysteria2://${encodeURIComponent(credential)}@${server}:${port}${query ? `?${query}` : ''}#${tag}`;
  }

  return `vless://${credential}@${server}:${port}${query ? `?${query}` : ''}#${tag}`;
}

function createLocalClientNodeLabel(inbound: XrayInbound, client: XrayInbound['clients'][number], index: number) {
  if (inbound.clients.length <= 1) {
    return inbound.label;
  }

  const suffix = client.email || client.subId || client.id || `client-${index + 1}`;
  return `${inbound.label} / ${suffix}`;
}

function toSubscriptionNode(
  inbound: XrayInbound,
  client = inbound.clients[0],
  index = 0
): SubscriptionInventoryNode | undefined {
  const label = createLocalClientNodeLabel(inbound, client, index);
  const rawUrl = createRawUrl(inbound, client, label);

  if (!rawUrl || inbound.status === 'disabled') {
    return undefined;
  }

  const server = readServerAddress(inbound);
  const tags = [
    'local-inbound',
    inbound.protocol,
    inbound.agentId ? `agent:${inbound.agentId}` : '',
    inbound.customerName ? `customer:${inbound.customerName}` : '',
    client.email ? `client:${client.email}` : '',
    client.id ? `client-id:${client.id}` : '',
    client.subId ? `sub:${client.subId}` : '',
    inbound.subscriptionRule || '',
    inbound.streamSettings.security,
    inbound.streamSettings.network
  ].filter(Boolean);

  return {
    id: inbound.clients.length > 1 ? `${inbound.id}:${client.id || client.email || index}` : inbound.id,
    sourceId: inbound.agentId ? `local:${inbound.agentId}` : 'local-inbounds',
    name: label,
    protocol: inbound.protocol,
    server,
    port: inbound.listenPort,
    latencyMs: 0,
    tags,
    status: resolveSubscriptionNodeStatus(inbound, client),
    customerName: inbound.customerName,
    hostId: inbound.agentId,
    usedTrafficBytes: client?.usedTrafficBytes,
    trafficLimitBytes: client?.trafficLimitBytes,
    expiresAt: client?.expiresAt,
    rawUrl,
    clashConfig: createClashProxy(inbound, client, label),
    inboundTag: inbound.id,
    probeAgentId: inbound.agentId
  };
}

function toSubscriptionNodes(inbound: XrayInbound) {
  return inbound.clients
    .map((client, index) => toSubscriptionNode(inbound, client, index))
    .filter((node): node is SubscriptionInventoryNode => Boolean(node));
}

function createClashProxy(
  inbound: XrayInbound,
  client = inbound.clients[0],
  label = inbound.label
): Record<string, unknown> {
  const server = readServerAddress(inbound);
  const credential = readCredential(inbound, client);
  const base: Record<string, unknown> = {
    name: label,
    type: inbound.protocol === 'hysteria' ? 'hysteria2' : inbound.protocol,
    server,
    port: inbound.listenPort,
    udp: true
  };
  const sni = inbound.streamSettings.sni || inbound.streamSettings.host || inbound.reality.serverNames[0];

  if (inbound.protocol === 'vless' || inbound.protocol === 'vmess') {
    base.uuid = credential;
    base.alterId = inbound.protocol === 'vmess' ? 0 : undefined;
    base.cipher = inbound.protocol === 'vmess' ? client?.security || 'auto' : undefined;
    base.flow = inbound.protocol === 'vless' ? client?.flow || inbound.flow || undefined : undefined;
  } else if (inbound.protocol === 'shadowsocks') {
    base.cipher = client?.method || '2022-blake3-aes-128-gcm';
    base.password = credential;
  } else {
    base.password = credential;
  }

  if (inbound.streamSettings.security !== 'none') {
    base.tls = true;
    base.servername = sni;
  }

  if (inbound.streamSettings.security === 'reality') {
    base['reality-opts'] = {
      'public-key': inbound.reality.publicKey,
      'short-id': inbound.reality.shortIds[0]
    };
    base['client-fingerprint'] = inbound.streamSettings.fingerprint || inbound.reality.fingerprint || 'chrome';
  }

  if (inbound.streamSettings.network !== 'tcp') {
    base.network = inbound.streamSettings.network;
  }

  if (inbound.streamSettings.network === 'ws') {
    base['ws-opts'] = {
      path: inbound.streamSettings.path || inbound.path || '/',
      headers: sni ? { Host: sni } : undefined
    };
  }

  if (inbound.streamSettings.network === 'grpc') {
    base['grpc-opts'] = {
      'grpc-service-name': inbound.streamSettings.serviceName || inbound.path?.replace(/^\//, '') || ''
    };
  }

  if (inbound.streamSettings.network === 'httpupgrade') {
    base['httpupgrade-opts'] = {
      path: inbound.streamSettings.path || inbound.path || '/',
      host: sni || undefined
    };
  }

  return Object.fromEntries(Object.entries(base).filter(([, value]) => value !== undefined && value !== ''));
}

function quoteYaml(value: string) {
  return JSON.stringify(value);
}

function toYaml(value: unknown, indent = 0): string {
  const space = ' '.repeat(indent);

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]';
    }

    return value
      .map((item) => {
        if (item && typeof item === 'object') {
          const nested = toYaml(item, indent + 2);
          return `${space}- ${nested.trimStart()}`;
        }

        return `${space}- ${formatYamlScalar(item)}`;
      })
      .join('\n');
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined);

    if (entries.length === 0) {
      return '{}';
    }

    return entries
      .map(([key, item]) => {
        if (Array.isArray(item) || (item && typeof item === 'object')) {
          return `${space}${key}:\n${toYaml(item, indent + 2)}`;
        }

        return `${space}${key}: ${formatYamlScalar(item)}`;
      })
      .join('\n');
  }

  return formatYamlScalar(value);
}

function formatYamlScalar(value: unknown) {
  if (typeof value === 'string') {
    return quoteYaml(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (value === null) {
    return 'null';
  }

  return quoteYaml(String(value ?? ''));
}

function createProfileProxyGroups(
  profile: SubscriptionExportProfile | undefined,
  nodes: SubscriptionInventoryNode[],
  fallbackName: string
) {
  const proxyNames = nodes.map((node) => node.name);

  if (!profile || profile.proxyGroups.length === 0) {
    return [
      {
        name: fallbackName,
        type: 'select',
        proxies: proxyNames.length > 0 ? proxyNames : ['DIRECT']
      },
      {
        name: 'AUTO',
        type: 'url-test',
        url: 'https://www.gstatic.com/generate_204',
        interval: 300,
        proxies: proxyNames.length > 0 ? proxyNames : ['DIRECT']
      }
    ];
  }

  return profile.proxyGroups.map((group) => {
    const healthChecked = group.strategy === 'url-test' || group.strategy === 'fallback' || group.strategy === 'load-balance';
    const groupNodeIds = new Set(group.nodeIds ?? []);
    const groupProxyNames = nodes
      .filter((node) => {
        if (groupNodeIds.size > 0) return groupNodeIds.has(node.id);
        if (group.filterTags.length === 0) return true;
        const searchable = [node.name, node.protocol, ...node.tags].join(' ').toLowerCase();
        return group.filterTags.some((tag) => searchable.includes(tag.toLowerCase()));
      })
      .map((node) => node.name);

    return {
      name: group.name,
      type: group.strategy,
      ...(healthChecked
        ? {
            url: 'https://www.gstatic.com/generate_204',
            interval: 300
          }
        : {}),
      proxies: groupProxyNames.length > 0 ? groupProxyNames : proxyNames.length > 0 ? proxyNames : ['DIRECT']
    };
  });
}

function renderClash(
  nodes: SubscriptionInventoryNode[],
  client: SubscriptionClientIdentity,
  mihomo = false,
  exportProfile?: SubscriptionExportProfile
) {
  const fallbackGroupName = exportProfile?.proxyGroups[0]?.name || client.displayName || 'OU-UI Next';
  const document = {
    'mixed-port': 7890,
    'allow-lan': false,
    mode: 'rule',
    'log-level': 'info',
    proxies: nodes.map((node) => node.clashConfig ?? createClashProxyFromNode(node)),
    'proxy-groups': createProfileProxyGroups(exportProfile, nodes, fallbackGroupName),
    rules: ['MATCH,' + fallbackGroupName]
  };

  return `${mihomo ? '# mihomo-compatible subscription generated by OU-UI Next\n' : ''}${toYaml(document)}\n`;
}

function createClashProxyFromNode(node: SubscriptionInventoryNode) {
  return {
    name: node.name,
    type: node.protocol,
    server: node.server,
    port: node.port
  };
}

function createSingBoxTransport(proxy: Record<string, unknown>) {
  const network = readProxyString(proxy, 'network', 'tcp');

  if (network === 'ws') {
    const wsOptions = readProxyRecord(proxy, 'ws-opts') ?? {};
    const headers = readProxyRecord(wsOptions, 'headers');

    return compactRecord({
      type: 'ws',
      path: readProxyString(wsOptions, 'path', '/'),
      headers: headers && Object.keys(headers).length > 0 ? headers : undefined
    });
  }

  if (network === 'grpc') {
    const grpcOptions = readProxyRecord(proxy, 'grpc-opts') ?? {};

    return compactRecord({
      type: 'grpc',
      service_name: readProxyString(grpcOptions, 'grpc-service-name', readProxyString(grpcOptions, 'serviceName'))
    });
  }

  if (network === 'httpupgrade') {
    const httpupgradeOptions = readProxyRecord(proxy, 'httpupgrade-opts') ?? {};

    return compactRecord({
      type: 'httpupgrade',
      path: readProxyString(httpupgradeOptions, 'path', '/'),
      host: readProxyString(httpupgradeOptions, 'host')
    });
  }

  return undefined;
}

function createSingBoxTls(proxy: Record<string, unknown>) {
  const realityOptions = readProxyRecord(proxy, 'reality-opts');
  const fingerprint = readProxyString(
    proxy,
    'client-fingerprint',
    readProxyString(proxy, 'fingerprint', realityOptions ? 'chrome' : '')
  );

  if (proxy.tls !== true && !realityOptions) {
    return undefined;
  }

  return compactRecord({
    enabled: true,
    server_name: readProxyString(proxy, 'servername'),
    utls: fingerprint
      ? {
          enabled: true,
          fingerprint
        }
      : undefined,
    reality: realityOptions
      ? compactRecord({
          enabled: true,
          public_key: readProxyString(realityOptions, 'public-key'),
          short_id: readProxyString(realityOptions, 'short-id')
        })
      : undefined
  });
}

function renderSingBox(nodes: SubscriptionInventoryNode[]) {
  return JSON.stringify(
    {
      log: {
        level: 'info'
      },
      outbounds: [
        ...nodes.map((node) => {
          const proxy = node.clashConfig ?? {};
          const type = node.protocol === 'hysteria' ? 'hysteria2' : node.protocol;
          const outbound: Record<string, unknown> = {
            type,
            tag: node.name,
            server: node.server,
            server_port: node.port
          };

          if (type === 'vless' || type === 'vmess') {
            outbound.uuid = proxy.uuid;
            if (type === 'vless') {
              outbound.flow = proxy.flow;
            }
          } else if (type === 'shadowsocks') {
            outbound.method = proxy.cipher;
            outbound.password = proxy.password;
          } else {
            outbound.password = proxy.password;
          }

          outbound.tls = createSingBoxTls(proxy);
          outbound.transport = createSingBoxTransport(proxy);

          return outbound;
        }),
        {
          type: 'direct',
          tag: 'direct'
        }
      ]
    },
    null,
    2
  );
}

function tagValueMatches(tags: string[], prefix: string, candidates: Set<string>) {
  return tags.some((tag) => tag.startsWith(prefix) && candidates.has(normalizeIdentity(tag.slice(prefix.length))));
}

function localSubscriptionNodeMatchesClient(client: SubscriptionClientIdentity, node: SubscriptionInventoryNode) {
  if (!node.tags.includes('local-inbound')) {
    return true;
  }

  const candidates = new Set(
    [client.email, client.subId, client.id, client.customerName].map(normalizeIdentity).filter(Boolean)
  );

  if (candidates.size === 0) {
    return true;
  }

  const hasExplicitClientIdentity = node.tags.some(
    (tag) => tag.startsWith('client:') || tag.startsWith('client-id:') || tag.startsWith('sub:')
  );
  const explicitClientMatched =
    tagValueMatches(node.tags, 'client:', candidates) ||
    tagValueMatches(node.tags, 'client-id:', candidates) ||
    tagValueMatches(node.tags, 'sub:', candidates);

  if (hasExplicitClientIdentity) {
    return explicitClientMatched;
  }

  return tagValueMatches(node.tags, 'customer:', candidates);
}

export function selectPublicSubscriptionNodes(
  client: SubscriptionClientIdentity,
  inbounds: XrayInbound[],
  externalNodes: SubscriptionInventoryNode[] = [],
  exportProfile?: SubscriptionExportProfile
) {
  const nodes = [
    ...externalNodes,
    ...inbounds.flatMap(toSubscriptionNodes)
  ].filter((node) => localSubscriptionNodeMatchesClient(client, node));

  const clientNodes = selectSubscriptionInventoryNodes(nodes, {
    sourceIds: client.sourceIds,
    selectedTags: client.selectedTags,
    includeFilter: client.includeFilter,
    excludeFilter: client.excludeFilter,
    regionFilter: client.regionFilter,
    routingRule: client.routingRule,
    protocol: client.protocol,
    maxLatencyMs: client.maxLatencyMs,
    sortStrategy: client.sortStrategy
  });

  if (!exportProfile) {
    return clientNodes;
  }

  return selectSubscriptionInventoryNodes(clientNodes, {
    sourceIds: exportProfile.sourceIds,
    includeFilter: exportProfile.includeFilter,
    excludeFilter: exportProfile.excludeFilter,
    regionFilter: exportProfile.regionFilter,
    sortStrategy: client.sortStrategy
  });
}

export function projectSubscriptionClientRuntimeState({
  client,
  inbounds,
  externalNodes = [],
  exportProfile,
  nowIso = new Date().toISOString(),
  quotaResetBaseline
}: ProjectSubscriptionClientRuntimeStateInput): SubscriptionClientRuntimeProjection {
  const nodes = selectPublicSubscriptionNodes(client, inbounds, externalNodes, exportProfile);
  const matchedXrayClients = collectSelectedXrayClients(client, inbounds, nodes);
  const activeQuotaResetBaseline = quotaResetBaseline ?? readClientQuotaResetBaseline(client);
  const matchedUsedTrafficBytes = matchedXrayClients.reduce((total, inboundClient) => total + clampBytes(inboundClient.usedTrafficBytes), 0);
  const latestMatchedSampleAt = matchedXrayClients
    .map((inboundClient) => inboundClient.lastTrafficSampleAt)
    .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
    .sort((left, right) => right.localeCompare(left))[0];
  const resetAtMs = activeQuotaResetBaseline ? Date.parse(activeQuotaResetBaseline.resetAt) : Number.NaN;
  const latestMatchedSampleAtMs = latestMatchedSampleAt ? Date.parse(latestMatchedSampleAt) : Number.NaN;
  const nowMs = Date.parse(nowIso);
  const quotaResetIsActive = activeQuotaResetBaseline && Number.isFinite(resetAtMs) && (!Number.isFinite(nowMs) || resetAtMs <= nowMs);
  const beforeReset =
    quotaResetIsActive
    && (!latestMatchedSampleAt || !Number.isFinite(latestMatchedSampleAtMs) || latestMatchedSampleAtMs < resetAtMs);
  const usedTrafficBytes =
    matchedXrayClients.length > 0
      ? activeQuotaResetBaseline && quotaResetIsActive
        ? beforeReset
          ? 0
          : subtractBaseline(matchedUsedTrafficBytes, activeQuotaResetBaseline.baselineUsedTrafficBytes)
        : matchedUsedTrafficBytes
      : client.usedTrafficBytes;
  const quotaExceeded = client.trafficLimitBytes > 0 && clampBytes(usedTrafficBytes) >= clampBytes(client.trafficLimitBytes);
  const runtimeDisabledByPolicy = Boolean(client.runtimeDisabledByPolicy) && quotaExceeded;
  const guardrailReason =
    quotaExceeded && client.guardrailReason && client.guardrailReason !== 'ok'
      ? client.guardrailReason
      : quotaExceeded
        ? 'subscription_client_quota_exceeded'
        : 'ok';

  return {
    client: {
      ...client,
      usedTrafficBytes,
      generatedNodeCount: nodes.length,
      quotaResetAt: activeQuotaResetBaseline?.resetAt ?? client.quotaResetAt,
      quotaResetBaselineUsedTrafficBytes:
        activeQuotaResetBaseline?.baselineUsedTrafficBytes ?? client.quotaResetBaselineUsedTrafficBytes,
      quotaExceeded,
      runtimeDisabledByPolicy,
      guardrailReason
    },
    nodes,
    matchedXrayClientCount: matchedXrayClients.length
  };
}

function createTrafficHeaders(client: SubscriptionClientIdentity, nodeCount: number) {
  const expireSeconds = Math.max(Math.floor(Date.parse(client.expiresAt) / 1000), 0);

  return {
    'subscription-userinfo': [
      'upload=0',
      `download=${Math.max(client.usedTrafficBytes, 0)}`,
      `total=${Math.max(client.trafficLimitBytes, 0)}`,
      `expire=${expireSeconds}`
    ].join('; '),
    'profile-update-interval': '24',
    'x-ou-ui-node-count': String(nodeCount)
  };
}

export function isPublicSubscriptionFormat(value: string): value is PublicSubscriptionFormat {
  return ['uri', 'v2ray', 'clash', 'mihomo', 'sing-box'].includes(value);
}

export function renderPublicSubscriptionOutput({
  client,
  exportProfile,
  format,
  inbounds,
  externalNodes = []
}: RenderSubscriptionOutputInput): PublicSubscriptionOutput {
  const projection = projectSubscriptionClientRuntimeState({
    client,
    exportProfile,
    inbounds,
    externalNodes
  });
  const nodes = projection.nodes;
  const projectedClient = projection.client;
  const uriList = nodes.map(createRawUrlFromExternalNode).filter((url): url is string => Boolean(url));
  const uriBody = uriList.join('\n');
  const headers =
    exportProfile?.includeTrafficHeaders === false
      ? { 'x-ou-ui-node-count': String(nodes.length) }
      : createTrafficHeaders(projectedClient, nodes.length);

  if (format === 'v2ray') {
    return {
      body: encodeBase64(uriBody),
      contentType: 'text/plain; charset=utf-8',
      headers,
      nodeCount: nodes.length
    };
  }

  if (format === 'clash' || format === 'mihomo') {
    return {
      body: renderClash(nodes, projectedClient, format === 'mihomo', exportProfile),
      contentType: 'text/yaml; charset=utf-8',
      headers,
      nodeCount: nodes.length
    };
  }

  if (format === 'sing-box') {
    return {
      body: renderSingBox(nodes),
      contentType: 'application/json; charset=utf-8',
      headers,
      nodeCount: nodes.length
    };
  }

  return {
    body: uriBody,
    contentType: 'text/plain; charset=utf-8',
    headers,
    nodeCount: nodes.length
  };
}
