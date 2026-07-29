import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
/**
 * normalizeDocData — Deterministic Normalization Layer
 * 
 * Sits between extractDocData (AI) and buildQuickReport (calculations).
 * Rules are hard-coded logic — no AI involved.
 * 
 * Input:  rawData from extractDocData
 * Output: cleanedData with guaranteed consistency
 * 
 * KEY FIXES (v4):
 *   1. ESPP → classified as equity asset early in pipeline, NOT debt/undisclosed loan
 *   2. High-earner gross/net ratio → calibrated thresholds for 35K+ gross
 *   3. Foreign currency payslips (GBP/USD) → excluded from Israeli avg
 *   4. Anomaly Shield → hard-removes explained alerts from Risk Radar
 *   5. Government/Military employer → suppress gross/net alert (rigid statutory deductions)
 *   6. Capital movements (פיקדון/חיסכון) + large transfers (>₪50K) → NOT classified as loans
 *   7. Pro-rated first month → excluded from average if >20% below rest
 *   8. Strengthened ID-based payslip swap detection
 *   9. Double-Key Attribution: bank statements tagged with borrower_index by account_holder_name
 *  10. Prenuptial agreement (הסכם ממון) → detected as Mitigating Factor
 *  11. ESPP in payslip_deductions → filtered before suspicious-deduction pipeline
 */

export default {
  fetch: withSupabase({ auth: ["publishable"] }, async (req, ctx) => {
    try {
        const payload = await req.json();
        const { rawData, reportType, dealContext } = payload;

        if (!rawData) {
            return Response.json({ error: 'rawData is required' }, { status: 400 });
        }

        // ═══════════════════════════════════════════════════════════════
        // STRICT ANCHOR ENFORCEMENT — runs before everything else
        // If deal_context contains exactly ONE valid identity anchor, this is
        // a Single Borrower Case. Any additional borrowers invented by OCR/AI
        // ("Ghost Borrowers") are violently removed. All payslips without an
        // extractable Israeli ID are assigned to slot 0 (only borrower).
        // ═══════════════════════════════════════════════════════════════
        const _anchorCleanId = (v) => { const d = (v || '').replace(/\D/g, ''); return d.length >= 7 ? d.padStart(9, '0') : ''; };
        const _validAnchors = (dealContext?.identity_anchors || []).filter(a => a && (_anchorCleanId(a.id).length === 9 || a.name));
        const _isSingleBorrowerCase = _validAnchors.length === 1;

        if (_isSingleBorrowerCase && rawData.borrowers && rawData.borrowers.length > 1) {
            // Merge all payslips into slot 0 before slicing borrowers
            rawData.payslips_borrower1 = [
                ...(rawData.payslips_borrower1 || []),
                ...(rawData.payslips_borrower2 || [])
            ];
            rawData.payslips_borrower2 = [];
            rawData.borrowers = [rawData.borrowers[0]];
            console.log(`[STRICT_ANCHOR] Single-borrower enforcement: removed ${rawData.borrowers.length - 1} ghost borrower(s)`);
        }

        // Fallback for single-borrower case: payslips with no ID → assign to slot 0
        if (_isSingleBorrowerCase) {
            rawData.payslips_borrower1 = (rawData.payslips_borrower1 || []).map(p => {
                const pid = _anchorCleanId(p.id_number || p.employee_id || '');
                if (!pid) return { ...p, _no_id_assigned_to_primary: true };
                return p;
            });
        }

        // ═══════════════════════════════════════════════════════════════
        // PRE-NORMALIZATION HARD DEDUP — runs before everything else
        // If borrower[0] and borrower[1] share the exact same 9-digit ID
        // (after stripping non-digits and zero-padding), they are the same
        // person entered twice (e.g. OCR spelling variant: ילנה / הלנה).
        // Merge immediately: keep borrower[0], fold all payslips into slot1,
        // clear slot2. Identity is ID-only — name differences are irrelevant.
        // ═══════════════════════════════════════════════════════════════
        if (rawData.borrowers && rawData.borrowers.length >= 2) {
            const _b0 = rawData.borrowers[0];
            const _b1 = rawData.borrowers[1];
            const _cleanId = (v) => { const d = (v || '').replace(/\D/g, ''); return d.length >= 7 ? d.padStart(9, '0') : ''; };
            const _id0 = _cleanId(_b0.id || _b0.id_number);
            const _id1 = _cleanId(_b1.id || _b1.id_number);
            if (_id0 && _id1 && _id0 === _id1) {
                // Same person — merge payslips into slot 0, wipe slot 1
                const merged = { ..._b0 };
                if (!merged.employer && _b1.employer) merged.employer = _b1.employer;
                if (!merged.seniority_years && _b1.seniority_years) merged.seniority_years = _b1.seniority_years;
                rawData.borrowers = [merged];
                rawData.payslips_borrower1 = [
                    ...(rawData.payslips_borrower1 || []),
                    ...(rawData.payslips_borrower2 || [])
                ];
                rawData.payslips_borrower2 = [];
                console.log(`[PRE_DEDUP] Same-ID borrowers merged: id=${_id0}, names="${_b0.name}" / "${_b1.name}"`);
            }
        }

        // ═══════════════════════════════════════════════════════════════
        // UNDERWRITING POLICY ENGINE — חוקים קשיחים מהגדרות החתם
        // deal_context מגיע מ-DealSetupModal עם דגלי מדיניות מפורשים.
        // ═══════════════════════════════════════════════════════════════
        const isRefinanceDeal = (dealContext?.loan_purpose || '').toLowerCase().includes('refinance') ||
            (dealContext?.loan_purpose || '').includes('מחזור') || (dealContext?.loan_purpose || '').includes('איחוד');
        // דגל מפורש מהחתם — איחוד חובות עו"ש (גובר על ניחוש)
        const consolidateDebts = dealContext?.consolidate_existing_debts === true;
        // דגל מפורש מהחתם — שבתון מורים מאושר
        const teacherSabbaticalApproved = dealContext?.teacher_sabbatical_approved === true;

        if (dealContext) {
            rawData._deal_context = {
                loan_purpose: dealContext.loan_purpose || (isRefinanceDeal ? 'refinance' : 'purchase'),
                product_type: dealContext.product_type || null,
                product_label: dealContext.product_label || null,
                estimated_property_value: dealContext.estimated_property_value || null,
                requested_mortgage_amount: dealContext.requested_mortgage_amount || null,
                consolidate_existing_debts: consolidateDebts,
                teacher_sabbatical_approved: teacherSabbaticalApproved,
                is_reverse_mortgage: dealContext.is_reverse_mortgage === true,
                debts_marked_for_consolidation: consolidateDebts
            };
            // שווי נכס מהחתם — מקור אמת לחישוב LTV אם לא חולץ מטאבו
            // ✅ FIX: שווי הנכס מה-Modal גובר תמיד — גם אם חולץ מסמך (כי המסמך עלול להכיל שווי ישן)
            if (dealContext.estimated_property_value > 0) {
                rawData.property_value = dealContext.estimated_property_value;
                rawData._property_value_from_modal = true;
            }
            if (dealContext.requested_mortgage_amount > 0) {
                rawData.requested_loan_amount = dealContext.requested_mortgage_amount;
            }
        }

        const today = new Date();
        const normalizationLog = []; // audit trail of every correction made
        const suppressedAlerts = []; // alerts that were identified and suppressed

        const isMeaningfulObjectLocal = (o) => o && typeof o === 'object' && Object.values(o).some(v =>
            v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0) &&
            !(typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0)
        );

        // ═══════════════════════════════════════════════════════════════
        // MORTGAGE CLEARANCE REPORTS → EXISTING_MORTGAGE (בסיס המחזור)
        // דוחות יתרות לסילוק (הבינלאומי/מסד/הפועלים) שחולצו ב-extractSingleChunk
        // מגושרים לכאן ל-existing_mortgage עם יתרה כוללת ומסלולים, כדי שניתוח
        // כדאיות המחזור וה-LTV יקבלו את היתרה לסילוק האמיתית במקום "חסר".
        // ═══════════════════════════════════════════════════════════════
        // ✅ FIX #1 — AUTO-CLASSIFICATION: מסמך שחולץ ל-existing_mortgage אך מכיל מבנה של דוח
        // יתרות לסילוק (total_stated_balance + monthly_payment + tracks) → העבר אותו גם ל-
        // mortgage_clearance_reports כדי שמנוע המחזור יזהה אותו ויופעל. זה פותר את הבאג שבו
        // הבנק הפועלים / בינלאומי מזוהה כ-"Loan Statement" ולא כ-"Mortgage Clearance".
        if (isMeaningfulObjectLocal(rawData.existing_mortgage) && !rawData.mortgage_clearance_reports?.length) {
            const em = rawData.existing_mortgage;
            const hasBalance = (em.remaining_balance || em.total_stated_balance || 0) > 0;
            const hasMonthly = (em.monthly_payment || 0) > 0;
            const hasTracks = Array.isArray(em.tracks) && em.tracks.length > 0;
            // זהה כ-Clearance Report אם יש יתרה + תשלום חודשי (מבנה בנקאי אמיתי)
            // גם אם אין מסלולים (single-line statement)
            if (hasBalance && (hasMonthly || hasTracks)) {
                rawData.mortgage_clearance_reports = [{
                    bank_name: em.bank_name || 'לא ידוע',
                    statement_date: em.statement_date || null,
                    total_clearance_balance: em.remaining_balance || em.total_stated_balance || 0,
                    total_monthly_payment: em.monthly_payment || 0,
                    early_repayment_fee: em.early_repayment_fee || 0,
                    tracks: (em.tracks || []).map(t => ({
                        track_type: t.track_type || t.track_name || 'מסלול',
                        total_balance: t.remaining_balance || t.total_balance || 0,
                        principal_balance: t.remaining_balance || 0,
                        current_interest_rate: t.interest_rate || 0,
                        remaining_months: t.remaining_months || 0,
                        rate_basis: t.rate_basis || '',
                        linkage: t.linkage || '',
                        early_repayment_fee: t.early_repayment_fee || 0,
                        _auto_classified: true
                    })),
                    _auto_classified_from_existing_mortgage: true
                }];
                normalizationLog.push({ rule: 'EXISTING_MORTGAGE_AUTO_CLASSIFIED_AS_CLEARANCE', bank: em.bank_name, balance: em.remaining_balance || em.total_stated_balance });
            }
        }

        const clearanceReports = Array.isArray(rawData.mortgage_clearance_reports) ? rawData.mortgage_clearance_reports.filter(isMeaningfulObjectLocal) : [];
        if (clearanceReports.length > 0) {
            // היתרה הכוללת לסילוק מכל הבנקים יחד (במחזור — סוגרים את כל המשכנתאות הקיימות)
            const totalClearance = clearanceReports.reduce((s, r) => s + (r.total_clearance_balance || 0), 0);
            const totalMonthly = clearanceReports.reduce((s, r) => s + (r.total_monthly_payment || 0), 0);
            const totalEarlyFee = clearanceReports.reduce((s, r) => s + (r.early_repayment_fee || 0), 0);
            const mappedTracks = clearanceReports.flatMap(r => (r.tracks || []).map(t => ({
                track_type: t.track_type || t.track_name || 'מסלול',
                remaining_balance: t.total_balance || t.principal_balance || 0,
                interest_rate: t.current_interest_rate || 0,
                remaining_months: t.remaining_months || 0,
                rate_basis: t.rate_basis || '',
                linkage: t.linkage || '',
                early_repayment_fee: t.early_repayment_fee || 0,
                _from_clearance_report: true
            })));
            const primaryBank = clearanceReports.map(r => r.bank_name).filter(Boolean).join(' + ') || 'לא ידוע';
            const em = rawData.existing_mortgage || {};
            const emHasBalance = (em.remaining_balance || 0) > 0 || (em.total_stated_balance || 0) > 0;
            // ✅ תיקון ב׳ — גשר עמיד: פועל גם כאשר existing_mortgage קיים חלקי (bank_name ללא remaining_balance)
            if (totalClearance > 0 && (!emHasBalance || (em.bank_name && !(em.remaining_balance > 0) && !(em.total_stated_balance > 0)))) {
                rawData.existing_mortgage = {
                    ...em,
                    bank_name: em.bank_name || primaryBank,
                    remaining_balance: totalClearance,
                    total_stated_balance: totalClearance,
                    monthly_payment: em.monthly_payment || totalMonthly || 0,
                    early_repayment_fee: em.early_repayment_fee || totalEarlyFee || 0,
                    tracks: (em.tracks && em.tracks.length > 0) ? em.tracks : mappedTracks,
                    _balance_from_clearance_report: true
                };
                normalizationLog.push({ rule: 'CLEARANCE_REPORT_MAPPED_TO_MORTGAGE', banks: primaryBank, total_clearance: Math.round(totalClearance), tracks_count: mappedTracks.length });
            } else if (totalClearance > 0 && emHasBalance && (!em.tracks || em.tracks.length === 0) && mappedTracks.length > 0) {
                // יש כבר יתרה אך אין מסלולים — נצמיד את המסלולים מדוח היתרות
                rawData.existing_mortgage = { ...em, tracks: mappedTracks };
                normalizationLog.push({ rule: 'CLEARANCE_REPORT_TRACKS_ATTACHED', banks: primaryBank, tracks_count: mappedTracks.length });
            }
            rawData._mortgage_clearance_total = totalClearance;
        }

        // ── REFINANCE / CONSOLIDATION: אכיפת מדיניות סילוק חובות ──
        // כשהחתם סימן "איחוד חובות": ההלוואות הצרכניות מסומנות marked_for_extinguishment
        // ומאופסות בפועל (monthly_payment=0) כך שלא ייספרו ב-PTI העתידי.
        // המשכנתא החדשה סוגרת אותן — חישוב ה-PTI הוא (החזר משכנתא חדשה) / (הכנסה מאוחדת).
        if (isRefinanceDeal || consolidateDebts) {
            const extinguishedDebts = [];
            // איפוס ההלוואות הצרכניות מנטל החוב העתידי
            (rawData.loans || []).forEach(l => {
                l._marked_for_consolidation = true;
                if (consolidateDebts) {
                    extinguishedDebts.push({ type: 'loan', description: l.description || 'הלוואה', monthly_payment: l.monthly_payment || 0, balance: l.remaining_balance || 0 });
                    l._marked_for_extinguishment = true;
                    l._original_monthly_payment = l.monthly_payment || 0;
                    l.monthly_payment = 0; // ✅ לא נספר ב-PTI העתידי — מיועד לסילוק
                }
            });
            (rawData.credit_cards || []).forEach(c => {
                c._marked_for_consolidation = true;
                if (consolidateDebts) {
                    extinguishedDebts.push({ type: 'credit_card', description: c.issuer || c.description || 'כרטיס אשראי', monthly_payment: c.monthly_payment || c.monthly_average || 0 });
                    c._marked_for_extinguishment = true;
                    c._original_monthly_payment = c.monthly_payment || c.monthly_average || 0;
                    c.monthly_payment = 0;
                    c.monthly_average = 0; // ✅ לא נספר ב-PTI העתידי
                }
            });
            if (consolidateDebts && extinguishedDebts.length > 0) {
                rawData._extinguished_debts = extinguishedDebts;
                const totalExtinguished = extinguishedDebts.reduce((s, d) => s + (d.monthly_payment || 0), 0);
                rawData._extinguished_monthly_total = totalExtinguished;
                if (!rawData._financial_strengths) rawData._financial_strengths = [];
                rawData._financial_strengths.push({
                    type: 'DEBT_CONSOLIDATION',
                    label: 'איחוד חובות — סילוק התחייבויות קיימות',
                    description: `המשכנתא החדשה סוגרת ${extinguishedDebts.length} התחייבויות צרכניות בסך ₪${Math.round(totalExtinguished).toLocaleString()}/חודש. החזרים אלו אינם נספרים ב-PTI העתידי שכן הם מסולקים במסגרת העסקה.`,
                    monthly_relief: totalExtinguished,
                    is_strength: true,
                    is_mitigant: true
                });
                normalizationLog.push({ rule: 'DEBTS_EXTINGUISHED_FOR_CONSOLIDATION', count: extinguishedDebts.length, monthly_total: Math.round(totalExtinguished) });
            }
            // דיכוי דגלי "הוצאת אשראי חריגה" — חובות אלו מיועדים לסילוק
            const consumerDebtFlag = (f) => {
                const lf = (f || '').toLowerCase();
                return lf.includes('אשראי') || lf.includes('הוצאת אשראי') || lf.includes('כרטיס') ||
                    lf.includes('credit') || lf.includes('הלוואות צרכניות') || lf.includes('ריבוי הלוואות') ||
                    lf.includes('הלוואה מוסתרת') || lf.includes('חשד להלוואה');
            };
            if (rawData.bank_red_flags) {
                rawData.bank_red_flags = rawData.bank_red_flags.filter(f => {
                    if (consumerDebtFlag(f)) {
                        normalizationLog.push({ rule: 'REFINANCE_CONSUMER_DEBT_NOT_PENALIZED', flag: f.substring(0, 80) });
                        suppressedAlerts.push({ rule: 'CONSUMER_DEBT_FOR_CONSOLIDATION', original_text: f, reason: 'עסקת מחזור/איחוד — חוב צרכני זה מיועד לסילוק במסגרת העסקה ואינו נספר כסיכון התנהלות.' });
                        return false;
                    }
                    return true;
                });
            }
            // דיכוי דגלי "הוצאת אשראי חריגה" גם ב-executive alerts / undisclosed indicators
            if (consolidateDebts && Array.isArray(rawData.undisclosed_loan_indicators)) {
                rawData.undisclosed_loan_indicators = rawData.undisclosed_loan_indicators.filter(ind => {
                    if (consumerDebtFlag(ind)) {
                        normalizationLog.push({ rule: 'CONSOLIDATION_UNDISCLOSED_SUPPRESSED', indicator: (ind || '').substring(0, 60) });
                        return false;
                    }
                    return true;
                });
            }
            rawData._consumer_debts_for_consolidation = true;
            normalizationLog.push({ rule: 'REFINANCE_DEAL_CONTEXT_APPLIED', consolidate: consolidateDebts });
        }

        // ═══════════════════════════════════════════════════════════════
        // LAYER 0: INPUT SANITIZATION — Hebrew/English normalization
        // ═══════════════════════════════════════════════════════════════

        const canonicalEmploymentType = (et) => {
            if (!et) return et;
            const lower = et.toLowerCase().trim();
            if (lower.includes('sabbatical') || lower.includes('שבתון')) return 'שבתון';
            if (lower.includes('maternity') || lower.includes('לידה') || lower.includes('הריון')) return 'חופשת לידה';
            if (lower.includes('unpaid leave') || lower.includes('חל"ת') || lower.includes('חלת')) return 'חל"ת';
            if (lower.includes('self employed') || lower.includes('self-employed') || lower.includes('עצמאי')) return 'עצמאי';
            if (lower.includes('salaried') || lower.includes('שכיר')) return 'שכיר';
            if (lower.includes('pensioner') || lower.includes('גמלאי')) return 'גמלאי';
            return et;
        };

        const fixSabbaticalVsLeave = (borrower) => {
            const et = (borrower.employment_type || '').toLowerCase();
            const sn = (borrower.special_status_note || '').toLowerCase();
            const employer = (borrower.employer || '').toLowerCase();
            const isEducation = employer.includes('חינוך') || employer.includes('הוראה') || employer.includes('education');
            const hasSabbaticalDoc = (rawData.special_circumstances || []).some(s =>
                s.toLowerCase().includes('שבתון') || s.toLowerCase().includes('sabbatical') || s.toLowerCase().includes('keren hishtalmut')
            );
            const sabbaticalInNote = sn.includes('שבתון') || sn.includes('sabbatical');
            if ((et.includes('חל"ת') || et.includes('חלת') || et.includes('unpaid')) && isEducation && (hasSabbaticalDoc || sabbaticalInNote)) {
                normalizationLog.push({ rule: 'HALAT_TO_SABBATICAL', employer: borrower.employer, original: borrower.employment_type, reason: 'Education employee with sabbatical indicators' });
                return 'שבתון';
            }
            return borrower.employment_type;
        };

        const translateToHe = (text) => {
            if (!text) return text;
            return text
                .replace(/on sabbatical with monthly payout from keren hishtalmut/gi, 'בשנת שבתון — מקבל תשלום חודשי מקרן ההשתלמות')
                .replace(/on sabbatical/gi, 'בשנת שבתון')
                .replace(/keren hishtalmut/gi, 'קרן השתלמות')
                .replace(/high leverage with multiple existing consumer loans/gi, 'מינוף גבוה — ריבוי הלוואות צרכניות קיימות')
                .replace(/multiple existing loans/gi, 'ריבוי הלוואות קיימות')
                .replace(/high leverage/gi, 'מינוף גבוה')
                .replace(/Borrower\s*1/gi, 'לווה 1')
                .replace(/Borrower\s*2/gi, 'לווה 2')
                .replace(/sabbatical/gi, 'שבתון')
                .replace(/maternity leave/gi, 'חופשת לידה')
                .replace(/unpaid leave/gi, 'חל"ת')
                .replace(/self.?employed/gi, 'עצמאי')
                .replace(/salaried/gi, 'שכיר')
                .replace(/pensioner/gi, 'גמלאי')
                .replace(/significant liquid equity/gi, 'הון עצמי נזיל משמעותי')
                .replace(/liquid equity/gi, 'הון עצמי נזיל')
                .replace(/strong financial profile/gi, 'פרופיל פיננסי חזק')
                .replace(/stable employment/gi, 'תעסוקה יציבה')
                .replace(/rental income/gi, 'הכנסה משכ"ד')
                .replace(/business owner/gi, 'בעל עסק')
                .replace(/sole proprietor/gi, 'עוסק מורשה')
                .replace(/company owner/gi, 'בעל חברה')
                .replace(/receives?\s+monthly\s+salary\s+from/gi, 'מקבל משכורת חודשית מ-')
                .replace(/monthly salary/gi, 'משכורת חודשית')
                .replace(/as seen in bank statement/gi, 'כפי שנצפה בדף חשבון')
                .replace(/bank statement/gi, 'דף חשבון')
                .replace(/deposit of ([\d,]+) ILS/gi, 'הפקדה של ₪$1')
                .replace(/deposit of ([\d,]+) NIS/gi, 'הפקדה של ₪$1')
                .replace(/has an active employee loan/gi, 'קיימת הלוואת עובדים פעילה')
                .replace(/employee loan/gi, 'הלוואת עובדים')
                .replace(/monthly payment of ([\d,]+)/gi, 'תשלום חודשי של ₪$1')
                .replace(/at ([\d.]+)%\s+prime.?based interest/gi, 'בריבית $1% מבוססת פריים')
                .replace(/prime.?based interest/gi, 'ריבית מבוססת פריים')
                .replace(/\bprime\b/gi, 'פריים')
                .replace(/high statutory deductions and pension contributions/gi, 'ניכויי חובה גבוהים והפרשות פנסיה')
                .replace(/statutory deductions/gi, 'ניכויי חובה')
                .replace(/pension contributions/gi, 'הפרשות פנסיה')
                .replace(/Employer based on/gi, 'מעסיק על בסיס')
                .replace(/Employee ID ([\w-]+) on payslips/gi, 'מספר עובד $1 בתלושי השכר')
                .replace(/employee id/gi, 'מספר עובד')
                .replace(/includes? travel and phone benefits/gi, 'כולל הטבות נסיעה וטלפון')
                .replace(/\bbenefits?\b/gi, 'הטבות')
                .replace(/the couple has/gi, 'לבני הזוג')
                .replace(/with monthly payment of/gi, 'עם תשלום חודשי של ₪')
                .replace(/Bank Hapoalim/gi, 'בנק הפועלים')
                .replace(/Bank Leumi/gi, 'בנק לאומי')
                .replace(/Bank Discount/gi, 'בנק דיסקונט')
                .replace(/Bank Mizrahi/gi, 'בנק מזרחי')
                .replace(/Bank Otzar Hahayal/gi, 'בנק אוצר החייל')
                .replace(/\bon\s+(\d{2})\.(\d{2})\.(\d{4})\b/gi, 'בתאריך $1.$2.$3')
                .replace(/NIS/gi, '₪')
                .replace(/ILS/gi, '₪');
        };

        const anySabbatical = (rawData.borrowers || []).some(b => {
            const et = (b.employment_type || '').toLowerCase();
            const sn = (b.special_status_note || '').toLowerCase();
            return et.includes('שבתון') || et.includes('sabbatical') || sn.includes('שבתון') || sn.includes('sabbatical');
        });
        const hasSabbaticalKeren = (rawData.keren_hishtalmut || []).some(k => k.monthly_payout > 0);

        const hasRealReserveDuty = (rawData.reserve_duty_months || []).length > 0;
        const hasReservePay = (rawData.income_deposits || []).some(d => {
            const desc = (d.description || '').toLowerCase();
            return desc.includes('מילואים') || desc.includes('תגמול') || desc.includes('reserve');
        });
        const MILITARY_HALLUCINATION_KEYWORDS = [
            'מילואים', 'צנחנים', 'גולני', 'נח"ל', 'חטיבה', 'גדוד', 'פלוגה', 'צבא',
            'reserve duty', 'paratroopers', 'military', 'idf unit', 'combat unit'
        ];

        if (rawData.special_circumstances) {
            rawData.special_circumstances = rawData.special_circumstances
                .map(translateToHe)
                .filter(sc => {
                    const scLower = sc.toLowerCase();
                    const isMilitaryMention = MILITARY_HALLUCINATION_KEYWORDS.some(kw => scLower.includes(kw.toLowerCase()));
                    if (isMilitaryMention && !hasRealReserveDuty && !hasReservePay) {
                        normalizationLog.push({ rule: 'MILITARY_HALLUCINATION_STRIPPED', text: sc.substring(0, 80) });
                        return false;
                    }
                    const isSabbaticalRelated = sc.includes('שבתון') || sc.includes('sabbatical') || sc.includes('קרן השתלמות');
                    if (isSabbaticalRelated && !anySabbatical && !hasSabbaticalKeren) {
                        normalizationLog.push({ rule: 'CONTEXT_LEAK_SABBATICAL_STRIPPED', text: sc.substring(0, 60) });
                        return false;
                    }
                    return true;
                });
        }

        if (rawData.payslip_deduction_alerts) {
            rawData.payslip_deduction_alerts = rawData.payslip_deduction_alerts.map(alert => ({
                ...alert,
                suspected_reason: translateToHe((alert.suspected_reason || '')
                    .replace(/Deductions for loans of ([\d,]+) NIS and insurance/gi, 'ניכויי הלוואות וביטוח — כ-₪$1')
                    .replace(/Deductions for loans of ([\d,]+) NIS/gi, 'ניכויי הלוואות — כ-₪$1')
                    .replace(/insurance deductions/gi, 'ניכויי ביטוח')
                    .replace(/loan deductions/gi, 'ניכויי הלוואות')
                    .replace(/high statutory deductions and pension contributions/gi, 'ניכויי חובה גבוהים והפרשות פנסיה')
                    .replace(/NIS/gi, '₪'))
            }));
        }

        if (rawData.borrowers) {
            rawData.borrowers = rawData.borrowers.map(b => {
                const fixedEt = fixSabbaticalVsLeave(b);
                const canonicalEt = canonicalEmploymentType(fixedEt);
                if (canonicalEt !== b.employment_type) {
                    normalizationLog.push({ rule: 'EMPLOYMENT_TYPE_CANONICAL', borrower: b.name, original: b.employment_type, corrected: canonicalEt });
                }
                const translatedNote = b.special_status_note ? translateToHe(b.special_status_note) : b.special_status_note;
                return { ...b, employment_type: canonicalEt, special_status_note: translatedNote };
            });
        }

        // ─────────────────────────────────────────────
        // ID NORMALIZATION
        // ─────────────────────────────────────────────
        const normalizeIsraeliId = (idStr) => {
            if (!idStr) return '';
            const digitsOnly = idStr.replace(/\D/g, '');
            if (digitsOnly.length === 0) return '';
            return digitsOnly.padStart(9, '0');
        };

        if (rawData.borrowers) {
            // ── מיפוי ת.ז. שהופיעו בתלושי שכר → לפי שם/סלוט, כדי לגשר זהות גם ללווה ללא שדה id ──
            // אורטל מגיעה ללא b.id, אך ת.ז. שלה (032557852) מופיעה בתלוש (id_number). בלי הגשר הזה
            // היא נשארת id_document_found:false → "חסר קריטי" שגוי. כאן מאתרים ת.ז. מהתלוש לפי סלוט.
            const slipIdForSlot = (slotIdx) => {
                const slips = slotIdx === 0 ? (rawData.payslips_borrower1 || []) : (rawData.payslips_borrower2 || []);
                for (const p of slips) {
                    const sid = normalizeIsraeliId(p.id_number || '');
                    if (sid.length === 9) return sid;
                }
                return '';
            };
            const allSlipIdsForSlot = (slotIdx) => {
                const slips = slotIdx === 0 ? (rawData.payslips_borrower1 || []) : (rawData.payslips_borrower2 || []);
                const ids = new Set();
                slips.forEach(p => {
                    const sid = normalizeIsraeliId(p.id_number || '');
                    if (sid.length === 9) ids.add(sid);
                });
                return ids;
            };
            // ת.ז התלושים לכל סלוט — לזיהוי ת.ז "דבוקה" מהלווה הלא נכון
            const slot0SlipIds = allSlipIdsForSlot(0);
            const slot1SlipIds = allSlipIdsForSlot(1);
            rawData.borrowers = rawData.borrowers.map((b, idx) => {
                const idFromField = normalizeIsraeliId(b.id || '');
                // ת.ז של הלווה הזה מהתלוש שלו (הסלוט שלו) — מקור האמת לבעלות
                const ownSlipId = slipIdForSlot(idx);
                const ownSlotIds = idx === 0 ? slot0SlipIds : slot1SlipIds;
                const otherSlotIds = idx === 0 ? slot1SlipIds : slot0SlipIds;
                // ת.ז "שגויה" בשדה id כשלתלוש של הלווה יש ת.ז משלו השונה ממנה. שני מצבים:
                // (א) ה-id שייך לתלוש בן/בת הזוג (OCR הדביק ת.ז של השני).
                // (ב) ה-id זהה לזה של הלווה האחר (אותה ת.ז הודבקה לשניהם) ולתלוש שלו ת.ז שונה.
                // בשני המצבים — ת.ז התלוש של הלווה עצמו היא האמת.
                const idMismatchesOwnSlip = ownSlipId.length === 9 && idFromField.length === 9 &&
                    idFromField !== ownSlipId && !ownSlotIds.has(idFromField);
                const idBelongsToOther = idFromField.length === 9 && otherSlotIds.has(idFromField) && !ownSlotIds.has(idFromField);
                // PAYSLIP-FIRST: ת.ז מהתלוש גוברת על שדה id
                let effectiveId;
                if (ownSlipId.length === 9) {
                    // תלוש קיים — השתמש בת.ז ממנו תמיד
                    effectiveId = ownSlipId;
                    if (idFromField.length === 9 && idFromField !== ownSlipId) {
                        normalizationLog.push({ rule: 'ID_RECLAIMED_FROM_OWN_PAYSLIP', borrower: b.name, glued_id: idFromField, correct_id: ownSlipId, reason: 'PAYSLIP-FIRST: ת.ז התלוש גוברת על שדה id (OCR-glue / Wallet-photo ספח)' });
                    }
                } else if (idBelongsToOther && ownSlipId.length !== 9) {
                    // ת.ז בשדה שייכת לבן/בת הזוג ואין תלוש לתיקון — שדה id אינו אמין
                    effectiveId = '';
                    normalizationLog.push({ rule: 'ID_BELONGS_TO_OTHER_NO_SLIP', borrower: b.name, glued_id: idFromField });
                } else {
                    effectiveId = idFromField.length === 9 ? idFromField : '';
                }
                const hasValidId = effectiveId.length === 9;
                if (b.id && idFromField !== (b.id || '').replace(/\D/g, '')) {
                    normalizationLog.push({ rule: 'ID_LEADING_ZERO_NORMALIZED', borrower: b.name, original: b.id, normalized: idFromField });
                }
                // ✅ RULE: id_document_found נקבע אך ורק לפי מה שה-LLM קבע בחילוץ (true/false).
                // אסור לשנות id_document_found ל-true רק בגלל שמספר ת.ז. תקין נמצא —
                // כי המספר יכול להגיע מהספח של בן/בת הזוג (שם הלווה מופיע כ"בן זוג", לא כבעל התעודה).
                // רק ה-LLM יכול לשפוט אם זה המסמך הראשי של הלווה.
                // החריג היחיד: אם id_document_found עדיין undefined/null (לא הוחלט), נגדיר false.
                // ── FIX: ברירת המחדל הזו חייבת לחול תמיד, לא רק כש-hasValidId=true ──
                // בעבר, הענף hasValidId=false (בדיוק המקרה של בן/בת זוג שזוהה רק מהספח, ללא
                // תלוש משלו/שלה לאימות ה-ID) עקף את הבדיקה כליל והחזיר b.id_document_found
                // הגולמי ללא שינוי — כך undefined "דלף" למטה ותורגם ל"מאומת" ע"י צרכנים שמשתמשים
                // ב-!== false. עכשיו docFound מחושב תמיד, בשני הענפים.
                const docFound = b.id_document_found === true ? true : false;
                if (b.id_document_found === undefined || b.id_document_found === null) {
                    normalizationLog.push({ rule: 'ID_DOC_FLAG_DEFAULTED_FALSE', borrower: b.name, reason: 'id_document_found לא הוגדר על ידי ה-LLM — ברירת מחדל: false (ת.ז. נמצאה אך לא ידוע אם מהמסמך הראשי)' });
                }
                if (hasValidId) {
                    return { ...b, id: effectiveId, id_document_found: docFound };
                }
                return { ...(b.id ? { ...b, id: idFromField } : b), id_document_found: docFound };
            });
        }

        ['payslips_borrower1', 'payslips_borrower2'].forEach(key => {
            if (rawData[key]) {
                rawData[key] = rawData[key].map(p => {
                    if (!p.employee_id) return p;
                    const normalized = normalizeIsraeliId(p.employee_id);
                    if (normalized !== (p.employee_id || '').replace(/\D/g, '') && normalized.length === 9) {
                        normalizationLog.push({ rule: 'PAYSLIP_ID_LEADING_ZERO_NORMALIZED', month: p.month_year, original: p.employee_id, normalized });
                    }
                    return { ...p, employee_id: normalized };
                });
            }
        });

        const idKey = (raw) => { const k = normalizeIsraeliId(raw || ''); return k.length === 9 ? k : ''; };

        // ── HARD IDENTITY ANCHOR OVERRIDE ──
        // If the underwriter provided identity_anchors in deal_context, they are THE source of truth.
        // Override borrower.id values with the anchors — this locks identity before any other normalization.
        const anchorList = (dealContext?.identity_anchors || []).filter(a => a && (a.id || a.name));
        if (anchorList.length > 0 && rawData.borrowers) {
            anchorList.forEach((anchor, anchorIdx) => {
                const anchorId = idKey(anchor.id || '');
                if (anchorIdx < rawData.borrowers.length) {
                    const b = rawData.borrowers[anchorIdx];
                    const updates = {};
                    if (anchorId.length === 9) updates.id = anchorId;
                    if (anchor.name && !b.name) updates.name = anchor.name;
                    if (Object.keys(updates).length > 0) {
                        rawData.borrowers[anchorIdx] = { ...b, ...updates };
                        normalizationLog.push({ rule: 'IDENTITY_ANCHOR_APPLIED', slot: anchorIdx, anchor_id: anchorId, anchor_name: anchor.name });
                    }
                }
            });
        }

        // ── HARD ID LOCK: borrower.id is immutable — built from payslip id_number only if borrower has no id yet ──
        // NEVER overwrite an existing borrower.id. If the borrower already has an id, keep it.
        // If the borrower has no id, try to find it from their payslips.
        if (rawData.borrowers && rawData.borrowers.length >= 2) {
            [0, 1].forEach(slot => {
                const b = rawData.borrowers[slot];
                if (idKey(b.id).length === 9) return; // already has valid ID — never touch it
                const slips = slot === 0 ? (rawData.payslips_borrower1 || []) : (rawData.payslips_borrower2 || []);
                for (const p of slips) {
                    const pid = idKey(p.id_number);
                    if (pid.length === 9) {
                        rawData.borrowers[slot] = { ...b, id: pid };
                        normalizationLog.push({ rule: 'ID_FILLED_FROM_PAYSLIP', slot, id: pid, borrower: b.name });
                        break;
                    }
                }
            });
        }

        const idToBorrowerIndex = {};
        (rawData.borrowers || []).forEach((b, idx) => { const k = idKey(b.id); if (k) idToBorrowerIndex[k] = idx; });

        // ── DETERMINISTIC PAYSLIP ASSIGNMENT by Anchor IDs ──
        // If anchors exist: payslips with id_number matching anchor[0] → slot0, anchor[1] → slot1.
        // Payslips with no matching id_number stay in their original slot.
        // Payslips with id_number matching the WRONG anchor → forcibly moved.
        if (anchorList.length >= 2 && rawData.borrowers) {
            const anchor0Id = idKey(anchorList[0]?.id || '');
            const anchor1Id = idKey(anchorList[1]?.id || '');
            if (anchor0Id.length === 9 && anchor1Id.length === 9) {
                const allPayslips = [
                    ...(rawData.payslips_borrower1 || []).map(p => ({ ...p, _original_slot: 0 })),
                    ...(rawData.payslips_borrower2 || []).map(p => ({ ...p, _original_slot: 1 })),
                ];
                const newSlot0 = [], newSlot1 = [];
                allPayslips.forEach(({ _original_slot, ...p }) => {
                    const pid = idKey(p.id_number);
                    if (pid === anchor0Id) newSlot0.push(p);
                    else if (pid === anchor1Id) newSlot1.push(p);
                    else if (_original_slot === 0) newSlot0.push(p); // no ID match → keep original
                    else newSlot1.push(p);
                });
                const changed = newSlot0.length !== (rawData.payslips_borrower1 || []).length ||
                    newSlot1.length !== (rawData.payslips_borrower2 || []).length;
                if (changed) {
                    rawData.payslips_borrower1 = newSlot0;
                    rawData.payslips_borrower2 = newSlot1;
                    normalizationLog.push({ rule: 'ANCHOR_DETERMINISTIC_PAYSLIP_ASSIGNMENT', slot0_count: newSlot0.length, slot1_count: newSlot1.length, anchor0: anchor0Id, anchor1: anchor1Id });
                }
            }
        }

        // ═══════════════════════════════════════════════════════════════
        // ✅ FIX: ENTITY RESOLUTION לעצמאי — שיוך business_data ללווה הנכון
        // הבאג: שומת מס/אישור רו"ח של "יקים ארמה" (שם חיבה) לא חוברו ל-"יעקב ארמה"
        // (שם בת.ז.) → הכנסת העצמאי אופסה. התיקון: שיוך לפי ת.ז. (אמין ביותר) ואם אין,
        // לפי שם עם גמישות לשמות חיבה/קיצור (יקים↔יעקב). קובע owner_borrower_index נכון
        // כדי ש-buildUnderwriterReport ייחס את ההכנסה ללווה הנכון ויפיק verified_income.
        // ═══════════════════════════════════════════════════════════════
        if (isMeaningfulObjectLocal(rawData.business_data)) {
            const bd = rawData.business_data;
            // נירמול שם לצורך השוואה: הסרת תארים, רווחים כפולים
            const normNameTokens = (name) => (name || '')
                .replace(/["'.]/g, '').trim().toLowerCase()
                .split(/\s+/).filter(w => w.length > 1);
            // שמות חיבה/קיצור נפוצים בעברית — שורש משותף נחשב התאמה
            const nicknameMatch = (a, b) => {
                if (!a || !b) return false;
                if (a === b) return true;
                // שורש משותף של ≥3 אותיות בתחילת המילה (יעקב/יקים → "יע"/"יק" — לכן בודקים גם דמיון אותיות)
                const shorter = a.length <= b.length ? a : b;
                const longer = a.length <= b.length ? b : a;
                if (longer.startsWith(shorter.slice(0, 3))) return true;
                // התאמת ראשי-תיבות + אורך דומה (יקים↔יעקב: אות ראשונה זהה, 3-4 אותיות)
                if (a[0] === b[0] && Math.abs(a.length - b.length) <= 2) {
                    const common = [...a].filter(ch => b.includes(ch)).length;
                    if (common >= Math.min(a.length, b.length) - 1) return true;
                }
                return false;
            };
            const matchBusinessToBorrower = (ownerName) => {
                const ownerTokens = normNameTokens(ownerName);
                if (ownerTokens.length === 0) return -1;
                const arr = rawData.borrowers || [];
                let best = -1, bestScore = 0;
                for (let i = 0; i < arr.length; i++) {
                    const bTokens = normNameTokens(arr[i].name);
                    if (bTokens.length === 0) continue;
                    // ספירת התאמות: שם משפחה (התאמה מדויקת) + שם פרטי (כולל חיבה)
                    let score = 0;
                    bTokens.forEach(bt => {
                        if (ownerTokens.some(ot => ot === bt || nicknameMatch(ot, bt))) score++;
                    });
                    if (score > bestScore) { bestScore = score; best = i; }
                }
                // דרוש לפחות התאמה אחת (שם משפחה משותף מספיק בתיק זוגי)
                return bestScore >= 1 ? best : -1;
            };

            // עדיפות 1: שיוך לפי ת.ז. של בעל העסק (אמין ביותר — חוצה הבדלי שם חיבה)
            let resolvedIdx = -1;
            const ownerIdKey = idKey(bd.owner_id);
            if (ownerIdKey && idToBorrowerIndex[ownerIdKey] !== undefined) {
                resolvedIdx = idToBorrowerIndex[ownerIdKey];
                normalizationLog.push({ rule: 'BUSINESS_DATA_RESOLVED_BY_ID', owner_id: ownerIdKey, borrower_index: resolvedIdx });
            }
            // עדיפות 2: שיוך לפי שם עם גמישות לשמות חיבה (יקים↔יעקב)
            if (resolvedIdx < 0 && bd.owner_name) {
                resolvedIdx = matchBusinessToBorrower(bd.owner_name);
                if (resolvedIdx >= 0) {
                    normalizationLog.push({ rule: 'BUSINESS_DATA_RESOLVED_BY_NICKNAME', owner_name: bd.owner_name, matched_borrower: rawData.borrowers[resolvedIdx]?.name, borrower_index: resolvedIdx });
                }
            }
            // עדיפות 3: אם יש בדיוק לווה אחד שאינו שכיר עם תלושים פעילים — הוא העצמאי
            if (resolvedIdx < 0 && (rawData.borrowers || []).length >= 1) {
                const candidates = (rawData.borrowers || []).map((b, i) => {
                    const slips = i === 0 ? (rawData.payslips_borrower1 || []) : (rawData.payslips_borrower2 || []);
                    const hasActiveSalary = slips.filter(p => (p.net_salary || 0) > 3000).length >= 2;
                    return { i, hasActiveSalary };
                }).filter(c => !c.hasActiveSalary);
                if (candidates.length === 1) {
                    resolvedIdx = candidates[0].i;
                    normalizationLog.push({ rule: 'BUSINESS_DATA_RESOLVED_BY_ELIMINATION', borrower_index: resolvedIdx, reason: 'לווה יחיד ללא תלושי שכר פעילים = בעל העסק' });
                }
            }

            if (resolvedIdx >= 0) {
                bd.owner_borrower_index = resolvedIdx;
                // סמן את הלווה כעצמאי אם אינו מסומן כך כבר (כדי שה-Checklist וה-IdentityLock יתנהגו נכון)
                const b = rawData.borrowers[resolvedIdx];
                const et = (b.employment_type || '').toLowerCase();
                if (b && !et.includes('עצמאי') && !et.includes('שבתון')) {
                    rawData.borrowers[resolvedIdx] = { ...b, employment_type: et.includes('שכיר') ? 'שכיר+עצמאי' : 'עצמאי' };
                    normalizationLog.push({ rule: 'BORROWER_MARKED_SELF_EMPLOYED', borrower: b.name, borrower_index: resolvedIdx });
                }
                // ✅ תיקון א׳ — גשר מעסיק לעצמאי: אם שדה employer ריק ויש owner_name ב-business_data → שתול
                // מונע Identity Lock צהוב שגוי: ברגע שיש employer, המערכת לא תחפש תלושים לעצמאי
                const bAfter = rawData.borrowers[resolvedIdx];
                if (bAfter && !bAfter.employer && (bd.owner_name || bd.business_name)) {
                    rawData.borrowers[resolvedIdx] = { ...bAfter, employer: bd.owner_name || bd.business_name };
                    normalizationLog.push({ rule: 'SELF_EMPLOYED_EMPLOYER_BRIDGED_FROM_BUSINESS_DATA', borrower: bAfter.name, employer: bd.owner_name || bd.business_name });
                }
            } else {
                normalizationLog.push({ rule: 'BUSINESS_DATA_UNRESOLVED', owner_name: bd.owner_name, owner_id: bd.owner_id });
            }
        }

        // ─────────────────────────────────────────────
        // ENTITY RESOLUTION: LEAVE / SABBATICAL DOC → CORRECT BORROWER
        // ✅ FIX: מסמך חל"ת/שבתון ממוען ללווה אחד בלבד. משייכים אותו לפי
        // belongs_to_id / belongs_to_name, וקובעים את סטטוס התעסוקה רק על אותו לווה.
        // מונע "הלבשת" שבתון של דורון על פמלה (Cross-Contamination).
        // ─────────────────────────────────────────────
        const matchNameToBorrowerIndex = (name) => {
            if (!name) return -1;
            const target = name.toLowerCase().trim();
            const arr = rawData.borrowers || [];
            for (let i = 0; i < arr.length; i++) {
                const parts = (arr[i].name || '').toLowerCase().split(/\s+/).filter(w => w.length > 1);
                if (parts.length === 0) continue;
                const matches = parts.filter(p => target.includes(p)).length;
                if (parts.length >= 2 ? matches >= 2 : matches >= 1) return i;
            }
            return -1;
        };

        if (Array.isArray(rawData.leave_documents) && rawData.leave_documents.length > 0 && (rawData.borrowers || []).length > 0) {
            const leaveTypeToEt = (lt) => {
                const l = (lt || '').toLowerCase();
                if (l.includes('שבתון') || l.includes('sabbatical')) return 'שבתון';
                if (l.includes('לידה') || l.includes('maternity')) return 'חופשת לידה';
                if (l.includes('חל"ת') || l.includes('חלת') || l.includes('unpaid')) return 'חל"ת';
                if (l.includes('מחלה')) return 'מחלה ממושכת';
                return 'שבתון';
            };
            const targetedBorrowerIdxs = new Set();
            rawData.leave_documents.forEach(doc => {
                let idx = -1;
                const docIdKey = idKey(doc.belongs_to_id);
                if (docIdKey && idToBorrowerIndex[docIdKey] !== undefined) idx = idToBorrowerIndex[docIdKey];
                if (idx < 0) idx = matchNameToBorrowerIndex(doc.belongs_to_name);
                if (idx >= 0 && rawData.borrowers[idx]) {
                    targetedBorrowerIdxs.add(idx);
                    const et = leaveTypeToEt(doc.leave_type);
                    const note = [et, doc.start_date ? `מ-${doc.start_date}` : '', doc.end_date ? `עד ${doc.end_date}` : '', doc.issuing_body || ''].filter(Boolean).join(' ');
                    rawData.borrowers[idx] = { ...rawData.borrowers[idx], employment_type: et, special_status_note: note };
                    normalizationLog.push({ rule: 'LEAVE_DOC_RESOLVED_TO_BORROWER', leave_type: et, borrower: rawData.borrowers[idx].name, belongs_to: doc.belongs_to_name || doc.belongs_to_id, resolved_index: idx });
                } else {
                    normalizationLog.push({ rule: 'LEAVE_DOC_UNRESOLVED', leave_type: doc.leave_type, belongs_to_name: doc.belongs_to_name, belongs_to_id: doc.belongs_to_id });
                }
            });
            // ✅ ביטול דגל שבתון/חל"ת מלווה שיש לו תלושים פעילים אך לא ממוען אליו מסמך חופשה
            rawData.borrowers = rawData.borrowers.map((b, i) => {
                const et = (b.employment_type || '').toLowerCase();
                const isLeaveType = et.includes('שבתון') || et.includes('חל"ת') || et.includes('חלת') || et.includes('לידה') || et.includes('sabbatical');
                if (isLeaveType && !targetedBorrowerIdxs.has(i)) {
                    const slips = i === 0 ? (rawData.payslips_borrower1 || []) : (rawData.payslips_borrower2 || []);
                    const hasActiveSlips = slips.filter(p => (p.net_salary || 0) > 3000).length >= 2;
                    if (hasActiveSlips) {
                        normalizationLog.push({ rule: 'LEAVE_FLAG_CLEARED_WRONG_BORROWER', borrower: b.name, original: b.employment_type, reason: 'מסמך החופשה ממוען ללווה אחר; ללווה זה תלושים פעילים' });
                        return { ...b, employment_type: 'שכיר', special_status_note: null };
                    }
                }
                return b;
            });
        }

        const resolveDocToBorrowerIndex = (docId, defaultIndex, docType) => {
            const cleanDocId = idKey(docId);
            if (cleanDocId && idToBorrowerIndex[cleanDocId] !== undefined) {
                const resolved = idToBorrowerIndex[cleanDocId];
                if (resolved !== defaultIndex) {
                    normalizationLog.push({ rule: 'IDENTITY_LOCK_SWAP_DETECTED', doc_type: docType, doc_id: cleanDocId, default_index: defaultIndex, resolved_index: resolved });
                }
                return { index: resolved, id_verified: true };
            }
            return { index: defaultIndex, id_verified: false };
        };

        // Payslip reassignment by ID
        const reassignPayslipsByIdOld1 = rawData.payslips_borrower1 || [];
        const reassignPayslipsByIdOld2 = rawData.payslips_borrower2 || [];
        const finalPayslipsB1 = [];
        const finalPayslipsB2 = [];

        [...reassignPayslipsByIdOld1.map(p => ({ ...p, _original_slot: 0 })),
         ...reassignPayslipsByIdOld2.map(p => ({ ...p, _original_slot: 1 }))
        ].forEach(payslip => {
            // ת.ז. בתלוש מנופדת ל-9 (לתפוס 39319207 → 039319207); מספר עובד פנימי לא יעבור idKey
            const slipId = idKey(payslip.id_number) || idKey(payslip.employee_id);
            const originalSlot = payslip._original_slot;
            if (slipId && idToBorrowerIndex[slipId] !== undefined) {
                const correctSlot = idToBorrowerIndex[slipId];
                if (correctSlot !== originalSlot) {
                    normalizationLog.push({ rule: 'PAYSLIP_REASSIGNED_BY_ID', employee_id: slipId, month: payslip.month_year, from_slot: originalSlot + 1, to_slot: correctSlot + 1 });
                }
                const { _original_slot, ...cleanPayslip } = payslip;
                if (correctSlot === 0) finalPayslipsB1.push(cleanPayslip);
                else finalPayslipsB2.push(cleanPayslip);
            } else {
                const { _original_slot, ...cleanPayslip } = payslip;
                if (originalSlot === 0) finalPayslipsB1.push(cleanPayslip);
                else finalPayslipsB2.push(cleanPayslip);
            }
        });

        if (finalPayslipsB1.length !== reassignPayslipsByIdOld1.length || finalPayslipsB2.length !== reassignPayslipsByIdOld2.length) {
            rawData.payslips_borrower1 = finalPayslipsB1;
            rawData.payslips_borrower2 = finalPayslipsB2;
        }

        // Clear employee IDs that don't match any borrower
        ['payslips_borrower1', 'payslips_borrower2'].forEach(key => {
            if (!rawData[key]) return;
            rawData[key] = rawData[key].map(p => {
                const slipId = (p.employee_id || '').replace(/\D/g, '');
                if (!slipId || slipId.length !== 9) return p;
                const matchesBorrower = idToBorrowerIndex[slipId] !== undefined;
                if (!matchesBorrower) {
                    const slipName = (p.borrower_name || p.employee_name || '').trim();
                    const borrowerNameMatch = (rawData.borrowers || []).some(b =>
                        slipName && b.name && b.name.split(' ').filter(Boolean).some(w => slipName.includes(w))
                    );
                    if (borrowerNameMatch) {
                        normalizationLog.push({ rule: 'PAYSLIP_ID_FROM_NON_EMPLOYEE_CLEARED', month: p.month_year, bad_id: slipId });
                        return { ...p, employee_id: null, _employee_id_unclear: true };
                    }
                }
                return p;
            });
        });

        // EMPLOYER-BASED PAYSLIP SWAP — DISABLED
        // Causes catastrophic contamination when both borrowers share the same employer (e.g. Ministry of Education).
        // The only safe reassignment is via ID match — already handled by PAYSLIP_REASSIGNED_BY_ID above.
        normalizationLog.push({ rule: 'EMPLOYER_BASED_PAYSLIP_SWAP_DISABLED', reason: 'Unsafe when both borrowers share same employer; ID-only assignment is the source of truth' });

        // ✅ NAME-BASED PAYSLIP SWAP — DISABLED
        // This logic caused catastrophic cross-borrower contamination in the Katzav case:
        // Pamela received Doron's sabbatical doc and Doron received all of Pamela's Ministry of Education payslips.
        // The ONLY safe assignment is via ID (t.z.) — already handled above by PAYSLIP_REASSIGNED_BY_ID.
        // Name matching is too ambiguous with Hebrew partial names / shared last names → permanently removed.
        // normalizationLog entry kept for audit trail.
        normalizationLog.push({ rule: 'NAME_BASED_PAYSLIP_SWAP_DISABLED', reason: 'Replaced by strict ID-only assignment to prevent cross-borrower contamination' });

        // EMPLOYMENT_TYPE_SWAP — DISABLED
        // This logic swapped sabbatical/employment types between borrowers based on heuristics,
        // causing Pamela's employment status to be incorrectly assigned to Doron in the Katzav case.
        // Employment type must come directly from the leave_documents (resolved by ID) — never swapped heuristically.
        normalizationLog.push({ rule: 'EMPLOYMENT_TYPE_SWAP_DISABLED', reason: 'Employment type must come from leave_documents resolved by ID only' });

        if (rawData.keren_hishtalmut && rawData.keren_hishtalmut.length > 0) {
            rawData.keren_hishtalmut = rawData.keren_hishtalmut.map(k => {
                const kerenId = idKey(k.owner_id) || idKey(k.id_number);
                if (kerenId && idToBorrowerIndex[kerenId] !== undefined) {
                    const correctIndex = idToBorrowerIndex[kerenId];
                    if (k.borrower_index !== correctIndex) {
                        normalizationLog.push({ rule: 'KEREN_HISHTALMUT_REASSIGNED_BY_ID', owner_id: kerenId, from_index: k.borrower_index, to_index: correctIndex });
                        return { ...k, borrower_index: correctIndex, _id_verified: true };
                    }
                    return { ...k, _id_verified: true };
                }
                return k;
            });
        }

        if (rawData.income_deposits && rawData.income_deposits.length > 0) {
            rawData.income_deposits = rawData.income_deposits.map(d => {
                const depositId = idKey(d.owner_id) || idKey(d.id_number);
                if (depositId && idToBorrowerIndex[depositId] !== undefined) {
                    const correctIndex = idToBorrowerIndex[depositId];
                    if (d.borrower_index !== undefined && d.borrower_index !== correctIndex) {
                        normalizationLog.push({ rule: 'INCOME_DEPOSIT_REASSIGNED_BY_ID', owner_id: depositId, from_index: d.borrower_index, to_index: correctIndex });
                        return { ...d, borrower_index: correctIndex, _id_verified: true };
                    }
                    return { ...d, _id_verified: true };
                }
                return d;
            });
        }

        // ─────────────────────────────────────────────
        // LAYER 1: ESPP & STOCK PLAN CLASSIFICATION
        // ✅ FIX: ESPP is equity accumulation, NOT an undisclosed debt
        // Removes from undisclosed_loan_indicators + adds to _financial_strengths
        // ─────────────────────────────────────────────
        const classifyEsppAsAsset = () => {
            if (!rawData.undisclosed_loan_indicators) return;
            const remaining = [];
            for (const ind of rawData.undisclosed_loan_indicators) {
                const lower = (ind || '').toLowerCase();
                const isEspp = lower.includes('espp') ||
                    (lower.includes('מניות') && (lower.includes('עובד') || lower.includes('רכישת'))) ||
                    lower.includes('stock purchase') || lower.includes('share purchase');
                if (isEspp) {
                    normalizationLog.push({ rule: 'ESPP_CLASSIFIED_AS_ASSET', original: ind, reason: 'ESPP/stock plan = equity accumulation, not a debt indicator' });
                    suppressedAlerts.push({
                        rule: 'ESPP_SUSPECTED_LOAN',
                        original_text: ind,
                        reason: 'ESPP זוהה כצבירת הון מנייתי של עובד. אינו חוב.'
                    });
                    // Add to financial strengths
                    if (!rawData._financial_strengths) rawData._financial_strengths = [];
                    const amtMatch = ind.match(/[\d,]+(\.\d+)?/);
                    const amt = amtMatch ? parseFloat(amtMatch[0].replace(/,/g, '')) : 0;
                    rawData._financial_strengths.push({
                        type: 'EQUITY_ACCUMULATION_ESPP',
                        label: 'צבירת הון מנייתי (ESPP)',
                        description: `ניכוי ESPP חודשי — צבירה שיטתית של מניות המעסיק. מהווה חיסכון הוני לטווח בינוני-ארוך.`,
                        monthly_deduction: amt,
                        is_strength: true
                    });
                } else {
                    remaining.push(ind);
                }
            }
            rawData.undisclosed_loan_indicators = remaining;
        };
        classifyEsppAsAsset();

        // ─────────────────────────────────────────────
        // LAYER 2: FOREIGN CURRENCY PAYSLIP ISOLATION
        // ✅ FIX: GBP/USD payslips excluded from Israeli avg
        // ─────────────────────────────────────────────
        ['payslips_borrower1', 'payslips_borrower2'].forEach(key => {
            if (!rawData[key]) return;
            rawData[key] = rawData[key].map(p => {
                const curr = (p.currency || '').toUpperCase();
                const emp = (p.employer || '').toLowerCase();
                const isForeign = (curr === 'GBP' || curr === 'USD' || curr === 'EUR') ||
                    ((emp.includes('international') || (emp.includes(' ltd') && !emp.includes('israel'))) && !emp.includes('ישראל'));
                if (isForeign) {
                    normalizationLog.push({ rule: 'FOREIGN_PAYSLIP_FLAGGED', employer: p.employer, month: p.month_year, currency: curr });
                    return { ...p, _foreign_currency: true, _skip_in_avg: true };
                }
                return p;
            });
        });

        // Life insurance / routine insurance whitelist
        const knownLoanMonthlyPayments = new Set((rawData.loans || []).map(l => Math.round(l.monthly_payment || 0)));
        if (rawData.undisclosed_loan_indicators) {
            rawData.undisclosed_loan_indicators = rawData.undisclosed_loan_indicators.filter(ind => {
                const indLower = ind.toLowerCase();
                const isLifeInsurance = indLower.includes('ביטוח חיים') || indLower.includes('life insurance');
                if (!isLifeInsurance) return true;
                const amtMatch = ind.match(/[\d,]+(\.\d+)?/);
                const amt = amtMatch ? parseFloat(amtMatch[0].replace(/,/g, '')) : 0;
                const matchesKnownLoan = amt > 0 && [...knownLoanMonthlyPayments].some(p => p > 0 && Math.abs(amt - p) / p < 0.30);
                const isRoutineInsurance = amt > 0 && amt < 500 && (rawData.loans || []).length > 0;
                if (matchesKnownLoan || isRoutineInsurance) {
                    normalizationLog.push({ rule: 'LIFE_INSURANCE_WHITELIST', amount: amt });
                    return false;
                }
                return true;
            });
        }

        [[rawData.payslips_borrower1, 0], [rawData.payslips_borrower2, 1]].forEach(([slips, idx]) => {
            if (!slips) return;
            slips.forEach(p => {
                const liAmt = p.life_insurance_deduction || 0;
                if (liAmt > 0 && liAmt < 1500) {
                    p._life_insurance_is_routine = true;
                }
                const notes = (p.notes || '').toLowerCase();
                if (liAmt > 0 && (notes.includes('מסד') || notes.includes('סמל 423') || notes.includes('masad'))) {
                    p._life_insurance_is_routine = true;
                }
            });
        });

        const ROUTINE_INSURANCE_COMPANIES = ['הראל', 'מגדל', 'כלל ביטוח', 'הפניקס', 'מנורה', 'הכשרה', 'איילון'];
        if (rawData.undisclosed_loan_indicators) {
            rawData.undisclosed_loan_indicators = rawData.undisclosed_loan_indicators.filter(ind => {
                const isRoutineInsurer = ROUTINE_INSURANCE_COMPANIES.some(co => ind.includes(co));
                const amtMatch = ind.match(/[\d,]+(\.\d+)?/);
                const amt = amtMatch ? parseFloat(amtMatch[0].replace(/,/g, '')) : 9999;
                if (isRoutineInsurer && amt < 2000) {
                    normalizationLog.push({ rule: 'ROUTINE_INSURER_STRIPPED', amount: amt });
                    return false;
                }
                return true;
            });
        }

        // ════════════════════════════════════════════════════════════════════
        // BORROWER DEDUPLICATION GUARD — אותו אדם לא יופיע פעמיים
        // כלל ברזל: אם לווה 2 וולווה 1 חולקים אותה ת.ז. (או שם זהה לחלוטין ואין ת.ז.) —
        // מאחדים אותם ללווה ראשי אחד. אם יש שני מעסיקים — בוחרים את בעל השכר הגבוה יותר.
        // ════════════════════════════════════════════════════════════════════
        if (rawData.borrowers && rawData.borrowers.length >= 2) {
            const b0 = rawData.borrowers[0];
            const b1 = rawData.borrowers[1];
            // נירמול ת.ז. לפורמט 9 ספרות עם padStart — מגשר על 39319207 לעומת 039319207
            const b0Id = (b0.id || '').replace(/\D/g, '').padStart(9, '0');
            const b1Id = (b1.id || '').replace(/\D/g, '').padStart(9, '0');
            const sameId = b0Id.replace(/^0+/, '').length >= 7 && b1Id.replace(/^0+/, '').length >= 7 && b0Id === b1Id;
            const sameName = !sameId && b0.name && b1.name && b0.name.trim().toLowerCase() === b1.name.trim().toLowerCase();
            // ✅ FIX v5: שם פרטי חייב להיות זהה — שם משפחה משותף בלבד (כגון "קצב") אינו מאחד בני זוג!
            const nameTokenMatch = !sameId && !sameName && b0.name && b1.name && (() => {
                const t0 = b0.name.trim().toLowerCase().split(/\s+/).filter(w => w.length > 1);
                const t1 = b1.name.trim().toLowerCase().split(/\s+/).filter(w => w.length > 1);
                if (t0.length < 2 || t1.length < 2) return false;
                if (t0[0] !== t1[0]) return false; // שמות פרטיים שונים = אנשים שונים (בני זוג!)
                return t0.filter(w => t1.includes(w)).length >= 2;
            })();
            if (sameId || sameName || nameTokenMatch) {
                // מאחדים: לוקחים את כל התלושים לסלוט 1, מנקים את סלוט 2
                // ממוצע שכר — לוקחים את ההכנסה הגבוהה יותר
                const avg = (slips) => {
                    const active = (slips || []).filter(p => (p.net_salary || 0) > 0 && !p._skip_in_avg);
                    if (!active.length) return 0;
                    return active.reduce((s, p) => s + p.net_salary, 0) / active.length;
                };
                const avg0 = avg(rawData.payslips_borrower1);
                const avg1 = avg(rawData.payslips_borrower2);
                // מזג את כל התלושים לסלוט אחד (הסלוט עם הממוצע הגבוה יותר נשאר ראשון)
                if (avg1 > avg0) {
                    rawData.payslips_borrower1 = [...(rawData.payslips_borrower2 || []), ...(rawData.payslips_borrower1 || [])];
                } else {
                    rawData.payslips_borrower1 = [...(rawData.payslips_borrower1 || []), ...(rawData.payslips_borrower2 || [])];
                }
                rawData.payslips_borrower2 = [];
                // עדכן את הלווה הראשי עם הנתונים הטובים ביותר מבין שני הרשומות
                const mergedBorrower = { ...b0 };
                if (!mergedBorrower.employer && b1.employer) mergedBorrower.employer = b1.employer;
                if (!mergedBorrower.seniority_years && b1.seniority_years) mergedBorrower.seniority_years = b1.seniority_years;
                // ת.ז. — קח את הארוכה/שלמה יותר (9 ספרות מנורמלות)
                if (!mergedBorrower.id && b1.id) mergedBorrower.id = b1.id;
                else if (b1.id && (b1.id.replace(/\D/g, '').length > (mergedBorrower.id || '').replace(/\D/g, '').length)) mergedBorrower.id = b1.id;
                rawData.borrowers = [mergedBorrower];
                normalizationLog.push({
                    rule: 'BORROWER_DEDUP_SAME_IDENTITY',
                    reason: sameId ? `ת.ז. זהה: ${b0Id}` : sameName ? `שם זהה: ${b0.name}` : `שם חלקי זהה: ${b0.name} ↔ ${b1.name}`,
                    merged_payslips: (rawData.payslips_borrower1 || []).length,
                    avg0: Math.round(avg0), avg1: Math.round(avg1)
                });
            }
        }

        // Ghost borrower 2 / divorced cleanup
        if (rawData.borrowers && rawData.borrowers.length >= 2) {
            const b0 = rawData.borrowers[0];
            const b1 = rawData.borrowers[1];
            const b0Divorced = (b0.marital_status || '').includes('גרוש');
            const b1HasNoPayslips = (rawData.payslips_borrower2 || []).length === 0;
            const b1NoIdFound = b1.id_document_found === false;
            const hasDivorceDocs = (rawData.special_circumstances || []).some(sc => {
                const scL = sc.toLowerCase();
                return scL.includes('גירושין') || scL.includes('הסכם גירושין') || scL.includes('מזונות') || scL.includes('divorce');
            });
            const hasDivorceInRecs = (rawData.actionable_recommendations || []).some(r =>
                (r.text || '').includes('גירושין') || (r.text || '').includes('מזונות')
            );
            if (b0Divorced && b1HasNoPayslips && b1NoIdFound && (hasDivorceDocs || hasDivorceInRecs)) {
                normalizationLog.push({ rule: 'EX_SPOUSE_PHANTOM_REMOVED', b0_name: b0.name, b1_name: b1.name });
                rawData.borrowers = [b0];
                rawData.payslips_borrower2 = [];
            } else if (b0Divorced && b1HasNoPayslips && b1NoIdFound && !b1.name) {
                rawData.borrowers = [b0];
                rawData.payslips_borrower2 = [];
            }
        }

        // Contradictions in actionable_recommendations
        if (rawData.actionable_recommendations && rawData.actionable_recommendations.length > 0) {
            const b1IdFound = (rawData.borrowers || [])[0]?.id_document_found === true;
            const b2IdFound = (rawData.borrowers || [])[1]?.id_document_found === true;
            const b1HasPayslips = (rawData.payslips_borrower1 || []).length >= 3;
            const b2HasPayslips = (rawData.payslips_borrower2 || []).length >= 3;
            const hasBankStatements = (rawData.cash_flow_summary || []).length > 0;
            const b1Name = ((rawData.borrowers || [])[0]?.name || '').split(' ')[0];
            const b2Name = ((rawData.borrowers || [])[1]?.name || '').split(' ')[0];
            rawData.actionable_recommendations = rawData.actionable_recommendations.filter(rec => {
                const text = rec.text || '';
                const textL = text.toLowerCase();
                const isIdRequest = textL.includes('תעודת זהות') || textL.includes('ספח') || textL.includes('ת.ז');
                if (isIdRequest) {
                    const isForB1 = !b2Name || textL.includes(b1Name.toLowerCase()) || !textL.includes(b2Name.toLowerCase());
                    const isForB2 = b2Name && textL.includes(b2Name.toLowerCase());
                    if (isForB1 && b1IdFound) { normalizationLog.push({ rule: 'REC_CONTRADICTS_ID_VERIFIED_B1' }); return false; }
                    if (isForB2 && b2IdFound) { normalizationLog.push({ rule: 'REC_CONTRADICTS_ID_VERIFIED_B2' }); return false; }
                }
                const isPayslipRequest = textL.includes('תלוש') || textL.includes('תלושי שכר');
                if (isPayslipRequest) {
                    const isForB1 = !b2Name || textL.includes(b1Name.toLowerCase()) || !textL.includes(b2Name.toLowerCase());
                    const isForB2 = b2Name && textL.includes(b2Name.toLowerCase());
                    if (isForB1 && b1HasPayslips) { normalizationLog.push({ rule: 'REC_CONTRADICTS_PAYSLIPS_EXIST_B1' }); return false; }
                    if (isForB2 && b2HasPayslips) { normalizationLog.push({ rule: 'REC_CONTRADICTS_PAYSLIPS_EXIST_B2' }); return false; }
                    if (!isForB2 && b1HasPayslips && (rawData.borrowers || []).length === 1) { normalizationLog.push({ rule: 'REC_CONTRADICTS_PAYSLIPS_EXIST_GENERIC' }); return false; }
                }
                const isBankRequest = (textL.includes('דפי עו"ש') || textL.includes('דפי בנק') || textL.includes('עובר ושב')) && !textL.includes('עדכני');
                if (isBankRequest && hasBankStatements) { normalizationLog.push({ rule: 'REC_CONTRADICTS_BANK_STMTS_EXIST' }); return false; }
                return true;
            });
        }

        // ─────────────────────────────────────────────
        // LTV FLAG
        // ─────────────────────────────────────────────
        if (rawData.property_value && rawData.requested_loan_amount && !rawData._ltv_high_risk_flag) {
            const computedLTV = (rawData.requested_loan_amount / rawData.property_value) * 100;
            if (computedLTV >= 70) {
                rawData._ltv_high_risk_flag = true;
                rawData._ltv_high_risk_message = computedLTV >= 75
                    ? `⚠️ חריג רגולטורי: LTV ${computedLTV.toFixed(1)}% — מעל תקרת 75%`
                    : `⚠️ סיכון שמאי גבוה: LTV ${computedLTV.toFixed(1)}% — מרווח ביטחון נמוך`;
            }
        }

        const hasBorrower2Real = !!(rawData.borrowers?.[1]?.name);
        if (!hasBorrower2Real && rawData.undisclosed_loan_indicators) {
            rawData.undisclosed_loan_indicators = rawData.undisclosed_loan_indicators.map(ind =>
                (ind || '').replace(/לווה 2/g, rawData.borrowers?.[0]?.name || 'לווה 1')
            );
        }

        // ─────────────────────────────────────────────
        // RULE 1: SENIORITY CALCULATION
        // ─────────────────────────────────────────────
        const calcSeniorityFromDate = (dateStr) => {
            if (!dateStr) return null;
            const match = dateStr.match(/(\d{2})[.\/](\d{2})[.\/](\d{4})/);
            if (!match) return null;
            const start = new Date(+match[3], +match[2] - 1, +match[1]);
            if (isNaN(start.getTime()) || start > today) return null;
            return (today - start) / (1000 * 60 * 60 * 24 * 365.25);
        };

        const calcAgeFromDate = (dateStr) => {
            if (!dateStr) return null;
            let d;
            if (/^\d{2}\.\d{2}\.\d{4}$/.test(dateStr)) {
                const [day, month, year] = dateStr.split('.');
                d = new Date(+year, +month - 1, +day);
            } else if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                d = new Date(dateStr);
            } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
                const [day, month, year] = dateStr.split('/');
                d = new Date(+year, +month - 1, +day);
            } else return null;
            if (isNaN(d.getTime())) return null;
            let age = today.getFullYear() - d.getFullYear();
            const m = today.getMonth() - d.getMonth();
            if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
            return age;
        };

        const normalizedBorrowers = (rawData.borrowers || []).map((b, idx) => {
            const label = idx === 0 ? 'לווה 1' : 'לווה 2';
            let updated = { ...b };
            if (b.birth_date) {
                const calcAge = calcAgeFromDate(b.birth_date);
                if (calcAge !== null && Math.abs((b.age || 0) - calcAge) > 1) {
                    normalizationLog.push({ rule: 'AGE_CORRECTION', borrower: label, original: b.age, corrected: calcAge });
                    updated.age = calcAge;
                } else if (calcAge !== null) {
                    updated.age = calcAge;
                }
            }
            if (!b.birth_date && updated.age !== undefined && updated.age !== null) {
                if (updated.age < 18 || updated.age > 100) {
                    normalizationLog.push({ rule: 'AGE_INVALID_CLEARED', borrower: label, bad_age: updated.age });
                    updated.age = null;
                }
            }
            if (b.special_status_note) {
                const noteLower = (b.special_status_note || '').toLowerCase();
                const isSabbaticalNote = noteLower.includes('שבתון') || noteLower.includes('sabbatical');
                if (!isSabbaticalNote) {
                    const calcSen = calcSeniorityFromDate(b.special_status_note);
                    if (calcSen !== null) {
                        if (b.seniority_years && Math.abs(b.seniority_years - calcSen) > 0.3) {
                            normalizationLog.push({ rule: 'SENIORITY_CORRECTION', borrower: label, original: b.seniority_years, corrected: parseFloat(calcSen.toFixed(2)) });
                        }
                        updated.seniority_years = parseFloat(calcSen.toFixed(2));
                    }
                } else {
                    normalizationLog.push({ rule: 'SENIORITY_SABBATICAL_NOTE_SKIPPED', borrower: label });
                }
            }
            const isSabbaticalBorrower = (b.employment_type || '').toLowerCase().includes('שבתון');
            if (isSabbaticalBorrower) {
                const totalSeniority = b.total_seniority_years || b.seniority_total_years || b.seniority_teaching_years || 0;
                if (totalSeniority > (updated.seniority_years || 0) + 1) {
                    normalizationLog.push({ rule: 'SABBATICAL_SENIORITY_OVERRIDE', borrower: label, total_seniority: totalSeniority });
                    updated.seniority_years = totalSeniority;
                }
            }
            if (b.employer && (b.employer.includes('חינוך') || b.employer.includes('הוראה'))) {
                const teachingSeniority = b.seniority_teaching_years || null;
                if (teachingSeniority && teachingSeniority > (updated.seniority_years || 0)) {
                    normalizationLog.push({ rule: 'SENIORITY_TEACHING_MAX', borrower: label, original: updated.seniority_years, corrected: teachingSeniority });
                    updated.seniority_years = teachingSeniority;
                }
            }
            return updated;
        });

        // ─────────────────────────────────────────────
        // RULE 1B: MORTGAGE BALANCE + TRACK CLASSIFICATION
        // ─────────────────────────────────────────────
        const PRIME_KEYWORDS = ['p-', 'p+', 'פריים', 'prime'];
        const BOND_KEYWORDS = ['v+', 'v-', 'אג"ח', 'ממשלתי'];
        const CPI_KEYWORDS = ['h+', 'מדד', 'צמוד'];

        if (rawData.existing_mortgage) {
            const mortgage = rawData.existing_mortgage;
            const tracks = mortgage.tracks || [];
            tracks.forEach(track => {
                const rateBasis = (track.rate_basis || '').toLowerCase();
                const trackType = (track.track_type || '').toLowerCase();
                const isPrime = PRIME_KEYWORDS.some(k => rateBasis.includes(k));
                const isBond = BOND_KEYWORDS.some(k => rateBasis.includes(k));
                const isCPILinked = CPI_KEYWORDS.some(k => rateBasis.includes(k));
                if (isPrime) {
                    if (track.track_type !== 'פריים') { track.track_type = 'פריים'; track.is_index_linked = false; }
                } else if (isBond) {
                    const isVPlusBond = rateBasis.startsWith('v+');
                    const corrected = (isCPILinked || isVPlusBond) ? 'משתנה צמודה' : 'משתנה לא צמודה';
                    if (track.track_type !== corrected) { track.track_type = corrected; track.is_index_linked = isCPILinked || isVPlusBond; }
                } else if (isCPILinked && (trackType.includes('קבוע') || trackType.includes('fixed'))) {
                    if (track.track_type !== 'קבועה צמודה') { track.track_type = 'קבועה צמודה'; track.is_index_linked = true; }
                }
            });
            const totalTrackBalance = tracks.reduce((s, t) => s + (t.remaining_balance || 0), 0);
            if (totalTrackBalance > 0 && tracks.length > 1) {
                const weightedRate = tracks.reduce((s, t) => s + ((t.interest_rate || 0) * (t.remaining_balance || 0)), 0) / totalTrackBalance;
                const roundedRate = parseFloat(weightedRate.toFixed(2));
                const aiRate = mortgage.average_interest_rate || 0;
                if (Math.abs(roundedRate - aiRate) > 0.3) {
                    rawData.existing_mortgage.average_interest_rate = roundedRate;
                }
            }
            const statedTotal = mortgage.total_stated_balance || 0;
            const sumOfTracks = totalTrackBalance;
            if (statedTotal > 0 && sumOfTracks > 0) {
                const gapPct = Math.abs(statedTotal - sumOfTracks) / statedTotal;
                if (gapPct > 0.03) {
                    rawData.existing_mortgage.remaining_balance = statedTotal;
                    rawData.existing_mortgage._balance_gap_warning = `⚠️ פער ₪${Math.round(statedTotal - sumOfTracks).toLocaleString()} בין סכום המסלולים לסה"כ המסמך.`;
                }
            }
        }

        // ─────────────────────────────────────────────
        // RULE 1C: LIABILITY CRAWLER
        // ─────────────────────────────────────────────
        const FINANCIAL_INSTITUTION_KEYWORDS = [
            'דיסקונט', 'discount', 'וואן זירו', 'one zero', 'onezero', 'מב. הדיגיטלי', 'הדיגיטלי', 'digital bank', 'מזרחי', 'mizrahi',
            'הפועלים', 'hapoalim', 'לאומי', 'leumi', 'ירושלים', 'jerusalem', 'בינלאומי', 'international',
            'מקס', 'max', 'כאל', 'cal', 'ישראכרט', 'isracard', 'אמריקן אקספרס', 'amex',
            'רייפייזן', 'בי.אי.אי', 'bll', 'aio',
            'הראל', 'harel', 'מנורה', 'menora', 'מגדל', 'migdal', 'הפניקס', 'phoenix',
            'פמילי', 'family', 'אוצר החיל', 'בנק יהב', 'יהב', 'בנק אגוד', 'אגוד',
            'בנק פועלי', 'מרכנתיל', 'mercantile'
        ];
        const EXCLUDED_FROM_LIABILITY = ['ארנונה', 'חשמל', 'מים', 'גז', 'ועד בית', 'סלולר', 'אינטרנט', 'hot', 'partner', 'yes ', 'cellcom', 'פנסיה', 'גמל', 'קרן השתלמות', 'קה"ל', 'שכר דירה', 'שכ"ד'];
        const knownLoanPaymentsSet = new Set((rawData.loans || []).map(l => Math.round(l.monthly_payment || 0)));
        const knownLoanDescKeys = new Set((rawData.loans || []).flatMap(l => {
            const desc = (l.description || '').toLowerCase();
            return FINANCIAL_INSTITUTION_KEYWORDS.filter(kw => desc.includes(kw.toLowerCase()));
        }));

        (rawData.loans || []).forEach(loan => {
            const desc = (loan.description || '').toLowerCase();
            const isExcluded = EXCLUDED_FROM_LIABILITY.some(kw => desc.includes(kw.toLowerCase()));
            if (isExcluded) return;
            const isUnlabeled = (loan.monthly_payment || 0) > 1500 && loan.needs_clarification;
            if (isUnlabeled) {
                const indicator = `תנועת חובה קבועה של ₪${Math.round(loan.monthly_payment).toLocaleString()}/חודש — "${loan.description || 'לא ידוע'}" — טרם אומתה כהלוואה`;
                if (!(rawData.undisclosed_loan_indicators || []).some(i => i.includes(loan.description || 'XXX'))) {
                    rawData.undisclosed_loan_indicators = [...(rawData.undisclosed_loan_indicators || []), indicator];
                }
            }
        });

        const isDebitIndicator = (ind) => {
            const lower = ind.toLowerCase();
            if (lower.includes('חיוב') || lower.includes('יוצא') || lower.includes('debit') || lower.includes('outgoing')) return true;
            if (lower.includes('זיכוי') || lower.includes('נכנס') || lower.includes('credit') || lower.includes('incoming') || lower.includes('הכנסה משכירות') || lower.includes('שכירות')) return false;
            return true;
        };

        const hasBusinessDataForCrawler = !!(rawData.business_data?.average_monthly_income || rawData.business_data?.annual_income_year1);
        const avgBusinessMonthly = hasBusinessDataForCrawler ? (
            rawData.business_data?.average_monthly_income ||
            ((rawData.business_data?.annual_income_year1 || 0) + (rawData.business_data?.annual_income_year2 || 0)) / 2 / 12 || 0
        ) : 0;

        if (rawData.undisclosed_loan_indicators && hasBusinessDataForCrawler && avgBusinessMonthly > 0) {
            rawData.undisclosed_loan_indicators = rawData.undisclosed_loan_indicators.filter(ind => {
                const indLower = ind.toLowerCase();
                const isDigitalTransfer = indLower.includes('דיגיטל') || indLower.includes('digital') || indLower.includes('העברה');
                if (!isDigitalTransfer) return true;
                const amtMatch = ind.match(/[\d,]+/g);
                const amounts = amtMatch ? amtMatch.map(a => parseInt(a.replace(/,/g, ''))).filter(a => a > 1000 && a < 200000) : [];
                if (amounts.length === 0) return true;
                const transferAmt = Math.min(...amounts);
                const ratio = transferAmt / avgBusinessMonthly;
                if (ratio >= 0.4 && ratio <= 2.0) {
                    normalizationLog.push({ rule: 'OWNER_WITHDRAWAL_CLASSIFIED', amount: transferAmt });
                    return false;
                }
                return true;
            });
        }

        const liabilityCrawlerResults = [];
        // ✅ FIX v3: Capital movements (פיקדון / חיסכון / השקעה) are NOT loans
        const CAPITAL_MOVEMENT_KEYWORDS = [
            'פיקדון', 'חיסכון', 'קרן חיסכון', 'פתיחת פיקדון', 'הפקדת פיקדון',
            'deposit', 'savings', 'investment', 'השקעה', 'קרן גמל', 'תיק מניות',
            'ני"ע', 'ניירות ערך', 'קנייה', 'stock purchase'
        ];
        const isCapitalMovement = (ind) => {
            const lower = ind.toLowerCase();
            return CAPITAL_MOVEMENT_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()));
        };

        const indicatorsToConvert = (rawData.undisclosed_loan_indicators || []).filter(ind => {
            const indLower = ind.toLowerCase();
            // Exclude capital movements — these are assets, not loans
            if (isCapitalMovement(ind)) {
                normalizationLog.push({ rule: 'CAPITAL_MOVEMENT_NOT_A_LOAN', indicator: ind.substring(0, 80) });
                return false;
            }
            const isFinancialInstitution = FINANCIAL_INSTITUTION_KEYWORDS.some(kw => indLower.includes(kw.toLowerCase()));
            if (!isFinancialInstitution) return false;
            if (!isDebitIndicator(ind)) return false;
            const amtMatch = ind.match(/[\d,]+/g);
            if (!amtMatch) return false;
            const amounts = amtMatch.map(a => parseInt(a.replace(/,/g, ''))).filter(a => a > 300 && a < 100000);
            return amounts.length > 0;
        });

        indicatorsToConvert.forEach(ind => {
            const indLower = ind.toLowerCase();
            const institutionName = FINANCIAL_INSTITUTION_KEYWORDS.find(kw => indLower.includes(kw.toLowerCase())) || 'גוף פיננסי';
            const amtMatch = ind.match(/[\d,]+/g);
            const amounts = amtMatch ? amtMatch.map(a => parseInt(a.replace(/,/g, ''))).filter(a => a > 300 && a < 100000) : [];
            if (amounts.length === 0) return;
            const estimatedMonthly = Math.min(...amounts);
            const alreadyInLoans = (rawData.loans || []).some(l => {
                const lDesc = (l.description || '').toLowerCase();
                return lDesc.includes(institutionName.toLowerCase()) || Math.abs((l.monthly_payment || 0) - estimatedMonthly) < 200;
            });
            if (alreadyInLoans) return;
            const syntheticLoan = {
                description: `הלוואה — ${institutionName} (חיוב חובה קבוע בעו"ש, טרם אומת)`,
                monthly_payment: estimatedMonthly,
                remaining_balance: estimatedMonthly * 24,
                remaining_months: 24,
                is_confirmed_loan: false,
                needs_clarification: true,
                _from_liability_crawler: true
            };
            rawData.loans = [...(rawData.loans || []), syntheticLoan];
            liabilityCrawlerResults.push({ institution: institutionName, monthly: estimatedMonthly });
            normalizationLog.push({ rule: 'LIABILITY_CRAWLER_ADDED_TO_LOANS', institution: institutionName, monthly_payment: estimatedMonthly });
        });

        if (rawData.actionable_recommendations) {
            rawData.actionable_recommendations = rawData.actionable_recommendations.filter(rec => {
                const text = (rec.text || '').toLowerCase();
                const isMisclassifiedAsRental = (text.includes('שכירות') || text.includes('rental')) &&
                    FINANCIAL_INSTITUTION_KEYWORDS.some(kw => text.includes(kw.toLowerCase()));
                if (isMisclassifiedAsRental) { normalizationLog.push({ rule: 'MISCLASSIFIED_RENTAL_REMOVED' }); return false; }
                return true;
            });
        }

        // ─────────────────────────────────────────────
        // RULE 2: CASE TYPE ISOLATION
        // ─────────────────────────────────────────────
        const hasRealMortgage = !!(rawData.existing_mortgage?.remaining_balance > 0);
        let detectedTypes = [...(rawData.detected_case_types || [])];
        if (!hasRealMortgage) {
            detectedTypes = detectedTypes.filter(t => !t.includes('מיחזור') && !t.includes('מחזור'));
            if (!detectedTypes.includes('רכישת נכס חדש') && !detectedTypes.includes('משכנתא לכל מטרה') && !detectedTypes.includes('בעלי עסקים וחברות') && !detectedTypes.includes('גיל הזהב')) {
                detectedTypes.push('רכישת נכס חדש');
            }
        }

        // ─────────────────────────────────────────────
        // RULE 3: LOAN vs CREDIT CARD DEDUPLICATION
        // ─────────────────────────────────────────────
        const LOAN_KEYWORDS = ['הלוואה', 'מימון', 'ליסינג', 'credit', 'loan', 'מקס איט', 'max it', 'כאל', 'ישראכרט', 'שלג לבן', 'מב. הדיגיטלי', 'אוצר החיל', 'דיסקונט'];
        const NOISE_KEYWORDS = ['סופר', 'מרקט', 'חשמל', 'ארנונה', 'דלק', 'מסעדה', 'קפה', 'פארם', 'שטראוס', 'סלולר', 'yes ', 'hot ', 'partner'];
        const normalizedLoans = (rawData.loans || []).map(loan => {
            const desc = (loan.description || '').toLowerCase();
            const isNoise = NOISE_KEYWORDS.some(kw => desc.includes(kw.toLowerCase()));
            if (isNoise) { normalizationLog.push({ rule: 'LOAN_NOISE_REMOVED', description: loan.description }); return null; }
            return loan;
        }).filter(Boolean);

        const loanDescs = new Set(normalizedLoans.map(l => (l.description || '').toLowerCase().substring(0, 12)));
        const LOAN_CARD_OVERLAP_KEYS = ['מקס איט', 'max it', 'כאל', 'ישראכרט', 'ויזה כאל', 'אמריקן אקספרס'];
        const normalizedCreditCards = (rawData.credit_cards || []).filter(card => {
            const cardDesc = (card.description || '').toLowerCase();
            const cardShort = cardDesc.substring(0, 12);
            if (loanDescs.has(cardShort)) { normalizationLog.push({ rule: 'CREDIT_CARD_DEDUP', description: card.description }); return false; }
            const semanticMatch = LOAN_CARD_OVERLAP_KEYS.find(kw =>
                cardDesc.includes(kw.toLowerCase()) && normalizedLoans.some(l => (l.description || '').toLowerCase().includes(kw.toLowerCase()))
            );
            if (semanticMatch) { normalizationLog.push({ rule: 'CREDIT_CARD_DEDUP_SEMANTIC', description: card.description }); return false; }
            return true;
        });

        // ─────────────────────────────────────────────
        // RULE 4: OVERDRAFT SEVERITY REDUCTION
        // ─────────────────────────────────────────────
        const liquidEquity = (rawData.equity_events || [])
            .filter(e => e.is_incoming !== false && e.type !== 'הפקדה_לפקדון')
            .reduce((s, e) => s + (e.amount || 0), 0) || rawData.total_equity_evidence || 0;

        const hasOverdraft = (rawData.bank_red_flags || []).some(f =>
            f.toLowerCase().includes('מינוס') || f.toLowerCase().includes('negative') || f.toLowerCase().includes('overdraft')
        );

        const kerenFundsTotal = (rawData.keren_hishtalmut || []).reduce((s, k) => s + (k.accumulated_balance || 0), 0);
        const pensionFundsTotal = (rawData.pension_funds || []).filter(p => p.is_accessible).reduce((s, p) => s + (p.accumulated_balance || 0), 0);
        const totalLiquidEquityWithFunds = liquidEquity + kerenFundsTotal + pensionFundsTotal;

        let overdraftWithEquity = false;
        if (hasOverdraft && (liquidEquity > 50000 || totalLiquidEquityWithFunds > 100000)) {
            overdraftWithEquity = true;
            normalizationLog.push({ rule: 'OVERDRAFT_DOWNGRADE', reason: `Total liquid ₪${totalLiquidEquityWithFunds.toLocaleString()} > 100K` });
        }

        // ── ESPP pre-filter: remove ESPP deductions before Masad/Mortgage dedup ──
        // This ensures ESPP never shows up as a suspicious deduction
        if (rawData.payslip_deductions) {
            rawData.payslip_deductions = rawData.payslip_deductions.filter(d => {
                const desc = (d.description || '').toLowerCase();
                const isEspp = desc.includes('espp') || desc.includes('מניות עובד') ||
                    desc.includes('stock purchase') || desc.includes('share purchase') ||
                    (desc.includes('מניות') && desc.includes('רכישת'));
                if (isEspp) {
                    normalizationLog.push({ rule: 'ESPP_PAYSLIP_DEDUCTION_EARLY_FILTER', description: d.description });
                    if (!rawData._financial_strengths) rawData._financial_strengths = [];
                    const alreadyEspp = rawData._financial_strengths.some(s => s.type === 'EQUITY_ACCUMULATION_ESPP' && Math.abs((s.monthly_deduction || 0) - (d.monthly_amount || 0)) < 50);
                    if (!alreadyEspp) {
                        rawData._financial_strengths.push({
                            type: 'EQUITY_ACCUMULATION_ESPP',
                            label: 'צבירת הון מנייתי (ESPP)',
                            description: `ניכוי ESPP חודשי ₪${Math.round(d.monthly_amount || 0).toLocaleString()} — צבירה שיטתית של מניות המעסיק. גורם מפצה: חיסכון הוני לטווח בינוני.`,
                            monthly_deduction: d.monthly_amount || 0,
                            is_strength: true
                        });
                    }
                    return false;
                }
                return true;
            });
        }

        // MASAD / Mortgage deduction dedup
        const mortgagePayment = rawData.existing_mortgage?.monthly_payment || 0;
        const mortgageBankName = (rawData.existing_mortgage?.bank_name || '').toLowerCase();
        const numBorrowers = (rawData.borrowers || []).length || 1;
        const perBorrowerMortgage = mortgagePayment / numBorrowers;

        const cleanedPayslipDeductions = (rawData.payslip_deductions || []).filter(d => {
            const desc = (d.description || '').toLowerCase();
            const amt = d.monthly_amount || 0;
            const isMasad = desc.includes('מסד') || desc.includes('mortgage') || desc.includes('משכנתא');
            const isMortgageBank = mortgageBankName && desc.includes(mortgageBankName.substring(0, 5));
            const isCloseToMortgagePayment = perBorrowerMortgage > 0 && Math.abs(amt - perBorrowerMortgage) < perBorrowerMortgage * 0.25;
            const isCloseToFullMortgage = mortgagePayment > 0 && Math.abs(amt - mortgagePayment) < mortgagePayment * 0.15;
            if ((isMasad || isMortgageBank) && (isCloseToMortgagePayment || isCloseToFullMortgage)) {
                normalizationLog.push({ rule: 'MASAD_DEDUCTION_IS_MORTGAGE', amount: amt });
                return false;
            }
            return true;
        });

        const cleanedUndisclosedIndicatorsStep2 = (rawData.undisclosed_loan_indicators || []).filter(ind => {
            const indLower = ind.toLowerCase();
            const isMasad = indLower.includes('מסד') || indLower.includes('mortgage');
            const isMortgageBank = mortgageBankName && indLower.includes(mortgageBankName.substring(0, 5));
            if (isMasad || isMortgageBank) {
                normalizationLog.push({ rule: 'MASAD_UNDISCLOSED_REMOVED', indicator: ind });
                return false;
            }
            return true;
        });

        // ─────────────────────────────────────────────
        // RULE 4C: GROSS/NET RATIO SUPPRESSION + GOVERNMENT/MILITARY SUPPRESSION
        // ✅ FIX v3: calibrated thresholds + per-sector suppression
        // ─────────────────────────────────────────────
        // ─────────────────────────────────────────────
        // GOVERNMENT / MILITARY EMPLOYER DETECTION
        // ✅ FIX v3: Suppress gross/net alert for public sector (rigid statutory deductions)
        // ─────────────────────────────────────────────
        const GOVERNMENT_EMPLOYER_KEYWORDS = [
            'משרד', 'רשות', 'עירייה', 'מועצה', 'ממשלת', 'ממשלה', 'מדינה',
            'ראש הממשלה', 'רה"מ', 'כנסת', 'משטרה', 'צבא', 'צה"ל', 'חיל',
            'קבע', 'officer', 'military', 'idf', 'police', 'army',
            'בית חולים', 'הדסה', 'שיבא', 'ביקור חולים', 'תל השומר',
            'אוניברסיטה', 'university', 'מכון', 'institute',
            'רשות החברות', 'חברת חשמל', 'נתיבי ישראל', 'תשתיות',
            'בטל"מ', 'מטח', 'malam', 'mamram', 'ממר"מ',
        ];

        const isGovernmentOrMilitaryEmployer = (employerStr) => {
            if (!employerStr) return false;
            const lower = employerStr.toLowerCase();
            return GOVERNMENT_EMPLOYER_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()));
        };

        // Per-payslip government check — based on the payslip's own employer field
        // Also checks borrower employer by ID match OR by slot (after swap)
        const isGovernmentPayslip = (p, slotIndex) => {
            // 1. Payslip employer field directly
            if (isGovernmentOrMilitaryEmployer(p.employer || '')) return true;
            // 2. Borrower linked by ID
            const linkedByIdGovt = (rawData.borrowers || []).some(b =>
                (p.employee_id || p.id_number || '') &&
                (b.id || '').replace(/\D/g, '') === (p.employee_id || '').replace(/\D/g, '') &&
                isGovernmentOrMilitaryEmployer(b.employer || '')
            );
            if (linkedByIdGovt) return true;
            // 3. Fallback: borrower in same slot is government employer (after employer-based swap)
            if (slotIndex !== undefined && slotIndex >= 0) {
                const slotBorrower = (rawData.borrowers || [])[slotIndex];
                if (slotBorrower && isGovernmentOrMilitaryEmployer(slotBorrower.employer || '')) return true;
            }
            return false;
        };

        const isEducationEmployer = (rawData.borrowers || []).some(b =>
            b.employer && (b.employer.includes('חינוך') || b.employer.includes('הוראה') || b.employer.includes('Education'))
        );
        const knownLoanDeductionsTotal = (rawData.loans || []).reduce((s, l) => s + (l.monthly_payment || 0), 0)
            + (rawData.payslip_deductions || []).reduce((s, d) => s + (d.monthly_amount || 0), 0);

        const getGrossNetThreshold = (gross, isEducation, isGovt) => {
            if (isGovt) return 0.42;    // Government/Military: extreme statutory deductions (pension + מסד + income tax)
            if (isEducation) return 0.55; // Education: heavy Masad + pension
            if (gross > 60000) return 0.47; // Top bracket — very high taxes
            if (gross > 45000) return 0.50; // High earner
            if (gross > 35000) return 0.52; // Upper-mid earner
            if (gross > 20000) return 0.63; // Standard
            return 0.72; // Lower earner — lower taxes
        };

        const suppressGrossNetAlerts = (payslips, slotIndex) => {
            if (!payslips) return payslips;
            return payslips.map(p => {
                const gross = p.gross_salary || 0;
                const net = p.net_salary || 0;
                if (gross < 5000 || net <= 0) return p;
                const ratio = net / gross;
                const isGovtPayslip = isGovernmentPayslip(p, slotIndex);
                const threshold = getGrossNetThreshold(gross, isEducationEmployer, isGovtPayslip);
                const isHighEarner = gross > 35000;

                if (ratio < threshold && ratio >= 0.38) {
                    // Compute expected deductions based on gross
                    const taxDeduction = p.tax_deduction || 0;
                    const socialSecurity = p.social_security || 0;
                    const pensionDeduction = p.pension || 0;

                    // For government/military: statutory deductions ALWAYS explain the gap
                    if (isGovtPayslip) {
                        const reason = `עובד מדינה/צבא (${p.employer || 'גוף ממשלתי'}) — ניכויי חובה קשיחים: פנסיה, קרן השתלמות, מס הכנסה (${Math.round(ratio * 100)}% נטו/ברוטו תקין למגזר זה)`;
                        normalizationLog.push({ rule: 'GROSS_NET_GAP_SUPPRESSED_GOVT', month: p.month_year, ratio: Math.round(ratio * 100), gross, employer: p.employer });
                        suppressedAlerts.push({ rule: 'GROSS_NET_RATIO_CRITICAL', original_text: `יחס ברוטו/נטו ${Math.round(ratio * 100)}%`, reason });
                        return { ...p, _gross_net_explained: true, _gross_net_note: reason, _govt_employer: true };
                    }

                    // For high earners: statutory deductions alone can explain the gap
                    const expectedStatutoryDeductionPct = isHighEarner ? 0.43 : 0.28;
                    const expectedDeductions = gross * expectedStatutoryDeductionPct + knownLoanDeductionsTotal;
                    const actualDeductions = gross - net;

                    if (actualDeductions <= expectedDeductions * 1.25) {
                        const reason = isHighEarner
                            ? `שכר גבוה (₪${Math.round(gross).toLocaleString()}) — ניכויי מס גבוהים בהתאם למדרגות המס בישראל (${Math.round(ratio * 100)}% נטו/ברוטו תקין לשכר זה)`
                            : `פער נטו/ברוטו מוסבר ע"י ניכויי הלוואות ידועות (₪${Math.round(knownLoanDeductionsTotal).toLocaleString()}/חודש)${isEducationEmployer ? ' — עובד הוראה' : ''}`;
                        normalizationLog.push({ rule: 'GROSS_NET_GAP_SUPPRESSED', month: p.month_year, ratio: Math.round(ratio * 100), gross, is_high_earner: isHighEarner });
                        suppressedAlerts.push({ rule: 'GROSS_NET_RATIO_CRITICAL', original_text: `יחס ברוטו/נטו ${Math.round(ratio * 100)}%`, reason });
                        return { ...p, _gross_net_explained: true, _gross_net_note: reason };
                    }
                }
                return p;
            });
        };

        // ─────────────────────────────────────────────
        // RULE 4D: PRO-RATED FIRST MONTH EXCLUSION
        // ✅ FIX v3: First payslip that is >20% below the rest → exclude from avg
        // ─────────────────────────────────────────────
        const excludeProRatedFirstMonth = (payslips) => {
            if (!payslips || payslips.length < 3) return payslips;
            // Sort by month_year ascending to find the earliest
            const sorted = [...payslips].sort((a, b) => {
                const toDate = (s) => { const p = (s || '').split('/'); return p.length === 2 ? new Date(+p[1], +p[0] - 1) : new Date(0); };
                return toDate(a.month_year) - toDate(b.month_year);
            });
            const first = sorted[0];
            if (!first || (first.net_salary || 0) <= 0) return payslips;
            const restNets = sorted.slice(1).map(p => p.net_salary || 0).filter(v => v > 0);
            if (restNets.length < 2) return payslips;
            const restAvg = restNets.reduce((s, v) => s + v, 0) / restNets.length;
            if ((first.net_salary || 0) < restAvg * 0.80) {
                normalizationLog.push({ rule: 'PRO_RATED_FIRST_MONTH_EXCLUDED', month: first.month_year, net: first.net_salary, rest_avg: Math.round(restAvg) });
                return payslips.map(p =>
                    p.month_year === first.month_year
                        ? { ...p, _skip_in_avg: true, _anomaly_note: 'חודש ראשון חלקי (Pro-rated) — הוחרג מחישוב ממוצע הכנסה' }
                        : p
                );
            }
            return payslips;
        };

        // ─────────────────────────────────────────────
        // RULE 5: UNDISCLOSED INDICATOR CLEANUP
        // ─────────────────────────────────────────────
        const cleanedUndisclosedIndicators = cleanedUndisclosedIndicatorsStep2.filter(ind => {
            const indLower = ind.toLowerCase();
            const amtMatch = ind.match(/[\d,]+(\.\d+)?/);
            const amt = amtMatch ? parseFloat(amtMatch[0].replace(/,/g, '')) : 999;
            if (amt < 150 && (indLower.includes('ביטוח') || indLower.includes('insurance'))) {
                normalizationLog.push({ rule: 'UNDISCLOSED_LOAN_SMALL_REMOVED', amount: amt });
                return false;
            }
            return true;
        });

        // ─────────────────────────────────────────────
        // RULE 5B: SENIORITY FROM PAYSLIP employment_start_date
        // ─────────────────────────────────────────────
        const updatedBorrowers = normalizedBorrowers.map((b, idx) => {
            const label = idx === 0 ? 'לווה 1' : 'לווה 2';
            const isSabbaticalBorrower = (b.employment_type || '').toLowerCase().includes('שבתון') ||
                (b.special_status_note || '').toLowerCase().includes('שבתון');
            const seniorityLooksWrong = !b.seniority_years || b.seniority_years <= 0.1 ||
                (isSabbaticalBorrower && b.seniority_years < 2);
            const borrowerPayslips = idx === 0 ? (rawData.payslips_borrower1 || []) : (rawData.payslips_borrower2 || []);
            const startDateFromSlip = borrowerPayslips.map(p => p.employment_start_date).filter(Boolean).sort()[0];
            if (startDateFromSlip) {
                const calcSen = calcSeniorityFromDate(startDateFromSlip);
                if (calcSen !== null && (seniorityLooksWrong || calcSen > (b.seniority_years || 0) + 1)) {
                    normalizationLog.push({ rule: 'SENIORITY_FROM_PAYSLIP_START_DATE', borrower: label, seniority: parseFloat(calcSen.toFixed(2)) });
                    return { ...b, seniority_years: parseFloat(calcSen.toFixed(2)) };
                }
            }
            const isSelfEmployed = (b.employment_type || '').toLowerCase().includes('עצמאי');
            if (isSelfEmployed && rawData.business_data) {
                const bd = rawData.business_data;
                const extractYear = (label) => { if (!label) return null; const m = label.match(/20(\d{2})/); return m ? 2000 + parseInt(m[1]) : null; };
                const y1 = extractYear(bd.year1_label);
                const y2 = extractYear(bd.year2_label);
                const y3 = extractYear(bd.year3_label);
                const years = [y1, y2, y3].filter(Boolean);
                const earliestYear = years.length > 0 ? Math.min(...years) : null;
                if (earliestYear) {
                    const currentYear = today.getFullYear();
                    const seniorityFromEarliestYear = parseFloat((currentYear - earliestYear + (today.getMonth() >= 6 ? 0.5 : 0)).toFixed(1));
                    const existingSeniority = bd.seniority_years || b.seniority_years || 0;
                    if (seniorityFromEarliestYear > existingSeniority + 0.5) {
                        normalizationLog.push({ rule: 'SENIORITY_FROM_EARLIEST_TAX_YEAR', borrower: label, earliest_year: earliestYear, corrected: seniorityFromEarliestYear });
                        rawData.business_data.seniority_years = seniorityFromEarliestYear;
                        return { ...b, seniority_years: seniorityFromEarliestYear };
                    }
                }
                if (bd.seniority_years && bd.seniority_years > (b.seniority_years || 0) + 0.5) {
                    normalizationLog.push({ rule: 'SENIORITY_FROM_BUSINESS_DATA_SELF_EMPLOYED', borrower: label, corrected: bd.seniority_years });
                    return { ...b, seniority_years: bd.seniority_years };
                }
            }
            if (isSabbaticalBorrower && rawData.business_data?.seniority_years > (b.seniority_years || 0)) {
                return { ...b, seniority_years: rawData.business_data.seniority_years };
            }
            return b;
        });

        // ─────────────────────────────────────────────
        // RULE 5C: RESERVE DUTY EXCLUSION
        // ─────────────────────────────────────────────
        const reserveDutyMonths = new Set(rawData.reserve_duty_months || []);
        const excludeReserveDuty = (payslips) => {
            if (!payslips || reserveDutyMonths.size === 0) return payslips;
            return payslips.map(p => {
                if (reserveDutyMonths.has((p.month_year || '').trim())) {
                    normalizationLog.push({ rule: 'RESERVE_DUTY_EXCLUDED', month: p.month_year });
                    return { ...p, _anomaly_flag: true, _anomaly_note: 'חודש מילואים — הוחרג מחישוב ממוצע הכנסה', _skip_in_avg: true };
                }
                return p;
            });
        };

        // ─────────────────────────────────────────────
        // RULE 6: INCOME ANOMALY DETECTION
        // ─────────────────────────────────────────────
        const checkIncomeAnomaly = (payslips, label) => {
            if (!payslips || payslips.length < 2) return payslips || [];
            const nets = payslips.map(p => p.net_salary || 0).filter(v => v > 0);
            if (nets.length < 2) return payslips;
            const avg = nets.reduce((s, v) => s + v, 0) / nets.length;
            return payslips.map(p => {
                const net = p.net_salary || 0;
                if (net > 0 && net < avg * 0.70) {
                    normalizationLog.push({ rule: 'INCOME_ANOMALY_FLAGGED', borrower: label, month: p.month_year, net, avg: Math.round(avg) });
                    return { ...p, _anomaly_flag: true, _anomaly_note: `שכר נמוך ב-${Math.round((1 - net/avg)*100)}% מהממוצע — בדוק מילואים/מחלה/היעדרות` };
                }
                return p;
            });
        };

        const normalizedB1Payslips = checkIncomeAnomaly(excludeProRatedFirstMonth(excludeReserveDuty(rawData.payslips_borrower1)), 'לווה 1');
        const normalizedB2Payslips = checkIncomeAnomaly(excludeProRatedFirstMonth(excludeReserveDuty(rawData.payslips_borrower2)), 'לווה 2');

        // ─────────────────────────────────────────────
        // RULE DUAL EMPLOYER DETECTION
        // ─────────────────────────────────────────────
        // ── EMPLOYER ROOT NORMALIZATION — מנרמל שמות מעסיקים לפני השוואה ──
        // OCR מחזיר שמות שונים לאותו מעסיק: "פרזיוניטי", "פריוריטי סופט", "פריורטי סופט"
        // כלל: מוציאים את המילה הראשונה (שורש) לאחר ניקוי "בע"מ", "סופט", "סיטי", "בע."
        const extractEmployerRootNorm = (name) => {
            if (!name) return '';
            // נרמל שמות OCR שגויים נפוצים לפני הכל
            const ocrFixes = [
                [/פרזיוניטי/g, 'פריוריטי'],
                [/פריורטי\b/g, 'פריוריטי'],
                [/פריוריטי\s*(סופטוור|סופטויר|סופט|סיטי|software|city)?/gi, 'פריוריטי'],
            ];
            let normalized = name;
            ocrFixes.forEach(([pat, rep]) => { normalized = normalized.replace(pat, rep); });
            return normalized.replace(/\b(בע"מ|בעמ|ltd|inc|בע\.מ|סופט|software|city|סיטי|בינלאומי)\b/gi, '').trim().split(/\s+/)[0].toLowerCase();
        };

        const checkDualEmployer = (payslips, borrower, borrowerLabel) => {
            if (!payslips || payslips.length < 2) return;
            const recentSlips = payslips.slice(-3);
            const rawEmployers = recentSlips.map(p => (p.employer || '').trim()).filter(Boolean);
            // נרמל כל שם מעסיק ובדוק שורשים ייחודיים
            const employerRoots = new Set(rawEmployers.map(extractEmployerRootNorm).filter(Boolean));
            // אם כל השמות השונים נוצרים משורש זהה — אותה חברה, לא dual employer
            if (employerRoots.size < 2) return;
            const allRecentEmployers = new Set(rawEmployers);
            if (allRecentEmployers.size >= 2) {
                const hasTerminationNote = recentSlips.some(p => {
                    const notes = (p.notes || '').toLowerCase();
                    return notes.includes('סיום עבודה') || notes.includes('פיטורים') || notes.includes('התפטרות') || notes.includes('מעסיק קודם');
                });
                if (!hasTerminationNote) {
                    const employers = [...allRecentEmployers].join(' / ');
                    normalizationLog.push({ rule: 'DUAL_EMPLOYER_DETECTED', borrower: borrowerLabel, employers });
                    borrower._dual_employer_flag = true;
                    borrower._dual_employer_names = employers;
                }
            }
        };

        if (updatedBorrowers[0]) checkDualEmployer(rawData.payslips_borrower1 || [], updatedBorrowers[0], 'לווה 1');
        if (updatedBorrowers[1]) checkDualEmployer(rawData.payslips_borrower2 || [], updatedBorrowers[1], 'לווה 2');

        // ─────────────────────────────────────────────
        // SABBATICAL CHECKLIST
        // ─────────────────────────────────────────────
        const TEMP_INCOME_TYPES = ['שבתון', 'חל"ד', 'חופשת לידה', 'מחלה ממושכת', 'sabbatical', 'maternity'];
        const sabbaticalChecklistFlags = [];
        (rawData.borrowers || []).forEach((b, idx) => {
            const et = (b.employment_type || '').toLowerCase();
            const sn = (b.special_status_note || '').toLowerCase();
            const isOnSabb = et.includes('שבתון') || sn.includes('שבתון') || et.includes('sabbatical') || sn.includes('sabbatical');
            if (!isOnSabb) return;
            const label = idx === 0 ? 'לווה 1' : 'לווה 2';
            const borrowerPayslips = idx === 0 ? (rawData.payslips_borrower1 || []) : (rawData.payslips_borrower2 || []);
            const sabbStartMatch = (b.special_status_note || '').match(/(\d{2})[./](\d{2})[./](\d{4})/);
            const sabbStartDate = sabbStartMatch ? new Date(+sabbStartMatch[3], +sabbStartMatch[2] - 1, +sabbStartMatch[1]) : null;
            const preSlips = borrowerPayslips.filter(p => {
                const notes = (p.notes || '').toLowerCase();
                const isNormalSlip = (p.net_salary || 0) > 3000 && !notes.includes('קרן השתלמות') && !notes.includes('שבתון') && !notes.includes('דמי לידה') && !notes.includes('ביטוח לאומי');
                if (!isNormalSlip) return false;
                if (sabbStartDate && p.month_year) {
                    const parts = (p.month_year || '').split('/');
                    if (parts.length === 2) { const slipDate = new Date(+parts[1], +parts[0] - 1, 1); return slipDate < sabbStartDate; }
                }
                return true;
            });
            if (preSlips.length < 3) {
                sabbaticalChecklistFlags.push({ rule: 'SABBATICAL_PRE_SLIPS_MISSING', borrower: label, found: preSlips.length, missing: 3 - preSlips.length, alert: `חסרים ${3 - preSlips.length} תלושי שכר טרום-שבתון — ${label}` });
            }
            const hasReturnLetter = (rawData.special_circumstances || []).some(sc => {
                const scL = sc.toLowerCase();
                return scL.includes('חזרה לעבודה') || scL.includes('מכתב חזרה') || scL.includes('return to work');
            });
            // ✅ שבתון מורים מאושר ע"י החתם — הכנסה מוכרת ללא תלות במכתב חזרה
            if (!hasReturnLetter && !teacherSabbaticalApproved) {
                sabbaticalChecklistFlags.push({ rule: 'SABBATICAL_RETURN_LETTER_MISSING', borrower: label, alert: `חובה להמציא מכתב חזרה לעבודה — ${label}` });
            }
        });
        rawData._sabbatical_checklist = sabbaticalChecklistFlags;

        // ─────────────────────────────────────────────
        // ✅ FIX: UNDERWRITER ACTIONABLE INSTRUCTIONS — הוראות לחתם
        // לכל לווה בשבתון/חופשה → דרישת אישורים. לכל עצמאי → שומה/אישור רו"ח.
        // מנגנון זה "אומר לחתם מה חסר" ונדחף ישירות ל-actionable_recommendations.
        // ─────────────────────────────────────────────
        if (!rawData.actionable_recommendations) rawData.actionable_recommendations = [];
        const recExists = (needle) => rawData.actionable_recommendations.some(r => (r.text || '').includes(needle));
        (rawData.borrowers || []).forEach((b, idx) => {
            const label = idx === 0 ? 'לווה 1' : 'לווה 2';
            const who = b.name || label;
            const et = (b.employment_type || '').toLowerCase();
            const sn = (b.special_status_note || '').toLowerCase();
            const onLeave = et.includes('שבתון') || sn.includes('שבתון') || et.includes('sabbatical') ||
                et.includes('חל"ת') || et.includes('חלת') || et.includes('לידה') || et.includes('maternity');
            // ✅ שבתון מורים מאושר ע"י החתם — מדלגים על דרישת מכתב חזרה (ההכנסה מוכרת)
            if (onLeave && !teacherSabbaticalApproved && !recExists(`אישורי שבתון/חופשה — ${who}`)) {
                rawData.actionable_recommendations.push({
                    priority: 'חובה_לפני_הגשה', category: 'מסמך_חסר',
                    text: `${who} בשנת שבתון/חופשה — נדרש לצרף אישור יתרה מקרן ההשתלמות ומכתב חזרה לעבודה עם תאריך מדויק. (אישורי שבתון/חופשה — ${who})`,
                    for_whom: who
                });
                normalizationLog.push({ rule: 'UW_INSTRUCTION_SABBATICAL_DOCS', borrower: label });
            }
            const isSelfEmp = et.includes('עצמאי') || et.includes('self');
            if (isSelfEmp && !recExists(`שומה/אישור רו"ח — ${who}`)) {
                rawData.actionable_recommendations.push({
                    priority: 'חובה_לפני_הגשה', category: 'מסמך_חסר',
                    text: `${who} עצמאי — נדרשת שומת מס מעודכנת (שנה אחרונה) או אישור רו"ח עדכני על ההכנסה. (שומה/אישור רו"ח — ${who})`,
                    for_whom: who
                });
                normalizationLog.push({ rule: 'UW_INSTRUCTION_SELF_EMPLOYED_DOCS', borrower: label });
            }
        });

        // ─────────────────────────────────────────────
        // SABBATICAL INCOME CALCULATION
        // ─────────────────────────────────────────────
        const SABBATICAL_GRANT_KEYWORDS = [
            'מענק שבתון', 'מענג שבתון', 'מענק השתלמות',
            'קה"ל מו"ג', 'קה"ל מ"ג', 'קה"ל מוג', 'קהל מוג',
            'קה״ל מו״ג', 'קה״ל מ״ג', 'קה"ל', 'קרן השתלמות מורים', 'כרן השתלמות',
            'קרן השתלמות לעובדי ה', 'קרן מורים', 'מורים וגננות',
            'keren hishtalmut', 'hishtalmut', 'מסגרת שבתון', 'תשלום שבתון'
        ];

        const isSabbaticalGrantDeposit = (d) => {
            const desc = (d.description || '').toLowerCase();
            const src = (d.source_type || '').toLowerCase();
            const combined = desc + ' ' + src;
            if (SABBATICAL_GRANT_KEYWORDS.some(kw => combined.includes(kw.toLowerCase()))) return true;
            if (desc.includes('קה') && (desc.includes('מוג') || desc.includes('מו"') || desc.includes('מו\u05f3'))) return true;
            return false;
        };

        const sabbaticalGrantFromBank = (rawData.income_deposits || []).find(d => isSabbaticalGrantDeposit(d) && (d.average_monthly || 0) > 1000);

        const sabbaticalIncomeFromKeren = (() => {
            const hasSabbaticalBusinessOwner = (rawData.borrowers || []).some((b) => {
                const isSabb = (b.employment_type || '').toLowerCase().includes('שבתון') || (b.special_status_note || '').toLowerCase().includes('שבתון');
                const isSelfEmp = (b.employment_type || '').toLowerCase().includes('עצמאי');
                const hasFull2024Shoma = (rawData.business_data?.annual_income_year1 || 0) > 0;
                return isSabb && isSelfEmp && hasFull2024Shoma;
            });
            if (hasSabbaticalBusinessOwner) { normalizationLog.push({ rule: 'SABBATICAL_SELF_EMPLOYED_USE_SHOMA' }); return null; }
            if (sabbaticalGrantFromBank && (sabbaticalGrantFromBank.average_monthly || 0) > 1000) return sabbaticalGrantFromBank.average_monthly;
            const kerenWithPayout = (rawData.keren_hishtalmut || []).find(k => k.monthly_payout && k.monthly_payout > 1000);
            if (kerenWithPayout) return kerenWithPayout.monthly_payout;
            const sabbSlips = (rawData.pension_slips || []).filter(ps => {
                const src = (ps.source || '').toLowerCase();
                return src.includes('שבתון') || src.includes('קרן השתלמות') || src.includes('keren');
            });
            if (sabbSlips.length > 0) {
                const avg = Math.round(sabbSlips.reduce((s, p) => s + (p.net_allowance || 0), 0) / sabbSlips.length);
                if (avg > 1000) return avg;
            }
            const kerenDeposit = (rawData.income_deposits || []).find(d => {
                const src = (d.source_type || '').toLowerCase();
                return isSabbaticalGrantDeposit(d) || src.includes('קרן') || src.includes('שבתון');
            });
            if (kerenDeposit && (kerenDeposit.average_monthly || 0) > 1000) return kerenDeposit.average_monthly;
            const stableDeposits = (rawData.income_deposits || []).filter(d => d.is_income && (d.average_monthly || 0) > 3000 && (d.average_monthly || 0) < 20000);
            if (stableDeposits.length === 1) return stableDeposits[0].average_monthly;
            return null;
        })();

        const calcPreSabbaticalIncome = (payslips) => {
            if (!payslips || payslips.length === 0) return null;
            const normalSlips = payslips.filter(p => {
                const notes = (p.notes || '').toLowerCase();
                return (p.net_salary || 0) > 3000 && !notes.includes('קרן השתלמות') && !notes.includes('שבתון') && !notes.includes('דמי לידה') && !notes.includes('ביטוח לאומי');
            });
            if (normalSlips.length === 0) return null;
            const last3 = normalSlips.slice(-3);
            return Math.round(last3.reduce((s, p) => s + (p.net_salary || 0), 0) / last3.length);
        };

        const isSabbatical = (b) => {
            const et = (b?.employment_type || '').toLowerCase();
            const sn = (b?.special_status_note || '').toLowerCase();
            const employer = (b?.employer || '').toLowerCase();
            if (et.includes('שבתון')) return true;
            if (et === 'שכיר' && !sn.includes('שבתון')) return false;
            if (et.includes('עצמאי') && sn.includes('שבתון')) return true;
            const isEducation = employer.includes('חינוך') || employer.includes('הוראה') || employer.includes('education');
            if (isEducation && sn.includes('שבתון')) return true;
            const hasSabbaticalInCase = (rawData.special_circumstances || []).some(s => s.toLowerCase().includes('שבתון') || s.toLowerCase().includes('sabbatical'));
            if (isEducation && hasSabbaticalInCase && (rawData.keren_hishtalmut || []).some(k => k.monthly_payout > 0)) return true;
            return false;
        };

        // ✅ שבתון מורים מאושר ע"י החתם — מנוע מדיניות: כפיית הכרה ב-100% ממענק הקרן
        // מאתר את מענק קרן ההשתלמות למורים שחולץ (גם אם ה-LLM לא סיווג אותו כ-sabbatical).
        const teacherSabbaticalMonthly = (() => {
            if (!teacherSabbaticalApproved) return null;
            // 1. מענק מקרן השתלמות בתלושי פנסיה / income_deposits
            if (sabbaticalIncomeFromKeren && sabbaticalIncomeFromKeren > 1000) return sabbaticalIncomeFromKeren;
            // 2. keren_hishtalmut monthly_payout
            const kerenPayout = (rawData.keren_hishtalmut || []).find(k => (k.monthly_payout || 0) > 1000);
            if (kerenPayout) return kerenPayout.monthly_payout;
            // 3. תלוש פנסיה/קרן מורים — נטו ממוצע
            const teacherSlips = (rawData.pension_slips || []).filter(ps => {
                const src = (ps.source || '').toLowerCase();
                return src.includes('שבתון') || src.includes('קרן השתלמות') || src.includes('מורים') || src.includes('keren');
            });
            if (teacherSlips.length > 0) {
                const avg = Math.round(teacherSlips.reduce((s, p) => s + (p.net_allowance || 0), 0) / teacherSlips.length);
                if (avg > 1000) return avg;
            }
            return null;
        })();

        const updatedBorrowersWithSabb = updatedBorrowers.map((b, idx) => {
            // ✅ שבתון מורים מאושר — מכריח הכרה במענק הקרן ב-100% ומבטל את ה-Guard Clause
            const isSabbBorrower = (b.employment_type || '').toLowerCase().includes('שבתון') ||
                (b.special_status_note || '').toLowerCase().includes('שבתון');
            if (teacherSabbaticalApproved && isSabbBorrower && teacherSabbaticalMonthly && teacherSabbaticalMonthly > 1000) {
                normalizationLog.push({ rule: 'TEACHER_SABBATICAL_APPROVED_INCOME_RECOGNIZED', borrower: idx === 0 ? 'לווה 1' : 'לווה 2', monthly_income: teacherSabbaticalMonthly });
                return { ...b, _sabbatical_income_override: teacherSabbaticalMonthly, _teacher_sabbatical_approved: true };
            }
            if (!isSabbatical(b)) return b;
            const isSelfEmployed = (b.employment_type || '').toLowerCase().includes('עצמאי');
            const businessIncome = rawData.business_data?.annual_income_year1 || 0;
            const salaryIncome = rawData.business_data?.salary_income_year1 || 0;
            const plausibleSalary = salaryIncome > 0 && salaryIncome < 300000 ? salaryIncome : 0;
            const totalTaxableYear1 = businessIncome + plausibleSalary;
            const hasFull2024Shoma = businessIncome > 0;
            if (isSelfEmployed && hasFull2024Shoma) {
                const normativeMonthly = Math.round(totalTaxableYear1 / 12);
                normalizationLog.push({ rule: 'SABBATICAL_SELF_EMPLOYED_SHOMA_OVERRIDE', borrower: idx === 0 ? 'לווה 1' : 'לווה 2', normative_monthly: normativeMonthly });
                return { ...b, _sabbatical_income_override: 0, _normative_shoma_monthly: normativeMonthly };
            }
            const kerenData = (rawData.keren_hishtalmut || []).find(k => k.borrower_index === idx || k.borrower_index === undefined || k.borrower_index === null);
            const kerenBelongsToThisBorrower = kerenData && (kerenData.borrower_index === idx || kerenData.borrower_index === undefined || kerenData.borrower_index === null);
            const sabbIncome = (kerenBelongsToThisBorrower && kerenData?.monthly_payout > 1000 ? kerenData.monthly_payout : null) || (kerenBelongsToThisBorrower ? sabbaticalIncomeFromKeren : null);
            if (sabbIncome && sabbIncome > 1000) {
                normalizationLog.push({ rule: 'SABBATICAL_INCOME_ATTACHED', borrower: idx === 0 ? 'לווה 1' : 'לווה 2', monthly_income: sabbIncome });
                return { ...b, _sabbatical_income_override: sabbIncome };
            }
            const borrowerPayslips = idx === 0 ? (rawData.payslips_borrower1 || []) : (rawData.payslips_borrower2 || []);
            const preSabbIncome = calcPreSabbaticalIncome(borrowerPayslips);
            if (preSabbIncome && preSabbIncome > 3000) {
                normalizationLog.push({ rule: 'SABBATICAL_INCOME_FROM_HISTORY', borrower: idx === 0 ? 'לווה 1' : 'לווה 2', monthly_income: preSabbIncome });
                return { ...b, _sabbatical_income_override: preSabbIncome };
            }
            return b;
        });

        const normativeOverrideBorrowerIdxs = new Set(
            updatedBorrowersWithSabb.map((b, idx) => ((b._normative_shoma_monthly || 0) > 0 ? idx : -1)).filter(idx => idx >= 0)
        );
        if (normativeOverrideBorrowerIdxs.size > 0 && rawData.keren_hishtalmut) {
            rawData.keren_hishtalmut = rawData.keren_hishtalmut.map(k => {
                const borrowerIdx = k.borrower_index !== undefined ? k.borrower_index : -1;
                const belongsToNormative = normativeOverrideBorrowerIdxs.has(borrowerIdx) || (borrowerIdx === -1 && normativeOverrideBorrowerIdxs.size > 0);
                if (belongsToNormative && (k.monthly_payout || 0) > 0) {
                    return { ...k, monthly_payout: 0, _payout_suppressed_normative: true };
                }
                return k;
            });
        }

        // ─────────────────────────────────────────────
        // PROPERTY VALUE FROM TABU/CONTRACT
        // ─────────────────────────────────────────────
        let propertyValueFromTabu = rawData.property_value || null;
        let ltvComputed = null;

        // ✅ FIX TABU MAPPING: הסכמה החדשה כותבת ל-real_estate_properties. אם tabu_data ריק
        // אך קיים נכס במערך — גשר ממנו ל-tabu_data כדי שכל לוגיקת הטאבו (כולל שיוך
        // existing_mortgage והשווי) תעבוד. מונע LTV=0 כש"עיוורון לטאבו" נובע מקריאה משדה ישן.
        if (!isMeaningfulObjectLocal(rawData.tabu_data) && Array.isArray(rawData.real_estate_properties) && rawData.real_estate_properties.length > 0) {
            const primary = rawData.real_estate_properties.find(p =>
                (p.registered_mortgages && p.registered_mortgages.length > 0) || p.gush || p.helka
            ) || rawData.real_estate_properties[0];
            if (primary) {
                const firstMortgage = (primary.registered_mortgages || [])[0] || null;
                rawData.tabu_data = {
                    gush: primary.gush, helka: primary.helka, tat_helka: primary.tat_helka,
                    address: primary.address, owners: primary.owners || [],
                    property_value: primary.property_value,
                    registered_mortgage: firstMortgage ? { bank_name: firstMortgage.bank_name, amount: firstMortgage.amount, rank: firstMortgage.rank } : null
                };
                normalizationLog.push({ rule: 'TABU_MAPPED_FROM_REAL_ESTATE_PROPERTIES', gush: primary.gush, helka: primary.helka, registered_mortgage: firstMortgage?.amount || 0 });
            }
        }

        const tabuRegisteredMortgage = rawData.tabu_data?.registered_mortgage?.amount || 0;
        if (rawData.tabu_data?.property_value && rawData.tabu_data.property_value > 0) {
            propertyValueFromTabu = rawData.tabu_data.property_value;
        } else if (rawData.tabu_data?.mortgage_value && rawData.tabu_data.mortgage_value > 0) {
            propertyValueFromTabu = rawData.tabu_data.mortgage_value;
        } else if (rawData.tabu_data?.transaction_amount && rawData.tabu_data.transaction_amount > 0) {
            propertyValueFromTabu = rawData.tabu_data.transaction_amount;
        } else if (rawData.purchase_contract_value && rawData.purchase_contract_value > 0) {
            propertyValueFromTabu = rawData.purchase_contract_value;
        }

        // ✅ FIX: נסח טאבו עם משכנתא רשומה — שייך נכס + משכנתא קיימת אם חסרים.
        // מונע "עיוורון לטאבו": LTV=0 ו-"ללא נכס" כשיש דירה רשומה בבעלות הלווים.
        if (rawData.tabu_data && (rawData.tabu_data.gush || rawData.tabu_data.helka || tabuRegisteredMortgage > 0)) {
            const td = rawData.tabu_data;
            if (tabuRegisteredMortgage > 0) {
                // ✅ תיקון: נתון הטאבו (סכום משכנתא רשומה) הוא הסכום הרשום בלשכת המקרקעין —
                // לא יתרת הסילוק הנוכחית. אסור לגשר אותו ל-remaining_balance כי הוא עלול לנפח
                // את החוב מעל לסכום הסילוק האמיתי שמגיע מדוח הבנק. גישור מטאבו → existing_mortgage
                // מותר רק ל-bank_name (לזיהוי) — לא ליתרה.
                if (!rawData.existing_mortgage?.bank_name && td.registered_mortgage?.bank_name) {
                    rawData.existing_mortgage = {
                        ...(rawData.existing_mortgage || {}),
                        bank_name: td.registered_mortgage.bank_name,
                        _bank_from_tabu: true
                    };
                    normalizationLog.push({ rule: 'TABU_MORTGAGE_BANK_NAME_ONLY', bank: td.registered_mortgage?.bank_name, note: 'שם הבנק מטאבו — היתרה חייבת להגיע מדוח יתרות בנקאי, לא מטאבו' });
                }
                // אם אין שווי נכס כלל — אל תחשב LTV מהסכום הרשום (אינו שווי). רק נסמן שצריך שמאות.
            }
            rawData._tabu_property = {
                gush: td.gush, helka: td.helka, tat_helka: td.tat_helka,
                address: td.address, owners: td.owners || [], registered_mortgage: td.registered_mortgage || null
            };
            normalizationLog.push({ rule: 'TABU_PROPERTY_REGISTERED', gush: td.gush, helka: td.helka, owners_count: (td.owners || []).length });
        }

        const mortgageBalance = rawData.existing_mortgage?.remaining_balance || 0;
        if (propertyValueFromTabu && propertyValueFromTabu > 0 && mortgageBalance > 0) {
            ltvComputed = parseFloat(((mortgageBalance / propertyValueFromTabu) * 100).toFixed(1));
        }

        // ─────────────────────────────────────────────
        // OVERDRAFT CAUSE CLASSIFICATION
        // ─────────────────────────────────────────────
        const classifyOverdraftCause = () => {
            const cashFlowSummary = rawData.cash_flow_summary || [];
            const allCreditCards = rawData.credit_cards || [];
            return cashFlowSummary.map(acc => {
                if ((acc.lowest_balance || 0) < -3000) {
                    const largeCardCharges = allCreditCards.filter(c => {
                        const maxCharge = Math.max(...(c.monthly_amounts_seen || [c.monthly_payment || 0]));
                        return maxCharge > 5000;
                    });
                    if (largeCardCharges.length > 0) {
                        const totalLargeCharges = largeCardCharges.reduce((s, c) => s + Math.max(...(c.monthly_amounts_seen || [c.monthly_payment || 0])), 0);
                        if (Math.abs(acc.lowest_balance || 0) <= totalLargeCharges * 1.5) {
                            normalizationLog.push({ rule: 'OVERDRAFT_TECHNICAL_CAUSE', lowest_balance: acc.lowest_balance, likely_cause: `חיוב כרטיס גדול (₪${Math.round(totalLargeCharges).toLocaleString()})` });
                            return { ...acc, _overdraft_classification: 'technical', _overdraft_cause: `חיוב כרטיס אשראי חד-פעמי של ₪${Math.round(totalLargeCharges).toLocaleString()}` };
                        }
                    }
                }
                return acc;
            });
        };
        const classifiedCashFlow = classifyOverdraftCause();

        // ─────────────────────────────────────────────
        // EQUITY DEDUPLICATION
        // ─────────────────────────────────────────────
        const equityEventsSeen = new Set();
        const deduplicatedEquityEvents = (rawData.equity_events || []).filter(e => {
            const key = `${e.date}_${Math.round(e.amount || 0)}`;
            if (equityEventsSeen.has(key)) { normalizationLog.push({ rule: 'EQUITY_DEDUP', amount: e.amount }); return false; }
            equityEventsSeen.add(key);
            return true;
        }).filter(e => e.is_incoming !== false && e.type !== 'הפקדה_לפקדון');
        const totalEquity = deduplicatedEquityEvents.reduce((s, e) => s + (e.amount || 0), 0);

        // Mortgage bank locking
        if (rawData.existing_mortgage?.bank_name && !rawData._locked_mortgage_bank) {
            rawData._locked_mortgage_bank = rawData.existing_mortgage.bank_name;
        } else if (rawData._locked_mortgage_bank && rawData.existing_mortgage?.bank_name && rawData.existing_mortgage.bank_name !== rawData._locked_mortgage_bank) {
            rawData.existing_mortgage.bank_name = rawData._locked_mortgage_bank;
        }

        // Equity gap auto-task
        const declaredEquity = rawData.declared_equity || rawData.property_purchase_equity || 0;
        const liquidAssetsForGap = liquidEquity + kerenFundsTotal + pensionFundsTotal;
        if (declaredEquity > 0) {
            const equityGapPct = (declaredEquity - liquidAssetsForGap) / declaredEquity;
            if (equityGapPct > 0.10 && declaredEquity > liquidAssetsForGap) {
                const gapAmount = Math.round(declaredEquity - liquidAssetsForGap);
                if (!rawData.actionable_recommendations) rawData.actionable_recommendations = [];
                const alreadyHasEquityTask = rawData.actionable_recommendations.some(r => (r.text || '').includes('אימות מקור הון'));
                if (!alreadyHasEquityTask) {
                    rawData.actionable_recommendations.push({
                        priority: 'חובה_לפני_הגשה', category: 'מסמך_חסר',
                        text: `נדרש אימות מקור הון עצמי: פער ₪${gapAmount.toLocaleString()} בין הון מוצהר (₪${declaredEquity.toLocaleString()}) לנזילות שזוהתה (₪${Math.round(liquidAssetsForGap).toLocaleString()}).`,
                        for_whom: 'לקוח'
                    });
                }
            }
        }

        // ─────────────────────────────────────────────────────────────────
        // RULE: BANK STATEMENT NAME-ANCHOR + DOUBLE-KEY ATTRIBUTION
        // בתיק זוגי: כל חשבון בנק משויך ל-borrower_index לפי שם בעל החשבון.
        // שלושה מצבים: (1) אין שם כלל, (2) שם שלא תואם אף לווה, (3) OK → שיוך
        // ─────────────────────────────────────────────────────────────────
        const allStmts = rawData.bank_statements || [];
        const hasCashFlowData = (rawData.cash_flow_summary || []).length > 0;
        const hasRawStatements = allStmts.length > 0;

        // Helper: returns borrower index (0/1) if holderName matches, else -1
        // ✅ MODULE 6: FUZZY MATCHING — Hebrew name surrounded by English (Leumi bilingual format)
        // "Account Name: ילנה חוציאן" → strip English labels, isolate Hebrew tokens, match each.
        const extractHebrewTokens = (str) => (str || '').match(/[\u0590-\u05FF]{2,}/g) || [];
        const matchHolderToBorrowerIndex = (holderName) => {
            if (!holderName) return -1;
            const holder = holderName.toLowerCase().trim();
            const holderHebTokens = extractHebrewTokens(holderName); // ignores "Account Name:" etc.
            const borrowersArr = rawData.borrowers || [];
            for (let i = 0; i < borrowersArr.length; i++) {
                const bName = (borrowersArr[i].name || '').trim();
                const partsLower = bName.toLowerCase().split(/\s+/).filter(w => w.length > 1);
                // Primary: substring match on the full (lowercased) holder string
                const matchCount = partsLower.filter(part => holder.includes(part)).length;
                if (partsLower.length >= 2 ? matchCount >= 2 : matchCount >= 1) return i;
                // Fuzzy fallback: match Hebrew name tokens against Hebrew tokens isolated from a bilingual header
                const bNameHebTokens = extractHebrewTokens(bName);
                if (bNameHebTokens.length > 0 && holderHebTokens.length > 0) {
                    const hebMatches = bNameHebTokens.filter(t => holderHebTokens.some(h => h === t || h.includes(t) || t.includes(h))).length;
                    if (bNameHebTokens.length >= 2 ? hebMatches >= 2 : hebMatches >= 1) {
                        normalizationLog.push({ rule: 'BANK_STMT_FUZZY_HEBREW_MATCH', holder: holderName, borrower: bName });
                        return i;
                    }
                }
            }
            return -1;
        };
        const holderMatchesAnyBorrower = (holderName) => matchHolderToBorrowerIndex(holderName) >= 0;

        if (hasRawStatements || hasCashFlowData) {
            if (hasRawStatements) {
                const stmtsWithNoName = allStmts.filter(s => !s.account_holder_name);
                const stmtsWithWrongName = allStmts.filter(s =>
                    s.account_holder_name && !holderMatchesAnyBorrower(s.account_holder_name)
                );

                // ✅ FIX v4: NAME-ANCHOR VALIDATION FLAG — מחובר ל-Output
                // אם יש דפי עו"ש ללא שם → מסמן _bank_stmt_name_anchor_failed=true
                // buildQuickReport ו-buildUnderwriterReport ישתמשו בזה לצבוע Anomaly Shield בצהוב
                if (stmtsWithNoName.length > 0 || stmtsWithWrongName.length > 0) {
                    rawData._bank_stmt_name_anchor_failed = true;
                    rawData._bank_stmt_name_anchor_details = {
                        no_name_count: stmtsWithNoName.length,
                        wrong_name_count: stmtsWithWrongName.length,
                        wrong_names: stmtsWithWrongName.map(s => s.account_holder_name).filter(Boolean)
                    };
                } else {
                    rawData._bank_stmt_name_anchor_failed = false;
                }

                // ── Double-Key Attribution: tag each statement with its borrower_index ──
                rawData.bank_statements = allStmts.map(s => {
                    if (!s.account_holder_name) return { ...s, _name_anchor_missing: true };
                    const idx = matchHolderToBorrowerIndex(s.account_holder_name);
                    if (idx >= 0) {
                        if (s.borrower_index !== undefined && s.borrower_index !== idx) {
                            normalizationLog.push({ rule: 'BANK_STMT_REATTRIBUTED', holder: s.account_holder_name, from: s.borrower_index, to: idx });
                        }
                        return { ...s, borrower_index: idx, _name_anchor_verified: true };
                    }
                    return s;
                });

                if (stmtsWithNoName.length > 0) {
                    normalizationLog.push({ rule: 'BANK_STMT_NO_HOLDER_NAME', count: stmtsWithNoName.length });
                    if (!rawData.bank_red_flags) rawData.bank_red_flags = [];
                    rawData.bank_red_flags.push(
                        `דפי עו"ש (${stmtsWithNoName.length} חשבון/ות) — שם בעל החשבון לא מופיע במסמך. לא ניתן לאמת בעלות.`
                    );
                    if (!rawData.actionable_recommendations) rawData.actionable_recommendations = [];
                    const alreadyHas = rawData.actionable_recommendations.some(r =>
                        (r.text || '').includes('שם בעל החשבון') || (r.text || '').includes('אימות בעלות')
                    );
                    if (!alreadyHas) {
                        rawData.actionable_recommendations.push({
                            priority: 'חובה_לפני_הגשה',
                            category: 'מסמך_חסר',
                            text: `דפי חשבון הבנק אינם מציגים את שם הלווה — לא ניתן לאמת בעלות על החשבון. נדרש אחד מהמסמכים הבאים: (1) דפי עו"ש הכוללים את שם בעל החשבון בכותרת, (2) אישור ניהול חשבון חתום ע"י הבנק, (3) צ'ק מבוטל על שם הלווה.`,
                            for_whom: 'לקוח'
                        });
                    }
                }

                if (stmtsWithWrongName.length > 0) {
                    const mismatchNames = [...new Set(stmtsWithWrongName.map(s => s.account_holder_name))].join(', ');
                    stmtsWithWrongName.forEach(s => normalizationLog.push({
                        rule: 'BANK_STMT_NAME_MISMATCH', holder: s.account_holder_name, account: s.account_last4
                    }));
                    if (!rawData.bank_red_flags) rawData.bank_red_flags = [];
                    rawData.bank_red_flags.push(
                        `⚠️ שם בעל החשבון בדפי עו"ש (${mismatchNames}) אינו תואם לשם הלווה — חשד לדפי בנק של צד שלישי.`
                    );
                    if (!rawData.actionable_recommendations) rawData.actionable_recommendations = [];
                    rawData.actionable_recommendations.push({
                        priority: 'חובה_לפני_הגשה',
                        category: 'אזהרה',
                        text: `שם בעל החשבון בדפי הבנק (${mismatchNames}) אינו תואם לשם הלווה. יש לוודא שהמסמכים שייכים ללווה ולא לצד שלישי. נדרש: אישור ניהול חשבון על שם הלווה.`,
                        for_whom: 'שניהם'
                    });
                }
            } else if (hasCashFlowData) {
                normalizationLog.push({ rule: 'BANK_STMT_NAME_NOT_EXTRACTED' });
                if (!rawData.actionable_recommendations) rawData.actionable_recommendations = [];
                const alreadyHas = rawData.actionable_recommendations.some(r =>
                    (r.text || '').includes('שם בעל החשבון') || (r.text || '').includes('אימות בעלות')
                );
                if (!alreadyHas) {
                    rawData.actionable_recommendations.push({
                        priority: 'חובה_לפני_הגשה',
                        category: 'מסמך_חסר',
                        text: `לא אומת שם הלווה בדפי חשבון הבנק. נדרש: (1) דפי עו"ש הכוללים את שם בעל החשבון, (2) אישור ניהול חשבון חתום ע"י הבנק, או (3) צ'ק מבוטל על שם הלווה.`,
                        for_whom: 'לקוח'
                    });
                }
            }
        }

        // ─────────────────────────────────────────────────────────────────
        // RULE: THIRD PROPERTY / INVESTMENT PROPERTY — EQUITY SOURCE = CRITICAL RED
        // דירה שלישית/השקעה: מקור הון עצמי חייב להיות "חובה אדום", לא המלצה.
        // ─────────────────────────────────────────────────────────────────
        const isThirdPropertyOrInvestment = (rawData.property_purpose === 'דירה_להשקעה') ||
            (rawData.detected_case_types || []).some(t => t.includes('השקעה')) ||
            ((rawData.borrowers || []).some(b => b.owns_additional_properties === true)) ||
            (rawData.property_purpose === 'דירה_חלופית' && (rawData.all_mortgages || []).length >= 2);

        if (isThirdPropertyOrInvestment) {
            if (!rawData.actionable_recommendations) rawData.actionable_recommendations = [];
            const alreadyHasEquityRed = rawData.actionable_recommendations.some(r =>
                (r.text || '').includes('מקור הון עצמי') && r.priority === 'חובה_לפני_הגשה'
            );
            if (!alreadyHasEquityRed) {
                // הסר המלצה צהובה/רגילה קיימת על מקור הון עצמי
                rawData.actionable_recommendations = rawData.actionable_recommendations.filter(r =>
                    !(r.text || '').includes('מקור הון עצמי')
                );
                rawData.actionable_recommendations.push({
                    priority: 'חובה_לפני_הגשה',
                    category: 'אזהרה',
                    text: '🔴 דירה שלישית / להשקעה — חובה לאמת מקור הון עצמי (מסמכים: עו"ש 6 חודשים + הצהרת מקור ממקצה נוטריוני). הבנק יחמיר מאוד בדרישה זו.',
                    for_whom: 'שניהם'
                });
                normalizationLog.push({ rule: 'THIRD_PROPERTY_EQUITY_SOURCE_ESCALATED_TO_CRITICAL' });
            }
        }

        // ─────────────────────────────────────────────────────────────────
        // RULE: PRENUPTIAL AGREEMENT (הסכם ממון) — MITIGATING FACTOR
        // זיהוי הסכם ממון → גורם מפצה: הפרדה רכושית מלאה = סיכון משפטי נמוך לבנק
        // ─────────────────────────────────────────────────────────────────
        const hasPrenuptialAgreement = (rawData.special_circumstances || []).some(sc => {
            const scL = sc.toLowerCase();
            return scL.includes('הסכם ממון') || scL.includes('prenuptial') || scL.includes('הפרדה רכושית') || scL.includes('נכסים נפרדים');
        });
        if (hasPrenuptialAgreement) {
            if (!rawData._financial_strengths) rawData._financial_strengths = [];
            const alreadyAdded = rawData._financial_strengths.some(s => s.type === 'PRENUPTIAL_AGREEMENT');
            if (!alreadyAdded) {
                rawData._financial_strengths.push({
                    type: 'PRENUPTIAL_AGREEMENT',
                    label: 'הסכם ממון — הפרדה רכושית מלאה',
                    description: 'קיים הסכם ממון בין הלווים המבטיח הפרדה רכושית מלאה. הנכסים הקיימים (דירות/חסכונות) אינם "צובעים" את הנכס החדש. גורם זה מוריד את הסיכון המשפטי של הבנק ומאפשר ניתוח LTV נקי עבור כל לווה בנפרד.',
                    is_strength: true,
                    is_mitigant: true
                });
                normalizationLog.push({ rule: 'PRENUPTIAL_AGREEMENT_DETECTED_AS_MITIGANT' });
            }
        }

        // ─────────────────────────────────────────────────────────────────
        // RULE: LARGE CAPITAL MOVEMENTS → EQUITY EVENTS (not shadow debts)
        // העברות גדולות (>₪50K) חד-פעמיות בעו"ש = פירעון פיקדון / הון הוני,
        // לא הלוואה צל. מונע פאניקה מיותרת על ₪110K, ₪94K וכדומה.
        // ─────────────────────────────────────────────────────────────────
        if (rawData.undisclosed_loan_indicators) {
            rawData.undisclosed_loan_indicators = rawData.undisclosed_loan_indicators.filter(ind => {
                if (isCapitalMovement(ind)) {
                    normalizationLog.push({ rule: 'CAPITAL_MOVEMENT_UNDISCLOSED_STRIPPED', indicator: ind.substring(0, 80) });
                    return false;
                }
                // Large one-time transfers (>₪50K) are almost always equity events, not recurring loans
                const amtMatch = ind.match(/[\d,]+/g);
                const amounts = amtMatch ? amtMatch.map(a => parseInt(a.replace(/,/g, ''))).filter(a => a > 0) : [];
                const maxAmt = amounts.length > 0 ? Math.max(...amounts) : 0;
                const indLower = ind.toLowerCase();
                const isLargeOneTime = maxAmt >= 50000 && (
                    indLower.includes('העברה') || indLower.includes('transfer') ||
                    indLower.includes('הפקדה') || indLower.includes('deposit') ||
                    indLower.includes('פירעון') || indLower.includes('משיכה')
                );
                if (isLargeOneTime) {
                    normalizationLog.push({ rule: 'LARGE_CAPITAL_MOVEMENT_NOT_SHADOW_DEBT', amount: maxAmt, indicator: ind.substring(0, 80) });
                    // Promote to equity_events if not already there
                    const alreadyInEquity = (rawData.equity_events || []).some(e => Math.abs((e.amount || 0) - maxAmt) < maxAmt * 0.05);
                    if (!alreadyInEquity && maxAmt > 0) {
                        if (!rawData.equity_events) rawData.equity_events = [];
                        rawData.equity_events.push({
                            date: null,
                            description: `העברה הונית — ${ind.substring(0, 60)}`,
                            amount: maxAmt,
                            type: 'העברת_הון',
                            borrower_index: 0,
                            is_incoming: true
                        });
                    }
                    return false;
                }
                return true;
            });
        }

        // ESPP already filtered early above (before cleanedPayslipDeductions was computed)

        // ═══════════════════════════════════════════════════════════════
        // HI-TECH UNDERWRITING ENGINE — 6 MODULES (deterministic)
        // 1. Partial Month  2. ESPP Add-Back  3. RSU/benefit exclusion
        // 4. Car Lease (no double-count)  5. Keren-Hishtalmut loan (asset-backed)
        // 6. Equity Hunter (already promoted in extractDocData; reinforced here)
        // ═══════════════════════════════════════════════════════════════
        const hiTechModules = { espp_added_back: 0, rsu_excluded: 0, car_lease_detected: 0, salary_advance_detected: 0, keren_loan_detected: 0, partial_months: [] };

        // ── MODULE 1: PARTIAL MONTH LOGIC ──
        // If a payslip's employment_start_date falls inside that payslip's own month → it's a partial
        // (first) working month. Flag _skip_in_avg so it's excluded from averages AND salary-jump detection.
        const parseMonthYear = (my) => { const p = (my || '').split('/'); return p.length === 2 ? { m: +p[0], y: +p[1] } : null; };
        const flagPartialMonths = (payslips, label) => {
            if (!payslips) return payslips;
            return payslips.map(p => {
                const startStr = p.employment_start_date;
                const my = parseMonthYear(p.month_year);
                if (startStr && my) {
                    const sm = startStr.match(/(\d{2})[.\/](\d{2})[.\/](\d{4})/);
                    if (sm) {
                        const startMonth = +sm[2], startYear = +sm[3], startDay = +sm[1];
                        // Start date is inside this payslip's month, and not on the 1st → partial month
                        if (startMonth === my.m && startYear === my.y && startDay > 1) {
                            normalizationLog.push({ rule: 'PARTIAL_MONTH_EXCLUDED', borrower: label, month: p.month_year, start_date: startStr });
                            hiTechModules.partial_months.push({ borrower: label, month: p.month_year });
                            return { ...p, _skip_in_avg: true, _partial_month: true, _anomaly_note: `חודש עבודה חלקי (תחילת עבודה ${startStr}) — הוחרג מחישוב ממוצע ומזיהוי קפיצות שכר` };
                        }
                    }
                }
                return p;
            });
        };

        // ── MODULES 2-5: per-payslip deduction tagging + Add-Back / exclusion ──
        const processHiTechDeductions = (payslips, label) => {
            if (!payslips) return payslips;
            return payslips.map(p => {
                const updated = { ...p };
                // MODULE 2 — ESPP Add-Back: voluntary saving → add back to net (effective income)
                if ((p.espp_deduction || 0) > 0) {
                    updated._espp_addback = p.espp_deduction;
                    hiTechModules.espp_added_back = Math.max(hiTechModules.espp_added_back, p.espp_deduction);
                    normalizationLog.push({ rule: 'ESPP_ADDED_BACK_TO_NET', borrower: label, month: p.month_year, amount: p.espp_deduction });
                }
                // MODULE 3 — RSU / benefit zekifa: notional, exclude from cash income (never added to net)
                if ((p.rsu_gain || 0) > 0) {
                    updated._rsu_excluded = p.rsu_gain;
                    hiTechModules.rsu_excluded = Math.max(hiTechModules.rsu_excluded, p.rsu_gain);
                    normalizationLog.push({ rule: 'RSU_GAIN_EXCLUDED_NOTIONAL', borrower: label, month: p.month_year, amount: p.rsu_gain });
                }
                // MODULE 4 — Car lease: already netted out, do NOT add to obligations. Tag only.
                if ((p.car_lease_deduction || 0) > 0) {
                    updated._car_lease = p.car_lease_deduction;
                    hiTechModules.car_lease_detected = Math.max(hiTechModules.car_lease_detected, p.car_lease_deduction);
                    normalizationLog.push({ rule: 'CAR_LEASE_TAGGED_NOT_DEBT', borrower: label, month: p.month_year, amount: p.car_lease_deduction });
                }
                // MODULE 5 — Salary advance: one-time, orange flag only
                if ((p.salary_advance || 0) > 0) {
                    updated._salary_advance = p.salary_advance;
                    hiTechModules.salary_advance_detected = Math.max(hiTechModules.salary_advance_detected, p.salary_advance);
                    normalizationLog.push({ rule: 'SALARY_ADVANCE_FLAGGED', borrower: label, month: p.month_year, amount: p.salary_advance });
                }
                // MODULE 5b — Keren Hishtalmut / pension-backed loan: asset-backed, subsidized
                if ((p.keren_hishtalmut_loan_deduction || 0) > 0) {
                    updated._keren_loan = p.keren_hishtalmut_loan_deduction;
                    hiTechModules.keren_loan_detected = Math.max(hiTechModules.keren_loan_detected, p.keren_hishtalmut_loan_deduction);
                    normalizationLog.push({ rule: 'KEREN_HISHTALMUT_LOAN_ASSET_BACKED', borrower: label, month: p.month_year, amount: p.keren_hishtalmut_loan_deduction });
                }
                return updated;
            });
        };

        let hiTechB1 = processHiTechDeductions(flagPartialMonths(normalizedB1Payslips, 'לווה 1'), 'לווה 1');
        let hiTechB2 = processHiTechDeductions(flagPartialMonths(normalizedB2Payslips, 'לווה 2'), 'לווה 2');

        // ── Compute the monthly ESPP add-back (use the most recent / max value seen) ──
        const esppAddBack = hiTechModules.espp_added_back;
        if (esppAddBack > 0) {
            if (!rawData._financial_strengths) rawData._financial_strengths = [];
            rawData._financial_strengths.push({
                type: 'ESPP_ADDBACK_EFFECTIVE_INCOME',
                label: 'הכנסה מנורמלת — Add-Back ל-ESPP',
                description: `ההכנסה הקובעת כוללת הוספה של ₪${Math.round(esppAddBack).toLocaleString()} בגין ניכוי חיסכון וולונטרי (ESPP) הניתן לביטול. ניכוי זה הופחת מהנטו אך מהווה חיסכון אישי זמין.`,
                monthly_addback: esppAddBack,
                is_strength: true
            });
        }
        // Expose the effective income add-back so buildQuickReport can fold it into avg net
        rawData._espp_monthly_addback = esppAddBack;
        rawData._hitech_modules = hiTechModules;

        // ── MODULE 5b strength note: subsidized keren-hishtalmut loan ──
        if (hiTechModules.keren_loan_detected > 0) {
            if (!rawData._financial_strengths) rawData._financial_strengths = [];
            rawData._financial_strengths.push({
                type: 'KEREN_HISHTALMUT_SUBSIDIZED_LOAN',
                label: 'הלוואה מסובסדת ע"ח קרן השתלמות',
                description: `ההתחייבויות כוללות הלוואה ע"ח קרן השתלמות בסך ₪${Math.round(hiTechModules.keren_loan_detected).toLocaleString()}/חודש. ההלוואה מגובה בנכס וניתנת לסילוק מלא באמצעות הקרן ללא פגיעה בהון העצמי המזומן. הלוואה זו ניתנת בתנאים מועדפים — מומלץ לשמרה כמימון זול.`,
                monthly_payment: hiTechModules.keren_loan_detected,
                is_strength: true,
                is_mitigant: true
            });
        }
        // ── MODULE 4 strength note: car lease (embedded in net) ──
        if (hiTechModules.car_lease_detected > 0) {
            if (!rawData._financial_strengths) rawData._financial_strengths = [];
            rawData._financial_strengths.push({
                type: 'CAR_LEASE_EMBEDDED_NET',
                label: 'הוצאות רכב/ליסינג (מגולמות בנטו)',
                description: `לידיעת הבנק: ללווה רכב ליסינג בעלות של ₪${Math.round(hiTechModules.car_lease_detected).toLocaleString()} המנוכה מהנטו. בעת הצורך, הלווה יכול לוותר על הרכב ולהגדיל את ההכנסה הפנויה.`,
                monthly_deduction: hiTechModules.car_lease_detected,
                is_strength: true
            });
        }
        // ── MODULE 5 orange flag: salary advance ──
        if (hiTechModules.salary_advance_detected > 0) {
            rawData._salary_advance_alert = `זוהתה מקדמת שכר ע"ס ₪${Math.round(hiTechModules.salary_advance_detected).toLocaleString()} בתלוש. יש לוודא מול הלקוח שלא מדובר בהלוואה נגררת.`;
        }

        // ─────────────────────────────────────────────
        // ASSEMBLE OUTPUT
        // ─────────────────────────────────────────────
        const finalB1Payslips = suppressGrossNetAlerts(hiTechB1, 0);
        const finalB2Payslips = suppressGrossNetAlerts(hiTechB2, 1);

        const cleanedData = {
            ...rawData,
            borrowers: updatedBorrowersWithSabb,
            detected_case_types: detectedTypes,
            loans: normalizedLoans,
            credit_cards: normalizedCreditCards,
            payslips_borrower1: finalB1Payslips,
            payslips_borrower2: finalB2Payslips,
            payslip_deductions: cleanedPayslipDeductions,
            undisclosed_loan_indicators: cleanedUndisclosedIndicators,
            equity_events: deduplicatedEquityEvents,
            total_equity_evidence: totalEquity,
            property_value: propertyValueFromTabu || rawData.property_value,
            ltv_computed: ltvComputed,
            cash_flow_summary: classifiedCashFlow,
            _normalization: {
                overdraft_with_equity: overdraftWithEquity,
                liquid_equity: liquidEquity,
                sabbatical_income_found: sabbaticalIncomeFromKeren,
                ltv_computed: ltvComputed,
                property_value_source: propertyValueFromTabu ? (rawData.tabu_data?.property_value ? 'tabu' : 'contract') : 'none',
                suppressed_alerts: suppressedAlerts,   // ✅ alerts removed from Risk Radar
                financial_strengths: rawData._financial_strengths || [],  // ✅ ESPP + strengths
                log: normalizationLog,
                normalized_at: new Date().toISOString(),
                rules_applied: [...new Set(normalizationLog.map(l => l.rule))]
            }
        };

        return Response.json(cleanedData);

    } catch (error) {
        console.error('normalizeDocData error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
  }),
};
