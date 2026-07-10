import { AlertTriangle, CheckCircle2, Clock3, Copy, ExternalLink, Info } from 'lucide-react';
import { cn } from '../../lib/cn';

export type OperatorWorkbenchState = 'ready' | 'attention' | 'blocked' | 'waiting';

export type OperatorWorkbenchItem = {
  id: string;
  label: string;
  value: string;
  state: OperatorWorkbenchState;
  description?: string;
  meta?: string;
  actionLabel?: string;
  onAction?: () => void;
  actionDisabled?: boolean;
};

type OperatorWorkbenchPanelProps = {
  title: string;
  items: OperatorWorkbenchItem[];
  className?: string;
  copyLabel?: string;
  onCopyDiagnostics?: () => void;
  subtitle?: string;
};

const stateIcon = {
  ready: CheckCircle2,
  attention: Info,
  blocked: AlertTriangle,
  waiting: Clock3
} satisfies Record<OperatorWorkbenchState, typeof CheckCircle2>;

export function OperatorWorkbenchPanel({
  className,
  copyLabel,
  items,
  onCopyDiagnostics,
  subtitle,
  title
}: OperatorWorkbenchPanelProps) {
  return (
    <section
      aria-label={title}
      className={cn('operator-workbench-panel border bg-[var(--ou-surface)] p-3', className)}
      data-operator-workbench-panel
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--ou-primary)]">
            {title}
          </p>
          {subtitle ? <p className="mt-1 max-w-4xl text-xs leading-5 text-[var(--ou-text-muted)]">{subtitle}</p> : null}
        </div>
        {onCopyDiagnostics ? (
          <button
            aria-label={copyLabel}
            className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 border border-[var(--ou-border-strong)] bg-[var(--ou-surface-muted)] px-3 text-xs font-semibold text-[var(--ou-text)] transition duration-200 hover:border-[var(--ou-primary)] hover:text-[var(--ou-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ou-ring)] disabled:cursor-not-allowed disabled:opacity-50"
            onClick={onCopyDiagnostics}
            type="button"
          >
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            {copyLabel}
          </button>
        ) : null}
      </div>

      <div className="mt-3 grid gap-2 xl:grid-cols-4" role="list">
        {items.map((item) => {
          const Icon = stateIcon[item.state];

          return (
            <article
              className="operator-workbench-item min-w-0 border bg-[var(--ou-surface-muted)] p-3"
              data-operator-workbench-state={item.state}
              key={item.id}
              role="listitem"
            >
              <div className="flex min-w-0 items-start gap-2.5">
                <span
                  className="operator-workbench-state-icon mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center border"
                  data-operator-workbench-state={item.state}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <p className="min-w-0 break-words text-xs font-semibold text-[var(--ou-text)]">{item.label}</p>
                    <span
                      className="operator-workbench-state-pill inline-flex min-h-6 shrink-0 items-center border px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.08em]"
                      data-operator-workbench-state={item.state}
                    >
                      {item.state}
                    </span>
                  </div>
                  <p className="mt-1 break-words text-lg font-semibold leading-6 text-[var(--ou-text)]">{item.value}</p>
                  {item.meta ? (
                    <p className="mt-1 break-words font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--ou-text-muted)]">
                      {item.meta}
                    </p>
                  ) : null}
                  {item.description ? (
                    <p className="mt-2 break-words text-[11px] font-medium leading-5 text-[var(--ou-text-muted)]">
                      {item.description}
                    </p>
                  ) : null}
                </div>
              </div>
              {item.actionLabel && item.onAction ? (
                <button
                  className="mt-3 inline-flex min-h-9 w-full items-center justify-center gap-1.5 border border-[var(--ou-border-strong)] bg-[var(--ou-surface)] px-3 text-xs font-semibold text-[var(--ou-text)] transition duration-200 hover:border-[var(--ou-primary)] hover:bg-[var(--ou-primary-soft)] hover:text-[var(--ou-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ou-ring)] disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={item.actionDisabled}
                  onClick={item.onAction}
                  type="button"
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  {item.actionLabel}
                </button>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
