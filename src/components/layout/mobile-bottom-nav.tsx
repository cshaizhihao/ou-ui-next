import { useEffect, useState } from 'react';
import { Boxes, ClipboardList, LayoutDashboard, Menu, Route, ServerCog } from 'lucide-react';
import type { AppLanguage } from '../../app/app-store';
import { getNavigationItem, type PageId } from '../../app/navigation';
import { cn } from '../../lib/cn';

type MobileBottomNavProps = {
  activePage: PageId;
  language: AppLanguage;
  onPageChange: (pageId: PageId) => void;
  onPrefetchPage?: (pageId: PageId) => void;
};

const mobilePageIds = ['dashboard', 'nodes', 'customerNodes', 'subscriptions', 'tasks', 'permissions'] as const;
type MobilePageId = (typeof mobilePageIds)[number];
const mobileIcons = {
  dashboard: LayoutDashboard,
  nodes: ServerCog,
  customerNodes: Boxes,
  subscriptions: Route,
  tasks: ClipboardList,
  permissions: Menu
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

export function MobileBottomNav({ activePage, language, onPageChange, onPrefetchPage }: MobileBottomNavProps) {
  const label = language === 'zh' ? '手机快捷导航' : 'Mobile quick navigation';
  const isMobileViewport = useIsMobileViewport();

  if (!isMobileViewport) {
    return null;
  }

  return (
    <nav
      aria-label={label}
      className="fixed inset-x-3 bottom-3 z-40 rounded-[1.35rem] border border-slate-200/80 bg-white/94 p-1.5 shadow-2xl shadow-slate-950/16 backdrop-blur-2xl dark:border-white/10 dark:bg-[#080b12]/94 md:hidden"
    >
      <div className="grid grid-cols-6 gap-1">
        {mobilePageIds.map((pageId) => {
          const item = pageId === 'permissions'
            ? { ...getNavigationItem(pageId, language), label: language === 'zh' ? '更多' : 'More' }
            : getNavigationItem(pageId, language);
          const Icon = mobileIcons[pageId];
          const active = pageId === activePage;

          return (
            <button
              aria-current={active ? 'page' : undefined}
              aria-label={item.label}
              className={cn(
                'flex min-w-0 touch-manipulation flex-col items-center justify-center gap-1 rounded-2xl px-1.5 py-2 text-[10px] font-black transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 dark:focus-visible:ring-primary/40',
                active
                  ? 'bg-gradient-to-br from-slate-950 to-blue-700 text-white shadow-lg shadow-blue-500/20 dark:from-blue-500 dark:to-cyan-400 dark:text-slate-950'
                  : 'text-slate-500 hover:bg-blue-50 hover:text-blue-700 dark:text-white/55 dark:hover:bg-white/5 dark:hover:text-blue-200'
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
      </div>
    </nav>
  );
}
