import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * generateExecutiveSummaryHelper — generates the underwriting executive
 * summary. Called from buildUnderwriterReport as a fallback when the summary
 * is missing from normalizedData.
 *
 * ── NO AUTH, BY EXPLICIT DECISION (2026-08-19) ──
 * This is the second port of מרכז חיתום מוסדי — unlike the first (gated
 * behind Supabase Auth), this copy has no login at all, same as the rest of
 * this app. Model: gemini-3.1-pro-preview — already the billed/enabled model
 * in this project via consolidateExtractedData, so no new billing setup
 * needed here.
 */
const SUMMARY_MODEL = 'gemini-3.1-pro-preview';

export default {
  fetch: withSupabase({ auth: ["publishable"] }, async (req, ctx) => {
    try {
      const payload = await req.json();
      const { slim } = payload;

      if (!slim) return Response.json({ error: 'slim payload required' }, { status: 400 });

      const apiKey = Deno.env.get('GEMINI_API_KEY');
      if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');
      const genAI = new GoogleGenerativeAI(apiKey);
      const geminiModel = genAI.getGenerativeModel({ model: SUMMARY_MODEL });

      const prompt = `אתה חתם אשראי בכיר במוסד בנקאי. לפניך נתונים מתיק משכנתא:
${JSON.stringify(slim, null, 2)}

כתוב תקציר מנהלים חיתומי מקצועי בעברית למנהל סניף. התקציר חייב להיות בדיוק 3 פסקאות, כל פסקה עם כותרת קצרה ואחריה גוף הטקסט.

מבנה חובה:
פרופיל הלווה והכנסות
[פסקה על הלווה, המעסיק, ההכנסה החודשית הנטו, אורח חייו הפיננסי]

מדדי סיכון ואיתנות פיננסית
[פסקה על PTI ${slim.pti}%, LTV${slim.ltv ? ' ' + slim.ltv + '%' : ''}, ציון ${slim.risk_score}/100 דירוג ${slim.rating}, הון נזיל]

המלצה וגורמים לתשומת לב
[פסקה עם המלצה ברורה ונקודות לפעולה]

כללים מחייבים לפורמט התגובה:
- כתוב טקסט עברי נקי בלבד
- הפרד בין פסקאות בשורה ריקה בלבד
- חל איסור מוחלט על שימוש בתווים: * ** # ## --- __ ~ | \`
- אסור להשתמש ב-Markdown בשום צורה
- הכותרות הן שורת טקסט רגילה בלבד (ללא קישוטים)
- אל תמציא נתונים שאינם בקלט`;

      const result = await geminiModel.generateContent({ contents: [{ role: 'user', parts: [{ text: prompt }] }] });
      const summaryText = result.response.text();

      return Response.json({ executive_summary: summaryText || null });

    } catch (error) {
      console.error('generateExecutiveSummaryHelper error:', error.message);
      return Response.json({ executive_summary: null, error: error.message });
    }
  }),
};
