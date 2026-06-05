export type OperatorSessionStatus = 'active' | 'revoked' | 'expired';

export type OperatorSessionSummary = {
  id: string;
  username: string;
  actor: string;
  operatorGroupId?: string;
  resourceGroupId?: string;
  status: OperatorSessionStatus;
  issuedAt: string;
  expiresAt: string;
  sourceIp: string;
  userAgent?: string;
  requestId: string;
  revokedAt?: string;
  revokedBy?: string;
  revokedReason?: string;
};

export type OperatorSessionRevokeRequest = {
  reason: string;
};
