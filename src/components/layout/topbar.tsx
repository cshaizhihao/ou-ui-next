import { LogOut, Search } from 'lucide-react';
import type { RefObject } from 'react';
import type { AppLanguage } from '../../app/app-store';
import { LanguageSwitch } from '../ui/language-switch';

type TopbarProps = {
  title: string;
  subtitle: string;
  language: AppLanguage;
  showGlobalActions?: boolean;
  onLanguageChange: (language: AppLanguage) => void;
  onLogout: () => void;
  onOpenQuickActions: (returnFocusTarget?: HTMLElement | null) => void;
  onToggleTheme: () => void;
  quickActionButtonRef?: RefObject<HTMLButtonElement | null>;
};

export function Topbar({
  title,
  subtitle,
  language,
  showGlobalActions = true,
  onLanguageChange,
  onLogout,
  onOpenQuickActions,
  onToggleTheme,
  quickActionButtonRef
}: TopbarProps) {
  const isZh = language === 'zh';

  return (
    <header className="flex min-h-20 flex-shrink-0 flex-wrap items-center justify-between gap-3 border-b border-black/15 bg-white/90 px-8 py-4 backdrop-blur-xl dark:border-white/10 dark:bg-black/28 max-md:min-h-16 max-md:flex-nowrap max-md:gap-2 max-md:px-3 max-md:py-3">
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold tracking-tight text-black dark:text-white max-md:text-xs">{title}</h2>
        <p className="mt-1 truncate text-[10px] font-medium text-black/60 dark:text-white/50 max-md:max-w-[44vw] max-md:text-[9px]">
          {subtitle}
        </p>
      </div>

      {showGlobalActions ? (
        <div className="flex flex-wrap items-center gap-3 max-md:flex-nowrap max-md:gap-2">
          <button
            aria-label={isZh ? '打开快速操作' : 'Open quick actions'}
            className="ou-command-pill flex h-9 min-w-[180px] touch-manipulation items-center gap-2 rounded-full border border-primary/20 bg-white/95 px-3 text-left text-xs font-medium text-[#07111F]/72 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 dark:border-primary/25 dark:bg-white/[0.06] dark:text-white/72 dark:focus-visible:ring-primary/55 max-md:hidden"
            onClick={(event) => onOpenQuickActions(event.currentTarget)}
            ref={quickActionButtonRef}
            type="button"
          >
            <Search className="h-4 w-4 flex-shrink-0" />
            <span className="truncate max-sm:hidden">{isZh ? '搜索资源 / 页面' : 'Search resources'}</span>
          </button>
          <LanguageSwitch
            ariaLabel={isZh ? '语言切换' : 'Language switcher'}
            language={language}
            onLanguageChange={onLanguageChange}
          />
          <button
            aria-label={isZh ? '退出登录' : 'Sign out'}
            className="ou-mini-button grid h-9 w-9 place-items-center rounded-full border border-primary/20 bg-white/95 text-primary/75 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 dark:border-primary/25 dark:bg-white/[0.06] dark:text-primary/80 dark:focus-visible:ring-primary/55"
            onClick={onLogout}
            type="button"
          >
            <LogOut className="h-4 w-4" />
          </button>
          <button
            aria-label={isZh ? '切换深浅主题' : 'Toggle color theme'}
            className="ou-mini-button grid h-9 w-9 place-items-center rounded-full border border-primary/20 bg-white/95 text-accent/80 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 dark:border-primary/25 dark:bg-white/[0.06] dark:text-accent/80 dark:focus-visible:ring-primary/55"
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
