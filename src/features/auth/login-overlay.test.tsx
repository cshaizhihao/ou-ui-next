import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { LoginOverlay } from './login-overlay';

describe('LoginOverlay', () => {
  afterEach(() => {
    document.title = '';
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('syncs the browser document title with the localized login title and resets after authentication', () => {
    const { rerender } = render(
      <LoginOverlay
        authenticated={false}
        language="zh"
        onAuthenticated={vi.fn()}
        onLanguageChange={vi.fn()}
      />
    );

    expect(document.title).toBe('OU-UI Next 控制面板');

    rerender(
      <LoginOverlay
        authenticated={false}
        language="en"
        onAuthenticated={vi.fn()}
        onLanguageChange={vi.fn()}
      />
    );

    expect(document.title).toBe('OU-UI Next Control Panel');

    rerender(
      <LoginOverlay
        authenticated
        language="en"
        onAuthenticated={vi.fn()}
        onLanguageChange={vi.fn()}
      />
    );

    expect(document.title).toBe('OU-UI Next');
  });

  it('binds local mock login to the seeded current operator session', async () => {
    const onAuthenticated = vi.fn();
    const user = userEvent.setup();

    render(
      <LoginOverlay
        authenticated={false}
        language="zh"
        onAuthenticated={onAuthenticated}
        onLanguageChange={vi.fn()}
      />
    );

    await user.type(screen.getByRole('textbox', { name: '用户名' }), 'admin');
    await user.type(screen.getByLabelText('密码'), 'admin');
    await user.click(screen.getByRole('button', { name: '安全登录' }));

    expect(onAuthenticated).toHaveBeenCalledWith({
      operatorSessionId: 'operator-session-local-current'
    });
  });

  it('exposes production login fields with visible labels, autofill hints, and alert recovery semantics', async () => {
    const user = userEvent.setup();

    render(
      <LoginOverlay
        authenticated={false}
        language="zh"
        onAuthenticated={vi.fn()}
        onLanguageChange={vi.fn()}
      />
    );

    const usernameField = screen.getByRole('textbox', { name: '用户名' });
    const passwordField = screen.getByLabelText('密码');

    expect(usernameField).toHaveAttribute('autocomplete', 'username');
    expect(usernameField).toHaveAttribute('aria-describedby', 'operator-login-recovery');
    expect(passwordField).toHaveAttribute('type', 'password');
    expect(passwordField).toHaveAttribute('autocomplete', 'current-password');
    expect(passwordField).toHaveAttribute('aria-describedby', 'operator-login-recovery');
    expect(screen.getByText('使用管理员凭据进入生产控制面。')).toHaveAttribute('id', 'operator-login-recovery');

    await user.type(usernameField, 'admin');
    await user.type(passwordField, 'wrong-password');
    await user.click(screen.getByRole('button', { name: '安全登录' }));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('访问拒绝：认证失败');
    expect(usernameField).toHaveAttribute('aria-invalid', 'true');
    expect(passwordField).toHaveAttribute('aria-invalid', 'true');
  });

  it('reuses an existing server-side operator session in HTTP mode', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            authenticated: true,
            csrfToken: 'csrf-existing-session-001',
            sessionId: 'operator-session-existing-001'
          },
          requestId: 'req-login-overlay-existing-session'
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      )
    );
    const onAuthenticated = vi.fn();

    vi.stubEnv('VITE_CONTROL_PLANE_MODE', 'http');
    vi.stubEnv('VITE_CONTROL_PLANE_BASE_URL', '/secure-panel');
    vi.stubGlobal('fetch', fetcher);

    render(
      <LoginOverlay
        authenticated={false}
        language="zh"
        onAuthenticated={onAuthenticated}
        onLanguageChange={vi.fn()}
      />
    );

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledTimes(1));
    expect(onAuthenticated).toHaveBeenCalledWith({
      csrfToken: 'csrf-existing-session-001',
      operatorSessionId: 'operator-session-existing-001'
    });
    expect(fetcher).toHaveBeenCalledWith(
      '/secure-panel/api/v1/auth/session',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include'
      })
    );
  });

  it('creates a server-side operator session in HTTP mode', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: 'unauthorized'
            },
            requestId: 'req-login-overlay-missing-session'
          }),
          {
            status: 401,
            headers: {
              'Content-Type': 'application/json'
            }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
        JSON.stringify({
          data: {
            authenticated: true,
            csrfToken: 'csrf-login-session-001',
            sessionId: 'operator-session-login-001'
          },
          requestId: 'req-login-overlay-session'
        }),
          {
            status: 201,
            headers: {
              'Content-Type': 'application/json',
              'Set-Cookie': 'ou_ui_next_operator_session=session-001; HttpOnly; SameSite=Lax'
            }
          }
        )
      );
    const onAuthenticated = vi.fn();
    const user = userEvent.setup();

    vi.stubEnv('VITE_CONTROL_PLANE_MODE', 'http');
    vi.stubEnv('VITE_CONTROL_PLANE_BASE_URL', '/secure-panel');
    vi.stubGlobal('fetch', fetcher);

    render(
      <LoginOverlay
        authenticated={false}
        language="zh"
        onAuthenticated={onAuthenticated}
        onLanguageChange={vi.fn()}
      />
    );

    await screen.findByRole('textbox', { name: '用户名' });
    await user.type(screen.getByRole('textbox', { name: '用户名' }), 'operator_001');
    await user.type(screen.getByLabelText('密码'), 'operator-password-001');
    await user.click(screen.getByRole('button', { name: '安全登录' }));

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledTimes(1));
    expect(onAuthenticated).toHaveBeenCalledWith({
      csrfToken: 'csrf-login-session-001',
      operatorSessionId: 'operator-session-login-001'
    });
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      '/secure-panel/api/v1/auth/session',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include'
      })
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      '/secure-panel/api/v1/auth/session',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          username: 'operator_001',
          password: 'operator-password-001'
        })
      })
    );
  });
});
