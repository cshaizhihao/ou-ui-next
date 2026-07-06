#!/usr/bin/env node

const { randomUUID } = require('node:crypto');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { dirname } = require('node:path');
const {
  buildEndpointUrl,
  createCookieHeader,
  normalizeBaseUrl,
  parseEnvFile
} = require('./production-smoke.cjs');

const defaultCredentialsFile = '/etc/ou-ui-next/credentials.env';
const defaultTimeoutMs = 15_000;
const defaultWaitMs = 180_000;
const defaultPollIntervalMs = 3_000;
const defaultPortMin = 42_000;
const defaultPortMax = 48_999;

function parseBoolean(value) {
  return /^(1|true|yes|on)$/i.test(String(value ?? '').trim());
}

function parseBooleanDefaultTrue(value) {
  if (value === undefined || value === null || value === '') {
    return true;
  }

  return !/^(0|false|no|off)$/i.test(String(value).trim());
}

function parseArgs(argv) {
  const options = {
    positional: []
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    if (arg === '--base-url') {
      options.baseUrl = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--credentials-file') {
      options.credentialsFile = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--timeout-ms') {
      options.timeoutMs = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--wait-ms') {
      options.waitMs = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--poll-interval-ms') {
      options.pollIntervalMs = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--agent-id') {
      options.agentId = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--listen-port') {
      options.listenPort = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--port-min') {
      options.portMin = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--port-max') {
      options.portMax = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--server-address') {
      options.serverAddress = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--target-prefix') {
      options.targetPrefix = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--client-actions') {
      options.clientActions = true;
      continue;
    }

    if (arg === '--skip-client-actions') {
      options.clientActions = false;
      continue;
    }

    if (arg === '--cleanup') {
      options.cleanup = true;
      continue;
    }

    if (arg === '--skip-cleanup') {
      options.cleanup = false;
      continue;
    }

    if (arg === '--report') {
      options.reportPath = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--insecure-tls') {
      options.insecureTls = true;
      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    options.positional.push(arg);
  }

  if (!options.baseUrl && options.positional.length > 0) {
    options.baseUrl = options.positional[0];
  }

  return options;
}

function readOptionalEnvFile(path) {
  if (!path || !existsSync(path)) {
    return {};
  }

  return parseEnvFile(readFileSync(path, 'utf8'));
}

function readOptionalSecretFile(path) {
  if (!path) {
    return undefined;
  }

  return readFileSync(path, 'utf8').trim();
}

function readPositiveInteger(value, fallback, label) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return parsed;
}

function readOptionalPort(value, label) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`${label} must be a TCP port from 1 to 65535.`);
  }

  return parsed;
}

function resolveXrayApplySmokeConfig(env = process.env, argv = process.argv.slice(2)) {
  const args = parseArgs(argv);

  if (args.help) {
    return { help: true };
  }

  const credentialsFile =
    args.credentialsFile ??
    env.OU_UI_XRAY_SMOKE_CREDENTIALS_FILE ??
    env.OU_UI_SMOKE_CREDENTIALS_FILE ??
    defaultCredentialsFile;
  const credentials = readOptionalEnvFile(credentialsFile);
  const explicitUsername = env.OU_UI_XRAY_SMOKE_USERNAME ?? env.OU_UI_SMOKE_USERNAME;
  const explicitPassword =
    env.OU_UI_XRAY_SMOKE_PASSWORD ??
    readOptionalSecretFile(env.OU_UI_XRAY_SMOKE_PASSWORD_FILE) ??
    env.OU_UI_SMOKE_PASSWORD ??
    readOptionalSecretFile(env.OU_UI_SMOKE_PASSWORD_FILE);
  const username =
    explicitUsername ??
    credentials.OU_UI_CONTROL_PLANE_OPERATOR_USERNAME ??
    credentials.OU_UI_XRAY_SMOKE_USERNAME ??
    credentials.OU_UI_SMOKE_USERNAME;
  const password =
    explicitPassword ??
    credentials.OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD ??
    credentials.OU_UI_XRAY_SMOKE_PASSWORD ??
    credentials.OU_UI_SMOKE_PASSWORD;
  const baseUrl = args.baseUrl ?? env.OU_UI_XRAY_SMOKE_BASE_URL ?? env.OU_UI_SMOKE_BASE_URL ?? env.OU_UI_PANEL_URL;

  if (!baseUrl) {
    throw new Error('Missing OU_UI_XRAY_SMOKE_BASE_URL or --base-url.');
  }

  if (!username || !password) {
    throw new Error('Missing Xray smoke login credentials.');
  }

  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const portMin = readPositiveInteger(args.portMin ?? env.OU_UI_XRAY_SMOKE_PORT_MIN, defaultPortMin, 'portMin');
  const portMax = readPositiveInteger(args.portMax ?? env.OU_UI_XRAY_SMOKE_PORT_MAX, defaultPortMax, 'portMax');

  if (portMin > portMax) {
    throw new Error('portMin must be less than or equal to portMax.');
  }

  return {
    baseUrl: normalizedBaseUrl,
    username,
    password,
    credentialsFile,
    timeoutMs: readPositiveInteger(
      args.timeoutMs ?? env.OU_UI_XRAY_SMOKE_TIMEOUT_MS ?? env.OU_UI_SMOKE_TIMEOUT_MS,
      defaultTimeoutMs,
      'timeoutMs'
    ),
    waitMs: readPositiveInteger(args.waitMs ?? env.OU_UI_XRAY_SMOKE_WAIT_MS, defaultWaitMs, 'waitMs'),
    pollIntervalMs: readPositiveInteger(
      args.pollIntervalMs ?? env.OU_UI_XRAY_SMOKE_POLL_INTERVAL_MS,
      defaultPollIntervalMs,
      'pollIntervalMs'
    ),
    insecureTls: Boolean(args.insecureTls) || parseBoolean(env.OU_UI_XRAY_SMOKE_INSECURE_TLS ?? env.OU_UI_SMOKE_INSECURE_TLS),
    agentId: args.agentId ?? env.OU_UI_XRAY_SMOKE_AGENT_ID,
    listenPort: readOptionalPort(args.listenPort ?? env.OU_UI_XRAY_SMOKE_LISTEN_PORT, 'listenPort'),
    portMin,
    portMax,
    serverAddress: args.serverAddress ?? env.OU_UI_XRAY_SMOKE_SERVER_ADDRESS ?? normalizedBaseUrl.hostname,
    targetPrefix: args.targetPrefix ?? env.OU_UI_XRAY_SMOKE_TARGET_PREFIX ?? 'xray-live-smoke',
    clientActions:
      args.clientActions === undefined
        ? parseBoolean(env.OU_UI_XRAY_SMOKE_CLIENT_ACTIONS)
        : Boolean(args.clientActions),
    cleanup:
      args.cleanup === undefined
        ? parseBooleanDefaultTrue(env.OU_UI_XRAY_SMOKE_CLEANUP)
        : Boolean(args.cleanup),
    reportPath: args.reportPath ?? env.OU_UI_XRAY_SMOKE_REPORT_PATH
  };
}

function readArray(value) {
  return Array.isArray(value) ? value : [];
}

function readObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function hasCapability(item, capability) {
  return readArray(item?.capabilities).includes(capability);
}

function selectXrayAgent(snapshot, preferredAgentId) {
  const agents = readArray(snapshot?.agents);
  const xrayAgents = agents.filter((agent) => hasCapability(agent, 'xray'));

  if (preferredAgentId) {
    const agent = xrayAgents.find((item) => item?.id === preferredAgentId);

    if (!agent) {
      throw new Error(`Agent ${preferredAgentId} is missing or does not advertise xray capability.`);
    }

    if (agent.status !== 'online') {
      throw new Error(`Agent ${preferredAgentId} is not online; current status is ${agent.status ?? 'unknown'}.`);
    }

    return agent;
  }

  const onlineAgent = xrayAgents.find((agent) => agent?.status === 'online');

  if (!onlineAgent) {
    throw new Error('No online Agent with xray capability is available.');
  }

  return onlineAgent;
}

function collectReservedXrayPorts(snapshot, agentId) {
  const reserved = new Set();

  for (const inbound of readArray(snapshot?.inbounds)) {
    if (inbound?.agentId === agentId && Number.isSafeInteger(inbound.listenPort)) {
      reserved.add(inbound.listenPort);
    }
  }

  const latestRevisionByTarget = new Map();

  readArray(snapshot?.configRevisions).forEach((revision, index) => {
    const diagnosis = readObject(readObject(revision?.artifact).runtimeDiagnosis);
    const plannedInbound = readObject(diagnosis.plannedInbound);

    if (plannedInbound.agentId !== agentId || !Number.isSafeInteger(plannedInbound.listenPort)) {
      return;
    }

    const targetKey =
      typeof revision?.targetId === 'string' && revision.targetId.trim()
        ? revision.targetId.trim()
        : typeof revision?.id === 'string'
          ? revision.id
          : `${plannedInbound.agentId}:${plannedInbound.listenPort}:${index}`;
    const revisionTime = Date.parse(revision?.appliedAt ?? revision?.failedAt ?? revision?.createdAt ?? '');
    const rank = Number.isNaN(revisionTime) ? index : revisionTime;
    const current = latestRevisionByTarget.get(targetKey);

    if (!current || rank >= current.rank) {
      latestRevisionByTarget.set(targetKey, {
        rank,
        plannedInbound
      });
    }
  });

  for (const { plannedInbound } of latestRevisionByTarget.values()) {
    if (plannedInbound.action !== 'remove_inbound') {
      reserved.add(plannedInbound.listenPort);
    }
  }

  for (const task of readArray(snapshot?.tasks)) {
    const metadata = readObject(task?.metadata);

    if (
      metadata.agentId === agentId &&
      task?.resourceType === 'inbound' &&
      ['queued', 'running', 'retrying'].includes(task?.status) &&
      task?.operation !== 'inbound.delete' &&
      Number.isSafeInteger(metadata.listenPort)
    ) {
      reserved.add(metadata.listenPort);
    }
  }

  return reserved;
}

function allocateXrayListenPort(snapshot, agentId, options = {}) {
  const reserved = collectReservedXrayPorts(snapshot, agentId);

  if (options.listenPort) {
    if (reserved.has(options.listenPort)) {
      throw new Error(`Listen port ${options.listenPort} is already reserved for Agent ${agentId}.`);
    }

    return options.listenPort;
  }

  const min = options.portMin ?? defaultPortMin;
  const max = options.portMax ?? defaultPortMax;

  for (let port = min; port <= max; port += 1) {
    if (!reserved.has(port)) {
      return port;
    }
  }

  throw new Error(`No free Xray smoke listen port in ${min}-${max} for Agent ${agentId}.`);
}

function createTargetSlug(prefix, listenPort) {
  return `${prefix}-${listenPort}-${randomUUID().slice(0, 8)}`.toLowerCase();
}

function buildXrayInboundTaskInput(options) {
  const targetId = options.targetId ?? createTargetSlug(options.targetPrefix ?? 'xray-live-smoke', options.listenPort);
  const clientCredential = options.clientCredential ?? randomUUID();
  const clientIdentity = options.clientIdentity ?? `smoke-${options.listenPort}-${randomUUID().slice(0, 8)}`;
  const clientEmail = options.clientEmail ?? `${clientIdentity}@example.test`;
  const expiresAt =
    options.expiresAt ?? new Date((options.nowMs ?? Date.now()) + 24 * 60 * 60 * 1000).toISOString();

  return {
    operation: 'inbound.create',
    resourceType: 'inbound',
    targetId,
    targetLabel: options.targetLabel ?? `Xray Live Smoke ${options.listenPort}`,
    summary: options.summary ?? 'Create Xray runtime smoke inbound and wait for Agent evidence',
    metadata: {
      nodeId: targetId,
      agentId: options.agentId,
      customerNodeName: options.targetLabel ?? `Xray Live Smoke ${options.listenPort}`,
      customerName: options.customerName ?? 'Runtime Smoke',
      serverAddress: options.serverAddress,
      xrayProtocol: 'vless',
      listenPort: options.listenPort,
      clientIdentity,
      clientEmail,
      clientCredential,
      clientLevel: 0,
      resetPolicy: 'never',
      streamNetwork: 'tcp',
      security: 'none',
      sniffingEnabled: true,
      trafficMultiplier: 1,
      trafficLimitGb: 1,
      currentUsedTrafficGb: 0,
      remainingDays: 1,
      expiresAt,
      subscriptionRule: 'runtime-smoke',
      enabled: true,
      clients: [
        {
          clientIdentity,
          clientEmail,
          clientCredential,
          clientLevel: 0,
          resetPolicy: 'never',
          trafficMultiplier: 1,
          trafficLimitGb: 1,
          currentUsedTrafficGb: 0,
          remainingDays: 1,
          expiresAt,
          subscriptionRule: 'runtime-smoke',
          enabled: true
        }
      ]
    }
  };
}

function buildXrayInboundUpdateTaskInput(createTaskInput, options = {}) {
  const metadata = readObject(createTaskInput.metadata);
  const clients = readArray(metadata.clients);
  const trafficLimitGb = options.trafficLimitGb ?? 2;
  const sniffingEnabled = options.sniffingEnabled ?? false;

  return {
    ...createTaskInput,
    operation: 'inbound.update',
    targetLabel: options.targetLabel ?? `${createTaskInput.targetLabel ?? metadata.customerNodeName ?? createTaskInput.targetId} Updated`,
    summary: options.summary ?? 'Update Xray runtime smoke inbound and wait for Agent evidence',
    metadata: {
      ...metadata,
      customerNodeName: options.targetLabel ?? metadata.customerNodeName,
      trafficLimitGb,
      sniffingEnabled,
      clients: clients.map((client) => ({
        ...readObject(client),
        trafficLimitGb,
        clientComment: options.clientComment ?? 'runtime-smoke-update-verified'
      }))
    }
  };
}

function buildXrayInboundDeleteTaskInput(createTaskInput, options = {}) {
  const metadata = readObject(createTaskInput.metadata);
  const clients = readArray(metadata.clients);

  return {
    ...createTaskInput,
    operation: 'inbound.delete',
    targetLabel:
      options.targetLabel ??
      `${createTaskInput.targetLabel ?? metadata.customerNodeName ?? createTaskInput.targetId} Cleanup`,
    summary: options.summary ?? 'Delete Xray runtime smoke inbound and verify Agent removal evidence',
    metadata: {
      ...metadata,
      customerNodeName: options.targetLabel ?? metadata.customerNodeName,
      enabled: false,
      clients: clients.map((client) => ({
        ...readObject(client),
        enabled: false,
        runtimeDisabledByPolicy: true,
        guardrailReason: 'runtime_smoke_cleanup'
      }))
    },
    riskConfirmation: {
      operation: 'inbound.delete',
      targetId: createTaskInput.targetId
    }
  };
}

function buildXrayClientAddActionRequest(createTaskInput, options = {}) {
  const metadata = readObject(createTaskInput.metadata);
  const listenPort = Number.isSafeInteger(metadata.listenPort) ? metadata.listenPort : 0;
  const clientIdentity = options.clientIdentity ?? `smoke-extra-${listenPort}-${randomUUID().slice(0, 8)}`;
  const clientEmail = options.clientEmail ?? `${clientIdentity}@example.test`;
  const remainingDays = options.remainingDays ?? 1;

  return {
    inboundId: createTaskInput.targetId,
    action: {
      kind: 'add-client',
      clientIdentity,
      clientEmail,
      clientCredential: options.clientCredential ?? randomUUID(),
      trafficLimitGb: options.trafficLimitGb ?? 1,
      remainingDays,
      ipLimit: options.ipLimit ?? 1,
      subscriptionRule: options.subscriptionRule ?? `runtime-smoke:${clientIdentity}`,
      enabled: options.enabled ?? true
    },
    reason: options.reason ?? 'runtime smoke add-client evidence'
  };
}

function buildXrayClientDeleteActionRequest(createTaskInput, options = {}) {
  return {
    inboundId: createTaskInput.targetId,
    clientEmail: options.clientEmail,
    clientId: options.clientId,
    action: {
      kind: 'delete-client'
    },
    reason: options.reason ?? 'runtime smoke delete-client evidence'
  };
}

function getSetCookieValues(headers) {
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie();
  }

  const value = headers.get('set-cookie');
  return value ? [value] : [];
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      redirect: 'manual',
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms.`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function readResponsePayload(response) {
  const text = await response.text();
  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('application/json') && text) {
    return {
      text,
      json: JSON.parse(text)
    };
  }

  return { text };
}

function responseErrorSummary(payload) {
  const error = payload.json?.error;

  if (error && typeof error === 'object') {
    return [error.code, error.message].filter(Boolean).join(': ');
  }

  if (payload.text) {
    return payload.text.replace(/\s+/g, ' ').slice(0, 200);
  }

  return 'empty response';
}

function assertStatus(label, response, payload, expectedStatuses) {
  if (expectedStatuses.includes(response.status)) {
    return;
  }

  throw new Error(`${label} HTTP ${response.status}; expected ${expectedStatuses.join('/')} (${responseErrorSummary(payload)}).`);
}

function assertEnvelopeData(label, payload) {
  if (!payload.json || !Object.prototype.hasOwnProperty.call(payload.json, 'data')) {
    throw new Error(`${label} did not return a standard API envelope.`);
  }

  return payload.json.data;
}

async function requestJson(config, context, method, endpointPath, options = {}) {
  const response = await fetchWithTimeout(
    buildEndpointUrl(config.baseUrl, endpointPath),
    {
      method,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(context.cookieHeader ? { Cookie: context.cookieHeader } : {}),
        ...(options.headers ?? {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    },
    config.timeoutMs
  );
  const payload = await readResponsePayload(response);

  return { response, payload };
}

async function login(config, context) {
  const result = await requestJson(config, context, 'POST', '/api/v1/auth/session', {
    body: {
      username: config.username,
      password: config.password
    }
  });
  assertStatus('operator login', result.response, result.payload, [201]);
  const data = assertEnvelopeData('operator login', result.payload);
  context.cookieHeader = createCookieHeader(getSetCookieValues(result.response.headers));
  context.csrfToken = data.csrfToken;

  if (!context.cookieHeader || !context.csrfToken) {
    throw new Error('Operator login did not return both session cookie and CSRF token.');
  }

  return data;
}

async function logout(config, context) {
  if (!context.cookieHeader || !context.csrfToken) {
    return;
  }

  await requestJson(config, context, 'DELETE', '/api/v1/auth/session', {
    headers: {
      'X-Request-Id': `req-xray-smoke-logout-${randomUUID()}`,
      'X-CSRF-Token': context.csrfToken
    }
  });
}

async function readSnapshot(config, context) {
  const result = await requestJson(config, context, 'GET', '/api/v1/snapshot');
  assertStatus('snapshot', result.response, result.payload, [200]);
  return assertEnvelopeData('snapshot', result.payload);
}

async function createTask(config, context, taskInput, label = 'create Xray inbound task') {
  const result = await requestJson(config, context, 'POST', '/api/v1/tasks', {
    headers: {
      'X-Request-Id': `req-xray-smoke-${randomUUID()}`,
      'Idempotency-Key': `idem-xray-smoke-${taskInput.operation}-${taskInput.targetId}`,
      'X-CSRF-Token': context.csrfToken
    },
    body: taskInput
  });
  assertStatus(label, result.response, result.payload, [201]);

  const payload = result.payload.json ?? {};
  const data = payload.data ?? {};
  const taskId = payload.taskId ?? data.taskId ?? data.id;

  if (!taskId) {
    throw new Error('Create task response did not include a task id.');
  }

  return {
    taskId,
    response: payload
  };
}

async function createXrayClientActionTask(config, context, request, label = 'create Xray client action task') {
  const action = readObject(request.action);
  const actionTarget =
    request.clientEmail ?? action.clientEmail ?? request.clientId ?? action.clientIdentity ?? randomUUID().slice(0, 8);
  const result = await requestJson(config, context, 'POST', '/api/v1/xray-client-actions', {
    headers: {
      'X-Request-Id': `req-xray-client-smoke-${randomUUID()}`,
      'Idempotency-Key': `idem-xray-client-smoke-${request.inboundId}-${action.kind}-${actionTarget}`,
      'X-CSRF-Token': context.csrfToken
    },
    body: request
  });
  assertStatus(label, result.response, result.payload, [202]);

  const payload = result.payload.json ?? {};
  const data = payload.data ?? {};
  const taskId = payload.taskId ?? data.taskId ?? data.id;

  if (!taskId) {
    throw new Error('Xray client action response did not include a task id.');
  }

  return {
    taskId,
    response: payload
  };
}

function findById(items, id) {
  return readArray(items).find((item) => item?.id === id);
}

function findByTaskId(items, taskId) {
  return readArray(items).find((item) => item?.taskId === taskId);
}

function extractXrayApplyEvidence(snapshot, taskId, targetId) {
  const task =
    findById(snapshot?.tasks, taskId) ??
    readArray(snapshot?.tasks).find(
      (item) =>
        item?.targetId === targetId &&
        (item?.operation === 'inbound.create' || item?.operation === 'inbound.update' || item?.operation === 'inbound.delete')
    );
  const configRevision = findByTaskId(snapshot?.configRevisions, taskId);
  const preflightPlan = findByTaskId(snapshot?.preflightPlans, taskId);
  const runtimeSnapshot = findByTaskId(snapshot?.runtimeSnapshots, taskId);
  const commandOutboxItem = findByTaskId(snapshot?.commandOutbox, taskId);
  const artifact = readObject(configRevision?.artifact);
  const runtimeDiagnosis = readObject(artifact.runtimeDiagnosis);

  return {
    task,
    configRevision,
    preflightPlan,
    runtimeSnapshot,
    commandOutboxItem,
    runtimeDiagnosis
  };
}

function validateXrayApplyEvidence(evidence, expected = {}) {
  const errors = [];
  const plannedInbound = readObject(evidence.runtimeDiagnosis.plannedInbound);
  const taskMetadata = readObject(evidence.task?.metadata);
  const clientCounters = readObject(evidence.runtimeDiagnosis.clientCounters);

  if (!evidence.task) {
    errors.push('task is missing from snapshot');
  } else if (evidence.task.status !== 'succeeded') {
    errors.push(`task status is ${evidence.task.status ?? 'unknown'}`);
  }

  if (expected.operation && evidence.task?.operation !== expected.operation) {
    errors.push(`task operation is ${evidence.task?.operation ?? 'missing'}`);
  }

  if (expected.clientAction && taskMetadata.xrayClientAction !== expected.clientAction) {
    errors.push(`Xray client action is ${taskMetadata.xrayClientAction ?? 'missing'}`);
  }

  if (expected.clientEmail && taskMetadata.xrayClientActionTargetEmail !== expected.clientEmail) {
    errors.push(`Xray client action target email is ${taskMetadata.xrayClientActionTargetEmail ?? 'missing'}`);
  }

  if (!evidence.commandOutboxItem) {
    errors.push('Agent command outbox item is missing');
  } else if (evidence.commandOutboxItem.status !== 'completed') {
    errors.push(`Agent command status is ${evidence.commandOutboxItem.status ?? 'unknown'}`);
  }

  if (!evidence.configRevision) {
    errors.push('runtime config revision is missing');
  } else if (evidence.configRevision.status !== 'applied') {
    errors.push(`runtime config revision status is ${evidence.configRevision.status ?? 'unknown'}`);
  }

  if (!evidence.preflightPlan) {
    errors.push('preflight plan is missing');
  } else if (evidence.preflightPlan.status !== 'passed') {
    errors.push(`preflight plan status is ${evidence.preflightPlan.status ?? 'unknown'}`);
  }

  if (!evidence.runtimeSnapshot) {
    errors.push('runtime snapshot is missing');
  } else if (evidence.runtimeSnapshot.status !== 'verified') {
    errors.push(`runtime snapshot status is ${evidence.runtimeSnapshot.status ?? 'unknown'}`);
  }

  if (evidence.runtimeDiagnosis.evidenceStage !== 'agent-result-verified') {
    errors.push(`runtime diagnosis evidenceStage is ${evidence.runtimeDiagnosis.evidenceStage ?? 'missing'}`);
  }

  if (evidence.runtimeDiagnosis.hasRuntimeEvidence !== true) {
    errors.push('runtime diagnosis does not have Agent runtime evidence');
  }

  const expectedRuntimeState = expected.runtimeState ?? 'ready';

  if (evidence.runtimeDiagnosis.state !== expectedRuntimeState) {
    errors.push(`runtime diagnosis state is ${evidence.runtimeDiagnosis.state ?? 'missing'}`);
  }

  if (expected.agentId && plannedInbound.agentId !== expected.agentId) {
    errors.push(`planned inbound agentId is ${plannedInbound.agentId ?? 'missing'}`);
  }

  if (expected.listenPort && plannedInbound.listenPort !== expected.listenPort) {
    errors.push(`planned inbound listenPort is ${plannedInbound.listenPort ?? 'missing'}`);
  }

  if (plannedInbound.protocol !== 'vless') {
    errors.push(`planned inbound protocol is ${plannedInbound.protocol ?? 'missing'}`);
  }

  const expectedPlannedInboundAction = expected.plannedInboundAction ?? 'upsert_inbound';

  if (plannedInbound.action !== expectedPlannedInboundAction) {
    errors.push(`planned inbound action is ${plannedInbound.action ?? 'missing'}`);
  }

  if (expected.plannedBindingStatus && evidence.runtimeDiagnosis.plannedBindingStatus !== expected.plannedBindingStatus) {
    errors.push(`planned binding status is ${evidence.runtimeDiagnosis.plannedBindingStatus ?? 'missing'}`);
  }

  if (!readArray(evidence.runtimeDiagnosis.plannedRuntimeServices).includes('ou-ui-xray.service')) {
    errors.push('planned runtime services do not include ou-ui-xray.service');
  }

  if (expected.clientCounters) {
    for (const [key, value] of Object.entries(expected.clientCounters)) {
      if (clientCounters[key] !== value) {
        errors.push(`runtime diagnosis clientCounters.${key} is ${clientCounters[key] ?? 'missing'}`);
      }
    }
  }

  return errors;
}

function summarizeXrayApplyEvidence(evidence) {
  const plannedInbound = readObject(evidence.runtimeDiagnosis.plannedInbound);
  const taskMetadata = readObject(evidence.task?.metadata);
  const clientCounters = readObject(evidence.runtimeDiagnosis.clientCounters);

  return {
    taskId: evidence.task?.id,
    taskStatus: evidence.task?.status,
    targetId: evidence.task?.targetId,
    operation: evidence.task?.operation,
    configRevisionId: evidence.configRevision?.id,
    configRevisionStatus: evidence.configRevision?.status,
    preflightPlanId: evidence.preflightPlan?.id,
    preflightStatus: evidence.preflightPlan?.status,
    runtimeSnapshotId: evidence.runtimeSnapshot?.id,
    runtimeSnapshotStatus: evidence.runtimeSnapshot?.status,
    commandId: evidence.commandOutboxItem?.commandId,
    commandStatus: evidence.commandOutboxItem?.status,
    agentId: plannedInbound.agentId,
    listenAddress: plannedInbound.listenAddress,
    listenPort: plannedInbound.listenPort,
    protocol: plannedInbound.protocol,
    action: plannedInbound.action,
    runtimeState: evidence.runtimeDiagnosis.state,
    evidenceStage: evidence.runtimeDiagnosis.evidenceStage,
    plannedBindingStatus: evidence.runtimeDiagnosis.plannedBindingStatus,
    xrayClientAction: taskMetadata.xrayClientAction,
    xrayClientActionTargetEmail: taskMetadata.xrayClientActionTargetEmail,
    clientCounters,
    plannedRuntimeServices: readArray(evidence.runtimeDiagnosis.plannedRuntimeServices)
  };
}

function createXraySmokeReport(config, details = {}) {
  return {
    schemaVersion: 'ou-ui-next.xray-apply-smoke.v1',
    status: 'running',
    startedAt: new Date().toISOString(),
    baseUrl: config.baseUrl.toString(),
    waitMs: config.waitMs,
    pollIntervalMs: config.pollIntervalMs,
    ...details
  };
}

function writeJsonReport(reportPath, report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

function markReportComplete(report, status, details = {}) {
  report.status = status;
  report.completedAt = new Date().toISOString();
  Object.assign(report, details);
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForXrayApplyEvidence(config, context, taskId, targetId, expected) {
  const deadlineAt = Date.now() + config.waitMs;
  let lastErrors = [];
  let lastEvidence;

  while (Date.now() <= deadlineAt) {
    const snapshot = await readSnapshot(config, context);
    const evidence = extractXrayApplyEvidence(snapshot, taskId, targetId);
    const errors = validateXrayApplyEvidence(evidence, expected);
    lastErrors = errors;
    lastEvidence = evidence;

    if (evidence.task?.status === 'failed') {
      throw new Error(
        `Xray apply task failed: ${evidence.task.failureReason ?? 'unknown failure'}; evidence errors: ${errors.join('; ')}`
      );
    }

    if (errors.length === 0) {
      return {
        snapshot,
        evidence
      };
    }

    await delay(config.pollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for Xray Agent runtime evidence for task ${taskId}: ${lastErrors.join('; ') || 'no evidence observed'}.` +
      (lastEvidence?.task?.status ? ` Last task status: ${lastEvidence.task.status}.` : '')
  );
}

function logPass(label, detail) {
  process.stdout.write(`PASS ${label}${detail ? ` - ${detail}` : ''}\n`);
}

async function runXrayApplySmoke(config) {
  if (config.insecureTls) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  const context = {};
  const report = createXraySmokeReport(config);

  try {
    process.stdout.write(`OU-UI Next Xray apply smoke: ${config.baseUrl.toString()}\n`);
    await login(config, context);
    logPass('operator login');

    const initialSnapshot = await readSnapshot(config, context);
    const agent = selectXrayAgent(initialSnapshot, config.agentId);
    const listenPort = allocateXrayListenPort(initialSnapshot, agent.id, {
      listenPort: config.listenPort,
      portMin: config.portMin,
      portMax: config.portMax
    });
    const taskInput = buildXrayInboundTaskInput({
      agentId: agent.id,
      listenPort,
      serverAddress: config.serverAddress,
      targetPrefix: config.targetPrefix
    });

    logPass('xray agent selected', `${agent.id} port=${listenPort}`);
    Object.assign(report, {
      agentId: agent.id,
      listenPort,
      targetId: taskInput.targetId,
      cleanup: config.cleanup,
      phases: []
    });

    const createdTask = await createTask(config, context, taskInput);
    logPass('xray apply task created', createdTask.taskId);
    Object.assign(report, {
      taskId: createdTask.taskId
    });

    const { evidence } = await waitForXrayApplyEvidence(config, context, createdTask.taskId, taskInput.targetId, {
      agentId: agent.id,
      listenPort,
      operation: 'inbound.create'
    });
    const evidenceSummary = summarizeXrayApplyEvidence(evidence);
    report.phases.push({
      name: 'create',
      taskId: createdTask.taskId,
      evidence: evidenceSummary
    });
    logPass('create agent runtime evidence verified', `${evidenceSummary.configRevisionId} ${evidenceSummary.evidenceStage}`);

    const updateTaskInput = buildXrayInboundUpdateTaskInput(taskInput, {
      targetLabel: `${taskInput.targetLabel} Updated`
    });
    const updatedTask = await createTask(config, context, updateTaskInput, 'update Xray inbound task');
    logPass('xray update task created', updatedTask.taskId);

    const { evidence: updateEvidence } = await waitForXrayApplyEvidence(
      config,
      context,
      updatedTask.taskId,
      updateTaskInput.targetId,
      {
        agentId: agent.id,
        listenPort,
        operation: 'inbound.update'
      }
    );
    const updateEvidenceSummary = summarizeXrayApplyEvidence(updateEvidence);
    report.phases.push({
      name: 'update',
      taskId: updatedTask.taskId,
      evidence: updateEvidenceSummary
    });
    logPass(
      'update agent runtime evidence verified',
      `${updateEvidenceSummary.configRevisionId} ${updateEvidenceSummary.evidenceStage}`
    );

    let addClientEvidenceSummary;
    let deleteClientEvidenceSummary;
    let cleanupEvidenceSummary;

    if (config.clientActions) {
      const addClientRequest = buildXrayClientAddActionRequest(taskInput);
      const addClientEmail = addClientRequest.action.clientEmail;
      const addedClientTask = await createXrayClientActionTask(config, context, addClientRequest, 'add Xray client action task');
      logPass('xray add-client action task created', addedClientTask.taskId);

      const { evidence: addClientEvidence } = await waitForXrayApplyEvidence(
        config,
        context,
        addedClientTask.taskId,
        taskInput.targetId,
        {
          agentId: agent.id,
          listenPort,
          operation: 'inbound.update',
          clientAction: 'add-client',
          clientEmail: addClientEmail,
          clientCounters: {
            total: 2,
            active: 2
          }
        }
      );
      addClientEvidenceSummary = summarizeXrayApplyEvidence(addClientEvidence);
      report.phases.push({
        name: 'add-client',
        taskId: addedClientTask.taskId,
        evidence: addClientEvidenceSummary
      });
      logPass(
        'add-client agent runtime evidence verified',
        `${addClientEvidenceSummary.configRevisionId} ${addClientEvidenceSummary.evidenceStage}`
      );

      const deleteClientRequest = buildXrayClientDeleteActionRequest(taskInput, {
        clientEmail: addClientEmail
      });
      const deletedClientTask = await createXrayClientActionTask(
        config,
        context,
        deleteClientRequest,
        'delete Xray client action task'
      );
      logPass('xray delete-client action task created', deletedClientTask.taskId);

      const { evidence: deleteClientEvidence } = await waitForXrayApplyEvidence(
        config,
        context,
        deletedClientTask.taskId,
        taskInput.targetId,
        {
          agentId: agent.id,
          listenPort,
          operation: 'inbound.update',
          clientAction: 'delete-client',
          clientEmail: addClientEmail,
          clientCounters: {
            total: 1,
            active: 1
          }
        }
      );
      deleteClientEvidenceSummary = summarizeXrayApplyEvidence(deleteClientEvidence);
      report.phases.push({
        name: 'delete-client',
        taskId: deletedClientTask.taskId,
        evidence: deleteClientEvidenceSummary
      });
      logPass(
        'delete-client agent runtime evidence verified',
        `${deleteClientEvidenceSummary.configRevisionId} ${deleteClientEvidenceSummary.evidenceStage}`
      );
    }

    if (config.cleanup) {
      const deleteTaskInput = buildXrayInboundDeleteTaskInput(taskInput);
      const deletedInboundTask = await createTask(config, context, deleteTaskInput, 'delete Xray smoke inbound task');
      logPass('xray cleanup delete task created', deletedInboundTask.taskId);

      const { evidence: cleanupEvidence } = await waitForXrayApplyEvidence(
        config,
        context,
        deletedInboundTask.taskId,
        deleteTaskInput.targetId,
        {
          agentId: agent.id,
          listenPort,
          operation: 'inbound.delete',
          plannedInboundAction: 'remove_inbound',
          plannedBindingStatus: 'releasing',
          runtimeState: 'waiting',
          clientCounters: {
            total: 1,
            active: 0
          }
        }
      );
      cleanupEvidenceSummary = summarizeXrayApplyEvidence(cleanupEvidence);
      report.phases.push({
        name: 'cleanup-delete',
        taskId: deletedInboundTask.taskId,
        evidence: cleanupEvidenceSummary
      });
      logPass(
        'cleanup delete agent runtime evidence verified',
        `${cleanupEvidenceSummary.configRevisionId} ${cleanupEvidenceSummary.evidenceStage}`
      );
    }

    markReportComplete(report, 'passed', {
      evidence: cleanupEvidenceSummary ?? deleteClientEvidenceSummary ?? updateEvidenceSummary,
      createEvidence: evidenceSummary,
      updateEvidence: updateEvidenceSummary,
      addClientEvidence: addClientEvidenceSummary,
      deleteClientEvidence: deleteClientEvidenceSummary,
      cleanupEvidence: cleanupEvidenceSummary
    });

    if (config.reportPath) {
      writeJsonReport(config.reportPath, report);
      logPass('xray apply smoke report', config.reportPath);
    }

    await logout(config, context);

    return report;
  } catch (error) {
    markReportComplete(report, 'failed', {
      error: error instanceof Error ? error.message : String(error)
    });

    if (config.reportPath) {
      writeJsonReport(config.reportPath, report);
    }

    try {
      await logout(config, context);
    } catch {
      // Best-effort cleanup only; preserve the original smoke error.
    }

    throw error;
  }
}

function printHelp() {
  process.stdout.write(`OU-UI Next Xray Agent apply smoke

Usage:
  OU_UI_XRAY_SMOKE_BASE_URL=https://example.com/panel \\
  OU_UI_XRAY_SMOKE_USERNAME=operator \\
  OU_UI_XRAY_SMOKE_PASSWORD=... \\
  node scripts/production-xray-apply-smoke.cjs

Options:
  --base-url <url>             Panel base URL
  --credentials-file <path>    Read OU_UI_CONTROL_PLANE_OPERATOR_USERNAME/PASSWORD
  --agent-id <id>              Require a specific online Agent with xray capability
  --listen-port <port>         Use an explicit test Xray listen port
  --port-min <port>            Auto-allocation range start, default ${defaultPortMin}
  --port-max <port>            Auto-allocation range end, default ${defaultPortMax}
  --server-address <host>      Public server address written into the test inbound
  --target-prefix <prefix>     Test inbound target prefix
  --client-actions             Also verify add-client and delete-client through /api/v1/xray-client-actions
  --skip-client-actions        Disable client action phases when enabled by env
  --cleanup                    Delete the smoke inbound after verification, default on
  --skip-cleanup               Leave the smoke inbound in place for manual inspection
  --timeout-ms <ms>            Per-request timeout, default ${defaultTimeoutMs}
  --wait-ms <ms>               Total Agent evidence wait, default ${defaultWaitMs}
  --poll-interval-ms <ms>      Snapshot polling interval, default ${defaultPollIntervalMs}
  --report <path>              Write a redacted JSON report
  --insecure-tls               Allow self-signed TLS certificates
`);
}

if (require.main === module) {
  (async () => {
    try {
      const config = resolveXrayApplySmokeConfig();

      if (config.help) {
        printHelp();
        return;
      }

      await runXrayApplySmoke(config);
    } catch (error) {
      process.stderr.write(`FAIL Xray apply smoke: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  })();
}

module.exports = {
  allocateXrayListenPort,
  buildXrayClientAddActionRequest,
  buildXrayClientDeleteActionRequest,
  buildXrayInboundDeleteTaskInput,
  buildXrayInboundTaskInput,
  buildXrayInboundUpdateTaskInput,
  collectReservedXrayPorts,
  createXraySmokeReport,
  createXrayClientActionTask,
  extractXrayApplyEvidence,
  parseArgs,
  resolveXrayApplySmokeConfig,
  runXrayApplySmoke,
  selectXrayAgent,
  summarizeXrayApplyEvidence,
  validateXrayApplyEvidence
};
