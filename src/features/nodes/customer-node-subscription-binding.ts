import type { SubscriptionClientFormat } from '../../domain';
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
