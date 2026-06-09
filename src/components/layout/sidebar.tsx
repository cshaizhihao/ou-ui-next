import { useEffect, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { AppLanguage } from '../../app/app-store';
import {
  getNavigationGroups,
  navigationEntryContainsPage,
  type NavigationEntry,
  type NavigationGroup,
  type NavigationItem,
  type PageId
} from '../../app/navigation';
import { cn } from '../../lib/cn';
import { BrandLogo } from './brand-logo';

type SidebarProps = {
  activePage: PageId;
  language: AppLanguage;
  onPageChange: (pageId: PageId) => void;
};

function collectActiveGroupIds(entries: NavigationEntry[], pageId: PageId): string[] {
  return entries.flatMap((entry) => {
    if (entry.type === 'item' || !navigationEntryContainsPage(entry, pageId)) {
      return [];
    }

    return [entry.id, ...collectActiveGroupIds(entry.children, pageId)];
  });
}

export function Sidebar({ activePage, language, onPageChange }: SidebarProps) {
  const navigationGroups = useMemo(() => getNavigationGroups(language), [language]);
  const [openGroupIds, setOpenGroupIds] = useState<string[]>(['core']);
  const controlNodeTitle = language === 'zh' ? '主控节点' : 'Master Node';
  const controlNodeSubtitle = language === 'zh' ? '控制面主节点' : 'Control Plane';

  useEffect(() => {
    const activeGroupIds = collectActiveGroupIds(navigationGroups, activePage);

    setOpenGroupIds((current) => [...new Set([...current, ...activeGroupIds])]);
  }, [activePage, navigationGroups]);

  function toggleGroup(groupId: string) {
    setOpenGroupIds((current) =>
      current.includes(groupId) ? current.filter((item) => item !== groupId) : [...current, groupId]
    );
  }

  function renderNavigationItem(item: NavigationItem, depth: number) {
    return (
      <button
        aria-label={item.label}
        className={cn(
          'nav-item flex w-full min-w-0 items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-all',
          depth > 0 && 'ml-3 w-[calc(100%-0.75rem)]',
          activePage === item.id
            ? 'nav-active border-blue-200 bg-blue-50 text-blue-600 dark:border-primary/20 dark:bg-primary/15 dark:text-primary'
            : 'border-transparent text-slate-600 hover:bg-slate-100 dark:text-white/60 dark:hover:bg-white/5'
        )}
        key={item.id}
        onClick={() => onPageChange(item.id)}
        type="button"
      >
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-bold tracking-wide">{item.label}</span>
          <span className="mt-0.5 truncate font-mono text-[9px] uppercase tracking-widest opacity-60">
            {item.description}
          </span>
        </span>
      </button>
    );
  }

  function renderNavigationGroup(group: NavigationGroup, depth: number) {
    const isOpen = openGroupIds.includes(group.id);
    const containsActivePage = navigationEntryContainsPage(group, activePage);
    const actionLabel =
      language === 'zh'
        ? `${isOpen ? '收起' : '展开'} ${group.label}`
        : `${isOpen ? 'Collapse' : 'Expand'} ${group.label}`;

    return (
      <div className={cn('space-y-1', depth > 0 && 'ml-3')} key={group.id}>
        <button
          aria-expanded={isOpen}
          aria-label={actionLabel}
          className={cn(
            'flex w-full min-w-0 items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition-all',
            containsActivePage
              ? 'border-blue-200 bg-blue-50/70 text-blue-600 dark:border-primary/20 dark:bg-primary/10 dark:text-primary'
              : 'border-transparent text-slate-500 hover:bg-slate-100 dark:text-white/50 dark:hover:bg-white/5'
          )}
          onClick={() => toggleGroup(group.id)}
          type="button"
        >
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[11px] font-black uppercase tracking-widest">{group.label}</span>
            <span className="mt-0.5 truncate text-[10px] font-semibold opacity-60">{group.description}</span>
          </span>
          <ChevronDown
            className={cn('h-4 w-4 flex-shrink-0 transition-transform', !isOpen && '-rotate-90')}
            strokeWidth={1.8}
          />
        </button>

        {isOpen ? (
          <div className="space-y-1">
            {group.children.map((entry) =>
              entry.type === 'item'
                ? renderNavigationItem(entry.item, depth + 1)
                : renderNavigationGroup(entry, depth + 1)
            )}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <aside className="island-panel w-[248px] flex-shrink-0 max-md:max-h-[460px] max-md:w-full">
      <div className="flex h-20 shrink-0 items-center border-b border-slate-200 px-6 dark:border-white/[0.06]">
        <div className="mr-3 flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 dark:border-white/10 dark:bg-white/5">
          <BrandLogo />
        </div>
        <h1 className="text-base font-bold tracking-widest text-slate-900 dark:text-white">OU-UI NEXT</h1>
      </div>

      <nav className="flex-1 space-y-2 overflow-y-auto px-4 py-5">
        {navigationGroups.map((group) => renderNavigationGroup(group, 0))}
      </nav>

      <div className="shrink-0 p-5 max-md:hidden">
        <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-100 p-3 dark:border-white/10 dark:bg-white/5">
          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-xs font-bold text-slate-800 shadow-sm dark:border-white/10 dark:bg-black dark:text-white">
            M
          </div>
          <div className="min-w-0">
            <p className="truncate text-xs font-bold tracking-wide text-slate-800 dark:text-white">{controlNodeTitle}</p>
            <p className="mt-0.5 truncate font-mono text-[9px] uppercase tracking-widest text-slate-500 dark:text-white/50">
              {controlNodeSubtitle}
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
}
