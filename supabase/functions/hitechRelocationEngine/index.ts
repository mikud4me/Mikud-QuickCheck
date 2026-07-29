import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
/**
 * hitechRelocationEngine — Deterministic Hi-Tech / Relocation Fixer
 *
 * Runs AFTER normalizeDocData and BEFORE buildQuickReport.
 * Fixes 4 extraction-gap bugs that the AI layer leaves behind, working only on
 * fields that actually exist in the real (Yelena) payload:
 *
 *  BUG 4 — Relocation: two payslips with a shared employer root (Cisco Israel /
 *          Cisco International) = global employment continuity, NOT dual income.
 *          We canonicalize the employer name on all of that borrower's payslips
 *          so buildQuickReport's checkDualEmployer / checkEmployerStability never
 *          fire "כפל הכנסה" / "שינוי מעסיק". Foreign-currency slips already carry
 *          _skip_in_avg from normalizeDocData, so the +197% salary-jump alert is
 *          also defused once the employer is unified.
 *
 *  BUG 2 — ESPP Add-Back: if the AI put ESPP in the payslip note instead of the
 *          espp_deduction field, extract it into espp_deduction so calcAvgNet
 *          adds it back to net income.
 *
 *  BUG 3 — Bilingual name: if a bank statement / cash-flow holder name fuzzy-
 *          matches a borrower (Hebrew tokens inside an English "Account Name:"
 *          header), strip the "name not verified" red flags + recommendations.
 */

export default {
  fetch: withSupabase({ auth: ["publishable"] }, async (req, ctx) => {
    try {
        const payload = await req.json();
        const rawData = payload.rawData;
        if (!rawData) return Response.json({ error: 'rawData is required' }, { status: 400 });

        const log = [];

        // Hebrew<->English transliteration map for global hi-tech employers.
        // Lets us recognise "Cisco International" ≡ "סיסקו סיסטמס ישראל" as one company.
        const TRANSLIT = [
            ['cisco', 'סיסקו'], ['microsoft', 'מיקרוסופט'], ['intel', 'אינטל'], ['google', 'גוגל'],
            ['amazon', 'אמזון'], ['apple', 'אפל'], ['meta', 'מטא'], ['facebook', 'פייסבוק'],
            ['nvidia', 'נבידיה'], ['ibm', 'איביאם'], ['oracle', 'אורקל'], ['salesforce', 'סיילספורס'],
            ['wix', 'וויקס'], ['monday', 'מאנדיי'], ['checkpoint', 'צ׳ק פוינט'], ['mobileye', 'מובילאיי'],
            ['paypal', 'פייפאל'], ['ebay', 'איביי'], ['dell', 'דל'], ['hp', 'אייצpי'], ['sap', 'אספי']
        ];
        // canonicalize: map any known brand (in either language) to a single English key
        const brandKey = (name) => {
            const low = (name || '').toLowerCase();
            for (const [en, he] of TRANSLIT) { if (low.includes(en) || low.includes(he)) return en; }
            return null;
        };
        // ── shared employer root: same brand key, OR a >=3-char token in every name ──
        const sharedRoot = (names) => {
            const clean = [...new Set(names.map(n => (n || '').trim()).filter(Boolean))];
            if (clean.length < 2) return null;
            // 1) brand-key match across languages (Cisco / סיסקו)
            const keys = clean.map(brandKey);
            if (keys[0] && keys.every(k => k === keys[0])) return keys[0];
            // 2) literal shared token
            const tokens = clean.map(n => n.toLowerCase().replace(/[^a-z\u0590-\u05FF\s]/g, ' ').split(/\s+/).filter(w => w.length >= 3));
            if (tokens.some(t => t.length === 0)) return null;
            return tokens[0].find(w => tokens.every(t => t.includes(w))) || null;
        };

        // ── BUG 4: unify relocation employers on each borrower's payslips ──
        const unifyRelocation = (slips, label) => {
            if (!slips || slips.length < 2) return slips;
            const employers = slips.map(p => (p.employer || '').trim()).filter(Boolean);
            const root = sharedRoot(employers);
            if (!root) return slips;
            // a slip belongs to the unified employer if it shares the literal root OR the brand key
            const belongs = (e) => !!e && (e.toLowerCase().includes(root) || brandKey(e) === root);
            // canonical name: prefer the local (Hebrew, current) employer over the foreign one;
            // among same-language candidates, take the longest (most descriptive).
            const matching = [...new Set(employers)].filter(belongs);
            const hasHeb = (s) => /[\u0590-\u05FF]/.test(s);
            const hebMatches = matching.filter(hasHeb);
            const pool = hebMatches.length > 0 ? hebMatches : matching;
            const canonical = pool.sort((a, b) => b.length - a.length)[0];
            log.push({ rule: 'RELOCATION_EMPLOYER_UNIFIED', borrower: label, root, canonical, originals: [...new Set(employers)] });
            return slips.map(p => belongs(p.employer)
                ? { ...p, _original_employer: p.employer, employer: canonical, _relocation: true }
                : p);
        };

        // ── BUG 2: pull ESPP out of the note when the field is missing ──
        const esppFromNote = (slips, label) => {
            if (!slips) return slips;
            return slips.map(p => {
                if ((p.espp_deduction || 0) > 0) return p;
                const note = (p.notes || p.note || '').toString();
                if (!/espp|מניות עובד|רכישת מניות|share purchase|stock purchase/i.test(note)) return p;
                const m = note.match(/(\d[\d,]*(?:\.\d+)?)/);
                const amt = m ? parseFloat(m[1].replace(/,/g, '')) : 0;
                if (amt <= 0 || amt > 5000) return p;
                log.push({ rule: 'ESPP_EXTRACTED_FROM_NOTE', borrower: label, month: p.month_year, amount: amt });
                return { ...p, espp_deduction: amt, _espp_addback: amt, _espp_from_note: true };
            });
        };

        const b1 = esppFromNote(unifyRelocation(rawData.payslips_borrower1, 'לווה 1'), 'לווה 1');
        const b2 = esppFromNote(unifyRelocation(rawData.payslips_borrower2, 'לווה 2'), 'לווה 2');
        rawData.payslips_borrower1 = b1;
        rawData.payslips_borrower2 = b2;

        // recompute the monthly ESPP add-back so buildQuickReport surfaces the strength
        const maxEspp = [...(b1 || []), ...(b2 || [])].reduce((mx, p) => Math.max(mx, p._espp_addback || p.espp_deduction || 0), rawData._espp_monthly_addback || 0);
        if (maxEspp > 0) {
            rawData._espp_monthly_addback = maxEspp;
            rawData._financial_strengths = rawData._financial_strengths || [];
            if (!rawData._financial_strengths.some(s => s.type === 'ESPP_ADDBACK_EFFECTIVE_INCOME')) {
                rawData._financial_strengths.push({
                    type: 'ESPP_ADDBACK_EFFECTIVE_INCOME',
                    label: 'הכנסה מנורמלת — Add-Back ל-ESPP',
                    description: `ההכנסה הקובעת כוללת הוספה של ₪${Math.round(maxEspp).toLocaleString()} בגין ניכוי חיסכון וולונטרי (ESPP) הניתן לביטול.`,
                    monthly_addback: maxEspp,
                    is_strength: true
                });
            }
        }

        // ── BUG 3: bilingual fuzzy-name match → strip "name not verified" flags ──
        const extractHeb = (s) => (s || '').match(/[\u0590-\u05FF]{2,}/g) || [];
        const borrowerNames = (rawData.borrowers || []).map(b => b.name).filter(Boolean);
        const holderMatchesBorrower = (holder) => {
            if (!holder) return false;
            const hLower = holder.toLowerCase();
            const hHeb = extractHeb(holder);
            return borrowerNames.some(bn => {
                const parts = bn.toLowerCase().split(/\s+/).filter(w => w.length > 1);
                const subHits = parts.filter(p => hLower.includes(p)).length;
                if (parts.length >= 2 ? subHits >= 2 : subHits >= 1) return true;
                const bHeb = extractHeb(bn);
                const hebHits = bHeb.filter(t => hHeb.some(h => h === t || h.includes(t) || t.includes(h))).length;
                return bHeb.length >= 2 ? hebHits >= 2 : hebHits >= 1;
            });
        };
        // a holder name that matches → verified. If ALL statements verify, drop the alerts.
        const stmts = rawData.bank_statements || [];
        const anyHolderVerified = stmts.some(s => holderMatchesBorrower(s.account_holder_name));
        const allHoldersVerified = stmts.length > 0 && stmts.every(s => holderMatchesBorrower(s.account_holder_name));
        if (anyHolderVerified) {
            const NAME_FLAG = (t) => /שם בעל החשבון|אימות בעלות|לא אומת שם הלווה/.test(t || '');
            if (allHoldersVerified) {
                rawData._bank_stmt_name_anchor_failed = false;
                if (Array.isArray(rawData.bank_red_flags)) rawData.bank_red_flags = rawData.bank_red_flags.filter(f => !NAME_FLAG(f));
                if (Array.isArray(rawData.actionable_recommendations)) rawData.actionable_recommendations = rawData.actionable_recommendations.filter(r => !NAME_FLAG(r.text));
                log.push({ rule: 'BANK_NAME_VERIFIED_FUZZY_FLAGS_CLEARED', verified: borrowerNames });
            }
        }

        rawData._hitech_relocation = { applied: true, log };
        return Response.json(rawData);

    } catch (error) {
        console.error('hitechRelocationEngine error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
  }),
};
