import { fetchTelegramBotUpdates, sendTelegramBotMessage } from './telegram-bot';

describe('Telegram bot transport helpers', () => {
  it('redacts bot tokens from failed Telegram sendMessage responses', async () => {
    const result = await sendTelegramBotMessage({
      botToken: '123456:secret-token',
      customApiBaseUrl: 'https://api.telegram.org',
      requestTimeoutMs: 5000,
      fetcher: (async () =>
        new Response(
          JSON.stringify({
            ok: false,
            description:
              'Too Many Requests: retry after calling https://api.telegram.org/bot123456:secret-token/sendMessage',
            parameters: {
              retry_after: 7
            }
          }),
          {
            status: 429,
            statusText: 'Too Many Requests',
            headers: {
              'Content-Type': 'application/json'
            }
          }
        )) as typeof fetch,
      request: {
        chatId: '999000111',
        text: 'hello'
      }
    });

    expect(result).toMatchObject({
      ok: false,
      statusCode: 429,
      retryAfterSeconds: 7
    });

    if (!result.ok) {
      expect(result.errorMessage).toContain('[redacted-token]');
      expect(result.errorMessage).not.toContain('123456:secret-token');
    }
  });

  it('fetches Telegram updates with offset and allowed updates', async () => {
    let requestedUrl = '';
    let requestedBody: unknown;
    const result = await fetchTelegramBotUpdates({
      botToken: '123456:secret-token',
      customApiBaseUrl: 'https://telegram.example',
      requestTimeoutMs: 5000,
      fetcher: (async (input, init) => {
        requestedUrl = String(input);
        requestedBody = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;

        return new Response(
          JSON.stringify({
            ok: true,
            result: [
              {
                update_id: 42,
                message: {
                  message_id: 1,
                  text: '/start OU-123456',
                  chat: {
                    id: 999000111,
                    type: 'private'
                  }
                }
              }
            ]
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json'
            }
          }
        );
      }) as typeof fetch,
      offset: 41,
      timeoutSeconds: 3,
      allowedUpdates: ['message']
    });

    expect(requestedUrl).toBe('https://telegram.example/bot123456:secret-token/getUpdates');
    expect(requestedBody).toEqual({
      offset: 41,
      timeout: 3,
      allowed_updates: ['message']
    });
    expect(result).toEqual({
      ok: true,
      updates: [
        expect.objectContaining({
          update_id: 42
        })
      ]
    });
  });
});
