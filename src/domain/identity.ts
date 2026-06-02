export type UserRole = 'owner' | 'admin' | 'operator' | 'viewer' | 'tenant';

export type AccessScope = 'global' | 'agent' | 'node' | 'tunnel-group' | 'user-group';

export type UserAccount = {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  groupIds: string[];
  status: 'active' | 'disabled' | 'pending';
};

export type UserGroup = {
  id: string;
  name: string;
  scope: AccessScope;
  memberIds: string[];
};
