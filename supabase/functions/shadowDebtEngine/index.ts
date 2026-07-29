/**
 * shadowDebtEngine — Shadow Debt Forensic Engine
 *
 * Sits AFTER normalizeDocData, BEFORE buildQuickReport.
 * Detects undisclosed debts using deductive logic (elimination method).
 * Never crashes the pipeline — always returns a result, even if partial.
 *
 * Input:  normalizedData from normalizeDocData + net_income
 * Output: shadow_debt_analysis object injected into cleanedData
 */

import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

// ─── Known financial institution keywords (debit side) ───
const SHADOW_DEBT_INSTITUTIONS = [
    // כרטיסי אשראי
    'מקס', 'max', 'כאל', 'cal', 'ישראכרט', 'isracard', 'אמריקן אקספרס', 'amex',
    // גופי מימון חוץ-בנקאי — דגל אדום מיידי
    'גמא', 'gamma', 'טריא', 'tria', 'מימון ישיר', 'blender', 'קרדיט גארד', 'creditguard',
    'פמילי קרדיט', 'family credit', 'לנדר', 'lender', 'פנסיה נט', 'pension net',
    'CapiTaL', 'קפיטל', 'משכן', 'משכנתאות', 'ריבית', 'הלוואה',
    // בנקים (העברות קבועות לבנקים אחרים — עשויות להיות פירעון הלוואה)
    'דיסקונט', 'discount', 'מזרחי', 'mizrahi', 'הפועלים', 'hapoalim',
    'לאומי', 'leumi', 'ירושלים', 'jerusalem', 'בינלאומי', 'international',
    'יהב', 'אגוד', 'אוצר החיל', 'מרכנתיל', 'mercantile', 'בי.פי.אי', 'one zero'
];

// ─── Family transfer keywords (עגולים קבועים לקרובי משפחה = הלוואה פנימית) ───
const FAMILY_TRANSFER_KEYWORDS = [
    'העברה לחשבון', 'העברה בנקאית', 'ביט', 'bit', 'paybox', 'פייבוקס', 'pepper', 'פייפר',
    'העברה', 'transfer', 'שיק', 'check'
];

// ─── Non-loan exclusions (regular expenses, not debts) ───
const EXPENSE_EXCLUSIONS = [
    'ארנונה', 'חשמל', 'מים', 'גז', 'ועד', 'סלולר', 'אינטרנט', 'hot', 'partner', 'yes ',
    'cellcom', 'פנסיה', 'גמל', 'קרן', 'שכר דירה', 'שכ"ד', 'דלק', 'מסעדה', 'קפה',
    'פארם', 'שטראוס', 'סופר', 'מרקט', 'חשמל', 'מכולת', 'בגדים', 'נסיעות'
];

const isExcluded = (desc) => {
    const lower = (desc || '').toLowerCase();
    return EXPENSE_EXCLUSIONS.some(kw => lower.includes(kw.toLowerCase()));
};

const isShadowDebtInstitution = (desc) => {
    const lower = (desc || '').toLowerCase();
    return SHADOW_DEBT_INSTITUTIONS.some(kw => lower.includes(kw.toLowerCase()));
};

const extractAmount = (text) => {
    if (!text) return 0;
    const matches = text.match(/[\d,]+/g);
    if (!matches) return 0;
    const amounts = matches.map(m => parseInt(m.replace(/,/g, ''))).filter(a => a > 300 && a < 200000);
    return amounts.length > 0 ? Math.min(...amounts) : 0;
};

export default {
  fetch: withSupabase({ auth: ["publishable"] }, async (req, ctx) => {
    try {
        // ── NO AUTH GATE (intentional) ──
        // This function is called from the public, anonymous Quick Check flow
        // (no logged-in user). The original Base44 version gated on
        // base44.auth.me() — which meant it always 401'd for anonymous callers
        // and was only ever invoked wrapped in a non-critical try/catch, so it
        // silently contributed nothing to production for exactly this flow.
        // withSupabase's publishable-key check already covers the intended
        // "callable by our own frontend" boundary, so this now actually runs
        // shadow-debt detection for these users instead of always failing.

        const payload = await req.json();
        const { normalizedData } = payload;

        if (!normalizedData) {
            return Response.json({ error: 'normalizedData is required' }, { status: 400 });
        }

        const forensicLog = [];
        const redFlags = [];
        let totalShadowDebt = 0;
        const shadowLoans = [];

        // ─────────────────────────────────────────────────────────
        // PHASE A: Calculate Declared Expenses (known commitments)
        // ─────────────────────────────────────────────────────────
        const declaredMortgage    = normalizedData.existing_mortgage?.monthly_payment || 0;
        const declaredLoans       = (normalizedData.loans || [])
            .filter(l => l.is_confirmed_loan !== false || !l.needs_clarification)
            .reduce((s, l) => s + (l.monthly_payment || 0), 0);
        const declaredCards       = (normalizedData.credit_cards || [])
            .reduce((s, c) => s + (c.monthly_payment || 0), 0);
        const declaredAlimony     = normalizedData.alimony_monthly || 0;
        const declaredRent        = normalizedData.rent_payment_monthly || 0;

        const totalDeclaredExpenses = declaredMortgage + declaredLoans + declaredCards + declaredAlimony + declaredRent;

        forensicLog.push({ step: 'DECLARED_EXPENSES', mortgage: declaredMortgage, loans: Math.round(declaredLoans), cards: Math.round(declaredCards), total: Math.round(totalDeclaredExpenses) });

        // ─────────────────────────────────────────────────────────
        // PHASE B: Calculate Recurring Outgoing (from bank statements)
        // Estimate from avg_debit in cash_flow_summary
        // ─────────────────────────────────────────────────────────
        const cashFlowSummary = normalizedData.cash_flow_summary || [];
        const totalAvgDebit = cashFlowSummary.reduce((s, acc) => s + (acc.avg_debit || 0), 0);
        const totalAvgCredit = cashFlowSummary.reduce((s, acc) => s + (acc.avg_credit || 0), 0);

        forensicLog.push({ step: 'BANK_FLOW', avg_debit: Math.round(totalAvgDebit), avg_credit: Math.round(totalAvgCredit) });

        // ─────────────────────────────────────────────────────────
        // PHASE C: Discrepancy Formula
        // ShadowDebt = RecurringOutgoing - DeclaredExpenses
        // Trigger if > 5% of net income
        // ─────────────────────────────────────────────────────────
        const netIncomeBorrower1 = (() => {
            const b1 = (normalizedData.borrowers || [])[0];
            if (b1?._normative_shoma_monthly) return b1._normative_shoma_monthly;
            if (b1?._sabbatical_income_override > 0) return b1._sabbatical_income_override;
            const payslips = (normalizedData.payslips_borrower1 || []).filter(p => !p._anomaly_flag && (p.net_salary || 0) > 0);
            if (payslips.length > 0) return Math.round(payslips.reduce((s, p) => s + p.net_salary, 0) / payslips.length);
            return 0;
        })();

        const netIncomeBorrower2 = (() => {
            const b2 = (normalizedData.borrowers || [])[1];
            if (!b2) return 0;
            if (b2?._normative_shoma_monthly) return b2._normative_shoma_monthly;
            if (b2?._sabbatical_income_override > 0) return b2._sabbatical_income_override;
            const payslips = (normalizedData.payslips_borrower2 || []).filter(p => !p._anomaly_flag && (p.net_salary || 0) > 0);
            if (payslips.length > 0) return Math.round(payslips.reduce((s, p) => s + p.net_salary, 0) / payslips.length);
            const bd = normalizedData.business_data;
            if (bd?.average_monthly_income) return bd.average_monthly_income;
            if (bd?.annual_income_year1) return Math.round(bd.annual_income_year1 / 12);
            return 0;
        })();

        const totalNetIncome = netIncomeBorrower1 + netIncomeBorrower2;

        // Discrepancy: only meaningful if we have bank flow data
        let discrepancy = 0;
        let discrepancyAlert = null;

        if (totalAvgDebit > 0 && totalDeclaredExpenses > 0) {
            discrepancy = Math.max(0, totalAvgDebit - totalDeclaredExpenses);
            const discrepancyRatio = totalNetIncome > 0 ? discrepancy / totalNetIncome : 0;

            forensicLog.push({ step: 'DISCREPANCY', discrepancy: Math.round(discrepancy), net_income: Math.round(totalNetIncome), ratio_pct: Math.round(discrepancyRatio * 100) });

            if (discrepancyRatio > 0.05 && discrepancy > 1500) {
                discrepancyAlert = {
                    severity: discrepancyRatio > 0.15 ? 'HIGH' : 'MEDIUM',
                    discrepancy_amount: Math.round(discrepancy),
                    discrepancy_ratio_pct: Math.round(discrepancyRatio * 100),
                    message: `חשד לחוב לא מדווח — פער של ₪${Math.round(discrepancy).toLocaleString()} בין הוצאות מוכרזות לחיובים בפועל (${Math.round(discrepancyRatio * 100)}% מהכנסה נטו). נדרשת הצהרת לווה.`
                };
                redFlags.push(discrepancyAlert.message);
                forensicLog.push({ step: 'DISCREPANCY_ALERT', ...discrepancyAlert });
            }
        }

        // ─────────────────────────────────────────────────────────
        // PHASE D: Shadow Debt Institution Scanner
        // Scan undisclosed_loan_indicators for non-bank-financial entities
        // ─────────────────────────────────────────────────────────
        const EXTRALEGAL_LENDERS = ['גמא', 'gamma', 'טריא', 'tria', 'מימון ישיר', 'blender', 'קרדיט גארד', 'פמילי קרדיט', 'family credit', 'לנדר'];

        (normalizedData.undisclosed_loan_indicators || []).forEach(ind => {
            const lower = ind.toLowerCase();
            if (isExcluded(lower)) return;

            const isExtralegal = EXTRALEGAL_LENDERS.some(kw => lower.includes(kw.toLowerCase()));
            const isFinancial = isShadowDebtInstitution(lower);
            const amount = extractAmount(ind);

            if (isExtralegal) {
                // Immediate RED flag — extralegal lender
                const flag = {
                    severity: 'HIGH',
                    type: 'EXTRALEGAL_LENDER',
                    description: ind,
                    monthly_estimate: amount || null,
                    message: `⚠️ גוף מימון חוץ-בנקאי זוהה: "${ind.substring(0, 80)}" — דגל אדום מיידי. נדרש בירור מיידי עם הלווה.`
                };
                redFlags.push(flag.message);
                if (amount > 0) totalShadowDebt += amount;
                shadowLoans.push({ source: 'EXTRALEGAL', description: ind.substring(0, 80), monthly_payment: amount, severity: 'HIGH' });
                forensicLog.push({ step: 'EXTRALEGAL_LENDER_DETECTED', indicator: ind.substring(0, 80), amount });

            } else if (isFinancial && amount > 500) {
                // Suspected shadow loan — already handled in normalizeDocData LIABILITY_CRAWLER
                // Only flag it if it's NOT already in loans[]
                const alreadyInLoans = (normalizedData.loans || []).some(l =>
                    Math.abs((l.monthly_payment || 0) - amount) < 300
                );
                if (!alreadyInLoans) {
                    shadowLoans.push({ source: 'UNDISCLOSED_INDICATOR', description: ind.substring(0, 80), monthly_payment: amount, severity: 'MEDIUM' });
                    totalShadowDebt += amount;
                    forensicLog.push({ step: 'SHADOW_LOAN_FROM_INDICATOR', indicator: ind.substring(0, 80), amount });
                }
            }
        });

        // ─────────────────────────────────────────────────────────
        // PHASE E: Family Transfer Detection
        // Recurring round-number transfers to same recipient = suspected family loan
        // ─────────────────────────────────────────────────────────
        const familyTransferAlerts = [];
        const incomeDeposits = normalizedData.income_deposits || [];

        // Group outgoing deposits by approximate amount (round numbers: multiples of 500)
        const outgoingByAmount = {};
        incomeDeposits.filter(d => !d.is_income && (d.average_monthly || 0) > 1000).forEach(d => {
            const amt = Math.round((d.average_monthly || 0) / 500) * 500; // round to nearest 500
            const desc = (d.description || '').toLowerCase();
            const isFamilyLike = FAMILY_TRANSFER_KEYWORDS.some(kw => desc.includes(kw.toLowerCase()));

            if (isFamilyLike && amt >= 1000) {
                if (!outgoingByAmount[amt]) outgoingByAmount[amt] = [];
                outgoingByAmount[amt].push(d);
            }
        });

        Object.entries(outgoingByAmount).forEach(([amt, transfers]) => {
            if (transfers.length >= 2) { // 2+ months = recurring
                const alert = {
                    amount_monthly: parseInt(amt),
                    frequency: transfers.length,
                    description: transfers[0].description,
                    message: `העברה קבועה של ₪${parseInt(amt).toLocaleString()}/חודש — עשויה להסתיר הלוואה פנים-משפחתית. נדרש בירור.`,
                    severity: 'MEDIUM'
                };
                familyTransferAlerts.push(alert);
                redFlags.push(alert.message);
                totalShadowDebt += parseInt(amt);
                forensicLog.push({ step: 'FAMILY_TRANSFER_SUSPECTED', amount: parseInt(amt), frequency: transfers.length });
            }
        });

        // ─────────────────────────────────────────────────────────
        // PHASE F: BDI Cross-Validation
        // If BDI shows lower payment than bank statement → flag discrepancy
        // ─────────────────────────────────────────────────────────
        const bdiFlags = normalizedData.bdi_red_flags || [];
        const bdiAmountMatch = bdiFlags.join(' ').match(/[\d,]{3,}/g);
        const bdiTotalMonthly = bdiAmountMatch
            ? bdiAmountMatch.map(m => parseInt(m.replace(/,/g, ''))).filter(a => a > 500 && a < 20000).reduce((s, a) => s + a, 0)
            : 0;

        let bdiDiscrepancyAlert = null;
        if (bdiTotalMonthly > 0 && totalAvgDebit > 0) {
            const bdiVsBankGap = totalAvgDebit - bdiTotalMonthly;
            if (bdiVsBankGap > 2000) {
                bdiDiscrepancyAlert = {
                    bdi_monthly: bdiTotalMonthly,
                    bank_monthly: Math.round(totalAvgDebit),
                    gap: Math.round(bdiVsBankGap),
                    message: `פער BDI vs עו"ש: BDI מדווח ₪${bdiTotalMonthly.toLocaleString()}/חודש, עו"ש מראה ₪${Math.round(totalAvgDebit).toLocaleString()}/חודש — פער ₪${Math.round(bdiVsBankGap).toLocaleString()}. תיק מסומן High Risk.`,
                    risk_level: 'HIGH'
                };
                redFlags.push(bdiDiscrepancyAlert.message);
                forensicLog.push({ step: 'BDI_DISCREPANCY', ...bdiDiscrepancyAlert });
            }
        }

        // ─────────────────────────────────────────────────────────
        // RESULT ASSEMBLY
        // ─────────────────────────────────────────────────────────
        const overallRisk = redFlags.length === 0 ? 'LOW'
            : (redFlags.some(f => f.includes('HIGH') || f.includes('מיידי') || f.includes('High Risk')) ? 'HIGH' : 'MEDIUM');

        const shadowDebtAnalysis = {
            total_shadow_debt_monthly: Math.round(totalShadowDebt),
            overall_risk: overallRisk,
            discrepancy_alert: discrepancyAlert,
            bdi_discrepancy_alert: bdiDiscrepancyAlert,
            shadow_loans: shadowLoans,
            family_transfer_alerts: familyTransferAlerts,
            red_flags: redFlags,
            declared_expenses_monthly: Math.round(totalDeclaredExpenses),
            detected_outgoing_monthly: Math.round(totalAvgDebit),
            net_income_estimated: Math.round(totalNetIncome),
            forensic_log: forensicLog,
            analyzed_at: new Date().toISOString()
        };

        console.log(`shadowDebtEngine: risk=${overallRisk}, shadow_debt=₪${Math.round(totalShadowDebt)}, red_flags=${redFlags.length}`);

        // Return the full normalizedData ENRICHED with shadow debt analysis
        return Response.json({
            ...normalizedData,
            _shadow_debt: shadowDebtAnalysis
        });

    } catch (error) {
        console.error('shadowDebtEngine error:', error);
        // CIRCUIT BREAKER: never crash the pipeline — return data as-is with error flag
        const payload = await req.json().catch(() => ({}));
        return Response.json({
            ...(payload.normalizedData || {}),
            _shadow_debt: {
                error: error.message,
                overall_risk: 'UNKNOWN',
                red_flags: [],
                total_shadow_debt_monthly: 0,
                _engine_failed: true
            }
        });
    }
  }),
};
