import type { SystemAlert } from '../../domain/system-alert';

export type SystemAlertNotificationType = 'activated' | 'updated' | 'resolved';
export type SystemAlertNotificationStatus = SystemAlert['status'] | 'resolved';

export type SystemAlertNotification = {
  type: SystemAlertNotificationType;
  notificationKey: string;
  alert: Omit<SystemAlert, 'status'> & {
    status: SystemAlertNotificationStatus;
  };
  firstObservedAt: string;
  lastChangedAt: string;
  resolvedAt?: string;
};

export type SystemAlertNotificationBatch = {
  schemaVersion: 'ou-ui-next.system-alerts.v1';
  generatedAt: string;
  events: SystemAlertNotification[];
};

export type SystemAlertNotifier = {
  notify(batch: SystemAlertNotificationBatch): Promise<void>;
};

export type SystemAlertWebhookDeliveryEvent = {
  event: 'system_alert.webhook.delivered' | 'system_alert.webhook.failed';
  url: string;
  statusCode?: number;
  eventCount: number;
  errorMessage?: string;
};

export type SystemAlertWebhookNotifierOptions = {
  url: string;
  timeoutMs?: number;
  bearerToken?: string;
  fetcher?: typeof fetch;
  onDelivery?: (event: SystemAlertWebhookDeliveryEvent) => void;
};

function sanitizeWebhookUrlForLog(url: string) {
  try {
    return new URL(url).origin;
  } catch {
    return 'invalid-url';
  }
}

export function createSystemAlertWebhookNotifier({
  url,
  timeoutMs = 5000,
  bearerToken,
  fetcher = fetch,
  onDelivery
}: SystemAlertWebhookNotifierOptions): SystemAlertNotifier {
  const logUrl = sanitizeWebhookUrlForLog(url);

  return {
    async notify(batch) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(1, Math.round(timeoutMs)));

      try {
        const response = await fetcher(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {})
          },
          body: JSON.stringify(batch),
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error(`System alert webhook responded with HTTP ${response.status}`);
        }

        onDelivery?.({
          event: 'system_alert.webhook.delivered',
          url: logUrl,
          statusCode: response.status,
          eventCount: batch.events.length
        });
      } catch (error) {
        onDelivery?.({
          event: 'system_alert.webhook.failed',
          url: logUrl,
          eventCount: batch.events.length,
          errorMessage: error instanceof Error ? error.message : String(error)
        });
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }
  };
}
