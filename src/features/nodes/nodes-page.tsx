import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, Copy, Cpu, Gauge, KeyRound, Network, ServerCog, Terminal } from 'lucide-react';
import type { AppLanguage } from '../../app/app-store';
import { GlassCard } from '../../components/ui/glass-card';
import { GlassToggle } from '../../components/ui/glass-toggle';
import { GlowButton } from '../../components/ui/glow-button';
import { AGENT_INSTALL_PROFILE, type Agent, type AgentInstallCommand, type AgentInstallMetadata } from '../../domain';
import type { ManagedNode } from '../../domain/node';
import { formatBytes, formatDateTime, formatPercent } from '../shared/format';

type NodesPageProps = {
  agents: Agent[];
  language: AppLanguage;
  nodes: ManagedNode[];
  taskMutationBusy?: boolean;
  onInstallAgent: (metadata: AgentInstallMetadata) => void;
  onPreviewAgentInstallCommand: (metadata: AgentInstallMetadata) => Promise<AgentInstallCommand>;
};

const copy = {
  zh: {
    title: 'Agent 安装与主机纳管',
    subtitle: '为任意新主机生成一键安装命令。命令会完成探针、Xray、FLVX、转发执行器、遥测上报与命令通道初始化。',
    installTitle: '一键安装命令',
    installHint: '填写主机和客户归属后生成短期安装任务；Master 接入成功后即可把策略下发到 N 台已纳管主机。',
    hostName: '主机名称',
    maxTraffic: '最大流量',
    customerNodeName: '客户节点名称',
    customerName: '客户名称',
    remainingTime: '剩余时间',
    maxTrafficSuffix: 'GB',
    remainingSuffix: '天',
    tokenPolicy: '安装令牌',
    tokenPolicyValue: '短期令牌 / 指纹绑定 / 最小权限',
    capabilitySet: '安装能力',
    capabilitySetValue: '探针、Xray、FLVX、端口转发、遥测',
    commandPreview: '命令预览',
    commandLoading: '正在生成安装命令...',
    commandUnavailable: '安装命令暂不可用，请检查控制面 API。',
    tokenExpires: '令牌过期',
    generate: '生成一键安装命令',
    generating: '生成中',
    architectureBadge: '任意主机',
    hostBadge: 'N 台主机',
    registeredTitle: '已纳管 Agent',
    noAgent: '暂无已纳管 Agent',
    noNode: '该 Agent 尚未绑定运行节点',
    latency: '延迟',
    traffic: '流量',
    updated: '更新',
    runtime: '运行时模块'
  },
  en: {
    title: 'Agent Install and Host Onboarding',
    subtitle: 'Generate one install command for any new host. The command initializes probe, Xray, FLVX, forwarding executor, telemetry, and command transport.',
    installTitle: 'One-Click Install Command',
    installHint: 'Register host and customer ownership, then issue a short-lived install task. After enrollment, Master can dispatch policy to any managed host.',
    hostName: 'Host Name',
    maxTraffic: 'Max Traffic',
    customerNodeName: 'Customer Node Name',
    customerName: 'Customer Name',
    remainingTime: 'Remaining Time',
    maxTrafficSuffix: 'GB',
    remainingSuffix: 'days',
    tokenPolicy: 'Install Token',
    tokenPolicyValue: 'Short-lived token / fingerprint binding / least privilege',
    capabilitySet: 'Capability Set',
    capabilitySetValue: 'Probe, Xray, FLVX, port forwarding, telemetry',
    commandPreview: 'Command Preview',
    commandLoading: 'Generating install command...',
    commandUnavailable: 'Install command unavailable. Check the control-plane API.',
    tokenExpires: 'Token Expires',
    generate: 'Generate Install Command',
    generating: 'Generating',
    architectureBadge: 'Master-to-Any',
    hostBadge: 'N Hosts',
    registeredTitle: 'Managed Agents',
    noAgent: 'No managed Agents yet',
    noNode: 'No runtime node is bound to this Agent',
    latency: 'Latency',
    traffic: 'Traffic',
    updated: 'Updated',
    runtime: 'Runtime Modules'
  }
} as const;

const defaultInstallMetadata: AgentInstallMetadata = {
  hostName: 'edge-hkg-01',
  maxTrafficGb: 8,
  customerNodeName: '香港高级节点 01',
  customerName: 'Acme Team',
  remainingDays: 30,
  installProfile: [...AGENT_INSTALL_PROFILE]
};

export function NodesPage({
  agents,
  language,
  nodes,
  taskMutationBusy = false,
  onInstallAgent,
  onPreviewAgentInstallCommand
}: NodesPageProps) {
  const t = copy[language];
  const [metadata, setMetadata] = useState<AgentInstallMetadata>(defaultInstallMetadata);
  const [installCommand, setInstallCommand] = useState<AgentInstallCommand>();
  const [previewError, setPreviewError] = useState(false);

  useEffect(() => {
    let stale = false;
    setPreviewError(false);

    onPreviewAgentInstallCommand(metadata)
      .then((command) => {
        if (!stale) {
          setInstallCommand(command);
        }
      })
      .catch(() => {
        if (!stale) {
          setPreviewError(true);
          setInstallCommand(undefined);
        }
      });

    return () => {
      stale = true;
    };
  }, [metadata, onPreviewAgentInstallCommand]);

  function updateTextField(field: 'hostName' | 'customerNodeName' | 'customerName', value: string) {
    setMetadata((current) => ({ ...current, [field]: value }));
  }

  function updateNumberField(field: 'maxTrafficGb' | 'remainingDays', value: string) {
    const parsed = Number.parseInt(value, 10);
    setMetadata((current) => ({ ...current, [field]: Number.isFinite(parsed) ? Math.max(parsed, 0) : 0 }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onInstallAgent(metadata);
  }

  return (
    <div className="space-y-6">
      <section className="stagger-1">
        <h3 className="text-base font-bold text-slate-800 dark:text-white">{t.title}</h3>
        <p className="mt-1 max-w-3xl text-xs leading-6 text-slate-500 dark:text-white/50">{t.subtitle}</p>
      </section>

      <section className="stagger-2 island-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Terminal className="h-4 w-4 text-blue-500 dark:text-primary" />
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">{t.installTitle}</h4>
            </div>
            <p className="mt-1 max-w-3xl text-xs leading-6 text-slate-500 dark:text-white/45">{t.installHint}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-blue-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-blue-600 dark:bg-primary/10 dark:text-primary">
              {t.architectureBadge}
            </span>
            <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-300">
              {t.hostBadge}
            </span>
          </div>
        </div>

        <form className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.9fr)]" onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <InstallInput label={t.hostName} value={metadata.hostName} onChange={(value) => updateTextField('hostName', value)} />
            <InstallInput
              label={t.maxTraffic}
              suffix={t.maxTrafficSuffix}
              type="number"
              value={String(metadata.maxTrafficGb)}
              onChange={(value) => updateNumberField('maxTrafficGb', value)}
            />
            <InstallInput
              label={t.customerNodeName}
              value={metadata.customerNodeName}
              onChange={(value) => updateTextField('customerNodeName', value)}
            />
            <InstallInput
              label={t.customerName}
              value={metadata.customerName}
              onChange={(value) => updateTextField('customerName', value)}
            />
            <InstallInput
              label={t.remainingTime}
              suffix={t.remainingSuffix}
              type="number"
              value={String(metadata.remainingDays)}
              onChange={(value) => updateNumberField('remainingDays', value)}
            />
            <InfoField label={t.tokenPolicy} value={t.tokenPolicyValue} />
            <div className="md:col-span-2">
              <InfoField label={t.capabilitySet} value={t.capabilitySetValue} />
            </div>
          </div>

          <GlassCard className="tilt-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                  {t.commandPreview}
                </p>
                <p className="mt-2 text-sm font-bold text-slate-900 dark:text-white">
                  {installCommand?.agentId ?? metadata.hostName}
                </p>
                {installCommand ? (
                  <p className="mt-1 text-[10px] font-semibold uppercase tracking-widest text-slate-500 dark:text-white/40">
                    {t.tokenExpires} {formatDateTime(installCommand.expiresAt, language)}
                  </p>
                ) : null}
              </div>
              <KeyRound className="h-4 w-4 text-slate-400 dark:text-white/40" />
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-100/80 p-3 dark:border-white/10 dark:bg-black/20">
              <div className="mb-2 flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                <span>{t.installTitle}</span>
                <Copy className="h-3.5 w-3.5" />
              </div>
              <code className="block break-all font-mono text-[10px] leading-5 text-slate-700 dark:text-white/70">
                {previewError ? t.commandUnavailable : installCommand?.command ?? t.commandLoading}
              </code>
            </div>

            <GlowButton className="mt-4 w-full justify-center text-xs" disabled={taskMutationBusy} type="submit">
              {taskMutationBusy ? t.generating : t.generate}
            </GlowButton>
          </GlassCard>
        </form>
      </section>

      <section className="stagger-3">
        <div className="mb-4 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          <h4 className="text-sm font-bold text-slate-900 dark:text-white">{t.registeredTitle}</h4>
        </div>

        {agents.length === 0 ? (
          <GlassCard className="p-5 text-sm text-slate-500 dark:text-white/50">{t.noAgent}</GlassCard>
        ) : (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            {agents.map((agent) => {
              const agentNodes = nodes.filter((node) => node.agentId === agent.id);
              return (
                <GlassCard key={agent.id} className="tilt-card p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <ServerCog className="h-4 w-4 text-blue-500 dark:text-primary" />
                        <h4 className="text-sm font-bold text-slate-900 dark:text-white">{agent.name}</h4>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500 dark:text-white/45">
                        {agent.region} / {agent.publicAddress} / {agent.connectionMode}
                      </p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-bold uppercase text-slate-600 dark:bg-white/10 dark:text-white/70">
                      {agent.status}
                    </span>
                  </div>

                  <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
                    <Metric icon={Cpu} label="CPU" value={formatPercent(agent.telemetry.cpuPercent)} />
                    <Metric icon={Gauge} label="MEM" value={formatPercent(agent.telemetry.memoryPercent)} />
                    <Metric icon={Network} label={t.latency} value={`${agent.telemetry.latencyMs}ms`} />
                    <Metric label={t.traffic} value={formatBytes(agent.telemetry.txBytes + agent.telemetry.rxBytes)} />
                  </div>

                  <div className="mt-5 space-y-3">
                    {agentNodes.length === 0 ? (
                      <div className="rounded-xl border border-slate-200 p-3 text-xs text-slate-500 dark:border-white/10 dark:text-white/45">
                        {t.noNode}
                      </div>
                    ) : (
                      agentNodes.map((node) => (
                        <div key={node.id} className="rounded-xl border border-slate-200 p-3 dark:border-white/10">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="text-sm font-bold text-slate-800 dark:text-white">{node.name}</p>
                              <p className="mt-1 text-[11px] text-slate-500 dark:text-white/45">
                                {node.entrypoint} / {t.updated} {formatDateTime(node.updatedAt)}
                              </p>
                            </div>
                            <span className="text-[10px] font-bold uppercase tracking-widest text-blue-600 dark:text-primary">
                              {node.status}
                            </span>
                          </div>
                          <p className="mt-3 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                            {t.runtime}
                          </p>
                          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                            {node.modules.map((module) => (
                              <div
                                key={module.id}
                                className="flex items-center justify-between rounded-lg bg-slate-100 px-3 py-2 dark:bg-white/5"
                              >
                                <div>
                                  <p className="text-xs font-bold text-slate-700 dark:text-white/80">{module.label}</p>
                                  <p className="mt-0.5 text-[10px] text-slate-500 dark:text-white/40">
                                    {module.kind} / {module.version} / {module.configVersion}
                                  </p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <GlassToggle
                                    aria-label={`${module.label} hot reload`}
                                    checked={module.hotReload}
                                    readOnly
                                  />
                                  <span className="text-[10px] font-bold uppercase text-slate-500 dark:text-white/50">
                                    {module.state}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </GlassCard>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function InstallInput({
  label,
  onChange,
  suffix,
  type = 'text',
  value
}: {
  label: string;
  onChange: (value: string) => void;
  suffix?: string;
  type?: 'number' | 'text';
  value: string;
}) {
  return (
    <label className="block rounded-lg border border-slate-200 bg-white/60 p-3 dark:border-white/10 dark:bg-black/20">
      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</span>
      <span className="mt-2 flex items-center gap-2">
        <input
          aria-label={label}
          className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400 dark:text-white"
          min={type === 'number' ? 0 : undefined}
          onChange={(event) => onChange(event.target.value)}
          type={type}
          value={value}
        />
        {suffix ? <span className="text-[10px] font-bold text-slate-400 dark:text-white/35">{suffix}</span> : null}
      </span>
    </label>
  );
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white/60 p-3 dark:border-white/10 dark:bg-black/20">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</p>
      <p className="mt-1 font-semibold text-slate-700 dark:text-white/70">{value}</p>
    </div>
  );
}

type MetricProps = {
  label: string;
  value: string;
  icon?: typeof Cpu;
};

function Metric({ label, value, icon: Icon }: MetricProps) {
  return (
    <div className="rounded-xl border border-slate-200 p-3 dark:border-white/10">
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
        {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
        {label}
      </div>
      <p className="mt-2 text-lg font-black text-slate-900 dark:text-white">{value}</p>
    </div>
  );
}
