// ────────────────────────────────────────────────────────────────────────────
// Total lifetime cost of a single CPI-linked mortgage track, including the
// effect of monthly index-linked payment growth (assumed 2.5%/year CPI).
// Extracted from CalculationBreakdown's inline JSX .map() so the formula can
// be unit-tested independently of rendering.
// Formula: P × ((1+i)^n − 1) / i, where P is the base (unindexed) monthly
// payment and i is the assumed monthly inflation rate.
// ────────────────────────────────────────────────────────────────────────────

const ANNUAL_INFLATION = 0.025;

/**
 * @param {{remaining_balance:number, interest_rate:number, remaining_months:number}} track
 * @returns {{monthlyPayment:number, totalWithInflation:number}}
 */
export function calcCpiLinkedTrackCost(track) {
  const monthlyInflation = ANNUAL_INFLATION / 12;
  const months = track.remaining_months;
  const monthlyRate = track.interest_rate / 100 / 12;
  const monthlyPayment = track.remaining_balance *
    (monthlyRate * Math.pow(1 + monthlyRate, months)) /
    (Math.pow(1 + monthlyRate, months) - 1);
  const totalWithInflation = monthlyPayment *
    (Math.pow(1 + monthlyInflation, months) - 1) / monthlyInflation;
  return { monthlyPayment, totalWithInflation };
}
