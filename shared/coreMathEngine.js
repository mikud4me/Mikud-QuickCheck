// ────────────────────────────────────────────────────────────────────────────
// coreMathEngine — Core Financial Math Library
//
// Single Source of Truth for ALL financial calculations.
// Used by: buildQuickReport, buildUnderwriterReport, and any future report.
//
// Deterministic: no AI, no randomness. Same input → same output every time.
// Zero dependencies on Base44/Deno — see shared/israeliId.js for the module
// conventions this directory follows.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Monthly amortization payment (שפיצר — Spitzer formula)
 * @param {number} principal - Loan amount (₪)
 * @param {number} annualRate - Annual interest rate (e.g. 4.5 for 4.5%)
 * @param {number} months - Total loan months
 * @returns {number} Monthly payment (₪)
 */
export function calcMonthlyPayment(principal, annualRate, months) {
  if (!principal || !annualRate || !months) return 0;
  const r = annualRate / 100 / 12;
  if (r === 0) return Math.round(principal / months);
  const payment = principal * r * Math.pow(1 + r, months) / (Math.pow(1 + r, months) - 1);
  return Math.round(payment);
}

/**
 * Maximum loan for a given monthly payment
 * @param {number} monthlyPayment - Available monthly payment (₪)
 * @param {number} annualRate - Annual rate (%)
 * @param {number} years - Loan period (years)
 * @returns {number} Max loan amount (₪)
 */
export function calcMaxLoan(monthlyPayment, annualRate, years) {
  if (!monthlyPayment || !annualRate || !years) return 0;
  const r = annualRate / 100 / 12;
  const n = years * 12;
  if (r === 0) return Math.round(monthlyPayment * n);
  return Math.round(monthlyPayment * (1 - Math.pow(1 + r, -n)) / r);
}

/**
 * PTI (Payment-to-Income) ratio
 * @param {number} totalMonthlyDebt - Total monthly obligations (₪)
 * @param {number} totalNetIncome - Total household net income (₪)
 * @returns {{ ratio: number, status: string, max_allowed: number, available: number }}
 */
export function calcPTI(totalMonthlyDebt, totalNetIncome) {
  if (!totalNetIncome || totalNetIncome <= 0) {
    return { ratio: 0, ratio_pct: 0, status: 'unknown', max_allowed: 0, available: 0 };
  }
  const ratio = totalMonthlyDebt / totalNetIncome;
  const ratio_pct = parseFloat((ratio * 100).toFixed(1));
  const max_allowed = Math.round(totalNetIncome * 0.40);
  const available = Math.max(0, max_allowed - totalMonthlyDebt);
  let status = 'excellent';
  if (ratio_pct >= 40) status = 'critical';
  else if (ratio_pct >= 35) status = 'borderline';
  else if (ratio_pct >= 25) status = 'acceptable';
  else if (ratio_pct >= 10) status = 'good';
  return { ratio, ratio_pct, status, max_allowed, available };
}

/**
 * LTV (Loan-to-Value) ratio
 * @param {number} loanBalance - Remaining loan balance (₪)
 * @param {number} propertyValue - Property value (₪)
 * @returns {{ ratio: number, ratio_pct: number, status: string }}
 */
export function calcLTV(loanBalance, propertyValue) {
  if (!propertyValue || propertyValue <= 0 || !loanBalance) {
    return { ratio: 0, ratio_pct: 0, status: 'unknown' };
  }
  const ratio = loanBalance / propertyValue;
  const ratio_pct = parseFloat((ratio * 100).toFixed(1));
  let status = 'excellent';
  if (ratio_pct > 75) status = 'high';
  else if (ratio_pct > 60) status = 'acceptable';
  else if (ratio_pct > 40) status = 'good';
  return { ratio, ratio_pct, status };
}

/**
 * Weighted average interest rate across multiple tracks
 * @param {Array<{remaining_balance: number, interest_rate: number}>} tracks
 * @returns {number} Weighted average rate (%)
 */
export function calcWeightedRate(tracks) {
  if (!tracks || tracks.length === 0) return 0;
  const totalBalance = tracks.reduce((s, t) => s + (t.remaining_balance || 0), 0);
  if (totalBalance <= 0) return 0;
  const weighted = tracks.reduce((s, t) => s + ((t.interest_rate || 0) * (t.remaining_balance || 0)), 0);
  return parseFloat((weighted / totalBalance).toFixed(2));
}

/**
 * Average net income from payslips (excluding anomaly months)
 * One-time payment detection: notes containing bonus/reward keywords → net income adjusted
 * @param {Array} payslips
 * @returns {{ avg: number, count: number, anomaly_count: number, one_time_detected: boolean }}
 */
export function calcAvgNetIncome(payslips) {
  if (!payslips || payslips.length === 0) return { avg: 0, count: 0, anomaly_count: 0, one_time_detected: false };

  const ONE_TIME_KEYWORDS = ['תגמול', 'בונוס', 'מענק', 'מיוחד', 'עונתי', 'מתנה', 'פרס', 'החזר', 'הסדר', 'שלמוני', 'עמלה'];
  const isOneTime = (notes) => ONE_TIME_KEYWORDS.some(kw => (notes || '').includes(kw));

  const active = payslips.filter(p => !p._skip_in_avg && (p.net_salary || 0) > 0);
  if (active.length === 0) return { avg: 0, count: 0, anomaly_count: 0, one_time_detected: false };

  let oneTimeDetected = false;
  const nets = active.map(p => {
    const notes = (p.notes || '').toLowerCase();
    if (isOneTime(notes)) {
      oneTimeDetected = true;
      const estimatedOneTime = Math.round((p.gross_salary || 0) * 0.12);
      return Math.max(0, (p.net_salary || 0) - Math.round(estimatedOneTime * 0.72));
    }
    return p.net_salary || 0;
  });

  const anomalyCount = payslips.filter(p => p._anomaly_flag).length;
  const avg = Math.round(nets.reduce((s, n) => s + n, 0) / nets.length);

  return { avg, count: active.length, anomaly_count: anomalyCount, one_time_detected: oneTimeDetected };
}

/**
 * Business net income (self-employed) — CPA priority
 * @param {object} businessData - business_data from extractDocData
 * @returns {{ gross: number, net: number, net_ratio: number, source: string } | null}
 */
export function calcBusinessNetIncome(businessData) {
  const bd = businessData || {};
  let rawMonthly = 0;
  let source = 'unknown';
  let isCPA = false;

  if (bd.cpa_monthly_income > 0) {
    rawMonthly = bd.cpa_monthly_income;
    source = 'cpa_monthly';
    isCPA = true;
  } else if (bd.cpa_annual_income > 0) {
    rawMonthly = bd.cpa_annual_income / 12;
    source = 'cpa_annual';
    isCPA = true;
  } else if (bd.annual_income_year1 > 0 && !bd.annual_income_year2) {
    rawMonthly = bd.annual_income_year1 / 12;
    source = 'tax_year1_only';
  } else if (bd.annual_income_year1 > 0 && bd.annual_income_year2 > 0) {
    rawMonthly = ((bd.annual_income_year1 + bd.annual_income_year2) / 2) / 12;
    source = 'tax_avg_2years';
  } else if (bd.annual_income_year3 > 0) {
    rawMonthly = bd.annual_income_year3 / 12;
    source = 'cpa_year3';
  } else if (bd.average_monthly_income > 0) {
    rawMonthly = bd.average_monthly_income;
    source = 'bd_average';
  } else if (bd.annual_income > 0) {
    rawMonthly = bd.annual_income / 12;
    source = 'bd_annual';
  }

  if (!rawMonthly) return null;

  // Net ratio: CPA = 72% flat; tax assessment = sliding scale
  const net_ratio = isCPA ? 0.72 : (rawMonthly <= 10000 ? 0.80 : rawMonthly > 20000 ? 0.65 : 0.72);
  return {
    gross: Math.round(rawMonthly),
    net: Math.round(rawMonthly * net_ratio),
    net_ratio,
    source,
    is_cpa: isCPA
  };
}

/**
 * Refinance savings calculation (מחזור משכנתא)
 * @param {object} existingMortgage - {remaining_balance, average_interest_rate, monthly_payment, remaining_months, tracks}
 * @param {object} newRates - {average_rates: {prime, fixed_linked, fixed_unlinked, variable_linked, variable_unlinked}}
 * @returns {object} Full savings analysis
 */
export function calcRefinanceSavings(existingMortgage, newRates) {
  const balance = existingMortgage?.remaining_balance || 0;
  const currentRate = existingMortgage?.average_interest_rate || 0;
  const currentPayment = existingMortgage?.monthly_payment || 0;
  const remainingMonths = existingMortgage?.remaining_months || 240;
  const earlyRepaymentFee = existingMortgage?.early_repayment_fee || 0;
  const bankFees = 5000; // Standard bank processing fees

  if (!balance || !currentRate) {
    return { error: 'Missing existing mortgage data', actualRemainingBalance: balance };
  }

  // Recommended new rate (balanced mix assumption: prime + fixed unlinked)
  const prime = newRates?.average_rates?.prime || 4.5;
  const fixedUnlinked = newRates?.average_rates?.fixed_unlinked || 5.0;
  const newAverageRate = parseFloat(((prime * 0.4 + fixedUnlinked * 0.6)).toFixed(2));

  const newMonthlyPayment = calcMonthlyPayment(balance, newAverageRate, remainingMonths);
  const monthlySavings = Math.max(0, currentPayment - newMonthlyPayment);

  // Total interest remaining on existing mortgage
  const totalRemainingInterestOld = (currentPayment * remainingMonths) - balance;

  // Total interest on new mortgage
  const totalInterestNew = (newMonthlyPayment * remainingMonths) - balance;

  const grossSavings = totalRemainingInterestOld - totalInterestNew;
  const refinanceCost = earlyRepaymentFee + bankFees;
  const netSavings = Math.round(grossSavings - refinanceCost);

  // Break-even months
  const breakEvenMonths = monthlySavings > 0 ? Math.ceil(refinanceCost / monthlySavings) : null;
  const isWorthwhile = netSavings > 0 && (breakEvenMonths === null || breakEvenMonths < remainingMonths);

  return {
    actualRemainingBalance: balance,
    currentRate,
    currentPayment,
    newAverageRate,
    newMonthlyPayment,
    monthlySavings,
    grossSavings: Math.round(grossSavings),
    netSavings,
    refinanceCost,
    earlyRepaymentFee,
    bankFees,
    breakEvenMonths,
    isWorthwhile,
    remainingMonths
  };
}

/**
 * Full amortization schedule
 * @param {number} principal
 * @param {number} annualRate
 * @param {number} months
 * @returns {Array<{month, payment, principal_portion, interest_portion, balance}>}
 */
export function calcAmortizationSchedule(principal, annualRate, months) {
  if (!principal || !annualRate || !months) return [];
  const r = annualRate / 100 / 12;
  const payment = calcMonthlyPayment(principal, annualRate, months);
  const schedule = [];
  let balance = principal;

  for (let i = 1; i <= months; i++) {
    const interestPortion = Math.round(balance * r);
    const principalPortion = payment - interestPortion;
    balance = Math.max(0, balance - principalPortion);
    schedule.push({
      month: i,
      payment,
      principal_portion: principalPortion,
      interest_portion: interestPortion,
      balance: Math.round(balance)
    });
  }
  return schedule;
}
