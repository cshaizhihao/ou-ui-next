import { X } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { cn } from '../../lib/cn';

type ConfigDrawerProps = {
  children: ReactNode;
  description?: string;
  footer?: ReactNode;
  open: boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
  title: string;
  onClose: () => void;
};

function getFocusableElements(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true');
}

function getActiveReturnTarget() {
  if (typeof document === 'undefined' || !(document.activeElement instanceof HTMLElement)) {
    return undefined;
  }

  if (document.activeElement === document.body || document.activeElement === document.documentElement) {
    return undefined;
  }

  return document.activeElement;
}

export function ConfigDrawer({ children, description, footer, open, returnFocusRef, title, onClose }: ConfigDrawerProps) {
  const [rendered, setRendered] = useState(open);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const capturedReturnFocusRef = useRef<HTMLElement | null>(null);
  const openRef = useRef(open);

  openRef.current = open;

  useEffect(() => {
    if (open) {
      setRendered(true);
      return undefined;
    }

    const timeoutId = window.setTimeout(() => setRendered(false), 450);

    return () => window.clearTimeout(timeoutId);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    capturedReturnFocusRef.current = getActiveReturnTarget() ?? null;
  }, [open]);

  useEffect(() => {
    if (!open || !rendered) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      if (!openRef.current || !dialogRef.current || overlayRef.current?.getAttribute('aria-hidden') === 'true') {
        return;
      }

      if (dialogRef.current?.contains(document.activeElement)) {
        return;
      }

      closeButtonRef.current?.focus();
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [open, rendered]);

  useEffect(() => {
    if (open) {
      return;
    }

    const returnTarget = capturedReturnFocusRef.current;
    capturedReturnFocusRef.current = null;

    window.setTimeout(() => {
      if (returnTarget?.isConnected) {
        returnTarget.focus();
        return;
      }

      if (returnFocusRef?.current?.isConnected) {
        returnFocusRef.current.focus();
      }
    }, 0);
  }, [open, returnFocusRef]);

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

  useEffect(() => {
    if (!open || !rendered || !overlayRef.current?.parentElement) {
      return;
    }

    const siblings = Array.from(overlayRef.current.parentElement.children)
      .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== overlayRef.current)
      .map((element) => ({
        element,
        ariaHidden: element.getAttribute('aria-hidden'),
        inert: element.hasAttribute('inert')
      }));

    siblings.forEach(({ element }) => {
      element.setAttribute('aria-hidden', 'true');
      element.setAttribute('inert', '');
    });

    return () => {
      siblings.forEach(({ element, ariaHidden, inert }) => {
        if (ariaHidden === null) {
          element.removeAttribute('aria-hidden');
        } else {
          element.setAttribute('aria-hidden', ariaHidden);
        }

        if (!inert) {
          element.removeAttribute('inert');
        }
      });
    };
  }, [open, rendered]);

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

  if (!rendered) {
    return null;
  }

  return (
    <div
      aria-hidden={!open}
      className={cn('overlay fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4', open && 'open')}
      ref={overlayRef}
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
        onKeyDown={handleDialogKeyDown}
        ref={dialogRef}
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
              className="rounded-full bg-slate-100 p-2 text-slate-500 transition-colors hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 dark:bg-white/5 dark:text-white/60 dark:focus-visible:ring-primary/40"
              onClick={onClose}
              ref={closeButtonRef}
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
