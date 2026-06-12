import { X } from 'lucide-react';
import { type KeyboardEvent, useEffect, useRef } from 'react';
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

function getFocusableElements(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true');
}

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
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus();
    });
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleWindowKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    }

    window.addEventListener('keydown', handleWindowKeyDown);

    return () => {
      window.removeEventListener('keydown', handleWindowKeyDown);
    };
  }, [onClose, open]);

  function handleDialogKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }

    if (event.key !== 'Tab' || !dialogRef.current) {
      return;
    }

    const focusableElements = getFocusableElements(dialogRef.current);

    if (focusableElements.length === 0) {
      event.preventDefault();
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
      return;
    }

    if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  }

  if (!open) {
    return null;
  }

  return (
    <div
      aria-hidden={!open}
      className={cn('overlay fixed inset-0 z-50 flex items-center justify-center bg-slate-950/32 p-4', open && 'open')}
      onClick={onClose}
    >
      <section
        aria-modal="true"
        aria-label={title}
        role="dialog"
        className={cn(
          'modal-panel ou-surface flex max-h-[min(86vh,620px)] w-full max-w-[520px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white/96 p-6 shadow-2xl backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/92',
          open && 'open'
        )}
        onKeyDown={handleDialogKeyDown}
        ref={dialogRef}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">{title}</h3>
            <p className="mt-2 text-xs leading-6 text-slate-500 dark:text-white/50">{description}</p>
          </div>
          <button
            aria-label={t.close}
            className="ou-mini-button rounded-full bg-slate-100 p-2 text-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 dark:bg-white/5 dark:text-white/60 dark:focus-visible:ring-blue-400"
            onClick={onClose}
            ref={closeButtonRef}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-white/5">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-white/40">
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
            className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 dark:border-white/10 dark:text-white/60 dark:focus-visible:ring-blue-400"
            onClick={onClose}
            type="button"
          >
            {t.cancel}
          </button>
          <GlowButton
            className="px-4 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60"
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
