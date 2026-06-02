export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

export function formatBytes(value: number) {
  if (!Number.isFinite(value)) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = Math.abs(value);
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const sign = value < 0 ? '-' : '';
  const digits = unitIndex === 0 ? 0 : 1;
  return `${sign}${size.toFixed(digits)} ${units[unitIndex]}`;
}

export function formatPercent(value: number) {
  return `${Math.round(value)}%`;
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat('zh-CN').format(value);
}
