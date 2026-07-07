import { LogOut, Search } from 'lucide-react';
import type { RefObject } from 'react';
import type { AppLanguage } from '../../app/app-store';
import { LanguageSwitch } from '../ui/language-switch';

type TopbarProps = {
  title: string;
  subtitle?: string;
  language: AppLanguage;
  quickActionScope?: {
    objects: number;
    commands: number;
  };
  showGlobalActions?: boolean;
  onLanguageChange: (language: AppLanguage) => void;
  onLogout: () => void;
  onOpenQuickActions: (returnFocusTarget?: HTMLElement | null) => void;
  onToggleTheme: () => void;
  quickActionButtonRef?: RefObject<HTMLButtonElement | null>;
};

export function Topbar({
  title,
  language,
  quickActionScope,
  showGlobalActions = true,
  onLanguageChange,
  onLogout,
  onOpenQuickActions,
  onToggleTheme,
  quickActionButtonRef
}: TopbarProps) {
  const isZh = language === 'zh';
  const searchLabel = isZh ? '搜索控制面' : 'Search control plane';
  const objectLabel = quickActionScope
    ? isZh
      ? `${quickActionScope.objects} 对象`
      : `${quickActionScope.objects} ${quickActionScope.objects === 1 ? 'object' : 'objects'}`
    : undefined;
  const commandLabel = quickActionScope
    ? isZh
      ? `${quickActionScope.commands} 动作`
      : `${quickActionScope.commands} ${quickActionScope.commands === 1 ? 'action' : 'actions'}`
    : undefined;

  return (
    <header className="control-plane-topbar ou-shell-topbar flex min-h-20 flex-shrink-0 flex-wrap items-center justify-between gap-3 border-b px-8 py-4 max-md:min-h-16 max-md:flex-nowrap max-md:gap-2 max-md:px-3 max-md:py-3">
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold tracking-tight text-[var(--ou-text)] max-md:text-xs">{title}</h2>
      </div>

      {showGlobalActions ? (
        <div className="flex flex-wrap items-center gap-3 max-md:flex-nowrap max-md:gap-2">
          <button
            aria-label={isZh ? '打开控制面搜索' : 'Open control-plane search'}
            className="control-plane-search-trigger ou-command-pill flex h-10 min-w-[320px] max-w-[420px] touch-manipulation items-center gap-2 rounded-full border px-3 text-left text-xs font-medium shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 max-md:hidden"
            onClick={(event) => onOpenQuickActions(event.currentTarget)}
            ref={quickActionButtonRef}
            type="button"
          >
            <Search className="h-4 w-4 flex-shrink-0" />
            <span className="min-w-0 flex-1 truncate max-sm:hidden">{searchLabel}</span>
            {quickActionScope ? (
              <span className="flex flex-shrink-0 items-center gap-1.5 font-mono text-[10px] font-bold leading-none tabular-nums">
                <span className="control-plane-search-scope-chip rounded-full border px-2 py-1">
                  {objectLabel}
                </span>
                <span className="control-plane-search-scope-chip ou-tone-danger rounded-full border px-2 py-1">
                  {commandLabel}
                </span>
              </span>
            ) : null}
            <span className="ou-chip flex-shrink-0 rounded-full border px-2 py-1 font-mono text-[10px] font-bold leading-none">
              Ctrl K
            </span>
          </button>
          <LanguageSwitch
            ariaLabel={isZh ? '语言切换' : 'Language switcher'}
            language={language}
            onLanguageChange={onLanguageChange}
          />
          <button
            aria-label={isZh ? '退出登录' : 'Sign out'}
            className="ou-mini-button ou-tone-danger grid h-9 w-9 place-items-center border shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45"
            onClick={onLogout}
            type="button"
          >
            <LogOut className="h-4 w-4" />
          </button>
          <button
            aria-label={isZh ? '切换深浅主题' : 'Toggle color theme'}
            className="ou-mini-button ou-tone-warning grid h-9 w-9 place-items-center border shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45"
            onClick={onToggleTheme}
            type="button"
          >
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-current" />
          </button>
        </div>
      ) : null}
    </header>
  );
}
