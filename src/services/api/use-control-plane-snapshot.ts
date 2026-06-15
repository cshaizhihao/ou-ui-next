import { useQuery } from '@tanstack/react-query';
import { useApi } from './use-api';
import type { ControlPlaneSnapshotReadModel } from './control-plane-api';

export const controlPlaneSnapshotQueryKey = ['control-plane', 'snapshot', 'v1'] as const;

export type ControlPlaneSnapshot = ControlPlaneSnapshotReadModel;

export function useControlPlaneSnapshot(enabled: boolean) {
  const api = useApi();

  return useQuery({
    queryKey: controlPlaneSnapshotQueryKey,
    enabled,
    retry: false,
    queryFn: () => api.getSnapshot()
  });
}
