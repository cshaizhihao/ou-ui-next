import { useQuery } from '@tanstack/react-query';
import { useApi } from './use-api';
import type { ApiBoundaryDescriptor } from './control-plane-api';
import type {
  Agent,
  AuditLog,
  DeployTask,
  ForwardRule,
  ManagedNode,
  PermissionGrant,
  QuotaPolicy,
  RateLimitPolicy,
  RoutingPolicy,
  RuntimeConfigRevision,
  RuntimePreflightPlan,
  RuntimeSnapshot,
  SubscriptionBundle,
  SubscriptionClientIdentity,
  SubscriptionSource,
  Tunnel,
  TuningProfile,
  XrayInbound
} from '../../domain';

export const controlPlaneSnapshotQueryKey = ['control-plane', 'snapshot', 'v1'] as const;

export type ControlPlaneSnapshot = {
  apiBoundary: ApiBoundaryDescriptor;
  agents: Agent[];
  nodes: ManagedNode[];
  inbounds: XrayInbound[];
  subscriptionSources: SubscriptionSource[];
  subscriptionBundles: SubscriptionBundle[];
  subscriptionClients: SubscriptionClientIdentity[];
  tunnels: Tunnel[];
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
        nodes,
        inbounds,
        subscriptionSources,
        subscriptionBundles,
        subscriptionClients,
        tunnels,
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
        auditLogs
      ] = await Promise.all([
        api.getApiBoundary(),
        api.listAgents(),
        api.listNodes(),
        api.listInbounds(),
        api.listSubscriptionSources(),
        api.listSubscriptionBundles(),
        api.listSubscriptionClients(),
        api.listTunnels(),
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
        api.listAuditLogs()
      ]);

      return {
        apiBoundary,
        agents,
        nodes,
        inbounds,
        subscriptionSources,
        subscriptionBundles,
        subscriptionClients,
        tunnels,
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
        auditLogs
      };
    }
  });
}
