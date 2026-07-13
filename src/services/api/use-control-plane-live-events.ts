import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { controlPlaneSnapshotQueryKey } from './use-control-plane-snapshot';

export type ControlPlaneLiveEventState = 'disabled' | 'connecting' | 'live' | 'reconnecting' | 'unavailable';

export function createControlPlaneTaskEventUrl(baseUrl = '') {
  return `${baseUrl.replace(/\/+$/, '')}/events/v1/tasks?since=${encodeURIComponent(new Date().toISOString())}`;
}

export function useControlPlaneLiveEvents(enabled: boolean, baseUrl = '') {
  const queryClient = useQueryClient();
  const invalidateTimerRef = useRef<number | undefined>(undefined);
  const [state, setState] = useState<ControlPlaneLiveEventState>(enabled ? 'connecting' : 'disabled');

  useEffect(() => {
    if (!enabled) {
      setState('disabled');
      return;
    }
    if (typeof window === 'undefined' || typeof window.EventSource !== 'function') {
      setState('unavailable');
      return;
    }

    setState('connecting');
    const eventSource = new window.EventSource(createControlPlaneTaskEventUrl(baseUrl), { withCredentials: true });
    const invalidateSnapshot = () => {
      if (invalidateTimerRef.current !== undefined) {
        window.clearTimeout(invalidateTimerRef.current);
      }
      invalidateTimerRef.current = window.setTimeout(() => {
        invalidateTimerRef.current = undefined;
        void queryClient.invalidateQueries({ queryKey: controlPlaneSnapshotQueryKey });
      }, 250);
    };
    const markLive = () => setState('live');
    const markReconnecting = () => setState('reconnecting');

    eventSource.addEventListener('stream.ready', markLive);
    eventSource.addEventListener('task.status.changed', invalidateSnapshot);
    eventSource.addEventListener('audit.summary', invalidateSnapshot);
    eventSource.addEventListener('stream.error', markReconnecting);
    eventSource.onerror = markReconnecting;

    return () => {
      eventSource.close();
      if (invalidateTimerRef.current !== undefined) {
        window.clearTimeout(invalidateTimerRef.current);
        invalidateTimerRef.current = undefined;
      }
    };
  }, [baseUrl, enabled, queryClient]);

  return state;
}
