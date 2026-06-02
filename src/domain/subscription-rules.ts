import type { SubscriptionInventoryNode, SubscriptionSource } from './subscription';

export type SubscriptionSourceRuleSet = {
  includeFilter?: string;
  excludeFilter?: string;
  dedupeKey?: SubscriptionSource['dedupeKey'];
};

export type SubscriptionClientRuleSet = {
  selectedTags?: string[];
  routingRule?: string;
  protocol?: string;
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

function resolveDedupeKey(node: SubscriptionInventoryNode, dedupeKey: SubscriptionSource['dedupeKey']) {
  if (dedupeKey === 'uuid') {
    return normalize(readClashConfigIdentity(node) ?? node.rawUrl ?? node.name);
  }

  if (dedupeKey === 'name-region') {
    const regionTag = node.tags.find((tag) => /^region:|^geo:/.test(tag)) ?? node.tags[0] ?? 'global';
    return `${normalize(node.name)}:${normalize(regionTag)}`;
  }

  return `${normalize(node.server)}:${node.port}`;
}

function matchesSourceFilters(node: SubscriptionInventoryNode, rules: SubscriptionSourceRuleSet) {
  const searchText = createSearchText(node);
  const includes = splitKeywords(rules.includeFilter);
  const excludes = splitKeywords(rules.excludeFilter);
  const includeMatched = includes.length === 0 || includes.some((keyword) => matchesKeyword(searchText, keyword));
  const excludeMatched = excludes.some((keyword) => matchesKeyword(searchText, keyword));

  return includeMatched && !excludeMatched;
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

export function dedupeSubscriptionInventoryNodes(
  nodes: SubscriptionInventoryNode[],
  dedupeKey: SubscriptionSource['dedupeKey'] = 'server-port'
) {
  const seen = new Set<string>();

  return nodes.filter((node) => {
    const key = resolveDedupeKey(node, dedupeKey);

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

  return nodes.filter((node) => {
    const protocolMatched = !protocol || normalize(node.protocol) === protocol;
    const tagMatched =
      selectedTags.length === 0 ||
      selectedTags.every((selectedTag) => node.tags.some((nodeTag) => normalize(nodeTag).includes(selectedTag)));

    return protocolMatched && tagMatched && matchesRoutingRule(node, rules.routingRule);
  });
}
