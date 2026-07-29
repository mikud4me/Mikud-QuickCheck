// ────────────────────────────────────────────────────────────────────────────
// "המסלול המדמם" — 20-year CPI-drag projection used by BleedingPathChart.
// Extracted from the component's useMemo bodies so the projection math can be
// unit-tested independently of rendering.
// ────────────────────────────────────────────────────────────────────────────

const INFLATION = 0.025;

const isIndexLinked = (t) =>
  t.is_index_linked || ((t.track_type || '').includes('צמוד') && !(t.track_type || '').includes('לא צמוד'));

/**
 * Projects the existing (CPI-linked) mortgage balance vs. a new mortgage's
 * balance year-by-year over 20 years.
 * @param {Array} tracks - existing mortgage tracks ({ remaining_balance, interest_rate, is_index_linked, track_type })
 * @param {number} newMonthlyPayment - monthly payment of the proposed new mortgage (optional, derived if absent)
 * @param {number} newAverageRate - annual rate (%) of the proposed new mortgage
 * @param {number} remainingBalance - total remaining balance of the existing mortgage
 * @returns {Array<{year:number,label:string,existing:number,new_mortgage:number}>}
 */
export function computeBleedingPathData(tracks, newMonthlyPayment, newAverageRate, remainingBalance) {
  if (!tracks || tracks.length === 0 || !remainingBalance) return [];
  const years = 20;
  const data = [];
  let currentBalance = remainingBalance;
  const newRate = (newAverageRate || 5.0) / 100 / 12;
  const newMonths = years * 12;
  const monthlyNew = newMonthlyPayment ||
    (remainingBalance * (newRate * Math.pow(1 + newRate, newMonths)) / (Math.pow(1 + newRate, newMonths) - 1));
  let newBalance = remainingBalance;

  for (let year = 0; year <= years; year++) {
    if (year > 0) {
      let linkedBalance = 0;
      let unlinkedBalance = 0;
      tracks.forEach(t => {
        const portion = t.remaining_balance / remainingBalance;
        if (isIndexLinked(t)) linkedBalance += currentBalance * portion;
        else unlinkedBalance += currentBalance * portion;
      });
      const inflatedLinked = linkedBalance * (1 + INFLATION);
      const avgRate = tracks.reduce((s, t) => s + t.interest_rate * t.remaining_balance, 0) / remainingBalance / 100 / 12;
      const rem = 240 - year * 12;
      const monthlyPayment = rem > 0
        ? currentBalance * (avgRate * Math.pow(1 + avgRate, rem)) / (Math.pow(1 + avgRate, rem) - 1)
        : 0;
      currentBalance = Math.max(0, (inflatedLinked + unlinkedBalance) - (monthlyPayment * 12 * 0.4));
      for (let m = 0; m < 12; m++) {
        const interest = newBalance * newRate;
        const principal = monthlyNew - interest;
        newBalance = Math.max(0, newBalance - principal);
      }
    }
    data.push({
      year,
      label: year === 0 ? 'היום' : `שנה ${year}`,
      existing: Math.round(Math.max(0, currentBalance)),
      new_mortgage: Math.round(Math.max(0, newBalance)),
    });
  }
  return data;
}

/**
 * Monthly shekel damage from CPI indexation alone, across all linked tracks.
 * @param {Array} tracks
 * @param {number} remainingBalance
 * @returns {number}
 */
export function computeMonthlyBurn(tracks, remainingBalance) {
  if (!tracks || !remainingBalance) return 0;
  const linkedBalance = tracks
    .filter(isIndexLinked)
    .reduce((s, t) => s + (t.remaining_balance || 0), 0);
  return Math.round((linkedBalance * INFLATION) / 12);
}
