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
    cancel: '取消'
  },
  en: {
    close: 'Close dialog',
    cancel: 'Cancel'
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
      className={cn('overlay fixed inset-0 z-50 flex items-center justify-center bg-[#07111F]/55 p-4', open && 'open')}
      onClick={onClose}
      data-action-overlay="true"
    >
      <section
        aria-modal="true"
        aria-label={title}
        role="dialog"
        className={cn(
          'modal-panel ou-surface flex max-h-[min(86vh,620px)] w-full max-w-[520px] flex-col overflow-hidden border border-[#FF3D18] bg-[#FFFDF5] p-6 shadow-[0_28px_84px_-50px_rgba(5,5,5,0.22)] backdrop-blur-xl dark:border-[#FF6A3A]/35 dark:bg-[#101827]',
          open && 'open'
        )}
        onKeyDown={handleDialogKeyDown}
        ref={dialogRef}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-[#07111F] dark:text-[#F4F8FF]">{title}</h3>
            <p className="mt-2 text-xs leading-6 text-[#35405A] dark:text-[#D8E0FF]/72">{description}</p>
          </div>
          <button
            aria-label={t.close}
            className="ou-mini-button rounded-full border border-[#1E3AFF] bg-[#DCE1FF] p-2 text-[#1E3AFF] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 hover:bg-[#1E3AFF] hover:text-white dark:border-[#1E3AFF]/35 dark:bg-[#1E3AFF]/14 dark:text-[#DDE3FF] dark:hover:bg-[#1E3AFF] dark:hover:text-[#07111F] dark:focus-visible:ring-primary/55"
            onClick={onClose}
            ref={closeButtonRef}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-auto flex items-center justify-end gap-3 pt-6">
          <button
            className="border border-[#07111F]/25 px-4 py-2 text-xs font-semibold text-[#35405A] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 hover:border-[#1E3AFF] hover:text-[#1E3AFF] dark:border-[#E2E8F0]/10 dark:text-[#D8E0FF]/72 dark:focus-visible:ring-primary/55"
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
