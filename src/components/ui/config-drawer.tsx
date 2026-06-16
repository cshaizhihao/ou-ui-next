import { X } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { cn } from '../../lib/cn';

type ConfigDrawerProps = {
  children: ReactNode;
  description?: string;
  headerActions?: ReactNode;
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

export function ConfigDrawer({
  children,
  description,
  footer,
  headerActions,
  open,
  returnFocusRef,
  title,
  onClose
}: ConfigDrawerProps) {
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
      className={cn('overlay ou-drawer-overlay fixed inset-0 z-50 flex items-center justify-center bg-[#07111F]/54 p-4', open && 'open')}
      ref={overlayRef}
      onClick={onClose}
    >
      <section
        aria-modal="true"
        aria-label={title}
        role="dialog"
        className={cn(
          'modal-panel ou-config-drawer flex max-h-[min(88vh,760px)] w-full max-w-[720px] flex-col overflow-hidden border border-[#07111F] bg-[#FFFDF5] shadow-[0_28px_84px_-50px_rgba(7,17,31,0.42)] dark:border-[#6B7CFF]/28 dark:bg-[#101827] dark:shadow-[0_30px_96px_-54px_rgba(0,0,0,0.92)] max-md:max-h-[92vh]',
          open && 'open'
        )}
        onKeyDown={handleDialogKeyDown}
        ref={dialogRef}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-[#07111F]/18 bg-[#DCE1FF]/55 p-6 dark:border-[#6B7CFF]/20 dark:bg-[#192238] max-md:p-4">
          <div className="flex items-start justify-between gap-4 max-md:flex-col max-md:items-stretch">
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-semibold text-[#07111F] dark:text-white">{title}</h3>
              {description ? (
                <p className="mt-2 text-xs leading-6 text-[#35405A] dark:text-[#D8E0FF]/72">{description}</p>
              ) : null}
              {headerActions ? <div className="mt-3 flex flex-wrap gap-2">{headerActions}</div> : null}
            </div>
            <button
              aria-label="Close"
              className="ou-mini-button ou-drawer-close border border-[#1E3AFF]/32 bg-[#FFFDF5] p-2 text-[#1E3AFF] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 hover:border-[#1E3AFF] hover:bg-[#DCE1FF] dark:border-[#6B7CFF]/32 dark:bg-[#101827] dark:text-[#DDE3FF] dark:focus-visible:ring-primary/55 dark:hover:bg-[#6B7CFF]/14"
              onClick={onClose}
              ref={closeButtonRef}
              type="button"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-[#FFFDF5] p-6 dark:bg-[#101827]">{children}</div>

        {footer ? (
          <div className="border-t border-[#07111F]/18 bg-[#EAF3D1]/70 p-4 dark:border-[#6B7CFF]/20 dark:bg-[#192238]">{footer}</div>
        ) : null}
      </section>
    </div>
  );
}
