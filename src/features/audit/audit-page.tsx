import { FileSearch } from 'lucide-react';
import type { AppLanguage } from '../../app/app-store';
import { GlassCard } from '../../components/ui/glass-card';
import type { AuditLog } from '../../domain/audit';
import { formatDateTime } from '../shared/format';

type AuditPageProps = {
  auditLogs: AuditLog[];
  language?: AppLanguage;
};

const copy = {
  zh: {
    title: '审计日志',
    subtitle: '记录变更创建、状态推进、回滚与失败原因，确保关键变更有据可查。',
    ledgerTitle: '变更账本',
    actor: '执行者',
    source: '来源 IP',
    task: '记录',
    emptyTitle: '暂无审计事件',
    emptyDescription: '创建或推进任务后，这里会自动生成对应的审计记录。',
    severity: {
      info: '信息',
      warning: '警告',
      critical: '严重'
    },
    actions: {
      'audit.denied': '审计拒绝',
      'agent.credential.issued': 'Agent 凭据已签发',
      'agent.credential.revoked': 'Agent 凭据已撤销',
      'agent.credential.rotated': 'Agent 凭据已轮换',
      'task.created': '变更已创建',
      'task.queued': '等待执行',
      'task.running': '执行中',
      'task.succeeded': '执行成功',
      'task.failed': '执行失败',
      'task.retrying': '重试中',
      'task.rolled_back': '已回滚',
      'task.canceled': '已取消'
    }
  },
  en: {
    title: 'Audit Log',
    subtitle: 'Track change creation, status progression, rollback events, and failure reasons with a clear audit trail.',
    ledgerTitle: 'Change Ledger',
    actor: 'Actor',
    source: 'Source IP',
    task: 'Record',
    emptyTitle: 'No audit events yet',
    emptyDescription: 'Audit records will appear here automatically after changes are created or advanced.',
    severity: {
      info: 'Info',
      warning: 'Warning',
      critical: 'Critical'
    },
    actions: {
      'audit.denied': 'Audit Denied',
      'agent.credential.issued': 'Agent Credential Issued',
      'agent.credential.revoked': 'Agent Credential Revoked',
      'agent.credential.rotated': 'Agent Credential Rotated',
      'task.created': 'Change Created',
      'task.queued': 'Awaiting Execution',
      'task.running': 'Running',
      'task.succeeded': 'Succeeded',
      'task.failed': 'Failed',
      'task.retrying': 'Retrying',
      'task.rolled_back': 'Rolled Back',
      'task.canceled': 'Canceled'
    }
  }
} as const;

export function AuditPage({ auditLogs, language = 'zh' }: AuditPageProps) {
  const t = copy[language];

  return (
    <div className="space-y-6">
      <section className="stagger-1">
        <h3 className="text-base font-bold text-slate-800 dark:text-white">{t.title}</h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-white/50">{t.subtitle}</p>
      </section>

      <GlassCard className="stagger-2 p-5">
        <div className="mb-4 flex items-center gap-2">
          <FileSearch className="h-4 w-4 text-blue-500 dark:text-primary" />
          <h4 className="text-sm font-bold text-slate-800 dark:text-white">{t.ledgerTitle}</h4>
        </div>
        <div className="space-y-3">
          {auditLogs.map((log) => (
            <div key={log.id} className="rounded-xl border border-slate-200 p-4 dark:border-white/10">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-slate-900 dark:text-white">{log.message}</p>
                  <p className="mt-1 font-mono text-[11px] text-slate-500 dark:text-white/45">
                    {t.actions[log.action]} · {log.targetLabel} · {formatDateTime(log.createdAt, language)}
                  </p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-bold uppercase text-slate-600 dark:bg-white/10 dark:text-white/70">
                  {t.severity[log.severity]}
                </span>
              </div>
              <p className="mt-3 text-xs text-slate-500 dark:text-white/50">
                {t.actor} {log.actor} · {t.source} {log.sourceIp} · {t.task} {log.taskId}
              </p>
            </div>
          ))}
          {auditLogs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-white/10">
              <p className="text-sm font-bold text-slate-700 dark:text-white/70">{t.emptyTitle}</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-white/45">{t.emptyDescription}</p>
            </div>
          ) : null}
        </div>
      </GlassCard>
    </div>
  );
}
