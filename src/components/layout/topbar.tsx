import { LogOut, Search } from 'lucide-react';
import type { RefObject } from 'react';
import type { AppLanguage } from '../../app/app-store';
import { LanguageSwitch } from '../ui/language-switch';

type TopbarProps = {
  title: string;
  subtitle: string;
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
  subtitle,
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
    <header className="flex min-h-20 flex-shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[#07111F] bg-[#FFFDF5] px-8 py-4 shadow-[0_16px_34px_-34px_rgba(7,17,31,0.42)] backdrop-blur-xl dark:border-[#6B7CFF]/25 dark:bg-[#101827] max-md:min-h-16 max-md:flex-nowrap max-md:gap-2 max-md:px-3 max-md:py-3">
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold tracking-tight text-[#07111F] dark:text-white max-md:text-xs">{title}</h2>
        <p className="mt-1 truncate text-[10px] font-medium text-[#35405A] dark:text-white/55 max-md:max-w-[44vw] max-md:text-[9px]">
          {subtitle}
        </p>
      </div>

      {showGlobalActions ? (
        <div className="flex flex-wrap items-center gap-3 max-md:flex-nowrap max-md:gap-2">
          <button
            aria-label={isZh ? '打开控制面搜索' : 'Open control-plane search'}
            className="ou-command-pill flex h-10 min-w-[300px] max-w-[380px] touch-manipulation items-center gap-2 rounded-full border border-[#1E3AFF] bg-[#DCE1FF] px-3 text-left text-xs font-medium text-[#1E3AFF] shadow-sm shadow-[#1E3AFF]/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 dark:border-[#6B7CFF]/35 dark:bg-[#6B7CFF]/14 dark:text-[#DDE3FF] dark:focus-visible:ring-primary/55 max-md:hidden"
            onClick={(event) => onOpenQuickActions(event.currentTarget)}
            ref={quickActionButtonRef}
            type="button"
          >
            <Search className="h-4 w-4 flex-shrink-0" />
            <span className="min-w-0 flex-1 truncate max-sm:hidden">{searchLabel}</span>
            {quickActionScope ? (
              <span className="flex flex-shrink-0 items-center gap-1.5 font-mono text-[10px] font-bold leading-none tabular-nums">
                <span className="rounded-full border border-[#1E3AFF]/24 bg-[#FFFDF5]/82 px-2 py-1 text-[#07111F] dark:border-[#6B7CFF]/24 dark:bg-white/[0.07] dark:text-[#DDE3FF]">
                  {objectLabel}
                </span>
                <span className="rounded-full border border-[#FF3D18]/26 bg-[#FF3D18]/[0.1] px-2 py-1 text-[#FF3D18] dark:border-[#FF6A3A]/26 dark:bg-[#FF6A3A]/12 dark:text-[#FFB197]">
                  {commandLabel}
                </span>
              </span>
            ) : null}
            <span className="flex-shrink-0 rounded-full border border-[#07111F]/18 bg-[#07111F]/[0.06] px-2 py-1 font-mono text-[10px] font-bold leading-none text-[#35405A] dark:border-white/10 dark:bg-white/[0.06] dark:text-[#D8E0FF]/72">
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
            className="ou-mini-button grid h-9 w-9 place-items-center rounded-full border border-[#FF3D18] bg-[#FF3D18]/[0.12] text-[#FF3D18] shadow-sm shadow-[#FF3D18]/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 dark:border-[#FF6A3A]/35 dark:bg-[#FF6A3A]/12 dark:text-[#FFB197] dark:focus-visible:ring-primary/55"
            onClick={onLogout}
            type="button"
          >
            <LogOut className="h-4 w-4" />
          </button>
          <button
            aria-label={isZh ? '切换深浅主题' : 'Toggle color theme'}
            className="ou-mini-button grid h-9 w-9 place-items-center rounded-full border border-[#D9FF00] bg-[#D9FF00]/[0.28] text-[#07111F] shadow-sm shadow-[#D9FF00]/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 dark:border-[#EAFF5A]/35 dark:bg-[#EAFF5A]/12 dark:text-[#F4FFC5] dark:focus-visible:ring-primary/55"
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
