import { lazy } from 'react';
import { appShellPageLoaders } from './app-shell-page-prefetch';
export const AdminAccountSettingsPage = lazy(() =>
  appShellPageLoaders.adminAccounts().then((module) => ({
    default: module.AdminAccountSettingsPage
  }))
);

export const AuditPage = lazy(() => appShellPageLoaders.audit().then((module) => ({ default: module.AuditPage })));

export const CustomersPage = lazy(() => appShellPageLoaders.customers().then((module) => ({ default: module.CustomersPage })));

export const DashboardPage = lazy(() => appShellPageLoaders.dashboard().then((module) => ({ default: module.DashboardPage })));

export const ForwardingPage = lazy(() =>
  appShellPageLoaders.forwarding().then((module) => ({ default: module.ForwardingPage }))
);

export const NodesPage = lazy(() => appShellPageLoaders.nodes().then((module) => ({ default: module.NodesPage })));

export const RecoveryCenterPage = lazy(() =>
  appShellPageLoaders.recovery().then((module) => ({ default: module.RecoveryCenterPage }))
);

export const RoutingPage = lazy(() => appShellPageLoaders.routing().then((module) => ({ default: module.RoutingPage })));

export const SubscriptionMixerPage = lazy(() =>
  appShellPageLoaders.subscriptions().then((module) => ({
    default: module.SubscriptionMixerPage
  }))
);

export const TasksPage = lazy(() => appShellPageLoaders.tasks().then((module) => ({ default: module.TasksPage })));

export const TelegramNotificationSettingsPage = lazy(() =>
  appShellPageLoaders.telegram().then((module) => ({
    default: module.TelegramNotificationSettingsPage
  }))
);

export const TuningPage = lazy(() => appShellPageLoaders.tuning().then((module) => ({ default: module.TuningPage })));
