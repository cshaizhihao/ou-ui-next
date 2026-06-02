import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowRightLeft, CircleDollarSign, Gauge, Pencil, Plus, Router, Send, Trash2 } from 'lucide-react';
import type { AppLanguage } from '../../app/app-store';
import { ConfigDrawer } from '../../components/ui/config-drawer';
import { GlassToggle } from '../../components/ui/glass-toggle';
import { GlowButton } from '../../components/ui/glow-button';
import type { Agent, BillingDirection, ForwardProtocol, ForwardStrategy, Tunnel, TunnelMode } from '../../domain';
import { formatBytes } from '../shared/format';

export type ForwardingRuleView = {
  id: string;
  name: string;
  ownerName: string;
  protocol: ForwardProtocol;
  tunnelId: string;
  tunnelName: string;
  sourceAgentId: string;
  sourceAddress: string;
  listenAddress: string;
  listenPort: number;
  targetAddress: string;
  targetPort: number;
  enabled: boolean;
  bindingCount: number;
  quotaBytes: number;
  usedBytes: number;
  rateLimitMbps: number;
  ipRateLimitMbps: number;
  billingDirection: BillingDirection;
  pricePerGb: number;
  tunnelMode: TunnelMode;
  strategy: ForwardStrategy;
  maxConnections: number;
  maxConnectionsPerIp: number;
  proxyProtocol: boolean;
};

export type ForwardingCreateMetadata = {
  name: string;
  ownerName: string;
  tunnelId: string;
  listenAddress: string;
  listenPort: number;
  targetAddress: string;
  targetPort: number;
  protocol: ForwardProtocol;
  entryNodeIds: string[];
  strategy: ForwardStrategy;
  quotaGb: number;
  rateLimitMbps: number;
  ipRateLimitMbps: number;
  maxConnections: number;
  maxConnectionsPerIp: number;
  proxyProtocol: boolean;
  billingDirection: BillingDirection;
  tunnelMode: TunnelMode;
};

type ForwardingPageProps = {
  agents: Agent[];
  language: AppLanguage;
  rules: ForwardingRuleView[];
  taskMutationBusy?: boolean;
  tunnels: Tunnel[];
  onCreateForwarding: (metadata: ForwardingCreateMetadata) => void;
  onRunTask: (id: string) => void;
};

type ForwardDraft = {
  name: string;
  ownerName: string;
  tunnelId: string;
  listenAddress: string;
  listenPort: string;
  targetAddress: string;
  targetPort: string;
  protocol: ForwardProtocol;
  entryNodeIds: string[];
  strategy: ForwardStrategy;
  quotaGb: string;
  rateLimitMbps: string;
  ipRateLimitMbps: string;
  maxConnections: string;
  maxConnectionsPerIp: string;
  proxyProtocol: boolean;
  billingDirection: BillingDirection;
  tunnelMode: TunnelMode;
};

type DrawerState = { type: 'closed' } | { type: 'create' } | { type: 'edit'; ruleId: string };
type Workspace = 'rules' | 'tunnels';

const copy = {
  zh: {
    title: '端口转发',
    subtitle: '按端口转发模型管理转发规则、入口端口绑定和隧道链路。规则可以下发到多个入口主机，并独立配置限速、限连、计费方向与转发策略。',
    rulesTab: '转发规则',
    tunnelsTab: '隧道链路',
    createAction: '创建转发规则',
    editAction: '编辑转发规则',
    drawerDescription: '规则会被展开为入口端口绑定，并在受控主机侧生成 TCP/UDP 运行时服务。',
    enabledRules: '启用规则',
    usedQuota: '已用配额',
    billingDirection: '计费方向',
    name: '规则名称',
    tunnel: '隧道',
    owner: '客户',
    binding: '入口绑定',
    target: '目标端点',
    policy: '策略',
    quota: '配额',
    limiter: '限速/限连',
    actions: '操作',
    applyPolicy: '下发',
    deleteRule: '删除规则',
    noRules: '暂无转发规则',
    tunnelName: '隧道名称',
    tunnelType: '类型',
    tunnelEntry: '入口主机',
    tunnelExit: '出口主机',
    tunnelStatus: '状态',
    noTunnels: '暂无隧道链路',
    listenAddress: '监听地址',
    listenPort: '监听端口',
    targetAddress: '目标 IP',
    targetPort: '目标端口',
    protocol: '协议',
    entryNodes: '入口主机',
    strategy: '调度策略',
    quotaGb: '流量配额',
    rateLimitMbps: '规则限速',
    ipRateLimitMbps: '单 IP 限速',
    maxConnections: '最大连接',
    maxConnectionsPerIp: '单 IP 连接',
    proxyProtocol: 'Proxy Protocol',
    tunnelMode: '转发模式',
    save: '保存',
    cancel: '取消',
    selected: '已选',
    unitGb: 'GB',
    unitMbps: 'Mbps',
    billingOptions: {
      ingress: '入站',
      egress: '出站',
      both: '双向'
    },
    strategyOptions: {
      fifo: '顺序',
      'round-robin': '轮询',
      'least-latency': '最低延迟',
      weighted: '权重'
    },
    tunnelModeOptions: {
      direct: '端口转发',
      relay: '中继',
      encrypted: '加密隧道'
    }
  },
  en: {
    title: 'Port Forwarding',
    subtitle: 'Manage port forwarding rules, entry port bindings, and tunnel fabrics. A rule can target multiple entry hosts with independent rate, connection, billing, and strategy controls.',
    rulesTab: 'Forward Rules',
    tunnelsTab: 'Tunnels',
    createAction: 'Create Forward Rule',
    editAction: 'Edit Forward Rule',
    drawerDescription: 'A rule expands into entry port bindings and creates TCP/UDP runtime services on managed hosts.',
    enabledRules: 'Enabled Rules',
    usedQuota: 'Used Quota',
    billingDirection: 'Billing Direction',
    name: 'Rule Name',
    tunnel: 'Tunnel',
    owner: 'Customer',
    binding: 'Entry Binding',
    target: 'Target Endpoint',
    policy: 'Policy',
    quota: 'Quota',
    limiter: 'Limiters',
    actions: 'Actions',
    applyPolicy: 'Deploy',
    deleteRule: 'Delete Rule',
    noRules: 'No forwarding rules yet',
    tunnelName: 'Tunnel Name',
    tunnelType: 'Type',
    tunnelEntry: 'Entry Hosts',
    tunnelExit: 'Exit Hosts',
    tunnelStatus: 'Status',
    noTunnels: 'No tunnels yet',
    listenAddress: 'Listen Address',
    listenPort: 'Listen Port',
    targetAddress: 'Target IP',
    targetPort: 'Target Port',
    protocol: 'Protocol',
    entryNodes: 'Entry Hosts',
    strategy: 'Strategy',
    quotaGb: 'Traffic Quota',
    rateLimitMbps: 'Rule Rate',
    ipRateLimitMbps: 'Per-IP Rate',
    maxConnections: 'Max Conn',
    maxConnectionsPerIp: 'Per-IP Conn',
    proxyProtocol: 'Proxy Protocol',
    tunnelMode: 'Forward Mode',
    save: 'Save',
    cancel: 'Cancel',
    selected: 'Selected',
    unitGb: 'GB',
    unitMbps: 'Mbps',
    billingOptions: {
      ingress: 'Ingress',
      egress: 'Egress',
      both: 'Both'
    },
    strategyOptions: {
      fifo: 'FIFO',
      'round-robin': 'Round Robin',
      'least-latency': 'Least Latency',
      weighted: 'Weighted'
    },
    tunnelModeOptions: {
      direct: 'Port Forward',
      relay: 'Relay',
      encrypted: 'Encrypted Tunnel'
    }
  }
} as const;

function createDraft(tunnels: Tunnel[], agents: Agent[]): ForwardDraft {
  return {
    name: '客户入口转发 01',
    ownerName: 'Acme Team',
    tunnelId: tunnels[0]?.id ?? '',
    listenAddress: '0.0.0.0',
    listenPort: '2443',
    targetAddress: '172.20.8.10',
    targetPort: '9443',
    protocol: 'tcp+udp',
    entryNodeIds: agents.slice(0, 2).map((agent) => agent.id),
    strategy: 'round-robin',
    quotaGb: '1024',
    rateLimitMbps: '600',
    ipRateLimitMbps: '80',
    maxConnections: '2048',
    maxConnectionsPerIp: '32',
    proxyProtocol: false,
    billingDirection: 'both',
    tunnelMode: 'encrypted'
  };
}

export function ForwardingPage({
  agents,
  language,
  rules,
  taskMutationBusy = false,
  tunnels,
  onCreateForwarding,
  onRunTask
}: ForwardingPageProps) {
  const t = copy[language];
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace>('rules');
  const [drawer, setDrawer] = useState<DrawerState>({ type: 'closed' });
  const [removedRuleIds, setRemovedRuleIds] = useState<string[]>([]);
  const [draft, setDraft] = useState<ForwardDraft>(() => createDraft(tunnels, agents));
  const visibleRules = rules.filter((rule) => !removedRuleIds.includes(rule.id));
  const enabledCount = visibleRules.filter((rule) => rule.enabled).length;
  const totalUsed = visibleRules.reduce((sum, rule) => sum + rule.usedBytes, 0);
  const totalQuota = visibleRules.reduce((sum, rule) => sum + rule.quotaBytes, 0);
  const editingRule = drawer.type === 'edit' ? visibleRules.find((rule) => rule.id === drawer.ruleId) : undefined;
  const canSubmit = draft.entryNodeIds.length > 0 && draft.tunnelId && draft.targetAddress.trim();

  useEffect(() => {
    setDraft((current) => {
      const availableIds = new Set(agents.map((agent) => agent.id));
      const retained = current.entryNodeIds.filter((agentId) => availableIds.has(agentId));

      return {
        ...current,
        tunnelId: current.tunnelId || tunnels[0]?.id || '',
        entryNodeIds: retained.length > 0 ? retained : agents.slice(0, 2).map((agent) => agent.id)
      };
    });
  }, [agents, tunnels]);

  function openCreateDrawer() {
    setDraft(createDraft(tunnels, agents));
    setDrawer({ type: 'create' });
  }

  function openEditDrawer(rule: ForwardingRuleView) {
    setDraft({
      name: rule.name,
      ownerName: rule.ownerName,
      tunnelId: rule.tunnelId,
      listenAddress: rule.listenAddress,
      listenPort: String(rule.listenPort),
      targetAddress: rule.targetAddress,
      targetPort: String(rule.targetPort),
      protocol: rule.protocol,
      entryNodeIds: [rule.sourceAgentId],
      strategy: rule.strategy,
      quotaGb: String(Math.round(rule.quotaBytes / 1024 / 1024 / 1024)),
      rateLimitMbps: String(rule.rateLimitMbps),
      ipRateLimitMbps: String(rule.ipRateLimitMbps),
      maxConnections: String(rule.maxConnections),
      maxConnectionsPerIp: String(rule.maxConnectionsPerIp),
      proxyProtocol: rule.proxyProtocol,
      billingDirection: rule.billingDirection,
      tunnelMode: rule.tunnelMode
    });
    setDrawer({ type: 'edit', ruleId: rule.id });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSubmit) {
      return;
    }

    onCreateForwarding({
      name: draft.name.trim() || t.createAction,
      ownerName: draft.ownerName.trim() || t.owner,
      tunnelId: draft.tunnelId,
      listenAddress: draft.listenAddress.trim() || '0.0.0.0',
      listenPort: Math.max(Number.parseInt(draft.listenPort, 10) || 1, 1),
      targetAddress: draft.targetAddress.trim(),
      targetPort: Math.max(Number.parseInt(draft.targetPort, 10) || 1, 1),
      protocol: draft.protocol,
      entryNodeIds: draft.entryNodeIds,
      strategy: draft.strategy,
      quotaGb: Math.max(Number.parseInt(draft.quotaGb, 10) || 0, 0),
      rateLimitMbps: Math.max(Number.parseInt(draft.rateLimitMbps, 10) || 0, 0),
      ipRateLimitMbps: Math.max(Number.parseInt(draft.ipRateLimitMbps, 10) || 0, 0),
      maxConnections: Math.max(Number.parseInt(draft.maxConnections, 10) || 0, 0),
      maxConnectionsPerIp: Math.max(Number.parseInt(draft.maxConnectionsPerIp, 10) || 0, 0),
      proxyProtocol: draft.proxyProtocol,
      billingDirection: draft.billingDirection,
      tunnelMode: draft.tunnelMode
    });
    setDrawer({ type: 'closed' });
  }

  function updateDraft(patch: Partial<ForwardDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function toggleEntryNode(agentId: string) {
    setDraft((current) => ({
      ...current,
      entryNodeIds: current.entryNodeIds.includes(agentId)
        ? current.entryNodeIds.filter((item) => item !== agentId)
        : [...current.entryNodeIds, agentId]
    }));
  }

  return (
    <div className="space-y-6">
      <section className="stagger-1">
        <h3 className="text-base font-bold text-slate-800 dark:text-white">{t.title}</h3>
        <p className="mt-1 max-w-3xl text-xs leading-6 text-slate-500 dark:text-white/50">{t.subtitle}</p>
      </section>

      <section className="stagger-2 island-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap gap-2">
            <WorkspaceButton active={activeWorkspace === 'rules'} label={t.rulesTab} onClick={() => setActiveWorkspace('rules')} />
            <WorkspaceButton active={activeWorkspace === 'tunnels'} label={t.tunnelsTab} onClick={() => setActiveWorkspace('tunnels')} />
          </div>
          <GlowButton className="gap-2 px-4 py-2 text-xs" onClick={openCreateDrawer}>
            <Plus className="h-3.5 w-3.5" />
            {t.createAction}
          </GlowButton>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
          <SummaryMetric icon={Router} label={t.enabledRules} value={`${enabledCount}/${visibleRules.length}`} />
          <SummaryMetric icon={Gauge} label={t.usedQuota} value={`${formatBytes(totalUsed)} / ${formatBytes(totalQuota)}`} />
          <SummaryMetric icon={CircleDollarSign} label={t.billingDirection} value={t.billingOptions.both} />
        </div>
      </section>

      {activeWorkspace === 'rules' ? (
        <section className="stagger-3 island-card overflow-hidden">
          {visibleRules.length === 0 ? (
            <EmptyState label={t.noRules} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1080px] text-left">
                <thead className="bg-slate-50/70 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:bg-white/[0.03] dark:text-white/40">
                  <tr>
                    <th className="px-5 py-3">{t.name}</th>
                    <th className="px-5 py-3">{t.binding}</th>
                    <th className="px-5 py-3">{t.target}</th>
                    <th className="px-5 py-3">{t.policy}</th>
                    <th className="px-5 py-3">{t.quota}</th>
                    <th className="px-5 py-3">{t.limiter}</th>
                    <th className="px-5 py-3 text-right">{t.actions}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-white/10">
                  {visibleRules.map((rule) => (
                    <tr key={rule.id} className="transition-colors hover:bg-slate-50/60 dark:hover:bg-white/[0.03]">
                      <td className="px-5 py-4">
                        <div className="flex items-start gap-3">
                          <span className="mt-1 rounded-lg bg-blue-500/10 p-2 text-blue-600 dark:bg-primary/10 dark:text-primary">
                            <ArrowRightLeft className="h-4 w-4" />
                          </span>
                          <div>
                            <p className="text-sm font-bold text-slate-900 dark:text-white">{rule.name}</p>
                            <p className="mt-1 text-[11px] text-slate-500 dark:text-white/45">
                              {rule.ownerName} / {rule.tunnelName}
                            </p>
                            <span className="mt-2 inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase text-slate-500 dark:bg-white/10 dark:text-white/50">
                              {rule.enabled ? 'enabled' : 'disabled'}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <p className="font-mono text-xs font-semibold text-slate-700 dark:text-white/70">
                          {rule.listenAddress}:{rule.listenPort}
                        </p>
                        <p className="mt-1 text-[11px] text-slate-500 dark:text-white/45">
                          {rule.bindingCount} {t.entryNodes} / {rule.protocol.toUpperCase()}
                        </p>
                      </td>
                      <td className="px-5 py-4 font-mono text-xs font-semibold text-slate-700 dark:text-white/70">
                        {rule.targetAddress}:{rule.targetPort}
                      </td>
                      <td className="px-5 py-4">
                        <p className="text-xs font-bold text-slate-800 dark:text-white/80">
                          {t.strategyOptions[rule.strategy]}
                        </p>
                        <p className="mt-1 text-[11px] text-slate-500 dark:text-white/45">
                          {t.tunnelModeOptions[rule.tunnelMode]} / {t.billingOptions[rule.billingDirection]}
                        </p>
                      </td>
                      <td className="px-5 py-4 text-xs font-semibold text-slate-700 dark:text-white/70">
                        {formatBytes(rule.usedBytes)} / {formatBytes(rule.quotaBytes)}
                      </td>
                      <td className="px-5 py-4">
                        <p className="text-xs font-bold text-slate-800 dark:text-white/80">
                          {rule.rateLimitMbps} {t.unitMbps} / IP {rule.ipRateLimitMbps} {t.unitMbps}
                        </p>
                        <p className="mt-1 text-[11px] text-slate-500 dark:text-white/45">
                          {rule.maxConnections} / IP {rule.maxConnectionsPerIp}
                        </p>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex justify-end gap-2">
                          <IconButton label={t.editAction} onClick={() => openEditDrawer(rule)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </IconButton>
                          <IconButton label={t.applyPolicy} onClick={() => onRunTask(rule.id)}>
                            <Send className="h-3.5 w-3.5" />
                          </IconButton>
                          <IconButton danger label={t.deleteRule} onClick={() => setRemovedRuleIds((current) => [...current, rule.id])}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </IconButton>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : (
        <section className="stagger-3 island-card overflow-hidden">
          {tunnels.length === 0 ? (
            <EmptyState label={t.noTunnels} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left">
                <thead className="bg-slate-50/70 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:bg-white/[0.03] dark:text-white/40">
                  <tr>
                    <th className="px-5 py-3">{t.tunnelName}</th>
                    <th className="px-5 py-3">{t.tunnelType}</th>
                    <th className="px-5 py-3">{t.tunnelEntry}</th>
                    <th className="px-5 py-3">{t.tunnelExit}</th>
                    <th className="px-5 py-3">{t.policy}</th>
                    <th className="px-5 py-3">{t.tunnelStatus}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-white/10">
                  {tunnels.map((tunnel) => (
                    <tr key={tunnel.id} className="transition-colors hover:bg-slate-50/60 dark:hover:bg-white/[0.03]">
                      <td className="px-5 py-4">
                        <p className="text-sm font-bold text-slate-900 dark:text-white">{tunnel.name}</p>
                        <p className="mt-1 text-[11px] text-slate-500 dark:text-white/45">{tunnel.accountId}</p>
                      </td>
                      <td className="px-5 py-4 text-xs font-semibold text-slate-700 dark:text-white/70">
                        {tunnel.type} / {tunnel.protocol.toUpperCase()}
                      </td>
                      <td className="px-5 py-4 text-xs font-semibold text-slate-700 dark:text-white/70">
                        {tunnel.entryAgentIds.length}
                      </td>
                      <td className="px-5 py-4 text-xs font-semibold text-slate-700 dark:text-white/70">
                        {tunnel.exitAgentIds.length}
                      </td>
                      <td className="px-5 py-4 text-xs font-semibold text-slate-700 dark:text-white/70">
                        x{tunnel.trafficRatio} / {tunnel.ipPreference}
                      </td>
                      <td className="px-5 py-4">
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase text-slate-500 dark:bg-white/10 dark:text-white/50">
                          {tunnel.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <ConfigDrawer
        description={t.drawerDescription}
        open={drawer.type !== 'closed'}
        title={editingRule ? t.editAction : t.createAction}
        onClose={() => setDrawer({ type: 'closed' })}
      >
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <InputField label={t.name} value={draft.name} onChange={(value) => updateDraft({ name: value })} />
            <InputField label={t.owner} value={draft.ownerName} onChange={(value) => updateDraft({ ownerName: value })} />
          </div>
          <SelectField
            label={t.tunnel}
            value={draft.tunnelId}
            onChange={(value) => updateDraft({ tunnelId: value })}
            options={tunnels.map((tunnel) => ({ label: tunnel.name, value: tunnel.id }))}
          />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <InputField label={t.listenAddress} value={draft.listenAddress} onChange={(value) => updateDraft({ listenAddress: value })} />
            <InputField label={t.listenPort} type="number" value={draft.listenPort} onChange={(value) => updateDraft({ listenPort: value })} />
            <InputField label={t.targetAddress} value={draft.targetAddress} onChange={(value) => updateDraft({ targetAddress: value })} />
            <InputField label={t.targetPort} type="number" value={draft.targetPort} onChange={(value) => updateDraft({ targetPort: value })} />
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <SelectField
              label={t.protocol}
              value={draft.protocol}
              onChange={(value) => updateDraft({ protocol: value as ForwardProtocol })}
              options={[
                { label: 'TCP', value: 'tcp' },
                { label: 'UDP', value: 'udp' },
                { label: 'TCP + UDP', value: 'tcp+udp' }
              ]}
            />
            <SelectField
              label={t.strategy}
              value={draft.strategy}
              onChange={(value) => updateDraft({ strategy: value as ForwardStrategy })}
              options={[
                { label: t.strategyOptions.fifo, value: 'fifo' },
                { label: t.strategyOptions['round-robin'], value: 'round-robin' },
                { label: t.strategyOptions['least-latency'], value: 'least-latency' },
                { label: t.strategyOptions.weighted, value: 'weighted' }
              ]}
            />
            <SelectField
              label={t.tunnelMode}
              value={draft.tunnelMode}
              onChange={(value) => updateDraft({ tunnelMode: value as TunnelMode })}
              options={[
                { label: t.tunnelModeOptions.direct, value: 'direct' },
                { label: t.tunnelModeOptions.relay, value: 'relay' },
                { label: t.tunnelModeOptions.encrypted, value: 'encrypted' }
              ]}
            />
          </div>
          <div className="rounded-lg border border-slate-200 bg-white/60 p-3 dark:border-white/10 dark:bg-black/20">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{t.entryNodes}</p>
              <span className="rounded-full bg-blue-500/10 px-2.5 py-1 text-[10px] font-bold text-blue-600 dark:bg-primary/10 dark:text-primary">
                {t.selected} {draft.entryNodeIds.length}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-2">
              {agents.map((agent) => (
                <label
                  key={agent.id}
                  className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 dark:border-white/10"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-bold text-slate-800 dark:text-white/80">{agent.name}</span>
                    <span className="mt-0.5 block truncate text-[10px] text-slate-500 dark:text-white/40">
                      {agent.region} / {agent.publicAddress}
                    </span>
                  </span>
                  <GlassToggle
                    aria-label={`select ${agent.name}`}
                    checked={draft.entryNodeIds.includes(agent.id)}
                    onChange={() => toggleEntryNode(agent.id)}
                  />
                </label>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <InputField label={t.quotaGb} suffix={t.unitGb} type="number" value={draft.quotaGb} onChange={(value) => updateDraft({ quotaGb: value })} />
            <SelectField
              label={t.billingDirection}
              value={draft.billingDirection}
              onChange={(value) => updateDraft({ billingDirection: value as BillingDirection })}
              options={[
                { label: t.billingOptions.ingress, value: 'ingress' },
                { label: t.billingOptions.egress, value: 'egress' },
                { label: t.billingOptions.both, value: 'both' }
              ]}
            />
            <InputField label={t.rateLimitMbps} suffix={t.unitMbps} type="number" value={draft.rateLimitMbps} onChange={(value) => updateDraft({ rateLimitMbps: value })} />
            <InputField label={t.ipRateLimitMbps} suffix={t.unitMbps} type="number" value={draft.ipRateLimitMbps} onChange={(value) => updateDraft({ ipRateLimitMbps: value })} />
            <InputField label={t.maxConnections} type="number" value={draft.maxConnections} onChange={(value) => updateDraft({ maxConnections: value })} />
            <InputField label={t.maxConnectionsPerIp} type="number" value={draft.maxConnectionsPerIp} onChange={(value) => updateDraft({ maxConnectionsPerIp: value })} />
          </div>
          <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white/60 p-3 dark:border-white/10 dark:bg-black/20">
            <span className="text-xs font-bold text-slate-700 dark:text-white/70">{t.proxyProtocol}</span>
            <GlassToggle
              aria-label={t.proxyProtocol}
              checked={draft.proxyProtocol}
              onChange={() => updateDraft({ proxyProtocol: !draft.proxyProtocol })}
            />
          </label>
          <div className="flex justify-end gap-3 pt-2">
            <GhostButton label={t.cancel} onClick={() => setDrawer({ type: 'closed' })} />
            <GlowButton className="px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60" disabled={taskMutationBusy || !canSubmit} type="submit">
              {t.save}
            </GlowButton>
          </div>
        </form>
      </ConfigDrawer>
    </div>
  );
}

function WorkspaceButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      className={
        active
          ? 'rounded-xl bg-blue-500 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-blue-500/20 dark:bg-primary dark:text-slate-950'
          : 'rounded-xl border border-slate-200 bg-white/60 px-4 py-2 text-xs font-bold text-slate-500 transition hover:text-blue-600 dark:border-white/10 dark:bg-white/5 dark:text-white/50 dark:hover:text-primary'
      }
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function SummaryMetric({
  label,
  value,
  icon: Icon
}: {
  label: string;
  value: string;
  icon: typeof Router;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white/50 p-4 dark:border-white/10 dark:bg-black/10">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</p>
          <p className="mt-2 text-xl font-black text-slate-900 dark:text-white">{value}</p>
        </div>
        <Icon className="h-5 w-5 text-blue-500 dark:text-primary" />
      </div>
    </div>
  );
}

function IconButton({
  children,
  danger = false,
  label,
  onClick
}: {
  children: ReactNode;
  danger?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className={
        danger
          ? 'rounded-full border border-rose-200 p-2 text-rose-500 transition hover:bg-rose-50 dark:border-rose-400/30 dark:hover:bg-rose-400/10'
          : 'rounded-full border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-50 hover:text-blue-600 dark:border-white/10 dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-primary'
      }
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function InputField({
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

function SelectField({
  label,
  onChange,
  options,
  value
}: {
  label: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  value: string;
}) {
  return (
    <label className="block rounded-lg border border-slate-200 bg-white/60 p-3 dark:border-white/10 dark:bg-black/20">
      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</span>
      <select
        aria-label={label}
        className="mt-2 w-full bg-transparent text-sm font-semibold text-slate-800 outline-none dark:text-white"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function GhostButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 dark:border-white/10 dark:text-white/60"
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function EmptyState({ label }: { label: string }) {
  return <div className="p-8 text-center text-sm font-semibold text-slate-500 dark:text-white/50">{label}</div>;
}
