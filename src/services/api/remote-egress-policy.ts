import { lookup as lookupDns } from 'node:dns/promises';
import { isIP } from 'node:net';

export type RemoteResolvedAddress = {
  address: string;
  family: 4 | 6;
};

export type RemoteHostResolver = (hostname: string) => Promise<RemoteResolvedAddress[]>;

export type RemoteEgressPolicy = {
  allowedHosts: string[];
};

type ResolveAllowedRemoteAddressesMessages = {
  unresolved: string;
  blockedResolvedHost: string;
};

export const defaultRemoteHostResolver: RemoteHostResolver = async (hostname) => {
  const records = await lookupDns(hostname, { all: true });

  return records.map((record) => ({
    address: record.address,
    family: record.family === 6 ? 6 : 4
  }));
};

export function normalizeRemoteHostname(hostname: string) {
  return hostname.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '');
}

export function normalizeRemoteEgressAllowlistEntry(entry: string) {
  const trimmed = entry.trim();

  if (!trimmed) {
    return undefined;
  }

  if (trimmed.includes('://')) {
    try {
      return normalizeRemoteHostname(new URL(trimmed).hostname);
    } catch {
      return normalizeRemoteHostname(trimmed);
    }
  }

  return normalizeRemoteHostname(trimmed);
}

export function normalizeRemoteEgressPolicy(policy: Partial<RemoteEgressPolicy> | undefined): RemoteEgressPolicy {
  const allowedHosts = (policy?.allowedHosts ?? [])
    .map((entry) => normalizeRemoteEgressAllowlistEntry(entry))
    .filter((entry): entry is string => Boolean(entry));

  return {
    allowedHosts: [...new Set(allowedHosts)]
  };
}

export function isRemoteHostAllowedByEgressPolicy(hostname: string, egressPolicy: RemoteEgressPolicy) {
  if (egressPolicy.allowedHosts.length === 0) {
    return true;
  }

  const normalized = normalizeRemoteHostname(hostname);

  return egressPolicy.allowedHosts.some((allowedHost) => {
    if (allowedHost.startsWith('*.')) {
      const suffix = allowedHost.slice(1);
      return normalized.endsWith(suffix) && normalized.length > suffix.length;
    }

    if (allowedHost.startsWith('.')) {
      return normalized.endsWith(allowedHost) && normalized.length > allowedHost.length;
    }

    return normalized === allowedHost;
  });
}

function parseIpv4Octets(hostname: string) {
  const parts = hostname.split('.');

  if (parts.length !== 4) {
    return undefined;
  }

  const octets = parts.map((part) => (part.trim() === '' ? Number.NaN : Number(part)));

  return octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255) ? octets : undefined;
}

function parseIpv6SideHextets(side: string) {
  if (side === '') {
    return [];
  }

  const hextets: number[] = [];

  for (const part of side.split(':')) {
    if (part === '') {
      return undefined;
    }

    if (part.includes('.')) {
      const octets = parseIpv4Octets(part);

      if (!octets) {
        return undefined;
      }

      hextets.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
      continue;
    }

    if (!/^[0-9a-f]{1,4}$/i.test(part)) {
      return undefined;
    }

    hextets.push(Number.parseInt(part, 16));
  }

  return hextets;
}

function parseIpv6Hextets(hostname: string) {
  if (isIP(hostname) !== 6) {
    return undefined;
  }

  const compressedParts = hostname.split('::');

  if (compressedParts.length > 2) {
    return undefined;
  }

  const head = parseIpv6SideHextets(compressedParts[0] ?? '');
  const tail = compressedParts.length === 2 ? parseIpv6SideHextets(compressedParts[1] ?? '') : [];

  if (!head || !tail) {
    return undefined;
  }

  if (compressedParts.length === 1) {
    return head.length === 8 ? head : undefined;
  }

  const missingHextets = 8 - head.length - tail.length;

  if (missingHextets < 1) {
    return undefined;
  }

  return [...head, ...Array.from({ length: missingHextets }, () => 0), ...tail];
}

function isBlockedIpv4Host(hostname: string) {
  const octets = parseIpv4Octets(hostname);

  if (!octets) {
    return false;
  }

  const [first, second] = octets;

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224
  );
}

function readIpv6EmbeddedIpv4Host(hextets: number[]) {
  const seventh = hextets[6] ?? 0;
  const eighth = hextets[7] ?? 0;

  return [
    (seventh >> 8) & 0xff,
    seventh & 0xff,
    (eighth >> 8) & 0xff,
    eighth & 0xff
  ].join('.');
}

function isBlockedIpv6Host(hostname: string) {
  const hextets = parseIpv6Hextets(hostname);

  if (!hextets) {
    return false;
  }

  const firstHextet = hextets[0] ?? 0;
  const isUnspecified = hextets.every((hextet) => hextet === 0);
  const isLoopback = hextets.slice(0, 7).every((hextet) => hextet === 0) && hextets[7] === 1;
  const isIpv4Mapped = hextets.slice(0, 5).every((hextet) => hextet === 0) && hextets[5] === 0xffff;
  const isIpv4Compatible = hextets.slice(0, 6).every((hextet) => hextet === 0);

  if (isIpv4Mapped || isIpv4Compatible) {
    return isBlockedIpv4Host(readIpv6EmbeddedIpv4Host(hextets));
  }

  const isUniqueLocal = (firstHextet & 0xfe00) === 0xfc00;
  const isLinkLocal = (firstHextet & 0xffc0) === 0xfe80;
  const isMulticast = (firstHextet & 0xff00) === 0xff00;

  return isUnspecified || isLoopback || isUniqueLocal || isLinkLocal || isMulticast;
}

export function isBlockedRemoteHost(hostname: string) {
  const normalized = normalizeRemoteHostname(hostname);

  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    isBlockedIpv4Host(normalized) ||
    isBlockedIpv6Host(normalized)
  );
}

export async function resolveAllowedRemoteAddresses(
  hostname: string,
  hostResolver: RemoteHostResolver,
  messages: ResolveAllowedRemoteAddressesMessages
): Promise<RemoteResolvedAddress[]> {
  const normalized = normalizeRemoteHostname(hostname);
  const literalIpFamily = isIP(normalized);

  if (literalIpFamily !== 0) {
    return [
      {
        address: normalized,
        family: literalIpFamily === 6 ? 6 : 4
      }
    ];
  }

  let resolvedAddresses: RemoteResolvedAddress[];

  try {
    resolvedAddresses = await hostResolver(normalized);
  } catch {
    throw new Error(messages.unresolved);
  }

  if (resolvedAddresses.length === 0) {
    throw new Error(messages.unresolved);
  }

  if (resolvedAddresses.some((record) => isBlockedRemoteHost(record.address))) {
    throw new Error(messages.blockedResolvedHost);
  }

  return resolvedAddresses;
}
