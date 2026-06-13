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
            'ou-nav-item nav-item flex w-full min-w-0 items-center gap-3 rounded-xl border px-3 py-2.5 text-left',
            depth > 0 && 'ml-3 w-[calc(100%-0.75rem)]',
            activePage === item.id
            ? 'nav-active border-black/20 bg-black/[0.04] text-black shadow-sm shadow-black/10 dark:border-white/15 dark:bg-white/[0.06] dark:text-white dark:shadow-black/30'
            : 'border-transparent text-black/65 hover:border-black/15 hover:bg-white/90 hover:text-black dark:text-white/70 dark:hover:border-white/10 dark:hover:bg-white/5 dark:hover:text-white'
        )}
        key={item.id}
        onClick={() => onPageChange(item.id)}
        type="button"
      >
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold tracking-tight">{item.label}</span>
          <span className="mt-0.5 truncate text-[9px] font-medium opacity-60">
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
            'ou-nav-item flex w-full min-w-0 items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left',
            containsActivePage
              ? 'border-black/20 bg-black/[0.04] text-black shadow-sm shadow-black/10 dark:border-white/15 dark:bg-white/[0.06] dark:text-white'
              : 'border-transparent text-black/58 hover:border-black/15 hover:bg-white/90 hover:text-black dark:text-white/60 dark:hover:border-white/10 dark:hover:bg-white/5 dark:hover:text-white/85'
          )}
          onClick={() => toggleGroup(group.id)}
          type="button"
        >
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[11px] font-semibold tracking-tight">{group.label}</span>
            <span className="mt-0.5 truncate text-[10px] font-medium opacity-60">{group.description}</span>
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
    <aside className="island-panel w-[272px] flex-shrink-0 max-md:hidden">
      <div className="flex h-20 shrink-0 items-center border-b border-black/15 bg-white/60 px-6 dark:border-white/10 dark:bg-white/[0.02]">
        <div className="mr-3 flex h-9 w-9 items-center justify-center rounded-xl border border-black/15 bg-white text-black shadow-sm shadow-black/10 dark:border-white/10 dark:bg-white/[0.04] dark:text-white">
          <BrandLogo />
        </div>
        <h1 className="text-base font-semibold tracking-tight text-black dark:text-white">OU-UI NEXT</h1>
      </div>

      <nav className="flex-1 space-y-2 overflow-y-auto px-4 py-5">
        {navigationGroups.map((group) => renderNavigationGroup(group, 0))}
      </nav>

      <div className="shrink-0 p-5 max-md:hidden">
        <div className="flex items-center gap-3 rounded-2xl border border-black/15 bg-white/80 p-3 shadow-sm dark:border-white/10 dark:bg-white/[0.04]">
          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-black/15 bg-white text-xs font-semibold text-black shadow-sm dark:border-white/10 dark:bg-black/40 dark:text-white">
            M
          </div>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold tracking-tight text-black dark:text-white">{controlNodeTitle}</p>
            <p className="mt-0.5 truncate text-[9px] font-medium text-black/60 dark:text-white/50">
              {controlNodeSubtitle}
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
}
