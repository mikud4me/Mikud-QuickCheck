// ────────────────────────────────────────────────────────────────────────────
// Deterministic rules applied to preScanDocuments' LLM classification output.
// The model's only job is to classify what it sees in the uploaded files
// (found_documents, has_* flags, identity fields); every judgment call about
// what that means — an expired ID, a spouse known only from a ספח, a missing
// document — is a fixed rule here, not asked of the model. Same input always
// produces the same output, run to run.
// ────────────────────────────────────────────────────────────────────────────

// Normalize an Israeli ID to a 9-digit string for comparison.
function normId(id) {
    if (!id) return '';
    const digits = String(id).replace(/\D/g, '');
    return digits.padStart(9, '0');
}

// Parse an Israeli-format date (DD/MM/YYYY or DD.MM.YYYY).
function parseIsraeliDate(dateStr) {
    if (!dateStr) return null;
    const s = String(dateStr).replace(/\./g, '/').trim();
    const parts = s.split('/');
    if (parts.length !== 3) return null;
    const [d, m, y] = parts.map(Number);
    const year = y < 100 ? 2000 + y : y;
    const date = new Date(year, m - 1, d);
    return isNaN(date.getTime()) ? null : date;
}

// תיאור אחיד וקבוע לבן/בת זוג שמוזכר/ת בספח בלבד (לא הועלה מסמך ת.ז עצמאי משלו/שלה) — משמש
// בכל מקום שמתאר את המצב הזה (warnings, missing_critical, found_documents details) כך שהניסוח
// לא משתנה בין הרצה להרצה. מבחין באופן קבוע בין "מוזכר/ת בספח בלבד" לבין "מוזכר/ת בספח יחד עם
// ילדי המשפחה" — ospach-ים ישראליים מרובים כוללים גם ילדים לצד בן/בת הזוג; ילדים לעולם אינם
// צריכים ת.ז עצמאית, אבל הניסוח צריך בכל זאת לתאר נכון מה מופיע בעמוד.
function describeSpouseMention(spouse) {
    const name = spouse.full_name || 'בן/בת הזוג';
    const idPart = spouse.id_number ? ` (ת.ז ${spouse.id_number})` : '';
    const base = spouse.children_also_listed
        ? `${name}${idPart} מוזכר/ת בספח יחד עם ילדי המשפחה`
        : `${name}${idPart} מוזכר/ת בספח`;
    return spouse.mentioned_on ? `${base} של ${spouse.mentioned_on}` : base;
}

// ─────────────────────────────────────────────────────────────────────────────
// Identity Lock — deterministic analysis (no LLM)
// ─────────────────────────────────────────────────────────────────────────────
export function buildIdentityLock(scanResult) {
    const issues = [];
    const warnings = [];
    const verifiedItems = [];
    const missingCriticalAdditions = [];
    const idCards = scanResult.id_cards_found || [];
    const payslipIdentities = scanResult.payslip_identities || [];
    const bankHolders = scanResult.bank_account_holders || [];
    const spouseMentions = scanResult.spouse_mentioned_on_sepach || [];

    const today = new Date();

    // ── Check 1: ID Card expiry ──
    idCards.forEach((card, i) => {
        const label = card.full_name || `ת.ז ${i + 1}`;
        const normCardId = normId(card.id_number);

        if (!card.id_number || normCardId.replace(/^0+/, '').length < 7) {
            warnings.push({
                type: 'missing_id_number',
                severity: 'warning',
                message: `מספר ת.ז לא נמצא בתעודת הזהות של ${label}`,
                borrower: label
            });
        }

        if (card.id_expiry_date) {
            const expiry = parseIsraeliDate(card.id_expiry_date);
            if (expiry) {
                if (expiry < today) {
                    issues.push({
                        type: 'expired_id',
                        severity: 'critical',
                        message: `תעודת זהות פגת תוקף — ${label} (פגה: ${card.id_expiry_date})`,
                        borrower: label,
                        expiry_date: card.id_expiry_date
                    });
                } else {
                    // Check if expiry is within 3 months
                    const monthsLeft = (expiry - today) / (1000 * 60 * 60 * 24 * 30);
                    if (monthsLeft < 3) {
                        warnings.push({
                            type: 'expiring_id_soon',
                            severity: 'warning',
                            message: `תעודת זהות קרובה לפוג תוקף — ${label} (פוגה: ${card.id_expiry_date})`,
                            borrower: label,
                            expiry_date: card.id_expiry_date
                        });
                    } else {
                        verifiedItems.push({ type: 'id_valid', message: `ת.ז בתוקף — ${label}`, borrower: label });
                    }
                }
            }
        } else {
            warnings.push({
                type: 'missing_expiry',
                severity: 'warning',
                message: `תאריך תפוגת ת.ז לא נמצא — ${label}`,
                borrower: label
            });
        }

        // ── Check 2: Cross-match ID number with payslips ──
        if (normCardId) {
            const matchingPayslip = payslipIdentities.find(p => {
                const normPayslipId = normId(p.employee_id);
                return normPayslipId && normPayslipId === normCardId;
            });

            if (payslipIdentities.length > 0 && !matchingPayslip) {
                // Check by name similarity instead
                const nameSimilarity = payslipIdentities.some(p => {
                    if (!p.employee_name || !card.full_name) return false;
                    const cardWords = card.full_name.trim().split(/\s+/);
                    const payslipWords = p.employee_name.trim().split(/\s+/);
                    const matches = cardWords.filter(w => w.length > 1 && payslipWords.some(pw => pw.includes(w) || w.includes(pw)));
                    return matches.length >= Math.min(2, cardWords.length);
                });

                if (!nameSimilarity) {
                    warnings.push({
                        type: 'id_not_in_payslips',
                        severity: 'warning',
                        message: `לא נמצא תלוש שכר עם ת.ז תואמת לזו של ${label}`,
                        borrower: label
                    });
                } else {
                    verifiedItems.push({ type: 'name_match', message: `שם ${label} תואם לתלושי השכר`, borrower: label });
                }
            } else if (matchingPayslip) {
                verifiedItems.push({ type: 'id_match', message: `ת.ז ${normCardId.slice(-3).padStart(normCardId.length, '*')} מאומתת מול תלוש שכר`, borrower: label });
            }
        }

        // ── Check 3: Cross-match name with bank statements ──
        if (card.full_name && bankHolders.length > 0) {
            const cardWords = card.full_name.trim().split(/\s+/).filter(w => w.length > 1);
            const bankMatch = bankHolders.some(holder => {
                if (!holder) return false;
                const holderWords = holder.trim().split(/\s+/);
                const matches = cardWords.filter(w => holderWords.some(hw => hw.includes(w) || w.includes(hw)));
                return matches.length >= Math.min(2, cardWords.length);
            });

            if (!bankMatch) {
                warnings.push({
                    type: 'name_not_in_bank',
                    severity: 'warning',
                    message: `שם ${label} לא נמצא כבעל החשבון בדפי הבנק — דורש אימות ידני`,
                    borrower: label
                });
            }
        }
    });

    // ── Check 3b: Spouse named on a ספח but not independently verified ──
    // (mentioned_on the primary holder's document, own ID number known but their own
    // ID card/ספח was never uploaded — must not be conflated with a verified id_card)
    spouseMentions.forEach((spouse) => {
        const label = spouse.full_name || 'בן/בת הזוג';
        const normSpouseId = normId(spouse.id_number);
        const alreadyHasOwnIdCard = normSpouseId && idCards.some(card => normId(card.id_number) === normSpouseId);

        if (!alreadyHasOwnIdCard) {
            warnings.push({
                type: 'spouse_mentioned_not_verified',
                severity: 'warning',
                message: `${describeSpouseMention(spouse)} — לא הועלה עבורו/ה מסמך תעודת זהות עצמאי`,
                borrower: label
            });
            // ── דטרמיניסטי, לא תלוי בהחלטת ה-LLM ──
            // "מסמכים חסרים" (missing_critical) הוא שדה שהיה בעבר בשליטת ה-LLM, וזה בדיוק
            // מה שגרם לחוסר עקביות: לפעמים המודל בחר להוסיף "נדרשת ת.ז עצמאית לבן/בת הזוג",
            // לפעמים לא — למרות שבשני המקרים spouse_mentioned_on_sepach זיהה נכון שאין
            // עדיין תעודת זהות עצמאית. כדי שהתוצאה תהיה עקבית בכל הרצה, מוסיפים כאן את
            // הפריט לרשימת החוסרים באופן דטרמיניסטי, ולא סומכים על כך שה-LLM יזכור. הניסוח
            // עצמו מגיע מ-describeSpouseMention כדי שיהיה זהה בכל מקום שמתאר את המצב הזה.
            missingCriticalAdditions.push({
                label,
                text: `תעודת זהות עצמאית — ${describeSpouseMention(spouse)}`
            });
        }
    });

    // ── Check 4: Payslip-to-payslip name consistency ──
    if (payslipIdentities.length >= 2) {
        const uniqueNames = [...new Set(payslipIdentities.map(p => (p.employee_name || '').trim()).filter(Boolean))];
        if (uniqueNames.length > 2) {
            warnings.push({
                type: 'multiple_names_in_payslips',
                severity: 'warning',
                message: `נמצאו יותר מ-2 שמות שונים בתלושי השכר — ייתכן ערבוב מסמכים`,
                borrower: 'כללי'
            });
        }
    }

    // ── Overall status ──
    let overall_status = 'ok';
    if (issues.some(i => i.severity === 'critical')) {
        overall_status = 'critical';
    } else if (issues.length > 0 || warnings.length > 0) {
        overall_status = 'warning';
    } else if (idCards.length === 0) {
        overall_status = 'no_id';
    }

    return {
        overall_status,
        issues,
        warnings,
        verified_items: verifiedItems,
        id_cards_count: idCards.length,
        summary: (() => {
            if (overall_status === 'critical') return `🔴 בעיית זהות קריטית — ${issues[0]?.message}`;
            if (overall_status === 'warning') return `⚠️ ${warnings.length} אזהרות זהות — דורש בדיקה לפני ניתוח`;
            if (overall_status === 'no_id') return `⚠️ לא הועלתה תעודת זהות — מומלץ לצרף לפני ניתוח`;
            return `✅ אימות זהות תקין — ${verifiedItems.length} פריטים אומתו`;
        })(),
        _missingCriticalAdditions: missingCriticalAdditions
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Missing-documents checklist — deterministic (no LLM). Fixed rules applied to
// the model's classification output (found_documents / has_* flags / suggested
// report type / identity data) — the model itself is never asked to decide
// what's missing, so the same uploaded files always produce the same list.
// ─────────────────────────────────────────────────────────────────────────────
export function computeMissingCritical(scanResult, identityLock) {
    const missing = [];
    const foundTypes = new Set((scanResult.found_documents || []).map(d => d.type));
    const reportTypes = [
        ...(scanResult.suggested_report_type ? [scanResult.suggested_report_type] : []),
        ...(scanResult.additional_suggested_types || [])
    ];

    // ── תעודת זהות — ליבה, נדרש בכל תיק ──
    if (!scanResult.has_id_card || !(scanResult.id_cards_found || []).length) {
        missing.push('תעודת זהות');
    }

    // ── בני/בנות זוג שזוהו בספח ללא ת.ז עצמאית משלהם/ן (מחושב ב-buildIdentityLock) ──
    (identityLock._missingCriticalAdditions || []).forEach(({ text }) => {
        missing.push(text);
    });

    // ── הוכחת הכנסה: תלוש שכר / שומת מס / מכתב רו"ח / תלוש פנסיה ──
    const hasIncomeProof = foundTypes.has('payslip') || foundTypes.has('tax_assessment') ||
        foundTypes.has('cpa_letter') || foundTypes.has('pension_slip');
    if (!hasIncomeProof) {
        missing.push('מסמכי הכנסה (תלושי שכר / שומת מס / תלוש פנסיה)');
    }
    if (scanResult.has_business_indicator && !foundTypes.has('tax_assessment') && !foundTypes.has('cpa_letter')) {
        missing.push('שומת מס ומכתב רו"ח (לבעל עסק / עצמאי)');
    }

    // ── דפי עובר ושב ──
    if (!scanResult.has_bank_statements) {
        missing.push('דפי עובר ושב');
    }

    // ── דרישות ספציפיות לפי סוג התיק שזוהה ──
    if ((reportTypes.includes('מחזור משכנתא') || reportTypes.includes('מיחזור משכנתא ואיחוד חובות')) && !scanResult.has_mortgage_balance) {
        missing.push('אישור יתרת סילוק למשכנתא קיימת');
    }
    if (reportTypes.includes('רכישת נכס חדש') && !foundTypes.has('property_doc')) {
        missing.push('מסמכי נכס (הסכם רכישה / נסח טאבו)');
    }
    if (reportTypes.includes('גיל הזהב') && !foundTypes.has('pension_slip')) {
        missing.push('תלוש פנסיה / קצבה');
    }

    // ── לווה שני שזוהה בתיק, אך אין לו הוכחת הכנסה נפרדת ──
    const borrowersDetected = Math.max(scanResult.num_borrowers_detected || 0, (scanResult.borrower_names || []).length);
    const payslipNames = new Set((scanResult.payslip_identities || []).map(p => (p.employee_name || '').trim()).filter(Boolean));
    if (borrowersDetected >= 2 && hasIncomeProof && payslipNames.size < 2) {
        missing.push('מסמכי הכנסה עבור הלווה/ת השני/ה בתיק');
    }

    return missing;
}

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic "details" text for the id_card entry in found_documents.
//
// The model's free-text "details" for this entry is exactly the kind of thing
// that caused the original reported bug: even when id_cards_found and
// spouse_mentioned_on_sepach correctly classify who the primary holder is vs.
// who's merely named on their ספח, the model can still phrase the free-text
// description ambiguously (e.g. "ת.ז. כולל ספח של X ו-Y", reading as if both
// people's IDs were verified). Since the structured fields are already
// correct and deterministic, this text is built directly from them instead
// of trusting the model's prose — same principle as computeMissingCritical.
// ─────────────────────────────────────────────────────────────────────────────
export function buildIdCardDetails(scanResult) {
    const idCards = scanResult.id_cards_found || [];
    const spouseMentions = scanResult.spouse_mentioned_on_sepach || [];
    if (!idCards.length && !spouseMentions.length) return null;

    const parts = [];
    idCards.forEach(card => {
        const name = card.full_name || 'לווה';
        parts.push(`${name}${card.id_number ? ` (ת.ז ${card.id_number})` : ''} — תעודת זהות עצמאית אומתה`);
    });
    spouseMentions.forEach(spouse => {
        parts.push(`${describeSpouseMention(spouse)}, ת.ז עצמאית לא הועלתה`);
    });
    return parts.join(' | ');
}
