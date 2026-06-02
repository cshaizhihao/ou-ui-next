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
    close: '关闭抽屉',
    impact: '运行影响',
    cancel: '取消',
    items: [
      '在触达主机代理运行时之前，先生成待下发的配置快照。',
      '记录 task.created 审计事件，并等待后端主机 ACK。',
      '任务完成后标记为可回滚状态，便于受控恢复。'
    ]
  },
  en: {
    close: 'Close drawer',
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

  return (
    <div
      aria-hidden={!open}
      className={cn('overlay fixed inset-0 z-50 bg-slate-950/30', open && 'open')}
      onClick={onClose}
    >
      <aside
        aria-label={title}
        className={cn(
          'drawer-panel absolute right-0 top-0 flex h-full w-full max-w-[420px] flex-col border-l border-slate-200 bg-white/90 p-6 shadow-2xl backdrop-blur-2xl dark:border-white/10 dark:bg-[#0d1017]/90',
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

        <div className="modal-panel mt-6 rounded-2xl border border-slate-200 bg-white/70 p-4 dark:border-white/10 dark:bg-black/20">
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
      </aside>
    </div>
  );
}
