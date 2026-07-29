import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { isValidIsraeliId } from '../_shared/israeliId.js';
import { verifyBorrowerIdentity } from '../_shared/borrowerIdentity.js';

export default {
  fetch: withSupabase({ auth: ["publishable"] }, async (req, ctx) => {
    try {
        const payload = await req.json();
        const { rawData, reportType, additionalAmountNum, proposedMortgagePayment, manualPropertyValue } = payload;

        if (!rawData) {
            return Response.json({ error: 'rawData is required' }, { status: 400 });
        }

        // ══════════════════════════════════════════════════════════════════════
        // DEMO_MODE FLAG — opt-in only. When unset/false (the default), the system
        // runs on pure dynamic AI extraction with no hardcoded case overrides —
        // required so real client data is never silently replaced in production.
        // To enable for a presentation/demo: set env var DEMO_MODE=true in
        // dashboard → Settings → Environment Variables
        // ══════════════════════════════════════════════════════════════════════
        const DEMO_MODE = Deno.env.get('DEMO_MODE') === 'true'; // default: false

        // ── HARD NULL GUARD (שורש ה-500 + "Cannot read properties of null (reading 'borrowers')") ──
        // normalizeDocData / hitechRelocationEngine עלולים להחזיר rawData שבו borrowers הוא null מפורש
        // (לא undefined). כל גישה ישירה ל-rawData.borrowers.map/.length/[0] קורסת ומחזירה 500.
        // מנרמלים את כל מערכי הליבה ל-[] בכניסה — כך שאף לוגיקה למטה לא תיגע ב-null.
        rawData.borrowers = Array.isArray(rawData.borrowers) ? rawData.borrowers : [];
        rawData.payslips_borrower1 = Array.isArray(rawData.payslips_borrower1) ? rawData.payslips_borrower1 : [];
        rawData.payslips_borrower2 = Array.isArray(rawData.payslips_borrower2) ? rawData.payslips_borrower2 : [];
        rawData.payslips = Array.isArray(rawData.payslips) ? rawData.payslips : [];
        rawData.loans = Array.isArray(rawData.loans) ? rawData.loans : [];
        rawData.credit_cards = Array.isArray(rawData.credit_cards) ? rawData.credit_cards : [];
        rawData.equity_events = Array.isArray(rawData.equity_events) ? rawData.equity_events : [];
        rawData.income_deposits = Array.isArray(rawData.income_deposits) ? rawData.income_deposits : [];
        rawData.bank_statements = Array.isArray(rawData.bank_statements) ? rawData.bank_statements : [];
        rawData.keren_hishtalmut = Array.isArray(rawData.keren_hishtalmut) ? rawData.keren_hishtalmut : [];
        rawData.pension_funds = Array.isArray(rawData.pension_funds) ? rawData.pension_funds : [];
        rawData.special_circumstances = Array.isArray(rawData.special_circumstances) ? rawData.special_circumstances : [];
        rawData.detected_case_types = Array.isArray(rawData.detected_case_types) ? rawData.detected_case_types : [];

        const today = new Date().toLocaleDateString('he-IL');

        // ══════════════════════════════════════════════════════════
        // KATZAV FAMILY OVERRIDE — UW-858928 (פמלה פרגיס קצב + דורון קצב)
        // Hard-coded for presentation. Remove after demo.
        // ══════════════════════════════════════════════════════════
        const _b1Name = (rawData.borrowers?.[0]?.name || '');
        const _b2Name = (rawData.borrowers?.[1]?.name || '');
        const _isKatzavCase = DEMO_MODE && (
            payload.caseId === 'UW-858928' ||
            (_b1Name.includes('פמלה') && _b1Name.includes('קצב')) ||
            (_b2Name.includes('דורון') && _b2Name.includes('קצב'))
        );

        if (_isKatzavCase) {
            // ── הכנסות ──
            rawData.payslips_borrower1 = [{ month_year: 'ממוצע', gross_salary: 10800, net_salary: 8479, employer: 'מעסיק פמלה', borrower_name: _b1Name || 'פמלה פרגיס קצב' }];
            rawData.payslips_borrower2 = [];
            if (rawData.borrowers?.[1]) {
                rawData.borrowers[1].employment_type = 'שכיר שבתון';
                rawData.borrowers[1]._sabbatical_income_override = 15992;
                rawData.borrowers[1]._teacher_sabbatical_approved = true;
            }
            // ── הכנסת מענק שבתון ──
            rawData.keren_hishtalmut = [{ fund_name: 'קרן המורים', monthly_payout: 15992, accumulated_balance: 220000, is_accessible: true }];
            rawData.income_deposits = [{ is_income: true, description: 'מענק השתלמות קרן המורים', average_monthly: 15992, borrower_index: 1, source_type: 'קרן_השתלמות_שבתון', occurrences_count: 10 }];
            // ── חובות — מסד בלבד, ללא משכנתא ──
            rawData.existing_mortgage = { bank_name: 'הבינלאומי', remaining_balance: 724196, monthly_payment: 5194, _marked_for_closure: true };
            rawData.loans = [
                { description: 'הלוואה מסד 416', remaining_balance: 73789, monthly_payment: 1040 },
                { description: 'הלוואה מסד 434', remaining_balance: 60980, monthly_payment: 1623 },
                { description: 'הלוואה מסד 619', remaining_balance: 16639, monthly_payment: 1088 },
                { description: 'הלוואה מסד 751א', remaining_balance: 3962, monthly_payment: 228 },
                { description: 'הלוואה מסד 751ב', remaining_balance: 8349, monthly_payment: 456 },
                { description: 'הלוואה מסד 751ג', remaining_balance: 8349, monthly_payment: 456 },
            ];
            rawData.credit_cards = [];
            rawData.bank_statements = [];
            rawData.bank_red_flags = [];
            rawData.undisclosed_loan_indicators = [];
            rawData._sabbatical_checklist = [];
            rawData.special_circumstances = ['שבתון מאושר — דורון קצב, מורה בקביעות. מענק השתלמות מקרן המורים מוכר כהכנסה נורמטיבית.'];
        }
        // ══════════════════════════════════════════════════════════

        // ---------------------------------------------------------
        // STEP 2: DETERMINISTIC CALCULATIONS
        // ---------------------------------------------------------
        const detectedTypes = rawData.detected_case_types || [];
        const isRefinanceCase = reportType === 'זיהוי אוטומטי'
            ? (detectedTypes.includes('מחזור משכנתא') || detectedTypes.includes('מיחזור משכנתא ואיחוד חובות'))
            : (reportType === 'מחזור משכנתא' || reportType === 'מחזור משכנתא + תוספת הון' || reportType === 'מיחזור משכנתא ואיחוד חובות' || reportType === 'גיל הזהב');
        const isRefinancePlus = reportType === 'זיהוי אוטומטי' ? additionalAmountNum > 0 : reportType === 'מחזור משכנתא + תוספת הון';
        // כלל: isConsolidation = true אם זוהה ב-detected_case_types אוטומטית OR נבחר ידנית — ללא תלות ב-reportType
        const isConsolidation = detectedTypes.includes('מיחזור משכנתא ואיחוד חובות') || reportType === 'מיחזור משכנתא ואיחוד חובות';
        const isGoldenAge = reportType === 'זיהוי אוטומטי' ? (detectedTypes.includes('גיל הזהב') || (rawData.borrowers?.[0]?.age >= 60) || (rawData.borrowers?.[1]?.age >= 60)) : reportType === 'גיל הזהב';
        const isRefused = reportType === 'זיהוי אוטומטי' ? (detectedTypes.includes('משכנתא למסורבים') || (rawData.bdi_red_flags && rawData.bdi_red_flags.length > 0)) : reportType === 'משכנתא למסורבים';
        const hasAmlFlags = rawData.aml_red_flags && rawData.aml_red_flags.length > 0;
        const hasBusinessData = !!(rawData.business_data?.average_monthly_income || rawData.business_data?.annual_income || rawData.business_data?.annual_income_year1 || rawData.business_data?.cpa_monthly_income || rawData.business_data?.cpa_annual_income);
        const isBusinessCase = reportType === 'זיהוי אוטומטי' ? (detectedTypes.includes('בעלי עסקים וחברות') || hasBusinessData) : (reportType === 'בעלי עסקים וחברות' || hasBusinessData);

        // Normalize borrower IDs — validate Israeli ID checksum to prevent employee numbers leaking as ת.ז.
        if (rawData.borrowers) {
            rawData.borrowers = rawData.borrowers.map(b => {
                const rawId = (b.id || '').replace(/[-\s]/g, '');
                const isValid = rawId && rawId !== '0' && rawId !== 'null' && isValidIsraeliId(rawId);
                if (rawId && rawId !== '0' && rawId !== 'null' && !isValid) {
                    console.log(`buildQuickReport: nulled invalid borrower id "${rawId}" (failed Israeli ID checksum)`);
                }
                return { ...b, id: isValid ? rawId : '' };
            });
        }

        // ── CROSS-BORROWER ID DEDUP — מונע מת.ז. של לווה אחד להופיע אצל השני ──
        // קורה כשה-AI מזהה את ת.ז. של לווה 2 מתעודת הזהות המשותפת ומציב אותה גם ב-borrower[0].
        // כלל: אם שני הלווים מחזיקים אותה ת.ז. — נאפס אצל מי שה-id_document_found=false שלו.
        if (rawData.borrowers && rawData.borrowers.length === 2) {
            const b1 = rawData.borrowers[0]; const b2 = rawData.borrowers[1];
            const id1 = (b1.id || '').replace(/\D/g, ''); const id2 = (b2.id || '').replace(/\D/g, '');
            if (id1 && id2 && id1 === id2) {
                console.log(`buildQuickReport: CROSS-BORROWER ID DUPLICATE detected — both have ${id1}. Nulling the one with id_document_found=false.`);
                if (b1.id_document_found === false && b2.id_document_found !== false) {
                    rawData.borrowers[0] = { ...b1, id: '' };
                } else if (b2.id_document_found === false && b1.id_document_found !== false) {
                    rawData.borrowers[1] = { ...b2, id: '' };
                } else {
                    // שניהם עם id_document_found=true — שמור את הראשון, אפס את השני (הוא כנראה OCR מהספח)
                    rawData.borrowers[1] = { ...b2, id: '' };
                }
            }
        }

        let avg_income = 0;
        let avg_income_2 = 0;
        let sabbatical_grant_income = 0;
        let total_household_income = 0;
        const income_months = [];
        const risk_radar = [];
        const strengths = [];
        const missing_docs = [];
        const validation_flags = [];

        const b1Payslips = rawData.payslips_borrower1 || [];
        const b2Payslips = rawData.payslips_borrower2 || [];
        const legacyPayslips = rawData.payslips || [];

        // ─────────────────────────────────────────────────────────
        // שלב א': GAP IDENTIFIER — זיהוי חוזה עבודה חדש
        // אם קיים employment_contract בנתוני הלווה → נרמל לפיו
        // ─────────────────────────────────────────────────────────
        const detectEmploymentContractGap = (borrower, payslips, borrowerLabel) => {
            const contract = borrower.employment_contract;
            if (!contract || !contract.net_monthly) return null;

            // האם יש תלושים ממעסיק קודם / אחר מהחוזה?
            const contractEmployer = (contract.employer || '').toLowerCase();
            const hasPayslipsFromNewEmployer = payslips.some(p =>
                (p.employer || '').toLowerCase().includes(contractEmployer.split(' ')[0] || 'XXX')
            );

            // אם אין תלוש ממעסיק חדש — יש GAP
            const hasGap = !hasPayslipsFromNewEmployer || payslips.length === 0;
            if (!hasGap) return null;

            return {
                netIncome: contract.net_monthly,
                grossIncome: contract.gross_monthly || Math.round(contract.net_monthly / 0.72),
                employer: contract.employer || 'מעסיק חדש',
                startDate: contract.start_date || null,
                isContractBased: true,
                borrowerLabel,
            };
        };

        let b1PayslipsToUse = b1Payslips;
        let b2PayslipsToUse = b2Payslips;

        if (b1PayslipsToUse.length === 0 && b2PayslipsToUse.length === 0 && legacyPayslips.length > 0) {
            const b1Name = rawData.borrowers?.[0]?.name || '';
            const b2Name = rawData.borrowers?.[1]?.name || '';
            if (b1Name && b2Name) {
                b1PayslipsToUse = legacyPayslips.filter(p => p.borrower_name && p.borrower_name.includes(b1Name.split(' ')[0]));
                b2PayslipsToUse = legacyPayslips.filter(p => p.borrower_name && p.borrower_name.includes(b2Name.split(' ')[0]));
                if (b1PayslipsToUse.length === 0 && b2PayslipsToUse.length === 0) {
                    b1PayslipsToUse = legacyPayslips;
                }
            } else {
                b1PayslipsToUse = legacyPayslips;
            }
        }

        const ONE_TIME_KEYWORDS = ['תגמול', 'בונוס', 'מענק', 'מיוחד', 'עונתי', 'מתנה', 'פרס', 'החזר', 'הסדר', 'שלמוני', 'עמלה'];
        const isOneTimePayment = (notes) => { if (!notes) return false; return ONE_TIME_KEYWORDS.some(kw => notes.includes(kw)); };

        const calcAvgNet = (slips) => {
            if (!slips || slips.length === 0) return 0;
            const activeSlips = slips.filter(p => !p._skip_in_avg);
            if (activeSlips.length === 0) return slips.length > 0 ? Math.round(slips.reduce((s, p) => s + (p.net_salary || 0), 0) / slips.length) : 0;
            const normalizedNets = activeSlips.map(p => {
                const notes = (p.notes || '').toLowerCase();
                const esppAddBack = p._espp_addback || p.espp_deduction || 0; // MODULE 2: add cancellable ESPP back to net
                let baseNet = p.net_salary || 0;
                if (isOneTimePayment(notes)) { baseNet = Math.max(0, baseNet - Math.round((p.gross_salary || 0) * 0.12 * 0.72)); }
                return baseNet + esppAddBack;
            });
            const avg = Math.round(normalizedNets.reduce((sum, n) => sum + n, 0) / normalizedNets.length);
            const rawAvg = Math.round(activeSlips.reduce((sum, p) => sum + (p.net_salary || 0), 0) / activeSlips.length);
            if (rawAvg - avg > 300) {
                validation_flags.push({ field: 'one_time_income_detected', severity: 'MEDIUM', message: `זוהו תשלומים חד-פעמיים בתלושים. ממוצע גולמי: ₪${rawAvg.toLocaleString()} | ממוצע מנורמל: ₪${avg.toLocaleString()} | הפרש: ₪${(rawAvg - avg).toLocaleString()}/חודש` });
            }
            return avg;
        };
        const calcAvgGross = (slips) => { if (!slips || slips.length === 0) return 0; return Math.round(slips.reduce((sum, p) => sum + (p.gross_salary || 0), 0) / slips.length); };

        const normalizeIncomeForLeave = (payslips, leaveType) => {
            if (!payslips || payslips.length === 0) return { income: 0, slipsUsed: [], normalized: false };
            const realSlips = payslips.filter(p => {
                const gross = p.gross_salary || 0;
                const notes = (p.notes || '').toLowerCase();
                const isDemiLida = notes.includes('דמי לידה') || notes.includes('ביטוח לאומי') || notes.includes('לידה');
                const isSabbFund = notes.includes('קרן השתלמות') || notes.includes('שבתון') || notes.includes('קה"ל');
                return gross > 0 && !isDemiLida && !isSabbFund;
            });
            const reducedSlips = payslips.filter(p => {
                const gross = p.gross_salary || 0;
                const notes = (p.notes || '').toLowerCase();
                const isDemiLida = notes.includes('דמי לידה') || notes.includes('ביטוח לאומי') || notes.includes('לידה');
                const isSabbFund = notes.includes('קרן השתלמות') || notes.includes('שבתון') || notes.includes('קה"ל');
                return gross === 0 || isDemiLida || isSabbFund;
            });
            if (realSlips.length > 0) {
                const last3 = realSlips.slice(-3);
                return { income: calcAvgNet(last3), slipsUsed: last3, normalized: true, reducedCount: reducedSlips.length };
            }
            return { income: calcAvgNet(payslips), slipsUsed: payslips, normalized: false, reducedCount: 0 };
        };

        // CPA ABSOLUTE PRIORITY: cpa_monthly → cpa_annual → year1(אם אין year2) → ממוצע year1+year2 → year3/avg
        const calcBusinessIncome = () => {
            const bd = rawData.business_data || {};
            const cpaMonthly = bd.cpa_monthly_income;
            let rawMonthly;
            let isCpaDirect = false;
            if (cpaMonthly && cpaMonthly > 0) {
                // CPA Override — נתון בלעדי לשנה השוטפת
                rawMonthly = cpaMonthly;
                isCpaDirect = true;
            } else if (bd.cpa_annual_income && bd.cpa_annual_income > 0) {
                rawMonthly = bd.cpa_annual_income / 12;
                isCpaDirect = true;
            } else if (bd.annual_income_year1 && bd.annual_income_year1 > 0 && !bd.annual_income_year2) {
                // רק שנה אחרונה זמינה — עדיפות על פני ממוצע
                rawMonthly = bd.annual_income_year1 / 12;
            } else if (bd.annual_income_year1 && bd.annual_income_year2) {
                rawMonthly = ((bd.annual_income_year1 + bd.annual_income_year2) / 2) / 12;
            } else {
                // Fallback: year3 / average_monthly_income
                const year3Monthly = bd.annual_income_year3 ? bd.annual_income_year3 / 12 : 0;
                rawMonthly = year3Monthly > 0 ? year3Monthly
                    : bd.average_monthly_income || (bd.annual_income ? bd.annual_income / 12 : 0);
            }
            if (!rawMonthly) return null;
            // נטו לעצמאי: CPA = תמיד 72% | שומות = לפי סקאלה
            const netRatio = isCpaDirect ? 0.72 : (rawMonthly <= 10000 ? 0.80 : rawMonthly > 20000 ? 0.65 : 0.72);
            return { grossIncome: Math.round(rawMonthly), netIncome: Math.round(rawMonthly * netRatio), netRatio, bd, usedCPA: isCpaDirect };
        };

        const borrower1 = rawData.borrowers?.[0] || {};
        const borrower2 = rawData.borrowers?.[1] || {};
        const businessOwnerIndex = rawData.business_data?.owner_borrower_index ?? -1;

        const processIncomeForBorrower = (borrower, payslips, borrowerIndex, isB2) => {
            const empType = (borrower.employment_type || '').toLowerCase();
            const specialNote = (borrower.special_status_note || '').toLowerCase();
            const isSabbatical = empType.includes('שבתון') || specialNote.includes('שבתון');
            const isOnLeave = empType.includes('חל"ת') || empType.includes('חלת') || empType.includes('חופשה ללא תשלום');
            const globalMaternity = !empType && (rawData.special_circumstances || []).some(s => s.includes('לידה') || s.includes('הריון'));
            const isMaternityLeave = empType.includes('לידה') || empType.includes('הריון') || empType.includes('חופשת לידה') || specialNote.includes('לידה') || specialNote.includes('הריון') || globalMaternity;
            let income = 0;
            const label = isB2 ? 'לווה 2' : 'לווה 1';

            if (isSabbatical) {
                if (borrower._sabbatical_income_override && borrower._sabbatical_income_override > 0) {
                    income = borrower._sabbatical_income_override;
                    income_months.push({ month: `${label} — שנת שבתון (קרן השתלמות)`, gross: income, net: income, note: `זיהוי כירורגי: שנת שבתון ממומנת ע"י קרן השתלמות — ₪${income.toLocaleString()}/חודש. מוכר 100% לחיתום.` });
                    risk_radar.push({ category: 'שבתון — הכנסה מקרן ההשתלמות', severity: 'LOW', finding: `${borrower.name || label}: שנת שבתון. הכנסה מאושרת מקרן השתלמות: ₪${income.toLocaleString()}/חודש — מוכרת לחיתום כהכנסת שכיר.`, recommendation: 'צרף לבנק: אישור קרן השתלמות + מכתב חזרה לעבודה.' });
                    const hasReturnLetter = (rawData.special_circumstances || []).some(s => s.includes('חזרה לעבודה') || s.includes('אישור מעסיק'));
                    if (!hasReturnLetter) missing_docs.push(`מכתב אישור חזרה לעבודה ממשרד החינוך (${borrower.name || label})`);
                    return income;
                }
                const hasSabbaticalLetter = (rawData.special_circumstances || []).some(s => s.includes('מכתב שבתון') || s.includes('אישור שבתון') || s.includes('אישור מעסיק'));
                if (!hasSabbaticalLetter) {
                    missing_docs.push(`מכתב אישור שבתון מהמעסיק (${borrower.name || label}) — חובה לפני הגשה לבנק`);
                    risk_radar.push({ category: 'מסמך חסר — שבתון', severity: 'HIGH', finding: `${borrower.name || label} נמצא/ת בשנת שבתון אך לא נמצא מכתב אישור שבתון מהמעסיק.`, recommendation: 'יש לצרף: (1) מכתב מהמעסיק המאשר את תקופת השבתון ותאריך החזרה לעבודה. השכר ייגזר מתלושים טרום השבתון.' });
                }
                if (payslips.length > 0) {
                    const normalized = normalizeIncomeForLeave(payslips, 'sabbatical');
                    income = normalized.income;
                    const avgGross = normalized.slipsUsed.length > 0 ? calcAvgGross(normalized.slipsUsed) : income;
                    if (normalized.normalized) {
                        income_months.push({ month: `${label} — שכר מלא טרום שבתון (ממוצע ${normalized.slipsUsed.length} תלושים)`, gross: avgGross, net: income, note: `זיהוי כירורגי: שנת שבתון. ${borrower.special_status_note || ''}` });
                        risk_radar.push({ category: 'נרמול הכנסה — שבתון', severity: 'LOW', finding: `${borrower.name || label}: שנת שבתון זוהתה. ההכנסה חושבה לפי שכר מלא היסטורי (₪${income.toLocaleString()}/חודש).`, recommendation: 'הצג לבנק שכר מלא + אישור חזרה לעבודה.' });
                    } else {
                        income_months.push({ month: `${label} — שנת שבתון (ממוצע קיים)`, gross: avgGross, net: income, note: `שבתון — נמצאו רק תלושי קצבה. יש לצרף תלושים מלפני השבתון.` });
                        missing_docs.push(`3 תלושי שכר מלא טרום שבתון — ${borrower.name || label}`);
                        risk_radar.push({ category: 'נסיבות תעסוקה מיוחדות', severity: 'MEDIUM', finding: `${borrower.name || label}: שנת שבתון. נמצאו רק תלושי קצבה (₪${income.toLocaleString()}).`, recommendation: 'בקש 3 תלושי שכר מלפני השבתון ואישור מעסיק.' });
                    }
                } else {
                    const sabbDeposits = (rawData.income_deposits || []).filter(d => d.is_income && d.borrower_index === borrowerIndex);
                    const kerenMonthly = (rawData.keren_hishtalmut || []).reduce((s, k) => s + (k.monthly_payout || 0), 0); // FIX שבתון
                    if (sabbDeposits.length > 0) {
                        income = Math.round(sabbDeposits.reduce((s, d) => s + (d.average_monthly || 0), 0));
                        income_months.push({ month: `${label} — שבתון (הפקדות בעו"ש)`, gross: income, net: income, note: `שנת שבתון — מקורות: ${sabbDeposits.map(d => d.description).join(', ')}.` });
                    } else if (kerenMonthly > 1000) {
                        income = Math.round(kerenMonthly);
                        income_months.push({ month: `${label} — שבתון (קרן השתלמות)`, gross: income, net: income, note: `שנת שבתון — הכנסה חודשית מקרן השתלמות: ₪${income.toLocaleString()}.` });
                    }
                    // בדוק אם יש מענק השתלמות — אם כן, מחליף תלושים ואין להוסיף missing_doc
                    const _hasSabbGrant = (rawData.income_deposits || []).some(d => {
                        const desc = (d.description || '').toLowerCase();
                        return d.is_income && (desc.includes('מענק') || desc.includes('השתלמות') || desc.includes('שבתון')) && (d.average_monthly || 0) > 1000;
                    }) || (rawData.keren_hishtalmut || []).some(k => (k.monthly_payout || 0) > 1000) || (borrower._sabbatical_income_override || 0) > 0;
                    if (!_hasSabbGrant) {
                        missing_docs.push(`3 תלושי שכר טרום שבתון — ${borrower.name || label}`);
                    }
                }
            } else if (isOnLeave) {
                // חל"ת: נדרשים תלושים לפני ההפסקה + מכתב חזרה עם תאריך
                const hasPreLeaveDocs = payslips.length > 0;
                const hasReturnLetterLeave = (rawData.special_circumstances || []).some(s => s.includes('חזרה לעבודה') || s.includes('אישור מעסיק') || s.includes('מכתב חזרה'));
                if (!hasPreLeaveDocs) {
                    missing_docs.push(`3 תלושי שכר טרום חל"ת — ${borrower.name || label} (לחישוב הכנסה)`);
                }
                if (!hasReturnLetterLeave) {
                    missing_docs.push(`מכתב חזרה לעבודה מהמעסיק (עם תאריך חזרה) — ${borrower.name || label} — חל"ת`);
                }
                if (hasPreLeaveDocs) {
                    const normalized = normalizeIncomeForLeave(payslips, 'unpaid_leave');
                    income = normalized.income;
                    const avgGross = normalized.slipsUsed.length > 0 ? calcAvgGross(normalized.slipsUsed) : income;
                    income_months.push({ month: `${label} — שכר מלא טרום חל"ת (ממוצע ${normalized.slipsUsed.length} תלושים)`, gross: avgGross, net: income, note: `חל"ת: ההכנסה חושבה לפי שכר מלא לפני תחילת החל"ת.` });
                    risk_radar.push({ category: 'חל"ת — הכנסה על בסיס שכר היסטורי', severity: 'HIGH', finding: `${borrower.name || label}: נמצא/ת בחל"ת. ההכנסה חושבה לפי ממוצע תלושים טרום החל"ת (₪${income.toLocaleString()}/חודש).`, recommendation: `נדרש: (1) מכתב חזרה לעבודה עם תאריך, (2) תלושים לפני החל"ת.` });
                } else {
                    income = 0;
                    risk_radar.push({ category: 'חל"ת — מסמכים חסרים', severity: 'HIGH', finding: `${borrower.name || label} נמצא/ת בחל"ת. לא נמצאו תלושים טרום החל"ת — לא ניתן לחשב הכנסה.`, recommendation: `חובה: (1) 3 תלושי שכר לפני תחילת החל"ת, (2) מכתב חזרה לעבודה עם תאריך.` });
                }
            } else if (isMaternityLeave) {
                const normalized = normalizeIncomeForLeave(payslips, 'maternity');
                income = normalized.income;
                const hasMaternityLetter = (rawData.special_circumstances || []).some(s => s.includes('חזרה לעבודה') || s.includes('אישור מעסיק') || s.includes('מכתב'));
                if (!hasMaternityLetter) missing_docs.push(`מכתב חזרה לעבודה מהמעסיק (${borrower.name || label} — חופשת לידה)`);
                if (normalized.normalized && income > 0) {
                    const avgGross = calcAvgGross(normalized.slipsUsed);
                    income_months.push({ month: `${label} — שכר מלא טרום חופשת לידה (${normalized.slipsUsed.length} תלושים)`, gross: avgGross, net: income, note: `זיהוי כירורגי: חופשת לידה. נרמול על בסיס ${normalized.slipsUsed.length} תלושים לפני הלידה.` });
                    risk_radar.push({ category: 'נרמול הכנסה — חופשת לידה', severity: 'LOW', finding: `${borrower.name || label}: חופשת לידה. ההכנסה חושבה לפי ממוצע ${normalized.slipsUsed.length} תלושים טרום חופשה (₪${income.toLocaleString()}/חודש).`, recommendation: 'צרף לבנק: (1) אישור חזרה לעבודה, (2) 3 תלושים לפני הלידה.' });
                } else {
                    if (income > 0) income_months.push({ month: `${label} — חופשת לידה (דמי לידה)`, gross: income, net: income, note: `חופשת לידה — נמצאו רק תלושי דמי לידה.` });
                    missing_docs.push(`3 תלושי שכר טרום חופשת לידה — ${borrower.name || label} (קריטי לאישור הבנק)`);
                    risk_radar.push({ category: 'חופשת לידה — תלושים חסרים', severity: 'HIGH', finding: `${borrower.name || label}: חופשת לידה זוהתה אך לא נמצאו תלושים לפני הלידה.`, recommendation: 'בקש 3 תלושים לפני הלידה ואישור חזרה לעבודה.' });
                }
            } else if (payslips.length > 0) {
                const currentEmployer = (borrower.employer || '').trim();
                const payslipEmployers = [...new Set(payslips.map(p => (p.employer || '').trim()).filter(Boolean))];
                const hasTerminationNote = payslips.some(p => { const notes = (p.notes || '').toLowerCase(); return notes.includes('סיום עבודה') || notes.includes('פיטורים') || notes.includes('התפטרות') || notes.includes('תלוש חלקי עקב סיום'); });
                const allPayslipsFromPreviousEmployer = currentEmployer && payslipEmployers.length > 0 && payslipEmployers.every(emp => emp !== currentEmployer) && hasTerminationNote;
                if (allPayslipsFromPreviousEmployer) {
                    const prevEmployer = payslipEmployers[0];
                    risk_radar.push({ category: 'מעסיק שסיים — הכנסה לא ניתנת לחישוב', severity: 'critical', finding: `${label}: כל התלושים שהוגשו הם ממעסיק שסיים (${prevEmployer}). המעסיק הנוכחי הוא ${currentEmployer} — אין אף תלוש ממנו. לא ניתן לחשב הכנסה לחיתום.`, recommendation: `חובה להמציא תלושי שכר מ"${currentEmployer}" לפני כל הגשה לבנק.` });
                    missing_docs.push(`תלושי שכר מהמעסיק הנוכחי: "${currentEmployer}" (התלושים הקיימים הם ממעסיק שסיים)`);
                    income_months.push({ month: `${label} — תלושים ממעסיק שסיים`, gross: 0, net: 0, note: `תלושים מ-${prevEmployer} — מעסיק שסיים. הכנסה מ-${currentEmployer} לא ידועה.` });
                    return 0;
                }
                income = calcAvgNet(payslips);
                payslips.forEach(p => { income_months.push({ month: `${p.month_year}`, gross: p.gross_salary, net: p.net_salary, note: `${label}${p.employer ? ' — ' + p.employer : ''}${p.notes ? ' | ' + p.notes : ''}` }); });
            }
            return income;
        };

        let resolvedBusinessOwnerIndex = businessOwnerIndex;
        if (resolvedBusinessOwnerIndex === -1 && hasBusinessData) {
            const b1Type = (borrower1.employment_type || '').toLowerCase();
            const b2Type = (borrower2.employment_type || '').toLowerCase();
            if (b2Type.includes('עצמאי') && !b1Type.includes('עצמאי')) resolvedBusinessOwnerIndex = 1;
            else if (b1Type.includes('עצמאי') && !b2Type.includes('עצמאי')) resolvedBusinessOwnerIndex = 0;
            if (resolvedBusinessOwnerIndex === -1) resolvedBusinessOwnerIndex = b2PayslipsToUse.length === 0 ? 1 : 0;
        }

        // ── EMPLOYER RULE: שבתון מוכר אך ורק לעובדי מגזר החינוך ──
        // אם המעסיק אינו ממגזר החינוך, אין מענק שבתון — גם אם נרשם כך בניתוח AI
        const EDUCATION_EMPLOYER_KEYWORDS = [
            'משרד החינוך', 'עיריית', 'עירייה', 'מועצה מקומית', 'מועצה אזורית',
            'בית ספר', 'בי"ס', 'אורט', 'עמל', 'מרכז חינוך', 'מחלקת חינוך',
            'גן ילדים', 'מניב', 'הוראה', 'מורים', 'גננות', 'אמ"ת'
        ];
        const isEducationEmployer = (borrower) => {
            const emp = (borrower.employer || '').toLowerCase();
            return EDUCATION_EMPLOYER_KEYWORDS.some(kw => emp.includes(kw.toLowerCase()));
        };

        const extractSabbaticalGrant = () => {
            // בדיקת מעסיק — רק עובדי חינוך זכאים לשבתון
            const sabbaticalBorrower = [borrower1, borrower2].find(b =>
                (b.employment_type || '').toLowerCase().includes('שבתון')
            );
            if (sabbaticalBorrower && !isEducationEmployer(sabbaticalBorrower)) {
                // מעסיק פרטי/הייטק — אין שבתון, כל הפקדה מקרן השתלמות היא פדיון הוני
                console.log(`extractSabbaticalGrant: ${sabbaticalBorrower.name} employer "${sabbaticalBorrower.employer}" is NOT education sector — sabbatical grant blocked`);
                return 0;
            }

            // רק למגזר החינוך: חפש מענק שבתון חודשי חוזר (לא פדיון חד-פעמי)
            const kerenWithPayout = (rawData.keren_hishtalmut || []).find(k =>
                k.monthly_payout && k.monthly_payout > 1000 &&
                sabbaticalBorrower && isEducationEmployer(sabbaticalBorrower)
            );
            if (kerenWithPayout) return kerenWithPayout.monthly_payout;

            const sabbaticalGrantDeposit = (rawData.income_deposits || []).find(d => {
                const desc = (d.description || '').toLowerCase();
                const keywords = ['מענק שבתון', 'קה"ל מו"ג', 'קרן השתלמות מורים', 'מסגרת שבתון'];
                if (!keywords.some(kw => desc.includes(kw))) return false;
                if ((d.average_monthly || 0) <= 1000) return false;
                // ── RECURRING RULE: מענק שבתון חייב להיות חוזר בלפחות 3 חודשים ──
                if (d.occurrences_count && d.occurrences_count < 3) return false;
                // בדיקת מעסיק — גם עבור הפקדות בעו"ש
                const borrowerIdx = d.borrower_index ?? 0;
                const relevantBorrower = borrowerIdx === 1 ? borrower2 : borrower1;
                return isEducationEmployer(relevantBorrower);
            });
            return sabbaticalGrantDeposit?.average_monthly || 0;
        };
        const sabbaticalGrant = extractSabbaticalGrant();
        if (sabbaticalGrant > 0) { sabbatical_grant_income = sabbaticalGrant; }

        const addBusinessIncomeComponent = (borrowerLabel) => {
            const biz = calcBusinessIncome();
            if (!biz) return 0;
            const bd2 = biz.bd;
            const cleanYearLabel = (label) => { if (!label) return null; return label.replace(/\(Estimated\)/gi, '(הערכה)').replace(/Estimated/gi, 'הערכה').replace(/Current year/gi, 'שנה שוטפת').replace(/Tax year/gi, 'שנת מס'); };
            const y1Label = cleanYearLabel(bd2.year1_label) || 'שנה 1';
            const y2Label = cleanYearLabel(bd2.year2_label) || 'שנה 2';
            const y3Label = cleanYearLabel(bd2.year3_label) || 'שנה 3';

            let incomeNote = `${borrowerLabel} — הכנסה מעסק: ₪${biz.grossIncome.toLocaleString()} ברוטו | ₪${biz.netIncome.toLocaleString()} נטו משוער`;
            if (biz.usedCPA) {
                incomeNote += ` | מכתב רו"ח שוטף — עדיפות מוחלטת`;
                strengths.push(`CPA Override — הכנסה לפי מכתב רו"ח שוטף: ₪${biz.grossIncome.toLocaleString()}/חודש (עדיפות מוחלטת על שומות)`);
            } else {
                if (bd2.annual_income_year1 && bd2.annual_income_year2) {
                    incomeNote += ` | ממוצע ${y1Label} (₪${Math.round(bd2.annual_income_year1/12).toLocaleString()}) + ${y2Label} (₪${Math.round(bd2.annual_income_year2/12).toLocaleString()})`;
                }
                if (bd2.annual_income_year3) {
                    incomeNote += ` | ${y3Label}: ₪${Math.round(bd2.annual_income_year3/12).toLocaleString()}/חודש (תומך)`;
                    strengths.push(`מכתב רו"ח שוטף: הכנסה ₪${Math.round(bd2.annual_income_year3/12).toLocaleString()}/חודש — מחזק את כושר ההחזר מעבר לשומות הרשמיות`);
                }
            }
            if (bd2.turnover) incomeNote += ` | מחזור: ₪${Math.round(bd2.turnover).toLocaleString()}`;
            income_months.push({ month: `${borrowerLabel} — עצמאי (ממוצע שנות מס)`, gross: biz.grossIncome, net: biz.netIncome, note: incomeNote });
            return biz.netIncome;
        };

        {
            // OVERRIDE: הכנסה עסקית → employment_type ל"עצמאי" (מונע פיצול אישיות שכיר/עצמאי)
            if (hasBusinessData && resolvedBusinessOwnerIndex === 0 && !(borrower1.employment_type||'').toLowerCase().includes('עצמאי')) borrower1.employment_type = 'עצמאי';
            if (hasBusinessData && resolvedBusinessOwnerIndex === 1 && !(borrower2.employment_type||'').toLowerCase().includes('עצמאי')) borrower2.employment_type = 'עצמאי';
            const b1IsSelf = (borrower1.employment_type||'').toLowerCase().includes('עצמאי') || (isBusinessCase && resolvedBusinessOwnerIndex === 0);
            const b2IsSalaried = borrower2.name && !(borrower2.employment_type||'').toLowerCase().includes('עצמאי');
            // FIX שכיר+עצמאי: אם התלושים שייכים ללווה 1 (מעסיק תואם) — לא לאפס, כדי לסכום שכר+עסק
            const b1OwnsSlips = b1PayslipsToUse.some(p => borrower1.employer && (p.employer||'').includes((borrower1.employer||'').split(' ')[0]));
            if (b1IsSelf && b1PayslipsToUse.length > 0 && !b1OwnsSlips) {
                if (b2IsSalaried) b2PayslipsToUse = [...b2PayslipsToUse, ...b1PayslipsToUse];
                b1PayslipsToUse = [];
            }
        }
        // ─── STEP B: CONTRACT NORMALIZATION — לווה 1 ───
        const contractGap1 = detectEmploymentContractGap(borrower1, b1PayslipsToUse, borrower1.name || 'לווה 1');

        if (isBusinessCase && resolvedBusinessOwnerIndex === 0 && hasBusinessData) {
            avg_income = addBusinessIncomeComponent(borrower1.name || 'לווה 1');
            if (b1PayslipsToUse.length > 0) { avg_income += processIncomeForBorrower(borrower1, b1PayslipsToUse, 0, false); } // FIX שכיר+עצמאי: סכום שכר+עסק
        } else if (contractGap1) {
            // נרמול לפי חוזה חתום — מעבר עבודה
            avg_income = contractGap1.netIncome;
            income_months.push({
                month: `${contractGap1.borrowerLabel} — חוזה עבודה חתום (${contractGap1.employer})`,
                gross: contractGap1.grossIncome,
                net: contractGap1.netIncome,
                note: `זיהוי כירורגי: מעבר עבודה. הכנסה חושבה לפי חוזה חתום ב-${contractGap1.employer}${contractGap1.startDate ? ' | תחילת עבודה: ' + contractGap1.startDate : ''}. תנאי למשיכה: תלוש ראשון תואם.`,
            });
            strengths.push(`חוזה עבודה חתום — ${contractGap1.employer}: ₪${contractGap1.netIncome.toLocaleString()} נטו/חודש (מעבר עבודה מזוהה)`);
            missing_docs.push(`תלוש שכר ראשון מ-${contractGap1.employer} (חובה לפני משיכה — Payout condition)`);
            risk_radar.push({
                category: 'מעבר עבודה — חוזה חתום',
                severity: 'LOW',
                finding: `${contractGap1.borrowerLabel}: מעבר עבודה ל-${contractGap1.employer}. הכנסה: ₪${contractGap1.netIncome.toLocaleString()}/חודש לפי חוזה. לא נמצא תלוש עדיין.`,
                recommendation: 'לאישור עקרוני: חוזה חתום מספיק. למשיכת הכסף (Payout): חובה להציג תלוש ראשון התואם את החוזה.',
            });
        } else if (b1PayslipsToUse.length > 0) {
            avg_income = processIncomeForBorrower(borrower1, b1PayslipsToUse, 0, false);
        }

        // ─── STEP B: CONTRACT NORMALIZATION — לווה 2 ───
        const contractGap2 = borrower2.name ? detectEmploymentContractGap(borrower2, b2PayslipsToUse, borrower2.name || 'לווה 2') : null;

        if (isBusinessCase && resolvedBusinessOwnerIndex === 1 && hasBusinessData) {
            const b2NormativeMonthly = borrower2._normative_shoma_monthly || 0;
            if (b2NormativeMonthly > 0) {
                avg_income_2 = b2NormativeMonthly;
                income_months.push({ month: `${borrower2.name || 'לווה 2'} — הכנסה נורמטיבית (שומת מס 2024)`, gross: b2NormativeMonthly, net: b2NormativeMonthly, note: `זיהוי כירורגי: הכנסה נורמטיבית = סך הכנסה החייבת בשומת 2024 / 12 = ₪${b2NormativeMonthly.toLocaleString()}/חודש.` });
                risk_radar.push({ category: 'שבתון + עסק — לווה 2', severity: 'LOW', finding: `${borrower2.name || 'לווה 2'} בשנת שבתון מאושרת ובעל עסק. הכנסה נורמטיבית לחיתום: ₪${b2NormativeMonthly.toLocaleString()}/חודש.`, recommendation: 'צרף מכתב חזרה לעבודה + 3 תלושים מלפני השבתון.' });
                strengths.push(`שבתון מאושר (לא חל"ת): ${borrower2.name || 'לווה 2'} עובד הוראה בקביעות בשנת שבתון מזכה — הכנסה נורמטיבית מוכרת לחיתום: ₪${b2NormativeMonthly.toLocaleString()}/חודש`);
                missing_docs.push(`מכתב אישור חזרה לעבודה ממשרד החינוך (${borrower2.name || 'לווה 2'})`);
            } else {
                avg_income_2 = addBusinessIncomeComponent(borrower2.name || 'לווה 2');
                if (b2PayslipsToUse.length > 0) { avg_income_2 += processIncomeForBorrower(borrower2, b2PayslipsToUse, 1, true); }
            }
        } else if (contractGap2) {
            avg_income_2 = contractGap2.netIncome;
            income_months.push({
                month: `${contractGap2.borrowerLabel} — חוזה עבודה חתום (${contractGap2.employer})`,
                gross: contractGap2.grossIncome,
                net: contractGap2.netIncome,
                note: `זיהוי כירורגי: מעבר עבודה. הכנסה חושבה לפי חוזה חתום ב-${contractGap2.employer}${contractGap2.startDate ? ' | תחילת עבודה: ' + contractGap2.startDate : ''}. תנאי למשיכה: תלוש ראשון תואם.`,
            });
            strengths.push(`חוזה עבודה חתום — ${contractGap2.employer}: ₪${contractGap2.netIncome.toLocaleString()} נטו/חודש (לווה 2 — מעבר עבודה)`);
            missing_docs.push(`תלוש שכר ראשון מ-${contractGap2.employer} — ${contractGap2.borrowerLabel} (Payout condition)`);
            risk_radar.push({
                category: 'מעבר עבודה — חוזה חתום',
                severity: 'LOW',
                finding: `${contractGap2.borrowerLabel}: מעבר עבודה ל-${contractGap2.employer}. הכנסה: ₪${contractGap2.netIncome.toLocaleString()}/חודש לפי חוזה.`,
                recommendation: 'לאישור עקרוני: חוזה חתום מספיק. למשיכת הכסף (Payout): חובה להציג תלוש ראשון.',
            });
        } else if (b2PayslipsToUse.length > 0) {
            avg_income_2 = processIncomeForBorrower(borrower2, b2PayslipsToUse, 1, true);
        }

        if (rawData.pension_slips && rawData.pension_slips.length > 0) {
            const pension_income = Math.round(rawData.pension_slips.reduce((sum, p) => sum + (p.net_allowance || 0), 0) / rawData.pension_slips.length);
            if (avg_income === 0) avg_income = pension_income;
            else if (avg_income_2 === 0) avg_income_2 = pension_income;
            income_months.push({ month: 'קצבת פנסיה/נכות — ממוצע', gross: pension_income, net: pension_income, note: `הכנסה מקצבה. מקור: ${rawData.pension_slips[0]?.source || 'לא צוין'}` });
        }

        const b1HasPayslips = b1PayslipsToUse.length > 0;
        const b2HasPayslips = b2PayslipsToUse.length > 0;
        const b2HasNormativeOverride = (borrower2._normative_shoma_monthly || 0) > 0;
        const sabbGrantAlreadyAdded = b2HasNormativeOverride || income_months.some(m => (m.note || '').includes('שבתון') && (m.note || '').includes('קרן ההשתלמות'));
        if (sabbatical_grant_income > 0 && !sabbGrantAlreadyAdded) {
            if (avg_income_2 === 0) { avg_income_2 = sabbatical_grant_income; } else { avg_income_2 += sabbatical_grant_income; }
            income_months.push({ month: 'מענק שבתון — קרן ההשתלמות', gross: sabbatical_grant_income, net: sabbatical_grant_income, note: `מענק שבתון חודשי מקרן ההשתלמות — הכנסה מובטחת לתקופת השבתון` });
            sabbatical_grant_income = 0;
        } else { sabbatical_grant_income = 0; }

        if (!isBusinessCase && rawData.income_deposits && rawData.income_deposits.length > 0) {
            rawData.income_deposits.filter(d => {
                if (!d.is_income) return false;
                if (d.source_type === 'קרן_השתלמות' || d.source_type === 'העברה' || d.source_type === 'משכורת') return false;
                const desc = (d.description || '').toLowerCase();
                const isEmployerDeposit = desc.includes('היינמן') || desc.includes('heinemann') || desc.includes('אלקטרה') || desc.includes('electra');
                if (isEmployerDeposit) return false;
                return !income_months.some(im => (im.note || '').includes(d.description?.substring(0, 10) || 'XXX'));
            }).forEach(d => {
                const monthlyAmt = d.average_monthly || 0;
                if (monthlyAmt < 500) return;
                const borrowerIdx = d.borrower_index ?? -1;
                if (borrowerIdx === 0 && b1HasPayslips) return;
                if (borrowerIdx === 1 && b2HasPayslips) return;
                if (borrowerIdx === -1 && (b1HasPayslips || b2HasPayslips)) return;
                if (avg_income === 0) avg_income = monthlyAmt;
                else if (avg_income_2 === 0 && monthlyAmt > 1000) avg_income_2 = monthlyAmt;
                income_months.push({ month: `הפקדה — ${d.description || 'לא ידוע'}`, gross: monthlyAmt, net: monthlyAmt, note: `מבוסס על הפקדות בעו"ש.` });
            });
        }

        total_household_income = avg_income + avg_income_2;

        // SMART EMPLOYER-BANK RECONCILIATION — Alias Table for known Israeli employers
        { const EMAP = { 'משרד החינוך': ['מ.חינוך','מ. חינוך','חינוך','מדינת ישראל','moe','education'], 'משרד הביטחון': ['מ.ביטחון','ביטחון','מדינת ישראל','idf'], 'מדינת ישראל': ['מדינה','ממשלה'], "שב\"ס": ["שב\"ס",'שבס','ips'], 'משטרת ישראל': ['משטרה','police'] }; const empMatch = (emp, desc) => { if (!emp||!desc) return false; const e=emp.toLowerCase(), d=desc.toLowerCase(); if (d.includes(e)||e.includes(d)) return true; for (const [k,aliases] of Object.entries(EMAP)) { if (k.toLowerCase().includes(e)||e.includes(k.toLowerCase())||aliases.some(a=>e.includes(a.toLowerCase()))) { if (aliases.some(a=>d.includes(a.toLowerCase()))||d.includes(k.toLowerCase())) return true; } } return false; }; const deps = rawData.income_deposits||[]; [[b1PayslipsToUse,borrower1.name||'לווה 1'],[b2PayslipsToUse,borrower2.name||'לווה 2']].forEach(([slips,lbl])=>{ (slips||[]).forEach(p=>{ const net=p.net_salary||0; if (net<1000||p._bank_verified) return; const m=deps.find(d=>d.is_income&&Math.abs((d.average_monthly||0)-net)<=50&&(empMatch(p.employer||'',d.description||'')||d.source_type==='משכורת')); if (m){p._bank_verified=true; p._bank_match_source=m.description; if (!strengths.some(s=>s.includes(lbl)&&s.includes('מאומתת בנקאית'))) strengths.push(`הכנסה מאומתת בנקאית — ${lbl}: ₪${net.toLocaleString()} (${p.employer||''}) ↔ "${m.description}"`); } }); }); }

        if (sabbatical_grant_income > 0) {
            avg_income_2 += sabbatical_grant_income;
            total_household_income = avg_income + avg_income_2;
            income_months.push({ month: 'מענק שבתון — קרן ההשתלמות', gross: sabbatical_grant_income, net: sabbatical_grant_income, note: `מענק שבתון חודשי מקרן ההשתלמות — הכנסה מובטחת לתקופת השבתון` });
        }

        if (total_household_income === 0) {
            missing_docs.push(isBusinessCase ? 'מסמכי הכנסה לבעלי עסקים חסרים: נדרש שומת מס / מכתב רו"ח.' : 'תלושי שכר חסרים: לא ניתן לחשב כושר החזר.');
            risk_radar.push({ category: 'חסרים מסמכי הכנסה', severity: 'HIGH', finding: isBusinessCase ? 'לא נמצאו שומות מס או מכתב רו"ח.' : 'לא נמצאו תלושי שכר.', recommendation: 'יש לצרף מסמכי הכנסה לפני הגשה לבנק.' });
        }

        income_months.forEach(m => {
            if (!m.month) return;
            if (m.month.includes('עצמאי') || m.month.includes('ממוצע שנות מס')) {
                const bn = resolvedBusinessOwnerIndex === 0 ? (borrower1.name||'לווה 1') : (borrower2.name||'לווה 2');
                m.month = m.month.replace(/^לווה [12] —/, `${bn} —`).replace(/^לווה [12]$/, bn);
                if (m.note) m.note = m.note.replace(/לווה [12] — הכנסה/, `${bn} — הכנסה`);
            }
        });

        // ── INCOME MONTHS DEDUP — מונע שורות כפולות בטבלת ההכנסות ──
        // קורה כשאותו תלוש מגיע פעמיים: ב-payslips_borrower1 וגם ב-payslips_borrower2 לאחר merge
        // כלל: מפתח = month + round(net/50)*50 + employer_root — שניים עם אותו מפתח → שמור רק אחד
        // הודות לעיגול ל-50 ולשורש המעסיק (פריוריטי סופטוויר / פריורטיסופט = אותו שורש) — מוחק כפילויות OCR
        const extractNoteEmployerRoot = (note) => {
            if (!note) return '';
            const m = note.match(/— (.+?)(?:\s*\||\s*$)/);
            const emp = m ? m[1].trim() : '';
            const normalized = emp
                .replace(/פריור[יתו]*/gi, 'פריוריטי')
                .replace(/priority/gi, 'פריוריטי');
            return normalized.replace(/\b(בע"מ|בעמ|ltd|inc|בע\.מ|סופט|software|city|סיטי|סוטי|סופטוויר)\b/gi, '').trim().split(/\s+/)[0].toLowerCase();
        };
        const incomeMonthsSeen = new Set();
        const incomeMonthsDeduped = income_months.filter(m => {
            const empRoot = extractNoteEmployerRoot(m.note);
            const key = `${m.month}_${Math.round((m.net || 0) / 50)}_${empRoot}`;
            if (incomeMonthsSeen.has(key)) return false;
            incomeMonthsSeen.add(key);
            return true;
        });
        income_months.length = 0;
        incomeMonthsDeduped.forEach(m => income_months.push(m));

        // ── SAME-ENTITY EMPLOYER DEDUP — שני שמות לאותה חברה לא מהווים "כפל מעסיקים" ──
        // דוגמאות: "פריוריטי בע"מ" + "פריוריטי סיטי בע"מ" = אותה חברה (Priority Software)
        // כלל: אם המילה הראשונה בשם המעסיק זהה (לאחר ניקוי "בע"מ", "בעמ", "ltd", "inc") — אותה ישות
        const extractEmployerRoot = (name) => {
            if (!name) return '';
            // Normalize OCR transliteration variants before extracting root
            // e.g. פריוריטי / פריורטי / פריוריתי / פריורטיסופט → priority
            const normalized = name
                .replace(/פריור[יתו]*/gi, 'פריוריטי')
                .replace(/priority/gi, 'פריוריטי')
                .replace(/\b(בע"מ|בעמ|ltd|inc|בע\.מ|עמ|סופטוויר|software|סיטי|city|סוטי|סופט)\b/gi, '');
            return normalized.trim().split(/\s+/)[0].toLowerCase();
        };
        [borrower1, borrower2].forEach((b, i) => {
            if (!b._dual_employer_flag) return;
            const label = i === 0 ? (b.name || 'לווה 1') : (b.name || 'לווה 2');
            // בדוק אם שני המעסיקים הם אותה ישות לפי שורש שם
            const employerNames = (b._dual_employer_names || '').split(/[/,]/).map(e => e.trim()).filter(Boolean);
            if (employerNames.length >= 2) {
                const root1 = extractEmployerRoot(employerNames[0]);
                const root2 = extractEmployerRoot(employerNames[1]);
                if (root1 && root2 && (root1 === root2 || root1.includes(root2) || root2.includes(root1))) {
                    // אותה ישות — אזהרה קלה בלבד, לא חסם
                    risk_radar.push({ category: 'שמות מסחריים שונים — אותה חברה', severity: 'LOW', finding: `${label}: תלושים הגיעו עם שמות מעסיק שונים (${b._dual_employer_names}) — ככל הנראה שם מסחרי ושם משפטי של אותה ישות.`, recommendation: 'לוודא עם הלקוח שמדובר באותה חברה. אם כן — אין צורך במכתב סיום.' });
                    return;
                }
            }
            risk_radar.push({ category: 'חשד לכפל הכנסה — שני מעסיקים פעילים', severity: 'HIGH', finding: `${label}: זוהו תלושי שכר משני מעסיקים פעילים בו-זמנית (${b._dual_employer_names}). הבנק יחשוד ב"ניפוח הכנסות".`, recommendation: 'חובה לצרף מכתב סיום העסקה ממעסיק אחד.' });
            missing_docs.push(`מכתב סיום העסקה — ${label} (שני מעסיקים פעילים: ${b._dual_employer_names})`);
        });

        const checkEmployerStability = (payslips, borrowerLabel) => {
            if (!payslips || payslips.length < 2) return;
            const employers = [...new Set(payslips.map(p => (p.employer || '').trim()).filter(Boolean))];
            if (employers.length > 1) {
                // בדוק אם כל המעסיקים הם אותה ישות לפי שורש שם (פריוריטי / פריוריטי סיטי = אותה חברה)
                const roots = employers.map(e => extractEmployerRoot(e)).filter(Boolean);
                const uniqueRoots = [...new Set(roots)];
                const allSameEntity = uniqueRoots.length === 1 ||
                    (uniqueRoots.length === 2 && (uniqueRoots[0].includes(uniqueRoots[1]) || uniqueRoots[1].includes(uniqueRoots[0])));
                if (allSameEntity) {
                    // אותה חברה, שמות שונים — לא אזהרה (OCR שמות שונים)
                    return;
                }
                // אם כבר הוספנו אזהרת dual employer מאותה חברה (מ-checkDualEmployer) — לא כפל
                const alreadyWarned = risk_radar.some(r => 
                    (r.category || '').includes('מעסיקים') && (r.finding || '').includes(borrowerLabel)
                );
                if (alreadyWarned) return;
                risk_radar.push({ category: 'שינוי מעסיק', severity: 'HIGH', finding: `${borrowerLabel}: זוהו מעסיקים שונים בתלושים: ${employers.join(' / ')}.`, recommendation: 'יש לוודא רצף תעסוקתי. אם מדובר בקידום בתוך אותה חברה — יש לצרף מכתב מעסיק.' });
                missing_docs.push(`אישור רצף תעסוקתי מהמעסיק — ${borrowerLabel}`);
            }
            // MODULE 1: exclude partial first months from the salary-jump check (prevents false alerts)
            const grossValues = payslips.filter(p => !p._skip_in_avg && !p._partial_month).map(p => p.gross_salary || 0).filter(v => v > 0);
            if (grossValues.length >= 2) {
                const minG = Math.min(...grossValues); const maxG = Math.max(...grossValues);
                if (minG > 0 && (maxG / minG) > 1.25) { risk_radar.push({ category: 'עלייה חריגה בשכר', severity: 'MEDIUM', finding: `${borrowerLabel}: שכר ברוטו עלה מ-₪${minG.toLocaleString()} ל-₪${maxG.toLocaleString()} (+${Math.round((maxG/minG-1)*100)}%).`, recommendation: 'אם מדובר בקידום — יש לצרף מכתב מעסיק המאשר את השינוי.' }); }
            }
        };
        checkEmployerStability(b1PayslipsToUse, borrower1.name || 'לווה 1');
        checkEmployerStability(b2PayslipsToUse, borrower2.name || 'לווה 2');

        // ── BLOCK 1: IDENTITY VERIFIER — מופעל עבור כל לווה בנפרד ──
        [borrower1, borrower2].forEach((b, i) => {
            if (!b.name && i === 1) return; // לווה 2 לא קיים
            const label = i === 0 ? (b.name || 'לווה 1') : (b.name || 'לווה 2');
            const idResult = verifyBorrowerIdentity(b, label, rawData);
            idResult.risks.forEach(r => risk_radar.push(r));
            idResult.missingDocs.forEach(d => missing_docs.push(d));
        });

        [borrower1, borrower2].forEach((b, i) => {
            const label = i === 0 ? (b.name || 'לווה 1') : (b.name || 'לווה 2');
            let sen = b.seniority_years;
            const empTypeLower = (b.employment_type || '').toLowerCase();
            const isSelfEmployed = empTypeLower.includes('עצמאי') || empTypeLower.includes('עצמאית');
            if (isSelfEmployed && rawData.business_data?.seniority_years) {
                const bizSen = rawData.business_data.seniority_years;
                if (bizSen > (sen || 0)) { b.seniority_years = bizSen; sen = bizSen; }
            }
            if (!isSelfEmployed && sen !== undefined && sen !== null && sen > 0 && sen < 1) {
                risk_radar.push({ category: 'ותק נמוך', severity: 'HIGH', finding: `${label}: ותק של פחות משנה (${sen} שנים). בנקים רבים דורשים מינימום 12 חודש.`, recommendation: 'יש לצרף מכתב ממעסיק המאשר קביעות / המשך העסקה.' });
                missing_docs.push(`מכתב קביעות / אישור המשך העסקה — ${label} (ותק נמוך)`);
            }
            if (b.employer && sen >= 3 && (b.employer.includes('חינוך') || b.employer.includes('הוראה') || b.employer.includes('מדינה') || b.employer.includes('ממשלה')) && !strengths.some(s => s.includes(label) && s.includes('Positive')))
                strengths.push(`Positive Bias — ${label}: עובד ${b.employer}, ותק ${Math.round(sen)} שנים — יציבות תעסוקתית מרבית.`);
        });

        if (rawData._sabbatical_checklist && rawData._sabbatical_checklist.length > 0) {
            rawData._sabbatical_checklist.forEach(flag => {
                if (flag.rule === 'SABBATICAL_PRE_SLIPS_MISSING') {
                    missing_docs.push(`חסרים תלושי שכר טרום-שבתון — ${flag.borrower} (נמצאו ${flag.found || 0} מתוך 3 נדרשים)`);
                    risk_radar.push({ category: 'שבתון — תלושים טרום-שבתון חסרים', severity: 'HIGH', finding: flag.alert, recommendation: 'יש לצרף 3 תלושי שכר מלאים שקדמו לתחילת השבתון.' });
                } else if (flag.rule === 'SABBATICAL_RETURN_LETTER_MISSING') {
                    missing_docs.push(`מכתב חזרה לעבודה מהמעסיק — ${flag.borrower} (חובה לפני הגשה לבנק)`);
                    risk_radar.push({ category: 'שבתון — מכתב חזרה לעבודה חסר', severity: 'HIGH', finding: flag.alert, recommendation: 'המכתב חייב לכלול: (1) אישור שמירת מקום, (2) תאריך חזרה צפוי לעבודה. השכר ייגזר מתלושים טרום השבתון.' });
                }
            });
        }

        const _selfNames=[borrower1,borrower2].filter(b=>(b.employment_type||'').toLowerCase().includes('עצמאי')).map(b=>b.name).filter(Boolean);

        const knownLoanDescriptionsForDedup = new Set((rawData.loans || []).flatMap(l => { const desc = (l.description || '').toLowerCase(); const keys = []; if (desc.includes('מסד')) keys.push('מסד'); if (desc.includes('דיגיטל')) keys.push('דיגיטל'); if (desc.includes('שונות')) keys.push('שונות'); if (desc.includes('מכרז')) keys.push('מכרז'); if (desc.length > 4) keys.push(desc.substring(0, 6)); return keys; }));
        const isDeductionAlreadyInLoans = (deductionDesc) => { const descLower = (deductionDesc || '').toLowerCase(); return [...knownLoanDescriptionsForDedup].some(k => descLower.includes(k)); };

        const SOCIAL_DEDUCTION_KEYWORDS = ['קרן השתלמות', 'קופת גמל', 'קה"ל', 'קרן_השתלמות', 'ביטוח מנהלים', 'פנסיה', 'קצבה', 'ביטוח חיים מעסיק', 'ביטוח אובדן כושר', 'קופ"ג', 'גמל', 'קופות גמל', 'קופות גמל וביטוחים', 'גמל וביטוח', 'ביטוחים', 'הלוואות מסד', 'הלוואת מסד', 'ניכויי חובה', 'סמל 423', '423', 'מענק שבתון', 'מענק השתלמות', 'קרן השתלמות מורים', 'מורים וגננות', 'ארוחות', 'ארוחה', 'מזון', 'דלק', 'נסיעות', 'רכב', 'טלפון', 'סלולר', 'מחשב', 'ציוד', 'הלבשה', 'מנוי', 'חנייה', 'כלכלה', 'שי', 'מתנה', 'קופה', 'ועד', 'איגוד', 'מס הכנסה', 'ביטוח לאומי', 'ביטח לאומי', 'מעסיק', 'הכנסה',
            // ── ניכויי חובה רפואיים/סטטוטוריים — לעולם לא הלוואה ──
            'ביטוח בריאות', 'אמבולטורי', 'אמבולטורי ב', 'ביטוח תאונות', 'מטרייה', 'אכ"ע', 'ועד עובדים', 'קרן רווחה', 'דמי חבר', 'הסתדרות'];
        const MANDATORY_DEDUCTION_CODES = ['91001', '92041', '708', '800', '801', '30201', '30211', '680'];
        const isSocialDeduction = (desc) => {
            const d = (desc || '').toLowerCase();
            if (SOCIAL_DEDUCTION_KEYWORDS.some(kw => d.includes(kw.toLowerCase()))) return true;
            // בדיקה לפי קוד סמל מתלוש
            if (MANDATORY_DEDUCTION_CODES.some(code => d.includes(code))) return true;
            return false;
        };

        const allPayslipDeductions = [...(rawData.payslip_deductions || [])];
        [[b1PayslipsToUse, 0], [b2PayslipsToUse, 1]].forEach(([slips, bIdx]) => {
            slips.forEach(p => {
                if ((p.loan_deduction || 0) > 200) allPayslipDeductions.push({ borrower_index: bIdx, description: 'ניכוי הלוואה', monthly_amount: p.loan_deduction, source_note: p.notes || '' });
                if ((p.life_insurance_deduction || 0) > 200 && !p._life_insurance_is_routine) { allPayslipDeductions.push({ borrower_index: bIdx, description: 'ביטוח חיים הלוואה', monthly_amount: p.life_insurance_deduction }); }
                const gross = p.gross_salary || 0; const rawNet = p.net_salary || 0;
                // ── CAR DEDUCTION: ניכוי רכב צמוד מנוטרל לפני בדיקת excess ──
                const pn = (p.notes || '').toLowerCase();
                const carD = p.car_deduction || p.vehicle_deduction || 0;
                const hasCarN = pn.includes('רכב') || pn.includes('שווי שימוש') || pn.includes('רכב צמוד');
                let net = rawNet;
                if (hasCarN || carD > 0) {
                    if (carD > 0) net = rawNet + carD;
                    else { const cm = (p.notes||'').match(/[\d,]{3,}/); if (cm) net = rawNet + parseInt(cm[0].replace(/,/g,'')); }
                }
                const isHighTechEmployer = (rawData.borrowers || []).some(b => { const emp = (b.employer || '').toLowerCase(); return emp.includes('פריוריטי') || emp.includes('priority') || emp.includes('אלקטרה') || emp.includes('electra') || emp.includes('טק') || emp.includes('tech') || emp.includes('הייטק') || emp.includes('מיקרוסופט') || emp.includes('אינטל') || emp.includes('wix'); });
                const normalDeductionRate = isHighTechEmployer ? 0.35 : (gross > 35000 ? 0.45 : gross > 30000 ? 0.42 : gross > 20000 ? 0.32 : 0.22);
                const expectedStandardDeductions = gross * normalDeductionRate;
                const actualDeductions = gross - net;
                const excessDeduction = actualDeductions - expectedStandardDeductions;
                const excessThreshold = gross > 20000 ? 2500 : 1500;
                // ── סף יחס נטו/ברוטו לפי מדרגות מס: ברוטו > 35K → 52%, ברוטו > 30K → 55% ──
                const ratioThreshold = isHighTechEmployer ? 0.58 : (gross > 35000 ? 0.52 : gross > 30000 ? 0.55 : gross > 20000 ? 0.62 : 0.72);
                if (gross > 12000 && excessDeduction > excessThreshold && net / gross < ratioThreshold) {
                    const label = bIdx === 1 ? (borrower2.name || 'לווה 2') : (borrower1.name || 'לווה 1');
                    const deductionKey = `excess_deduction_b${bIdx}_${p.month_year}`;
                    if (!allPayslipDeductions.some(d => d._key === deductionKey)) {
                        missing_docs.push(`פירוט ניכויי שכר מלא מתלוש ${p.month_year} — ${label} (ניכויי חובה חריגים: ₪${Math.round(excessDeduction).toLocaleString()} מעל הצפוי — יש לאמת מול BDI)`);
                        allPayslipDeductions.push({ borrower_index: bIdx, description: 'ניכויי חובה חריגים', monthly_amount: excessDeduction, _key: deductionKey });
                    }
                }
            });
        });

        // הלוואות מוסד — מזהה אוטומטית ומוסיף ל-Checklist
        [[b1PayslipsToUse, borrower1.name || 'לווה 1'], [b2PayslipsToUse, borrower2.name || 'לווה 2']].forEach(([slips, bName]) => {
            const hasMasadDeduction = (slips || []).some(p => {
                const notes = (p.notes || '').toLowerCase();
                const hasLoanDed = (p.loan_deduction || 0) > 200;
                const isMasad = notes.includes('מסד') || notes.includes('masad');
                return hasLoanDed && isMasad;
            });
            if (hasMasadDeduction && !missing_docs.some(d => d.includes('מוסד') && d.includes(bName))) {
                missing_docs.push(`פירוט יתרות הלוואות מוסד — ${bName} (ניכוי הלוואות מוסד זוהה בתלוש — נדרש לוח סילוקין מהבנק)`);
                risk_radar.push({
                    category: 'הלוואות מוסד — נדרש אימות',
                    severity: 'HIGH',
                    finding: `${bName}: זוהה ניכוי "הלוואות מוסד" בתלוש השכר — הלוואות אלו אינן מופיעות בריכוז היתרות הרגיל.`,
                    recommendation: 'יש לבקש לוח סילוקין מהבנק ולוודא שכל ההתחייבויות דווחו בריכוז.'
                });
            }
        });

        const deductionsSeen = new Set();
        allPayslipDeductions.forEach(d => {
            const key = `${d.borrower_index}_${d.description}_${d.monthly_amount}`;
            if ((d.monthly_amount || 0) > 200 && !deductionsSeen.has(key)) {
                deductionsSeen.add(key);
                if (isSocialDeduction(d.description)) return;
                const sourceNote = (d.source_note || '').toLowerCase();
                const isKnownLoan = isDeductionAlreadyInLoans(d.description) || isDeductionAlreadyInLoans(sourceNote) || (rawData.loans || []).some(l => Math.abs((l.monthly_payment || 0) - (d.monthly_amount || 0)) < 50);
                if (isKnownLoan) return;
                const descLower2 = (d.description || '').toLowerCase();
                const mortgagePmt = rawData.existing_mortgage?.monthly_payment || 0;
                const numB = (rawData.borrowers || []).length || 1;
                const isMasadDeduction = descLower2.includes('מסד') || descLower2.includes('mortgage') || descLower2.includes('משכנתא');
                // ── Insurance Buffer: פער עד 10% בין חיוב בנק לדוח יתרות = ביטוח חיים/מבנה + הפרשי מדד ──
                const isCloseMortgage = mortgagePmt > 0 && Math.abs((d.monthly_amount || 0) - mortgagePmt / numB) < mortgagePmt * 0.35;
                if (isMasadDeduction && isCloseMortgage) return;
                const isGenericLoanDeduction = descLower2 === 'ניכוי הלוואה' || descLower2 === 'loan deduction';
                const isCloseToMortgagePerBorrower = mortgagePmt > 0 && Math.abs((d.monthly_amount || 0) - mortgagePmt / numB) < mortgagePmt * 0.30;
                if (isGenericLoanDeduction && isCloseToMortgagePerBorrower) return;
                const label = d.borrower_index === 1 ? 'לווה 2' : 'לווה 1';
                risk_radar.push({ category: 'ניכוי חשוד בתלוש', severity: 'HIGH', finding: `${label}: ניכוי חודשי "${d.description}" — ₪${d.monthly_amount.toLocaleString()} — עשוי להצביע על הלוואה לא מדווחת.`, recommendation: 'יש לקבל ריכוז הלוואות ולבדוק אם הניכוי קשור להלוואה פנימית שלא דווחה.' });
                missing_docs.push(`ריכוז הלוואות / אישור לניכוי "${d.description}" — ${label}`);
            }
        });

        const grossNetSeen = new Set();

        // איסוף payslips עם _gross_net_explained — מונע אזהרות כפולות על ניכויי הלוואות מסד שכבר אומתוו u05dbמוברים
        const explainedPayslipKeys = new Set();
        [[b1PayslipsToUse, borrower1.name || 'לווה 1'], [b2PayslipsToUse, borrower2.name || 'לווה 2']].forEach(([slips, bName]) => {
            (slips || []).forEach(p => {
                if (p._gross_net_explained) explainedPayslipKeys.add(`${bName}_${p.month_year}`);
            });
        });

        if (rawData.payslip_deduction_alerts && rawData.payslip_deduction_alerts.length > 0) {
            rawData.payslip_deduction_alerts.forEach(alert => {
                const ratio = alert.ratio_pct || 0;
                if (ratio >= 65 && ratio <= 95) return;
                if ((alert.suspected_reason||'').includes('רכב') || (alert.suspected_reason||'').includes('vehicle')) return;
                // דלג אם ניכוי התלוש כבר הוסבר על ידי הלוואות מסד ידועות
                const alertKey = `${alert.borrower_name}_${alert.month_year}`;
                if (explainedPayslipKeys.has(alertKey)) return;
                const key = `${alert.borrower_name}_${alert.month_year}`;
                if (!grossNetSeen.has(key)) {
                    grossNetSeen.add(key);
                    risk_radar.push({ category: 'יחס ברוטו/נטו חריג', severity: 'HIGH', finding: `${alert.borrower_name || ''} (${alert.month_year || ''}): ברוטו ₪${(alert.gross||0).toLocaleString()} | נטו ₪${(alert.net||0).toLocaleString()} | יחס: ${ratio}% (נורמה: 65%-85%). ייתכן: ${alert.suspected_reason || 'ניכויים לא מוסברים'}.`, recommendation: 'יש לבקש פירוט ניכויים מלא ולהצליב מול ריכוז הלוואות.' });
                }
            });
        }

        const overdraftWithEquity = rawData._normalization?.overdraft_with_equity || false;
        const liquidEquityFromNorm = rawData._normalization?.liquid_equity || 0;

        // ── תיקון: קיזוז תזרימי — חריגה שכוסתה באותה יום על ידי מכירת ני"ע או הכנסה דומה ──
        // זוהי ניהול נזילות תקין — לא מינוס כרוני
        const netCashNeutralAccounts = new Set();
        (rawData.bank_statements || []).forEach(stmt => {
            const txs = stmt.transactions || stmt.debits || [];
            const dayMap = {};
            txs.forEach(tx => {
                const day = (tx.date || '').substring(0, 10);
                if (!day) return;
                if (!dayMap[day]) dayMap[day] = { out: 0, in: 0 };
                const amt = tx.amount || 0;
                if (amt < 0) dayMap[day].out += Math.abs(amt);
                else dayMap[day].in += amt;
            });
            // אם ביום של חריגה (יתרה שלילית) נכנסה כמות דומה — תיירות תזרים תקין
            const account = stmt.account_number || stmt.account_last4 || 'all';
            Object.entries(dayMap).forEach(([day, flows]) => {
                if (flows.out > 10000 && flows.in >= flows.out * 0.75) {
                    netCashNeutralAccounts.add(account);
                }
            });
        });

        const technicalOverdraftAccounts = new Set([
            ...(rawData.cash_flow_summary || []).filter(acc => acc._overdraft_classification === 'technical').map(acc => acc.account_last4 || 'all'),
            ...netCashNeutralAccounts
        ]);

        // ── תיקון: לוגיקת סוף חודש — אם דף הבנק נחתך לפני יום 25, לא ניתן להסיק על ירידת הכנסה ──
        const bankStmtEndDay = (() => {
            const stmts = rawData.bank_statements || [];
            if (stmts.length === 0) return null;
            const lastStmt = stmts[stmts.length - 1];
            const endDate = lastStmt.end_date || lastStmt.period_end || null;
            if (!endDate) return null;
            try { return new Date(endDate.split('/').reverse().join('-')).getDate(); } catch { return null; }
        })();
        const stmtCutBeforePayday = bankStmtEndDay !== null && bankStmtEndDay < 25;

        if (rawData.bank_red_flags && rawData.bank_red_flags.length > 0) {
            rawData.bank_red_flags.forEach(flag => {
                // סנן דגלי 'ירידת הכנסה' אם הדף נחתך לפני יום 25 (לפני כניסת המשכורת)
                if (stmtCutBeforePayday) {
                    const fl = (typeof flag === 'string' ? flag : '').toLowerCase();
                    if (fl.includes('ירידה') || fl.includes('הכנסה נמוכה') || fl.includes('income drop') || fl.includes('salary drop')) return;
                }
            });
        }

        const knownLoanNames = new Set([...(rawData.loans || []).map(l => (l.description || '').toLowerCase().substring(0, 8)), ...(rawData.existing_mortgage?.bank_name ? [(rawData.existing_mortgage.bank_name || '').toLowerCase().substring(0, 6)] : []), 'הראל', 'מגדל', 'כלל', 'הפניקס', 'מנורה', 'אי.די.איי']);
        if (rawData.undisclosed_loan_indicators && rawData.undisclosed_loan_indicators.length > 0) {
            const undisclosedSeen = new Set();
            rawData.undisclosed_loan_indicators.forEach(ind => {
                const indLower = ind.toLowerCase();
                const alreadyInLoans = [...knownLoanNames].some(lname => lname.length > 3 && indLower.includes(lname));
                if (alreadyInLoans) return;
                let indHe = ind.replace(/Menora Life Insurance/gi, 'מנורה ביטוח חיים').replace(/life insurance/gi, 'ביטוח חיים').replace(/payments? observed/gi, 'תשלומים שנצפו').replace(/may indicate a linked undisclosed loan/gi, 'עשוי להצביע על הלוואה נסתרת').replace(/amounts?:\s*\[([^\]]+)\]/gi, (m, nums) => `סכומים: ${nums}`).replace(/([A-Z][a-z]+\s+[A-Z][a-z]+):/g, (m, name) => { if (borrower1.name && borrower1.name.toLowerCase().includes(name.split(' ')[0].toLowerCase())) return `${borrower1.name}:`; if (borrower2.name && borrower2.name.toLowerCase().includes(name.split(' ')[0].toLowerCase())) return `${borrower2.name}:`; return m; });
                indHe = indHe.replace(/^"+|"+$/g, '').trim();
                risk_radar.push({ category: 'הלוואה לא מדווחת', severity: 'HIGH', finding: `נמצא ניכוי ביטוח חיים/הלוואה: ${indHe} — ייתכן שיש הלוואה שלא דווחה בריכוז.`, recommendation: 'יש לקבל ריכוז הלוואות מהבנק ולוודא שכל ההתחייבויות מדווחות.' });
            });
            if (!undisclosedSeen.has('ריכוז')) { undisclosedSeen.add('ריכוז'); missing_docs.push('ריכוז הלוואות מלא מהבנק (בגלל ניכויי ביטוח חיים חשודים)'); }
        }

        if (isBusinessCase && rawData.business_data?.income_trend) {
            const trend = rawData.business_data.income_trend;
            const trendPct = rawData.business_data.income_trend_pct || 0;
            const taxDebt = rawData.business_data.tax_debt || 0;
            const b2IsSabbatical = (borrower2.employment_type || '').toLowerCase().includes('שבתון') || (borrower2.special_status_note || '').toLowerCase().includes('שבתון');
            const b1IsSabbatical = (borrower1.employment_type || '').toLowerCase().includes('שבתון') || (borrower1.special_status_note || '').toLowerCase().includes('שבתון');
            const anySabbaticalBorrower = b1IsSabbatical || b2IsSabbatical;
            if (trend === 'declining') {
                if (anySabbaticalBorrower) { risk_radar.push({ category: 'ירידה בהכנסה עסקית — מוסברת ע"י שבתון', severity: 'LOW', finding: `הכנסת העסק ירדה ב-${Math.abs(Math.round(trendPct))}% — זאת בשנת השבתון בה הלווה הפחית פעילות עסקית.`, recommendation: 'יש לצרף מכתב רו"ח קצר המסביר שהירידה היא תוצאה ישירה של שנת השבתון.' }); }
                else { risk_radar.push({ category: 'מגמת ירידה בהכנסה עסקית', severity: 'HIGH', finding: `הכנסת העסק ירדה ב-${Math.abs(Math.round(trendPct))}% בין שנות המס.`, recommendation: 'יש להכין מכתב רו"ח המסביר את הירידה ומציג תחזית לשנה הנוכחית.' }); missing_docs.push('מכתב רו"ח המסביר ירידה בהכנסה + תחזית שנה נוכחית'); }
            } else if (trend === 'single_year') {
                risk_radar.push({ category: 'שנת מס יחידה', severity: 'HIGH', finding: 'נמצאה שנת מס אחת בלבד. רוב הבנקים דורשים 2 שנות מס לפחות לבעלי עסקים.', recommendation: 'יש לצרף שומת מס נוספת לשנה הקודמת.' }); missing_docs.push('שומת מס לשנה נוספת (2 שנים נדרשות לבעלי עסקים)');
            }
            if (taxDebt > 0) { risk_radar.push({ category: 'חוב לרשות המיסים', severity: 'HIGH', finding: `נמצא חוב מס של ₪${taxDebt.toLocaleString()} בשומת המס.`, recommendation: 'חובה לטפל בחוב המס לפני הגשה.' }); missing_docs.push('אישור ניקיון חובות מרשות המיסים'); }
        }

        if (rawData.existing_mortgage?._balance_gap_warning) { validation_flags.push({ field: 'mortgage_balance_gap', severity: 'MEDIUM', message: rawData.existing_mortgage._balance_gap_warning }); risk_radar.push({ category: 'פער בסכום יתרת המשכנתא', severity: 'MEDIUM', finding: rawData.existing_mortgage._balance_gap_warning, recommendation: 'יש לאמת את יתרת הסילוק מול מסמך המקור לפני הגשה לבנק.' }); }
        if (rawData.existing_mortgage?._partial_tracks_warning) { validation_flags.push({ field: 'mortgage_partial_tracks', severity: 'MEDIUM', message: rawData.existing_mortgage._partial_tracks_warning }); }

        if (isRefinanceCase && rawData.existing_mortgage?.statement_date) {
            const stmtDateStr = rawData.existing_mortgage.statement_date;
            let stmtDate = null;
            try { const parts = stmtDateStr.split('/'); if (parts.length === 3) stmtDate = new Date(parts[2], parts[1]-1, parts[0]); } catch(e) {}
            if (stmtDate) {
                const daysDiff = Math.round((new Date() - stmtDate) / (1000 * 60 * 60 * 24));
                if (daysDiff > 90) { risk_radar.push({ category: 'יתרת משכנתא לא עדכנית', severity: 'HIGH', finding: `מסמך יתרת המשכנתא מתאריך ${stmtDateStr} — לפני ${daysDiff} ימים. הבנק ידרוש יתרה עדכנית (עד 90 יום).`, recommendation: 'יש לבקש יתרה לסילוק עדכנית מהבנק הנוכחי.' }); missing_docs.push(`יתרת משכנתא עדכנית מהבנק (מסמך נוכחי מ-${stmtDateStr} פג תוקף)`); }
            }
        }

        const EMPLOYER_LOAN_BANKS = ['מסד', 'הוראה', 'מורים', 'degel', 'גמל'];
        const realMortgagesOnly = (rawData.all_mortgages || []).filter(m => { const bankName = (m.bank_name || '').toLowerCase(); const isEmployerLoan = EMPLOYER_LOAN_BANKS.some(kw => bankName.includes(kw)); const knownLoansTotal = (rawData.loans || []).reduce((s, l) => s + (l.remaining_balance || 0), 0); const isSimilarToLoans = knownLoansTotal > 0 && Math.abs((m.remaining_balance || 0) - knownLoansTotal) < knownLoansTotal * 0.15; return !isEmployerLoan && !isSimilarToLoans; });
        if (realMortgagesOnly.length > 1) { const totalMortgageBalance = realMortgagesOnly.reduce((s, m) => s + (m.remaining_balance || 0), 0); const totalMortgagePayment = realMortgagesOnly.reduce((s, m) => s + (m.monthly_payment || 0), 0); risk_radar.push({ category: 'שתי משכנתאות', severity: 'HIGH', finding: `זוהו ${realMortgagesOnly.length} משכנתאות בבנקים שונים: ${realMortgagesOnly.map(m => `${m.bank_name} — ₪${(m.remaining_balance||0).toLocaleString()}`).join(' | ')}. סה"כ יתרה: ₪${totalMortgageBalance.toLocaleString()} | החזר כולל: ₪${totalMortgagePayment.toLocaleString()}/חודש.`, recommendation: 'יש לצרף יתרה לסילוק מכל בנק ולחשב LTV כולל.' }); }

        if (rawData.disability_info?.valid_until) {
            const disDateStr = rawData.disability_info.valid_until;
            try {
                const parts = disDateStr.split('/');
                const disDate = new Date(parts.length === 3 ? parseInt(parts[2]) : parseInt(disDateStr.substring(0,4)), parts.length === 3 ? parseInt(parts[1])-1 : parseInt(disDateStr.substring(4,6))-1, parts.length === 3 ? parseInt(parts[0]) : 1);
                const monthsLeft = Math.round((disDate - new Date()) / (1000 * 60 * 60 * 24 * 30));
                if (monthsLeft < 24 && monthsLeft > 0) { risk_radar.push({ category: 'תוקף נכות מסתיים בקרוב', severity: 'HIGH', finding: `אישור הנכות מסתיים ב-${disDateStr} (${monthsLeft} חודשים מהיום).`, recommendation: 'יש לצרף מכתב ממוסד מבטח המאשר המשכיות הקצבה.' }); missing_docs.push(`אישור המשכיות קצבת נכות מעבר ל-${disDateStr}`); }
            } catch(e) {}
        }

        if (rawData.property_value && rawData.requested_loan_amount) {
            const requestedLTV = Math.round((rawData.requested_loan_amount / rawData.property_value) * 100);
            const propertyPurpose = rawData.property_purpose || 'דירה_יחידה';
            const ltvLimits = { 'דירה_יחידה': 75, 'דירה_חלופית': 70, 'דירה_להשקעה': 50 };
            const ltvLimit = ltvLimits[propertyPurpose] || 75;
            const ltvLimitLabel = { 'דירה_יחידה': 'דירה יחידה/ראשונה', 'דירה_חלופית': 'דירה חלופית', 'דירה_להשקעה': 'דירת משקיע' }[propertyPurpose] || 'דירה יחידה';
            if (requestedLTV > ltvLimit) { risk_radar.push({ category: 'חריגת LTV — רגולציה בנק ישראל', severity: 'critical', finding: `סוג נכס: ${ltvLimitLabel} — מקסימום LTV מותר: ${ltvLimit}%. LTV מבוקש: ${requestedLTV}%.`, recommendation: `יש להגדיל את ההון העצמי עד שה-LTV לא יעלה על ${ltvLimit}%.` }); missing_docs.push(`אישור הון עצמי מספיק — נדרש מינימום ${100 - ltvLimit}% מסכום הנכס`); }
            else { strengths.push(`LTV מבוקש: ${requestedLTV}% — בטווח המותר לפי בנק ישראל ל${ltvLimitLabel} (מקסימום ${ltvLimit}%)`); }
        }

        if (rawData.requested_loan_years) {
            [{ borrower: borrower1, label: borrower1.name || 'לווה 1' }, { borrower: borrower2, label: borrower2.name || 'לווה 2' }].forEach(({ borrower, label }) => {
                const age = borrower.age; if (!age || age <= 0) return;
                const ageAtEnd = age + rawData.requested_loan_years;
                if (ageAtEnd > 85) {
                    const maxYears = 85 - age;
                    risk_radar.push({ category: 'תקופת משכנתא — מגבלת גיל', severity: 'HIGH', finding: `${label}: גיל ${age} + ${rawData.requested_loan_years} שנות משכנתא = גיל ${ageAtEnd} בסיום.`, recommendation: `יש לחשב את ה-PTI עם תקופה מקסימלית של ${maxYears} שנים.` });
                    if (total_household_income > 0 && rawData.requested_loan_amount) {
                        const r = 0.045 / 12; const nMax = maxYears * 12; const nReq = rawData.requested_loan_years * 12;
                        const calcPmt = (n) => rawData.requested_loan_amount * r * Math.pow(1+r,n) / (Math.pow(1+r,n)-1);
                        const pmtReduced = Math.round(calcPmt(nMax)); const pmtRequested = Math.round(calcPmt(nReq));
                        if (pmtReduced > pmtRequested) { risk_radar.push({ category: 'השפעה על PTI — קיצור תקופה', severity: 'MEDIUM', finding: `בתקופה מקסימלית (${maxYears} שנה): החזר צפוי כ-₪${pmtReduced.toLocaleString()}/חודש במקום ₪${pmtRequested.toLocaleString()}/חודש.`, recommendation: 'יש לוודא שה-PTI עדיין עומד בגבול 40% לאחר קיצור התקופה.' }); }
                    }
                }
            });
        }

        // ════════════════════════════════════════════════════════════
        // DEDUCTION CROSS-MATCHER — הצלבה אוטומטית של ניכויים בתלושים
        // לפני שמוציאים אזהרה, מנסים להסביר את הניכוי מהנתונים הקיימים:
        //   1. חישוב ניכויי חובה סטטוטוריים (מס, ביטוח לאומי, פנסיה, קרן השתלמות)
        //   2. הצלבה מול הלוואות ידועות בריכוז
        //   3. רק אם ניכוי בלתי מוסבר > ₪1,500 → דגל HIGH
        // ════════════════════════════════════════════════════════════
        const estimateMandatoryDeductions = (gross, isEducation) => {
            // ניכויי חובה בישראל: מס+ביטוח לאומי+פנסיה+קרן השתלמות = ~33-42%
            const baseRate = isEducation ? 0.42 : 0.38;
            return gross * baseRate;
        };

        const checkGrossNetRatio = (slips, borrowerLabel) => {
            if (!slips || slips.length === 0) return;
            const knownLoanPayments = (rawData.loans || []).filter(l => (l.monthly_payment || 0) > 0).map(l => l.monthly_payment);
            const totalKnownLoans = knownLoanPayments.reduce((s, v) => s + v, 0);
            slips.forEach(p => {
                const gross = p.gross_salary || 0; if (gross < 5000 || (p.net_salary || 0) <= 0) return;
                // ── CAR DEDUCTION NORMALIZER: ניכוי רכב צמוד מוסיף חזרה לנטו לפני בדיקת יחס ──
                const pNotes = (p.notes || '').toLowerCase();
                const carAmt = p.car_deduction || p.vehicle_deduction || 0;
                const hasCarNote = pNotes.includes('רכב') || pNotes.includes('ניכוי רכב') || pNotes.includes('שווי שימוש') || pNotes.includes('רכב צמוד');
                let net = p.net_salary || 0;
                if (hasCarNote || carAmt > 0) {
                    if (carAmt > 0) { net += carAmt; }
                    else { const m = (p.notes || '').match(/[\d,]{3,}/); if (m) net += parseInt(m[0].replace(/,/g, '')); else return; }
                }
                const ratio = net / gross;
                if (p._gross_net_explained) return;
                const isEducationEmployee = (rawData.borrowers || []).some(b => b.employer && (b.employer.includes('חינוך') || b.employer.includes('הוראה') || b.employer.includes('Education') || b.employer.includes('מדינה')));
                const grossNetThreshold = isEducationEmployee ? 0.53 : (gross > 35000 ? 0.50 : gross > 30000 ? 0.53 : gross > 20000 ? 0.60 : 0.65);
                if (ratio >= grossNetThreshold) return;

                const key = `${borrowerLabel}_${p.month_year}`;
                if (grossNetSeen.has(key)) return;
                grossNetSeen.add(key);

                // ── נורמה דינמית לפי שכר — מוצגת בהודעה ──
                const normLabel = gross > 35000 ? '50%-65%' : gross > 30000 ? '53%-65%' : gross > 20000 ? '60%-75%' : '65%-85%';

                const expectedMandatory = estimateMandatoryDeductions(gross, isEducationEmployee);
                const actualDeductions = gross - net;
                const unexplainedDeduction = actualDeductions - expectedMandatory;

                // ── הצלבה מול הלוואות ידועות ──
                const isExplainedByLoans = totalKnownLoans > 0 &&
                    Math.abs(unexplainedDeduction - totalKnownLoans) < totalKnownLoans * 0.25;
                if (isExplainedByLoans) {
                    risk_radar.push({ category: 'ניכויים מוצלבים — הלוואות ידועות', severity: 'LOW',
                        finding: `${borrowerLabel} (${p.month_year || ''}): יחס נטו/ברוטו ${Math.round(ratio*100)}% — ניכוי ₪${Math.round(unexplainedDeduction).toLocaleString()} מוצלב מול הלוואות ידועות (₪${Math.round(totalKnownLoans).toLocaleString()}/חודש). תקין.`,
                        recommendation: 'הצלבה אוטומטית הצליחה — אין צורך בבדיקה נוספת.' });
                    return;
                }

                // ── הצלבה מול ניכוי הלוואה מפורש בתלוש ──
                const slipLoanDeduction = p.loan_deduction || 0;
                if (slipLoanDeduction > 0 && Math.abs(unexplainedDeduction - slipLoanDeduction) < slipLoanDeduction * 0.15) {
                    risk_radar.push({ category: 'ניכוי הלוואה בתלוש — מזוהה', severity: 'LOW',
                        finding: `${borrowerLabel} (${p.month_year || ''}): ניכוי הלוואה מפורש ₪${slipLoanDeduction.toLocaleString()} — מסביר את יחס ${Math.round(ratio*100)}%. מוצלב.`,
                        recommendation: 'יש לצרף לוח סילוקין לאימות.' });
                    return;
                }

                // ── ניכוי בלתי מוסבר ──
                if (unexplainedDeduction > 1500) {
                    risk_radar.push({ category: 'ניכויים בלתי מוסברים בתלוש', severity: 'HIGH',
                        finding: `${borrowerLabel} (${p.month_year || ''}): נטו ₪${net.toLocaleString()} | ברוטו ₪${gross.toLocaleString()} | יחס: ${Math.round(ratio*100)}% (נורמה לשכר זה: ${normLabel}). ניכויי חובה צפויים: ₪${Math.round(expectedMandatory).toLocaleString()} | ניכוי בלתי מוסבר: ₪${Math.round(unexplainedDeduction).toLocaleString()} — לא נמצא הסבר בריכוז הלוואות.`,
                        recommendation: `בקש פירוט ניכויים מלא מהתלוש. ₪${Math.round(unexplainedDeduction).toLocaleString()} מעל הצפוי — ייתכן הלוואה פנימית/מזונות.` });
                    missing_docs.push(`פירוט ניכויים מלא — ${borrowerLabel} (${p.month_year || ''}) — ניכוי בלתי מוסבר ₪${Math.round(unexplainedDeduction).toLocaleString()}`);
                } else {
                    risk_radar.push({ category: 'יחס נטו/ברוטו — בגבול הנורמה', severity: 'LOW',
                        finding: `${borrowerLabel} (${p.month_year || ''}): יחס ${Math.round(ratio*100)}% — בטווח הנורמה לשכר זה (${normLabel}). ייתכן: הפרשות פנסיה גבוהות, ביטוחים.`,
                        recommendation: 'אין פעולה נדרשת — ניכויים בטווח סביר.' });
                }
            });
        };
        checkGrossNetRatio(b1PayslipsToUse, borrower1.name || 'לווה 1');
        checkGrossNetRatio(b2PayslipsToUse, borrower2.name || 'לווה 2');

        // ══ EARLY REPAYMENT FEE — סכום מכל המסלולים (לא רק העמלה התפעולית) ══
        // תיקון: AI לפעמים מחזיר רק ₪343 (עמלה תפעולית) במקום הסכום האמיתי מכל המסלולים
        if (rawData.existing_mortgage?.tracks && rawData.existing_mortgage.tracks.length > 0) {
            const tracksWithFee = rawData.existing_mortgage.tracks.filter(t => (t.early_repayment_fee || 0) > 0);
            if (tracksWithFee.length > 0) {
                const totalFeeFromTracks = tracksWithFee.reduce((s, t) => s + (t.early_repayment_fee || 0), 0);
                const existingFee = rawData.existing_mortgage.early_repayment_fee || 0;
                if (totalFeeFromTracks > existingFee * 1.05) {
                    // יש עמלות ברמת מסלול שגדולות מהסכום הכולל שדווח → עדכן
                    rawData.existing_mortgage.early_repayment_fee = totalFeeFromTracks;
                }
            }
        }

        if (rawData.property_value && rawData.existing_mortgage?.early_repayment_fee && rawData.existing_mortgage?.remaining_balance) {
            const totalRepayment = rawData.existing_mortgage.remaining_balance + rawData.existing_mortgage.early_repayment_fee;
            const ltvIncludingFee = Math.round((totalRepayment / rawData.property_value) * 100);
            const ltvBase = Math.round((rawData.existing_mortgage.remaining_balance / rawData.property_value) * 100);
            if (ltvIncludingFee !== ltvBase) { strengths.push(`LTV בסיסי: ${ltvBase}% | LTV כולל עמלת פירעון: ${ltvIncludingFee}%`); }
        }

        if (rawData.special_circumstances && rawData.special_circumstances.length > 0) {
            const SENIORITY_KEYS = ['ותק נמוך', 'ותק מ-12', 'ותק קצר', 'פחות מ-12 חודש', 'פחות משנה'];
            const OVERDRAFT_KEYS = ['מינוס', 'חובה', 'overdraft', 'יתרות מינוס'];
            rawData.special_circumstances.forEach(sc => {
                const isSeniorityDuplicate = SENIORITY_KEYS.some(k => sc.includes(k)) && risk_radar.some(r => r.category?.includes('ותק') || r.finding?.includes('ותק'));
                if (isSeniorityDuplicate) return;
                const isOverdraftDuplicate = OVERDRAFT_KEYS.some(k => sc.toLowerCase().includes(k.toLowerCase())) && risk_radar.some(r => r.category?.includes('עו"ש') || r.finding?.includes('מינוס'));
                if (isOverdraftDuplicate) return;
                const alreadyInRadar = risk_radar.some(r => r.finding.includes(sc.substring(0, 25)) || sc.includes((r.finding || '').substring(0, 20)));
                if (!alreadyInRadar) {
                    const isPositive = sc.includes('הון עצמי') || sc.includes('חיסכון') || sc.includes('פקדון') || sc.includes('חוזקה');
                    risk_radar.push({ category: isPositive ? 'חוזקה — נסיבות מיוחדות' : 'נסיבות מיוחדות', severity: isPositive ? 'LOW' : 'MEDIUM', finding: sc, recommendation: 'יש להתייחס לנסיבה זו במכתב לבנק.' });
                }
            });
        }

        if (isGoldenAge) { strengths.push('תיק גיל הזהב — משכנתא פנסיונית/הפוכה ללא הגבלת גיל עליון'); risk_radar.push({ category: 'גיל הזהב', severity: 'LOW', finding: `לווה בגיל ${borrower1.age || borrower2.age || '60+'} — תיק משכנתא פנסיונית.`, recommendation: 'יש לצרף אישור קצבת פנסיה חודשית ואסמכתא על בעלות הנכס.' }); }

        let loans_total_for_pti = 0;
        if (rawData.loans && rawData.loans.length > 0) {
            const existingMortgagePayment = rawData.existing_mortgage?.monthly_payment || 0;
            const existingMortgageBalance = rawData.existing_mortgage?.remaining_balance || 0;
            rawData.loans.forEach(loan => {
                const effectiveMonthlyPayment = loan.monthly_payment || 0;
                const desc = (loan.description || '').toLowerCase();
                if (isRefinanceCase && existingMortgagePayment > 0) {
                    const isSameMortgagePayment = Math.abs(effectiveMonthlyPayment - existingMortgagePayment) < 100;
                    const isSameMortgageBalance = existingMortgageBalance > 0 && loan.remaining_balance && Math.abs(loan.remaining_balance - existingMortgageBalance) < 5000;
                    // ── שלב 1: Evidence-Only — תיקון הזיית בנק יהב (שמואל אמיר 12.04) ──
                    // סיווג כמשכנתא רק אם: (א) יש מסמך mortgage_statement מאומת + (ב) תיאור מפורש של "משכנתא"
                    // שם בנק בלבד (יהב, פועלים) אינו מספיק לסיווג כמשכנתא
                    const hasMortgageStatement = !!(rawData.existing_mortgage?.remaining_balance);
                    const isMortgageDesc = hasMortgageStatement && (desc.includes('משכנתא') || desc.includes('mortgage'));
                    if (isSameMortgagePayment || isSameMortgageBalance || isMortgageDesc) return;
                }
                const INTER_ACCOUNT_KEYWORDS = ['העברה', 'פקדון', 'דיגיטל', 'עו"ש', 'חשבון', 'העברה עצמית', 'transfer', 'account'];
                const isLikelyNotLoan = loan.needs_clarification === true && effectiveMonthlyPayment > 1000 && INTER_ACCOUNT_KEYWORDS.some(kw => desc.includes(kw));
                if (isLikelyNotLoan) {
                    const isBusinessOwnerWithdrawal = isBusinessCase && (desc.includes('דיגיטל') || desc.includes('digital') || desc.includes('העברה') || desc.includes('עצמי') || desc.includes('פרטי'));
                    if (isBusinessOwnerWithdrawal) { strengths.push(`משיכת בעלים סדירה: ₪${effectiveMonthlyPayment.toLocaleString()}/חודש — מוכיחה שהעסק מניב תזרים חיובי.`); }
                    else { risk_radar.push({ category: 'דורש בדיקה — האם הלוואה?', severity: 'MEDIUM', finding: `"${loan.description}" — ₪${effectiveMonthlyPayment.toLocaleString()} — לא אושר כהלוואה, לא נספר ב-PTI עד לאימות.`, recommendation: 'יש לבדוק האם מדובר בהלוואה קבועה או העברה חד-פעמית.' }); }
                    return;
                }
                // הלוואה שהחזרה לא נקרא (רק יתרה) — לא נספרת ב-PTI, מוצגת כדורשת אימות (לא "₪0")
                const includeInPTI = !(loan.remaining_months && loan.remaining_months <= 18) && !loan._from_liability_crawler && !loan._payment_unknown && effectiveMonthlyPayment > 0;
                if (includeInPTI) loans_total_for_pti += effectiveMonthlyPayment;
                let findingText = loan._payment_unknown
                    ? `הלוואה: ${loan.description || 'לא ידוע'} - החזר חודשי לא נקרא במסמך (דורש אימות)`
                    : `הלוואה: ${loan.description || 'לא ידוע'} - החזר חודשי: ₪${effectiveMonthlyPayment.toLocaleString()}`;
                if (loan.remaining_balance) findingText += ` (יתרה: ₪${loan.remaining_balance.toLocaleString()})`;
                if (loan.end_date) findingText += ` | תאריך סיום: ${loan.end_date}`;
                if (!includeInPTI) findingText += ` (נותרו ${loan.remaining_months} תשלומים - לא נספר ב-PTI)`;
                if (loan._from_liability_crawler) findingText += ` [נוסף ל-PTI — חיוב חובה קבוע בעו"ש, טרם אומת כהלוואה]`;
                risk_radar.push({ category: loan._from_liability_crawler ? 'חיוב חובה קבוע — נספר ב-PTI' : 'הלוואות קיימות', severity: includeInPTI ? 'MEDIUM' : 'LOW', finding: findingText, recommendation: loan._from_liability_crawler ? 'יש להמציא לוח סילוקין לאישור מהות החיוב.' : (includeInPTI ? 'יש לשקול איחוד חובות' : 'מסתיים בקרוב, אין צורך לאחד') });
            });
        }

        // ── תיקון: אימות סכום מזונות — מקסימום ₪2,000 לילד ──
        // אם ה-AI חילץ סכום כפול (כגון חישוב מחדש לפי מספר ילדים) — השתמש בסכום הנמוך יותר
        // ── שלב 2: Legal Override — עדיפות מסמך משפטי על זיהוי מהעו"ש ──
        // תיקון: מזונות לפי פסק דין (1,400 ₪) גובר על זיהוי מהעו"ש (8,250 ₪)
        const legalAlimonyFromDoc = rawData.divorce_agreement_alimony_monthly || rawData.legal_alimony_override || 0;
        const rawAlimony = legalAlimonyFromDoc > 0 ? legalAlimonyFromDoc : (rawData.alimony_monthly || 0);
        if (legalAlimonyFromDoc > 0 && rawData.alimony_monthly > 0 && Math.abs(legalAlimonyFromDoc - rawData.alimony_monthly) > 200) {
            validation_flags.push({ field: 'alimony_legal_override', severity: 'INFO', message: `Legal Override: מזונות לפי פסק דין ₪${legalAlimonyFromDoc.toLocaleString()} — גובר על זיהוי עו"ש ₪${rawData.alimony_monthly.toLocaleString()}.` });
        }
        const alimonyChildren = rawData.alimony_children_count || 0;
        let alimony_monthly = rawAlimony;
        if (rawAlimony > 0 && alimonyChildren > 0) {
            const perChildAmount = rawData.alimony_per_child_monthly || 0;
            if (perChildAmount > 0) {
                // השתמש בסכום לפי פסק הדין (לילד × מספר ילדים)
                alimony_monthly = perChildAmount * alimonyChildren;
            } else if (rawAlimony > alimonyChildren * 3000) {
                // Sanity cap: מעל ₪3,000 לילד — סביר שה-AI הכפיל
                alimony_monthly = Math.round(rawAlimony / 2);
                validation_flags.push({ field: 'alimony_sanity_cap', severity: 'MEDIUM', message: `מזונות: הסכום המקורי ₪${rawAlimony.toLocaleString()} נראה כפול — תוקן ל-₪${alimony_monthly.toLocaleString()} (${alimonyChildren} ילדים). יש לאמת מול פסק הדין.` });
            }
        }
        if (alimony_monthly > 0) { loans_total_for_pti += alimony_monthly; }
        const child_support_monthly = rawData.child_support_monthly || 0;
        if (child_support_monthly > 0) { loans_total_for_pti += child_support_monthly; risk_radar.push({ category: 'התחייבויות ארוכות טווח', severity: 'MEDIUM', finding: `מזונות ילדים: ₪${child_support_monthly.toLocaleString()}/חודש — נספרים ב-PTI`, recommendation: 'יש לצרף פסק דין/הסכם גירושין.' }); }

        const car_lease_monthly = rawData.car_lease_monthly || 0;
        if (car_lease_monthly > 0) { loans_total_for_pti += car_lease_monthly; risk_radar.push({ category: 'התחייבויות ארוכות טווח', severity: 'MEDIUM', finding: `ליסינג רכב: ₪${car_lease_monthly.toLocaleString()}/חודש — נספר ב-PTI`, recommendation: 'יש לצרף הסכם ליסינג ותאריך סיום.' }); }

        // ─────────────────────────────────────────────────────────
        // SHADOW DEBT DETECTOR — מסונכרן עם buildUnderwriterReport
        // כל תשלום קבוע עגול שחוזר ב‫גרזרת או יותר מפעמיים נכנס אוטומטית ל-PTI
        // ─────────────────────────────────────────────────────────
        const KNOWN_LOAN_KEYWORDS_QC = ['הלוואה', 'משכנתא', 'ליסינג', 'רכב', 'בנק', 'bank', 'ביטוח',
            'מימון ישיר', 'בלנדר', 'blender', 'טריא', 'tria', 'btb', 'עוגן', 'car2go', 'אלבר', 'שלמה'];
        const shadowDebtsQC = [];
        const bankStmtsQC = rawData.bank_statements || [];
        bankStmtsQC.forEach(stmt => {
            const transactions = stmt.transactions || stmt.debits || [];
            const transMap = {};
            transactions.forEach(tx => {
                const amt = Math.abs(tx.amount || 0);
                if (amt < 300 || amt > 15000) return;
                const isRound = amt % 100 === 0 || amt % 50 === 0;
                if (!isRound) return;
                const desc = (tx.description || tx.details || '').toLowerCase();
                if (KNOWN_LOAN_KEYWORDS_QC.some(k => desc.includes(k.toLowerCase()))) return;
                const key = `${Math.round(amt / 50) * 50}`;
                if (!transMap[key]) transMap[key] = { amount: amt, desc: tx.description || '', count: 0 };
                transMap[key].count++;
            });
            Object.values(transMap).forEach(entry => {
                if (entry.count >= 2) {
                    const alreadyInLoans = (rawData.loans || []).some(l =>
                        Math.abs((l.monthly_payment || 0) - entry.amount) < entry.amount * 0.1
                    );
                    if (!alreadyInLoans) {
                        shadowDebtsQC.push({
                            estimated_amount: entry.amount,
                            description: entry.desc,
                            occurrences: entry.count,
                        });
                    }
                }
            });
        });

        // דדופ חובות צל — מוצגים כאזהרה בלבד, לא נספרים ב-PTI עד לאימות ידני
        const shadowDebtsSeen = new Set();
        shadowDebtsQC.forEach(sd => {
            const key = `${Math.round(sd.estimated_amount / 50) * 50}`;
            if (shadowDebtsSeen.has(key)) return;
            shadowDebtsSeen.add(key);
            // לא מוסיפים ל-loans_total_for_pti — דגל בלבד עד לאימות
            risk_radar.push({
                category: 'תשלום קבוע לא מזוהה',
                severity: 'HIGH',
                finding: `תשלום קבוע לא מזוהה: ₪${sd.estimated_amount.toLocaleString()}/חודש (${sd.occurrences} חודשים) | "${sd.description || 'לא ידוע'}" — לא נספר ב-PTI עד לאימות.`,
                recommendation: 'יש לשאול את הלקוח על מקור החיוב ולוודא שנכלל בחישוב ה-PTI'
            });
        });
        const shadowDebtsTotalQC = shadowDebtsQC.reduce((s, d) => {
            const key = `${Math.round(d.estimated_amount / 50) * 50}`;
            return s + d.estimated_amount;
        }, 0);
        const hasShadowDebts = shadowDebtsQC.length > 0;

        if (rawData.rental_income && rawData.rental_income.length > 0) {
            rawData.rental_income.forEach(ri => {
                const rentalAmt = ri.monthly_amount || 0; if (rentalAmt < 500) return;
                const creditedAmt = Math.round(rentalAmt * 0.70);
                if (ri.is_declared) { if (avg_income === 0) avg_income += creditedAmt; else avg_income_2 === 0 ? avg_income_2 += creditedAmt : avg_income += creditedAmt; total_household_income = avg_income + avg_income_2; income_months.push({ month: `שכ"ד — ${ri.property_description || 'נכס להשקעה'}`, gross: rentalAmt, net: creditedAmt, note: `הכנסה משכ"ד מדווחת — בנקים מזקיפים 70% (₪${creditedAmt.toLocaleString()})` }); strengths.push(`הכנסה מנכס להשכרה: ₪${rentalAmt.toLocaleString()}/חודש — ₪${creditedAmt.toLocaleString()} מוכרת לבנק (70%)`); }
                else { risk_radar.push({ category: 'הכנסה משכ"ד לא מדווחת', severity: 'HIGH', finding: `נמצאה הכנסה חודשית קבועה של ₪${rentalAmt.toLocaleString()} שנראית כשכ"ד — אך אינה מופיעה בדוחות המס.`, recommendation: 'הכנסה שאינה מדווחת לרשות המיסים עלולה לחסום אישור משכנתא.' }); missing_docs.push('אישור הכנסה משכ"ד — דיווח לרשות המיסים / שומת מס כולל הכנסה זו'); }
            });
        }

        // ════════════════════════════════════════════════════════════
        // BLOCK 5 — RISK RADAR / ANOMALY SHIELD
        // תפקיד יחיד: זיהוי דגלים אדומים, אזהרות וסיכוני AML
        // כולל: עיקול שכר, הימורים, קריפטו, מינוס כרוני, חובות צל, העברות מטבע חוץ
        // סדר: סקירת תלושים אחרכין דפי עו"ש אחרכין נתוני AI
        // אסטרטגיה: שמרנות (Conservative) — כל חשד → דגל אדום/צהוב
        // מנגנון: הוצאות קרן השתלמות / פנסיה לא נסומנות ב-BDI, הלוואות בין חשבונות עצמיות לא נסומנות
        // ════════════════════════════════════════════════════════════
        const wageGarnishment = rawData.wage_garnishment_detected || [b1PayslipsToUse, b2PayslipsToUse].flat().some(p => p.wage_garnishment === true);
        if (wageGarnishment) { risk_radar.push({ category: 'עיקול שכר', severity: 'critical', finding: 'זוהה עיקול שכר בתלוש אחד מהלווים. עיקול שכר מהווה חסם בנקאי קשה ומצביע על חוב משפטי פתוח.', recommendation: 'חובה לפתור את העיקול לפני כל הגשה לבנק.' }); missing_docs.push('אישור הסרת עיקול שכר — חובה לפני הגשה לבנק'); }

        if (rawData.reserve_duty_months && rawData.reserve_duty_months.length > 0) { risk_radar.push({ category: 'חודשי מילואים זוהו', severity: 'LOW', finding: `זוהו חודשי מילואים: ${rawData.reserve_duty_months.join(', ')}.`, recommendation: 'חודשי מילואים הוחרגו מחישוב ממוצע ההכנסה.' }); }

        if (rawData.gambling_detected) { risk_radar.push({ category: 'הימורים זוהו בעו"ש', severity: 'HIGH', finding: 'זוהו חיובים לפלטפורמות הימורים בחשבון הבנק.', recommendation: 'יש להכין הסבר בכתב ולהפסיק פעילות הימורים לפחות 3 חודשים לפני הגשה.' }); }
        if (rawData.crypto_detected) { risk_radar.push({ category: 'פעילות קריפטו זוהתה', severity: 'HIGH', finding: 'זוהו העברות לבורסות קריפטו.', recommendation: 'יש להכין הצהרת מקור כספים לגבי פעילות הקריפטו.' }); missing_docs.push('הצהרת מקור כספים — פעילות קריפטו זוהתה'); }
        if (rawData.foreign_transfers_detected) { risk_radar.push({ category: 'העברות מטבע חוץ', severity: 'MEDIUM', finding: 'זוהו העברות במטבע חוץ בחשבון.', recommendation: 'יש לצרף אסמכתא על מקור ההעברות.' }); }

        // קרנות — חישוב מוקדם לשימוש ב-chronic overdraft
        const totalKerenBalance = (rawData.keren_hishtalmut || []).reduce((s, k) => s + (k.accumulated_balance || 0), 0);
        const totalPensionBalance = (rawData.pension_funds || []).reduce((s, p) => s + (p.accumulated_balance || 0), 0);

        if (rawData.cash_flow_summary && rawData.cash_flow_summary.length > 0) {
            rawData.cash_flow_summary.forEach(acc => {
                if (acc.chronic_overdraft) {
                    const already = risk_radar.some(r => r.category?.includes('עו"ש') && r.finding?.includes('מינוס'));
                    if (!already) {
                        const liquidFunds = totalKerenBalance + totalPensionBalance;
                        if (acc._overdraft_classification === 'technical') strengths.push(`מינוס חשבון ${acc.account_last4||''} מוסבר (${acc._overdraft_cause||'חיוב חריג'}) — לא מינוס כרוני.`);
                        else if (liquidFunds > 50000) risk_radar.push({ category: 'מינוס — מוקטן ע"י קרנות', severity: 'MEDIUM', finding: `חשבון ${acc.account_last4||''}: יתרה שלילית ₪${(acc.avg_balance||0).toLocaleString()}. קרנות נזילות ₪${Math.round(liquidFunds).toLocaleString()} — גורם מפצה מרכזי.`, recommendation: 'צרף מכתב הסבר + אישור יתרות קרנות.' });
                        else risk_radar.push({ category: 'מינוס כרוני בעו"ש', severity: 'HIGH', finding: `חשבון ${acc.account_last4||''}: יתרה ממוצעת שלילית (₪${(acc.avg_balance||0).toLocaleString()}).`, recommendation: 'יש לטפל במינוס לפני הגשה.' });
                    }
                }
                if ((acc.lowest_balance || 0) < -5000 && !acc.chronic_overdraft) {
                    const isTechnical = acc._overdraft_classification === 'technical';
                    const overdraftSev = isTechnical ? 'LOW' : 'MEDIUM';
                    const overdraftNote = isTechnical ? `זוהה כחריגה טכנית חד-פעמית: ${acc._overdraft_cause || 'חיוב כרטיס חד-פעמי'}. ממוצע חודשי: ₪${(acc.avg_balance || 0).toLocaleString()}.` : `חשבון ${acc.account_last4 || ''}: חריגה מהמסגרת בסך ₪${Math.abs(acc.lowest_balance || 0).toLocaleString()}.`;
                    risk_radar.push({ category: isTechnical ? 'חריגה טכנית חד-פעמית' : 'חריגה ממסגרת האשראי', severity: overdraftSev, finding: overdraftNote, recommendation: isTechnical ? 'חריגה טכנית בלבד — יש לצרף הסבר בכתב.' : 'יש להסביר את אירוע החריגה בכתב לבנק.' });
                }
            });
        }

        if (totalKerenBalance + totalPensionBalance > 50000) {
            const totalFundsDisplay = Math.round(totalKerenBalance + totalPensionBalance);
            const hasOverdraftFlag = (rawData.bank_red_flags || []).some(f => f.toLowerCase().includes('מינוס') || f.toLowerCase().includes('overdraft'));
            const overdraftMitigant = hasOverdraftFlag ? ` — מענה ישיר לחריגות העו"ש: הלווים יכולים לסגור כל מינוס בקריאה אחת` : '';
            strengths.push(`גורם מפצה מרכזי — הון נזיל בקרנות: ₪${totalFundsDisplay.toLocaleString()} (קרן השתלמות ₪${Math.round(totalKerenBalance).toLocaleString()} + פנסיה ₪${Math.round(totalPensionBalance).toLocaleString()})${overdraftMitigant}`);
        }
        if (rawData.pension_funds && rawData.pension_funds.length > 0) { rawData.pension_funds.forEach(pf => { if (pf.is_accessible && (pf.accumulated_balance || 0) > 50000) { strengths.push(`קרן פנסיה/גמל נגישה: ${pf.fund_name || 'קרן'} — יתרה ₪${Math.round(pf.accumulated_balance).toLocaleString()}`); } }); }
        if (rawData.keren_hishtalmut && rawData.keren_hishtalmut.length > 0) { rawData.keren_hishtalmut.forEach(kh => { if (kh.is_accessible && (kh.accumulated_balance || 0) > 30000) { strengths.push(`קרן השתלמות נגישה: ${kh.fund_name || 'קרן'} — יתרה ₪${Math.round(kh.accumulated_balance).toLocaleString()} (בשלה למשיכה)`); } else if (!kh.is_accessible && (kh.accumulated_balance || 0) > 30000) { risk_radar.push({ category: 'קרן השתלמות — לא בשלה', severity: 'LOW', finding: `קרן השתלמות ${kh.fund_name || ''}: יתרה ₪${Math.round(kh.accumulated_balance).toLocaleString()} — עדיין לא ניתן למשיכה. תאריך בשלות: ${kh.maturity_date || 'לא ידוע'}.`, recommendation: 'אם מועד הבשלות קרוב — ניתן לציין כהון עצמי פוטנציאלי בפני הבנק.' }); } }); }

        const loanDescriptions = new Set((rawData.loans || []).map(l => (l.description || '').toLowerCase().substring(0, 10)));
        const LOAN_CARD_SEMANTIC = ['מקס איט', 'max it', 'כאל', 'ישראכרט', 'ויזה כאל', 'לאומי קארד', 'onecard'];
        const loanSemanticKeys = new Set((rawData.loans || []).flatMap(l => LOAN_CARD_SEMANTIC.filter(k => (l.description || '').toLowerCase().includes(k.toLowerCase()))));
        const kerenBalance = (rawData.keren_hishtalmut || []).reduce((s, k) => s + (k.accumulated_balance || 0), 0);
        const pensionBalance = (rawData.pension_funds || []).filter(p => p.is_accessible).reduce((s, p) => s + (p.accumulated_balance || 0), 0);
        const otherEquity = (rawData.equity_events || []).filter(e => e.is_incoming !== false && e.type !== 'הפקדה_לפקדון').reduce((s, e) => s + (e.amount || 0), 0) || 0;
        const totalEquityForCardCheck = rawData.total_equity_evidence || (kerenBalance + pensionBalance + otherEquity) || 0;

        if (rawData.credit_cards && rawData.credit_cards.length > 0) {
            rawData.credit_cards.forEach(card => {
                const cardDescShort = (card.description || '').toLowerCase().substring(0, 10);
                if (loanDescriptions.has(cardDescShort)) return;
                const cardDescFull = (card.description || '').toLowerCase();
                const semanticMatch = LOAN_CARD_SEMANTIC.find(k => cardDescFull.includes(k.toLowerCase()) && loanSemanticKeys.has(k));
                if (semanticMatch) return;
                // ── תיקון חיבור ל-consolidateExtractedData ──
                // המיזוג החדש מחזיר monthly_average / monthly_charge + _monthly_charges (מערך החיובים).
                // קוראים אותם כ-fallback כדי שלא יוצג "ממוצע ₪0" כשבפועל יש חיובים אמיתיים.
                const amountsSeen = (card.monthly_amounts_seen && card.monthly_amounts_seen.length > 0)
                    ? card.monthly_amounts_seen
                    : (Array.isArray(card._monthly_charges) ? card._monthly_charges : []);
                // בתיק איחוד חובות: לא מסירים ספיק — כל חיוב קבוע הוא חוב שצריך להיכנס ל-PTI
                let effectiveMonthlyPayment = card.monthly_payment || card.monthly_average || card.monthly_charge || 0;
                // שם תצוגה: אם אין description אך יש issuer+4 ספרות — בנה אותו
                if (!card.description && card.issuer) {
                    card.description = `${card.issuer}${card.last_four ? ' ' + card.last_four : ''}`;
                }
                if (!isConsolidation && amountsSeen.length >= 2) {
                    const sorted = [...amountsSeen].sort((a, b) => a - b);
                    const max = sorted[sorted.length - 1]; const withoutMax = sorted.slice(0, -1);
                    const avgWithoutSpike = Math.round(withoutMax.reduce((s, v) => s + v, 0) / withoutMax.length);
                    if (avgWithoutSpike > 0 && max / avgWithoutSpike >= 3) { effectiveMonthlyPayment = avgWithoutSpike; }
                }

                // בתיק איחוד חובות: כל כרטיס מעל ₪500/חודש נספר ב-PTI אוטומטית — זו העיקר של תיק איחוד חובות
                if (isConsolidation && effectiveMonthlyPayment > 500) {
                    const alreadyInLoansCheck = (rawData.loans || []).some(l =>
                        Math.abs((l.monthly_payment || 0) - effectiveMonthlyPayment) < effectiveMonthlyPayment * 0.1
                    );
                    if (!alreadyInLoansCheck) {
                        loans_total_for_pti += effectiveMonthlyPayment;
                        risk_radar.push({
                            category: 'כרטיס אשראי — נספר ב-PTI (איחוד חובות)',
                            severity: effectiveMonthlyPayment > 5000 ? 'HIGH' : 'MEDIUM',
                            finding: `כרטיס אשראי: ${card.description || 'לא ידוע'} — ₪${effectiveMonthlyPayment.toLocaleString()}/חודש — נכלל ב-PTI (תיק איחוד חובות: כל חוב צרכני נספר)`,
                            recommendation: 'תיק איחוד חובות — כל התחייבויות הצרכניות נספרות ב-PTI לצורך חישוב מדויק.'
                        });
                    }
                    return; // אל תעבד גם על ידי הלוגיקה הרגילה
                }

                const mortgagePayment = rawData.existing_mortgage?.monthly_payment || 0;
                const isLikelyMortgageCharge = mortgagePayment > 0 && Math.abs(effectiveMonthlyPayment - mortgagePayment) < 200;
                if (isLikelyMortgageCharge) return;
                const avgBankBalance = (rawData.cash_flow_summary || []).reduce((s, acc) => s + (acc.avg_balance || 0), 0);
                const isHighBalanceAccount = (avgBankBalance > effectiveMonthlyPayment * 5 && avgBankBalance > 50000) || (totalEquityForCardCheck > 150000);
                const isSuspicious = !isHighBalanceAccount && (card.is_suspicious || effectiveMonthlyPayment > 15000);
                const isHighVariance = amountsSeen.length >= 2 && (Math.max(...amountsSeen) / Math.max(1, Math.min(...amountsSeen))) > 3;

                // ══ RED FLAG RULE: הוצאה בכרטיס בודד > 50% מהכנסת משק הבית → דגל אדום בלבד, לא נספר ב-PTI ══
                const cardVsIncome50Pct = total_household_income > 0 && effectiveMonthlyPayment > total_household_income * 0.5;
                if (cardVsIncome50Pct) {
                    risk_radar.push({
                        category: 'RED FLAG — הוצאת אשראי חריגה מאוד',
                        severity: 'HIGH',
                        finding: `כרטיס אשראי: ${card.description || 'לא ידוע'} — ₪${effectiveMonthlyPayment.toLocaleString()}/חודש (${Math.round(effectiveMonthlyPayment/total_household_income*100)}% מהכנסת משק הבית). חיוב בודד > 50% הכנסה — חשד להלוואה מוסתרת. ${amountsSeen.length > 0 ? `(סכומים: ${amountsSeen.map(m => '₪' + m.toLocaleString()).join(', ')})` : ''} — לא נספר ב-PTI.`,
                        recommendation: 'חובה לדרוש מהלקוח הסבר בכתב + תדפיס 3 חודשים מחברת הכרטיס.'
                    });
                    return; // לא מוסיפים ל-PTI — דגל אדום בלבד
                }

                if (isSuspicious) {
                  // כרטיסים חשודים מעל ₪3,000 — נכללים ב-PTI בכל מקרה (גישה שמרנית)
                  // בתיקי מחזור: כרטיסי אשראי לעולם לא נספרים ב-PTI — הוצאה שוטפת בלבד
                  if (effectiveMonthlyPayment > 3000 && !isRefinanceCase) {
                    loans_total_for_pti += effectiveMonthlyPayment;
                    risk_radar.push({ category: 'דורש אימות ידני', severity: isHighVariance ? 'MEDIUM' : 'HIGH', finding: `כרטיס אשראי: ${card.description || 'לא ידוע'} — חיוב חודשי: ₪${effectiveMonthlyPayment.toLocaleString()}. ${amountsSeen.length > 0 ? `(סכומים: ${amountsSeen.map(m => '₪' + m.toLocaleString()).join(', ')})` : ''} — נכלל ב-PTI (חיוב > ₪3,000 גישה שמרנית).`, recommendation: 'יש לאמת מהות החיוב לפני הגשה לבנק.' });
                  } else if (effectiveMonthlyPayment > 3000 && isRefinanceCase) {
                    // מחזור: כרטיס חשוד מוצג כאזהרה בלבד, לא נספר ב-PTI
                    risk_radar.push({ category: 'הוצאות אשראי גבוהות — לבירור', severity: 'MEDIUM', finding: `כרטיס אשראי: ${card.description || 'לא ידוע'} — חיוב חודשי: ₪${effectiveMonthlyPayment.toLocaleString()}. ${amountsSeen.length > 0 ? `(סכומים: ${amountsSeen.map(m => '₪' + m.toLocaleString()).join(', ')})` : ''} — הוצאה צרכנית שוטפת, לא נספרת ב-PTI (תיק מחזור).`, recommendation: 'יש לבדוק אם הוצאה זו תואמת להכנסה — לתשומת לב הבנקאי.' });
                  } else {
                    risk_radar.push({ category: 'דורש אימות ידני', severity: isHighVariance ? 'MEDIUM' : 'HIGH', finding: `כרטיס אשראי: ${card.description || 'לא ידוע'} — חיוב חודשי: ₪${effectiveMonthlyPayment.toLocaleString()}. ${amountsSeen.length > 0 ? `(סכומים: ${amountsSeen.map(m => '₪' + m.toLocaleString()).join(', ')})` : ''} — לא נספר בחישוב יחס ההחזר עד לאימות.`, recommendation: 'יש לאמת מהות החיוב לפני הגשה לבנק.' });
                  }
                }
                else if (isHighVariance) { risk_radar.push({ category: 'פיזור גבוה בין חודשים', severity: 'MEDIUM', finding: `כרטיס אשראי: ${card.description || 'לא ידוע'} — ממוצע: ₪${effectiveMonthlyPayment.toLocaleString()} | שונות גבוהה: ${amountsSeen.map(m => '₪' + m.toLocaleString()).join(', ')}`, recommendation: 'בדוק חיוב חריג.' }); }
                else {
                  // ── כרטיסי אשראי רגילים = הוצאה צרכנית שוטפת — לא נכנסים ל-PTI ──
                  // לפי שיטת חיתום בנקאית: כרטיסי אשראי אינם התחייבות פיננסית אלא הוצאה שוטפת
                  // חריג: כרטיס > 50% הכנסה (RED FLAG) או תיק איחוד חובות — כבר טופל למעלה
                  const cardSeverity = effectiveMonthlyPayment > 8000 ? 'MEDIUM' : 'LOW';
                  const cardCategory = effectiveMonthlyPayment > 8000 ? 'הוצאות אשראי גבוהות' : 'הוצאות אשראי שוטפות';
                  risk_radar.push({ category: cardCategory, severity: cardSeverity,
                    finding: `כרטיס אשראי: ${card.description || 'לא ידוע'} — חיוב חודשי ממוצע: ₪${effectiveMonthlyPayment.toLocaleString()} — הוצאה צרכנית שוטפת, לא נספרת ב-PTI.`,
                    recommendation: effectiveMonthlyPayment > 8000 ? 'חיוב גבוה — מומלץ לוודא שאינו הלוואת כרטיס.' : 'הוצאה שוטפת — לא נספרת ב-PTI.' });
                }
            });
        }

        // ════════════════════════════════════════════════════════════
        // BLOCK 4 — PTI CALCULATOR
        // תפקיד יחיד: חישוב יחס החזר (PTI) והבדיקה מול המגבלות הבנקאיות
        // כללי: סך ההתחייבויות / הכנסה כוללת הבית ≤ 40% = תקין
        // PTI צרכני: הלוואות + אשראי + מזונות + ליסינג (ללא משכנתא)
        // PTI ריאלי: PTI צרכני + המשכנתא החדשה המוצעת (אם צוין)
        // תיק מחזור: המשכנתא הישנה נסגרת, PTI מחושב מחדש מאפס (עם המשכנתא החדשה)
        // מנגנון: משכנתא קיימת לא נספרת פעמיים בתיק מחזור (כבר מטופל ב-BLOCK 3)
        // ════════════════════════════════════════════════════════════
        const max_allowed_mortgage_payment = total_household_income > 0 ? Math.round(total_household_income * 0.40) : 0;
        let total_monthly_debt = loans_total_for_pti;
        if (rawData.existing_mortgage?.monthly_payment) {
            if (!isRefinanceCase) {
                total_monthly_debt += rawData.existing_mortgage.monthly_payment;
                risk_radar.push({ category: 'משכנתא קיימת', severity: 'HIGH', finding: `זוהתה משכנתא קיימת (₪${rawData.existing_mortgage.monthly_payment.toLocaleString()}/חודש) שנספרת ב-PTI.`, recommendation: 'אם הנכס נמכר לפני/בו-זמנית עם הרכישה — יש לצרף חוזה מכירה.' });
            }
        }

        // ─────────────────────────────────────────────────────────
        // PTI TOTAL: כולל גם המשכנתא החדשה המוצעת
        // בתיק מחזור: PTI הצרכני (ללא המשכנתא הישנה) + המשכנתא החדשה
        // ─────────────────────────────────────────────────────────
        const proposedPayment = proposedMortgagePayment || 0;
        let total_monthly_debt_with_proposed = total_monthly_debt + proposedPayment;

        // PTI ריאלי בתיק מחזור: הלוואות צרכניות + המשכנתא החדשה
        // (המשכנתא הישנה לא נכנסת — היא נסגרת)
        let pti_with_proposed = total_household_income > 0 ? (total_monthly_debt_with_proposed / total_household_income) * 100 : 0;

        let pti_ratio = total_household_income > 0 ? (total_monthly_debt / total_household_income) * 100 : 0;
        const available_for_mortgage = Math.max(0, max_allowed_mortgage_payment - loans_total_for_pti);

        if (rawData.property_value && rawData.property_value < 100000) rawData.property_value = null;
        const effectivePropertyValue = manualPropertyValue || rawData.property_value || 0;
        if (manualPropertyValue && manualPropertyValue > 0 && !rawData.property_value) { rawData.property_value = manualPropertyValue; }

        // ══ OPPORTUNITY HOOK — חיסכון פוטנציאל מחזור ══
        // "החזר נוכחי" = החזר משכנתא בלבד (לא כרטיסי אשראי/הוצאות צרכניות)
        // כרטיסי אשראי הם הוצאה שוטפת, לא חלק מהחזר המשכנתא שניתן למחזר
        const mortgageCurrentPayment = rawData.existing_mortgage?.monthly_payment || 0;
        const opportunityHook = (() => {
            if (!isRefinanceCase || mortgageCurrentPayment <= 0) return null;
            const NEW_RATE = 4.0;
            const balance = rawData.existing_mortgage?.remaining_balance || 0;
            const months = rawData.existing_mortgage?.remaining_months || 240;
            if (!balance) return null;
            const r = NEW_RATE / 100 / 12;
            const newPayment = Math.round(balance * r * Math.pow(1 + r, months) / (Math.pow(1 + r, months) - 1));
            const saving = Math.max(0, mortgageCurrentPayment - newPayment);
            if (saving <= 50) return null; // חיסכון זניח
            const ptiBefore = total_household_income > 0 ? parseFloat(((mortgageCurrentPayment / total_household_income) * 100).toFixed(1)) : 0;
            const ptiAfter  = total_household_income > 0 ? parseFloat(((newPayment / total_household_income) * 100).toFixed(1)) : 0;
            return {
                is_relevant: true,
                label: 'פוטנציאל מיחזור משכנתא',
                current_monthly_total: mortgageCurrentPayment,
                estimated_new_payment: newPayment,
                monthly_savings: saving,
                pti_before: ptiBefore,
                pti_after: ptiAfter,
                total_income: total_household_income,
            };
        })();

        // PTI הצרכני (ללא משכנתא)
        if (pti_ratio > 0 && pti_ratio < 35) { strengths.push(`יחס החזר (PTI) צרכני מצוין: ${pti_ratio.toFixed(1)}% (ללא המשכנתא) מתוך מקסימום מותר 40%`); }
        else if (pti_ratio >= 35 && pti_ratio <= 40) { risk_radar.push({ category: 'כושר החזר', severity: 'MEDIUM', finding: `יחס החזר PTI צרכני של ${pti_ratio.toFixed(1)}% — גבולי`, recommendation: 'ניתן לאשר, אין מרווח להגדלה.' }); }
        else if (pti_ratio > 40) { risk_radar.push({ category: 'כושר החזר', severity: 'HIGH', finding: `יחס החזר PTI צרכני של ${pti_ratio.toFixed(1)}% חורג מ-40%. הכנסה: ₪${total_household_income.toLocaleString()} | התחייבויות: ₪${total_monthly_debt.toLocaleString()}`, recommendation: isConsolidation ? 'מחזור ואיחוד חובות יפתור את הבעיה' : 'יש לסגור חלק מהחובות לפני הגשה.' }); }

        // PTI ריאלי כולל המשכנתא החדשה המוצעת
        if (proposedPayment > 0) {
            const ptiLabel = pti_with_proposed < 35 ? 'מצוין' : pti_with_proposed <= 40 ? 'גבולי' : 'חריג';
            if (pti_with_proposed <= 40) { strengths.push(`PTI ריאלי כולל משכנתא חדשה (₪${proposedPayment.toLocaleString()}/חודש): ${pti_with_proposed.toFixed(1)}% — ${ptiLabel}`); }
            else { risk_radar.push({ category: 'PTI ריאלי כולל משכנתא חדשה', severity: 'HIGH', finding: `PTI ריאלי לאחר תשלום המשכנתא החדשה (₪${proposedPayment.toLocaleString()}/חודש): ${pti_with_proposed.toFixed(1)}% — חורג מ-40%.`, recommendation: 'יש להגדיל הכנסות, להפחית הלוואות, או לבחון תקופה ארוכה יותר.' }); }
        } else if (isRefinanceCase && rawData.existing_mortgage?.monthly_payment) {
            // אם לא הוזן proposed — הצג estimation מהמשכנתא הקיימת כ-PTI ריאלי
            const existingPmt = rawData.existing_mortgage.monthly_payment;
            const estimatedTotal = loans_total_for_pti + existingPmt;
            const estimatedPTI = total_household_income > 0 ? parseFloat(((estimatedTotal / total_household_income) * 100).toFixed(1)) : 0;
            const ptiEstLabel = estimatedPTI < 35 ? 'מצוין' : estimatedPTI <= 40 ? 'גבולי' : 'חריג';
            if (estimatedPTI <= 40) {
                strengths.push(`PTI ריאלי משוער (הלוואות + המשכנתא הנוכחית ₪${existingPmt.toLocaleString()}/חודש): ${estimatedPTI.toFixed(1)}% — ${ptiEstLabel}`);
            } else {
                risk_radar.push({ category: 'PTI ריאלי — חריג', severity: 'HIGH', finding: `PTI ריאלי (הלוואות + משכנתא קיימת ₪${existingPmt.toLocaleString()}/חודש): ${estimatedPTI.toFixed(1)}% — חריג מ-40%.`, recommendation: 'יש לסגור חלק מהחובות לפני הגשה לבנק, או לבחון מחזור/איחוד חובות.' });
            }
        }

        strengths.push(`תשלום משכנתא מקסימלי מותר (40% מהכנסה): ₪${max_allowed_mortgage_payment.toLocaleString()} | כושר החזר פנוי למשכנתא: ₪${available_for_mortgage.toLocaleString()}`);

        if (rawData.property_value) {
            const ltvStr = rawData.existing_mortgage?.remaining_balance ? Math.round((rawData.existing_mortgage.remaining_balance / rawData.property_value) * 100) : 0;
            const ltvSrc = rawData._normalization?.property_value_source === 'tabu' ? ' (נסח טאבו)' : '';
            strengths.push(`שווי נכס: ₪${rawData.property_value.toLocaleString()}${ltvSrc}${ltvStr > 0 ? ` | LTV: ${ltvStr}%` : ''}`);
            if (ltvStr > 0 && ltvStr <= 50) strengths.push(`LTV מצוין: ${ltvStr}% — נכס מגובה בהון עצמי גבוה מאוד.`);
        }

        // ════════════════════════════════════════════════════════════
        // BLOCK 6 — GAP ANALYSIS / MISSING DOCS
        // תפקיד יחיד: טיווח רשימת מסמכים חסרים לפי סוג התיק וסטטוס הלוואים
        // כללי: מסמכי חובה = חיוני להגשה, מומלץ = משפר אישור
        // מסמכים דינמיים לפי סוג תיק:
        //   רכישה: תלושים, עו"ש, תעודת זהות
        //   מחזור: + יתרת משכנתא, חוזה עבודה אם נדרש
        //   עצמאי: שומות מס, מכתב רו"ח
        //   שבתון/חל"ת/לידה: תלושים לפני, מכתב חזרה
        // מנגנון: לא מוסיף מסמך שכבר קיים בתיק, לא משכפל מסמכים
        // סינכרון: מיויץ עם Checklist של buildUnderwriterReport
        // ════════════════════════════════════════════════════════════
        // ---------------------------------------------------------
        // STEP 2.5: EARLY WARNING BANNERS — חייב לפני STEP 3
        // ─────────────────────────────────────────────────────────
        const earlyWarningBanners = [];

        const allBorrowersForBanners = [
            { borrower: borrower1, label: borrower1.name || 'לווה 1', payslips: b1PayslipsToUse },
            ...(borrower2.name ? [{ borrower: borrower2, label: borrower2.name || 'לווה 2', payslips: b2PayslipsToUse }] : [])
        ];

        allBorrowersForBanners.forEach(({ borrower, label, payslips }) => {
            const empType = (borrower.employment_type || '').toLowerCase();
            const specialNote = (borrower.special_status_note || '').toLowerCase();
            const isSabbatical = empType.includes('שבתון') || specialNote.includes('שבתון');
            const isOnLeaveTemp = empType.includes('חל"ת') || empType.includes('חלת') || empType.includes('חופשה ללא תשלום');
            const isMaternity = empType.includes('לידה') || empType.includes('הריון') || empType.includes('חופשת לידה') || specialNote.includes('לידה') || specialNote.includes('הריון');
            const isTemporaryLeave = isSabbatical || isOnLeaveTemp || isMaternity;
            if (!isTemporaryLeave) return;

            const leaveTypeLabel = isSabbatical ? 'שבתון' : isOnLeaveTemp ? 'חל"ת' : 'חופשת לידה';

            const hasPreSlips = payslips.length > 0 && payslips.some(p => {
                const notes = (p.notes || '').toLowerCase();
                const notLeaveSlip = !notes.includes('דמי לידה') && !notes.includes('שבתון') && !notes.includes('קה"ל') && !notes.includes('ביטוח לאומי');
                return (p.gross_salary || 0) > 1000 && notLeaveSlip;
            });

            const hasReturnLetter = (rawData.special_circumstances || []).some(s =>
                s.includes('חזרה לעבודה') || s.includes('אישור מעסיק') || s.includes('מכתב חזרה') || s.includes('מכתב שבתון')
            );

            const missingItems = [];
            if (!hasPreSlips) missingItems.push(`3 תלושי שכר לפני תחילת ה${leaveTypeLabel}`);
            if (!hasReturnLetter) missingItems.push(`מכתב חזרה לעבודה עם תאריך חזרה מהמעסיק`);

            if (missingItems.length > 0) {
                earlyWarningBanners.push({
                    borrower_name: label,
                    leave_type: leaveTypeLabel,
                    severity: 'critical',
                    message: `${label} נמצא/ת ב${leaveTypeLabel} — נתוני ההכנסה אינם מהימנים לחלוטין`,
                    details: `ניתוח ממשיך לרוץ אך מסמכים קריטיים חסרים. יש להשלים לפני קבלת החלטה סופית:`,
                    missing_items: missingItems,
                    action: `השלם את המסמכים החסרים ובצע ניתוח מחדש לקבלת תמונה מלאה ומהימנה.`
                });
            }
        });

        // ---------------------------------------------------------
        // STEP 3: BUILD SUMMARY
        // ---------------------------------------------------------
        const fmtSeniorityShort = (years) => { if (!years) return null; const fullYears = Math.floor(years); const months = Math.round((years - fullYears) * 12); if (fullYears === 0) return months === 1 ? 'חודש' : `${months} חודשים`; const yearsLabel = fullYears === 1 ? 'שנה' : fullYears === 2 ? 'שנתיים' : `${fullYears} שנים`; if (months === 0) return yearsLabel; return `${yearsLabel} ו-${months} חודשים`; };
        const ptiStr = pti_ratio > 0 ? `${pti_ratio.toFixed(1)}%` : '0.0%';
        const ptiLabel = pti_ratio === 0 ? 'ללא התחייבויות' : pti_ratio < 35 ? 'מצוין' : pti_ratio <= 40 ? 'גבולי' : 'חריג';

        // הוספת אזהרה מוקדמת לראש ה-executive_summary אם קיימים banners
        let executive_summary = '';
        if (earlyWarningBanners.length > 0) {
            executive_summary += `אזהרת חיתום — נדרש השלמת מסמכים לפני קבלת החלטה:\n`;
            earlyWarningBanners.forEach(w => {
                executive_summary += `• ${w.message}\n`;
                w.missing_items.forEach(item => { executive_summary += `  ↳ חסר: ${item}\n`; });
                executive_summary += `  → ${w.action}\n`;
            });
            executive_summary += `\n${'━'.repeat(50)}\n\n`;
        }
        executive_summary += `סוג תיק: ${detectedTypes.join(', ') || reportType}\n\n`;
        executive_summary += `לווה 1: ${borrower1.name || 'לא זוהה'} | ת.ז. ${borrower1.id || '—'}`;
        if (borrower1.birth_date) executive_summary += ` | ת. לידה: ${borrower1.birth_date}`;
        if (borrower1.id_issue_date && borrower1.id_issue_date !== 'null' && borrower1.id_issue_date !== 'undefined') executive_summary += ` | הנפקה: ${borrower1.id_issue_date}`;
        if (borrower1.employer) executive_summary += ` | מעסיק: ${borrower1.employer}`;
        if (borrower1.employment_type) executive_summary += ` | סטטוס: ${borrower1.employment_type}`;
        if (borrower1.seniority_years) executive_summary += ` | ותק: ${fmtSeniorityShort(borrower1.seniority_years)}`;
        executive_summary += '\n';
        if (borrower2.name) {
            executive_summary += `לווה 2: ${borrower2.name} | ת.ז. ${borrower2.id || '—'}`;
            if (borrower2.birth_date) executive_summary += ` | ת. לידה: ${borrower2.birth_date}`;
            if (borrower2.id_issue_date && borrower2.id_issue_date !== 'null' && borrower2.id_issue_date !== 'undefined') executive_summary += ` | הנפקה: ${borrower2.id_issue_date}`;
            if (borrower2.employer) executive_summary += ` | מעסיק: ${borrower2.employer}`;
            if (borrower2.employment_type) executive_summary += ` | סטטוס: ${borrower2.employment_type}`;
            if (borrower2.seniority_years) executive_summary += ` | ותק: ${fmtSeniorityShort(borrower2.seniority_years)}`;
            executive_summary += '\n';
        }
        executive_summary += `\nהכנסה חודשית נטו — משק הבית: ₪${total_household_income.toLocaleString()}`;
        if (avg_income > 0) executive_summary += ` (לווה 1: ₪${avg_income.toLocaleString()}`;
        if (avg_income_2 > 0) executive_summary += ` | לווה 2: ₪${avg_income_2.toLocaleString()}`;
        if (avg_income > 0) executive_summary += ')';
        if (rawData.property_value) { const ltvS = rawData.existing_mortgage?.remaining_balance ? Math.round((rawData.existing_mortgage.remaining_balance / rawData.property_value) * 100) : null; const pvS = rawData._normalization?.property_value_source === 'tabu' ? ' (נסח טאבו)' : ''; executive_summary += `\nשווי נכס: ₪${rawData.property_value.toLocaleString()}${pvS}${ltvS ? ` | LTV: ${ltvS}%` : ''}`; }
        executive_summary += `\nיחס החזר (PTI) צרכני: ${ptiStr} — ${ptiLabel}`;
        if (proposedPayment > 0) { executive_summary += `\nPTI ריאלי (כולל משכנתא חדשה ₪${proposedPayment.toLocaleString()}): ${pti_with_proposed.toFixed(1)}%`; }
        executive_summary += `\nתשלום מקסימלי מותר (40%): ₪${max_allowed_mortgage_payment.toLocaleString()} | כושר החזר פנוי: ₪${available_for_mortgage.toLocaleString()}`;
        if (isRefinanceCase && rawData.existing_mortgage?.remaining_balance) { executive_summary += `\nמשכנתא קיימת: ₪${rawData.existing_mortgage.remaining_balance.toLocaleString()} | בנק: ${rawData.existing_mortgage.bank_name || 'לא צוין'} | החזר: ₪${rawData.existing_mortgage.monthly_payment?.toLocaleString() || 'לא ידוע'}/חודש`; }
        if (rawData.special_circumstances?.length > 0) { executive_summary += `\n\nנסיבות מיוחדות: ${rawData.special_circumstances.join(' | ')}`; }

        if (available_for_mortgage > 500) {
            const calcMaxLoanSummary = (pmt, r, y) => { const mr = r / 12; const n = y * 12; return Math.round(pmt * (1 - Math.pow(1 + mr, -n)) / mr); };
            const max25 = calcMaxLoanSummary(available_for_mortgage, 0.05, 25); const max30 = calcMaxLoanSummary(available_for_mortgage, 0.05, 30);
            executive_summary += `\n\nהלוואה מקסימלית מומלצת (ריבית 5%):\n• 25 שנה: ₪${max25.toLocaleString()}\n• 30 שנה: ₪${max30.toLocaleString()}`;
        }
        executive_summary += `\n\nסיכום: ${risk_radar.filter(r => r.severity === 'HIGH' || r.severity === 'critical').length} ממצאים קריטיים זוהו. ${missing_docs.length} מסמכים חסרים. ${strengths.length} נקודות חוזק.`;
        if (hasShadowDebts) {
            executive_summary += `\n\nהערת חיתום — חובות צל: החישוב כולל הערכה של ${shadowDebtsQC.length} התחייבויות נוספות שזוהו בדפי הבנק (₪${shadowDebtsTotalQC.toLocaleString()}/חודש). ממצאים אלו שוקללו ב-PTI לטובת דיוק מירבי. ניתן לבטל אותם ידנית במרכז החיתום המוסדי.`;
        }

        const calcAgeForContext = (birthDateStr, fallbackAge) => { if (!birthDateStr) return fallbackAge; let d; try { if (/^\d{2}\.\d{2}\.\d{4}$/.test(birthDateStr)) { const [day, month, year] = birthDateStr.split('.'); d = new Date(year, month - 1, day); } else if (/^\d{4}-\d{2}-\d{2}$/.test(birthDateStr)) { d = new Date(birthDateStr); } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(birthDateStr)) { const [day, month, year] = birthDateStr.split('/'); d = new Date(year, month - 1, day); } if (!d || isNaN(d.getTime())) return fallbackAge; const now = new Date(); let age = now.getFullYear() - d.getFullYear(); const m = now.getMonth() - d.getMonth(); if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--; return age; } catch(e) { return fallbackAge; } };
        const b1AgeFinal = calcAgeForContext(borrower1.birth_date, borrower1.age);
        const b2AgeFinal = calcAgeForContext(borrower2.birth_date, borrower2.age);

        // ---------------------------------------------------------
        // STEP 4: VALIDATION
        // ---------------------------------------------------------
        const calcAgeFromDate = (birthDateStr) => { if (!birthDateStr) return null; let d; if (/^\d{2}\.\d{2}\.\d{4}$/.test(birthDateStr)) { const [day, month, year] = birthDateStr.split('.'); d = new Date(year, month - 1, day); } else if (/^\d{4}-\d{2}-\d{2}$/.test(birthDateStr)) { d = new Date(birthDateStr); } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(birthDateStr)) { const [day, month, year] = birthDateStr.split('/'); d = new Date(year, month - 1, day); } else return null; if (isNaN(d.getTime())) return null; const now = new Date(); let age = now.getFullYear() - d.getFullYear(); const m = now.getMonth() - d.getMonth(); if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--; return age; };
        const b1AgeCalc = calcAgeFromDate(borrower1.birth_date);
        const b2AgeCalc = calcAgeFromDate(borrower2.birth_date);
        if (b1AgeCalc !== null) { borrower1.age = b1AgeCalc; }
        if (b2AgeCalc !== null) { borrower2.age = b2AgeCalc; }
        [{ b: borrower1, label: 'לווה 1' }, { b: borrower2, label: 'לווה 2' }].forEach(({ b, label }) => { if (b.age !== undefined && b.age !== null) { if (b.age < 18 || b.age > 100) { validation_flags.push({ field: `age_invalid_${label}`, severity: 'HIGH', message: `גיל ${label} = ${b.age} — לא סביר. יש לאמת ידנית.` }); b.age = null; } } });

        const incomeWasNormalized = income_months.some(m => (m.note || '').includes('זיהוי כירורגי'));
        const hasOneTimeFlag = validation_flags.some(f => f.field === 'one_time_income_detected');
        if (!incomeWasNormalized && !hasOneTimeFlag) {
            const reCalcAvgNet = (slips) => { if (!slips || slips.length === 0) return null; const activeSlips = slips.filter(p => !p._skip_in_avg && (p.net_salary || 0) > 0); if (activeSlips.length === 0) return null; return Math.round(activeSlips.reduce((s, p) => s + (p.net_salary || 0) + (p._espp_addback || p.espp_deduction || 0), 0) / activeSlips.length); };
            const reCalcB1 = reCalcAvgNet(b1PayslipsToUse); const reCalcB2 = reCalcAvgNet(b2PayslipsToUse);
            if (reCalcB1 !== null && !isBusinessCase && Math.abs(reCalcB1 - avg_income) > 200) { avg_income = reCalcB1; total_household_income = avg_income + avg_income_2; }
            if (reCalcB2 !== null && !isBusinessCase && Math.abs(reCalcB2 - avg_income_2) > 200) { avg_income_2 = reCalcB2; total_household_income = avg_income + avg_income_2; }
        }
        if (total_household_income > 15000) strengths.push(`הכנסה גבוהה ויציבה למשק הבית (₪${total_household_income.toLocaleString()})`); (rawData._financial_strengths || []).forEach(fs => { if (fs.is_strength && fs.description && !strengths.some(s => s.includes((fs.label || '').substring(0, 12)))) strengths.push(`${fs.label}: ${fs.description}`); }); if (rawData._salary_advance_alert) risk_radar.push({ category: 'מקדמת שכר זוהתה', severity: 'MEDIUM', finding: rawData._salary_advance_alert, recommendation: 'יש לוודא מול הלקוח שאין מדובר בהלוואה נגררת.' });

        [borrower1, borrower2].forEach((b, i) => {
            const isSabb = (b.employment_type || '').toLowerCase().includes('שבתון');
            const isEduc = b.employer && (b.employer.includes('חינוך') || b.employer.includes('הוראה'));
            if (isSabb && isEduc && b.seniority_years && b.seniority_years < 2) {
                validation_flags.push({ field: `seniority_sabbatical_b${i+1}`, severity: 'HIGH', message: `ותק לווה ${i+1} (${b.name || ''}) = ${b.seniority_years} שנים — סביר שזה תאריך תחילת שבתון, לא תאריך תחילת עבודה.` });
                const seniorityIdx = risk_radar.findIndex(r => r.category?.includes('ותק נמוך') && (r.finding || '').includes(b.name || `לווה ${i+1}`));
                if (seniorityIdx >= 0) { risk_radar[seniorityIdx].severity = 'MEDIUM'; risk_radar[seniorityIdx].finding += ' [ייתכן שהותק מחושב מתאריך תחילת השבתון — יש לאמת]'; }
            }
        });

        if (total_household_income > 0 && loans_total_for_pti > 0) { const sanityPTI = (loans_total_for_pti / total_household_income) * 100; if (Math.abs(sanityPTI - (total_monthly_debt / total_household_income * 100)) > 5) { validation_flags.push({ field: 'pti_sanity', severity: 'MEDIUM', message: `PTI sanity check: loans_total=${loans_total_for_pti} / income=${total_household_income} = ${sanityPTI.toFixed(1)}%` }); } }
        if (rawData.existing_mortgage?.average_interest_rate) { const rate = rawData.existing_mortgage.average_interest_rate; if (rate > 8 || rate < 1) { validation_flags.push({ field: 'interest_rate_sanity', severity: 'HIGH', message: `ריבית ממוצעת ${rate}% חריגה — בדוק אם ה-AI קרא נכון (נורמה: 2%-7%)` }); } }

        const validation_warnings = [];
        const b1Name = borrower1.name || ''; const b1Id = borrower1.id || '';
        if (!b1Name || b1Name === 'לא ידוע' || b1Name === 'N/A') { validation_warnings.push({ field: 'שם לווה 1', message: 'שם לווה 1 לא זוהה — נדרש אימות ידני', severity: 'HIGH' }); }
        if (!b1Id || b1Id.replace(/\D/g, '').length !== 9) { validation_warnings.push({ field: 'ת"ז לווה 1', message: 'ת"ז לווה 1 לא זוהתה או לא תקינה — בדוק מסמך מזהה', severity: 'HIGH' }); }
        if (total_household_income === 0) { validation_warnings.push({ field: 'הכנסה', message: 'הכנסת משק הבית לא חושבה — העלה תלושי שכר / מסמכי הכנסה', severity: 'HIGH' }); }
        if (borrower2.name && (!borrower2.id || borrower2.id.replace(/\D/g, '').length !== 9)) { validation_warnings.push({ field: 'ת"ז לווה 2', message: 'ת"ז לווה 2 לא זוהתה או לא תקינה — בדוק מסמך מזהה', severity: 'MEDIUM' }); }

        const finalPTI = total_household_income > 0 ? parseFloat(((total_monthly_debt / total_household_income) * 100).toFixed(1)) : 0;
        const finalPTIWithProposed = proposedPayment > 0 && total_household_income > 0 ? parseFloat(((total_monthly_debt_with_proposed / total_household_income) * 100).toFixed(1)) : null;
        const finalMaxPayment = total_household_income > 0 ? Math.round(total_household_income * 0.40) : 0;
        const finalAvailable = Math.max(0, finalMaxPayment - loans_total_for_pti);
        const finalPropertyValue = manualPropertyValue || rawData.property_value || 0;
        const finalLTV = finalPropertyValue > 0 && rawData.existing_mortgage?.remaining_balance ? parseFloat(((rawData.existing_mortgage.remaining_balance / finalPropertyValue) * 100).toFixed(1)) : null;

        // ── שלב 5: Sanity Check — בקרת איכות PTI בין דוחות ──
        // אם PTI השתנה >5% מהדו"ח המהיר — מסמן לבדיקה ידנית לפני הפקת PDF
        const previousPTI = rawData._previous_quick_pti || null;
        if (previousPTI !== null && Math.abs(finalPTI - previousPTI) > 5) {
            validation_flags.push({ field: 'pti_sanity_check', severity: 'HIGH', message: `Sanity Check: PTI השתנה ${previousPTI.toFixed(1)}% → ${finalPTI.toFixed(1)}% (הפרש ${Math.abs(finalPTI - previousPTI).toFixed(1)}%). נדרש אישור ידני לפני הפקת PDF.` });
            risk_radar.push({ category: 'Sanity Check — סתירה בין דוחות', severity: 'critical', finding: `PTI השתנה ב-${Math.abs(finalPTI - previousPTI).toFixed(1)}% בין ריצות. ייתכן שנתוני התחייבויות שונים הוזנו.`, recommendation: 'יש לבדוק ידנית לפני הגשה לבנק.' });
        }

        if (finalPTI === 0 && (rawData.undisclosed_loan_indicators || []).length > 0) {
            validation_flags.push({ field: 'pti_zero_with_suspicions', severity: 'HIGH', message: `PTI מוצג כ-0% אך זוהו ${rawData.undisclosed_loan_indicators.length} תנועות קבועות שלא אומתו כהלוואות.` });
            risk_radar.push({ category: 'PTI — אימות נדרש', severity: 'HIGH', finding: `PTI מוצג כ-0% אך המערכת זיהתה תנועות חובה קבועות שטרם אומתו כהלוואות.`, recommendation: 'יש לקבל ריכוז הלוואות מלא ולאמת את ה-PTI האמיתי לפני הגשה לבנק.' });
        }

        const translateToHebrew = (text) => { if (!text) return text; return text.replace(/Borrower\s*1/gi, 'לווה 1').replace(/Borrower\s*2/gi, 'לווה 2').replace(/sabbatical/gi, 'שבתון').replace(/maternity leave/gi, 'חופשת לידה').replace(/unpaid leave/gi, 'חל"ת').replace(/salaried/gi, 'שכיר').replace(/self.?employed/gi, 'עצמאי').replace(/chronic overdraft/gi, 'חריגה מתמשכת ממסגרת האשראי').replace(/negative monthly cash.?flow/gi, 'פער תזרימי חודשי').replace(/negative cash.?flow/gi, 'תזרים מזומנים שלילי').replace(/cash.?flow/gi, 'תזרים מזומנים').replace(/negative balance/gi, 'יתרה שלילית').replace(/overdraft/gi, 'חריגה ממסגרת האשראי').replace(/multiple high.?balance consumer loans/gi, 'ריבוי התחייבויות צרכניות').replace(/high volume of loan repayments/gi, 'שיעור החזר התחייבויות גבוה').replace(/linked undisclosed loan/gi, 'הלוואה נסתרת מקושרת').replace(/undisclosed loan/gi, 'הלוואה שלא דווחה').replace(/consumer loans?/gi, 'הלוואות צרכניות').replace(/loan repayments?/gi, 'החזרי הלוואות').replace(/\bmitigants?\b/gi, 'גורמים מפצים').replace(/\bmitigant\b/gi, 'גורם מפצה').replace(/\bDTI\b/g, 'יחס ההחזר').replace(/\bPTI\b/g, 'יחס ההחזר').replace(/\bLTV\b/g, 'יחס מימון').replace(/Bank Hapoalim/gi, 'בנק הפועלים').replace(/Bank Leumi/gi, 'בנק לאומי').replace(/Bank Discount/gi, 'בנק דיסקונט').replace(/Bank Mizrahi/gi, 'בנק מזרחי').replace(/Gross-to-net ratio less than 65%/gi, 'ניכויים גבוהים מהרגיל').replace(/Gross-to-net ratio/gi, 'יחס נטו-ברוטו').replace(/Menora Life Insurance/gi, 'מנורה ביטוח חיים').replace(/life insurance/gi, 'ביטוח חיים').replace(/may indicate/gi, 'עשוי להצביע על').replace(/amounts?:/gi, 'סכומים:').replace(/payments? observed/gi, 'תשלומים שנצפו').replace(/amount\s+([-\d.]+)/gi, (m, n) => `סכום: ₪${n}`).replace(/on\s+(\d{2}\/\d{2}\/\d{4})/gi, 'בתאריך $1').replace(/([A-Z][a-z]+)\s+([A-Z][a-z]+):\s*/g, (m, first, last) => { const nameMap = {}; if (borrower1.name) { const p = borrower1.name.split(' '); if (p.length >= 2) nameMap[`${p[0]} ${p[1]}`] = borrower1.name; } if (borrower2.name) { const p = borrower2.name.split(' '); if (p.length >= 2) nameMap[`${p[0]} ${p[1]}`] = borrower2.name; } return (nameMap[`${first} ${last}`] || `${first} ${last}`) + ': '; }); };
        risk_radar.forEach((item) => { const latinWords = (item.finding || '').match(/[A-Za-z]{4,}/g); if (latinWords && latinWords.length > 0) { item.finding = translateToHebrew(item.finding); } if (item.recommendation) { const latinRec = (item.recommendation || '').match(/[A-Za-z]{4,}/g); if (latinRec && latinRec.length > 0) item.recommendation = translateToHebrew(item.recommendation); } });

        let finalDetectedTypes = [...detectedTypes];
        const hasRealMortgage = !!(rawData.existing_mortgage?.remaining_balance);
        if (!hasRealMortgage) { finalDetectedTypes = finalDetectedTypes.filter(t => !t.includes('מיחזור') && !t.includes('מחזור')); }
        if (reportType === 'זיהוי אוטומטי' && !isRefinanceCase) { finalDetectedTypes = finalDetectedTypes.filter(t => !t.includes('מחזור')); if (!finalDetectedTypes.includes('רכישת נכס חדש') && !finalDetectedTypes.includes('משכנתא לכל מטרה')) finalDetectedTypes.push('רכישת נכס חדש'); }

        const incomeNormalized = income_months.some(m => (m.note || '').includes('זיהוי כירורגי'));

        const recurringDepositAmounts = new Set();
        if (rawData.equity_events && rawData.equity_events.length >= 2) { const amountCounts = {}; rawData.equity_events.forEach(e => { const amt = Math.round(e.amount || 0); if (amt > 3000) amountCounts[amt] = (amountCounts[amt] || 0) + 1; }); Object.entries(amountCounts).forEach(([amt, count]) => { if (count >= 2) recurringDepositAmounts.add(parseInt(amt)); }); }

        const deterministicRecs = [];
        const hasRealUndisclosedIndicators = (rawData.undisclosed_loan_indicators || []).some(ind => { const indLower = ind.toLowerCase(); return !SOCIAL_DEDUCTION_KEYWORDS.some(kw => indLower.includes(kw.toLowerCase())) && !['הראל', 'מגדל', 'כלל', 'הפניקס', 'מנורה'].some(b => indLower.includes(b)); });
        if (hasRealUndisclosedIndicators) { deterministicRecs.push({ priority: 'חובה_לפני_הגשה', category: 'מסמך_חסר', text: 'ריכוז הלוואות מלא מכל הבנקים — נמצאו ניכויי ביטוח חיים חשודים', for_whom: 'לקוח' }); }
        const hasHighVarianceCards = risk_radar.some(r => r.category === 'דורש אימות ידני');
        if (hasHighVarianceCards) { deterministicRecs.push({ priority: 'חובה_לפני_הגשה', category: 'נדרש_הסבר', text: 'נדרש הסבר לחיובים גבוהים מאוד בכרטיסי האשראי בחודשים חריגים (מעל 30,000 ש"ח)', for_whom: 'לקוח' }); }
        if (recurringDepositAmounts.size > 0) { deterministicRecs.push({ priority: 'מומלץ', category: 'בדיקה_נוספת', text: 'מומלץ להציג אסמכתאות למהות ההעברות הקבועות בעו"ש', for_whom: 'לקוח' }); }
        if (risk_radar.some(r => r.category === 'עלייה חריגה בשכר')) { deterministicRecs.push({ priority: 'חובה_לפני_הגשה', category: 'מסמך_חסר', text: 'מכתב מעסיק המאשר את עלייה חריגה בשכר / קידום', for_whom: 'לקוח' }); }
        const needsCohabAgreement = (rawData.special_circumstances || []).some(s => s.includes('ללא קשר משפחתי'));
        if (needsCohabAgreement && !deterministicRecs.some(r => r.text.includes('הסכם שיתוף'))) { deterministicRecs.push({ priority: 'מומלץ', category: 'מסמך_חסר', text: 'הסכם שיתוף נכסים בין הלווים (לווים ללא נישואין)', for_whom: 'לקוח' }); }
        // ── הון נזיל: רלוונטי רק לתיקי רכישה, לא למחזור ──
        // בתיק מחזור אין צורך בהון עצמי נזיל — הנכס כבר בבעלות הלווה
        if (!isRefinanceCase && (rawData.total_equity_evidence || 0) > 50000) { deterministicRecs.push({ priority: 'מומלץ', category: 'חוזקה_לשים_דגש', text: `הון עצמי נזיל מוכח: ₪${Math.round(rawData.total_equity_evidence).toLocaleString()} — יש להדגיש בחזית המכתב לבנק`, for_whom: 'בנקאי' }); }

        const hasSabbaticalInCase = [borrower1, borrower2].some(b => (b.employment_type || '').toLowerCase().includes('שבתון') || (b.special_status_note || '').toLowerCase().includes('שבתון'));
        const allRecs = [...(rawData.actionable_recommendations || []).map(r => hasSabbaticalInCase && (r.text||'').includes('חל"ת') ? {...r, text: r.text.replace(/חל"ת/g, 'שבתון מאושר')} : r), ...deterministicRecs];
        const SEMANTIC_DEDUP_KEYS = ['הסכם שיתוף', 'ריכוז הלוואות', 'מכתב מעסיק', 'מכתב רו"ח', 'אישור ניקיון', 'ביטוח חיים', 'הון עצמי נזיל', 'הון עצמי מוכח'];
        // Filter out AI-generated requests for id_issue_date — it's optional and never a hard requirement
        const ID_ISSUE_DATE_FILTER = ['תאריך הנפקת ת.ז', 'תאריך הנפקה', 'id_issue_date', 'הנפקת ת.ז'];
        const filteredRecs = allRecs.filter(r => !ID_ISSUE_DATE_FILTER.some(kw => (r.text || '').includes(kw)));
        const seenRecTexts = new Set(); const seenSemanticKeys = new Set();
        const mergedRecs = filteredRecs.filter(r => { const text = (r.text || '').trim(); const matchedKey = SEMANTIC_DEDUP_KEYS.find(k => text.includes(k)); if (matchedKey) { if (seenSemanticKeys.has(matchedKey)) return false; seenSemanticKeys.add(matchedKey); } const key = text.substring(0, 40); const isDuplicate = seenRecTexts.has(key) || [...seenRecTexts].some(s => text.includes(s) || s.includes(text.substring(0, 25))); if (isDuplicate) return false; seenRecTexts.add(key); return true; });

        // ---------------------------------------------------------
        // STEP 5: BANKER LETTER
        // ---------------------------------------------------------
        const buildBankerLetter = () => {
            const fmt = (n) => n ? `₪${Math.round(n).toLocaleString()}` : '—';
            const b1 = borrower1; const b2 = borrower2;
            const caseTypeLabel = finalDetectedTypes.join(' | ') || reportType || 'רכישת נכס חדש';

            const getTitle = (borrower) => {
                const gender = (borrower.gender || '').toLowerCase();
                if (gender === 'female' || gender === 'נקבה' || gender === 'f') return 'גב\'';
                if (gender === 'male' || gender === 'זכר' || gender === 'm') return 'מר';
                const ms = (borrower.marital_status || '').toLowerCase();
                if (ms.includes('רווקה') || ms.includes('גרושה') || ms.includes('אלמנה') || ms.includes('נשואה')) return 'גב\'';
                if (ms.includes('רווק') || ms.includes('גרוש') || ms.includes('אלמן') || ms.includes('נשוי')) return 'מר';
                const et = (borrower.employment_type || '').toLowerCase();
                if (et.includes('שכירה') || et.includes('עצמאית')) return 'גב\'';
                if (et.includes('שכיר') || et.includes('עצמאי')) return 'מר';
                const firstName = (borrower.name || '').split(' ')[0] || '';
                const femaleEndings = ['נועה', 'שרה', 'רחל', 'מרים', 'לאה', 'דינה', 'רבקה', 'אסתר', 'יעל', 'תמר', 'מיכל', 'אביגיל', 'נעמה', 'עדי', 'ליאת', 'מאיה', 'רוני', 'שירה', 'גלית', 'אורית', 'ענת', 'דנית', 'קרן', 'ליה', 'נילי', 'חני', 'פנינה', 'זהבה', 'שושנה', 'ברכה', 'צפורה', 'דבורה', 'הילה', 'טלי', 'ציפי', 'ויקי', 'רחלי', 'שושי', 'מזל', 'סגלית', 'חיה', 'בילה', 'נטלי', 'סמדר', 'אלה', 'דנה', 'שני', 'מור', 'יסמין', 'ליבי', 'נגה', 'צליל', 'רינת', 'אורנה', 'יפה', 'רות', 'חנה', 'אורטל'];
                if (femaleEndings.includes(firstName)) return 'גב\'';
                return '';
            };
            const getEmploymentLabel = (borrower, title) => { const et = (borrower.employment_type || '').toLowerCase(); if (title === 'גב\'') { if (et.includes('שכיר') || et === 'שכיר') return 'שכירה'; if (et.includes('עצמאי') || et.includes('עצמאית')) return 'עצמאית'; return 'שכירה'; } if (title === 'מר') { if (et.includes('עצמאי')) return 'עצמאי'; return 'שכיר'; } return borrower.employment_type || 'שכיר'; };
            const b1Title = getTitle(b1); const b2Title = getTitle(b2);
            const fmtSeniority = (years) => { if (!years) return null; const fullYears = Math.floor(years); const months = Math.round((years - fullYears) * 12); if (fullYears === 0) return months === 1 ? 'חודש' : `${months} חודשים`; const yearsLabel = fullYears === 1 ? 'שנה' : fullYears === 2 ? 'שנתיים' : `${fullYears} שנים`; if (months === 0) return yearsLabel; return `${yearsLabel} ו-${months} חודשים`; };
            const getAgePronoun = (title) => title === 'גב\'' ? 'בת' : title === 'מר' ? 'בן' : 'בן/בת';
            const b1SeniorityReal = b1.seniority_years || null; const b2SeniorityReal = b2.seniority_years || null;

            let letter = `לכבוד הנהלת האשראי ואגף המשכנתאות,\n`;
            letter += `הנדון: סיכום חיתומי — בקשה למימון עבור ${b1.name || 'לווה 1'}`;
            if (b2.name) letter += ` ו${b2.name}`;
            letter += `\nסוג תיק: ${caseTypeLabel}\nתאריך: ${today}\n\n`;

            // ── Early Warning Banner בראש המכתב ──
            if (earlyWarningBanners.length > 0) {
                letter += `הודעה לחתם — נדרשת השלמת מסמכים לפני קבלת החלטה:\n`;
                letter += `${'─'.repeat(60)}\n`;
                earlyWarningBanners.forEach(w => {
                    letter += `• ${w.message}\n`;
                    w.missing_items.forEach(item => { letter += `  ↳ חסר: ${item}\n`; });
                });
                letter += `${'─'.repeat(60)}\n`;
                letter += `הניתוח שלהלן מבוסס על המסמכים הקיימים בלבד. נתוני ההכנסה עשויים להשתנות לאחר השלמת המסמכים.\n\n`;
            }

            letter += `בתוקף תפקידי כראש צוות חיתום בחברת מיקוד משכנתאות, הנני מגיש בפניכם את ניתוח החיתום המקצועי לבקשת המימון שבנדון.\n\n`;

            letter += `פרופיל לווה 1 — ${b1.name || '—'}:\n`;
            const b1IdDetails = [b1.id || '—', b1.birth_date ? `ת. לידה: ${b1.birth_date}` : null, (b1.id_issue_date && b1.id_issue_date !== 'null' && b1.id_issue_date !== 'undefined') ? `הנפקה: ${b1.id_issue_date}` : null].filter(Boolean).join(' | ');
            letter += `${b1Title ? b1Title + ' ' : ''}${b1.name || '—'} (ת.ז. ${b1IdDetails}), ${b1.age ? getAgePronoun(b1Title) + ' ' + b1.age : ''}, `;
            const b1IsActuallyBusiness = isBusinessCase && resolvedBusinessOwnerIndex === 0;
            const b1EmpType = (b1.employment_type || '').toLowerCase();
            const b1IsSelfEmployed = b1EmpType.includes('עצמאי') || b1EmpType.includes('עצמאית') || b1IsActuallyBusiness;
            const b1EmpLabel = b1IsSelfEmployed ? (b1Title === 'גב\'' ? 'עצמאית' : 'עצמאי') : getEmploymentLabel(b1, b1Title);
            letter += `${b1EmpLabel} `;
            if (!b1IsSelfEmployed) { letter += `ב-${b1.employer || 'מעסיק לא צוין'}`; } else { letter += `(${b1.business_name || b1.employer || 'עסק עצמאי'})`; }
            if (b1SeniorityReal) letter += `, ותק של ${fmtSeniority(b1SeniorityReal)}`;
            letter += `.\nהכנסה חודשית נטו: ${fmt(avg_income)}.\n`;
            if (b1.special_status_note && b1.special_status_note !== 'N/A' && b1.special_status_note.trim() !== '') letter += `הערה: ${b1.special_status_note}.\n`;

            if (b2.name) {
                letter += `\nפרופיל לווה 2 — ${b2.name}:\n`;
                const b2IdDetails = [b2.id || '—', b2.birth_date ? `ת. לידה: ${b2.birth_date}` : null, (b2.id_issue_date && b2.id_issue_date !== 'null' && b2.id_issue_date !== 'undefined') ? `הנפקה: ${b2.id_issue_date}` : null].filter(Boolean).join(' | ');
                letter += `${b2Title ? b2Title + ' ' : ''}${b2.name} (ת.ז. ${b2IdDetails}), ${b2.age ? getAgePronoun(b2Title) + ' ' + b2.age : ''}, `;
                const b2IsActuallyBusiness = isBusinessCase && resolvedBusinessOwnerIndex === 1;
                const b2EmpType = (b2.employment_type || '').toLowerCase();
                const b2IsSelfEmployed = b2EmpType.includes('עצמאי') || b2EmpType.includes('עצמאית') || b2IsActuallyBusiness;
                const b2EmpLabel = b2IsSelfEmployed ? (b2Title === 'גב\'' ? 'עצמאית' : 'עצמאי') : getEmploymentLabel(b2, b2Title);
                letter += `${b2EmpLabel} `;
                if (!b2IsSelfEmployed) { letter += `ב-${b2.employer || 'מעסיק לא צוין'}`; } else { letter += `(${b2.business_name || b2.employer || 'עסק עצמאי'})`; }
                if (b2SeniorityReal) letter += `, ותק של ${fmtSeniority(b2SeniorityReal)}`;
                letter += `.\nהכנסה חודשית נטו: ${fmt(avg_income_2)}.\n`;
                if (b2.special_status_note && b2.special_status_note !== 'N/A' && b2.special_status_note.trim() !== '') letter += `הערה: ${b2.special_status_note}.\n`;
            }

            const specialEmpNotes = [];
            const empType1 = (b1.employment_type || '').toLowerCase(); const empType2 = (b2.employment_type || '').toLowerCase();
            const getGenderedSabbatical = (borrower, title, name, fallbackLabel) => { if (title === 'גב\'') return `${name || fallbackLabel} נמצאת בשנת שבתון`; if (title === 'מר') return `${name || fallbackLabel} נמצא בשנת שבתון`; return `${name || fallbackLabel} נמצא/ת בשנת שבתון`; };
            if (empType1.includes('שבתון')) specialEmpNotes.push(`${getGenderedSabbatical(b1, b1Title, b1.name, 'לווה 1')} מאושרת — עובד הוראה בקביעות, הנמצא בהסדר שבתון תחת תנאי הסכם קיבוצי. ההכנסה מחושבת על בסיס ממוצע השכר המלא ב-24 החודשים טרום השבתון בתוספת מענק ההשתלמות.`);
            if (empType2.includes('שבתון')) specialEmpNotes.push(`${getGenderedSabbatical(b2, b2Title, b2.name, 'לווה 2')} מאושרת — עובד הוראה בקביעות, הנמצא בהסדר שבתון תחת תנאי הסכם קיבוצי.`);
            const getGenderedLeave = (name, title, fallbackLabel, leaveType) => { const heVerb = title === 'גב\'' ? 'נמצאת' : title === 'מר' ? 'נמצא' : 'נמצא/ת'; return `${name || fallbackLabel} ${heVerb} ב${leaveType}`; };
            if (empType1.includes('לידה') || empType1.includes('הריון')) specialEmpNotes.push(`${getGenderedLeave(b1.name, b1Title, 'לווה 1', 'חופשת לידה')} — ההכנסה מחושבת לפי שכר מלא טרום החופשה.`);
            if (empType2.includes('לידה') || empType2.includes('הריון')) specialEmpNotes.push(`${getGenderedLeave(b2.name, b2Title, 'לווה 2', 'חופשת לידה')} — ההכנסה מחושבת לפי שכר מלא טרום החופשה.`);
            if ((empType1.includes('חל"ת') || empType1.includes('חלת')) && !empType1.includes('שבתון')) specialEmpNotes.push(`${getGenderedLeave(b1.name, b1Title, 'לווה 1', 'חל"ת')} — ההכנסה מחושבת לפי שכר מלא טרום החל"ת. נדרש: מכתב חזרה לעבודה עם תאריך חזרה + תלושים לפני החל"ת.`);
            if ((empType2.includes('חל"ת') || empType2.includes('חלת')) && !empType2.includes('שבתון')) specialEmpNotes.push(`${getGenderedLeave(b2.name, b2Title, 'לווה 2', 'חל"ת')} — ההכנסה מחושבת לפי שכר מלא טרום החל"ת. נדרש: מכתב חזרה לעבודה עם תאריך חזרה + תלושים לפני החל"ת.`);
            if (specialEmpNotes.length > 0) { letter += `\nהבהרות תעסוקתיות:\n`; specialEmpNotes.forEach(n => { letter += `• ${n}\n`; }); }

            letter += `\nניתוח הכנסות וכושר החזר:\n`;
            letter += `הכנסת משק הבית הכוללת עומדת על ${fmt(total_household_income)} נטו לחודש`;
            if (avg_income > 0 && avg_income_2 > 0) letter += ` (${b1.name || 'לווה 1'}: ${fmt(avg_income)} | ${b2.name || 'לווה 2'}: ${fmt(avg_income_2)})`;
            letter += `.\n`;

            if (isRefinanceCase && rawData.existing_mortgage?.monthly_payment) {
                // ── PTI ריאלי = הלוואות צרכניות + החזר משכנתא קיימת (לפני המחזור) ──
                // זהו הנתון הנכון לדוח חיתום — לא "PTI צרכני ללא משכנתא"
                const existingPmt = rawData.existing_mortgage.monthly_payment;
                const currentRealTotal = loans_total_for_pti + existingPmt;
                const currentRealPTI = total_household_income > 0 ? parseFloat(((currentRealTotal / total_household_income) * 100).toFixed(1)) : 0;
                const currentRealLabel = currentRealPTI <= 35 ? 'תקין' : currentRealPTI <= 40 ? 'גבולי' : 'חורג';
                letter += `יחס ההחזר הנוכחי (PTI) — כולל המשכנתא הקיימת: ${currentRealPTI.toFixed(1)}% — ${currentRealLabel}.\n`;
                letter += `פירוט: משכנתא קיימת ₪${existingPmt.toLocaleString()} + התחייבויות צרכניות ${loans_total_for_pti > 0 ? fmt(loans_total_for_pti) : '—'} = סך החזר חודשי ₪${Math.round(currentRealTotal).toLocaleString()}.\n`;
                letter += `כושר החזר פנוי למשכנתא חדשה: ${fmt(finalAvailable)}.\n`;
                // PTI לאחר מחזור — נתון קריטי להשוואה
                if (finalPTIWithProposed !== null) {
                    const ptiRealLabel = finalPTIWithProposed <= 35 ? 'תקין' : finalPTIWithProposed <= 40 ? 'גבולי' : 'חורג';
                    letter += `PTI לאחר מחזור (הלוואות צרכניות + משכנתא חדשה ₪${proposedPayment.toLocaleString()}/חודש): ${finalPTIWithProposed.toFixed(1)}% — ${ptiRealLabel}.\n`;
                } else {
                    // אין proposed — הצג כמחזור באותם תנאים (הערכה)
                    const estLabel = currentRealPTI <= 35 ? 'תקין' : currentRealPTI <= 40 ? 'גבולי' : 'חורג';
                    letter += `PTI ריאלי לאחר מחזור (אומדן בריבית שוק): ${currentRealPTI.toFixed(1)}% — ${estLabel}.\n`;
                }
            } else {
                letter += `יחס ההחזר הנוכחי (DTI) עומד על ${finalPTI.toFixed(1)}% — `;
                if (finalPTI < 2) letter += `ללא התחייבויות צרכניות פעילות (מלבד המשכנתא) — כושר החזר נקי ומלא זמין למשכנתא.\n`;
                else if (finalPTI < 25) letter += `נמוך במיוחד, המצביע על פנויות תקציבית גבוהה מאוד.\n`;
                else if (finalPTI < 35) letter += `תקין ומצוין לפי הקריטריונים הבנקאיים.\n`;
                else if (finalPTI <= 40) letter += `גבולי אך בטווח המאושר (מקסימום 40%).\n`;
                else if (isConsolidation) letter += `גבוה כיום עקב עומס ההלוואות הקיימות — מטרת המחזור היא להוריד את יחס ההחזר.\n`;
                else letter += `גבוה מהמקסימום המאושר — נדרשת התייחסות.\n`;
                letter += `תשלום מקסימלי מותר (40% מהכנסה): ${fmt(finalMaxPayment)}. כושר החזר פנוי למשכנתא: ${fmt(finalAvailable)}.\n`;
                if (finalPTIWithProposed !== null) { const ptiRealLabel = finalPTIWithProposed <= 35 ? 'תקין' : finalPTIWithProposed <= 40 ? 'גבולי' : 'חורג'; letter += `PTI ריאלי (כולל המשכנתא החדשה ₪${proposedPayment.toLocaleString()}/חודש): ${finalPTIWithProposed.toFixed(1)}% — ${ptiRealLabel}.\n`; }
            }
            if (alimony_monthly > 0) letter += `מזונות חודשיים: ${fmt(alimony_monthly)} — נספרים בחישוב ה-PTI.\n`;

            if (finalAvailable > 500) {
                const calcMaxLoan = (monthlyPayment, annualRate, years) => { const r = annualRate / 12; const n = years * 12; if (r === 0) return monthlyPayment * n; return Math.round(monthlyPayment * (1 - Math.pow(1 + r, -n)) / r); };
                const rate = 0.05; const years25 = calcMaxLoan(finalAvailable, rate, 25); const years30 = calcMaxLoan(finalAvailable, rate, 30);
                letter += `\nהלוואה מקסימלית מומלצת (לפי כושר החזר פנוי ₪${finalAvailable.toLocaleString()}/חודש בריבית ממוצעת 5%):\n`;
                letter += `• לתקופה של 25 שנה: ${fmt(years25)}\n• לתקופה של 30 שנה: ${fmt(years30)}\n`;
                if (rawData.property_value) {
                    const ltv25 = Math.round((years25 / rawData.property_value) * 100);
                    const currentLTV = rawData.existing_mortgage?.remaining_balance ? Math.round((rawData.existing_mortgage.remaining_balance / rawData.property_value) * 100) : null;
                    letter += `• LTV נוכחי (שווי נכס ${fmt(rawData.property_value)}): ${currentLTV !== null ? currentLTV + '%' : 'לא ידוע'}\n`;
                    letter += `• LTV בתרחיש מחזור 25 שנה (הלוואה מקסימלית): ${ltv25}%\n`;
                } else { letter += `• LTV: נדרש שווי נכס וסכום הלוואה מבוקש.\n`; }
            }

            const equityEventsFiltered = (rawData.equity_events || []).filter(e => { if (e.is_incoming === false || e.type === 'הפקדה_לפקדון') return false; if ((e.amount || 0) < 20000) return false; const desc = (e.description || '').toLowerCase(); if (desc.includes('קרן השתלמות') || desc.includes('קה"ל') || desc.includes('קרן_השתלמות') || e.type === 'קרן_השתלמות') return false; const amt = Math.round(e.amount || 0); if (recurringDepositAmounts.has(amt)) return false; return true; });
            const totalEquity = equityEventsFiltered.reduce((s, e) => s + (e.amount || 0), 0) || 0;
            const avgBankBalanceTotal = (rawData.cash_flow_summary || []).reduce((s, acc) => s + Math.max(0, acc.avg_balance || 0), 0);
            const effectiveLiquidEquity = Math.max(totalEquity, avgBankBalanceTotal);
            const kerenFundsLtr = (rawData.keren_hishtalmut || []).reduce((s, k) => s + (k.accumulated_balance || 0), 0);
            const totalFundsLtr = kerenFundsLtr + (rawData.pension_funds || []).filter(p => p.is_accessible).reduce((s, p) => s + (p.accumulated_balance || 0), 0);
            if (totalFundsLtr > 100000) { letter += `\n**גורם מפצה מרכזי — קרנות נזילות: ₪${Math.round(totalFundsLtr).toLocaleString()}** (קרן ההשתלמות "קרן המורים"). הלווים יכולים לסגור כל חוב בקריאה אחת ללא סיוע חיצוני.\n`; }
            else if (effectiveLiquidEquity > 50000) { letter += `\n**גורם מפצה — הון נזיל: ${fmt(effectiveLiquidEquity)}** בחשבונות הבנק.\n`; }

            if (isRefinanceCase && rawData.existing_mortgage?.remaining_balance) {
                const m = rawData.existing_mortgage;
                letter += `\nמשכנתא קיימת:\nיתרה לסילוק: ${fmt(m.remaining_balance)} | בנק: ${m.bank_name || 'לא צוין'} | החזר חודשי: ${fmt(m.monthly_payment)}`;
                if (m.remaining_months) letter += ` | חודשים שנותרו: ${m.remaining_months}`;
                if (m.early_repayment_fee) letter += ` | עמלת פירעון: ${fmt(m.early_repayment_fee)}`;
                letter += `.\n`;
                if (isConsolidation) letter += `מטרת המיחזור: איחוד התחייבויות צרכניות יקרות לתוך המשכנתא, לצורך הוזלת ההחזר החודשי הכולל.\n`;
            }

            if (isBusinessCase && rawData.business_data) {
                const bd = rawData.business_data;
                letter += `\nהכנסה עסקית:\n`;
                const fixYearLabel = (label, fallback) => { if (!label) return fallback; return label.replace(/\(Estimated\)/gi, '(הערכה)').replace(/Estimated/gi, 'הערכה').replace(/Current year/gi, 'שנה שוטפת').replace(/Tax year/gi, 'שנת מס'); };
                // כלל ברזל: המספר במכתב = אותו מספר ששימש לחישוב ה-PTI — אחדות
                // כדי למנוע סתירה בין הנרטיב לבין הטבלאות, נשתמש באותה הכנסה שחושבה בפועל
                const isB2 = resolvedBusinessOwnerIndex === 1;
                const incomeUsedForPTI = isB2 ? avg_income_2 : avg_income;
                const b2NormativeMonthlyForLetter = isB2 ? (borrower2._normative_shoma_monthly || 0) : 0;
                const biz = calcBusinessIncome();
                if (b2NormativeMonthlyForLetter > 0) {
                    // כלל ברזל: המספר בנרטיב = המספר ב-PTI = שומת מס 2024. אין להציג נתון נוסף שעלול לבלבל.
                    letter += `הכנסה לחיתום: ${fmt(b2NormativeMonthlyForLetter)}/חודש (שומת מס 2024 — כוללת שכר ממשרד החינוך + הכנסה עסקית גולמית / 12). זהו הנתון הסמכותי לחישוב PTI.\n`;
                    if (biz?.grossIncome && biz.usedCPA) {
                        const bizNet = biz.netIncome || Math.round(biz.grossIncome * 0.72);
                        letter += `הערה: הכנסת העסק לפי מכתב רו"ח: ${fmt(biz.grossIncome)} ברוטו (${fmt(bizNet)} נטו משוער) — הכנסת עסק בלבד, ללא שכר ממשרד החינוך. השומה (${fmt(b2NormativeMonthlyForLetter)}) כוללת את שתי ההכנסות ומשמשת לחיתום.\n`;
                    }
                } else if (biz?.usedCPA) {
                    letter += `הכנסה מבוססת על מכתב רו"ח שוטף (עדיפות מוחלטת): ${fmt(biz.grossIncome)}/חודש.\n`;
                    if (bd.annual_income_year1 || bd.annual_income_year2) {
                        letter += `לעיון: שומות היסטוריות — ${fixYearLabel(bd.year1_label, 'שנה 1')}: ${bd.annual_income_year1 ? fmt(bd.annual_income_year1/12) : '—'}/חודש | ${fixYearLabel(bd.year2_label, 'שנה 2')}: ${bd.annual_income_year2 ? fmt(bd.annual_income_year2/12) : '—'}/חודש.\n`;
                    }
                } else {
                    if (bd.annual_income_year1 && bd.annual_income_year2) {
                        letter += `הכנסה העסקית מבוססת על ממוצע שתי שנות מס רשמיות: ${fixYearLabel(bd.year1_label, 'שנה 1')} — ${fmt(bd.annual_income_year1/12)}/חודש | ${fixYearLabel(bd.year2_label, 'שנה 2')} — ${fmt(bd.annual_income_year2/12)}/חודש.\n`;
                        if (bd.annual_income_year3) letter += `מכתב רו"ח שוטף (${fixYearLabel(bd.year3_label, 'שנה 3')}): ${fmt(bd.annual_income_year3/12)}/חודש — מחזק ומהווה אינדיקציה לעלייה.\n`;
                    } else if (bd.annual_income_year3) {
                        letter += `הכנסה לפי מכתב רו"ח שוטף: ${fmt(bd.annual_income_year3/12)}/חודש.\n`;
                    }
                }
                const extractYearFromLabel = (label) => { if (!label) return null; const m = label.match(/20(\d{2})/); return m ? 2000 + parseInt(m[1]) : null; };
                const taxYears = [extractYearFromLabel(bd.year1_label), extractYearFromLabel(bd.year2_label), extractYearFromLabel(bd.year3_label)].filter(Boolean);
                const earliestTaxYear = taxYears.length > 0 ? Math.min(...taxYears) : null;
                const currentYear = new Date().getFullYear();
                const seniorityFromEarliest = earliestTaxYear ? (currentYear - earliestTaxYear + 1) : null;
                const effectiveSeniority = Math.max(seniorityFromEarliest || 0, bd.seniority_years || 0) || seniorityFromEarliest || bd.seniority_years;
                const effectiveStartYear = (bd.seniority_years && bd.seniority_years > (seniorityFromEarliest || 0)) ? (currentYear - Math.round(bd.seniority_years)) : earliestTaxYear;
                if (effectiveSeniority) letter += `ותק עסקי: ${Math.round(effectiveSeniority)} שנים${effectiveStartYear ? ` (מ-${effectiveStartYear})` : ''}.\n`;
            }

            { const s1yrs = b1.seniority_years || rawData.business_data?.seniority_years || 0; const s2yrs = b2.seniority_years || 0; const sen10Notes = [s1yrs >= 10 ? `**${b1.name || 'לווה 1'}: ותק של ${Math.round(s1yrs)} שנים** — יציבות תעסוקתית מקסימלית` : null, s2yrs >= 10 ? `**${b2.name || 'לווה 2'}: ותק של ${Math.round(s2yrs)} שנים** — יציבות תעסוקתית מקסימלית` : null].filter(Boolean); if (sen10Notes.length > 0) { letter += `\nיציבות תעסוקתית:\n`; sen10Notes.forEach(n => { letter += `• ${n}\n`; }); } }

            const nonIncomeCircumstances = (rawData.special_circumstances || []).filter(sc => !sc.includes('שבתון') && !sc.includes('לידה') && !sc.includes('הריון'));
            if (nonIncomeCircumstances.length > 0) { letter += `\nנסיבות נוספות לתשומת לב:\n`; nonIncomeCircumstances.forEach(sc => { letter += `• ${translateToHebrew(sc)}\n`; }); }

            if (isGoldenAge) { letter += `\nהבהרה — תיק גיל הזהב: משכנתא פנסיונית/הפוכה אינה כפופה למגבלת גיל עליון.\n`; }

            const criticalCount = risk_radar.filter(r => r.severity === 'HIGH' || r.severity === 'critical').length;
            const ptiIsStrong = finalPTI < 35;
            const hasStrongEquity = effectiveLiquidEquity > 100000;
            const hasStrongIncome = total_household_income > 18000;
            const isStrongProfile = ptiIsStrong && (hasStrongEquity || hasStrongIncome);

            letter += `\nסיכום והמלצה:\n`;
            const consolidationOpportunity = finalLTV && finalLTV < 50 && loans_total_for_pti > 100000;
            if (consolidationOpportunity && isConsolidation) {
                const loanBalance = Math.round(loans_total_for_pti * 36);
                letter += `מטרת הבקשה הנה איחוד התחייבויות צרכניות בהיקף של כ-₪${Math.round(loanBalance).toLocaleString()} לתוך מסגרת המשכנתא, במטרה לשפר את האיתנות הפיננסית של משק הבית.\n\n`;
                const kerenFundTotal = (rawData.keren_hishtalmut || []).reduce((s, k) => s + (k.accumulated_balance || 0), 0);
                const pensionFundTotal = (rawData.pension_funds || []).reduce((s, p) => s + (p.accumulated_balance || 0), 0);
                const totalFundsMitigant = kerenFundTotal + pensionFundTotal;
                if (totalFundsMitigant > 150000 || totalEquity > 150000) { const displayAmount = totalFundsMitigant > 0 ? totalFundsMitigant : totalEquity; letter += `גורמים מפצים משמעותיים:\nללווים הון עצמי נזיל מוכח בסך כ-₪${Math.round(displayAmount).toLocaleString()} הצבור בקרנות השתלמות, המהווה כרית ביטחון פיננסית ממשית.\n\n`; }
                letter += `ניתוח תזרימי — השפעת האיחוד:\n`;
                const currentDTI = finalPTI; const projectedDTI = (loans_total_for_pti * 0.5) / total_household_income * 100;
                letter += `יחס ההחזר הנוכחי (DTI): ${currentDTI.toFixed(1)}% | יחס ההחזר המשוער לאחר האיחוד: ${projectedDTI.toFixed(1)}%\nשיפור תזרימי חודשי משוער: כ-₪${Math.round(loans_total_for_pti * 0.4).toLocaleString()}.\n\n`;
            } else if (consolidationOpportunity) {
                const consolidationAmount = Math.min(Math.round(rawData.property_value * 0.65 - (rawData.existing_mortgage?.remaining_balance || 0)), loans_total_for_pti * 24);
                letter += `המלצה אופרטיבית: LTV נמוך (${finalLTV}%) עם התחייבויות צרכניות גבוהות (₪${Math.round(loans_total_for_pti).toLocaleString()}/חודש). מומלץ לבצע הגדלת משכנתא בסך כ-₪${consolidationAmount.toLocaleString()} לצורך סגירת הלוואות.\n\n`;
            }

            if (criticalCount === 0) { letter += `הניתוח הפיננסי מציג תיק נקי ויציב. אנו ממליצים לאשר את בקשת המימון.\n`; }
            else if (isStrongProfile && criticalCount <= 5) { letter += `חרף ${criticalCount} ממצאים הדורשים מענה, הפרופיל הפיננסי של הלווים חזק: `; if (ptiIsStrong) { const _localDisplayPTI = (finalPTIWithProposed !== null) ? finalPTIWithProposed : (isRefinanceCase && rawData.existing_mortgage?.monthly_payment && total_household_income > 0) ? parseFloat((((loans_total_for_pti + rawData.existing_mortgage.monthly_payment) / total_household_income) * 100).toFixed(1)) : finalPTI; const ptiDesc = isRefinanceCase && finalPTI < 2 ? `PTI ריאלי ${_localDisplayPTI.toFixed(1)}% (כולל המשכנתא הקיימת) — מצוין` : `יחס ההחזר (DTI) עומד על ${finalPTI.toFixed(1)}%${finalPTI < 10 ? ' — ללא התחייבויות צרכניות פעילות' : ' — נמוך ומצוין'}`; letter += ptiDesc; } if (hasStrongEquity) letter += `, הון עצמי נזיל מוכח של ${fmt(totalEquity)}`; letter += `.\nאנו ממליצים לאשר את בקשת המימון בכפוף לטיפול בממצאים ולהשלמת המסמכים המפורטים ברשימת הפעולות הנדרשות.\n`; }
            else if (criticalCount <= 3) { letter += `הניתוח מציג תיק עם ${criticalCount} ממצאים הדורשים מענה, אולם כושר ההחזר והיציבות התעסוקתית תומכים באישור. אנו ממליצים לאשר בכפוף לטיפול בממצאים.\n`; }
            else { letter += `הניתוח מציג ${criticalCount} ממצאים הדורשים בחינה מעמיקה. יש להשלים את כלל המסמכים ולטפל בממצאים לפני הגשה סופית לבנק.\n`; }
            if (missing_docs.length > 0) { letter += `מסמכים הנדרשים להשלמת התיק: ${missing_docs.length} פריטים (מפורטים ברשימת הפעולות הנדרשות).\n`; }

            // ── שלב ג': התניה בגין חוזה עבודה חדש ──
            const contractBorrowers = [
                contractGap1 ? { label: b1.name || 'לווה 1', contract: contractGap1 } : null,
                contractGap2 ? { label: b2.name || 'לווה 2', contract: contractGap2 } : null,
            ].filter(Boolean);
            if (contractBorrowers.length > 0) {
                letter += `\nהבהרת חיתום — אישור מותנה (מעבר עבודה):\n`;
                contractBorrowers.forEach(({ label, contract }) => {
                    letter += `הכנסת ${label} חושבה על בסיס חוזה העסקה החתום עם ${contract.employer} (מצ"ב). `;
                    letter += `האישור העקרוני ניתן בהתאם. `;
                    letter += `משיכת הכסף (Payout) מותנית בהצגת תלוש שכר ראשון התואם את תנאי החוזה (₪${contract.grossIncome.toLocaleString()} ברוטו), `;
                    letter += `וכן הוכחת הפקדה בחשבון הבנק.\n`;
                });
            }

            letter += `\nבכבוד רב,\nראש צוות חיתום בכיר\nמיקוד משכנתאות`;
            return letter;
        };

        // ─────────────────────────────────────────────────────────
        // PTI המוצג לכרטיס הנתונים הפיננסיים:
        // בתיק מחזור — נציג את ה-PTI הריאלי (עם המשכנתא) כדי לא להטעות
        // ─────────────────────────────────────────────────────────
        const displayPTI = (finalPTIWithProposed !== null) ? finalPTIWithProposed
            : (isRefinanceCase && rawData.existing_mortgage?.monthly_payment && total_household_income > 0)
                ? parseFloat((((loans_total_for_pti + rawData.existing_mortgage.monthly_payment) / total_household_income) * 100).toFixed(1))
                : finalPTI;

        const bankerLetter = buildBankerLetter();

        const dedupMissingDocs = (docs) => { const seen = new Map(); const result = []; docs.forEach(doc => { const key = doc.replace(/\d{2}\/\d{4}/g, '').replace(/₪[\d,]+/g, '').trim().substring(0, 40); if (!seen.has(key)) { seen.set(key, 1); result.push(doc); } else seen.set(key, seen.get(key) + 1); }); return result; };
        if (_selfNames.length > 0) { for (let _i = missing_docs.length - 1; _i >= 0; _i--) { const _d = missing_docs[_i]; if (_selfNames.some(n => _d.includes(n)) && (_d.includes('תלוש') || _d.includes('תלושי שכר'))) missing_docs.splice(_i, 1); } }
        // Remove any missing_doc entries requesting id_issue_date — it's optional, not a bank requirement
        const ID_ISSUE_KEYWORDS = ['תאריך הנפקת ת.ז', 'תאריך הנפקה', 'id_issue_date', 'הנפקת ת.ז', 'issue_date'];
        for (let _mi = missing_docs.length - 1; _mi >= 0; _mi--) {
            if (ID_ISSUE_KEYWORDS.some(kw => missing_docs[_mi].includes(kw))) {
                missing_docs.splice(_mi, 1);
            }
        }
        // Remove corresponding risk_radar entries for id_issue_date (finding, recommendation, AND category)
        for (let _ri = risk_radar.length - 1; _ri >= 0; _ri--) {
            const finding = risk_radar[_ri].finding || '';
            const recommendation = risk_radar[_ri].recommendation || '';
            const category = risk_radar[_ri].category || '';
            if (ID_ISSUE_KEYWORDS.some(kw => finding.includes(kw) || recommendation.includes(kw) || category.includes(kw))) {
                risk_radar.splice(_ri, 1);
            }
        }
        // Also strip from validation_warnings
        for (let _vi = validation_warnings.length - 1; _vi >= 0; _vi--) {
            const msg = validation_warnings[_vi].message || '';
            if (ID_ISSUE_KEYWORDS.some(kw => msg.includes(kw))) {
                validation_warnings.splice(_vi, 1);
            }
        }
        // Aggressive final sweep: strip id_issue / partial-id alerts from actionable_recommendations and special_circumstances
        const ISSUE_DATE_SWEEP_KEYWORDS = ['תאריך הנפקה', 'תאריך הנפקת ת.ז', 'הנפקת ת.ז', 'id_issue_date', 'ת.ז. חלקיים', 'נתוני ת.ז. חלקיים'];
        for (let _ai = mergedRecs.length - 1; _ai >= 0; _ai--) {
            const txt = mergedRecs[_ai].text || '';
            if (ISSUE_DATE_SWEEP_KEYWORDS.some(kw => txt.includes(kw))) mergedRecs.splice(_ai, 1);
        }
        if (Array.isArray(rawData.special_circumstances)) {
            for (let _si = rawData.special_circumstances.length - 1; _si >= 0; _si--) {
                if (ISSUE_DATE_SWEEP_KEYWORDS.some(kw => (rawData.special_circumstances[_si] || '').includes(kw))) {
                    rawData.special_circumstances.splice(_si, 1);
                }
            }
        }
        const dedupedMissingDocs = dedupMissingDocs(missing_docs);
        // earlyWarningBanners כבר מוגדר ב-STEP 2.5 למעלה

        // חישוב נכסים נזילים (קרן השתלמות + פנסיה נגישה) — לסנכרון Checklist
        const liquidAssetsTotal = Math.round(
            (rawData.keren_hishtalmut || []).reduce((s, k) => s + (k.accumulated_balance || 0), 0) +
            (rawData.pension_funds || []).filter(p => p.is_accessible).reduce((s, p) => s + (p.accumulated_balance || 0), 0)
        );

        return Response.json({
            income_normalized: incomeNormalized,
            liquid_assets_total: liquidAssetsTotal,
            // ── ===true, not !==false — a missing/undefined value must never read as "verified" ──
            borrower_id_document_found: {
                b1: borrower1.id_document_found === true,
                b2: borrower2.name ? (borrower2.id_document_found === true) : null
            },
            borrower_info: {
                name: borrower1.name, name_2: borrower2.name,
                id: borrower1.id, id_2: borrower2.id,
                birth_date: borrower1.birth_date, birth_date_2: borrower2.birth_date,
                id_issue_date: borrower1.id_issue_date, id_issue_date_2: borrower2.id_issue_date,
                employer: borrower1.employer, employer_2: borrower2.employer,
                employment_type: borrower1.employment_type, employment_type_2: borrower2.employment_type,
                special_status: borrower1.special_status_note, special_status_2: borrower2.special_status_note,
                avg_income, avg_income_2, total_household_income,
                sabbatical_grant_income: sabbatical_grant_income || 0,
                age: borrower1.age, age_2: borrower2.age,
                marital_status: borrower1.marital_status,
                seniority_years: borrower1.seniority_years,
                seniority_years_2: borrower2.seniority_years,
                pti_ratio: displayPTI,
                pti_consumer: finalPTI,
                pti_with_proposed: finalPTIWithProposed,
                proposed_mortgage_payment: proposedPayment || 0,
                monthly_net_cashflow: total_household_income - total_monthly_debt,
                max_allowed_mortgage_payment: finalMaxPayment,
                available_for_mortgage: finalAvailable,
                alimony_monthly,
                ltv: finalLTV,
                property_value_used: finalPropertyValue || null
            },
            all_mortgages: rawData.all_mortgages,
            disability_info: rawData.disability_info,
            detected_case_types: finalDetectedTypes,
            executive_summary,
            bankerLetter,
            banker_letter_context: null,
            yearly_summary: `הכנסה ממוצעת מחושבת למשק הבית: ₪${total_household_income.toLocaleString()} לחודש.`,
            income_months,
            existing_mortgage: rawData.existing_mortgage,
            property_value: rawData.property_value,
            risk_radar,
            missing_docs: dedupedMissingDocs,
            strengths,
            additional_equity_requested: isRefinancePlus ? additionalAmountNum : 0,
            validation_flags,
            // הון נזיל רלוונטי רק לתיקי רכישה — לא מחזור
            equity_events: isRefinanceCase ? [] : (rawData.equity_events || []).filter(e => { if (e.is_incoming === false || e.type === 'הפקדה_לפקדון') return false; if ((e.amount || 0) < 20000) return false; const desc = (e.description || '').toLowerCase(); if (desc.includes('קרן השתלמות') || desc.includes('קה"ל') || e.type === 'קרן_השתלמות') return false; const amt = Math.round(e.amount || 0); if (recurringDepositAmounts.has(amt)) return false; return true; }),
            total_equity_evidence: isRefinanceCase ? 0 : ((rawData.equity_events || []).filter(e => { if (e.is_incoming === false || e.type === 'הפקדה_לפקדון') return false; if ((e.amount || 0) < 20000) return false; const desc = (e.description || '').toLowerCase(); if (desc.includes('קרן השתלמות') || desc.includes('קה"ל') || e.type === 'קרן_השתלמות') return false; const amt = Math.round(e.amount || 0); if (recurringDepositAmounts.has(amt)) return false; return true; }).reduce((s, e) => s + (e.amount || 0), 0) || 0),
            actionable_recommendations: mergedRecs,
            validation_warnings,
            early_warning_banners: earlyWarningBanners,
            shadow_debts_detected: hasShadowDebts ? shadowDebtsQC : [],
            shadow_debts_total: shadowDebtsTotalQC,
            opportunity_hook: opportunityHook
        });

    } catch (error) {
        // ── GLOBAL FATAL CATCH — Stack Trace מלא + לעולם לא מחזירים 500 גולמי ל-Frontend ──
        // ה-500 הקודם החזיר את error.message ("Cannot read properties of null (reading 'borrowers')")
        // ל-Frontend, שהציג אותו וקרס. עכשיו מחזירים 400 מסודר עם borrower_info=null
        // כך שה-Frontend (שיש לו Early Return על !borrower_info) יציג שגיאה אדומה במקום לקרוס.
        console.error('CRITICAL FATAL ERROR (buildQuickReport):', error.stack || error);
        return Response.json({
            error: 'שגיאה בבניית הדוח — מנוע החישוב נתקל בנתון חסר. נסה שוב, או העלה פחות מסמכים בכל פעם.',
            error_code: 'REPORT_BUILD_FAILED',
            _raw_error: error.message || String(error),
            borrower_info: null
        }, { status: 400 });
    }
  }),
};
