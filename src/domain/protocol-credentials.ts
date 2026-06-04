import type { XrayClientCredentialType, XrayProtocol } from './protocol';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function stableHex(input: string) {
  let first = 0x811c9dc5;
  let second = 0x01000193;

  for (let index = 0; index < input.length; index += 1) {
    first ^= input.charCodeAt(index);
    first = Math.imul(first, 0x01000193);
    second ^= input.charCodeAt(input.length - index - 1);
    second = Math.imul(second, 0x811c9dc5);
  }

  const seed = `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
  return seed.repeat(3).slice(0, 32);
}

export function createStableUuid(input: string) {
  const hex = stableHex(input);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function createStableSecret(input: string) {
  return `ou-${stableHex(input).slice(0, 24)}`;
}

export function isUuid(value: string) {
  return UUID_PATTERN.test(value.trim());
}

export function normalizeXrayClientCredentials(input: {
  protocol: XrayProtocol;
  clientIdentity: string;
  clientCredential: string;
  hysteriaAuth?: string;
  fallbackSeed: string;
}): {
  clientIdentity: string;
  clientId: string;
  credential: string;
  password: string;
  auth: string;
  credentialType: XrayClientCredentialType;
} {
  const clientIdentity = input.clientIdentity.trim() || createStableUuid(`${input.fallbackSeed}:identity`);
  const rawCredential = input.clientCredential.trim();

  if (input.protocol === 'vless' || input.protocol === 'vmess') {
    const uuid = isUuid(rawCredential)
      ? rawCredential.toLowerCase()
      : isUuid(clientIdentity)
        ? clientIdentity.toLowerCase()
        : createStableUuid(`${input.fallbackSeed}:${clientIdentity}:${rawCredential || 'uuid'}`);

    return {
      clientIdentity,
      clientId: uuid,
      credential: uuid,
      password: '',
      auth: '',
      credentialType: 'uuid'
    };
  }

  if (input.protocol === 'hysteria') {
    const auth = input.hysteriaAuth?.trim() || rawCredential || createStableSecret(`${input.fallbackSeed}:${clientIdentity}:hysteria`);

    return {
      clientIdentity,
      clientId: clientIdentity,
      credential: auth,
      password: '',
      auth,
      credentialType: 'auth'
    };
  }

  const password = rawCredential || createStableSecret(`${input.fallbackSeed}:${clientIdentity}:${input.protocol}`);

  return {
    clientIdentity,
    clientId: clientIdentity,
    credential: password,
    password,
    auth: '',
    credentialType: 'password'
  };
}
