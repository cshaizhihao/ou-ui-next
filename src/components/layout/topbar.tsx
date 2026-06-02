import type { AppLanguage } from '../../app/app-store';
import { cn } from '../../lib/cn';
import { GlowButton } from '../ui/glow-button';

type TopbarProps = {
  title: string;
  subtitle: string;
  language: AppLanguage;
  onDeployRuntimeConfig: () => void;
  onLanguageChange: (language: AppLanguage) => void;
  onToggleTheme: () => void;
};

export function Topbar({
  title,
  subtitle,
  language,
  onDeployRuntimeConfig,
  onLanguageChange,
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

      <div className="flex flex-wrap items-center gap-3">
        <div
          aria-label={isZh ? '语言切换' : 'Language switcher'}
          className="flex rounded-full border border-slate-200 bg-slate-100 p-1 dark:border-white/10 dark:bg-white/5"
          role="group"
        >
          {(['zh', 'en'] as const).map((item) => (
            <button
              className={cn(
                'min-w-16 rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-colors',
                language === item
                  ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/20 dark:bg-primary dark:text-black'
                  : 'text-slate-500 hover:text-slate-800 dark:text-white/50 dark:hover:text-white'
              )}
              key={item}
              onClick={() => onLanguageChange(item)}
              type="button"
            >
              {item === 'zh' ? '中文' : 'English'}
            </button>
          ))}
        </div>
        <button
          aria-label={isZh ? '切换深浅主题' : 'Toggle color theme'}
          className="rounded-full bg-slate-100 p-2 text-slate-500 transition-colors hover:text-primary focus:outline-none dark:bg-white/5 dark:text-white/60"
          onClick={onToggleTheme}
          type="button"
        >
          <span aria-hidden="true">●</span>
        </button>
        <div className="mx-1 h-5 w-px bg-slate-300 dark:bg-white/10" />
        <GlowButton className="text-xs" onClick={onDeployRuntimeConfig}>
          <span>{isZh ? '下发运行时配置' : 'Deploy Runtime Config'}</span>
        </GlowButton>
      </div>
    </header>
  );
}
