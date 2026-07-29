// ────────────────────────────────────────────────────────────────────────────
// Runtime-agnostic business logic — zero dependencies on Base44, Deno, or
// React. Imported today by the Base44 Deno functions (via relative path);
// intended to survive a future migration off Base44 unchanged, since any
// backend can import a plain JS module like this one.
// ────────────────────────────────────────────────────────────────────────────

/**
 * isValidIsraeliId — Israeli ID checksum validator (Luhn-like).
 * Returns true only for well-formed 9-digit IDs that pass the checksum.
 * Zero-padded employee-number look-alikes (000001420, 000000045) always fail
 * the THREE-ZERO rule below, regardless of checksum.
 *
 * Single source of truth: previously duplicated verbatim in
 * base44/functions/buildQuickReport/entry.ts and
 * base44/functions/buildUnderwriterReport/entry.ts — both now import this.
 * @param {string} id
 * @returns {boolean}
 */
export function isValidIsraeliId(id) {
  const clean = (id || '').replace(/[-\s]/g, '').replace(/\D/g, '');
  if (clean.length !== 9) return false;
  // THREE-ZERO RULE: a zero-padded employee number (000001420, 000000045) is not an ID.
  if (clean.startsWith('000')) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let d = parseInt(clean[i]) * ((i % 2) + 1);
    if (d > 9) d -= 9;
    sum += d;
  }
  return sum % 10 === 0;
}
