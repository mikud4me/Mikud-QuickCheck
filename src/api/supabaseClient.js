import { createClient } from '@supabase/supabase-js';

// Replaces base44Client.js. Uses the publishable key only — safe to expose in
// the frontend bundle. Every Edge Function call and table access from this
// app is anonymous by design (no user login), matching the original app's
// `requiresAuth: false` Base44 client config.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
);

// ── Shared upload helper (replaces base44.integrations.Core.UploadFile) ──
// Uploads to the private `documents` bucket, then mints a 1-hour signed URL —
// required because extractSingleChunk/analyzeRefinanceDocument fetch() the file
// server-side and the bucket has no public read policy, only anon insert+select.
export async function uploadFileToStorage(file) {
  // Deliberately drop the original filename from the storage path — a Hebrew
  // (or any non-ASCII/special-character) filename embedded in the object key
  // was breaking downstream signed-URL construction/fetching with a 400 Bad
  // Request (found via live testing 2026-07-29). A UUID + the file's own
  // extension is always ASCII-safe and carries everything the backend
  // functions need (they only ever inspect the extension, never the name).
  const extMatch = file.name.match(/\.[a-zA-Z0-9]+$/);
  const ext = extMatch ? extMatch[0] : '';
  const path = `uploads/${crypto.randomUUID()}${ext}`;
  const { error: uploadError } = await supabase.storage.from('documents').upload(path, file);
  if (uploadError) throw uploadError;
  const { data: signedData, error: signedError } = await supabase.storage
    .from('documents')
    .createSignedUrl(path, 3600);
  if (signedError) throw signedError;
  return signedData.signedUrl;
}

// ── Shared error-shape helper for supabase.functions.invoke() ──
// The old Base44 SDK behaved like axios: a rejected call carried the server's
// JSON error body at err.response.data. supabase-js is NOT axios-shaped — invoke()
// resolves to { data: null, error } on any non-2xx response, where `error` is a
// FunctionsHttpError (or FunctionsRelayError/FunctionsFetchError for
// relay/network failures) and the JSON body our Edge Functions actually wrote
// ({ error, error_code, ... }) is only reachable via error.context.json().
// This recovers that body so call sites can keep checking `.error`/`.error_code`
// the same way the original code did.
export async function parseInvokeError(error) {
  if (error?.context?.json) {
    try {
      return await error.context.json();
    } catch {
      // Body wasn't JSON — a true network/relay failure, not a structured error response.
    }
  }
  return null;
}
