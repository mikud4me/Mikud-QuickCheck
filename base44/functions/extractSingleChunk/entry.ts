import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { correctUnverifiedBorrowerIds } from '../../../shared/mergeExtractedDocuments.js';

/**
 * extractSingleChunk — חילוץ קובץ/צ'אנק בודד מול מודל Pro.
 *
 * ── ארכיטקטורה: True Frontend Orchestration ──
 * זהו ה-Endpoint הקל שעליו רוכבת המקביליות בדפדפן. הדפדפן מפצל PDF גדול ל-chunks,
 * ואז מריץ Promise.all מול הפונקציה הזו — קריאה אחת לכל URL. לכל קריאה יש רק קובץ
 * אחד לעבד, ולכן היא תמיד מסיימת הרבה לפני תקרת ה-150ש' של השרת — גם על gemini Pro.
 *
 * תפקיד: URL אחד → 2 סכמות (זהות+תלושים / חובות+בנק) על Pro במקביל → merge → JSON מלא.
 * ה-Worker הראשי (processUnderwriterCase) כבר לא נוגע ב-LLM — הוא רק ממזג את התוצאות.
 *
 * Payload: { file_url }
 * מחזיר: אובייקט JSON מחולץ (אותו מבנה שכל צ'אנק מחזיר), או { error, _failed: true }.
 */

const EXTRACTION_MODEL = 'gemini_3_flash';
// ⚠️ מגבלת Deno ~150s. שתי סכמות רצות במקביל (Promise.all) — זמן כולל = max(Schema0, Schema1).
// ללא re-upload: זמן = max(Schema0, Schema1) ≈ 80-120s בלבד ✅
const ATTEMPT_TIMEOUT_MS = 120_000; // 120s לכל סכמה — רצות במקביל, זמן לא מצטבר

// ── CACHE SCHEMA VERSION ──
// עלה מספר זה בכל שינוי מהותי ל-chunkA/chunkB/chunkPrompt — כך רשומות DocumentExtractionCache
// ישנות (שנוצרו תחת סכמה קודמת) ייחשבו מיושנות ויחולצו מחדש, במקום להישאר תקועות על נתונים חלקיים.
const SCHEMA_VERSION = 2; // v2: fixed contradictory/missing spouse-on-ספח vs id_document_found guidance

// ── 2 הסכמות (זהות+תלושים, חובות+בנק) — זהות לאלו שב-extractDocData ──
const payslipItem = { type: "object", properties: {
    month_year:{type:"string"}, gross_salary:{type:"number"}, net_salary:{type:"number"},
    employer:{type:"string"}, notes:{type:"string"},
    loan_deduction:{type:"number", description:'ניכוי חודשי בפועל בלבד — לא יתרת הלוואה'},
    life_insurance_deduction:{type:"number"}, bonus_amount:{type:"number"},
    employment_start_date:{type:"string"}, wage_garnishment:{type:"boolean"},
    employee_id:{type:"string", description:'מספר עובד פנימי — אינו ת.ז.'},
    id_number:{type:"string", description:'ת.ז. 9 ספרות ליד מספר זהות בלבד'},
    espp_deduction:{type:"number", description:'ניכוי ESPP/רכישת מניות עובד'},
    rsu_gain:{type:"number", description:'זקיפת RSU בברוטו (לא תזרים)'},
    car_lease_deduction:{type:"number", description:'ניכוי ליסינג/רכב חברה'},
    salary_advance:{type:"number"},
    keren_hishtalmut_loan_deduction:{type:"number", description:'הלוואה ע"ח קרן השתלמות'}
}};

const chunkA = { // זהות + תלושים
    type: "object",
    properties: {
        detected_case_types: { type: "array", items: { type: "string" }, description: 'סוגי תיק: רכישת נכס חדש, מחזור משכנתא, מיחזור משכנתא ואיחוד חובות, בעלי עסקים וחברות, גיל הזהב, משכנתא למסורבים' },
        borrowers: { type: "array", description: 'עד 2 לווים. חלץ את כל הלווים. אל תניח ששני לווים עובדים אצל אותו מעסיק. אם לווה 1 גרוש/ה — אדם בספח כבן זוג הוא הגרוש/ה ולא לווה 2. אם בספח של לווה 1 מופיע "בן זוג"/"בת זוג" עם שם ומספר ת.ז. (ואין מדובר בגרוש/ה) — הוסף אותו/ה כלווה שני וּמַלֵא את השם ואת ה-id שלו/שלה, גם אם לא הועלה עבורו/ה מסמך תעודת זהות נפרד משלו/שלה. אל תשמיט לווה שני רק כי חסר לו/ה מסמך זהות עצמאי — סמן זאת דרך id_document_found (ר\' הגדרת השדה), לא דרך השמטת הלווה כולו.', items: { type: "object", properties: {
            name:{type:"string", description:'שם מלא מדויק של הלווה עצמו (שם פרטי + שם משפחה בלבד). חלץ אך ורק תחת התוויות "שם פרטי" ו"שם משפחה" של בעל התעודה, או לפי הופעה מפורשת של שם הלווה במכתבים נלווים (מכתב שבתון, שומת מס, מכתב רו"ח, נסח טאבו), או תחת "בן זוג"/"בת זוג" בספח (ר\' כלל הלווה השני למעלה). אסור בתכלית האיסור לקחת שם משדות "שם האב", "שם הסב", "שם האם" — אלה קרובי משפחה, לא הלווה. אסור בתכלית האיסור להדביק לשם סטטוס תעסוקה (כמו "שבתון", "חל\"ת") — סטטוס הוא ערך של employment_type בלבד ולא חלק מהשם. אם השם הפרטי של הלווה השני מופיע במכתב נלווה (למשל אישור משרד החינוך/שבתון הממוען אליו), העדף אותו על פני כל שם בספח.'},
            id:{type:"string", description:'ת.ז. 9 ספרות. רק ליד התווית מספר זהות/ת.ז. מספר עובד אינו ת.ז. אם המספר מופיע רק בשדה "בן זוג"/"בת זוג" בספח של אדם אחר (ולא על מסמך ת.ז. עצמאי של אותו אדם) — עדיין חלץ את המספר לכאן; זה נפרד לחלוטין מהשאלה אם id_document_found=true (ר\' הגדרת אותו שדה).'},
            birth_date:{type:"string", description:'תאריך לידה DD.MM.YYYY'}, age:{type:"number"},
            gender:{type:"string", description:'זכר/נקבה'},
            employer:{type:"string", description:'מקום העבודה הקבוע של הלווה בלבד (המעסיק האמיתי — למשל "משרד החינוך", שם החברה). חובה: זהו מקום העבודה הקבוע ולא הגוף שמשלם הכנסה זמנית. בשנת שבתון/חל"ת — שדה זה נשאר שם המעסיק הקבוע (משרד החינוך), ולעולם לא "קרן השתלמות למורים" / קרן הפנסיה / הגוף שמעביר את מענק השבתון — אלה מקור הכנסה זמני, לא המעסיק. אל תעתיק מעסיק מהלווה השני. אם אין — null.'},
            employment_type:{type:"string", description:'סטטוס התעסוקה: שכיר/עצמאי/גמלאי/שכיר (שנת שבתון)/חל"ת/חופשת לידה/שכיר+עצמאי. אם הלווה מורה במשרד החינוך הנמצא בשנת שבתון — ערך זה הוא "שכיר (שנת שבתון)", ושדה employer נשאר "משרד החינוך".'},
            marital_status:{type:"string"},
            seniority_years:{type:"number", description:'שנות וותק אצל המעסיק הנוכחי'},
            special_status_note:{type:"string"},
            sabbatical_info:{type:"object", description:'מילוי אך ורק אם נמצא מסמך חופשה/שבתון/חל"ת/חופשת לידה הממוען במפורש לאדם זה (לפי שמו ות.ז. שלו על המסמך). אל תמלא אובייקט זה ללווה אחר. אם לאדם זה יש תלושי שכר פעילים מהחודשים האחרונים — הוא איננו בשבתון, השאר null.', properties:{
                leave_type:{type:"string", description:'שבתון/חל"ת/חופשת לידה/מחלה ממושכת'},
                start_date:{type:"string", description:'תאריך תחילת החופשה DD.MM.YYYY'},
                end_date:{type:"string", description:'תאריך סיום/חזרה לעבודה DD.MM.YYYY'},
                issuing_body:{type:"string", description:'הגוף שהנפיק (משרד החינוך, קרן השתלמות וכו׳)'},
                document_addressed_to:{type:"string", description:'השם המדויק שאליו ממוען המסמך — לאימות שיוך'}
            }},
            id_expiry_date:{type:"string"},
            id_issue_date:{type:"string", description:'תאריך הנפקת ת.ז. DD.MM.YYYY'},
            id_document_found:{type:"boolean", description:'true אך ורק אם אדם זה הוא בעל התעודה הראשי של מסמך ת.ז./ספח שהועלה — כלומר שמו מופיע תחת "שם פרטי"+"שם משפחה"+"מספר זהות" בכותרת אותו מסמך עצמו. FALSE אם אדם זה מוזכר רק כ"בן זוג"/"בת זוג" בספח של אדם אחר, גם אם מספר הת.ז. שלו/שלה גלוי וניתן לחלץ אותו לשדה id (חלץ את ה-id בכל מקרה — זה שדה נפרד, ר\' הגדרתו). אותו כלל FALSE חל אם המספר מופיע רק בנסח טאבו/כותרת מסמך אחר בלי צילום ת.ז. עצמאי בפועל. דוגמה: בספח של יעקב מופיע "בן זוג: אורטל ארמה 032557852" → ליעקב (בעל התעודה) id_document_found=true; לאורטל id_document_found=false (הוזכרה בלבד — לא הועלה עבורה מסמך ת.ז./ספח משלה), אך יש למלא id="032557852" עבורה כי המספר ידוע וניתן לאימות מול תלושים/מסמכים אחרים.'},
            payslips_found_count:{type:"number"},
            employment_contract:{type:"object", properties:{
                employer:{type:"string"}, gross_monthly:{type:"number"}, net_monthly:{type:"number"},
                start_date:{type:"string"}, is_signed:{type:"boolean"}
            }}
        }}},
        payslips_borrower1: { type: "array", description: 'תלושי לווה 1 בלבד (לפי שם/ת.ז. בתלוש)', items: payslipItem },
        payslips_borrower2: { type: "array", description: 'תלושי לווה 2 בלבד (לפי שם/ת.ז. בתלוש)', items: payslipItem },
        payslip_deduction_alerts: { type: "array", items: { type: "object", properties: {
            borrower_name:{type:"string"}, month_year:{type:"string"}, gross:{type:"number"},
            net:{type:"number"}, ratio_pct:{type:"number"}, suspected_reason:{type:"string"}
        }}},
        payslip_deductions: { type: "array", description: 'ניכויי חובות צל בתלוש: הלוואה לקבוצות עובדים, הלוואת מעסיק, ניכוי הלוואה, גמ"ח', items: { type: "object", properties: {
            borrower_index:{type:"number", description:'0 עבור לווה 1, 1 עבור לווה 2. חובה לוודא לאיזה לווה שייך התלוש לפי שמו לפני קביעת האינדקס.'}, description:{type:"string"}, monthly_amount:{type:"number"}
        }}},
        pension_slips: { type: "array", items: { type: "object", properties: {
            month_year:{type:"string"}, net_allowance:{type:"number"}, source:{type:"string"}
        }}},
        leave_documents: { type: "array", description: 'מסמכי חופשה/שבתון/חל"ת/חופשת לידה. כל מסמך כזה (אישור חופשה ללא תשלום, מכתב שבתון, אישור חל"ד) שייך ללווה ספציפי אחד — חובה לזהות למי הוא ממוען לפי השם והת.ז. שעליו, ולא להניח שהוא של הלווה הראשי.', items: { type: "object", properties: {
            leave_type:{type:"string", description:'שבתון/חל"ת/חופשת לידה/מחלה ממושכת'},
            belongs_to_name:{type:"string", description:'השם המלא המדויק שאליו המסמך ממוען (כפי שמופיע במכתב/אישור)'},
            belongs_to_id:{type:"string", description:'ת.ז. 9 ספרות של מי שהמסמך ממוען אליו, אם מופיעה במסמך'},
            employer:{type:"string"},
            start_date:{type:"string", description:'תאריך תחילת החופשה/שבתון DD.MM.YYYY'},
            end_date:{type:"string", description:'תאריך סיום/חזרה לעבודה DD.MM.YYYY'},
            issuing_body:{type:"string", description:'הגוף שהנפיק (משרד החינוך, קרן השתלמות וכו׳)'}
        }}}
    }
};

const chunkB = { // חובות + בנק
    type: "object",
    properties: {
        existing_mortgage: { type: "object", properties: {
            bank_name:{type:"string"}, remaining_balance:{type:"number", description:'סה"כ יתרת המשכנתא — חובה לשלוף משורת הסה"כ תחת עמודת "יתרה לסילוק" (הכוללת קרן + הצמדה + עמלות). בבנקים ישראליים, ובמיוחד בנק הפועלים, לעולם אל תשלוף נתון זה מעמודת "קרן" (Principal) — היא נמוכה יותר ושגויה. רק "יתרה לסילוק".'}, total_stated_balance:{type:"number", description:'סה"כ יתרה לסילוק כפי שמופיע מפורשות בשורת הסה"כ במסמך. אל תחשב מעמודת קרן.'},
            average_interest_rate:{type:"number", description:'ריבית משוקללת'}, monthly_payment:{type:"number", description:'תשלום חודשי מהשורה המסכמת (סה"כ)'},
            remaining_months:{type:"number"}, early_repayment_fee:{type:"number"}, statement_date:{type:"string"},
            tracks:{ type:"array", items:{ type:"object", properties:{
                track_type:{type:"string", description:'פריים/קבועה צמודה/קבועה לא צמודה/משתנה'}, remaining_balance:{type:"number", description:'יתרת המסלול מעמודת "יתרה לסילוק" של אותה שורה בלבד — לא מעמודת "קרן".'},
                interest_rate:{type:"number"}, remaining_months:{type:"number"},
                is_index_linked:{type:"boolean"}, rate_basis:{type:"string"}
            }}}
        }},
        all_mortgages: { type: "array", items: { type: "object", properties: {
            bank_name:{type:"string"}, remaining_balance:{type:"number"}, monthly_payment:{type:"number"}, statement_date:{type:"string"}
        }}},
        mortgage_clearance_reports: { type: "array", description: '🚨 MANDATORY — חובה מוחלטת. מחלץ יתרות אוניברסלי — דוח יתרות לסילוק / מצב הלוואות מכל בנק בישראל, ללא תלות בכותרת. זהה לפי מבנה ולא לפי שם: כל מסמך המכיל יתרה לסילוק של הלוואה/משכנתא ופירוט מסלולים. כותרות נרדפות בכל הבנקים: "אישור זכויות וחובות", "הודעת ריכוז יתרות" / "ריכוז יתרות שנתי", "פירוט הלוואות ומשכנתאות", "פירוט משכנתאות", "אישור פרטי הלוואה/ות", "יתרה לסילוק", "סילוקין" / "סכום לסילוק", "מצב חשבון הלוואות", "דוח יתרות", "Loan Payoff Statement". תקף לכל הבנקים: טפחות/מזרחי-טפחות, לאומי, הפועלים, דיסקונט, הבינלאומי, מסד, ירושלים, אוצר החייל, יהב, מרכנתיל וכו׳. חובה למלא מערך זה במלואו עבור כל בנק שמופיע לו דוח כזה. כל איבר = בנק אחד עם כל מסלוליו וקנסות ההיוון. אסור להחזיר מערך ריק אם יש מסמך כזה.', items: { type: "object", required: ["bank_name", "total_clearance_balance", "tracks"], properties: {
            bank_name:{type:"string", description:'שם הבנק שהנפיק את דוח היתרות — קרא מהלוגו/הכותרת/הפוטר (טפחות, לאומי, הפועלים, דיסקונט, בינלאומי, מסד וכו׳). אם לא מופיע שם מפורש — "לא ידוע".'},
            statement_date:{type:"string", description:'תאריך הדוח DD.MM.YYYY'},
            total_clearance_balance:{type:"number", description:'🚨 REQUIRED — סה"כ לסילוק בלבד: קרא אך ורק את שורת "סה"כ לסילוק" / "Total for clearance" / "יתרה לסילוק" שהיא סיכום הסופי של הטבלה. בבנק הבינלאומי (FIBI) — קרא את שורת "סה"כ" בתחתית הטבלה. אסור בתכלית לחבר עמודות בנפרד (כמו "קרן" + "הצמדה" + "ריבית") כאשר קיימת שורת סה"כ מסכמת — שורת הסה"כ היא תמיד מקור האמת. אסור לחבר נתוני טאבו (סכומי משכנתא רשומה) ליתרות הסילוק.'},
            total_monthly_payment:{type:"number", description:'סה"כ ההחזר החודשי לבנק זה אם מופיע'},
            early_repayment_fee:{type:"number", description:'עמלת היוון/פירעון מוקדם כוללת אם מופיעה'},
            tracks:{ type:"array", description:'🚨 REQUIRED — חובה מוחלטת: מערך כל המסלולים/ההלוואות הקיימים בבנק זה. חלץ כל שורת מסלול בנפרד מהטבלה. אסור להחזיר מערך ריק כשיש טבלת מסלולים במסמך — כל שורה = אובייקט track נפרד. בנק הפועלים לדוגמה: כל שורה עם שם מסלול, ריבית, ויתרה = track אחד. חובה לחלץ את הריבית הנוכחית, היתרה לסילוק ומספר החודשים שנותרו לכל מסלול.', items:{ type:"object", required: ["total_balance"], properties:{
                track_name:{type:"string", description:'שם/מספר המסלול (למשל "דיגיטל מורים 416-108", "מכרז 2021 751-302", "פרטית שפיצר", "פריים", "קבועה צמודה"). אל תשאיר ריק — קרא את שם השורה/המסלול מהטבלה.'},
                track_type:{type:"string", description:'פריים/קבועה צמודה/קבועה לא צמודה/משתנה צמודה/משתנה לא צמודה — הסק לפי שם המסלול/בסיס הריבית.'},
                principal_balance:{type:"number", description:'יתרת הקרן לסילוק של מסלול זה. בבנק הבינלאומי — העמודה "יתרת הקרן".'},
                total_balance:{type:"number", description:'🚨 REQUIRED — יתרה כוללת לסילוק (קרן+ריבית+הצמדה) של מסלול זה. בבנק הפועלים — העמודה "יתרה לסילוק" של אותה שורה. בבנק הבינלאומי — "יתרת הקרן" + "יתרת ריבית". חובה לכל מסלול.'},
                current_interest_rate:{type:"number", description:'🚨 REQUIRED — הריבית הנוכחית של המסלול באחוזים. חלץ מהעמודה "ריבית" או "שיעור ריבית" בשורת המסלול. חובה לכל מסלול.'},
                linkage:{type:"string", description:'סוג ההצמדה של המסלול: צמוד מדד / לא צמוד / צמוד מט"ח'},
                rate_basis:{type:"string", description:'בסיס הריבית: פריים/P+/P-/קבועה/מדד וכו׳'},
                remaining_months:{type:"number", description:'🚨 REQUIRED — מספר חודשים שנותרו לסיום המסלול. חלץ מהעמודה "חודשים שנותרו" / "תקופה שנותרה" / חשב מתאריך הפירעון הסופי. חובה לכל מסלול.'},
                end_date:{type:"string", description:'מועד פירעון סופי DD.MM.YYYY'},
                monthly_payment:{type:"number", description:'ההחזר החודשי של מסלול זה אם מופיע בשורה'},
                early_repayment_fee:{type:"number", description:'עמלת היוון/פירעון מוקדם של מסלול זה אם מופיעה'}
            }}}
        }}},
        loans: { type: "array", items: { type: "object", properties: {
            description:{type:"string"}, monthly_payment:{type:"number"}, remaining_balance:{type:"number"},
            remaining_months:{type:"number"}, end_date:{type:"string"},
            is_confirmed_loan:{type:"boolean"}, needs_clarification:{type:"boolean"}
        }}},
        credit_cards: { type: "array", items: { type: "object", properties: {
            description:{type:"string"}, monthly_payment:{type:"number"},
            monthly_amounts_seen:{type:"array", items:{type:"number"}}, is_suspicious:{type:"boolean"}
        }}},
        tax_assessments: { type: "array", description: '🚨 MANDATORY — מערך שומות מס. חלץ כל שומת מס בנפרד — כולל שומות זוגיות (שתי עמודות בנפרד). כותרות מזהות: "הודעת שומה", "שומה עצמית", "הודעה על שומה", "הודעה על החזר מס", "דו"ח שנתי", כל מסמך של "רשות המסים"/"מדינת ישראל / האוצר" עם "שנת מס". אסור להחזיר מערך ריק כשקיים מסמך כזה.', items: { type: "object", required: ["tax_year", "taxpayer_name"], properties: {
            tax_year: { type: "string", description: 'שנת המס (YYYY) — חלץ מ"שנת מס" בכותרת השומה' },
            taxpayer_name: { type: "string", description: 'שם הנישום כפי שמופיע בשומה — חובה. בשומה זוגית: שדה זה = שם "בן הזוג הרשום"' },
            taxpayer_id: { type: "string", description: 'ת.ז. 9 ספרות של הנישום — מספר התיק/ת.ז. שבראש השומה' },
            spouse_name: { type: "string", description: 'שם בן/בת הזוג בשומה זוגית — אם קיים' },
            spouse_id: { type: "string", description: 'ת.ז. 9 ספרות של בן/בת הזוג בשומה זוגית — אם קיים' },
            total_taxable_income: { type: "number", description: 'ס"ה הכנסה חייבת במס של הנישום הרשום — שורת "ס"ה הכנסות" או "הכנסה חייבת"' },
            business_income: { type: "number", description: 'הכנסה מעסק/משלח יד של הנישום הרשום — שורת "מעסק"/"משלח יד"/"רווח"' },
            salary_income: { type: "number", description: 'הכנסה ממשכורת של הנישום הרשום — שורת "ממשכורת"' },
            spouse_total_income: { type: "number", description: 'ס"ה הכנסה חייבת של בן/בת הזוג (עמודה שנייה בשומה זוגית)' },
            spouse_business_income: { type: "number", description: 'הכנסה מעסק של בן/בת הזוג (עמודה שנייה) — חובה לחלץ אם קיימת' },
            spouse_salary_income: { type: "number", description: 'הכנסה ממשכורת של בן/בת הזוג (עמודה שנייה)' },
            tax_refund: { type: "number", description: 'החזר מס אם מופיע' },
            issuing_office: { type: "string", description: 'פקיד השומה / משרד המיסים שהנפיק' }
        }}},
        cpa_letters: { type: "array", description: 'מכתבי רו"ח / אישורי רואה חשבון. כותרות מזהות: "דוח הכנסות והוצאות", "אישור רו"ח", "מכתב רואה חשבון", כל מסמך חתום ע"י רו"ח המציין "רווח לפני מס"/"מחזור הכנסות". אסור להחזיר מערך ריק כשקיים מסמך כזה.', items: { type: "object", required: ["business_owner_name"], properties: {
            business_owner_name: { type: "string", description: 'שם בעל העסק כפי שמופיע במכתב — חובה לזיהוי שיוך' },
            business_owner_id: { type: "string", description: 'ת.ז. 9 ספרות של בעל העסק — אם מופיעה' },
            tax_year: { type: "string", description: 'שנת המס של המכתב (YYYY)' },
            pre_tax_profit: { type: "number", description: 'רווח לפני מס — "הרווח המשוער לפני מס" / "רווח"' },
            annual_income: { type: "number", description: 'הכנסה שנתית כוללת לפי המכתב' },
            monthly_income: { type: "number", description: 'הכנסה חודשית ממוצעת לפי המכתב — אם מופיעה מפורשות' },
            turnover: { type: "number", description: 'מחזור הכנסות השנתי — "מחזור"' },
            cpa_name: { type: "string", description: 'שם רואה החשבון החותם' }
        }}},
        business_data: { type: "object", description: 'נתוני עסק/עצמאי. מלא אובייקט זה תמיד כשנמצא דוח שנתי, שומת מס, מכתב רו"ח או אישור עוסק — גם אם אין לאותו אדם תלושי שכר כלל. עצמאי/עוסק פטור מוכיח הכנסה דרך הרווח השנתי המוצהר (רו"ח/שומה), לא דרך תלוש. חלץ את ההכנסה מהדוח השנתי גם בהיעדר תלושים.', properties: {
            owner_borrower_index:{type:"number", description:'0 עבור לווה 1, 1 עבור לווה 2. קבע את האינדקס אך ורק לפי השם הרשום על שומת המס או מכתב הרו"ח מול שמות הלווים.'},
            owner_name:{type:"string", description:'השם המלא של בעל העסק כפי שמופיע על שומת המס / מכתב הרו"ח / אישור עוסק. חובה לחלץ כדי לשייך נכון.'},
            owner_id:{type:"string", description:'ת.ז. 9 ספרות של בעל העסק כפי שמופיעה על שומת המס / מכתב הרו"ח, אם קיימת'},
            is_osek_patur:{type:"boolean", description:'true אם זה עוסק פטור'},
            average_monthly_income:{type:"number", description:'הכנסה חודשית ממוצעת מהעסק. אם יש רק דוח שנתי — חשב מהרווח השנתי המוצהר חלקי 12.'},
            cpa_monthly_income:{type:"number"}, cpa_annual_income:{type:"number", description:'הכנסה שנתית לפי מכתב רו"ח / דוח שנתי'},
            cpa_pre_tax_profit:{type:"number", description:'רווח לפני מס לפי מכתב רו"ח / דוח שנתי (גם לעוסק פטור — סכום הרווח המוצהר). זהו מקור ההכנסה העיקרי לעצמאי ללא תלושים.'},
            annual_income_year1:{type:"number", description:'רווח/הכנסה שנתית לשנה האחרונה לפי דוח שנתי או שומת מס'}, annual_income_year2:{type:"number"}, annual_income_year3:{type:"number"},
            salary_income_year1:{type:"number"}, salary_income_year2:{type:"number"},
            year1_label:{type:"string"}, year2_label:{type:"string"}, year3_label:{type:"string"},
            turnover:{type:"number"}, seniority_years:{type:"number"}, income_trend:{type:"string"}, tax_debt:{type:"number"}
        }},
        property_value: { type: "number" },
        requested_loan_amount: { type: "number" }, requested_loan_years: { type: "number" },
        property_purpose: { type: "string", description:'דירה_יחידה/דירה_חלופית/דירה_להשקעה' },
        tabu_data: { type: "object", description: 'נסח רישום מקרקעין (טאבו) / אישור זכויות. זהה אותו לפי כל אחת מהכותרות הבאות: "העתק רישום מפנקס הבתים המשותפים", "העתק רישום מפנקס בתים משותפים", "נסח רישום מקרקעין", "נסח טאבו", "אישור זכויות", או כל מסמך של "רשות מקרקעי ישראל"/"לשכת רישום המקרקעין" המכיל גוש וחלקה. חלץ אותו כאן ומפה גוש/חלקה/בעלים/משכנתא.', properties: {
            gush:{type:"string", description:'מספר גוש'}, helka:{type:"string", description:'מספר חלקה'}, tat_helka:{type:"string", description:'תת-חלקה'},
            address:{type:"string", description:'כתובת הנכס כפי שמופיעה בנסח'},
            owners:{type:"array", description:'בעלי הזכויות בנכס', items:{type:"object", properties:{
                name:{type:"string"}, id:{type:"string", description:'ת.ז. 9 ספרות של הבעלים'}, ownership_share:{type:"string", description:'חלק בבעלות, למשל "1/2"'}
            }}},
            registered_mortgage:{type:"object", description:'משכנתא רשומה על הנכס (תחת הכותרת "משכנתאות")', properties:{
                bank_name:{type:"string", description:'שם הבנק/חברה שלטובתה רשומה המשכנתא'}, amount:{type:"number", description:'סכום המשכנתא הרשומה בש"ח'}, rank:{type:"string", description:'דרגה (ראשונה/שנייה)'}
            }},
            property_value:{type:"number", description:'שווי הנכס אם מופיע במסמך'}
        }},
        real_estate_properties: { type: "array", description: 'כל נכס מקרקעין שנמצא לו מסמך רישום. זהה אותו לפי הכותרות: "העתק רישום מפנקס הבתים המשותפים", "נסח רישום מקרקעין", "נסח טאבו", "אישור זכויות", או מסמך של "רשות מקרקעי ישראל"/"לשכת רישום המקרקעין" המכיל גוש וחלקה. חובה לאכלס מערך זה במלואו כשמסמך כזה קיים — חלץ במדויק את הגוש, החלקה, הבעלים והמשכנתאות הרשומות עליו. תומך בריבוי נכסים (נכס משועבד + נכס נרכש).', items: { type: "object", properties: {
            gush:{type:"string", description:'מספר גוש'}, helka:{type:"string", description:'מספר חלקה'}, tat_helka:{type:"string", description:'תת-חלקה'},
            address:{type:"string", description:'כתובת הנכס כפי שמופיעה בנסח'},
            property_role:{type:"string", description:'נכס_משועבד_קיים/נכס_נרכש/נכס_להשקעה — אם ניתן להסיק'},
            owners:{type:"array", description:'בעלי הזכויות בנכס', items:{type:"object", properties:{
                name:{type:"string"}, id:{type:"string", description:'ת.ז. 9 ספרות של הבעלים'}, ownership_share:{type:"string", description:'חלק בבעלות, למשל "1/2"'}
            }}},
            registered_mortgages:{type:"array", description:'משכנתאות רשומות על הנכס (תחת הכותרת "משכנתאות")', items:{type:"object", properties:{
                bank_name:{type:"string", description:'שם הבנק/חברה שלטובתה רשומה המשכנתא'}, amount:{type:"number", description:'סכום המשכנתא הרשומה בש"ח'}, rank:{type:"string", description:'דרגה (ראשונה/שנייה)'}
            }}},
            property_value:{type:"number", description:'שווי הנכס אם מופיע במסמך'}
        }}},
        bank_statements: { type: "array", items: { type: "object", properties: {
            account_last4:{type:"string"}, bank_name:{type:"string"},
            account_holder_name:{type:"string", description:'שם בעל החשבון מכותרת הדף — אל תמציא'}, period_start:{type:"string"}, period_end:{type:"string"}
        }}},
        cash_flow_summary: { type: "array", items: { type: "object", properties: {
            account_last4:{type:"string"}, avg_credit:{type:"number"}, avg_debit:{type:"number"},
            avg_balance:{type:"number"}, lowest_balance:{type:"number"}, chronic_overdraft:{type:"boolean"}
        }}},
        income_deposits: { type: "array", items: { type: "object", properties: {
            description:{type:"string"}, source_type:{type:"string", description:'משכורת/קצבה/שכ_דירה/העברה/אחר'},
            average_monthly:{type:"number"}, is_income:{type:"boolean"}, borrower_index:{type:"number"}
        }}},
        equity_events: { type: "array", description:'כל זכות בעו"ש מעל 50,000 ש"ח = העברת_הון', items: { type: "object", properties: {
            date:{type:"string"}, description:{type:"string"}, amount:{type:"number"},
            type:{type:"string"}, borrower_index:{type:"number"}, is_incoming:{type:"boolean"}
        }}},
        keren_hishtalmut: { type: "array", items: { type: "object", properties: {
            fund_name:{type:"string"}, borrower_index:{type:"number"},
            accumulated_balance:{type:"number"}, is_accessible:{type:"boolean"}, maturity_date:{type:"string"},
            monthly_payout:{type:"number"}, owner_id:{type:"string"}
        }}},
        pension_funds: { type: "array", items: { type: "object", properties: {
            fund_name:{type:"string"}, borrower_index:{type:"number"},
            accumulated_balance:{type:"number"}, is_accessible:{type:"boolean"}, fund_type:{type:"string"}
        }}},
        rental_income: { type: "array", items: { type: "object", properties: {
            monthly_amount:{type:"number"}, property_description:{type:"string"}, is_declared:{type:"boolean"}, borrower_index:{type:"number"}
        }}},
        disability_info: { type: "object", properties: {
            disability_percentage:{type:"number"}, monthly_amount:{type:"number"},
            valid_until:{type:"string"}, issuing_body:{type:"string"}, is_lifetime:{type:"boolean"}
        }},
        bank_red_flags: { type: "array", items: { type: "string" } },
        bdi_red_flags: { type: "array", items: { type: "string" } },
        aml_red_flags: { type: "array", items: { type: "string" } },
        undisclosed_loan_indicators: { type: "array", items: { type: "string" } },
        special_circumstances: { type: "array", items: { type: "string" } },
        reserve_duty_months: { type: "array", items: { type: "string" } },
        gambling_detected: { type: "boolean" }, crypto_detected: { type: "boolean" },
        foreign_transfers_detected: { type: "boolean" }, wage_garnishment_detected: { type: "boolean" },
        alimony_monthly: { type: "number" }, child_support_monthly: { type: "number" },
        rent_payment_monthly: { type: "number" }, car_lease_monthly: { type: "number" },
        actionable_recommendations: { type: "array", items: { type: "object", properties: {
            priority:{type:"string"}, category:{type:"string"}, text:{type:"string"}, for_whom:{type:"string"}
        }}}
    }
};

const SCHEMA_CHUNKS = [chunkA, chunkB];

// DEBT_MANDATE הוסר — גרם למודל לחרוג מ-120s על מסמכים ארוכים

const chunkPrompt = (idx) => {
    const focus = [
        'זהות הלווים (שמות, ת.ז. 9 ספרות ליד "מספר זהות"/"ת.ז." בלבד — לא מספר עובד, תאריך לידה/הנפקה, מעסיק, סוג תעסוקה) + תלושי שכר לכל לווה בנפרד (ברוטו, נטו, מעסיק, ניכויים כולל ESPP/RSU/ליסינג/הלוואות/קרן השתלמות) + מסמכי חופשה/שבתון/חל"ת (leave_documents). זהה בדייקנות תלושים מורכבים של משרד החינוך/רשויות.',
        '🚨 PRIORITY 1 — דוחות יתרות לסילוק משכנתא (mortgage_clearance_reports): זהה כל מסמך בנקאי המכיל טבלת מסלולים עם ריביות ויתרות. זה כולל: "ריכוז יתרות", "פירוט משכנתאות", "אישור פרטי הלוואה", "יתרה לסילוק", "מצב חשבון הלוואות", "Loan Payoff Statement", ו-ANY מסמך של בנק הפועלים/לאומי/מזרחי/דיסקונט/בינלאומי המכיל עמודות ריבית + יתרה. עבור כל מסמך כזה: (1) צור איבר ב-mortgage_clearance_reports, (2) מלא total_clearance_balance מהשורה המסכמת, (3) חלץ כל שורת מסלול ל-tracks עם track_name + current_interest_rate + total_balance + remaining_months. אסור בתכלית להחזיר tracks=[] כשיש טבלה. חוק קריטי: שלוף יתרה מעמודת "יתרה לסילוק" — לא מעמודת "קרן". PRIORITY 2 — חובות ומשכנתא (משכנתא קיימת → existing_mortgage, הלוואות, כרטיסי אשראי, נתוני עסק משומות מס/רו"ח/אישור עוסק, שווי נכס, נסח טאבו → tabu_data) + תזרים בנקאי (דפי עו"ש, תנועות הכנסה, אירועי הון מעל 50,000 ש"ח, קרנות השתלמות/פנסיה, שכירות, דגלי אזהרה).'
    ];
    return `אתה חתם משכנתאות בכיר. חלץ מהמסמך/ים המצורפים את הנתונים הבאים בלבד, בדיוק מרבי, והחזר JSON תקין לפי הסכמה.

התמקד בחילוץ הלוואות מרכזיות (הלוואות צרכניות, רכב, אישיות) והתעלם מחיובי עו"ש קטנים וחד-פעמיים.

מיקוד: ${focus[idx]}

🔒 כלל-על #1 — ENTITY RESOLUTION (שיוך מסמך לאדם), הכלל החשוב ביותר:
זהירות! מסמכים עשויים להיות שייכים ללווים שונים (למשל בעל ואישה). קרא למי מופנה המסמך (למשל אישור שבתון או תלוש) ושייך אותו אך ורק לאותו אדם תחת מערך ה-borrowers. לעולם אל תשליך מסמך של לווה א' על לווה ב'.

🛑🛑 חוק ברזל מוחלט — איסור חילוץ שמות קרובי משפחה מהספח (הבאג #1 הקריטי):
בספח תעודת זהות ישראלי מופיעים, מתחת לפרטי בעל התעודה, השדות: "שם האב", "שם הסב", "שם האם". אלה שמות של הורים/סבים — הם **אינם לווים ואינם בני אדם בתיק, לעולם**.
התעלם לחלוטין מכל שדה הכולל את המילים "שם האב", "שם האם", "שם הסב", "שם הסבא", או "שם הורה". אסור בתכלית האיסור ליצור לווה (borrower) על בסיס שם שהופיע באחד מהשדות הללו.
🔴 דוגמה מפורשת מתיק קצב (עמוד 2): בספח ת.ז. של פמלה קצב מופיע "שם הסב: יהודה". יהודה הוא הסב של פמלה — הוא **אינו לווה**, אסור ליצור עבורו borrower, אסור לתת לו ת.ז. או id_document_found. הלווה השני הנכון הוא **דורון קצב**, שמופיע במסמכי השבתון (מכתב שבתון/אישור חופשה) הממוענים אליו.

🟢 שדה "בן זוג"/"בת זוג" שונה לחלוטין מהורה/סב — זהו לרוב הלווה השני האמיתי בתיק, לא קרוב משפחה שיש להתעלם ממנו. אם שדה "בן זוג"/"בת זוג" בספח מכיל שם ומספר ת.ז. — חובה להוסיף אותו/ה כלווה שני (borrowers[1]) עם השם והת.ז. שחולצו, אלא אם ידוע שהם גרושים (ר' כלל הגירושין למעלה בתיאור השדה borrowers). אל תשמיט את הלווה השני רק כי לא הועלה עבורו/ה מסמך תעודת זהות נפרד משלו/שלה — סמן זאת באמצעות id_document_found=false (ר' הגדרת השדה בסכמה), לעולם לא באמצעות השמטת הלווה כולו מהמערך.

חלץ את שם הלווה אך ורק תחת התוויות "שם פרטי" + "שם משפחה" של בעל התעודה עצמו, או תחת "בן זוג"/"בת זוג" כמתואר למעלה. אם השם הפרטי של הלווה מופיע במכתב נלווה הממוען אליו (אישור משרד החינוך, שבתון, שומת מס, נסח טאבו) — זהו השם האמיתי, העדף אותו על פני כל שם בספח.
• מסמך שבתון/חל"ת/חופשה (אישור חופשה ללא תשלום, מכתב שבתון, אישור חל"ד): ממוען לאדם אחד בלבד. זהה את השם והת.ז. שעל המסמך, ומלא את נתוני החופשה בצורה מובנית בשדה sabbatical_info של אותו לווה בלבד (וגם ב-leave_documents עם belongs_to_name/belongs_to_id). אל תקבע שלווה מסוים בשבתון אלא אם המסמך ממוען אליו במפורש. אם ללווה יש תלושי שכר פעילים מהחודשים האחרונים — הוא איננו בשבתון, גם אם בתיק קיים מכתב שבתון של לווה אחר. השאר את sabbatical_info של הלווה הפעיל ריק (null).
⚠️ מעסיק מול גוף משלם זמני (מלכודת שבתון): כשלווה הוא מורה במשרד החינוך הנמצא בשנת שבתון — שדה employer חייב להישאר "משרד החינוך" (מקום העבודה הקבוע), ושדה employment_type = "שכיר (שנת שבתון)". לעולם אל תכניס לשדה employer את "קרן השתלמות למורים וגננות", את קרן הפנסיה, או כל גוף שמעביר את מענק השבתון — אלה מקור הכנסה זמני בלבד, לא המעסיק. וכמובן אל תדביק את המילה "שבתון" לשם הפרטי/משפחה של הלווה.
• שומת מס / מכתב רו"ח / אישור עוסק (עצמאי/עוסק פטור): ממוענים לבעל העסק בלבד. מלא owner_name ו-owner_id מתוך המסמך, ושייך לפי השם — אל תניח שזה הלווה הראשי.

🔒 כלל-על #2 — חילוץ טאבו קשיח (Property Blindness — אסור!):
מסמך מקרקעין ישראלי מזוהה לפי אחת מהכותרות: "העתק רישום מפנקס הבתים המשותפים", "העתק רישום מפנקס בתים משותפים", "נסח רישום מקרקעין", "נסח טאבו", "אישור זכויות", או כל מסמך של "רשות מקרקעי ישראל"/"לשכת רישום המקרקעין" המכיל גוש וחלקה. אם זיהית מסמך כזה — חובה מוחלטת לאכלס את real_estate_properties (וגם tabu_data לנכס העיקרי) במלואו: גוש, חלקה, כל הבעלים עם הת.ז. וחלקם, וכל המשכנתאות הרשומות (תחת הכותרת "משכנתאות") עם שם הבנק והסכום. נסח שמכיל משכנתא רשומה (למשל בנק בינלאומי) הוא קריטי לחישוב LTV — אסור בתכלית להחזיר 0 נכסים כשקיים נסח בתיק.

🔒 כלל-על #2ב — מחלץ יתרות אוניברסלי (UNIVERSAL MORTGAGE EXTRACTOR — קריטי למחזור):
אתה מזהה דוח יתרות לסילוק לפי המבנה שלו, לא לפי שם הבנק או כותרת ספציפית. כל בנק בישראל מנפיק מסמך כזה בשם שונה — חובה לזהות את כולם. חפש סמנים מבניים: יתרה לסילוק כוללת, יתרות מסלול בודדות (קרן/הצמדה), וזיהוי בנק (טקסט לוגו/כותרת). מפה כל וריאציה לסכמה המאוחדת mortgage_clearance_reports.
מונחים נרדפים שכל אחד מהם = דוח יתרות לסילוק (חפש את כולם): "אישור זכויות וחובות", "הודעת ריכוז יתרות" / "ריכוז יתרות שנתי" / "הודעת ריכוז יתרות שנתי", "פירוט הלוואות ומשכנתאות", "פירוט משכנתאות", "אישור פרטי הלוואה/ות", "יתרה לסילוק", "סילוקין" / "סכום לסילוק", "מצב חשבון הלוואות", "דוח יתרות", "Loan Payoff Statement".
🏦 הבנק הבינלאומי / FIBI (חובה מיוחדת — כותרות ייחודיות!): מסמכי הבינלאומי נושאים את הכותרות המדויקות הבאות — "הבינלאומי משכנתאות", "אישור פרטי הלוואה/ות", "הודעת ריכוז יתרות שנתי". זהה אותם בוודאות גם בלי המילים "יתרה לסילוק". בתוך הטבלאות של הבינלאומי: עמודת "יתרת הקרן" + עמודת "יתרת ריבית" = total_balance של כל שורת מסלול. 🚨 חוק קריטי לסה"כ הבינלאומי: total_clearance_balance חייב להילקח מ**שורת הסה"כ בלבד** שבתחתית הטבלה (לרוב מסומנת "סה"כ" / "סכום כולל" / "סה"כ לסילוק"). אסור בתכלית לחבר עמודת "יתרת הקרן" של כל המסלולים בנפרד — השורה המסכמת היא מקור האמת ומכילה את הסכום המדויק לסילוק. אל תחזיר מערך ריק רק כי המסמך לא כתב במפורש "יתרה לסילוק".
תקף לכל הבנקים ללא יוצא מן הכלל: טפחות/מזרחי-טפחות, לאומי, הפועלים, דיסקונט, הבינלאומי, מסד, ירושלים, אוצר החייל, יהב, מרכנתיל. אל תניח שרק בנק מסוים מנפיק מסמך כזה.
לכל בנק כזה צור איבר אחד ב-mortgage_clearance_reports עם: שם הבנק (מהלוגו/כותרת), היתרה הכוללת לסילוק (total_clearance_balance — קרן+הצמדה+עמלות משורת הסה"כ), עמלת היוון/פירעון מוקדם (early_repayment_fee), ומערך tracks של כל מסלול בנפרד (שם המסלול, סוג, יתרת קרן, יתרה כוללת, ריבית נוכחית, בסיס ריבית, סוג הצמדה linkage, מועד פירעון, עמלת היוון). אסור בתכלית להחזיר מערך ריק כשקיים מסמך כזה בתיק — בלי מסלולי המשכנתא הקיימת אי אפשר לנתח כדאיות מחזור.
🔴 ABSOLUTE RULE — tracks חובה: אם זיהית מסמך יתרות לסילוק (בכל שם/כותרת), ויש בו טבלה עם יותר משורה אחת — כל שורה חייבת להפוך ל-track נפרד. track ללא current_interest_rate וללא total_balance = שגיאה קריטית. ריבית "0" היא לגיטימית (פריים) — חלץ אותה. tracks=[] כשיש טבלה = אסור מוחלט. מסמך בנק הפועלים עם עמודות "שם מסלול / ריבית / יתרה" = חובה לחלץ כל שורה.

🔒 כלל-על #3 — עצמאי לעומת שכיר (חילוץ הכנסת עצמאי — קריטי!):
אם מצאת דוח שנתי, שומת מס או מכתב רו"ח — מלא את business_data וחלץ את ההכנסה השנתית/הרווח המוצהר משם, גם אם לאותו אדם אין תלושי שכר כלל. עצמאי/עוסק פטור מוכיח הכנסה דרך הדוח השנתי ולא דרך תלוש. אל תסמן עצמאי כ"חסר תלושים".
🧾 מחלץ שומות מס ומכתבי רו"ח אוניברסלי — זהה לפי מבנה, לא לפי כותרת מדויקת:
• שומת מס / הודעת שומה: כותרות נרדפות — "הודעה על החזר מס", "הודעת שומה", "שומה עצמית", "הודעה על שומה", "דו"ח שנתי", מסמך של "רשות המסים"/"מדינת ישראל / האוצר" עם "שנת מס" וטבלת הכנסות. שלוף ל-annual_income_year1/year2/year3 את "ס"ה הכנסות" או "ההכנסה החייבת במס" של כל שנה. מלא year1_label/year2_label עם שנת המס. owner_id = מספר התיק/ת.ז. 9 ספרות שבראש השומה.
🚨🚨 שומת מס זוגית (בני זוג) — הבאג #2 הקריטי, חובה מוחלטת לחלץ את שתי העמודות בנפרד:
בשומה משותפת מופיעות שתי עמודות הכנסה: "בן הזוג הרשום" (לרוב בעל העסק) מול "בן/בת הזוג". בתוך כל עמודה יש שורות נפרדות: "הכנסה מעסק/משלח יד" (= הכנסת העצמאי) ו-"הכנסה ממשכורת" (= הכנסת השכיר).
• חובה: חלץ את שורת "מעסק"/"משלח יד"/"מחזור"/"רווח" → business_data.annual_income_year1 (וזו הכנסת העצמאי, גם אם היא בעמודת בן/בת הזוג ולא בעמודת בן הזוג הרשום!). אל תדלג עליה ואל תאחד אותה עם המשכורת.
• חלץ את שורת "ממשכורת" של אותו אדם → salary_income_year1.
• אם בשומה אדם אחד עם "מעסק" ואדם שני עם "ממשכרת" — זה תיק זוגי קלאסי (עצמאי + שכיר). מלא business_data לעצמאי (owner_name + owner_id שלו לפי טור ההכנסה מעסק), ושייך את המשכורת לשני. לעולם אל תחזיר business_data ריק כשמופיעה שורת "מעסק"/"משלח יד" עם סכום > 0.
• owner_name/owner_id של business_data = השם והת.ז. של בעל ההכנסה מעסק (העמודה עם "מעסק"), לא של השכיר.
• מכתב רו"ח: כותרות נרדפות — "דוח הכנסות והוצאות", "אישור רו"ח", "מכתב רואה חשבון", כל מסמך חתום ע"י רו"ח המציין "רווח לפני מס"/"מחזור הכנסות"/"רווח משוער". שלוף cpa_pre_tax_profit מ-"הרווח המשוער לפני מס" וגם cpa_annual_income, ו-turnover מ-"מחזור ההכנסות". owner_name = שם העוסק כפי שמופיע במכתב.
⚠️ זיהוי שם חיבה/קיצור: שם העוסק במכתב הרו"ח עשוי להופיע בכינוי/קיצור (למשל "יקים") בעוד בת.ז. מופיע השם המלא ("יעקב") — זהו אותו אדם. אל תיצור לווה נפרד; מלא תמיד owner_id (ת.ז. 9 ספרות) כדי לאפשר שיוך מדויק גם כשהשם שונה.

חוקי ברזל: מספר עובד אינו ת.ז.. אל תעתיק מעסיק בין לווים. שמור הכנסת שכיר ועצמאי בשדות נפרדים. אל תמציא נתונים — אם שדה לא נמצא, השאר null/ריק.`;
};

// ── merge של 2 הצ'אנקים של אותו קובץ — additive, never overwrite non-empty ──
const isMeaningfulObject = (o) => o && typeof o === 'object' && Object.values(o).some(v =>
    v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0) &&
    !(typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0)
);

// ── Name Sanitizer: מנקה סטטוס תעסוקה/תארים שנדבקו לשם הלווה (הזיית OCR) ──
// "שבתון דורון קצב" → "דורון קצב". "עו""ד שרה לוי" → "שרה לוי".
const NAME_NOISE_PREFIXES = [
    'שבתון', 'חל"ת', 'חלת', 'חופשת לידה', 'חל"ד', 'חלד', 'מחלה', 'גמלאי', 'גמלאית',
    'עצמאי', 'עצמאית', 'שכיר', 'שכירה', 'מר', 'גברת', 'גב\'', 'ד"ר', 'דר\'', 'עו"ד', 'עוד',
    'רו"ח', 'רוח', 'פרופ\'', 'מהנדס', 'מר.', 'sabbatical', 'mr', 'mrs', 'dr'
];
const sanitizeBorrowerName = (name) => {
    if (!name || typeof name !== 'string') return name;
    let cleaned = name.trim();
    // הסר עד 2 מילות-רעש מתחילת השם (סטטוס/תואר), שוב ושוב
    for (let pass = 0; pass < 2; pass++) {
        const firstWord = cleaned.split(/\s+/)[0] || '';
        const isNoise = NAME_NOISE_PREFIXES.some(p => firstWord === p || firstWord.replace(/["'.]/g, '') === p.replace(/["'.]/g, ''));
        if (isNoise) {
            cleaned = cleaned.slice(firstWord.length).trim();
        } else break;
    }
    return cleaned || name.trim();
};

const mergeChunks = (results) => {
    const safe = (results || []).filter(r => r && typeof r === 'object');
    if (!safe.length) return null;
    const merged = { ...(safe[0] || {}) };
    const ARRAY_KEYS = [
        'payslips_borrower1','payslips_borrower2','loans','credit_cards','equity_events',
        'income_deposits','keren_hishtalmut','pension_funds','pension_slips','bank_statements',
        'payslip_deductions','payslip_deduction_alerts','actionable_recommendations',
        'all_mortgages','cash_flow_summary','rental_income','reserve_duty_months','leave_documents',
        'real_estate_properties','mortgage_clearance_reports',
        'tax_assessments','cpa_letters'
    ];
    const SET_KEYS = [
        'bank_red_flags','bdi_red_flags','aml_red_flags','special_circumstances',
        'undisclosed_loan_indicators','detected_case_types'
    ];
    for (let i = 1; i < safe.length; i++) {
        const r = safe[i] || {};
        ARRAY_KEYS.forEach(k => { merged[k] = [...(merged[k] || []), ...(r[k] || [])]; });
        SET_KEYS.forEach(k => { merged[k] = [...new Set([...(merged[k] || []), ...(r[k] || [])])]; });
        if (r.borrowers?.length) {
            const cur = merged.borrowers || [];
            const keyOf = (b) => (String(b?.id || '').replace(/\D/g, '').padStart(9, '0')) || (b?.name || '').trim();
            const byKey = new Map(cur.map(b => [keyOf(b), b]));
            r.borrowers.forEach(b => {
                const k = keyOf(b);
                if (!k) { cur.push(b); return; }
                if (byKey.has(k)) {
                    const existing = byKey.get(k);
                    Object.keys(b).forEach(f => {
                        const ev = existing[f];
                        if (ev === null || ev === undefined || ev === '') existing[f] = b[f];
                    });
                } else { byKey.set(k, b); cur.push(b); }
            });
            merged.borrowers = cur;
        }
        if (isMeaningfulObject(r.existing_mortgage)) {
            const cur = isMeaningfulObject(merged.existing_mortgage) ? { ...merged.existing_mortgage } : {};
            Object.keys(r.existing_mortgage).forEach(f => {
                const cv = cur[f];
                const rv = r.existing_mortgage[f];
                // tracks: additive merge — לא מחליף, מחבר
                if (f === 'tracks' && Array.isArray(rv) && rv.length > 0) {
                    cur[f] = [...(Array.isArray(cv) ? cv : []), ...rv];
                    return;
                }
                const curEmpty = cv === null || cv === undefined || cv === '' || (Array.isArray(cv) && cv.length === 0);
                const rvFilled = !(rv === null || rv === undefined || rv === '' || (Array.isArray(rv) && rv.length === 0));
                if (curEmpty && rvFilled) cur[f] = rv;
            });
            merged.existing_mortgage = cur;
        }
        if (!isMeaningfulObject(merged.business_data) && isMeaningfulObject(r.business_data)) merged.business_data = r.business_data;
        if (!isMeaningfulObject(merged.tabu_data) && isMeaningfulObject(r.tabu_data)) merged.tabu_data = r.tabu_data;
        if (!isMeaningfulObject(merged.disability_info) && isMeaningfulObject(r.disability_info)) merged.disability_info = r.disability_info;
        if (!merged.property_value && r.property_value) merged.property_value = r.property_value;
        if (!merged.requested_loan_amount && r.requested_loan_amount) merged.requested_loan_amount = r.requested_loan_amount;
        if (!merged.requested_loan_years && r.requested_loan_years) merged.requested_loan_years = r.requested_loan_years;
        if (!merged.property_purpose && r.property_purpose) merged.property_purpose = r.property_purpose;
        ['alimony_monthly','child_support_monthly','rent_payment_monthly','car_lease_monthly'].forEach(k => {
            if (!merged[k] && r[k]) merged[k] = r[k];
        });
        merged.gambling_detected = merged.gambling_detected || r.gambling_detected;
        merged.crypto_detected = merged.crypto_detected || r.crypto_detected;
        merged.foreign_transfers_detected = merged.foreign_transfers_detected || r.foreign_transfers_detected;
        merged.wage_garnishment_detected = merged.wage_garnishment_detected || r.wage_garnishment_detected;
    }
    // ── ניקוי שמות לווים: הסרת סטטוס תעסוקה/תארים שנדבקו לשם (הזיית OCR — "שבתון דורון קצב") ──
    if (Array.isArray(merged.borrowers)) {
        merged.borrowers = merged.borrowers.map(b => b && b.name ? { ...b, name: sanitizeBorrowerName(b.name) } : b);
    }
    return merged;
};

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        // ── NO AUTH GATE (intentional) ──
        // This function is the shared extraction engine for BOTH the public, anonymous
        // Quick Check flow (prospects with no account) and the authenticated Underwriter
        // flow. Same accepted risk posture as extractDocData's public Fast Lane: the
        // real exposure here is cost/abuse (someone hammering this with junk files), not
        // data leakage — this function only ever reads the one file_url it's given, no
        // cross-case/cross-user data access. Rate-limiting is a separate, not-yet-scoped
        // follow-up (see project_document_analysis_architecture memory note).

        const { file_url } = await req.json();
        if (!file_url) {
            return Response.json({ error: 'file_url is required', _failed: true }, { status: 200 });
        }

        console.log(`extractSingleChunk: ${file_url.split('/').pop()} on ${EXTRACTION_MODEL}`);

        // ── CACHE LOOKUP — thorough extraction runs once per physical file, ever ──
        // Any flow (Quick Check, Underwriter async upload, a later re-open of the same
        // case) that touches the same file_url reuses this result instead of re-running
        // the LLM. A prospect's Quick Check documents carry forward unchanged into their
        // real case on conversion, so this also means conversion never re-extracts.
        let existingCacheRecord = null;
        try {
            const cached = await base44.asServiceRole.entities.DocumentExtractionCache.filter({ file_url });
            existingCacheRecord = cached?.[0] || null;
            const fresh = cached.find(c => c.schema_version === SCHEMA_VERSION && c.extracted_data);
            if (fresh) {
                console.log(`extractSingleChunk: CACHE HIT for ${file_url.split('/').pop()}`);
                return Response.json({ ...fresh.extracted_data, _extraction_model: fresh.extraction_model, _from_cache: true }, { status: 200 });
            }
        } catch (cacheReadErr) {
            console.warn('extractSingleChunk: cache lookup failed (continuing without cache):', cacheReadErr?.message);
        }

        // ── Re-upload לאחסון ציבורי — מבטיח נגישות ל-InvokeLLM ──
        // Base44 storage URLs דורשים auth headers שה-LLM לא מעביר. Re-upload יוצר URL ציבורי יציב.
        let accessibleUrl = file_url;
        try {
            const fetchRes = await fetch(file_url);
            if (!fetchRes.ok) throw new Error(`fetch failed: ${fetchRes.status}`);
            const arrayBuffer = await fetchRes.arrayBuffer();
            const uint8 = new Uint8Array(arrayBuffer);
            const ext = file_url.split('.').pop()?.split('?')[0]?.toLowerCase() || 'pdf';
            const mimeMap = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
            const mimeType = mimeMap[ext] || 'application/octet-stream';
            const blob = new Blob([uint8], { type: mimeType });
            const file = new File([blob], `chunk_${Date.now()}.${ext}`, { type: mimeType });
            const uploadRes = await base44.integrations.Core.UploadFile({ file });
            accessibleUrl = uploadRes.file_url;
            console.log(`Re-uploaded to accessible URL: ${accessibleUrl.split('/').pop()}`);
        } catch (uploadErr) {
            console.warn(`Re-upload failed, using original URL: ${uploadErr?.message}`);
            accessibleUrl = file_url;
        }

        const runChunkWithRetry = async (schemaObj, idx, maxAttempts = 1) => {
            // ⚠️ maxAttempts=1 — Deno runtime נהרג אחרי ~150s. retry יגרום לחריגה מהמגבלה.
            // הדפדפן (ב-AsyncDocumentUpload) מנהל retry ברמה גבוהה יותר ללא מגבלת זמן.
            const withTimeout = (promise) => Promise.race([
                promise,
                new Promise((_, reject) => setTimeout(() => reject(new Error(`Schema ${idx} timeout after ${ATTEMPT_TIMEOUT_MS}ms`)), ATTEMPT_TIMEOUT_MS))
            ]);
            const schemaStr = JSON.stringify(schemaObj, null, 2);
            const prompt = chunkPrompt(idx) + `\n\n🔴 CRITICAL OUTPUT FORMAT: Return ONLY a valid JSON object matching this schema — no markdown, no code fences, no explanation. Start your response with { and end with }.\n\nSCHEMA:\n${schemaStr}`;
            let lastErr;
            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                try {
                    const text = await withTimeout(base44.integrations.Core.InvokeLLM({
                        prompt,
                        file_urls: [accessibleUrl],
                        model: EXTRACTION_MODEL
                    }));
                    if (!text || typeof text !== 'string') throw new Error(`Schema ${idx} returned non-string`);
                    // חלץ JSON — ספירת עומק סוגריים
                    const firstBrace = text.indexOf('{');
                    if (firstBrace === -1) throw new Error(`Schema ${idx} response has no JSON object`);
                    let depth = 0, end = -1;
                    for (let i = firstBrace; i < text.length; i++) {
                        if (text[i] === '{') depth++;
                        else if (text[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
                    }
                    if (end === -1) throw new Error(`Schema ${idx} JSON is not closed properly`);
                    const parsed = JSON.parse(text.slice(firstBrace, end + 1));
                    if (typeof parsed !== 'object') throw new Error(`Schema ${idx} parsed to non-object`);
                    return parsed;
                } catch (err) {
                    lastErr = err;
                    const is429 = err?.message?.includes('429') || err?.message?.includes('quota') || err?.message?.includes('rate');
                    const isTimeout = err?.message?.includes('timeout') || err?.message?.includes('Timeout') || err?.name === 'AbortError';
                    const isFetch = err?.message?.includes('fetch') || err?.message?.includes('Fetch') || err?.message?.includes('Failed to fetch');
                    console.error(`Schema ${idx} attempt ${attempt} FAILED — reason: ${isTimeout ? 'LLM_TIMEOUT' : is429 ? 'RATE_LIMIT' : isFetch ? 'FETCH_ERROR' : 'OTHER'} — message: ${err?.message}`);
                    if (attempt < maxAttempts) {
                        const delay = is429 ? 8000 * attempt : 3000 * attempt;
                        console.warn(`Schema ${idx} retrying in ${delay}ms (attempt ${attempt + 1}/${maxAttempts})...`);
                        await new Promise(r => setTimeout(r, delay));
                    }
                }
            }
            throw lastErr;
        };

        // מקביל: שתי הסכמות רצות יחד — זמן כולל = max(Schema0, Schema1) ≈ 80-120s, לא מצטבר.
        // DEBT_MANDATE הוסר → הפרומפט קל יותר → Gemini מסיים ~80-90s ולא מגיע ל-120s.
        console.log('Running Schema 0 + Schema 1 in parallel...');
        const [schemaA, schemaB] = await Promise.all([
            runChunkWithRetry(SCHEMA_CHUNKS[0], 0),
            runChunkWithRetry(SCHEMA_CHUNKS[1], 1)
        ]);
        const chunkResults = [schemaA, schemaB];
        const merged = mergeChunks(chunkResults);
        if (!merged) {
            return Response.json({ error: 'no data extracted', _failed: true }, { status: 200 });
        }

        // ── דטרמיניסטי: אם בקובץ הזה בעצמו אחד הלווים יש לו שדות ת.ז אמיתיים
        // (id_expiry_date/id_issue_date) והאחר לא — האחר לא יכול להיות בעל תעודה עצמאית
        // במסמך הזה, בלי קשר למה שהמודל עצמו קבע ב-id_document_found. סוגר את המקרה שבו
        // אותה קריאת LLM בודדת (לא בעיית מיזוג בין קבצים) קובעת בטעות true לבן/בת הזוג
        // שמוזכר/ת בספח בלבד.
        if (Array.isArray(merged.borrowers)) {
            merged.borrowers = correctUnverifiedBorrowerIds(merged.borrowers);
        }

        merged._extraction_model = EXTRACTION_MODEL;

        // ── CACHE WRITE — best-effort, never blocks the response ──
        try {
            const cachePayload = { file_url, extracted_data: merged, extraction_model: EXTRACTION_MODEL, schema_version: SCHEMA_VERSION };
            if (existingCacheRecord) {
                await base44.asServiceRole.entities.DocumentExtractionCache.update(existingCacheRecord.id, cachePayload);
            } else {
                await base44.asServiceRole.entities.DocumentExtractionCache.create(cachePayload);
            }
        } catch (cacheWriteErr) {
            console.warn('extractSingleChunk: failed to write cache (non-fatal):', cacheWriteErr?.message);
        }

        return Response.json(merged, { status: 200 });

    } catch (error) {
        console.error('extractSingleChunk error:', error?.stack || error);
        // STATUS 200 תמיד — הדפדפן בודק _failed בעצמו ולא נכשל על פירסור שגיאה
        return Response.json({
            error: error?.message || 'extraction failed',
            _failed: true
        }, { status: 200 });
    }
});