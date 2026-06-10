import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, vi } from 'vitest';
import { createDefaultTelegramBotSettings } from '../../services/api/telegram-bot';
import { TelegramNotificationSettingsPage } from './telegram-notification-settings-page';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TelegramNotificationSettingsPage', () => {
  it('renders only the minimal Bot Token and Chat ID controls', () => {
    const settings = {
      ...createDefaultTelegramBotSettings('2026-06-06T10:00:00.000Z'),
      adminChatIds: ['999000111']
    };

    const { container } = render(
      <TelegramNotificationSettingsPage
        bindings={[]}
        deliveries={[]}
        language="zh"
        policies={[]}
        settings={settings}
      />
    );

    expect(screen.getByRole('heading', { name: 'Telegram 通知' })).toBeInTheDocument();
    expect(screen.getByLabelText('Bot Token')).toBeInTheDocument();
    expect(screen.getByLabelText('Chat ID')).toHaveValue('999000111');
    expect(container.querySelectorAll('input, textarea, select')).toHaveLength(2);

    expect(screen.queryByText('客户绑定')).not.toBeInTheDocument();
    expect(screen.queryByText('默认通知策略')).not.toBeInTheDocument();
    expect(screen.queryByText('投递记录')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '发送测试' })).not.toBeInTheDocument();
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
