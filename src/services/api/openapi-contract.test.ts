import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';

type SchemaObject = {
  $ref?: string;
  additionalProperties?: boolean;
  allOf?: SchemaObject[];
  enum?: string[];
  items?: SchemaObject;
  maximum?: number;
  minimum?: number;
  minItems?: number;
  oneOf?: SchemaObject[];
  required?: string[];
  properties?: Record<string, SchemaObject>;
  type?: string;
};

type OperationObject = {
  parameters?: Array<{ $ref: string }>;
  requestBody?: {
    content?: Record<
      string,
      {
        schema: SchemaObject;
      }
    >;
  };
  responses?: Record<
    string,
    {
      content?: Record<
        string,
        {
          schema: {
            allOf: [SchemaObject, SchemaObject];
          };
        }
      >;
    }
  >;
};

type OpenApiDocument = {
  openapi: string;
  paths: Record<string, Record<string, OperationObject>>;
  components: {
    parameters: Record<string, unknown>;
    schemas: Record<string, SchemaObject>;
  };
};

function loadOpenApi() {
  return yaml.load(readFileSync('docs/openapi/ou-ui-next-v1.yaml', 'utf8')) as OpenApiDocument;
}

function resolveSchema(document: OpenApiDocument, schema: SchemaObject) {
  if (!schema.$ref) {
    return schema;
  }

  const schemaName = schema.$ref.replace('#/components/schemas/', '');
  return document.components.schemas[schemaName];
}

function getSchemaProperty(schema: SchemaObject, propertyName: string) {
  const property = schema.properties?.[propertyName];

  if (!property) {
    throw new Error(`OpenAPI schema is missing property: ${propertyName}`);
  }

  return property;
}

function getJsonDataItemsSchema(document: OpenApiDocument, path: string) {
  const schema = document.paths[path].get.responses?.['200']?.content?.['application/json']?.schema;
  const dataSchema = schema?.allOf[1];

  if (!dataSchema) {
    throw new Error(`OpenAPI path is missing JSON data schema: ${path}`);
  }

  const data = getSchemaProperty(dataSchema, 'data');

  if (!data.items) {
    throw new Error(`OpenAPI path data schema is missing array items: ${path}`);
  }

  return data.items;
}

function getJsonDataSchema(document: OpenApiDocument, path: string) {
  const schema = document.paths[path].get.responses?.['200']?.content?.['application/json']?.schema;
  const dataSchema = schema?.allOf[1];

  if (!dataSchema) {
    throw new Error(`OpenAPI path is missing JSON data schema: ${path}`);
  }

  return getSchemaProperty(dataSchema, 'data');
}

describe('OpenAPI v1 contract', () => {
  it('documents the minimum production control-plane and agent endpoints', () => {
    const document = loadOpenApi();

    expect(document.openapi).toBe('3.1.0');
    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining([
        '/api/v1/tasks',
        '/api/v1/auth/session',
        '/api/v1/tasks/{taskId}',
        '/api/v1/tasks/{taskId}/transition',
        '/api/v1/boundary',
        '/api/v1/snapshot',
        '/api/v1/observability-metrics',
        '/metrics',
        '/api/v1/audit-logs',
        '/api/v1/audit-logs:verify',
        '/api/v1/agents',
        '/api/v1/system-alerts',
        '/api/v1/agents/install-command',
        '/api/v1/agent-credentials',
        '/api/v1/operator-sessions',
        '/api/v1/agent-credentials/{credentialId}/revoke',
        '/api/v1/agent-credentials/{credentialId}/rotate',
        '/api/v1/operator-sessions/{sessionId}/revoke',
        '/api/v1/nodes',
        '/api/v1/inbounds',
        '/api/v1/subscription-sources',
        '/api/v1/subscription-sources/{sourceId}/sync',
        '/api/v1/subscription-nodes',
        '/api/v1/subscription-bundles',
        '/api/v1/subscription-clients',
        '/api/v1/subscription-export-profiles',
        '/api/v1/proxy-providers',
        '/api/v1/subscription-export-files',
        '/sub/{securePath}/{format}/{subId}',
        '/api/v1/forward-rules',
        '/api/v1/quota-policies',
        '/api/v1/quota-policies/{quotaPolicyId}/reset',
        '/api/v1/rate-limit-policies',
        '/api/v1/permission-grants',
        '/api/v1/routing-policies',
        '/api/v1/tuning-profiles',
        '/api/v1/command-outbox',
        '/api/v1/agent-log-chunks',
        '/api/v1/agent-log-chunks:export',
        '/api/v1/agent-log-archives',
        '/api/v1/agent-log-archives:export',
        '/api/v1/agent-log-retention-policy',
        '/api/v1/traffic-rollup-retention-policy',
        '/api/v1/config-revisions',
        '/api/v1/preflight-plans',
        '/api/v1/runtime-snapshots',
        '/api/v1/traffic-rollups',
        '/api/v1/traffic-rollups:export',
        '/api/v1/traffic-rollup-compactions',
        '/api/v1/traffic-rollup-compactions:export',
        '/api/v1/agents/{agentId}/commands',
        '/agent/v1/register',
        '/agent/v1/credentials/rotate',
        '/agent/v1/poll',
        '/agent/v1/events',
        '/api/v1/customers',
        '/events/v1/tasks',
        '/events/v1/system-alerts'
      ])
    );

    const createTask = document.paths['/api/v1/tasks'].post;
    expect(createTask.parameters?.map((parameter) => parameter.$ref)).toEqual(
      expect.arrayContaining([
        '#/components/parameters/XRequestId',
        '#/components/parameters/IdempotencyKey',
        '#/components/parameters/IfMatch',
        '#/components/parameters/Actor',
        '#/components/parameters/OperatorGroupId',
        '#/components/parameters/ResourceGroupId'
      ])
    );

    const updateAgentLogRetentionPolicy = document.paths['/api/v1/agent-log-retention-policy'].patch;
    expect(updateAgentLogRetentionPolicy.parameters?.map((parameter) => parameter.$ref)).toEqual(
      expect.arrayContaining([
        '#/components/parameters/XRequestId',
        '#/components/parameters/XCsrfToken',
        '#/components/parameters/IdempotencyKey',
        '#/components/parameters/Actor',
        '#/components/parameters/OperatorGroupId',
        '#/components/parameters/ResourceGroupId'
      ])
    );
    expect(updateAgentLogRetentionPolicy.requestBody?.content?.['application/json']?.schema.$ref).toBe(
      '#/components/schemas/AgentLogRetentionPolicyUpdateRequest'
    );
    const updateTrafficRollupRetentionPolicy = document.paths['/api/v1/traffic-rollup-retention-policy'].patch;
    expect(updateTrafficRollupRetentionPolicy.parameters?.map((parameter) => parameter.$ref)).toEqual(
      expect.arrayContaining([
        '#/components/parameters/XRequestId',
        '#/components/parameters/XCsrfToken',
        '#/components/parameters/IdempotencyKey',
        '#/components/parameters/Actor',
        '#/components/parameters/OperatorGroupId',
        '#/components/parameters/ResourceGroupId'
      ])
    );
    expect(updateTrafficRollupRetentionPolicy.requestBody?.content?.['application/json']?.schema.$ref).toBe(
      '#/components/schemas/TrafficRollupRetentionPolicyUpdateRequest'
    );

    const createOperatorSession = document.paths['/api/v1/auth/session'].post;
    const operatorSessionData = createOperatorSession.responses?.['201']?.content?.['application/json']?.schema.allOf[1]
      .properties?.data;
    expect(operatorSessionData?.$ref).toBe('#/components/schemas/OperatorSession');
    expect(document.components.schemas.OperatorSession.required).toEqual(
      expect.arrayContaining(['authenticated', 'sessionId', 'username', 'actor', 'expiresAt', 'csrfToken'])
    );
    expect(document.components.schemas.OperatorSession.properties).not.toHaveProperty('password');
    expect(document.components.schemas.OperatorSession.properties).not.toHaveProperty('token');

    const createAgentInstallCommand = document.paths['/api/v1/agents/install-command'].post;
    expect(createAgentInstallCommand.parameters?.map((parameter) => parameter.$ref)).toEqual(
      expect.arrayContaining([
        '#/components/parameters/XRequestId',
        '#/components/parameters/IdempotencyKey',
        '#/components/parameters/Actor',
        '#/components/parameters/OperatorGroupId',
        '#/components/parameters/ResourceGroupId'
      ])
    );

    const registerAgent = document.paths['/agent/v1/register'].post;
    const registerResponseData = registerAgent.responses?.['201']?.content?.['application/json']?.schema.allOf[1].properties
      ?.data;

    expect(registerResponseData?.$ref).toBe('#/components/schemas/AgentRuntimeCredential');
    expect(document.components.schemas.AgentRuntimeCredential.required).toEqual(
      expect.arrayContaining(['agentId', 'agentToken', 'credentialId', 'issuedAt', 'expiresAt'])
    );
    const selfRotateAgent = document.paths['/agent/v1/credentials/rotate'].post;
    const selfRotateResponseData = selfRotateAgent.responses?.['201']?.content?.['application/json']?.schema.allOf[1]
      .properties?.data;
    expect(selfRotateAgent.requestBody?.content?.['application/json']?.schema.$ref).toBe(
      '#/components/schemas/AgentRuntimeCredentialRotateRequest'
    );
    expect(selfRotateResponseData?.$ref).toBe('#/components/schemas/AgentRuntimeCredential');

    expect(document.paths['/api/v1/agent-credentials'].get).toBeDefined();
    expect(document.paths['/api/v1/agent-credentials/{credentialId}/revoke'].post.parameters?.map((parameter) => parameter.$ref)).toEqual(
      expect.arrayContaining([
        '#/components/parameters/XRequestId',
        '#/components/parameters/Actor',
        '#/components/parameters/OperatorGroupId',
        '#/components/parameters/ResourceGroupId'
      ])
    );
    expect(document.paths['/api/v1/agent-credentials/{credentialId}/rotate'].post.parameters?.map((parameter) => parameter.$ref)).toEqual(
      expect.arrayContaining([
        '#/components/parameters/XRequestId',
        '#/components/parameters/Actor',
        '#/components/parameters/OperatorGroupId',
        '#/components/parameters/ResourceGroupId'
      ])
    );
    expect(document.paths['/api/v1/operator-sessions'].get).toBeDefined();
    expect(document.paths['/api/v1/operator-sessions/{sessionId}/revoke'].post.parameters?.map((parameter) => parameter.$ref)).toEqual(
      expect.arrayContaining([
        '#/components/parameters/XRequestId',
        '#/components/parameters/XCsrfToken',
        '#/components/parameters/Actor',
        '#/components/parameters/OperatorGroupId',
        '#/components/parameters/ResourceGroupId'
      ])
    );
    expect(document.components.schemas.OperatorSessionSummary.required).toEqual(
      expect.arrayContaining(['id', 'username', 'actor', 'status', 'issuedAt', 'expiresAt', 'sourceIp', 'requestId'])
    );
    const rotateResponseData = document.paths['/api/v1/agent-credentials/{credentialId}/rotate'].post.responses?.['201']
      ?.content?.['application/json']?.schema.allOf[1].properties?.data;
    expect(rotateResponseData?.$ref).toBe('#/components/schemas/AgentRuntimeCredential');
    expect(document.components.schemas.AgentCredentialSummary.properties).not.toHaveProperty('tokenHash');
    expect(document.components.schemas.AgentCredentialSummary.required).toEqual(
      expect.arrayContaining(['agentId', 'tokenPrefix', 'status', 'purpose', 'issuedAt', 'expiresAt'])
    );
    expect(document.components.schemas.CommandOutboxItem.properties).toMatchObject({
      deadlineAt: expect.objectContaining({ type: 'string', format: 'date-time' }),
      leaseOwnerId: expect.objectContaining({ type: 'string' }),
      leaseSessionId: { $ref: '#/components/schemas/SessionId' },
      leasedAt: expect.objectContaining({ type: 'string', format: 'date-time' }),
      leaseExpiresAt: expect.objectContaining({ type: 'string', format: 'date-time' }),
      ackedAt: expect.objectContaining({ type: 'string', format: 'date-time' })
    });
  });

  it('documents the HTTP control-plane runtime routes implemented by the server adapter', () => {
    const document = loadOpenApi();

    expect(document.paths['/api/v1/boundary'].get).toBeDefined();
    expect(document.paths['/api/v1/snapshot'].get).toBeDefined();
    expect(document.paths['/api/v1/agents'].get).toBeDefined();
    expect(document.paths['/api/v1/subscription-nodes'].get).toBeDefined();
    expect(document.paths['/api/v1/subscription-export-profiles'].get).toBeDefined();
    expect(document.paths['/api/v1/subscription-sources/{sourceId}/sync'].post.parameters?.map((parameter) => parameter.$ref)).toEqual(
      expect.arrayContaining([
        '#/components/parameters/XRequestId',
        '#/components/parameters/Actor',
        '#/components/parameters/OperatorGroupId',
        '#/components/parameters/ResourceGroupId'
      ])
    );
    expect(document.paths['/api/v1/quota-policies/{quotaPolicyId}/reset'].post.parameters?.map((parameter) => parameter.$ref)).toEqual(
      expect.arrayContaining([
        '#/components/parameters/XRequestId',
        '#/components/parameters/Actor',
        '#/components/parameters/OperatorGroupId',
        '#/components/parameters/ResourceGroupId'
      ])
    );
    const quotaResetResponseData = document.paths['/api/v1/quota-policies/{quotaPolicyId}/reset'].post.responses?.['202']
      ?.content?.['application/json']?.schema.allOf[1].properties?.data;
    expect(quotaResetResponseData?.$ref).toBe('#/components/schemas/DeployTask');
    expect(document.paths['/api/v1/command-outbox'].get).toBeDefined();
    expect(document.paths['/api/v1/agent-log-chunks'].get).toBeDefined();
    expect(document.paths['/api/v1/agent-log-archives'].get).toBeDefined();
    expect(document.paths['/api/v1/config-revisions'].get).toBeDefined();
    expect(document.paths['/api/v1/preflight-plans'].get).toBeDefined();
    expect(document.paths['/api/v1/runtime-snapshots'].get).toBeDefined();
    expect(document.paths['/api/v1/audit-logs'].get).toBeDefined();
    expect(document.paths['/api/v1/audit-logs:verify'].get).toBeDefined();
    expect(document.paths['/api/v1/audit-logs:verify'].post).toBeDefined();
    expect(document.paths['/api/v1/system-alerts'].get).toBeDefined();
    expect(document.paths['/events/v1/tasks'].get.responses?.['200']?.content).toHaveProperty('text/event-stream');
    expect(document.paths['/events/v1/tasks'].get.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'once' }),
        expect.objectContaining({ name: 'cursor' }),
        expect.objectContaining({ name: 'Last-Event-ID', in: 'header' })
      ])
    );
    expect(document.paths['/events/v1/system-alerts'].get.responses?.['200']?.content).toHaveProperty(
      'text/event-stream'
    );
    expect(document.paths['/events/v1/system-alerts'].get.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'once' }),
        expect.objectContaining({ name: 'cursor' }),
        expect.objectContaining({ name: 'Last-Event-ID', in: 'header' }),
        expect.objectContaining({ name: 'severity' }),
        expect.objectContaining({ name: 'resourceId' })
      ])
    );
    const agentReadModelSchema = resolveSchema(document, getJsonDataItemsSchema(document, '/api/v1/agents'));
    expect(agentReadModelSchema).toMatchObject({
      required: ['id']
    });
    expect(agentReadModelSchema.properties).toEqual(
      expect.objectContaining({
        telemetry: { $ref: '#/components/schemas/AgentTelemetryReadModel' }
      })
    );
    expect(document.components.schemas.AgentTelemetryReadModel.properties).toEqual(
      expect.objectContaining({
        loadAverage1m: { type: 'number', minimum: 0 },
        loadAverage5m: { type: 'number', minimum: 0 },
        loadAverage15m: { type: 'number', minimum: 0 },
        runtimeServices: {
          type: 'array',
          items: { $ref: '#/components/schemas/AgentRuntimeServiceHealth' }
        },
        hostGuardrailStoppedUnits: {
          type: 'array',
          items: { type: 'string', minLength: 1, maxLength: 200 }
        },
        hostGuardrailRestoredUnits: {
          type: 'array',
          items: { type: 'string', minLength: 1, maxLength: 200 }
        },
        samplingExpectedSince: expect.objectContaining({ type: 'string' }),
        sampleGapDetected: { type: 'boolean' },
        sampleGapSeconds: { type: 'integer', minimum: 0 },
        expectedSamplingIntervalSeconds: { type: 'number', minimum: 1 },
        sampleGapReason: {
          type: 'string',
          enum: ['no_telemetry_sample', 'stale_telemetry_sample', 'invalid_telemetry_timestamp']
        }
      })
    );
    expect(document.components.schemas.AgentRuntimeServiceHealth).toMatchObject({
      required: ['name', 'moduleKind', 'status', 'required', 'checkedAt'],
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 200 },
        status: { type: 'string', enum: ['active', 'inactive', 'failed', 'missing', 'unknown'] },
        required: { type: 'boolean' },
        checkedAt: { type: 'string', format: 'date-time' }
      }
    });
    expect(getJsonDataItemsSchema(document, '/api/v1/forward-rules')).toEqual({
      $ref: '#/components/schemas/ForwardRule'
    });
    expect(document.components.schemas.ControlPlaneSnapshot.properties?.forwardRules.items).toEqual({
      $ref: '#/components/schemas/ForwardRule'
    });
    expect(document.components.schemas.PortAllocationStatus.enum).toEqual(
      expect.arrayContaining(['deploying', 'allocated', 'paused', 'conflict', 'releasing', 'failed'])
    );
    expect(document.components.schemas.ForwardRule.properties?.portStatus).toEqual({
      $ref: '#/components/schemas/PortAllocationStatus'
    });
    expect(document.components.schemas.ForwardPortBinding.properties?.status).toEqual({
      $ref: '#/components/schemas/PortAllocationStatus'
    });
    expect(resolveSchema(document, getJsonDataItemsSchema(document, '/api/v1/subscription-sources'))).toMatchObject({
      required: ['id', 'kind', 'name', 'url', 'status', 'nodeCount', 'dedupeKey', 'lastSyncAt', 'rateLimitPerMinute'],
      properties: expect.objectContaining({
        providerAccountId: expect.objectContaining({ type: 'string' }),
        fetchTimeoutSeconds: expect.objectContaining({ type: 'integer', minimum: 1 }),
        maxBodyBytes: expect.objectContaining({ type: 'integer', minimum: 1 }),
        syncLeaseOwnerId: expect.objectContaining({ type: 'string' }),
        syncLeaseExpiresAt: expect.objectContaining({ type: 'string', format: 'date-time' }),
        syncBudget: expect.objectContaining({
          $ref: '#/components/schemas/SubscriptionSourceSyncBudget'
        }),
        traffic: expect.objectContaining({
          $ref: '#/components/schemas/SubscriptionTrafficSnapshot'
        })
      })
    });
    expect(document.components.schemas.SubscriptionSourceSyncBudget).toMatchObject({
      required: ['windowStartedAt', 'windowEndsAt', 'usedFetches', 'usedBytes'],
      properties: expect.objectContaining({
        maxFetchesPerDay: expect.objectContaining({ type: 'integer', minimum: 1 }),
        maxBytesPerDay: expect.objectContaining({ type: 'integer', minimum: 1 }),
        usedFetches: expect.objectContaining({ type: 'integer', minimum: 0 }),
        usedBytes: expect.objectContaining({ type: 'integer', minimum: 0 })
      })
    });
    expect(resolveSchema(document, getJsonDataItemsSchema(document, '/api/v1/subscription-nodes'))).toMatchObject({
      required: ['id', 'sourceId', 'name', 'protocol', 'server', 'port', 'latencyMs', 'tags'],
      properties: expect.objectContaining({
        status: expect.objectContaining({
          enum: expect.arrayContaining(['online', 'quota-exceeded', 'unknown'])
        }),
        customerName: expect.objectContaining({ type: 'string' }),
        hostId: expect.objectContaining({ type: 'string' }),
        usedTrafficBytes: expect.objectContaining({ type: 'number', minimum: 0 }),
        trafficLimitBytes: expect.objectContaining({ type: 'number', minimum: 0 })
      })
    });
    expect(resolveSchema(document, getJsonDataItemsSchema(document, '/api/v1/permission-grants'))).toMatchObject({
      required: ['id', 'subjectType', 'subjectId', 'resourceType', 'resourceId', 'permissions']
    });
    expect(resolveSchema(document, getJsonDataItemsSchema(document, '/api/v1/permission-grants')).properties).toEqual(
      expect.objectContaining({
        revokedAt: expect.objectContaining({ type: 'string' }),
        revokedBy: expect.objectContaining({ type: 'string' }),
        revokedReason: expect.objectContaining({ type: 'string' })
      })
    );
    expect(resolveSchema(document, getJsonDataItemsSchema(document, '/api/v1/agent-log-chunks')).required).toEqual([
      'eventId',
      'agentId',
      'sessionId',
      'seq',
      'observedAt',
      'commandId',
      'taskId',
      'chunkSeq',
      'stream',
      'content'
    ]);
    expect(resolveSchema(document, getJsonDataItemsSchema(document, '/api/v1/agent-log-archives')).required).toEqual([
      'id',
      'agentId',
      'sessionIds',
      'taskId',
      'commandId',
      'stream',
      'bucketStartAt',
      'bucketEndAt',
      'firstObservedAt',
      'lastObservedAt',
      'firstSeq',
      'lastSeq',
      'firstChunkSeq',
      'lastChunkSeq',
      'chunkCount',
      'contentBytes',
      'contentSha256',
      'archivedAt',
      'source'
    ]);
    expect(resolveSchema(document, getJsonDataItemsSchema(document, '/api/v1/agent-log-archives'))).toMatchObject({
      properties: expect.objectContaining({
        stream: { type: 'string', enum: ['stdout', 'stderr', 'agent', 'runtime'] },
        chunkCount: { type: 'integer', minimum: 0 },
        contentBytes: { type: 'integer', minimum: 0 },
        contentSha256: expect.objectContaining({ type: 'string' }),
        source: { type: 'string', enum: ['retention-prune'] }
      }),
      additionalProperties: false
    });

    const transitionTask = document.paths['/api/v1/tasks/{taskId}/transition'].post;
    expect(transitionTask.parameters?.map((parameter) => parameter.$ref)).toEqual(
      expect.arrayContaining([
        '#/components/parameters/TaskIdPath',
        '#/components/parameters/XRequestId',
        '#/components/parameters/Actor',
        '#/components/parameters/OperatorGroupId',
        '#/components/parameters/ResourceGroupId'
      ])
    );

    expect(document.components.schemas.ApiBoundaryDescriptor.required).toEqual(
      expect.arrayContaining(['version', 'restBasePath', 'eventStreamPath', 'agentStreamPath', 'supportsIdempotency'])
    );
    expect(document.components.schemas.ControlPlaneSnapshot.required).toEqual(
      expect.arrayContaining([
        'apiBoundary',
        'agents',
        'nodes',
        'subscriptionInventoryNodes',
        'subscriptionExportProfiles',
        'proxyProviders',
        'subscriptionExportFiles',
        'configRevisions',
        'preflightPlans',
        'runtimeSnapshots',
        'trafficRollups',
        'trafficRollupCompactions',
        'systemAlerts',
        'agentLogRetentionPolicy',
        'trafficRollupRetentionPolicy',
        'tasks',
        'auditLogs'
      ])
    );
    expect(resolveSchema(document, getJsonDataItemsSchema(document, '/api/v1/system-alerts'))).toMatchObject({
      required: expect.arrayContaining([
        'id',
        'kind',
        'severity',
        'status',
        'resourceType',
        'resourceId',
        'observedAt',
        'dedupeKey'
      ]),
      properties: expect.objectContaining({
        kind: {
          type: 'string',
          enum: [
            'agent.telemetry_sampling_gap',
            'agent.offline',
            'agent.runtime_service_unhealthy',
            'agent.high_latency',
            'command_outbox.overdue',
            'command_outbox.dead_letter',
            'runtime.reload_failed',
            'audit.write_failed',
            'system_alert_notification.overdue',
            'system_alert_notification.dead_letter',
            'quota.exceeded'
          ]
        },
        severity: { type: 'string', enum: ['warning', 'critical'] },
        status: { type: 'string', enum: ['active'] },
        resourceType: {
          type: 'string',
          enum: ['agent', 'command_outbox', 'quota_policy', 'runtime_release', 'audit', 'system_alert_notification']
        }
      })
    });
    expect(resolveSchema(document, getJsonDataSchema(document, '/api/v1/agent-log-retention-policy'))).toMatchObject({
      required: ['maxAgeMs', 'maxAgeDays', 'maxEventsPerAgent', 'source'],
      properties: {
        maxAgeMs: { type: 'integer', minimum: 1 },
        maxAgeDays: { type: 'number', exclusiveMinimum: 0 },
        maxEventsPerAgent: { type: 'integer', minimum: 0 },
        source: { type: 'string', enum: ['runtime-config', 'control-plane'] }
      }
    });
    expect(document.components.schemas.AgentLogRetentionPolicyUpdateRequest).toMatchObject({
      required: ['maxAgeDays', 'maxEventsPerAgent'],
      properties: {
        maxAgeDays: { type: 'number', exclusiveMinimum: 0, maximum: 3650 },
        maxEventsPerAgent: { type: 'integer', minimum: 0, maximum: 1000000 },
        reason: { type: 'string', minLength: 1, maxLength: 500 }
      },
      additionalProperties: false
    });
    expect(resolveSchema(document, getJsonDataSchema(document, '/api/v1/traffic-rollup-retention-policy'))).toMatchObject({
      required: ['maxAgeMs', 'maxAgeDays', 'maxRecordsPerScope', 'source', 'runtimeDefault'],
      properties: {
        maxAgeMs: { type: 'integer', minimum: 1 },
        maxAgeDays: { type: 'number', exclusiveMinimum: 0 },
        maxRecordsPerScope: { type: 'integer', minimum: 0 },
        source: { type: 'string', enum: ['runtime-config', 'control-plane'] },
        runtimeDefault: { $ref: '#/components/schemas/TrafficRollupRetentionPolicyValues' },
        controlPlaneOverride: { $ref: '#/components/schemas/TrafficRollupRetentionPolicyValues' }
      }
    });
    expect(document.components.schemas.TrafficRollupRetentionPolicyValues).toMatchObject({
      required: ['maxAgeMs', 'maxAgeDays', 'maxRecordsPerScope'],
      properties: {
        maxAgeMs: { type: 'integer', minimum: 1 },
        maxAgeDays: { type: 'number', exclusiveMinimum: 0 },
        maxRecordsPerScope: { type: 'integer', minimum: 0 }
      },
      additionalProperties: false
    });
    expect(document.components.schemas.TrafficRollupRetentionPolicyUpdateRequest).toMatchObject({
      required: ['maxAgeDays', 'maxRecordsPerScope'],
      properties: {
        maxAgeDays: { type: 'number', exclusiveMinimum: 0, maximum: 3650 },
        maxRecordsPerScope: { type: 'integer', minimum: 0, maximum: 10000000 },
        reason: { type: 'string', minLength: 1, maxLength: 500 }
      },
      additionalProperties: false
    });
    expect(resolveSchema(document, getJsonDataSchema(document, '/api/v1/agent-log-chunks:export'))).toMatchObject({
      required: ['format', 'contentType', 'filename', 'generatedAt', 'count', 'query', 'chunks', 'content'],
      properties: expect.objectContaining({
        format: { type: 'string', enum: ['jsonl', 'json'] },
        contentType: {
          type: 'string',
          enum: ['application/x-ndjson; charset=utf-8', 'application/json; charset=utf-8']
        },
        count: { type: 'integer', minimum: 0 },
        chunks: expect.objectContaining({
          type: 'array',
          items: { $ref: '#/components/schemas/AgentLogChunk' }
        }),
        content: { type: 'string' }
      })
    });
    expect(resolveSchema(document, getJsonDataSchema(document, '/api/v1/agent-log-archives:export'))).toMatchObject({
      required: ['format', 'contentType', 'filename', 'generatedAt', 'count', 'query', 'archives', 'content'],
      properties: expect.objectContaining({
        format: { type: 'string', enum: ['jsonl', 'json'] },
        contentType: {
          type: 'string',
          enum: ['application/x-ndjson; charset=utf-8', 'application/json; charset=utf-8']
        },
        count: { type: 'integer', minimum: 0 },
        archives: expect.objectContaining({
          type: 'array',
          items: { $ref: '#/components/schemas/AgentLogArchive' }
        }),
        content: { type: 'string' }
      })
    });
    expect(resolveSchema(document, getJsonDataSchema(document, '/api/v1/observability-metrics'))).toMatchObject({
      required: expect.arrayContaining([
        'generatedAt',
        'tasks',
        'commandOutbox',
        'agents',
        'systemAlerts',
        'systemAlertNotifications',
        'trafficRollups',
        'trafficRollupCompactions',
        'agentLogs',
        'agentLogArchives',
        'audit'
      ]),
      properties: expect.objectContaining({
        tasks: expect.objectContaining({
          required: expect.arrayContaining([
            'total',
            'active',
            'failed',
            'rollbacks',
            'completionLatencyMs',
            'completionLatencyByOperation',
            'runtimeApplyLatencyByModule',
            'byStatus'
          ])
        }),
        commandOutbox: expect.objectContaining({
          required: expect.arrayContaining([
            'total',
            'backlog',
            'activeLeases',
            'overdue',
            'deadLetters',
            'ackLatencyMs',
            'resultLatencyMs',
            'byStatus'
          ])
        }),
        systemAlerts: expect.objectContaining({
          required: expect.arrayContaining(['total', 'warning', 'critical', 'byKind', 'bySeverity'])
        }),
        systemAlertNotifications: expect.objectContaining({
          required: expect.arrayContaining([
            'total',
            'pending',
            'failed',
            'delivered',
            'deadLetters',
            'overdue',
            'byStatus'
          ])
        }),
        trafficRollups: { $ref: '#/components/schemas/ObservabilityTrafficRollupMetrics' },
        trafficRollupCompactions: { $ref: '#/components/schemas/ObservabilityTrafficRollupCompactionMetrics' },
        agentLogs: { $ref: '#/components/schemas/ObservabilityAgentLogMetrics' },
        agentLogArchives: { $ref: '#/components/schemas/ObservabilityAgentLogArchiveMetrics' },
        audit: { $ref: '#/components/schemas/ObservabilityAuditMetrics' }
      })
    });
    expect(document.components.schemas.ObservabilityTrafficRollupMetrics).toMatchObject({
      required: expect.arrayContaining([
        'retained',
        'earliestSampledAt',
        'latestSampledAt',
        'meteredBytesTotal',
        'byDimension'
      ]),
      properties: expect.objectContaining({
        retained: { type: 'integer', minimum: 0 },
        meteredBytesTotal: { type: 'integer', minimum: 0 },
        byDimension: expect.objectContaining({
          required: ['agent', 'forward-rule', 'xray-client']
        })
      }),
      additionalProperties: false
    });
    expect(document.components.schemas.ObservabilityTrafficRollupStorageMetrics).toMatchObject({
      required: expect.arrayContaining([
        'retained',
        'earliestSampledAt',
        'latestSampledAt',
        'meteredBytesTotal'
      ]),
      properties: expect.objectContaining({
        retained: { type: 'integer', minimum: 0 },
        earliestSampledAt: { type: 'string', format: 'date-time', nullable: true },
        latestSampledAt: { type: 'string', format: 'date-time', nullable: true },
        meteredBytesTotal: { type: 'integer', minimum: 0 }
      }),
      additionalProperties: false
    });
    expect(document.components.schemas.ObservabilityTrafficRollupCompactionMetrics).toMatchObject({
      required: expect.arrayContaining([
        'buckets',
        'samples',
        'earliestBucketStartAt',
        'latestBucketStartAt',
        'meteredBytesTotal',
        'byDimension'
      ]),
      properties: expect.objectContaining({
        buckets: { type: 'integer', minimum: 0 },
        samples: { type: 'integer', minimum: 0 },
        meteredBytesTotal: { type: 'integer', minimum: 0 },
        byDimension: expect.objectContaining({
          required: ['agent', 'forward-rule', 'xray-client']
        })
      }),
      additionalProperties: false
    });
    expect(document.components.schemas.ObservabilityTrafficRollupCompactionStorageMetrics).toMatchObject({
      required: expect.arrayContaining([
        'buckets',
        'samples',
        'earliestBucketStartAt',
        'latestBucketStartAt',
        'meteredBytesTotal'
      ]),
      properties: expect.objectContaining({
        buckets: { type: 'integer', minimum: 0 },
        samples: { type: 'integer', minimum: 0 },
        earliestBucketStartAt: { type: 'string', format: 'date-time', nullable: true },
        latestBucketStartAt: { type: 'string', format: 'date-time', nullable: true },
        meteredBytesTotal: { type: 'integer', minimum: 0 }
      }),
      additionalProperties: false
    });
    expect(document.components.schemas.ObservabilityAgentLogMetrics).toMatchObject({
      required: expect.arrayContaining([
        'retained',
        'contentBytes',
        'earliestObservedAt',
        'latestObservedAt',
        'byStream'
      ]),
      properties: expect.objectContaining({
        retained: { type: 'integer', minimum: 0 },
        contentBytes: { type: 'integer', minimum: 0 },
        byStream: expect.objectContaining({
          required: ['stdout', 'stderr', 'agent', 'runtime']
        })
      }),
      additionalProperties: false
    });
    expect(document.components.schemas.ObservabilityAgentLogStorageMetrics).toMatchObject({
      required: expect.arrayContaining(['retained', 'contentBytes', 'earliestObservedAt', 'latestObservedAt']),
      properties: expect.objectContaining({
        retained: { type: 'integer', minimum: 0 },
        contentBytes: { type: 'integer', minimum: 0 },
        earliestObservedAt: { type: 'string', format: 'date-time', nullable: true },
        latestObservedAt: { type: 'string', format: 'date-time', nullable: true }
      }),
      additionalProperties: false
    });
    expect(document.components.schemas.ObservabilityAgentLogArchiveMetrics).toMatchObject({
      required: expect.arrayContaining([
        'buckets',
        'chunks',
        'contentBytes',
        'earliestBucketStartAt',
        'latestBucketStartAt',
        'byStream'
      ]),
      properties: expect.objectContaining({
        buckets: { type: 'integer', minimum: 0 },
        chunks: { type: 'integer', minimum: 0 },
        contentBytes: { type: 'integer', minimum: 0 },
        byStream: expect.objectContaining({
          required: ['stdout', 'stderr', 'agent', 'runtime']
        })
      }),
      additionalProperties: false
    });
    expect(document.components.schemas.ObservabilityAgentLogArchiveStorageMetrics).toMatchObject({
      required: expect.arrayContaining([
        'buckets',
        'chunks',
        'contentBytes',
        'earliestBucketStartAt',
        'latestBucketStartAt'
      ]),
      properties: expect.objectContaining({
        buckets: { type: 'integer', minimum: 0 },
        chunks: { type: 'integer', minimum: 0 },
        contentBytes: { type: 'integer', minimum: 0 },
        earliestBucketStartAt: { type: 'string', format: 'date-time', nullable: true },
        latestBucketStartAt: { type: 'string', format: 'date-time', nullable: true }
      }),
      additionalProperties: false
    });
    expect(document.components.schemas.ObservabilityAuditMetrics).toMatchObject({
      required: expect.arrayContaining(['valid', 'checked', 'denied', 'quotaExceeded', 'writeFailures']),
      properties: expect.objectContaining({
        denied: { type: 'integer', minimum: 0 },
        quotaExceeded: { type: 'integer', minimum: 0 },
        writeFailures: { type: 'integer', minimum: 0 }
      })
    });
    expect(document.paths['/metrics'].get.responses?.['200']?.content?.['text/plain']?.schema).toMatchObject({
      type: 'string'
    });
    expect(resolveSchema(document, getJsonDataItemsSchema(document, '/api/v1/traffic-rollups'))).toMatchObject({
      required: expect.arrayContaining([
        'id',
        'dimension',
        'subjectId',
        'agentId',
        'periodKey',
        'monthlyResetDay',
        'ingressBytes',
        'egressBytes',
        'meteredBytes',
        'source'
      ]),
      properties: expect.objectContaining({
        dimension: { type: 'string', enum: ['agent', 'forward-rule', 'xray-client'] },
        accountingMode: { type: 'string', enum: ['both', 'single', 'ingress', 'egress'] },
        source: { type: 'string', enum: ['agent-telemetry'] }
      })
    });
    expect(resolveSchema(document, getJsonDataItemsSchema(document, '/api/v1/traffic-rollup-compactions'))).toMatchObject({
      required: expect.arrayContaining([
        'id',
        'granularity',
        'dimension',
        'subjectId',
        'subjectLabel',
        'agentId',
        'periodKey',
        'bucketStartAt',
        'bucketEndAt',
        'firstObservedAt',
        'lastObservedAt',
        'firstSampledAt',
        'lastSampledAt',
        'sampleCount',
        'ingressBytesTotal',
        'egressBytesTotal',
        'meteredBytesTotal',
        'compactedAt',
        'source'
      ]),
      properties: expect.objectContaining({
        granularity: { type: 'string', enum: ['day'] },
        dimension: { type: 'string', enum: ['agent', 'forward-rule', 'xray-client'] },
        sampleCount: { type: 'integer', minimum: 0 },
        meteredBytesTotal: { type: 'integer', minimum: 0 },
        source: { type: 'string', enum: ['retention-prune'] }
      }),
      additionalProperties: false
    });
    expect(resolveSchema(document, getJsonDataSchema(document, '/api/v1/traffic-rollups:export'))).toMatchObject({
      required: expect.arrayContaining(['format', 'contentType', 'filename', 'generatedAt', 'count', 'query', 'rollups', 'content']),
      properties: expect.objectContaining({
        format: { type: 'string', enum: ['jsonl', 'json'] },
        contentType: {
          type: 'string',
          enum: ['application/x-ndjson; charset=utf-8', 'application/json; charset=utf-8']
        },
        rollups: expect.objectContaining({
          type: 'array'
        })
      })
    });
    expect(resolveSchema(document, getJsonDataSchema(document, '/api/v1/traffic-rollup-compactions:export'))).toMatchObject({
      required: expect.arrayContaining([
        'format',
        'contentType',
        'filename',
        'generatedAt',
        'count',
        'query',
        'compactions',
        'content'
      ]),
      properties: expect.objectContaining({
        format: { type: 'string', enum: ['jsonl', 'json'] },
        count: { type: 'integer', minimum: 0 },
        query: expect.objectContaining({
          properties: expect.objectContaining({
            periodKey: { type: 'string', minLength: 1 }
          })
        }),
        compactions: expect.objectContaining({
          type: 'array',
          items: { $ref: '#/components/schemas/TrafficRollupCompaction' }
        })
      })
    });
    expect(document.components.schemas.AuditChainVerification.required).toEqual(
      expect.arrayContaining(['valid', 'checked'])
    );
    expect(document.components.schemas.AuditLogVerificationRequest.required).toEqual(['auditLogs']);
    const exportedAuditLogs = getSchemaProperty(document.components.schemas.AuditLogVerificationRequest, 'auditLogs');
    expect(resolveSchema(document, exportedAuditLogs.items ?? {})).toEqual(document.components.schemas.AuditLog);
    expect(document.components.schemas.ProxyProviderConfig.required).toEqual(
      expect.arrayContaining(['id', 'name', 'externalSubscriptionId', 'filter', 'processMode', 'overrideRule'])
    );
    expect(resolveSchema(document, getJsonDataItemsSchema(document, '/api/v1/subscription-export-profiles'))).toMatchObject({
      required: expect.arrayContaining([
        'id',
        'name',
        'client',
        'sourceIds',
        'outputFormats',
        'proxyGroups',
        'includeTrafficHeaders'
      ])
    });
    expect(document.components.schemas.SubscriptionExportFile.required).toEqual(
      expect.arrayContaining([
        'id',
        'subscriptionClientId',
        'subId',
        'name',
        'templateName',
        'selectedProviderIds',
        'formats',
        'accessTokenPreview'
      ])
    );
    expect(document.components.schemas.AgentInstallCommand.required).toEqual(
      expect.arrayContaining(['agentId', 'command', 'expiresAt', 'installToken', 'masterEndpoint', 'scriptUrl'])
    );
    expect(document.components.schemas.AgentInstallCommandRequest.allOf).toBeUndefined();
    expect(document.components.schemas.AgentInstallCommandRequest.properties).not.toHaveProperty('hostName');
    expect(document.components.schemas.AgentInstallCommandRequest.properties).toEqual(
      expect.objectContaining({
        installProfile: expect.objectContaining({ type: 'array' }),
        publicBaseUrl: expect.objectContaining({ type: 'string' })
      })
    );
    expect(document.paths['/api/v1/agents/install-command'].post.responses).toHaveProperty('409');
  });

  it('keeps REST task schemas aligned with OU-UI domain operations and statuses', () => {
    const document = loadOpenApi();
    const schemas = document.components.schemas;

    expect(schemas.CreateTaskRequest.required).toEqual(
      expect.arrayContaining(['operation', 'targetId', 'targetLabel', 'summary'])
    );
    expect(resolveSchema(document, getSchemaProperty(schemas.CreateTaskRequest, 'operation')).enum).toEqual(
      expect.arrayContaining(['agent.deploy', 'forward.apply', 'permission.grant', 'subscription.profile.upsert'])
    );
    expect(resolveSchema(document, getSchemaProperty(schemas.CreateTaskRequest, 'operation')).enum).toEqual(
      expect.arrayContaining(['tunnel.create', 'tunnel.update', 'tunnel.redeploy'])
    );
    expect(document.paths).not.toHaveProperty('/api/v1/tunnels');
    expect(document.components.schemas.ControlPlaneSnapshot.required).not.toContain('tunnels');
    expect(document.components.schemas.ControlPlaneSnapshot.properties).not.toHaveProperty('tunnels');
    expect(document.components.schemas.ControlPlaneSnapshot.required).toContain('customers');
    expect(getSchemaProperty(document.components.schemas.ControlPlaneSnapshot, 'customers').items?.$ref).toBe(
      '#/components/schemas/CustomerReadModel'
    );
    expect(getJsonDataItemsSchema(document, '/api/v1/customers').$ref).toBe('#/components/schemas/CustomerReadModel');
    expect(schemas.CustomerReadModel.required).toEqual(
      expect.arrayContaining([
        'id',
        'name',
        'status',
        'sourceKinds',
        'customerNodeCount',
        'subscriptionClientCount',
        'forwardRuleCount',
        'usedTrafficBytes',
        'trafficLimitBytes'
      ])
    );
    expect(resolveSchema(document, getSchemaProperty(schemas.CustomerReadModel, 'status')).enum).toEqual([
      'active',
      'limited',
      'expired'
    ]);
    expect(resolveSchema(document, getSchemaProperty(schemas.TaskMetadata, 'type')).enum).toEqual(['port-forward']);
    expect(resolveSchema(document, getSchemaProperty(schemas.CreateTaskRequest, 'permissionChange'))).toMatchObject({
      required: ['subjectType', 'subjectId', 'resourceType', 'resourceId', 'permissions']
    });
    expect(resolveSchema(document, getSchemaProperty(schemas.CreateTaskRequest, 'riskConfirmation'))).toMatchObject({
      required: ['operation', 'targetId']
    });
    expect(resolveSchema(document, getSchemaProperty(schemas.CreateTaskRequest, 'metadata'))).toMatchObject({
      type: 'object',
      additionalProperties: true
    });
    expect(resolveSchema(document, getSchemaProperty(schemas.DeployTask, 'metadata'))).toMatchObject({
      type: 'object',
      additionalProperties: true
    });
    expect(getSchemaProperty(schemas.TaskMetadata, 'listenPort')).toMatchObject({
      minimum: 1,
      maximum: 65535
    });
    expect(getSchemaProperty(schemas.TaskMetadata, 'agentIds')).toMatchObject({
      minItems: 1
    });
    expect(getSchemaProperty(schemas.TaskMetadata, 'ownerName')).toMatchObject({
      minLength: 1,
      maxLength: 160
    });
    expect(getSchemaProperty(schemas.TaskMetadata, 'enabled')).toMatchObject({
      type: 'boolean'
    });
    expect(getSchemaProperty(schemas.TaskMetadata, 'xrayGuardrailAutomatic')).toMatchObject({
      type: 'boolean'
    });
    expect(getSchemaProperty(schemas.TaskMetadata, 'xrayGuardrailAction')).toMatchObject({
      enum: ['disable', 'resume']
    });
    expect(getSchemaProperty(schemas.TaskMetadata, 'xrayGuardrailPolicyId')).toMatchObject({
      type: 'string',
      minLength: 1,
      maxLength: 255
    });
    expect(getSchemaProperty(schemas.TaskMetadata, 'xrayGuardrailPolicyScope')).toMatchObject({
      enum: ['customer-node']
    });
    expect(getSchemaProperty(schemas.TaskMetadata, 'xrayGuardrailObservedAt')).toMatchObject({
      type: 'string',
      format: 'date-time'
    });
    expect(getSchemaProperty(schemas.TaskMetadata, 'xrayGuardrailTriggerKind')).toMatchObject({
      enum: ['agent-event', 'task']
    });
    expect(getSchemaProperty(schemas.TaskMetadata, 'xrayGuardrailTriggerId')).toMatchObject({
      type: 'string',
      minLength: 1,
      maxLength: 255
    });
    expect(getSchemaProperty(schemas.TaskMetadata, 'xrayGuardrailReason')).toMatchObject({
      type: 'string',
      minLength: 1,
      maxLength: 160
    });
    expect(getSchemaProperty(schemas.TaskMetadata, 'monthlyTrafficGb')).toMatchObject({
      type: 'integer',
      minimum: 0
    });
    expect(getSchemaProperty(schemas.TaskMetadata, 'trafficAccountingMode')).toMatchObject({
      enum: ['both', 'single', 'ingress', 'egress']
    });
    expect(getSchemaProperty(schemas.TaskMetadata, 'billingDirection')).toMatchObject({
      enum: ['both', 'single', 'ingress', 'egress']
    });
    expect(getSchemaProperty(schemas.TaskMetadata, 'monthlyResetDay')).toMatchObject({
      type: 'integer',
      minimum: 1,
      maximum: 31
    });
    expect(getSchemaProperty(schemas.TaskMetadata, 'currentUsedTrafficGb')).toMatchObject({
      type: 'number',
      minimum: 0
    });
    expect(getSchemaProperty(schemas.TaskMetadata, 'expiresAt')).toMatchObject({
      type: 'string',
      format: 'date-time'
    });
    expect(getSchemaProperty(schemas.TaskMetadata, 'pingTarget')).toMatchObject({
      type: 'string',
      minLength: 1,
      maxLength: 255
    });
    expect(getSchemaProperty(schemas.TaskMetadata, 'pingIntervalSeconds')).toMatchObject({
      enum: [30]
    });
    expect(getSchemaProperty(schemas.TaskMetadata, 'xrayProtocol')).toMatchObject({
      enum: ['vmess', 'vless', 'trojan', 'shadowsocks']
    });
    expect(getSchemaProperty(schemas.TaskMetadata, 'realityPublicKey')).toMatchObject({
      type: 'string',
      maxLength: 255
    });
    expect(getSchemaProperty(schemas.TaskMetadata, 'realityPrivateKey')).toMatchObject({
      type: 'string',
      maxLength: 255
    });
    expect(getSchemaProperty(schemas.TaskMetadata, 'realityTarget')).toMatchObject({
      type: 'string',
      maxLength: 255
    });
    expect(getSchemaProperty(schemas.TaskMetadata, 'realityShortId')).toMatchObject({
      type: 'string',
      maxLength: 32
    });
    expect(getSchemaProperty(schemas.TaskMetadata, 'kind')).toMatchObject({
      enum: expect.arrayContaining(['clash', 'mihomo-provider', 'v2ray-uri', 'sing-box'])
    });
    expect(getSchemaProperty(schemas.TaskMetadata, 'dedupeKey')).toMatchObject({
      enum: ['server-port', 'uuid', 'name-region']
    });
    expect(getSchemaProperty(schemas.TaskMetadata, 'formats').items).toMatchObject({
      enum: ['plain', 'json', 'clash', 'mihomo', 'sing-box']
    });
    expect(getSchemaProperty(schemas.TaskMetadata, 'outputFormats').items).toMatchObject({
      enum: ['uri', 'v2ray', 'clash', 'mihomo', 'sing-box']
    });
    expect(getSchemaProperty(schemas.TaskMetadata, 'installProfile')).toMatchObject({
      minItems: 5,
      maxItems: 5,
      uniqueItems: true
    });
    expect(getSchemaProperty(schemas.TaskMetadata, 'installProfile').items).toMatchObject({
      enum: ['host-agent', 'xray', 'port-forwarding', 'telemetry', 'command-channel']
    });
    expect(getSchemaProperty(schemas.TaskMetadata, 'registrationVersion')).toMatchObject({
      type: 'string',
      maxLength: 80
    });
    expect(getSchemaProperty(schemas.TaskMetadata, 'registrationPlatform')).toMatchObject({
      type: 'string',
      maxLength: 160
    });
    expect(getSchemaProperty(schemas.TaskMetadata, 'registrationCapabilities').items).toMatchObject({
      enum: ['host-agent', 'xray', 'port-forwarding', 'telemetry', 'command-channel']
    });
    expect(schemas.ResourcePermission.enum).toEqual(['read', 'operate', 'configure', 'grant']);
    expect(schemas.TaskStatus.enum).toEqual(
      expect.arrayContaining(['queued', 'running', 'retrying', 'succeeded', 'failed', 'rolled_back', 'canceled'])
    );
    expect(schemas.CommandOutboxStatus.enum).toEqual(
      expect.arrayContaining(['pending', 'dispatched', 'acknowledged', 'completed', 'failed', 'expired', 'dead_letter'])
    );
    expect(schemas.AuditOperation.oneOf?.[1].enum).toEqual(
      expect.arrayContaining([
        'operator.session.issue',
        'operator.session.revoke',
        'operator.session.expire',
        'agent.poll',
        'agent.events',
        'operator.auth',
        'agent.credential.issue',
        'agent.credential.revoke',
        'agent.credential.rotate'
      ])
    );
  });

  it('keeps Agent command and event schemas aligned with Universal Agent v1', () => {
    const document = loadOpenApi();
    const schemas = document.components.schemas;
    const issueCommand = document.paths['/api/v1/agents/{agentId}/commands'].post;

    expect(schemas.AgentCommandEnvelope.required).toEqual(
      expect.arrayContaining([
        'type',
        'commandId',
        'taskId',
        'agentId',
        'seq',
        'requestId',
        'issuedAt',
        'deadlineAt',
        'payload'
      ])
    );
    expect(issueCommand.parameters?.map((parameter) => parameter.$ref)).toEqual(
      expect.arrayContaining([
        '#/components/parameters/XRequestId',
        '#/components/parameters/IdempotencyKey',
        '#/components/parameters/Actor',
        '#/components/parameters/OperatorGroupId',
        '#/components/parameters/ResourceGroupId'
      ])
    );
    expect(schemas.AgentCommandType.enum).toEqual(['apply', 'rollback', 'reload', 'health', 'telemetry']);
    expect(schemas.ApplyCommandPayload.properties?.rollbackTaskId).toMatchObject({
      type: 'string'
    });
    expect(schemas.AgentEventType.enum).toEqual(['ack', 'heartbeat', 'result', 'log_chunk', 'telemetry_sample']);
    expect(schemas.ResultEventPayload.required).toEqual(['status']);
    expect(schemas.LogChunkEventPayload.required).toEqual(['chunkSeq', 'stream', 'content']);
    expect(schemas.TelemetrySampleEventPayload.properties).toMatchObject({
      loadAverage1m: { type: 'number', minimum: 0 },
      loadAverage5m: { type: 'number', minimum: 0 },
      loadAverage15m: { type: 'number', minimum: 0 },
      monthlyIngressBytes: { type: 'number', minimum: 0 },
      monthlyEgressBytes: { type: 'number', minimum: 0 },
      trafficAccountingMode: { type: 'string', enum: ['both', 'single', 'ingress', 'egress'] },
      monthlyResetDay: { type: 'integer', minimum: 1, maximum: 31 },
      manualUsedTrafficBytes: { type: 'number', minimum: 0 },
      trafficBillingPeriod: { type: 'string', pattern: '^\\d{4}-\\d{2}-reset-\\d{2}$' },
      latencyStatus: { type: 'string', enum: ['green', 'yellow', 'red'] },
      cpuModel: { type: 'string', minLength: 1, maxLength: 160 },
      trafficTelemetrySource: { type: 'string', enum: ['agent'] },
      hardwareTelemetrySource: { type: 'string', enum: ['agent'] },
      runtimeServices: {
        type: 'array',
        items: { $ref: '#/components/schemas/AgentRuntimeServiceHealth' }
      },
      hostGuardrailStoppedUnits: {
        type: 'array',
        items: { type: 'string', minLength: 1, maxLength: 200 }
      },
      hostGuardrailRestoredUnits: {
        type: 'array',
        items: { type: 'string', minLength: 1, maxLength: 200 }
      },
      xrayClientCounters: {
        type: 'array',
        items: expect.objectContaining({
          type: 'object',
          properties: expect.objectContaining({
            inboundId: { type: 'string', minLength: 1 },
            clientEmail: { type: 'string', minLength: 1 },
            uplinkBytes: { type: 'number', minimum: 0 },
            downlinkBytes: { type: 'number', minimum: 0 },
            usedTrafficBytes: { type: 'number', minimum: 0 },
            monthlyResetDay: { type: 'integer', minimum: 1, maximum: 31 },
            runtimeDisabledByPolicy: { type: 'boolean' },
            guardrailReason: { type: 'string', minLength: 1, maxLength: 160 },
            source: { type: 'string', enum: ['xray-stats', 'xray-guardrail', 'agent'] },
            trafficBillingPeriod: { type: 'string', pattern: '^\\d{4}-\\d{2}-reset-\\d{2}$' }
          })
        })
      },
      forwardingCounters: {
        type: 'array',
        items: expect.objectContaining({
          type: 'object',
          properties: expect.objectContaining({
            ruleId: { type: 'string', minLength: 1 },
            serviceName: { type: 'string', minLength: 1 },
            inboundBytes: { type: 'number', minimum: 0 },
            outboundBytes: { type: 'number', minimum: 0 },
            source: { type: 'string', enum: ['agent', 'nftables', 'gost'] },
            trafficBillingPeriod: { type: 'string', pattern: '^\\d{4}-\\d{2}-reset-\\d{2}$' }
          })
        })
      },
      forwardingGuardrails: {
        type: 'array',
        items: expect.objectContaining({
          type: 'object',
          required: ['ruleId'],
          properties: expect.objectContaining({
            ruleId: { type: 'string', minLength: 1 },
            quotaBytes: { type: 'number', minimum: 0 },
            billedTrafficBytes: { type: 'number', minimum: 0 },
            quotaExceeded: { type: 'boolean' },
            runtimeDisabledByPolicy: { type: 'boolean' },
            guardrailReason: { type: 'string', minLength: 1, maxLength: 160 },
            trafficBillingPeriod: { type: 'string', pattern: '^\\d{4}-\\d{2}-reset-\\d{2}$' }
          })
        })
      }
    });
    expect(schemas.RuntimeConfigRevision.required).toEqual(
      expect.arrayContaining(['id', 'taskId', 'artifactUri', 'checksum', 'signature', 'preflightPlanId', 'snapshotBeforeId'])
    );
    expect(schemas.RuntimePreflightPlan.required).toEqual(
      expect.arrayContaining(['id', 'taskId', 'configRevisionId', 'checks'])
    );
    expect(schemas.RuntimeSnapshot.required).toEqual(
      expect.arrayContaining(['id', 'taskId', 'targetId', 'agentId', 'moduleKind', 'reason', 'status'])
    );
  });
});
