import type { PermissionGrant } from '../../domain';

export type BootstrapOperatorIdentity = {
  actor: string;
  operatorGroupId?: string;
  resourceGroupId?: string;
};

const bootstrapPermissions: PermissionGrant['permissions'] = ['read', 'operate', 'configure', 'grant'];

export function createBootstrapPermissionGrants(operatorIdentity: BootstrapOperatorIdentity): PermissionGrant[] {
  const operatorGroupId = operatorIdentity.operatorGroupId ?? 'owner';
  const resourceId = operatorIdentity.resourceGroupId ?? 'group-premium';

  return [
    {
      id: `grant-bootstrap-user-${operatorGroupId}-${operatorIdentity.actor}`,
      subjectType: 'user',
      subjectId: operatorIdentity.actor,
      resourceType: 'tunnel-group',
      resourceId,
      permissions: [...bootstrapPermissions],
      grantedBy: 'system:bootstrap',
      reason: 'bootstrap owner user permissions'
    },
    {
      id: `grant-bootstrap-user-${operatorGroupId}-${operatorIdentity.actor}-agent`,
      subjectType: 'user',
      subjectId: operatorIdentity.actor,
      resourceType: 'agent',
      resourceId,
      permissions: [...bootstrapPermissions],
      grantedBy: 'system:bootstrap',
      reason: 'bootstrap Agent enrollment permissions'
    },
    {
      id: `grant-bootstrap-group-${operatorGroupId}-${resourceId}`,
      subjectType: 'group',
      subjectId: operatorGroupId,
      resourceType: 'tunnel-group',
      resourceId,
      permissions: [...bootstrapPermissions],
      grantedBy: 'system:bootstrap',
      reason: 'bootstrap owner group permissions'
    },
    {
      id: `grant-bootstrap-group-${operatorGroupId}-${resourceId}-agent`,
      subjectType: 'group',
      subjectId: operatorGroupId,
      resourceType: 'agent',
      resourceId,
      permissions: [...bootstrapPermissions],
      grantedBy: 'system:bootstrap',
      reason: 'bootstrap owner Agent enrollment permissions'
    }
  ];
}
