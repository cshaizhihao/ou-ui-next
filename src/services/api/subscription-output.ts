import type { SubscriptionClientIdentity, SubscriptionInventoryNode, XrayInbound } from '../../domain';
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
};

function encodeBase64(value: string) {
  return Buffer.from(value, 'utf8').toString('base64');
}

function encodeTag(value: string) {
  return encodeURIComponent(value).replace(/%20/g, '+');
}

function readServerAddress(inbound: XrayInbound) {
  const candidate = inbound.serverAddress?.trim() || inbound.streamSettings.sni?.trim() || inbound.listenAddress.trim();

  if (candidate === '0.0.0.0' || candidate === '::') {
    return inbound.agentId || inbound.nodeId;
  }

  return candidate;
}

function readCredential(inbound: XrayInbound) {
  const client = inbound.clients[0];
  return client?.password || client?.auth || inbound.clientIdentity || client?.id || '';
}

function createTransportQuery(inbound: XrayInbound) {
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

  if (inbound.flow && inbound.protocol === 'vless') {
    query.set('flow', inbound.flow);
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

function createRawUrl(inbound: XrayInbound) {
  const client = inbound.clients[0];
  const server = readServerAddress(inbound);
  const port = inbound.listenPort;
  const credential = readCredential(inbound);
  const tag = encodeTag(inbound.label);
  const query = createTransportQuery(inbound);

  if (!credential || !client?.enabled) {
    return undefined;
  }

  if (inbound.protocol === 'vmess') {
    return `vmess://${encodeBase64(
      JSON.stringify({
        v: '2',
        ps: inbound.label,
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

function toSubscriptionNode(inbound: XrayInbound): SubscriptionInventoryNode | undefined {
  const rawUrl = createRawUrl(inbound);

  if (!rawUrl || inbound.status === 'disabled') {
    return undefined;
  }

  const server = readServerAddress(inbound);
  const tags = [
    'local-inbound',
    inbound.protocol,
    inbound.agentId ? `agent:${inbound.agentId}` : '',
    inbound.customerName ? `customer:${inbound.customerName}` : '',
    inbound.subscriptionRule || '',
    inbound.streamSettings.security,
    inbound.streamSettings.network
  ].filter(Boolean);

  return {
    id: inbound.id,
    sourceId: inbound.agentId ? `local:${inbound.agentId}` : 'local-inbounds',
    name: inbound.label,
    protocol: inbound.protocol,
    server,
    port: inbound.listenPort,
    latencyMs: 0,
    tags,
    rawUrl,
    clashConfig: createClashProxy(inbound),
    inboundTag: inbound.id,
    probeAgentId: inbound.agentId
  };
}

function createClashProxy(inbound: XrayInbound): Record<string, unknown> {
  const client = inbound.clients[0];
  const server = readServerAddress(inbound);
  const credential = readCredential(inbound);
  const base: Record<string, unknown> = {
    name: inbound.label,
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

function renderClash(nodes: SubscriptionInventoryNode[], client: SubscriptionClientIdentity, mihomo = false) {
  const proxyNames = nodes.map((node) => node.name);
  const document = {
    'mixed-port': 7890,
    'allow-lan': false,
    mode: 'rule',
    'log-level': 'info',
    proxies: nodes.map((node) => node.clashConfig ?? createClashProxyFromNode(node)),
    'proxy-groups': [
      {
        name: client.displayName || 'OU-UI Next',
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
    ],
    rules: ['MATCH,' + (client.displayName || 'OU-UI Next')]
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
          } else if (type === 'shadowsocks') {
            outbound.method = proxy.cipher;
            outbound.password = proxy.password;
          } else {
            outbound.password = proxy.password;
          }

          if (proxy.tls) {
            outbound.tls = {
              enabled: true,
              server_name: proxy.servername,
              reality: proxy['reality-opts']
                ? {
                    enabled: true,
                    public_key: (proxy['reality-opts'] as Record<string, unknown>)['public-key'],
                    short_id: (proxy['reality-opts'] as Record<string, unknown>)['short-id']
                  }
                : undefined
            };
          }

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

function selectClientNodes(client: SubscriptionClientIdentity, inbounds: XrayInbound[], externalNodes: SubscriptionInventoryNode[] = []) {
  const nodes = [
    ...externalNodes,
    ...inbounds.map(toSubscriptionNode).filter((node): node is SubscriptionInventoryNode => Boolean(node))
  ];

  return selectSubscriptionInventoryNodes(nodes, {
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
  format,
  inbounds,
  externalNodes = []
}: RenderSubscriptionOutputInput): PublicSubscriptionOutput {
  const nodes = selectClientNodes(client, inbounds, externalNodes);
  const uriList = nodes.map((node) => node.rawUrl).filter((url): url is string => Boolean(url));
  const uriBody = uriList.join('\n');
  const headers = createTrafficHeaders(client, nodes.length);

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
      body: renderClash(nodes, client, format === 'mihomo'),
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
