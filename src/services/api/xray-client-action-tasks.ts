import type { XrayClient, XrayClientResetPolicy, XrayInbound } from '../../domain/protocol';
import type { CreateTaskInput } from '../../domain/task';

export type XrayClientAction =
  | {
      kind: 'add-client';
      clientIdentity?: string;
      clientEmail: string;
      clientCredential?: string;
      clientLevel?: number;
      clientComment?: string;
      telegramId?: string;
      resetPolicy?: XrayClientResetPolicy;
      vmessSecurity?: string;
      shadowsocksMethod?: string;
      hysteriaAuth?: string;
      flow?: string;
      ipLimit?: number;
      trafficMultiplier?: XrayClient['trafficMultiplier'];
      trafficLimitGb?: number;
      monthlyResetDay?: number;
      currentUsedTrafficGb?: number;
      remainingDays?: number;
      expiresAt?: string;
      subscriptionRule?: string;
      enabled?: boolean;
    }
  | { kind: 'set-enabled'; enabled: boolean }
  | { kind: 'add-traffic'; addedTrafficGb: number }
  | { kind: 'set-traffic-limit'; trafficLimitGb: number }
  | { kind: 'reset-used-traffic' }
  | { kind: 'renew'; addedDays: number }
  | { kind: 'set-reset-policy'; resetPolicy: XrayClientResetPolicy }
  | { kind: 'set-ip-limit'; ipLimit: number }
  | { kind: 'delete-client' };

export type XrayClientActionRequest = {
  inboundId: string;
  clientId?: string;
  clientEmail?: string;
  action: XrayClientAction;
  reason?: string;
  observedAt?: string;
};

export type XrayClientActionTaskPlan = {
  input: CreateTaskInput;
  idempotencyKey: string;
};

type XrayClientTaskMetadata = {
  clientIdentity: string;
  clientEmail: string;
  clientCredential: string;
  clientLevel: number;
  clientComment: string;
  telegramId: string;
  resetPolicy: XrayClientResetPolicy;
  shadowsocksMethod: string;
  hysteriaAuth: string;
  flow: string;
  ipLimit: number;
  trafficMultiplier?: XrayClient['trafficMultiplier'];
  trafficLimitGb: number;
  monthlyResetDay: number;
  currentUsedTrafficGb: number;
  remainingDays: number;
  expiresAt: string;
  subscriptionRule: string;
  enabled: boolean;
  quotaExceeded: boolean;
  clientExpired: boolean;
  runtimeDisabledByPolicy: boolean;
  guardrailReason: string;
  vmessSecurity?: string;
};

const GB = 1024 ** 3;
const DAY_MS = 24 * 60 * 60 * 1000;

function clampNumber(value: number | undefined) {
  return Number.isFinite(value) ? Math.max(value ?? 0, 0) : 0;
}

function roundNonNegative(value: number) {
  return Number.isFinite(value) ? Math.max(Math.round(value), 0) : 0;
}

function bytesToGb(value: number | undefined) {
  return clampNumber(value) / GB;
}

function readClientUsedTrafficBytes(client: XrayClient) {
  return (client.manualUsedTrafficBytes ?? 0) > 0 ? client.manualUsedTrafficBytes : client.usedTrafficBytes;
}

function computeRemainingDays(expiresAt: string | undefined, observedAt: string, fallback?: number) {
  const fallbackDays = Number.isFinite(fallback) ? Math.max(Math.round(fallback ?? 0), 0) : undefined;
  const expiresAtMs = Date.parse(expiresAt ?? '');
  const observedAtMs = Date.parse(observedAt);

  if (!Number.isNaN(expiresAtMs) && !Number.isNaN(observedAtMs)) {
    return Math.max(Math.ceil((expiresAtMs - observedAtMs) / DAY_MS), 0);
  }

  return fallbackDays ?? 0;
}

function normalizeClientLookup(value: string | undefined) {
  return value?.trim().toLowerCase() ?? '';
}

function readClientTaskIdentity(inbound: XrayInbound, client: XrayClient) {
  return inbound.clients.length > 1 ? client.id : inbound.clientIdentity ?? client.id;
}

function readClientCredential(client: XrayClient) {
  return client.password ?? client.auth ?? client.id;
}

function readClientSubscriptionRule(inbound: XrayInbound, client: XrayClient) {
  const baseRule = inbound.subscriptionRule?.trim() || 'manual';
  const clientSubId = client.subId?.trim() ?? '';
  const duplicateSubId =
    clientSubId !== '' &&
    inbound.clients.filter((item) => normalizeClientLookup(item.subId) === normalizeClientLookup(clientSubId)).length > 1;

  if (clientSubId && !duplicateSubId) {
    return clientSubId;
  }

  return inbound.clients.length > 1 ? `${baseRule}:${client.id}` : baseRule;
}

function readRuntimeDisabledByPolicy(client: XrayClient) {
  return client.runtimeDisabledByPolicy === true || client.quotaExceeded === true || client.clientExpired === true;
}

function readGuardrailReason(client: Pick<XrayClientTaskMetadata, 'guardrailReason' | 'quotaExceeded' | 'clientExpired' | 'runtimeDisabledByPolicy'>) {
  if (client.guardrailReason && client.guardrailReason !== 'ok') {
    return client.guardrailReason;
  }

  if (client.clientExpired) {
    return 'xray_client_expired';
  }

  if (client.quotaExceeded) {
    return 'xray_client_monthly_quota_exceeded';
  }

  if (client.runtimeDisabledByPolicy) {
    return 'xray_client_runtime_disabled_by_policy';
  }

  return 'ok';
}

function isQuotaGuardrailReason(reason: string | undefined) {
  return Boolean(reason && reason.includes('quota'));
}

function isExpiryGuardrailReason(reason: string | undefined) {
  return Boolean(reason && reason.includes('expired'));
}

function isQuotaExceeded(usedTrafficGb: number, trafficLimitGb: number) {
  return trafficLimitGb > 0 && usedTrafficGb >= trafficLimitGb;
}

function createStableHash(value: string) {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(36).padStart(7, '0');
}

function normalizeForHash(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeForHash);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeForHash(item)])
    );
  }

  return value;
}

function actionLabel(action: XrayClientAction) {
  switch (action.kind) {
    case 'add-client':
      return 'add';
    case 'set-enabled':
      return action.enabled ? 'enable' : 'disable';
    case 'add-traffic':
      return `quota +${roundNonNegative(action.addedTrafficGb)}GB`;
    case 'set-traffic-limit':
      return `quota ${roundNonNegative(action.trafficLimitGb)}GB`;
    case 'reset-used-traffic':
      return 'reset used traffic';
    case 'renew':
      return `renew +${roundNonNegative(action.addedDays)}d`;
    case 'set-reset-policy':
      return `reset policy ${action.resetPolicy}`;
    case 'set-ip-limit':
      return `IP limit ${roundNonNegative(action.ipLimit)}`;
    case 'delete-client':
      return 'delete';
    default:
      return 'client action';
  }
}

function compactMetadata<T extends Record<string, unknown>>(metadata: T): T {
  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => {
      if (value === undefined) return false;
      if (typeof value === 'string') return value.trim() !== '';
      if (Array.isArray(value)) return value.length > 0;
      return true;
    })
  ) as T;
}

function readStringFromMetadata(metadata: Record<string, unknown> | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === 'string' ? value : '';
}

function slugClientIdentity(value: string, fallback: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_.@-]+/g, '-').replace(/^-|-$/g, '') || fallback;
}

function createNewClientIdentity(action: Extract<XrayClientAction, { kind: 'add-client' }>) {
  const explicitIdentity = action.clientIdentity?.trim();

  if (explicitIdentity) {
    return explicitIdentity;
  }

  const email = action.clientEmail.trim();
  const emailLocalPart = email.split('@')[0] ?? '';

  return `client-${slugClientIdentity(emailLocalPart || email, createStableHash(email))}`;
}

function createExpiresAtFromRemainingDays(observedAt: string, remainingDays: number) {
  return new Date(Date.parse(observedAt) + Math.max(remainingDays, 0) * DAY_MS).toISOString();
}

function createClientTaskMetadata(inbound: XrayInbound, client: XrayClient, observedAt: string): XrayClientTaskMetadata {
  const quotaExceeded = client.quotaExceeded ?? false;
  const clientExpired = client.clientExpired ?? false;
  const runtimeDisabledByPolicy = readRuntimeDisabledByPolicy(client);
  const metadata: XrayClientTaskMetadata = {
    clientIdentity: readClientTaskIdentity(inbound, client),
    clientEmail: client.email,
    clientCredential: readClientCredential(client),
    clientLevel: client.level ?? 0,
    clientComment: client.comment ?? '',
    telegramId: client.tgId ?? '',
    resetPolicy: client.resetPolicy ?? 'never',
    shadowsocksMethod: client.method ?? '2022-blake3-aes-128-gcm',
    hysteriaAuth: client.auth ?? client.password ?? client.id,
    flow: client.flow ?? inbound.flow ?? '',
    ipLimit: client.ipLimit,
    trafficMultiplier: client.trafficMultiplier,
    trafficLimitGb: Math.round(bytesToGb(client.trafficLimitBytes)),
    monthlyResetDay: client.monthlyResetDay ?? 1,
    currentUsedTrafficGb: bytesToGb(readClientUsedTrafficBytes(client)),
    remainingDays: computeRemainingDays(client.expiresAt, observedAt, inbound.remainingDays),
    expiresAt: client.expiresAt,
    subscriptionRule: readClientSubscriptionRule(inbound, client),
    enabled: client.enabled,
    quotaExceeded,
    clientExpired,
    runtimeDisabledByPolicy,
    guardrailReason: readGuardrailReason({
      guardrailReason: client.guardrailReason ?? '',
      quotaExceeded,
      clientExpired,
      runtimeDisabledByPolicy
    }),
    ...(client.security?.trim() ? { vmessSecurity: client.security.trim() } : {})
  };

  return metadata;
}

function createNewClientTaskMetadata(input: {
  inbound: XrayInbound;
  action: Extract<XrayClientAction, { kind: 'add-client' }>;
  observedAt: string;
}): XrayClientTaskMetadata {
  const clientIdentity = createNewClientIdentity(input.action);
  const clientEmail = input.action.clientEmail.trim();
  const trafficLimitGb = roundNonNegative(input.action.trafficLimitGb ?? 100);
  const currentUsedTrafficGb = bytesToGb((input.action.currentUsedTrafficGb ?? 0) * GB);
  const remainingDays = roundNonNegative(input.action.remainingDays ?? 30);
  const expiresAt = input.action.expiresAt?.trim() || createExpiresAtFromRemainingDays(input.observedAt, remainingDays);
  const clientExpired = computeRemainingDays(expiresAt, input.observedAt, remainingDays) <= 0;
  const quotaExceeded = isQuotaExceeded(currentUsedTrafficGb, trafficLimitGb);
  const runtimeDisabledByPolicy = quotaExceeded || clientExpired;
  const baseSubscriptionRule = input.inbound.subscriptionRule?.trim() || 'manual';
  const subscriptionRule = input.action.subscriptionRule?.trim() || `${baseSubscriptionRule}:${clientIdentity}`;

  return {
    clientIdentity,
    clientEmail,
    clientCredential: input.action.clientCredential?.trim() || clientIdentity,
    clientLevel: roundNonNegative(input.action.clientLevel ?? 0),
    clientComment: input.action.clientComment?.trim() ?? '',
    telegramId: input.action.telegramId?.trim() ?? '',
    resetPolicy: input.action.resetPolicy ?? 'monthly',
    shadowsocksMethod: input.action.shadowsocksMethod?.trim() || '2022-blake3-aes-128-gcm',
    hysteriaAuth: input.action.hysteriaAuth?.trim() || input.action.clientCredential?.trim() || clientIdentity,
    flow: input.action.flow?.trim() || input.inbound.flow || '',
    ipLimit: roundNonNegative(input.action.ipLimit ?? 0),
    trafficMultiplier: input.action.trafficMultiplier ?? 1,
    trafficLimitGb,
    monthlyResetDay: Math.min(Math.max(roundNonNegative(input.action.monthlyResetDay ?? 1), 1), 31),
    currentUsedTrafficGb,
    remainingDays: computeRemainingDays(expiresAt, input.observedAt, remainingDays),
    expiresAt,
    subscriptionRule,
    enabled: input.action.enabled ?? true,
    quotaExceeded,
    clientExpired,
    runtimeDisabledByPolicy,
    guardrailReason: readGuardrailReason({
      guardrailReason: '',
      quotaExceeded,
      clientExpired,
      runtimeDisabledByPolicy
    }),
    ...(input.action.vmessSecurity?.trim() ? { vmessSecurity: input.action.vmessSecurity.trim() } : {})
  };
}

function normalizePatchGuardrailState(
  current: XrayClientTaskMetadata,
  patch: Partial<XrayClientTaskMetadata>
): Partial<XrayClientTaskMetadata> {
  const next = {
    ...current,
    ...patch
  };

  if (next.clientExpired) {
    return {
      ...patch,
      clientExpired: true,
      runtimeDisabledByPolicy: true,
      guardrailReason: 'xray_client_expired'
    };
  }

  if (next.quotaExceeded) {
    return {
      ...patch,
      quotaExceeded: true,
      runtimeDisabledByPolicy: true,
      guardrailReason: 'xray_client_monthly_quota_exceeded'
    };
  }

  const clearsQuota =
    patch.quotaExceeded === false && (current.quotaExceeded === true || isQuotaGuardrailReason(current.guardrailReason));
  const clearsExpiry =
    patch.clientExpired === false && (current.clientExpired === true || isExpiryGuardrailReason(current.guardrailReason));

  if (clearsQuota || clearsExpiry) {
    return {
      ...patch,
      enabled: true,
      runtimeDisabledByPolicy: false,
      guardrailReason: 'ok'
    };
  }

  return patch;
}

function createClientActionPatch(
  current: XrayClientTaskMetadata,
  action: XrayClientAction,
  observedAt: string
): Partial<XrayClientTaskMetadata> {
  switch (action.kind) {
    case 'set-enabled':
      return {
        enabled: action.enabled
      };
    case 'add-traffic': {
      const trafficLimitGb = current.trafficLimitGb + roundNonNegative(action.addedTrafficGb);
      return normalizePatchGuardrailState(current, {
        trafficLimitGb,
        quotaExceeded: isQuotaExceeded(current.currentUsedTrafficGb, trafficLimitGb)
      });
    }
    case 'set-traffic-limit': {
      const trafficLimitGb = roundNonNegative(action.trafficLimitGb);
      return normalizePatchGuardrailState(current, {
        trafficLimitGb,
        quotaExceeded: isQuotaExceeded(current.currentUsedTrafficGb, trafficLimitGb)
      });
    }
    case 'reset-used-traffic':
      return normalizePatchGuardrailState(current, {
        currentUsedTrafficGb: 0,
        quotaExceeded: false
      });
    case 'renew': {
      const remainingDays = current.remainingDays + roundNonNegative(action.addedDays);
      return normalizePatchGuardrailState(current, {
        remainingDays,
        expiresAt: new Date(Date.parse(observedAt) + remainingDays * DAY_MS).toISOString(),
        clientExpired: remainingDays <= 0
      });
    }
    case 'set-reset-policy':
      return {
        resetPolicy: action.resetPolicy
      };
    case 'set-ip-limit':
      return {
        ipLimit: roundNonNegative(action.ipLimit)
      };
    case 'delete-client':
      return {
        enabled: false,
        runtimeDisabledByPolicy: true,
        guardrailReason: 'xray_client_deleted'
      };
    default:
      return {};
  }
}

function isSameActionTarget(client: XrayClient, request: XrayClientActionRequest) {
  const requestClientId = normalizeClientLookup(request.clientId);
  const requestClientEmail = normalizeClientLookup(request.clientEmail);

  return (
    (requestClientId !== '' && normalizeClientLookup(client.id) === requestClientId) ||
    (requestClientEmail !== '' && normalizeClientLookup(client.email) === requestClientEmail)
  );
}

export function findXrayClientForAction(inbound: XrayInbound, request: XrayClientActionRequest) {
  if (request.action.kind === 'add-client') {
    throw new Error('Xray add-client action does not target an existing client.');
  }

  if (!request.clientId?.trim() && !request.clientEmail?.trim()) {
    throw new Error('Xray client action requires clientId or clientEmail.');
  }

  const client = inbound.clients.find((item) => isSameActionTarget(item, request));

  if (!client) {
    throw new Error(`Xray client not found for inbound ${inbound.id}.`);
  }

  return client;
}

function createClientMetadataLookupKey(value: string | undefined) {
  return normalizeClientLookup(value);
}

function assertCanAddXrayClient(inbound: XrayInbound, newClient: XrayClientTaskMetadata) {
  const identityKey = createClientMetadataLookupKey(newClient.clientIdentity);
  const emailKey = createClientMetadataLookupKey(newClient.clientEmail);
  const subscriptionRuleKey = createClientMetadataLookupKey(newClient.subscriptionRule);

  if (identityKey === '' && emailKey === '') {
    throw new Error('Xray add-client action requires clientIdentity or clientEmail.');
  }

  for (const client of inbound.clients) {
    if (identityKey !== '' && createClientMetadataLookupKey(client.id) === identityKey) {
      throw new Error(`Xray client identity already exists for inbound ${inbound.id}.`);
    }

    if (emailKey !== '' && createClientMetadataLookupKey(client.email) === emailKey) {
      throw new Error(`Xray client email already exists for inbound ${inbound.id}.`);
    }

    if (
      subscriptionRuleKey !== '' &&
      createClientMetadataLookupKey(readClientSubscriptionRule(inbound, client)) === subscriptionRuleKey
    ) {
      throw new Error(`Xray client subscription rule already exists for inbound ${inbound.id}.`);
    }
  }
}

function createPatchedClientMetadata(input: {
  inbound: XrayInbound;
  client: XrayClient;
  targetClient: XrayClient;
  action: XrayClientAction;
  observedAt: string;
}) {
  const current = createClientTaskMetadata(input.inbound, input.client, input.observedAt);

  if (!isSameActionTarget(input.client, {
    inboundId: input.inbound.id,
    clientId: input.targetClient.id,
    clientEmail: input.targetClient.email,
    action: input.action
  })) {
    return current;
  }

  return {
    ...current,
    ...createClientActionPatch(current, input.action, input.observedAt)
  };
}

function createXrayClientActionMetadata(input: {
  inbound: XrayInbound;
  targetClient?: XrayClient;
  action: XrayClientAction;
  observedAt: string;
  reason?: string;
}) {
  const newClientMetadata =
    input.action.kind === 'add-client'
      ? createNewClientTaskMetadata({
          inbound: input.inbound,
          action: input.action,
          observedAt: input.observedAt
        })
      : undefined;
  const patchedTargetClientMetadata =
    input.targetClient && input.action.kind !== 'add-client'
      ? createPatchedClientMetadata({
          inbound: input.inbound,
          client: input.targetClient,
          targetClient: input.targetClient,
          action: input.action,
          observedAt: input.observedAt
        })
      : newClientMetadata;

  if (newClientMetadata) {
    assertCanAddXrayClient(input.inbound, newClientMetadata);
  }

  const existingTargetClient = input.action.kind === 'add-client' ? undefined : input.targetClient;

  if (input.action.kind !== 'add-client' && !existingTargetClient) {
    throw new Error('Xray client action requires an existing target client.');
  }
  const requiredTargetClient = existingTargetClient as XrayClient;

  const clients =
    input.action.kind === 'add-client' && newClientMetadata
      ? [
          ...input.inbound.clients.map((client) => createClientTaskMetadata(input.inbound, client, input.observedAt)),
          newClientMetadata
        ]
      : input.action.kind === 'delete-client' && existingTargetClient && input.inbound.clients.length > 1
      ? input.inbound.clients
          .filter(
            (client) =>
              !isSameActionTarget(client, {
                inboundId: input.inbound.id,
                clientId: existingTargetClient.id,
                clientEmail: existingTargetClient.email,
                action: input.action
              })
          )
          .map((client) => createClientTaskMetadata(input.inbound, client, input.observedAt))
      : input.inbound.clients.map((client) =>
          createPatchedClientMetadata({
            inbound: input.inbound,
            client,
            targetClient: requiredTargetClient,
            action: input.action,
            observedAt: input.observedAt
          })
        );
  const targetClientMetadata =
    clients.find(
      (client) =>
        (existingTargetClient && client.clientIdentity === readClientTaskIdentity(input.inbound, existingTargetClient)) ||
        (existingTargetClient && normalizeClientLookup(client.clientEmail) === normalizeClientLookup(existingTargetClient.email)) ||
        (newClientMetadata && client.clientIdentity === newClientMetadata.clientIdentity) ||
        (newClientMetadata && normalizeClientLookup(client.clientEmail) === normalizeClientLookup(newClientMetadata.clientEmail))
    ) ?? patchedTargetClientMetadata;

  if (!targetClientMetadata) {
    throw new Error('Xray client action could not resolve target metadata.');
  }
  const primaryClientMetadata =
    input.action.kind === 'delete-client' && clients.length > 0 ? clients[0] : targetClientMetadata;
  const activeClientCount = clients.filter(
    (client) =>
      client.enabled !== false &&
      client.quotaExceeded !== true &&
      client.clientExpired !== true &&
      client.runtimeDisabledByPolicy !== true
  ).length;
  const primaryServerName = input.inbound.streamSettings.sni ?? input.inbound.reality.serverNames[0] ?? '';
  const fallback = input.inbound.fallbacks[0];

  return compactMetadata({
    nodeId: input.inbound.id,
    agentId: input.inbound.agentId,
    customerNodeName: input.inbound.label,
    customerName: input.inbound.customerName ?? targetClientMetadata.clientEmail,
    serverAddress: input.inbound.serverAddress,
    xrayProtocol: input.inbound.protocol,
    listenAddress: input.inbound.listenAddress,
    listenPort: input.inbound.listenPort,
    streamNetwork: input.inbound.streamSettings.network,
    security: input.inbound.streamSettings.security,
    sni: primaryServerName,
    path: input.inbound.streamSettings.path,
    fingerprint: input.inbound.streamSettings.fingerprint ?? input.inbound.reality.fingerprint,
    alpn: input.inbound.tls.alpn,
    realityPublicKey: input.inbound.reality.publicKey,
    realityPrivateKey: input.inbound.reality.privateKey,
    realityTarget: input.inbound.reality.target,
    realityShortId: input.inbound.reality.shortIds[0],
    fallbackName: fallback?.name,
    fallbackDestination: fallback?.destination,
    fallbackXver: fallback?.xver,
    sniffingEnabled: input.inbound.sniffingEnabled,
    ...primaryClientMetadata,
    enabled: activeClientCount > 0,
    clients,
    xrayReplaceClients:
      input.action.kind === 'add-client' || (input.action.kind === 'delete-client' && input.inbound.clients.length > 1)
        ? true
        : undefined,
    xrayClientAction: input.action.kind,
    xrayClientActionLabel: actionLabel(input.action),
    xrayClientActionTargetIdentity: targetClientMetadata.clientIdentity,
    xrayClientActionTargetEmail: targetClientMetadata.clientEmail,
    xrayClientActionObservedAt: input.observedAt,
    xrayClientActionReason: input.reason
  });
}

export function createXrayClientActionIdempotencyKey(input: {
  inbound: XrayInbound;
  client: XrayClient;
  action: XrayClientAction;
}) {
  const identity = {
    inboundId: input.inbound.id,
    clientId: input.client.id,
    clientEmail: input.client.email,
    action: normalizeForHash(input.action),
    currentState: {
      enabled: input.client.enabled,
      trafficLimitBytes: input.client.trafficLimitBytes,
      manualUsedTrafficBytes: input.client.manualUsedTrafficBytes,
      usedTrafficBytes: input.client.usedTrafficBytes,
      expiresAt: input.client.expiresAt,
      ipLimit: input.client.ipLimit,
      resetPolicy: input.client.resetPolicy,
      quotaExceeded: input.client.quotaExceeded,
      clientExpired: input.client.clientExpired,
      runtimeDisabledByPolicy: input.client.runtimeDisabledByPolicy,
      guardrailReason: input.client.guardrailReason
    }
  };

  return [
    'api',
    'xray-client-action',
    input.action.kind,
    createStableHash(`${input.inbound.id}:${input.client.id}:${input.client.email}`),
    createStableHash(JSON.stringify(normalizeForHash(identity)))
  ].join(':');
}

export function createXrayClientActionTaskPlan(input: {
  inbound: XrayInbound;
  request: XrayClientActionRequest;
  observedAt: string;
}): XrayClientActionTaskPlan {
  const targetClient = input.request.action.kind === 'add-client' ? undefined : findXrayClientForAction(input.inbound, input.request);
  const operation =
    input.request.action.kind === 'delete-client' && input.inbound.clients.length <= 1 ? 'inbound.delete' : 'inbound.update';
  const metadata = createXrayClientActionMetadata({
    inbound: input.inbound,
    targetClient,
    action: input.request.action,
    observedAt: input.observedAt,
    reason: input.request.reason
  });
  const idempotencyClient: XrayClient =
    targetClient ??
    {
      id: readStringFromMetadata(metadata, 'xrayClientActionTargetIdentity'),
      email: readStringFromMetadata(metadata, 'xrayClientActionTargetEmail'),
      enabled: true,
      trafficLimitBytes: 0,
      usedTrafficBytes: 0,
      expiresAt: input.observedAt,
      ipLimit: 0
    };

  return {
    idempotencyKey: createXrayClientActionIdempotencyKey({
      inbound: input.inbound,
      client: idempotencyClient,
      action: input.request.action
    }),
    input: {
      operation,
      resourceType: 'inbound',
      targetId: input.inbound.id,
      targetLabel: input.inbound.label,
      summary: `Xray client ${actionLabel(input.request.action)}: ${
        targetClient?.email ||
        readStringFromMetadata(metadata, 'xrayClientActionTargetEmail') ||
        readStringFromMetadata(metadata, 'xrayClientActionTargetIdentity')
      }`,
      metadata,
      ...(operation === 'inbound.delete'
        ? {
            riskConfirmation: {
              operation,
              targetId: input.inbound.id
            }
          }
        : {})
    }
  };
}

export function createXrayInboundRestoreTaskInput(input: {
  inbound: XrayInbound;
  observedAt: string;
  recreate: boolean;
  reason: string;
}): CreateTaskInput {
  const referenceClient = input.inbound.clients[0];

  if (!referenceClient) {
    throw new Error(`Xray inbound ${input.inbound.id} has no client configuration to restore.`);
  }

  const restorePlan = createXrayClientActionTaskPlan({
    inbound: input.inbound,
    observedAt: input.observedAt,
    request: {
      inboundId: input.inbound.id,
      clientId: referenceClient.id,
      clientEmail: referenceClient.email,
      action: {
        kind: 'set-enabled',
        enabled: referenceClient.enabled
      },
      reason: input.reason
    }
  });
  const operation = input.recreate ? 'inbound.create' : 'inbound.update';

  return {
    ...restorePlan.input,
    operation,
    summary: `Restore Xray inbound after operation failure: ${input.inbound.label}`,
    riskConfirmation: undefined
  };
}
