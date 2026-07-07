import { useEffect, useState } from 'react';
import {
  ArrowLeftRight,
  Bell,
  Boxes,
  ClipboardList,
  Gauge,
  LayoutDashboard,
  Route,
  Search,
  ServerCog,
  ShieldCheck,
  UserCog,
  UsersRound
} from 'lucide-react';
import type { AppLanguage } from '../../app/app-store';
import { getNavigationItem, type PageId } from '../../app/navigation';
import { cn } from '../../lib/cn';

type MobileBottomNavProps = {
  activePage: PageId;
  language: AppLanguage;
  quickActionScope?: {
    objects: number;
    commands: number;
  };
  onPageChange: (pageId: PageId) => void;
  onPrefetchPage?: (pageId: PageId) => void;
  onOpenQuickActions: (returnFocusTarget?: HTMLElement | null) => void;
};

const mobilePageIds = ['dashboard', 'nodes', 'customerNodes', 'forwarding'] as const;
type MobilePageId = (typeof mobilePageIds)[number];
const mobileIcons = {
  dashboard: LayoutDashboard,
  nodes: ServerCog,
  customerNodes: Boxes,
  forwarding: ArrowLeftRight
} satisfies Record<MobilePageId, typeof LayoutDashboard>;
const governancePageIds = [
  'customers',
  'subscriptions',
  'routing',
  'tuning',
  'telegram',
  'adminAccounts',
  'tasks',
  'audit'
] as const;
type GovernancePageId = (typeof governancePageIds)[number];
const governanceIcons = {
  customers: UsersRound,
  subscriptions: Route,
  routing: Route,
  tuning: Gauge,
  telegram: Bell,
  adminAccounts: UserCog,
  tasks: ClipboardList,
  audit: ShieldCheck
} satisfies Record<GovernancePageId, typeof LayoutDashboard>;

const mobileMediaQuery = '(max-width: 767px)';

function useIsMobileViewport() {
  const [isMobileViewport, setIsMobileViewport] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }

    return window.matchMedia(mobileMediaQuery).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }

    const mediaQuery = window.matchMedia(mobileMediaQuery);
    const handleChange = () => setIsMobileViewport(mediaQuery.matches);
    handleChange();
    mediaQuery.addEventListener('change', handleChange);

    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  return isMobileViewport;
}

export function MobileBottomNav({
  activePage,
  language,
  onOpenQuickActions,
  onPageChange,
  onPrefetchPage,
  quickActionScope
}: MobileBottomNavProps) {
  const label = language === 'zh' ? '手机快捷导航' : 'Mobile quick navigation';
  const isMobileViewport = useIsMobileViewport();
  const quickActionLabel = language === 'zh' ? '搜索' : 'Search';
  const governanceLabel = language === 'zh' ? '治理' : 'Govern';
  const governanceTrayLabel = language === 'zh' ? '手机治理入口' : 'Mobile governance entry';
  const [governanceOpen, setGovernanceOpen] = useState(false);
  const activeGovernance = governancePageIds.includes(activePage as GovernancePageId);
  const commandLabel = quickActionScope
    ? language === 'zh'
      ? `${quickActionScope.commands} 动作`
      : `${quickActionScope.commands} ${quickActionScope.commands === 1 ? 'action' : 'actions'}`
    : undefined;

  if (!isMobileViewport) {
    return null;
  }

  function handlePageChange(pageId: PageId) {
    setGovernanceOpen(false);
    onPageChange(pageId);
  }

  return (
    <nav
      aria-label={label}
      className="ou-mobile-nav fixed inset-x-3 bottom-3 z-40 border p-1.5 md:hidden"
    >
      {governanceOpen ? (
        <div
          aria-label={governanceTrayLabel}
          className="mobile-governance-tray absolute inset-x-0 bottom-[calc(100%+0.5rem)] grid grid-cols-2 gap-1.5 border p-2 transition duration-200 ease-out"
          id="mobile-governance-tray"
          role="region"
        >
          {governancePageIds.map((pageId) => {
            const item = getNavigationItem(pageId, language);
            const Icon = governanceIcons[pageId];
            const active = pageId === activePage;

            return (
              <button
                aria-current={active ? 'page' : undefined}
                aria-label={item.label}
                className={cn(
                  'ou-tab flex min-h-11 min-w-0 touch-manipulation items-center gap-2 border px-2.5 py-2 text-left text-[11px] font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 dark:focus-visible:ring-primary/60',
                  active
                    ? 'shadow-sm'
                    : 'border-[var(--ou-border)] bg-[var(--ou-surface-muted)] text-[var(--ou-text-muted)] hover:border-[var(--ou-primary)] hover:bg-[var(--ou-primary-softer)] hover:text-[var(--ou-text)]'
                )}
                key={pageId}
                onClick={() => handlePageChange(pageId)}
                onFocus={() => onPrefetchPage?.(pageId)}
                onMouseEnter={() => onPrefetchPage?.(pageId)}
                type="button"
              >
                <Icon className="h-4 w-4 flex-shrink-0" />
                <span className="min-w-0 truncate">{item.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="grid grid-cols-6 gap-1">
        {mobilePageIds.map((pageId) => {
          const item = getNavigationItem(pageId, language);
          const Icon = mobileIcons[pageId];
          const active = pageId === activePage;

          return (
            <button
              aria-current={active ? 'page' : undefined}
              aria-label={item.label}
              className={cn(
                'ou-tab flex min-h-11 min-w-0 touch-manipulation flex-col items-center justify-center gap-1 border border-transparent px-1.5 py-2 text-[10px] font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 dark:focus-visible:ring-primary/60',
                active
                  ? 'border shadow-sm'
                  : 'text-[var(--ou-text-muted)] hover:bg-[var(--ou-primary-softer)] hover:text-[var(--ou-text)]'
              )}
              key={pageId}
              onClick={() => handlePageChange(pageId)}
              onFocus={() => onPrefetchPage?.(pageId)}
              onMouseEnter={() => onPrefetchPage?.(pageId)}
              type="button"
            >
              <Icon className="h-4 w-4" />
              <span className="w-full truncate text-center leading-none">{item.label}</span>
            </button>
          );
        })}
        <button
          aria-controls="mobile-governance-tray"
          aria-expanded={governanceOpen}
          aria-label={governanceLabel}
          className={cn(
            'ou-tab flex min-h-11 min-w-0 touch-manipulation flex-col items-center justify-center gap-1 border border-transparent px-1.5 py-2 text-[10px] font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 dark:focus-visible:ring-primary/60',
            activeGovernance || governanceOpen
              ? 'border ou-tone-warning shadow-sm'
              : 'text-[var(--ou-text-muted)] hover:bg-[var(--ou-warning-soft)] hover:text-[var(--ou-text)]'
          )}
          onClick={() => setGovernanceOpen((current) => !current)}
          type="button"
        >
          <ShieldCheck className="h-4 w-4" />
          <span className="w-full truncate text-center leading-none">{governanceLabel}</span>
        </button>
        <button
          aria-label={quickActionLabel}
          className="ou-tab ou-tone-danger flex min-h-11 min-w-0 touch-manipulation flex-col items-center justify-center gap-1 border px-1.5 py-2 text-[10px] font-semibold shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 dark:focus-visible:ring-primary/60"
          onClick={(event) => {
            setGovernanceOpen(false);
            onOpenQuickActions(event.currentTarget);
          }}
          type="button"
        >
          <Search className="h-4 w-4" />
          <span className="w-full truncate text-center leading-none">{quickActionLabel}</span>
          {commandLabel ? (
            <span className="ou-chip ou-tone-warning max-w-full whitespace-nowrap rounded-full border px-1.5 py-0.5 font-mono text-[9px] font-black leading-none tabular-nums">
              {commandLabel}
            </span>
          ) : null}
        </button>
      </div>
    </nav>
  );
}
