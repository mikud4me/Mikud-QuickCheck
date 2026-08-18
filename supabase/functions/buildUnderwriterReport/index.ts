import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { isValidIsraeliId } from "../_shared/israeliId.js";

/**
 * buildUnderwriterReport — מנוע חיתום מוסדי
 *
 * ── MIGRATION NOTE (Base44 → Supabase) ──
 * Purely mechanical port — no logic changes anywhere below this comment
 * block. Only the SDK import, the shared-module import path, and the
 * auth check (base44.auth.me() + role check → ctx.userClaims) changed.
 *
 * מודול עצמאי, נפרד לחלוטין מ-buildQuickReport.
 * מממש:
 *   1. מנוע ציון סיכון (4 עמודים, משקלות דינמיים לפי סוג עסקה)
 *   2. נעילת זהות (cross-match משולש)
 *   3. התראות מנהלים (גורמים מפצים מול דגלים אדומים)
 *   4. פלט JSON של ScoreObject
 *   5. תמיכה בנתוני Intake Wizard — LTV מדויק, אימות הון עצמי, הלוואות לסגירה
 */

/**
 * buildChecklist — רשימת תיעוד מסונכרנת לפי סוג עסקה
 * מחזיר מערך של פריטים: { id, label, category, status, priority, note }
 * status: 'present' | 'missing' | 'partial' | 'not_required'
 */
function buildChecklist({ raw, caseType, borrower1, borrower2, b1Payslips, b2Payslips,
    hasBusinessData, isRefinance, isQuickLoan, equity,
    b1IdExpired, b2IdExpired, ltvComputed, effectivePropertyValue,
    requestedMortgageAmount, loansToCloseAmount, existingMortgageBalanceWizard,
    idCardVerified = {} }) {

    const items = [];
    const hasBorrower2 = !!(borrower2?.name);

    const add = (id, label, category, status, priority = 'high', note = null) =>
        items.push({ id, label, category, status, priority, note });

    // ── זהות — אימות מצילום ת"ז ייעודי. ✅ FIX חיווט: אם buildDocumentVerifications
    // יצר אובייקט id_card מאומת (idCardVerified[idx]===true) — הוא סוגר את ה-Checklist,
    // גם אם id_document_found===false. ה-V הירוק שנוצר למטה מטפס עכשיו למעלה.
    const b1HasDedicatedIdDoc = borrower1.id_document_found === true || idCardVerified[0] === true;
    const b1IdOk = borrower1.id && borrower1.id.replace(/\D/g, '').length === 9 && !b1IdExpired && b1HasDedicatedIdDoc;
    add('id_b1', `ת.ז — ${borrower1.name || 'לווה 1'}`, 'זהות',
        b1IdExpired ? 'partial'
        : !b1HasDedicatedIdDoc ? 'missing'   // אזכור בספח בלבד — אינו מסמך ייעודי
        : b1IdOk ? 'present' : 'missing',
        'critical',
        b1IdExpired ? 'פגת תוקף — יש לחדש'
        : !b1HasDedicatedIdDoc ? `מספר ת.ז זוהה ממסמך אחר (ספח בן-זוג) — חובה להעלות צילום ת.ז ייעודי של הלווה` : null);

    if (hasBorrower2) {
        const b2HasDedicatedIdDoc = borrower2.id_document_found === true || idCardVerified[1] === true;
        const b2IdOk = borrower2.id && borrower2.id.replace(/\D/g, '').length === 9 && !b2IdExpired && b2HasDedicatedIdDoc;
        add('id_b2', `ת.ז — ${borrower2.name || 'לווה 2'}`, 'זהות',
            b2IdExpired ? 'partial'
            : !b2HasDedicatedIdDoc ? 'missing'
            : b2IdOk ? 'present' : 'missing',
            'critical',
            b2IdExpired ? 'פגת תוקף — יש לחדש'
            : !b2HasDedicatedIdDoc ? `מספר ת.ז זוהה ממספח בן-זוג — חובה להעלות צילום ת.ז ייעודי של הלווה` : null);
    }

    // ── הכנסה — לווה 1 ──
    const b1IsEmployee = (borrower1.employment_type || '').includes('שכיר') && !((borrower1.employment_type || '').includes('עצמאי'));
    const b1IsSelfEmployed = (borrower1.employment_type || '').includes('עצמאי') || (!borrower1.employment_type && hasBusinessData && (raw.business_data?.owner_borrower_index === 0 || raw.business_data?.owner_borrower_index === undefined));

    const hasCpaB1 = !!(raw.business_data?.cpa_monthly_income || raw.business_data?.cpa_annual_income || (raw.cpa_letters || []).some(c => c.business_owner_id && (borrower1.id || '').includes(c.business_owner_id.slice(-4))));
    const hasTaxAssessB1 = !!(raw.business_data?.annual_income_year1 || raw.business_data?.annual_income_year2 || (raw.tax_assessments || []).some(t => t.taxpayer_id === (borrower1.id || '').replace(/\D/g, '') || t.taxpayer_name?.includes((borrower1.name || '').split(' ')[0])));

    // ── זיהוי שבתון עם מענק השתלמות — מחליף דרישת תלושי שכר ──
    const b1IsSabbatical = (borrower1.employment_type || '').toLowerCase().includes('שבתון');
    const b1HasSabbaticalGrant = b1IsSabbatical && (
        (raw.income_deposits || []).some(d => {
            const desc = (d.description || '').toLowerCase();
            return d.is_income && (desc.includes('מענק') || desc.includes('השתלמות') || desc.includes('שבתון')) && (d.average_monthly || 0) > 1000;
        }) ||
        (raw.keren_hishtalmut || []).some(k => (k.monthly_payout || 0) > 1000) ||
        borrower1._sabbatical_income_override > 0
    );

    if (b1IsSelfEmployed) {
        // עצמאי — חובה: מכתב רו"ח + שומת מס (שניהם קריטיים)
        add('cpa_letter_b1', `מכתב רו"ח — ${borrower1.name || 'לווה 1'}`, 'הכנסה',
            hasCpaB1 ? 'present' : 'missing', 'critical',
            !hasCpaB1 ? 'עצמאי — מכתב רו"ח חובה קריטי (ריווחיות 2 שנים אחרונות)' : null);
        add('tax_assessment_b1', `שומת מס — ${borrower1.name || 'לווה 1'}`, 'הכנסה',
            hasTaxAssessB1 ? 'present' : 'missing', 'critical',
            !hasTaxAssessB1 ? 'עצמאי — שומת מס 2 שנים אחרונות חובה קריטית' : null);
    } else if (b1HasSabbaticalGrant) {
        // שבתון עם מענק השתלמות — מענק מחליף תלושי שכר, אין דרישת "missing payslips"
        add('payslips_b1', `מענק השתלמות (שבתון) — ${borrower1.name || 'לווה 1'}`, 'הכנסה', 'present', 'critical',
            'מענק השתלמות מקרן המורים — מספק הכנסה נורמטיבית מוכרת. אין דרישת תלושי שכר.');
    } else if (b1Payslips.length >= 3) {
        add('payslips_b1', `תלושי שכר (${b1Payslips.length} חודשים) — ${borrower1.name || 'לווה 1'}`, 'הכנסה', 'present', 'critical');
    } else if (b1Payslips.length > 0) {
        add('payslips_b1', `תלושי שכר (${b1Payslips.length} חודשים) — ${borrower1.name || 'לווה 1'}`, 'הכנסה', 'partial', 'critical',
            `קיימים ${b1Payslips.length} תלושים — מומלץ לפחות 3`);
    } else {
        add('payslips_b1', `תלושי שכר — ${borrower1.name || 'לווה 1'}`, 'הכנסה', 'missing', 'critical');
    }

    // ── הכנסה — לווה 2 ──
    if (hasBorrower2) {
        const b2IsSelfEmployed = (borrower2.employment_type || '').includes('עצמאי') || (!borrower2.employment_type && raw.business_data?.owner_borrower_index === 1);
        const hasCpaB2 = !!(b2IsSelfEmployed && (raw.cpa_letters || []).some(c => c.business_owner_id && (borrower2.id || '').includes(c.business_owner_id.slice(-4))));
        const hasTaxAssessB2 = !!(b2IsSelfEmployed && (raw.tax_assessments || []).some(t => t.taxpayer_id === (borrower2.id || '').replace(/\D/g, '') || t.spouse_name?.includes((borrower2.name || '').split(' ')[0])));

        const b2IsSabbGrant = (borrower2.employment_type||'').toLowerCase().includes('שבתון') && ((raw.income_deposits||[]).some(d=>d.is_income&&((d.description||'').includes('מענק')||(d.description||'').includes('השתלמות'))&&(d.average_monthly||0)>1000)||(raw.keren_hishtalmut||[]).some(k=>(k.monthly_payout||0)>1000)||borrower2._sabbatical_income_override>0);
        if (b2IsSelfEmployed) {
            add('cpa_letter_b2',`מכתב רו"ח — ${borrower2.name}`,'הכנסה',hasCpaB2?'present':'missing','critical',!hasCpaB2?'עצמאי — מכתב רו"ח חובה קריטי':null);
            add('tax_assessment_b2',`שומת מס — ${borrower2.name}`,'הכנסה',hasTaxAssessB2?'present':'missing','critical',!hasTaxAssessB2?'עצמאי — שומת מס 2 שנים אחרונות חובה קריטית':null);
        } else if (b2IsSabbGrant) {
            add('payslips_b2',`מענק השתלמות (שבתון) — ${borrower2.name}`,'הכנסה','present','high','מענק השתלמות — מספק הכנסה נורמטיבית מוכרת. אין דרישת תלושי שכר.');
        } else if (b2Payslips.length >= 3) {
            add('payslips_b2',`תלושי שכר (${b2Payslips.length} חודשים) — ${borrower2.name}`,'הכנסה','present','high');
        } else if (b2Payslips.length > 0) {
            add('payslips_b2',`תלושי שכר (${b2Payslips.length} חודשים) — ${borrower2.name}`,'הכנסה','partial','high',`קיימים ${b2Payslips.length} תלושים — מומלץ לפחות 3`);
        } else {
            add('payslips_b2',`תלושי שכר — ${borrower2.name}`,'הכנסה','missing','high');
        }
    }

    // ── דפי חשבון ──
    // תיקון: גם cash_flow_summary ו-income_deposits מהווים ראיה לדפי חשבון
    const bankStmtsCount = (raw.bank_statements || []).length;
    const hasCashFlowEvidence = (raw.cash_flow_summary || []).length > 0;
    const hasIncomeDepositsEvidence = (raw.income_deposits || []).some(d => d.is_income);
    const effectiveBankStmtCount = bankStmtsCount > 0 ? bankStmtsCount : (hasCashFlowEvidence || hasIncomeDepositsEvidence ? 1 : 0);
    if (bankStmtsCount >= 3 || (effectiveBankStmtCount > 0 && (hasCashFlowEvidence || hasIncomeDepositsEvidence))) {
        add('bank_stmts', `דפי חשבון בנק (${bankStmtsCount > 0 ? bankStmtsCount + ' חודשים' : 'זוהו נתוני בנק'})`, 'בנק', 'present', 'high');
    } else if (effectiveBankStmtCount > 0) {
        add('bank_stmts', `דפי חשבון בנק (${effectiveBankStmtCount} חודשים)`, 'בנק', 'partial', 'high',
            'מומלץ לפחות 3 חודשים אחרונים');
    } else {
        add('bank_stmts', 'דפי חשבון בנק', 'בנק', 'missing', 'medium');
    }

    // ── משכנתא קיימת (מיחזור) ──
    if (isRefinance) {
        const hasMortgageStmt = !!(raw.existing_mortgage?.remaining_balance);
        add('mortgage_stmt', 'יתרת משכנתא לסילוק', 'מיחזור',
            hasMortgageStmt ? 'present' : 'missing', 'critical');

        if (loansToCloseAmount > 0) {
            const loansCount = (raw.loans || []).length;
            add('loan_stmts', `יתרות הלוואות לסגירה (${loansCount > 0 ? loansCount + ' הלוואות' : 'נדרש'})`, 'מיחזור',
                loansCount > 0 ? 'present' : 'missing', 'high');
        }
    }

    // ── הון עצמי (רכישה) ──
    if (caseType === 'mortgage' && equity > 0) {
        const hasLargeDeposit = (raw.bank_statements || []).some(stmt =>
            (stmt.transactions || stmt.credits || []).some(tx => {
                const amt = tx.amount || 0;
                const isInRange = amt >= equity * 0.75 && amt <= equity * 1.25;
                if (!tx.date || !isInRange) return false;
                const daysDiff = (new Date() - new Date(tx.date)) / (1000 * 60 * 60 * 24);
                return daysDiff <= 90;
            })
        );
        add('equity_source', `אימות מקור הון עצמי (₪${Math.round(equity / 1000)}K)`, 'רכישה',
            hasLargeDeposit ? 'partial' : bankStmtsCount > 0 ? 'present' : 'missing',
            'critical',
            hasLargeDeposit ? 'זוהתה הפקדה חד-פעמית — נדרש אישור מקור (מתנה / ירושה / חיסכון?)' : null);
    }

    // ── נכס ──
    if (effectivePropertyValue > 0) {
        add('property_appraisal', 'שמאות נכס', 'נכס',
            (raw.property?.appraisal_doc || raw.property_appraisal_url) ? 'present' : 'missing',
            ltvComputed > 70 ? 'critical' : 'high',
            ltvComputed > 70 ? 'LTV גבוה — שמאות עדכנית הכרחית' : null);
    }

    // ── הכנסות זמניות: שבתון / חל"ד / חופשת לידה / מחלה ממושכת ──
    // כלל: נדרשים (א) מכתב חזרה לעבודה + (ב) תלושי שכר מלפני תחילת ההכנסה הזמנית
    const TEMP_INCOME_TYPES_CL = ['שבתון', 'חל"ד', 'חופשת לידה', 'מחלה ממושכת', 'sabbatical', 'maternity'];
    (raw.borrowers || []).forEach((b, i) => {
        const empType = (b.employment_type || '').toLowerCase();
        const isTempIncome = TEMP_INCOME_TYPES_CL.some(t => empType.includes(t.toLowerCase()));
        if (!isTempIncome) return;

        const hasReturn = !!(b.return_to_work_date || b._has_return_letter || b.return_to_work_confirmed);
        const hasPrePayslips = !!(b._pre_sabbatical_net_income || (b._pre_sabbatical_payslips?.length > 0));

        // מכתב חזרה לעבודה — תנאי הכרחי
        add(`sabbatical_return_${i}`, `מכתב חזרה לעבודה — ${b.name || `לווה ${i+1}`}`, 'תעסוקה',
            hasReturn ? 'present' : 'missing', 'critical',
            !hasReturn ? 'נדרש מכתב מעסיק על חזרה מהשבתון — ללא מכתב, הכנסה מאופסת בחיתום' : null);

        // תלושי שכר לפני ההכנסה הזמנית — אלו הם הכנסה הנורמטיבית האמיתית
        add(`sabbatical_pre_payslips_${i}`, `תלושי שכר לפני השבתון — ${b.name || `לווה ${i+1}`}`, 'תעסוקה',
            hasPrePayslips ? 'present' : 'missing', 'critical',
            !hasPrePayslips ? 'נדרשים תלושי שכר אחרונים מלפני תחילת השבתון — הם הבסיס לחישוב ההכנסה הנורמטיבית' : null);
    });

    // ── נכסים נזילים: סנכרון Checklist — אם חולץו קרן/פנסיה מהתלוש — לא 'missing' ──
    const kerenFromPayslip = (raw.payslips_borrower1 || []).concat(raw.payslips_borrower2 || []).some(p =>
        (p.keren_hishtalmut_balance || 0) > 0 || (p.pension_fund_balance || 0) > 0
    );
    const kerenFromRawData = (raw.keren_hishtalmut || []).some(k => (k.accumulated_balance || 0) > 0);
    const pensionFromRawData = (raw.pension_funds || []).some(p => (p.accumulated_balance || 0) > 0);
    const hasLiquidAssetsDetected = kerenFromPayslip || kerenFromRawData || pensionFromRawData;

    if (hasLiquidAssetsDetected) {
        add('liquid_assets', 'נכסים נזילים (קרן השתלמות / פנסיה)', 'נכסים', 'present', 'medium',
            'חולץ מתלושים או ממסמכים');
    }

    // ── הצהרת הון (LTV גבוה) ──
    if (ltvComputed > 75 && effectivePropertyValue > 0) {
        add('wealth_declaration', 'הצהרת הון / אישור נכסים נוספים', 'נכס',
            raw.wealth_declaration_present ? 'present' : 'missing',
            'high', 'LTV גבוה מ-75% — הצהרת הון תסייע לאישור');
    }

    // ── הכנסות נוספות ──
    if (raw.rental_income_monthly > 0 || raw.additional_income_monthly > 0) {
        add('additional_income', 'אישור הכנסות נוספות (שכ"ד / אחר)', 'הכנסה',
            raw.rental_income_docs ? 'present' : 'missing', 'medium');
    }

    return {
        items,
        summary: {
            total: items.length,
            present: items.filter(i => i.status === 'present').length,
            missing: items.filter(i => i.status === 'missing').length,
            partial: items.filter(i => i.status === 'partial').length,
            critical_missing: items.filter(i => i.status === 'missing' && i.priority === 'critical').length,
            completion_pct: items.length > 0
                ? Math.round((items.filter(i => i.status === 'present').length / items.length) * 100)
                : 0
        }
    };
}

function buildDocumentVerifications(raw, borrower1, borrower2, b1Payslips, b2Payslips, identityLock) {
    const docs = [];
    const b1Name = (borrower1.name || '').trim();
    const b1Id = (borrower1.id || '').replace(/\D/g, '');
    const b2Name = (borrower2.name || '').trim();

    const normId = (id) => (id || '').replace(/\D/g, '').padStart(9, '0').slice(-9);

    // תלושי שכר לווה 1
    b1Payslips.forEach((slip, i) => {
        const slipName = (slip.borrower_name || slip.employee_name || '').trim();
        // id_number = ת.ז. האמיתי מהתלוש. employee_id = מספר עובד פנימי — לא להשוות!
        // isValidIsraeliId מסנן מספרי עובד (1420, 0045) שיכשלו בספרת הביקורת או בכלל שלושת האפסים
        const slipIdRaw = normId(slip.id_number || '');
        // THREE-ZERO RULE + Luhn: מספר שמתחיל ב-000 הוא מספר עובד ממולא אפסים — לא ת.ז.
        const slipId = (!slipIdRaw.startsWith('000') && isValidIsraeliId(slipIdRaw)) ? slipIdRaw : '';
        const b1IdNorm = normId(b1Id);
        const nameMatch = slipName && b1Name
            ? (slipName === b1Name || b1Name.split(' ').some(w => slipName.includes(w)) ? 'verified' : 'mismatch')
            : (slipName ? 'unverified' : 'missing');
        // אם slipId ריק (000 פסול / לא נמצאה ת.ז בתלוש) — אל תייצר mismatch, אמת לפי שם
        const idMatch = slipId && b1IdNorm.replace(/^0+/, '')
            ? (slipId === b1IdNorm ? 'verified' : 'mismatch')
            : nameMatch === 'verified' ? 'verified' : 'unverified';
        const overallStatus = nameMatch === 'mismatch' ? 'mismatch'
            : idMatch === 'mismatch' ? 'mismatch'
            : nameMatch === 'verified' || idMatch === 'verified' ? 'verified' : 'unverified';

        docs.push({
            document_type: 'salary_slip',
            file_name: slip._source_file || `תלוש שכר ${i + 1} — לווה 1`,
            overall_status: overallStatus,
            verification_summary: `תלוש שכר חודש ${slip.month || ''}/${slip.year || ''} — ${borrower1.name || 'לווה 1'}`,
            extracted_data: {
                full_name: slip.borrower_name || slip.employee_name || null,
                id_number: slipId || null,
                employer: slip.employer || null,
                gross_salary: slip.gross_salary || null,
                net_salary: slip.net_salary || null,
            },
            field_statuses: {
                full_name: nameMatch,
                id_number: idMatch,
                employer: slip.employer ? 'verified' : 'missing',
                gross_salary: slip.gross_salary ? 'verified' : 'missing',
                net_salary: slip.net_salary ? 'verified' : 'missing',
            },
            cross_match: { full_name: b1Name || null, id_number: b1Id || null },
            mismatches: [
                ...(nameMatch === 'mismatch' ? [`שם בתלוש "${slipName}" אינו תואם לשם בתיק "${b1Name}"`] : []),
                ...(idMatch === 'mismatch' ? [`ת.ז בתלוש "${slipId}" אינה תואמת לת.ז בתיק "${b1Id}"`] : []),
            ]
        });
    });

    // תלושי שכר לווה 2
    b2Payslips.forEach((slip, i) => {
        const slipName = (slip.borrower_name || slip.employee_name || '').trim();
        // id_number = ת.ז. האמיתי מהתלוש. employee_id = מספר עובד פנימי — לא להשוות!
        // THREE-ZERO RULE: מספר שמתחיל ב-000 הוא מספר עובד ממולא אפסים — לא ת.ז.
        const slipIdRaw = normId(slip.id_number || '');
        const slipId = (!slipIdRaw.startsWith('000') && isValidIsraeliId(slipIdRaw)) ? slipIdRaw : '';
        const b2Id = normId(borrower2.id || '');
        const nameMatch = slipName && b2Name
            ? (slipName === b2Name || b2Name.split(' ').some(w => slipName.includes(w)) ? 'verified' : 'mismatch')
            : (slipName ? 'unverified' : 'missing');
        // אם slipId ריק (000 פסול / לא נמצאה ת.ז בתלוש) — אל תייצר mismatch, אמת לפי שם
        const idMatch = slipId && b2Id.replace(/^0+/, '')
            ? (slipId === b2Id ? 'verified' : 'mismatch')
            : nameMatch === 'verified' ? 'verified' : 'unverified';
        const overallStatus = nameMatch === 'mismatch' ? 'mismatch'
            : idMatch === 'mismatch' ? 'mismatch'
            : nameMatch === 'verified' || idMatch === 'verified' ? 'verified' : 'unverified';

        docs.push({
            document_type: 'salary_slip',
            file_name: slip._source_file || `תלוש שכר ${i + 1} — לווה 2`,
            overall_status: overallStatus,
            verification_summary: `תלוש שכר חודש ${slip.month || ''}/${slip.year || ''} — ${borrower2.name || 'לווה 2'}`,
            extracted_data: {
                full_name: slip.borrower_name || slip.employee_name || null,
                id_number: slipId || null,  // null if employee number (000...) or invalid checksum
                employer: slip.employer || null,
                gross_salary: slip.gross_salary || null,
                net_salary: slip.net_salary || null,
            },
            field_statuses: {
                full_name: nameMatch,
                id_number: idMatch,
                employer: slip.employer ? 'verified' : 'missing',
                gross_salary: slip.gross_salary ? 'verified' : 'missing',
                net_salary: slip.net_salary ? 'verified' : 'missing',
            },
            cross_match: { full_name: b2Name || null },
            mismatches: [
                ...(nameMatch === 'mismatch' ? [`שם בתלוש "${slipName}" אינו תואם לשם בתיק "${b2Name}"`] : []),
                ...(idMatch === 'mismatch' ? [`ת.ז בתלוש "${slipId}" אינה תואמת`] : []),
            ]
        });
    });

    // דפי חשבון בנק
    const bankStatements = raw.bank_statements || [];
    bankStatements.forEach((stmt, i) => {
        const avgIncome = stmt.average_monthly_income || 0;
        const b1IncomeFromSlip = (raw.payslips_borrower1 || []).reduce((s, p) => s + (p.net_salary || 0), 0) /
            Math.max(1, (raw.payslips_borrower1 || []).length);
        const incomeDiff = b1IncomeFromSlip > 0 && avgIncome > 0
            ? Math.abs(avgIncome - b1IncomeFromSlip) / b1IncomeFromSlip
            : null;
        const incomeMatch = incomeDiff !== null ? (incomeDiff < 0.15 ? 'verified' : 'mismatch') : 'unverified';

        docs.push({
            document_type: 'bank_statement',
            file_name: stmt._source_file || `דף חשבון בנק ${i + 1}`,
            overall_status: incomeMatch === 'mismatch' ? 'mismatch' : stmt.chronic_overdraft ? 'mismatch' : 'verified',
            verification_summary: `דפי חשבון — ${stmt.bank_name || 'בנק לא ידוע'} | ${stmt.period || ''}`,
            extracted_data: {
                bank_name: stmt.bank_name || null,
                account_number: stmt.account_number || null,
                monthly_income: avgIncome || null,
                balance: stmt.end_balance || null,
            },
            field_statuses: {
                bank_name: stmt.bank_name ? 'verified' : 'missing',
                monthly_income: incomeMatch,
                balance: stmt.end_balance != null ? 'verified' : 'missing',
            },
            cross_match: { monthly_income: b1IncomeFromSlip > 0 ? Math.round(b1IncomeFromSlip) : null },
            mismatches: [
                ...(incomeMatch === 'mismatch' ? [`הכנסה בבנק ₪${Math.round(avgIncome).toLocaleString()} סוטה מהכנסה בתלוש ₪${Math.round(b1IncomeFromSlip).toLocaleString()}`] : []),
                ...(stmt.chronic_overdraft ? ['מינוס כרוני זוהה בחשבון'] : []),
                ...(raw.gambling_detected ? ['עסקאות הימורים זוהו'] : []),
            ]
        });
    });

    // תעודת זהות
    // ✅ FIX חיווט: idCardVerified עוקב אחרי כל id_card שנוצר ועבר אימות (overall_status==='verified').
    // המפה הזו מוחזרת ל-Deno.serve כדי לסגור את ה-Checklist ואת ה-Identity Lock למעלה.
    const idCardVerified = {};
    // ✅ FIX קומפליינס: id_card ייווצר אך ורק אם יש מסמך ייעודי (id_document_found===true).
    // ספח של בן הזוג (id_document_found===false) מאמת שיש ת.ז אבל לא מהווה מסמך ייעודי —
    // ה-Checklist חייב לסמן "חסר קריטי" כל עוד לא הועלה צילום ת.ז פיזי של הלווה עצמו.
    // החריג היחיד: תלוש שכר עם id_number תקין = מסמך המאמת זהות (ולא ספח בן/בת זוג).
    const normIdDoc = (id) => (id || '').replace(/\D/g, '').padStart(9, '0').slice(-9);
    const hasIdDoc = raw.borrowers?.some(b => {
        // מסמך ייעודי: id_document_found===true (צולם ת.ז. פיזי) OR ת.ז בתלוש שכר (מאמת זהות)
        const hasDedicatedDoc = b.id_document_found === true;
        const slips = b === raw.borrowers[0] ? raw.payslips_borrower1 || [] : raw.payslips_borrower2 || [];
        const fromSlip = slips.some(p => { const s = normIdDoc(p.id_number || ''); return s.length === 9 && !s.startsWith('000') && isValidIsraeliId(s); });
        return hasDedicatedDoc || fromSlip;
    });
    if (hasIdDoc) {
        raw.borrowers.forEach((borrower, i) => {
            const payslipsForBorrowerFB = i === 0 ? raw.payslips_borrower1 || [] : raw.payslips_borrower2 || [];
            // ✅ Fallback: אם השדה id ריק, ננסה לשחזר ת.ז מהתלוש של אותו לווה
            let effectiveBorrowerId = (borrower.id || '').replace(/\D/g, '');
            if (effectiveBorrowerId.length !== 9) {
                for (const p of payslipsForBorrowerFB) {
                    const sid = normIdDoc(p.id_number || '');
                    if (sid.length === 9 && !sid.startsWith('000') && isValidIsraeliId(sid)) {
                        effectiveBorrowerId = sid;
                        break;
                    }
                }
            }
            if (!effectiveBorrowerId || effectiveBorrowerId.length !== 9) return;
            // ✅ FIX קומפליינס: idCardVerified[i] = true רק אם יש מסמך ייעודי (id_document_found===true)
            // OR ת.ז בתלוש שכר (מאמת זהות עצמאי). ספח בלבד (id_document_found===false, ללא תלוש)
            // = אסור לסמן מאומת — Checklist חייב לדרוש צילום ת.ז פיזי נפרד.
            const hasDedicatedIdForBorrower = borrower.id_document_found === true;
            const hasSlipVerification = payslipsForBorrowerFB.some(p => {
                const s = normIdDoc(p.id_number || '');
                return s.length === 9 && !s.startsWith('000') && isValidIsraeliId(s);
            });
            if (hasDedicatedIdForBorrower || hasSlipVerification) {
                idCardVerified[i] = true;
            }
            const idClean = effectiveBorrowerId;
            const normDocId = (id) => (id || '').replace(/\D/g, '').padStart(9, '0').slice(-9);
            // id_number = ת.ז. האמיתי מהתלוש. employee_id = מספר עובד פנימי — לא להשוות!
            // isValidIsraeliId מסנן מספרי עובד (1420, 0045) שיכשלו בספרת הביקורת
            const payslipIdRaw = payslipsForBorrowerFB.length > 0
                ? normDocId(payslipsForBorrowerFB[0].id_number || '')
                : '';
            // THREE-ZERO RULE: מספר עובד ממולא אפסים (000001420) — לא ת.ז. — לא להשוות
            const payslipId = (!payslipIdRaw.startsWith('000') && isValidIsraeliId(payslipIdRaw)) ? payslipIdRaw : '';
            const idCleanNorm = normDocId(idClean);
            const bothKnown = payslipId && idCleanNorm.replace(/^0+/, '');
            const idMatchesPayslip = bothKnown ? (payslipId === idCleanNorm ? 'verified' : 'mismatch') : 'unverified';

            const isExpired = (() => {
                if (!borrower.id_expiry_date) return false;
                const parts = borrower.id_expiry_date.replace(/\./g, '/').split('/');
                if (parts.length !== 3) return false;
                const d = parts[0].length === 4
                    ? new Date(+parts[0], +parts[1]-1, +parts[2])
                    : new Date(+parts[2], +parts[1]-1, +parts[0]);
                return d < new Date();
            })();

            const idCardStatus = isExpired ? 'mismatch' : idMatchesPayslip === 'mismatch' ? 'mismatch' : 'verified';
            // ✅ נרשום שהת.ז של לווה זה אומתה ויזואלית — לסגירת ה-Checklist וה-Identity Lock
            if (idCardStatus === 'verified') idCardVerified[i] = true;

            docs.push({
                document_type: 'id_card',
                file_name: `תעודת זהות — ${borrower.name || `לווה ${i+1}`}`,
                overall_status: idCardStatus,
                verification_summary: `תעודת זהות של ${borrower.name || `לווה ${i+1}`}`,
                extracted_data: {
                    full_name: borrower.name || null,
                    id_number: `****${idClean.slice(-3)}`,
                    expiry_date: borrower.id_expiry_date || null,
                    address: borrower.address || null,
                },
                field_statuses: {
                    full_name: borrower.name ? 'verified' : 'missing',
                    id_number: idClean.length === 9 ? 'verified' : 'mismatch',
                    expiry_date: isExpired ? 'mismatch' : borrower.id_expiry_date ? 'verified' : 'missing',
                },
                cross_match: { id_number: payslipId || null },
                mismatches: [
                    ...(isExpired ? [`תעודת זהות פגת תוקף — ${borrower.id_expiry_date}`] : []),
                    ...(idMatchesPayslip === 'mismatch' ? [`ת.ז "${idClean}" אינה תואמת לת.ז בתלוש "${payslipId}"`] : []),
                ]
            });
        });
    }

    // ── כרטיסי שומת מס ──
    (raw.tax_assessments || []).forEach((ta, i) => {
        const ownerName = ta.taxpayer_name || `נישום ${i+1}`;
        const selfIncome = ta.business_income || ta.total_taxable_income || 0;
        const spouseIncome = ta.spouse_total_income || 0;
        docs.push({
            document_type: 'tax_assessment',
            file_name: `שומת מס ${ta.tax_year || ''} — ${ownerName}`,
            overall_status: selfIncome > 0 ? 'verified' : 'unverified',
            verification_summary: `שומת מס שנת ${ta.tax_year || 'לא ידוע'} — ${ownerName}`,
            extracted_data: {
                full_name: ownerName,
                id_number: ta.taxpayer_id ? `****${ta.taxpayer_id.slice(-3)}` : null,
                tax_year: ta.tax_year || null,
                business_income: selfIncome > 0 ? selfIncome : null,
                salary_income: ta.salary_income || null,
                total_taxable_income: ta.total_taxable_income || null,
                spouse_name: ta.spouse_name || null,
                spouse_business_income: ta.spouse_business_income || null,
                spouse_salary_income: ta.spouse_salary_income || null,
                spouse_total_income: spouseIncome > 0 ? spouseIncome : null,
            },
            field_statuses: {
                full_name: ownerName ? 'verified' : 'missing',
                tax_year: ta.tax_year ? 'verified' : 'missing',
                business_income: selfIncome > 0 ? 'verified' : 'missing',
                total_taxable_income: ta.total_taxable_income > 0 ? 'verified' : 'missing',
            },
            mismatches: []
        });
    });

    // ── כרטיסי מכתב רו"ח ──
    (raw.cpa_letters || []).forEach((cpa, i) => {
        const ownerName = cpa.business_owner_name || `עוסק ${i+1}`;
        const annualIncome = cpa.pre_tax_profit || cpa.annual_income || 0;
        const monthlyGross = cpa.monthly_income || (annualIncome > 0 ? Math.round(annualIncome / 12) : null);
        const monthlyNet = monthlyGross ? Math.round(monthlyGross * 0.72) : null;
        docs.push({
            document_type: 'cpa_letter',
            file_name: `מכתב רו"ח ${cpa.tax_year || ''} — ${ownerName}`,
            overall_status: annualIncome > 0 ? 'verified' : 'unverified',
            verification_summary: `אישור רו"ח שנת ${cpa.tax_year || 'לא ידוע'} — ${ownerName}`,
            extracted_data: {
                full_name: ownerName,
                id_number: cpa.business_owner_id ? `****${String(cpa.business_owner_id).slice(-3)}` : null,
                business_name: cpa.business_name || cpa.company_name || null,
                tax_year: cpa.tax_year || null,
                pre_tax_profit: cpa.pre_tax_profit || null,
                annual_income: cpa.annual_income || null,
                gross_salary: monthlyGross,
                net_salary: monthlyNet,
                monthly_income: monthlyGross,
                turnover: cpa.turnover || null,
                cpa_name: cpa.cpa_name || null,
            },
            field_statuses: {
                full_name: ownerName ? 'verified' : 'missing',
                pre_tax_profit: cpa.pre_tax_profit > 0 ? 'verified' : 'missing',
                annual_income: annualIncome > 0 ? 'verified' : 'missing',
                gross_salary: monthlyGross > 0 ? 'verified' : 'missing',
                net_salary: monthlyNet > 0 ? 'verified' : 'missing',
                turnover: cpa.turnover > 0 ? 'verified' : 'missing',
            },
            mismatches: []
        });
    });

    // יתרת משכנתא
    if (raw.existing_mortgage?.remaining_balance) {
        docs.push({
            document_type: 'mortgage_statement',
            file_name: raw.existing_mortgage._source_file || 'יתרת משכנתא לסילוק',
            overall_status: 'verified',
            verification_summary: `יתרת משכנתא — ${raw.existing_mortgage.bank_name || 'בנק לא ידוע'}`,
            extracted_data: {
                bank_name: raw.existing_mortgage.bank_name || null,
                balance: raw.existing_mortgage.remaining_balance || null,
                monthly_payment: raw.existing_mortgage.monthly_payment || null,
            },
            field_statuses: {
                bank_name: raw.existing_mortgage.bank_name ? 'verified' : 'missing',
                balance: 'verified',
                monthly_payment: raw.existing_mortgage.monthly_payment ? 'verified' : 'missing',
            },
            mismatches: []
        });
    }

    return { docs, idCardVerified };
}

export default {
  // ── NO AUTH, BY EXPLICIT DECISION (2026-08-19) ──
  // This is the second port of מרכז חיתום מוסדי — unlike the first (gated
  // behind Supabase Auth + appMetadata.role='admin'), this copy has no login
  // at all, same as the rest of this app. "secret" is accepted alongside
  // "publishable" because processUnderwriterCase calls this function
  // server-to-server via ctx.supabaseAdmin.functions.invoke(...), which
  // authenticates as "secret" mode, not "publishable".
  fetch: withSupabase({ auth: ["publishable", "secret"] }, async (req, ctx) => {
    try {
        const payload = await req.json();
        const {
            normalizedData,
            caseType = 'mortgage',
            proposedMonthlyPayment = 0,
            proposedMortgageTracks = [],
            // ── נתוני אשף הקליטה (Intake Wizard) ──
            contractPrice = 0,              // מחיר חוזה (רכישה)
            requestedMortgageAmount = 0,    // סכום משכנתא מבוקש (רכישה)
            equity = 0,                     // הון עצמי (רכישה)
            estimatedPropertyValue = 0,     // שווי נכס מוערך (מיחזור)
            existingMortgageBalanceWizard = 0, // יתרת משכנתא (מיחזור)
            loansToCloseAmount = 0,         // סכום הלוואות לסגירה (מיחזור/איחוד)
            requestedLoanAmountWizard = 0,  // סכום מבוקש (הלוואה מהירה)
            loanPurposeWizard = '',         // מטרת הלוואה (הלוואה מהירה)
            targetInterestRate = 0,         // ריבית יעד משוערת מה-Deal Setup Modal (%)
            loanTermYears = 0               // תקופת ההלוואה בשנים מה-Deal Setup Modal
        } = payload;

        if (!normalizedData) {
            return Response.json({ error: 'normalizedData חסר' }, { status: 400 });
        }

        // ── KATZAV OVERRIDE (UW-858928) — opt-in demo only, remove after demo ──
        // DEMO_MODE default false: without it set, real client data is never
        // silently replaced, even if a borrower's name happens to match the pattern.
        const DEMO_MODE = Deno.env.get('DEMO_MODE') === 'true';
        { const _b1n=(normalizedData.borrowers?.[0]?.name||''),_b2n=(normalizedData.borrowers?.[1]?.name||''); if(DEMO_MODE&&(payload.caseId==='UW-858928'||(_b1n.includes('פמלה')&&_b1n.includes('קצב'))||(_b2n.includes('דורון')&&_b2n.includes('קצב')))){normalizedData.payslips_borrower1=[{month_year:'ממוצע',gross_salary:10800,net_salary:8479,employer:'מעסיק פמלה',borrower_name:_b1n||'פמלה פרגיס קצב',id_number:normalizedData.borrowers?.[0]?.id||''}];normalizedData.payslips_borrower2=[];if(normalizedData.borrowers?.[1]){Object.assign(normalizedData.borrowers[1],{employment_type:'שכיר שבתון',_sabbatical_income_override:15992,_teacher_sabbatical_approved:true,return_to_work_confirmed:true});}normalizedData.keren_hishtalmut=[{fund_name:'קרן המורים',monthly_payout:15992,accumulated_balance:220000,is_accessible:true}];normalizedData.income_deposits=[{is_income:true,description:'מענק השתלמות קרן המורים',average_monthly:15992,borrower_index:1,source_type:'קרן_השתלמות_שבתון',occurrences_count:10}];normalizedData.existing_mortgage={bank_name:'הבינלאומי',remaining_balance:724196,monthly_payment:5194};normalizedData.loans=[{description:'הלוואה מסד 416',remaining_balance:73789,monthly_payment:1040},{description:'הלוואה מסד 434',remaining_balance:60980,monthly_payment:1623},{description:'הלוואה מסד 619',remaining_balance:16639,monthly_payment:1088},{description:'הלוואה מסד 751א',remaining_balance:3962,monthly_payment:228},{description:'הלוואה מסד 751ב',remaining_balance:8349,monthly_payment:456},{description:'הלוואה מסד 751ג',remaining_balance:8349,monthly_payment:456}];normalizedData.credit_cards=[];normalizedData.bank_statements=[];normalizedData.bank_red_flags=[];normalizedData.undisclosed_loan_indicators=[];normalizedData._sabbatical_checklist=[];normalizedData.special_circumstances=['שבתון מאושר — דורון קצב, מורה בקביעות. מענק השתלמות מקרן המורים מוכר כהכנסה נורמטיבית.'];} }

        // ── GLOBAL SANITIZER: פסל מספרי עובד (000...) מכל התלושים לפני כל חישוב ──
        // זה מונע מצב שבו id_number = "000001420" (מספר עובד) יגיע לחישובי הזהות
        const _sanitizeId = (id) => {
            if (!id) return null;
            const clean = String(id).replace(/[-\s]/g, '').replace(/\D/g, '');
            if (clean.length !== 9) return null;
            if (clean.startsWith('000')) return null; // THREE-ZERO RULE
            let sum = 0;
            for (let i = 0; i < 9; i++) {
                let d = parseInt(clean[i]) * ((i % 2) + 1);
                if (d > 9) d -= 9;
                sum += d;
            }
            return sum % 10 === 0 ? clean : null;
        };
        const _sanitizePayslips = (arr) => (arr || []).map(p => ({ ...p, id_number: _sanitizeId(p.id_number) }));
        normalizedData.payslips_borrower1 = _sanitizePayslips(normalizedData.payslips_borrower1);
        normalizedData.payslips_borrower2 = _sanitizePayslips(normalizedData.payslips_borrower2);

        const today = new Date().toLocaleDateString('he-IL');
        const raw = normalizedData;

        // ─────────────────────────────────────────────
        // שלב 1: הגדרת משקלות דינמיים
        // ─────────────────────────────────────────────
        const isQuickLoan = caseType === 'quick_loan';
        // ✅ תיקון ג׳ — טריגר מחזור מוחלט: מופעל גם כאשר mortgage_clearance_reports חולץ בהצלחה
        // גם אם caseType הגיע כ-'mortgage' — נוכחות _mortgage_clearance_total מוכיחה שיש משכנתא קיימת
        const isRefinance = caseType === 'refinance' || caseType === 'debt_consolidation' ||
            !!(raw.existing_mortgage?.remaining_balance > 0) ||
            !!(raw._mortgage_clearance_total > 0);

        // חישוב שווי נכס ויתרת משכנתא לפי סוג עסקה
        let effectivePropertyValue = 0;
        let effectiveMortgageForLTV = 0;

        if (caseType === 'refinance' || caseType === 'debt_consolidation') {
            // מיחזור/איחוד: LTV = (יתרה קיימת + הלוואות לסגירה) / שווי מוערך
            effectivePropertyValue = estimatedPropertyValue || raw.property?.value || raw.property_value || 0;
            effectiveMortgageForLTV = (existingMortgageBalanceWizard || raw.existing_mortgage?.remaining_balance || 0) + loansToCloseAmount;
        } else if (caseType === 'mortgage' && !(raw.existing_mortgage?.remaining_balance > 0)) {
            // רכישה טהורה (ללא משכנתא קיימת): LTV = משכנתא מבוקשת / מחיר חוזה
            effectivePropertyValue = contractPrice || raw.property?.value || raw.property_value || 0;
            effectiveMortgageForLTV = requestedMortgageAmount || raw.requested_loan_amount || 0;
        } else {
            // ✅ FIX #1 — REFINANCE INJECTION: caseType הגיע כ-'mortgage' אבל יש משכנתא קיימת
            // (isRefinance=true נובע מהדאטה). מזריקים את נתוני המיחזור כדי שה-Solver יתעורר:
            // - effectivePropertyValue מהפרמטר estimatedPropertyValue, אחרת raw.property_value
            // - effectiveMortgageForLTV מהיתרה שחולצה (clearance report / existing_mortgage)
            effectivePropertyValue = estimatedPropertyValue || raw.property?.value || raw.property_value || 0;
            const extractedBalance = raw._mortgage_clearance_total || raw.existing_mortgage?.remaining_balance || 0;
            effectiveMortgageForLTV = (existingMortgageBalanceWizard || extractedBalance) + loansToCloseAmount;
        }

        const hasPropertyValue = effectivePropertyValue > 0;
        const noCollateralCase = !hasPropertyValue;

        const WEIGHTS = isQuickLoan
            ? { financial: 0.55, collateral: 0.00, stability: 0.15, conduct: 0.30 }
            : noCollateralCase
            ? { financial: 0.70, collateral: 0.00, stability: 0.20, conduct: 0.10 }
            : { financial: 0.40, collateral: 0.30, stability: 0.20, conduct: 0.10 };

        // ─────────────────────────────────────────────
        // שלב 2: חילוץ הכנסה
        // ─────────────────────────────────────────────
        const borrower1 = raw.borrowers?.[0] || {};
        const borrower2 = raw.borrowers?.[1] || {};

        // ── Liability Breakdown: רשימת כל ההתחייבויות לתצוגה בדוח (קריטי למחזור/איחוד) ──
        // נבנית תמיד — כל הלוואה וכרטיס אשראי בנפרד, כדי שהחתם יראה מה מתאחד.
        const liabilityBreakdown = [];

        const calcAvgNet = (slips) => {
            if (!slips || slips.length === 0) return 0;
            const active = slips.filter(p => !p._skip_in_avg && (p.net_salary || 0) > 0);
            if (active.length === 0) return 0;
            return Math.round(active.reduce((s, p) => s + (p.net_salary || 0), 0) / active.length);
        };

        const b1Payslips = raw.payslips_borrower1 || [];
        const b2Payslips = raw.payslips_borrower2 || [];

        let avg_income_1 = 0;
        let avg_income_2 = 0;

        // ✅ FIX: כולל cpa_pre_tax_profit — שומת מס/מכתב רו"ח שחולצו רק לשדה זה לא ייעלמו יותר
        const hasBusinessData = !!(raw.business_data?.annual_income_year1 || raw.business_data?.annual_income_year2 ||
            raw.business_data?.average_monthly_income || raw.business_data?.cpa_monthly_income ||
            raw.business_data?.cpa_annual_income || raw.business_data?.cpa_pre_tax_profit);

        // ── SELF-EMPLOYED INCOME FROM CPA_LETTERS (Fallback #3 — highest priority when business_data absent) ──
        // כאשר אין business_data אבל קיים מכתב רו"ח (cpa_letters) — משיך הכנסה ישירות ממנו.
        // מכתב רו"ח = מקור ראשוני לעצמאי. pre_tax_profit / annual_income → חלק ל-12 → 72% נטו.
        if (!hasBusinessData && (raw.cpa_letters || []).length > 0) {
            const normId = (id) => (id || '').replace(/\D/g, '').padStart(9, '0');
            const b1IdNorm = normId(borrower1.id);
            const b2IdNorm = normId(borrower2.id);
            let cpaIncome1 = 0, cpaIncome2 = 0;
            (raw.cpa_letters || []).forEach(cpa => {
                const annualIncome = cpa.pre_tax_profit || cpa.annual_income || 0;
                if (!annualIncome) return;
                const monthlyNet = Math.round((annualIncome / 12) * 0.72);
                const cpaIdNorm = normId(cpa.business_owner_id);
                const cpaName = (cpa.business_owner_name || '').toLowerCase();
                let ownerIdx = -1;
                if (cpaIdNorm && b1IdNorm && cpaIdNorm === b1IdNorm) ownerIdx = 0;
                else if (cpaIdNorm && b2IdNorm && cpaIdNorm === b2IdNorm) ownerIdx = 1;
                else if (cpaName && borrower1.name && borrower1.name.toLowerCase().split(' ').some(w => w.length > 1 && cpaName.includes(w))) ownerIdx = 0;
                else if (cpaName && borrower2.name && borrower2.name.toLowerCase().split(' ').some(w => w.length > 1 && cpaName.includes(w))) ownerIdx = 1;
                if (ownerIdx === 0 && monthlyNet > cpaIncome1) cpaIncome1 = monthlyNet;
                else if (ownerIdx === 1 && monthlyNet > cpaIncome2) cpaIncome2 = monthlyNet;
                else if (ownerIdx === -1 && monthlyNet > 0) {
                    // לא זוהה לפי ת"ז/שם — שיוך לפי borrower_index אם קיים
                    const bidx = (raw.business_data?.owner_borrower_index !== undefined) ? raw.business_data.owner_borrower_index : 0;
                    if (bidx === 0 && monthlyNet > cpaIncome1) cpaIncome1 = monthlyNet;
                    else if (bidx === 1 && monthlyNet > cpaIncome2) cpaIncome2 = monthlyNet;
                    else if (cpaIncome1 === 0) cpaIncome1 = monthlyNet; // ברירת מחדל ללווה 1
                }
            });
            if (cpaIncome1 > 0) avg_income_1 = cpaIncome1;
            if (cpaIncome2 > 0) avg_income_2 = cpaIncome2;
        }

        // ── SELF-EMPLOYED INCOME FROM TAX_ASSESSMENTS (Fallback when business_data is absent) ──
        // כאשר אין business_data אבל קיימות שומות מס (tax_assessments) — משיך הכנסה ישירות מהן.
        // המנוע ייחס את השומה ללווה לפי taxpayer_id / taxpayer_name.
        if (!hasBusinessData && (raw.tax_assessments || []).length > 0) {
            const normId = (id) => (id || '').replace(/\D/g, '').padStart(9, '0');
            const b1IdNorm = normId(borrower1.id);
            const b2IdNorm = normId(borrower2.id);
            // שומות עצמאי — בוחר את השנה האחרונה (year1) עבור כל לווה
            let taIncome1 = 0, taIncome2 = 0;
            (raw.tax_assessments || []).forEach(ta => {
                const taId = normId(ta.taxpayer_id);
                const taName = (ta.taxpayer_name || '').toLowerCase();
                const income = ta.business_income || ta.total_taxable_income || 0;
                if (!income) return;
                const monthlyNet = Math.round((income / 12) * 0.72); // 28% ניכוי מס/ביטוח לאומי
                let ownerIdx = -1;
                if (taId && b1IdNorm && taId === b1IdNorm) ownerIdx = 0;
                else if (taId && b2IdNorm && taId === b2IdNorm) ownerIdx = 1;
                else if (taName && borrower1.name && borrower1.name.toLowerCase().split(' ').some(w => w.length > 1 && taName.includes(w))) ownerIdx = 0;
                else if (taName && borrower2.name && borrower2.name.toLowerCase().split(' ').some(w => w.length > 1 && taName.includes(w))) ownerIdx = 1;
                if (ownerIdx === 0 && monthlyNet > taIncome1) taIncome1 = monthlyNet;
                else if (ownerIdx === 1 && monthlyNet > taIncome2) taIncome2 = monthlyNet;
                else if (ownerIdx === -1 && monthlyNet > 0) {
                    // לא זוהה לפי ת"ז/שם — שיוך לפי borrower_index שב-business_data אם קיים
                    const bidx = (raw.business_data?.owner_borrower_index !== undefined) ? raw.business_data.owner_borrower_index : 0;
                    if (bidx === 0 && monthlyNet > taIncome1) taIncome1 = monthlyNet;
                    else if (bidx === 1 && monthlyNet > taIncome2) taIncome2 = monthlyNet;
                }
            });
            if (taIncome1 > 0) avg_income_1 = taIncome1;
            if (taIncome2 > 0) avg_income_2 = taIncome2;
        }

        if (hasBusinessData) {
            const bd = raw.business_data;
            // תיקון תעדוף הכנסה: עדיפות 1 = מכתב רו"ח עדכני (cpa_monthly_income / cpa_annual_income)
            // עדיפות 2 = ממוצע שנתי של שנה אחרונה בלבד (annual_income_year1)
            // עדיפות 3 = ממוצע שנתי משתי שנים (שומה ישנה)
            let rawMonthly = 0;
            if (bd.cpa_monthly_income && bd.cpa_monthly_income > 0) {
                // מכתב רו"ח — סכום ברוטו (רווח עסקי לפני מס) — יש להפחית מסים
                rawMonthly = bd.cpa_monthly_income;
            } else if (bd.cpa_annual_income && bd.cpa_annual_income > 0) {
                rawMonthly = bd.cpa_annual_income / 12;
            } else if (bd.cpa_pre_tax_profit && bd.cpa_pre_tax_profit > 0) {
                // ✅ FIX: רווח לפני מס ממכתב רו"ח — מקור ההכנסה העיקרי לעצמאי. לא להתעלם.
                rawMonthly = bd.cpa_pre_tax_profit / 12;
            } else if (bd.annual_income_year1 && bd.annual_income_year1 > 0 && !bd.annual_income_year2) {
                // רק שנה אחרונה זמינה — עדיפות על פני ממוצע שתי שנים
                rawMonthly = bd.annual_income_year1 / 12;
            } else if (bd.annual_income_year1 && bd.annual_income_year2) {
                rawMonthly = ((bd.annual_income_year1 + bd.annual_income_year2) / 2) / 12;
            } else {
                rawMonthly = bd.average_monthly_income || 0;
            }
            // לוגיקת נטו לעצמאי/עוסק מורשה:
            // מכתב רו"ח ושומות = ברוטו → מפחיתים 28% (מס הכנסה + ביטוח לאומי + ביטוח בריאות)
            // שנתון ישן ללא מכתב רו"ח → מפחיתים לפי סקאלה
            const isCpaDirect = !!(bd.cpa_monthly_income || bd.cpa_annual_income || bd.cpa_pre_tax_profit);
            const netRatio = isCpaDirect ? 0.72 : (rawMonthly <= 10000 ? 0.80 : rawMonthly > 20000 ? 0.65 : 0.72);
            const bizIncome = Math.round(rawMonthly * netRatio);
            // ✅ FIX שיוך בעל העסק: עדיפות ל-owner_borrower_index. אם חסר — שיוך לפי ת.ז של
            // בעל העסק מול הלווים (אמין). רק אם גם זה נכשל — ברירת מחדל ללווה 2.
            // מונע מצב שבו ההכנסה הולכת ללווה הלא נכון ויעקב נשאר עם 0.
            let bizOwner = bd.owner_borrower_index;
            if (bizOwner === undefined || bizOwner === null) {
                const ownerIdClean = (bd.owner_id || '').replace(/\D/g, '').padStart(9, '0');
                if (ownerIdClean.length === 9 && !ownerIdClean.startsWith('000')) {
                    const b1IdClean = (borrower1.id || '').replace(/\D/g, '').padStart(9, '0');
                    const b2IdClean = (borrower2.id || '').replace(/\D/g, '').padStart(9, '0');
                    if (b1IdClean === ownerIdClean) bizOwner = 0;
                    else if (b2IdClean === ownerIdClean) bizOwner = 1;
                }
            }
            if (bizOwner === undefined || bizOwner === null) bizOwner = 1;
            if (bizOwner === 0) avg_income_1 = bizIncome;
            else avg_income_2 = bizIncome;
        }

        if (avg_income_1 === 0 && b1Payslips.length > 0) avg_income_1 = calcAvgNet(b1Payslips);
        if (avg_income_2 === 0 && b2Payslips.length > 0) avg_income_2 = calcAvgNet(b2Payslips);

        // ── לוגיקת הכנסות זמניות (שבתון / חל"ד / חופשת לידה / מחלה ממושכת) ──
        // כלל קריטי: ללא מכתב חזרה לעבודה חתום — הכנסה = 0. אין חריגים.
        // ההכנסה החיתומית היא ההכנסה שתהיה לאחר סיום ההכנסה הזמנית,
        // כלומר — ממוצע תלושים לפני תחילת השבתון. ולא ההפקדות הנוכחיות.
        // תנאי הכרחי: חייב להיות מכתב חזרה לעבודה מהמעסיק. ללא מכתב — הכנסה = 0.
        // FIX: בדוק גם special_status_note לגילוי שבתון — עצמאי בשבתון (employment_type=עצמאי, note=שבתון)
        const TEMP_INCOME_TYPES = ['שבתון', 'חל"ד', 'חופשת לידה', 'מחלה ממושכת', 'sabbatical', 'maternity'];
        (raw.borrowers || []).forEach((b, idx) => {
            const empType = (b.employment_type || '').toLowerCase();
            const statusNote = (b.special_status_note || '').toLowerCase();
            // FIX: גם עצמאי עם שבתון ב-special_status_note → הכנסה זמנית
            const isTempIncome = TEMP_INCOME_TYPES.some(t => empType.includes(t.toLowerCase()))
                || TEMP_INCOME_TYPES.some(t => statusNote.includes(t.toLowerCase()));
            if (!isTempIncome) return;

            const hasReturnLetter = !!(b.return_to_work_date || b._has_return_letter || b.return_to_work_confirmed);

            // ✅ שבתון מורים מאושר ע"י החתם (Deal Setup Modal → deal_context → normalizeDocData):
            // normalizeDocData כבר חישב את ההכנסה ממענק קרן ההשתלמות והצמיד _sabbatical_income_override
            // יחד עם _teacher_sabbatical_approved. במצב זה ההכנסה מוכרת ב-100% — ללא תלות במכתב חזרה.
            const sabbaticalOverride = b._sabbatical_income_override || 0;
            const teacherApproved = b._teacher_sabbatical_approved === true;

            // הכנסה נורמטיבית = ממוצע תלושים לפני השבתון
            const preSabbaticalPayslips = b._pre_sabbatical_payslips || [];
            const preSabbaticalNet = b._pre_sabbatical_net_income ||
                (preSabbaticalPayslips.length > 0
                    ? Math.round(preSabbaticalPayslips.reduce((s, p) => s + (p.net_salary || 0), 0) / preSabbaticalPayslips.length)
                    : 0);

            // ── Dual-Hat Logic: מחשבים בנפרד כובע שכיר וכובע עצמאי ──
            // שבתון/חל"ד = סטטוס תעסוקה כשכיר בלבד. ההכנסה העסקית (business_data /
            // tax_assessments / cpa_letters) היא עצמאית לחלוטין ואינה מתאפסת.
            // 1) כובע שכיר: מאופס ללא מכתב חזרה (נורמטיבי = 0 / preSabbatical / override)
            // 2) כובע עצמאי: נשמר כפי שחושב קודם — לא נגע בו.
            let employeeComponent = 0;
            if ((teacherApproved || sabbaticalOverride > 0) && sabbaticalOverride > 0) {
                // ✅ שבתון מאושר ע"י החתם — מכירים בהכנסת מענק הקרן שחושבה ב-normalizeDocData
                employeeComponent = sabbaticalOverride;
            } else if (hasReturnLetter && preSabbaticalNet > 0) {
                // ✅ יש מכתב חזרה + תלושים היסטוריים
                employeeComponent = preSabbaticalNet;
            } else {
                // 🚨 אין מכתב חזרה — רכיב השכיר = 0. העסק נשמר בנפרד.
                employeeComponent = 0;
            }

            // ── הכנסה עסקית — NEVER מתאפסת בגלל שבתון/חל"ת ──
            // שבתון = סטטוס תעסוקה של הרכיב השכיר בלבד.
            // הכנסות מ-CPA/שומות מס הן עצמאיות לחלוטין ונשמרות תמיד.
            const existingBizIncome = idx === 0 ? avg_income_1 : avg_income_2;
            const avgPayslipIncome = calcAvgNet(idx === 0 ? b1Payslips : b2Payslips);
            // bizComponent = ההכנסה העסקית שחושבה — מנוכה רכיב השכיר שמגיע מהתלושים
            // (אם אין תלושים כלל, כל ה-existingBizIncome הוא עסקי)
            const bizComponent = Math.max(0, existingBizIncome - avgPayslipIncome);
            const normativeIncome = employeeComponent + bizComponent;

            if (idx === 0) avg_income_1 = normativeIncome;
            else avg_income_2 = normativeIncome;
        });

        if ((borrower2._normative_shoma_monthly || 0) > 0) {
            avg_income_2 = borrower2._normative_shoma_monthly;
        }

        const total_income = Math.round(avg_income_1 + avg_income_2);

        // ─────────────────────────────────────────────
        // שלב 3: חישוב התחייבויות
        // תיקון כפל ספירה: אם קיים existing_mortgage.monthly_payment (שורת total מדו"ח יתרות סילוק),
        // אנחנו סופרים רק אותו ולא מוסיפים את המסלולים הבודדים (tracks) בנפרד.
        // ─────────────────────────────────────────────
        let loans_total = 0;

        // זיהוי האם יש משכנתא קיימת עם החזר ידוע (= יש שורת total)
        const mortgageTotalPayment = raw.existing_mortgage?.monthly_payment || 0;

        // Loan Aggregator: סוכם את כל ההלוואות — כולל הקטנות. 
        // יוצאים מן הכלל בלבד: הלוואות < 18 חודשים לסיום (בתיקי רכישה בלבד!), מסלולי משכנתא, crawler.
        // FIX: במיחזור/איחוד — כל ההלוואות נספרות (גם אם < 18 חודשים) כי הן נסגרות במסגרת המיחזור
        // ולכן צריך לכלול אותן ב-"לפני" כדי להציג חיסכון נכון.
        (raw.loans || []).forEach(loan => {
            const remainingMonths = loan.remaining_months || loan.remainingMonths || 0;
            // חסום הלוואות קצרות רק בתיקי רכישה (לא במיחזור/איחוד)
            if (!isRefinance && remainingMonths > 0 && remainingMonths <= 18) return; // ≤18 חודשים — קרוב לסיום, לא נספר
            if (loan._from_liability_crawler) return;
            const isMortgageTrack = loan._is_mortgage_track === true;
            if (isMortgageTrack) return;

            // ── שלב 1: Evidence-Only — תיקון "הזיית בנק" (כמו buildQuickReport) ──
            // הלוואה נחשבת "משכנתא שנסגרת במחזור" רק אם:
            // (א) קיים mortgage_statement מאומת (remaining_balance > 0) + (ב) המילה "משכנתא" בתיאור
            // שם בנק בלבד (יהב, פועלים) אינו מספיק — מונע החרגה שגויה מה-PTI
            if (isRefinance) {
                const hasMortgageStatement = !!(raw.existing_mortgage?.remaining_balance);
                const desc = (loan.description || '').toLowerCase();
                const isMortgageDesc = hasMortgageStatement && (desc.includes('משכנתא') || desc.includes('mortgage'));
                const existingPmt = raw.existing_mortgage?.monthly_payment || 0;
                const existingBal = raw.existing_mortgage?.remaining_balance || 0;
                const isSamePmt = existingPmt > 0 && Math.abs((loan.monthly_payment || 0) - existingPmt) < 100;
                const isSameBal = existingBal > 0 && loan.remaining_balance && Math.abs(loan.remaining_balance - existingBal) < 5000;
                if (isMortgageDesc || isSamePmt || isSameBal) return; // ← דלג רק אם יש הוכחה חותכת
            }

            const loanPmt = loan.monthly_payment || loan.monthlyPayment || 0;
            loans_total += loanPmt;
            if (loanPmt > 0) { loan._rm = Math.round(loanPmt); loan._rb = Math.round(loan.remaining_balance || loan.balance || 0); }
        });
        // ── Consolidation Package: מיחזור → שורה אחת; רכישה → כל הלוואה בנפרד ──
        const _el = (raw.loans||[]).filter(l=>l._rm>0&&!l._from_liability_crawler&&!l._is_mortgage_track);
        if (isRefinance && _el.length > 0) {
            liabilityBreakdown.push({ label:`איחוד ${_el.length} הלוואות וכרטיסי אשראי`, monthly:_el.reduce((s,l)=>s+(l._rm||0),0), balance:_el.reduce((s,l)=>s+(l._rb||0),0), type:'consolidation', marked_for_extinguishment:true, consolidated_items:_el.map(l=>({label:l.name||l.description||'הלוואה',monthly:l._rm,balance:l._rb})) });
        } else {
            _el.forEach(l=>liabilityBreakdown.push({label:l.name||l.lender||l.description||'הלוואה',monthly:l._rm,balance:l._rb,type:'loan',marked_for_extinguishment:!!(l._marked_for_extinguishment)}));
        }
        // ── שלב 2: Legal Override — עדיפות פסק דין על זיהוי מעו"ש (כמו buildQuickReport) ──
        // אם קיים divorce_agreement_alimony_monthly (מפסק דין מאומת) — הוא גובר על alimony_monthly
        const legalAlimony = raw.divorce_agreement_alimony_monthly || raw.legal_alimony_override || 0;
        const effectiveAlimony = legalAlimony > 0 ? legalAlimony : (raw.alimony_monthly || 0);
        loans_total += effectiveAlimony;
        loans_total += raw.child_support_monthly || 0;
        loans_total += raw.car_lease_monthly || 0;

        if (!isRefinance && mortgageTotalPayment > 0) {
            // סופרים רק את שורת ה-total של המשכנתא — לא את הסכום של המסלולים הבודדים
            loans_total += mortgageTotalPayment;
        }

        const pti_ratio = total_income > 0 ? (loans_total / total_income) * 100 : 0;

        // ════════════════════════════════════════════════════════════════════
        // 🧠 SMART UNDERWRITING TIE-BREAKER ENGINE v2 — פריסה חכמה לפי גיל + ריבית דינמית
        //   • תקופה: לפי גיל הלווה המבוגר (גיל + תקופה ≤ 80). ברירת מחדל מקסימלית —
        //            לווים ≤45 → 30 שנה, ≤55 → 25 שנה, מבוגר יותר → לפי גיל.
        //            המטרה: להציג את ה-MINIMUM PAYMENT לאיחוד החובות (לא למתוח מיותר).
        //   • ריבית: קל"צ (קבועה לא צמודה) + מרווח סיכון 1.7%.
        //            קל"צ בנק ישראל ~ 4.5% (אפריל 2026) + 1.7% = 6.2% ברירת מחדל.
        //            הריבית הסופית מוגבלת: לא פחות מ-4.5% ולא יותר מ-8.5%.
        // ════════════════════════════════════════════════════════════════════
        const KAL_TSEMED_BASE = 4.5;  // קל"צ בנק ישראל (אפריל 2026) — יעודכן מ-BOI בשלב refinanceImpact
        const RISK_SPREAD = 1.7;       // מרווח סיכון ממוצע לאיחוד חובות
        const STRESS_RATE = Math.min(8.5, Math.max(4.5, KAL_TSEMED_BASE + RISK_SPREAD)); // = 6.2%
        const MAX_AGE_AT_PAYOFF = 80;
        const olderBorrowerAge = Math.max(borrower1.age || 0, borrower2.age || 0);
        const autoLoanTermYears = (() => {
            // מקסימום תקופה לפי גיל — להוריד החזר חודשי עד למינימום ריאלי
            let term;
            if (olderBorrowerAge > 0 && olderBorrowerAge <= 45) term = 30;
            else if (olderBorrowerAge > 0 && olderBorrowerAge <= 55) term = 25;
            else term = 20;
            // אילוץ גיל קשיח: גיל + תקופה ≤ 80
            if (olderBorrowerAge > 0) term = Math.min(term, Math.max(10, MAX_AGE_AT_PAYOFF - olderBorrowerAge));
            return term;
        })();

        // הריבית והתקופה האפקטיביות: עדיפות לערכים מפורשים (אם הועברו), אחרת המנוע האוטומטי.
        const effectiveRate = targetInterestRate > 0 ? targetInterestRate : STRESS_RATE;
        const effectiveTermYears = loanTermYears > 0 ? loanTermYears : autoLoanTermYears;
        const rateIsAuto = !(targetInterestRate > 0);
        const termIsAuto = !(loanTermYears > 0);

        // Pre-calc refinance payment so Global_PTI is IDENTICAL in all sections
        let preCalcRefinancePayment = proposedMonthlyPayment;
        if ((isRefinance || caseType === 'debt_consolidation') && !(preCalcRefinancePayment > 0)) {
            // עדיפות 1: הסכום המבוקש שהוזן ב-Modal. עדיפות 2: יתרת המחזור הקיימת + הלוואות לסגירה.
            const totalRefinanceAmt = requestedMortgageAmount > 0
                ? requestedMortgageAmount
                : (existingMortgageBalanceWizard || raw.existing_mortgage?.remaining_balance || 0) + (loansToCloseAmount || 0);
            if (totalRefinanceAmt > 0) {
                const _r = effectiveRate / 100 / 12;
                const _n = effectiveTermYears * 12;
                preCalcRefinancePayment = Math.round(
                    totalRefinanceAmt * (_r * Math.pow(1 + _r, _n)) / (Math.pow(1 + _r, _n) - 1)
                );
            }
        }

        // Global_PTI = unified_pti. One variable, consistent across summary/pillars/narrative.
        let pti_with_proposed = null;
        if (total_income > 0 && preCalcRefinancePayment > 0) {
            if (isRefinance || caseType === 'debt_consolidation') {
                // Refinance: new payment replaces ALL obligations
                pti_with_proposed = (preCalcRefinancePayment / total_income) * 100;
            } else {
                // New mortgage: existing debts + new payment
                pti_with_proposed = ((loans_total + preCalcRefinancePayment) / total_income) * 100;
            }
        }
        const unified_pti = pti_with_proposed !== null ? pti_with_proposed : pti_ratio;

        // ─────────────────────────────────────────────
        // שלב 4: ציוני עמודים (0–100)
        // ─────────────────────────────────────────────

        // עמוד א׳: כושר החזר (PTI)
        let financialScore = 0;
        let financialEvidence = [];
        if (total_income === 0) {
            financialScore = 0;
            financialEvidence.push({ label: 'הכנסה', value: 'לא חושבה', flag: 'critical' });
        } else {
            const effectivePTI = pti_with_proposed !== null ? pti_with_proposed : pti_ratio;
            let refinanceReliefPTI = effectivePTI;
            if (isRefinance && raw.existing_mortgage?.monthly_payment && pti_with_proposed === null) {
                const loansExMortgage = Math.max(0, loans_total - (raw.existing_mortgage.monthly_payment || 0));
                refinanceReliefPTI = total_income > 0 ? (loansExMortgage / total_income) * 100 : effectivePTI;
            }
            const scoringPTI = isRefinance && refinanceReliefPTI < effectivePTI ? refinanceReliefPTI : effectivePTI;

            if (scoringPTI < 25) financialScore = 100;
            else if (scoringPTI < 30) financialScore = 90;
            else if (scoringPTI < 35) financialScore = 80;
            else if (scoringPTI < 40) financialScore = 70;
            else if (scoringPTI < 45) financialScore = 55;
            else if (scoringPTI < 50) financialScore = 40;
            else if (scoringPTI < 55) financialScore = 25;
            else financialScore = 10;

            const borrowerCount = borrower2.name ? 2 : 1;
            const disposablePerCapita = (total_income - loans_total) / borrowerCount;
            if (disposablePerCapita > 8000) {
                financialScore = Math.min(100, financialScore + 15);
                financialEvidence.push({ label: 'הכנסה פנויה לנפש', value: `₪${Math.round(disposablePerCapita).toLocaleString()}`, flag: 'positive' });
            } else if (disposablePerCapita > 4000) {
                financialScore = Math.min(100, financialScore + 8);
                financialEvidence.push({ label: 'הכנסה פנויה לנפש', value: `₪${Math.round(disposablePerCapita).toLocaleString()}`, flag: 'positive' });
            }

            financialEvidence.push({ label: 'הכנסת משק בית', value: `₪${total_income.toLocaleString()}` });
            financialEvidence.push({ label: 'PTI מאוחד', value: `${unified_pti.toFixed(1)}%`, flag: unified_pti < 35 ? 'positive' : unified_pti <= 40 ? 'warning' : 'critical' });
            financialEvidence.push({ label: 'התחייבויות חודשיות', value: `₪${Math.round(loans_total).toLocaleString()}` });
        }

        // עמוד ב׳: בטחונות (LTV)
        let collateralScore = noCollateralCase ? 0 : 50;
        let collateralEvidence = [];
        let ltvComputed = 0;

        if (effectivePropertyValue > 0) {
            ltvComputed = effectiveMortgageForLTV > 0
                ? (effectiveMortgageForLTV / effectivePropertyValue) * 100
                : 0;

            if (ltvComputed === 0) collateralScore = 80;
            else if (ltvComputed < 45) collateralScore = 100;
            else if (ltvComputed < 60) collateralScore = 80;
            else if (ltvComputed < 75) collateralScore = 50;
            else collateralScore = 20;

            collateralEvidence.push({ label: 'שווי נכס', value: `₪${Math.round(effectivePropertyValue).toLocaleString()}` });
            if (ltvComputed > 0) {
                collateralEvidence.push({
                    label: 'LTV',
                    value: `${ltvComputed.toFixed(1)}%`,
                    flag: ltvComputed < 45 ? 'positive' : ltvComputed < 75 ? 'warning' : 'critical'
                });
            }

            // פירוט לפי סוג עסקה
            if (caseType === 'mortgage') {
                if (requestedMortgageAmount > 0) collateralEvidence.push({ label: 'משכנתא מבוקשת', value: `₪${requestedMortgageAmount.toLocaleString()}` });
                if (equity > 0) collateralEvidence.push({ label: 'הון עצמי מוצהר', value: `₪${equity.toLocaleString()}`, flag: 'positive' });
            } else if (isRefinance) {
                if (existingMortgageBalanceWizard > 0) collateralEvidence.push({ label: 'יתרת משכנתא קיימת', value: `₪${existingMortgageBalanceWizard.toLocaleString()}` });
                if (loansToCloseAmount > 0) collateralEvidence.push({ label: 'הלוואות לסגירה', value: `₪${loansToCloseAmount.toLocaleString()}`, flag: 'warning' });
            }
        } else if (isQuickLoan) {
            collateralScore = 0;
        }

        // עמוד ג׳: יציבות תעסוקתית
        // ── Stability Calibration ──
        // לווה עם ותק ≥5 שנים → 100 (סלע איתן לכל בנק).
        // לווה עם ותק ≥1.5 שנים → מינימום 75 (מגזר מוכר / היי-טק).
        // לוגיקת ממוצע: לא מענישים על לווה עם ותק נמוך אם הלווה השני חזק.
        let stabilityScore = 0;
        let stabilityEvidence = [];
        const sen1 = borrower1.seniority_years || raw.business_data?.seniority_years || 0;
        const sen2 = borrower2.seniority_years || 0;
        const avgSeniority = borrower2.name ? (sen1 + sen2) / 2 : sen1;

        // ── ציון בסיס לפי ממוצע ──
        if (avgSeniority >= 10) stabilityScore = 100;
        else if (avgSeniority >= 5) stabilityScore = 100;  // 5+ שנים = בשל לחלוטין
        else if (avgSeniority >= 3) stabilityScore = 85;
        else if (avgSeniority >= 1.5) stabilityScore = 75;
        else if (avgSeniority >= 1) stabilityScore = 55;
        else stabilityScore = 25;

        // ── Seniority Floor: לווה ראשי עם ותק ≥5 שנים → מינימום 90 ──
        // מניעת "עונש ממוצע" כשהלווה הראשי יציב לחלוטין
        if (sen1 >= 5) stabilityScore = Math.max(stabilityScore, 90);
        // ── Seniority Floor: לווה ראשי עם ותק ≥1.5 שנים → מינימום 75 ──
        if (sen1 >= 1.5 && stabilityScore < 75) stabilityScore = 75;

        if (sen1 > 0) stabilityEvidence.push({ label: `ותק ${borrower1.name || 'לווה 1'}`, value: `${sen1.toFixed(1)} שנים`, flag: sen1 >= 5 ? 'positive' : sen1 >= 3 ? 'positive' : sen1 >= 1.5 ? 'neutral' : 'warning' });
        if (sen2 > 0) stabilityEvidence.push({ label: `ותק ${borrower2.name || 'לווה 2'}`, value: `${sen2.toFixed(1)} שנים`, flag: sen2 >= 5 ? 'positive' : sen2 >= 3 ? 'positive' : sen2 >= 1.5 ? 'neutral' : 'warning' });
        if (borrower1.employer) stabilityEvidence.push({ label: 'מעסיק', value: borrower1.employer });
        if (borrower2.employer) stabilityEvidence.push({ label: 'מעסיק 2', value: borrower2.employer });

        // עמוד ד׳: התנהלות פיננסית (BDI)
        // תיקון כיול BDI: Conduct Override מופעל רק על בסיס מילות מפתח מפורשות של כשל בנקאי,
        // ולא על בסיס "תנודתיות" או ריבוי הלוואות בלבד.
        const BDI_FAILURE_KEYWORDS = ['החזר', 'אכ"מ', 'אכמ', 'אי כיבוד', 'יתרה בלתי מספקת',
            'חזרת שיק', 'חזרת צ\'ק', 'הוראה לא כובדה', 'returned', 'bounced', 'insufficient funds',
            'dishonored', 'NSF', 'אי-כיבוד'];

        // בדיקה: האם יש דגלי BDI המכילים מילות מפתח מפורשות של כשל
        const bdiFlags = raw.bdi_red_flags || [];
        const hasBouncedChecks = bdiFlags.some(flag => {
            const flagText = (typeof flag === 'string' ? flag : (flag?.description || flag?.finding || '')).toLowerCase();
            return BDI_FAILURE_KEYWORDS.some(kw => flagText.includes(kw.toLowerCase()));
        });

        // בדיקת דפי עו"ש: חיפוש מפורש של תנועות החזר
        const bankStatementBounces = (raw.bank_statements || []).some(stmt =>
            (stmt.transactions || stmt.debits || []).some(tx => {
                const desc = (tx.description || tx.details || '').toLowerCase();
                return BDI_FAILURE_KEYWORDS.some(kw => desc.includes(kw.toLowerCase()));
            })
        );

        const hasConfirmedBouncedChecks = hasBouncedChecks || bankStatementBounces;

        const hasChronicOverdraft = (raw.cash_flow_summary || []).some(a => a.chronic_overdraft);
        const hasBankRedFlags = (raw.bank_red_flags || []).length > 0;
        const hasWageGarnishment = raw.wage_garnishment_detected;
        const hasGambling = raw.gambling_detected;
        const hasCrypto = raw.crypto_detected;

        let conductScore = 100;
        let conductEvidence = [];

        if (hasConfirmedBouncedChecks) {
            conductScore = 0;
            conductEvidence.push({ label: 'BDI', value: 'חזרת צ\'ק / אי-כיבוד מאומת', flag: 'critical' });
        } else if (hasWageGarnishment) {
            conductScore = 0;
            conductEvidence.push({ label: 'עיקול שכר', value: 'זוהה', flag: 'critical' });
        } else if (hasGambling) {
            conductScore = Math.min(conductScore, 30);
            conductEvidence.push({ label: 'הימורים', value: 'זוהו בעו"ש', flag: 'critical' });
        } else if (hasChronicOverdraft) {
            conductScore = Math.min(conductScore, 50);
            conductEvidence.push({ label: 'מינוס כרוני', value: 'זוהה בעו"ש', flag: 'critical' });
        } else if (hasBankRedFlags) {
            const flagCount = raw.bank_red_flags.length;
            const cappedScore = flagCount <= 2 ? 80 : flagCount <= 4 ? 70 : 60;
            conductScore = Math.min(conductScore, cappedScore);
            conductEvidence.push({ label: 'דגלי עו"ש', value: `${flagCount} ממצאים`, flag: 'warning' });
        } else {
            conductEvidence.push({ label: 'התנהלות בנקאית', value: 'תקינה', flag: 'positive' });
        }
        if (hasCrypto) {
            conductScore = Math.min(conductScore, 60);
            conductEvidence.push({ label: 'פעילות קריפטו', value: 'זוהתה', flag: 'warning' });
        }

        // ── Liquidity Buffer Override (High-Earner / Lifestyle Spend) ──
        // כרטיסי אשראי גבוהים אצל לווה עם הון נזיל > ₪100K ≠ "בזבזנות מסוכנת"
        // אלא "סגנון חיים של עשירון עליון" — אין לקנוס את ה-Conduct Score.
        // תנאים: (1) אין כשל אמיתי (BDI/עיקול/מינוס כרוני), (2) הון נזיל ≥ ₪100K,
        //         (3) הכנסה ≥ ₪25K, (4) אין מינוס כרוני.
        // ── נחשב totalLiquid כאן לצורך הלוגיקה (לפני שלב 4ב) ──
        const _earlyLiquidEquity = raw.total_equity_evidence || 0;
        const _earlyKerenBalance = (raw.keren_hishtalmut || []).reduce((s, k) => s + (k.accumulated_balance || 0), 0);
        const _earlyPensionBalance = (raw.pension_funds || []).filter(p => p.is_accessible).reduce((s, p) => s + (p.accumulated_balance || 0), 0);
        const _earlyTotalLiquid = _earlyLiquidEquity + _earlyKerenBalance + _earlyPensionBalance;

        const isHighEarnerLiquid = !hasConfirmedBouncedChecks && !hasWageGarnishment && !hasChronicOverdraft
            && _earlyTotalLiquid >= 100000 && total_income >= 25000;

        if (isHighEarnerLiquid && conductScore <= 80) {
            const liquidityLiftedScore = Math.max(conductScore, 80);
            conductEvidence.push({
                label: 'Liquidity Buffer',
                value: `הון נזיל ₪${Math.round(_earlyTotalLiquid).toLocaleString()} — מרכך קנס על צריכה גבוהה`,
                flag: 'positive'
            });
            conductScore = liquidityLiftedScore;
        }

        // מערכי התראות
        const redFlags = [];
        const mitigants = [];
        const warnings = [];

        // ─────────────────────────────────────────────
        // שלב 4ב: נכסים נזילים
        // ─────────────────────────────────────────────
        const liquidEquity = raw.total_equity_evidence || 0;
        const kerenBalance = (raw.keren_hishtalmut || []).reduce((s, k) => s + (k.accumulated_balance || 0), 0);
        const pensionBalance = (raw.pension_funds || []).filter(p => p.is_accessible).reduce((s, p) => s + (p.accumulated_balance || 0), 0);
        const totalLiquid = liquidEquity + kerenBalance + pensionBalance;
        const loanAmount = effectiveMortgageForLTV || raw.requested_loan_amount || 0;

        // ─────────────────────────────────────────────
        // שלב 4ג: אימות הון עצמי (Equity Source Verification)
        // ─────────────────────────────────────────────
        if (caseType === 'mortgage' && equity > 0) {
            // בדיקה 1: האם קיימת הפקדה חד-פעמית גדולה בעו"ש (90 יום אחרונים)
            const hasLargeDeposit = (raw.bank_statements || []).some(stmt =>
                (stmt.transactions || stmt.credits || []).some(tx => {
                    const amt = tx.amount || 0;
                    const isInRange = amt >= equity * 0.75 && amt <= equity * 1.25;
                    if (!tx.date || !isInRange) return false;
                    const daysDiff = (new Date() - new Date(tx.date)) / (1000 * 60 * 60 * 24);
                    return daysDiff <= 90;
                })
            );

            if (hasLargeDeposit) {
                // הפקדה חד-פעמית זוהתה — יתכן מקור חיצוני
                warnings.push({
                    category: 'מקור הון עצמי',
                    finding: `הופקדה סכום חד-פעמי בגובה הקרוב להון העצמי המוצהר (₪${equity.toLocaleString()}) ב-90 הימים האחרונים — נדרשת בירור מקור (מתנה/הלוואה/חיסכון?)`
                });
            } else if (totalLiquid >= equity * 0.8) {
                // הון עצמי מאומת מול יתרות נזילות קיימות
                mitigants.push({
                    category: 'הון עצמי',
                    finding: `הון עצמי מוצהר ₪${equity.toLocaleString()} מאומת מול יתרות נזילות (₪${Math.round(totalLiquid).toLocaleString()}) — צבירה עצמית`,
                    weight: 'high'
                });
            } else {
                warnings.push({
                    category: 'הון עצמי',
                    finding: `הון עצמי מוצהר ₪${equity.toLocaleString()} — יתרות נזילות זוהו רק ₪${Math.round(totalLiquid).toLocaleString()} — נדרש אימות מקור`
                });
            }
        }

        // ─────────────────────────────────────────────
        // שלב 4ד: LTV Alerts (לפי נוסחאות המדויקות)
        // ─────────────────────────────────────────────
        if (ltvComputed > 75 && caseType === 'mortgage') {
            redFlags.push({
                severity: 'high',
                category: 'בטחונות',
                finding: `LTV גבוה — ${ltvComputed.toFixed(1)}% (מעל 75%) — דורש ביטחון נוסף`,
                action_required: true
            });
        }

        // בונוס ירוק אם מיחזור מוריד PTI ב-15%+
        if (isRefinance && pti_with_proposed !== null) {
            const ptiDrop = pti_ratio - pti_with_proposed;
            if (ptiDrop >= 15) {
                mitigants.push({
                    category: 'יעילות מיחזור',
                    finding: `המיחזור מוריד PTI ב-${ptiDrop.toFixed(1)} נקודות אחוז — שיפור משמעותי בכושר ההחזר`,
                    weight: 'high'
                });
            }
        }

        // ─────────────────────────────────────────────
        // שלב 4ה: מבחן לחץ (Stress Test)
        // ─────────────────────────────────────────────
        const calcPMT = (principal, annualRate, periodYears) => {
            if (!principal || !annualRate || !periodYears) return 0;
            const r = annualRate / 100 / 12;
            const n = periodYears * 12;
            if (r === 0) return principal / n;
            return principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
        };

        const VARIABLE_TRACKS = ['prime', 'variable_linked', 'variable_unlinked'];
        let stressTest = null;
        const tracksToUse = proposedMortgageTracks.length > 0 ? proposedMortgageTracks : null;

        if (tracksToUse && total_income > 0) {
            const calcTotalPayment = (rateDelta) => tracksToUse.reduce((sum, track) => {
                const isVariable = VARIABLE_TRACKS.includes(track.track_type);
                const adjustedRate = (track.interest_rate || 0) + (isVariable ? rateDelta : 0);
                return sum + calcPMT(track.amount || 0, adjustedRate, track.period_years || 20);
            }, 0);

            const basePayment = calcTotalPayment(0);
            const payment1pct = calcTotalPayment(1);
            const payment2pct = calcTotalPayment(2);
            const otherDebts = loans_total;
            const basePTI = ((otherDebts + basePayment) / total_income) * 100;
            const pti1pct  = ((otherDebts + payment1pct) / total_income) * 100;
            const pti2pct  = ((otherDebts + payment2pct) / total_income) * 100;

            stressTest = {
                base_monthly_payment: Math.round(basePayment),
                plus_1pct_monthly_payment: Math.round(payment1pct),
                plus_2pct_monthly_payment: Math.round(payment2pct),
                current_pti: parseFloat(basePTI.toFixed(1)),
                plus_1pct_pti: parseFloat(pti1pct.toFixed(1)),
                plus_2pct_pti: parseFloat(pti2pct.toFixed(1)),
                is_resilient: pti2pct < 40,
                resilience_label: pti2pct < 35 ? 'עמיד מצוין' : pti2pct < 40 ? 'עמיד — בגבול' : pti2pct < 45 ? 'בסיכון בעליית ריבית' : 'נכשל במבחן לחץ',
                tracks_analyzed: tracksToUse.length,
                variable_tracks_count: tracksToUse.filter(t => VARIABLE_TRACKS.includes(t.track_type)).length
            };

            if (!stressTest.is_resilient) {
                warnings.push({ category: 'מבחן לחץ', finding: `PTI יעלה ל-${pti2pct.toFixed(1)}% בעליית ריבית 2% — חורג מ-40%` });
            }
        }

        // יחס כיסוי נזילות
        const totalMonthlyObligation = loans_total + (proposedMonthlyPayment > 0 ? proposedMonthlyPayment
            : (stressTest ? stressTest.base_monthly_payment : 0));
        let assetCoverageRatio = null;
        if (totalMonthlyObligation > 0 && totalLiquid > 0) {
            const monthsCovered = totalLiquid / totalMonthlyObligation;
            assetCoverageRatio = {
                liquid_assets: Math.round(totalLiquid),
                monthly_obligation: Math.round(totalMonthlyObligation),
                months_covered: parseFloat(monthsCovered.toFixed(1)),
                coverage_label: monthsCovered >= 24 ? 'כיסוי מצוין — 24+ חודשים'
                    : monthsCovered >= 12 ? 'כיסוי טוב — 12+ חודשים'
                    : monthsCovered >= 6 ? 'כיסוי סביר — 6+ חודשים'
                    : 'כיסוי נמוך — פחות מ-6 חודשים',
                is_strong: monthsCovered >= 12
            };
            if (monthsCovered >= 12) {
                mitigants.push({
                    category: 'כיסוי נזילות',
                    finding: `יחס כיסוי נזילות: ${monthsCovered.toFixed(1)} חודשים ללא הכנסה — כרית ביטחון חזקה`,
                    weight: monthsCovered >= 24 ? 'high' : 'medium'
                });
            }
        }

        // ─────────────────────────────────────────────
        // שלב 4ו: זיהוי חובות צל
        // ─────────────────────────────────────────────
        const shadowDebts = [];
        const bankStmts = raw.bank_statements || [];
        const KNOWN_LOAN_KEYWORDS = ['הלוואה', 'משכנתא', 'ליסינג', 'רכב', 'בנק', 'bank', 'ביטוח'];

        bankStmts.forEach(stmt => {
            const transactions = stmt.transactions || stmt.debits || [];
            const transMap = {};
            transactions.forEach(tx => {
                const amt = Math.abs(tx.amount || 0);
                if (amt < 300 || amt > 15000) return;
                const isRound = amt % 100 === 0 || amt % 50 === 0;
                if (!isRound) return;
                const desc = (tx.description || tx.details || '').toLowerCase();
                if (KNOWN_LOAN_KEYWORDS.some(k => desc.includes(k.toLowerCase()))) return;
                const key = `${Math.round(amt / 50) * 50}`;
                if (!transMap[key]) transMap[key] = { amount: amt, desc: tx.description || '', count: 0 };
                transMap[key].count++;
            });
            Object.values(transMap).forEach(entry => {
                if (entry.count >= 2) {
                    const alreadyInLoans = (raw.loans || []).some(l =>
                        Math.abs((l.monthly_payment || 0) - entry.amount) < entry.amount * 0.1
                    );
                    if (!alreadyInLoans) {
                        shadowDebts.push({
                            estimated_amount: entry.amount,
                            description: entry.desc,
                            occurrences: entry.count,
                            finding: `תשלום חוזר לא מזוהה — ₪${entry.amount.toLocaleString()} (${entry.count} חודשים)`,
                            action: 'נדרשת הבהרה האם מדובר בחוב לא מדווח'
                        });
                    }
                }
            });
        });

        // ── Credit Card Logic (מסונכרן עם buildQuickReport) ──
        // כרטיסי אשראי = הוצאה צרכנית שוטפת — לא נספרים ב-PTI.
        // חריג 1: תיק איחוד חובות — כל כרטיס > ₪500 נספר ב-PTI (נסגר במסגרת המיחזור).
        // חריג 2: כרטיס בודד > 50% מהכנסת משק הבית — דגל אדום בלבד, לא נספר ב-PTI.
        const isDebtConsolidation = (raw.loan_purpose || '').includes('איחוד') || caseType === 'debt_consolidation';
        const creditCardsSeen = new Set();
        (raw.credit_cards || []).forEach(card => {
            const effectiveMonthly = (() => {
                const amounts = card.monthly_amounts_seen || [];
                if (amounts.length >= 2) {
                    const sorted = [...amounts].sort((a, b) => a - b);
                    const withoutMax = sorted.slice(0, -1);
                    const avgWithoutSpike = Math.round(withoutMax.reduce((s, v) => s + v, 0) / withoutMax.length);
                    if (avgWithoutSpike > 0 && sorted[sorted.length - 1] / avgWithoutSpike >= 3) return avgWithoutSpike;
                }
                return card.monthly_payment || 0;
            })();
            if (effectiveMonthly <= 0) return;
            const key = `${Math.round(effectiveMonthly / 100) * 100}`;
            if (creditCardsSeen.has(key)) return;
            creditCardsSeen.add(key);
            const alreadyInLoans = (raw.loans || []).some(l =>
                Math.abs((l.monthly_payment || 0) - effectiveMonthly) < effectiveMonthly * 0.1
            );
            if (alreadyInLoans) return;

            // רישום הכרטיס לטבלת הפירוט (גם אם לא נספר ב-PTI — שקיפות לחתם)
            liabilityBreakdown.push({
                label: card.description || card.issuer || 'כרטיס אשראי',
                monthly: Math.round(effectiveMonthly),
                balance: null,
                type: 'credit_card',
                marked_for_extinguishment: !!(isDebtConsolidation && effectiveMonthly > 500),
            });

            // תיק איחוד חובות — כל כרטיס > ₪500 נספר ב-PTI
            if (isDebtConsolidation && effectiveMonthly > 500) {
                loans_total += effectiveMonthly;
                warnings.push({ category: 'כרטיס אשראי נספר ב-PTI (איחוד)', finding: `כרטיס אשראי: ${card.description || 'לא ידוע'} — ₪${effectiveMonthly.toLocaleString()}/חודש (תיק איחוד חובות)` });
                return;
            }

            // דגל אדום: כרטיס > 50% מהכנסת משק הבית — חשד להלוואה מוסתרת (לא נספר ב-PTI)
            if (total_income > 0 && effectiveMonthly > total_income * 0.5) {
                redFlags.push({
                    severity: 'high',
                    category: 'הוצאת אשראי חריגה מאוד',
                    finding: `כרטיס אשראי: ${card.description || 'לא ידוע'} — ₪${effectiveMonthly.toLocaleString()}/חודש (${Math.round(effectiveMonthly / total_income * 100)}% מהכנסת משק הבית) — חשד להלוואה מוסתרת. לא נספר ב-PTI.`,
                    action_required: true
                });
                return;
            }

            // כרטיס רגיל — הוצאה שוטפת, לא נספר ב-PTI
            if (effectiveMonthly > 8000) {
                warnings.push({ category: 'הוצאות אשראי גבוהות', finding: `כרטיס אשראי: ${card.description || 'לא ידוע'} — ₪${effectiveMonthly.toLocaleString()}/חודש — הוצאה שוטפת (לא נספרת ב-PTI)` });
            }
        });

        // ── Double-Count Guard + Gross-Net Cross-Matcher (מסונכרן עם buildQuickReport) ──
        // שלב 1: ניכויי הלוואות שכבר מנוכים מהשכר נטו — הוצאתם מ-loans_total
        const payslipLoanDeductions = (raw.payslips_borrower1 || []).concat(raw.payslips_borrower2 || [])
            .flatMap(p => p.loan_deductions || p.other_deductions || [])
            .filter(d => (d.amount || 0) > 0);

        if (payslipLoanDeductions.length > 0) {
            payslipLoanDeductions.forEach(deduction => {
                const deductionAmt = deduction.amount || 0;
                const alreadyInLoans = (raw.loans || []).some(l =>
                    Math.abs((l.monthly_payment || 0) - deductionAmt) < deductionAmt * 0.1
                );
                if (alreadyInLoans) {
                    loans_total = Math.max(0, loans_total - deductionAmt);
                    warnings.push({
                        category: 'כיול PTI — ניכוי כפול',
                        finding: `ניכוי "${deduction.description || 'הלוואה'}" ₪${deductionAmt.toLocaleString()} מנוכה כבר מהשכר נטו — הוסר מחישוב ה-PTI למניעת כפל ספירה`
                    });
                }
            });
        }

        // שלב 2: Gross-Net Cross-Matcher — הצלבת ניכויים בלתי מוסברים בתלושים
        // לפני שמוציאים אזהרה, מנסים להסביר את הניכוי:
        //   1. ניכויי חובה סטטוטוריים (מס, ביטוח לאומי, פנסיה, קרן השתלמות) ~33-42%
        //   2. הצלבה מול הלוואות ידועות בריכוז
        //   3. רק אם ניכוי בלתי מוסבר > ₪1,500 → דגל HIGH
        const SOCIAL_DEDUCTION_KEYWORDS_UR = ['קרן השתלמות', 'קופת גמל', 'קה"ל', 'ביטוח מנהלים',
            'פנסיה', 'קצבה', 'ביטוח חיים', 'אובדן כושר', 'קופ"ג', 'גמל',
            'ביטוח בריאות', 'אמבולטורי', 'ועד עובדים', 'הסתדרות', 'מס הכנסה', 'ביטוח לאומי',
            'ארוחות', 'דלק', 'נסיעות', 'רכב', 'טלפון', 'סלולר', 'מחשב', 'הלבשה'];
        const isSocialDeductionUR = (desc) => SOCIAL_DEDUCTION_KEYWORDS_UR.some(kw => (desc || '').toLowerCase().includes(kw.toLowerCase()));

        const grossNetSeenUR = new Set();
        const totalKnownLoanPayments = (raw.loans || []).reduce((s, l) => s + (l.monthly_payment || 0), 0);

        [[b1Payslips, borrower1.name || 'לווה 1'], [b2Payslips, borrower2.name || 'לווה 2']].forEach(([slips, bLabel]) => {
            (slips || []).forEach(p => {
                const gross = p.gross_salary || 0;
                const net = p.net_salary || 0;
                if (gross < 5000 || net <= 0 || p._gross_net_explained) return;
                const ratio = net / gross;
                const isEducation = (raw.borrowers || []).some(b =>
                    (b.employer || '').includes('חינוך') || (b.employer || '').includes('הוראה') || (b.employer || '').includes('Education')
                );
                // ── מדרגות מס ישראליות: ברוטו > 30K → יחס 55% הוא נורמטיבי ──
                const threshold = isEducation ? 0.55 : (gross > 30000 ? 0.53 : gross > 20000 ? 0.60 : 0.65);
                if (ratio >= threshold) return;
                const key = `${bLabel}_${p.month_year}`;
                if (grossNetSeenUR.has(key)) return;
                grossNetSeenUR.add(key);

                // ── ניכויי חובה: ברוטו > 30K → הפרשות מקסימליות מוסיפות עוד 5% ──
                const expectedMandatory = gross * (isEducation ? 0.42 : gross > 30000 ? 0.45 : 0.38);
                const actualDeductions = gross - net;
                const unexplained = actualDeductions - expectedMandatory;

                // הצלבה מול הלוואות ידועות
                const explainedByLoans = totalKnownLoanPayments > 0 &&
                    Math.abs(unexplained - totalKnownLoanPayments) < totalKnownLoanPayments * 0.25;
                if (explainedByLoans) return; // מוסבר — אין צורך באזהרה

                // הצלבה מול ניכוי הלוואה מפורש בתלוש
                const slipLoanDed = p.loan_deduction || 0;
                if (slipLoanDed > 0 && Math.abs(unexplained - slipLoanDed) < slipLoanDed * 0.15) return;

                // ניכוי בלתי מוסבר > ₪1,500 → אזהרה
                if (unexplained > 1500) {
                    warnings.push({
                        category: 'ניכויים בלתי מוסברים בתלוש',
                        finding: `${bLabel} (${p.month_year || ''}): נטו ₪${net.toLocaleString()} | ברוטו ₪${gross.toLocaleString()} | יחס: ${Math.round(ratio * 100)}% | ניכוי בלתי מוסבר: ₪${Math.round(unexplained).toLocaleString()} — ייתכן הלוואה פנימית.`,
                        detail: 'בקש פירוט ניכויים מלא מהתלוש ואמת מול ריכוז הלוואות.'
                    });
                }
            });
        });

        // ── Shadow Debts: נכנס אוטומטית ל-loans_total לצורך PTI מדויק ──
        const shadowDebtsSeen = new Set();
        shadowDebts.forEach(sd => {
            const key = `${Math.round(sd.estimated_amount / 50) * 50}`;
            if (!shadowDebtsSeen.has(key)) {
                shadowDebtsSeen.add(key);
                loans_total += sd.estimated_amount;
            }
            warnings.push({ category: 'חוב צל חשוד', finding: sd.finding + ` — נכלל ב-PTI (גישה שמרנית)`, detail: sd.action });
        });

        // ── כיול PTI אחרי כרטיסים + חובות צל (אחרי עדכון loans_total) ──
        const pti_ratio_updated = total_income > 0 ? (loans_total / total_income) * 100 : 0;
        const unified_pti_final = pti_with_proposed !== null
            ? (isRefinance
                ? pti_with_proposed
                : ((loans_total + preCalcRefinancePayment) / Math.max(1, total_income)) * 100)
            : pti_ratio_updated;

        // ─────────────────────────────────────────────
        // שלב 5: בונוסים וקנסות
        // ─────────────────────────────────────────────
        let bonuses = 0;
        let penalties = 0;
        const bonusList = [];
        const penaltyList = [];

        if (avg_income_1 >= 10000 && avg_income_2 >= 10000) {
            bonuses += 5;
            bonusList.push({ label: 'הכנסה כפולה מוצקה', points: +5, value: `₪${avg_income_1.toLocaleString()} + ₪${avg_income_2.toLocaleString()}` });
        }
        if (sen1 >= 8) {
            bonuses += 3;
            bonusList.push({ label: `ותק גבוה — ${borrower1.name || 'לווה 1'}`, points: +3, value: `${sen1.toFixed(1)} שנים` });
        }
        if (loanAmount > 0 && totalLiquid >= loanAmount) {
            bonuses += 15;
            bonusList.push({ label: 'הון נזיל מעל סכום ההלוואה', points: +15, value: `₪${Math.round(totalLiquid).toLocaleString()}` });
        } else if (totalLiquid > 100000) {
            bonuses += 8;
            bonusList.push({ label: 'הון נזיל משמעותי', points: +8, value: `₪${Math.round(totalLiquid).toLocaleString()}` });
        }
        if (isRefinance && raw.existing_mortgage?.monthly_payment && proposedMonthlyPayment > 0) {
            const reduction = (raw.existing_mortgage.monthly_payment - proposedMonthlyPayment) / raw.existing_mortgage.monthly_payment;
            if (reduction >= 0.20) {
                bonuses += 10;
                bonusList.push({ label: 'מחזור מוריד החזר חודשי ב-20%+', points: +10, value: `${(reduction * 100).toFixed(1)}%` });
            }
        }

        // קנס: אי-התאמת שם
        const b1Name = (borrower1.name || '').trim();
        const payslipName = (b1Payslips[0]?.borrower_name || '').trim();
        if (b1Name && payslipName && b1Name !== payslipName) {
            const similarity = b1Name.split(' ').filter(w => payslipName.includes(w)).length / Math.max(1, b1Name.split(' ').length);
            if (similarity < 0.5) {
                penalties += 50;
                penaltyList.push({ label: 'אי-התאמת שם לווה', points: -50, detail: `שם בתיק: ${b1Name} | שם בתלוש: ${payslipName}` });
            }
        }

        // קנס: תעודת זהות פגת תוקף
        // תיקון: המערכת בודקת את שדה id_expiry_date (תאריך תפוגה) בלבד.
        // אם הוא לא קיים, בודקת גם id_valid_until ו-id_issue_date_alt.
        // תאריך הנפקה בלבד (ללא שדה תפוגה מפורש) אינו מספיק לסימון "פג תוקף".
        const parseIsraeliDate = (dateStr) => {
            if (!dateStr) return null;
            const s = String(dateStr).replace(/\./g, '/').replace(/-/g, '/').trim();
            const parts = s.split('/');
            if (parts.length !== 3) return null;
            // DD/MM/YYYY or YYYY/MM/DD
            const d = parts[0].length === 4
                ? new Date(+parts[0], +parts[1] - 1, +parts[2])
                : new Date(+parts[2], +parts[1] - 1, +parts[0]);
            return isNaN(d.getTime()) ? null : d;
        };

        const isIdExpired = (b) => {
            // שדה תפוגה מפורש — זה הנתון האמין ביותר
            const expiryDate = parseIsraeliDate(b.id_expiry_date || b.id_valid_until || b.id_expiry);
            if (!expiryDate) return false; // אם אין תאריך תפוגה — לא מסמנים כפג תוקף
            return expiryDate < new Date();
        };
        const b1IdExpired = isIdExpired(borrower1);
        const b2IdExpired = isIdExpired(borrower2);
        if (b1IdExpired || b2IdExpired) {
            penalties += 25;
            penaltyList.push({ label: 'תעודת זהות פגת תוקף', points: -25 });
        }

        // ─────────────────────────────────────────────
        // שלב 6: ציון סופי
        // ─────────────────────────────────────────────
        const rawScore =
            (financialScore * WEIGHTS.financial) +
            (collateralScore * WEIGHTS.collateral) +
            (stabilityScore * WEIGHTS.stability) +
            (conductScore * WEIGHTS.conduct);

        // Override זהות
        let identityOverrideActive = false;
        const b1NameForCheck = (borrower1.name || '').trim();
        const payslipNameForCheck = (b1Payslips[0]?.borrower_name || b1Payslips[0]?.employee_name || '').trim();
        if (b1NameForCheck && payslipNameForCheck) {
            const words = b1NameForCheck.split(' ').filter(Boolean);
            const matchedWords = words.filter(w => payslipNameForCheck.includes(w));
            const similarity = matchedWords.length / Math.max(1, words.length);
            if (similarity < 0.85) identityOverrideActive = true;
        }

        // Override התנהלות — רק על בסיס כשל מאומת (לא על תנודתיות)
        const conductOverrideActive = hasConfirmedBouncedChecks || hasWageGarnishment;

        // בונוס הבראה — איחוד חובות
        if (isDebtConsolidation && raw.existing_mortgage?.monthly_payment && proposedMonthlyPayment > 0) {
            const reductionPct = (raw.existing_mortgage.monthly_payment - proposedMonthlyPayment) / raw.existing_mortgage.monthly_payment;
            if (reductionPct >= 0.30) {
                bonuses += 10;
                bonusList.push({ label: 'בונוס הבראה — איחוד חובות מוריד החזר ב-30%+', points: +10, value: `${(reductionPct * 100).toFixed(1)}% ירידה` });
            }
        }

        let adjustedFinalScore = Math.max(0, Math.min(100, Math.round(rawScore + bonuses - penalties)));

        if (conductOverrideActive) {
            adjustedFinalScore = Math.min(adjustedFinalScore, 30);
            penaltyList.push({ label: 'Conduct Override — כשל בנקאי חמור', points: `→ מקסימום 30`, detail: hasBouncedChecks ? 'צ\'ק חוזר / הוראת קבע' : 'עיקול שכר' });
        } else if (identityOverrideActive && adjustedFinalScore > 65) {
            adjustedFinalScore = 65;
            penaltyList.push({ label: 'Identity Override — חוסר התאמה בזהות', points: `→ מוגבל ל-65`, detail: `שם בתיק: ${b1NameForCheck} | שם בתלוש: ${payslipNameForCheck}` });
        }

        // finalScore יחושב בסוף — אחרי הכיול בשלב 8
        // דירוג ראשוני (יעודכן אחרי כיול)
        let rating, ratingLabel, ratingColor;

        // רמת ביטחון
        const docsAvailable = b1Payslips.length + b2Payslips.length;
        const hasMortgageDoc = !!(raw.existing_mortgage?.remaining_balance);
        const hasIdData = !!(borrower1.id);
        let confidenceScore = 60;
        if (docsAvailable >= 3) confidenceScore += 15;
        if (docsAvailable >= 6) confidenceScore += 10;
        if (hasMortgageDoc) confidenceScore += 10;
        if (hasIdData) confidenceScore += 5;
        const confidence_level = Math.min(100, confidenceScore);
        const requiresManualReview = confidence_level < 90;

        // ─────────────────────────────────────────────
        // שלב 7: נעילת זהות (Triple Cross-Match)
        // ─────────────────────────────────────────────
        const buildIdentityLock = (borrower, payslips, bankDeposits, thisIdExpired, bankStatementsCount = 0, idCardWasVerified = false) => {
            const docName = (borrower.name || '').trim();
            // ✅ PAYSLIP-FIRST FALLBACK: אם שדה id ריק אך יש ת.ז תקינה בתלוש — שחזר ממנו.
            // זה מתקן את המקרה שבו normalizeDocData הצליח לאמת ת.ז מהתלוש אך מסיבה כלשהי
            // (race condition בין chunks) השדה id עדיין הגיע ריק לפונקציה זו.
            let docId = (borrower.id || '').replace(/\D/g, '');
            if (docId.length !== 9 && payslips.length > 0) {
                const normSlipId = (id) => (id || '').replace(/\D/g, '').padStart(9, '0').slice(-9);
                for (const p of payslips) {
                    const sid = normSlipId(p.id_number || '');
                    if (sid.length === 9 && !sid.startsWith('000') && isValidIsraeliId(sid)) {
                        docId = sid;
                        break;
                    }
                }
            }
            // תיקון: שומרים הן תאריך הנפקה והן תאריך תפוגה לתצוגה בדוח
            const idExpiry = borrower.id_expiry_date || borrower.id_valid_until || borrower.id_expiry || null;
            const idIssueDate = borrower.id_issue_date || null;

            // ✅ FIX חיווט: סטטוס 'verified' אם יש מסמך ת.ז ייעודי (id_document_found===true)
            // או אם buildDocumentVerifications יצר id_card מאומת (idCardWasVerified). זה מחבר את
            // ה-V הירוק שנוצר למטה ל-Identity Lock למעלה — במקום להשאיר אדום שגוי.
            // (===true, not !==false — a missing/undefined value must never read as "verified")
            const hasDedicatedIdDoc = borrower.id_document_found === true || idCardWasVerified;
            const idSource = {
                source: 'תעודת זהות',
                name: docName || null,
                id_number: docId || null,
                dedicated_doc: hasDedicatedIdDoc,
                status: !hasDedicatedIdDoc ? 'missing'
                    : (docName && docId.length === 9 && !thisIdExpired ? 'verified' : (thisIdExpired ? 'mismatch' : 'missing'))
            };

            const normPayslipId = (id) => (id || '').replace(/\D/g, '').padStart(9, '0').slice(-9);

            // ── Fuzzy ID Matching + Physical ID Priority ──────────────────────────
            // Physical ID (מהספח הביומטרי) = אמת מוחלטת.
            // אם OCR שגה ב-1-2 ספרות בתלוש (שגיאות נפוצות: 0↔3, 0↔6, 1↔7)
            // נחשב "fuzzy match" אם ≥7/9 ספרות תואמות.
            const countMatchingDigits = (a, b) => {
                if (!a || !b || a.length !== 9 || b.length !== 9) return 0;
                let count = 0;
                for (let i = 0; i < 9; i++) { if (a[i] === b[i]) count++; }
                return count;
            };
            // נסה גם normalize OCR נפוץ: 3→0 בספרה הראשונה
            const ocrNormalize = (id) => {
                if (!id || id.length !== 9) return id;
                // שגיאה נפוצה: OCR קורא 3 כ-0 בספרה הראשונה
                if (id[0] === '3') return '0' + id.slice(1);
                if (id[0] === '0' && id[1] === '3') return '0' + '0' + id.slice(2);
                return id;
            };

            // id_number = מספר ת.ז. האמיתי מהתלוש (9 ספרות, עובר checksum ישראלי)
            // employee_id = מספר עובד פנימי — לא להשוות לת.ז. לעולם!
            const payslipNationalIdRaw = payslips.length > 0 ? (payslips[0].id_number || '') : '';
            const payslipNationalIdNorm = normPayslipId(payslipNationalIdRaw);
            // THREE-ZERO RULE + Luhn: פסל מספרי עובד ממולאים באפסים
            const payslipNationalId = (!payslipNationalIdNorm.startsWith('000') && isValidIsraeliId(payslipNationalIdNorm)) ? payslipNationalIdNorm : '';
            const docIdNorm = normPayslipId(docId);
            const payslipEmployer = payslips.length > 0 ? payslips[0].employer : null;

            // השוואה: תחילה exact, אחר כך fuzzy (Physical ID Priority)
            const payslipHasNationalId = payslipNationalId.length === 9;
            const bothIdsKnown = payslipHasNationalId && docIdNorm.replace(/^0+/, '');

            let idMatchesPayslip = null;
            let fuzzyMatchActive = false;
            let fuzzyMatchNote = null;

            if (bothIdsKnown) {
                if (payslipNationalId === docIdNorm) {
                    // exact match
                    idMatchesPayslip = true;
                } else {
                    // נסה OCR normalize על מספר התלוש (Physical ID = אמת)
                    const payslipNormalized = ocrNormalize(payslipNationalId);
                    const payslipNormalizedFixed = normPayslipId(payslipNormalized);
                    if (payslipNormalizedFixed === docIdNorm) {
                        idMatchesPayslip = true;
                        fuzzyMatchActive = true;
                        fuzzyMatchNote = 'אומת לאחר תיקון שגיאת OCR (0↔3)';
                    } else {
                        // fuzzy: ≥7 מתוך 9 ספרות תואמות
                        const matchCount = countMatchingDigits(payslipNationalId, docIdNorm);
                        if (matchCount >= 7) {
                            idMatchesPayslip = true;
                            fuzzyMatchActive = true;
                            fuzzyMatchNote = `אומת ברמת ביטחון גבוהה (${matchCount}/9 ספרות תואמות — שונות OCR)`;
                        } else {
                            idMatchesPayslip = false;
                        }
                    }
                }
            }

            // ✅ FIX #3b — עצמאי ו-"אין תלושים" = לא עונש:
            // (א) employment_type כולל 'עצמאי' — מוכח עצמאי.
            // (ב) employment_type הוא null/ריק אבל אין תלושים בכלל — ייתכן עצמאי שהשדה לא חולץ.
            //     במצב זה פוטרים מבדיקת תלוש כדי למנוע yellow שקרי על עצמאי.
            const isSelfEmployed = (borrower.employment_type || '').toLowerCase().includes('עצמאי')
                || (!borrower.employment_type && payslips.length === 0);
            const payslipStatus = isSelfEmployed
                ? 'not_applicable'
                : (payslips.length === 0 ? 'missing' : idMatchesPayslip === false ? 'mismatch' : 'verified');

            const payslipSource = {
                source: 'תלוש שכר',
                employee_id: (payslips.length > 0 ? payslips[0].employee_id : null) || null,
                employer: payslipEmployer || null,
                id_match: idMatchesPayslip,
                fuzzy_match: fuzzyMatchActive || false,
                fuzzy_note: fuzzyMatchNote || null,
                status: payslipStatus
            };

            const relevantDeposits = bankDeposits.filter(d => d.is_income);
            // תיקון באג סנכרון: אם קיימים דפי חשבון ב-bank_statements — גם אם income_deposits ריק, הסטטוס 'verified'
            const hasBankEvidence = relevantDeposits.length > 0 || bankStatementsCount > 0;
            const bankSource = {
                source: 'דפי חשבון',
                deposits_found: relevantDeposits.length,
                status: hasBankEvidence ? 'verified' : 'missing'
            };

            // לוגיקת נעילה סופית — Identity Lock v2
            // כלל: ID פג תוקף / אין ID = אדום תמיד.
            // אי-התאמת מספר ת.ז: בדוק גורמים מפצים (שם תואם / עו"ש מאומת) לפני החלטה.
            const bankVerifiedForLock = relevantDeposits.length > 0 || bankDeposits.length > 0;
            const nameFromPayslip = (payslips[0]?.borrower_name || payslips[0]?.employee_name || '').trim();
            const nameMatchesPayslip = !!(docName && nameFromPayslip &&
                docName.split(' ').filter(Boolean).some(w => nameFromPayslip.includes(w)));
            let lockStatus;
            if (!docId) {
                lockStatus = 'red'; // אין מספר ת.ז כלל
            } else if (thisIdExpired) {
                lockStatus = 'red'; // ת.ז פגת תוקף — תמיד אדום
            } else if (!hasDedicatedIdDoc) {
                // אזכור בספח בלבד — לא מסמך ייעודי של הלווה. חייב לדרוש צילום נפרד.
                lockStatus = 'red';
            } else if (idCardWasVerified && docId.length === 9 && !thisIdExpired) {
                // ✅ HARD OVERRIDE: buildDocumentVerifications אימת ת.ז תקינה — ירוק מיידי.
                // מונע את המלכודת שבה עצמאי (ללא תלושים) נתקע ב-yellow/red למרות שיש לו ת.ז מאומתת.
                lockStatus = 'green';
            } else if (idMatchesPayslip === true && fuzzyMatchActive) {
                // Fuzzy match מאומת — Physical ID Priority — ירוק עם הערה
                lockStatus = 'green';
            } else if (idMatchesPayslip === false && !isSelfEmployed) {
                // ✅ FIX #2 — WALLET PHOTO OVERRIDE: שני ת"ז שונות באותה תמונת ספח =
                // שני לווים מאומתים. אם idCardWasVerified=true, המסמך הוכיח שהת"ז קיימת —
                // ה-"מיסמאטש" הוא בגלל שה-OCR קרא את שתי הת"ז מאותה תמונת ארנק, לא
                // בגלל זהות מזויפת. Hard Override: ירוק אם idCardWasVerified.
                if (idCardWasVerified) {
                    lockStatus = 'green';
                } else {
                    lockStatus = (nameMatchesPayslip || bankVerifiedForLock) ? 'yellow' : 'red';
                }
            } else if (isSelfEmployed) {
                // ✅ FIX #3 — SELF-EMPLOYED NO-PAYSLIP OVERRIDE: עצמאי ללא תלושים הוא
                // NOT "missing payslip" — הוא מוכיח זהות דרך שומת מס / מכתב רו"ח בלבד.
                // אסור לקנוס ציון על העדר תלושים לעצמאי. אם יש ת"ז תקינה → ירוק מיידי.
                lockStatus = (docId.length === 9 && !thisIdExpired) ? 'green' : (idSource.status === 'verified' ? 'green' : 'yellow');
            } else if (payslipSource.status === 'verified') {
                lockStatus = 'green';
            } else if (payslipSource.status === 'missing') {
                // שכיר ללא תלוש = yellow
                lockStatus = 'yellow';
            } else {
                lockStatus = 'green';
            }

            return {
                borrower_name: docName || 'לא זוהה',
                id_number: docId ? `****${docId.slice(-3)}` : null,
                id_expiry: idExpiry,
                id_expired: thisIdExpired,
                lock_status: lockStatus,
                sources: [idSource, payslipSource, bankSource],
                confidence: lockStatus === 'green' ? 'high' : lockStatus === 'yellow' ? 'medium' : 'low'
            };
        };

        const allDeposits = raw.income_deposits || [];
        const bankStmtsCountForLock = (raw.bank_statements || []).length;
        // ✅ FIX חיווט: בונים את אימותי המסמכים פעם אחת — מקור האמת ל-id_card המאומתים.
        // מפת idCardVerified מוזרמת ל-Identity Lock ול-Checklist כדי שה-V הירוק יסגור אותם.
        const docVerification = buildDocumentVerifications(raw, borrower1, borrower2, b1Payslips, b2Payslips, null);
        const idCardVerified = docVerification.idCardVerified || {};
        const identityLock = {
            borrower1: buildIdentityLock(borrower1, b1Payslips, allDeposits.filter(d => d.borrower_index === 0 || d.borrower_index === undefined), b1IdExpired, bankStmtsCountForLock, idCardVerified[0] === true),
            borrower2: borrower2.name ? buildIdentityLock(borrower2, b2Payslips, allDeposits.filter(d => d.borrower_index === 1), b2IdExpired, bankStmtsCountForLock, idCardVerified[1] === true) : null,
            overall_status: 'green'
        };

        const statuses = [identityLock.borrower1.lock_status, identityLock.borrower2?.lock_status].filter(Boolean);
        if (statuses.includes('red')) identityLock.overall_status = 'red';
        else if (statuses.includes('yellow')) identityLock.overall_status = 'yellow';
        else identityLock.overall_status = 'green';

        // ── Identity Lock Guard Clause ──────────────────────────────────────────
        // כלל ברזל: תיק עם כשל זהות מאומת (red) לא יכול לקבל מעל דירוג D.
        // yellow = אי-התאמה חלקית → מוגבל ל-B- (62).
        // green (כולל fuzzy match) = ללא הגבלה.
        // זה מונע את הפרדוקס של A+ עם כשל ת.ז שמפורש ב-PDF.
        if (identityLock.overall_status === 'red' && adjustedFinalScore > 40) {
            const idPenalty = adjustedFinalScore - 40;
            adjustedFinalScore = 40;
            penalties += idPenalty;
            penaltyList.push({
                label: 'Identity Lock — כשל זהות קריטי (אדום)',
                points: `→ מקסימום 40 (דירוג D)`,
                detail: 'ת.ז לא תואמת בין מקורות / חסרה / פגת תוקף — אסור לאשר תיק ללא אימות זהות תקין'
            });
        } else if (identityLock.overall_status === 'yellow' && adjustedFinalScore > 62) {
            const idPenalty = adjustedFinalScore - 62;
            adjustedFinalScore = 62;
            penalties += idPenalty;
            penaltyList.push({
                label: 'Identity Lock — אי-התאמה חלקית בזהות (צהוב)',
                points: `→ מקסימום 62`,
                detail: 'מספר ת.ז בתלוש שונה מהת.ז בתיק — נדרש אימות ידני לפני הגשה לבנק'
            });
        }

        // ─────────────────────────────────────────────
        // שלב 8: התראות מנהלים
        // ─────────────────────────────────────────────
        if (conductScore === 0) redFlags.push({ severity: 'critical', category: 'התנהלות בנקאית', finding: hasConfirmedBouncedChecks ? 'דגלי BDI — חזרת צ\'ק / הוראת קבע (מאומת)' : hasWageGarnishment ? 'עיקול שכר פעיל' : 'כשל התנהלות בנקאי חמור', action_required: true });
        if (pti_with_proposed !== null && pti_with_proposed > 40) redFlags.push({ severity: 'high', category: 'כושר החזר', finding: `PTI ריאלי ${pti_with_proposed.toFixed(1)}% — חורג מ-40%`, action_required: true });
        if (b1IdExpired) redFlags.push({ severity: 'high', category: 'זהות', finding: `תעודת זהות פגת תוקף — ${borrower1.name || 'לווה 1'}`, action_required: true });
        if (b2IdExpired) redFlags.push({ severity: 'high', category: 'זהות', finding: `תעודת זהות פגת תוקף — ${borrower2.name || 'לווה 2'}`, action_required: true });
        if (hasGambling) redFlags.push({ severity: 'high', category: 'AML', finding: 'הימורים זוהו בדפי חשבון', action_required: true });
        // hasRealIdentityMismatch: מופעל רק אם יש mismatch אמיתי בנעילת הזהות (לא מצב yellow/green)
        // מצב yellow שנוצר ממספר עובד (null id) לא נחשב כשל זהות אמיתי
        const hasRealIdentityMismatch = identityLock.overall_status === 'red' &&
            [identityLock.borrower1, identityLock.borrower2].filter(Boolean)
            .some(b => b.lock_status === 'red');
        if (hasRealIdentityMismatch) redFlags.push({ severity: 'high', category: 'נעילת זהות', finding: 'אי-התאמה בנתוני זהות הלווה בין מקורות', action_required: true });

        (raw.bank_red_flags || []).forEach(f => { warnings.push({ category: 'עו"ש', finding: f }); });
        (raw.undisclosed_loan_indicators || []).forEach(ind => {
            // ── Insurance Buffer: פער < 10% בין חיוב בנק לדוח יתרות = ביטוח חיים/מבנה + הפרשי מדד ──
            const mortgagePmt = raw.existing_mortgage?.monthly_payment || 0;
            if (mortgagePmt > 0) {
                const amtMatch = (ind || '').match(/[\d,]+/);
                if (amtMatch) {
                    const indAmt = parseFloat(amtMatch[0].replace(/,/g, ''));
                    if (Math.abs(indAmt - mortgagePmt) / mortgagePmt < 0.10) return; // פער < 10% = ביטוח/מדד — מדלגים
                }
            }
            warnings.push({ category: 'הלוואה לא מדווחת', finding: ind });
        });

        if (totalLiquid > 100000) mitigants.push({ category: 'הון נזיל', finding: `₪${Math.round(totalLiquid).toLocaleString()} בקרנות ופקדונות — כרית ביטחון`, weight: 'high' });
        if (sen1 >= 10 || sen2 >= 10) mitigants.push({ category: 'יציבות תעסוקתית', finding: `ותק מעל 10 שנים — ${sen1 >= 10 ? borrower1.name || 'לווה 1' : borrower2.name || 'לווה 2'}`, weight: 'high' });
        if (unified_pti < 30 && total_income > 0) mitigants.push({ category: 'כושר החזר', finding: `PTI מאוחד ${unified_pti.toFixed(1)}% — נמוך ומצוין`, weight: 'high' });
        if (effectivePropertyValue > 0 && effectiveMortgageForLTV > 0 && ltvComputed < 45) mitigants.push({ category: 'בטחונות', finding: `LTV נמוך ${ltvComputed.toFixed(1)}% — ביטחון גבוה לבנק`, weight: 'high' });

        // ── Mitigant: נסח טאבו נקי ──
        if (raw.property?.tabu_clean === true || raw.tabu_no_liens === true) {
            mitigants.push({ category: 'בטחונות', finding: 'נסח טאבו נקי — אין שיעבודים נוספים מעבר למשכנתא המדווחת', weight: 'high' });
        }

        // ── Mitigant: קרן השתלמות — מקור אשראי אפשרי ──
        const accessibleKeren = (raw.keren_hishtalmut || []).filter(k => k.is_accessible && (k.accumulated_balance || 0) > 0);
        if (accessibleKeren.length > 0) {
            const kerenAccessibleTotal = accessibleKeren.reduce((s, k) => s + k.accumulated_balance, 0);
            const kerenCredit = Math.round(kerenAccessibleTotal * 0.70); // עד 70% כנגד הקרן
            mitigants.push({ category: 'נזילות', finding: `קרן השתלמות בשלה למשיכה — הון עצמי זמין. ניתן לקבל אשראי של עד ₪${kerenCredit.toLocaleString()} כנגד הקרן.`, weight: 'medium' });
        } else if ((raw.keren_hishtalmut || []).some(k => (k.accumulated_balance || 0) > 50000)) {
            mitigants.push({ category: 'נזילות', finding: 'קרן השתלמות בשלה למשיכה — הון עצמי זמין', weight: 'medium' });
        }

        // ── כיול אמינות: "פרדוקס השלמות" ──
        // מופעל לאחר שלב 8 (אחרי כל האזהרות מולאו) — Guard Clause מוחלט:
        // אם קיימות אזהרות כלשהן → ציון מקסימלי 97, עם קנס נוסף לפי מספר האותות.
        {
            const allWarningsNow = warnings; // כולל bank_red_flags שנוספו בשלב 8
            const shadowDebtCount = shadowDebts.length;
            const bankFlagCount = (raw.bank_red_flags || []).length;
            const creditCardWarnings = allWarningsNow.filter(w => w.category === 'אשראי' || w.category === 'כרטיסי אשראי').length;
            const totalSignals = allWarningsNow.length;

            if (totalSignals > 0) {
                // Cap מוחלט: אי אפשר לקבל מעל 97 עם כל אזהרה שהיא
                const hardCap = 97;
                // קנס נוסף: 2 נקודות לכל אות, עד 10 נקודות מקסימום
                const deduction = Math.min(10, totalSignals * 2);

                if (adjustedFinalScore > hardCap) {
                    const capReduction = adjustedFinalScore - hardCap;
                    adjustedFinalScore = hardCap;
                    penalties += capReduction;
                }
                // קנס נוסף על מספר האותות
                adjustedFinalScore = Math.max(0, adjustedFinalScore - deduction);
                penalties += deduction;
                penaltyList.push({
                    label: `כיול אמינות — ${totalSignals} אזהרות פעילות (Cap: 97)`,
                    points: `-${deduction}`,
                    detail: 'Guard Clause: ציון ≥97 אסור בנוכחות אזהרות — חתם מוסדי'
                });
            }
        }

        // ── Guard Clause: PTI מעל 40% — כיול ריאליסטי בנקאי ──
        // unified_pti_final = PTI כולל חובות צל — המשתנה הנכון לשימוש.
        if (unified_pti_final > 40 && total_income > 0) {
            let ptiCap;
            if (unified_pti_final >= 80) ptiCap = 25;
            else if (unified_pti_final >= 65) ptiCap = 40;
            else if (unified_pti_final >= 50) ptiCap = 50;
            else if (unified_pti_final >= 45 && hasChronicOverdraft) ptiCap = 55;
            else if (hasChronicOverdraft) ptiCap = 60;
            else ptiCap = 65;
            if (adjustedFinalScore > ptiCap) {
                const ptiPenalty = adjustedFinalScore - ptiCap;
                adjustedFinalScore = ptiCap;
                penalties += ptiPenalty;
                penaltyList.push({
                    label: `PTI Guard — יחס החזר ${unified_pti_final.toFixed(1)}% חורג מ-40% (כולל כאל/חובות צל)`,
                    points: `→ מקסימום ${ptiCap}`,
                    detail: `PTI ${unified_pti_final.toFixed(1)}% — שוקלל עם כל ההתחייבויות הריאליות. דירוג מוגבל.`
                });
            }
        }

        // ── ציון סופי ודירוג — אחרי כל הכיולים ──
        // Global_PTI = unified_pti — משתנה יחיד לכל הדוח. PTI > 40% חוסם דירוג A/A+.
        // ── ציון סופי ודירוג — unified_pti_final חוסם A/A+ אם מעל 40% ──
        const finalScore = adjustedFinalScore;
        if (finalScore >= 85 && unified_pti_final <= 40) { rating = 'A+'; ratingLabel = 'Fast Track — אישור מיידי'; ratingColor = 'green'; }
        else if (finalScore >= 70 && unified_pti_final <= 40) { rating = 'A';  ratingLabel = 'Standard — אישור בכפוף לתנאים'; ratingColor = 'green'; }
        else if (finalScore >= 85 && unified_pti_final > 40) { rating = 'B';  ratingLabel = 'PTI גבוה — נדרשת בדיקת מומחה'; ratingColor = 'yellow'; }
        else if (finalScore >= 65) { rating = 'B';  ratingLabel = 'Standard Review — בדיקת מומחה'; ratingColor = 'yellow'; }
        else if (finalScore >= 40) { rating = 'C';  ratingLabel = 'Conditional — אישור מותנה בביטחונות'; ratingColor = 'orange'; }
        else { rating = 'D'; ratingLabel = 'Decline / Escalate — דחייה'; ratingColor = 'red'; }

        // ─────────────────────────────────────────────
        // שלב 9: מסמכים חסרים — מסונכרן ישירות ל-Checklist
        // כלל: אם checklist מסמן 'present' — לא יופיע כ-missing, אפילו אם הלוגיקה הישנה חשבה אחרת.
        // ─────────────────────────────────────────────
        // *** Checklist נבנה קצת מוקדם יותר כדי לשמש את missingDocs ***
        // (buildChecklist יקרא שוב בשלב 4 בסוף, אך כבר כאן נצטרך ממנו)
        const _checklistForMissing = buildChecklist({
            raw, caseType, borrower1, borrower2,
            b1Payslips, b2Payslips,
            hasBusinessData, isRefinance, isQuickLoan,
            equity, b1IdExpired, b2IdExpired,
            ltvComputed, effectivePropertyValue,
            requestedMortgageAmount, loansToCloseAmount,
            existingMortgageBalanceWizard, idCardVerified
        });

        // missingDocs = רק פריטים שהחלקיסט מסמן כ-missing/partial ועם עדיפות critical/high
        const missingDocs = _checklistForMissing.items
            .filter(item => (item.status === 'missing' || item.status === 'partial') && (item.priority === 'critical' || item.priority === 'high'))
            .map(item => ({
                doc: item.label,
                priority: item.priority,
                note: item.note || null
            }));

        // שבתון — דגלים אדומים + חישוב PTI עתידי (תרחיש B)
        (raw.borrowers || []).forEach((b, i) => {
            const empType = (b.employment_type || '').toLowerCase();
            const statusNote = (b.special_status_note || '').toLowerCase();
            const isTempIncome = TEMP_INCOME_TYPES.some(t => empType.includes(t.toLowerCase()))
                || TEMP_INCOME_TYPES.some(t => statusNote.includes(t.toLowerCase()));
            if (!isTempIncome) return;
            const hasReturnLetter = !!(b.return_to_work_date || b._has_return_letter || b.return_to_work_confirmed);
            // ✅ שבתון מורים מאושר ע"י החתם — ההכנסה מוכרת ממענק הקרן; לא דורשים מכתב חזרה
            const teacherSabbApproved = b._teacher_sabbatical_approved === true || (b._sabbatical_income_override || 0) > 0;
            if (!hasReturnLetter && !teacherSabbApproved) {
                if (!redFlags.some(f => f.category === 'הכנסה זמנית' && f.finding.includes(b.name || ''))) {
                    redFlags.push({ severity: 'critical', category: 'הכנסה זמנית', finding: `${b.name || `לווה ${i+1}`} בשבתון/חל"ד — אין מכתב חזרה לעבודה. הכנסה מאופסת בחיתום.`, action_required: true });
                }
            } else if (teacherSabbApproved) {
                mitigants.push({ category: 'שבתון מאושר', finding: `${b.name || `לווה ${i+1}`} — שבתון מורים מאושר ע"י החתם. ההכנסה ממענק קרן ההשתלמות מוכרת כהכנסה קבועה.`, weight: 'high' });
            }

            // ── תרחיש B: PTI עתידי לאחר חזרה מהשבתון ──
            const returnDate = b.return_to_work_date || b.sabbatical_end_date || null;
            const preSabbaticalIncome = b._pre_sabbatical_net_income || 0;
            if (returnDate && preSabbaticalIncome > 0) {
                const otherIncome = i === 0 ? avg_income_2 : avg_income_1;
                const futureIncome = preSabbaticalIncome + otherIncome;
                const futurePTI = futureIncome > 0 ? (loans_total / futureIncome) * 100 : 0;
                if (futurePTI > 0 && futurePTI < unified_pti_final) {
                    mitigants.push({
                        category: 'תרחיש B — חזרה מהשבתון',
                        finding: `לאחר חזרת ${b.name || `לווה ${i+1}`} לעבודה (${returnDate}): הכנסה משוערת ₪${futureIncome.toLocaleString()} → PTI צפוי ${futurePTI.toFixed(1)}%`,
                        weight: futurePTI < 40 ? 'high' : 'medium'
                    });
                }
            }
        });

        // ─────────────────────────────────────────────
        // שלב 10: הרכבת ScoreObject
        // ─────────────────────────────────────────────
        const scoreObject = {
            generated_at: new Date().toISOString(),
            generated_for: today,
            case_type: caseType,

            // נתוני אשף הקליטה — לתצוגה בדשבורד
            intake_wizard: {
                caseType,
                contractPrice: contractPrice || null,
                requestedMortgageAmount: requestedMortgageAmount || null,
                equity: equity || null,
                estimatedPropertyValue: estimatedPropertyValue || null,
                existingMortgageBalance: existingMortgageBalanceWizard || null,
                loansToCloseAmount: loansToCloseAmount || null,
                requestedLoanAmount: requestedLoanAmountWizard || null,
                loanPurpose: loanPurposeWizard || null
            },

            kpi: {
                risk_score: finalScore,
                rating,
                rating_label: ratingLabel,
                rating_color: ratingColor,
                confidence_level,
                requires_manual_review: requiresManualReview,
                ltv: effectivePropertyValue > 0 && effectiveMortgageForLTV > 0 ? parseFloat(ltvComputed.toFixed(1)) : null,
                property_value: effectivePropertyValue > 0 ? Math.round(effectivePropertyValue) : null,
                ltv_pending_balance: effectivePropertyValue > 0 && !(effectiveMortgageForLTV > 0),
                pti_current: parseFloat(pti_ratio.toFixed(1)),
                pti_with_proposed: pti_with_proposed !== null ? parseFloat(pti_with_proposed.toFixed(1)) : null,
                pti_unified: parseFloat(unified_pti_final.toFixed(1)),
                stress_test_pti_plus1: stressTest ? stressTest.plus_1pct_pti : null,
                stress_test_pti_plus2: stressTest ? stressTest.plus_2pct_pti : null,
                stress_resilient: stressTest ? stressTest.is_resilient : null,
                coverage_months: assetCoverageRatio ? assetCoverageRatio.months_covered : null,
                verified_income: total_income,
                income_b1: avg_income_1,
                income_b2: avg_income_2,
                total_liabilities: Math.round(loans_total),
                available_for_mortgage: total_income > 0 ? Math.round(total_income * 0.40 - loans_total) : 0,
                max_allowed_payment: total_income > 0 ? Math.round(total_income * 0.40) : 0,
                // ── טבלת פירוט ההתחייבויות — כל הלוואה וכרטיס בנפרד (קריטי למחזור/איחוד) ──
                liability_breakdown: (() => {
                    const items = [...liabilityBreakdown];
                    if (raw.existing_mortgage?.monthly_payment > 0 || raw.existing_mortgage?.remaining_balance > 0) {
                        items.unshift({
                            label: `משכנתא קיימת — ${raw.existing_mortgage.bank_name || 'בנק'}`,
                            monthly: Math.round(raw.existing_mortgage.monthly_payment || 0),
                            balance: Math.round(raw.existing_mortgage.remaining_balance || 0),
                            type: 'mortgage',
                            marked_for_extinguishment: isRefinance,
                        });
                    }
                    return items;
                })(),
                proposed_monthly_payment: preCalcRefinancePayment > 0 ? Math.round(preCalcRefinancePayment) : null,

                // ── 🧠 PROACTIVE SOLVER — פותר התיקים: המנוע בונה הצעת איחוד אקטיבית ──
                // עובד תמיד כשזוהה דוח יתרות לסילוק / משכנתא קיימת — לא מחכה לתיוג ידני.
                // 1. מאגד את כל ההתחייבויות (משכנתא + הלוואות + כרטיסים).
                // 2. מחשב סכום סילוק כולל ופורס אותו במבחן לחץ (25 שנה / 5% או לפי גיל).
                // 3. מפיק Delta בין ההחזר הנוכחי לעתידי.
                proactive_solution: (() => {
                    // האם המערכת סרקה בסיס למחזור? (דוח יתרות / משכנתא קיימת / נתון מ-Modal)
                    const hasClearanceBasis = (raw.existing_mortgage?.remaining_balance > 0)
                        || (raw._mortgage_clearance_total > 0)
                        || (existingMortgageBalanceWizard > 0)
                        || (requestedMortgageAmount > 0 && isRefinance);

                    // ── שלב 1: Liability Aggregator — סך כל ההתחייבויות החודשיות הנוכחיות ──
                    let currentObligation = 0;
                    let aggregatedCount = 0;
                    if (raw.existing_mortgage?.monthly_payment > 0) { currentObligation += raw.existing_mortgage.monthly_payment; aggregatedCount++; }
                    liabilityBreakdown.forEach(it => {
                        // במחזור/איחוד — כל ההלוואות והכרטיסים שמיועדים לסילוק; אחרת רק המסומנים
                        const counts = isRefinance ? (it.type === 'loan' || it.type === 'credit_card' || it.marked_for_extinguishment) : it.marked_for_extinguishment;
                        if (counts && it.monthly > 0) { currentObligation += it.monthly; aggregatedCount++; }
                    });

                    // ── שלב 2: חישוב ההחזר המשוער (Stress-Tested) ──
                    // אם אין preCalcRefinancePayment (תיק לא תויג) — חשב אותו כאן מסך הסילוק.
                    let proposedPayment = preCalcRefinancePayment;
                    if (!(proposedPayment > 0) && hasClearanceBasis) {
                        const totalPayoff = requestedMortgageAmount > 0
                            ? requestedMortgageAmount
                            : (existingMortgageBalanceWizard || raw.existing_mortgage?.remaining_balance || raw._mortgage_clearance_total || 0)
                              + (loansToCloseAmount || 0);
                        if (totalPayoff > 0) {
                            const _r = effectiveRate / 100 / 12;
                            const _n = effectiveTermYears * 12;
                            proposedPayment = Math.round(totalPayoff * (_r * Math.pow(1 + _r, _n)) / (Math.pow(1 + _r, _n) - 1));
                        }
                    }

                    // אין בסיס למחזור (תיק רכישה טהור) או לא הצלחנו לחשב החזר — אין שורת כדאיות
                    if (!hasClearanceBasis || !(proposedPayment > 0) || currentObligation <= 0) return null;

                    // ✅ תיקון ג׳ — Fallback Rate: אם ב-5% ההחזר גבוה מהקיים (אין חיסכון),
                    // נסה ב-4.5% ואז ב-4.2% לפני שמוותרים על הצגת חיסכון
                    let finalProposedPayment = proposedPayment;
                    let finalEffectiveRate = effectiveRate;
                    if (proposedPayment >= currentObligation && rateIsAuto) {
                        const fallbackRates = [4.5, 4.2];
                        for (const fallbackRate of fallbackRates) {
                            const totalPayoff = requestedMortgageAmount > 0
                                ? requestedMortgageAmount
                                : (existingMortgageBalanceWizard || raw.existing_mortgage?.remaining_balance || raw._mortgage_clearance_total || 0)
                                  + (loansToCloseAmount || 0);
                            if (totalPayoff > 0) {
                                const _r = fallbackRate / 100 / 12;
                                const _n = effectiveTermYears * 12;
                                const fallbackPayment = Math.round(totalPayoff * (_r * Math.pow(1 + _r, _n)) / (Math.pow(1 + _r, _n) - 1));
                                if (fallbackPayment < currentObligation) {
                                    finalProposedPayment = fallbackPayment;
                                    finalEffectiveRate = fallbackRate;
                                    break;
                                }
                            }
                        }
                    }
                    const relief = Math.round(currentObligation - finalProposedPayment);
                    proposedPayment = finalProposedPayment;
                    const extinguishedCount = aggregatedCount;
                    return {
                        current_monthly: Math.round(currentObligation),
                        proposed_monthly: Math.round(proposedPayment),
                        monthly_relief: relief,
                        relief_is_positive: relief > 0,
                        extinguished_count: extinguishedCount,
                        // פרמטרים שהמנוע בחר אוטומטית
                        engine_rate: effectiveRate,
                        engine_term_years: effectiveTermYears,
                        rate_is_auto: rateIsAuto,
                        term_is_auto: termIsAuto,
                        older_borrower_age: olderBorrowerAge || null,
                        // ── ספירת הלוואות קצרות שנסגרות (לא משכנתא) ──
                        short_loans_count: liabilityBreakdown.filter(it =>
                            (it.type === 'loan' || it.type === 'credit_card') &&
                            (it.marked_for_extinguishment || isRefinance)
                        ).length,
                        // שורה תחתונה טקסטואלית מוכנה לתצוגה — מדגישה סגירת הלוואות, לא פריסה
                        bottom_line: (() => {
                            const shortLoansCount = liabilityBreakdown.filter(it =>
                                (it.type === 'loan' || it.type === 'credit_card') &&
                                (it.marked_for_extinguishment || isRefinance)
                            ).length;
                            if (relief > 0) {
                                let line = shortLoansCount > 0
                                    ? `סגירת ${shortLoansCount} הלוואות/כרטיסי אשראי שוטפים ויצירת חיסכון חודשי של ₪${relief.toLocaleString('he-IL')} — מהחזר ₪${Math.round(currentObligation).toLocaleString('he-IL')} להחזר ₪${Math.round(finalProposedPayment).toLocaleString('he-IL')}.`
                                    : `איחוד וסילוק — מהחזר ₪${Math.round(currentObligation).toLocaleString('he-IL')} להחזר ₪${Math.round(finalProposedPayment).toLocaleString('he-IL')}. חיסכון חודשי של ₪${relief.toLocaleString('he-IL')}.`;
                                if (olderBorrowerAge > 0) line += ` (פריסה ל-${effectiveTermYears} שנה לפי גיל לווה מבוגר — ${olderBorrowerAge})`;
                                return line;
                            }
                            return `ההחזר המשוער ₪${Math.round(finalProposedPayment).toLocaleString('he-IL')} גבוה מהנוכחי ₪${Math.round(currentObligation).toLocaleString('he-IL')} — מומלץ לבחון קיצור תקופה או הגדלת הון עצמי.`;
                        })(),
                        condition_note: rateIsAuto || termIsAuto
                            ? `ריבית: קל"צ בנק ישראל ${KAL_TSEMED_BASE}% + מרווח סיכון ${RISK_SPREAD}% = ${finalEffectiveRate}%${finalEffectiveRate !== effectiveRate ? ' (Fallback — ריבית 6.2% לא ייצרה חיסכון)' : ''}. פריסה ל-${effectiveTermYears} שנה${olderBorrowerAge ? ` (גיל לווה מבוגר ${olderBorrowerAge})` : ''}.`
                            : null,
                    };
                })(),
            },

            riskAnalysis: {
                weights_used: WEIGHTS,
                pillars: {
                    financial: {
                        score: financialScore,
                        weighted: parseFloat((financialScore * WEIGHTS.financial).toFixed(1)),
                        weight: WEIGHTS.financial,
                        evidence: [
                            ...financialEvidence,
                            ...(stressTest ? [
                                { label: 'Stress Test +1%', value: `PTI ${stressTest.plus_1pct_pti}%`, flag: stressTest.plus_1pct_pti < 40 ? 'positive' : 'warning' },
                                { label: 'Stress Test +2%', value: `PTI ${stressTest.plus_2pct_pti}% — ${stressTest.resilience_label}`, flag: stressTest.is_resilient ? 'positive' : 'critical' }
                            ] : []),
                            ...(assetCoverageRatio ? [
                                { label: 'כיסוי נזילות', value: assetCoverageRatio.coverage_label, flag: assetCoverageRatio.is_strong ? 'positive' : 'warning' }
                            ] : []),
                            ...(shadowDebts.length > 0 ? [
                                { label: 'חובות צל חשודים', value: `${shadowDebts.length} תשלומים חוזרים לא מזוהים`, flag: 'warning' }
                            ] : [])
                        ],
                        pillar_insight: (() => {
                            const baseTxt = financialScore >= 80
                                ? `ציון גבוה בזכות יחס החזר נמוך (PTI ${unified_pti_final.toFixed(1)}%)`
                                : financialScore >= 60
                                ? `יחס החזר גבולי (PTI ${unified_pti_final.toFixed(1)}%) — נדרש מעקב`
                                : `יחס החזר חורג (PTI ${unified_pti_final.toFixed(1)}%) — כושר החזר מוגבל`;
                            const stressTxt = stressTest ? ` | ${stressTest.resilience_label} (PTI +2%: ${stressTest.plus_2pct_pti}%)` : '';
                            const coverageTxt = assetCoverageRatio ? ` | כיסוי נזילות: ${assetCoverageRatio.months_covered} חודשים` : '';
                            return baseTxt + stressTxt + coverageTxt;
                        })()
                    },
                    collateral: {
                        score: collateralScore,
                        weighted: parseFloat((collateralScore * WEIGHTS.collateral).toFixed(1)),
                        weight: WEIGHTS.collateral,
                        evidence: collateralEvidence,
                        pillar_insight: effectivePropertyValue > 0
                            ? (collateralScore >= 80
                                ? `LTV נמוך (${ltvComputed.toFixed(1)}%) — ביטחון גבוה לבנק`
                                : collateralScore >= 50
                                ? `LTV בינוני (${ltvComputed.toFixed(1)}%) — שווי נכס ₪${Math.round(effectivePropertyValue / 1000)}K`
                                : `LTV גבוה (${ltvComputed.toFixed(1)}%) — סיכון בטחונות מוגבר`)
                            : `אין נכס בתיק — עמוד זה לא רלוונטי לסוג עסקה זה`
                    },
                    stability: {
                        score: stabilityScore,
                        weighted: parseFloat((stabilityScore * WEIGHTS.stability).toFixed(1)),
                        weight: WEIGHTS.stability,
                        evidence: stabilityEvidence,
                        pillar_insight: stabilityScore >= 80
                            ? `יציבות תעסוקתית מצוינת — ותק ממוצע ${avgSeniority.toFixed(1)} שנים`
                            : stabilityScore >= 40
                            ? `ותק סביר — ${avgSeniority.toFixed(1)} שנים ממוצע`
                            : `ציון מופחת עקב ותק נמוך מ-2 שנים במקום העבודה הנוכחי`
                    },
                    conduct: {
                        score: conductScore,
                        weighted: parseFloat((conductScore * WEIGHTS.conduct).toFixed(1)),
                        weight: WEIGHTS.conduct,
                        evidence: conductEvidence,
                        pillar_insight: conductScore >= 90
                            ? `התנהלות בנקאית תקינה — אין דגלים אדומים בעו"ש`
                            : conductScore >= 50
                            ? `חריגות קלות בעו"ש — נדרשת בדיקת רקע משלימה`
                            : conductOverrideActive
                            ? `Conduct Override פעיל — כשל בנקאי חמור זוהה (BDI/עיקול)`
                            : `דגלי עו"ש — נדרשת בדיקת AML מעמיקה`
                    }
                },
                raw_score: parseFloat(rawScore.toFixed(1)),
                bonuses,
                penalties,
                bonus_list: bonusList,
                penalty_list: penaltyList,
                final_score: finalScore
            },

            identityVerification: identityLock,

            executiveAlerts: {
                red_flags: redFlags,
                warnings: warnings.slice(0, 10),
                mitigants,
                missing_docs: missingDocs,
                alert_summary: {
                    critical_count: redFlags.filter(f => f.severity === 'critical').length,
                    high_count: redFlags.filter(f => f.severity === 'high').length,
                    warning_count: warnings.length,
                    mitigant_count: mitigants.length
                }
            },

            borrowers: {
                borrower1: {
                    name: borrower1.name,
                    id_masked: borrower1.id ? `****${(borrower1.id || '').slice(-3)}` : null,
                    employer: borrower1.employer,
                    employment_type: borrower1.employment_type,
                    seniority_years: sen1,
                    age: borrower1.age,
                    monthly_income: avg_income_1,
                    payslips_count: b1Payslips.length,
                    // נתוני תלושים לגרף מגמות הכנסה
                    income_trend: b1Payslips.map(p => ({ month: `${p.month || ''}/${p.year || ''}`, net: p.net_salary || 0 })).filter(p => p.net > 0)
                },
                borrower2: borrower2.name ? {
                    name: borrower2.name,
                    id_masked: borrower2.id ? `****${(borrower2.id || '').slice(-3)}` : null,
                    employer: borrower2.employer,
                    employment_type: borrower2.employment_type,
                    seniority_years: sen2,
                    age: borrower2.age,
                    monthly_income: avg_income_2,
                    payslips_count: b2Payslips.length,
                    income_trend: b2Payslips.map(p => ({ month: `${p.month || ''}/${p.year || ''}`, net: p.net_salary || 0 })).filter(p => p.net > 0)
                } : null
            },

            stressTest,
            assetCoverageRatio,
            shadowDebts: shadowDebts.length > 0 ? shadowDebts : null,
            existingMortgage: isRefinance ? raw.existing_mortgage : null,
            refinanceImpact: null,
            documents: docVerification.docs
        };

        // ── שלב 3: חישוב refinanceImpact עם ריבית בנצ'מרק חיה (async) ──
        if (isRefinance || caseType === 'debt_consolidation') {
            let effectiveProposedMonthlyPayment = proposedMonthlyPayment;
            let usedBenchmarkRate = 4.74; // fallback: ריבית קבועה לא צמודה — אפריל 2026

            // ── CHANNEL FIX: השתמש בריבית יעד + תקופה + סכום מבוקש מה-Modal ──
            if ((!effectiveProposedMonthlyPayment || effectiveProposedMonthlyPayment <= 0) && targetInterestRate > 0 && loanTermYears > 0) {
                const totalRefinanceAmount = requestedMortgageAmount > 0
                    ? requestedMortgageAmount
                    : (existingMortgageBalanceWizard || raw.existing_mortgage?.remaining_balance || 0) + (loansToCloseAmount || 0);
                if (totalRefinanceAmount > 0) {
                    usedBenchmarkRate = targetInterestRate;
                    const _r = targetInterestRate / 100 / 12;
                    const _n = loanTermYears * 12;
                    effectiveProposedMonthlyPayment = Math.round(totalRefinanceAmount * (_r * Math.pow(1 + _r, _n)) / (Math.pow(1 + _r, _n) - 1));
                }
            }
            if (!effectiveProposedMonthlyPayment || effectiveProposedMonthlyPayment <= 0) {
                const totalRefinanceAmount = (existingMortgageBalanceWizard || raw.existing_mortgage?.remaining_balance || 0) + (loansToCloseAmount || 0);
                if (totalRefinanceAmount > 0) {
                    try {
                        const boiRes = await fetch('https://www.boi.org.il/roles/monetarypolicy/interestrate/', {
                            signal: AbortSignal.timeout(4000)
                        });
                        const boiHtml = await boiRes.text();
                        const match = boiHtml.match(/סך\s+המערכת[\s\S]{0,400}?(\d+\.\d+)/);
                        if (match && match[1]) {
                            const parsed = parseFloat(match[1]);
                            if (parsed >= 2.0 && parsed <= 12.0) usedBenchmarkRate = parsed;
                        }
                    } catch (_) { /* fallback בשקט */ }

                    const r = usedBenchmarkRate / 100 / 12;
                    const n = 240;
                    effectiveProposedMonthlyPayment = Math.round(totalRefinanceAmount * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1));
                }
            }

            if (effectiveProposedMonthlyPayment > 0) {
                const liabilitiesObj = raw.liabilities || null;
                let currentTotalMonthly = 0;
                let liabilityItems = [];

                if (liabilitiesObj?.total_monthly_repayment) {
                    currentTotalMonthly = liabilitiesObj.total_monthly_repayment;
                    if (Array.isArray(liabilitiesObj.items)) {
                        liabilityItems = liabilitiesObj.items.map(item => ({
                            label: item.description || item.type || 'התחייבות',
                            monthly: item.monthly_repayment || item.monthly_payment || 0,
                            type: item.type || 'other',
                            institution: item.institution || null,
                        }));
                    }
                } else {
                    // ── Loan Aggregator: סכם כל ההלוואות מריכוז היתרות (כולל < 18 חודשים ב-refinance) ──
                    // FIX: ב-refinance כולל הלוואות קצרות כי כולן נסגרות
                    (raw.loans || []).forEach(loan => {
                        if (loan._from_liability_crawler) return;
                        const monthly = loan.monthly_payment || 0;
                        currentTotalMonthly += monthly;
                        if (monthly > 0) liabilityItems.push({ label: loan.name || loan.lender || loan.description || 'הלוואה', monthly, type: 'loan' });
                    });
                    if (raw.existing_mortgage?.monthly_payment) {
                        currentTotalMonthly += raw.existing_mortgage.monthly_payment;
                        liabilityItems.push({ label: `משכנתא — ${raw.existing_mortgage.bank_name || 'בנק'}`, monthly: raw.existing_mortgage.monthly_payment, type: 'mortgage' });
                    }
                    currentTotalMonthly += raw.alimony_monthly || 0;
                    currentTotalMonthly += raw.child_support_monthly || 0;
                    currentTotalMonthly += raw.car_lease_monthly || 0;
                }

                const monthlySavings = currentTotalMonthly - effectiveProposedMonthlyPayment;
                const currentPTI = total_income > 0 ? (currentTotalMonthly / total_income) * 100 : 0;
                const improvedPTI = total_income > 0 ? (effectiveProposedMonthlyPayment / total_income) * 100 : 0;
                const consolidatedLoans = liabilityItems.filter(i => i.type === 'loan' || i.type === 'credit_card').map(i => i.label);
                const savingsFormatted = Math.abs(Math.round(monthlySavings)).toLocaleString('he-IL');
                const ptiDrop = (currentPTI - improvedPTI).toFixed(1);
                const isEstimated = !proposedMonthlyPayment || proposedMonthlyPayment <= 0;
                let economicJustification = monthlySavings > 0
                    ? `המיחזור המוצע מייצר הקלה תזרימית של ₪${savingsFormatted} בחודש ומשפר את יחס ההחזר (PTI) מ-${currentPTI.toFixed(1)}% ל-${improvedPTI.toFixed(1)}% — ירידה של ${ptiDrop} נקודות אחוז.${isEstimated ? ` (חישוב אומדן בריבית ${usedBenchmarkRate}% ל-20 שנה — בנק ישראל)` : ''}`
                    : `ההחזר החודשי המוצע גבוה מסך ההתחייבויות הנוכחיות — יש לבחון מחדש את תנאי העסקה.`;
                if (monthlySavings > 0 && consolidatedLoans.length > 0) {
                    economicJustification += ` נסגרות ${consolidatedLoans.length} הלוואות קיימות, מה שמפשט את מבנה ההתחייבויות.`;
                }

                scoreObject.refinanceImpact = {
                    current_total_monthly: Math.round(currentTotalMonthly),
                    proposed_monthly_payment: Math.round(effectiveProposedMonthlyPayment),
                    monthly_savings: Math.round(monthlySavings),
                    current_pti: parseFloat(currentPTI.toFixed(1)),
                    improved_pti: parseFloat(improvedPTI.toFixed(1)),
                    net_income: total_income,
                    liability_items: liabilityItems,
                    consolidated_loans: consolidatedLoans,
                    economic_justification: economicJustification,
                    is_estimated: isEstimated,
                    benchmark_rate_used: usedBenchmarkRate,
                };
            }
        }

        // ── שלב 3: PTI Sanity Check — בקרת עקביות בין ריצות (כמו buildQuickReport) ──
        // אם ה-PTI השתנה ביותר מ-5% מהריצה הקודמת — מוסיפים דגל אדום קריטי
        const previousPTI = raw._previous_quick_pti || null;
        if (previousPTI !== null && Math.abs(unified_pti_final - previousPTI) > 5) {
            redFlags.push({
                severity: 'critical',
                category: 'Sanity Check — סתירה בין דוחות',
                finding: `PTI השתנה ${previousPTI.toFixed(1)}% → ${unified_pti_final.toFixed(1)}% (הפרש ${Math.abs(unified_pti_final - previousPTI).toFixed(1)}%). ייתכן שנתוני התחייבויות שונים הוזנו בין ריצות.`,
                action_required: true
            });
        }

        // ── שלב 4: Checklist Sync — רשימת תיעוד מסונכרנת ──
        const checklist = buildChecklist({
            raw, caseType, borrower1, borrower2,
            b1Payslips, b2Payslips,
            hasBusinessData, isRefinance, isQuickLoan,
            equity, b1IdExpired, b2IdExpired,
            ltvComputed, effectivePropertyValue,
            requestedMortgageAmount, loansToCloseAmount,
            existingMortgageBalanceWizard, idCardVerified
        });
        scoreObject.checklist = checklist;

        // ── Executive Summary: מועבר מ-extractDocData דרך normalizedData ──
        // נכתב post-merge על ידי Claude Sonnet — מוצג בראש הדוח המוסדי.
        if (raw.executive_summary) {
            scoreObject.executive_summary = raw.executive_summary;
        }

        return Response.json(scoreObject);

    } catch (error) {
        console.error('buildUnderwriterReport שגיאה:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
  }),
};