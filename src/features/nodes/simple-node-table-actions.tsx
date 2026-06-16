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
        'nodes-node-action-button inline-flex h-9 w-9 shrink-0 items-center justify-center border border-[#07111F]/18 bg-[#FFFDF5]/72 text-[#35405A] transition hover:border-[#1E3AFF]/55 hover:bg-[#DCE1FF]/60 hover:text-[#1E3AFF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3AFF]/35 dark:border-[#6B7CFF]/18 dark:bg-white/[0.035] dark:text-white/60 dark:hover:border-[#6B7CFF]/35 dark:hover:bg-[#6B7CFF]/12 dark:hover:text-[#DCE1FF]',
        danger
          ? 'border-[#DC2626]/42 text-[#B91C1C] hover:border-[#DC2626]/64 hover:bg-[#DC2626]/10 hover:text-[#991B1B] dark:border-[#FF8A8A]/28 dark:text-[#FFB4B4] dark:hover:bg-[#FF8A8A]/10'
          : ''
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
