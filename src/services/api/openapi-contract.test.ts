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
        '/api/v1/config-revisions',
        '/api/v1/preflight-plans',
        '/api/v1/runtime-snapshots',
        '/api/v1/agents/{agentId}/commands',
        '/agent/v1/register',
        '/agent/v1/poll',
        '/agent/v1/events',
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
        fetchTimeoutSeconds: expect.objectContaining({ type: 'integer', minimum: 1 }),
        maxBodyBytes: expect.objectContaining({ type: 'integer', minimum: 1 }),
        syncLeaseOwnerId: expect.objectContaining({ type: 'string' }),
        syncLeaseExpiresAt: expect.objectContaining({ type: 'string', format: 'date-time' }),
        traffic: expect.objectContaining({
          $ref: '#/components/schemas/SubscriptionTrafficSnapshot'
        })
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
        'systemAlerts',
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
        kind: { type: 'string', enum: ['agent.telemetry_sampling_gap'] },
        severity: { type: 'string', enum: ['warning', 'critical'] },
        status: { type: 'string', enum: ['active'] },
        resourceType: { type: 'string', enum: ['agent'] }
      })
    });
    expect(resolveSchema(document, getJsonDataSchema(document, '/api/v1/observability-metrics'))).toMatchObject({
      required: expect.arrayContaining(['generatedAt', 'tasks', 'commandOutbox', 'agents', 'systemAlerts', 'audit']),
      properties: expect.objectContaining({
        tasks: expect.objectContaining({
          required: expect.arrayContaining(['total', 'active', 'failed', 'rollbacks', 'completionLatencyMs', 'byStatus'])
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
        audit: { $ref: '#/components/schemas/ObservabilityAuditMetrics' }
      })
    });
    expect(document.components.schemas.ObservabilityAuditMetrics).toMatchObject({
      required: expect.arrayContaining(['valid', 'checked', 'denied', 'quotaExceeded']),
      properties: expect.objectContaining({
        denied: { type: 'integer', minimum: 0 },
        quotaExceeded: { type: 'integer', minimum: 0 }
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
