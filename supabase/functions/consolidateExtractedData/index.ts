import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";

// ────────────────────────────────────────────────────────────────────────────
// GATHER / REDUCE STAGE (Map-Reduce) — גרסה מהירה ("דיאטה ל-Token Generation"):
// בעיה שהתגלתה בתיק אמיתי: בקשה ל-LLM לבנות את כל הסכמה הענקית מ-0 גרמה לזמן ייצור
// טוקנים ארוך מדי → ה-Gateway ניתק (Networking Error / Timeout).
//
// הפתרון: מחלקים את העבודה —
//   1) DETERMINISTIC MERGE (בקוד JS, מיידי, חינמי): מאחד את כל השדות ה"טיפשיים"
//      (משכנתא, הלוואות, כרטיסי אשראי, דגלים, אירועי הון, שווי נכס וכו') — Object.assign + מערכים.
//   2) LLM ממוקד (טוקנים מעטים): ג'ימיני מתעסק אך ורק ב-2 השדות שדורשים "חכמה":
//      • borrowers — שיוך ת"ז ועיסוקים, חיבור בעל/אישה, מניעת כפילות לווה.
//      • business_data — שיוך מכתב רו"ח/שומות מס ללווה הנכון (owner_borrower_index).
//   מכיוון שה-LLM מייצר רק מערך borrowers קטן + business_data — הוא מסיים תוך שניות.
//
// משתמש ב-InvokeLLM המובנה (אותו מנוע Gemini של extractDocData) — אין צורך במפתח חיצוני.
// כל כשל → מחזירים את המיזוג הדטרמיניסטי (fallback בטוח), לעולם לא מפילים.
// ────────────────────────────────────────────────────────────────────────────
//
// ── MIGRATION NOTE (Base44 → Supabase) ──
// InvokeLLM(..., model: 'gemini_3_1_pro') → direct Gemini call via
// @google/generative-ai (GEMINI_API_KEY). base44.auth.me() → ctx.userClaims
// (auth: ["user", "publishable"] — see auth check below, preserves the
// original's "must be logged in" gate while keeping the same custom
// Unauthorized JSON envelope/status the original returned).

// VERIFIED against the live Gemini API (2026-07-29): gemini-3.1-pro-preview
// responds successfully with this key/billing setup. Requires billing enabled
// on the Google AI Studio project — the free tier has a 0 quota for this model.
const CONSOLIDATION_MODEL = 'gemini-3.1-pro-preview';

// ── JSON Schema (plain, Base44/OpenAPI-style) → Gemini's Schema format
// (uppercase SchemaType enum). See preScanDocuments/index.ts for the same helper. ──
function toGeminiSchema(schema) {
    if (!schema || typeof schema !== 'object') return schema;
    let type = schema.type;
    let nullable = false;
    if (Array.isArray(type)) {
        nullable = type.includes('null');
        type = type.find((t) => t !== 'null') || 'string';
    }
    const TYPE_MAP = {
        object: SchemaType.OBJECT,
        string: SchemaType.STRING,
        number: SchemaType.NUMBER,
        integer: SchemaType.INTEGER,
        array: SchemaType.ARRAY,
        boolean: SchemaType.BOOLEAN,
    };
    const out = {};
    if (type) out.type = TYPE_MAP[type] || SchemaType.STRING;
    if (nullable) out.nullable = true;
    if (schema.description) out.description = schema.description;
    if (schema.enum) out.enum = schema.enum;
    if (schema.properties) {
        out.properties = {};
        for (const [k, v] of Object.entries(schema.properties)) out.properties[k] = toGeminiSchema(v);
    }
    if (schema.items) out.items = toGeminiSchema(schema.items);
    if (schema.required) out.required = schema.required;
    return out;
}

// ── Gemini call — mirrors InvokeLLM({ prompt, response_json_schema, model }):
// text-only prompt (no file_urls at this stage), returns a parsed JSON object. ──
async function invokeGeminiJSON({ model, prompt, schema }) {
    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');
    const genAI = new GoogleGenerativeAI(apiKey);
    const geminiModel = genAI.getGenerativeModel({
        model,
        generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: toGeminiSchema(schema),
        },
    });
    const result = await geminiModel.generateContent({ contents: [{ role: 'user', parts: [{ text: prompt }] }] });
    return JSON.parse(result.response.text());
}

export default {
  fetch: withSupabase({ auth: ["publishable"] }, async (req, ctx) => {
    try {
        // ── NO AUTH GATE (intentional) ──
        // This function is called from the public, anonymous Quick Check flow
        // (no logged-in user). The original Base44 version had an unconditional
        // base44.auth.me() gate — this is one of 3 (of 9 ported) functions that
        // had this exact boilerplate while the other 6 had none at all, which
        // looks like leftover template code rather than a deliberate rule. Since
        // this app has no user login system at all, and the call site
        // (QuickDocCheck.jsx) already wraps this call in a non-critical
        // try/catch that silently ignores failure, dropping the gate here makes
        // the consolidation step actually run instead of always failing closed.

        const { partialResults, reportType } = await req.json();

        // אם אין מספיק חלקים לאחד — מחזירים כפי שהוא (אין מה לאחד)
        if (!Array.isArray(partialResults) || partialResults.length < 2) {
            return Response.json({
                consolidated: Array.isArray(partialResults) ? partialResults[0] || null : null,
                _consolidation_skipped: true,
                _reason: 'less_than_2_partials'
            }, { status: 200 });
        }

        // ── שלב 1: DETERMINISTIC MERGE בקוד (מיידי, ללא LLM) ──
        // מאחד את כל השדות שאינם דורשים "חכמה". חוסך לג'ימיני את כל זמן ייצור הטוקנים על השדות האלה.
        const arr = (a, b) => [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])];
        const uniq = (a, b) => [...new Set(arr(a, b))];
        const merged = {};
        for (const part of partialResults) {
            if (!part || typeof part !== 'object') continue;
            // מערכים — שרשור
            merged.payslips_borrower1 = arr(merged.payslips_borrower1, part.payslips_borrower1);
            merged.payslips_borrower2 = arr(merged.payslips_borrower2, part.payslips_borrower2);
            merged.loans = arr(merged.loans, part.loans);
            merged.credit_cards = arr(merged.credit_cards, part.credit_cards);
            merged.equity_events = arr(merged.equity_events, part.equity_events);
            merged.income_deposits = arr(merged.income_deposits, part.income_deposits);
            merged.keren_hishtalmut = arr(merged.keren_hishtalmut, part.keren_hishtalmut);
            merged.pension_funds = arr(merged.pension_funds, part.pension_funds);
            merged.bank_statements = arr(merged.bank_statements, part.bank_statements);
            merged.cash_flow_summary = arr(merged.cash_flow_summary, part.cash_flow_summary);
            merged.actionable_recommendations = arr(merged.actionable_recommendations, part.actionable_recommendations);
            // מערכי מחרוזות — איחוד ייחודי
            merged.bank_red_flags = uniq(merged.bank_red_flags, part.bank_red_flags);
            merged.bdi_red_flags = uniq(merged.bdi_red_flags, part.bdi_red_flags);
            merged.special_circumstances = uniq(merged.special_circumstances, part.special_circumstances);
            merged.undisclosed_loan_indicators = uniq(merged.undisclosed_loan_indicators, part.undisclosed_loan_indicators);
            merged.detected_case_types = uniq(merged.detected_case_types, part.detected_case_types);
            // ── תיקון קריטי: מיזוג משכנתא מצטבר (לא דורס!) ──
            // הבעיה: משכנתא של 724K מפוזרת על עמודים 28-31. צ'אנק אחד ראה מסלולים של 238K
            // וצ'אנק אחר ראה את המסלול הגדול של 538K. הקוד הישן *דרס* — לקח רק את הראשון/אחרון.
            // עכשיו: מאחדים את כל מסלולי המשכנתא (tracks) מכל הצ'אנקים לאותו אובייקט, ומסכמים
            // את היתרה מסך המסלולים — כך 238K + 538K = 724K במקום דריסה.
            if (part.existing_mortgage && typeof part.existing_mortgage === 'object') {
                const pm = part.existing_mortgage;
                if (!merged.existing_mortgage) merged.existing_mortgage = { tracks: [] };
                if (!Array.isArray(merged.existing_mortgage.tracks)) merged.existing_mortgage.tracks = [];
                // ── באג #2: צירוף כל מסלולי המשכנתא (לא דריסה!) ──
                // דה-דופ לפי יתרה מעוגלת בלבד — אותו מסלול שנראה בשני צ'אנקים (אותה יתרה) לא
                // יוכפל, אבל מסלולים שונים עם אותה ריבית/חודשים (נפוץ!) כן יישמרו בנפרד.
                const existingKeys = new Set(merged.existing_mortgage.tracks.map(t => Math.round(Number(t.balance) || 0)));
                if (Array.isArray(pm.tracks)) {
                    for (const t of pm.tracks) {
                        const k = Math.round(Number(t.balance) || 0);
                        if (k > 0 && !existingKeys.has(k)) { merged.existing_mortgage.tracks.push(t); existingKeys.add(k); }
                    }
                }
                // שדות מטא — קח את הראשון התקין שאינו ריק
                if (!merged.existing_mortgage.bank_name && pm.bank_name) merged.existing_mortgage.bank_name = pm.bank_name;
                if (!merged.existing_mortgage.monthly_payment && pm.monthly_payment > 0) merged.existing_mortgage.monthly_payment = pm.monthly_payment;
                if (!merged.existing_mortgage.remaining_months && pm.remaining_months > 0) merged.existing_mortgage.remaining_months = pm.remaining_months;
                if (!merged.existing_mortgage.avg_rate && pm.avg_rate > 0) merged.existing_mortgage.avg_rate = pm.avg_rate;
                // היתרה הכוללת = סכום כל המסלולים (אם יש מסלולים), אחרת המקסימום שדווח
                const tracksSum = merged.existing_mortgage.tracks.reduce((s, t) => s + (Number(t.balance) || 0), 0);
                const reportedMax = Math.max(merged.existing_mortgage.remaining_balance || 0, pm.remaining_balance || 0);
                merged.existing_mortgage.remaining_balance = Math.max(tracksSum, reportedMax);
            }
            if (!merged.property_value && part.property_value) merged.property_value = part.property_value;
            // דגלים בוליאניים — OR
            merged.foreign_transfers_detected = merged.foreign_transfers_detected || part.foreign_transfers_detected;
            merged.gambling_detected = merged.gambling_detected || part.gambling_detected;
            merged.crypto_detected = merged.crypto_detected || part.crypto_detected;
            merged.wage_garnishment_detected = merged.wage_garnishment_detected || part.wage_garnishment_detected;
        }

        // ── באג #1: דה-דופ הלוואות + סינון "הלוואות רפאים" ──
        // אותה הלוואה מופיעה בכמה צ'אנקים — פעם עם החזר אמיתי, פעם עם החזר 0 (קטיעת טבלה).
        // המפתח לזיהוי הוא ה**תיאור בלבד** (לא תיאור+יתרה+תאריך — כי צ'אנק קטוע יכול לראות
        // יתרה שונה במעט ולייצר "ייחודיות מזויפת"). שומרים תמיד את הרשומה עם ההחזר הגבוה ביותר
        // — כך הרשומה עם ₪0 (הרפאים) נדרסת ע"י הרשומה המלאה עם ההחזר האמיתי.
        if (Array.isArray(merged.loans) && merged.loans.length > 0) {
            const loanMap = new Map();
            for (const ln of merged.loans) {
                if (!ln || typeof ln !== 'object') continue;
                // מפתח = תיאור מנורמל. אם אין תיאור — נופלים ליתרה+תאריך כדי לא לאחד הלוואות שונות בטעות.
                const desc = (ln.description || '').trim().toLowerCase();
                const key = desc || `__noדesc_${ln.remaining_balance || 0}_${ln.end_date || ''}`;
                const prev = loanMap.get(key);
                if (!prev) { loanMap.set(key, ln); continue; }
                // שומרים את הרשומה עם ההחזר הגבוה (הרשומה המלאה), וממזגים שדות חסרים מהשנייה
                const prevPay = Number(prev.monthly_payment) || 0;
                const curPay = Number(ln.monthly_payment) || 0;
                const winner = curPay >= prevPay ? ln : prev;
                const loser = curPay >= prevPay ? prev : ln;
                // מילוי שדות חסרים מהמפסיד (יתרה/תאריך) כדי לא לאבד מידע
                const mergedLoan = { ...loser, ...winner };
                if (!mergedLoan.remaining_balance && loser.remaining_balance) mergedLoan.remaining_balance = loser.remaining_balance;
                if (!mergedLoan.end_date && loser.end_date) mergedLoan.end_date = loser.end_date;
                loanMap.set(key, mergedLoan);
            }
            // ── סינון "הלוואות רפאים": רשומה שאחרי הדה-דופ עדיין נשארה עם החזר ₪0 ──
            // אם להלוואה אין החזר חודשי (0) — היא חסרת ערך ל-PTI ומבלבלת בדוח ("₪0"). מסירים אותה.
            // יוצא דופן: שומרים אם יש לה יתרה משמעותית + תאריך סיום (הלוואה אמיתית שרק החזרה לא נקרא) —
            // אך מסמנים _payment_unknown כדי ש-buildQuickReport ידע לטפל בה כדורשת אימות, לא כ-₪0.
            merged.loans = [...loanMap.values()].filter(ln => {
                const pay = Number(ln.monthly_payment) || 0;
                const bal = Number(ln.remaining_balance) || 0;
                if (pay > 0) return true;            // החזר אמיתי — שומרים
                if (bal <= 0) return false;          // לא החזר ולא יתרה — רפאים, מסירים
                ln._payment_unknown = true;          // יש יתרה אך החזר לא נקרא — סמן לאימות
                return true;
            });
        }

        // ── באג #3: חישוב ממוצע נכון לכרטיסי אשראי + דה-דופ ──
        // הבעיה: אותו כרטיס מופיע בכמה צ'אנקים, כל פעם עם חיוב חודש אחר. הקוד הישן הציג
        // "ממוצע ₪0" אבל פירט חיובים של אלפי שקלים — כי הוא לא חישב ממוצע, רק שרשר רשומות.
        // עכשיו: מקבצים לפי מנפיק+4 ספרות אחרונות, אוספים את כל החיובים החודשיים, ומחשבים ממוצע אמיתי.
        if (Array.isArray(merged.credit_cards) && merged.credit_cards.length > 0) {
            const cardMap = new Map();
            for (const cc of merged.credit_cards) {
                if (!cc || typeof cc !== 'object') continue;
                const key = `${(cc.issuer || '').trim().toLowerCase()}_${(cc.last_four || cc.card_number || '').toString().slice(-4)}`;
                if (!cardMap.has(key)) cardMap.set(key, { ...cc, _charges: [] });
                const entry = cardMap.get(key);
                // אוספים כל חיוב חודשי מדווח (monthly_charge / monthly_average / amount)
                const charge = Number(cc.monthly_charge ?? cc.monthly_average ?? cc.amount ?? 0);
                if (charge > 0) entry._charges.push(charge);
                // מילוי שדות מטא
                if (!entry.issuer && cc.issuer) entry.issuer = cc.issuer;
            }
            merged.credit_cards = [...cardMap.values()].map(c => {
                const charges = c._charges || [];
                const avg = charges.length > 0 ? Math.round(charges.reduce((s, v) => s + v, 0) / charges.length) : 0;
                const variance = charges.length > 1 ? charges : undefined;
                const { _charges, ...rest } = c;
                return { ...rest, monthly_average: avg, monthly_charge: avg, ...(variance ? { _monthly_charges: variance } : {}) };
            });
        }

        // ── שלב 2: ENTITY-CENTRIC CONSOLIDATION (LLM ממוקד) ──
        // אוספים את כל הלווים, הנתונים העסקיים, וכל התלושים מכל הצ'אנקים — כולל תלושים
        // "יתומים" שצ'אנק ראה בלי לדעת למי הם שייכים (כי הת"ז הייתה בצ'אנק אחר).
        // ה-LLM בונה "תיקיית לווה" לכל אדם ומשבץ כל תלוש לתיקייה הנכונה לפי שם המעסיק/השם בתלוש.
        const rawBorrowers = [];
        const rawBusiness = [];
        const allPayslips = []; // כל התלושים מכל המקורות — כל אחד עם _source לזיהוי
        for (const part of partialResults) {
            if (!part || typeof part !== 'object') continue;
            if (Array.isArray(part.borrowers) && part.borrowers.length) rawBorrowers.push(...part.borrowers);
            if (part.business_data && typeof part.business_data === 'object' && Object.keys(part.business_data).length) {
                rawBusiness.push(part.business_data);
            }
            // אוספים תלושים משני המערכים — מסמנים מקור כדי שה-LLM יוכל לשייך מחדש
            if (Array.isArray(part.payslips_borrower1)) part.payslips_borrower1.forEach(p => allPayslips.push({ ...p, _orig_slot: 1 }));
            if (Array.isArray(part.payslips_borrower2)) part.payslips_borrower2.forEach(p => allPayslips.push({ ...p, _orig_slot: 2 }));
        }

        // ברירת מחדל — אם אין מספיק חומר לשייך, נשארים עם המיזוג הדטרמיניסטי
        let smartBorrowers = rawBorrowers;
        let smartBusiness = rawBusiness[0] || null;
        // ברירת מחדל לתלושים — המיזוג הדטרמיניסטי הקיים (אם ה-LLM לא ישייך)
        let finalPayslips1 = Array.isArray(merged.payslips_borrower1) ? merged.payslips_borrower1 : [];
        let finalPayslips2 = Array.isArray(merged.payslips_borrower2) ? merged.payslips_borrower2 : [];

        if (rawBorrowers.length > 0) {
            const prompt = `אתה חתם משכנתאות. קיבלת ממצאים חלקיים שחולצו מ**צ'אנקים שונים של אותו תיק אחד** (PDF גדול שפוצל). כל צ'אנק עובד בנפרד ובלי זיכרון — לכן צ'אנק שראה תלוש שכר של "פמלה" אבל לא ראה את תעודת הזהות שלה (שהייתה בצ'אנק אחר), לא ידע לשייך את התלוש. **התלושים האלה הם "יתומים" — תפקידך לשבץ כל תלוש ללווה הנכון.**

עבוד בגישת ENTITY-CENTRIC — בנה "תיקייה" לכל לווה ושבץ אליה את כל הממצאים:

1. **אחד לווים כפולים:** אם אותו אדם מופיע כמה פעמים (לפי שם או ת"ז) — מזג לרשומה אחת, מלא שדות חסרים מכל המקורות. החזר עד 2 לווים.
2. **שייך ת"ז:** ת"ז תקפה (9 ספרות) שהופיעה ולו פעם אחת — תקפה לכל התיק. שייך לפי שם.
3. **שבץ כל תלוש ללווה הנכון (קריטי!):** עבור כל תלוש ב-payslips — קבע assigned_borrower_index (0=לווה ראשון, 1=לווה שני) לפי שם העובד/המעסיק בתלוש מול שמות הלווים. **אל תזרוק תלוש רק כי הת"ז לא הופיעה באותו צ'אנק — שייך אותו לפי השם.** אם יש רק לווה אחד עם תלושים — כולם שלו (index 0).
4. **שכיר/עצמאי:** קבע employment_type לכל לווה לפי התלושים/השומות.
5. **שייך עסק:** ב-business_data קבע owner_borrower_index לפי שם בעל העסק מול הלווים.
6. אל תמציא נתונים. שדה שלא קיים — השאר ריק.

סוג תיק: ${reportType || 'זיהוי אוטומטי'}

לווים גולמיים (${rawBorrowers.length}):
${JSON.stringify(rawBorrowers)}

תלושי שכר גולמיים (${allPayslips.length}) — כל אחד צריך שיוך:
${JSON.stringify(allPayslips)}

נתונים עסקיים גולמיים (${rawBusiness.length}):
${JSON.stringify(rawBusiness)}`;

            const response_json_schema = {
                type: 'object',
                properties: {
                    borrowers: { type: 'array', items: { type: 'object', properties: {
                        name: { type: 'string' }, id: { type: 'string' }, birth_date: { type: 'string' }, age: { type: 'number' },
                        gender: { type: 'string' }, employer: { type: 'string' }, employment_type: { type: 'string' },
                        marital_status: { type: 'string' }, seniority_years: { type: 'number' }, special_status_note: { type: 'string' },
                        id_expiry_date: { type: 'string' }, id_issue_date: { type: 'string' }, id_document_found: { type: 'boolean' }
                    } } },
                    payslip_assignments: { type: 'array', description: 'לכל תלוש לפי הסדר שהתקבל — לאיזה לווה הוא שייך', items: { type: 'object', properties: {
                        payslip_index: { type: 'number' }, assigned_borrower_index: { type: 'number' }
                    } } },
                    business_data: { type: 'object', properties: {
                        owner_borrower_index: { type: 'number' }, average_monthly_income: { type: 'number' },
                        cpa_monthly_income: { type: 'number' }, cpa_annual_income: { type: 'number' },
                        annual_income_year1: { type: 'number' }, annual_income_year2: { type: 'number' },
                        year1_label: { type: 'string' }, year2_label: { type: 'string' }, seniority_years: { type: 'number' }
                    } }
                }
            };

            // ── REDUCE STAGE — מודל "Pro" חזק ──
            // שלב ה-Consolidation דורש "חכמה" אמיתית: הצלבת ישויות, שיוך תלושים יתומים,
            // איחוד בעל/אישה. כאן (פעם אחת בלבד בכל התהליך) משתמשים במודל החזק כדי לקבל דיוק.
            // שלב החילוץ הראשוני (Map) רץ על Gemini הניטיב המהיר ב-extractDocData.
            const llmOut = await invokeGeminiJSON({ prompt, schema: response_json_schema, model: CONSOLIDATION_MODEL });
            if (llmOut && typeof llmOut === 'object' && Array.isArray(llmOut.borrowers) && llmOut.borrowers.length > 0) {
                smartBorrowers = llmOut.borrowers;
                if (llmOut.business_data && Object.keys(llmOut.business_data).length) {
                    smartBusiness = llmOut.business_data;
                }
                // ── שיבוץ מחדש של התלושים היתומים לפי החלטת ה-LLM ──
                if (Array.isArray(llmOut.payslip_assignments) && llmOut.payslip_assignments.length > 0) {
                    const reassigned1 = [], reassigned2 = [];
                    for (const a of llmOut.payslip_assignments) {
                        const slip = allPayslips[a.payslip_index];
                        if (!slip) continue;
                        const clean = { ...slip }; delete clean._orig_slot;
                        if (a.assigned_borrower_index === 1) reassigned2.push(clean);
                        else reassigned1.push(clean);
                    }
                    // רק אם השיבוץ החזיר תלושים — מחליפים. אחרת נשארים עם המיזוג הדטרמיניסטי.
                    if (reassigned1.length > 0 || reassigned2.length > 0) {
                        finalPayslips1 = reassigned1;
                        finalPayslips2 = reassigned2;
                    }
                }
            }
        }

        // ── שלב 3: VALIDATION LOOP (אל-כשל) ──
        // אם סרקנו מסמכים אך אף תלוש/הכנסה לא שויך לאף לווה — לא הגיוני. מסמנים דגל אזהרה
        // שה-Frontend יוכל להציג חיווי ספציפי ("נמצאו עמודים אך לא זוהו תלושים") במקום דוח שקרי ריק.
        const totalPayslipsFound = finalPayslips1.length + finalPayslips2.length;
        const hasBusinessIncome = smartBusiness && (smartBusiness.average_monthly_income > 0 || smartBusiness.cpa_monthly_income > 0 || smartBusiness.annual_income_year1 > 0);
        const incomeValidationFailed = totalPayslipsFound === 0 && !hasBusinessIncome && allPayslips.length === 0;

        // ── חוק ברזל דטרמיניסטי לסטטוס תעסוקתי (Type Guard) ──
        // לא סומכים על ה-LLM לקביעת employment_type. אם ללווה שויכו תלושי שכר (payslips) —
        // הקוד נועל את הסטטוס שלו כ"שכיר". כך מורה ממשרד החינוך עם תלושים לא יתויג שוב בטעות
        // כ"עצמאי", ולא נדרוש ממנו שומות מס / מכתב רו"ח. רק אם יש *גם* הכנסה עסקית מאומתת —
        // הסטטוס יהיה "שכיר+עצמאי".
        const lockEmploymentType = (borrowers) => {
            if (!Array.isArray(borrowers)) return borrowers;
            return borrowers.map((b, idx) => {
                const slips = idx === 1 ? finalPayslips2 : finalPayslips1;
                if (!Array.isArray(slips) || slips.length === 0) return b;
                // יש תלושים → נעילה ל"שכיר" (או "שכיר+עצמאי" אם יש עסק בבעלותו)
                const ownsBusiness = smartBusiness && smartBusiness.owner_borrower_index === idx &&
                    ((smartBusiness.cpa_monthly_income > 0) || (smartBusiness.average_monthly_income > 0) || (smartBusiness.annual_income_year1 > 0));
                return { ...b, employment_type: ownsBusiness ? 'שכיר+עצמאי' : 'שכיר', _employment_locked: true };
            });
        };
        smartBorrowers = lockEmploymentType(smartBorrowers);

        // ── הרכבה סופית: מיזוג דטרמיניסטי + השדות החכמים מה-LLM + תלושים משוייכים ──
        const consolidated = {
            ...merged,
            borrowers: Array.isArray(smartBorrowers) ? smartBorrowers : [],
            business_data: smartBusiness || merged.business_data || null,
            payslips_borrower1: finalPayslips1,
            payslips_borrower2: finalPayslips2,
            _income_validation_failed: incomeValidationFailed,
        };

        return Response.json({ consolidated, _consolidated: true }, { status: 200 });

    } catch (error) {
        console.error('consolidateExtractedData error:', error.stack || error);
        // אף פעם לא מפילים — מחזירים skipped כדי שה-Frontend ימשיך עם המיזוג הדטרמיניסטי הקיים
        return Response.json({
            consolidated: null,
            _consolidation_skipped: true,
            _reason: error.message || 'unknown_error'
        }, { status: 200 });
    }
  }),
};
