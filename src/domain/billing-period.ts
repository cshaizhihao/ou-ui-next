export type MonthlyBillingPeriod = {
  key: string;
  startsAt: string;
  endsBefore: string;
  resetDay: number;
};

const billingPeriodKeyPattern = /^\d{4}-\d{2}-reset-\d{2}$/;

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

function parseFiniteDate(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms) : undefined;
}

function daysInUtcMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addUtcMonths(year: number, month: number, delta: number) {
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1
  };
}

function periodStartMs(year: number, month: number, resetDay: number) {
  return Date.UTC(year, month - 1, Math.min(resetDay, daysInUtcMonth(year, month)));
}

export function clampMonthlyResetDay(value: unknown, fallback = 1) {
  const numberValue = typeof value === 'number' ? value : Number(value);
  const normalizedFallback = Number.isInteger(fallback) ? Math.max(1, Math.min(31, fallback)) : 1;

  if (!Number.isInteger(numberValue)) {
    return normalizedFallback;
  }

  return Math.max(1, Math.min(31, numberValue));
}

export function normalizeMonthlyBillingPeriodKey(value: unknown) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const key = value.trim();
  return billingPeriodKeyPattern.test(key) ? key : undefined;
}

export function resolveMonthlyBillingPeriod(resetDayInput: unknown, atIso: string): MonthlyBillingPeriod | undefined {
  const at = parseFiniteDate(atIso);
  if (!at) {
    return undefined;
  }

  const resetDay = clampMonthlyResetDay(resetDayInput);
  const year = at.getUTCFullYear();
  const month = at.getUTCMonth() + 1;
  const currentStartMs = periodStartMs(year, month, resetDay);
  const start = at.getTime() >= currentStartMs ? { year, month } : addUtcMonths(year, month, -1);
  const next = addUtcMonths(start.year, start.month, 1);
  const startsAtMs = periodStartMs(start.year, start.month, resetDay);
  const endsBeforeMs = periodStartMs(next.year, next.month, resetDay);

  return {
    key: `${start.year}-${pad2(start.month)}-reset-${pad2(resetDay)}`,
    startsAt: new Date(startsAtMs).toISOString(),
    endsBefore: new Date(endsBeforeMs).toISOString(),
    resetDay
  };
}

export function resolveMonthlyBillingPeriodKey(resetDayInput: unknown, atIso: string) {
  return resolveMonthlyBillingPeriod(resetDayInput, atIso)?.key;
}

export function isSampleInMonthlyBillingPeriod(input: {
  resetDay: unknown;
  sampledAt?: string;
  currentAt: string;
  trafficBillingPeriod?: unknown;
}) {
  const currentPeriod = resolveMonthlyBillingPeriod(input.resetDay, input.currentAt);
  if (!currentPeriod) {
    return false;
  }

  const reportedPeriod = normalizeMonthlyBillingPeriodKey(input.trafficBillingPeriod);
  if (reportedPeriod) {
    return reportedPeriod === currentPeriod.key;
  }

  if (!input.sampledAt) {
    return false;
  }

  return resolveMonthlyBillingPeriodKey(input.resetDay, input.sampledAt) === currentPeriod.key;
}
