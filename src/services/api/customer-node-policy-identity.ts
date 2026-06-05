import type { XrayClient, XrayInbound } from '../../domain/protocol';

function readTrimmed(value: string | undefined) {
  return value?.trim() ?? '';
}

export function readCustomerNodePolicySubject(inbound: Pick<XrayInbound, 'clientIdentity'>, client: Pick<XrayClient, 'id' | 'email'>) {
  return readTrimmed(inbound.clientIdentity) || readTrimmed(client.id) || readTrimmed(client.email);
}

export function readCustomerNodePolicyResourceId(
  inbound: Pick<XrayInbound, 'id' | 'clientIdentity'>,
  client: Pick<XrayClient, 'id' | 'email'>
) {
  const subject = readCustomerNodePolicySubject(inbound, client);
  return subject ? `${inbound.id}:${subject}` : inbound.id;
}

export function readCustomerNodePolicyId(
  inbound: Pick<XrayInbound, 'id' | 'clientIdentity'>,
  client: Pick<XrayClient, 'id' | 'email'>
) {
  return `customer-node:${readCustomerNodePolicyResourceId(inbound, client)}`;
}

export function matchesCustomerNodePolicySubject(
  inbound: Pick<XrayInbound, 'clientIdentity'>,
  client: Pick<XrayClient, 'id' | 'email'>,
  subject: string
) {
  const normalizedSubject = subject.trim();

  if (!normalizedSubject) {
    return false;
  }

  return [readTrimmed(inbound.clientIdentity), readTrimmed(client.id), readTrimmed(client.email)].includes(normalizedSubject);
}
