import type { AddressInfo } from 'node:net';
import {
  createHttpRuntimeMetrics,
  createJsonConsoleControlPlaneLogger
} from '../../services/api/http-control-plane-server';
import { createSystemAlertWebhookNotifier } from '../../services/api/system-alert-notifications';
import {
  createRuntimeControlPlaneAuditAnchorSink,
  type ControlPlaneAuditAnchorSinkErrorHandler
} from './audit-anchor-sink';
import { createRuntimeControlPlaneArchiveSink } from './archive-sink';
import { createBootstrapPermissionGrants } from './bootstrap-permissions';
import { createServiceBackedControlPlane } from './create-service-backed-control-plane';
import type { ControlPlaneArchiveSinkErrorHandler } from './control-plane-service';
import { resolveHttpControlPlaneRuntimeConfig } from './http-control-plane-runtime-config';

const config = resolveHttpControlPlaneRuntimeConfig(process.env);
const { host, port, storage } = config;
const logger = createJsonConsoleControlPlaneLogger();
const runtimeMetrics = createHttpRuntimeMetrics();
const externalArchiveSink = createRuntimeControlPlaneArchiveSink(config.externalArchiveSink, {
  onWebhookDelivery: (event) => logger.write(event),
  onObjectStorageDelivery: (event) => logger.write(event)
});
const auditAnchorSink = createRuntimeControlPlaneAuditAnchorSink(config.externalArchiveSink, {
  onWebhookDelivery: (event) => logger.write(event),
  onObjectStorageDelivery: (event) => logger.write(event)
});
const onExternalArchiveSinkError: ControlPlaneArchiveSinkErrorHandler = (error, batch) => {
  logger.write({
    event: 'external_archive.sink_failed',
    kind: batch.kind,
    recordCount: batch.records.length,
    errorMessage: error instanceof Error ? error.message : String(error)
  });
};
const externalArchiveSinkOptions = externalArchiveSink
  ? {
      archiveSink: externalArchiveSink,
      onArchiveSinkError: onExternalArchiveSinkError
    }
  : {};
const onAuditAnchorSinkError: ControlPlaneAuditAnchorSinkErrorHandler = (error, batch) => {
  logger.write({
    event: 'audit_anchor.sink_failed',
    recordCount: batch.auditLogs.length,
    errorMessage: error instanceof Error ? error.message : String(error)
  });
};
const auditAnchorSinkOptions = auditAnchorSink
  ? {
      auditAnchorSink,
      onAuditAnchorSinkError
    }
  : {};
const systemAlertNotificationChannels = config.systemAlertWebhook
  ? config.systemAlertWebhook.targets.map((target) => ({
      id: target.id,
      label: target.label,
      notifier: createSystemAlertWebhookNotifier({
        url: target.url,
        timeoutMs: config.systemAlertWebhook?.timeoutMs,
        bearerToken: config.systemAlertWebhook?.bearerToken,
        egressPolicy: config.systemAlertWebhook?.egress,
        onDelivery: (event) => logger.write({ ...event, channelId: target.id, channelLabel: target.label })
      })
    }))
  : [];
const systemAlertNotificationDeliveryOptions = config.systemAlertWebhook
  ? {
      systemAlertNotificationRetry: {
        retryDelayMs: config.systemAlertWebhook.retryDelayMs,
        maxAttempts: config.systemAlertWebhook.maxAttempts,
        maxDeliveriesPerSweep: config.systemAlertWebhook.maxDeliveriesPerSweep
      },
      systemAlertNotificationRetryJob: {
        enabled: true,
        intervalMs: config.systemAlertWebhook.retrySweepIntervalMs,
        maxDeliveries: config.systemAlertWebhook.maxDeliveriesPerSweep,
        onSweep: (result: { attempted: number; delivered: number; failed: number; deadLettered: number }) => {
          if (result.attempted > 0) {
            logger.write({
              event: 'system_alert.webhook.retry_sweep',
              ...result
            });
          }
        }
      }
    }
  : {};

const bootstrapOperatorIdentity =
  Object.values(config.auth?.operatorTokens ?? {})[0] ??
  {
    actor: process.env.OU_UI_CONTROL_PLANE_OPERATOR_ACTOR ?? 'local-operator',
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
        subscriptionExportProfiles: [],
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
        logger,
        runtimeMetrics,
        agentLogRetention: config.agentLogRetention,
        trafficRollupRetention: config.trafficRollupRetention,
        ...externalArchiveSinkOptions,
        ...auditAnchorSinkOptions,
        ...(systemAlertNotificationChannels.length > 0 ? { systemAlertNotificationChannels } : {}),
        ...systemAlertNotificationDeliveryOptions,
        operatorAuthFailureThrottle: config.operatorAuthFailureThrottle,
        commandTimeoutSweep: config.commandTimeoutSweep,
        subscriptionSourceEgress: config.subscriptionSourceEgress,
        subscriptionSourceProviderBudget: config.subscriptionSourceProviderBudget,
        subscriptionSourceSyncBudget: config.subscriptionSourceSyncBudget,
        seed: {
          tasks: [],
          auditLogs: [],
          forwardRules: [],
          permissionGrants: bootstrapPermissionGrants
        },
        ...(emptyInventory ? { inventory: emptyInventory } : {})
      }
    : storage.type === 'sqlite'
      ? {
          storage: 'sqlite',
          databaseFilePath: storage.databaseFilePath,
          ...(storage.legacyStateFilePath ? { legacyStateFilePath: storage.legacyStateFilePath } : {}),
          auth: config.auth,
          logger,
          runtimeMetrics,
          agentLogRetention: config.agentLogRetention,
          trafficRollupRetention: config.trafficRollupRetention,
          ...externalArchiveSinkOptions,
          ...auditAnchorSinkOptions,
          ...(systemAlertNotificationChannels.length > 0 ? { systemAlertNotificationChannels } : {}),
          ...systemAlertNotificationDeliveryOptions,
          operatorAuthFailureThrottle: config.operatorAuthFailureThrottle,
          commandTimeoutSweep: config.commandTimeoutSweep,
          subscriptionSourceEgress: config.subscriptionSourceEgress,
          subscriptionSourceProviderBudget: config.subscriptionSourceProviderBudget,
          subscriptionSourceSyncBudget: config.subscriptionSourceSyncBudget,
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
        logger,
        runtimeMetrics,
        agentLogRetention: config.agentLogRetention,
        trafficRollupRetention: config.trafficRollupRetention,
        ...externalArchiveSinkOptions,
        ...auditAnchorSinkOptions,
        ...(systemAlertNotificationChannels.length > 0 ? { systemAlertNotificationChannels } : {}),
        ...systemAlertNotificationDeliveryOptions,
        operatorAuthFailureThrottle: config.operatorAuthFailureThrottle,
        commandTimeoutSweep: config.commandTimeoutSweep,
        subscriptionSourceEgress: config.subscriptionSourceEgress,
        subscriptionSourceProviderBudget: config.subscriptionSourceProviderBudget,
        subscriptionSourceSyncBudget: config.subscriptionSourceSyncBudget,
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
