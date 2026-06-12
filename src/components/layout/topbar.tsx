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
  onOpenQuickActions: () => void;
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
    <header className="taste-v2-topbar flex min-h-20 flex-shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 bg-white/55 px-8 py-4 backdrop-blur-2xl dark:border-white/[0.06] dark:bg-white/[0.025] max-md:min-h-16 max-md:flex-nowrap max-md:gap-2 max-md:px-3 max-md:py-3">
      <div className="min-w-0">
        <h2 className="truncate text-sm font-bold uppercase tracking-widest text-slate-800 dark:text-white max-md:text-xs">{title}</h2>
        <p className="mt-1 truncate font-mono text-[10px] uppercase tracking-widest text-slate-500 dark:text-white/40 max-md:max-w-[44vw] max-md:text-[9px]">
          {subtitle}
        </p>
      </div>

      {showGlobalActions ? (
        <div className="flex flex-wrap items-center gap-3 max-md:flex-nowrap max-md:gap-2">
          <button
            aria-label={isZh ? '打开快速操作' : 'Open quick actions'}
            className="taste-v2-command-pill flex h-9 min-w-[180px] touch-manipulation items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-3 text-left text-xs font-semibold text-slate-500 shadow-sm transition-colors hover:border-blue-200 hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 dark:border-white/10 dark:bg-white/[0.06] dark:text-white/60 dark:hover:border-blue-300/30 dark:hover:text-blue-200 dark:focus-visible:ring-primary/40 max-sm:h-11 max-sm:min-w-11 max-sm:justify-center max-sm:px-0"
            onClick={onOpenQuickActions}
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
            className="grid h-9 w-9 place-items-center rounded-full border border-slate-200 bg-white/80 text-slate-500 shadow-sm transition-colors hover:border-blue-200 hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 dark:border-white/10 dark:bg-white/[0.06] dark:text-white/60 dark:hover:border-blue-300/30 dark:hover:text-blue-200 dark:focus-visible:ring-primary/40"
            onClick={onLogout}
            type="button"
          >
            <LogOut className="h-4 w-4" />
          </button>
          <button
            aria-label={isZh ? '切换深浅主题' : 'Toggle color theme'}
            className="grid h-9 w-9 place-items-center rounded-full border border-slate-200 bg-white/80 text-slate-500 shadow-sm transition-colors hover:border-blue-200 hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 dark:border-white/10 dark:bg-white/[0.06] dark:text-white/60 dark:hover:border-blue-300/30 dark:hover:text-blue-200 dark:focus-visible:ring-primary/40"
            onClick={onToggleTheme}
            type="button"
          >
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-current shadow-[0_0_12px_currentColor]" />
          </button>
        </div>
      ) : null}
    </header>
  );
}
