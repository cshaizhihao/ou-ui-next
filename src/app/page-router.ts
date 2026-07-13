import { useCallback, useEffect, useState } from 'react';
import type { PageId } from './navigation';

const pagePaths = {
  dashboard: 'overview',
  recovery: 'recovery',
  customers: 'customers',
  customerNodes: 'customer-nodes',
  nodes: 'servers',
  forwarding: 'forwarding',
  subscriptions: 'subscriptions',
  routing: 'routing',
  telegram: 'notifications',
  adminAccounts: 'settings',
  tuning: 'tuning',
  tasks: 'execution',
  audit: 'audit'
} satisfies Record<PageId, string>;

const pagesByPath = new Map(Object.entries(pagePaths).map(([pageId, path]) => [path, pageId as PageId]));

export function createPageHash(pageId: PageId) {
  return `#/${pagePaths[pageId]}`;
}

export function readPageFromHash(hash: string): PageId {
  const path = hash.replace(/^#\/?/, '').split(/[?&]/, 1)[0]?.replace(/^\/+|\/+$/g, '');
  return (path && pagesByPath.get(path)) || 'dashboard';
}

export function usePageRouter() {
  const [activePage, setActivePage] = useState<PageId>(() =>
    typeof window === 'undefined' ? 'dashboard' : readPageFromHash(window.location.hash)
  );

  useEffect(() => {
    const syncFromLocation = () => setActivePage(readPageFromHash(window.location.hash));
    window.addEventListener('hashchange', syncFromLocation);
    window.addEventListener('popstate', syncFromLocation);

    return () => {
      window.removeEventListener('hashchange', syncFromLocation);
      window.removeEventListener('popstate', syncFromLocation);
    };
  }, []);

  const navigate = useCallback((pageId: PageId, options?: { replace?: boolean }) => {
    const nextHash = createPageHash(pageId);
    const nextUrl = `${window.location.pathname}${window.location.search}${nextHash}`;

    if (window.location.hash !== nextHash) {
      window.history[options?.replace ? 'replaceState' : 'pushState'](null, '', nextUrl);
    }
    setActivePage(pageId);
  }, []);

  return { activePage, navigate };
}
