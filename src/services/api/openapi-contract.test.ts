import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';

type SchemaObject = {
  $ref?: string;
  additionalProperties?: boolean;
  enum?: string[];
  items?: SchemaObject;
  maximum?: number;
  minimum?: number;
  minItems?: number;
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

describe('OpenAPI v1 contract', () => {
  it('documents the minimum production control-plane and agent endpoints', () => {
    const document = loadOpenApi();

    expect(document.openapi).toBe('3.1.0');
    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining([
        '/api/v1/tasks',
        '/api/v1/tasks/{taskId}',
        '/api/v1/tasks/{taskId}/transition',
        '/api/v1/boundary',
        '/api/v1/snapshot',
        '/api/v1/audit-logs',
        '/api/v1/audit-logs:verify',
        '/api/v1/agents',
        '/api/v1/agents/install-command',
        '/api/v1/nodes',
        '/api/v1/inbounds',
        '/api/v1/subscription-sources',
        '/api/v1/subscription-bundles',
        '/api/v1/tunnels',
        '/api/v1/forward-rules',
        '/api/v1/quota-policies',
        '/api/v1/rate-limit-policies',
        '/api/v1/permission-grants',
        '/api/v1/routing-policies',
        '/api/v1/tuning-profiles',
        '/api/v1/command-outbox',
        '/api/v1/config-revisions',
        '/api/v1/preflight-plans',
        '/api/v1/runtime-snapshots',
        '/api/v1/agents/{agentId}/commands',
        '/agent/v1/poll',
        '/agent/v1/events',
        '/events/v1/tasks'
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
  });

  it('documents the HTTP control-plane runtime routes implemented by the server adapter', () => {
    const document = loadOpenApi();

    expect(document.paths['/api/v1/boundary'].get).toBeDefined();
    expect(document.paths['/api/v1/snapshot'].get).toBeDefined();
    expect(document.paths['/api/v1/agents'].get).toBeDefined();
    expect(document.paths['/api/v1/command-outbox'].get).toBeDefined();
    expect(document.paths['/api/v1/config-revisions'].get).toBeDefined();
    expect(document.paths['/api/v1/preflight-plans'].get).toBeDefined();
    expect(document.paths['/api/v1/runtime-snapshots'].get).toBeDefined();
    expect(document.paths['/api/v1/audit-logs'].get).toBeDefined();
    expect(document.paths['/api/v1/audit-logs:verify'].get).toBeDefined();
    expect(resolveSchema(document, getJsonDataItemsSchema(document, '/api/v1/agents'))).toMatchObject({
      required: ['id']
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
        'configRevisions',
        'preflightPlans',
        'runtimeSnapshots',
        'tasks',
        'auditLogs'
      ])
    );
    expect(document.components.schemas.AuditChainVerification.required).toEqual(
      expect.arrayContaining(['valid', 'checked'])
    );
    expect(document.components.schemas.AgentInstallCommand.required).toEqual(
      expect.arrayContaining(['agentId', 'command', 'expiresAt', 'installToken', 'masterEndpoint', 'scriptUrl'])
    );
  });

  it('keeps REST task schemas aligned with OU-UI domain operations and statuses', () => {
    const document = loadOpenApi();
    const schemas = document.components.schemas;

    expect(schemas.CreateTaskRequest.required).toEqual(
      expect.arrayContaining(['operation', 'targetId', 'targetLabel', 'summary'])
    );
    expect(resolveSchema(document, getSchemaProperty(schemas.CreateTaskRequest, 'operation')).enum).toEqual(
      expect.arrayContaining(['agent.deploy', 'forward.apply', 'permission.grant'])
    );
    expect(resolveSchema(document, getSchemaProperty(schemas.CreateTaskRequest, 'permissionChange'))).toMatchObject({
      required: ['subjectType', 'subjectId', 'resourceType', 'resourceId', 'permissions']
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
    expect(getSchemaProperty(schemas.TaskMetadata, 'installProfile')).toMatchObject({
      minItems: 6,
      maxItems: 6,
      uniqueItems: true
    });
    expect(getSchemaProperty(schemas.TaskMetadata, 'installProfile').items).toMatchObject({
      enum: ['probe', 'xray', 'flvx', 'forwarding', 'telemetry', 'command-channel']
    });
    expect(schemas.ResourcePermission.enum).toEqual(['read', 'operate', 'configure', 'grant']);
    expect(schemas.TaskStatus.enum).toEqual(
      expect.arrayContaining(['queued', 'running', 'retrying', 'succeeded', 'failed', 'rolled_back', 'canceled'])
    );
    expect(schemas.CommandOutboxStatus.enum).toEqual(
      expect.arrayContaining(['pending', 'dispatched', 'acknowledged', 'completed', 'failed', 'expired', 'dead_letter'])
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
