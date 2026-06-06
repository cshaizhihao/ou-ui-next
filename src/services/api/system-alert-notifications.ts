import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { SystemAlert } from '../../domain/system-alert';
import {
  defaultRemoteHostResolver,
  isBlockedRemoteHost,
  isRemoteHostAllowedByEgressPolicy,
  normalizeRemoteEgressPolicy,
  resolveAllowedRemoteAddresses,
  type RemoteEgressPolicy,
  type RemoteHostResolver,
  type RemoteResolvedAddress
} from './remote-egress-policy';

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

export type SystemAlertNotificationChannel = {
  id: string;
  label: string;
  notifier: SystemAlertNotifier;
};

export type SystemAlertNotificationDeliveryStatus = 'pending' | 'failed' | 'delivered' | 'dead_letter';

export type SystemAlertNotificationDeliveryRecord = {
  id: string;
  channelId?: string;
  channelLabel?: string;
  status: SystemAlertNotificationDeliveryStatus;
  batch: SystemAlertNotificationBatch;
  createdAt: string;
  updatedAt: string;
  nextAttemptAt: string;
  attemptCount: number;
  maxAttempts: number;
  lastAttemptAt?: string;
  deliveredAt?: string;
  deadLetteredAt?: string;
  lastErrorMessage?: string;
};

export type SystemAlertNotificationRetryOptions = {
  now: string;
  maxDeliveries?: number;
};

export type SystemAlertNotificationRetryResult = {
  attempted: number;
  delivered: number;
  failed: number;
  deadLettered: number;
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
  egressPolicy?: Partial<RemoteEgressPolicy>;
  hostResolver?: RemoteHostResolver;
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

type SystemAlertWebhookRemoteTarget = {
  url: URL;
  resolvedAddress: RemoteResolvedAddress;
  resolvedAddresses: RemoteResolvedAddress[];
};

async function resolveSystemAlertWebhookRemoteTarget(
  url: URL,
  hostResolver: RemoteHostResolver,
  egressPolicy: RemoteEgressPolicy
): Promise<SystemAlertWebhookRemoteTarget> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('system alert webhook url protocol must be http or https');
  }

  if (isBlockedRemoteHost(url.hostname)) {
    throw new Error('system alert webhook host is not allowed for remote delivery');
  }

  if (!isRemoteHostAllowedByEgressPolicy(url.hostname, egressPolicy)) {
    throw new Error('system alert webhook host is not in the egress allowlist');
  }

  const resolvedAddresses = await resolveAllowedRemoteAddresses(url.hostname, hostResolver, {
    unresolved: 'system alert webhook host could not be resolved for remote delivery',
    blockedResolvedHost: 'system alert webhook resolved host is not allowed for remote delivery'
  });

  return {
    url,
    resolvedAddress: resolvedAddresses[0],
    resolvedAddresses
  };
}

function createSystemAlertWebhookHeaders(
  target: URL,
  body: Buffer,
  bearerToken: string | undefined
) {
  return {
    'Content-Type': 'application/json',
    'Content-Length': String(body.length),
    Host: target.host,
    ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {})
  };
}

function postPinnedSystemAlertWebhook({
  target,
  body,
  bearerToken,
  timeoutMs,
  signal
}: {
  target: SystemAlertWebhookRemoteTarget;
  body: Buffer;
  bearerToken?: string;
  timeoutMs: number;
  signal: AbortSignal;
}): Promise<number> {
  const transport = target.url.protocol === 'https:' ? httpsRequest : httpRequest;
  const port =
    target.url.port || (target.url.protocol === 'https:' ? '443' : target.url.protocol === 'http:' ? '80' : undefined);

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      callback();
    };
    const request = transport(
      {
        protocol: target.url.protocol,
        hostname: target.resolvedAddress.address,
        port,
        path: `${target.url.pathname}${target.url.search}`,
        method: 'POST',
        headers: createSystemAlertWebhookHeaders(target.url, body, bearerToken),
        servername: target.url.hostname,
        signal,
        timeout: timeoutMs
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;

        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          finish(() => reject(new Error(`System alert webhook responded with HTTP ${statusCode}`)));
          return;
        }

        response.on('end', () => finish(() => resolve(statusCode)));
        response.on('error', (error) => finish(() => reject(error)));
        response.resume();
      }
    );

    request.on('timeout', () => {
      finish(() => reject(new Error(`System alert webhook timed out after ${timeoutMs}ms`)));
      request.destroy();
    });

    request.on('error', (error) => {
      finish(() => reject(error));
    });

    request.end(body);
  });
}

export function createSystemAlertWebhookNotifier({
  url,
  timeoutMs = 5000,
  bearerToken,
  egressPolicy,
  hostResolver = defaultRemoteHostResolver,
  fetcher,
  onDelivery
}: SystemAlertWebhookNotifierOptions): SystemAlertNotifier {
  const targetUrl = new URL(url);
  const logUrl = sanitizeWebhookUrlForLog(url);
  const normalizedEgressPolicy = normalizeRemoteEgressPolicy(egressPolicy);

  return {
    async notify(batch) {
      const controller = new AbortController();
      const normalizedTimeoutMs = Math.max(1, Math.round(timeoutMs));
      const timer = setTimeout(() => controller.abort(), normalizedTimeoutMs);

      try {
        const target = await resolveSystemAlertWebhookRemoteTarget(targetUrl, hostResolver, normalizedEgressPolicy);
        const bodyText = JSON.stringify(batch);
        const body = Buffer.from(bodyText, 'utf8');
        const statusCode = fetcher
          ? await fetcher(url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {})
              },
              body: bodyText,
              signal: controller.signal
            }).then((response) => {
              if (!response.ok) {
                throw new Error(`System alert webhook responded with HTTP ${response.status}`);
              }

              return response.status;
            })
          : await postPinnedSystemAlertWebhook({
              target,
              body,
              bearerToken,
              timeoutMs: normalizedTimeoutMs,
              signal: controller.signal
            });

        onDelivery?.({
          event: 'system_alert.webhook.delivered',
          url: logUrl,
          statusCode,
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
