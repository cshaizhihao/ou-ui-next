import type { ProxyGroupTemplate, SubscriptionInventoryNode, SubscriptionProducerFormat } from './subscription';
import { selectSubscriptionInventoryNodes } from './subscription-rules';

export type SubscriptionProducerId = SubscriptionProducerFormat;

export type SubscriptionProducerKind = 'uri-list' | 'base64-uri-list' | 'clash-yaml' | 'sing-box-json';

export type SubscriptionProducer = {
  id: SubscriptionProducerId;
  label: string;
  format: SubscriptionProducerFormat;
  kind: SubscriptionProducerKind;
  aliases: string[];
  contentType: string;
};

export type SubscriptionOutputFormatAlias = SubscriptionProducerFormat | 'plain' | 'json';

export type SubscriptionTemplateInstruction =
  | { type: 'include-all' }
  | { type: 'include-region-proxy-groups'; regions: string[] }
  | { type: 'filter'; value: string }
  | { type: 'exclude-filter'; value: string }
  | { type: 'provider-marker'; value: string };

export type SubscriptionTemplateDefinition = {
  id: string;
  name: string;
  instructions: SubscriptionTemplateInstruction[];
};

export type AppliedSubscriptionTemplate = {
  nodes: SubscriptionInventoryNode[];
  proxyGroups: ProxyGroupTemplate[];
  providerMarkers: string[];
};

const subscriptionProducers: SubscriptionProducer[] = [
  {
    id: 'uri',
    label: 'URI',
    format: 'uri',
    kind: 'uri-list',
    aliases: ['plain', 'raw-uri'],
    contentType: 'text/plain; charset=utf-8'
  },
  {
    id: 'v2ray',
    label: 'V2Ray',
    format: 'v2ray',
    kind: 'base64-uri-list',
    aliases: ['json'],
    contentType: 'text/plain; charset=utf-8'
  },
  {
    id: 'clash',
    label: 'Clash',
    format: 'clash',
    kind: 'clash-yaml',
    aliases: ['clash-meta'],
    contentType: 'text/yaml; charset=utf-8'
  },
  {
    id: 'mihomo',
    label: 'Mihomo',
    format: 'mihomo',
    kind: 'clash-yaml',
    aliases: ['clash-meta-compatible'],
    contentType: 'text/yaml; charset=utf-8'
  },
  {
    id: 'sing-box',
    label: 'Sing-box',
    format: 'sing-box',
    kind: 'sing-box-json',
    aliases: ['singbox'],
    contentType: 'application/json; charset=utf-8'
  },
  {
    id: 'shadowrocket',
    label: 'Shadowrocket',
    format: 'shadowrocket',
    kind: 'uri-list',
    aliases: ['shadowrocket-uri'],
    contentType: 'text/plain; charset=utf-8'
  },
  {
    id: 'stash',
    label: 'Stash',
    format: 'stash',
    kind: 'clash-yaml',
    aliases: ['stash-yaml'],
    contentType: 'text/yaml; charset=utf-8'
  }
];

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function formatRegionName(region: string) {
  const normalized = normalize(region);
  return normalized ? normalized.toUpperCase() : 'GLOBAL';
}

function createRegionProxyGroup(region: string): ProxyGroupTemplate {
  const normalized = normalize(region);

  return {
    id: `template-region-${normalized || 'global'}`,
    name: formatRegionName(region),
    strategy: 'select',
    filterTags: [`region:${normalized}`, `geo:${normalized}`]
  };
}

export function listSubscriptionProducers() {
  return subscriptionProducers;
}

export function getSubscriptionProducer(format: string) {
  const normalized = normalize(format);

  return subscriptionProducers.find(
    (producer) => producer.id === normalized || producer.aliases.some((alias) => normalize(alias) === normalized)
  );
}

export function resolveSubscriptionOutputFormatAlias(format: string): SubscriptionProducerFormat | undefined {
  return getSubscriptionProducer(format)?.format;
}

export function applySubscriptionTemplate(
  template: SubscriptionTemplateDefinition,
  nodes: SubscriptionInventoryNode[]
): AppliedSubscriptionTemplate {
  let selectedNodes = nodes;
  let includeFilter = '';
  let excludeFilter = '';
  const proxyGroups: ProxyGroupTemplate[] = [];
  const providerMarkers: string[] = [];

  for (const instruction of template.instructions) {
    if (instruction.type === 'include-all') {
      selectedNodes = nodes;
      includeFilter = '';
      excludeFilter = '';
    } else if (instruction.type === 'filter') {
      includeFilter = instruction.value;
    } else if (instruction.type === 'exclude-filter') {
      excludeFilter = instruction.value;
    } else if (instruction.type === 'include-region-proxy-groups') {
      proxyGroups.push(...instruction.regions.map(createRegionProxyGroup));
    } else if (instruction.type === 'provider-marker') {
      providerMarkers.push(instruction.value);
    }
  }

  return {
    nodes: selectSubscriptionInventoryNodes(selectedNodes, {
      includeFilter,
      excludeFilter,
      sortStrategy: 'manual'
    }),
    proxyGroups,
    providerMarkers
  };
}
