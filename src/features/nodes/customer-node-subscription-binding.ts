import type { SubscriptionClientFormat } from '../../domain';
import {
  isXrayRuntimeProtocol,
  type XrayInbound
} from '../../domain/protocol';
import type { XrayClientAction } from '../../services/api/xray-client-action-tasks';
import type { SubscriptionClientRuleMetadata } from '../subscriptions/subscription-mixer-page';
import type { CustomerNodeConfigMetadata } from './nodes-page';

function createStableSlug(value: string, fallback: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || fallback;
}

function createStableHash(value: string) {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(36).padStart(7, '0');
}

function createStableSecret(value: string, length: number) {
  let output = '';
  let index = 0;

  while (output.length < length) {
    output += createStableHash(`${value}:${index}`);
    index += 1;
  }

  return output.slice(0, length);
}

function roundNonNegative(value: number | undefined, fallback = 0) {
  return Number.isFinite(value) ? Math.max(Math.round(value ?? fallback), 0) : fallback;
}

function clampResetDay(value: number | undefined) {
  return Math.min(Math.max(roundNonNegative(value, 1), 1), 31);
}

function slugClientIdentity(value: string, fallback: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_.@-]+/g, '-').replace(/^-|-$/g, '') || fallback;
}

function createAddedClientIdentity(action: Extract<XrayClientAction, { kind: 'add-client' }>) {
  const explicitIdentity = action.clientIdentity?.trim();

  if (explicitIdentity) {
    return explicitIdentity;
  }

  const email = action.clientEmail.trim();
  const emailLocalPart = email.split('@')[0] ?? '';

  return `client-${slugClientIdentity(emailLocalPart || email, createStableHash(email))}`;
}

function createRemainingDays(action: Extract<XrayClientAction, { kind: 'add-client' }>, observedAt: string) {
  const fallbackDays = roundNonNegative(action.remainingDays, 30);
  const expiresAtMs = Date.parse(action.expiresAt ?? '');
  const observedAtMs = Date.parse(observedAt);

  if (!Number.isNaN(expiresAtMs) && !Number.isNaN(observedAtMs)) {
    return Math.max(Math.ceil((expiresAtMs - observedAtMs) / 24 / 60 / 60 / 1000), 0);
  }

  return fallbackDays;
}

const customerNodeOutputFormats: SubscriptionClientRuleMetadata['outputFormats'] = [
  'uri',
  'v2ray',
  'clash',
  'mihomo',
  'sing-box',
  'shadowrocket',
  'stash'
];
const customerNodeLegacyFormats: SubscriptionClientFormat[] = ['plain', 'json', 'clash', 'mihomo', 'sing-box'];

export function createCustomerNodeSubscriptionMetadata(
  metadata: CustomerNodeConfigMetadata,
  publicBaseUrl: string
): SubscriptionClientRuleMetadata {
  const outputFormats = customerNodeOutputFormats;
  const formats = customerNodeLegacyFormats;
  const subId = metadata.subId || metadata.subscriptionRule || metadata.clientIdentity;
  const subscriptionClientId =
    metadata.subscriptionClientId || `sub-client-${createStableSlug(`${metadata.customerName}-${subId}`, 'customer-node')}`;
  const securePathPreview =
    metadata.securePathPreview || `/${createStableSecret(`${subscriptionClientId}:${subId}:secure-path`, 24)}`;
  const tokenPreview = `ou_${createStableSecret(`${subscriptionClientId}:${subId}:token`, 10)}`;
  const createSubscriptionUrl = (format: keyof SubscriptionClientRuleMetadata['subscriptionUrlPreview']) =>
    `${publicBaseUrl}/sub${securePathPreview}/${format}/${encodeURIComponent(subId)}`;
  const subscriptionUrlPreview = {
    uri: metadata.subscriptionUrlPreview?.uri || createSubscriptionUrl('uri'),
    v2ray: metadata.subscriptionUrlPreview?.v2ray || createSubscriptionUrl('v2ray'),
    clash: metadata.subscriptionUrlPreview?.clash || createSubscriptionUrl('clash'),
    mihomo: metadata.subscriptionUrlPreview?.mihomo || createSubscriptionUrl('mihomo'),
    'sing-box': metadata.subscriptionUrlPreview?.['sing-box'] || createSubscriptionUrl('sing-box'),
    shadowrocket: metadata.subscriptionUrlPreview?.shadowrocket || createSubscriptionUrl('shadowrocket'),
    stash: metadata.subscriptionUrlPreview?.stash || createSubscriptionUrl('stash')
  };

  return {
    subscriptionClientId,
    customerName: metadata.customerName,
    ruleName: `${metadata.customerName} subscription`,
    displayName: `${metadata.customerName} subscription`,
    subId,
    email: metadata.clientEmail,
    protocol: metadata.xrayProtocol,
    group: metadata.agentId,
    trafficLimitGb: metadata.trafficLimitGb,
    usedTrafficGb: metadata.currentUsedTrafficGb,
    remainingDays: metadata.remainingDays,
    ipLimit: metadata.ipLimit,
    requestLimitPerHour: 360,
    sourceIds: [],
    selectedTags: [],
    includeFilter: '',
    excludeFilter: '',
    regionFilter: [],
    routingRule: metadata.subscriptionRule,
    trafficFilter: '',
    maxLatencyMs: 0,
    sortStrategy: 'latency',
    formats,
    outputFormats,
    templateName: 'mihomo-compatible.yaml',
    enabled: metadata.enabled ?? true,
    generatedNodeCount: 1,
    accessTokenPreview: tokenPreview,
    securePathPreview,
    subscriptionUrlPreview,
    clientRule: {
      protocolFilter: metadata.xrayProtocol,
      sourceIds: [],
      tagFilter: [],
      regionFilter: [],
      includeFilter: '',
      excludeFilter: '',
      routingRule: metadata.subscriptionRule,
      trafficFilter: '',
      maxLatencyMs: 0,
      sortStrategy: 'latency',
      outputFormats,
      trafficConstraint: {
        limitGb: metadata.trafficLimitGb,
        usedGb: metadata.currentUsedTrafficGb,
        remainingDays: metadata.remainingDays,
        ipLimit: metadata.ipLimit,
        requestLimitPerHour: 360
      },
      access: {
        subId,
        tokenPreview,
        securePathPreview
      }
    }
  };
}

export function createAddedCustomerNodeClientSubscriptionMetadata(input: {
  inbound: XrayInbound;
  action: Extract<XrayClientAction, { kind: 'add-client' }>;
  publicBaseUrl: string;
  observedAt?: string;
}): SubscriptionClientRuleMetadata {
  if (!isXrayRuntimeProtocol(input.inbound.protocol)) {
    throw new Error(`Unsupported Xray inbound protocol: ${input.inbound.protocol}`);
  }

  const observedAt = input.observedAt ?? new Date().toISOString();
  const clientIdentity = createAddedClientIdentity(input.action);
  const clientEmail = input.action.clientEmail.trim();
  const clientCredential = input.action.clientCredential?.trim() || clientIdentity;
  const baseSubscriptionRule = input.inbound.subscriptionRule?.trim() || 'manual';
  const subscriptionRule = input.action.subscriptionRule?.trim() || `${baseSubscriptionRule}:${clientIdentity}`;
  const trafficLimitGb = roundNonNegative(input.action.trafficLimitGb, 100);
  const currentUsedTrafficGb = Math.max(input.action.currentUsedTrafficGb ?? 0, 0);
  const remainingDays = createRemainingDays(input.action, observedAt);
  const quotaExceeded = trafficLimitGb > 0 && currentUsedTrafficGb >= trafficLimitGb;
  const clientExpired = remainingDays <= 0;
  const customerName = input.action.clientComment?.trim() || clientEmail;
  const fallback = input.inbound.fallbacks[0];

  return createCustomerNodeSubscriptionMetadata(
    {
      nodeId: input.inbound.id,
      agentId: input.inbound.agentId ?? input.inbound.nodeId,
      customerNodeName: `${input.inbound.label} / ${customerName}`,
      customerName,
      serverAddress: input.inbound.serverAddress ?? '',
      xrayProtocol: input.inbound.protocol,
      listenPort: input.inbound.listenPort,
      clientIdentity,
      clientEmail,
      clientCredential,
      clientLevel: roundNonNegative(input.action.clientLevel, 0),
      clientComment: input.action.clientComment?.trim() ?? '',
      telegramId: input.action.telegramId?.trim() ?? '',
      resetPolicy: input.action.resetPolicy ?? 'monthly',
      vmessSecurity: input.action.vmessSecurity?.trim() || 'auto',
      shadowsocksMethod: input.action.shadowsocksMethod?.trim() || '2022-blake3-aes-128-gcm',
      hysteriaAuth: input.action.hysteriaAuth?.trim() || clientCredential,
      streamNetwork: input.inbound.streamSettings.network,
      security: input.inbound.streamSettings.security,
      sni: input.inbound.streamSettings.sni ?? input.inbound.reality.serverNames[0] ?? '',
      path: input.inbound.streamSettings.path ?? input.inbound.streamSettings.serviceName ?? input.inbound.path ?? '',
      flow: input.action.flow?.trim() || input.inbound.flow || '',
      fingerprint: input.inbound.streamSettings.fingerprint ?? input.inbound.reality.fingerprint ?? 'chrome',
      alpn: input.inbound.tls.alpn,
      realityPublicKey: input.inbound.reality.publicKey ?? '',
      realityPrivateKey: input.inbound.reality.privateKey ?? '',
      realityTarget: input.inbound.reality.target ?? '',
      realityShortId: input.inbound.reality.shortIds[0] ?? '',
      fallbackName: fallback?.name ?? '',
      fallbackDestination: fallback?.destination ?? '',
      fallbackXver: fallback?.xver ?? 0,
      sniffingEnabled: input.inbound.sniffingEnabled,
      ipLimit: roundNonNegative(input.action.ipLimit, 0),
      trafficMultiplier: input.action.trafficMultiplier ?? 1,
      trafficLimitGb,
      monthlyResetDay: clampResetDay(input.action.monthlyResetDay),
      currentUsedTrafficGb,
      remainingDays,
      expiresAt: input.action.expiresAt,
      quotaExceeded,
      clientExpired,
      runtimeDisabledByPolicy: quotaExceeded || clientExpired,
      guardrailReason: clientExpired
        ? 'xray_client_expired'
        : quotaExceeded
          ? 'xray_client_monthly_quota_exceeded'
          : 'ok',
      subscriptionRule,
      subId: subscriptionRule,
      enabled: (input.action.enabled ?? true) && !quotaExceeded && !clientExpired
    },
    input.publicBaseUrl
  );
}

export function createCustomerNodeAllSubscriptionText(metadata: SubscriptionClientRuleMetadata) {
  const entries: Array<[string, keyof SubscriptionClientRuleMetadata['subscriptionUrlPreview']]> = [
    ['URI', 'uri'],
    ['V2Ray JSON', 'v2ray'],
    ['Clash', 'clash'],
    ['Mihomo', 'mihomo'],
    ['Sing-box', 'sing-box'],
    ['Shadowrocket', 'shadowrocket'],
    ['Stash', 'stash']
  ];

  return entries.map(([label, format]) => `${label}: ${metadata.subscriptionUrlPreview[format]}`).join('\n');
}
