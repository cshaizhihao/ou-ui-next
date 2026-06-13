import type { AppLanguage } from '../../app/app-store';
import type { PageId } from '../../app/navigation';
import { OperationsLaunchpad } from './operations-launchpad';
import { ControlPlaneSkeleton } from './control-plane-skeleton';

type AppShellWorkspaceChromeProps = {
  activePage: PageId;
  agentsCount: number;
  forwardingRulesCount: number;
  language: AppLanguage;
  loading: boolean;
  nodesCount: number;
  subscriptionsCount: number;
  onOpenQuickActions: (returnFocusTarget?: HTMLElement | null) => void;
  onPrefetchPage?: (pageId: PageId) => void;
  onSelectPage: (pageId: PageId) => void;
};

export function AppShellWorkspaceChrome({
  activePage,
  agentsCount,
  forwardingRulesCount,
  language,
  loading,
  nodesCount,
  onOpenQuickActions,
  onPrefetchPage,
  onSelectPage,
  subscriptionsCount
}: AppShellWorkspaceChromeProps) {
  if (activePage !== 'dashboard') {
    return null;
  }

  if (loading) {
    return <ControlPlaneSkeleton language={language} />;
  }

  return (
    <OperationsLaunchpad
      activePage={activePage}
      agentsCount={agentsCount}
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
