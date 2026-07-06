import type { CustomerNodeConfigMetadata } from './nodes-page';

type CustomerNodeTaskOperation = 'inbound.create' | 'inbound.update' | 'inbound.delete';
type MetadataValue = string | number | boolean | string[] | undefined;
export type CustomerNodeTaskMetadata = Record<string, unknown>;

function compactMetadata(input: Record<string, MetadataValue>): CustomerNodeTaskMetadata {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => {
      if (value === undefined) {
        return false;
      }

      if (typeof value === 'string') {
        return value.trim() !== '';
      }

      if (Array.isArray(value)) {
        return value.some((item) => item.trim() !== '');
      }

      return true;
    }).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.map((item) => item.trim()).filter(Boolean) : typeof value === 'string' ? value.trim() : value
    ])
  ) as CustomerNodeTaskMetadata;
}

function createDeleteMetadata(metadata: CustomerNodeConfigMetadata) {
  return compactMetadata({
    agentId: metadata.agentId,
    nodeId: metadata.nodeId,
    customerNodeName: metadata.customerNodeName,
    customerName: metadata.customerName,
    xrayProtocol: metadata.xrayProtocol,
    listenPort: metadata.listenPort,
    clientIdentity: metadata.clientIdentity,
    clientEmail: metadata.clientEmail
  });
}

function createClientMetadata(metadata: CustomerNodeConfigMetadata) {
  return {
    ...compactMetadata({
      clientIdentity: metadata.clientIdentity,
      clientEmail: metadata.clientEmail,
      clientCredential: metadata.clientCredential,
      clientLevel: metadata.clientLevel,
      clientComment: metadata.clientComment,
      telegramId: metadata.telegramId,
      resetPolicy: metadata.resetPolicy,
      flow: metadata.flow,
      ipLimit: metadata.ipLimit,
      trafficMultiplier: metadata.trafficMultiplier,
      trafficLimitGb: metadata.trafficLimitGb,
      monthlyResetDay: metadata.monthlyResetDay,
      currentUsedTrafficGb: metadata.currentUsedTrafficGb,
      remainingDays: metadata.remainingDays,
      expiresAt: metadata.expiresAt,
      quotaExceeded: metadata.quotaExceeded,
      clientExpired: metadata.clientExpired,
      runtimeDisabledByPolicy: metadata.runtimeDisabledByPolicy,
      guardrailReason: metadata.guardrailReason,
      subscriptionRule: metadata.subscriptionRule,
      enabled: metadata.enabled
    }),
    ...compactMetadata(
      metadata.xrayProtocol === 'vmess'
        ? {
            vmessSecurity: metadata.vmessSecurity
          }
        : {}
    ),
    ...compactMetadata(
      metadata.xrayProtocol === 'shadowsocks'
        ? {
            shadowsocksMethod: metadata.shadowsocksMethod
          }
        : {}
    ),
    ...compactMetadata(
      metadata.xrayProtocol === 'hysteria'
        ? {
            hysteriaAuth: metadata.hysteriaAuth
          }
        : {}
    )
  };
}

function createUpsertMetadata(metadata: CustomerNodeConfigMetadata) {
  const common = compactMetadata({
    nodeId: metadata.nodeId,
    agentId: metadata.agentId,
    customerNodeName: metadata.customerNodeName,
    customerName: metadata.customerName,
    serverAddress: metadata.serverAddress,
    xrayProtocol: metadata.xrayProtocol,
    listenPort: metadata.listenPort,
    clientIdentity: metadata.clientIdentity,
    clientEmail: metadata.clientEmail,
    clientCredential: metadata.clientCredential,
    clientLevel: metadata.clientLevel,
    clientComment: metadata.clientComment,
    telegramId: metadata.telegramId,
    resetPolicy: metadata.resetPolicy,
    streamNetwork: metadata.streamNetwork,
    security: metadata.security,
    sni: metadata.sni,
    path: metadata.path,
    flow: metadata.flow,
    fingerprint: metadata.fingerprint,
    alpn: metadata.alpn,
    fallbackName: metadata.fallbackName,
    fallbackDestination: metadata.fallbackDestination,
    fallbackXver: metadata.fallbackXver,
    sniffingEnabled: metadata.sniffingEnabled,
    ipLimit: metadata.ipLimit,
    trafficMultiplier: metadata.trafficMultiplier,
    trafficLimitGb: metadata.trafficLimitGb,
    monthlyResetDay: metadata.monthlyResetDay,
    currentUsedTrafficGb: metadata.currentUsedTrafficGb,
    remainingDays: metadata.remainingDays,
    expiresAt: metadata.expiresAt,
    quotaExceeded: metadata.quotaExceeded,
    clientExpired: metadata.clientExpired,
    runtimeDisabledByPolicy: metadata.runtimeDisabledByPolicy,
    guardrailReason: metadata.guardrailReason,
    subscriptionRule: metadata.subscriptionRule,
    enabled: metadata.enabled
  });

  return {
    ...common,
    ...compactMetadata(
      metadata.xrayProtocol === 'vmess'
        ? {
            vmessSecurity: metadata.vmessSecurity
          }
        : {}
    ),
    ...compactMetadata(
      metadata.xrayProtocol === 'shadowsocks'
        ? {
            shadowsocksMethod: metadata.shadowsocksMethod
          }
        : {}
    ),
    ...compactMetadata(
      metadata.xrayProtocol === 'hysteria'
        ? {
            hysteriaAuth: metadata.hysteriaAuth
          }
        : {}
    ),
    ...compactMetadata(
      metadata.security === 'reality'
        ? {
            realityPublicKey: metadata.realityPublicKey,
            realityPrivateKey: metadata.realityPrivateKey,
            realityTarget: metadata.realityTarget,
            realityShortId: metadata.realityShortId
          }
        : {}
    ),
    clients: [createClientMetadata(metadata)]
  };
}

export function createCustomerNodeTaskMetadata(
  metadata: CustomerNodeConfigMetadata,
  operation: CustomerNodeTaskOperation
): CustomerNodeTaskMetadata {
  if (operation === 'inbound.delete') {
    return createDeleteMetadata(metadata);
  }

  return createUpsertMetadata(metadata);
}
