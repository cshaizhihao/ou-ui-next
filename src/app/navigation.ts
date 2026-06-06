import type { AppLanguage } from './app-store';

export type PageId =
  | 'dashboard'
  | 'customers'
  | 'customerNodes'
  | 'nodes'
  | 'forwarding'
  | 'subscriptions'
  | 'routing'
  | 'permissions'
  | 'telegram'
  | 'adminAccounts'
  | 'tuning'
  | 'tasks'
  | 'audit';

export type NavigationItem = {
  id: PageId;
  label: string;
  description: string;
};

export type NavigationLeaf = {
  type: 'item';
  item: NavigationItem;
};

export type NavigationGroup = {
  type: 'group';
  id: string;
  label: string;
  description: string;
  children: NavigationEntry[];
};

export type NavigationEntry = NavigationLeaf | NavigationGroup;

export const navigationItems: NavigationItem[] = [
  { id: 'dashboard', label: '系统总览', description: '控制面总览' },
  { id: 'customers', label: '客户管理', description: '客户目录与归属' },
  { id: 'customerNodes', label: '节点管理', description: '客户节点与协议配置' },
  { id: 'nodes', label: '主机探针', description: '主机接入与遥测' },
  { id: 'forwarding', label: '端口转发', description: '多主机端口转发' },
  { id: 'subscriptions', label: '订阅管理', description: '订阅身份与导出文件' },
  { id: 'routing', label: '分流策略', description: '路由与策略编排' },
  { id: 'tuning', label: '系统调优', description: 'Agent 调优任务' },
  { id: 'permissions', label: '安全策略', description: '访问与配额策略' },
  { id: 'telegram', label: 'Telegram 通知设置', description: 'Bot 通知与客户绑定' },
  { id: 'adminAccounts', label: '管理员账户设置', description: '登录凭据与会话' },
  { id: 'tasks', label: '执行记录', description: '任务状态与回滚' },
  { id: 'audit', label: '审计日志', description: '不可抵赖操作记录' }
];

export const englishNavigationItems: NavigationItem[] = [
  { id: 'dashboard', label: 'Overview', description: 'Control plane overview' },
  { id: 'customers', label: 'Customers', description: 'Customer directory and ownership' },
  { id: 'customerNodes', label: 'Node Management', description: 'Customer nodes and protocol config' },
  { id: 'nodes', label: 'Host Probes', description: 'Managed host enrollment and telemetry' },
  { id: 'forwarding', label: 'Port Forwarding', description: 'Multi-host port forwarding' },
  { id: 'subscriptions', label: 'Subscription Management', description: 'Identities and export files' },
  { id: 'routing', label: 'Routing', description: 'Policy orchestration' },
  { id: 'tuning', label: 'Tuning', description: 'Agent tuning tasks' },
  { id: 'permissions', label: 'Security Policy', description: 'Access and quota policy' },
  { id: 'telegram', label: 'Telegram Notifications', description: 'Bot notifications and bindings' },
  { id: 'adminAccounts', label: 'Admin Accounts', description: 'Login credentials and sessions' },
  { id: 'tasks', label: 'Execution Log', description: 'Task state and rollback' },
  { id: 'audit', label: 'Audit Log', description: 'Non-repudiation ledger' }
];

export function getNavigationItems(language: AppLanguage = 'zh') {
  return language === 'zh' ? navigationItems : englishNavigationItems;
}

export function getNavigationItem(pageId: PageId, language: AppLanguage = 'zh') {
  const items = getNavigationItems(language);
  return items.find((item) => item.id === pageId) ?? items[0];
}

function createLeaf(items: NavigationItem[], id: PageId): NavigationLeaf {
  const item = items.find((candidate) => candidate.id === id);

  if (!item) {
    throw new Error(`Unknown navigation item: ${id}`);
  }

  return { type: 'item', item };
}

export function getNavigationGroups(language: AppLanguage = 'zh'): NavigationGroup[] {
  const items = getNavigationItems(language);

  if (language === 'zh') {
    return [
      {
        type: 'group',
        id: 'overview',
        label: '系统总览',
        description: '控制面状态',
        children: [createLeaf(items, 'dashboard')]
      },
      {
        type: 'group',
        id: 'features',
        label: '功能管理',
        description: '节点、转发与订阅',
        children: [
          {
            type: 'group',
            id: 'node-management',
            label: '节点管理',
            description: '客户与协议节点',
            children: [createLeaf(items, 'nodes'), createLeaf(items, 'customerNodes'), createLeaf(items, 'customers')]
          },
          createLeaf(items, 'forwarding'),
          createLeaf(items, 'subscriptions'),
          createLeaf(items, 'tuning')
        ]
      },
      {
        type: 'group',
        id: 'settings',
        label: '系统设置',
        description: '策略与日志',
        children: [
          createLeaf(items, 'routing'),
          createLeaf(items, 'permissions'),
          createLeaf(items, 'telegram'),
          createLeaf(items, 'adminAccounts'),
          {
            type: 'group',
            id: 'logs',
            label: '日志',
            description: '执行与审计',
            children: [createLeaf(items, 'tasks'), createLeaf(items, 'audit')]
          }
        ]
      }
    ];
  }

  return [
    {
      type: 'group',
      id: 'overview',
      label: 'System Overview',
      description: 'Control-plane state',
      children: [createLeaf(items, 'dashboard')]
    },
    {
      type: 'group',
      id: 'features',
      label: 'Feature Management',
      description: 'Nodes, forwarding, and subscriptions',
      children: [
        {
          type: 'group',
          id: 'node-management',
          label: 'Node Management',
          description: 'Customers and protocol nodes',
          children: [createLeaf(items, 'nodes'), createLeaf(items, 'customerNodes'), createLeaf(items, 'customers')]
        },
        createLeaf(items, 'forwarding'),
        createLeaf(items, 'subscriptions'),
        createLeaf(items, 'tuning')
      ]
    },
    {
      type: 'group',
      id: 'settings',
      label: 'System Settings',
      description: 'Policies and logs',
      children: [
        createLeaf(items, 'routing'),
        createLeaf(items, 'permissions'),
        createLeaf(items, 'telegram'),
        createLeaf(items, 'adminAccounts'),
        {
          type: 'group',
          id: 'logs',
          label: 'Logs',
          description: 'Execution and audit',
          children: [createLeaf(items, 'tasks'), createLeaf(items, 'audit')]
        }
      ]
    }
  ];
}

export function navigationEntryContainsPage(entry: NavigationEntry, pageId: PageId): boolean {
  if (entry.type === 'item') {
    return entry.item.id === pageId;
  }

  return entry.children.some((child) => navigationEntryContainsPage(child, pageId));
}
