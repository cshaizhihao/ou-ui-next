export const XRAY_HIGH_PORT_MIN = 20_000;
export const XRAY_HIGH_PORT_MAX = 60_999;

function stableHash(input: string) {
  let hash = 0x811c9dc5;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash;
}

export function allocateStableHighListenPort(seed: string, usedPorts: Iterable<number> = []) {
  const occupiedPorts = new Set<number>();

  for (const port of usedPorts) {
    if (!Number.isFinite(port)) {
      continue;
    }

    const normalizedPort = Math.round(port);

    if (normalizedPort >= XRAY_HIGH_PORT_MIN && normalizedPort <= XRAY_HIGH_PORT_MAX) {
      occupiedPorts.add(normalizedPort);
    }
  }

  const range = XRAY_HIGH_PORT_MAX - XRAY_HIGH_PORT_MIN + 1;
  const startOffset = stableHash(seed.trim() || 'xray') % range;

  for (let attempt = 0; attempt < range; attempt += 1) {
    const port = XRAY_HIGH_PORT_MIN + ((startOffset + attempt) % range);

    if (!occupiedPorts.has(port)) {
      return port;
    }
  }

  return XRAY_HIGH_PORT_MIN;
}
