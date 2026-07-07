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
      className="fixed inset-0 z-50 flex overscroll-contain bg-[var(--ou-scrim)] p-4 pt-[10vh] max-sm:items-start max-sm:justify-center sm:items-start sm:justify-center"
      data-quick-action-overlay="true"
      onClick={onClose}
    >
      <section
        aria-label={t.title}
        aria-modal="true"
        className="ou-surface surface-shell w-full max-w-2xl overflow-hidden border"
        onKeyDown={handleDialogKeyDown}
        ref={dialogRef}
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-[var(--ou-divider)] p-4">
          <Search className="h-5 w-5 flex-shrink-0 text-[var(--ou-primary)]" />
          <input
            aria-label={t.placeholder}
            aria-controls="quick-action-results"
            className="min-w-0 flex-1 bg-transparent text-sm font-medium text-[var(--ou-text)] outline-none placeholder:text-[var(--ou-text-subtle)] max-sm:text-base"
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
            className="ou-mini-button ou-tone-primary grid h-8 w-8 flex-shrink-0 touch-manipulation place-items-center rounded-full border focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 max-sm:h-11 max-sm:w-11"
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
            className="mb-3 grid gap-2 border border-[var(--ou-border)] bg-[var(--ou-surface-muted)] p-2 sm:grid-cols-3"
          >
            {scopeMetrics.map((metric) => (
              <div
                className={cn(
                  'min-w-0 border bg-[var(--ou-surface)] px-3 py-2',
                  metric.tone === 'blue' && 'ou-tone-primary',
                  metric.tone === 'orange' && 'ou-tone-danger',
                  metric.tone === 'verify' && 'ou-tone-warning'
                )}
                data-tone={metric.tone === 'blue' ? 'primary' : metric.tone === 'orange' ? 'danger' : 'warning'}
                key={metric.label}
              >
                <p className="truncate text-[10px] font-bold uppercase tracking-[0.08em] opacity-80">{metric.label}</p>
                <p className="mt-1 font-mono text-lg font-black leading-none tabular-nums">{metric.value}</p>
              </div>
            ))}
          </section>

          <ul
            aria-label={t.shortcutsLabel}
            className="mb-3 flex flex-wrap items-center gap-2 border border-[var(--ou-border)] bg-[var(--ou-surface)] p-2 text-[10px] font-semibold text-[var(--ou-text-muted)]"
          >
            {shortcutHints.map((shortcut) => (
              <li className="flex min-h-7 items-center gap-1.5" key={shortcut.key}>
                <kbd className="ou-chip rounded-full border px-2 py-1 font-mono text-[10px] font-bold leading-none">
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
                      'group flex w-full min-w-0 items-stretch gap-2 border transition-colors hover:border-[var(--ou-primary)] hover:bg-[var(--ou-primary-softer)] focus-within:border-[var(--ou-primary)] focus-within:bg-[var(--ou-primary-softer)] max-sm:flex-col max-sm:gap-0',
                      item.id === activeItem?.id
                        ? 'border-[var(--ou-primary)] bg-[var(--ou-primary-soft)]'
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
                        <span className="block truncate text-sm font-semibold text-[var(--ou-text)]">{item.title}</span>
                      </span>
                      <span className="flex flex-shrink-0 items-center gap-2 max-sm:self-stretch max-sm:flex-wrap">
                        <span className="ou-tone-danger rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-[0.08em]">
                          {item.group}
                        </span>
                        {item.badge ? (
                          <span className="ou-tone-warning rounded-full border px-2.5 py-1 text-[10px] font-semibold">
                            {item.badge}
                          </span>
                        ) : null}
                        {commands.length > 0 ? (
                          <span className="ou-chip rounded-full border px-2.5 py-1 text-[10px] font-semibold">
                            {t.actionCount(commands.length)}
                          </span>
                        ) : null}
                      </span>
                    </button>
                    {commands.length > 0 && onRunCommand ? (
                      <span className="m-2 flex flex-shrink-0 items-center gap-2 max-sm:mt-0 max-sm:flex-wrap max-sm:border-t max-sm:border-[var(--ou-divider)] max-sm:pt-2">
                        {commands.map((command) => (
                          <button
                            aria-label={`${command.label} ${item.title}`}
                            className="ou-mini-button ou-tone-danger flex min-w-14 touch-manipulation items-center justify-center border px-3 text-xs font-semibold shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 max-sm:min-h-11 max-sm:flex-1"
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
            <div className="ou-tone-warning grid min-h-40 place-items-center border border-dashed p-6 text-center">
              <div>
                <p className="text-sm font-semibold text-[var(--ou-text)]">{t.empty}</p>
                <p className="mt-2 text-xs text-[var(--ou-text-muted)]">{t.hint}</p>
              </div>
            </div>
          )}
        </div>

        <p aria-label={t.activeResult} className="sr-only" role="status">
          {activeItem ? activeItem.title : t.empty}
        </p>

        <div className={cn('border-t border-[var(--ou-divider)] px-4 py-3', visibleItems.length === 0 && 'hidden')}>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--ou-text-muted)]">
            {t.hint}
          </p>
        </div>
      </section>
    </div>
  );
}
