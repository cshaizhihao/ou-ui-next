import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createPageHash, readPageFromHash, usePageRouter } from './page-router';

describe('page router', () => {
  it('maps stable deep links and falls back safely', () => {
    expect(createPageHash('customerNodes')).toBe('#/customer-nodes');
    expect(readPageFromHash('#/recovery')).toBe('recovery');
    expect(readPageFromHash('#/execution?task=task-1')).toBe('tasks');
    expect(readPageFromHash('#/unknown')).toBe('dashboard');
  });

  it('writes history and follows browser navigation', () => {
    window.history.replaceState(null, '', '/#/overview');
    const { result } = renderHook(() => usePageRouter());

    act(() => result.current.navigate('recovery'));
    expect(result.current.activePage).toBe('recovery');
    expect(window.location.hash).toBe('#/recovery');

    act(() => {
      window.history.pushState(null, '', '/#/subscriptions');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current.activePage).toBe('subscriptions');
  });
});
