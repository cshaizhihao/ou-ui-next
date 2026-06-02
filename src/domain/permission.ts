export type ResourcePermission = 'read' | 'operate' | 'configure' | 'grant';

export type TunnelGroup = {
  id: string;
  name: string;
  tunnelIds: string[];
};

export type PermissionGrant = {
  id: string;
  subjectType: 'user' | 'group';
  subjectId: string;
  resourceType: 'agent' | 'node' | 'tunnel' | 'tunnel-group' | 'subscription' | 'forward-rule';
  resourceId: string;
  permissions: ResourcePermission[];
  expiresAt?: string;
  grantedBy?: string;
  reason?: string;
  resourceVersion?: string;
  createdAt?: string;
  updatedAt?: string;
  revokedAt?: string;
  revokedBy?: string;
  revokedReason?: string;
};
