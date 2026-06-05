import { createSystemAlertWebhookNotifier, type SystemAlertNotificationBatch } from './system-alert-notifications';

const batch: SystemAlertNotificationBatch = {
  schemaVersion: 'ou-ui-next.system-alerts.v1',
  generatedAt: '2026-06-05T12:00:00.000Z',
  events: [
    {
      type: 'activated',
      notificationKey: 'activated:agent-alert:2026-06-05T12:00:00.000Z',
      alert: {
        id: 'alert-agent-runtime-service-agent-hkg-01-ou-ui-xray.service',
        kind: 'agent.runtime_service_unhealthy',
        severity: 'critical',
        status: 'active',
        title: 'Agent runtime service unhealthy',
        message: 'ou-ui-xray.service is missing on agent-hkg-01',
        resourceType: 'agent',
        resourceId: 'agent-hkg-01',
        resourceLabel: 'Hong Kong Edge',
        observedAt: '2026-06-05T11:59:30.000Z',
        dedupeKey: 'agent-runtime-service:agent-hkg-01:ou-ui-xray.service',
        metadata: {
          serviceName: 'ou-ui-xray.service'
        }
      },
      firstObservedAt: '2026-06-05T11:59:30.000Z',
      lastChangedAt: '2026-06-05T12:00:00.000Z'
    }
  ]
};

describe('system alert webhook notifier', () => {
  it('posts sanitized alert notification batches with optional bearer auth', async () => {
    const deliveries: unknown[] = [];
    const fetcher = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 204
      })
    );
    const notifier = createSystemAlertWebhookNotifier({
      url: 'https://alerts.example.com/ou-ui?token=request-url-secret',
      bearerToken: 'alert-webhook-token',
      fetcher,
      onDelivery: (event) => deliveries.push(event)
    });

    await notifier.notify(batch);

    expect(fetcher).toHaveBeenCalledWith(
      'https://alerts.example.com/ou-ui?token=request-url-secret',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer alert-webhook-token'
        },
        body: JSON.stringify(batch),
        signal: expect.any(AbortSignal)
      })
    );
    expect(deliveries).toEqual([
      {
        event: 'system_alert.webhook.delivered',
        url: 'https://alerts.example.com',
        statusCode: 204,
        eventCount: 1
      }
    ]);
    expect(JSON.stringify(deliveries)).not.toContain('request-url-secret');
  });

  it('reports failed webhook deliveries without exposing request secrets', async () => {
    const deliveries: unknown[] = [];
    const notifier = createSystemAlertWebhookNotifier({
      url: 'https://alerts.example.com/ou-ui?token=request-url-secret',
      bearerToken: 'alert-webhook-token',
      fetcher: vi.fn().mockResolvedValue(
        new Response('failed', {
          status: 503
        })
      ),
      onDelivery: (event) => deliveries.push(event)
    });

    await expect(notifier.notify(batch)).rejects.toThrow('HTTP 503');
    expect(JSON.stringify(deliveries)).not.toContain('alert-webhook-token');
    expect(JSON.stringify(deliveries)).not.toContain('request-url-secret');
    expect(deliveries).toEqual([
      expect.objectContaining({
        event: 'system_alert.webhook.failed',
        url: 'https://alerts.example.com',
        eventCount: 1,
        errorMessage: 'System alert webhook responded with HTTP 503'
      })
    ]);
  });
});
