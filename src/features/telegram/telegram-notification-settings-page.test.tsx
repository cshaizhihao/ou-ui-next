import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  TelegramBindingReadModel,
  TelegramNotificationDelivery,
  TelegramNotificationPolicy
} from '../../domain';
import { afterEach, vi } from 'vitest';
import {
  createDefaultTelegramBotSettings,
  createDefaultTelegramNotificationPolicy
} from '../../services/api/telegram-bot';
import { TelegramNotificationSettingsPage } from './telegram-notification-settings-page';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TelegramNotificationSettingsPage', () => {
  it('splits Telegram operations into a control rail and delivery workspace cockpit', () => {
    const settings = {
      ...createDefaultTelegramBotSettings('2026-06-06T10:00:00.000Z'),
      enabled: true,
      botTokenSet: true,
      adminChatIds: ['999000111']
    };

    render(
      <TelegramNotificationSettingsPage
        bindings={[createBinding()]}
        deliveries={[createDelivery({ status: 'delivered' })]}
        language="zh"
        policies={[createPolicy()]}
        settings={settings}
      />
    );

    const cockpit = screen.getByRole('region', { name: 'Telegram 运营 cockpit' });
    const rail = within(cockpit).getByRole('complementary', { name: 'Telegram 控制轨' });
    const workspace = within(cockpit).getByRole('region', { name: '通知投递工作区' });

    expect(within(rail).getByText('Token 已配置')).toBeInTheDocument();
    expect(within(rail).getByLabelText('Bot Token')).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: '保存' })).toBeInTheDocument();

    expect(within(workspace).getByText('通知链路')).toBeInTheDocument();
    expect(within(workspace).getByRole('region', { name: '投递证据' })).toBeInTheDocument();
    expect(within(workspace).getByRole('region', { name: '策略与绑定' })).toBeInTheDocument();
  });

  it('frames Telegram as a notification control surface while preserving credential controls', () => {
    const settings = {
      ...createDefaultTelegramBotSettings('2026-06-06T10:00:00.000Z'),
      enabled: true,
      botTokenSet: true,
      adminChatIds: ['999000111']
    };
    const policy = createPolicy();

    const { container } = render(
      <TelegramNotificationSettingsPage
        bindings={[createBinding()]}
        deliveries={[
          createDelivery({ id: 'telegram-delivery-failed', status: 'failed' }),
          createDelivery({ id: 'telegram-delivery-delivered', status: 'delivered' })
        ]}
        language="zh"
        policies={[policy]}
        settings={settings}
      />
    );

    expect(screen.getByRole('heading', { name: 'Telegram 通知' })).toBeInTheDocument();
    const overview = screen.getByRole('region', { name: '运营总览' });
    expect(within(overview).getByText('通知链路')).toBeInTheDocument();
    const notificationPath = within(overview).getByRole('list');
    expect(within(notificationPath).getByText('Bot 配置')).toBeInTheDocument();
    expect(within(notificationPath).getByText('管理员 Chat')).toBeInTheDocument();
    expect(within(notificationPath).getByText('客户绑定')).toBeInTheDocument();
    expect(within(notificationPath).getByText('投递证据')).toBeInTheDocument();
    expect(within(overview).getByText('策略开启 1 / 1')).toBeInTheDocument();

    const deliveryEvidence = screen.getByRole('region', { name: '投递证据' });
    expect(within(deliveryEvidence).getByText('失败投递 1 / 2')).toBeInTheDocument();
    expect(within(deliveryEvidence).getAllByText('quota.exceeded').length).toBeGreaterThan(0);
    expect(within(deliveryEvidence).getByText('failed')).toBeInTheDocument();

    expect(screen.getByLabelText('Bot Token')).toBeInTheDocument();
    expect(screen.getByLabelText('Chat ID')).toHaveValue('999000111');
    expect(container.querySelectorAll('input, textarea, select')).toHaveLength(2);
  });

  it('saves Bot Token and Chat ID immediately with inline success feedback', async () => {
    const user = userEvent.setup();
    const settings = createDefaultTelegramBotSettings('2026-06-06T10:00:00.000Z');
    const onUpdateSettings = vi.fn(async () => ({
      ...settings,
      enabled: true,
      botTokenSet: true,
      adminChatIds: ['999000111', '222333444']
    }));
    const confirm = vi.fn();
    vi.stubGlobal('confirm', confirm);

    render(
      <TelegramNotificationSettingsPage
        bindings={[]}
        deliveries={[]}
        language="zh"
        onUpdateSettings={onUpdateSettings}
        policies={[]}
        settings={settings}
      />
    );

    await user.type(screen.getByLabelText('Bot Token'), '123456:secret-token');
    await user.type(screen.getByLabelText('Chat ID'), '999000111, 222333444');
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(confirm).not.toHaveBeenCalled();
    expect(onUpdateSettings).toHaveBeenCalledWith({
      enabled: true,
      botToken: '123456:secret-token',
      adminChatIds: ['999000111', '222333444']
    });
    expect(await screen.findByRole('status')).toHaveTextContent('已保存');
  });

  it('disables saving while a settings mutation is in flight', () => {
    render(
      <TelegramNotificationSettingsPage
        bindings={[]}
        deliveries={[]}
        language="en"
        mutationBusy
        policies={[]}
        settings={createDefaultTelegramBotSettings('2026-06-06T10:00:00.000Z')}
      />
    );

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});

function createPolicy(overrides: Partial<TelegramNotificationPolicy> = {}): TelegramNotificationPolicy {
  return {
    ...createDefaultTelegramNotificationPolicy('2026-06-06T10:00:00.000Z'),
    ...overrides
  };
}

function createBinding(overrides: Partial<TelegramBindingReadModel> = {}): TelegramBindingReadModel {
  const createdAt = '2026-06-06T10:00:00.000Z';
  const binding: TelegramBindingReadModel = {
    id: 'telegram-binding-0001',
    chat: {
      id: 'telegram-chat-0001',
      telegramChatId: '999000111',
      telegramUserId: '888000222',
      chatType: 'private',
      username: 'ou_customer',
      displayName: 'OU Customer',
      status: 'active',
      isAdminRecipient: false,
      firstSeenAt: createdAt,
      lastSeenAt: createdAt,
      lastStartAt: createdAt,
      source: 'admin_direct',
      createdAt,
      updatedAt: createdAt
    },
    customerBinding: {
      id: 'telegram-binding-0001',
      chatBindingId: 'telegram-chat-0001',
      customerId: 'customer-001',
      customerNameSnapshot: 'North Harbor',
      scopeType: 'customer',
      permissions: {
        receiveNotifications: true,
        queryTraffic: true,
        queryExpiry: true,
        queryNodes: true,
        receiveSubscriptionLinks: true,
        manageNotificationPolicy: false
      },
      status: 'active',
      policyId: 'telegram-policy-default',
      createdAt,
      createdBy: 'operator',
      auditEvidenceId: 'audit-telegram-binding-0001'
    },
    ...overrides
  };

  return binding;
}

function createDelivery(overrides: Partial<TelegramNotificationDelivery> = {}): TelegramNotificationDelivery {
  const createdAt = '2026-06-06T10:05:00.000Z';

  return {
    id: 'telegram-delivery-0001',
    dedupeKey: 'quota:customer-001:2026-06-06',
    notificationType: 'quota.exceeded',
    recipientKind: 'customer-binding',
    chatBindingId: 'telegram-chat-0001',
    customerBindingId: 'telegram-binding-0001',
    policyId: 'telegram-policy-default',
    templateId: 'quota.exceeded.zh-CN',
    language: 'zh-CN',
    status: 'failed',
    createdAt,
    updatedAt: createdAt,
    nextAttemptAt: createdAt,
    attemptCount: 2,
    maxAttempts: 3,
    lastAttemptAt: createdAt,
    lastErrorMessage: 'telegram request timeout',
    renderedPreviewRedacted: '客户 North Harbor 的配额已超限。',
    payloadHash: 'sha256:delivery',
    target: {
      customerId: 'customer-001',
      scopeType: 'customer'
    },
    ...overrides
  };
}
