import type { AppLanguage } from '../../app/app-store';
import type { PageId } from '../../app/navigation';
import { ControlPlaneStatusCenter } from './control-plane-status-center';
import type { ControlPlaneLiveEventState } from '../../services/api/use-control-plane-live-events';
import { OperationsLaunchpad } from './operations-launchpad';
import { ControlPlaneSkeleton } from './control-plane-skeleton';

type AppShellWorkspaceChromeProps = {
  activePage: PageId;
  agentsCount: number;
  agentsOnlineCount: number;
  alertsCount: number;
  failedTasksCount: number;
  forwardingRulesCount: number;
  language: AppLanguage;
  liveEventState: ControlPlaneLiveEventState;
  loading: boolean;
  nodesCount: number;
  quotaRiskCount: number;
  runtimeApplyingCount: number;
  subscriptionsCount: number;
  tasksCount: number;
  onOpenQuickActions: (returnFocusTarget?: HTMLElement | null) => void;
  onPrefetchPage?: (pageId: PageId) => void;
  onSelectPage: (pageId: PageId) => void;
};

export function AppShellWorkspaceChrome({
  activePage,
  agentsCount,
  agentsOnlineCount,
  alertsCount,
  failedTasksCount,
  forwardingRulesCount,
  language,
  liveEventState,
  loading,
  nodesCount,
  quotaRiskCount,
  runtimeApplyingCount,
  onOpenQuickActions,
  onPrefetchPage,
  onSelectPage,
  subscriptionsCount,
  tasksCount
}: AppShellWorkspaceChromeProps) {
  if (activePage !== 'dashboard') {
    return null;
  }

  if (loading) {
    return <ControlPlaneSkeleton language={language} />;
  }

  return (
    <>
      <OperationsLaunchpad
        activePage={activePage}
        agentsCount={agentsCount}
        alertsCount={alertsCount}
        forwardingRulesCount={forwardingRulesCount}
        language={language}
        nodesCount={nodesCount}
        subscriptionsCount={subscriptionsCount}
        tasksCount={tasksCount}
        onOpenQuickActions={onOpenQuickActions}
        onPrefetchPage={onPrefetchPage}
        onSelectPage={onSelectPage}
      />
      <ControlPlaneStatusCenter
        agentsOnlineCount={agentsOnlineCount}
        agentsTotalCount={agentsCount}
        alertsCount={alertsCount}
        failedTasksCount={failedTasksCount}
        language={language}
        liveEventState={liveEventState}
        quotaRiskCount={quotaRiskCount}
        runtimeApplyingCount={runtimeApplyingCount}
        onPrefetchPage={onPrefetchPage}
        onSelectPage={onSelectPage}
      />
    </>
  );
}
