import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ControlPlaneApi, MutationContext } from './control-plane-api';
import {
  agentCommandEnvelopeSchema,
  parseAgentCredentialRevokeRequest,
  parseAgentInstallCommandRequest,
  parseAgentEventsRequest,
  parseAgentPollRequest,
  parseAgentRegistrationRequest,
  parseCreateTaskRequest,
  parseTransitionTaskRequest
} from './api-contract';

type HttpErrorCode =
  | 'agent_event.command_deadline_expired'
  | 'agent_event.sequence_replay'
  | 'bad_request'
  | 'idempotency.conflict'
  | 'identity.mismatch'
  | 'not_found'
  | 'permission.denied'
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
const operatorProtectedReadRoutes = new Set([
  '/api/v1/snapshot',
  '/api/v1/agents',
  '/api/v1/nodes',
  '/api/v1/inbounds',
  '/api/v1/subscription-sources',
  '/api/v1/subscription-bundles',
  '/api/v1/tunnels',
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
  '/api/v1/tasks',
  '/api/v1/audit-logs',
  '/api/v1/audit-logs:verify'
]);

type OperatorTokenIdentity = Pick<MutationContext, 'actor' | 'operatorGroupId' | 'resourceGroupId'>;

type AgentTokenIdentity = {
  agentId: string;
};

type AgentTokenResolver = (token: string) => Promise<AgentTokenIdentity | undefined>;

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

function assertAgentIdentityMatches(agentIdentity: AgentTokenIdentity | undefined, agentIds: string[]) {
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
}

function registerEphemeralAgentToken(auth: HttpControlPlaneAuthOptions | undefined, token: string, agentId: string) {
  if (!auth || auth.agentTokenResolver) {
    return;
  }

  auth.agentTokens = {
    ...(auth.agentTokens ?? {}),
    [token]: {
      agentId
    }
  };
}

function createHttpError(status: number, code: HttpErrorCode, message: string, details?: unknown): HttpError {
  return {
    status,
    code,
    message,
    details
  };
}

function mapThrownError(error: unknown): HttpError {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes('idempotency.conflict')) {
    return createHttpError(409, 'idempotency.conflict', 'Idempotency key was replayed with a different request body.');
  }

  if (message.includes('permission.denied')) {
    return createHttpError(403, 'permission.denied', 'The actor is not allowed to perform this mutation.');
  }

  if (message.includes('resource_version.conflict')) {
    return createHttpError(409, 'resource_version.conflict', 'The supplied If-Match resource version is stale.');
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
    subscriptionBundles,
    tunnels,
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
    api.listSubscriptionBundles(),
    api.listTunnels(),
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
    subscriptionBundles,
    tunnels,
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
    case '/api/v1/subscription-bundles':
      return api.listSubscriptionBundles();
    case '/api/v1/tunnels':
      return api.listTunnels();
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
  options: CreateHttpControlPlaneServerOptions = {}
) {
  const method = request.method ?? 'GET';
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const requestId = createRequestId(request.headers);

  if (method === 'GET' && url.pathname === '/api/v1/boundary') {
    sendData(response, requestId, await api.getApiBoundary());
    return;
  }

  if (method === 'GET') {
    requireOperatorForProtectedRead(request, url.pathname, options.auth);
  }

  if (method === 'GET' && url.pathname === '/api/v1/snapshot') {
    sendData(response, requestId, await createSnapshot(api));
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
    registerEphemeralAgentToken(options.auth, credential.agentToken, credential.agentId);
    sendData(response, body.requestId, credential, 201);
    return;
  }

  if (method === 'POST' && url.pathname === '/api/v1/tasks') {
    const context = createMutationContext(request, options.auth);
    const input = parseCreateTaskRequest(await readJsonBody(request));
    const task = await api.createTask(input, context);
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
    sendData(response, context.requestId, credential, 202);
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
    assertAgentIdentityMatches(agentIdentity, [body.agentId]);
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
      body.events.map((event) => event.agentId)
    );
    let accepted = 0;

    for (const event of body.events) {
      await api.receiveAgentEvent(event);
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
  return createServer((request, response) => {
    void routeRequest(api, request, response, options).catch((error: unknown) => {
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
