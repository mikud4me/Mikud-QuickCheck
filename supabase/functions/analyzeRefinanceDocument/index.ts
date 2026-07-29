import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import OpenAI from "openai";

// ────────────────────────────────────────────────────────────────────────────
// ── MIGRATION NOTE (Base44 → Supabase) ──
// - InvokeLLM(..., model: 'gemini_3_flash') → direct Gemini call (GEMINI_API_KEY).
// - InvokeLLM(..., model: 'gpt_5') → direct OpenAI call (OPENAI_API_KEY).
// - base44.auth.me() → ctx.userClaims (auth: ["user", "publishable"] — preserves
//   the original's "must be logged in" gate with the same 401 status/shape).
// - This function was confirmed self-contained by a prior audit (no entities,
//   no asServiceRole, no other-function calls) — re-verified while porting:
//   the ONLY base44.* surface used anywhere in the 1375-line original is
//   `auth.me()` plus 9 `integrations.Core.InvokeLLM(...)` call sites. Holds true.
// - The "live market rates" call uses Base44's `add_context_from_internet: true`
//   (Gemini grounding via Google Search) with NO response_json_schema, returning
//   a free-text response that's regex-parsed for embedded JSON. Replicated below
//   via the Gemini SDK's `googleSearch` tool (verified live 2026-07-29 —
//   the older `googleSearchRetrieval` tool name is rejected by current Gemini
//   models and was the root cause of a gateway-level 503 on every real
//   request: the rejected promise was never awaited immediately, so the
//   unhandled rejection crashed the isolate before the later `await
//   ratesPromise` could catch it). If grounding doesn't work as expected,
//   the original's own fallback logic (FALLBACK_RATES + range validation
//   a few lines below) already covers it —
//   a bad/missing live-rates result degrades gracefully either way.
// - The OpenAI (gpt_5) calls pass file_urls for both images AND PDFs. Images are
//   sent as `image_url` content parts (base64 data URI). PDFs are sent as `file`
//   content parts (`{ type: 'file', file: { file_data: <base64 data URI> } }`) —
//   OpenAI's direct-PDF-input format. ⚠️ FLAG: PDF-via-base64 support varies by
//   model; re-verify once OPENAI_API_KEY is live and the real "gpt_5" model is
//   confirmed.
// - JSON-schema compliance for the OpenAI calls uses the simpler `json_object`
//   response format (valid JSON, not schema-validated) with the schema embedded
//   as text in the prompt, rather than OpenAI's stricter `json_schema` structured
//   output mode (which requires reshaping every schema to mark all properties as
//   required / additionalProperties:false). This is a deliberate simplification,
//   flagged here — swap in strict `json_schema` mode later if needed once this
//   is live and can be tested end-to-end.
// ────────────────────────────────────────────────────────────────────────────

// GEMINI_FLASH_MODEL VERIFIED against the live Gemini API (2026-07-29):
// gemini-3-flash-preview responds successfully with this key.
// GPT_MODEL ('gpt-5') is STILL UNVERIFIED — OPENAI_API_KEY is not configured yet
// (left empty intentionally). This function's GPT-5 fallback path will fail
// until that key is set; confirm the exact model string once it is.
const GEMINI_FLASH_MODEL = 'gemini-3-flash-preview';
const GPT_MODEL = 'gpt-5';

// ── base64 helper — safe for large files (avoids call-stack blowup on big arrays) ──
function bytesToBase64(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
    }
    return btoa(binary);
}

const MIME_MAP = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
const guessMimeType = (url) => {
    // Strip the query string BEFORE splitting on '.' — Supabase signed URLs embed
    // a JWT (header.payload.signature) in the query string, and JWTs contain dots
    // themselves. Splitting on '.' first (the original order) grabs a fragment of
    // the token instead of the real file extension. Bug found via live smoke test
    // (2026-07-29) on the sibling preScanDocuments function; fixed here too since
    // this file has the identical pattern.
    const ext = url.split('?')[0]?.split('.').pop()?.toLowerCase() || 'pdf';
    return MIME_MAP[ext] || 'application/octet-stream';
};

// ── Base64 cache, keyed by the exact string passed as "url" everywhere below ──
// Found via live testing (2026-07-29): Supabase's gateway returns an instant,
// empty 503 (never reaching the edge runtime at all -- no logs, x-served-by:
// base/server) specifically when THIS function's incoming request body
// contains a /storage/v1/object/sign/ URL pointing back at this same
// project's own storage. Reproduced consistently (real file, fake file, valid
// token, garbage token -- all 503; a non-"sign"-pattern URL on the exact same
// domain succeeds fine). Every other ported function handles the identical
// signed-URL payload with no issue, so this is specific to this one function
// (the only one importing 'openai' -- plausibly a deliberate anti-SSRF rule
// aimed at functions calling third-party AI APIs with a same-project signed
// URL, not a bug to work around lightly).
//
// Fix: the frontend now sends a plain storage PATH (e.g. "uploads/abc.pdf"),
// never a signed URL, in the request body. The handler downloads it ONCE via
// the service-role client (ctx.supabaseAdmin, bypasses RLS) right after
// parsing the request, and populates this cache keyed by that same path
// string. fetchFileAsBase64() below checks the cache first -- since every
// call site in this file still just passes through whatever "url" variable
// it already has (which is now that path string), nothing else in this
// 1500+ line file needed to change.
const _fileCache = new Map();

async function fetchFileAsBase64(url) {
    if (_fileCache.has(url)) return _fileCache.get(url);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch file: ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    return { mimeType: guessMimeType(url), data: bytesToBase64(buf) };
}

// ── JSON Schema (plain, Base44/OpenAPI-style, incl. `type: [X, "null"]` for
// nullable fields as used by EXTRACTION_SCHEMA/IDENTITY_SCHEMA below) → Gemini's
// Schema format (uppercase SchemaType enum + `nullable: true`). ──
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

// ── Gemini call — covers both InvokeLLM shapes used in the original:
//   - schema provided  → parsed, schema-validated JSON object.
//   - no schema        → raw text (used for the grounded "live rates" call).
//   - useSearchGrounding → mirrors `add_context_from_internet: true`. ──
async function invokeGemini({ model, prompt, fileUrls = [], schema = null, useSearchGrounding = false }) {
    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');
    const genAI = new GoogleGenerativeAI(apiKey);

    const modelParams = { model };
    if (useSearchGrounding) {
        modelParams.tools = [{ googleSearch: {} }];
    }
    if (schema) {
        modelParams.generationConfig = {
            responseMimeType: 'application/json',
            responseSchema: toGeminiSchema(schema),
        };
    }
    const geminiModel = genAI.getGenerativeModel(modelParams);

    const parts = [{ text: prompt }];
    for (const url of fileUrls) {
        const { mimeType, data } = await fetchFileAsBase64(url);
        parts.push({ inlineData: { mimeType, data } });
    }

    const result = await geminiModel.generateContent({ contents: [{ role: 'user', parts }] });
    const text = result.response.text();
    return schema ? JSON.parse(text) : text;
}

// ── OpenAI (gpt_5) call — covers both file types the original passes through:
// images as `image_url` parts, PDFs as `file` parts (base64 data URI either way).
// Schema compliance is enforced via prompt text + `json_object` mode (see
// migration note above) rather than strict `json_schema` structured outputs. ──
async function invokeOpenAI({ model, prompt, fileUrls = [], schema = null }) {
    const apiKey = Deno.env.get('OPENAI_API_KEY');
    if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');
    const openai = new OpenAI({ apiKey });

    const fullPrompt = schema
        ? `${prompt}\n\n🔴 CRITICAL OUTPUT FORMAT: Return ONLY a valid JSON object matching this schema exactly — no markdown, no code fences, no explanation.\n\nSCHEMA:\n${JSON.stringify(schema, null, 2)}`
        : prompt;

    const content = [{ type: 'text', text: fullPrompt }];
    for (const url of fileUrls) {
        const { mimeType, data } = await fetchFileAsBase64(url);
        const dataUri = `data:${mimeType};base64,${data}`;
        if (mimeType.startsWith('image/')) {
            content.push({ type: 'image_url', image_url: { url: dataUri } });
        } else {
            content.push({ type: 'file', file: { filename: url.split('/').pop() || 'document.pdf', file_data: dataUri } });
        }
    }

    const completion = await openai.chat.completions.create({
        model,
        messages: [{ role: 'user', content }],
        ...(schema ? { response_format: { type: 'json_object' } } : {}),
    });

    const text = completion.choices?.[0]?.message?.content || '';
    return schema ? JSON.parse(text) : text;
}

export default {
  fetch: withSupabase({ auth: ["publishable"] }, async (req, ctx) => {
  try {
    // ── NO AUTH GATE (intentional) ──
    // This is the sole function called by the public, anonymous RefinanceQuickCheck
    // flow — no logged-in user exists. The original Base44 version had an
    // unconditional base44.auth.me() gate identical to 2 other ported functions
    // (consolidateExtractedData, shadowDebtEngine) while the other 6 had none at
    // all — leftover template code, not a deliberate rule. Since this app has no
    // user login system, dropping the gate here is what makes the refinance
    // quick-check tool actually work end-to-end instead of always 401'ing.

    const { file_url, transaction_type, external_debts_input } = await req.json();

    if (!file_url) {
      return Response.json({ error: 'Missing file_url' }, { status: 400 });
    }

    // ── Download once via the service-role storage client, not fetch() ──
    // file_url is now a plain storage path (e.g. "uploads/abc.pdf"), sent by
    // the frontend instead of a signed URL -- see the _fileCache comment
    // above fetchFileAsBase64 for why. ctx.supabaseAdmin bypasses RLS, so no
    // signed URL is needed at all.
    {
      const { data: blob, error: downloadError } = await ctx.supabaseAdmin.storage
        .from('documents')
        .download(file_url);
      if (downloadError || !blob) {
        return Response.json({
          success: false,
          error: `Failed to download file: ${downloadError?.message || 'not found'}`
        }, { status: 200 });
      }
      const buf = new Uint8Array(await blob.arrayBuffer());
      _fileCache.set(file_url, { mimeType: guessMimeType(file_url), data: bytesToBase64(buf) });
    }

    console.log(`📋 Transaction Type: ${transaction_type}`);

    // Detect file type — images need different handling than PDFs
    const urlLower = file_url.toLowerCase().split('?')[0];
    const isImage = urlLower.endsWith('.jpg') || urlLower.endsWith('.jpeg') ||
                    urlLower.endsWith('.png') || urlLower.endsWith('.webp') ||
                    urlLower.includes('/jpg') || urlLower.includes('/jpeg') ||
                    urlLower.includes('/png');
    const fileExt = urlLower.split('.').pop() || 'unknown';
    console.log(`📁 File type: ${fileExt} | isImage: ${isImage}`);
    const today = new Date().toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STEP 1: UNIVERSAL FINANCIAL EXTRACTION (bank-agnostic)
    // One powerful prompt that works for ANY Israeli bank payoff statement
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const UNIVERSAL_EXTRACTION_PROMPT = `You are a senior Israeli mortgage financial analyst. Extract ALL data from this mortgage payoff statement (דף יתרת סילוק / אישור יתרה).

DOCUMENT TYPE: This is an Israeli bank mortgage payoff statement. It may come from ANY bank (Hapoalim, Leumi, Discount, Mizrahi, Jerusalem, International, etc.) in ANY format — tables, columns, rows, multi-page. Your job is to extract numbers accurately regardless of format.

TODAY: ${today}

═══ WHAT TO EXTRACT ═══

1. STATEMENT DATE: Look for: תאריך הדוח / תאריך היתרה / ליום / נכון ל / תאריך. Return in DD/MM/YYYY format.

2. BANK NAME: Identify the bank from logo/header/account number prefix.

3. FOR EACH LOAN TRACK (מסלול / הלוואה / רכיב):
   The document may have 1-10 tracks in various layouts. Find ALL of them.

   a) REMAINING BALANCE (יתרת קרן / יתרה לסילוק / יתרת הלוואה):
      - This is the CURRENT outstanding principal, NOT the original loan amount
      - Usually between ₪20,000 and ₪2,000,000 per track
      - Hebrew labels: יתרת קרן, יתרה לסילוק, יתרת ההלוואה, קרן שנותרה
      - DO NOT use: סכום ההלוואה המקורי / סכום מקורי (original amount — ignore this)

   b) INTEREST RATE (שיעור ריבית / ריבית):
      - The CURRENT nominal interest rate in percent (e.g., 4.5, 2.8, 5.1)
      - Labels: שיעור ריבית נומינלי, ריבית נוכחית, ריבית שנתית
      - If it shows "P-0.6%" → the rate IS the prime rate MINUS 0.6 (e.g. prime=6.0, so rate=5.4)
      - If it shows "P+1.5%" → rate = prime + 1.5
      - Prime rate (פריים) in Israel as of 2025-2026 = approximately 6.0%
      - ALWAYS return the actual numeric rate, not the spread formula

   c) REMAINING MONTHS (חודשים שנותרו):
      - Calculate from TODAY (${today}) to the end date
      - End date labels: מועד סיום, מועד פירעון, תאריך סילוק, מועד תשלום אחרון, תוקף ההלוואה
      - Example: end date 04/2053, today 03/2026 → 325 months
      - If shown in years, multiply by 12

   d) TRACK TYPE (סוג המסלול):
      Classify as one of these 5 types based on the rate basis field (בסיס ריבית / סוג ריבית / מסלול):
      - "פריים" → if rate basis contains P / פריים / Prime
      - "קבועה צמודה" → Fixed rate + CPI-linked (מדד / הצמדה / H+)
      - "קבועה לא צמודה" → Fixed rate, NOT linked to CPI (% only, no P/H/V)
      - "משתנה צמודה" → Variable rate + CPI-linked
      - "משתנה לא צמודה" → Variable rate, NOT CPI-linked (V+ / אג"ח / ממשלתי)

   e) IS_INDEX_LINKED (צמוד מדד):
      - TRUE only if explicitly CPI-linked (מדד המחירים לצרכן / הצמדה למדד / H+)
      - FALSE for: Prime (P), bond-based variable (V+), fixed unlinked
      - V+ tracks (variable based on government bonds) are NOT CPI-linked → false

   f) RATE BASIS (בסיס ריבית): Exact text from document, e.g. "P-0.60%", "H+3.45%", "V+3.00%", "4.90%"

   g) PAYMENT METHOD (שיטת פירעון): שפיצר / קרן שווה / בלון / ריבית בלבד / bullet

   h) PREPAYMENT FEE (עמלת פירעון מוקדם):
      - The actual exit penalty for early repayment per track
      - Labels: עמלת פירעון מוקדם, דמי פירעון מוקדם, קנס פירעון
      - DO NOT confuse with: הפרשי הצמדה, ריבית שנצברה, הצמדה שנצברה (those are accruals, not fees)
      - Prime tracks: usually ₪0
      - Fixed/linked tracks: can be ₪0 to ₪50,000
      - Small amounts like ₪343, ₪500 are valid — do NOT round to 0

4. TOTAL MONTHLY PAYMENT: Sum of all track payments, or from a summary row. Labels: תשלום חודשי כולל, החזר חודשי.

5. TOTAL EARLY REPAYMENT FEE: Sum of all track fees, or from a "סה"כ עמלת פירעון מוקדם" row.

6. ARREARS DEBT (פיגורים): Any overdue/arrears amount if shown. Labels: חוב בפיגור, יתרת פיגורים, חוב עבר.

7. PROPERTY VALUE: If mentioned in the document. Labels: שווי נכס, ערך הנכס.

8. BORROWERS: Names, ID numbers (ת.ז - 9 digits), ages if shown.

═══ CRITICAL RULES ═══
- Extract ALL tracks — multi-page documents may have 4-12 tracks spread across pages
- Sum track balances for total. If you see a "סה"כ" summary row, verify it matches your sum
- Never invent numbers — if unclear, return null for that field
- For multi-column layouts: each column = one track
- For multi-row layouts: each row group = one track

Return structured data as specified in the JSON schema.`;

    // ━━━ STEP 0: Fetch market rates in background (no file needed) ━━━
    // NOTE: add_context_from_internet cannot be combined with response_json_schema on Gemini.
    // We use gemini_3_flash with internet search and parse the text response manually.
    const ratesPromise = invokeGemini({
      model: GEMINI_FLASH_MODEL,
      prompt: `What are the current Israeli mortgage interest rates as of today ${today}?
Search the Bank of Israel website (boi.org.il) and major Israeli bank sites for the latest rates.
Return CUSTOMER-FACING effective rates (after typical bank discounts) as a JSON object:
{"prime": <number>, "fixed_linked": <number>, "fixed_unlinked": <number>, "variable_linked": <number>, "variable_unlinked": <number>}
- prime: effective ~4.8-5.0
- fixed_linked: typically 3.0-3.4
- fixed_unlinked: typically 4.5-4.9
- variable_linked: typically 2.9-3.3
- variable_unlinked: typically 4.4-4.8
Return ONLY the JSON object, nothing else.`,
      useSearchGrounding: true,
    });

    // ━━━ PARALLEL: Universal extraction + identity (simultaneously) ━━━
    console.log(`🔬 Running universal parallel extraction...`);

    const EXTRACTION_SCHEMA = {
      type: "object",
      properties: {
        bank_name: { type: ["string", "null"] },
        statement_date: { type: ["string", "null"] },
        is_full_payoff_statement: { type: "boolean" },
        remaining_balance: { type: "number", description: "Sum of all track balances" },
        monthly_payment: { type: "number", description: "Total monthly payment" },
        remaining_months: { type: ["number", "null"] },
        average_interest_rate: { type: ["number", "null"] },
        total_early_repayment_fee: { type: ["number", "null"] },
        arrears_debt: { type: ["number", "null"] },
        estimated_property_value: { type: ["number", "null"] },
        tracks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              track_type: { type: "string" },
              remaining_balance: { type: "number" },
              interest_rate: { type: "number" },
              remaining_months: { type: "number" },
              is_index_linked: { type: "boolean" },
              rate_basis: { type: ["string", "null"] },
              payment_method: { type: ["string", "null"] },
              prepayment_fee: { type: ["number", "null"] },
              monthly_payment: { type: ["number", "null"] }
            }
          }
        }
      }
    };

    const IDENTITY_SCHEMA = {
      type: "object",
      properties: {
        statement_date: { type: ["string", "null"] },
        borrowers_found: {
          type: "array",
          items: {
            type: "object",
            properties: {
              full_name: { type: "string" },
              first_name: { type: "string" },
              last_name: { type: "string" },
              id_number: { type: ["string", "null"] },
              age: { type: ["number", "null"] }
            }
          }
        }
      }
    };

    const IDENTITY_PROMPT = `Extract borrower names, ID numbers (ת.ז - must be 9 digits), ages from this Israeli mortgage document.
Also extract the statement date (תאריך הדוח / תאריך היתרה / ליום) in DD/MM/YYYY format.
Only extract what you can clearly read. Return null if unclear.`;

    // Try Gemini first (PDFs), fallback to gpt_5 for images or on error
    const runExtractionWithFallback = async () => {
      // For images, skip Gemini (it treats them as PDFs) and go directly to gpt_5
      if (isImage) {
        console.log(`🖼️ Image detected — using ${GPT_MODEL} vision directly`);
        const [extr, ident] = await Promise.all([
          invokeOpenAI({
            model: GPT_MODEL,
            prompt: UNIVERSAL_EXTRACTION_PROMPT,
            fileUrls: [file_url],
            schema: EXTRACTION_SCHEMA
          }),
          invokeOpenAI({
            model: GPT_MODEL,
            prompt: IDENTITY_PROMPT,
            fileUrls: [file_url],
            schema: IDENTITY_SCHEMA
          })
        ]);
        return { extractionResult: extr, identityResult: ident, usedFallback: false };
      }

      // PDFs: Try Gemini first, fallback to gpt_5 on error
      try {
        const [extr, ident] = await Promise.all([
          invokeGemini({
            model: GEMINI_FLASH_MODEL,
            prompt: UNIVERSAL_EXTRACTION_PROMPT,
            fileUrls: [file_url],
            schema: EXTRACTION_SCHEMA
          }),
          invokeGemini({
            model: GEMINI_FLASH_MODEL,
            prompt: IDENTITY_PROMPT,
            fileUrls: [file_url],
            schema: IDENTITY_SCHEMA
          })
        ]);
        return { extractionResult: extr, identityResult: ident, usedFallback: false };
      } catch (geminiError) {
        console.warn(`⚠️ Gemini failed (${geminiError.message?.slice(0, 80)}), switching to ${GPT_MODEL}...`);
        const [extr, ident] = await Promise.all([
          invokeOpenAI({
            model: GPT_MODEL,
            prompt: UNIVERSAL_EXTRACTION_PROMPT,
            fileUrls: [file_url],
            schema: EXTRACTION_SCHEMA
          }),
          invokeOpenAI({
            model: GPT_MODEL,
            prompt: IDENTITY_PROMPT,
            fileUrls: [file_url],
            schema: IDENTITY_SCHEMA
          })
        ]);
        return { extractionResult: extr, identityResult: ident, usedFallback: true };
      }
    };

    const { extractionResult, identityResult, usedFallback } = await runExtractionWithFallback();
    if (usedFallback) console.log(`✅ Claude fallback used for initial extraction`);

    // Await the rates (already running in background since before file extraction)
    let ratesResultRaw = null;
    try {
      const ratesRaw = await ratesPromise;
      // Response may be a string (since we removed response_json_schema) — parse it
      if (typeof ratesRaw === 'string') {
        const match = ratesRaw.match(/\{[\s\S]*\}/);
        if (match) ratesResultRaw = JSON.parse(match[0]);
      } else if (typeof ratesRaw === 'object') {
        ratesResultRaw = ratesRaw;
      }
      console.log(`✅ Live rates fetched: prime=${ratesResultRaw?.prime}%`);
    } catch(e) {
      console.warn(`⚠️ Live rates fetch failed, using fallback: ${e.message}`);
    }

    console.log(`✅ Extraction done: ${extractionResult.tracks?.length || 0} tracks | Balance: ₪${extractionResult.remaining_balance?.toLocaleString()}`);

    // ━━━ FALLBACK: If initial extraction returned nothing, retry with Claude ━━━
    const gotNothing = !extractionResult.remaining_balance && (!extractionResult.tracks || extractionResult.tracks.length === 0);
    if (gotNothing && !usedFallback) {
      console.log(`⚠️ Extraction returned nothing — retrying with ${GPT_MODEL}...`);
      try {
        const claudeResult = await invokeOpenAI({
          model: GPT_MODEL,
          prompt: UNIVERSAL_EXTRACTION_PROMPT,
          fileUrls: [file_url],
          schema: EXTRACTION_SCHEMA
        });
        if (claudeResult.remaining_balance > 0 || (claudeResult.tracks && claudeResult.tracks.length > 0)) {
          Object.assign(extractionResult, claudeResult);
          console.log(`✅ Claude fallback succeeded: ${claudeResult.tracks?.length || 0} tracks | Balance: ₪${claudeResult.remaining_balance?.toLocaleString()}`);
        } else {
          console.log(`❌ Claude fallback also returned nothing`);
        }
      } catch(e) {
        console.warn(`Claude fallback error: ${e.message}`);
      }
    }

    // ━━━ STATEMENT DATE ━━━
    const statementDate = identityResult.statement_date || extractionResult.statement_date || null;
    let statementDateWarning = null;
    if (statementDate) {
      try {
        const parts = statementDate.split('/');
        const dt = new Date(+parts[2], +parts[1]-1, +parts[0]);
        const daysDiff = Math.round((new Date() - dt) / (1000*60*60*24));
        if (daysDiff > 90) {
          statementDateWarning = `דף יתרת הסילוק מתאריך ${statementDate} — לפני ${daysDiff} ימים. הבנק ידרוש יתרה עדכנית (עד 90 יום). יש לבקש יתרה חדשה.`;
        }
      } catch(e) {}
    }

    // ━━━ BORROWERS ━━━
    const finalBorrowers = (identityResult.borrowers_found || []).map(b => ({
      first_name: b.first_name,
      last_name: b.last_name,
      id_number: b.id_number,
      age: b.age
    }));
    extractionResult.borrower_1 = finalBorrowers[0] || null;
    extractionResult.borrower_2 = finalBorrowers[1] || null;

    // ━━━ MARKET RATES ━━━
    // STABILITY FIX: ריביות ה-fallback משמשות כ-anchor קבוע כדי למנוע תנודות בין הרצות.
    // ריביות ה-LLM נקבלות אך מוגבלות לטווח הגיוני ± 0.3% מה-fallback.
    const FALLBACK_RATES = { prime: 5.0, fixed_linked: 3.2, fixed_unlinked: 4.7, variable_linked: 3.1, variable_unlinked: 4.6 };
    const clampRate = (live, fallback, maxDrift = 0.3) => {
      if (live == null || isNaN(live)) return fallback;
      return Math.min(fallback + maxDrift, Math.max(fallback - maxDrift, live));
    };
    const primeValid = ratesResultRaw?.prime >= 4.5 && ratesResultRaw?.prime <= 5.5;
    const fixedValid = ratesResultRaw?.fixed_unlinked >= 4.0 && ratesResultRaw?.fixed_unlinked <= 6.0;
    const CURRENT_MARKET_RATES = (primeValid && fixedValid) ? {
      prime: clampRate(ratesResultRaw.prime, FALLBACK_RATES.prime),
      fixed_linked: clampRate(ratesResultRaw.fixed_linked, FALLBACK_RATES.fixed_linked),
      fixed_unlinked: clampRate(ratesResultRaw.fixed_unlinked, FALLBACK_RATES.fixed_unlinked),
      variable_linked: clampRate(ratesResultRaw.variable_linked, FALLBACK_RATES.variable_linked),
      variable_unlinked: clampRate(ratesResultRaw.variable_unlinked, FALLBACK_RATES.variable_unlinked),
    } : FALLBACK_RATES;
    if (!primeValid || !fixedValid) console.warn(`⚠️ Invalid live rates (prime=${ratesResultRaw?.prime}), using fallback`);
    console.log(`✅ Rates: prime=${CURRENT_MARKET_RATES.prime}`);

    const EXPECTED_ANNUAL_INFLATION = 2.5;

    // ━━━ HELPERS ━━━
    const calcLinkedCost = (principal, annualRate, months, customInflation = null) => {
      const monthlyRate = annualRate / 100 / 12;
      const inflRate = Math.pow(1 + (customInflation ?? EXPECTED_ANNUAL_INFLATION) / 100, 1/12) - 1;
      let balance = principal;
      let totalPaid = 0;
      for (let i = 0; i < months; i++) {
        balance *= (1 + inflRate);
        const rem = months - i;
        const payment = balance * (monthlyRate * Math.pow(1 + monthlyRate, rem)) / (Math.pow(1 + monthlyRate, rem) - 1);
        totalPaid += payment;
        balance -= (payment - balance * monthlyRate);
        if (balance < 0) balance = 0;
      }
      return totalPaid;
    };

    const translateTrackType = (trackType) => {
      const t = (trackType || '').toLowerCase();
      if (t.includes('פריים') || t.includes('prime')) return 'פריים';
      if (t.includes('קבוע') || t.includes('fixed')) return (t.includes('לא צמוד') || t.includes('unlinked')) ? 'קבועה לא צמודה' : 'קבועה צמודה';
      if (t.includes('משתנה') || t.includes('variable')) return (t.includes('לא צמוד') || t.includes('unlinked')) ? 'משתנה לא צמודה' : 'משתנה צמודה';
      return trackType;
    };

    const isBondBased = (track) => {
      const b = (track.rate_basis || '').toLowerCase();
      return b.startsWith('v+') || b.startsWith('v-');
    };

    const isTrackCPILinked = (track) => {
      // ━━━ CRITICAL FIX: Track type name takes ABSOLUTE PRIORITY ━━━
      // "משתנה צמודה" is CPI-linked even if rate basis is V+ (bond-based)
      // The bank document's track classification overrides the rate basis
      const type = (track.track_type || '').toLowerCase();

      // "לא צמוד" / "unlinked" in track name → NEVER CPI linked
      if (type.includes('לא צמוד') || type.includes('unlinked')) return false;

      // "צמוד" in track name → ALWAYS CPI linked (covers קבועה צמודה + משתנה צמודה)
      // This is the DEFINITIVE source — V+ basis does NOT override this!
      if (type.includes('צמוד')) return true;

      // Explicit CPI flag from extraction
      if (track.is_index_linked === true) return true;

      // H+ basis explicitly means CPI linked
      const basis = (track.rate_basis || '').toLowerCase();
      if (basis.startsWith('h+') || basis.startsWith('h-')) return true;

      // Prime tracks — never CPI linked
      if (type.includes('פריים') || type.includes('prime')) return false;

      // V+/bond-based with no explicit "צמוד" label → not CPI linked
      if (isBondBased(track)) return false;

      return false;
    };

    const classifyTrack = (track) => {
      const type = (track.track_type || '').toLowerCase();
      const isLinked = isTrackCPILinked(track);
      const rate = track.interest_rate || 0;
      const effectiveRateCalc = isLinked ? rate + EXPECTED_ANNUAL_INFLATION : rate;
      // goldenMax: מתחת לסף זה — שמר. toxicMin: מעל לסף זה — מחזר.
      // GOLDEN = נמוך בצורה ברורה מהשוק (שווה שמירה). TOXIC = יקר (צריך להחליף).
      // NEUTRAL שטח אפור — גם NEUTRAL כלפי GOLDEN ייחשב כ"כדאי לשמר" אם יש TOXIC ברורים
      let goldenMax = 3.5, toxicMin = 4.5;
      if (type.includes('פריים') || type.includes('prime')) { goldenMax = 4.5; toxicMin = 5.0; }
      else if (type.includes('קבוע') && isLinked) { goldenMax = 5.0; toxicMin = 7.0; } // קבועה צמודה: 2-3% ריבית = 4.5-5.5% אפקטיבי — שמרן
      else if (type.includes('קבוע') && !isLinked) { goldenMax = 4.2; toxicMin = 4.8; }
      else if (type.includes('משתנה') && !isLinked) { goldenMax = 4.0; toxicMin = 4.7; }
      else if (type.includes('משתנה') && isLinked) { goldenMax = 4.5; toxicMin = 5.5; }
      if (effectiveRateCalc <= goldenMax) return { status: 'GOLDEN', effectiveRate: effectiveRateCalc, reason: `נכס זהב - ${effectiveRateCalc.toFixed(2)}%` };
      if (effectiveRateCalc >= toxicMin) return { status: 'TOXIC', effectiveRate: effectiveRateCalc, reason: `רעיל - ${effectiveRateCalc.toFixed(2)}%` };
      return { status: 'NEUTRAL', effectiveRate: effectiveRateCalc, reason: `גבולי - ${effectiveRateCalc.toFixed(2)}%` };
    };

    // ━━━ BALANCE RESOLUTION ━━━
    let actualRemainingBalance = 0;
    const tracks = extractionResult.tracks || [];

    if (tracks.length > 0) {
      actualRemainingBalance = tracks.reduce((s, t) => s + (t.remaining_balance || 0), 0);
    }
    if (actualRemainingBalance === 0 && (extractionResult.remaining_balance || 0) > 0) {
      actualRemainingBalance = extractionResult.remaining_balance;
    }

    // ━━━ VALIDATION — reject if no financial data at all ━━━
    const hasTracks = tracks.length > 0 && tracks.some(t => (t.remaining_balance || 0) > 0);
    const hasBalance = actualRemainingBalance > 0;
    const hasMonthlyPayment = (extractionResult.monthly_payment || 0) > 0;

    if (!hasTracks && !hasBalance && !hasMonthlyPayment) {
      return Response.json({
        success: false,
        error: 'לא הצלחנו לזהות נתוני משכנתא במסמך זה. ודא שהקובץ הוא דף יתרת סילוק ברור וקריא, ונסה שוב.',
        errorCode: 'NOT_A_PAYOFF_STATEMENT'
      }, { status: 200 });
    }

    // ━━━ If no tracks but has balance — attempt one more targeted extraction ━━━
    if (!hasTracks && hasBalance) {
      console.log(`⚠️ No tracks found but balance=₪${actualRemainingBalance.toLocaleString()} — retrying track extraction...`);
      try {
        const retry = await invokeOpenAI({
          model: GPT_MODEL,
          prompt: `This is an Israeli mortgage payoff statement. I need to find all individual loan tracks (מסלולים/הלוואות).
The document shows balance ₪${actualRemainingBalance.toLocaleString()} total.
Find EACH individual track and extract:
- track_type: פריים / קבועה לא צמודה / קבועה צמודה / משתנה לא צמודה / משתנה צמודה
- remaining_balance: יתרת קרן per track (NOT original amount)
- interest_rate: current rate in percent
- remaining_months: months until end date from today (${today})
- is_index_linked: true only for CPI/מדד-linked tracks
- prepayment_fee: עמלת פירעון מוקדם per track (can be ₪0)
Today: ${today}`,
          fileUrls: [file_url],
          schema: {
            type: "object",
            properties: {
              tracks: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    track_type: { type: "string" },
                    remaining_balance: { type: "number" },
                    interest_rate: { type: "number" },
                    remaining_months: { type: "number" },
                    is_index_linked: { type: "boolean" },
                    rate_basis: { type: ["string", "null"] },
                    prepayment_fee: { type: ["number", "null"] }
                  }
                }
              },
              total_fee: { type: ["number", "null"] }
            }
          }
        });

        const validTracks = (retry.tracks || []).filter(t => (t.remaining_balance || 0) > 0 && (t.remaining_months || 0) > 0);
        if (validTracks.length > 0) {
          const tracksSum = validTracks.reduce((s, t) => s + t.remaining_balance, 0);
          // Scale to match known balance if needed
          if (Math.abs(tracksSum - actualRemainingBalance) / actualRemainingBalance > 0.05) {
            const scale = actualRemainingBalance / tracksSum;
            validTracks.forEach(t => { t.remaining_balance = Math.round(t.remaining_balance * scale); });
          }
          extractionResult.tracks = validTracks;
          if (retry.total_fee !== null && retry.total_fee !== undefined) {
            extractionResult.total_early_repayment_fee = retry.total_fee;
          }
          console.log(`✅ Retry found ${validTracks.length} tracks`);
        } else {
          return Response.json({
            success: false,
            error: 'לא הצלחנו לזהות את פרטי המסלולים במסמך. ייתכן שהמסמך לא ברור מספיק. אנא נסה להעלות קובץ PDF ברור יותר.',
            errorCode: 'TRACK_EXTRACTION_FAILED'
          }, { status: 200 });
        }
      } catch(e) {
        console.warn('Retry extraction failed:', e.message);
        return Response.json({
          success: false,
          error: 'שגיאה בניתוח המסמך. אנא נסה שוב.',
          errorCode: 'TRACK_EXTRACTION_FAILED'
        }, { status: 200 });
      }
    }

    const arrearsDebt = extractionResult.arrears_debt || 0;
    actualRemainingBalance = Math.round(actualRemainingBalance + arrearsDebt);

    // Log tracks for debugging
    (extractionResult.tracks || []).forEach((t, i) => {
      console.log(`  Track ${i+1}: ${t.track_type} | rate=${t.interest_rate}% | bal=₪${t.remaining_balance?.toLocaleString()} | months=${t.remaining_months} | linked=${t.is_index_linked} | basis=${t.rate_basis}`);
    });

    // ━━━ EARLY REPAYMENT FEE ━━━
    if ((extractionResult.total_early_repayment_fee === null || extractionResult.total_early_repayment_fee === undefined) && (extractionResult.tracks || []).length > 0) {
      const sumFromTracks = (extractionResult.tracks || []).reduce((s, t) => s + (t.prepayment_fee || 0), 0);
      if (sumFromTracks > 0) {
        extractionResult.total_early_repayment_fee = sumFromTracks;
        console.log(`✅ Fee from track sum: ₪${sumFromTracks}`);
      }
    }

    let earlyRepaymentFee = 0;
    let feeConfidence = 0;
    let feeWarning = null;
    let feeExemptionReason = null;

    if (extractionResult.total_early_repayment_fee !== null && extractionResult.total_early_repayment_fee !== undefined) {
      earlyRepaymentFee = Math.round(extractionResult.total_early_repayment_fee);
      feeConfidence = 90;
    } else if ((extractionResult.tracks || []).every(t => (t.track_type || '').includes('פריים'))) {
      earlyRepaymentFee = 0; feeConfidence = 100;
      feeExemptionReason = 'מסלולי פריים - ללא עמלת פירעון';
    } else {
      feeWarning = 'לא נמצאה עמלת פירעון - יש לאמת ידנית מול הבנק';
    }

    const bankFees = 360;
    const totalCost = earlyRepaymentFee + bankFees;

    // ━━━ WEIGHTED PERIOD ━━━
    let weightedPeriodMonths = extractionResult.remaining_months || 240;
    const allTracks = extractionResult.tracks || [];
    if (allTracks.length > 0) {
      const totalBal = allTracks.reduce((s, t) => s + (t.remaining_balance || 0), 0);
      if (totalBal > 0) {
        weightedPeriodMonths = Math.round(allTracks.reduce((s, t) => s + (t.remaining_months || 0) * (t.remaining_balance || 0), 0) / totalBal);
      }
    }
    if (!weightedPeriodMonths || weightedPeriodMonths <= 0) weightedPeriodMonths = 240;
    const weightedPeriodYears = Math.ceil(weightedPeriodMonths / 12);

    let maxAge = 40;
    if (extractionResult.borrower_1?.age) maxAge = Math.max(maxAge, extractionResult.borrower_1.age);
    if (extractionResult.borrower_2?.age) maxAge = Math.max(maxAge, extractionResult.borrower_2.age);
    const maxAllowedYears = Math.max(5, 75 - maxAge);

    // ━━━ OLD MORTGAGE TOTAL COST ━━━
    let totalOldPayments = 0;
    if (allTracks.length > 0) {
      allTracks.forEach(track => {
        const linked = isTrackCPILinked(track);
        const annualRate = track.interest_rate || 0;
        const monthlyRate = annualRate / 100 / 12;
        const months = track.remaining_months || 0;
        const balance = track.remaining_balance || 0;
        if (months <= 0 || balance <= 0) return;
        const paymentMethod = (track.payment_method || '').toLowerCase();
        let trackCost = 0;
        if (paymentMethod.includes('ריבית בלבד') || paymentMethod.includes('בלון') || paymentMethod.includes('bullet')) {
          trackCost = (balance * monthlyRate * months) + balance;
        } else if (linked) {
          trackCost = calcLinkedCost(balance, annualRate, months);
        } else {
          const payment = balance * (monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1);
          trackCost = payment * months;
        }
        totalOldPayments += trackCost;
        console.log(`  Track cost: ${track.track_type} | linked=${linked} | ₪${balance.toLocaleString()} × ${months}mo = ₪${Math.round(trackCost).toLocaleString()}`);
      });
    } else if (extractionResult.monthly_payment > 0 && weightedPeriodMonths > 0) {
      totalOldPayments = extractionResult.monthly_payment * weightedPeriodMonths;
    }
    // ━━━ NEW MORTGAGE ━━━
    const avgPrime = CURRENT_MARKET_RATES.prime;
    const avgFixedUnlinked = CURRENT_MARKET_RATES.fixed_unlinked;
    const avgVariableUnlinked = CURRENT_MARKET_RATES.variable_unlinked;
    const avgNewRate = (avgPrime * 0.67) + (avgFixedUnlinked * 0.20) + (avgVariableUnlinked * 0.13);
    const totalNewPrincipal = actualRemainingBalance + earlyRepaymentFee + bankFees;
    const monthlyNewRate = avgNewRate / 100 / 12;
    const newMonthlyPaymentTotal = totalNewPrincipal * (monthlyNewRate * Math.pow(1 + monthlyNewRate, weightedPeriodMonths)) / (Math.pow(1 + monthlyNewRate, weightedPeriodMonths) - 1);
    const totalNewPayments = newMonthlyPaymentTotal * weightedPeriodMonths;
    // ━━━ EXISTING MONTHLY PAYMENT ━━━
    const existingMonthlyPayment = extractionResult.monthly_payment || (() => {
      if (!allTracks.length) return 0;
      return allTracks.reduce((s, t) => {
        const r = (t.interest_rate || 0) / 100 / 12;
        const n = t.remaining_months || 0;
        const b = t.remaining_balance || 0;
        if (r === 0 || n === 0 || b === 0) return s;
        return s + b * (r * Math.pow(1+r, n)) / (Math.pow(1+r, n) - 1);
      }, 0);
    })();
    console.log(`📊 totalOldPayments=₪${Math.round(totalOldPayments).toLocaleString()} | weightedMonths=${weightedPeriodMonths} | existingMonthly=₪${Math.round(existingMonthlyPayment).toLocaleString()}`);

    // ━━━ INDEX DAMAGE — pre-calculation placeholder (computed properly later in INDEX DAMAGE LIFETIME section) ━━━
    // totalIndexDamageLifetime מחושב לאחר בניית indexDamageAlerts — משמש כאן רק כהפניה
    // לא מחשבים כאן כדי למנוע כפילות חישוב

    // ━━━ SAVINGS ━━━
    // gross = totalOldPayments(עם מדד) - totalNewPayments(ללא מדד)
    // זה כולל את ביטול נזק המדד בתוכו.
    // ה-netSavings = gross - fees.
    // monthlySavings = מחושב ישירות מהחזר חודשי, לא מחלוקת gross/months (שמביאה לתוצאה שגויה)
    const calculateFinalSavings = (oldCost, newCost, fee, periodMonths = null, newMonthly = null) => {
      const gross = oldCost - newCost;
      const net = gross - fee - bankFees;
      const months = periodMonths || weightedPeriodMonths || 240;
      const monthlySavings = newMonthly !== null ? Math.round(existingMonthlyPayment - newMonthly) : Math.round(gross / months);
      return { grossSavings: Math.round(gross), netSavings: Math.round(net), monthlySavings, isWorthwhile: net > 10000 };
    };

    // ━━━ INDEX DAMAGE LIFETIME — חישוב מוקדם לשימוש ב-netSavings הראשי ━━━
    // חישוב נזק המדד המלא (Lifetime) על כל המסלולים הצמודים
    // base = עלות ללא מדד (inflation=0), indexed = עלות עם מדד — ההפרש הוא הנזק האמיתי
    const calcIndexDamageLifetime = (tracks) => {
      let total = 0;
      tracks.forEach(track => {
        if (isTrackCPILinked(track) && (track.remaining_balance || 0) > 0 && (track.remaining_months || 0) > 0) {
          const base = calcLinkedCost(track.remaining_balance, track.interest_rate, track.remaining_months, 0);
          const indexed = calcLinkedCost(track.remaining_balance, track.interest_rate, track.remaining_months);
          total += Math.max(0, indexed - base);
        }
      });
      return Math.round(total);
    };

    // ━━━ SURGICAL SAVINGS: חיסכון רק על המסלולים הרעילים ━━━
    // עבור מחזור כירורגי, החיסכון צריך להיות: עלות מסלולים רעילים עכשיו (עם מדד) - עלותם לאחר מחזור
    // ולא: עלות כל המשכנתא לפני vs. כל המשכנתא לאחר (שמעניש על שמירת הקבועה הזולה)
    let surgicalOldCost = 0, surgicalNewCost = 0, surgicalBalance = 0, surgicalAvgMonths = 0;

    // Pre-classify tracks to compute surgical savings before savingsResult
    const preClassified = allTracks.map(track => ({ track, classification: classifyTrack(track) }));
    const toxicTracksForSavings = preClassified.filter(({ classification }) => classification.status === 'TOXIC').map(({ track }) => track);
    const goldenTracksForSavings = preClassified.filter(({ classification }) => classification.status === 'GOLDEN').map(({ track }) => track);
    const isSurgicalMode = toxicTracksForSavings.length > 0 && goldenTracksForSavings.length > 0;

    if (isSurgicalMode) {
      // עלות מסלולים רעילים קיימים (עם מדד אם צמוד)
      // surgicalAvgMonths = ממוצע משוקלל לפי יתרה (לא ממוצע פשוט)
      let surgicalWeightedMonthsSum = 0;
      toxicTracksForSavings.forEach(t => {
        const linked = isTrackCPILinked(t);
        const bal = t.remaining_balance || 0;
        const months = t.remaining_months || 0;
        if (bal <= 0 || months <= 0) return;
        surgicalBalance += bal;
        surgicalWeightedMonthsSum += months * bal;
        if (linked) {
          surgicalOldCost += calcLinkedCost(bal, t.interest_rate, months);
        } else {
          const r = t.interest_rate / 100 / 12;
          surgicalOldCost += bal * (r * Math.pow(1+r, months)) / (Math.pow(1+r, months) - 1) * months;
        }
      });
      // ממוצע משוקלל לפי יתרה — נותן תמונה נכונה יותר של תקופת ההלוואה החדשה
      surgicalAvgMonths = surgicalBalance > 0 ? Math.round(surgicalWeightedMonthsSum / surgicalBalance) : weightedPeriodMonths;
      // עלות מסלולים רעילים לאחר מחזור (ריבית שוק חדשה, ללא מדד)
      const newR = avgNewRate / 100 / 12;
      surgicalNewCost = surgicalBalance * (newR * Math.pow(1+newR, surgicalAvgMonths)) / (Math.pow(1+newR, surgicalAvgMonths) - 1) * surgicalAvgMonths;
      console.log(`🔪 Surgical setup: balance=₪${Math.round(surgicalBalance).toLocaleString()} | months=${surgicalAvgMonths} | oldCost=₪${Math.round(surgicalOldCost).toLocaleString()} | newRate=${avgNewRate.toFixed(2)}% | newCost=₪${Math.round(surgicalNewCost).toLocaleString()}`);
    }

    // ━━━ savingsResult: כירורגי = חיסכון על הרעילים בלבד (כולל נזק מדד Lifetime); מלא = כל המשכנתא ━━━
    let savingsResult;
    if (isSurgicalMode) {
      // surgicalOldCost = עלות מסלולים רעילים קיימים עם מדד (כולל הצמדה)
      // surgicalNewCost = עלות אותם מסלולים אחרי מחזור לריבית שוק (ללא הצמדה)
      // ה-gross כבר מגלם: חיסכון ריבית + ביטול נזק מדד על המסלולים הרעילים

      // חיסכון חודשי כירורגי: התשלום הנוכחי על הרעילים מול התשלום החדש עליהם
      let currentToxicMonthly = 0, newToxicMonthly = 0;
      toxicTracksForSavings.forEach(t => {
        const r = t.interest_rate / 100 / 12;
        const n = t.remaining_months || 0;
        const b = t.remaining_balance || 0;
        if (r > 0 && n > 0 && b > 0) currentToxicMonthly += b * (r * Math.pow(1+r, n)) / (Math.pow(1+r, n) - 1);
      });
      const newR = avgNewRate / 100 / 12;
      newToxicMonthly = surgicalBalance * (newR * Math.pow(1+newR, surgicalAvgMonths)) / (Math.pow(1+newR, surgicalAvgMonths) - 1);
      const monthlySavings = Math.round(currentToxicMonthly - newToxicMonthly);

      // netSavings = gross כירורגי (ריבית + ביטול מדד על רעילים) - עמלות
      const gross = surgicalOldCost - surgicalNewCost;
      const net = gross - earlyRepaymentFee - bankFees;
      console.log(`🔪 Surgical: oldCost=₪${Math.round(surgicalOldCost).toLocaleString()} | newCost=₪${Math.round(surgicalNewCost).toLocaleString()} | gross=₪${Math.round(gross).toLocaleString()} | net=₪${Math.round(net).toLocaleString()}`);
      savingsResult = { grossSavings: Math.round(gross), netSavings: Math.round(net), monthlySavings, isWorthwhile: net > 5000 };
    } else {
      savingsResult = calculateFinalSavings(totalOldPayments, totalNewPayments, earlyRepaymentFee, null, newMonthlyPaymentTotal);
    }
    const { grossSavings, monthlySavings } = savingsResult;

    // חיסכון חודשי כולל (להצגה בסיכום): הפרש ההחזר החודשי הכולל לפני ואחרי
    const overallMonthlySavings = Math.round(existingMonthlyPayment - newMonthlyPaymentTotal);

    // ━━━ SENSITIVITY ANALYSIS — ייאותחל אחרי חישוב netSavings ━━━
    const sensitivityAnalysis = { optimistic: null, realistic: null, pessimistic: null };
    const hasTrueCPILinked = allTracks.some(t => isTrackCPILinked(t));
    if (hasTrueCPILinked) {
      const calcOldCostAtInflation = (inflationPct) => {
        let cost = 0;
        allTracks.forEach(track => {
          const linked = isTrackCPILinked(track);
          const months = track.remaining_months || 0;
          const balance = track.remaining_balance || 0;
          const rate = track.interest_rate || 0;
          if (months <= 0 || balance <= 0) return;
          if (linked) {
            cost += calcLinkedCost(balance, rate, months, inflationPct);
          } else {
            const r = rate / 100 / 12;
            cost += balance * (r * Math.pow(1+r, months)) / (Math.pow(1+r, months) - 1) * months;
          }
        });
        return cost;
      };
      // בתיק כירורגי: השוואה נגד עלות המסלולים הרעילים בלבד (לא כל המשכנתא)
      const calcReferenceCost = (inflationPct) => {
        if (!isSurgicalMode) return calcOldCostAtInflation(inflationPct);
        let cost = 0;
        toxicTracksForSavings.forEach(track => {
          const linked = isTrackCPILinked(track);
          const months = track.remaining_months || 0;
          const balance = track.remaining_balance || 0;
          const rate = track.interest_rate || 0;
          if (months <= 0 || balance <= 0) return;
          if (linked) {
            cost += calcLinkedCost(balance, rate, months, inflationPct);
          } else {
            const rr = rate / 100 / 12;
            cost += balance * (rr * Math.pow(1+rr, months)) / (Math.pow(1+rr, months) - 1) * months;
          }
        });
        return cost;
      };
      const newCostRef = isSurgicalMode ? surgicalNewCost : totalNewPayments;
      sensitivityAnalysis.optimistic = Math.round(calcReferenceCost(2.0) - newCostRef - totalCost);
      sensitivityAnalysis.pessimistic = Math.round(calcReferenceCost(3.5) - newCostRef - totalCost);
      if (sensitivityAnalysis.optimistic > sensitivityAnalysis.pessimistic) {
        [sensitivityAnalysis.optimistic, sensitivityAnalysis.pessimistic] = [sensitivityAnalysis.pessimistic, sensitivityAnalysis.optimistic];
      }
    }

    // ━━━ INDEX DAMAGE LIFETIME — חוק 2 (Inflation Lifetime) ━━━
    // בתיק כירורגי: נזק המדד מחושב רק על המסלולים שמוחזרים (הרעילים) — לא על הזהב שנשמר.
    // אם שומרים מסלול צמוד (זהב), לא ניתן לטעון שביטלנו את הצמדה שלו.
    // calcLinkedCost עם inflation=0 = עלות נטו ריבית בלבד (בסיס)
    // calcLinkedCost עם inflation=2.5% = עלות כוללת ריבית + הצמדה (indexed)
    // נזק = indexed - base = הנזק הטהור מהצמדה למדד לכל תקופת המסלול
    const indexDamageAlerts = [];
    // tracksForIndexDamage: בכירורגי — רק הרעילים; במלא — כולם
    const tracksForIndexDamage = isSurgicalMode ? toxicTracksForSavings : allTracks;
    tracksForIndexDamage.forEach(track => {
      if (isTrackCPILinked(track) && (track.remaining_balance || 0) > 0 && (track.remaining_months || 0) > 0) {
        const n = track.remaining_months; // כל חודשי המסלול — לא רק 60 חודשים!
        const base = calcLinkedCost(track.remaining_balance, track.interest_rate, n, 0);   // ללא מדד
        const indexed = calcLinkedCost(track.remaining_balance, track.interest_rate, n);    // עם מדד 2.5% Lifetime
        const damage = Math.round(indexed - base);
        if (damage > 0) {
          indexDamageAlerts.push({
            track_type: translateTrackType(track.track_type),
            balance: track.remaining_balance,
            months: n,
            indexDamage: damage,
            note: `מדד יוסיף ₪${damage.toLocaleString()} לאורך כל ${Math.round(n/12)} שנות המסלול (Lifetime)`
          });
          console.log(`  💥 Index damage [${track.track_type}]: ₪${track.remaining_balance?.toLocaleString()} × ${n}mo = ₪${damage.toLocaleString()} (base=₪${Math.round(base).toLocaleString()} → indexed=₪${Math.round(indexed).toLocaleString()})`);
        }
      }
    });

    // totalIndexDamageLifetime = סך נזק המדד המלא על כל המסלולים הצמודים לכל תקופתם
    const totalIndexDamageLifetime = indexDamageAlerts.reduce((s, a) => s + (a.indexDamage || 0), 0);
    console.log(`🛡️ totalIndexDamageLifetime=₪${totalIndexDamageLifetime.toLocaleString()} (across ${indexDamageAlerts.length} linked tracks)`);
    console.log(`🔍 Index damage detail:`, indexDamageAlerts.map(a => `${a.track_type}: ₪${a.indexDamage?.toLocaleString()} (${a.months}mo)`).join(' | '));

    // ━━━ NET SAVINGS — השורה התחתונה האמיתית (finalTotalNetSavings) ━━━
    // חוק 3 (Executive Aggregation): הרווח הכלכלי נטו = MAX של כל החישובים:
    //   (א) savingsResult.netSavings — חיסכון כירורגי/מלא (ריבית + מדד רעילים)
    //   (ב) totalIndexDamageLifetime - totalCost — מגן מדד Lifetime נטו מעמלות
    //   (ג) totalOldPayments - totalNewPayments - totalCost — חיסכון ריאלי מלא
    // NOTE: strategyA.netSavings מחושב בתוך dualStrategy בהמשך ונכלל בהסוף
    // לא ייתכן שהרווח הנטו קטן ממגן המדד לבדו!
    const fullRefinanceSavings = Math.round(totalOldPayments - totalNewPayments - totalCost);
    const indexShieldNet = Math.round(totalIndexDamageLifetime - totalCost);

    // ━━━ STRATEGY A PRE-CALC: חישוב מוקדם של oldCostLifetime לשימוש ב-MAX ━━━
    // אותו חישוב שיתבצע בתוך dualStrategy — מחשבים כאן כדי לכלול ב-MAX
    const tracksForComparisonPreCalc = isSurgicalMode ? toxicTracksForSavings : allTracks;
    let oldCostLifetimePreCalc = 0;
    tracksForComparisonPreCalc.forEach(track => {
      const linked = isTrackCPILinked(track);
      const annualRate = track.interest_rate || 0;
      const balance = track.remaining_balance || 0;
      const rTrack = annualRate / 100 / 12;
      const months = track.remaining_months || weightedPeriodMonths;
      if (balance <= 0 || months <= 0) return;
      if (linked) {
        oldCostLifetimePreCalc += calcLinkedCost(balance, annualRate, months);
      } else {
        const pmt = balance * (rTrack * Math.pow(1+rTrack, months)) / (Math.pow(1+rTrack, months) - 1);
        oldCostLifetimePreCalc += pmt * months;
      }
    });
    // Strategy A principal: same logic as dualStrategy
    const surgicalPrincipalPreCalc = isSurgicalMode ? surgicalBalance + earlyRepaymentFee + bankFees : actualRemainingBalance + earlyRepaymentFee + bankFees;
    // Strategy A: shortest period where new payment ≤ current × 1.15
    const currentMonthlyPreCalc = extractionResult.monthly_payment || Math.round(existingMonthlyPayment);
    const r_preCalc = avgNewRate / 100 / 12;
    let strategyAYearsPreCalc = weightedPeriodYears;
    const refMonthlyPreCalc = isSurgicalMode
      ? toxicTracksForSavings.reduce((s, t) => { const rr = t.interest_rate/100/12; const n = t.remaining_months||0; const b = t.remaining_balance||0; return (rr>0&&n>0&&b>0) ? s + b*(rr*Math.pow(1+rr,n))/(Math.pow(1+rr,n)-1) : s; }, 0)
      : currentMonthlyPreCalc;
    const maxYearsPreCalc = isSurgicalMode ? Math.ceil((surgicalAvgMonths || weightedPeriodMonths) / 12) : weightedPeriodYears;
    for (let y = 10; y <= maxYearsPreCalc; y++) {
      const m = y * 12;
      const pmt = surgicalPrincipalPreCalc * (r_preCalc * Math.pow(1+r_preCalc, m)) / (Math.pow(1+r_preCalc, m) - 1);
      if (pmt <= refMonthlyPreCalc * 1.15) { strategyAYearsPreCalc = y; break; }
    }
    const strategyAMonthsPreCalc = strategyAYearsPreCalc * 12;
    const strategyAMonthlyPreCalc = surgicalPrincipalPreCalc * (r_preCalc * Math.pow(1+r_preCalc, strategyAMonthsPreCalc)) / (Math.pow(1+r_preCalc, strategyAMonthsPreCalc) - 1);
    const strategyANetSavingsPreCalc = Math.round(oldCostLifetimePreCalc - (strategyAMonthlyPreCalc * strategyAMonthsPreCalc) - totalCost);
    console.log(`📐 Pre-calc StrategyA: oldLifetime=₪${Math.round(oldCostLifetimePreCalc).toLocaleString()} | newTotal=₪${Math.round(strategyAMonthlyPreCalc * strategyAMonthsPreCalc).toLocaleString()} | netSavings=₪${strategyANetSavingsPreCalc.toLocaleString()}`);

    // ━━━ Strategy B pre-calc: חישוב oxygenNetSavings מוקדם לשימוש ב-FINAL_NET ━━━
    const oxygenYearsPreCalc = Math.min(30, maxAllowedYears);
    const oxygenMonthsPreCalc = oxygenYearsPreCalc * 12;
    const surgicalPrincipalB = isSurgicalMode ? surgicalBalance + earlyRepaymentFee + bankFees : actualRemainingBalance + earlyRepaymentFee + bankFees;
    const r_b = avgNewRate / 100 / 12;
    const oxygenMonthlyPreCalc = surgicalPrincipalB * (r_b * Math.pow(1+r_b, oxygenMonthsPreCalc)) / (Math.pow(1+r_b, oxygenMonthsPreCalc) - 1);
    const tracksForCompPreCalc = isSurgicalMode ? toxicTracksForSavings : allTracks;
    let oldCostForOxygenPreCalc = 0;
    tracksForCompPreCalc.forEach(track => {
      const linked = isTrackCPILinked(track);
      const annualRate = track.interest_rate || 0;
      const balance = track.remaining_balance || 0;
      const rTrack = annualRate / 100 / 12;
      const trackMonths = track.remaining_months || weightedPeriodMonths;
      if (balance <= 0 || trackMonths <= 0) return;
      const effectiveMonths = Math.max(trackMonths, oxygenMonthsPreCalc);
      if (linked) {
        oldCostForOxygenPreCalc += calcLinkedCost(balance, annualRate, effectiveMonths);
      } else {
        const pmt = balance * (rTrack * Math.pow(1+rTrack, effectiveMonths)) / (Math.pow(1+rTrack, effectiveMonths) - 1);
        oldCostForOxygenPreCalc += pmt * effectiveMonths;
      }
    });
    const strategyBNetSavingsPreCalc = Math.round(oldCostForOxygenPreCalc - (oxygenMonthlyPreCalc * oxygenMonthsPreCalc) - totalCost);
    console.log(`📐 Pre-calc StrategyB (oxygen): net=₪${strategyBNetSavingsPreCalc.toLocaleString()}`);

    // finalTotalNetSavings = MAX של כל האסטרטגיות — מספר אחד, עקבי, בכל הדוח
    const FINAL_NET = Math.max(savingsResult.netSavings, indexShieldNet, fullRefinanceSavings, strategyANetSavingsPreCalc, strategyBNetSavingsPreCalc);
    const netSavings = FINAL_NET; // alias — כל הקוד משתמש בשם netSavings
    console.log(`💰 FINAL_NET=₪${FINAL_NET.toLocaleString()} | surgical=₪${savingsResult.netSavings.toLocaleString()} | indexShieldNet=₪${indexShieldNet.toLocaleString()} | fullRefinance=₪${fullRefinanceSavings.toLocaleString()} | strategyA=₪${strategyANetSavingsPreCalc.toLocaleString()} | strategyB=₪${strategyBNetSavingsPreCalc.toLocaleString()}`);

    // ━━━ SENSITIVITY SYNC — realistic = FINAL_NET (Single Source of Truth) ━━━
    sensitivityAnalysis.realistic = FINAL_NET;
    // אם יש מסלולים צמודים: חשב optimistic/pessimistic ביחס ל-netSavings הסופי
    // הפרש בין realistic(2.5%) לoptimistic(2.0%)/pessimistic(3.5%) נשמר, אבל הבסיס = netSavings
    if (sensitivityAnalysis.optimistic !== null && sensitivityAnalysis.pessimistic !== null) {
      // הפרש יחסי: כמה פחות/יותר מדד 2.0% vs 3.5% ביחס ל-2.5%
      const baseOldCost = isSurgicalMode ? surgicalOldCost : totalOldPayments;
      const baseNewCost = isSurgicalMode ? surgicalNewCost : totalNewPayments;
      const baseNet = Math.round(baseOldCost - baseNewCost - totalCost);
      const deltaOpt = sensitivityAnalysis.optimistic - baseNet;
      const deltaPess = sensitivityAnalysis.pessimistic - baseNet;
      // apply same deltas on top of the true finalTotalNetSavings
      sensitivityAnalysis.optimistic = Math.round(netSavings + deltaOpt);
      sensitivityAnalysis.pessimistic = Math.round(netSavings + deltaPess);
      // ensure ordering: optimistic < realistic < pessimistic (higher inflation = higher savings from linked tracks)
      if (sensitivityAnalysis.optimistic > sensitivityAnalysis.pessimistic) {
        [sensitivityAnalysis.optimistic, sensitivityAnalysis.pessimistic] = [sensitivityAnalysis.pessimistic, sensitivityAnalysis.optimistic];
      }
    } else if (sensitivityAnalysis.optimistic === null) {
      // תיק ללא מסלולים צמודים — כל 3 הערכים זהים
      sensitivityAnalysis.optimistic = netSavings;
      sensitivityAnalysis.pessimistic = netSavings;
    }

    // ━━━ SURGICAL ANALYSIS (reuse preClassified) ━━━
    const surgicalAnalysis = { goldenAssets: [], toxicTracks: [], neutralTracks: [] };
    preClassified.forEach(({ track, classification }) => {
      const withClass = { ...track, classification };
      if (classification.status === 'GOLDEN') surgicalAnalysis.goldenAssets.push(withClass);
      else if (classification.status === 'TOXIC') surgicalAnalysis.toxicTracks.push(withClass);
      else surgicalAnalysis.neutralTracks.push(withClass);
    });

    // ━━━ MIX CALCULATION ━━━
    const validateCompliance = (tracks) => {
      let fixed = 0, variable = 0;
      tracks.forEach(t => {
        const type = (t.track_type || '').toLowerCase();
        const pct = t.percentage || 0;
        if (type.includes('פריים') || type.includes('prime')) variable += pct;
        else if (type.includes('קבוע') || type.includes('fixed')) fixed += pct;
        else if (type.includes('משתנה') || type.includes('variable')) variable += pct;
      });
      const errors = [];
      if (fixed < 33) errors.push({ type: 'REGULATORY', severity: 'CRITICAL', message: `${fixed.toFixed(1)}% קבוע - דורש Auto-Shift`, missingPercent: 33.1 - fixed });
      return { isCompliant: errors.length === 0, fixedPercentage: Math.round(fixed), variablePercentage: Math.round(variable), errors };
    };

    // בתיק כירורגי: תמהילים מחושבים על החלק שממחזרים בלבד (surgicalBalance + fees)
    const mixBasePrincipal = isSurgicalMode ? (surgicalBalance + earlyRepaymentFee + bankFees) : actualRemainingBalance;

    // goldenMonthly for mixes — חישוב החזר חודשי של מסלולי הזהב (לשימוש בתמהילים)
    const goldenMonthlyForMixes = isSurgicalMode
      ? goldenTracksForSavings.reduce((s, t) => {
          const rr = t.interest_rate / 100 / 12;
          const n = t.remaining_months || 0;
          const b = t.remaining_balance || 0;
          return (rr > 0 && n > 0 && b > 0) ? s + b * (rr * Math.pow(1+rr, n)) / (Math.pow(1+rr, n) - 1) : s;
        }, 0)
      : 0;

    const calculateMix = (trackDefs) => {
      let totalMonthly = 0, totalPayments = 0;
      const calculatedTracks = trackDefs.map(t => {
        const amount = t.exact_amount || (mixBasePrincipal * (t.percentage / 100));
        const r = t.interest_rate / 100 / 12;
        const m = t.period_years * 12;
        const monthly = amount * (r * Math.pow(1+r, m)) / (Math.pow(1+r, m) - 1);
        totalMonthly += monthly;
        totalPayments += monthly * m;
        return { track_type: t.track_type, amount: Math.round(amount), percentage: Math.round((amount / mixBasePrincipal) * 1000) / 10, interest_rate: t.interest_rate, period_years: t.period_years, monthly_payment: Math.round(monthly) };
      });

      // בתיק כירורגי: הוסף את מסלול הזהב כ-track נוסף (נשמר)
      if (isSurgicalMode && goldenTracksForSavings.length > 0) {
        goldenTracksForSavings.forEach(gt => {
          const rr = gt.interest_rate / 100 / 12;
          const n = gt.remaining_months || 0;
          const b = gt.remaining_balance || 0;
          const gm = (rr > 0 && n > 0 && b > 0) ? b * (rr * Math.pow(1+rr, n)) / (Math.pow(1+rr, n) - 1) : 0;
          calculatedTracks.push({
            track_type: translateTrackType(gt.track_type),
            amount: Math.round(b),
            percentage: Math.round((b / actualRemainingBalance) * 1000) / 10,
            interest_rate: gt.interest_rate,
            period_years: Math.round(n / 12),
            monthly_payment: Math.round(gm),
            is_golden: true,
            label: '⭐ מסלול נשמר'
          });
        });
      }

      const mixPeriodMonths = trackDefs[0].period_years * 12;
      // חישוב חיסכון הוגן: משווה עלות המשכנתא הישנה לאותה תקופה בדיוק
      let oldCostForPeriod = totalOldPayments;
      if (mixPeriodMonths !== weightedPeriodMonths && mixPeriodMonths > 0) {
        oldCostForPeriod = 0;
        allTracks.forEach(track => {
          const linked = isTrackCPILinked(track);
          const annualRate = track.interest_rate || 0;
          const r = annualRate / 100 / 12;
          const balance = track.remaining_balance || 0;
          if (balance <= 0) return;
          const effectiveMonths = Math.min(track.remaining_months || weightedPeriodMonths, mixPeriodMonths);
          if (linked) {
            oldCostForPeriod += calcLinkedCost(balance, annualRate, effectiveMonths);
          } else {
            const pmt = balance * (r * Math.pow(1+r, effectiveMonths)) / (Math.pow(1+r, effectiveMonths) - 1);
            oldCostForPeriod += pmt * effectiveMonths;
          }
        });
      }
      const savings = calculateFinalSavings(oldCostForPeriod, totalPayments, earlyRepaymentFee, mixPeriodMonths);
      // החזר חודשי כולל = מסלולים חדשים + מסלול זהב שנשמר
      const totalMonthlyWithGolden = Math.round(totalMonthly + goldenMonthlyForMixes);
      const realMixMonthlySavings = Math.round(existingMonthlyPayment - totalMonthlyWithGolden);
      return { tracks: calculatedTracks, total_monthly_payment: totalMonthlyWithGolden, total_interest: Math.round(totalPayments - mixBasePrincipal), monthly_savings: realMixMonthlySavings, total_savings: savings.grossSavings, net_savings: savings.netSavings, is_worthwhile: savings.isWorthwhile, compliance: validateCompliance(calculatedTracks) };
    };

    const enforce33Fixed = (mix) => {
      const fixedPct = mix.tracks.reduce((s, t) => (t.track_type || '').toLowerCase().includes('קבוע') ? s + (t.percentage || 0) : s, 0);
      if (fixedPct >= 33) return mix;
      const missing = 33.1 - fixedPct;
      const fixedIdx = mix.tracks.findIndex(t => (t.track_type || '').toLowerCase().includes('קבוע'));
      let flexIdx = mix.tracks.findIndex(t => (t.track_type || '').toLowerCase().includes('פריים'));
      if (flexIdx === -1) flexIdx = mix.tracks.findIndex(t => (t.track_type || '').toLowerCase().includes('משתנה'));
      if (fixedIdx === -1 || flexIdx === -1) return mix;
      const newTracks = mix.tracks.map((t, i) => ({ ...t, percentage: i === fixedIdx ? t.percentage + missing : i === flexIdx ? Math.max(10, t.percentage - missing) : t.percentage }));
      return { ...mix, ...calculateMix(newTracks), mix_name: mix.mix_name, mix_number: mix.mix_number, risk_level: mix.risk_level, advantages: mix.advantages, disadvantages: mix.disadvantages, recommended_for: mix.recommended_for };
    };

    const mix1Period = Math.min(weightedPeriodYears, maxAllowedYears);
    const mix2Period = Math.min(weightedPeriodYears, maxAllowedYears);
    const mix3Period = Math.min(30, Math.min(weightedPeriodYears + 3, maxAllowedYears));

    const mix1Raw = calculateMix([
      { track_type: 'פריים', percentage: 33, interest_rate: avgPrime, period_years: mix1Period },
      { track_type: 'קבועה לא צמודה', percentage: 34, interest_rate: avgFixedUnlinked, period_years: mix1Period },
      { track_type: 'משתנה לא צמודה', percentage: 33, interest_rate: avgVariableUnlinked, period_years: mix1Period }
    ]);
    const mix2Raw = calculateMix([
      { track_type: 'פריים', percentage: 47, interest_rate: avgPrime, period_years: mix2Period },
      { track_type: 'קבועה לא צמודה', percentage: 38, interest_rate: avgFixedUnlinked, period_years: mix2Period },
      { track_type: 'משתנה לא צמודה', percentage: 15, interest_rate: avgVariableUnlinked, period_years: mix2Period }
    ]);
    const mix3Raw = calculateMix([
      { track_type: 'פריים', percentage: 27, interest_rate: avgPrime, period_years: mix3Period },
      { track_type: 'קבועה לא צמודה', percentage: 46, interest_rate: avgFixedUnlinked, period_years: mix3Period },
      { track_type: 'משתנה לא צמודה', percentage: 27, interest_rate: avgVariableUnlinked, period_years: mix3Period }
    ]);

    const mixesData = [
      { ...mix1Raw, mix_name: 'תמהיל 1: מאוזן ואופטימלי', mix_number: 1, risk_level: 'balanced', advantages: ['חלוקה שווה', 'תשלום צפוי', `חיסכון: ₪${mix1Raw.monthly_savings?.toLocaleString()}`], disadvantages: ['לא ממקסם חיסכון'], recommended_for: 'לקוחות שרוצים חלוקה שווה' },
      { ...mix2Raw, mix_name: 'תמהיל 2: מאוזן', mix_number: 2, risk_level: 'balanced', advantages: ['עומד ברגולציה', 'איזון ריבית/ביטחון', `חיסכון: ₪${mix2Raw.monthly_savings?.toLocaleString()}`], disadvantages: ['פחות גמיש'], recommended_for: '⭐ מומלץ - איזון אופטימלי' },
      { ...mix3Raw, mix_name: 'תמהיל 3: הגנה מקסימלית', mix_number: 3, risk_level: 'conservative', advantages: ['תשלום יציב', 'הגנה מלאה ממדד', `חיסכון: ₪${mix3Raw.monthly_savings?.toLocaleString()}`], disadvantages: ['ריבית גבוהה יותר'], recommended_for: 'לקוחות שמעדיפים יציבות מקסימלית' }
    ];
    const compliantMixes = mixesData.map(m => enforce33Fixed(m));
    console.log(`✅ 3 mixes ready`);

    // ━━━ EQUITY RELEASE ━━━
    let equityReleaseAnalysis = null;
    const externalDebts = external_debts_input?.length > 0 ? external_debts_input : (extractionResult.external_debts || []);
    if (externalDebts?.length > 0) {
      const propertyValue = extractionResult.estimated_property_value || 0;
      const externalTotal = externalDebts.reduce((s, d) => s + (d.remaining_balance || 0), 0) + arrearsDebt;
      const externalMonthly = externalDebts.reduce((s, d) => s + (d.monthly_repayment || 0), 0);
      const totalNewLoan = actualRemainingBalance + externalTotal;
      const ltvRatio = propertyValue > 0 ? (totalNewLoan / propertyValue) * 100 : 0;
      const allPurposeRate = avgNewRate + 1.5;
      const r = allPurposeRate / 100 / 12;
      const rHousing = avgNewRate / 100 / 12;
      const m = 240;
      const newPayment = totalNewLoan * (r * Math.pow(1+r, m)) / (Math.pow(1+r, m) - 1);
      const currentBurden = (extractionResult.monthly_payment || existingMonthlyPayment || 0) + externalMonthly;
      const housingPayment = actualRemainingBalance * (rHousing * Math.pow(1+rHousing, m)) / (Math.pow(1+rHousing, m) - 1);
      const allPurposePayment = externalTotal > 0 ? externalTotal * (r * Math.pow(1+r, m)) / (Math.pow(1+r, m) - 1) : 0;
      const totalCombined = Math.round(housingPayment + allPurposePayment);
      const weightedRate = totalNewLoan > 0 ? parseFloat(((actualRemainingBalance * avgNewRate + externalTotal * allPurposeRate) / totalNewLoan).toFixed(2)) : parseFloat(allPurposeRate.toFixed(2));

      equityReleaseAnalysis = {
        propertyValue: Math.round(propertyValue), currentMortgageBalance: actualRemainingBalance,
        totalExternalDebt: Math.round(externalTotal), totalNewLoan: Math.round(totalNewLoan),
        ltvRatio: parseFloat(ltvRatio.toFixed(2)), currentMonthlyBurden: Math.round(currentBurden),
        newMonthlyPayment: Math.round(newPayment), monthlyCashFlowImprovement: Math.round(currentBurden - newPayment),
        allPurposeRate: parseFloat(allPurposeRate.toFixed(2)),
        status: ltvRatio > 70 ? 'HIGH_RISK_LTV' : ltvRatio > 50 ? 'MODERATE_LTV' : 'HEALTHY_LTV',
        isWorthwhile: (currentBurden - newPayment) > 2000 && ltvRatio <= 70,
        externalDebts,
        splitAnalysis: {
          housingPortion: { label: 'רכיב דיור (מחזור משכנתא)', amount: Math.round(actualRemainingBalance), rate: parseFloat(avgNewRate.toFixed(2)), monthlyImpact: Math.round(housingPayment) },
          allPurposePortion: { label: 'רכיב לכל מטרה (איחוד חובות)', amount: Math.round(externalTotal), rate: parseFloat(allPurposeRate.toFixed(2)), monthlyImpact: Math.round(allPurposePayment) },
          combinedTotal: { totalPrincipal: Math.round(totalNewLoan), totalMonthly: totalCombined, weightedRate, beforeTotal: Math.round(currentBurden), netSavings: Math.max(0, Math.round(currentBurden) - totalCombined) }
        }
      };
    }

    // ━━━ STRATEGY ━━━
    let strategy = { type: 'NO_REFINANCE', title: 'המשכנתא מצוינת', icon: '✅', description: 'ריביות קיימות טובות מהשוק' };
    if (surgicalAnalysis.toxicTracks.length > 0 && surgicalAnalysis.goldenAssets.length > 0) {
      strategy = { type: 'SURGICAL', title: 'מחזור כירורגי', description: `שומרים ${surgicalAnalysis.goldenAssets.length} מסלולים זולים`, icon: '🎯' };
    } else if (surgicalAnalysis.toxicTracks.length > 0) {
      strategy = { type: 'FULL', title: '💰 מחזור מלא', description: 'כל המסלולים יקרים', icon: '🔥' };
    }
    if (strategy.type === 'NO_REFINANCE' && netSavings > 10000) {
      strategy = { type: 'REFINANCE_RECOMMENDED', title: '💰 מחזור מומלץ', description: `חיסכון נטו ₪${netSavings.toLocaleString()} — כולל ביטול נזק מדד`, icon: '💰' };
    }

    // ━━━ BORROWER NAMES ━━━
    const borrowersNames = [];
    if (extractionResult.borrower_1) borrowersNames.push(`${extractionResult.borrower_1.first_name || ''} ${extractionResult.borrower_1.last_name || ''}`.trim());
    if (extractionResult.borrower_2) borrowersNames.push(`${extractionResult.borrower_2.first_name || ''} ${extractionResult.borrower_2.last_name || ''}`.trim());

    // ━━━ EFFECTIVE RATE ━━━
    let effectiveRateOld = extractionResult.average_interest_rate || 0;
    if (allTracks.length > 0) {
      const totalBal = allTracks.reduce((s, t) => s + (t.remaining_balance || 0), 0);
      if (totalBal > 0) {
        effectiveRateOld = allTracks.reduce((s, t) => s + (isTrackCPILinked(t) ? t.interest_rate + EXPECTED_ANNUAL_INFLATION : t.interest_rate) * (t.remaining_balance || 0), 0) / totalBal;
      }
    }

    // ━━━ CONCLUSION ━━━
    const totalIndexDamage = totalIndexDamageLifetime; // Lifetime, לא 5 שנים
    const isSurgical = strategy.type === 'SURGICAL';

    // ━━━ CONCLUSION — מחושב אחרי שיש לנו את netSavings הסופי (כולל חוק 3) ━━━
    let conclusionText = '';
    if (arrearsDebt > 0) conclusionText = `⚠️ זוהה פיגור במשכנתא בסך ₪${arrearsDebt.toLocaleString()}. מדובר בתיק הצלה — מחזור המשכנתא נועד להסדיר את החוב ולהציל את הנכס.\n\n`;

    // ━━━ CONCLUSION — כל המספרים נשאבים מ-FINAL_NET בלבד ━━━
    if (FINAL_NET > 0) {
      conclusionText += `לאחר ניתוח מעמיק של יתרת הסילוק, זיהינו פוטנציאל חיסכון כלכלי נטו של ₪${FINAL_NET.toLocaleString()} לאורך תקופת ההלוואה`;
      if (totalIndexDamage > 0) {
        conclusionText += ` (כולל ₪${totalIndexDamage.toLocaleString()} מגן מדד Lifetime — ביטול הצמדה מלאה)`;
      }
      if (isSurgical && savingsResult.monthlySavings >= 200) {
        conclusionText += `. חיסכון חודשי מהמחזור הכירורגי: ₪${savingsResult.monthlySavings.toLocaleString()}`;
      } else if (overallMonthlySavings > 0) {
        conclusionText += `. החיסכון החודשי הצפוי עומד על ₪${overallMonthlySavings.toLocaleString()}`;
      } else if (overallMonthlySavings < 0) {
        conclusionText += `. ההחזר החודשי עולה ב-₪${Math.abs(overallMonthlySavings).toLocaleString()}, אך החיסכון הכולל נובע מביטול ההצמדה למדד`;
      }
      conclusionText += `.\n\n`;
    } else {
      conclusionText += `לאחר ניתוח מעמיק, המשכנתא הנוכחית שלך זולה יותר מהמחזור המוצע בתנאי השוק הנוכחיים. `;
      conclusionText += `ריבית המחזור (${parseFloat(avgNewRate.toFixed(2))}%) גבוהה מהריבית האפקטיבית הקיימת, ולכן עלות המחזור תעמוד על ₪${Math.abs(FINAL_NET).toLocaleString()} יותר לאורך התקופה.\n\n`;
    }
    if (totalIndexDamage > 0) conclusionText += `מסלולי ההצמדה הקיימים גורמים ל"נזק מדד" נוסף של כ-₪${totalIndexDamage.toLocaleString()} לאורך התקופה. מחזור למסלולים לא צמודים יבטל נזק זה לחלוטין.\n\n`;
    if (equityReleaseAnalysis?.monthlyCashFlowImprovement > 0) conclusionText += `באמצעות איחוד החובות, שיפור התזרים החודשי יעמוד על ₪${equityReleaseAnalysis.monthlyCashFlowImprovement.toLocaleString()} — שינוי משמעותי באיכות החיים.\n\n`;
    conclusionText += `אסטרטגיה מומלצת: ${strategy.title}. ${FINAL_NET > 50000 ? 'ממליצים בחום לפעול ולממש את החיסכון בהקדם.' : FINAL_NET > 10000 ? 'המחזור משתלם — כדאי לפעול.' : 'מומלץ לבדוק תנאים עדכניים מול הבנקים.'}`;

    // אף פעם לא להציג אימוג'י סכין בטקסט המסקנה, ללא קשר למקור
    conclusionText = conclusionText.replace(/🔪\s*/g, '');

    // ━━━ SANITIZE & RETURN ━━━
    const safeData = (data) => JSON.parse(JSON.stringify(data, (key, value) => {
      if (typeof value === 'number' && (isNaN(value) || !isFinite(value))) return 0;
      return value;
    }));

    return Response.json(safeData({
      success: true,
      bankName: extractionResult.bank_name || 'לא זוהה',
      isFullReport: extractionResult.is_full_payoff_statement !== false,
      transactionType: transaction_type || 'refinance',
      statementDate,
      statementDateWarning,
      borrower_1: extractionResult.borrower_1 || null,
      borrower_2: extractionResult.borrower_2 || null,
      currentLoan: {
        remainingBalance: actualRemainingBalance,
        averageInterestRate: extractionResult.average_interest_rate,
        effectiveInterestRate: parseFloat(effectiveRateOld.toFixed(2)),
        monthlyPayment: extractionResult.monthly_payment || Math.round(existingMonthlyPayment),
        remainingMonths: weightedPeriodMonths,
        borrowers_names: borrowersNames,
        id_number: extractionResult.borrower_1?.id_number,
        borrower_2: extractionResult.borrower_2 || null,
        tracks: allTracks.map(t => {
          const c = classifyTrack(t);
          return { track_type: translateTrackType(t.track_type), remaining_balance: t.remaining_balance, interest_rate: t.interest_rate, remaining_months: t.remaining_months, effective_rate: c.effectiveRate, status: c.status, reason: c.reason, is_index_linked: t.is_index_linked };
        })
      },
      newLoan: {
        averageInterestRate: parseFloat(avgNewRate.toFixed(2)),
        monthlyPayment: Math.round(newMonthlyPaymentTotal),
        periodYears: Math.ceil(weightedPeriodMonths / 12)
      },
      savings: {
        actualRemainingBalance,
        newPrincipalWithFees: Math.round(totalNewPrincipal),
        arrearsDebt: arrearsDebt > 0 ? arrearsDebt : undefined,
        monthlySavings: overallMonthlySavings,
        netSavings,
        refinanceCost: totalCost,
        earlyRepaymentFee,
        feeExemptionReason,
        feeWarning,
        feeConfidence,
        bankFees,
        breakEvenMonths: savingsResult.monthlySavings > 0 ? Math.ceil(totalCost / Math.max(savingsResult.monthlySavings, 1)) : 0,
        isWorthwhile: savingsResult.isWorthwhile,
        newAverageRate: parseFloat(avgNewRate.toFixed(2)),
        newMonthlyPayment: Math.round(newMonthlyPaymentTotal),
        sensitivityAnalysis,
        indexDamageAlerts,
        equityReleaseAnalysis,
        inflationUsed: EXPECTED_ANNUAL_INFLATION
      },
      // partialRefinanceSavings — netSavings = FINAL_NET (Single Source of Truth)
      partialRefinanceSavings: isSurgicalMode ? {
        toxicBalance: Math.round(surgicalBalance),
        monthlySavings: savingsResult.monthlySavings,
        netSavings: FINAL_NET,
        fees: Math.round(earlyRepaymentFee + bankFees),
        breakEvenMonths: savingsResult.monthlySavings > 0 ? Math.ceil((earlyRepaymentFee + bankFees) / savingsResult.monthlySavings) : 0,
        isWorthwhile: FINAL_NET > 20000
      } : null,
      surgicalAnalysis: {
        goldenCount: surgicalAnalysis.goldenAssets.length,
        toxicCount: surgicalAnalysis.toxicTracks.length,
        strategy,
        goldenAssets: surgicalAnalysis.goldenAssets.map(t => ({ track_type: translateTrackType(t.track_type), interest_rate: t.interest_rate, remaining_balance: t.remaining_balance })),
        toxicTracks: surgicalAnalysis.toxicTracks.map(t => ({ track_type: translateTrackType(t.track_type), interest_rate: t.interest_rate, remaining_balance: t.remaining_balance }))
      },
      mixes: compliantMixes,
      conclusionText,
      newRates: { average_rates: CURRENT_MARKET_RATES },
      bankReadyMetadata: { inflationAssumption: EXPECTED_ANNUAL_INFLATION, actualFeesUsed: earlyRepaymentFee, complianceChecked: true, feeConfidence },

      // ━━━ SNAPSHOT HEADER: LTV + PTI ━━━
      snapshotHeader: (() => {
        const propertyValue = extractionResult.estimated_property_value || 0;
        const ltv = propertyValue > 0 ? parseFloat(((actualRemainingBalance / propertyValue) * 100).toFixed(1)) : null;
        // PTI: monthly payment vs estimated household income
        // We don't have income here, but we return the payment so the frontend can display PTI if income is known
        return {
          propertyValue: propertyValue || null,
          ltv,
          ltvStatus: ltv ? (ltv < 45 ? 'excellent' : ltv < 60 ? 'good' : ltv < 70 ? 'acceptable' : 'high') : null,
          remainingBalance: actualRemainingBalance,
          currentMonthlyPayment: extractionResult.monthly_payment || Math.round(existingMonthlyPayment),
        };
      })(),

      // ━━━ DUAL STRATEGY: חיסכון (קיצור שנים) vs חמצן (הפחתת החזר) ━━━
      dualStrategy: (() => {
        const r = avgNewRate / 100 / 12;
        const currentMonthly = extractionResult.monthly_payment || Math.round(existingMonthlyPayment);

        // ━━━ SURGICAL vs FULL: הגדר principal ומסלולים לפי מצב ━━━
        const tracksForComparison = isSurgicalMode ? toxicTracksForSavings : allTracks;
        const surgicalPrincipal = isSurgicalMode ? surgicalBalance + earlyRepaymentFee + bankFees : actualRemainingBalance + earlyRepaymentFee + bankFees;

        // ━━━ GOLDEN MONTHLY: החזר חודשי של המסלולים שנשמרים (לתיק כירורגי) ━━━
        // זה נדרש כדי להציג ללקוח את ה"החזר הכולל" האמיתי לאחר המחזור
        const goldenMonthly = isSurgicalMode
          ? goldenTracksForSavings.reduce((s, t) => {
              const rr = t.interest_rate / 100 / 12;
              const n = t.remaining_months || 0;
              const b = t.remaining_balance || 0;
              return (rr > 0 && n > 0 && b > 0) ? s + b * (rr * Math.pow(1+rr, n)) / (Math.pow(1+rr, n) - 1) : s;
            }, 0)
          : 0;

        // ═══ OLD COST LIFETIME: עלות המסלולים שמוחזרים — Lifetime מלא כולל מדד ═══
        // זה הבסיס הקריטי — חייב לרוץ על כל חודשי המסלול (לא רק 60!)
        let oldCostLifetime = 0;
        tracksForComparison.forEach(track => {
          const linked = isTrackCPILinked(track);
          const annualRate = track.interest_rate || 0;
          const balance = track.remaining_balance || 0;
          const rTrack = annualRate / 100 / 12;
          const months = track.remaining_months || weightedPeriodMonths; // FULL remaining life!
          if (balance <= 0 || months <= 0) return;
          if (linked) {
            oldCostLifetime += calcLinkedCost(balance, annualRate, months); // כולל הצמדה Lifetime
          } else {
            const pmt = balance * (rTrack * Math.pow(1+rTrack, months)) / (Math.pow(1+rTrack, months) - 1);
            oldCostLifetime += pmt * months;
          }
        });
        console.log(`📐 DualStrategy oldCostLifetime=₪${Math.round(oldCostLifetime).toLocaleString()} across ${tracksForComparison.length} tracks (surgical=${isSurgicalMode})`);

        // ━━━ STRATEGY A: MAX SAVINGS — Avoided Payments (חוק 1) ━━━
        // המנגנון: מחפש תקופה קצרה ביותר שבה ההחזר ≤ 115% מהנוכחי
        // netSavings = oldCostLifetime - (תשלומים בפועל בתקופה החדשה) - עמלות
        // הרווח הגדול = החודשים שנחסכו בסוף (Avoided Payments)
        const refCurrentMonthly = isSurgicalMode
          ? toxicTracksForSavings.reduce((s, t) => {
              const rr = t.interest_rate / 100 / 12;
              const n = t.remaining_months || 0;
              const b = t.remaining_balance || 0;
              return (rr > 0 && n > 0 && b > 0) ? s + b * (rr * Math.pow(1+rr, n)) / (Math.pow(1+rr, n) - 1) : s;
            }, 0)
          : currentMonthly;
        const referenceMonths = isSurgicalMode ? (surgicalAvgMonths || weightedPeriodMonths) : weightedPeriodMonths;
        const referenceYears = Math.ceil(referenceMonths / 12);
        let strategySavingsYears = referenceYears; // fallback = תקופה מלאה
        for (let y = 10; y <= referenceYears; y++) {
          const m = y * 12;
          const pmt = surgicalPrincipal * (r * Math.pow(1+r, m)) / (Math.pow(1+r, m) - 1);
          if (pmt <= refCurrentMonthly * 1.15) { strategySavingsYears = y; break; }
        }
        const strategySavingsMonths = strategySavingsYears * 12;
        const strategyAMonthlyPayment = Math.round(surgicalPrincipal * (r * Math.pow(1+r, strategySavingsMonths)) / (Math.pow(1+r, strategySavingsMonths) - 1));
        // ══ Avoided Payments חוק 1: המסלולים שנמחקים = oldCostLifetime - עלות חדשה קצרה - עמלות
        const strategyATotalPaid = strategyAMonthlyPayment * strategySavingsMonths;
        const savingsNetSavings = Math.round(oldCostLifetime - strategyATotalPaid - totalCost);
        const yearsShortened = referenceYears - strategySavingsYears;
        const savingsMonthlySavings = Math.round(currentMonthly - strategyAMonthlyPayment);
        const displaySavingsMonthlyPayment = strategyAMonthlyPayment;
        const displaySavingsYears = strategySavingsYears;

        console.log(`📐 StrategyA: oldLifetime=₪${Math.round(oldCostLifetime).toLocaleString()} | newTotal=₪${strategyATotalPaid.toLocaleString()} | fees=₪${totalCost} | NET=₪${savingsNetSavings.toLocaleString()} | yearsShortened=${yearsShortened}`);

        // ━━━ STRATEGY B: MAX OXYGEN — הפחתת החזר (30 שנה) ━━━
        // oldCostForOxygenPeriod: עלות ישנה לאותה תקופה ארוכה — השוואה הוגנת
        const oxygenYears = Math.min(30, maxAllowedYears);
        const oxygenMonths = oxygenYears * 12;
        const oxygenMonthlyPayment = Math.round(surgicalPrincipal * (r * Math.pow(1+r, oxygenMonths)) / (Math.pow(1+r, oxygenMonths) - 1));
        const oxygenTotalPaid = oxygenMonthlyPayment * oxygenMonths;
        let oldCostForOxygenPeriod = 0;
        tracksForComparison.forEach(track => {
          const linked = isTrackCPILinked(track);
          const annualRate = track.interest_rate || 0;
          const balance = track.remaining_balance || 0;
          const rTrack = annualRate / 100 / 12;
          const trackMonths = track.remaining_months || weightedPeriodMonths;
          if (balance <= 0 || trackMonths <= 0) return;
          const effectiveMonths = Math.max(trackMonths, oxygenMonths);
          if (linked) {
            oldCostForOxygenPeriod += calcLinkedCost(balance, annualRate, effectiveMonths);
          } else {
            const pmt = balance * (rTrack * Math.pow(1+rTrack, effectiveMonths)) / (Math.pow(1+rTrack, effectiveMonths) - 1);
            oldCostForOxygenPeriod += pmt * effectiveMonths;
          }
        });
        const oxygenNetSavings = Math.round(oldCostForOxygenPeriod - oxygenTotalPaid - totalCost);

        // ━━━ MARKET RATE FLOOR VALIDATION ━━━
        // בתיק כירורגי: ה-EMI החדש חייב לכסות לפחות את הריבית השוק על surgicalPrincipal.
        // אם oxygenMonthlyPayment נמוך מהאפשרי מתמטית (באג חישוב), נחשב מחדש לפי ריבית השוק.
        const marketRateFloorMonthly = (() => {
          if (!isSurgicalMode || surgicalPrincipal <= 0) return 0;
          const floorRate = Math.min(avgPrime, avgFixedUnlinked, avgVariableUnlinked) / 100 / 12;
          const n = oxygenMonths;
          return surgicalPrincipal * (floorRate * Math.pow(1 + floorRate, n)) / (Math.pow(1 + floorRate, n) - 1);
        })();
        const validatedOxygenMonthly = Math.max(oxygenMonthlyPayment, marketRateFloorMonthly);
        console.log(`🔍 OxygenFloor: calculated=₪${Math.round(oxygenMonthlyPayment).toLocaleString()} | floor=₪${Math.round(marketRateFloorMonthly).toLocaleString()} | used=₪${Math.round(validatedOxygenMonthly).toLocaleString()}`);

        const monthlyRelief = currentMonthly - oxygenMonthlyPayment;

        console.log(`📊 DualStrategy: Strategy A net=₪${savingsNetSavings.toLocaleString()} | Strategy B net=₪${oxygenNetSavings.toLocaleString()}`);

        // בתיק כירורגי: ה"החזר הכולל" = תשלום מסלולים חדשים (מאומת ≥ רצפת שוק) + תשלום מסלולי הזהב שנשמרו
        const strategyATotalMonthly = Math.round(strategyAMonthlyPayment + goldenMonthly);
        const strategyBTotalMonthly = Math.round(validatedOxygenMonthly + goldenMonthly);
        const strategyADeltaFromCurrent = strategyATotalMonthly - currentMonthly;
        const strategyBDeltaFromCurrent = strategyBTotalMonthly - currentMonthly;
        const strategyBReliefTotal = Math.max(0, currentMonthly - strategyBTotalMonthly);
        console.log(`📊 Final totals: strategyA=₪${strategyATotalMonthly.toLocaleString()} | strategyB=₪${strategyBTotalMonthly.toLocaleString()} | current=₪${currentMonthly.toLocaleString()} | golden=₪${Math.round(goldenMonthly).toLocaleString()}`);

        return {
          strategyA: {
            label: 'מקסימום חיסכון (קיצור שנים)',
            icon: '🏆',
            monthlyPayment: strategyATotalMonthly,
            monthlyPaymentNewOnly: strategyAMonthlyPayment,
            periodYears: displaySavingsYears,
            yearsShortened: Math.max(0, yearsShortened),
            netSavings: savingsNetSavings,
            monthlySavings: savingsMonthlySavings,
            monthlyDelta: strategyADeltaFromCurrent,
            suitedFor: 'מושלם למי שרוצה לגמור עם החוב מהר ובזול'
          },
          strategyB: {
            label: 'מקסימום חמצן (הפחתת החזר)',
            icon: '🫁',
            monthlyPayment: strategyBTotalMonthly,
            monthlyPaymentNewOnly: Math.round(validatedOxygenMonthly),
            periodYears: oxygenYears,
            monthlyRelief: strategyBReliefTotal,
            netSavings: oxygenNetSavings,
            monthlyDelta: strategyBDeltaFromCurrent,
            suitedFor: 'מושלם למי שרוצה לשפר תזרים חודשי'
          },
          goldenMonthly: Math.round(goldenMonthly),
          currentMonthly
        };
      })()
    }));

  } catch (error) {
    console.error('Error:', error);
    // Return 200 with success:false so the frontend can show a user-friendly message
    const isLLMError = error.message?.includes('AnthropicException') || error.message?.includes('litellm') || error.message?.includes('Invalid request');
    const userMessage = isLLMError
      ? 'שגיאה בניתוח המסמך. ודא שהקובץ הוא PDF ברור וקריא ונסה שוב.'
      : (error.message || 'שגיאה בניתוח. נסה שוב.');
    return Response.json({ success: false, error: userMessage }, { status: 200 });
  }
  }),
};
