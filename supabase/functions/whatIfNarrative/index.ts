import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * whatIfNarrative — replaces WhatIfSimulator.jsx's direct-from-frontend LLM
 * call. A Gemini API key can't be exposed client-side, so this thin proxy
 * exists purely to hold the key server-side — plain prompt in, plain text
 * out, no schema.
 *
 * ── NO AUTH, BY EXPLICIT DECISION (2026-08-19) ──
 * Same as the rest of מרכז חיתום מוסדי in this app — no login.
 */
const MODEL = 'gemini-3-flash-preview';

export default {
  fetch: withSupabase({ auth: ["publishable"] }, async (req, ctx) => {
    try {
      const { prompt } = await req.json();
      if (!prompt) return Response.json({ error: 'prompt is required' }, { status: 400 });

      const apiKey = Deno.env.get('GEMINI_API_KEY');
      if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');
      const genAI = new GoogleGenerativeAI(apiKey);
      const geminiModel = genAI.getGenerativeModel({ model: MODEL });

      const result = await geminiModel.generateContent({ contents: [{ role: 'user', parts: [{ text: prompt }] }] });
      return Response.json({ text: result.response.text() });

    } catch (error) {
      console.error('whatIfNarrative error:', error.message);
      return Response.json({ error: error.message }, { status: 500 });
    }
  }),
};
