import type { PropsWithChildren } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createControlPlaneTaskEventUrl, useControlPlaneLiveEvents } from './use-control-plane-live-events';

class TestEventSource {
  static latest?: TestEventSource;
  readonly url: string;
  readonly withCredentials: boolean;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, Set<() => void>>();

  constructor(url: string | URL, options?: EventSourceInit) {
    this.url = String(url);
    this.withCredentials = options?.withCredentials === true;
    TestEventSource.latest = this;
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const callback = typeof listener === 'function' ? () => listener(new Event(type)) : () => listener.handleEvent(new Event(type));
    this.listeners.set(type, new Set([...(this.listeners.get(type) ?? []), callback]));
  }

  emit(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }

  close() {}
}

describe('control-plane live events', () => {
  it('uses the configured base path for the task stream', () => {
    expect(createControlPlaneTaskEventUrl('/secure-panel')).toMatch(
      /^\/secure-panel\/events\/v1\/tasks\?since=/
    );
  });

  it('invalidates the snapshot after a task event without polling on every heartbeat', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('EventSource', TestEventSource);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result, unmount } = renderHook(() => useControlPlaneLiveEvents(true, '/secure-panel'), { wrapper });

    expect(TestEventSource.latest?.url).toContain('/secure-panel/events/v1/tasks');
    expect(TestEventSource.latest?.withCredentials).toBe(true);
    act(() => TestEventSource.latest?.emit('stream.ready'));
    expect(result.current).toBe('live');

    act(() => {
      TestEventSource.latest?.emit('task.status.changed');
      vi.advanceTimersByTime(249);
    });
    expect(invalidateQueries).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(invalidateQueries).toHaveBeenCalledTimes(1);

    unmount();
    vi.useRealTimers();
  });
});
