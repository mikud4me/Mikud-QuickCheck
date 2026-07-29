/**
 * chatWithMiko — replaces base44.integrations.Core.InvokeLLM for the
 * MortgageChatbot widget. Plain text prompt in, plain text reply out —
 * no multimodal input, no JSON schema, the simplest of the ported functions.
 */
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { GoogleGenerativeAI } from "npm:@google/generative-ai@^0.21.0";

// Same model already verified live (2026-07-29) for the other ported functions.
const CHAT_MODEL = 'gemini-3-flash-preview';

export default {
  fetch: withSupabase({ auth: ["publishable"] }, async (req, _ctx) => {
    try {
      const { prompt } = await req.json();
      if (!prompt) {
        return Response.json({ error: 'prompt is required' }, { status: 400 });
      }

      const apiKey = Deno.env.get('GEMINI_API_KEY');
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: CHAT_MODEL });
      const result = await model.generateContent(prompt);
      const text = result.response.text();

      return Response.json({ text });
    } catch (error) {
      console.error('chatWithMiko error:', error);
      return Response.json({ error: error?.message || 'chat failed' }, { status: 500 });
    }
  }),
};
