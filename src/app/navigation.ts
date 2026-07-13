import type { AppLanguage } from './app-store';

export type PageId =
  | 'dashboard'
  | 'recovery'
  | 'customers'
  | 'customerNodes'
  | 'nodes'
  | 'forwarding'
  | 'subscriptions'
  | 'routing'
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
  { id: 'dashboard', label: '概览', description: '运行状态' },
  { id: 'recovery', label: '恢复中心', description: '失败、漂移与补偿队列' },
  { id: 'customers', label: '客户', description: '客户目录与归属' },
  { id: 'customerNodes', label: '节点', description: 'VLESS 与客户节点' },
  { id: 'nodes', label: '服务器', description: '接入与遥测' },
  { id: 'forwarding', label: '端口转发', description: '多主机端口转发' },
  { id: 'subscriptions', label: '订阅', description: '订阅身份与导出文件' },
  { id: 'routing', label: '分流策略', description: '路由与策略编排' },
  { id: 'tuning', label: '调优', description: 'Agent 调优任务' },
  { id: 'telegram', label: '通知', description: 'Telegram Bot 与客户绑定' },
  { id: 'adminAccounts', label: '账户', description: '登录凭据、会话与系统设置' },
  { id: 'tasks', label: '执行记录', description: '任务状态与回滚' },
  { id: 'audit', label: '审计', description: '不可抵赖操作记录' }
];

export const englishNavigationItems: NavigationItem[] = [
  { id: 'dashboard', label: 'Overview', description: 'Control plane overview' },
  { id: 'recovery', label: 'Recovery', description: 'Failures, drift, and compensation' },
  { id: 'customers', label: 'Customers', description: 'Customer directory and ownership' },
  { id: 'customerNodes', label: 'Nodes', description: 'VLESS and customer nodes' },
  { id: 'nodes', label: 'Servers', description: 'Enrollment and telemetry' },
  { id: 'forwarding', label: 'Port Forwarding', description: 'Multi-host port forwarding' },
  { id: 'subscriptions', label: 'Subscriptions', description: 'Identities and export files' },
  { id: 'routing', label: 'Routing', description: 'Policy orchestration' },
  { id: 'tuning', label: 'Tuning', description: 'Agent tuning tasks' },
  { id: 'telegram', label: 'Notifications', description: 'Telegram bot and bindings' },
  { id: 'adminAccounts', label: 'Accounts', description: 'Login credentials, sessions, and settings' },
  { id: 'tasks', label: 'Execution', description: 'Task state and rollback' },
  { id: 'audit', label: 'Audit', description: 'Non-repudiation ledger' }
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
        id: 'operations',
        label: '运行工作台',
        description: '主机、节点、转发、订阅',
        children: [
          createLeaf(items, 'dashboard'),
          createLeaf(items, 'recovery'),
          createLeaf(items, 'nodes'),
          createLeaf(items, 'customerNodes'),
          createLeaf(items, 'forwarding'),
          createLeaf(items, 'subscriptions')
        ]
      },
      {
        type: 'group',
        id: 'delivery',
        label: '客户与策略',
        description: '客户、分流、调优、通知',
        children: [
          createLeaf(items, 'customers'),
          createLeaf(items, 'routing'),
          createLeaf(items, 'tuning'),
          createLeaf(items, 'telegram')
        ]
      },
      {
        type: 'group',
        id: 'evidence',
        label: '证据与设置',
        description: '任务、审计、账户安全',
        children: [
          createLeaf(items, 'tasks'),
          createLeaf(items, 'audit'),
          createLeaf(items, 'adminAccounts')
        ]
      }
    ];
  }

  return [
    {
      type: 'group',
      id: 'operations',
      label: 'Operations',
      description: 'Hosts, nodes, forwarding, subscriptions',
      children: [
        createLeaf(items, 'dashboard'),
        createLeaf(items, 'recovery'),
        createLeaf(items, 'nodes'),
        createLeaf(items, 'customerNodes'),
        createLeaf(items, 'forwarding'),
        createLeaf(items, 'subscriptions')
      ]
    },
    {
      type: 'group',
      id: 'delivery',
      label: 'Customers & Policy',
      description: 'Customers, routing, tuning, notifications',
      children: [
        createLeaf(items, 'customers'),
        createLeaf(items, 'routing'),
        createLeaf(items, 'tuning'),
        createLeaf(items, 'telegram')
      ]
    },
    {
      type: 'group',
      id: 'evidence',
      label: 'Evidence & Settings',
      description: 'Tasks, audit, account security',
      children: [
        createLeaf(items, 'tasks'),
        createLeaf(items, 'audit'),
        createLeaf(items, 'adminAccounts')
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
