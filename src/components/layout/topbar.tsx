import { LogOut } from 'lucide-react';
import type { AppLanguage } from '../../app/app-store';
import { LanguageSwitch } from '../ui/language-switch';

type TopbarProps = {
  title: string;
  subtitle: string;
  language: AppLanguage;
  showGlobalActions?: boolean;
  onLanguageChange: (language: AppLanguage) => void;
  onLogout: () => void;
  onToggleTheme: () => void;
};

export function Topbar({
  title,
  subtitle,
  language,
  showGlobalActions = true,
  onLanguageChange,
  onLogout,
  onToggleTheme
}: TopbarProps) {
  const isZh = language === 'zh';

  return (
    <header className="flex min-h-20 flex-shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white/60 px-8 py-4 dark:border-white/[0.06] dark:bg-black/20 max-md:px-4">
      <div>
        <h2 className="text-sm font-bold uppercase tracking-widest text-slate-800 dark:text-white">{title}</h2>
        <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-slate-500 dark:text-white/40">
          {subtitle}
        </p>
      </div>

      {showGlobalActions ? (
        <div className="flex flex-wrap items-center gap-3">
          <LanguageSwitch
            ariaLabel={isZh ? '语言切换' : 'Language switcher'}
            language={language}
            onLanguageChange={onLanguageChange}
          />
          <button
            aria-label={isZh ? '退出登录' : 'Sign out'}
            className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-slate-500 transition-colors hover:text-primary focus:outline-none dark:bg-white/5 dark:text-white/60"
            onClick={onLogout}
            type="button"
          >
            <LogOut className="h-4 w-4" />
          </button>
          <button
            aria-label={isZh ? '切换深浅主题' : 'Toggle color theme'}
            className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-slate-500 transition-colors hover:text-primary focus:outline-none dark:bg-white/5 dark:text-white/60"
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
