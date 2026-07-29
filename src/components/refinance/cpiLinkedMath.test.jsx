import { describe, it, expect } from 'vitest';
import { calcCpiLinkedTrackCost } from './cpiLinkedMath';

describe('calcCpiLinkedTrackCost', () => {
  it('computes the standard annuity monthly payment ignoring inflation', () => {
    // 500,000 balance, 4% annual rate, 120 months — a well-known amortization case
    const track = { remaining_balance: 500000, interest_rate: 4, remaining_months: 120 };
    const { monthlyPayment } = calcCpiLinkedTrackCost(track);
    // Standard annuity formula: ~5,062.26
    expect(monthlyPayment).toBeCloseTo(5062.26, 1);
  });

  it('produces a total-with-inflation figure larger than the naive (unindexed) total', () => {
    const track = { remaining_balance: 500000, interest_rate: 4, remaining_months: 120 };
    const { monthlyPayment, totalWithInflation } = calcCpiLinkedTrackCost(track);
    const naiveTotal = monthlyPayment * track.remaining_months;
    expect(totalWithInflation).toBeGreaterThan(naiveTotal);
  });

  it('returns a larger total-with-inflation for longer remaining terms, all else equal', () => {
    const shortTrack = { remaining_balance: 500000, interest_rate: 4, remaining_months: 60 };
    const longTrack = { remaining_balance: 500000, interest_rate: 4, remaining_months: 240 };
    const shortResult = calcCpiLinkedTrackCost(shortTrack);
    const longResult = calcCpiLinkedTrackCost(longTrack);
    expect(longResult.totalWithInflation).toBeGreaterThan(shortResult.totalWithInflation);
  });

  it('scales the monthly payment linearly with the remaining balance', () => {
    const track1x = { remaining_balance: 500000, interest_rate: 4, remaining_months: 120 };
    const track2x = { remaining_balance: 1000000, interest_rate: 4, remaining_months: 120 };
    const result1x = calcCpiLinkedTrackCost(track1x);
    const result2x = calcCpiLinkedTrackCost(track2x);
    expect(result2x.monthlyPayment).toBeCloseTo(result1x.monthlyPayment * 2, 5);
  });
});
