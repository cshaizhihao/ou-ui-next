import { useQuery } from '@tanstack/react-query';
import { useApi } from './use-api';
import type { AgentLogChunk, ApiBoundaryDescriptor } from './control-plane-api';
import type {
  Agent,
  AuditLog,
  CustomerReadModel,
  DeployTask,
  ForwardRule,
  ManagedNode,
  PermissionGrant,
  ProxyProviderConfig,
  QuotaPolicy,
  RateLimitPolicy,
  RoutingPolicy,
  RuntimeConfigRevision,
  RuntimePreflightPlan,
  RuntimeSnapshot,
  SubscriptionBundle,
  SubscriptionClientIdentity,
  SubscriptionExportFile,
  SubscriptionExportProfile,
  SubscriptionInventoryNode,
  SubscriptionSource,
  SystemAlert,
  TrafficRollup,
  TuningProfile,
  XrayInbound
} from '../../domain';

export const controlPlaneSnapshotQueryKey = ['control-plane', 'snapshot', 'v1'] as const;

export type ControlPlaneSnapshot = {
  apiBoundary: ApiBoundaryDescriptor;
  agents: Agent[];
  customers: CustomerReadModel[];
  nodes: ManagedNode[];
  inbounds: XrayInbound[];
  subscriptionSources: SubscriptionSource[];
  subscriptionInventoryNodes: SubscriptionInventoryNode[];
  subscriptionBundles: SubscriptionBundle[];
  subscriptionClients: SubscriptionClientIdentity[];
  subscriptionExportProfiles: SubscriptionExportProfile[];
  proxyProviders: ProxyProviderConfig[];
  subscriptionExportFiles: SubscriptionExportFile[];
  forwardRules: ForwardRule[];
  quotaPolicies: QuotaPolicy[];
  rateLimitPolicies: RateLimitPolicy[];
  permissionGrants: PermissionGrant[];
  routingPolicies: RoutingPolicy[];
  tuningProfiles: TuningProfile[];
  tasks: DeployTask[];
  configRevisions: RuntimeConfigRevision[];
  preflightPlans: RuntimePreflightPlan[];
  runtimeSnapshots: RuntimeSnapshot[];
  trafficRollups: TrafficRollup[];
  systemAlerts: SystemAlert[];
  agentLogChunks: AgentLogChunk[];
  auditLogs: AuditLog[];
};

export function useControlPlaneSnapshot(enabled: boolean) {
  const api = useApi();

  return useQuery({
    queryKey: controlPlaneSnapshotQueryKey,
    enabled,
    retry: false,
    queryFn: async (): Promise<ControlPlaneSnapshot> => {
      const [
        apiBoundary,
        agents,
        customers,
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
        tasks,
        configRevisions,
        preflightPlans,
        runtimeSnapshots,
        trafficRollups,
        systemAlerts,
        agentLogChunks,
        auditLogs
      ] = await Promise.all([
        api.getApiBoundary(),
        api.listAgents(),
        api.listCustomers(),
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
        api.listTasks(),
        api.listConfigRevisions(),
        api.listPreflightPlans(),
        api.listRuntimeSnapshots(),
        api.listTrafficRollups(),
        api.listSystemAlerts(),
        api.listAgentLogChunks({ limit: 200 }),
        api.listAuditLogs()
      ]);

      return {
        apiBoundary,
        agents,
        customers,
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
        tasks,
        configRevisions,
        preflightPlans,
        runtimeSnapshots,
        trafficRollups,
        systemAlerts,
        agentLogChunks,
        auditLogs
      };
    }
  });
}
