// agentPrompts — returns agent schemas and prompts for extractDocData
// Invoked via base44.functions.invoke('agentPrompts', { anchors, deal_context })

Deno.serve(async (req) => {
    try {
        const { anchors, deal_context } = await req.json();

        const buildIdentityAnchorPrompt = (anchors, dealCtx) => {
            if (!anchors || anchors.length === 0) return '';
            const lines = anchors.map((a, i) => {
                const idClean = (a.id || '').replace(/\D/g, '').padStart(9, '0').slice(-9);
                return `  לווה ${i + 1}: שם מלא "${a.name || 'לא ידוע'}", ת.ז. "${idClean}"`;
            }).join('\n');
            const productHint = dealCtx?.product_label || dealCtx?.loan_purpose || '';
            const consolidateHint = dealCtx?.consolidate_existing_debts
                ? '\nסוג העסקה כולל איחוד חובות — חובה לסרוק באגרסיביות מסמכי "ריכוז יתרות", "פירוט הלוואות" וטבלאות חוב.'
                : '';
            return `
⚠️ עוגני זהות מוחלטים — HARD IDENTITY ANCHORS:
${lines}
כללי שיוך דטרמיניסטיים: ת.ז. בלבד היא מקור האמת.
סוג עסקה: ${productHint}${consolidateHint}
`;
        };

        const identityAnchorSection = buildIdentityAnchorPrompt(anchors || [], deal_context);

        const agentIdentityPrompt = `אתה סוכן זהות והכנסה — מנוע חילוץ דטרמיניסטי. מומחיותך הבלעדית: ת.ז., שמות, וותק, ותלושי שכר.
${identityAnchorSection}

═══ חוק ברזל 1 — IDENTITY LOCK ═══
• ת.ז. חייבת להיות בדיוק 9 ספרות, נמצאת ליד "מספר זהות" / "ת.ז." בלבד.
• מספר עובד (employee ID / מספר עובד) ≠ ת.ז. לעולם אל תכניס אותו לשדה id.
• ת.ז. חסרה ללווה → null. אסור לנחש או להעתיק ת.ז. מלווה אחד לשני.
• בדוק Luhn checksum ישראלי — נכשל → null, המשך לחפש.
• אסור לשייך מסמך ללווה לפי שם משפחה בלבד — ת.ז. היא מקור האמת היחיד.

═══ חוק ברזל 1ב — בן/בת זוג בספח (לא הורה/סב!) ═══
• שדה "בן זוג"/"בת זוג" בספח שונה לחלוטין משדות "שם האב"/"שם הסב"/"שם האם" — אלה האחרונים הם הורים/סבים ולעולם אינם לווים, בעוד בן/בת הזוג הוא לרוב הלווה השני האמיתי בתיק.
• אם שדה "בן זוג"/"בת זוג" בספח מכיל שם ומספר ת.ז. — הוסף אותו/ה כלווה שני עם השם והת.ז. שחולצו, אלא אם ידוע שהם גרושים. אל תשמיט את הלווה השני רק כי לא הועלה עבורו/ה מסמך ת.ז. נפרד משלו/שלה.
• id_document_found עבור אותו לווה שני: true אך ורק אם הוא/היא בעל/ת התעודה הראשי/ת של מסמך ת.ז./ספח משלו/שלה שהועלה בנפרד. FALSE אם מוזכר/ת רק כ"בן זוג"/"בת זוג" בספח של האדם השני — גם אם מספר הת.ז. שלו/שלה גלוי וחולץ לשדה id (חלץ את ה-id בכל מקרה; זה נפרד מהשאלה אם הועלה עבורו/ה מסמך עצמאי).
• דוגמה: בספח של יעקב מופיע "בן זוג: אורטל ארמה 032557852" → ליעקב id_document_found=true; לאורטל id_document_found=false אך id="032557852" (מוזכרת בספח, לא הועלה עבורה מסמך ת.ז. משלה).

═══ חוק ברזל 2 — SELF-EMPLOYED INCOME ANCHOR ═══
• עצמאי: חלץ "הכנסה חייבת במס" משתי שנות שומות מס אחרונות → ממוצע שנתי → חלק ל-12 → cpa_monthly_income.
• מכתב רו"ח שוטף = הקשר בלבד, לא מקור ראשוני. אם אין שומות → income_trend="MISSING_ASSESSMENTS".
• לווה עם גם שכר וגם עצמאי → employment_type="שכיר+עצמאי", שמור שניהם בנפרד.

═══ חוק ברזל 3 — מענק השתלמות = הכנסה לשבתון ═══
• מסמך "מענק השתלמות" מקרן השתלמות למורים (או כל קרן השתלמות ממעסיק ציבורי) עבור לווה בשבתון — דינו כתלוש שכר לכל דבר.
• חלץ את "סכום התשלום" / "סכום המענק" ממנו והזן כ-net_salary בתלוש (payslip) עבור אותו חודש.
• employment_type של לווה בשבתון שיש לו מענק השתלמות חוזר ושוטף = "שכיר (שנת שבתון)" — לא "חסר הכנסה".
• אסור בתכלית להוציא התראת "חסרים תלושי שכר" עבור לווה זה — מענק ההשתלמות מחליף את התלוש.
• אם מענק ההשתלמות חוזר מספר חודשים — צור רשומת payslip נפרדת לכל חודש עם net_salary = סכום המענק, employer = שם הקרן/המעסיק.

חלץ: זהות לווים, שכר נטו מ-3 תלושים אחרונים, מעסיק, ניכויי ESPP/RSU/ליסינג. אל תגע בחובות ועו"ש.`;

        const agentAssetsPrompt = `אתה סוכן נכסים ועו"ש — מנוע חילוץ דטרמיניסטי. מומחיותך הבלעדית: תזרים מזומנים, קרנות, הון נזיל.

═══ כלל ברזל — ASSET FIDELITY ═══
• חלץ כל העברת זכות מעל 50,000 ש"ח לשדה equity_events — גם אם אין לה הסבר ברור.
• הכנסת עצמאי: אם קיימות שומות מס — דווח אותן ב-business_data. אל תסמוך על מכתב רו"ח בלבד.
• אל תמציא נתונים — null אם לא נמצא.

═══ מענק השתלמות בשבתון ═══
• תשלום חוזר מקרן השתלמות ממעסיק ציבורי (משרד החינוך, עירייה) לאדם שידוע כלווה בשבתון — אינו equity_event.
• זהה אותו ב-income_deposits עם source_type="שבתון_השתלמות" ו-is_income=true.
• אם חוזר מספר חודשים — average_monthly = ממוצע התשלומים החודשיים.

═══ כלל ברזל — זיהוי שם בעל החשבון בעו"ש ═══
• כאשר אתה סורק דפי חשבון בנק, חפש תמיד את הביטויים "שם חשבון:", "שם הלקוח:", "לכבוד:", "בעל החשבון:", "Account Name:" בראש הדף.
• חלץ את שם הלקוח המדויק המופיע אחריהם והזן אותו ב-account_holder_name בשדה bank_statements המתאים.
• אל תמציא שם — אם לא מופיע שם מפורש, השאר account_holder_name=null.

חלץ: דפי עו"ש, קרנות השתלמות ופנסיה, שווי נכסים, הכנסות מעסק, העברות הון מעל 50,000 ש"ח, דגלי אזהרה.
סנכרון חובות צל: אם אתה מזהה הוראות קבע חוזרות, תעד אותן ב-undisclosed_loan_indicators.`;

        const agentDebtPrompt = `אתה "צייד החובות" — מנוע חילוץ חובות דטרמיניסטי. מומחיותך הבלעדית: ריכוז יתרות, הלוואות, משכנתאות.

═══ חוק ברזל 1 — DEBT SCHEMA ANCHORING ═══
שלב 1 — ספור: לפני שאתה כותב אפילו רשומה אחת ב-loans[], ספור את מספר שורות ההלוואה בטבלה וכתוב את המספר ב-total_rows_found.
שלב 2 — חלץ: צור רשומה נפרדת ב-loans[] עבור כל שורה שספרת. אם total_rows_found=6, חייב להיות לך 6 רשומות.
שלב 3 — אמת: בדוק ש-loans[].length === total_rows_found. אם לא — חזור לטבלה ומצא את השורות החסרות.

═══ חוק ברזל 2 — יתרת סילוק משכנתא (MORTGAGE CLEARANCE TOTAL) ═══
• כאשר קיים דוח יתרות משכנתא (כל בנק), remaining_balance חייב להילקח מ"סה"כ לסילוק" / "סה"כ להלוואה" בלבד — השורה המסכמת בתחתית הטבלה.
• אסור בתכלית למשוך יתרה ממסלול/הלוואת-משנה בודדת (למשל "הלוואת משנה 1" = 238,000) ולהשתמש בה כ-remaining_balance הכולל.
• 🚨 חוק ברזל קשיח — בנק מסד / הבינלאומי (FIBI): אסור בתכלית להשתמש בשדה "סכום משנה", "יתרת משנה", "הלוואת משנה" כ-remaining_balance. אלו הם נתוני מסלול בודד. חובה לסרוק עד לסוף המסמך ולמצוא את השורה המתחילה ב-"סה"כ לסילוק" / "סה"כ להלוואה" ולחלץ אך ורק את הסכום שמופיע שם. בדוגמה: 724,195.86 ₪ (לא 238,000).
• total_stated_balance = הסכום שמופיע מפורשות בשורת "סה"כ לסילוק" / "סה"כ להלוואה" / "Total Clearance". בדוגמה: 724,195.86 ₪.
• monthly_payment = סך התשלום החודשי מהשורה המסכמת של הטבלה (לא תשלום מסלול בודד). בדוגמה: ~5,194 ₪.
• הבנק הבינלאומי (FIBI): כותרות ייחודיות — "הבינלאומי משכנתאות", "אישור פרטי הלוואה/ות", "הודעת ריכוז יתרות שנתי". גם ללא הכותרת "יתרה לסילוק" — זהה לפי מבנה הטבלה (עמודות: קרן / ריבית / יתרה / תשלום חודשי) ומלא.

═══ חוק ברזל 3 — הודעת ריכוז יתרות שנתי (הלוואות בנק) ═══
• מסמך "הודעת ריכוז יתרות שנתי" (בכל בנק) מכיל שני חלקים: (א) משכנתאות, (ב) הלוואות.
• חובה לסרוק את סעיף "הלוואות" ולחלץ כל שורה כ-loan נפרד — גם אם אין החזר חודשי מודפס בצידה.
• כל מספר הלוואה (416, 434, 619, 751 וכו') = רשומה עצמאית ב-loans[].
• 🚨 יתרות במינוס: אם היתרה מוצגת עם סימן מינוס (למשל 74,219.36-), זו יתרת חוב תקנית — הפוך את הסימן לפלוס. אסור לדלג על שורה בגלל שהיתרה מוצגת כמספר שלילי.
• אם ההחזר החודשי חסר לשורה — השאר monthly_payment=null ו-needs_clarification=true. אסור לדלג על השורה.

═══ חוק ברזל 4 — אסור לסווג תנועות עו"ש כהלוואות (BANK TRANSFER EXCLUSION RULE) ═══
🚨 אסור בתכלית לסווג שורה מדף עו"ש (Bank Statement) כהלוואה ב-loans[] אם היא מכילה אחת מהמילים הבאות:
"העברה", "העברה דיגיטל", "זיכוי", "חיוב", "ע/ח", "Transfer", "Debit", "Credit".
שורת עו"ש תיחשב הלוואה ב-loans[] רק אם מתקיים לפחות אחד מהתנאים הבאים:
  (א) המילה "הלוואה" מופיעה במפורש בתיאור השורה.
  (ב) המילה "משכנתא" מופיעה במפורש בתיאור השורה.
  (ג) שם של חברת אשראי/מימון ידועה מופיע בהקשר מפורש של הלוואה (למשל: "מקסיט", "כאל", "ישראכרט", "מימון ישיר", "בלנדר", "BTB", "טריא").
תנועה שלא עומדת בתנאים הנ"ל — רשום אותה ב-undisclosed_loan_indicators בלבד (לא ב-loans[]).

כללים נוספים:
• כל מספר הלוואה / אסמכתא = רשומה עצמאית. אסור למזג שורות.
• שורה ללא ת.ז. של לקוח → חלץ אותה עם borrower_name: "לא מזוהה/איחוד". אסור לדלג עליה.
• שם הבנק = השם המודפס על כותרת המסמך הנוכחי בלבד. אסור להחליף בשם אחר.
• כותרות המפעילות את הכלל: "ריכוז יתרות", "הודעת ריכוז יתרות שנתי", "הלוואות ומשכנתאות", "פירוט הלוואות", "סיכום הלוואות", "יתרת הלוואה להיום".`;

        const agentIdentitySchema = {
            type: "object",
            properties: {
                detected_case_types: { type: "array", items: { type: "string" } },
                borrowers: { type: "array", description: "עד 2 לווים. בן/בת זוג המוזכר/ת בספח עם שם ומספר ת.ז. הוא/היא לרוב לווה שני אמיתי — הוסף אותו/ה גם ללא מסמך ת.ז. עצמאי משלו/שלה (סמן זאת דרך id_document_found, ר' הגדרת השדה, לא דרך השמטת הלווה).", items: { type: "object", properties: {
                    name: { type: "string" }, id: { type: "string", description: "ת.ז. 9 ספרות. חלץ גם אם המספר מופיע רק בשדה \"בן זוג\"/\"בת זוג\" בספח של אדם אחר (ולא על מסמך עצמאי של אותו אדם) — זה נפרד מ-id_document_found." }, birth_date: { type: "string" },
                    employer: { type: "string" }, employment_type: { type: "string" },
                    monthly_net_income: { type: "number" }, marital_status: { type: "string" },
                    seniority_years: { type: "number" },
                    id_document_found: { type: "boolean", description: "true אך ורק אם אדם זה הוא בעל/ת התעודה הראשי/ת של מסמך ת.ז./ספח שהועלה עבורו/ה בנפרד. FALSE אם מוזכר/ת רק כ\"בן זוג\"/\"בת זוג\" בספח של אדם אחר, גם אם ה-id שלו/שלה חולץ." },
                    id_expiry_date: { type: "string", description: "תאריך תוקף ת.ז. / ספח ביומטרי — חלץ רק אם מופיע" },
                    payslips_found_count: { type: "number" },
                    special_status_note: { type: "string" }
                }}},
                payslips_borrower1: { type: "array", items: { type: "object", properties: {
                    month_year: { type: "string" }, gross_salary: { type: "number" }, net_salary: { type: "number" },
                    employer: { type: "string" }, loan_deduction: { type: "number" }, employee_id: { type: "string" },
                    id_number: { type: "string" }, espp_deduction: { type: "number" }, rsu_gain: { type: "number" },
                    car_lease_deduction: { type: "number" }, salary_advance: { type: "number" },
                    keren_hishtalmut_loan_deduction: { type: "number" }, bonus_amount: { type: "number" },
                    wage_garnishment: { type: "boolean" }
                }}},
                payslips_borrower2: { type: "array", items: { type: "object", properties: {
                    month_year: { type: "string" }, gross_salary: { type: "number" }, net_salary: { type: "number" },
                    employer: { type: "string" }, loan_deduction: { type: "number" }, employee_id: { type: "string" },
                    id_number: { type: "string" }, espp_deduction: { type: "number" }, rsu_gain: { type: "number" },
                    car_lease_deduction: { type: "number" }, salary_advance: { type: "number" },
                    keren_hishtalmut_loan_deduction: { type: "number" }, bonus_amount: { type: "number" },
                    wage_garnishment: { type: "boolean" }
                }}},
                payslip_deductions: { type: "array", items: { type: "object", properties: {
                    borrower_index: { type: "number" }, description: { type: "string" }, monthly_amount: { type: "number" }
                }}},
                payslip_deduction_alerts: { type: "array", items: { type: "object", properties: {
                    borrower_name: { type: "string" }, month_year: { type: "string" },
                    gross: { type: "number" }, net: { type: "number" }, ratio_pct: { type: "number" }, suspected_reason: { type: "string" }
                }}},
                pension_slips: { type: "array", items: { type: "object", properties: {
                    month_year: { type: "string" }, net_allowance: { type: "number" }, source: { type: "string" }
                }}},
                property_purpose: { type: "string" },
                requested_loan_amount: { type: "number" },
                requested_loan_years: { type: "number" },
                special_circumstances: { type: "array", items: { type: "string" } },
                actionable_recommendations: { type: "array", items: { type: "object", properties: {
                    priority: { type: "string" }, category: { type: "string" }, text: { type: "string" }, for_whom: { type: "string" }
                }}}
            }
        };

        const agentAssetsSchema = {
            type: "object",
            properties: {
                bank_statements: { type: "array", items: { type: "object", properties: {
                    account_last4: { type: "string" }, bank_name: { type: "string" },
                    account_holder_name: { type: "string" }, period_start: { type: "string" }, period_end: { type: "string" }
                }}},
                cash_flow_summary: { type: "array", items: { type: "object", properties: {
                    account_last4: { type: "string" }, avg_credit: { type: "number" }, avg_debit: { type: "number" },
                    avg_balance: { type: "number" }, lowest_balance: { type: "number" }, chronic_overdraft: { type: "boolean" }
                }}},
                income_deposits: { type: "array", items: { type: "object", properties: {
                    description: { type: "string" }, source_type: { type: "string" },
                    average_monthly: { type: "number" }, is_income: { type: "boolean" }, borrower_index: { type: "number" }
                }}},
                equity_events: { type: "array", items: { type: "object", properties: {
                    date: { type: "string" }, description: { type: "string" }, amount: { type: "number" },
                    type: { type: "string" }, borrower_index: { type: "number" }, is_incoming: { type: "boolean" }
                }}},
                keren_hishtalmut: { type: "array", items: { type: "object", properties: {
                    fund_name: { type: "string" }, borrower_index: { type: "number" },
                    accumulated_balance: { type: "number" }, is_accessible: { type: "boolean" },
                    maturity_date: { type: "string" }, monthly_payout: { type: "number" }, owner_id: { type: "string" }
                }}},
                pension_funds: { type: "array", items: { type: "object", properties: {
                    fund_name: { type: "string" }, borrower_index: { type: "number" },
                    accumulated_balance: { type: "number" }, is_accessible: { type: "boolean" }, fund_type: { type: "string" }
                }}},
                rental_income: { type: "array", items: { type: "object", properties: {
                    monthly_amount: { type: "number" }, property_description: { type: "string" },
                    is_declared: { type: "boolean" }, borrower_index: { type: "number" }
                }}},
                property_value: { type: "number" },
                business_data: { type: "object", properties: {
                    owner_borrower_index: { type: "number" }, average_monthly_income: { type: "number" },
                    cpa_monthly_income: { type: "number" }, cpa_annual_income: { type: "number" },
                    annual_income_year1: { type: "number" }, annual_income_year2: { type: "number" },
                    year1_label: { type: "string" }, year2_label: { type: "string" },
                    tax_debt: { type: "number" }, income_trend: { type: "string" }
                }},
                bank_red_flags: { type: "array", items: { type: "string" } },
                aml_red_flags: { type: "array", items: { type: "string" } },
                bdi_red_flags: { type: "array", items: { type: "string" } },
                undisclosed_loan_indicators: { type: "array", items: { type: "string" } },
                gambling_detected: { type: "boolean" }, crypto_detected: { type: "boolean" },
                foreign_transfers_detected: { type: "boolean" }, wage_garnishment_detected: { type: "boolean" },
                alimony_monthly: { type: "number" }, child_support_monthly: { type: "number" },
                rent_payment_monthly: { type: "number" }, car_lease_monthly: { type: "number" },
                reserve_duty_months: { type: "array", items: { type: "string" } },
                disability_info: { type: "object", properties: {
                    disability_percentage: { type: "number" }, monthly_amount: { type: "number" },
                    valid_until: { type: "string" }, issuing_body: { type: "string" }, is_lifetime: { type: "boolean" }
                }}
            }
        };

        const agentDebtSchema = {
            type: "object",
            properties: {
                existing_mortgage: { type: "object", properties: {
                    bank_name: { type: "string" },
                    remaining_balance: { type: "number", description: 'יתרה לסילוק — לא מעמודת "קרן"' },
                    total_stated_balance: { type: "number" },
                    monthly_payment: { type: "number", description: 'תשלום חודשי מהשורה המסכמת (סה"כ)' },
                    remaining_months: { type: "number" }, average_interest_rate: { type: "number" },
                    early_repayment_fee: { type: "number" }, statement_date: { type: "string" },
                    tracks: { type: "array", items: { type: "object", properties: {
                        track_type: { type: "string" }, remaining_balance: { type: "number" },
                        interest_rate: { type: "number" }, remaining_months: { type: "number" },
                        is_index_linked: { type: "boolean" }, rate_basis: { type: "string" }
                    }}}
                }},
                all_mortgages: { type: "array", items: { type: "object", properties: {
                    bank_name: { type: "string" }, remaining_balance: { type: "number" },
                    monthly_payment: { type: "number" }, statement_date: { type: "string" }
                }}},
                total_rows_found: { type: "number", description: "MANDATORY: Count ALL loan rows in the table BEFORE extracting. loans[].length MUST equal this number. If they differ, find the missing rows." },
                loans: { type: "array", description: 'DEBT HUNTER: Extract EVERY loan row. Each loan number = separate object. Use bank name from document header. If borrower ID is missing from a row use borrower_name="לא מזוהה/איחוד".', items: { type: "object", properties: {
                    description: { type: "string" }, borrower_name: { type: "string" }, monthly_payment: { type: "number" },
                    remaining_balance: { type: "number" }, remaining_months: { type: "number" },
                    end_date: { type: "string" }, is_confirmed_loan: { type: "boolean" }, needs_clarification: { type: "boolean" }
                }}},
                credit_cards: { type: "array", items: { type: "object", properties: {
                    description: { type: "string" }, monthly_payment: { type: "number" },
                    monthly_amounts_seen: { type: "array", items: { type: "number" } }, is_suspicious: { type: "boolean" }
                }}},
                undisclosed_loan_indicators: { type: "array", items: { type: "string" } }
            }
        };

        return Response.json({
            identityAnchorSection,
            agentIdentityPrompt,
            agentAssetsPrompt,
            agentDebtPrompt,
            agentIdentitySchema,
            agentAssetsSchema,
            agentDebtSchema
        });
    } catch (e) {
        return Response.json({ error: e.message }, { status: 500 });
    }
});