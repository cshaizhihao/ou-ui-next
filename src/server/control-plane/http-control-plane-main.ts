import type { AddressInfo } from 'node:net';
import { createBootstrapPermissionGrants } from './bootstrap-permissions';
import { createServiceBackedControlPlane } from './create-service-backed-control-plane';
import { resolveHttpControlPlaneRuntimeConfig } from './http-control-plane-runtime-config';

const config = resolveHttpControlPlaneRuntimeConfig(process.env);
const { host, port, storage } = config;

const bootstrapOperatorIdentity =
  Object.values(config.auth?.operatorTokens ?? {})[0] ??
  {
    actor: process.env.OU_UI_CONTROL_PLANE_OPERATOR_ACTOR ?? 'admin',
    operatorGroupId: process.env.OU_UI_CONTROL_PLANE_OPERATOR_GROUP_ID ?? 'owner',
    resourceGroupId: process.env.OU_UI_CONTROL_PLANE_RESOURCE_GROUP_ID ?? 'group-premium'
  };
const bootstrapPermissionGrants = createBootstrapPermissionGrants(bootstrapOperatorIdentity);
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
