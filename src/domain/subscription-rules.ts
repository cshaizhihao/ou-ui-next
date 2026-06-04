import type { SubscriptionClientSortStrategy, SubscriptionInventoryNode, SubscriptionSource } from './subscription';

export type SubscriptionSourceRuleSet = {
  includeFilter?: string;
  excludeFilter?: string;
  dedupeKey?: SubscriptionSource['dedupeKey'];
};

export type SubscriptionClientRuleSet = {
  sourceIds?: string[];
  selectedTags?: string[];
  includeFilter?: string;
  excludeFilter?: string;
  regionFilter?: string[];
  routingRule?: string;
  protocol?: string;
  maxLatencyMs?: number;
  sortStrategy?: SubscriptionClientSortStrategy;
};

function normalize(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

function splitKeywords(filter: string | undefined) {
  return (filter ?? '')
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean);
}

function matchesKeyword(value: string, keyword: string) {
  if (!keyword) return false;

  try {
    return new RegExp(keyword, 'i').test(value);
  } catch {
    return normalize(value).includes(normalize(keyword));
  }
}

function createSearchText(node: SubscriptionInventoryNode) {
  return [
    node.name,
    node.protocol,
    node.server,
    node.port,
    node.sourceId,
    node.status,
    node.customerName,
    node.hostId,
    node.hostName,
    node.probeAgentId,
    node.usedTrafficBytes,
    node.trafficLimitBytes,
    node.rawUrl,
    node.inboundTag,
    ...(node.tags ?? [])
  ].join(' ');
}

function readClashConfigIdentity(node: SubscriptionInventoryNode) {
  const config = node.clashConfig;

  if (!config) return undefined;

  for (const key of ['uuid', 'id', 'password', 'cipher']) {
    const value = config[key];

    if (typeof value === 'string' && value.trim() !== '') {
      return value;
    }
  }

  return undefined;
}

export function resolveSubscriptionInventoryDedupeKey(
  node: SubscriptionInventoryNode,
  dedupeKey: SubscriptionSource['dedupeKey']
) {
  if (dedupeKey === 'uuid') {
    return normalize(readClashConfigIdentity(node) ?? node.rawUrl ?? node.name);
  }

  if (dedupeKey === 'name-region') {
    const regionTag = node.tags.find((tag) => /^region:|^geo:/.test(tag)) ?? node.tags[0] ?? 'global';
    return `${normalize(node.name)}:${normalize(regionTag)}`;
  }

  return `${normalize(node.server)}:${node.port}`;
}

export function countCrossSourceSubscriptionInventoryDuplicates(
  nodes: SubscriptionInventoryNode[],
  existingNodes: SubscriptionInventoryNode[],
  dedupeKey: SubscriptionSource['dedupeKey'] = 'server-port'
) {
  const existingKeys = new Set(existingNodes.map((node) => resolveSubscriptionInventoryDedupeKey(node, dedupeKey)));

  return nodes.filter((node) => existingKeys.has(resolveSubscriptionInventoryDedupeKey(node, dedupeKey))).length;
}

function matchesSourceFilters(node: SubscriptionInventoryNode, rules: SubscriptionSourceRuleSet) {
  const searchText = createSearchText(node);
  const includes = splitKeywords(rules.includeFilter);
  const excludes = splitKeywords(rules.excludeFilter);
  const includeMatched = includes.length === 0 || includes.some((keyword) => matchesKeyword(searchText, keyword));
  const excludeMatched = excludes.some((keyword) => matchesKeyword(searchText, keyword));

  return includeMatched && !excludeMatched;
}

function parseTrafficBytes(value: string) {
  const match = /^(\d+(?:\.\d+)?)(b|kb|mb|gb|tb)?$/i.exec(value.trim());

  if (!match) return undefined;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return undefined;

  const unit = normalize(match[2] ?? 'b');
  const multiplier =
    unit === 'tb'
      ? 1024 ** 4
      : unit === 'gb'
        ? 1024 ** 3
        : unit === 'mb'
          ? 1024 ** 2
          : unit === 'kb'
            ? 1024
            : 1;

  return amount * multiplier;
}

function compareTrafficBytes(usedTrafficBytes: number, expression: string) {
  const match = /^(>=|<=|>|<|=)?(.+)$/.exec(expression.trim());

  if (!match) return false;

  const operator = match[1] ?? '=';
  const expectedBytes = parseTrafficBytes(match[2]);

  if (expectedBytes === undefined) return false;

  if (operator === '>') return usedTrafficBytes > expectedBytes;
  if (operator === '>=') return usedTrafficBytes >= expectedBytes;
  if (operator === '<') return usedTrafficBytes < expectedBytes;
  if (operator === '<=') return usedTrafficBytes <= expectedBytes;
  return usedTrafficBytes === expectedBytes;
}

function matchesTrafficRule(node: SubscriptionInventoryNode, value: string) {
  const normalizedValue = normalize(value);
  const usedTrafficBytes = Math.max(node.usedTrafficBytes ?? 0, 0);
  const trafficLimitBytes = Math.max(node.trafficLimitBytes ?? 0, 0);
  const quotaExceeded = trafficLimitBytes > 0 && usedTrafficBytes >= trafficLimitBytes;
  const ratio = trafficLimitBytes > 0 ? usedTrafficBytes / trafficLimitBytes : 0;

  if (['quota-exceeded', 'over-quota', 'exceeded'].includes(normalizedValue)) {
    return quotaExceeded;
  }

  if (['available', 'under-quota'].includes(normalizedValue)) {
    return !quotaExceeded;
  }

  if (normalizedValue === 'limited') {
    return trafficLimitBytes > 0;
  }

  if (normalizedValue === 'unlimited') {
    return trafficLimitBytes <= 0;
  }

  if (normalizedValue === 'high') {
    return trafficLimitBytes > 0 && ratio >= 0.8;
  }

  if (normalizedValue === 'low') {
    return trafficLimitBytes > 0 && ratio < 0.5;
  }

  return compareTrafficBytes(usedTrafficBytes, normalizedValue);
}

function matchesHostRule(node: SubscriptionInventoryNode, value: string) {
  const candidates = [
    node.hostId,
    node.hostName,
    node.probeAgentId,
    node.sourceId,
    ...node.tags.filter((tag) => normalize(tag).startsWith('agent:'))
  ];

  return candidates.some((candidate) => normalize(candidate).includes(value));
}

function matchesCustomerRule(node: SubscriptionInventoryNode, value: string) {
  const candidates = [
    node.customerName,
    ...node.tags.filter((tag) => normalize(tag).startsWith('customer:'))
  ];

  return candidates.some((candidate) => normalize(candidate).includes(value));
}

function matchesRuleToken(node: SubscriptionInventoryNode, token: string) {
  const isNegated = token.startsWith('!');
  const normalizedToken = isNegated ? token.slice(1).trim() : token;
  const [rawField, ...rawValueParts] = normalizedToken.split(':');
  const field = normalize(rawField);
  const value = normalize(rawValueParts.join(':'));

  if (!field || !value) return true;

  const matched =
    field === 'tag'
      ? node.tags.some((tag) => normalize(tag) === value || normalize(tag).includes(value))
      : field === 'protocol'
        ? normalize(node.protocol) === value
        : field === 'source'
          ? normalize(node.sourceId) === value
          : field === 'host' || field === 'agent'
            ? matchesHostRule(node, value)
            : field === 'status'
              ? normalize(node.status ?? 'unknown') === value
              : field === 'customer'
                ? matchesCustomerRule(node, value)
                : field === 'traffic'
                  ? matchesTrafficRule(node, value)
                  : field === 'name'
                    ? normalize(node.name).includes(value)
                    : field === 'server'
                      ? normalize(node.server).includes(value)
                      : matchesKeyword(createSearchText(node), normalizedToken);

  return isNegated ? !matched : matched;
}

function matchesRoutingRule(node: SubscriptionInventoryNode, routingRule: string | undefined) {
  const expression = routingRule?.trim();

  if (!expression) return true;

  return expression.split(/\s+OR\s+/i).some((orPart) =>
    orPart
      .split(/\s+AND\s+/i)
      .map((token) => token.trim())
      .filter(Boolean)
      .every((token) => matchesRuleToken(node, token))
  );
}

function matchesClientFilters(node: SubscriptionInventoryNode, rules: SubscriptionClientRuleSet) {
  const sourceIds = (rules.sourceIds ?? []).map(normalize).filter(Boolean);
  const regions = (rules.regionFilter ?? []).map(normalize).filter(Boolean);
  const maxLatencyMs = rules.maxLatencyMs ?? 0;
  const sourceMatched = sourceIds.length === 0 || sourceIds.includes(normalize(node.sourceId));
  const regionMatched =
    regions.length === 0 ||
    regions.some((region) =>
      node.tags.some((tag) => {
        const normalizedTag = normalize(tag);
        return normalizedTag === region || normalizedTag === `region:${region}` || normalizedTag === `geo:${region}`;
      })
    );
  const latencyMatched = maxLatencyMs <= 0 || node.latencyMs <= maxLatencyMs;

  return (
    sourceMatched &&
    regionMatched &&
    latencyMatched &&
    matchesSourceFilters(node, {
      includeFilter: rules.includeFilter,
      excludeFilter: rules.excludeFilter
    })
  );
}

function sortClientNodes(nodes: SubscriptionInventoryNode[], sortStrategy: SubscriptionClientSortStrategy | undefined) {
  const strategy = sortStrategy ?? 'latency';
  const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

  if (strategy === 'manual') {
    return nodes;
  }

  return [...nodes].sort((left, right) => {
    if (strategy === 'name') {
      return collator.compare(left.name, right.name);
    }

    if (strategy === 'region') {
      const leftRegion = left.tags.find((tag) => /^region:|^geo:/.test(tag)) ?? '';
      const rightRegion = right.tags.find((tag) => /^region:|^geo:/.test(tag)) ?? '';
      return collator.compare(leftRegion, rightRegion) || left.latencyMs - right.latencyMs;
    }

    return left.latencyMs - right.latencyMs;
  });
}

export function dedupeSubscriptionInventoryNodes(
  nodes: SubscriptionInventoryNode[],
  dedupeKey: SubscriptionSource['dedupeKey'] = 'server-port'
) {
  const seen = new Set<string>();

  return nodes.filter((node) => {
    const key = resolveSubscriptionInventoryDedupeKey(node, dedupeKey);

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

export function applySubscriptionSourceRules(nodes: SubscriptionInventoryNode[], rules: SubscriptionSourceRuleSet = {}) {
  return dedupeSubscriptionInventoryNodes(
    nodes.filter((node) => matchesSourceFilters(node, rules)),
    rules.dedupeKey ?? 'server-port'
  );
}

export function selectSubscriptionInventoryNodes(nodes: SubscriptionInventoryNode[], rules: SubscriptionClientRuleSet = {}) {
  const selectedTags = (rules.selectedTags ?? []).map(normalize).filter(Boolean);
  const protocol = normalize(rules.protocol);

  return sortClientNodes(
    nodes.filter((node) => {
      const protocolMatched = !protocol || normalize(node.protocol) === protocol;
      const tagMatched =
        selectedTags.length === 0 ||
        selectedTags.every((selectedTag) => node.tags.some((nodeTag) => normalize(nodeTag).includes(selectedTag)));

      return protocolMatched && tagMatched && matchesClientFilters(node, rules) && matchesRoutingRule(node, rules.routingRule);
    }),
    rules.sortStrategy
  );
}
