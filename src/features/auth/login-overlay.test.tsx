import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { LoginOverlay } from './login-overlay';

describe('LoginOverlay', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('reuses an existing server-side operator session in HTTP mode', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            authenticated: true,
            csrfToken: 'csrf-existing-session-001'
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
    expect(onAuthenticated).toHaveBeenCalledWith('csrf-existing-session-001');
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
              csrfToken: 'csrf-login-session-001'
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

    await screen.findByPlaceholderText('用户名');
    await user.type(screen.getByPlaceholderText('用户名'), 'operator_001');
    await user.type(screen.getByPlaceholderText('密码'), 'operator-password-001');
    await user.click(screen.getByRole('button', { name: '安全登录' }));

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledTimes(1));
    expect(onAuthenticated).toHaveBeenCalledWith('csrf-login-session-001');
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
