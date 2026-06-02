import { FileSearch } from 'lucide-react';
import { GlassCard } from '../../components/ui/glass-card';
import type { AuditLog } from '../../domain/audit';
import { formatDateTime } from '../shared/format';

type AuditPageProps = {
  auditLogs: AuditLog[];
};

export function AuditPage({ auditLogs }: AuditPageProps) {
  return (
    <div className="space-y-6">
      <section className="stagger-1">
        <h3 className="text-base font-bold text-slate-800 dark:text-white">审计日志</h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-white/50">
          记录任务创建、状态推进、回滚与失败原因。真实不可篡改审计需要后端持久化。
        </p>
      </section>

      <GlassCard className="stagger-2 p-5">
        <div className="mb-4 flex items-center gap-2">
          <FileSearch className="h-4 w-4 text-blue-500 dark:text-primary" />
          <h4 className="text-sm font-bold text-slate-800 dark:text-white">Change Ledger</h4>
        </div>
        <div className="space-y-3">
          {auditLogs.map((log) => (
            <div key={log.id} className="rounded-xl border border-slate-200 p-4 dark:border-white/10">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-slate-900 dark:text-white">{log.message}</p>
                  <p className="mt-1 font-mono text-[11px] text-slate-500 dark:text-white/45">
                    {log.action} · {log.targetLabel} · {formatDateTime(log.createdAt)}
                  </p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-bold uppercase text-slate-600 dark:bg-white/10 dark:text-white/70">
                  {log.severity}
                </span>
              </div>
              <p className="mt-3 text-xs text-slate-500 dark:text-white/50">
                Actor {log.actor} · Source {log.sourceIp} · Task {log.taskId}
              </p>
            </div>
          ))}
          {auditLogs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-white/10">
              <p className="text-sm font-bold text-slate-700 dark:text-white/70">暂无审计事件</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-white/45">创建任务后将自动生成 task.created 事件。</p>
            </div>
          ) : null}
        </div>
      </GlassCard>
    </div>
  );
}
