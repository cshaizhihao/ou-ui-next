export type RoutingPolicy = {
  id: string;
  name: string;
  enabled: boolean;
  match: string;
  action: 'direct' | 'proxy' | 'reject';
  priority: number;
  targetGroup: string;
  hitCount: number;
  riskLevel: 'low' | 'medium' | 'high';
};
