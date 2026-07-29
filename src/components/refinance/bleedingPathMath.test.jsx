import { describe, it, expect } from 'vitest';
import { computeBleedingPathData, computeMonthlyBurn } from './bleedingPathMath';

describe('computeBleedingPathData', () => {
  it('returns an empty array when there are no tracks or no remaining balance', () => {
    expect(computeBleedingPathData([], 1000, 5, 500000)).toEqual([]);
    expect(computeBleedingPathData([{ remaining_balance: 100 }], 1000, 5, 0)).toEqual([]);
    expect(computeBleedingPathData(null, 1000, 5, 500000)).toEqual([]);
  });

  it('produces 21 data points (year 0 through year 20)', () => {
    const tracks = [{ remaining_balance: 500000, interest_rate: 4, track_type: 'קבועה לא צמודה' }];
    const data = computeBleedingPathData(tracks, 3000, 5, 500000);
    expect(data).toHaveLength(21);
    expect(data[0]).toEqual({ year: 0, label: 'היום', existing: 500000, new_mortgage: 500000 });
  });

  it('grows the existing balance over time when the track is fully CPI-linked at a low rate (indexation outpaces amortization)', () => {
    const linkedTrack = [{ remaining_balance: 500000, interest_rate: 0.5, track_type: 'משתנה צמודה', is_index_linked: true }];
    const data = computeBleedingPathData(linkedTrack, 2500, 5, 500000);
    // The whole "bleeding path" premise: a fully CPI-linked track's balance can go up, not down,
    // when the 2.5%/year CPI drag outpaces the modeled amortization reduction.
    expect(data[1].existing).toBeGreaterThan(data[0].existing);
  });

  it('shrinks the new mortgage balance monotonically via standard amortization', () => {
    const tracks = [{ remaining_balance: 500000, interest_rate: 4, track_type: 'קבועה לא צמודה' }];
    const data = computeBleedingPathData(tracks, 3000, 5, 500000);
    for (let i = 1; i < data.length; i++) {
      expect(data[i].new_mortgage).toBeLessThanOrEqual(data[i - 1].new_mortgage);
    }
  });

  it('derives the new monthly payment from an annuity formula when none is supplied', () => {
    const tracks = [{ remaining_balance: 500000, interest_rate: 4, track_type: 'קבועה לא צמודה' }];
    const withExplicitPayment = computeBleedingPathData(tracks, 3000, 5, 500000);
    const withDerivedPayment = computeBleedingPathData(tracks, undefined, 5, 500000);
    // Different monthly payments should produce different new_mortgage trajectories
    expect(withDerivedPayment[5].new_mortgage).not.toBe(withExplicitPayment[5].new_mortgage);
  });
});

describe('computeMonthlyBurn', () => {
  it('is zero when there are no tracks or no remaining balance', () => {
    expect(computeMonthlyBurn([], 500000)).toBe(0);
    expect(computeMonthlyBurn(null, 500000)).toBe(0);
    expect(computeMonthlyBurn([{ remaining_balance: 100000, is_index_linked: true }], 0)).toBe(0);
  });

  it('is zero when no tracks are CPI-linked', () => {
    const tracks = [{ remaining_balance: 500000, track_type: 'קבועה לא צמודה' }];
    expect(computeMonthlyBurn(tracks, 500000)).toBe(0);
  });

  it('computes 2.5%/year of the linked balance, divided by 12, for linked tracks only', () => {
    const tracks = [
      { remaining_balance: 400000, is_index_linked: true },
      { remaining_balance: 100000, track_type: 'קבועה לא צמודה' }, // not linked, excluded
    ];
    // 400000 * 0.025 / 12 = 833.33... -> rounds to 833
    expect(computeMonthlyBurn(tracks, 500000)).toBe(Math.round((400000 * 0.025) / 12));
  });

  it('treats a track_type containing "צמוד" (but not "לא צמוד") as linked', () => {
    const tracks = [{ remaining_balance: 400000, track_type: 'ריבית קבועה צמודה למדד' }];
    expect(computeMonthlyBurn(tracks, 500000)).toBeGreaterThan(0);
  });

  it('does not treat "לא צמוד" (not linked) as linked even though it contains the substring "צמוד"', () => {
    const tracks = [{ remaining_balance: 400000, track_type: 'ריבית קבועה לא צמודה' }];
    expect(computeMonthlyBurn(tracks, 500000)).toBe(0);
  });
});
