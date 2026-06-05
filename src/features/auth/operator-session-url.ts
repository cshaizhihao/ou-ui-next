export function createOperatorSessionUrl(baseUrl: string) {
  return `${baseUrl.replace(/\/+$/, '')}/api/v1/auth/session`;
}
