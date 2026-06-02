import { useState, type FormEvent } from 'react';
import { ArrowRightLeft, CircleDollarSign, Gauge, Router, Send } from 'lucide-react';
import type { AppLanguage } from '../../app/app-store';
import { GlassCard } from '../../components/ui/glass-card';
import { GlassToggle } from '../../components/ui/glass-toggle';
import { GlowButton } from '../../components/ui/glow-button';
import { formatBytes } from '../shared/format';

export type ForwardingRule = {
  id: string;
  name: string;
  protocol: 'tcp' | 'udp' | 'tcp+udp';
  sourceAgentId: string;
  sourceAddress: string;
  listenPort: number;
  targetAddress: string;
  targetPort: number;
  enabled: boolean;
  quotaBytes: number;
  usedBytes: number;
  rateLimitMbps: number;
  billingDirection: 'ingress' | 'egress' | 'both';
  pricePerGb: number;
  tunnelMode: 'direct' | 'relay' | 'encrypted';
};

export type ForwardingCreateMetadata = {
  listenPort: number;
  targetAddress: string;
  targetPort: number;
  agentIds: string[];
};

type ForwardingPageProps = {
  language: AppLanguage;
  rules: ForwardingRule[];
  taskMutationBusy?: boolean;
  onCreateForwarding: (metadata: ForwardingCreateMetadata) => void;
  onRunTask: (id: string) => void;
};

const copy = {
  zh: {
    title: '流量转发',
    subtitle: '配置 TCP/UDP 端口转发、隧道转发、配额、限速和计费方向，并可把同一转发策略下发到多台已纳管主机。',
    createTitle: '多主机端口转发',
    createHint: '填写监听端口和目标端点，选择要下发的主机 ID。多个主机用逗号、空格或换行分隔。',
    listenPort: '监听端口',
    targetIp: '目标 IP',
    targetPort: '目标端口',
    targetHosts: '下发主机',
    createAction: '创建多主机转发',
    creating: '创建中',
    hostBadge: 'N 台主机',
    enabledTunnels: '启用转发',
    usedQuota: '已用配额',
    billingDirection: '计费方向',
    protocol: '协议',
    mode: '模式',
    rateLimit: '限速',
    unitPrice: '单价',
    quotaUsage: '配额使用',
    applyPolicy: '应用转发策略',
    routeBilling: '方向计费'
  },
  en: {
    title: 'Forwarding',
    subtitle: 'Configure TCP/UDP port forwarding, tunnel forwarding, quota, rate limits, and billing direction across managed hosts.',
    createTitle: 'Multi-Host Port Forwarding',
    createHint: 'Enter the listen port and target endpoint, then select host IDs. Separate multiple hosts with commas, spaces, or new lines.',
    listenPort: 'Listen Port',
    targetIp: 'Target IP',
    targetPort: 'Target Port',
    targetHosts: 'Target Hosts',
    createAction: 'Create Multi-Host Forwarding',
    creating: 'Creating',
    hostBadge: 'N Hosts',
    enabledTunnels: 'Enabled Rules',
    usedQuota: 'Used Quota',
    billingDirection: 'Billing Direction',
    protocol: 'Protocol',
    mode: 'Mode',
    rateLimit: 'Rate Limit',
    unitPrice: 'Unit Price',
    quotaUsage: 'Quota Usage',
    applyPolicy: 'Apply Forwarding Policy',
    routeBilling: 'direction billing'
  }
} as const;

export function ForwardingPage({
  language,
  rules,
  taskMutationBusy = false,
  onCreateForwarding,
  onRunTask
}: ForwardingPageProps) {
  const t = copy[language];
  const enabledCount = rules.filter((rule) => rule.enabled).length;
  const totalUsed = rules.reduce((sum, rule) => sum + rule.usedBytes, 0);
  const totalQuota = rules.reduce((sum, rule) => sum + rule.quotaBytes, 0);
  const [listenPort, setListenPort] = useState('2443');
  const [targetAddress, setTargetAddress] = useState('172.20.8.10');
  const [targetPort, setTargetPort] = useState('9443');
  const [agentTargets, setAgentTargets] = useState('agent-hkg-01, agent-sin-02');

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onCreateForwarding({
      listenPort: Number.parseInt(listenPort, 10),
      targetAddress: targetAddress.trim(),
      targetPort: Number.parseInt(targetPort, 10),
      agentIds: agentTargets
        .split(/[\s,]+/)
        .map((item) => item.trim())
        .filter(Boolean)
    });
  }

  return (
    <div className="space-y-6">
      <section className="stagger-1">
        <h3 className="text-base font-bold text-slate-800 dark:text-white">{t.title}</h3>
        <p className="mt-1 max-w-3xl text-xs leading-6 text-slate-500 dark:text-white/50">{t.subtitle}</p>
      </section>

      <form className="stagger-2 island-card p-5" onSubmit={handleSubmit}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Send className="h-4 w-4 text-blue-500 dark:text-primary" />
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">{t.createTitle}</h4>
            </div>
            <p className="mt-1 max-w-3xl text-xs leading-6 text-slate-500 dark:text-white/45">{t.createHint}</p>
          </div>
          <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-300">
            {t.hostBadge}
          </span>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <ForwardInput label={t.listenPort} type="number" value={listenPort} onChange={setListenPort} />
          <ForwardInput label={t.targetIp} value={targetAddress} onChange={setTargetAddress} />
          <ForwardInput label={t.targetPort} type="number" value={targetPort} onChange={setTargetPort} />
          <ForwardInput label={t.targetHosts} value={agentTargets} onChange={setAgentTargets} />
        </div>

        <div className="mt-5 flex justify-end">
          <GlowButton className="text-xs" disabled={taskMutationBusy} type="submit">
            {taskMutationBusy ? t.creating : t.createAction}
          </GlowButton>
        </div>
      </form>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <SummaryCard icon={Router} label={t.enabledTunnels} value={`${enabledCount}/${rules.length}`} />
        <SummaryCard icon={Gauge} label={t.usedQuota} value={`${formatBytes(totalUsed)} / ${formatBytes(totalQuota)}`} />
        <SummaryCard icon={CircleDollarSign} label={t.billingDirection} value="Ingress / Egress" />
      </section>

      <section className="stagger-3 grid grid-cols-1 gap-5 xl:grid-cols-2">
        {rules.map((rule) => {
          const usage = rule.quotaBytes > 0 ? Math.min((rule.usedBytes / rule.quotaBytes) * 100, 100) : 0;
          return (
            <GlassCard key={rule.id} className="tilt-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <ArrowRightLeft className="h-4 w-4 text-blue-500 dark:text-primary" />
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white">{rule.name}</h4>
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-slate-500 dark:text-white/45">
                    {rule.sourceAddress}:{rule.listenPort} -&gt; {rule.targetAddress}:{rule.targetPort}
                  </p>
                </div>
                <GlassToggle aria-label={`${rule.name} enabled`} checked={rule.enabled} readOnly />
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
                <Chip label={t.protocol} value={rule.protocol.toUpperCase()} />
                <Chip label={t.mode} value={rule.tunnelMode} />
                <Chip label={t.rateLimit} value={`${rule.rateLimitMbps} Mbps`} />
                <Chip label={t.unitPrice} value={`$${rule.pricePerGb}/GB`} />
              </div>

              <div className="mt-5">
                <div className="mb-2 flex justify-between text-xs text-slate-500 dark:text-white/50">
                  <span>{t.quotaUsage}</span>
                  <span>
                    {formatBytes(rule.usedBytes)} / {formatBytes(rule.quotaBytes)}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
                  <div className="h-full rounded-full bg-blue-500 dark:bg-primary" style={{ width: `${usage}%` }} />
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-slate-500 dark:text-white/50">
                  Agent {rule.sourceAgentId} / {rule.billingDirection} {t.routeBilling}
                </p>
                <GlowButton
                  className="px-4 py-2 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={taskMutationBusy}
                  onClick={() => onRunTask(rule.id)}
                >
                  {t.applyPolicy}
                </GlowButton>
              </div>
            </GlassCard>
          );
        })}
      </section>
    </div>
  );
}

type SummaryCardProps = {
  label: string;
  value: string;
  icon: typeof Router;
};

function SummaryCard({ label, value, icon: Icon }: SummaryCardProps) {
  return (
    <GlassCard className="p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</p>
          <p className="mt-3 text-xl font-black text-slate-900 dark:text-white">{value}</p>
        </div>
        <Icon className="h-5 w-5 text-blue-500 dark:text-primary" />
      </div>
    </GlassCard>
  );
}

function ForwardInput({
  label,
  onChange,
  type = 'text',
  value
}: {
  label: string;
  onChange: (value: string) => void;
  type?: 'number' | 'text';
  value: string;
}) {
  return (
    <label className="block rounded-lg border border-slate-200 bg-white/60 p-3 dark:border-white/10 dark:bg-black/20">
      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</span>
      <input
        aria-label={label}
        className="mt-2 w-full bg-transparent text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400 dark:text-white"
        min={type === 'number' ? 1 : undefined}
        onChange={(event) => onChange(event.target.value)}
        type={type}
        value={value}
      />
    </label>
  );
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3 dark:border-white/10">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</p>
      <p className="mt-1 break-words text-xs font-bold text-slate-800 dark:text-white/80">{value}</p>
    </div>
  );
}
