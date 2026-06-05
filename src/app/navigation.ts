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
  | 'tuning'
  | 'tasks'
  | 'audit';

export type NavigationItem = {
  id: PageId;
  label: string;
  description: string;
};

export const navigationItems: NavigationItem[] = [
  { id: 'dashboard', label: '系统总览', description: '控制面总览' },
  { id: 'customers', label: '客户管理', description: '客户目录与归属' },
  { id: 'customerNodes', label: '客户节点', description: 'Xray 入站与协议客户' },
  { id: 'nodes', label: '受控主机', description: '主机接入与遥测' },
  { id: 'forwarding', label: '端口转发', description: '多主机端口转发' },
  { id: 'subscriptions', label: '订阅管理', description: '订阅身份与导出文件' },
  { id: 'routing', label: '分流策略', description: '路由与策略编排' },
  { id: 'permissions', label: '安全策略', description: '访问与配额策略' },
  { id: 'tuning', label: '系统调优', description: '内核与运行时调优' },
  { id: 'tasks', label: '执行记录', description: '任务状态与回滚' },
  { id: 'audit', label: '审计日志', description: '不可抵赖操作记录' }
];

export const englishNavigationItems: NavigationItem[] = [
  { id: 'dashboard', label: 'Overview', description: 'Control plane overview' },
  { id: 'customers', label: 'Customers', description: 'Customer directory and ownership' },
  { id: 'customerNodes', label: 'Customer Nodes', description: 'Xray inbounds and protocol clients' },
  { id: 'nodes', label: 'Managed Hosts', description: 'Managed host enrollment and telemetry' },
  { id: 'forwarding', label: 'Port Forwarding', description: 'Multi-host port forwarding' },
  { id: 'subscriptions', label: 'Subscription Management', description: 'Identities and export files' },
  { id: 'routing', label: 'Routing', description: 'Policy orchestration' },
  { id: 'permissions', label: 'Security Policy', description: 'Access and quota policy' },
  { id: 'tuning', label: 'Tuning', description: 'Kernel and runtime tuning' },
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
