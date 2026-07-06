import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import QRCode from 'qrcode';
import {
  selectSubscriptionExportProfileForClient,
  type AuditLog,
  type CreateTaskInput,
  type DeployTask,
  type DeployTaskStatus,
  type SystemAlert,
  type SubscriptionClientFormat,
  type SubscriptionClientIdentity,
  type SubscriptionClientOutputFormat,
  type TrafficRollupDimension
} from '../../domain';
import {
  createInMemoryOperatorSessionStore,
  type OperatorSessionObservationContext,
  type OperatorSessionStore
} from '../../server/control-plane/operator-session-store';
import type {
  ControlPlaneApi,
  ControlPlaneRuntimeObservabilityMetricsInput,
  MutationContext
} from './control-plane-api';
import {
  agentCommandEnvelopeSchema,
  parseAgentCredentialRevokeRequest,
  parseAgentCredentialRotateRequest,
  parseAgentInstallCommandRequest,
  parseAgentLogRetentionPolicyUpdateRequest,
  parseAgentUpgradeCommandRequest,
  parseAgentEventsRequest,
  parseAgentPollRequest,
  parseAgentRegistrationRequest,
  parseAgentRuntimeCredentialRotateRequest,
  parseCreateTaskRequest,
  parseOperatorSessionLoginRequest,
  parseOperatorSessionRevokeRequest,
  parseTrafficRollupRetentionPolicyUpdateRequest,
  parseVerifyAuditLogChainRequest,
  parseTransitionTaskRequest
} from './api-contract';
import {
  isPublicSubscriptionFormat,
  normalizePublicSubscriptionFormat,
  renderPublicSubscriptionOutput,
  type PublicSubscriptionFormat,
  type PublicSubscriptionOutput
} from './subscription-output';
import { renderPrometheusMetrics } from './prometheus-metrics';
import {
  createSystemAlertsFromAuditWriteFailures,
  createSystemAlertsFromExternalArchiveSinkFailures
} from './system-alerts';

type HttpErrorCode =
  | 'agent_result.required'
  | 'agent_event.command_deadline_expired'
  | 'agent_event.command_task_mismatch'
  | 'agent_event.sequence_replay'
  | 'agent_upgrade.runtime_credential_required'
  | 'agent_upgrade.self_update_unsupported'
  | 'bad_request'
  | 'credential.inactive'
  | 'csrf.required'
  | 'high_risk_confirmation.required'
  | 'idempotency.conflict'
  | 'idempotency.replay_unavailable'
  | 'identity.mismatch'
  | 'not_found'
  | 'operator_auth.rate_limited'
  | 'permission_change.required'
  | 'permission.denied'
  | 'permission_grant.already_revoked'
  | 'permission_grant.last_admin_path'
  | 'permission_grant.mismatch'
  | 'permission_grant.not_found'
  | 'subscription.quota_exceeded'
  | 'subscription.rate_limited'
  | 'subscription_source.rate_limited'
  | 'resource_version.conflict'
  | 'task.invalid_transition'
  | 'unauthorized'
  | 'validation_error';

type HttpError = {
  status: number;
  code: HttpErrorCode;
  message: string;
  details?: unknown;
};

const mutationMethods = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const publicSubscriptionRateWindowMs = 60 * 60 * 1000;
const publicSubscriptionRequestBuckets = new Map<string, { windowStartedAt: number; count: number }>();
const defaultOperatorAuthFailureThrottle = {
  windowMs: 60_000,
  maxFailures: 20
};
const defaultOperatorSessionCookieName = 'ou_ui_next_operator_session';
const defaultOperatorSessionTtlMs = 8 * 60 * 60 * 1000;
const defaultTaskEventStreamPollIntervalMs = 500;
const operatorProtectedReadRoutes = new Set([
  '/api/v1/snapshot',
  '/api/v1/observability-metrics',
  '/api/v1/agent-log-retention-policy',
  '/api/v1/traffic-rollup-retention-policy',
  '/api/v1/agents',
  '/api/v1/customers',
  '/api/v1/nodes',
  '/api/v1/inbounds',
  '/api/v1/subscription-sources',
  '/api/v1/subscription-nodes',
  '/api/v1/subscription-bundles',
  '/api/v1/subscription-clients',
  '/api/v1/subscription-export-profiles',
  '/api/v1/proxy-providers',
  '/api/v1/subscription-export-files',
  '/api/v1/forward-rules',
  '/api/v1/quota-policies',
  '/api/v1/integrations/telegram-bot/settings',
  '/api/v1/telegram-bindings',
  '/api/v1/telegram-binding-challenges',
  '/api/v1/telegram-notification-policies',
  '/api/v1/telegram-notification-deliveries',
  '/api/v1/rate-limit-policies',
  '/api/v1/permission-grants',
  '/api/v1/agent-credentials',
  '/api/v1/agent-sessions',
  '/api/v1/operator-sessions',
  '/api/v1/routing-policies',
  '/api/v1/tuning-profiles',
  '/api/v1/command-outbox',
  '/api/v1/config-revisions',
  '/api/v1/preflight-plans',
  '/api/v1/runtime-snapshots',
  '/api/v1/traffic-rollups',
  '/api/v1/traffic-rollups:export',
  '/api/v1/traffic-rollup-compactions',
  '/api/v1/traffic-rollup-compactions:export',
  '/api/v1/system-alerts',
  '/api/v1/agent-log-chunks',
  '/api/v1/agent-log-chunks:export',
  '/api/v1/agent-log-archives',
  '/api/v1/agent-log-archives:export',
  '/api/v1/tasks',
  '/api/v1/audit-logs',
  '/api/v1/audit-logs:verify',
  '/metrics'
]);

type OperatorTokenIdentity = Pick<MutationContext, 'actor' | 'operatorGroupId' | 'resourceGroupId'>;
type OperatorSessionIdentity = OperatorTokenIdentity & {
  sessionId: string;
  username: string;
  issuedAt: string;
  expiresAt: string;
};
type OperatorSessionAuthentication = {
  identity: OperatorSessionIdentity;
  csrfToken: string;
};

type AgentTokenIdentity = {
  agentId: string;
  credentialId?: string;
  sessionId?: string;
};

type AgentTokenResolver = (token: string) => Promise<AgentTokenIdentity | undefined>;
export type OperatorAuthFailureThrottleOptions = {
  windowMs?: number;
  maxFailures?: number;
};
type OperatorAuthFailureThrottleConfig = Required<OperatorAuthFailureThrottleOptions>;
type OperatorAuthFailureBucket = {
  windowStartedAt: number;
  count: number;
  rateLimitedAuditRecorded: boolean;
};
type OperatorAuthFailureThrottle = OperatorAuthFailureThrottleConfig & {
  buckets: Map<string, OperatorAuthFailureBucket>;
};
type OperatorAuthFailureThrottleResult = OperatorAuthFailureThrottleConfig & {
  rateLimited: boolean;
  shouldAudit: boolean;
  retryAfterMs: number;
};
export type HttpRuntimeMetrics = Required<ControlPlaneRuntimeObservabilityMetricsInput> & {
  auditWriteFailures: number;
  firstAuditWriteFailureAt?: string;
  lastAuditWriteFailureAt?: string;
  externalArchiveSinkFailures: number;
  externalArchiveFailedRecords: number;
  firstExternalArchiveSinkFailureAt?: string;
  lastExternalArchiveSinkFailureAt?: string;
  lastExternalArchiveSinkFailureKind?: string;
};

export function createHttpRuntimeMetrics(input: Partial<HttpRuntimeMetrics> = {}): HttpRuntimeMetrics {
  return {
    auditWriteFailures: 0,
    externalArchiveSinkFailures: 0,
    externalArchiveFailedRecords: 0,
    ...input
  };
}

export function recordExternalArchiveSinkFailure(
  runtimeMetrics: HttpRuntimeMetrics,
  input: {
    kind?: string;
    recordCount?: number;
    observedAt?: string;
  }
) {
  const observedAt = input.observedAt ?? new Date().toISOString();
  runtimeMetrics.externalArchiveSinkFailures += 1;
  runtimeMetrics.externalArchiveFailedRecords += Math.max(0, Math.round(input.recordCount ?? 0));
  runtimeMetrics.firstExternalArchiveSinkFailureAt ??= observedAt;
  runtimeMetrics.lastExternalArchiveSinkFailureAt = observedAt;
  runtimeMetrics.lastExternalArchiveSinkFailureKind = input.kind;
}

function createRuntimeMetricsInputForApi(
  runtimeMetrics: HttpRuntimeMetrics
): Required<ControlPlaneRuntimeObservabilityMetricsInput> {
  return {
    auditWriteFailures: runtimeMetrics.auditWriteFailures,
    externalArchiveSinkFailures: runtimeMetrics.externalArchiveSinkFailures,
    externalArchiveFailedRecords: runtimeMetrics.externalArchiveFailedRecords
  };
}
type AuditWriteFailureContext = {
  requestId: string;
  auditKind: 'agent.denied' | 'operator.denied';
  error: unknown;
};
type TaskEventQuery = ReturnType<typeof readTaskEventQuery>;
type SystemAlertEventQuery = ReturnType<typeof readSystemAlertEventQuery>;
type TaskSseEvent = {
  event: string;
  id: string;
  taskId?: string;
  occurredAt?: string;
  data: unknown;
};

export type HttpControlPlaneAuthOptions = {
  operatorTokens?: Record<string, OperatorTokenIdentity>;
  operatorSession?: {
    username: string;
    password?: string;
    passwordHash?: string;
    sessionSecret: string;
    actor?: string;
    operatorGroupId?: string;
    resourceGroupId?: string;
    ttlMs?: number;
    cookieName?: string;
  };
  agentTokens?: Record<string, AgentTokenIdentity>;
  agentTokenResolver?: AgentTokenResolver;
};

export type CreateHttpControlPlaneServerOptions = {
  auth?: HttpControlPlaneAuthOptions;
  logger?: ControlPlaneStructuredLogger;
  operatorAuthFailureThrottle?: OperatorAuthFailureThrottleOptions | false;
  operatorSessionStore?: OperatorSessionStore;
  runtimeMetrics?: HttpRuntimeMetrics;
};

type ResolvedHttpControlPlaneServerOptions = CreateHttpControlPlaneServerOptions & {
  runtimeMetrics: HttpRuntimeMetrics;
};

export type ControlPlaneStructuredLogLevel = 'info' | 'warning' | 'error';

export type ControlPlaneStructuredLogEvent = {
  timestamp?: string;
  level?: ControlPlaneStructuredLogLevel;
  event: string;
  requestId?: string;
  traceId?: string;
  parentSpanId?: string;
  traceparent?: string;
  method?: string;
  path?: string;
  statusCode?: number;
  durationMs?: number;
  taskId?: string;
  commandId?: string;
  agentId?: string;
  sessionId?: string;
  actor?: string;
  operation?: string;
  resourceType?: string;
  targetId?: string;
  errorCode?: string;
  [key: string]: unknown;
};

export type ControlPlaneStructuredLogger = {
  write(event: ControlPlaneStructuredLogEvent): void;
};

function getHeader(headers: IncomingHttpHeaders, name: string) {
  const value = headers[name.toLowerCase()];

  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function createRequestId(headers: IncomingHttpHeaders) {
  return getHeader(headers, 'x-request-id') ?? `req-http-${Date.now()}`;
}

function readRequestSourceIp(request: IncomingMessage) {
  const forwardedFor = getHeader(request.headers, 'x-forwarded-for')
    ?.split(',')
    .map((item) => item.trim())
    .find((item) => item.length > 0);

  return forwardedFor ?? request.socket.remoteAddress ?? '127.0.0.1';
}

function readForwardedHeaderValue(headers: IncomingHttpHeaders, name: string) {
  return getHeader(headers, name)
    ?.split(',')
    .map((item) => item.trim())
    .find((item) => item.length > 0);
}

function createPublicRequestBaseUrl(request: IncomingMessage) {
  const host = readForwardedHeaderValue(request.headers, 'x-forwarded-host') ?? getHeader(request.headers, 'host')?.trim();

  if (!host) {
    return undefined;
  }

  const forwardedProto = readForwardedHeaderValue(request.headers, 'x-forwarded-proto')?.toLowerCase();
  const protocol = forwardedProto === 'https' ? 'https' : 'http';

  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return undefined;
  }
}

function createOperatorSessionObservationContext(request: IncomingMessage): OperatorSessionObservationContext {
  return {
    sourceIp: readRequestSourceIp(request),
    userAgent: getHeader(request.headers, 'user-agent'),
    requestId: createRequestId(request.headers)
  };
}

function readTraceContext(headers: IncomingHttpHeaders) {
  const traceparent = getHeader(headers, 'traceparent');

  if (!traceparent) {
    return {};
  }

  const match = /^([a-f0-9]{2})-([a-f0-9]{32})-([a-f0-9]{16})-([a-f0-9]{2})$/i.exec(traceparent);

  if (!match) {
    return { traceparent };
  }

  return {
    traceparent,
    traceId: match[2],
    parentSpanId: match[3]
  };
}

function writeStructuredLog(
  logger: ControlPlaneStructuredLogger | undefined,
  event: ControlPlaneStructuredLogEvent
) {
  if (!logger) {
    return;
  }

  try {
    logger.write({
      timestamp: event.timestamp ?? new Date().toISOString(),
      level: event.level ?? 'info',
      ...event
    });
  } catch {
    // Logging must not affect control-plane request handling.
  }
}

function logRequestEvent(
  options: CreateHttpControlPlaneServerOptions,
  request: IncomingMessage,
  event: ControlPlaneStructuredLogEvent
) {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  writeStructuredLog(options.logger, {
    method: request.method ?? 'GET',
    path: url.pathname,
    ...readTraceContext(request.headers),
    ...event
  });
}

function readErrorCode(error: unknown) {
  return 'code' in Object(error) && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : error instanceof Error
      ? error.name
      : 'unknown';
}

function recordAuditWriteFailure(
  options: CreateHttpControlPlaneServerOptions,
  runtimeMetrics: HttpRuntimeMetrics,
  request: IncomingMessage,
  context: AuditWriteFailureContext
) {
  const observedAt = new Date().toISOString();
  runtimeMetrics.auditWriteFailures += 1;
  runtimeMetrics.firstAuditWriteFailureAt ??= observedAt;
  runtimeMetrics.lastAuditWriteFailureAt = observedAt;
  logRequestEvent(options, request, {
    event: 'audit.write_failed',
    level: 'error',
    timestamp: observedAt,
    requestId: context.requestId,
    auditKind: context.auditKind,
    errorCode: readErrorCode(context.error)
  });
}

function createAuditWriteFailureAlertsFromRuntimeMetrics(
  runtimeMetrics: HttpRuntimeMetrics,
  now = new Date().toISOString()
) {
  return createSystemAlertsFromAuditWriteFailures(
    {
      writeFailures: runtimeMetrics.auditWriteFailures,
      firstFailureAt: runtimeMetrics.firstAuditWriteFailureAt,
      lastFailureAt: runtimeMetrics.lastAuditWriteFailureAt
    },
    now
  );
}

function createExternalArchiveSinkFailureAlertsFromRuntimeMetrics(
  runtimeMetrics: HttpRuntimeMetrics,
  now = new Date().toISOString()
) {
  return createSystemAlertsFromExternalArchiveSinkFailures(
    {
      sinkFailures: runtimeMetrics.externalArchiveSinkFailures,
      failedRecords: runtimeMetrics.externalArchiveFailedRecords,
      firstFailureAt: runtimeMetrics.firstExternalArchiveSinkFailureAt,
      lastFailureAt: runtimeMetrics.lastExternalArchiveSinkFailureAt,
      lastFailureKind: runtimeMetrics.lastExternalArchiveSinkFailureKind
    },
    now
  );
}

function createSystemAlertsFromRuntimeMetrics(
  runtimeMetrics: HttpRuntimeMetrics,
  now = new Date().toISOString()
) {
  return [
    ...createAuditWriteFailureAlertsFromRuntimeMetrics(runtimeMetrics, now),
    ...createExternalArchiveSinkFailureAlertsFromRuntimeMetrics(runtimeMetrics, now)
  ];
}

async function listSystemAlertsWithRuntimeMetrics(
  api: ControlPlaneApi,
  runtimeMetrics?: HttpRuntimeMetrics
) {
  return api.listSystemAlerts(
    undefined,
    runtimeMetrics ? createSystemAlertsFromRuntimeMetrics(runtimeMetrics) : []
  );
}

async function getObservabilityMetricsWithRuntimeMetrics(
  api: ControlPlaneApi,
  runtimeMetrics?: HttpRuntimeMetrics
) {
  return api.getObservabilityMetrics(
    runtimeMetrics ? createSystemAlertsFromRuntimeMetrics(runtimeMetrics) : [],
    runtimeMetrics ? createRuntimeMetricsInputForApi(runtimeMetrics) : undefined
  );
}

function logTaskEvent(
  options: CreateHttpControlPlaneServerOptions,
  request: IncomingMessage,
  event: string,
  task: DeployTask,
  context: MutationContext
) {
  logRequestEvent(options, request, {
    event,
    requestId: context.requestId,
    actor: context.actor,
    taskId: task.id,
    operation: task.operation,
    resourceType: task.resourceType,
    targetId: task.targetId,
    status: task.status
  });
}

function uniqueValues(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

export function createJsonConsoleControlPlaneLogger(): ControlPlaneStructuredLogger {
  return {
    write(event) {
      console.log(JSON.stringify(event));
    }
  };
}

function normalizeOperatorAuthFailureThrottle(
  options: CreateHttpControlPlaneServerOptions['operatorAuthFailureThrottle']
): OperatorAuthFailureThrottle | undefined {
  if (options === false) {
    return undefined;
  }

  const windowMs = Math.round(options?.windowMs ?? defaultOperatorAuthFailureThrottle.windowMs);
  const maxFailures = Math.round(options?.maxFailures ?? defaultOperatorAuthFailureThrottle.maxFailures);

  if (windowMs <= 0 || maxFailures <= 0) {
    return undefined;
  }

  return {
    windowMs,
    maxFailures,
    buckets: new Map()
  };
}

function consumeOperatorAuthFailure(
  throttle: OperatorAuthFailureThrottle | undefined,
  request: IncomingMessage,
  nowMs = Date.now()
): OperatorAuthFailureThrottleResult {
  const fallback = {
    ...defaultOperatorAuthFailureThrottle,
    retryAfterMs: defaultOperatorAuthFailureThrottle.windowMs,
    rateLimited: false,
    shouldAudit: true
  };

  if (!throttle) {
    return fallback;
  }

  const bucketKey = readRequestSourceIp(request);
  const existingBucket = throttle.buckets.get(bucketKey);
  const bucket =
    !existingBucket || nowMs - existingBucket.windowStartedAt >= throttle.windowMs
      ? {
          windowStartedAt: nowMs,
          count: 0,
          rateLimitedAuditRecorded: false
        }
      : existingBucket;

  bucket.count += 1;
  throttle.buckets.set(bucketKey, bucket);

  const retryAfterMs = Math.max(1, throttle.windowMs - (nowMs - bucket.windowStartedAt));

  if (bucket.count <= throttle.maxFailures) {
    return {
      windowMs: throttle.windowMs,
      maxFailures: throttle.maxFailures,
      retryAfterMs,
      rateLimited: false,
      shouldAudit: true
    };
  }

  if (!bucket.rateLimitedAuditRecorded) {
    bucket.rateLimitedAuditRecorded = true;

    return {
      windowMs: throttle.windowMs,
      maxFailures: throttle.maxFailures,
      retryAfterMs,
      rateLimited: true,
      shouldAudit: true
    };
  }

  return {
    windowMs: throttle.windowMs,
    maxFailures: throttle.maxFailures,
    retryAfterMs,
    rateLimited: true,
    shouldAudit: false
  };
}

function getBearerToken(headers: IncomingHttpHeaders) {
  const authorization = getHeader(headers, 'authorization');
  const match = /^Bearer\s+(.+)$/i.exec(authorization ?? '');
  return match?.[1];
}

function getCookie(headers: IncomingHttpHeaders, name: string) {
  const cookieHeader = getHeader(headers, 'cookie');

  if (!cookieHeader) {
    return undefined;
  }

  for (const cookie of cookieHeader.split(';')) {
    const [cookieName, ...cookieValueParts] = cookie.trim().split('=');

    if (cookieName === name) {
      return cookieValueParts.join('=');
    }
  }

  return undefined;
}

function createSha256Digest(value: string) {
  return createHash('sha256').update(value).digest();
}

function timingSafeEqualText(left: string, right: string) {
  return timingSafeEqual(createSha256Digest(left), createSha256Digest(right));
}

function parseHexBuffer(value: string) {
  if (!/^[a-f0-9]+$/i.test(value) || value.length % 2 !== 0) {
    return undefined;
  }

  return Buffer.from(value, 'hex');
}

function verifyOperatorPasswordHash(password: string, passwordHash: string) {
  const [algorithm, version, saltHex, keyHex] = passwordHash.split(':');

  if (algorithm !== 'scrypt' || version !== 'v1' || !saltHex || !keyHex) {
    return false;
  }

  const salt = parseHexBuffer(saltHex);
  const expectedKey = parseHexBuffer(keyHex);

  if (!salt || !expectedKey || expectedKey.length !== 32) {
    return false;
  }

  const actualKey = scryptSync(password, salt, 32);

  return timingSafeEqual(actualKey, expectedKey);
}

function createOperatorSessionSignature(payload: string, secret: string) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function createOperatorSessionCsrfToken(sessionToken: string, secret: string) {
  return createHmac('sha256', secret).update(`csrf:${sessionToken}`).digest('base64url');
}

function readOperatorSessionCookieName(options: HttpControlPlaneAuthOptions['operatorSession']) {
  return options?.cookieName ?? defaultOperatorSessionCookieName;
}

function readOperatorSessionTtlMs(options: HttpControlPlaneAuthOptions['operatorSession']) {
  const ttlMs = Math.round(options?.ttlMs ?? defaultOperatorSessionTtlMs);
  return ttlMs > 0 ? ttlMs : defaultOperatorSessionTtlMs;
}

function createOperatorSessionIdentity(
  options: NonNullable<HttpControlPlaneAuthOptions['operatorSession']>,
  sessionId: string = `operator-session-${randomBytes(12).toString('hex')}`,
  nowMs = Date.now()
): OperatorSessionIdentity {
  const ttlMs = readOperatorSessionTtlMs(options);

  return {
    sessionId,
    username: options.username,
    actor: options.actor ?? options.username,
    operatorGroupId: options.operatorGroupId,
    resourceGroupId: options.resourceGroupId,
    issuedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + ttlMs).toISOString()
  };
}

function createOperatorSessionToken(identity: OperatorSessionIdentity, secret: string) {
  const payload = Buffer.from(
    JSON.stringify({
      sessionId: identity.sessionId,
      username: identity.username,
      actor: identity.actor,
      operatorGroupId: identity.operatorGroupId,
      resourceGroupId: identity.resourceGroupId,
      issuedAt: identity.issuedAt,
      expiresAt: identity.expiresAt,
      nonce: randomBytes(16).toString('base64url')
    })
  ).toString('base64url');
  const signature = createOperatorSessionSignature(payload, secret);

  return `${payload}.${signature}`;
}

async function readOperatorSessionAuthentication(
  request: IncomingMessage,
  options: HttpControlPlaneAuthOptions['operatorSession'],
  sessionStore?: OperatorSessionStore
): Promise<OperatorSessionAuthentication | undefined> {
  if (!options?.sessionSecret) {
    return undefined;
  }

  const token = getCookie(request.headers, readOperatorSessionCookieName(options));

  if (!token) {
    return undefined;
  }

  const [payload, signature] = token.split('.');

  if (!payload || !signature) {
    return undefined;
  }

  const expectedSignature = createOperatorSessionSignature(payload, options.sessionSecret);
  const providedSignature = Buffer.from(signature);
  const expectedSignatureBuffer = Buffer.from(expectedSignature);

  if (providedSignature.length !== expectedSignatureBuffer.length || !timingSafeEqual(providedSignature, expectedSignatureBuffer)) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<OperatorSessionIdentity>;
    const expiresAtMs = typeof parsed.expiresAt === 'string' ? Date.parse(parsed.expiresAt) : Number.NaN;

    if (
      typeof parsed.sessionId !== 'string' ||
      typeof parsed.username !== 'string' ||
      typeof parsed.actor !== 'string' ||
      typeof parsed.issuedAt !== 'string' ||
      typeof parsed.expiresAt !== 'string' ||
      Number.isNaN(expiresAtMs)
    ) {
      return undefined;
    }

    const identity = {
      sessionId: parsed.sessionId,
      username: parsed.username,
      actor: parsed.actor,
      operatorGroupId: typeof parsed.operatorGroupId === 'string' ? parsed.operatorGroupId : undefined,
      resourceGroupId: typeof parsed.resourceGroupId === 'string' ? parsed.resourceGroupId : undefined,
      issuedAt: parsed.issuedAt,
      expiresAt: parsed.expiresAt
    };

    if (sessionStore) {
      const storedSession = await sessionStore.get(identity.sessionId, createOperatorSessionObservationContext(request));

      if (
        !storedSession ||
        storedSession.status !== 'active' ||
        storedSession.username !== identity.username ||
        storedSession.actor !== identity.actor ||
        storedSession.operatorGroupId !== identity.operatorGroupId ||
        storedSession.resourceGroupId !== identity.resourceGroupId ||
        storedSession.expiresAt !== identity.expiresAt
      ) {
        return undefined;
      }
    } else if (expiresAtMs <= Date.now()) {
      return undefined;
    }

    return {
      identity,
      csrfToken: createOperatorSessionCsrfToken(token, options.sessionSecret)
    };
  } catch {
    return undefined;
  }
}

function isOperatorSessionRequestSecure(request: IncomingMessage) {
  const forwardedProto = getHeader(request.headers, 'x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
  return forwardedProto === 'https';
}

function readOperatorSessionCookiePath(request: IncomingMessage) {
  const forwardedPrefix = getHeader(request.headers, 'x-forwarded-prefix')?.trim().replace(/\/+$/, '');

  if (forwardedPrefix && /^\/[A-Za-z0-9._~/-]+$/.test(forwardedPrefix)) {
    return forwardedPrefix;
  }

  return '/';
}

function createOperatorSessionCookie(
  request: IncomingMessage,
  options: NonNullable<HttpControlPlaneAuthOptions['operatorSession']>,
  token: string
) {
  const cookieName = readOperatorSessionCookieName(options);
  const cookiePath = readOperatorSessionCookiePath(request);
  const maxAgeSeconds = Math.max(1, Math.floor(readOperatorSessionTtlMs(options) / 1000));

  return [
    `${cookieName}=${token}`,
    `Path=${cookiePath}`,
    `Max-Age=${maxAgeSeconds}`,
    'HttpOnly',
    'SameSite=Lax',
    ...(isOperatorSessionRequestSecure(request) ? ['Secure'] : [])
  ].join('; ');
}

function createClearOperatorSessionCookie(request: IncomingMessage, options: HttpControlPlaneAuthOptions['operatorSession']) {
  const cookieName = readOperatorSessionCookieName(options);
  const cookiePath = readOperatorSessionCookiePath(request);

  return [
    `${cookieName}=`,
    `Path=${cookiePath}`,
    'Max-Age=0',
    'HttpOnly',
    'SameSite=Lax',
    ...(isOperatorSessionRequestSecure(request) ? ['Secure'] : [])
  ].join('; ');
}

function validateOperatorLogin(
  input: ReturnType<typeof parseOperatorSessionLoginRequest>,
  options: HttpControlPlaneAuthOptions['operatorSession']
) {
  if (!options) {
    return false;
  }

  if (!timingSafeEqualText(input.username, options.username)) {
    return false;
  }

  if (options.passwordHash) {
    return verifyOperatorPasswordHash(input.password, options.passwordHash);
  }

  return typeof options.password === 'string' && timingSafeEqualText(input.password, options.password);
}

function hasTokenRegistry<T>(registry: Record<string, T> | undefined) {
  return Boolean(registry && Object.keys(registry).length > 0);
}

function createTokenDigest(token: string) {
  return createHash('sha256').update(token).digest();
}

function findTokenIdentity<T>(registry: Record<string, T> | undefined, token: string | undefined): T | undefined {
  if (!registry || !token) {
    return undefined;
  }

  const providedDigest = createTokenDigest(token);

  for (const [candidate, identity] of Object.entries(registry)) {
    if (timingSafeEqual(providedDigest, createTokenDigest(candidate))) {
      return identity;
    }
  }

  return undefined;
}

async function authenticateOperator(
  request: IncomingMessage,
  auth: HttpControlPlaneAuthOptions | undefined,
  operatorSessionStore?: OperatorSessionStore
): Promise<OperatorTokenIdentity | undefined> {
  if (!hasTokenRegistry(auth?.operatorTokens) && !auth?.operatorSession) {
    return undefined;
  }

  const token = getBearerToken(request.headers);
  const identity = findTokenIdentity(auth?.operatorTokens, token);
  const sessionIdentity = (await readOperatorSessionAuthentication(request, auth?.operatorSession, operatorSessionStore))
    ?.identity;

  if (!identity && !sessionIdentity) {
    throw createHttpError(401, 'unauthorized', 'A valid operator bearer token or session cookie is required.');
  }

  return identity ?? sessionIdentity;
}

async function requireOperatorSessionCsrfForMutation(
  request: IncomingMessage,
  pathname: string,
  auth: HttpControlPlaneAuthOptions | undefined,
  operatorSessionStore?: OperatorSessionStore
) {
  const method = request.method ?? 'GET';

  if (!mutationMethods.has(method) || pathname === '/api/v1/auth/session' || !isOperatorAuthBoundaryPath(pathname)) {
    return;
  }

  const sessionAuthentication = await readOperatorSessionAuthentication(
    request,
    auth?.operatorSession,
    operatorSessionStore
  );

  if (!sessionAuthentication) {
    return;
  }

  const csrfToken = getHeader(request.headers, 'x-csrf-token');

  if (!csrfToken || !timingSafeEqualText(csrfToken, sessionAuthentication.csrfToken)) {
    throw createHttpError(403, 'csrf.required', 'A valid CSRF token is required for session-backed mutations.');
  }
}

async function authenticateAgent(
  request: IncomingMessage,
  auth: HttpControlPlaneAuthOptions | undefined
): Promise<AgentTokenIdentity | undefined> {
  if (!hasTokenRegistry(auth?.agentTokens) && !auth?.agentTokenResolver) {
    return undefined;
  }

  const token = getBearerToken(request.headers);
  const identity = findTokenIdentity(auth?.agentTokens, token) ?? (token ? await auth?.agentTokenResolver?.(token) : undefined);

  if (!identity) {
    throw createHttpError(401, 'unauthorized', 'A valid Agent bearer token is required.');
  }

  return identity;
}

async function requireOperatorForProtectedRead(
  request: IncomingMessage,
  pathname: string,
  auth: HttpControlPlaneAuthOptions | undefined,
  operatorSessionStore?: OperatorSessionStore
) {
  if (operatorProtectedReadRoutes.has(pathname)) {
    await authenticateOperator(request, auth, operatorSessionStore);
    return;
  }

  if (getTaskIdFromPath(pathname)) {
    await authenticateOperator(request, auth, operatorSessionStore);
  }
}

async function createMutationContext(
  request: IncomingMessage,
  auth?: HttpControlPlaneAuthOptions,
  operatorSessionStore?: OperatorSessionStore
): Promise<MutationContext> {
  const tokenIdentity = await authenticateOperator(request, auth, operatorSessionStore);
  const requestId = getHeader(request.headers, 'x-request-id');

  if (!requestId && mutationMethods.has(request.method ?? 'GET')) {
    throw createHttpError(400, 'bad_request', 'X-Request-Id header is required for mutations.');
  }

  const actor = tokenIdentity?.actor ?? getHeader(request.headers, 'x-actor');

  if (!actor && mutationMethods.has(request.method ?? 'GET')) {
    throw createHttpError(400, 'bad_request', 'X-Actor header is required for mutations.');
  }

  return {
    actor: actor ?? 'anonymous',
    operatorGroupId: tokenIdentity ? tokenIdentity.operatorGroupId : getHeader(request.headers, 'x-operator-group-id'),
    resourceGroupId: tokenIdentity ? tokenIdentity.resourceGroupId : getHeader(request.headers, 'x-resource-group-id'),
    sourceIp: readRequestSourceIp(request),
    userAgent: getHeader(request.headers, 'user-agent'),
    requestId: requestId ?? createRequestId(request.headers),
    idempotencyKey: getHeader(request.headers, 'idempotency-key'),
    ifMatch: getHeader(request.headers, 'if-match')
  };
}

function assertAgentIdentityMatches(
  agentIdentity: AgentTokenIdentity | undefined,
  agentIds: string[],
  sessionIds: string[] = []
) {
  if (!agentIdentity) {
    return;
  }

  const mismatchedAgentId = agentIds.find((agentId) => agentId !== agentIdentity.agentId);

  if (mismatchedAgentId) {
    throw createHttpError(
      403,
      'identity.mismatch',
      `Agent bearer token is bound to ${agentIdentity.agentId}, not ${mismatchedAgentId}.`
    );
  }

  if (agentIdentity.sessionId) {
    const mismatchedSessionId =
      sessionIds.length === 0 ? '(missing)' : sessionIds.find((sessionId) => sessionId !== agentIdentity.sessionId);

    if (mismatchedSessionId) {
      throw createHttpError(
        403,
        'identity.mismatch',
        `Agent bearer token is bound to session ${agentIdentity.sessionId}, not ${mismatchedSessionId}.`
      );
    }
  }
}

async function recordDeniedAgentRequest(
  api: ControlPlaneApi,
  serverOptions: CreateHttpControlPlaneServerOptions,
  runtimeMetrics: HttpRuntimeMetrics,
  request: IncomingMessage,
  endpoint: 'poll' | 'events' | 'credential_rotate',
  requestId: string,
  error: HttpError,
  options: {
    agentIds?: string[];
    sessionIds?: string[];
    agentIdentity?: AgentTokenIdentity;
  } = {}
) {
  if (error.code !== 'unauthorized' && error.code !== 'identity.mismatch') {
    return;
  }

  try {
    await api.recordAgentRequestDenied({
      endpoint,
      requestId,
      sourceIp: readRequestSourceIp(request),
      userAgent: getHeader(request.headers, 'user-agent'),
      denialCode: error.code,
      denialReason: error.message,
      tokenPresented: Boolean(getBearerToken(request.headers)),
      agentIds: options.agentIds,
      sessionIds: options.sessionIds,
      authenticatedAgentId: options.agentIdentity?.agentId,
      authenticatedSessionId: options.agentIdentity?.sessionId,
      credentialId: options.agentIdentity?.credentialId
    });
  } catch (auditError) {
    recordAuditWriteFailure(serverOptions, runtimeMetrics, request, {
      requestId,
      auditKind: 'agent.denied',
      error: auditError
    });
  }
}

function isOperatorAuthBoundaryPath(pathname: string) {
  return pathname === '/metrics' || pathname.startsWith('/api/v1/') || pathname.startsWith('/events/v1/');
}

async function recordDeniedOperatorRequest(
  api: ControlPlaneApi,
  serverOptions: CreateHttpControlPlaneServerOptions,
  runtimeMetrics: HttpRuntimeMetrics,
  request: IncomingMessage,
  method: string,
  pathname: string,
  requestId: string,
  error: HttpError,
  throttle: OperatorAuthFailureThrottle | undefined
): Promise<HttpError | undefined> {
  if ((error.code !== 'unauthorized' && error.code !== 'csrf.required') || !isOperatorAuthBoundaryPath(pathname)) {
    return undefined;
  }

  // Session-presence checks back the login overlay and logout/revoke smoke paths.
  // Missing or revoked cookies here are expected and should return promptly without
  // consuming auth-failure throttle windows or synchronously appending denied audits.
  if (error.code === 'unauthorized' && method === 'GET' && pathname === '/api/v1/auth/session') {
    return undefined;
  }

  if (error.code === 'csrf.required') {
    try {
      await api.recordOperatorRequestDenied({
        method,
        path: pathname,
        requestId,
        sourceIp: readRequestSourceIp(request),
        userAgent: getHeader(request.headers, 'user-agent'),
        denialCode: 'csrf.required',
        denialReason: error.message,
        tokenPresented: Boolean(getBearerToken(request.headers))
      });
    } catch (auditError) {
      recordAuditWriteFailure(serverOptions, runtimeMetrics, request, {
        requestId,
        auditKind: 'operator.denied',
        error: auditError
      });
    }

    return error;
  }

  const throttleResult = consumeOperatorAuthFailure(throttle, request);
  const effectiveError = throttleResult.rateLimited
    ? createHttpError(429, 'operator_auth.rate_limited', 'Too many failed operator authentication attempts.', {
        retryAfterMs: throttleResult.retryAfterMs,
        windowMs: throttleResult.windowMs,
        maxFailures: throttleResult.maxFailures
      })
    : error;

  if (throttleResult.shouldAudit) {
    try {
      await api.recordOperatorRequestDenied({
        method,
        path: pathname,
        requestId,
        sourceIp: readRequestSourceIp(request),
        userAgent: getHeader(request.headers, 'user-agent'),
        denialCode: effectiveError.code === 'operator_auth.rate_limited' ? 'operator_auth.rate_limited' : 'unauthorized',
        denialReason: effectiveError.message,
        tokenPresented: Boolean(getBearerToken(request.headers))
      });
    } catch (auditError) {
      recordAuditWriteFailure(serverOptions, runtimeMetrics, request, {
        requestId,
        auditKind: 'operator.denied',
        error: auditError
      });
    }
  }

  return effectiveError;
}

function registerEphemeralAgentToken(
  auth: HttpControlPlaneAuthOptions | undefined,
  token: string,
  agentId: string,
  sessionId?: string,
  credentialId?: string
) {
  if (!auth || auth.agentTokenResolver) {
    return;
  }

  auth.agentTokens = {
    ...(auth.agentTokens ?? {}),
    [token]: {
      agentId,
      credentialId,
      sessionId
    }
  };
}

function revokeEphemeralAgentCredential(auth: HttpControlPlaneAuthOptions | undefined, credentialId: string) {
  if (!auth?.agentTokens || auth.agentTokenResolver) {
    return;
  }

  auth.agentTokens = Object.fromEntries(
    Object.entries(auth.agentTokens).filter(([, identity]) => identity.credentialId !== credentialId)
  );
}

function createHttpError(status: number, code: HttpErrorCode, message: string, details?: unknown): HttpError {
  return {
    status,
    code,
    message,
    details
  };
}

function readHttpError(error: unknown): HttpError | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  const candidate = error as Partial<HttpError>;

  if (typeof candidate.status !== 'number' || typeof candidate.code !== 'string' || typeof candidate.message !== 'string') {
    return undefined;
  }

  return candidate as HttpError;
}

function isRejectableAgentEventConflict(error: unknown) {
  const httpError = readHttpError(error) ?? mapThrownError(error);

  return (
    httpError.status === 409 &&
    (httpError.code === 'agent_event.command_deadline_expired' ||
      httpError.code === 'agent_event.command_task_mismatch' ||
      httpError.code === 'agent_event.sequence_replay')
  );
}

function readStructuredControlPlaneError(error: unknown) {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  const code = 'code' in error ? (error as { code?: unknown }).code : undefined;

  if (typeof code !== 'string') {
    return undefined;
  }

  return {
    code,
    details: 'details' in error ? (error as { details?: unknown }).details : undefined
  };
}

function readStructuredDenialReason(details: unknown) {
  if (!details || typeof details !== 'object') {
    return undefined;
  }

  const denialReason = (details as { denialReason?: unknown }).denialReason;
  return typeof denialReason === 'string' && denialReason.trim() !== '' ? denialReason : undefined;
}

function mapThrownError(error: unknown): HttpError {
  const message = error instanceof Error ? error.message : String(error);
  const structuredError = readStructuredControlPlaneError(error);

  if (structuredError?.code === 'subscription_source.rate_limited') {
    return createHttpError(
      429,
      'subscription_source.rate_limited',
      'Subscription source sync is rate limited.',
      structuredError.details
    );
  }

  if (structuredError?.code === 'permission.denied') {
    return createHttpError(
      403,
      'permission.denied',
      readStructuredDenialReason(structuredError.details) ?? 'The actor is not allowed to perform this mutation.',
      structuredError.details
    );
  }

  if (structuredError?.code === 'validation_error') {
    return createHttpError(422, 'validation_error', message, structuredError.details);
  }

  if (structuredError?.code === 'permission_grant.last_admin_path') {
    return createHttpError(
      409,
      'permission_grant.last_admin_path',
      readStructuredDenialReason(structuredError.details) ??
        'Permission revoke would remove the last administrative grant path for this resource.',
      structuredError.details
    );
  }

  if (structuredError?.code === 'high_risk_confirmation.required') {
    return createHttpError(
      409,
      'high_risk_confirmation.required',
      readStructuredDenialReason(structuredError.details) ??
        'High-risk operations require explicit confirmation that matches the operation and target.',
      structuredError.details
    );
  }

  if (structuredError?.code === 'permission_grant.not_found') {
    return createHttpError(404, 'permission_grant.not_found', 'Permission grant does not exist.', structuredError.details);
  }

  if (structuredError?.code === 'permission_grant.already_revoked') {
    return createHttpError(
      409,
      'permission_grant.already_revoked',
      'Permission grant is already revoked.',
      structuredError.details
    );
  }

  if (structuredError?.code === 'permission_grant.mismatch') {
    return createHttpError(
      409,
      'permission_grant.mismatch',
      'Permission revoke payload does not match the target grant.',
      structuredError.details
    );
  }

  if (structuredError?.code === 'permission_change.required') {
    return createHttpError(
      422,
      'permission_change.required',
      'Permission revoke requires an explicit permissionChange payload.',
      structuredError.details
    );
  }

  if (message.includes('idempotency.conflict')) {
    return createHttpError(409, 'idempotency.conflict', 'Idempotency key was replayed with a different request body.');
  }

  if (structuredError?.code === 'idempotency.replay_unavailable' || message.includes('idempotency.replay_unavailable')) {
    return createHttpError(
      409,
      'idempotency.replay_unavailable',
      'The original one-time Agent install command cannot be replayed because the raw install token is not stored.',
      structuredError?.details
    );
  }

  if (
    structuredError?.code === 'agent_upgrade.runtime_credential_required' ||
    message.includes('agent_upgrade.runtime_credential_required')
  ) {
    return createHttpError(
      409,
      'agent_upgrade.runtime_credential_required',
      'Agent runtime upgrade command requires an active runtime credential.',
      structuredError?.details
    );
  }

  if (
    structuredError?.code === 'agent_upgrade.self_update_unsupported' ||
    message.includes('agent_upgrade.self_update_unsupported')
  ) {
    return createHttpError(
      409,
      'agent_upgrade.self_update_unsupported',
      'Remote Agent upgrade requires the target Agent to advertise self-update support.',
      structuredError?.details
    );
  }

  if (message.includes('permission.denied')) {
    return createHttpError(403, 'permission.denied', 'The actor is not allowed to perform this mutation.');
  }

  if (message.includes('resource_version.conflict')) {
    return createHttpError(409, 'resource_version.conflict', 'The supplied If-Match resource version is stale.');
  }

  if (message.includes('agent_target.required')) {
    return createHttpError(
      422,
      'validation_error',
      'This runtime operation requires at least one target Agent before it can be dispatched.',
      structuredError?.details
    );
  }

  if (structuredError?.code === 'agent_result.required' || message.includes('agent_result.required')) {
    return createHttpError(
      409,
      'agent_result.required',
      'Runtime command success must be recorded from Agent result events.',
      structuredError?.details
    );
  }

  if (message.includes('Invalid task transition')) {
    return createHttpError(409, 'task.invalid_transition', message);
  }

  if (message.includes('agent_event.command_deadline_expired')) {
    return createHttpError(
      409,
      'agent_event.command_deadline_expired',
      'Agent event was observed after the command deadline.'
    );
  }

  if (structuredError?.code === 'agent_event.command_task_mismatch' || message.includes('agent_event.command_task_mismatch')) {
    return createHttpError(
      409,
      'agent_event.command_task_mismatch',
      'Agent event command, task, and Agent identity must match the command outbox lease.',
      structuredError?.details
    );
  }

  if (message.includes('agent_event.sequence_replay')) {
    return createHttpError(409, 'agent_event.sequence_replay', 'Agent event sequence was replayed or stale.');
  }

  if (message.includes('agent_registration.install_token')) {
    return createHttpError(401, 'unauthorized', 'A valid Agent install token is required for registration.');
  }

  if (message.includes('agent_registration.agent_mismatch')) {
    return createHttpError(403, 'identity.mismatch', 'Agent registration token is bound to a different Agent identity.');
  }

  if (message.includes('agent_credential.rotate_inactive')) {
    return createHttpError(409, 'credential.inactive', 'Agent credential is not active and cannot be rotated.');
  }

  if (message.includes('agent_credential.rotate_runtime_required')) {
    return createHttpError(422, 'validation_error', 'Only runtime Agent credentials can be rotated.');
  }

  if (message.includes('Invalid ') || message.includes('Required')) {
    return createHttpError(422, 'validation_error', message);
  }

  if (message.includes('not found') || message.includes('not found:') || message.includes('not found')) {
    return createHttpError(404, 'not_found', message);
  }

  return createHttpError(500, 'bad_request', message);
}

function shouldRedactHttpResponseKey(key: string) {
  return key === 'tokenHash' || key === 'accessTokenHash';
}

function redactHttpResponseSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactHttpResponseSecrets(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const redacted: Record<string, unknown> = {};

  for (const [key, item] of Object.entries(value)) {
    if (shouldRedactHttpResponseKey(key)) {
      continue;
    }

    redacted[key] = redactHttpResponseSecrets(item);
  }

  return redacted;
}

function sendJson(response: ServerResponse, status: number, body: unknown, headers: Record<string, string | number> = {}) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    ...headers
  });
  response.end(payload);
}

function sendData(response: ServerResponse, requestId: string, data: unknown, status = 200, taskId?: string) {
  sendJson(response, status, {
    data: redactHttpResponseSecrets(data),
    requestId,
    ...(taskId ? { taskId } : {})
  });
}

function sendError(response: ServerResponse, requestId: string, error: HttpError) {
  const retryAfterMs =
    error.details && typeof error.details === 'object' && 'retryAfterMs' in error.details
      ? (error.details as { retryAfterMs?: unknown }).retryAfterMs
      : undefined;
  const retryAfterSeconds =
    typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs)
      ? Math.max(1, Math.ceil(retryAfterMs / 1000))
      : undefined;

  sendJson(
    response,
    error.status,
    {
      error: {
        code: error.code,
        message: error.message,
        details: error.details
      },
      requestId
    },
    retryAfterSeconds ? { 'Retry-After': retryAfterSeconds } : {}
  );
}

function sendRaw(response: ServerResponse, status: number, output: PublicSubscriptionOutput) {
  response.writeHead(status, {
    'Content-Type': output.contentType,
    'Content-Length': Buffer.byteLength(output.body),
    'Cache-Control': 'no-store',
    ...output.headers
  });
  response.end(output.body);
}

function sendHtml(response: ServerResponse, status: number, body: string) {
  response.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  response.end(body);
}

function sendText(response: ServerResponse, status: number, contentType: string, body: string) {
  response.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body)
  });
  response.end(body);
}

function sendSseEvent(response: ServerResponse, event: string, id: string, data: unknown) {
  response.write(`event: ${event}\n`);
  response.write(`id: ${id}\n`);
  response.write(`data: ${JSON.stringify(redactHttpResponseSecrets(data))}\n\n`);
}

async function readJsonBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function getTaskIdFromPath(pathname: string) {
  const match = /^\/api\/v1\/tasks\/([^/]+)$/.exec(pathname);
  return match?.[1];
}

function getTransitionTaskIdFromPath(pathname: string) {
  const match = /^\/api\/v1\/tasks\/([^/]+)\/transition$/.exec(pathname);
  return match?.[1];
}

function getAgentCommandAgentIdFromPath(pathname: string) {
  const match = /^\/api\/v1\/agents\/([^/]+)\/commands$/.exec(pathname);
  return match?.[1];
}

function getAgentUpgradeCommandAgentIdFromPath(pathname: string) {
  const match = /^\/api\/v1\/agents\/([^/]+)\/upgrade-command$/.exec(pathname);
  return match?.[1];
}

function getOperatorSessionRevokeIdFromPath(pathname: string) {
  const match = /^\/api\/v1\/operator-sessions\/([^/]+)\/revoke$/.exec(pathname);
  return match?.[1];
}

function getAgentCredentialRevokeIdFromPath(pathname: string) {
  const match = /^\/api\/v1\/agent-credentials\/([^/]+)\/revoke$/.exec(pathname);
  return match?.[1];
}

function getAgentCredentialRotateIdFromPath(pathname: string) {
  const match = /^\/api\/v1\/agent-credentials\/([^/]+)\/rotate$/.exec(pathname);
  return match?.[1];
}

function getQuotaPolicyResetIdFromPath(pathname: string) {
  const match = /^\/api\/v1\/quota-policies\/([^/]+)\/reset$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function getPublicSubscriptionPath(pathname: string) {
  const match = /^\/sub\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(pathname);

  if (!match) {
    return undefined;
  }

  const [, securePath, format, subId] = match;
  return {
    securePath: `/${decodeURIComponent(securePath)}`,
    format: decodeURIComponent(format),
    subId: decodeURIComponent(subId)
  };
}

function getPublicSubscriptionPortalPath(pathname: string) {
  const match = /^\/portal\/([^/]+)\/([^/]+)$/.exec(pathname);

  if (!match) {
    return undefined;
  }

  const [, securePath, subId] = match;
  return {
    securePath: `/${decodeURIComponent(securePath)}`,
    subId: decodeURIComponent(subId)
  };
}

const subscriptionClientFormatToOutputFormat: Record<SubscriptionClientFormat, SubscriptionClientOutputFormat> = {
  plain: 'uri',
  json: 'v2ray',
  clash: 'clash',
  mihomo: 'mihomo',
  'sing-box': 'sing-box'
};

type PublicSubscriptionRequestKind = PublicSubscriptionFormat | 'portal';

function resolveAllowedSubscriptionOutputFormats(client: SubscriptionClientIdentity) {
  const explicitFormats = client.outputFormats ?? [];

  if (explicitFormats.length > 0) {
    return new Set<SubscriptionClientOutputFormat>(explicitFormats);
  }

  return new Set<SubscriptionClientOutputFormat>(
    client.formats.map((format) => subscriptionClientFormatToOutputFormat[format]).filter(Boolean)
  );
}

function isSubscriptionFormatAllowed(client: SubscriptionClientIdentity, format: PublicSubscriptionFormat) {
  return resolveAllowedSubscriptionOutputFormats(client).has(format as SubscriptionClientOutputFormat);
}

function createSubscriptionQuotaExceededError(client: SubscriptionClientIdentity) {
  return createHttpError(403, 'subscription.quota_exceeded', 'Subscription traffic quota has been exhausted.', {
    clientId: client.id,
    subId: client.subId,
    usedTrafficBytes: Math.max(client.usedTrafficBytes, 0),
    trafficLimitBytes: Math.max(client.trafficLimitBytes, 0),
    guardrailReason: client.guardrailReason ?? 'subscription_client_quota_exceeded'
  });
}

function isSubscriptionQuotaExceeded(client: SubscriptionClientIdentity) {
  const trafficLimitBytes = Math.max(client.trafficLimitBytes, 0);
  const usedTrafficBytes = Math.max(client.usedTrafficBytes, 0);

  return client.quotaExceeded === true || (trafficLimitBytes > 0 && usedTrafficBytes >= trafficLimitBytes);
}

function createPublicSubscriptionAccessTokenHash(token: string) {
  return `sha256:${createHash('sha256').update(token).digest('hex')}`;
}

function readBearerToken(headers: IncomingHttpHeaders) {
  const authorization = Array.isArray(headers.authorization) ? headers.authorization[0] : headers.authorization;
  const match = /^Bearer\s+(.+)$/i.exec(authorization ?? '');
  return match?.[1]?.trim() || undefined;
}

function readPublicSubscriptionAccessToken(url: URL, headers: IncomingHttpHeaders) {
  return url.searchParams.get('token')?.trim() || url.searchParams.get('access_token')?.trim() || readBearerToken(headers);
}

function timingSafeHashEqual(left: string, right: string) {
  const leftDigest = left.replace(/^sha256:/i, '');
  const rightDigest = right.replace(/^sha256:/i, '');

  if (!/^[a-f0-9]{64}$/i.test(leftDigest) || !/^[a-f0-9]{64}$/i.test(rightDigest)) {
    return false;
  }

  return timingSafeEqual(Buffer.from(leftDigest, 'hex'), Buffer.from(rightDigest, 'hex'));
}

function verifyPublicSubscriptionAccessToken(client: SubscriptionClientIdentity, token: string | undefined) {
  const expectedHash = client.accessTokenHash;

  if (!expectedHash) {
    return;
  }

  if (!token) {
    throw createHttpError(401, 'unauthorized', 'Subscription access token is required.', {
      clientId: client.id,
      subId: client.subId,
      tokenRequired: true
    });
  }

  const actualHash = createPublicSubscriptionAccessTokenHash(token);

  if (!timingSafeHashEqual(actualHash, expectedHash)) {
    throw createHttpError(401, 'unauthorized', 'Subscription access token is invalid.', {
      clientId: client.id,
      subId: client.subId,
      tokenRequired: true
    });
  }
}

function normalizeCreateTaskSubscriptionAccessToken(input: CreateTaskInput): CreateTaskInput {
  const rawToken = input.metadata?.accessTokenRaw;

  if (typeof rawToken !== 'string') {
    return input;
  }

  const metadata = { ...input.metadata };
  delete metadata.accessTokenRaw;

  if (rawToken.trim()) {
    metadata.accessTokenHash = createPublicSubscriptionAccessTokenHash(rawToken.trim());
  }

  return {
    ...input,
    metadata
  };
}

async function resolvePublicSubscriptionClient(
  api: ControlPlaneApi,
  path: { securePath: string; subId: string }
) {
  const clients = await api.listSubscriptionClients();
  const client = clients.find((item) => item.subId === path.subId && item.securePathPreview === path.securePath);

  if (!client) {
    throw createHttpError(404, 'not_found', 'Subscription client not found.');
  }

  if (!client.enabled) {
    throw createHttpError(403, 'permission.denied', 'Subscription client is disabled.');
  }

  const expiresAtMs = Date.parse(client.expiresAt);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    throw createHttpError(403, 'permission.denied', 'Subscription client is expired.');
  }

  if (isSubscriptionQuotaExceeded(client) || client.runtimeDisabledByPolicy) {
    throw createSubscriptionQuotaExceededError(client);
  }

  return client;
}

function consumePublicSubscriptionRequest(
  client: SubscriptionClientIdentity,
  requestKind: PublicSubscriptionRequestKind,
  now = Date.now()
) {
  const requestLimitPerHour = Math.max(Math.round(client.requestLimitPerHour ?? 360), 0);

  if (requestLimitPerHour === 0) {
    return;
  }

  const bucketKey = `${client.id}:${client.subId}`;
  const currentWindowStartedAt = Math.floor(now / publicSubscriptionRateWindowMs) * publicSubscriptionRateWindowMs;
  const existing = publicSubscriptionRequestBuckets.get(bucketKey);
  const bucket =
    existing && existing.windowStartedAt === currentWindowStartedAt
      ? existing
      : {
          windowStartedAt: currentWindowStartedAt,
          count: 0
        };

  if (bucket.count >= requestLimitPerHour) {
    throw createHttpError(429, 'subscription.rate_limited', 'Subscription request limit exceeded.', {
      clientId: client.id,
      subId: client.subId,
      format: requestKind,
      requestLimitPerHour,
      windowResetAt: new Date(currentWindowStartedAt + publicSubscriptionRateWindowMs).toISOString()
    });
  }

  bucket.count += 1;
  publicSubscriptionRequestBuckets.set(bucketKey, bucket);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatPortalBytes(value: number) {
  const bytes = Math.max(Number.isFinite(value) ? value : 0, 0);
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let unitIndex = 0;
  let nextValue = bytes;

  while (nextValue >= 1024 && unitIndex < units.length - 1) {
    nextValue /= 1024;
    unitIndex += 1;
  }

  return `${nextValue.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}

function formatPublicSubscriptionLabel(format: SubscriptionClientOutputFormat) {
  if (format === 'uri') return 'URI';
  if (format === 'v2ray') return 'v2ray';
  if (format === 'sing-box') return 'sing-box';
  if (format === 'shadowrocket') return 'Shadowrocket';
  if (format === 'stash') return 'Stash';
  return format[0].toUpperCase() + format.slice(1);
}

function createPublicSubscriptionUrl(
  client: SubscriptionClientIdentity,
  format: SubscriptionClientOutputFormat,
  accessToken?: string
) {
  const securePath = (client.securePathPreview ?? '').replace(/^\/+/, '');
  const url = `/sub/${encodeURIComponent(securePath)}/${encodeURIComponent(format)}/${encodeURIComponent(client.subId)}`;
  return accessToken ? `${url}?token=${encodeURIComponent(accessToken)}` : url;
}

function createPublicSubscriptionQrUrl(relativeUrl: string, publicBaseUrl: string | undefined) {
  if (!publicBaseUrl) {
    return relativeUrl;
  }

  try {
    return new URL(relativeUrl, publicBaseUrl).toString();
  } catch {
    return relativeUrl;
  }
}

async function createPublicSubscriptionQrSvg(value: string) {
  try {
    return await QRCode.toString(value, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 148,
      color: {
        dark: '#07111F',
        light: '#FFFFFF'
      }
    });
  } catch {
    return undefined;
  }
}

async function renderPublicSubscriptionPortal(
  client: SubscriptionClientIdentity,
  options: { accessToken?: string; publicBaseUrl?: string } = {}
) {
  const outputFormats = Array.from(resolveAllowedSubscriptionOutputFormats(client));
  const trafficLimitBytes = Math.max(client.trafficLimitBytes, 0);
  const usedTrafficBytes = Math.max(client.usedTrafficBytes, 0);
  const remainingBytes = trafficLimitBytes > 0 ? Math.max(trafficLimitBytes - usedTrafficBytes, 0) : undefined;
  const links = (
    await Promise.all(
      outputFormats.map(async (format) => {
        const label = formatPublicSubscriptionLabel(format);
        const href = createPublicSubscriptionUrl(client, format, options.accessToken);
        const qrHref = createPublicSubscriptionQrUrl(href, options.publicBaseUrl);
        const qrSvg = await createPublicSubscriptionQrSvg(qrHref);

        return `<li>
        <div class="link-copy">
          <a data-format="${escapeHtml(format)}" href="${escapeHtml(href)}">${escapeHtml(label)}</a>
          <code>${escapeHtml(href)}</code>
        </div>
        ${
          qrSvg
            ? `<div class="qr" data-format-qr="${escapeHtml(format)}" data-qr-href="${escapeHtml(qrHref)}" aria-label="${escapeHtml(label)} QR code">${qrSvg}</div>`
            : ''
        }
      </li>`;
      })
    )
  )
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(client.displayName)} - OU-UI Next Subscription</title>
  <style>
    body{margin:0;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#fffdf5;color:#07111f}
    main{max-width:840px;margin:0 auto;padding:32px 20px}
    h1{font-size:24px;margin:0 0 6px}
    .meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:24px 0}
    .cell{border:1px solid rgba(7,17,31,.14);background:#fff;padding:14px}
    .label{display:block;font-size:11px;font-weight:800;text-transform:uppercase;color:#35405a;margin-bottom:6px}
    ul{list-style:none;padding:0;margin:0;display:grid;gap:10px}
    li{border:1px solid rgba(30,58,255,.25);background:#dce1ff66;padding:12px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center}
    .link-copy{display:grid;gap:8px;min-width:0}
    a{font-weight:800;color:#1e3aff;text-decoration:none}
    code{overflow-wrap:anywhere;font-size:12px;color:#35405a}
    .qr{width:148px;height:148px;background:#fff;border:1px solid rgba(7,17,31,.12);padding:8px}
    .qr svg{display:block;width:100%;height:100%}
    @media (max-width:560px){li{grid-template-columns:1fr}.qr{width:132px;height:132px}}
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(client.displayName)}</h1>
    <p>OU-UI Next subscription portal</p>
    <section class="meta" aria-label="Subscription status">
      <div class="cell"><span class="label">Sub ID</span>${escapeHtml(client.subId)}</div>
      <div class="cell"><span class="label">Expires At</span>${escapeHtml(client.expiresAt)}</div>
      <div class="cell"><span class="label">Used Traffic</span>${escapeHtml(formatPortalBytes(usedTrafficBytes))}</div>
      <div class="cell"><span class="label">Traffic Limit</span>${trafficLimitBytes > 0 ? escapeHtml(formatPortalBytes(trafficLimitBytes)) : 'Unlimited'}</div>
      <div class="cell"><span class="label">Remaining</span>${remainingBytes === undefined ? 'Unlimited' : escapeHtml(formatPortalBytes(remainingBytes))}</div>
      <div class="cell"><span class="label">Generated Nodes</span>${Math.max(client.generatedNodeCount, 0)}</div>
    </section>
    <section aria-label="Subscription links">
      <h2>Subscription links</h2>
      <ul>${links || '<li>No output formats are enabled.</li>'}</ul>
    </section>
  </main>
</body>
</html>`;
}

function getSubscriptionSourceSyncIdFromPath(pathname: string) {
  const match = /^\/api\/v1\/subscription-sources\/([^/]+)\/sync$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function readAgentLogChunkQuery(url: URL) {
  const limit = url.searchParams.get('limit');
  const pageSize = url.searchParams.get('pageSize');
  const format = url.searchParams.get('format');
  const exportFormat: 'jsonl' | 'json' | undefined =
    format === 'json' ? 'json' : format === 'jsonl' ? 'jsonl' : undefined;

  return {
    agentId: url.searchParams.get('agentId') ?? undefined,
    taskId: url.searchParams.get('taskId') ?? undefined,
    commandId: url.searchParams.get('commandId') ?? undefined,
    since: url.searchParams.get('since') ?? undefined,
    limit: limit ? Number(limit) : undefined,
    pageSize: pageSize ? Number(pageSize) : undefined,
    format: exportFormat
  };
}

function readAgentLogArchiveQuery(url: URL) {
  const limit = url.searchParams.get('limit');
  const pageSize = url.searchParams.get('pageSize');
  const format = url.searchParams.get('format');
  const stream = url.searchParams.get('stream');
  const exportFormat: 'jsonl' | 'json' | undefined =
    format === 'json' ? 'json' : format === 'jsonl' ? 'jsonl' : undefined;
  const archiveStream: 'stdout' | 'stderr' | 'agent' | 'runtime' | undefined =
    stream === 'stdout' || stream === 'stderr' || stream === 'agent' || stream === 'runtime'
      ? stream
      : undefined;

  return {
    agentId: url.searchParams.get('agentId') ?? undefined,
    taskId: url.searchParams.get('taskId') ?? undefined,
    commandId: url.searchParams.get('commandId') ?? undefined,
    stream: archiveStream,
    since: url.searchParams.get('since') ?? undefined,
    until: url.searchParams.get('until') ?? undefined,
    limit: limit ? Number(limit) : undefined,
    pageSize: pageSize ? Number(pageSize) : undefined,
    format: exportFormat
  };
}

function readTrafficRollupQuery(url: URL) {
  const limit = url.searchParams.get('limit');
  const pageSize = url.searchParams.get('pageSize');
  const format = url.searchParams.get('format');
  const dimension = url.searchParams.get('dimension');
  const exportFormat: 'jsonl' | 'json' | undefined =
    format === 'json' ? 'json' : format === 'jsonl' ? 'jsonl' : undefined;
  const rollupDimension: TrafficRollupDimension | undefined =
    dimension === 'agent' || dimension === 'forward-rule' || dimension === 'xray-client' ? dimension : undefined;

  return {
    dimension: rollupDimension,
    agentId: url.searchParams.get('agentId') ?? undefined,
    subjectId: url.searchParams.get('subjectId') ?? undefined,
    since: url.searchParams.get('since') ?? undefined,
    until: url.searchParams.get('until') ?? undefined,
    limit: limit ? Number(limit) : undefined,
    pageSize: pageSize ? Number(pageSize) : undefined,
    format: exportFormat
  };
}

function readTrafficRollupCompactionQuery(url: URL) {
  return {
    ...readTrafficRollupQuery(url),
    periodKey: url.searchParams.get('periodKey') ?? undefined
  };
}

function readOptionalString(value: string | undefined | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function readTaskEventQuery(url: URL, headers?: IncomingHttpHeaders) {
  return {
    since: readOptionalString(url.searchParams.get('since')),
    cursor:
      readOptionalString(url.searchParams.get('cursor')) ??
      (headers ? readOptionalString(getHeader(headers, 'last-event-id')) : undefined),
    taskId: readOptionalString(url.searchParams.get('taskId')),
    once: url.searchParams.get('once') === '1' || url.searchParams.get('mode') === 'snapshot'
  };
}

function readSystemAlertEventQuery(url: URL, headers?: IncomingHttpHeaders) {
  return {
    cursor:
      readOptionalString(url.searchParams.get('cursor')) ??
      (headers ? readOptionalString(getHeader(headers, 'last-event-id')) : undefined),
    severity: readOptionalString(url.searchParams.get('severity')),
    resourceId: readOptionalString(url.searchParams.get('resourceId')),
    once: url.searchParams.get('once') === '1' || url.searchParams.get('mode') === 'snapshot'
  };
}

function isAtOrAfter(timestamp: string, since: string | undefined) {
  if (!since) {
    return true;
  }

  const timestampMs = Date.parse(timestamp);
  const sinceMs = Date.parse(since);

  if (Number.isNaN(timestampMs) || Number.isNaN(sinceMs)) {
    return true;
  }

  return timestampMs >= sinceMs;
}

function createTaskStatusSseEvent(task: DeployTask): TaskSseEvent {
  return {
    event: 'task.status.changed',
    id: `task:${task.id}:${task.updatedAt}`,
    taskId: task.id,
    occurredAt: task.updatedAt,
    data: {
      taskId: task.id,
      status: task.status,
      operation: task.operation,
      targetId: task.targetId,
      targetLabel: task.targetLabel,
      summary: task.summary,
      occurredAt: task.updatedAt
    }
  };
}

function isDeployTaskStatus(value: unknown): value is DeployTaskStatus {
  return (
    value === 'queued'
    || value === 'running'
    || value === 'succeeded'
    || value === 'failed'
    || value === 'retrying'
    || value === 'rolled_back'
    || value === 'canceled'
  );
}

function readTaskStatusFromAuditLog(auditLog: AuditLog): DeployTaskStatus | undefined {
  if (auditLog.action === 'task.created') {
    return 'queued';
  }

  const actionStatus = auditLog.action.replace(/^task\./, '');

  if (isDeployTaskStatus(actionStatus)) {
    return actionStatus;
  }

  const after = auditLog.after;

  if (after && typeof after === 'object' && isDeployTaskStatus((after as { status?: unknown }).status)) {
    return (after as { status: DeployTaskStatus }).status;
  }

  return undefined;
}

function readTaskSummaryFromAuditLog(task: DeployTask | undefined, auditLog: AuditLog) {
  if (task?.summary) {
    return task.summary;
  }

  return auditLog.message.replace(/\s*->\s*task\.[a-z_]+$/i, '').trim() || auditLog.message;
}

function createHistoricalTaskStatusSseEvent(task: DeployTask | undefined, auditLog: AuditLog): TaskSseEvent | undefined {
  const status = readTaskStatusFromAuditLog(auditLog);

  if (!status || !auditLog.taskId) {
    return undefined;
  }

  return {
    event: 'task.status.changed',
    id: `task:${auditLog.taskId}:${auditLog.createdAt}#${auditLog.id}`,
    taskId: auditLog.taskId,
    occurredAt: auditLog.createdAt,
    data: {
      taskId: auditLog.taskId,
      status,
      operation: task?.operation ?? auditLog.operation,
      targetId: task?.targetId ?? auditLog.targetId,
      targetLabel: task?.targetLabel ?? auditLog.targetLabel,
      summary: readTaskSummaryFromAuditLog(task, auditLog),
      occurredAt: auditLog.createdAt,
      auditId: auditLog.id,
      beforeStatus:
        auditLog.before && typeof auditLog.before === 'object' && isDeployTaskStatus((auditLog.before as { status?: unknown }).status)
          ? (auditLog.before as { status: DeployTaskStatus }).status
          : undefined
    }
  };
}

function createAuditSummarySseEvent(auditLog: AuditLog): TaskSseEvent {
  return {
    event: 'audit.summary',
    id: `audit:${auditLog.id}`,
    taskId: auditLog.taskId,
    occurredAt: auditLog.createdAt,
    data: {
      auditId: auditLog.id,
      taskId: auditLog.taskId,
      action: auditLog.action,
      result: auditLog.result,
      severity: auditLog.severity,
      operation: auditLog.operation,
      targetId: auditLog.targetId,
      message: auditLog.message,
      occurredAt: auditLog.createdAt
    }
  };
}

function writeTaskSseEvent(response: ServerResponse, sseEvent: TaskSseEvent) {
  sendSseEvent(response, sseEvent.event, sseEvent.id, sseEvent.data);
}

function compareTaskSseEvents(left: TaskSseEvent, right: TaskSseEvent) {
  const leftMs = Date.parse(left.occurredAt ?? '');
  const rightMs = Date.parse(right.occurredAt ?? '');

  if (!Number.isNaN(leftMs) && !Number.isNaN(rightMs) && leftMs !== rightMs) {
    return leftMs - rightMs;
  }

  const leftOrder = left.event === 'task.status.changed' ? 0 : left.event === 'audit.summary' ? 1 : 2;
  const rightOrder = right.event === 'task.status.changed' ? 0 : right.event === 'audit.summary' ? 1 : 2;

  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }

  return left.id.localeCompare(right.id);
}

function parseTaskStatusCursorMs(cursor: string | undefined) {
  if (!cursor) {
    return undefined;
  }

  const match = /^task:[^:]+:(.+?)(?:#.+)?$/.exec(cursor);
  const cursorMs = Date.parse(match?.[1] ?? '');

  return Number.isNaN(cursorMs) ? undefined : cursorMs;
}

function filterTaskSseEventsAfterCursor(events: TaskSseEvent[], cursor: string | undefined) {
  if (!cursor) {
    return events;
  }

  const cursorIndex = events.findIndex((event) => event.id === cursor);

  if (cursorIndex >= 0) {
    return events.slice(cursorIndex + 1);
  }

  const cursorMs = parseTaskStatusCursorMs(cursor);

  if (cursorMs === undefined) {
    return events;
  }

  return events.filter((event) => {
    const eventMs = Date.parse(event.occurredAt ?? '');
    return Number.isNaN(eventMs) || eventMs > cursorMs;
  });
}

function compareSystemAlerts(left: SystemAlert, right: SystemAlert) {
  const severityOrder = { critical: 0, warning: 1 } satisfies Record<SystemAlert['severity'], number>;
  const severityDelta = severityOrder[left.severity] - severityOrder[right.severity];

  if (severityDelta !== 0) {
    return severityDelta;
  }

  const leftMs = Date.parse(left.observedAt);
  const rightMs = Date.parse(right.observedAt);

  if (!Number.isNaN(leftMs) && !Number.isNaN(rightMs) && leftMs !== rightMs) {
    return rightMs - leftMs;
  }

  return left.id.localeCompare(right.id);
}

function filterSystemAlertsForEventQuery(alerts: SystemAlert[], query: SystemAlertEventQuery) {
  return alerts
    .filter((alert) => {
      if (query.severity && alert.severity !== query.severity) {
        return false;
      }

      if (query.resourceId && alert.resourceId !== query.resourceId) {
        return false;
      }

      return alert.status === 'active';
    })
    .sort(compareSystemAlerts);
}

const volatileSystemAlertSnapshotMetadataKeys = new Set([
  'lastTelemetryAt',
  'lastHeartbeatAt',
  'serviceCheckedAt',
  'sampleGapSeconds',
  'latencyMs',
  'latestUpdatedAt',
  'overdueDeliveryCount',
  'deadLetterDeliveryCount',
  'oldestNextAttemptAt',
  'sampleAttemptCount',
  'usedBytes',
  'usageRatioPercent',
  'quotaReportedAt'
]);

function createStableSystemAlertSnapshotMetadata(metadata: SystemAlert['metadata']) {
  const stableMetadata: NonNullable<SystemAlert['metadata']> = {};

  for (const [key, value] of Object.entries(metadata ?? {})) {
    if (!volatileSystemAlertSnapshotMetadataKeys.has(key)) {
      stableMetadata[key] = value;
    }
  }

  return stableMetadata;
}

function createSystemAlertSnapshotSseEvent(alerts: SystemAlert[], generatedAt = new Date().toISOString()) {
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify(
        alerts.map((alert) => ({
          id: alert.id,
          kind: alert.kind,
          severity: alert.severity,
          status: alert.status,
          resourceType: alert.resourceType,
          resourceId: alert.resourceId,
          observedAt: alert.observedAt,
          dedupeKey: alert.dedupeKey,
          metadata: createStableSystemAlertSnapshotMetadata(alert.metadata)
        }))
      )
    )
    .digest('hex')
    .slice(0, 16);

  return {
    event: 'system_alert.snapshot',
    id: `system-alerts:${alerts.length === 0 ? 'empty' : fingerprint}`,
    data: {
      alerts,
      count: alerts.length,
      criticalCount: alerts.filter((alert) => alert.severity === 'critical').length,
      warningCount: alerts.filter((alert) => alert.severity === 'warning').length,
      generatedAt,
      fingerprint
    }
  };
}

async function listTaskSseEvents(api: ControlPlaneApi, query: TaskEventQuery) {
  const [tasks, auditLogs] = await Promise.all([api.listTasks(), api.listAuditLogs()]);
  const tasksById = new Map(tasks.map((task) => [task.id, task] as const));
  const matchedTaskStatusAudits = auditLogs.filter((auditLog) => {
    if (!auditLog.taskId || !readTaskStatusFromAuditLog(auditLog)) {
      return false;
    }

    if (query.taskId && auditLog.taskId !== query.taskId) {
      return false;
    }

    return isAtOrAfter(auditLog.createdAt, query.since);
  });
  const historicalTaskIds = new Set(matchedTaskStatusAudits.map((auditLog) => auditLog.taskId));
  const fallbackTasks = tasks.filter((task) => {
    if (query.taskId && task.id !== query.taskId) {
      return false;
    }

    return !historicalTaskIds.has(task.id) && isAtOrAfter(task.updatedAt, query.since);
  });
  const visibleTaskIds = new Set([...historicalTaskIds, ...fallbackTasks.map((task) => task.id)]);
  const matchedAuditLogs = auditLogs.filter((auditLog) => {
    if (query.taskId && auditLog.taskId !== query.taskId) {
      return false;
    }

    if (!query.taskId && visibleTaskIds.size > 0 && !visibleTaskIds.has(auditLog.taskId)) {
      return false;
    }

    return isAtOrAfter(auditLog.createdAt, query.since);
  });
  const taskStatusEvents = [
    ...matchedTaskStatusAudits
      .map((auditLog) => createHistoricalTaskStatusSseEvent(tasksById.get(auditLog.taskId), auditLog))
      .filter((event): event is TaskSseEvent => Boolean(event)),
    ...fallbackTasks.map(createTaskStatusSseEvent)
  ];

  return filterTaskSseEventsAfterCursor(
    [...taskStatusEvents, ...matchedAuditLogs.map(createAuditSummarySseEvent)].sort(
      compareTaskSseEvents
    ),
    query.cursor
  );
}

async function sendSystemAlertEventStream(
  api: ControlPlaneApi,
  response: ServerResponse,
  requestId: string,
  query: SystemAlertEventQuery,
  runtimeMetrics?: HttpRuntimeMetrics
) {
  const initialAlerts = filterSystemAlertsForEventQuery(await listSystemAlertsWithRuntimeMetrics(api, runtimeMetrics), query);
  const initialEvent = createSystemAlertSnapshotSseEvent(initialAlerts);
  let lastEventId = query.cursor;
  let lastSnapshotId = query.cursor;

  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  if (initialEvent.id !== query.cursor) {
    sendSseEvent(response, initialEvent.event, initialEvent.id, initialEvent.data);
    lastEventId = initialEvent.id;
    lastSnapshotId = initialEvent.id;
  }

  sendSseEvent(response, 'stream.ready', `ready:${requestId}`, {
    requestId,
    alertCount: initialEvent.data.count,
    criticalCount: initialEvent.data.criticalCount,
    warningCount: initialEvent.data.warningCount,
    cursor: query.cursor,
    lastEventId,
    generatedAt: new Date().toISOString(),
    live: !query.once
  });

  if (query.once) {
    response.end();
    return;
  }

  let polling = false;
  const pollForAlertChanges = async () => {
    if (polling || response.destroyed) {
      return;
    }

    polling = true;

    try {
      const alerts = filterSystemAlertsForEventQuery(await listSystemAlertsWithRuntimeMetrics(api, runtimeMetrics), query);
      const event = createSystemAlertSnapshotSseEvent(alerts);

      if (event.id !== lastSnapshotId && !response.destroyed) {
        sendSseEvent(response, event.event, event.id, event.data);
        lastSnapshotId = event.id;
      }
    } catch {
      if (!response.destroyed) {
        sendSseEvent(response, 'stream.error', `error:${requestId}:${Date.now()}`, {
          requestId,
          message: 'System alert stream refresh failed.'
        });
      }
    } finally {
      polling = false;
    }
  };
  const heartbeat = setInterval(() => {
    if (!response.destroyed) {
      response.write(': heartbeat\n\n');
    }
  }, 15_000);
  const poll = setInterval(() => {
    void pollForAlertChanges();
  }, 5_000);
  const unsubscribe = () => {
    clearInterval(heartbeat);
    clearInterval(poll);
  };

  response.on('close', unsubscribe);
  response.on('finish', unsubscribe);
}

async function sendTaskEventStream(
  api: ControlPlaneApi,
  response: ServerResponse,
  requestId: string,
  query: TaskEventQuery
) {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  const matchedEvents = await listTaskSseEvents(api, query);

  for (const event of matchedEvents) {
    writeTaskSseEvent(response, event);
  }

  const taskCount = matchedEvents.filter((event) => event.event === 'task.status.changed').length;
  const auditCount = matchedEvents.filter((event) => event.event === 'audit.summary').length;
  let lastEventId = matchedEvents.at(-1)?.id ?? query.cursor;

  sendSseEvent(response, 'stream.ready', `ready:${requestId}`, {
    requestId,
    taskCount,
    auditCount,
    cursor: query.cursor,
    lastEventId,
    generatedAt: new Date().toISOString(),
    live: !query.once
  });

  if (query.once) {
    response.end();
    return;
  }

  let polling = false;
  const heartbeat = setInterval(() => {
    if (!response.destroyed) {
      response.write(': heartbeat\n\n');
    }
  }, 15_000);
  const poll = setInterval(() => {
    if (polling || response.destroyed) {
      return;
    }

    polling = true;

    void listTaskSseEvents(api, {
      ...query,
      ...(lastEventId ? { cursor: lastEventId } : {})
    })
      .then((events) => {
        for (const event of events) {
          writeTaskSseEvent(response, event);
        }

        if (events.length > 0) {
          lastEventId = events.at(-1)?.id ?? lastEventId;
        }
      })
      .catch(() => {
        if (!response.destroyed) {
          sendSseEvent(response, 'stream.error', `error:${requestId}:${Date.now()}`, {
            requestId,
            message: 'Task stream refresh failed.'
          });
        }
      })
      .finally(() => {
        polling = false;
      });
  }, defaultTaskEventStreamPollIntervalMs);
  const unsubscribe = () => {
    clearInterval(heartbeat);
    clearInterval(poll);
  };

  response.on('close', unsubscribe);
  response.on('finish', unsubscribe);
}

function createPublicBaseUrlFromHeaders(request: IncomingMessage) {
  const proto = getHeader(request.headers, 'x-forwarded-proto') ?? 'http';
  const host = getHeader(request.headers, 'x-forwarded-host') ?? getHeader(request.headers, 'host') ?? '127.0.0.1';
  const prefix = (getHeader(request.headers, 'x-forwarded-prefix') ?? '').replace(/\/+$/, '');
  return `${proto}://${host}${prefix}`;
}

async function readListRoute(
  api: ControlPlaneApi,
  pathname: string,
  operatorSessionStore?: OperatorSessionStore,
  operatorSessionObservationContext?: OperatorSessionObservationContext,
  runtimeMetrics?: HttpRuntimeMetrics
) {
  switch (pathname) {
    case '/api/v1/agents':
      return api.listAgents();
    case '/api/v1/customers':
      return api.listCustomers();
    case '/api/v1/nodes':
      return api.listNodes();
    case '/api/v1/inbounds':
      return api.listInbounds();
    case '/api/v1/subscription-sources':
      return api.listSubscriptionSources();
    case '/api/v1/subscription-nodes':
      return api.listSubscriptionInventoryNodes();
    case '/api/v1/subscription-bundles':
      return api.listSubscriptionBundles();
    case '/api/v1/subscription-clients':
      return api.listSubscriptionClients();
    case '/api/v1/subscription-export-profiles':
      return api.listSubscriptionExportProfiles();
    case '/api/v1/proxy-providers':
      return api.listProxyProviders();
    case '/api/v1/subscription-export-files':
      return api.listSubscriptionExportFiles();
    case '/api/v1/forward-rules':
      return api.listForwardRules();
    case '/api/v1/quota-policies':
      return api.listQuotaPolicies();
    case '/api/v1/integrations/telegram-bot/settings':
      return api.getTelegramBotSettings();
    case '/api/v1/telegram-bindings':
      return api.listTelegramBindings();
    case '/api/v1/telegram-binding-challenges':
      return api.listTelegramBindingChallenges();
    case '/api/v1/telegram-notification-policies':
      return api.listTelegramNotificationPolicies();
    case '/api/v1/telegram-notification-deliveries':
      return api.listTelegramNotificationDeliveries();
    case '/api/v1/rate-limit-policies':
      return api.listRateLimitPolicies();
    case '/api/v1/permission-grants':
      return api.listPermissionGrants();
    case '/api/v1/agent-credentials':
      return api.listAgentCredentials();
    case '/api/v1/agent-sessions':
      return api.listAgentSessions();
    case '/api/v1/operator-sessions':
      return operatorSessionStore?.list(operatorSessionObservationContext) ?? api.listOperatorSessions();
    case '/api/v1/routing-policies':
      return api.listRoutingPolicies();
    case '/api/v1/tuning-profiles':
      return api.listTuningProfiles();
    case '/api/v1/command-outbox':
      return api.listCommandOutbox();
    case '/api/v1/config-revisions':
      return api.listConfigRevisions();
    case '/api/v1/preflight-plans':
      return api.listPreflightPlans();
    case '/api/v1/runtime-snapshots':
      return api.listRuntimeSnapshots();
    case '/api/v1/traffic-rollups':
      return api.listTrafficRollups();
    case '/api/v1/traffic-rollup-compactions':
      return api.listTrafficRollupCompactions();
    case '/api/v1/system-alerts':
      return listSystemAlertsWithRuntimeMetrics(api, runtimeMetrics);
    case '/api/v1/agent-log-retention-policy':
      return api.getAgentLogRetentionPolicy();
    case '/api/v1/traffic-rollup-retention-policy':
      return api.getTrafficRollupRetentionPolicy();
    case '/api/v1/observability-metrics':
      return getObservabilityMetricsWithRuntimeMetrics(api, runtimeMetrics);
    default:
      return undefined;
  }
}

async function routeRequest(
  api: ControlPlaneApi,
  request: IncomingMessage,
  response: ServerResponse,
  options: ResolvedHttpControlPlaneServerOptions
) {
  const method = request.method ?? 'GET';
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const requestId = createRequestId(request.headers);
  const publicSubscriptionPath = getPublicSubscriptionPath(url.pathname);
  const publicSubscriptionPortalPath = getPublicSubscriptionPortalPath(url.pathname);

  if (method === 'GET' && publicSubscriptionPath) {
    if (!isPublicSubscriptionFormat(publicSubscriptionPath.format)) {
      throw createHttpError(404, 'not_found', `Subscription format not found: ${publicSubscriptionPath.format}`);
    }
    const publicSubscriptionFormat = normalizePublicSubscriptionFormat(publicSubscriptionPath.format);

    if (!publicSubscriptionFormat) {
      throw createHttpError(404, 'not_found', `Subscription format not found: ${publicSubscriptionPath.format}`);
    }

    const client = await resolvePublicSubscriptionClient(api, publicSubscriptionPath);
    const accessToken = readPublicSubscriptionAccessToken(url, request.headers);
    verifyPublicSubscriptionAccessToken(client, accessToken);

    if (!isSubscriptionFormatAllowed(client, publicSubscriptionFormat)) {
      throw createHttpError(403, 'permission.denied', `Subscription format is not enabled: ${publicSubscriptionPath.format}`);
    }

    consumePublicSubscriptionRequest(client, publicSubscriptionFormat);
    const exportProfiles = await api.listSubscriptionExportProfiles();
    const exportProfile = selectSubscriptionExportProfileForClient(exportProfiles, client, publicSubscriptionFormat);

    sendRaw(
      response,
      200,
      renderPublicSubscriptionOutput({
        client,
        exportProfile,
        format: publicSubscriptionFormat,
        inbounds: await api.listInbounds(),
        externalNodes: await api.listSubscriptionInventoryNodes()
      })
    );
    return;
  }

  if (method === 'GET' && publicSubscriptionPortalPath) {
    const client = await resolvePublicSubscriptionClient(api, publicSubscriptionPortalPath);
    const accessToken = readPublicSubscriptionAccessToken(url, request.headers);
    verifyPublicSubscriptionAccessToken(client, accessToken);

    consumePublicSubscriptionRequest(client, 'portal');
    sendHtml(
      response,
      200,
      await renderPublicSubscriptionPortal(client, {
        accessToken,
        publicBaseUrl: createPublicRequestBaseUrl(request)
      })
    );
    return;
  }

  if (method === 'GET' && url.pathname === '/api/v1/boundary') {
    sendData(response, requestId, await api.getApiBoundary());
    return;
  }

  if (url.pathname === '/api/v1/auth/session') {
    const sessionOptions = options.auth?.operatorSession;

    if (!sessionOptions) {
      throw createHttpError(404, 'not_found', 'Operator session authentication is not configured.');
    }

    if (method === 'POST') {
      const loginRequest = parseOperatorSessionLoginRequest(await readJsonBody(request));

      if (!validateOperatorLogin(loginRequest, sessionOptions)) {
        throw createHttpError(401, 'unauthorized', 'Operator login credentials are invalid.');
      }

      const identity = createOperatorSessionIdentity(sessionOptions);
      const token = createOperatorSessionToken(identity, sessionOptions.sessionSecret);
      const csrfToken = createOperatorSessionCsrfToken(token, sessionOptions.sessionSecret);
      await options.operatorSessionStore?.issue({
        sessionId: identity.sessionId,
        username: identity.username,
        actor: identity.actor,
        operatorGroupId: identity.operatorGroupId,
        resourceGroupId: identity.resourceGroupId,
        expiresAt: identity.expiresAt,
        sourceIp: readRequestSourceIp(request),
        userAgent: getHeader(request.headers, 'user-agent'),
        requestId,
        issuedAt: identity.issuedAt
      });
      response.setHeader('Set-Cookie', createOperatorSessionCookie(request, sessionOptions, token));
      sendData(response, requestId, {
        authenticated: true,
        sessionId: identity.sessionId,
        username: identity.username,
        actor: identity.actor,
        operatorGroupId: identity.operatorGroupId,
        resourceGroupId: identity.resourceGroupId,
        expiresAt: identity.expiresAt,
        csrfToken
      }, 201);
      return;
    }

    if (method === 'GET') {
      const sessionAuthentication = await readOperatorSessionAuthentication(
        request,
        sessionOptions,
        options.operatorSessionStore
      );

      if (!sessionAuthentication) {
        throw createHttpError(401, 'unauthorized', 'A valid operator session cookie is required.');
      }

      const { identity } = sessionAuthentication;
      sendData(response, requestId, {
        authenticated: true,
        sessionId: identity.sessionId,
        username: identity.username,
        actor: identity.actor,
        operatorGroupId: identity.operatorGroupId,
        resourceGroupId: identity.resourceGroupId,
        expiresAt: identity.expiresAt,
        csrfToken: sessionAuthentication.csrfToken
      });
      return;
    }

    if (method === 'DELETE') {
      const sessionAuthentication = await readOperatorSessionAuthentication(
        request,
        sessionOptions,
        options.operatorSessionStore
      );

      if (sessionAuthentication) {
        await options.operatorSessionStore?.revoke(sessionAuthentication.identity.sessionId, {
          actor: sessionAuthentication.identity.actor,
          operatorGroupId: sessionAuthentication.identity.operatorGroupId,
          resourceGroupId: sessionAuthentication.identity.resourceGroupId,
          sourceIp: readRequestSourceIp(request),
          userAgent: getHeader(request.headers, 'user-agent'),
          requestId,
          reason: 'operator_logout'
        });
      }

      response.setHeader('Set-Cookie', createClearOperatorSessionCookie(request, sessionOptions));
      sendData(response, requestId, {
        authenticated: false
      });
      return;
    }
  }

  const telegramWebhookMatch = /^\/telegram\/webhook\/([^/]+)$/.exec(url.pathname);

  if (method === 'POST' && telegramWebhookMatch) {
    const update = (await readJsonBody(request)) as Parameters<ControlPlaneApi['handleTelegramWebhookUpdate']>[1];

    try {
      const result = await api.handleTelegramWebhookUpdate(decodeURIComponent(telegramWebhookMatch[1]), update);
      logRequestEvent(options, request, {
        event: 'telegram_webhook.update_handled',
        requestId,
        action: result.action,
        accepted: result.accepted
      });
      sendData(response, requestId, result);
      return;
    } catch (error) {
      if (error instanceof Error && error.message === 'Telegram webhook secret mismatch') {
        throw createHttpError(401, 'unauthorized', 'Telegram webhook secret is invalid.');
      }

      throw error;
    }
  }

  await requireOperatorSessionCsrfForMutation(request, url.pathname, options.auth, options.operatorSessionStore);

  if (method === 'GET' && url.pathname === '/metrics') {
    await requireOperatorForProtectedRead(request, url.pathname, options.auth, options.operatorSessionStore);
    sendText(
      response,
      200,
      'text/plain; version=0.0.4; charset=utf-8',
      renderPrometheusMetrics(await getObservabilityMetricsWithRuntimeMetrics(api, options.runtimeMetrics))
    );
    return;
  }

  if (method === 'GET' && url.pathname === '/events/v1/tasks') {
    await authenticateOperator(request, options.auth, options.operatorSessionStore);
    await sendTaskEventStream(api, response, requestId, readTaskEventQuery(url, request.headers));
    return;
  }

  if (method === 'GET' && url.pathname === '/events/v1/system-alerts') {
    await authenticateOperator(request, options.auth, options.operatorSessionStore);
    await sendSystemAlertEventStream(
      api,
      response,
      requestId,
      readSystemAlertEventQuery(url, request.headers),
      options.runtimeMetrics
    );
    return;
  }

  if (method === 'GET') {
    await requireOperatorForProtectedRead(request, url.pathname, options.auth, options.operatorSessionStore);
  }

  if (method === 'GET' && url.pathname === '/api/v1/snapshot') {
    sendData(response, requestId, await api.getSnapshot());
    return;
  }

  if (method === 'GET' && url.pathname === '/api/v1/agent-log-chunks:export') {
    sendData(response, requestId, await api.exportAgentLogChunks(readAgentLogChunkQuery(url)));
    return;
  }

  if (method === 'GET' && url.pathname === '/api/v1/agent-log-archives:export') {
    sendData(response, requestId, await api.exportAgentLogArchives(readAgentLogArchiveQuery(url)));
    return;
  }

  if (method === 'GET' && url.pathname === '/api/v1/traffic-rollups:export') {
    sendData(response, requestId, await api.exportTrafficRollups(readTrafficRollupQuery(url)));
    return;
  }

  if (method === 'GET' && url.pathname === '/api/v1/traffic-rollup-compactions:export') {
    sendData(response, requestId, await api.exportTrafficRollupCompactions(readTrafficRollupCompactionQuery(url)));
    return;
  }

  if (method === 'GET' && url.pathname === '/api/v1/agent-log-chunks') {
    sendData(response, requestId, await api.listAgentLogChunks(readAgentLogChunkQuery(url)));
    return;
  }

  if (method === 'GET' && url.pathname === '/api/v1/agent-log-archives') {
    sendData(response, requestId, await api.listAgentLogArchives(readAgentLogArchiveQuery(url)));
    return;
  }

  if (method === 'GET' && url.pathname === '/api/v1/traffic-rollups') {
    sendData(response, requestId, await api.listTrafficRollups(readTrafficRollupQuery(url)));
    return;
  }

  if (method === 'GET' && url.pathname === '/api/v1/traffic-rollup-compactions') {
    sendData(response, requestId, await api.listTrafficRollupCompactions(readTrafficRollupCompactionQuery(url)));
    return;
  }

  if (method === 'GET') {
    const readList = await readListRoute(
      api,
      url.pathname,
      options.operatorSessionStore,
      createOperatorSessionObservationContext(request),
      options.runtimeMetrics
    );

    if (readList) {
      sendData(response, requestId, readList);
      return;
    }
  }

  if (method === 'GET' && url.pathname === '/api/v1/tasks') {
    sendData(response, requestId, await api.listTasks());
    return;
  }

  if (method === 'POST' && url.pathname === '/api/v1/command-outbox:sweep-timeouts') {
    const context = await createMutationContext(request, options.auth, options.operatorSessionStore);
    const body = (await readJsonBody(request)) as {
      now?: string;
      ackTimeoutMs?: number;
      resultTimeoutMs?: number;
      maxCommands?: number;
    };
    const result = await api.sweepCommandTimeouts({
      requestId: context.requestId,
      now: body.now,
      ackTimeoutMs: body.ackTimeoutMs,
      resultTimeoutMs: body.resultTimeoutMs,
      maxCommands: body.maxCommands
    });
    logRequestEvent(options, request, {
      event: 'command_outbox.timeout_sweep',
      requestId: context.requestId,
      actor: context.actor,
      scanned: result.scanned,
      expired: result.expired,
      deadLettered: result.deadLettered,
      taskFailures: result.taskFailures
    });
    sendData(response, context.requestId, result, 202);
    return;
  }

  if (method === 'POST' && url.pathname === '/api/v1/agents/install-command') {
    const context = await createMutationContext(request, options.auth, options.operatorSessionStore);
    const input = parseAgentInstallCommandRequest(await readJsonBody(request));
    const command = await api.createAgentInstallCommand(
      {
        ...input,
        publicBaseUrl: input.publicBaseUrl ?? createPublicBaseUrlFromHeaders(request)
      },
      context
    );
    registerEphemeralAgentToken(options.auth, command.installToken, command.agentId);
    logRequestEvent(options, request, {
      event: 'agent.install_command.issued',
      requestId: context.requestId,
      actor: context.actor,
      agentId: command.agentId,
      expiresAt: command.expiresAt
    });
    sendData(response, context.requestId, command, 201);
    return;
  }

  const agentUpgradeCommandAgentId = getAgentUpgradeCommandAgentIdFromPath(url.pathname);

  if (method === 'POST' && agentUpgradeCommandAgentId) {
    const context = await createMutationContext(request, options.auth, options.operatorSessionStore);
    const input = parseAgentUpgradeCommandRequest(await readJsonBody(request));

    if (input.agentId !== agentUpgradeCommandAgentId) {
      throw createHttpError(409, 'identity.mismatch', 'Agent upgrade command target does not match the path Agent ID.');
    }

    const command = await api.createAgentUpgradeCommand(input, context);
    logRequestEvent(options, request, {
      event: 'agent.upgrade_command.issued',
      requestId: context.requestId,
      actor: context.actor,
      agentId: command.agentId,
      mode: command.mode
    });
    sendData(response, context.requestId, command, 201);
    return;
  }

  const subscriptionSourceSyncId = getSubscriptionSourceSyncIdFromPath(url.pathname);

  if (method === 'POST' && subscriptionSourceSyncId) {
    const context = await createMutationContext(request, options.auth, options.operatorSessionStore);
    const result = await api.syncSubscriptionSource(subscriptionSourceSyncId, context);
    logRequestEvent(options, request, {
      event: 'subscription.source.sync_requested',
      requestId: context.requestId,
      actor: context.actor,
      sourceId: subscriptionSourceSyncId,
      status: result.status,
      nodeCount: result.nodeCount,
      warningCount: result.warnings.length
    });
    sendData(response, context.requestId, result, 202);
    return;
  }

  const quotaPolicyResetId = getQuotaPolicyResetIdFromPath(url.pathname);

  if (method === 'POST' && quotaPolicyResetId) {
    const context = await createMutationContext(request, options.auth, options.operatorSessionStore);
    const task = await api.resetQuotaPolicy(quotaPolicyResetId, context);
    logTaskEvent(options, request, 'task.created', task, context);
    sendData(response, context.requestId, task, 202, task.id);
    return;
  }

  if (method === 'POST' && url.pathname === '/agent/v1/register') {
    const installToken = getBearerToken(request.headers);
    const body = parseAgentRegistrationRequest(await readJsonBody(request));

    const credential = await api.registerAgent(body, installToken ?? '', {
      sourceIp: readRequestSourceIp(request),
      userAgent: getHeader(request.headers, 'user-agent')
    });
    registerEphemeralAgentToken(
      options.auth,
      credential.agentToken,
      credential.agentId,
      credential.sessionId,
      credential.credentialId
    );
    logRequestEvent(options, request, {
      event: 'agent.registered',
      requestId: body.requestId,
      agentId: credential.agentId,
      sessionId: credential.sessionId,
      credentialId: credential.credentialId
    });
    sendData(response, body.requestId, credential, 201);
    return;
  }

  if (method === 'POST' && url.pathname === '/api/v1/tasks') {
    const context = await createMutationContext(request, options.auth, options.operatorSessionStore);
    const input = normalizeCreateTaskSubscriptionAccessToken(parseCreateTaskRequest(await readJsonBody(request)));
    const task = await api.createTask(input, context);
    logTaskEvent(options, request, 'task.created', task, context);
    sendData(response, context.requestId, task, 201, task.id);
    return;
  }

  if (method === 'PATCH' && url.pathname === '/api/v1/integrations/telegram-bot/settings') {
    const context = await createMutationContext(request, options.auth, options.operatorSessionStore);
    const input = (await readJsonBody(request)) as Parameters<ControlPlaneApi['updateTelegramBotSettings']>[0];
    const settings = await api.updateTelegramBotSettings(input, context);
    logRequestEvent(options, request, {
      event: 'telegram_bot.settings.updated',
      requestId: context.requestId,
      actor: context.actor,
      enabled: settings.enabled,
      mode: settings.mode,
      botTokenSet: settings.botTokenSet
    });
    sendData(response, context.requestId, settings);
    return;
  }

  if (method === 'POST' && url.pathname === '/api/v1/integrations/telegram-bot/test') {
    const context = await createMutationContext(request, options.auth, options.operatorSessionStore);
    const input = (await readJsonBody(request)) as Parameters<ControlPlaneApi['testTelegramBotNotification']>[0];
    const delivery = await api.testTelegramBotNotification(input, context);
    logRequestEvent(options, request, {
      event: 'telegram_bot.test_sent',
      requestId: context.requestId,
      actor: context.actor,
      deliveryId: delivery.id,
      status: delivery.status
    });
    sendData(response, context.requestId, delivery, 202);
    return;
  }

  if (method === 'POST' && url.pathname === '/api/v1/integrations/telegram-bot/poll') {
    const context = await createMutationContext(request, options.auth, options.operatorSessionStore);
    const result = await api.pollTelegramBotUpdates();
    logRequestEvent(options, request, {
      event: 'telegram_bot.long_polling.polled',
      requestId: context.requestId,
      actor: context.actor,
      fetchedCount: result.fetchedCount,
      handledCount: result.handledCount,
      errorCount: result.errors.length
    });
    sendData(response, context.requestId, result, 202);
    return;
  }

  if (method === 'POST' && url.pathname === '/api/v1/telegram-bindings') {
    const context = await createMutationContext(request, options.auth, options.operatorSessionStore);
    const input = (await readJsonBody(request)) as Parameters<ControlPlaneApi['createTelegramBinding']>[0];
    const binding = await api.createTelegramBinding(input, context);
    logRequestEvent(options, request, {
      event: 'telegram_binding.created',
      requestId: context.requestId,
      actor: context.actor,
      bindingId: binding.id,
      customerId: binding.customerBinding.customerId
    });
    sendData(response, context.requestId, binding, 201);
    return;
  }

  const telegramBindingRevokeMatch = /^\/api\/v1\/telegram-bindings\/([^/]+)\/revoke$/.exec(url.pathname);

  if (method === 'POST' && telegramBindingRevokeMatch) {
    const context = await createMutationContext(request, options.auth, options.operatorSessionStore);
    const input = (await readJsonBody(request)) as Parameters<ControlPlaneApi['revokeTelegramBinding']>[1];
    const binding = await api.revokeTelegramBinding(decodeURIComponent(telegramBindingRevokeMatch[1]), input, context);
    logRequestEvent(options, request, {
      event: 'telegram_binding.revoked',
      requestId: context.requestId,
      actor: context.actor,
      bindingId: binding.id,
      customerId: binding.customerBinding.customerId
    });
    sendData(response, context.requestId, binding);
    return;
  }

  if (method === 'POST' && url.pathname === '/api/v1/telegram-binding-challenges') {
    const context = await createMutationContext(request, options.auth, options.operatorSessionStore);
    const input = (await readJsonBody(request)) as Parameters<ControlPlaneApi['createTelegramBindingChallenge']>[0];
    const challenge = await api.createTelegramBindingChallenge(input, context);
    logRequestEvent(options, request, {
      event: 'telegram_binding_challenge.created',
      requestId: context.requestId,
      actor: context.actor,
      challengeId: challenge.challenge.id,
      customerId: challenge.challenge.customerId
    });
    sendData(response, context.requestId, challenge, 201);
    return;
  }

  const telegramPolicyMatch = /^\/api\/v1\/telegram-notification-policies\/([^/]+)$/.exec(url.pathname);

  if (method === 'PATCH' && telegramPolicyMatch) {
    const context = await createMutationContext(request, options.auth, options.operatorSessionStore);
    const input = (await readJsonBody(request)) as Parameters<ControlPlaneApi['updateTelegramNotificationPolicy']>[1];
    const policy = await api.updateTelegramNotificationPolicy(decodeURIComponent(telegramPolicyMatch[1]), input, context);
    logRequestEvent(options, request, {
      event: 'telegram_notification_policy.updated',
      requestId: context.requestId,
      actor: context.actor,
      policyId: policy.id
    });
    sendData(response, context.requestId, policy);
    return;
  }

  const telegramDeliveryRetryMatch = /^\/api\/v1\/telegram-notification-deliveries\/([^/]+)\/retry$/.exec(url.pathname);

  if (method === 'POST' && telegramDeliveryRetryMatch) {
    const context = await createMutationContext(request, options.auth, options.operatorSessionStore);
    const delivery = await api.retryTelegramNotificationDelivery(
      decodeURIComponent(telegramDeliveryRetryMatch[1]),
      context
    );
    logRequestEvent(options, request, {
      event: 'telegram_notification.delivery_retried',
      requestId: context.requestId,
      actor: context.actor,
      deliveryId: delivery.id,
      status: delivery.status
    });
    sendData(response, context.requestId, delivery, 202);
    return;
  }

  if (method === 'PATCH' && url.pathname === '/api/v1/agent-log-retention-policy') {
    const context = await createMutationContext(request, options.auth, options.operatorSessionStore);
    const input = parseAgentLogRetentionPolicyUpdateRequest(await readJsonBody(request));
    const policy = await api.updateAgentLogRetentionPolicy(input, context);
    logRequestEvent(options, request, {
      event: 'agent.log_retention.updated',
      requestId: context.requestId,
      actor: context.actor,
      maxAgeDays: policy.maxAgeDays,
      maxEventsPerAgent: policy.maxEventsPerAgent
    });
    sendData(response, context.requestId, policy);
    return;
  }

  if (method === 'PATCH' && url.pathname === '/api/v1/traffic-rollup-retention-policy') {
    const context = await createMutationContext(request, options.auth, options.operatorSessionStore);
    const input = parseTrafficRollupRetentionPolicyUpdateRequest(await readJsonBody(request));
    const policy = await api.updateTrafficRollupRetentionPolicy(input, context);
    logRequestEvent(options, request, {
      event: 'traffic.rollup_retention.updated',
      requestId: context.requestId,
      actor: context.actor,
      maxAgeDays: policy.maxAgeDays,
      maxRecordsPerScope: policy.maxRecordsPerScope
    });
    sendData(response, context.requestId, policy);
    return;
  }

  const commandAgentId = getAgentCommandAgentIdFromPath(url.pathname);

  if (method === 'POST' && commandAgentId) {
    const context = await createMutationContext(request, options.auth, options.operatorSessionStore);
    const command = agentCommandEnvelopeSchema.parse(await readJsonBody(request));

    if (command.agentId !== commandAgentId) {
      throw createHttpError(422, 'validation_error', 'Command agentId must match the path agentId.');
    }

    const outboxItem = await api.issueAgentCommand(commandAgentId, command, context);
    logRequestEvent(options, request, {
      event: 'agent.command.issued',
      requestId: context.requestId,
      actor: context.actor,
      agentId: command.agentId,
      sessionId: command.sessionId,
      commandId: command.commandId,
      taskId: command.taskId,
      commandType: command.type,
      outboxStatus: outboxItem.status
    });
    sendData(response, context.requestId, outboxItem, 202, command.taskId);
    return;
  }

  const credentialRevokeId = getAgentCredentialRevokeIdFromPath(url.pathname);

  if (method === 'POST' && credentialRevokeId) {
    const context = await createMutationContext(request, options.auth, options.operatorSessionStore);
    const input = parseAgentCredentialRevokeRequest(await readJsonBody(request));
    const credential = await api.revokeAgentCredential(credentialRevokeId, input, context);
    revokeEphemeralAgentCredential(options.auth, credential.id);
    logRequestEvent(options, request, {
      event: 'agent.credential.revoked',
      requestId: context.requestId,
      actor: context.actor,
      agentId: credential.agentId,
      credentialId: credential.id
    });
    sendData(response, context.requestId, credential, 202);
    return;
  }

  const operatorSessionRevokeId = getOperatorSessionRevokeIdFromPath(url.pathname);

  if (method === 'POST' && operatorSessionRevokeId) {
    const context = await createMutationContext(request, options.auth, options.operatorSessionStore);
    const input = parseOperatorSessionRevokeRequest(await readJsonBody(request));
    const session = options.operatorSessionStore
      ? await options.operatorSessionStore.revoke(operatorSessionRevokeId, {
          ...context,
          reason: input.reason
        })
      : await api.revokeOperatorSession(operatorSessionRevokeId, input, context);

    if (!session) {
      throw createHttpError(404, 'not_found', `Operator session not found: ${operatorSessionRevokeId}`);
    }

    logRequestEvent(options, request, {
      event: 'operator.session.revoked',
      requestId: context.requestId,
      actor: context.actor,
      sessionId: session.id
    });
    sendData(response, context.requestId, session, 202);
    return;
  }

  const credentialRotateId = getAgentCredentialRotateIdFromPath(url.pathname);

  if (method === 'POST' && credentialRotateId) {
    const context = await createMutationContext(request, options.auth, options.operatorSessionStore);
    const input = parseAgentCredentialRotateRequest(await readJsonBody(request));
    const credential = await api.rotateAgentCredential(credentialRotateId, input, context);
    revokeEphemeralAgentCredential(options.auth, credentialRotateId);
    registerEphemeralAgentToken(
      options.auth,
      credential.agentToken,
      credential.agentId,
      credential.sessionId,
      credential.credentialId
    );
    logRequestEvent(options, request, {
      event: 'agent.credential.rotated',
      requestId: context.requestId,
      actor: context.actor,
      agentId: credential.agentId,
      sessionId: credential.sessionId,
      credentialId: credential.credentialId,
      replacedCredentialId: credentialRotateId
    });
    sendData(response, context.requestId, credential, 201);
    return;
  }

  const taskId = getTaskIdFromPath(url.pathname);

  if (method === 'GET' && taskId) {
    const task = (await api.listTasks()).find((item) => item.id === taskId);

    if (!task) {
      throw createHttpError(404, 'not_found', `Task not found: ${taskId}`);
    }

    sendData(response, requestId, task);
    return;
  }

  const transitionTaskId = getTransitionTaskIdFromPath(url.pathname);

  if (method === 'POST' && transitionTaskId) {
    const context = await createMutationContext(request, options.auth, options.operatorSessionStore);
    const body = parseTransitionTaskRequest(await readJsonBody(request));
    const task = await api.transitionTask(transitionTaskId, body.status, context);
    logTaskEvent(options, request, 'task.transitioned', task, context);
    sendData(response, context.requestId, task);
    return;
  }

  if (method === 'GET' && url.pathname === '/api/v1/audit-logs') {
    sendData(response, requestId, await api.listAuditLogs());
    return;
  }

  if (method === 'GET' && url.pathname === '/api/v1/audit-logs:verify') {
    sendData(response, requestId, await api.verifyAuditLogChain());
    return;
  }

  if (method === 'POST' && url.pathname === '/api/v1/audit-logs:verify') {
    await requireOperatorForProtectedRead(request, url.pathname, options.auth, options.operatorSessionStore);
    const body = parseVerifyAuditLogChainRequest(await readJsonBody(request));
    sendData(response, requestId, await api.verifyAuditLogChain(body.auditLogs));
    return;
  }

  if (method === 'POST' && url.pathname === '/agent/v1/credentials/rotate') {
    let agentIdentity: AgentTokenIdentity | undefined;

    try {
      agentIdentity = await authenticateAgent(request, options.auth);
    } catch (error) {
      const httpError = readHttpError(error);

      if (httpError) {
        await recordDeniedAgentRequest(api, options, options.runtimeMetrics, request, 'credential_rotate', requestId, httpError);
      }

      throw error;
    }

    const body = parseAgentRuntimeCredentialRotateRequest(await readJsonBody(request));

    try {
      assertAgentIdentityMatches(agentIdentity, [body.agentId], body.sessionId ? [body.sessionId] : []);

      if (!agentIdentity?.credentialId) {
        throw createHttpError(
          403,
          'identity.mismatch',
          'Agent bearer token is not bound to a runtime credential that can be rotated.'
        );
      }
    } catch (error) {
      const httpError = readHttpError(error);

      if (httpError) {
        await recordDeniedAgentRequest(
          api,
          options,
          options.runtimeMetrics,
          request,
          'credential_rotate',
          body.requestId,
          httpError,
          {
            agentIds: [body.agentId],
            sessionIds: body.sessionId ? [body.sessionId] : [],
            agentIdentity
          }
        );
      }

      throw error;
    }

    const credential = await api.rotateAgentCredential(
      agentIdentity.credentialId,
      {
        reason: body.reason ?? 'agent.runtime_credential_renewal'
      },
      {
        actor: `agent:${body.agentId}`,
        sourceIp: readRequestSourceIp(request),
        userAgent: getHeader(request.headers, 'user-agent'),
        requestId: body.requestId
      }
    );
    revokeEphemeralAgentCredential(options.auth, agentIdentity.credentialId);
    registerEphemeralAgentToken(
      options.auth,
      credential.agentToken,
      credential.agentId,
      credential.sessionId,
      credential.credentialId
    );
    logRequestEvent(options, request, {
      event: 'agent.credential.self_rotated',
      requestId: body.requestId,
      httpRequestId: requestId,
      agentId: credential.agentId,
      sessionId: credential.sessionId,
      credentialId: credential.credentialId,
      replacedCredentialId: agentIdentity.credentialId
    });
    sendData(response, body.requestId, credential, 201);
    return;
  }

  if (method === 'POST' && url.pathname === '/agent/v1/poll') {
    let agentIdentity: AgentTokenIdentity | undefined;

    try {
      agentIdentity = await authenticateAgent(request, options.auth);
    } catch (error) {
      const httpError = readHttpError(error);

      if (httpError) {
        await recordDeniedAgentRequest(api, options, options.runtimeMetrics, request, 'poll', requestId, httpError);
      }

      throw error;
    }

    const body = parseAgentPollRequest(await readJsonBody(request));
    try {
      assertAgentIdentityMatches(agentIdentity, [body.agentId], body.sessionId ? [body.sessionId] : []);
    } catch (error) {
      const httpError = readHttpError(error);

      if (httpError) {
        await recordDeniedAgentRequest(api, options, options.runtimeMetrics, request, 'poll', body.requestId, httpError, {
          agentIds: [body.agentId],
          sessionIds: body.sessionId ? [body.sessionId] : [],
          agentIdentity
        });
      }

      throw error;
    }
    const commands = await api.leaseAgentCommands(body.agentId, {
      requestId: body.requestId,
      leaseOwnerId: agentIdentity?.credentialId ?? body.agentId,
      sessionId: body.sessionId,
      lastSeenCommandSeq: body.lastSeenCommandSeq
    });
    logRequestEvent(options, request, {
      event: 'agent.poll',
      requestId: body.requestId,
      httpRequestId: requestId,
      agentId: body.agentId,
      sessionId: body.sessionId,
      commandCount: commands.length,
      commandIds: commands.map((command) => command.commandId),
      taskIds: commands.map((command) => command.taskId)
    });
    sendData(response, requestId, {
      commands,
      nextPollAfterMs: 1000
    });
    return;
  }

  if (method === 'POST' && url.pathname === '/agent/v1/events') {
    let agentIdentity: AgentTokenIdentity | undefined;

    try {
      agentIdentity = await authenticateAgent(request, options.auth);
    } catch (error) {
      const httpError = readHttpError(error);

      if (httpError) {
        await recordDeniedAgentRequest(api, options, options.runtimeMetrics, request, 'events', requestId, httpError);
      }

      throw error;
    }

    const body = parseAgentEventsRequest(await readJsonBody(request));
    const eventAgentIds = body.events.map((event) => event.agentId);
    const eventSessionIds = body.events.map((event) => event.sessionId);

    try {
      assertAgentIdentityMatches(agentIdentity, eventAgentIds, eventSessionIds);
    } catch (error) {
      const httpError = readHttpError(error);

      if (httpError) {
        await recordDeniedAgentRequest(api, options, options.runtimeMetrics, request, 'events', requestId, httpError, {
          agentIds: eventAgentIds,
          sessionIds: eventSessionIds,
          agentIdentity
        });
      }

      throw error;
    }
    let accepted = 0;
    let rejected = 0;

    for (const event of body.events) {
      try {
        await api.receiveAgentEvent(event);
        accepted += 1;
      } catch (error) {
        if (body.events.length > 1 && isRejectableAgentEventConflict(error)) {
          rejected += 1;
          continue;
        }

        throw error;
      }
    }

    logRequestEvent(options, request, {
      event: 'agent.events.accepted',
      requestId,
      accepted,
      rejected,
      agentIds: uniqueValues(body.events.map((event) => event.agentId)),
      sessionIds: uniqueValues(body.events.map((event) => event.sessionId)),
      eventIds: body.events.map((event) => event.eventId),
      eventTypes: body.events.map((event) => event.type),
      commandIds: uniqueValues(body.events.map((event) => ('commandId' in event ? event.commandId : undefined))),
      taskIds: uniqueValues(body.events.map((event) => ('taskId' in event ? event.taskId : undefined)))
    });
    sendData(
      response,
      requestId,
      {
        accepted,
        rejected
      },
      202
    );
    return;
  }

  throw createHttpError(404, 'not_found', `Route not found: ${method} ${url.pathname}`);
}

export function createHttpControlPlaneServer(api: ControlPlaneApi, options: CreateHttpControlPlaneServerOptions = {}) {
  const operatorAuthFailureThrottle = normalizeOperatorAuthFailureThrottle(options.operatorAuthFailureThrottle);
  const operatorSessionStore =
    options.operatorSessionStore ?? (options.auth?.operatorSession ? createInMemoryOperatorSessionStore() : undefined);
  const runtimeMetrics = options.runtimeMetrics ?? createHttpRuntimeMetrics();
  const resolvedOptions: ResolvedHttpControlPlaneServerOptions = {
    ...options,
    operatorSessionStore,
    runtimeMetrics
  };

  return createServer((request, response) => {
    const startedAt = Date.now();
    const requestId = createRequestId(request.headers);
    const method = request.method ?? 'GET';
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    let completionLogged = false;
    const logCompletion = (outcome: 'finish' | 'close') => {
      if (completionLogged) {
        return;
      }

      completionLogged = true;
      logRequestEvent(resolvedOptions, request, {
        event: 'http.request.completed',
        level: response.statusCode >= 500 ? 'error' : response.statusCode >= 400 ? 'warning' : 'info',
        requestId,
        method,
        path: url.pathname,
        statusCode: response.statusCode,
        durationMs: Date.now() - startedAt,
        outcome
      });
    };

    response.once('finish', () => logCompletion('finish'));
    response.once('close', () => {
      if (!response.writableEnded) {
        logCompletion('close');
      }
    });

    void routeRequest(api, request, response, resolvedOptions).catch(async (error: unknown) => {
      let mappedError = 'status' in Object(error) ? (error as HttpError) : mapThrownError(error);

      try {
        mappedError =
          (await recordDeniedOperatorRequest(
            api,
            resolvedOptions,
            runtimeMetrics,
            request,
            method,
            url.pathname,
            requestId,
            mappedError,
            operatorAuthFailureThrottle
          )) ?? mappedError;
      } catch (auditError) {
        recordAuditWriteFailure(resolvedOptions, runtimeMetrics, request, {
          requestId,
          auditKind: 'operator.denied',
          error: auditError
        });
      }

      logRequestEvent(resolvedOptions, request, {
        event: 'http.request.error',
        level: mappedError.status >= 500 ? 'error' : 'warning',
        requestId,
        method,
        path: url.pathname,
        statusCode: mappedError.status,
        errorCode: mappedError.code,
        durationMs: Date.now() - startedAt
      });
      sendError(response, requestId, mappedError);
    });
  });
}

export async function listenHttpControlPlaneServer(api: ControlPlaneApi, port = 0) {
  const server = createHttpControlPlaneServer(api);

  await new Promise<void>((resolve) => {
    server.listen(port, '127.0.0.1', resolve);
  });

  const address = server.address() as AddressInfo;

  return {
    server,
    url: `http://127.0.0.1:${address.port}`
  };
}
