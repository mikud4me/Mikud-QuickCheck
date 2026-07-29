import { describe, it, expect } from 'vitest';
import {
  calcMonthlyPayment,
  calcMaxLoan,
  calcPTI,
  calcLTV,
  calcWeightedRate,
  calcAvgNetIncome,
  calcBusinessNetIncome,
  calcRefinanceSavings,
  calcAmortizationSchedule,
} from './coreMathEngine.js';

describe('calcMonthlyPayment', () => {
  it('computes the standard annuity payment', () => {
    // Well-known case: 500,000 @ 4% over 120 months ≈ 5,062.26
    expect(calcMonthlyPayment(500000, 4, 120)).toBeCloseTo(5062, 0);
  });

  it('returns 0 when any required input is missing or falsy, including a 0% rate', () => {
    // Note: a 0% annualRate is falsy in JS, so the `!annualRate` guard short-circuits
    // before the function's own r===0 straight-division branch is ever reached —
    // an existing quirk of the original implementation, preserved verbatim here.
    expect(calcMonthlyPayment(0, 4, 120)).toBe(0);
    expect(calcMonthlyPayment(500000, 0, 120)).toBe(0);
    expect(calcMonthlyPayment(500000, 4, 0)).toBe(0);
  });
});

describe('calcMaxLoan', () => {
  it('is the inverse of calcMonthlyPayment for the same rate/term', () => {
    const payment = calcMonthlyPayment(500000, 4, 300); // 25 years
    const maxLoan = calcMaxLoan(payment, 4, 25);
    expect(maxLoan).toBeCloseTo(500000, -2); // within ~100 due to rounding
  });

  it('returns 0 when any required input is missing', () => {
    expect(calcMaxLoan(0, 4, 25)).toBe(0);
  });
});

describe('calcPTI', () => {
  it('returns "unknown" status when there is no income', () => {
    expect(calcPTI(5000, 0)).toEqual({ ratio: 0, ratio_pct: 0, status: 'unknown', max_allowed: 0, available: 0 });
  });

  it('classifies status by ratio thresholds: excellent < 10% <= good < 25% <= acceptable < 35% <= borderline < 40% <= critical', () => {
    expect(calcPTI(500, 10000).status).toBe('excellent'); // 5%
    expect(calcPTI(1500, 10000).status).toBe('good'); // 15%
    expect(calcPTI(3000, 10000).status).toBe('acceptable'); // 30%
    expect(calcPTI(3600, 10000).status).toBe('borderline'); // 36%
    expect(calcPTI(4500, 10000).status).toBe('critical'); // 45%
  });

  it('computes max_allowed as 40% of net income and available as the remaining headroom', () => {
    const { max_allowed, available } = calcPTI(2000, 10000);
    expect(max_allowed).toBe(4000);
    expect(available).toBe(2000);
  });

  it('floors available at 0 when debt already exceeds the 40% threshold', () => {
    expect(calcPTI(9000, 10000).available).toBe(0);
  });
});

describe('calcLTV', () => {
  it('returns "unknown" when property value or loan balance is missing', () => {
    expect(calcLTV(500000, 0)).toEqual({ ratio: 0, ratio_pct: 0, status: 'unknown' });
    expect(calcLTV(0, 1000000)).toEqual({ ratio: 0, ratio_pct: 0, status: 'unknown' });
  });

  it('classifies status by LTV thresholds', () => {
    expect(calcLTV(350000, 1000000).status).toBe('excellent'); // 35%
    expect(calcLTV(500000, 1000000).status).toBe('good'); // 50%
    expect(calcLTV(700000, 1000000).status).toBe('acceptable'); // 70%
    expect(calcLTV(800000, 1000000).status).toBe('high'); // 80%
  });
});

describe('calcWeightedRate', () => {
  it('weights each track rate by its share of the total balance', () => {
    const tracks = [
      { remaining_balance: 300000, interest_rate: 3 },
      { remaining_balance: 700000, interest_rate: 5 },
    ];
    // (300000*3 + 700000*5) / 1000000 = 4.4
    expect(calcWeightedRate(tracks)).toBe(4.4);
  });

  it('returns 0 for no tracks or zero total balance', () => {
    expect(calcWeightedRate([])).toBe(0);
    expect(calcWeightedRate(null)).toBe(0);
    expect(calcWeightedRate([{ remaining_balance: 0, interest_rate: 5 }])).toBe(0);
  });
});

describe('calcAvgNetIncome', () => {
  it('averages net salary across active payslips', () => {
    const payslips = [{ net_salary: 10000 }, { net_salary: 12000 }];
    expect(calcAvgNetIncome(payslips)).toEqual({ avg: 11000, count: 2, anomaly_count: 0, one_time_detected: false });
  });

  it('excludes payslips explicitly marked _skip_in_avg', () => {
    const payslips = [{ net_salary: 10000 }, { net_salary: 999999, _skip_in_avg: true }];
    expect(calcAvgNetIncome(payslips).avg).toBe(10000);
  });

  it('detects and discounts a one-time bonus payment using the 12%-gross/72%-net estimate', () => {
    const payslips = [{ net_salary: 15000, gross_salary: 20000, notes: 'כולל בונוס שנתי' }];
    const result = calcAvgNetIncome(payslips);
    expect(result.one_time_detected).toBe(true);
    // estimatedOneTime = round(20000*0.12) = 2400; discount = round(2400*0.72) = 1728
    expect(result.avg).toBe(15000 - 1728);
  });

  it('returns all zeros for an empty or missing payslip list', () => {
    expect(calcAvgNetIncome([])).toEqual({ avg: 0, count: 0, anomaly_count: 0, one_time_detected: false });
    expect(calcAvgNetIncome(null)).toEqual({ avg: 0, count: 0, anomaly_count: 0, one_time_detected: false });
  });

  it('counts anomaly-flagged payslips independently of the average calculation', () => {
    const payslips = [{ net_salary: 10000, _anomaly_flag: true }, { net_salary: 10000 }];
    expect(calcAvgNetIncome(payslips).anomaly_count).toBe(1);
  });
});

describe('calcBusinessNetIncome', () => {
  it('prioritizes CPA monthly income and applies a flat 72% net ratio', () => {
    const result = calcBusinessNetIncome({ cpa_monthly_income: 20000 });
    expect(result.source).toBe('cpa_monthly');
    expect(result.net_ratio).toBe(0.72);
    expect(result.net).toBe(14400);
    expect(result.is_cpa).toBe(true);
  });

  it('averages two years of tax assessments when both are present', () => {
    const result = calcBusinessNetIncome({ annual_income_year1: 120000, annual_income_year2: 240000 });
    expect(result.source).toBe('tax_avg_2years');
    expect(result.gross).toBe(Math.round(((120000 + 240000) / 2) / 12));
  });

  it('applies the sliding net-ratio scale for non-CPA sources: <=10k -> 80%, >20k -> 65%, else 72%', () => {
    expect(calcBusinessNetIncome({ average_monthly_income: 8000 }).net_ratio).toBe(0.80);
    expect(calcBusinessNetIncome({ average_monthly_income: 25000 }).net_ratio).toBe(0.65);
    expect(calcBusinessNetIncome({ average_monthly_income: 15000 }).net_ratio).toBe(0.72);
  });

  it('returns null when there is no usable business income source', () => {
    expect(calcBusinessNetIncome({})).toBeNull();
    expect(calcBusinessNetIncome(null)).toBeNull();
  });
});

describe('calcRefinanceSavings', () => {
  it('returns an error object when existing mortgage data is missing', () => {
    const result = calcRefinanceSavings({}, {});
    expect(result.error).toBeDefined();
  });

  it('computes a positive net savings scenario as worthwhile', () => {
    const existingMortgage = {
      remaining_balance: 500000,
      average_interest_rate: 6,
      monthly_payment: 4500,
      remaining_months: 180,
    };
    const newRates = { average_rates: { prime: 4, fixed_unlinked: 4.5 } };
    const result = calcRefinanceSavings(existingMortgage, newRates);
    expect(result.newAverageRate).toBeCloseTo(4.3, 5); // 4*0.4 + 4.5*0.6
    expect(result.newMonthlyPayment).toBeLessThan(existingMortgage.monthly_payment);
    expect(result.monthlySavings).toBeGreaterThan(0);
  });

  it('includes the early repayment fee and standard bank fees in refinanceCost', () => {
    const existingMortgage = { remaining_balance: 500000, average_interest_rate: 6, monthly_payment: 4500, remaining_months: 180, early_repayment_fee: 8000 };
    const result = calcRefinanceSavings(existingMortgage, { average_rates: {} });
    expect(result.refinanceCost).toBe(8000 + 5000);
  });
});

describe('calcAmortizationSchedule', () => {
  it('produces one row per month with a strictly decreasing balance', () => {
    const schedule = calcAmortizationSchedule(100000, 4, 12);
    expect(schedule).toHaveLength(12);
    for (let i = 1; i < schedule.length; i++) {
      expect(schedule[i].balance).toBeLessThanOrEqual(schedule[i - 1].balance);
    }
    expect(schedule[schedule.length - 1].balance).toBe(0);
  });

  it('returns an empty array when any required input is missing', () => {
    expect(calcAmortizationSchedule(0, 4, 12)).toEqual([]);
    expect(calcAmortizationSchedule(100000, 0, 12)).toEqual([]);
  });

  it('keeps the payment constant across all months (fixed-rate amortization)', () => {
    const schedule = calcAmortizationSchedule(200000, 5, 24);
    const payments = new Set(schedule.map(s => s.payment));
    expect(payments.size).toBe(1);
  });
});
