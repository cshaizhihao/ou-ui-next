export type TuningProfile = {
  id: string;
  name: string;
  enabled: boolean;
  target: 'kernel' | 'network' | 'runtime';
  parameters: Array<{ key: string; value: string; status: 'pending' | 'applied' | 'backend_required' }>;
  riskLevel: 'low' | 'medium' | 'high';
};
