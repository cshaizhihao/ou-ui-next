import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, vi } from 'vitest';
import type { TelegramBindingReadModel, TelegramNotificationDelivery } from '../../domain';
import {
  createDefaultTelegramBotSettings,
  createDefaultTelegramNotificationPolicy
} from '../../services/api/telegram-bot';
import { TelegramNotificationSettingsPage } from './telegram-notification-settings-page';

afterEach(() => {
  vi.unstubAllGlobals();
});

function createBinding(): TelegramBindingReadModel {
  return {
    id: 'telegram-binding-0001',
    chat: {
      id: 'telegram-chat-0001',
      telegramChatId: '999000111',
      telegramUserId: '888000222',
      chatType: 'private',
      username: 'acme_ops',
      displayName: 'Acme Ops',
      status: 'active',
      isAdminRecipient: false,
      firstSeenAt: '2026-06-06T10:00:00.000Z',
      source: 'admin_direct',
      createdAt: '2026-06-06T10:00:00.000Z',
      updatedAt: '2026-06-06T10:00:00.000Z'
    },
    customerBinding: {
      id: 'telegram-binding-0001',
      chatBindingId: 'telegram-chat-0001',
      customerId: 'customer-acme',
      customerNameSnapshot: 'Acme Team',
      scopeType: 'customer',
      permissions: {
        receiveNotifications: true,
        queryTraffic: true,
        queryExpiry: true,
        queryNodes: true,
        receiveSubscriptionLinks: false,
        manageNotificationPolicy: true
      },
      status: 'active',
      createdAt: '2026-06-06T10:00:00.000Z',
      createdBy: 'admin',
      auditEvidenceId: 'audit-telegram-binding-0001'
    }
  };
}

function createDelivery(): TelegramNotificationDelivery {
  return {
    id: 'telegram-delivery-0001',
    dedupeKey: 'test:telegram-binding-0001',
    notificationType: 'test.notification',
    recipientKind: 'customer-binding',
    chatBindingId: 'telegram-chat-0001',
    customerBindingId: 'telegram-binding-0001',
    policyId: 'telegram-policy-default',
    templateId: 'test.notification.en',
    language: 'en',
    status: 'delivered',
    createdAt: '2026-06-06T10:00:00.000Z',
    updatedAt: '2026-06-06T10:00:05.000Z',
    nextAttemptAt: '2026-06-06T10:00:00.000Z',
    attemptCount: 1,
    maxAttempts: 3,
    deliveredAt: '2026-06-06T10:00:05.000Z',
    renderedPreviewRedacted: 'Test notification: Telegram Bot is connected to OU-UI Next.',
    payloadHash: `sha256:${'0'.repeat(64)}`,
    target: {
      customerId: 'customer-acme',
      scopeType: 'customer'
    }
  };
}

function createFailedDelivery(): TelegramNotificationDelivery {
  return {
    id: 'telegram-delivery-dead-letter-0002',
    dedupeKey: 'system-alert:alert-runtime-apply-health-failed',
    notificationType: 'system.alert',
    recipientKind: 'admin-chat',
    adminChatId: '[redacted-chat-id]',
    policyId: 'telegram-policy-default',
    templateId: 'system.alert.en',
    language: 'en',
    status: 'dead_letter',
    createdAt: '2026-06-06T11:00:00.000Z',
    updatedAt: '2026-06-06T11:05:00.000Z',
    nextAttemptAt: '2026-06-06T11:10:00.000Z',
    lastAttemptAt: '2026-06-06T11:05:00.000Z',
    attemptCount: 3,
    maxAttempts: 3,
    deadLetteredAt: '2026-06-06T11:05:00.000Z',
    lastErrorMessage: 'telegram bot api host is not allowed for remote delivery',
    renderedPreviewRedacted: 'System alert: runtime apply health failed for forward-hkg-443.',
    payloadHash: `sha256:${'1'.repeat(64)}`,
    target: {
      alertId: 'alert-runtime-apply-health-failed',
      customerId: 'customer-acme'
    }
  };
}

describe('TelegramNotificationSettingsPage', () => {
  it('renders Telegram notification settings and submits settings/test actions', async () => {
    const user = userEvent.setup();
    const settings = createDefaultTelegramBotSettings('2026-06-06T10:00:00.000Z');
    const onUpdateSettings = vi.fn(async () => ({
      ...settings,
      enabled: true,
      botTokenSet: true
    }));
    const onTestNotification = vi.fn();
    const confirm = vi.fn(() => false);
    const binding = createBinding();
    const policy = createDefaultTelegramNotificationPolicy('2026-06-06T10:00:00.000Z');
    const onUpdatePolicy = vi.fn(async () => policy);
    vi.stubGlobal('confirm', confirm);

    render(
      <TelegramNotificationSettingsPage
        bindings={[binding]}
        deliveries={[createDelivery()]}
        language="zh"
        onTestNotification={onTestNotification}
        onUpdatePolicy={onUpdatePolicy}
        onUpdateSettings={onUpdateSettings}
        policies={[policy]}
        settings={settings}
      />
    );

    expect(screen.getByRole('heading', { name: 'Telegram 通知设置' })).toBeInTheDocument();
    expect(screen.getByText('Token 未配置')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Bot Token'), '123456:secret-token');
    await user.clear(screen.getByLabelText('管理员 Chat ID'));
    await user.type(screen.getByLabelText('管理员 Chat ID'), '999000111');
    await user.click(screen.getAllByRole('button', { name: '保存' })[0]);

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('确认保存 Telegram Bot 配置'));
    expect(onUpdateSettings).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(screen.getAllByRole('button', { name: '保存' })[0]);

    expect(onUpdateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        botToken: '123456:secret-token',
        adminChatIds: ['999000111']
      })
    );

    confirm.mockReturnValue(false);
    await user.click(screen.getByRole('button', { name: '发送测试' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('确认发送 Telegram 测试通知'));
    expect(onTestNotification).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: '发送测试' }));

    expect(onTestNotification).toHaveBeenCalledWith({
      target: {
        kind: 'binding',
        bindingId: binding.id
      },
      language: 'zh-CN'
    });

    confirm.mockReturnValue(false);
    await user.click(screen.getAllByRole('button', { name: '保存' })[1]);

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('确认保存 Telegram 默认通知策略'));
    expect(onUpdatePolicy).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(screen.getAllByRole('button', { name: '保存' })[1]);

    expect(onUpdatePolicy).toHaveBeenCalledWith(
      policy.id,
      expect.objectContaining({
        language: 'zh-CN',
        maxMessagesPerHour: policy.maxMessagesPerHour
      })
    );
  });

  it('filters failed delivery history and opens copyable delivery evidence', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });
    const settings = createDefaultTelegramBotSettings('2026-06-06T10:00:00.000Z');
    const failedDelivery = createFailedDelivery();

    render(
      <TelegramNotificationSettingsPage
        bindings={[createBinding()]}
        deliveries={[createDelivery(), failedDelivery]}
        language="en"
        policies={[createDefaultTelegramNotificationPolicy('2026-06-06T10:00:00.000Z')]}
        settings={settings}
      />
    );

    await user.type(screen.getByRole('searchbox', { name: 'Search Deliveries' }), 'runtime apply');
    await user.selectOptions(screen.getByLabelText('Delivery Status'), 'dead_letter');

    expect(screen.getByText('Matching 1 / 2')).toBeInTheDocument();
    const failedRow = screen.getByRole('row', { name: /telegram-delivery-dead-letter-0002|system.alert/ });
    expect(within(failedRow).getByText('system.alert')).toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /telegram-delivery-0001/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: `View Delivery Evidence ${failedDelivery.id}` }));
    const drawer = screen.getByRole('dialog', { name: 'Delivery Evidence' });

    expect(within(drawer).getByText('telegram bot api host is not allowed for remote delivery')).toBeInTheDocument();
    expect(within(drawer).getAllByText(/alert-runtime-apply-health-failed/).length).toBeGreaterThan(0);
    expect(within(drawer).getAllByText(new RegExp(`sha256:${'1'.repeat(64)}`)).length).toBeGreaterThan(0);

    await user.click(within(drawer).getByRole('button', { name: 'Copy Delivery Evidence' }));

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"id": "telegram-delivery-dead-letter-0002"'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"status": "dead_letter"'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('[redacted-chat-id]'));
  });

  it('confirms before revoking a Telegram customer binding', async () => {
    const user = userEvent.setup();
    const settings = createDefaultTelegramBotSettings('2026-06-06T10:00:00.000Z');
    const binding = createBinding();
    const onRevokeBinding = vi.fn();
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);

    render(
      <TelegramNotificationSettingsPage
        bindings={[binding]}
        deliveries={[]}
        language="en"
        onRevokeBinding={onRevokeBinding}
        policies={[createDefaultTelegramNotificationPolicy('2026-06-06T10:00:00.000Z')]}
        settings={settings}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Revoke Acme Team' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Revoke Telegram binding for Acme Team'));
    expect(onRevokeBinding).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Revoke Acme Team' }));

    expect(onRevokeBinding).toHaveBeenCalledWith(binding.id, 'operator requested revoke');
  });

  it('bulk retries only selected filtered Telegram delivery failures', async () => {
    const user = userEvent.setup();
    const settings = createDefaultTelegramBotSettings('2026-06-06T10:00:00.000Z');
    const failedDelivery = createFailedDelivery();
    const pendingDelivery: TelegramNotificationDelivery = {
      ...failedDelivery,
      id: 'telegram-delivery-pending-0003',
      dedupeKey: 'system-alert:alert-runtime-pending',
      status: 'pending',
      attemptCount: 1,
      deadLetteredAt: undefined,
      lastErrorMessage: 'waiting for next retry window',
      renderedPreviewRedacted: 'System alert: pending retry for forward-lax-443.',
      payloadHash: `sha256:${'2'.repeat(64)}`,
      target: {
        alertId: 'alert-runtime-pending',
        customerId: 'customer-backup'
      }
    };
    const onRetryDelivery = vi.fn();
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);

    render(
      <TelegramNotificationSettingsPage
        bindings={[createBinding()]}
        deliveries={[createDelivery(), failedDelivery, pendingDelivery]}
        language="en"
        onRetryDelivery={onRetryDelivery}
        policies={[createDefaultTelegramNotificationPolicy('2026-06-06T10:00:00.000Z')]}
        settings={settings}
      />
    );

    await user.type(screen.getByRole('searchbox', { name: 'Search Deliveries' }), 'runtime apply');
    await user.selectOptions(screen.getByLabelText('Delivery Status'), 'dead_letter');
    await user.click(screen.getByRole('checkbox', { name: 'Select Visible Deliveries' }));
    await user.click(screen.getByRole('button', { name: 'Bulk Retry Deliveries' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Retry 1 selected Telegram delivery'));
    expect(onRetryDelivery).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Bulk Retry Deliveries' }));

    expect(onRetryDelivery).toHaveBeenCalledTimes(1);
    expect(onRetryDelivery).toHaveBeenCalledWith(failedDelivery.id);
    expect(onRetryDelivery).not.toHaveBeenCalledWith('telegram-delivery-0001');
    expect(onRetryDelivery).not.toHaveBeenCalledWith(pendingDelivery.id);
  });

  it('shows a delivery retry preflight before bulk retrying selected Telegram failures', async () => {
    const user = userEvent.setup();
    const settings = createDefaultTelegramBotSettings('2026-06-06T10:00:00.000Z');
    const deadLetterDelivery = createFailedDelivery();
    const failedDelivery: TelegramNotificationDelivery = {
      ...deadLetterDelivery,
      id: 'telegram-delivery-failed-0004',
      dedupeKey: 'traffic-threshold:customer-acme',
      notificationType: 'traffic.threshold',
      recipientKind: 'customer-binding',
      chatBindingId: 'telegram-chat-0001',
      customerBindingId: 'telegram-binding-0001',
      adminChatId: undefined,
      status: 'failed',
      attemptCount: 2,
      deadLetteredAt: undefined,
      lastErrorMessage: 'telegram rate limit 429 while sending threshold alert',
      renderedPreviewRedacted: 'Traffic threshold warning for Acme Team.',
      payloadHash: `sha256:${'3'.repeat(64)}`,
      target: {
        customerId: 'customer-acme',
        scopeType: 'customer'
      }
    };

    render(
      <TelegramNotificationSettingsPage
        bindings={[createBinding()]}
        deliveries={[createDelivery(), deadLetterDelivery, failedDelivery]}
        language="en"
        policies={[createDefaultTelegramNotificationPolicy('2026-06-06T10:00:00.000Z')]}
        settings={settings}
      />
    );

    await user.click(screen.getByRole('checkbox', { name: `Select Delivery ${deadLetterDelivery.id}` }));
    await user.click(screen.getByRole('checkbox', { name: `Select Delivery ${failedDelivery.id}` }));

    const preflight = screen.getByRole('region', { name: 'Delivery Retry Preflight' });
    const expectRetryMetric = (label: string, value: string) => {
      const metric = within(preflight).getByText(label).closest('div');

      expect(metric).not.toBeNull();
      expect(within(metric as HTMLElement).getByText(value)).toBeInTheDocument();
    };

    expectRetryMetric('Selected Deliveries', '2');
    expectRetryMetric('Failed/Dead-letter', '2');
    expectRetryMetric('Telegram Targets', '2');
    expectRetryMetric('Notification Types', '2');
    expectRetryMetric('Error Sources', '2');

    const deliveryPreview = within(preflight).getByText('Delivery Preview').closest('div');
    const errorPreview = within(preflight).getByText('Error Preview').closest('div');

    expect(deliveryPreview).not.toBeNull();
    expect(errorPreview).not.toBeNull();
    expect(within(deliveryPreview as HTMLElement).getByText(/telegram-delivery-dead-letter-0002/)).toBeInTheDocument();
    expect(within(deliveryPreview as HTMLElement).getByText(/telegram-delivery-failed-0004/)).toBeInTheDocument();
    expect(
      within(errorPreview as HTMLElement).getByText('telegram bot api host is not allowed for remote delivery')
    ).toBeInTheDocument();
    expect(
      within(errorPreview as HTMLElement).getByText('telegram rate limit 429 while sending threshold alert')
    ).toBeInTheDocument();
  });

  it('confirms before retrying a single Telegram delivery row', async () => {
    const user = userEvent.setup();
    const settings = createDefaultTelegramBotSettings('2026-06-06T10:00:00.000Z');
    const failedDelivery = createFailedDelivery();
    const onRetryDelivery = vi.fn();
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);

    render(
      <TelegramNotificationSettingsPage
        bindings={[createBinding()]}
        deliveries={[failedDelivery]}
        language="en"
        onRetryDelivery={onRetryDelivery}
        policies={[createDefaultTelegramNotificationPolicy('2026-06-06T10:00:00.000Z')]}
        settings={settings}
      />
    );

    await user.click(screen.getByRole('button', { name: `Retry ${failedDelivery.id}` }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining(`Retry Telegram delivery ${failedDelivery.id}`));
    expect(onRetryDelivery).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: `Retry ${failedDelivery.id}` }));

    expect(onRetryDelivery).toHaveBeenCalledWith(failedDelivery.id);
  });
});
