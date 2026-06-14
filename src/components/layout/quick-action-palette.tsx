import { Search, X } from 'lucide-react';
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { AppLanguage } from '../../app/app-store';
import type { PageId } from '../../app/navigation';
import { cn } from '../../lib/cn';

export type QuickActionCommand = {
  kind:
    | 'customer-node.copy-all-subscription-links'
    | 'customer-node.copy-subscription-link'
    | 'customer-node.copy-share-link'
    | 'customer-node.reset-traffic'
    | 'customer-node.set-enabled'
    | 'forward.apply'
    | 'forward.pause'
    | 'forward.resume'
    | 'subscription.sync'
    | 'subscription.copy-uri'
    | 'subscription.copy-all';
  label: string;
  targetId: string;
  aliases?: string[];
  value?: string;
};

export type QuickActionIntent = {
  kind: 'customer.resources' | 'forward.edit' | 'host.deploy' | 'customer-node.edit' | 'subscription.links';
  targetId: string;
};

export type QuickActionItem = {
  id: string;
  title: string;
  description: string;
  group: string;
  keywords: string[];
  pageId: PageId;
  badge?: string;
  command?: QuickActionCommand;
  commands?: QuickActionCommand[];
  intent?: QuickActionIntent;
};

type QuickActionPaletteProps = {
  items: QuickActionItem[];
  language: AppLanguage;
  open: boolean;
  onClose: () => void;
  onRunCommand?: (item: QuickActionItem, command: QuickActionCommand) => void;
  onSelect: (item: QuickActionItem) => void;
};

const copy = {
  zh: {
    title: '控制面搜索',
    close: '关闭控制面搜索',
    placeholder: '搜索控制面、主机、客户、转发和订阅',
    activeResult: '当前搜索结果',
    scopeRegion: '控制面搜索范围',
    results: '搜索结果',
    empty: '没有匹配结果',
    hint: '输入客户、端口、主机、订阅或页面名称',
    scope: {
      objects: '可搜索对象',
      commands: '可执行命令',
      matches: '当前匹配'
    },
    shortcutsLabel: '控制面搜索快捷键',
    shortcuts: {
      open: '打开结果',
      run: '执行动作',
      close: '关闭'
    },
    actionCount: (count: number) => `${count} 个动作`
  },
  en: {
    title: 'Control Plane Search',
    close: 'Close control-plane search',
    placeholder: 'Search control plane, hosts, customers, forwarding, and subscriptions',
    activeResult: 'Current search result',
    scopeRegion: 'Control Plane Scope',
    results: 'Search results',
    empty: 'No matches',
    hint: 'Type a customer, port, host, subscription, or page name',
    scope: {
      objects: 'Searchable Objects',
      commands: 'Executable Commands',
      matches: 'Current Matches'
    },
    shortcutsLabel: 'Control Plane Search Shortcuts',
    shortcuts: {
      open: 'Open result',
      run: 'Run action',
      close: 'Close'
    },
    actionCount: (count: number) => `${count} ${count === 1 ? 'action' : 'actions'}`
  }
} as const;

function normalizeSearch(value: string) {
  return value.trim().toLowerCase();
}

function tokenizeSearch(value: string) {
  return normalizeSearch(value).split(/\s+/).filter(Boolean);
}

function getItemCommands(item: QuickActionItem) {
  return item.commands ?? (item.command ? [item.command] : []);
}

function getCommandSearchTerms(command: QuickActionCommand) {
  return [command.label, command.kind, ...(command.aliases ?? [])];
}

function itemMatches(item: QuickActionItem, query: string) {
  if (!query) {
    return true;
  }

  const searchable = [
    item.title,
    item.description,
    item.group,
    item.badge ?? '',
    ...getItemCommands(item).flatMap(getCommandSearchTerms),
    ...item.keywords
  ]
    .join(' ')
    .toLowerCase();

  return tokenizeSearch(query).every((token) => searchable.includes(token));
}

function getMatchingCommand(item: QuickActionItem, query: string) {
  if (!query) {
    return undefined;
  }

  return getItemCommands(item).find((command) =>
    getCommandSearchTerms(command).some((term) => query.includes(term.toLowerCase()))
  );
}

function shouldAutoFocusSearch() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return true;
  }

  return window.matchMedia('(pointer: fine)').matches;
}

function getFocusableElements(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true');
}

export function QuickActionPalette({
  items,
  language,
  open,
  onClose,
  onRunCommand,
  onSelect
}: QuickActionPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const t = copy[language];
  const normalizedQuery = normalizeSearch(query);
  const visibleItems = useMemo(
    () => items.filter((item) => itemMatches(item, normalizedQuery)).slice(0, 12),
    [items, normalizedQuery]
  );
  const activeItem = visibleItems[activeIndex] ?? visibleItems[0];
  const totalCommandCount = useMemo(
    () => items.reduce((total, item) => total + getItemCommands(item).length, 0),
    [items]
  );
  const scopeMetrics = [
    { label: t.scope.objects, value: items.length, tone: 'blue' },
    { label: t.scope.commands, value: totalCommandCount, tone: 'orange' },
    { label: t.scope.matches, value: visibleItems.length, tone: 'verify' }
  ] as const;
  const shortcutHints = [
    { key: 'Enter', label: t.shortcuts.open },
    { key: 'Ctrl Enter', label: t.shortcuts.run },
    { key: 'Esc', label: t.shortcuts.close }
  ] as const;

  useEffect(() => {
    if (!open) {
      setQuery('');
      setActiveIndex(0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    window.requestAnimationFrame(() => {
      if (shouldAutoFocusSearch()) {
        searchInputRef.current?.focus();
        return;
      }

      closeButtonRef.current?.focus();
    });
  }, [open]);

  function updateQuery(value: string) {
    setQuery(value);
    setActiveIndex(0);
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' && visibleItems.length > 0) {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % visibleItems.length);
      return;
    }

    if (event.key === 'ArrowUp' && visibleItems.length > 0) {
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + visibleItems.length) % visibleItems.length);
      return;
    }

    if (event.key !== 'Enter' || !activeItem) {
      return;
    }

    event.preventDefault();

    if (onRunCommand) {
      const matchingCommand = getMatchingCommand(activeItem, normalizedQuery);

      if (matchingCommand) {
        onRunCommand(activeItem, matchingCommand);
        return;
      }
    }

    if ((event.ctrlKey || event.metaKey) && onRunCommand) {
      const [command] = getItemCommands(activeItem);

      if (command) {
        onRunCommand(activeItem, command);
        return;
      }
    }

    onSelect(activeItem);
  }

  function handleDialogKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Tab' || !dialogRef.current) {
      return;
    }

    const focusableElements = getFocusableElements(dialogRef.current);

    if (focusableElements.length === 0) {
      event.preventDefault();
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
      return;
    }

    if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  }

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex overscroll-contain bg-[#07111F]/55 p-4 pt-[10vh] max-sm:items-start max-sm:justify-center sm:items-start sm:justify-center"
      data-quick-action-overlay="true"
      onClick={onClose}
    >
      <section
        aria-label={t.title}
        aria-modal="true"
        className="ou-surface w-full max-w-2xl overflow-hidden border border-[#07111F] bg-[#FFFDF5] shadow-[0_28px_84px_-50px_rgba(5,5,5,0.22)] backdrop-blur-xl dark:border-[#E2E8F0]/14 dark:bg-[#101827]"
        onKeyDown={handleDialogKeyDown}
        ref={dialogRef}
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-[#07111F]/12 p-4 dark:border-[#E2E8F0]/10">
          <Search className="h-5 w-5 flex-shrink-0 text-[#1E3AFF] dark:text-[#DDE3FF]" />
          <input
            aria-label={t.placeholder}
            aria-controls="quick-action-results"
            className="min-w-0 flex-1 bg-transparent text-sm font-medium text-[#07111F] outline-none placeholder:text-[#35405A]/72 dark:text-[#F4F8FF] dark:placeholder:text-[#D8E0FF]/64 max-sm:text-base"
            onChange={(event) => updateQuery(event.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder={t.placeholder}
            ref={searchInputRef}
            role="searchbox"
            type="search"
            value={query}
          />
          <button
            aria-label={t.close}
            className="ou-mini-button grid h-8 w-8 flex-shrink-0 touch-manipulation place-items-center rounded-full border border-[#1E3AFF] bg-[#DCE1FF] text-[#1E3AFF] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 hover:bg-[#1E3AFF] hover:text-white dark:border-[#1E3AFF]/35 dark:bg-[#1E3AFF]/14 dark:text-[#DDE3FF] dark:hover:bg-[#1E3AFF] dark:hover:text-[#07111F] dark:focus-visible:ring-primary/55 max-sm:h-11 max-sm:w-11"
            onClick={onClose}
            ref={closeButtonRef}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[min(62vh,520px)] overflow-y-auto p-3">
          <section
            aria-label={t.scopeRegion}
            className="mb-3 grid gap-2 border border-[#07111F]/18 bg-[#EAF3D1]/70 p-2 dark:border-[#E2E8F0]/10 dark:bg-white/[0.04] sm:grid-cols-3"
          >
            {scopeMetrics.map((metric) => (
              <div
                className={cn(
                  'min-w-0 border bg-[#FFFDF5] px-3 py-2 dark:bg-[#07111F]/42',
                  metric.tone === 'blue' &&
                    'border-[#1E3AFF]/35 text-[#1E3AFF] dark:border-[#6B7CFF]/35 dark:text-[#DDE3FF]',
                  metric.tone === 'orange' &&
                    'border-[#FF3D18]/35 text-[#FF3D18] dark:border-[#FF6A3A]/35 dark:text-[#FFB197]',
                  metric.tone === 'verify' &&
                    'border-[#D9FF00] text-[#07111F] dark:border-[#EAFF5A]/35 dark:text-[#F4FFC5]'
                )}
                key={metric.label}
              >
                <p className="truncate text-[10px] font-bold uppercase tracking-[0.08em] opacity-80">{metric.label}</p>
                <p className="mt-1 font-mono text-lg font-black leading-none tabular-nums">{metric.value}</p>
              </div>
            ))}
          </section>

          <ul
            aria-label={t.shortcutsLabel}
            className="mb-3 flex flex-wrap items-center gap-2 border border-[#07111F]/12 bg-[#FFFDF5] p-2 text-[10px] font-semibold text-[#35405A] dark:border-[#E2E8F0]/10 dark:bg-white/[0.03] dark:text-[#D8E0FF]/70"
          >
            {shortcutHints.map((shortcut) => (
              <li className="flex min-h-7 items-center gap-1.5" key={shortcut.key}>
                <kbd className="rounded-full border border-[#07111F]/18 bg-[#07111F]/[0.06] px-2 py-1 font-mono text-[10px] font-bold leading-none text-[#07111F] dark:border-white/10 dark:bg-white/[0.06] dark:text-[#F4F8FF]">
                  {shortcut.key}
                </kbd>
                <span>{shortcut.label}</span>
              </li>
            ))}
          </ul>

          {visibleItems.length > 0 ? (
            <div aria-label={t.results} className="space-y-2" id="quick-action-results" role="list">
              {visibleItems.map((item) => {
                const commands = getItemCommands(item);

                return (
                  <div
                    className={cn(
                      'group flex w-full min-w-0 items-stretch gap-2 border transition-colors hover:border-[#1E3AFF]/30 hover:bg-[#DCE1FF]/55 focus-within:border-[#1E3AFF]/30 focus-within:bg-[#DCE1FF]/55 dark:hover:border-[#1E3AFF]/35 dark:hover:bg-[#1E3AFF]/10 dark:focus-within:border-[#1E3AFF]/35 dark:focus-within:bg-[#1E3AFF]/10 max-sm:flex-col max-sm:gap-0',
                      item.id === activeItem?.id
                        ? 'border-[#1E3AFF] bg-[#DCE1FF] dark:border-[#1E3AFF]/45 dark:bg-[#1E3AFF]/14'
                        : 'border-transparent'
                    )}
                    id={`quick-action-result-${item.id}`}
                    key={item.id}
                    role="listitem"
                  >
                    <button
                      aria-label={item.title}
                      aria-current={item.id === activeItem?.id ? true : undefined}
                      className="flex min-w-0 flex-1 items-center justify-between gap-4 px-4 py-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 dark:focus-visible:ring-primary/55 max-sm:flex-col max-sm:items-start max-sm:gap-3"
                      onClick={() => onSelect(item)}
                      type="button"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-[#07111F] dark:text-[#F4F8FF]">{item.title}</span>
                      </span>
                      <span className="flex flex-shrink-0 items-center gap-2 max-sm:self-stretch max-sm:flex-wrap">
                        <span className="rounded-full border border-[#FF3D18] px-2.5 py-1 text-[10px] font-semibold tracking-[0.08em] text-[#FF3D18] dark:border-[#FF6A3A]/35 dark:text-[#FFB197]">
                          {item.group}
                        </span>
                        {item.badge ? (
                          <span className="rounded-full bg-[#D9FF00]/[0.28] px-2.5 py-1 text-[10px] font-semibold text-[#07111F] dark:bg-[#EAFF5A]/12 dark:text-[#F4FFC5]">
                            {item.badge}
                          </span>
                        ) : null}
                        {commands.length > 0 ? (
                          <span className="rounded-full border border-[#07111F]/20 bg-[#FFFDF5] px-2.5 py-1 text-[10px] font-semibold text-[#35405A] dark:border-white/10 dark:bg-white/5 dark:text-white/64">
                            {t.actionCount(commands.length)}
                          </span>
                        ) : null}
                      </span>
                    </button>
                    {commands.length > 0 && onRunCommand ? (
                      <span className="m-2 flex flex-shrink-0 items-center gap-2 max-sm:mt-0 max-sm:flex-wrap max-sm:border-t max-sm:border-[#07111F]/12 max-sm:pt-2 dark:max-sm:border-[#E2E8F0]/10">
                        {commands.map((command) => (
                          <button
                            aria-label={`${command.label} ${item.title}`}
                            className="ou-mini-button flex min-w-14 touch-manipulation items-center justify-center border border-[#FF3D18] bg-[#FF3D18]/[0.12] px-3 text-xs font-semibold text-[#FF3D18] shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 hover:bg-[#FF3D18] hover:text-white dark:border-[#FF6A3A]/35 dark:bg-[#FF6A3A]/12 dark:text-[#FFB197] dark:hover:bg-[#FF6A3A] dark:hover:text-[#07111F] dark:focus-visible:ring-primary/55 max-sm:min-h-11 max-sm:flex-1"
                            key={`${command.kind}:${command.targetId}:${command.label}`}
                            onClick={() => onRunCommand(item, command)}
                            type="button"
                          >
                            {command.label}
                          </button>
                        ))}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="grid min-h-40 place-items-center border border-dashed border-[#D9FF00] bg-[#D9FF00]/[0.16] p-6 text-center dark:border-[#EAFF5A]/25 dark:bg-[#EAFF5A]/10">
              <div>
                <p className="text-sm font-semibold text-[#07111F] dark:text-[#F4FFC5]">{t.empty}</p>
                <p className="mt-2 text-xs text-[#35405A] dark:text-[#D8E0FF]/72">{t.hint}</p>
              </div>
            </div>
          )}
        </div>

        <p aria-label={t.activeResult} className="sr-only" role="status">
          {activeItem ? activeItem.title : t.empty}
        </p>

        <div className={cn('border-t border-[#07111F]/12 px-4 py-3 dark:border-[#E2E8F0]/10', visibleItems.length === 0 && 'hidden')}>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#35405A] dark:text-[#D8E0FF]/56">
            {t.hint}
          </p>
        </div>
      </section>
    </div>
  );
}
