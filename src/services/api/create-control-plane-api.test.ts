import { createControlPlaneApi, resolveControlPlaneApiMode } from './create-control-plane-api';
import { HttpControlPlaneClientError } from './http-control-plane-client';

describe('createControlPlaneApi', () => {
  it('defaults to an empty mock adapter when no HTTP mode is configured', async () => {
    const api = createControlPlaneApi({
      env: {
        MODE: 'test'
      }
    });

    await expect(api.listAgents()).resolves.toEqual([]);
    expect(resolveControlPlaneApiMode({})).toBe('mock');
  });

  it('requires an explicit mock seed flag before demo inventory is loaded', async () => {
    const api = createControlPlaneApi({
      env: {
        MODE: 'test',
        VITE_CONTROL_PLANE_MOCK_SEEDED: 'true'
      }
    });

    await expect(api.listAgents()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'agent-hkg-01' })])
    );
    await expect(api.listTasks()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'task-seed-forward-port-conflict',
          status: 'failed',
          failureReason: 'port_conflict: 0.0.0.0:443 is already in use'
        })
      ])
    );
  });

  it('keeps the mock adapter empty in non-test development environments without a control-plane base URL', async () => {
    const api = createControlPlaneApi({
      env: {
        MODE: 'development'
      }
    });

    await expect(api.listAgents()).resolves.toEqual([]);
    await expect(api.listNodes()).resolves.toEqual([]);
  });

  it('creates an HTTP adapter when VITE_CONTROL_PLANE_MODE=http', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init });

      return new Response(
        JSON.stringify({
          data: {
            version: 'v1',
            restBasePath: '/api/v1',
            eventStreamPath: '/events/v1',
            agentStreamPath: '/agent/v1',
            supportsIdempotency: true,
            transports: ['rest'],
            taskStatuses: ['queued'],
            taskTransitions: {
              queued: []
            }
          },
          requestId: 'req-factory-boundary'
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
    };
    const api = createControlPlaneApi({
      env: {
        VITE_CONTROL_PLANE_MODE: 'http',
        VITE_CONTROL_PLANE_BASE_URL: 'http://127.0.0.1:4010/'
      },
      fetcher
    });

    await expect(api.getApiBoundary()).resolves.toMatchObject({
      restBasePath: '/api/v1'
    });
    expect(calls[0].url).toBe('http://127.0.0.1:4010/api/v1/boundary');
  });

  it('uses the HTTP adapter when a production base URL is present even if mode is omitted', async () => {
    expect(
      resolveControlPlaneApiMode({
        VITE_CONTROL_PLANE_BASE_URL: '/secure-panel'
      })
    ).toBe('http');
  });

  it('does not fall back to mock inventory in production builds', () => {
    expect(resolveControlPlaneApiMode({ PROD: true })).toBe('http');
    expect(resolveControlPlaneApiMode({ PROD: true, VITE_CONTROL_PLANE_ALLOW_MOCK: 'true' })).toBe('http');
    expect(() =>
      createControlPlaneApi({
        env: {
          PROD: true
        }
      })
    ).toThrow('VITE_CONTROL_PLANE_BASE_URL');
  });

  it('ignores mock seed flags when production builds have an HTTP base URL', async () => {
    const calls: string[] = [];
    const fetcher: typeof fetch = async (url) => {
      calls.push(String(url));

      return new Response(
        JSON.stringify({
          data: [],
          requestId: 'req-prod-http-agents'
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
    };
    const api = createControlPlaneApi({
      env: {
        PROD: true,
        VITE_CONTROL_PLANE_BASE_URL: 'https://panel.example.com/x7K2mP9vL4qR1wDz',
        VITE_CONTROL_PLANE_MOCK_SEEDED: 'true'
      },
      fetcher
    });

    await expect(api.listAgents()).resolves.toEqual([]);
    expect(calls).toEqual(['https://panel.example.com/x7K2mP9vL4qR1wDz/api/v1/agents']);
  });

  it('passes HTTP bearer tokens from Vite environment to the client', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init });

      return new Response(
        JSON.stringify({
          data: [],
          requestId: 'req-factory-auth'
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
    };
    const api = createControlPlaneApi({
      env: {
        VITE_CONTROL_PLANE_MODE: 'http',
        VITE_CONTROL_PLANE_BASE_URL: 'http://127.0.0.1:4010',
        VITE_CONTROL_PLANE_AGENT_ID: 'agent-hkg-01',
        VITE_CONTROL_PLANE_OPERATOR_TOKEN: 'operator-token-001',
        VITE_CONTROL_PLANE_AGENT_TOKEN: 'agent-token-hkg-001'
      },
      fetcher
    });

    await api.listAgents();
    await api.listCommandOutbox();

    expect(calls[0].init?.headers).toMatchObject({
      Authorization: 'Bearer operator-token-001'
    });
    expect(calls[1].init?.headers).toMatchObject({
      Authorization: 'Bearer agent-token-hkg-001'
    });
  });

  it('fails early when HTTP mode is missing a base URL', () => {
    expect(() =>
      createControlPlaneApi({
        env: {
          VITE_CONTROL_PLANE_MODE: 'http'
        }
      })
    ).toThrow('VITE_CONTROL_PLANE_BASE_URL');
  });

  it('keeps HTTP client errors available to UI callers', () => {
    const error = new HttpControlPlaneClientError(403, {
      error: {
        code: 'permission.denied',
        message: 'Denied'
      },
      requestId: 'req-denied'
    });

    expect(error).toMatchObject({
      code: 'permission.denied',
      status: 403,
      requestId: 'req-denied'
    });
  });
});
