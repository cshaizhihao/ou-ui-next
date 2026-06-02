import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  CheckCircle2,
  Copy,
  Cpu,
  Gauge,
  KeyRound,
  Network,
  Pencil,
  Plus,
  Send,
  ServerCog,
  Terminal,
  Trash2,
  UserRound
} from 'lucide-react';
import type { AppLanguage } from '../../app/app-store';
import { ConfigDrawer } from '../../components/ui/config-drawer';
import { GlowButton } from '../../components/ui/glow-button';
import {
  AGENT_INSTALL_PROFILE,
  type Agent,
  type AgentInstallCommand,
  type AgentInstallMetadata,
  type XrayProtocol,
  type XrayStreamSettings
} from '../../domain';
import type { ManagedNode } from '../../domain/node';
import { formatBytes, formatDateTime, formatPercent } from '../shared/format';

type NodesPageProps = {
  agents: Agent[];
  language: AppLanguage;
  nodes: ManagedNode[];
  taskMutationBusy?: boolean;
  onDeployHostConfig: (agent: Agent) => void;
  onDeleteHost: (metadata: HostConfigMetadata) => void;
  onInstallAgent: (metadata: AgentInstallMetadata) => void;
  onPreviewAgentInstallCommand: (metadata: AgentInstallMetadata) => Promise<AgentInstallCommand>;
  onSaveHostConfig: (metadata: HostConfigMetadata) => void;
  onSaveCustomerNode: (metadata: CustomerNodeConfigMetadata, action: 'create' | 'update') => void;
};

export type HostConfigMetadata = {
  agentId: string;
  hostName: string;
  maxTrafficGb: number;
};

export type CustomerNodeConfigMetadata = {
  nodeId: string;
  agentId: string;
  customerNodeName: string;
  customerName: string;
  serverAddress: string;
  xrayProtocol: XrayProtocol;
  listenPort: number;
  clientIdentity: string;
  streamNetwork: XrayStreamSettings['network'];
  security: XrayStreamSettings['security'];
  sni: string;
  path: string;
  flow: string;
  ipLimit: number;
  trafficLimitGb: number;
  remainingDays: number;
  subscriptionRule: string;
};

type CustomerNodeRecord = {
  id: string;
  agentId: string;
  nodeName: string;
  customerName: string;
  serverAddress: string;
  protocol: XrayProtocol;
  listenPort: number;
  clientIdentity: string;
  streamNetwork: XrayStreamSettings['network'];
  security: XrayStreamSettings['security'];
  sni: string;
  path: string;
  flow: string;
  ipLimit: number;
  trafficLimitGb: number;
  remainingDays: number;
  subscriptionRule: string;
};

type CustomerDraft = {
  agentId: string;
  nodeName: string;
  customerName: string;
  serverAddress: string;
  protocol: XrayProtocol;
  listenPort: string;
  clientIdentity: string;
  streamNetwork: XrayStreamSettings['network'];
  security: XrayStreamSettings['security'];
  sni: string;
  path: string;
  flow: string;
  ipLimit: string;
  trafficLimitGb: string;
  remainingDays: string;
  subscriptionRule: string;
};

type DrawerState =
  | { type: 'closed' }
  | { type: 'install' }
  | { type: 'editHost'; agentId: string }
  | { type: 'deleteHost'; agentId: string }
  | { type: 'customerNode'; nodeId?: string };

type Workspace = 'hosts' | 'customerNodes';

const copy = {
  zh: {
    title: '受控主机',
    subtitle: '主控端可纳管任意数量服务器。受控主机只负责服务器接入、运行时上报和命令通道；客户节点、客户归属、流量额度和订阅规则在独立工作区维护。',
    hostsTab: '受控主机',
    customerNodesTab: '客户节点',
    installTitle: '主机代理一键安装',
    installDescription: '安装命令只负责把服务器接入主控端，并初始化主机代理、协议运行时、转发执行器、遥测上报与命令通道。',
    openInstall: '生成安装命令',
    hostName: '主机名称',
    tokenPolicy: '令牌策略',
    tokenPolicyValue: '短期令牌 / 指纹绑定 / 最小权限',
    capabilitySet: '安装能力',
    capabilitySetValue: '主机代理、协议运行时、转发执行器、遥测上报、命令通道',
    commandPreview: '命令预览',
    commandLoading: '正在生成安装命令...',
    commandUnavailable: '安装命令暂不可用，请检查控制面 API。',
    tokenExpires: '令牌过期',
    submitInstall: '创建安装任务',
    submitting: '提交中',
    hostSummary: '主机总数',
    onlineSummary: '在线主机',
    customerSummary: '客户节点',
    hostTableTitle: '已纳管主机',
    hostAlias: '主机别名',
    endpoint: '接入端点',
    traffic: '流量额度',
    telemetry: '遥测',
    runtime: '运行时',
    actions: '操作',
    deployHostConfig: '下发主机配置',
    editHost: '编辑主机',
    deleteHost: '移除主机',
    deleteHostTitle: '移除受控主机',
    deleteHostDescription: '移除后该主机下的客户节点绑定会一并移除。实际生产环境中这里应触发可审计的停用/删除任务。',
    confirmDelete: '确认删除',
    save: '保存',
    cancel: '取消',
    noAgent: '暂无受控主机',
    noNode: '未绑定运行节点',
    maxTraffic: '最大流量',
    customerNodesTitle: '客户节点配置',
    customerNodesHint: '一个受控主机可以承载多个客户节点。每个客户节点都要生成有效的协议入站和 client 配置，避免把客户业务写死在主机接入命令中。',
    addCustomerNode: '新增客户节点',
    editCustomerNode: '编辑客户节点',
    deleteCustomerNode: '删除客户节点',
    customerNodeName: '客户节点名称',
    customerName: '客户名称',
    serverAddress: '服务器地址',
    protocolConfig: '协议配置',
    protocol: 'Xray 协议',
    listenPort: '入站端口',
    clientIdentity: '客户标识',
    streamNetwork: '传输层',
    security: '安全层',
    sni: 'SNI / Host',
    path: '路径 / 服务名',
    flow: 'Flow',
    ipLimit: 'IP 限制',
    protocolLink: '可用订阅链接',
    configPreview: 'Xray 入站配置',
    remainingTime: '剩余时间',
    subscriptionRule: '订阅规则',
    assignedHost: '所属主机',
    noCustomerNode: '暂无客户节点配置',
    unitGb: 'GB',
    unitDays: '天',
    unknownHost: '未分配主机',
    statusLabels: {
      online: '在线',
      degraded: '降级',
      offline: '离线',
      provisioning: '纳管中'
    }
  },
  en: {
    title: 'Managed Hosts',
    subtitle: 'Master can manage any number of servers. Managed hosts handle server enrollment, runtime telemetry, and command transport; customer nodes, quota, ownership, and subscription rules live in a separate workspace.',
    hostsTab: 'Managed Hosts',
    customerNodesTab: 'Customer Nodes',
    installTitle: 'Host Agent One-Click Install',
    installDescription: 'The command only enrolls a server into Master and initializes the host agent, protocol runtime, forwarding executor, telemetry, and command transport.',
    openInstall: 'Generate Install Command',
    hostName: 'Host Name',
    tokenPolicy: 'Token Policy',
    tokenPolicyValue: 'Short-lived token / fingerprint binding / least privilege',
    capabilitySet: 'Capability Set',
    capabilitySetValue: 'Host agent, protocol runtime, forwarding executor, telemetry, command transport',
    commandPreview: 'Command Preview',
    commandLoading: 'Generating install command...',
    commandUnavailable: 'Install command unavailable. Check the control-plane API.',
    tokenExpires: 'Token Expires',
    submitInstall: 'Create Install Task',
    submitting: 'Submitting',
    hostSummary: 'Total Hosts',
    onlineSummary: 'Online Hosts',
    customerSummary: 'Customer Nodes',
    hostTableTitle: 'Managed Hosts',
    hostAlias: 'Host Alias',
    endpoint: 'Endpoint',
    traffic: 'Traffic Cap',
    telemetry: 'Telemetry',
    runtime: 'Runtime',
    actions: 'Actions',
    deployHostConfig: 'Deploy Host Config',
    editHost: 'Edit Host',
    deleteHost: 'Remove Host',
    deleteHostTitle: 'Remove Managed Host',
    deleteHostDescription: 'Removing this host also removes customer-node bindings under it. In production this should become an auditable disable/delete task.',
    confirmDelete: 'Delete',
    save: 'Save',
    cancel: 'Cancel',
    noAgent: 'No managed hosts yet',
    noNode: 'No runtime node bound',
    maxTraffic: 'Max Traffic',
    customerNodesTitle: 'Customer Node Config',
    customerNodesHint: 'A single managed host can serve multiple customer nodes. Each customer node generates a real protocol inbound and client config instead of being hard-coded into the host enrollment command.',
    addCustomerNode: 'Add Customer Node',
    editCustomerNode: 'Edit Customer Node',
    deleteCustomerNode: 'Delete Customer Node',
    customerNodeName: 'Customer Node Name',
    customerName: 'Customer Name',
    serverAddress: 'Server Address',
    protocolConfig: 'Protocol Config',
    protocol: 'Xray Protocol',
    listenPort: 'Inbound Port',
    clientIdentity: 'Client Identity',
    streamNetwork: 'Transport',
    security: 'Security',
    sni: 'SNI / Host',
    path: 'Path / Service',
    flow: 'Flow',
    ipLimit: 'IP Limit',
    protocolLink: 'Usable Subscription Link',
    configPreview: 'Xray Inbound Config',
    remainingTime: 'Remaining Time',
    subscriptionRule: 'Subscription Rule',
    assignedHost: 'Assigned Host',
    noCustomerNode: 'No customer node configs yet',
    unitGb: 'GB',
    unitDays: 'days',
    unknownHost: 'Unassigned Host',
    statusLabels: {
      online: 'Online',
      degraded: 'Degraded',
      offline: 'Offline',
      provisioning: 'Provisioning'
    }
  }
} as const;

const defaultInstallMetadata: AgentInstallMetadata = {
  hostName: 'edge-hkg-01',
  installProfile: [...AGENT_INSTALL_PROFILE]
};

function createCustomerDraft(agent?: Agent): CustomerDraft {
  return {
    agentId: agent?.id ?? '',
    nodeName: '香港高级节点 01',
    customerName: 'Acme Team',
    serverAddress: agent?.publicAddress ?? 'edge.example.com',
    protocol: 'vless',
    listenPort: '443',
    clientIdentity: '9f3f5b3e-1f42-4f46-9b76-22e8d0bbf3c1',
    streamNetwork: 'tcp',
    security: 'reality',
    sni: 'www.cloudflare.com',
    path: '/ou-ui',
    flow: 'xtls-rprx-vision',
    ipLimit: '3',
    trafficLimitGb: '1024',
    remainingDays: '30',
    subscriptionRule: 'region:hk AND tier:premium'
  };
}

function createClientIdentity(protocol: XrayProtocol) {
  if (protocol === 'trojan') {
    return 'trojan-strong-password';
  }

  if (protocol === 'shadowsocks') {
    return 'ss-strong-password';
  }

  if (protocol === 'hysteria') {
    return 'hysteria-auth-secret';
  }

  return '9f3f5b3e-1f42-4f46-9b76-22e8d0bbf3c1';
}

function createProtocolClient(protocol: XrayProtocol, identity: string) {
  if (protocol === 'trojan' || protocol === 'shadowsocks') {
    return { password: identity };
  }

  if (protocol === 'hysteria') {
    return { auth: identity };
  }

  return { id: identity };
}

function encodeUtf8Base64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary);
}

function createShareQuery(draft: CustomerDraft) {
  const query = new URLSearchParams();
  const sni = draft.sni.trim();
  const path = draft.path.trim();

  if (draft.protocol === 'vless') {
    query.set('encryption', 'none');
  }

  query.set('type', draft.streamNetwork);

  if (draft.security !== 'none') {
    query.set('security', draft.security);
  }

  if (sni) {
    query.set('sni', sni);
    query.set('host', sni);
  }

  if (path && ['ws', 'grpc', 'httpupgrade', 'splithttp'].includes(draft.streamNetwork)) {
    query.set(draft.streamNetwork === 'grpc' ? 'serviceName' : 'path', path);
  }

  if (draft.flow.trim() && draft.protocol === 'vless') {
    query.set('flow', draft.flow.trim());
  }

  return query.toString();
}

function buildShareLink(draft: CustomerDraft, identity: string, port: number) {
  const server = draft.serverAddress.trim() || 'edge.example.com';
  const tag = encodeURIComponent(draft.nodeName.trim() || draft.customerName.trim() || 'OU-UI Next');
  const query = createShareQuery(draft);

  if (draft.protocol === 'vmess') {
    const vmessPayload = {
      v: '2',
      ps: draft.nodeName.trim() || 'OU-UI Next',
      add: server,
      port: String(port),
      id: identity,
      aid: '0',
      scy: 'auto',
      net: draft.streamNetwork,
      type: 'none',
      host: draft.sni.trim(),
      path: draft.path.trim(),
      tls: draft.security === 'none' ? '' : draft.security,
      sni: draft.sni.trim()
    };

    return `vmess://${encodeUtf8Base64(JSON.stringify(vmessPayload))}`;
  }

  if (draft.protocol === 'shadowsocks') {
    const credential = encodeUtf8Base64(`chacha20-ietf-poly1305:${identity}`);
    return `ss://${credential}@${server}:${port}#${tag}`;
  }

  if (draft.protocol === 'trojan') {
    return `trojan://${encodeURIComponent(identity)}@${server}:${port}${query ? `?${query}` : ''}#${tag}`;
  }

  if (draft.protocol === 'hysteria') {
    return `hysteria2://${encodeURIComponent(identity)}@${server}:${port}${query ? `?${query}` : ''}#${tag}`;
  }

  return `vless://${identity}@${server}:${port}${query ? `?${query}` : ''}#${tag}`;
}

function createStreamSettings(draft: CustomerDraft) {
  const sni = draft.sni.trim();
  const path = draft.path.trim();
  const streamSettings: Record<string, unknown> = {
    network: draft.streamNetwork,
    security: draft.security
  };

  if (draft.streamNetwork === 'ws' || draft.streamNetwork === 'httpupgrade' || draft.streamNetwork === 'splithttp') {
    streamSettings[`${draft.streamNetwork}Settings`] = {
      path: path || '/ou-ui',
      headers: sni ? { Host: sni } : undefined
    };
  }

  if (draft.streamNetwork === 'grpc') {
    streamSettings.grpcSettings = {
      serviceName: (path || 'ou-ui').replace(/^\//, '')
    };
  }

  if (draft.security === 'tls') {
    streamSettings.tlsSettings = {
      serverName: sni || undefined,
      alpn: ['h2', 'http/1.1']
    };
  }

  if (draft.security === 'reality') {
    streamSettings.realitySettings = {
      serverName: sni || 'www.cloudflare.com',
      fingerprint: 'chrome',
      shortIds: ['a1b2c3d4e5f6a7b8']
    };
  }

  return streamSettings;
}

function buildXrayArtifacts(draft: CustomerDraft) {
  const remainingDays = Math.max(Number.parseInt(draft.remainingDays, 10) || 0, 0);
  const trafficLimitGb = Math.max(Number.parseInt(draft.trafficLimitGb, 10) || 0, 0);
  const expiresAt = Date.now() + remainingDays * 24 * 60 * 60 * 1000;
  const identity = draft.clientIdentity.trim() || createClientIdentity(draft.protocol);
  const flow = draft.flow.trim();
  const port = Math.max(Number.parseInt(draft.listenPort, 10) || 1, 1);
  const client = {
    email: draft.customerName.trim() || 'customer',
    enable: true,
    ...createProtocolClient(draft.protocol, identity),
    ...(flow ? { flow } : {}),
    limitIp: Math.max(Number.parseInt(draft.ipLimit, 10) || 0, 0),
    totalGB: trafficLimitGb * 1024 * 1024 * 1024,
    expiryTime: expiresAt,
    subId: draft.subscriptionRule.trim() || 'manual'
  };

  const inboundConfig = JSON.stringify(
    {
      tag: `inbound-${draft.customerName.trim() || 'customer'}-${draft.protocol}`,
      protocol: draft.protocol,
      listen: '0.0.0.0',
      port,
      settings: {
        clients: [client]
      },
      streamSettings: createStreamSettings(draft),
      sniffing: {
        enabled: true,
        destOverride: ['http', 'tls', 'quic']
      }
    },
    null,
    2
  );

  return {
    inboundConfig,
    shareLink: buildShareLink(draft, identity, port)
  };
}

export function NodesPage({
  agents,
  language,
  nodes,
  taskMutationBusy = false,
  onDeployHostConfig,
  onDeleteHost,
  onInstallAgent,
  onPreviewAgentInstallCommand,
  onSaveHostConfig,
  onSaveCustomerNode
}: NodesPageProps) {
  const t = copy[language];
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace>('hosts');
  const [drawer, setDrawer] = useState<DrawerState>({ type: 'closed' });
  const [metadata, setMetadata] = useState<AgentInstallMetadata>(defaultInstallMetadata);
  const [installCommand, setInstallCommand] = useState<AgentInstallCommand>();
  const [previewError, setPreviewError] = useState(false);
  const [hostEdits, setHostEdits] = useState<Record<string, { name: string; maxTrafficGb: number }>>({});
  const [removedAgentIds, setRemovedAgentIds] = useState<string[]>([]);
  const [customerNodes, setCustomerNodes] = useState<CustomerNodeRecord[]>([]);
  const [customerDraft, setCustomerDraft] = useState<CustomerDraft>(() => createCustomerDraft(agents[0]));

  const visibleAgents = useMemo(
    () => agents.filter((agent) => !removedAgentIds.includes(agent.id)),
    [agents, removedAgentIds]
  );
  const onlineHostCount = visibleAgents.filter((agent) => agent.status === 'online').length;
  const visibleCustomerNodes = customerNodes.filter((node) => visibleAgents.some((agent) => agent.id === node.agentId));
  const selectedHost = drawer.type === 'editHost' || drawer.type === 'deleteHost'
    ? visibleAgents.find((agent) => agent.id === drawer.agentId)
    : undefined;
  const editingCustomerNode =
    drawer.type === 'customerNode' && drawer.nodeId
      ? customerNodes.find((node) => node.id === drawer.nodeId)
      : undefined;
  const customerArtifacts = buildXrayArtifacts(customerDraft);

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

  useEffect(() => {
    if (visibleAgents.length === 0) {
      return;
    }

    setCustomerDraft((current) =>
      visibleAgents.some((agent) => agent.id === current.agentId)
        ? current
        : { ...current, agentId: visibleAgents[0].id }
    );
  }, [visibleAgents]);

  useEffect(() => {
    if (customerNodes.length > 0 || agents.length === 0) {
      return;
    }

    setCustomerNodes([
      {
        id: 'customer-node-hkg-acme',
        agentId: agents[0].id,
        nodeName: '香港高级节点 01',
        customerName: 'Acme Team',
        serverAddress: agents[0].publicAddress,
        protocol: 'vless',
        listenPort: 443,
        clientIdentity: '9f3f5b3e-1f42-4f46-9b76-22e8d0bbf3c1',
        streamNetwork: 'tcp',
        security: 'reality',
        sni: 'www.cloudflare.com',
        path: '/ou-ui',
        flow: 'xtls-rprx-vision',
        ipLimit: 3,
        trafficLimitGb: 1024,
        remainingDays: 30,
        subscriptionRule: 'region:hk AND tier:premium'
      },
      {
        id: 'customer-node-hkg-media',
        agentId: agents[0].id,
        nodeName: '香港流媒体节点 02',
        customerName: 'Media Guild',
        serverAddress: agents[0].publicAddress,
        protocol: 'trojan',
        listenPort: 8443,
        clientIdentity: 'trojan-media-strong-password',
        streamNetwork: 'tcp',
        security: 'tls',
        sni: 'stream.example.com',
        path: '/media',
        flow: '',
        ipLimit: 2,
        trafficLimitGb: 512,
        remainingDays: 14,
        subscriptionRule: 'region:hk AND unlock:streaming'
      }
    ]);
  }, [agents, customerNodes.length]);

  function getHostEdit(agent: Agent) {
    const trafficGb = Math.round(agent.maxTrafficBytes / 1024 / 1024 / 1024);
    return hostEdits[agent.id] ?? { name: agent.name, maxTrafficGb: trafficGb };
  }

  function updateHost(agent: Agent, patch: Partial<{ name: string; maxTrafficGb: number }>) {
    setHostEdits((current) => ({
      ...current,
      [agent.id]: {
        ...getHostEdit(agent),
        ...patch
      }
    }));
  }

  function openCustomerDrawer(node?: CustomerNodeRecord) {
    if (node) {
      setCustomerDraft({
        agentId: node.agentId,
        nodeName: node.nodeName,
        customerName: node.customerName,
        serverAddress: node.serverAddress,
        protocol: node.protocol,
        listenPort: String(node.listenPort),
        clientIdentity: node.clientIdentity,
        streamNetwork: node.streamNetwork,
        security: node.security,
        sni: node.sni,
        path: node.path,
        flow: node.flow,
        ipLimit: String(node.ipLimit),
        trafficLimitGb: String(node.trafficLimitGb),
        remainingDays: String(node.remainingDays),
        subscriptionRule: node.subscriptionRule
      });
      setDrawer({ type: 'customerNode', nodeId: node.id });
      return;
    }

    setCustomerDraft(createCustomerDraft(visibleAgents[0]));
    setDrawer({ type: 'customerNode' });
  }

  function handleInstallSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onInstallAgent(metadata);
  }

  function handleSaveHost(agent: Agent) {
    const hostEdit = getHostEdit(agent);

    onSaveHostConfig({
      agentId: agent.id,
      hostName: hostEdit.name.trim() || agent.name,
      maxTrafficGb: Math.max(hostEdit.maxTrafficGb, 0)
    });
    setDrawer({ type: 'closed' });
  }

  function handleCustomerSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!customerDraft.agentId) {
      return;
    }

    const nextNode: CustomerNodeRecord = {
      id: editingCustomerNode?.id ?? `customer-node-${Date.now()}`,
      agentId: customerDraft.agentId,
      nodeName: customerDraft.nodeName.trim() || t.customerNodeName,
      customerName: customerDraft.customerName.trim() || t.customerName,
      serverAddress: customerDraft.serverAddress.trim() || 'edge.example.com',
      protocol: customerDraft.protocol,
      listenPort: Math.max(Number.parseInt(customerDraft.listenPort, 10) || 1, 1),
      clientIdentity: customerDraft.clientIdentity.trim() || createClientIdentity(customerDraft.protocol),
      streamNetwork: customerDraft.streamNetwork,
      security: customerDraft.security,
      sni: customerDraft.sni.trim(),
      path: customerDraft.path.trim(),
      flow: customerDraft.flow.trim(),
      ipLimit: Math.max(Number.parseInt(customerDraft.ipLimit, 10) || 0, 0),
      trafficLimitGb: Math.max(Number.parseInt(customerDraft.trafficLimitGb, 10) || 0, 0),
      remainingDays: Math.max(Number.parseInt(customerDraft.remainingDays, 10) || 0, 0),
      subscriptionRule: customerDraft.subscriptionRule.trim() || 'manual'
    };
    const saveAction = editingCustomerNode ? 'update' : 'create';

    onSaveCustomerNode(
      {
        nodeId: nextNode.id,
        agentId: nextNode.agentId,
        customerNodeName: nextNode.nodeName,
        customerName: nextNode.customerName,
        serverAddress: nextNode.serverAddress,
        xrayProtocol: nextNode.protocol,
        listenPort: nextNode.listenPort,
        clientIdentity: nextNode.clientIdentity,
        streamNetwork: nextNode.streamNetwork,
        security: nextNode.security,
        sni: nextNode.sni,
        path: nextNode.path,
        flow: nextNode.flow,
        ipLimit: nextNode.ipLimit,
        trafficLimitGb: nextNode.trafficLimitGb,
        remainingDays: nextNode.remainingDays,
        subscriptionRule: nextNode.subscriptionRule
      },
      saveAction
    );

    setCustomerNodes((current) =>
      editingCustomerNode
        ? current.map((node) => (node.id === editingCustomerNode.id ? nextNode : node))
        : [nextNode, ...current]
    );
    setDrawer({ type: 'closed' });
    setActiveWorkspace('customerNodes');
  }

  function handleDeleteHost(agent: Agent) {
    const hostEdit = getHostEdit(agent);

    onDeleteHost({
      agentId: agent.id,
      hostName: hostEdit.name.trim() || agent.name,
      maxTrafficGb: Math.max(hostEdit.maxTrafficGb, 0)
    });
    setRemovedAgentIds((current) => [...new Set([...current, agent.id])]);
    setCustomerNodes((current) => current.filter((node) => node.agentId !== agent.id));
    setDrawer({ type: 'closed' });
  }

  function handleDeleteCustomerNode(nodeId: string) {
    setCustomerNodes((current) => current.filter((node) => node.id !== nodeId));
  }

  function copyInstallCommand() {
    if (!installCommand?.command || typeof navigator === 'undefined') {
      return;
    }

    void navigator.clipboard?.writeText(installCommand.command);
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
            <WorkspaceButton active={activeWorkspace === 'hosts'} label={t.hostsTab} onClick={() => setActiveWorkspace('hosts')} />
            <WorkspaceButton
              active={activeWorkspace === 'customerNodes'}
              label={t.customerNodesTab}
              onClick={() => setActiveWorkspace('customerNodes')}
            />
          </div>
          <GlowButton className="gap-2 px-4 py-2 text-xs" onClick={() => setDrawer({ type: 'install' })}>
            <Terminal className="h-3.5 w-3.5" />
            {t.openInstall}
          </GlowButton>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
          <SummaryMetric icon={ServerCog} label={t.hostSummary} value={String(visibleAgents.length)} />
          <SummaryMetric icon={CheckCircle2} label={t.onlineSummary} value={String(onlineHostCount)} />
          <SummaryMetric icon={UserRound} label={t.customerSummary} value={String(visibleCustomerNodes.length)} />
        </div>
      </section>

      {activeWorkspace === 'hosts' ? (
        <section className="stagger-3 island-card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-5 dark:border-white/10">
            <div className="flex items-center gap-2">
              <ServerCog className="h-4 w-4 text-blue-500 dark:text-primary" />
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">{t.hostTableTitle}</h4>
            </div>
          </div>
          {visibleAgents.length === 0 ? (
            <EmptyState label={t.noAgent} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-left">
                <thead className="bg-slate-50/70 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:bg-white/[0.03] dark:text-white/40">
                  <tr>
                    <th className="px-5 py-3">{t.hostAlias}</th>
                    <th className="px-5 py-3">{t.endpoint}</th>
                    <th className="px-5 py-3">{t.traffic}</th>
                    <th className="px-5 py-3">{t.telemetry}</th>
                    <th className="px-5 py-3">{t.runtime}</th>
                    <th className="px-5 py-3 text-right">{t.actions}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-white/10">
                  {visibleAgents.map((agent) => {
                    const hostEdit = getHostEdit(agent);
                    const agentNodes = nodes.filter((node) => node.agentId === agent.id);
                    const usedTraffic = agent.telemetry.txBytes + agent.telemetry.rxBytes;

                    return (
                      <tr key={agent.id} className="transition-colors hover:bg-slate-50/60 dark:hover:bg-white/[0.03]">
                        <td className="px-5 py-4">
                          <div className="flex items-start gap-3">
                            <span className="mt-1 rounded-lg bg-blue-500/10 p-2 text-blue-600 dark:bg-primary/10 dark:text-primary">
                              <ServerCog className="h-4 w-4" />
                            </span>
                            <div>
                              <p className="text-sm font-bold text-slate-900 dark:text-white">{hostEdit.name}</p>
                              <p className="mt-1 text-[11px] font-semibold text-slate-500 dark:text-white/45">
                                {agent.platform} / {agent.version}
                              </p>
                              <span className="mt-2 inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase text-slate-500 dark:bg-white/10 dark:text-white/50">
                                {t.statusLabels[agent.status]}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <p className="font-mono text-xs font-semibold text-slate-700 dark:text-white/70">{agent.publicAddress}</p>
                          <p className="mt-1 text-[11px] text-slate-500 dark:text-white/45">
                            {agent.region} / {agent.connectionMode}
                          </p>
                        </td>
                        <td className="px-5 py-4">
                          <p className="text-xs font-bold text-slate-800 dark:text-white/80">
                            {formatBytes(usedTraffic)} / {hostEdit.maxTrafficGb}
                            {t.unitGb}
                          </p>
                          <p className="mt-1 text-[11px] text-slate-500 dark:text-white/45">
                            {agentNodes[0]?.name ?? t.noNode}
                          </p>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex flex-wrap gap-2">
                            <SmallMetric icon={Cpu} label="CPU" value={formatPercent(agent.telemetry.cpuPercent)} />
                            <SmallMetric icon={Gauge} label="MEM" value={formatPercent(agent.telemetry.memoryPercent)} />
                            <SmallMetric icon={Network} label="RTT" value={`${agent.telemetry.latencyMs}ms`} />
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex max-w-[220px] flex-wrap gap-2">
                            {(agentNodes[0]?.modules ?? []).map((module) => (
                              <span
                                key={module.id}
                                className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase text-slate-500 dark:bg-white/10 dark:text-white/50"
                              >
                                {module.kind}
                              </span>
                            ))}
                            {agentNodes.length === 0 ? (
                              <span className="text-[11px] font-semibold text-slate-500 dark:text-white/45">{t.noNode}</span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex justify-end gap-2">
                            <IconButton label={t.deployHostConfig} onClick={() => onDeployHostConfig(agent)}>
                              <Send className="h-3.5 w-3.5" />
                            </IconButton>
                            <IconButton label={t.editHost} onClick={() => setDrawer({ type: 'editHost', agentId: agent.id })}>
                              <Pencil className="h-3.5 w-3.5" />
                            </IconButton>
                            <IconButton
                              danger
                              label={t.deleteHost}
                              onClick={() => setDrawer({ type: 'deleteHost', agentId: agent.id })}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </IconButton>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : (
        <section className="stagger-3 island-card overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 p-5 dark:border-white/10">
            <div>
              <div className="flex items-center gap-2">
                <UserRound className="h-4 w-4 text-blue-500 dark:text-primary" />
                <h4 className="text-sm font-bold text-slate-900 dark:text-white">{t.customerNodesTitle}</h4>
              </div>
              <p className="mt-1 max-w-3xl text-xs leading-6 text-slate-500 dark:text-white/45">{t.customerNodesHint}</p>
            </div>
            <GlowButton
              className="gap-2 px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
              disabled={visibleAgents.length === 0}
              onClick={() => openCustomerDrawer()}
            >
              <Plus className="h-3.5 w-3.5" />
              {t.addCustomerNode}
            </GlowButton>
          </div>

          {visibleCustomerNodes.length === 0 ? (
            <EmptyState label={t.noCustomerNode} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left">
                <thead className="bg-slate-50/70 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:bg-white/[0.03] dark:text-white/40">
                  <tr>
                    <th className="px-5 py-3">{t.customerNodeName}</th>
                    <th className="px-5 py-3">{t.customerName}</th>
                    <th className="px-5 py-3">{t.assignedHost}</th>
                    <th className="px-5 py-3">{t.protocolConfig}</th>
                    <th className="px-5 py-3">{t.maxTraffic}</th>
                    <th className="px-5 py-3">{t.subscriptionRule}</th>
                    <th className="px-5 py-3 text-right">{t.actions}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-white/10">
                  {visibleCustomerNodes.map((node) => {
                    const agent = visibleAgents.find((item) => item.id === node.agentId);

                    return (
                      <tr key={node.id} className="transition-colors hover:bg-slate-50/60 dark:hover:bg-white/[0.03]">
                        <td className="px-5 py-4">
                          <p className="text-sm font-bold text-slate-900 dark:text-white">{node.nodeName}</p>
                          <p className="mt-1 text-[11px] text-slate-500 dark:text-white/45">
                            {node.remainingDays} {t.unitDays}
                          </p>
                        </td>
                        <td className="px-5 py-4 text-xs font-semibold text-slate-700 dark:text-white/70">
                          {node.customerName}
                        </td>
                        <td className="px-5 py-4 text-xs font-semibold text-slate-700 dark:text-white/70">
                          {agent ? getHostEdit(agent).name : t.unknownHost}
                        </td>
                        <td className="px-5 py-4">
                          <p className="font-mono text-xs font-semibold uppercase text-slate-700 dark:text-white/70">
                            {node.protocol}:{node.listenPort}
                          </p>
                          <p className="mt-1 text-[11px] text-slate-500 dark:text-white/45">
                            {node.streamNetwork} / {node.security} / IP {node.ipLimit}
                          </p>
                        </td>
                        <td className="px-5 py-4 text-xs font-semibold text-slate-700 dark:text-white/70">
                          {node.trafficLimitGb} {t.unitGb}
                        </td>
                        <td className="px-5 py-4">
                          <code className="rounded-lg bg-slate-100 px-2.5 py-1 font-mono text-[11px] text-slate-600 dark:bg-white/10 dark:text-white/60">
                            {node.subscriptionRule}
                          </code>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex justify-end gap-2">
                            <IconButton label={t.editCustomerNode} onClick={() => openCustomerDrawer(node)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </IconButton>
                            <IconButton danger label={t.deleteCustomerNode} onClick={() => handleDeleteCustomerNode(node.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </IconButton>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <ConfigDrawer
        description={t.installDescription}
        open={drawer.type === 'install'}
        title={t.installTitle}
        onClose={() => setDrawer({ type: 'closed' })}
      >
        <form className="space-y-4" onSubmit={handleInstallSubmit}>
          <InputField
            label={t.hostName}
            value={metadata.hostName}
            onChange={(value) => setMetadata((current) => ({ ...current, hostName: value }))}
          />
          <InfoField label={t.tokenPolicy} value={t.tokenPolicyValue} />
          <InfoField label={t.capabilitySet} value={t.capabilitySetValue} />

          <div className="rounded-xl border border-slate-200 bg-slate-100/80 p-3 dark:border-white/10 dark:bg-black/20">
            <div className="mb-2 flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
              <span>{t.commandPreview}</span>
              <button aria-label={t.commandPreview} className="rounded-full p-1 hover:bg-white/70 dark:hover:bg-white/10" onClick={copyInstallCommand} type="button">
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>
            <p className="mb-2 flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-white">
              <KeyRound className="h-3.5 w-3.5 text-slate-400" />
              {installCommand?.agentId ?? metadata.hostName}
            </p>
            {installCommand ? (
              <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-slate-500 dark:text-white/40">
                {t.tokenExpires} {formatDateTime(installCommand.expiresAt, language)}
              </p>
            ) : null}
            <code className="block break-all font-mono text-[10px] leading-5 text-slate-700 dark:text-white/70">
              {previewError ? t.commandUnavailable : installCommand?.command ?? t.commandLoading}
            </code>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <GhostButton label={t.cancel} onClick={() => setDrawer({ type: 'closed' })} />
            <GlowButton className="px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60" disabled={taskMutationBusy} type="submit">
              {taskMutationBusy ? t.submitting : t.submitInstall}
            </GlowButton>
          </div>
        </form>
      </ConfigDrawer>

      <ConfigDrawer
        open={drawer.type === 'editHost'}
        title={t.editHost}
        onClose={() => setDrawer({ type: 'closed' })}
      >
        {selectedHost ? (
          <div className="space-y-4">
            <InputField
              label={t.hostAlias}
              value={getHostEdit(selectedHost).name}
              onChange={(value) => updateHost(selectedHost, { name: value })}
            />
            <InputField
              label={t.maxTraffic}
              suffix={t.unitGb}
              type="number"
              value={String(getHostEdit(selectedHost).maxTrafficGb)}
              onChange={(value) =>
                updateHost(selectedHost, { maxTrafficGb: Math.max(Number.parseInt(value, 10) || 0, 0) })
              }
            />
            <div className="flex justify-end gap-3 pt-2">
              <GhostButton label={t.cancel} onClick={() => setDrawer({ type: 'closed' })} />
              <GlowButton
                className="px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                disabled={taskMutationBusy}
                onClick={() => handleSaveHost(selectedHost)}
              >
                {t.save}
              </GlowButton>
            </div>
          </div>
        ) : null}
      </ConfigDrawer>

      <ConfigDrawer
        description={t.deleteHostDescription}
        open={drawer.type === 'deleteHost'}
        title={t.deleteHostTitle}
        onClose={() => setDrawer({ type: 'closed' })}
      >
        {selectedHost ? (
          <div className="space-y-4">
            <InfoField label={t.hostAlias} value={getHostEdit(selectedHost).name} />
            <div className="flex justify-end gap-3 pt-2">
              <GhostButton label={t.cancel} onClick={() => setDrawer({ type: 'closed' })} />
              <button
                className="rounded-xl bg-rose-500 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-rose-500/20 transition hover:bg-rose-400"
                disabled={taskMutationBusy}
                onClick={() => handleDeleteHost(selectedHost)}
                type="button"
              >
                {t.confirmDelete}
              </button>
            </div>
          </div>
        ) : null}
      </ConfigDrawer>

      <ConfigDrawer
        open={drawer.type === 'customerNode'}
        title={editingCustomerNode ? t.editCustomerNode : t.addCustomerNode}
        onClose={() => setDrawer({ type: 'closed' })}
      >
        <form className="space-y-4" onSubmit={handleCustomerSubmit}>
          <SelectField
            label={t.assignedHost}
            value={customerDraft.agentId}
            onChange={(value) => setCustomerDraft((current) => ({ ...current, agentId: value }))}
            options={visibleAgents.map((agent) => ({ label: getHostEdit(agent).name, value: agent.id }))}
          />
          <InputField
            label={t.customerNodeName}
            value={customerDraft.nodeName}
            onChange={(value) => setCustomerDraft((current) => ({ ...current, nodeName: value }))}
          />
          <InputField
            label={t.customerName}
            value={customerDraft.customerName}
            onChange={(value) => setCustomerDraft((current) => ({ ...current, customerName: value }))}
          />
          <InputField
            label={t.serverAddress}
            value={customerDraft.serverAddress}
            onChange={(value) => setCustomerDraft((current) => ({ ...current, serverAddress: value }))}
          />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <SelectField
              label={t.protocol}
              value={customerDraft.protocol}
              onChange={(value) =>
                setCustomerDraft((current) => ({
                  ...current,
                  protocol: value as XrayProtocol,
                  clientIdentity: createClientIdentity(value as XrayProtocol),
                  flow: value === 'vless' ? current.flow || 'xtls-rprx-vision' : ''
                }))
              }
              options={[
                { label: 'VLESS', value: 'vless' },
                { label: 'VMess', value: 'vmess' },
                { label: 'Trojan', value: 'trojan' },
                { label: 'Shadowsocks', value: 'shadowsocks' },
                { label: 'Hysteria', value: 'hysteria' }
              ]}
            />
            <InputField
              label={t.listenPort}
              type="number"
              value={customerDraft.listenPort}
              onChange={(value) => setCustomerDraft((current) => ({ ...current, listenPort: value }))}
            />
          </div>
          <InputField
            label={t.clientIdentity}
            value={customerDraft.clientIdentity}
            onChange={(value) => setCustomerDraft((current) => ({ ...current, clientIdentity: value }))}
          />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <SelectField
              label={t.streamNetwork}
              value={customerDraft.streamNetwork}
              onChange={(value) => setCustomerDraft((current) => ({ ...current, streamNetwork: value as XrayStreamSettings['network'] }))}
              options={[
                { label: 'TCP', value: 'tcp' },
                { label: 'WebSocket', value: 'ws' },
                { label: 'gRPC', value: 'grpc' },
                { label: 'HTTP Upgrade', value: 'httpupgrade' },
                { label: 'Split HTTP', value: 'splithttp' }
              ]}
            />
            <SelectField
              label={t.security}
              value={customerDraft.security}
              onChange={(value) => setCustomerDraft((current) => ({ ...current, security: value as XrayStreamSettings['security'] }))}
              options={[
                { label: 'None', value: 'none' },
                { label: 'TLS', value: 'tls' },
                { label: 'Reality', value: 'reality' }
              ]}
            />
            <InputField
              label={t.ipLimit}
              type="number"
              value={customerDraft.ipLimit}
              onChange={(value) => setCustomerDraft((current) => ({ ...current, ipLimit: value }))}
            />
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <InputField
              label={t.sni}
              value={customerDraft.sni}
              onChange={(value) => setCustomerDraft((current) => ({ ...current, sni: value }))}
            />
            <InputField
              label={t.path}
              value={customerDraft.path}
              onChange={(value) => setCustomerDraft((current) => ({ ...current, path: value }))}
            />
          </div>
          <InputField
            label={t.flow}
            value={customerDraft.flow}
            onChange={(value) => setCustomerDraft((current) => ({ ...current, flow: value }))}
          />
          <InputField
            label={t.maxTraffic}
            suffix={t.unitGb}
            type="number"
            value={customerDraft.trafficLimitGb}
            onChange={(value) => setCustomerDraft((current) => ({ ...current, trafficLimitGb: value }))}
          />
          <InputField
            label={t.remainingTime}
            suffix={t.unitDays}
            type="number"
            value={customerDraft.remainingDays}
            onChange={(value) => setCustomerDraft((current) => ({ ...current, remainingDays: value }))}
          />
          <InputField
            label={t.subscriptionRule}
            value={customerDraft.subscriptionRule}
            onChange={(value) => setCustomerDraft((current) => ({ ...current, subscriptionRule: value }))}
          />
          <div className="rounded-xl border border-slate-200 bg-slate-100/80 p-3 dark:border-white/10 dark:bg-black/20">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
              {t.protocolLink}
            </p>
            <code className="mb-4 block break-all font-mono text-[10px] leading-5 text-slate-700 dark:text-white/70">
              {customerArtifacts.shareLink}
            </code>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
              {t.configPreview}
            </p>
            <code className="block whitespace-pre-wrap break-all font-mono text-[10px] leading-5 text-slate-700 dark:text-white/70">
              {customerArtifacts.inboundConfig}
            </code>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <GhostButton label={t.cancel} onClick={() => setDrawer({ type: 'closed' })} />
            <GlowButton className="px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60" disabled={taskMutationBusy || visibleAgents.length === 0} type="submit">
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
  icon: typeof ServerCog;
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

function SmallMetric({
  label,
  value,
  icon: Icon
}: {
  label: string;
  value: string;
  icon: typeof Cpu;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-500 dark:bg-white/10 dark:text-white/55">
      <Icon className="h-3 w-3" />
      {label} {value}
    </span>
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

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white/60 p-3 dark:border-white/10 dark:bg-black/20">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</p>
      <p className="mt-1 break-words font-semibold text-slate-700 dark:text-white/70">{value}</p>
    </div>
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
  return (
    <div className="p-8 text-center text-sm font-semibold text-slate-500 dark:text-white/50">
      {label}
    </div>
  );
}
