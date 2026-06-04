import {
  clampMonthlyResetDay,
  isSampleInMonthlyBillingPeriod,
  resolveMonthlyBillingPeriod
} from './billing-period';

describe('monthly billing period', () => {
  it('uses UTC reset-day windows and stable period keys', () => {
    expect(resolveMonthlyBillingPeriod(7, '2026-06-07T00:00:00.000Z')).toEqual({
      key: '2026-06-reset-07',
      startsAt: '2026-06-07T00:00:00.000Z',
      endsBefore: '2026-07-07T00:00:00.000Z',
      resetDay: 7
    });

    expect(resolveMonthlyBillingPeriod(7, '2026-06-06T23:59:59.000Z')).toMatchObject({
      key: '2026-05-reset-07',
      startsAt: '2026-05-07T00:00:00.000Z',
      endsBefore: '2026-06-07T00:00:00.000Z'
    });
  });

  it('treats reset days beyond a short month as that month end', () => {
    expect(resolveMonthlyBillingPeriod(31, '2026-02-28T00:00:00.000Z')).toMatchObject({
      key: '2026-02-reset-31',
      startsAt: '2026-02-28T00:00:00.000Z',
      endsBefore: '2026-03-31T00:00:00.000Z'
    });

    expect(resolveMonthlyBillingPeriod(31, '2026-03-30T23:59:59.000Z')).toMatchObject({
      key: '2026-02-reset-31'
    });
  });

  it('matches samples by explicit period key or sampled time', () => {
    expect(
      isSampleInMonthlyBillingPeriod({
        resetDay: 1,
        currentAt: '2026-07-01T00:00:00.000Z',
        sampledAt: '2026-06-30T23:59:59.000Z'
      })
    ).toBe(false);

    expect(
      isSampleInMonthlyBillingPeriod({
        resetDay: 1,
        currentAt: '2026-07-01T00:00:00.000Z',
        sampledAt: '2026-07-01T00:00:01.000Z',
        trafficBillingPeriod: '2026-07-reset-01'
      })
    ).toBe(true);
  });

  it('clamps invalid reset days', () => {
    expect(clampMonthlyResetDay(0)).toBe(1);
    expect(clampMonthlyResetDay(40)).toBe(31);
    expect(clampMonthlyResetDay('bad', 9)).toBe(9);
  });
});
