import { X } from 'lucide-react';
import type { AppLanguage } from '../../app/app-store';
import { cn } from '../../lib/cn';
import { GlowButton } from '../ui/glow-button';

type ActionOverlayProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  confirmDisabled?: boolean;
  language: AppLanguage;
  onClose: () => void;
  onConfirm: () => void;
};

const copy = {
  zh: {
    close: '关闭浮窗',
    impact: '运行影响',
    cancel: '取消',
    items: [
      '应用前先生成配置快照，避免直接覆盖当前主机状态。',
      '通知主机代理执行变更，并等待主机回传确认结果。',
      '成功后保留回滚点，便于需要时恢复上一版配置。'
    ]
  },
  en: {
    close: 'Close dialog',
    impact: 'Runtime Impact',
    cancel: 'Cancel',
    items: [
      'Create a pending configuration snapshot before touching the host agent runtime.',
      'Record a task.created audit event and wait for the host ACK.',
      'Mark the task rollback-ready after completion for controlled recovery.'
    ]
  }
} as const;

export function ActionOverlay({
  open,
  title,
  description,
  confirmLabel,
  confirmDisabled = false,
  language,
  onClose,
  onConfirm
}: ActionOverlayProps) {
  const t = copy[language];

  if (!open) {
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
          'modal-panel flex max-h-[min(86vh,620px)] w-full max-w-[520px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white/95 p-6 shadow-2xl backdrop-blur-2xl dark:border-white/10 dark:bg-[#0d1017]/95',
          open && 'open'
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">{title}</h3>
            <p className="mt-2 text-xs leading-6 text-slate-500 dark:text-white/50">{description}</p>
          </div>
          <button
            aria-label={t.close}
            className="rounded-full bg-slate-100 p-2 text-slate-500 transition-colors hover:text-primary dark:bg-white/5 dark:text-white/60"
            onClick={onClose}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-white/5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
            {t.impact}
          </p>
          <div className="mt-4 space-y-3 text-xs text-slate-600 dark:text-white/60">
            {t.items.map((item, index) => (
              <p key={item}>
                {index + 1}. {item}
              </p>
            ))}
          </div>
        </div>

        <div className="mt-auto flex items-center justify-end gap-3 pt-6">
          <button
            className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 dark:border-white/10 dark:text-white/60"
            onClick={onClose}
            type="button"
          >
            {t.cancel}
          </button>
          <GlowButton
            className="px-4 py-2 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-60"
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel}
          </GlowButton>
        </div>
      </section>
    </div>
  );
}
