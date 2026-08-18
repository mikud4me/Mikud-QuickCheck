// ────────────────────────────────────────────────────────────────────────────
// reconcileIdentityFromPreScan — deterministic post-processing step.
//
// WHY THIS EXISTS: preScanDocuments and extractSingleChunk both extract borrower
// identity (name/ID), but with very different accuracy characteristics.
// preScanDocuments sees ALL uploaded files together in one call, with a schema
// scoped ONLY to document classification + identity — nothing else competing
// for the model's attention. extractSingleChunk instead runs once PER FILE
// (deliberately — see extractSingleChunk's own comments on why: sending all
// files in one request previously crashed the infrastructure), each call
// juggling a much larger schema (payslip line items, deductions, sabbatical
// info, leave documents, etc. — dozens of fields) while seeing only ONE
// document at a time, with no cross-file corroboration. In practice this
// means preScanDocuments is measurably better at correctly identifying BOTH
// borrowers when their ID cards are in different files — extractSingleChunk's
// per-file calls plus the downstream deterministic merge can end up losing or
// only partially capturing the second person.
//
// This function is the fix: once extraction + merge (+ optional LLM
// consolidation) has produced a final `borrowers` array, and IF the user ran
// סרוק מה יש בתיק (pre-scan) first, use pre-scan's identity findings to fill
// gaps in that array. It only ever FILLS empty fields or ADDS a borrower
// pre-scan found that extraction missed entirely — it never overwrites a
// value extraction already has, since extraction's own per-file identity
// data (when present) is richer (payslip cross-references, sabbatical
// evidence, etc.) than pre-scan's classification-only pass.
//
// Matching uses the same id-first-then-name key as mergeExtractedDocuments,
// for consistency with the rest of the extraction pipeline.
// ────────────────────────────────────────────────────────────────────────────

import { sanitizeBorrowerName } from './mergeExtractedDocuments.js';

const normId = (id) => String(id || '').replace(/\D/g, '').padStart(9, '0');
const keyOf = (b) => {
  const id = normId(b?.id || b?.id_number);
  if (id.replace(/^0+/, '').length >= 7) return id;
  return (b?.name || b?.full_name || '').trim();
};

/**
 * @param {object} extractedData - the merged/consolidated extraction result (has .borrowers)
 * @param {object|null} preScanResult - raw preScanDocuments output (has .id_cards_found / .spouse_mentioned_on_sepach)
 * @returns {object} extractedData with .borrowers reconciled (new array, does not mutate input)
 */
export function reconcileIdentityFromPreScan(extractedData, preScanResult) {
  if (!preScanResult) return extractedData;

  const idCards = preScanResult.id_cards_found || [];
  const spouses = preScanResult.spouse_mentioned_on_sepach || [];
  const preScanPeople = [
    ...idCards.map(c => ({ ...c, id_document_found: true })),
    ...spouses.map(s => ({ ...s, id_document_found: false })),
  ];
  if (preScanPeople.length === 0) return extractedData;

  const borrowers = Array.isArray(extractedData.borrowers) ? extractedData.borrowers.map(b => ({ ...b })) : [];
  const byKey = new Map(borrowers.map(b => [keyOf(b), b]));

  for (const person of preScanPeople) {
    const pName = (person.full_name || '').trim();
    const pId = normId(person.id_number);
    if (!pName && pId.replace(/^0+/, '').length < 7) continue;

    const key = pId.replace(/^0+/, '').length >= 7 ? pId : pName;
    const match = byKey.get(key)
      // fall back to a name-only match against an id-keyed entry (extraction may have the ID
      // but pre-scan matched by name, or vice versa) before deciding this is a brand-new person
      || borrowers.find(b => pName && (b.name || '').trim() === pName)
      || (pId.replace(/^0+/, '').length >= 7 ? borrowers.find(b => normId(b.id) === pId) : null);

    if (match) {
      // Fill gaps only — never overwrite extraction's own (richer) values.
      if (!match.id && person.id_number) match.id = person.id_number;
      if (!match.name && pName) match.name = sanitizeBorrowerName(pName);
      if (!match.id_expiry_date && person.id_expiry_date) match.id_expiry_date = person.id_expiry_date;
      if (!match.id_issue_date && person.id_issue_date) match.id_issue_date = person.id_issue_date;
      if (match.id_document_found == null) match.id_document_found = person.id_document_found;
    } else if (borrowers.length < 2) {
      // Extraction missed this person entirely (e.g. their ID card was in a file that, on its
      // own, extractSingleChunk didn't confidently tie to a second borrower). Add them from
      // pre-scan's identity so the report at least surfaces "there is a second borrower" rather
      // than silently dropping them -- normalizeDocData/buildQuickReport's existing
      // missing-documents logic already handles a borrower with identity but no income data.
      const added = {
        name: pName ? sanitizeBorrowerName(pName) : null,
        id: person.id_number || null,
        id_expiry_date: person.id_expiry_date || null,
        id_issue_date: person.id_issue_date || null,
        id_document_found: person.id_document_found,
        _identity_source: 'pre_scan',
      };
      borrowers.push(added);
      byKey.set(key, added);
    }
  }

  return { ...extractedData, borrowers };
}
