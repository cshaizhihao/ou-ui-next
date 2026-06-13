import { useEffect, useState } from 'react';
import { Boxes, ClipboardList, LayoutDashboard, Route, Search, ServerCog } from 'lucide-react';
import type { AppLanguage } from '../../app/app-store';
import { getNavigationItem, type PageId } from '../../app/navigation';
import { cn } from '../../lib/cn';

type MobileBottomNavProps = {
  activePage: PageId;
  language: AppLanguage;
  onPageChange: (pageId: PageId) => void;
  onPrefetchPage?: (pageId: PageId) => void;
  onOpenQuickActions: (returnFocusTarget?: HTMLElement | null) => void;
};

const mobilePageIds = ['dashboard', 'nodes', 'customerNodes', 'subscriptions', 'tasks'] as const;
type MobilePageId = (typeof mobilePageIds)[number];
const mobileIcons = {
  dashboard: LayoutDashboard,
  nodes: ServerCog,
  customerNodes: Boxes,
  subscriptions: Route,
  tasks: ClipboardList
} satisfies Record<MobilePageId, typeof LayoutDashboard>;

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
  onPrefetchPage
}: MobileBottomNavProps) {
  const label = language === 'zh' ? '手机快捷导航' : 'Mobile quick navigation';
  const isMobileViewport = useIsMobileViewport();
  const quickActionLabel = language === 'zh' ? '搜索' : 'Search';

  if (!isMobileViewport) {
    return null;
  }

  return (
    <nav
      aria-label={label}
      className="fixed inset-x-3 bottom-3 z-40 border border-black/15 bg-white/95 p-1.5 shadow-2xl shadow-black/12 backdrop-blur-xl dark:border-white/10 dark:bg-black/90 md:hidden"
    >
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
                'ou-tab flex min-w-0 touch-manipulation flex-col items-center justify-center gap-1 rounded-2xl px-1.5 py-2 text-[10px] font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 dark:focus-visible:ring-primary/60',
                active
                  ? 'border border-black/20 bg-black/[0.04] text-black shadow-sm shadow-black/10 dark:border-white/15 dark:bg-white/[0.06] dark:text-white'
                  : 'text-black/55 hover:bg-black/[0.03] hover:text-black dark:text-white/60 dark:hover:bg-white/5 dark:hover:text-white'
              )}
              key={pageId}
              onClick={() => onPageChange(pageId)}
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
          aria-label={quickActionLabel}
          className="ou-tab flex min-h-11 min-w-0 touch-manipulation flex-col items-center justify-center gap-1 rounded-2xl border border-black/20 bg-black/[0.04] px-1.5 py-2 text-[10px] font-semibold text-black shadow-sm shadow-black/10 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 dark:border-white/15 dark:bg-white/[0.06] dark:text-white dark:focus-visible:ring-primary/60"
          onClick={(event) => onOpenQuickActions(event.currentTarget)}
          type="button"
        >
          <Search className="h-4 w-4" />
          <span className="w-full truncate text-center leading-none">{quickActionLabel}</span>
        </button>
      </div>
    </nav>
  );
}
