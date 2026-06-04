import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  selectSubscriptionExportProfileForClient,
  type AuditLog,
  type DeployTask,
  type SubscriptionClientFormat,
  type SubscriptionClientIdentity,
  type SubscriptionClientOutputFormat
} from '../../domain';
import type { ControlPlaneApi, MutationContext } from './control-plane-api';
import {
  agentCommandEnvelopeSchema,
  parseAgentCredentialRevokeRequest,
  parseAgentCredentialRotateRequest,
  parseAgentInstallCommandRequest,
  parseAgentEventsRequest,
  parseAgentPollRequest,
  parseAgentRegistrationRequest,
  parseCreateTaskRequest,
  parseTransitionTaskRequest
} from './api-contract';
import {
  isPublicSubscriptionFormat,
  renderPublicSubscriptionOutput,
  type PublicSubscriptionFormat,
  type PublicSubscriptionOutput
} from './subscription-output';

type HttpErrorCode =
  | 'agent_event.command_deadline_expired'
  | 'agent_event.sequence_replay'
  | 'bad_request'
  | 'credential.inactive'
  | 'idempotency.conflict'
  | 'idempotency.replay_unavailable'
  | 'identity.mismatch'
  | 'not_found'
  | 'permission_change.required'
  | 'permission.denied'
  | 'permission_grant.already_revoked'
  | 'permission_grant.last_admin_path'
  | 'permission_grant.mismatch'
  | 'permission_grant.not_found'
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
const operatorProtectedReadRoutes = new Set([
  '/api/v1/snapshot',
  '/api/v1/agents',
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
  '/api/v1/rate-limit-policies',
  '/api/v1/permission-grants',
  '/api/v1/agent-credentials',
  '/api/v1/routing-policies',
  '/api/v1/tuning-profiles',
  '/api/v1/command-outbox',
  '/api/v1/config-revisions',
  '/api/v1/preflight-plans',
  '/api/v1/runtime-snapshots',
  '/api/v1/agent-log-chunks',
  '/api/v1/tasks',
  '/api/v1/audit-logs',
  '/api/v1/audit-logs:verify'
]);

type OperatorTokenIdentity = Pick<MutationContext, 'actor' | 'operatorGroupId' | 'resourceGroupId'>;

type AgentTokenIdentity = {
  agentId: string;
  credentialId?: string;
  sessionId?: string;
};

type AgentTokenResolver = (token: string) => Promise<AgentTokenIdentity | undefined>;
type TaskEventQuery = ReturnType<typeof readTaskEventQuery>;
type TaskSseEvent = {
  event: string;
  id: string;
  taskId?: string;
  occurredAt?: string;
  data: unknown;
};
type TaskEventSubscriber = {
  response: ServerResponse;
  query: TaskEventQuery;
};

export type HttpControlPlaneAuthOptions = {
  operatorTokens?: Record<string, OperatorTokenIdentity>;
  agentTokens?: Record<string, AgentTokenIdentity>;
  agentTokenResolver?: AgentTokenResolver;
};

export type CreateHttpControlPlaneServerOptions = {
  auth?: HttpControlPlaneAuthOptions;
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

function getBearerToken(headers: IncomingHttpHeaders) {
  const authorization = getHeader(headers, 'authorization');
  const match = /^Bearer\s+(.+)$/i.exec(authorization ?? '');
  return match?.[1];
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

function authenticateOperator(
  request: IncomingMessage,
  auth: HttpControlPlaneAuthOptions | undefined
): OperatorTokenIdentity | undefined {
  if (!hasTokenRegistry(auth?.operatorTokens)) {
    return undefined;
  }

  const token = getBearerToken(request.headers);
  const identity = findTokenIdentity(auth?.operatorTokens, token);

  if (!identity) {
    throw createHttpError(401, 'unauthorized', 'A valid operator bearer token is required.');
  }

  return identity;
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

function requireOperatorForProtectedRead(
  request: IncomingMessage,
  pathname: string,
  auth: HttpControlPlaneAuthOptions | undefined
) {
  if (operatorProtectedReadRoutes.has(pathname)) {
    authenticateOperator(request, auth);
    return;
  }

  if (getTaskIdFromPath(pathname)) {
    authenticateOperator(request, auth);
  }
}

function createMutationContext(request: IncomingMessage, auth?: HttpControlPlaneAuthOptions): MutationContext {
  const requestId = getHeader(request.headers, 'x-request-id');

  if (!requestId && mutationMethods.has(request.method ?? 'GET')) {
    throw createHttpError(400, 'bad_request', 'X-Request-Id header is required for mutations.');
  }

  const tokenIdentity = authenticateOperator(request, auth);
  const actor = tokenIdentity?.actor ?? getHeader(request.headers, 'x-actor');

  if (!actor && mutationMethods.has(request.method ?? 'GET')) {
    throw createHttpError(400, 'bad_request', 'X-Actor header is required for mutations.');
  }

  return {
    actor: actor ?? 'anonymous',
    operatorGroupId: tokenIdentity ? tokenIdentity.operatorGroupId : getHeader(request.headers, 'x-operator-group-id'),
    resourceGroupId: tokenIdentity ? tokenIdentity.resourceGroupId : getHeader(request.headers, 'x-resource-group-id'),
    sourceIp: getHeader(request.headers, 'x-forwarded-for') ?? request.socket.remoteAddress ?? '127.0.0.1',
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

  if (structuredError?.code === 'permission_grant.last_admin_path') {
    return createHttpError(
      409,
      'permission_grant.last_admin_path',
      readStructuredDenialReason(structuredError.details) ??
        'Permission revoke would remove the last administrative grant path for this resource.',
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

function sendJson(response: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload)
  });
  response.end(payload);
}

function sendData(response: ServerResponse, requestId: string, data: unknown, status = 200, taskId?: string) {
  sendJson(response, status, {
    data,
    requestId,
    ...(taskId ? { taskId } : {})
  });
}

function sendError(response: ServerResponse, requestId: string, error: HttpError) {
  sendJson(response, error.status, {
    error: {
      code: error.code,
      message: error.message,
      details: error.details
    },
    requestId
  });
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

function sendSseEvent(response: ServerResponse, event: string, id: string, data: unknown) {
  response.write(`event: ${event}\n`);
  response.write(`id: ${id}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
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

async function createSnapshot(api: ControlPlaneApi) {
  const [
    apiBoundary,
    agents,
    nodes,
    inbounds,
    subscriptionSources,
    subscriptionInventoryNodes,
    subscriptionBundles,
    subscriptionClients,
    subscriptionExportProfiles,
    proxyProviders,
    subscriptionExportFiles,
    forwardRules,
    quotaPolicies,
    rateLimitPolicies,
    permissionGrants,
    routingPolicies,
    tuningProfiles,
    configRevisions,
    preflightPlans,
    runtimeSnapshots,
    agentCredentials,
    tasks,
    auditLogs
  ] = await Promise.all([
    api.getApiBoundary(),
    api.listAgents(),
    api.listNodes(),
    api.listInbounds(),
    api.listSubscriptionSources(),
    api.listSubscriptionInventoryNodes(),
    api.listSubscriptionBundles(),
    api.listSubscriptionClients(),
    api.listSubscriptionExportProfiles(),
    api.listProxyProviders(),
    api.listSubscriptionExportFiles(),
    api.listForwardRules(),
    api.listQuotaPolicies(),
    api.listRateLimitPolicies(),
    api.listPermissionGrants(),
    api.listRoutingPolicies(),
    api.listTuningProfiles(),
    api.listConfigRevisions(),
    api.listPreflightPlans(),
    api.listRuntimeSnapshots(),
    api.listAgentCredentials(),
    api.listTasks(),
    api.listAuditLogs()
  ]);

  return {
    apiBoundary,
    agents,
    nodes,
    inbounds,
    subscriptionSources,
    subscriptionInventoryNodes,
    subscriptionBundles,
    subscriptionClients,
    subscriptionExportProfiles,
    proxyProviders,
    subscriptionExportFiles,
    forwardRules,
    quotaPolicies,
    rateLimitPolicies,
    permissionGrants,
    routingPolicies,
    tuningProfiles,
    configRevisions,
    preflightPlans,
    runtimeSnapshots,
    agentCredentials,
    tasks,
    auditLogs
  };
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

function getAgentCredentialRevokeIdFromPath(pathname: string) {
  const match = /^\/api\/v1\/agent-credentials\/([^/]+)\/revoke$/.exec(pathname);
  return match?.[1];
}

function getAgentCredentialRotateIdFromPath(pathname: string) {
  const match = /^\/api\/v1\/agent-credentials\/([^/]+)\/rotate$/.exec(pathname);
  return match?.[1];
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

const subscriptionClientFormatToOutputFormat: Record<SubscriptionClientFormat, SubscriptionClientOutputFormat> = {
  plain: 'uri',
  json: 'v2ray',
  clash: 'clash',
  mihomo: 'mihomo',
  'sing-box': 'sing-box'
};

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

function consumePublicSubscriptionRequest(client: SubscriptionClientIdentity, format: PublicSubscriptionFormat, now = Date.now()) {
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
      format,
      requestLimitPerHour,
      windowResetAt: new Date(currentWindowStartedAt + publicSubscriptionRateWindowMs).toISOString()
    });
  }

  bucket.count += 1;
  publicSubscriptionRequestBuckets.set(bucketKey, bucket);
}

function getSubscriptionSourceSyncIdFromPath(pathname: string) {
  const match = /^\/api\/v1\/subscription-sources\/([^/]+)\/sync$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function readAgentLogChunkQuery(url: URL) {
  const limit = url.searchParams.get('limit');
  const pageSize = url.searchParams.get('pageSize');

  return {
    agentId: url.searchParams.get('agentId') ?? undefined,
    taskId: url.searchParams.get('taskId') ?? undefined,
    commandId: url.searchParams.get('commandId') ?? undefined,
    since: url.searchParams.get('since') ?? undefined,
    limit: limit ? Number(limit) : undefined,
    pageSize: pageSize ? Number(pageSize) : undefined
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

  const match = /^task:[^:]+:(.+)$/.exec(cursor);
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

function matchesTaskEventQuery(sseEvent: TaskSseEvent, query: TaskEventQuery) {
  if (query.taskId && sseEvent.taskId !== query.taskId) {
    return false;
  }

  return (
    isAtOrAfter(sseEvent.occurredAt ?? '', query.since) &&
    filterTaskSseEventsAfterCursor([sseEvent], query.cursor).length > 0
  );
}

function createTaskEventHub() {
  const subscribers = new Set<TaskEventSubscriber>();
  const heartbeatTimers = new WeakMap<ServerResponse, NodeJS.Timeout>();

  return {
    subscribe(response: ServerResponse, query: TaskEventQuery) {
      const subscriber = {
        response,
        query
      };
      subscribers.add(subscriber);

      const heartbeat = setInterval(() => {
        if (!response.destroyed) {
          response.write(': heartbeat\n\n');
        }
      }, 15_000);
      heartbeatTimers.set(response, heartbeat);

      const unsubscribe = () => {
        subscribers.delete(subscriber);
        const timer = heartbeatTimers.get(response);

        if (timer) {
          clearInterval(timer);
          heartbeatTimers.delete(response);
        }
      };

      response.on('close', unsubscribe);
      response.on('finish', unsubscribe);
      return unsubscribe;
    },

    publish(sseEvent: TaskSseEvent) {
      for (const subscriber of subscribers) {
        if (subscriber.response.destroyed || !matchesTaskEventQuery(sseEvent, subscriber.query)) {
          continue;
        }

        writeTaskSseEvent(subscriber.response, sseEvent);
      }
    }
  };
}

async function sendTaskEventStream(
  api: ControlPlaneApi,
  response: ServerResponse,
  taskEvents: ReturnType<typeof createTaskEventHub>,
  requestId: string,
  query: TaskEventQuery
) {
  const [tasks, auditLogs] = await Promise.all([api.listTasks(), api.listAuditLogs()]);
  const matchedTasks = tasks.filter((task) => {
    if (query.taskId && task.id !== query.taskId) {
      return false;
    }

    return isAtOrAfter(task.updatedAt, query.since);
  });
  const matchedTaskIds = new Set(matchedTasks.map((task) => task.id));
  const matchedAuditLogs = auditLogs.filter((auditLog) => {
    if (query.taskId && auditLog.taskId !== query.taskId) {
      return false;
    }

    if (!query.taskId && matchedTaskIds.size > 0 && !matchedTaskIds.has(auditLog.taskId)) {
      return false;
    }

    return isAtOrAfter(auditLog.createdAt, query.since);
  });

  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  const matchedEvents = filterTaskSseEventsAfterCursor(
    [...matchedTasks.map(createTaskStatusSseEvent), ...matchedAuditLogs.map(createAuditSummarySseEvent)].sort(
      compareTaskSseEvents
    ),
    query.cursor
  );

  for (const event of matchedEvents) {
    writeTaskSseEvent(response, event);
  }

  const taskCount = matchedEvents.filter((event) => event.event === 'task.status.changed').length;
  const auditCount = matchedEvents.filter((event) => event.event === 'audit.summary').length;
  const lastEventId = matchedEvents.at(-1)?.id ?? query.cursor;

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

  taskEvents.subscribe(response, query);
}

async function publishTaskAndAuditEvents(
  api: ControlPlaneApi,
  taskEvents: ReturnType<typeof createTaskEventHub>,
  task: DeployTask | undefined
) {
  if (!task) {
    return;
  }

  taskEvents.publish(createTaskStatusSseEvent(task));

  const auditLogs = await api.listAuditLogs();

  for (const auditLog of auditLogs.filter((item) => item.taskId === task.id)) {
    taskEvents.publish(createAuditSummarySseEvent(auditLog));
  }
}

function createPublicBaseUrlFromHeaders(request: IncomingMessage) {
  const proto = getHeader(request.headers, 'x-forwarded-proto') ?? 'http';
  const host = getHeader(request.headers, 'x-forwarded-host') ?? getHeader(request.headers, 'host') ?? '127.0.0.1';
  const prefix = (getHeader(request.headers, 'x-forwarded-prefix') ?? '').replace(/\/+$/, '');
  return `${proto}://${host}${prefix}`;
}

async function readListRoute(api: ControlPlaneApi, pathname: string) {
  switch (pathname) {
    case '/api/v1/agents':
      return api.listAgents();
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
    case '/api/v1/rate-limit-policies':
      return api.listRateLimitPolicies();
    case '/api/v1/permission-grants':
      return api.listPermissionGrants();
    case '/api/v1/agent-credentials':
      return api.listAgentCredentials();
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
    default:
      return undefined;
  }
}

async function routeRequest(
  api: ControlPlaneApi,
  request: IncomingMessage,
  response: ServerResponse,
  taskEvents: ReturnType<typeof createTaskEventHub>,
  options: CreateHttpControlPlaneServerOptions = {}
) {
  const method = request.method ?? 'GET';
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const requestId = createRequestId(request.headers);
  const publicSubscriptionPath = getPublicSubscriptionPath(url.pathname);

  if (method === 'GET' && publicSubscriptionPath) {
    if (!isPublicSubscriptionFormat(publicSubscriptionPath.format)) {
      throw createHttpError(404, 'not_found', `Subscription format not found: ${publicSubscriptionPath.format}`);
    }

    const clients = await api.listSubscriptionClients();
    const client = clients.find(
      (item) =>
        item.subId === publicSubscriptionPath.subId &&
        item.securePathPreview === publicSubscriptionPath.securePath
    );

    if (!client) {
      throw createHttpError(404, 'not_found', 'Subscription client not found.');
    }

    if (!client.enabled) {
      throw createHttpError(403, 'permission.denied', 'Subscription client is disabled.');
    }

    if (Date.parse(client.expiresAt) <= Date.now()) {
      throw createHttpError(403, 'permission.denied', 'Subscription client is expired.');
    }

    if (!isSubscriptionFormatAllowed(client, publicSubscriptionPath.format)) {
      throw createHttpError(403, 'permission.denied', `Subscription format is not enabled: ${publicSubscriptionPath.format}`);
    }

    consumePublicSubscriptionRequest(client, publicSubscriptionPath.format);
    const exportProfiles = await api.listSubscriptionExportProfiles();
    const exportProfile = selectSubscriptionExportProfileForClient(exportProfiles, client, publicSubscriptionPath.format);

    sendRaw(
      response,
      200,
      renderPublicSubscriptionOutput({
        client,
        exportProfile,
        format: publicSubscriptionPath.format,
        inbounds: await api.listInbounds(),
        externalNodes: await api.listSubscriptionInventoryNodes()
      })
    );
    return;
  }

  if (method === 'GET' && url.pathname === '/api/v1/boundary') {
    sendData(response, requestId, await api.getApiBoundary());
    return;
  }

  if (method === 'GET' && url.pathname === '/events/v1/tasks') {
    authenticateOperator(request, options.auth);
    await sendTaskEventStream(api, response, taskEvents, requestId, readTaskEventQuery(url, request.headers));
    return;
  }

  if (method === 'GET') {
    requireOperatorForProtectedRead(request, url.pathname, options.auth);
  }

  if (method === 'GET' && url.pathname === '/api/v1/snapshot') {
    sendData(response, requestId, await createSnapshot(api));
    return;
  }

  if (method === 'GET' && url.pathname === '/api/v1/agent-log-chunks') {
    sendData(response, requestId, await api.listAgentLogChunks(readAgentLogChunkQuery(url)));
    return;
  }

  if (method === 'GET') {
    const readList = await readListRoute(api, url.pathname);

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
    const context = createMutationContext(request, options.auth);
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
    sendData(response, context.requestId, result, 202);
    return;
  }

  if (method === 'POST' && url.pathname === '/api/v1/agents/install-command') {
    const context = createMutationContext(request, options.auth);
    const input = parseAgentInstallCommandRequest(await readJsonBody(request));
    const command = await api.createAgentInstallCommand(
      {
        ...input,
        publicBaseUrl: input.publicBaseUrl ?? createPublicBaseUrlFromHeaders(request)
      },
      context
    );
    registerEphemeralAgentToken(options.auth, command.installToken, command.agentId);
    sendData(response, context.requestId, command, 201);
    return;
  }

  const subscriptionSourceSyncId = getSubscriptionSourceSyncIdFromPath(url.pathname);

  if (method === 'POST' && subscriptionSourceSyncId) {
    const context = createMutationContext(request, options.auth);
    const result = await api.syncSubscriptionSource(subscriptionSourceSyncId, context);
    sendData(response, context.requestId, result, 202);
    return;
  }

  if (method === 'POST' && url.pathname === '/agent/v1/register') {
    const installToken = getBearerToken(request.headers);
    const body = parseAgentRegistrationRequest(await readJsonBody(request));

    if (!installToken) {
      throw createHttpError(401, 'unauthorized', 'A valid Agent install token is required for registration.');
    }

    const credential = await api.registerAgent(body, installToken, {
      sourceIp: getHeader(request.headers, 'x-forwarded-for') ?? request.socket.remoteAddress ?? '127.0.0.1',
      userAgent: getHeader(request.headers, 'user-agent')
    });
    registerEphemeralAgentToken(
      options.auth,
      credential.agentToken,
      credential.agentId,
      credential.sessionId,
      credential.credentialId
    );
    sendData(response, body.requestId, credential, 201);
    return;
  }

  if (method === 'POST' && url.pathname === '/api/v1/tasks') {
    const context = createMutationContext(request, options.auth);
    const input = parseCreateTaskRequest(await readJsonBody(request));
    const task = await api.createTask(input, context);
    await publishTaskAndAuditEvents(api, taskEvents, task);
    sendData(response, context.requestId, task, 201, task.id);
    return;
  }

  const commandAgentId = getAgentCommandAgentIdFromPath(url.pathname);

  if (method === 'POST' && commandAgentId) {
    const context = createMutationContext(request, options.auth);
    const command = agentCommandEnvelopeSchema.parse(await readJsonBody(request));

    if (command.agentId !== commandAgentId) {
      throw createHttpError(422, 'validation_error', 'Command agentId must match the path agentId.');
    }

    const outboxItem = await api.issueAgentCommand(commandAgentId, command, context);
    sendData(response, context.requestId, outboxItem, 202, command.taskId);
    return;
  }

  const credentialRevokeId = getAgentCredentialRevokeIdFromPath(url.pathname);

  if (method === 'POST' && credentialRevokeId) {
    const context = createMutationContext(request, options.auth);
    const input = parseAgentCredentialRevokeRequest(await readJsonBody(request));
    const credential = await api.revokeAgentCredential(credentialRevokeId, input, context);
    revokeEphemeralAgentCredential(options.auth, credential.id);
    sendData(response, context.requestId, credential, 202);
    return;
  }

  const credentialRotateId = getAgentCredentialRotateIdFromPath(url.pathname);

  if (method === 'POST' && credentialRotateId) {
    const context = createMutationContext(request, options.auth);
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
    const context = createMutationContext(request, options.auth);
    const body = parseTransitionTaskRequest(await readJsonBody(request));
    const task = await api.transitionTask(transitionTaskId, body.status, context);
    await publishTaskAndAuditEvents(api, taskEvents, task);
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

  if (method === 'POST' && url.pathname === '/agent/v1/poll') {
    const agentIdentity = await authenticateAgent(request, options.auth);
    const body = parseAgentPollRequest(await readJsonBody(request));
    assertAgentIdentityMatches(agentIdentity, [body.agentId], body.sessionId ? [body.sessionId] : []);
    const commands = await api.leaseAgentCommands(body.agentId, {
      requestId: body.requestId,
      sessionId: body.sessionId,
      lastSeenCommandSeq: body.lastSeenCommandSeq
    });
    sendData(response, requestId, {
      commands,
      nextPollAfterMs: 1000
    });
    return;
  }

  if (method === 'POST' && url.pathname === '/agent/v1/events') {
    const agentIdentity = await authenticateAgent(request, options.auth);
    const body = parseAgentEventsRequest(await readJsonBody(request));
    assertAgentIdentityMatches(
      agentIdentity,
      body.events.map((event) => event.agentId),
      body.events.map((event) => event.sessionId)
    );
    let accepted = 0;

    for (const event of body.events) {
      const task = await api.receiveAgentEvent(event);
      await publishTaskAndAuditEvents(api, taskEvents, task);
      accepted += 1;
    }

    sendData(
      response,
      requestId,
      {
        accepted,
        rejected: 0
      },
      202
    );
    return;
  }

  throw createHttpError(404, 'not_found', `Route not found: ${method} ${url.pathname}`);
}

export function createHttpControlPlaneServer(api: ControlPlaneApi, options: CreateHttpControlPlaneServerOptions = {}) {
  const taskEvents = createTaskEventHub();

  return createServer((request, response) => {
    void routeRequest(api, request, response, taskEvents, options).catch((error: unknown) => {
      const requestId = createRequestId(request.headers);
      sendError(response, requestId, 'status' in Object(error) ? (error as HttpError) : mapThrownError(error));
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
