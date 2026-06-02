import type { AppLanguage } from '../../app/app-store';
import { getNavigationItems, type PageId } from '../../app/navigation';
import { cn } from '../../lib/cn';
import { BrandLogo } from './brand-logo';

type SidebarProps = {
  activePage: PageId;
  language: AppLanguage;
  onPageChange: (pageId: PageId) => void;
};

export function Sidebar({ activePage, language, onPageChange }: SidebarProps) {
  const navigationItems = getNavigationItems(language);

  return (
    <aside className="island-panel w-[240px] flex-shrink-0 max-md:max-h-[420px] max-md:w-full">
      <div className="flex h-20 shrink-0 items-center border-b border-slate-200 px-6 dark:border-white/[0.06]">
        <div className="mr-3 flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-slate-100 dark:border-white/10 dark:bg-white/5">
          <BrandLogo />
        </div>
        <h1 className="text-base font-bold tracking-widest text-slate-900 dark:text-white">OU-UI NEXT</h1>
      </div>

      <nav className="flex-1 space-y-1.5 overflow-y-auto px-4 py-6 max-md:grid max-md:grid-cols-2 max-md:gap-2 max-md:space-y-0">
        <p className="mb-3 px-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40 max-md:col-span-2 max-md:mb-0">
          {language === 'zh' ? '核心系统' : 'Core System'}
        </p>
        {navigationItems.map((item) => (
          <button
            aria-label={item.label}
            className={cn(
              'nav-item flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-all',
              activePage === item.id
                ? 'nav-active border-blue-200 bg-blue-50 text-blue-600 dark:border-primary/20 dark:bg-primary/15 dark:text-primary'
                : 'border-transparent text-slate-600 hover:bg-slate-100 dark:text-white/60 dark:hover:bg-white/5'
            )}
            key={item.id}
            onClick={() => onPageChange(item.id)}
            type="button"
          >
            <span className="flex min-w-0 flex-col">
              <span className="text-sm font-bold tracking-wide">{item.label}</span>
              <span className="mt-0.5 truncate font-mono text-[9px] uppercase tracking-widest opacity-60">
                {item.description}
              </span>
            </span>
          </button>
        ))}
      </nav>

      <div className="shrink-0 p-5 max-md:hidden">
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-100 p-3 dark:border-white/10 dark:bg-white/5">
          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-xs font-bold text-slate-800 shadow-sm dark:border-white/10 dark:bg-black dark:text-white">
            M
          </div>
          <div>
            <p className="text-xs font-bold tracking-wide text-slate-800 dark:text-white">Master Node</p>
            <p className="mt-0.5 font-mono text-[9px] uppercase tracking-widest text-slate-500 dark:text-white/50">
              {language === 'zh' ? '控制面主节点' : 'Control Plane'}
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
}
