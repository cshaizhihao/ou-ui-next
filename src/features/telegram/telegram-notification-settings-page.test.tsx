import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TelegramBindingReadModel, TelegramNotificationDelivery } from '../../domain';
import {
  createDefaultTelegramBotSettings,
  createDefaultTelegramNotificationPolicy
} from '../../services/api/telegram-bot';
import { TelegramNotificationSettingsPage } from './telegram-notification-settings-page';

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
    const binding = createBinding();

    render(
      <TelegramNotificationSettingsPage
        bindings={[binding]}
        deliveries={[createDelivery()]}
        language="zh"
        onTestNotification={onTestNotification}
        onUpdateSettings={onUpdateSettings}
        policies={[createDefaultTelegramNotificationPolicy('2026-06-06T10:00:00.000Z')]}
        settings={settings}
      />
    );

    expect(screen.getByRole('heading', { name: 'Telegram 通知设置' })).toBeInTheDocument();
    expect(screen.getByText('Token 未配置')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Bot Token'), '123456:secret-token');
    await user.clear(screen.getByLabelText('管理员 Chat ID'));
    await user.type(screen.getByLabelText('管理员 Chat ID'), '999000111');
    await user.click(screen.getAllByRole('button', { name: '保存' })[0]);

    expect(onUpdateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        botToken: '123456:secret-token',
        adminChatIds: ['999000111']
      })
    );

    await user.click(screen.getByRole('button', { name: '发送测试' }));

    expect(onTestNotification).toHaveBeenCalledWith({
      target: {
        kind: 'binding',
        bindingId: binding.id
      },
      language: 'zh-CN'
    });
  });
});
