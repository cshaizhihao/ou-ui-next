import type { ReactNode } from 'react';
import { CalendarPlus, Copy, CopyPlus, Download, Gauge, Pencil, Play, QrCode, RotateCcw, Square, Trash2 } from 'lucide-react';
import { cn } from '../../lib/cn';

type SimpleNodeTableActionsLabels = {
  addTraffic: string;
  copyShare: string;
  copySubscription: string;
  cloneNode: string;
  deleteNode: string;
  disableNode: string;
  editNode: string;
  enableNode: string;
  renewNode: string;
  resetTraffic?: string;
  viewLinks: string;
};

type SimpleNodeTableActionsProps = {
  enabled: boolean;
  labels: SimpleNodeTableActionsLabels;
  onAddTraffic: () => void;
  onCopyShare: () => void;
  onCopySubscription: () => void;
  onClone: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onRenew: () => void;
  onResetTraffic?: () => void;
  onSetEnabled: (enabled: boolean) => void;
  onViewLinks: () => void;
};

function ActionButton({
  danger,
  label,
  onClick,
  children
}: {
  danger?: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      aria-label={label}
      className={cn(
        'inline-flex h-9 w-9 items-center justify-center rounded-lg border text-slate-500 transition hover:bg-slate-50 hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 dark:border-white/10 dark:text-white/55 dark:hover:bg-white/10 dark:hover:text-primary',
        danger
          ? 'border-red-200 text-red-500 hover:bg-red-50 hover:text-red-600 dark:border-red-400/25 dark:text-red-300 dark:hover:bg-red-400/10'
          : 'border-slate-200'
      )}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

export function SimpleNodeTableActions({
  enabled,
  labels,
  onAddTraffic,
  onClone,
  onCopyShare,
  onCopySubscription,
  onDelete,
  onEdit,
  onRenew,
  onResetTraffic,
  onSetEnabled,
  onViewLinks
}: SimpleNodeTableActionsProps) {
  return (
    <div className="flex justify-end gap-2">
      <ActionButton label={labels.viewLinks} onClick={onViewLinks}>
        <QrCode className="h-3.5 w-3.5" />
      </ActionButton>
      <ActionButton label={labels.copyShare} onClick={onCopyShare}>
        <Copy className="h-3.5 w-3.5" />
      </ActionButton>
      <ActionButton label={labels.copySubscription} onClick={onCopySubscription}>
        <Download className="h-3.5 w-3.5" />
      </ActionButton>
      <ActionButton label={labels.cloneNode} onClick={onClone}>
        <CopyPlus className="h-3.5 w-3.5" />
      </ActionButton>
      <ActionButton label={labels.addTraffic} onClick={onAddTraffic}>
        <Gauge className="h-3.5 w-3.5" />
      </ActionButton>
      <ActionButton label={labels.renewNode} onClick={onRenew}>
        <CalendarPlus className="h-3.5 w-3.5" />
      </ActionButton>
      {labels.resetTraffic && onResetTraffic ? (
        <ActionButton label={labels.resetTraffic} onClick={onResetTraffic}>
          <RotateCcw className="h-3.5 w-3.5" />
        </ActionButton>
      ) : null}
      <ActionButton label={enabled ? labels.disableNode : labels.enableNode} onClick={() => onSetEnabled(!enabled)}>
        {enabled ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </ActionButton>
      <ActionButton label={labels.editNode} onClick={onEdit}>
        <Pencil className="h-3.5 w-3.5" />
      </ActionButton>
      <ActionButton danger label={labels.deleteNode} onClick={onDelete}>
        <Trash2 className="h-3.5 w-3.5" />
      </ActionButton>
    </div>
  );
}
