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
  { id: 'dashboard', label: '概览', description: '运行状态' },
  { id: 'customers', label: '客户', description: '客户目录与归属' },
  { id: 'customerNodes', label: '节点', description: 'VLESS 与客户节点' },
  { id: 'nodes', label: '服务器', description: '接入与遥测' },
  { id: 'forwarding', label: '端口转发', description: '多主机端口转发' },
  { id: 'subscriptions', label: '订阅', description: '订阅身份与导出文件' },
  { id: 'routing', label: '分流策略', description: '路由与策略编排' },
  { id: 'tuning', label: '调优', description: 'Agent 调优任务' },
  { id: 'permissions', label: '权限与配额', description: '访问与配额策略' },
  { id: 'telegram', label: '通知', description: 'Telegram Bot 与客户绑定' },
  { id: 'adminAccounts', label: '账户', description: '登录凭据与会话' },
  { id: 'tasks', label: '执行记录', description: '任务状态与回滚' },
  { id: 'audit', label: '审计', description: '不可抵赖操作记录' }
];

export const englishNavigationItems: NavigationItem[] = [
  { id: 'dashboard', label: 'Overview', description: 'Control plane overview' },
  { id: 'customers', label: 'Customers', description: 'Customer directory and ownership' },
  { id: 'customerNodes', label: 'Nodes', description: 'VLESS and customer nodes' },
  { id: 'nodes', label: 'Servers', description: 'Enrollment and telemetry' },
  { id: 'forwarding', label: 'Port Forwarding', description: 'Multi-host port forwarding' },
  { id: 'subscriptions', label: 'Subscriptions', description: 'Identities and export files' },
  { id: 'routing', label: 'Routing', description: 'Policy orchestration' },
  { id: 'tuning', label: 'Tuning', description: 'Agent tuning tasks' },
  { id: 'permissions', label: 'Access & Quotas', description: 'Access and quota policy' },
  { id: 'telegram', label: 'Notifications', description: 'Telegram bot and bindings' },
  { id: 'adminAccounts', label: 'Accounts', description: 'Login credentials and sessions' },
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
        id: 'core',
        label: '常用路径',
        description: '自托管节点交付',
        children: [createLeaf(items, 'dashboard'), createLeaf(items, 'nodes'), createLeaf(items, 'customerNodes'), createLeaf(items, 'tasks')]
      },
      {
        type: 'group',
        id: 'advanced',
        label: '高级功能',
        description: '客户、订阅、转发与策略',
        children: [
          createLeaf(items, 'customers'),
          createLeaf(items, 'forwarding'),
          createLeaf(items, 'subscriptions'),
          createLeaf(items, 'routing'),
          createLeaf(items, 'tuning'),
          createLeaf(items, 'permissions'),
          createLeaf(items, 'telegram'),
          createLeaf(items, 'adminAccounts'),
          createLeaf(items, 'audit')
        ]
      }
    ];
  }

  return [
    {
      type: 'group',
      id: 'core',
      label: 'Common Path',
      description: 'Self-hosted node delivery',
      children: [createLeaf(items, 'dashboard'), createLeaf(items, 'nodes'), createLeaf(items, 'customerNodes'), createLeaf(items, 'tasks')]
    },
    {
      type: 'group',
      id: 'advanced',
      label: 'Advanced Features',
      description: 'Customers, subscriptions, forwarding, and policy',
      children: [
        createLeaf(items, 'customers'),
        createLeaf(items, 'forwarding'),
        createLeaf(items, 'subscriptions'),
        createLeaf(items, 'routing'),
        createLeaf(items, 'tuning'),
        createLeaf(items, 'permissions'),
        createLeaf(items, 'telegram'),
        createLeaf(items, 'adminAccounts'),
        createLeaf(items, 'audit')
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
