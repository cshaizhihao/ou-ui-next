import { useQuery } from '@tanstack/react-query';
import type { OperatorSessionSummary } from '../../domain';
import { useApi } from './use-api';

export const operatorSessionsQueryKey = ['control-plane', 'operator-sessions', 'v1'] as const;

export function useOperatorSessions(enabled: boolean) {
  const api = useApi();

  return useQuery({
    queryKey: operatorSessionsQueryKey,
    enabled,
    retry: false,
    queryFn: async (): Promise<OperatorSessionSummary[]> => api.listOperatorSessions()
  });
}
