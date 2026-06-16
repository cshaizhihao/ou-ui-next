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
      className="ou-mobile-nav fixed inset-x-3 bottom-3 z-40 border border-[#07111F] bg-[#FFFDF5] p-1.5 shadow-[0_28px_84px_-50px_rgba(7,17,31,0.32)] dark:border-[#6B7CFF]/25 dark:bg-[#101827] dark:shadow-[0_30px_96px_-54px_rgba(0,0,0,0.9)] md:hidden"
    >
      {governanceOpen ? (
        <div
          aria-label={governanceTrayLabel}
          className="mobile-governance-tray absolute inset-x-0 bottom-[calc(100%+0.5rem)] grid grid-cols-2 gap-1.5 border border-[#07111F] bg-[#FFFDF5] p-2 shadow-xl shadow-[#07111F]/14 transition duration-200 ease-out dark:border-[#6B7CFF]/25 dark:bg-[#101827]"
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
                    ? 'border-[#1E3AFF] bg-[#1E3AFF] text-white shadow-sm shadow-[#1E3AFF]/20 dark:border-[#6B7CFF] dark:bg-[#6B7CFF] dark:text-[#07111F]'
                    : 'border-[#07111F]/14 bg-[#EAF3D1]/56 text-[#07111F] hover:border-[#1E3AFF] hover:bg-[#DCE1FF] dark:border-[#6B7CFF]/18 dark:bg-[#192238] dark:text-white/72 dark:hover:border-[#6B7CFF]/30 dark:hover:bg-[#6B7CFF]/12 dark:hover:text-white'
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
                  ? 'border border-[#1E3AFF] bg-[#1E3AFF] text-white shadow-sm shadow-[#1E3AFF]/20 dark:border-[#6B7CFF] dark:bg-[#6B7CFF] dark:text-[#07111F]'
                  : 'text-[#35405A] hover:bg-[#DCE1FF] hover:text-[#07111F] dark:text-white/65 dark:hover:bg-[#6B7CFF]/12 dark:hover:text-white'
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
              ? 'border border-[#D9FF00] bg-[#D9FF00]/[0.32] text-[#07111F] shadow-sm shadow-[#D9FF00]/20 dark:border-[#EAFF5A]/40 dark:bg-[#EAFF5A]/16 dark:text-[#F4FFC5]'
              : 'text-[#35405A] hover:bg-[#D9FF00]/[0.22] hover:text-[#07111F] dark:text-white/65 dark:hover:bg-[#EAFF5A]/10 dark:hover:text-white'
          )}
          onClick={() => setGovernanceOpen((current) => !current)}
          type="button"
        >
          <ShieldCheck className="h-4 w-4" />
          <span className="w-full truncate text-center leading-none">{governanceLabel}</span>
        </button>
        <button
          aria-label={quickActionLabel}
          className="ou-tab flex min-h-11 min-w-0 touch-manipulation flex-col items-center justify-center gap-1 border border-[#FF3D18] bg-[#FF3D18]/[0.14] px-1.5 py-2 text-[10px] font-semibold text-[#07111F] shadow-sm shadow-[#FF3D18]/10 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 dark:border-[#FF6A3A]/35 dark:bg-[#FF6A3A]/12 dark:text-[#FFB197] dark:focus-visible:ring-primary/60"
          onClick={(event) => {
            setGovernanceOpen(false);
            onOpenQuickActions(event.currentTarget);
          }}
          type="button"
        >
          <Search className="h-4 w-4" />
          <span className="w-full truncate text-center leading-none">{quickActionLabel}</span>
          {commandLabel ? (
            <span className="max-w-full whitespace-nowrap rounded-full border border-[#D9FF00] bg-[#D9FF00]/[0.28] px-1.5 py-0.5 font-mono text-[9px] font-black leading-none text-[#07111F] tabular-nums dark:border-[#EAFF5A]/35 dark:bg-[#EAFF5A]/12 dark:text-[#F4FFC5]">
              {commandLabel}
            </span>
          ) : null}
        </button>
      </div>
    </nav>
  );
}
