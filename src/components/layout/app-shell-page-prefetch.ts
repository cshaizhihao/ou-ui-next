import type { PageId } from '../../app/navigation';

export const appShellPageLoaders = {
  adminAccounts: () => import('../../features/admin/admin-account-settings-page'),
  audit: () => import('../../features/audit/audit-page'),
  customers: () => import('../../features/customers/customers-page'),
  customerNodes: () => import('../../features/nodes/nodes-page'),
  dashboard: () => import('../../features/dashboard/dashboard-page'),
  forwarding: () => import('../../features/forwarding/forwarding-page'),
  nodes: () => import('../../features/nodes/nodes-page'),
  permissions: () => import('../../features/permissions/permissions-page'),
  routing: () => import('../../features/routing/routing-page'),
  subscriptions: () => import('../../features/subscriptions/subscription-mixer-page'),
  tasks: () => import('../../features/tasks/tasks-page'),
  telegram: () => import('../../features/telegram/telegram-notification-settings-page'),
  tuning: () => import('../../features/tuning/tuning-page')
} satisfies Record<PageId, () => Promise<unknown>>;

const prefetchedPages = new Set<PageId>();

export function prefetchAppShellPage(pageId: PageId) {
  if (prefetchedPages.has(pageId)) {
    return;
  }

  prefetchedPages.add(pageId);
  void appShellPageLoaders[pageId]();
}