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
    title: '快速操作',
    close: '关闭快速操作',
    placeholder: '搜索页面、主机、客户、转发和订阅',
    activeResult: '当前快速操作结果',
    results: '快速操作结果',
    empty: '没有匹配结果',
    hint: '输入客户、端口、主机、订阅或页面名称'
  },
  en: {
    title: 'Quick Actions',
    close: 'Close quick actions',
    placeholder: 'Search pages, hosts, customers, forwarding, and subscriptions',
    activeResult: 'Current quick action result',
    results: 'Quick action results',
    empty: 'No matches',
    hint: 'Type a customer, port, host, subscription, or page name'
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
  return [command.label, ...(command.aliases ?? [])];
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
      className="fixed inset-0 z-50 flex overscroll-contain bg-slate-950/30 p-4 pt-[10vh] max-sm:items-start max-sm:justify-center sm:items-start sm:justify-center"
      data-quick-action-overlay="true"
      onClick={onClose}
    >
      <section
        aria-label={t.title}
        aria-modal="true"
        className="ou-surface w-full max-w-2xl overflow-hidden border border-black/15 bg-white/96 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-black/90"
        onKeyDown={handleDialogKeyDown}
        ref={dialogRef}
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-black/15 p-4 dark:border-white/10">
          <Search className="h-5 w-5 flex-shrink-0 text-black/35 dark:text-white/40" />
          <input
            aria-label={t.placeholder}
            aria-controls="quick-action-results"
            className="min-w-0 flex-1 bg-transparent text-sm font-medium text-black outline-none placeholder:text-black/38 dark:text-white dark:placeholder:text-white/35 max-sm:text-base"
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
            className="ou-mini-button grid h-8 w-8 flex-shrink-0 touch-manipulation place-items-center rounded-full bg-black/[0.04] text-black/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50 dark:bg-white/5 dark:text-white/60 dark:focus-visible:ring-red-400 max-sm:h-11 max-sm:w-11"
            onClick={onClose}
            ref={closeButtonRef}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[min(62vh,520px)] overflow-y-auto p-3">
          {visibleItems.length > 0 ? (
            <div aria-label={t.results} className="space-y-2" id="quick-action-results" role="list">
              {visibleItems.map((item) => {
                const commands = getItemCommands(item);

                return (
                  <div
                    className={cn(
                      'group flex w-full min-w-0 items-stretch gap-2 border transition-colors hover:border-black/25 hover:bg-black/[0.03] focus-within:border-black/25 focus-within:bg-black/[0.03] dark:hover:border-white/18 dark:hover:bg-white/[0.04] dark:focus-within:border-white/18 dark:focus-within:bg-white/[0.04]',
                      item.id === activeItem?.id
                        ? 'border-black/25 bg-black/[0.03] dark:border-white/18 dark:bg-white/[0.05]'
                        : 'border-transparent'
                    )}
                    id={`quick-action-result-${item.id}`}
                    key={item.id}
                    role="listitem"
                  >
                    <button
                      aria-label={`${item.title} ${item.description}`}
                      aria-current={item.id === activeItem?.id ? true : undefined}
                      className="flex min-w-0 flex-1 items-center justify-between gap-4 px-4 py-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50 dark:focus-visible:ring-red-400"
                      onClick={() => onSelect(item)}
                      type="button"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-black dark:text-white">{item.title}</span>
                        <span className="mt-1 block truncate text-xs text-black/60 dark:text-white/50">
                          {item.description}
                        </span>
                      </span>
                      <span className="flex flex-shrink-0 items-center gap-2">
                        <span className="rounded-full border border-black/15 px-2.5 py-1 text-[10px] font-semibold tracking-[0.08em] text-black/55 dark:border-white/10 dark:text-white/45">
                          {item.group}
                        </span>
                        {item.badge ? (
                          <span className="rounded-full bg-black/[0.04] px-2.5 py-1 text-[10px] font-semibold text-black/55 dark:bg-white/5 dark:text-white/50">
                            {item.badge}
                          </span>
                        ) : null}
                      </span>
                    </button>
                    {commands.length > 0 && onRunCommand ? (
                      <span className="m-2 flex flex-shrink-0 items-center gap-2">
                        {commands.map((command) => (
                          <button
                            aria-label={`${command.label} ${item.title}`}
                            className="ou-mini-button flex min-w-14 touch-manipulation items-center justify-center border border-black/15 bg-white px-3 text-xs font-semibold text-black shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50 dark:border-white/10 dark:bg-white/5 dark:text-white dark:hover:bg-white dark:hover:text-black dark:focus-visible:ring-red-400 max-sm:min-h-11"
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
            <div className="grid min-h-40 place-items-center border border-dashed border-black/18 bg-black/[0.02] p-6 text-center dark:border-white/10 dark:bg-white/5">
              <div>
                <p className="text-sm font-semibold text-black/78 dark:text-white/72">{t.empty}</p>
                <p className="mt-2 text-xs text-black/55 dark:text-white/40">{t.hint}</p>
              </div>
            </div>
          )}
        </div>

        <p aria-label={t.activeResult} className="sr-only" role="status">
          {activeItem ? `${activeItem.title} ${activeItem.description}` : t.empty}
        </p>

        <div className={cn('border-t border-black/15 px-4 py-3 dark:border-white/10', visibleItems.length === 0 && 'hidden')}>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-black/45 dark:text-white/35">
            {t.hint}
          </p>
        </div>
      </section>
    </div>
  );
}
