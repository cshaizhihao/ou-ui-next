import { createHash, createHmac } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import {
  defaultRemoteHostResolver,
  isBlockedRemoteHost,
  isRemoteHostAllowedByEgressPolicy,
  normalizeRemoteEgressPolicy,
  normalizeRemoteHostname,
  resolveAllowedRemoteAddresses,
  type RemoteEgressPolicy,
  type RemoteHostResolver,
  type RemoteResolvedAddress
} from '../../services/api/remote-egress-policy';

export type S3CompatibleObjectStorageWriterOptions = {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  prefix?: string;
  objectLock?: S3ObjectLockOptions;
  timeoutMs?: number;
  forcePathStyle?: boolean;
  egressPolicy?: Partial<RemoteEgressPolicy>;
  hostResolver?: RemoteHostResolver;
  fetcher?: typeof fetch;
  now?: () => Date;
};

export type S3ObjectLockOptions = {
  retentionMode?: 'GOVERNANCE' | 'COMPLIANCE';
  retentionDays?: number;
  legalHold?: boolean;
};

export type S3CompatibleObjectStorageWriter = {
  putJsonObject(key: string, value: unknown): Promise<number>;
};

export type RuntimeObjectStorageSinkConfig = {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  prefix?: string;
  objectLock?: S3ObjectLockOptions;
  timeoutMs: number;
  forcePathStyle: boolean;
  egress?: {
    allowedHosts: string[];
  };
};

type S3ObjectStorageTarget = {
  url: URL;
  resolvedAddress: RemoteResolvedAddress;
  resolvedAddresses: RemoteResolvedAddress[];
};

type SignedS3PutRequest = {
  url: URL;
  body: Buffer;
  fetchHeaders: Record<string, string>;
  pinnedHeaders: Record<string, string>;
};

function requireNonEmpty(value: string, label: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error(`${label} must not be empty.`);
  }

  return trimmed;
}

export function sanitizeObjectStorageEndpointForLog(endpoint: string) {
  try {
    return new URL(endpoint).origin;
  } catch {
    return 'invalid-endpoint';
  }
}

function normalizeObjectKeyPrefix(prefix: string | undefined) {
  if (!prefix?.trim()) {
    return '';
  }

  return prefix
    .trim()
    .split('/')
    .map((part) => sanitizeObjectKeySegment(part))
    .filter((part) => part.length > 0)
    .join('/');
}

function sanitizeObjectKeySegment(value: string) {
  const sanitized = value.trim().replace(/[^A-Za-z0-9._=-]+/g, '_').replace(/^_+|_+$/g, '');

  return sanitized || 'unknown';
}

function normalizeObjectStorageTimestamp(timestamp: string) {
  const parsed = new Date(timestamp);

  return Number.isNaN(parsed.getTime()) ? timestamp : parsed.toISOString();
}

function compactObjectStorageTimestamp(timestamp: string) {
  return sanitizeObjectKeySegment(timestamp.replace(/[-:]|\./g, ''));
}

function joinObjectKey(...segments: Array<string | undefined>) {
  return segments
    .flatMap((segment) => (segment ? segment.split('/') : []))
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .join('/');
}

export function createObjectStorageJsonKey({
  prefix,
  kind,
  timestamp,
  recordId
}: {
  prefix?: string;
  kind: string;
  timestamp: string;
  recordId: string;
}) {
  const normalizedTimestamp = normalizeObjectStorageTimestamp(timestamp);
  const [datePart = 'unknown'] = normalizedTimestamp.split('T');
  const [year = 'unknown', month = '00', day = '00'] = datePart.split('-');
  const filename = `${compactObjectStorageTimestamp(normalizedTimestamp)}-${sanitizeObjectKeySegment(recordId)}.json`;

  return joinObjectKey(
    normalizeObjectKeyPrefix(prefix),
    sanitizeObjectKeySegment(kind),
    sanitizeObjectKeySegment(year),
    sanitizeObjectKeySegment(month),
    sanitizeObjectKeySegment(day),
    filename
  );
}

function normalizeObjectStorageEndpoint(endpoint: string) {
  let url: URL;

  try {
    url = new URL(endpoint.trim());
  } catch {
    throw new Error('Object storage endpoint must be a valid http or https URL.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Object storage endpoint protocol must be http or https.');
  }

  if (url.username || url.password) {
    throw new Error('Object storage endpoint must not include credentials.');
  }

  if (url.search || url.hash) {
    throw new Error('Object storage endpoint must not include query or fragment values.');
  }

  return url;
}

function encodeAwsPathSegment(segment: string) {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function splitUrlPathname(pathname: string) {
  return pathname
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });
}

function encodeAwsPath(segments: string[]) {
  return `/${segments.map(encodeAwsPathSegment).join('/')}`;
}

function createS3ObjectUrl({
  endpoint,
  bucket,
  key,
  forcePathStyle
}: {
  endpoint: URL;
  bucket: string;
  key: string;
  forcePathStyle: boolean;
}) {
  const url = new URL(endpoint.toString());
  const endpointPathSegments = splitUrlPathname(endpoint.pathname);
  const keySegments = key.split('/').filter((segment) => segment.length > 0);

  if (forcePathStyle) {
    url.pathname = encodeAwsPath([...endpointPathSegments, bucket, ...keySegments]);
    return url;
  }

  if (isIP(normalizeRemoteHostname(endpoint.hostname)) !== 0) {
    throw new Error('Virtual-hosted object storage endpoints require a DNS hostname.');
  }

  url.hostname = `${bucket}.${endpoint.hostname}`;
  url.pathname = encodeAwsPath([...endpointPathSegments, ...keySegments]);

  return url;
}

async function resolveObjectStorageTarget(
  url: URL,
  hostResolver: RemoteHostResolver,
  egressPolicy: RemoteEgressPolicy
): Promise<S3ObjectStorageTarget> {
  if (isBlockedRemoteHost(url.hostname)) {
    throw new Error('object storage endpoint host is not allowed for remote delivery');
  }

  if (!isRemoteHostAllowedByEgressPolicy(url.hostname, egressPolicy)) {
    throw new Error('object storage endpoint host is not in the egress allowlist');
  }

  const resolvedAddresses = await resolveAllowedRemoteAddresses(url.hostname, hostResolver, {
    unresolved: 'object storage endpoint host could not be resolved for remote delivery',
    blockedResolvedHost: 'object storage endpoint resolved host is not allowed for remote delivery'
  });

  return {
    url,
    resolvedAddress: resolvedAddresses[0],
    resolvedAddresses
  };
}

function sha256Hex(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

function hmacSha256(key: string | Buffer, value: string) {
  return createHmac('sha256', key).update(value).digest();
}

function hmacSha256Hex(key: string | Buffer, value: string) {
  return createHmac('sha256', key).update(value).digest('hex');
}

function formatAmzDate(date: Date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function formatDateStamp(date: Date) {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

function createS3SigningKey(secretAccessKey: string, dateStamp: string, region: string) {
  const dateKey = hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const regionKey = hmacSha256(dateKey, region);
  const serviceKey = hmacSha256(regionKey, 's3');

  return hmacSha256(serviceKey, 'aws4_request');
}

function normalizeS3ObjectLockOptions(objectLock: S3ObjectLockOptions | undefined) {
  if (!objectLock) {
    return undefined;
  }

  const hasRetentionMode = objectLock.retentionMode !== undefined;
  const hasRetentionDays = objectLock.retentionDays !== undefined;
  if (hasRetentionMode !== hasRetentionDays) {
    throw new Error('Object storage object lock retention mode and retention days must be configured together.');
  }

  if (
    objectLock.retentionMode !== undefined &&
    objectLock.retentionMode !== 'GOVERNANCE' &&
    objectLock.retentionMode !== 'COMPLIANCE'
  ) {
    throw new Error('Object storage object lock retention mode must be GOVERNANCE or COMPLIANCE.');
  }

  if (
    objectLock.retentionDays !== undefined &&
    (!Number.isSafeInteger(objectLock.retentionDays) || objectLock.retentionDays <= 0)
  ) {
    throw new Error('Object storage object lock retention days must be a positive integer.');
  }

  if (!hasRetentionMode && objectLock.legalHold !== true) {
    return undefined;
  }

  return {
    ...(objectLock.retentionMode && objectLock.retentionDays
      ? {
          retentionMode: objectLock.retentionMode,
          retentionDays: objectLock.retentionDays
        }
      : {}),
    ...(objectLock.legalHold === true ? { legalHold: true } : {})
  };
}

function createS3ObjectLockHeaderPairs(objectLock: S3ObjectLockOptions | undefined, now: Date) {
  const normalized = normalizeS3ObjectLockOptions(objectLock);

  if (!normalized) {
    return {};
  }

  return {
    ...(normalized.retentionMode && normalized.retentionDays
      ? {
          'x-amz-object-lock-mode': normalized.retentionMode,
          'x-amz-object-lock-retain-until-date': new Date(
            now.getTime() + normalized.retentionDays * 24 * 60 * 60 * 1000
          ).toISOString()
        }
      : {}),
    ...(normalized.legalHold ? { 'x-amz-object-lock-legal-hold': 'ON' } : {})
  };
}

function createFetchHeadersFromCanonicalPairs(canonicalHeaderPairs: Record<string, string>) {
  return {
    'Content-Type': canonicalHeaderPairs['content-type'],
    'X-Amz-Content-Sha256': canonicalHeaderPairs['x-amz-content-sha256'],
    'X-Amz-Date': canonicalHeaderPairs['x-amz-date'],
    ...(canonicalHeaderPairs['x-amz-security-token']
      ? { 'X-Amz-Security-Token': canonicalHeaderPairs['x-amz-security-token'] }
      : {}),
    ...(canonicalHeaderPairs['x-amz-object-lock-mode']
      ? { 'X-Amz-Object-Lock-Mode': canonicalHeaderPairs['x-amz-object-lock-mode'] }
      : {}),
    ...(canonicalHeaderPairs['x-amz-object-lock-retain-until-date']
      ? {
          'X-Amz-Object-Lock-Retain-Until-Date':
            canonicalHeaderPairs['x-amz-object-lock-retain-until-date']
        }
      : {}),
    ...(canonicalHeaderPairs['x-amz-object-lock-legal-hold']
      ? { 'X-Amz-Object-Lock-Legal-Hold': canonicalHeaderPairs['x-amz-object-lock-legal-hold'] }
      : {})
  };
}

function createSignedS3PutRequest({
  url,
  body,
  region,
  accessKeyId,
  secretAccessKey,
  sessionToken,
  objectLock,
  now
}: {
  url: URL;
  body: Buffer;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  objectLock?: S3ObjectLockOptions;
  now: Date;
}): SignedS3PutRequest {
  const amzDate = formatAmzDate(now);
  const dateStamp = formatDateStamp(now);
  const payloadHash = sha256Hex(body);
  const canonicalHeaderPairs = {
    'content-type': 'application/json',
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...(sessionToken ? { 'x-amz-security-token': sessionToken } : {}),
    ...createS3ObjectLockHeaderPairs(objectLock, now)
  };
  const sortedHeaderNames = Object.keys(canonicalHeaderPairs).sort();
  const canonicalHeaders = `${sortedHeaderNames
    .map((headerName) => `${headerName}:${canonicalHeaderPairs[headerName as keyof typeof canonicalHeaderPairs]}`)
    .join('\n')}\n`;
  const signedHeaders = sortedHeaderNames.join(';');
  const canonicalRequest = [
    'PUT',
    url.pathname,
    url.searchParams.toString(),
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n');
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join('\n');
  const signature = hmacSha256Hex(createS3SigningKey(secretAccessKey, dateStamp, region), stringToSign);
  const authorization = [
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`
  ].join(', ');
  const fetchHeaders = {
    ...createFetchHeadersFromCanonicalPairs(canonicalHeaderPairs),
    Authorization: authorization
  };

  return {
    url,
    body,
    fetchHeaders,
    pinnedHeaders: {
      ...fetchHeaders,
      'Content-Length': String(body.length),
      Host: url.host
    }
  };
}

function putPinnedObjectStorageRequest({
  target,
  body,
  headers,
  timeoutMs,
  signal
}: {
  target: S3ObjectStorageTarget;
  body: Buffer;
  headers: Record<string, string>;
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
        method: 'PUT',
        headers,
        servername: target.url.hostname,
        signal,
        timeout: timeoutMs
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;

        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          finish(() => reject(new Error(`Object storage PUT responded with HTTP ${statusCode}`)));
          return;
        }

        response.on('end', () => finish(() => resolve(statusCode)));
        response.on('error', (error) => finish(() => reject(error)));
        response.resume();
      }
    );

    request.on('timeout', () => {
      finish(() => reject(new Error(`Object storage PUT timed out after ${timeoutMs}ms`)));
      request.destroy();
    });

    request.on('error', (error) => {
      finish(() => reject(error));
    });

    request.end(body);
  });
}

export function createS3CompatibleObjectStorageWriter({
  endpoint,
  bucket,
  region,
  accessKeyId,
  secretAccessKey,
  sessionToken,
  objectLock,
  timeoutMs = 5000,
  forcePathStyle = true,
  egressPolicy,
  hostResolver = defaultRemoteHostResolver,
  fetcher,
  now = () => new Date()
}: S3CompatibleObjectStorageWriterOptions): S3CompatibleObjectStorageWriter {
  const endpointUrl = normalizeObjectStorageEndpoint(endpoint);
  const normalizedBucket = requireNonEmpty(bucket, 'Object storage bucket');
  const normalizedRegion = requireNonEmpty(region, 'Object storage region');
  const normalizedAccessKeyId = requireNonEmpty(accessKeyId, 'Object storage access key id');
  const normalizedSecretAccessKey = requireNonEmpty(secretAccessKey, 'Object storage secret access key');
  const normalizedEgressPolicy = normalizeRemoteEgressPolicy(egressPolicy);
  const normalizedObjectLock = normalizeS3ObjectLockOptions(objectLock);

  return {
    async putJsonObject(key, value) {
      const body = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
      const objectUrl = createS3ObjectUrl({
        endpoint: endpointUrl,
        bucket: normalizedBucket,
        key,
        forcePathStyle
      });
      const controller = new AbortController();
      const normalizedTimeoutMs = Math.max(1, Math.round(timeoutMs));
      const timer = setTimeout(() => controller.abort(), normalizedTimeoutMs);

      try {
        const target = await resolveObjectStorageTarget(objectUrl, hostResolver, normalizedEgressPolicy);
        const signedRequest = createSignedS3PutRequest({
          url: objectUrl,
          body,
          region: normalizedRegion,
          accessKeyId: normalizedAccessKeyId,
          secretAccessKey: normalizedSecretAccessKey,
          sessionToken,
          objectLock: normalizedObjectLock,
          now: now()
        });

        if (fetcher) {
          const response = await fetcher(objectUrl.toString(), {
            method: 'PUT',
            headers: signedRequest.fetchHeaders,
            body,
            signal: controller.signal
          });

          if (!response.ok) {
            throw new Error(`Object storage PUT responded with HTTP ${response.status}`);
          }

          return response.status;
        }

        return await putPinnedObjectStorageRequest({
          target,
          body: signedRequest.body,
          headers: signedRequest.pinnedHeaders,
          timeoutMs: normalizedTimeoutMs,
          signal: controller.signal
        });
      } finally {
        clearTimeout(timer);
      }
    }
  };
}
