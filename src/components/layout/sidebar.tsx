import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, LayoutGrid, ShieldCheck, Signal } from 'lucide-react';
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
  const [openGroupIds, setOpenGroupIds] = useState<string[]>(['operations', 'evidence']);
  const controlNodeTitle = language === 'zh' ? '主控节点' : 'Master Node';
  const controlNodeSubtitle = language === 'zh' ? '控制面主节点' : 'Control Plane';
  const sidebarLabel = language === 'zh' ? 'Master 控制面导航' : 'Master control-plane navigation';
  const statusLabel = language === 'zh' ? '控制面状态' : 'Control-plane status';
  const evidenceLabel = language === 'zh' ? '证据链' : 'Evidence Chain';
  const onlineLabel = language === 'zh' ? '在线' : 'Online';
  const isZh = language === 'zh';

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
        aria-current={activePage === item.id ? 'page' : undefined}
        className={cn(
          'control-plane-nav-item ou-nav-item nav-item flex w-full min-w-0 items-center gap-3 border px-3 py-2.5 text-left',
          depth > 0 && 'ml-3 w-[calc(100%-0.75rem)]',
          activePage === item.id
            ? 'nav-active'
            : 'border-transparent text-[var(--ou-text-muted)] hover:border-[var(--ou-border-strong)] hover:bg-[var(--ou-surface-muted)] hover:text-[var(--ou-text)]'
        )}
        key={item.id}
        onClick={() => onPageChange(item.id)}
        type="button"
      >
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold tracking-tight">{item.label}</span>
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
      <div className={cn('control-plane-nav-group space-y-1', depth > 0 && 'ml-3')} key={group.id}>
        <button
          aria-expanded={isOpen}
          aria-label={actionLabel}
          className={cn(
            'ou-nav-item flex w-full min-w-0 items-center justify-between gap-3 border px-3 py-2.5 text-left',
            containsActivePage
              ? 'ou-tone-warning shadow-sm'
              : 'border-transparent text-[var(--ou-text-muted)] hover:border-[var(--ou-warning)] hover:bg-[var(--ou-warning-soft)] hover:text-[var(--ou-text)]'
          )}
          onClick={() => toggleGroup(group.id)}
          type="button"
        >
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[11px] font-semibold tracking-tight">{group.label}</span>
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
    <aside
      aria-label={sidebarLabel}
      className="control-plane-sidebar ou-shell-sidebar h-full min-h-0 w-[272px] flex-shrink-0 overflow-hidden border max-md:hidden"
    >
      <div className="flex h-20 shrink-0 items-center justify-between border-b px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="ou-tone-primary flex h-9 w-9 items-center justify-center border shadow-sm">
            <BrandLogo />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold tracking-tight text-[var(--ou-text)]">OU-UI NEXT</h1>
            <p className="truncate text-[10px] font-medium text-[var(--ou-text-muted)]">
              {isZh ? '商业级 Master 控制平面' : 'Commercial Master control plane'}
            </p>
          </div>
        </div>
        <div className="hidden items-center gap-2 lg:flex">
          <span className="ou-tone-primary flex h-8 w-8 items-center justify-center border">
            <LayoutGrid className="h-3.5 w-3.5" />
          </span>
          <span className="ou-tone-warning flex h-8 w-8 items-center justify-center border">
            <ShieldCheck className="h-3.5 w-3.5" />
          </span>
        </div>
      </div>

      <nav className="flex-1 space-y-2 overflow-y-auto px-4 py-5">
        {navigationGroups.map((group) => renderNavigationGroup(group, 0))}
      </nav>

      <div className="shrink-0 p-5 max-md:hidden">
        <div
          aria-label={statusLabel}
          className="control-plane-shell-status-strip grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 border p-3 shadow-sm"
          role="region"
        >
          <div className="ou-tone-success flex h-9 w-9 items-center justify-center border text-xs font-semibold shadow-sm">
            M
          </div>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold tracking-tight text-[var(--ou-text)]">{controlNodeTitle}</p>
            <p className="mt-0.5 truncate text-[9px] font-medium text-[var(--ou-text-muted)]">
              {controlNodeSubtitle}
            </p>
          </div>
          <div className="col-span-2 grid grid-cols-2 gap-2 text-[9px] font-black uppercase tracking-[0.08em] text-[var(--ou-text)]">
            <span className="ou-tone-warning flex min-w-0 items-center gap-1.5 border px-2 py-1">
              <ShieldCheck className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">{evidenceLabel}</span>
            </span>
            <span className="ou-tone-success flex min-w-0 items-center gap-1.5 border px-2 py-1">
              <Signal className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">{onlineLabel}</span>
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
}
