import type { AppLanguage } from '../../app/app-store';
import type { PageId } from '../../app/navigation';
import { OperationsLaunchpad } from './operations-launchpad';
import { ControlPlaneSkeleton } from './control-plane-skeleton';

type AppShellWorkspaceChromeProps = {
  activePage: PageId;
  agentsCount: number;
  alertsCount: number;
  forwardingRulesCount: number;
  language: AppLanguage;
  loading: boolean;
  nodesCount: number;
  subscriptionsCount: number;
  onOpenQuickActions: () => void;
  onPrefetchPage?: (pageId: PageId) => void;
  onSelectPage: (pageId: PageId) => void;
};

export function AppShellWorkspaceChrome({
  activePage,
  agentsCount,
  alertsCount,
  forwardingRulesCount,
  language,
  loading,
  nodesCount,
  onOpenQuickActions,
  onPrefetchPage,
  onSelectPage,
  subscriptionsCount
}: AppShellWorkspaceChromeProps) {
  if (loading) {
    return <ControlPlaneSkeleton language={language} />;
  }

  return (
    <OperationsLaunchpad
      activePage={activePage}
      agentsCount={agentsCount}
      alertsCount={alertsCount}
      forwardingRulesCount={forwardingRulesCount}
      language={language}
      nodesCount={nodesCount}
      subscriptionsCount={subscriptionsCount}
      onOpenQuickActions={onOpenQuickActions}
      onPrefetchPage={onPrefetchPage}
      onSelectPage={onSelectPage}
    />
  );
}
