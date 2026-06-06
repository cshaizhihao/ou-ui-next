import { X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

type ConfigDrawerProps = {
  children: ReactNode;
  description?: string;
  footer?: ReactNode;
  open: boolean;
  title: string;
  onClose: () => void;
};

export function ConfigDrawer({ children, description, footer, open, title, onClose }: ConfigDrawerProps) {
  const [rendered, setRendered] = useState(open);

  useEffect(() => {
    if (open) {
      setRendered(true);
      return undefined;
    }

    const timeoutId = window.setTimeout(() => setRendered(false), 450);

    return () => window.clearTimeout(timeoutId);
  }, [open]);

  if (!rendered) {
    return null;
  }

  return (
    <div
      aria-hidden={!open}
      className={cn('overlay fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4', open && 'open')}
      onClick={onClose}
    >
      <section
        aria-modal="true"
        aria-label={title}
        role="dialog"
        className={cn(
          'modal-panel flex max-h-[min(88vh,760px)] w-full max-w-[720px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white/95 shadow-2xl backdrop-blur-2xl dark:border-white/10 dark:bg-[#0d1017]/95 max-md:max-h-[92vh]',
          open && 'open'
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-slate-200 p-6 dark:border-white/10">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">{title}</h3>
              {description ? (
                <p className="mt-2 text-xs leading-6 text-slate-500 dark:text-white/50">{description}</p>
              ) : null}
            </div>
            <button
              aria-label="Close"
              className="rounded-full bg-slate-100 p-2 text-slate-500 transition-colors hover:text-primary dark:bg-white/5 dark:text-white/60"
              onClick={onClose}
              type="button"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">{children}</div>

        {footer ? (
          <div className="border-t border-slate-200 p-4 dark:border-white/10">{footer}</div>
        ) : null}
      </section>
    </div>
  );
}
