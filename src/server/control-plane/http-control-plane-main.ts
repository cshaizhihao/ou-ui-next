import type { AddressInfo } from 'node:net';
import type { PermissionGrant } from '../../domain';
import { createServiceBackedControlPlane } from './create-service-backed-control-plane';
import { resolveHttpControlPlaneRuntimeConfig } from './http-control-plane-runtime-config';

const config = resolveHttpControlPlaneRuntimeConfig(process.env);
const { host, port, storage } = config;

function createBootstrapPermissionGrants(): PermissionGrant[] {
  const operatorIdentity =
    Object.values(config.auth?.operatorTokens ?? {})[0] ??
    {
      actor: process.env.OU_UI_CONTROL_PLANE_OPERATOR_ACTOR ?? 'admin',
      operatorGroupId: process.env.OU_UI_CONTROL_PLANE_OPERATOR_GROUP_ID ?? 'owner',
      resourceGroupId: process.env.OU_UI_CONTROL_PLANE_RESOURCE_GROUP_ID ?? 'group-premium'
    };
  const operatorGroupId = operatorIdentity.operatorGroupId ?? 'owner';
  const resourceId = operatorIdentity.resourceGroupId ?? 'group-premium';

  return [
    {
      id: `grant-bootstrap-user-${operatorGroupId}-${operatorIdentity.actor}`,
      subjectType: 'user',
      subjectId: operatorIdentity.actor,
      resourceType: 'tunnel-group',
      resourceId,
      permissions: ['read', 'operate', 'configure', 'grant'],
      grantedBy: 'system:bootstrap',
      reason: 'bootstrap owner user permissions'
    },
    {
      id: `grant-bootstrap-group-${operatorGroupId}-${resourceId}`,
      subjectType: 'group',
      subjectId: operatorGroupId,
      resourceType: 'tunnel-group',
      resourceId,
      permissions: ['read', 'operate', 'configure', 'grant'],
      grantedBy: 'system:bootstrap',
      reason: 'bootstrap owner group permissions'
    }
  ];
}

const bootstrapPermissionGrants = createBootstrapPermissionGrants();
const initialState = config.initialState;
const emptyInventory =
  initialState === 'empty'
    ? {
        agents: [],
        nodes: [],
        inbounds: [],
        subscriptionSources: [],
        subscriptionInventoryNodes: [],
        subscriptionBundles: [],
        subscriptionClients: [],
        quotaPolicies: [],
        rateLimitPolicies: [],
        routingPolicies: [],
        tuningProfiles: []
      }
    : undefined;

const { server } = await createServiceBackedControlPlane(
  storage.type === 'file'
    ? {
        storage: 'file',
        stateFilePath: storage.stateFilePath,
        auth: config.auth,
        seed: {
          tasks: [],
          auditLogs: [],
          forwardRules: [],
          permissionGrants: bootstrapPermissionGrants
        },
        ...(emptyInventory ? { inventory: emptyInventory } : {})
      }
    : {
        storage: 'memory',
        auth: config.auth,
        seed: {
          tasks: [],
          auditLogs: [],
          forwardRules: [],
          permissionGrants: bootstrapPermissionGrants
        },
        ...(emptyInventory ? { inventory: emptyInventory } : {})
      }
);

await new Promise<void>((resolve) => {
  server.listen(port, host, resolve);
});

const address = server.address() as AddressInfo;
const url = `http://${address.address}:${address.port}`;

console.log(
  `OU-UI Next service-backed control plane listening at ${url} (${storage.type} storage, ${
    config.auth ? 'auth enabled' : 'auth disabled'
  })`
);

function shutdown(signal: NodeJS.Signals) {
  server.close((error) => {
    if (error) {
      console.error(`Failed to stop control plane after ${signal}:`, error);
      process.exitCode = 1;
    }

    process.exit();
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
