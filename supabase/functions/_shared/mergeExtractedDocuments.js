// ────────────────────────────────────────────────────────────────────────────
// Canonical cross-file merge — combines N per-file document-extraction results
// (each already the output of one extractSingleChunk-style call) into a single
// case-level object.
//
// This consolidates what used to be 4 independently-drifting copies:
// base44/functions/extractDocData (mergeExtractions), extractSingleChunk
// (mergeChunks — the richest field set, used as the base here),
// processUnderwriterCase (mergeExtractions), and src/pages/QuickDocCheck.jsx
// (mergeFileData). Each had a genuine improvement the others lacked; all are
// preserved here: extractSingleChunk's additive tracks-array merge (a mortgage
// can have tracks discovered across different files/chunks — a plain
// fill-if-empty rule on the whole `tracks` array would silently drop tracks
// found later), extractDocData's max-taking on payslips_found_count (a later
// chunk finding MORE payslips than an earlier one should win, not just fill
// an empty value), and extractSingleChunk's borrower-name sanitizer (strips
// employment-status noise words like "שבתון" that occasionally get OCR'd as
// part of the name).
// ────────────────────────────────────────────────────────────────────────────

const ARRAY_KEYS = [
  'payslips_borrower1', 'payslips_borrower2', 'loans', 'credit_cards', 'equity_events',
  'income_deposits', 'keren_hishtalmut', 'pension_funds', 'pension_slips', 'bank_statements',
  'payslip_deductions', 'payslip_deduction_alerts', 'actionable_recommendations',
  'all_mortgages', 'cash_flow_summary', 'rental_income', 'reserve_duty_months', 'leave_documents',
  'real_estate_properties', 'mortgage_clearance_reports', 'tax_assessments', 'cpa_letters',
];

const SET_KEYS = [
  'bank_red_flags', 'bdi_red_flags', 'aml_red_flags', 'special_circumstances',
  'undisclosed_loan_indicators', 'detected_case_types',
];

const SCALAR_FILL_KEYS = [
  'property_value', 'requested_loan_amount', 'requested_loan_years', 'property_purpose',
  'alimony_monthly', 'child_support_monthly', 'rent_payment_monthly', 'car_lease_monthly',
];

const BOOLEAN_OR_KEYS = [
  'gambling_detected', 'crypto_detected', 'foreign_transfers_detected', 'wage_garnishment_detected',
];

const isMeaningfulObject = (o) => o && typeof o === 'object' && Object.values(o).some(v =>
  v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0) &&
  !(typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0)
);

// ── Name Sanitizer: strips employment-status/title noise accidentally OCR'd onto a borrower's name ──
// "שבתון דורון קצב" → "דורון קצב". 'עו"ד שרה לוי' → "שרה לוי".
const NAME_NOISE_PREFIXES = [
  'שבתון', 'חל"ת', 'חלת', 'חופשת לידה', 'חל"ד', 'חלד', 'מחלה', 'גמלאי', 'גמלאית',
  'עצמאי', 'עצמאית', 'שכיר', 'שכירה', 'מר', 'גברת', 'גב\'', 'ד"ר', 'דר\'', 'עו"ד', 'עוד',
  'רו"ח', 'רוח', 'פרופ\'', 'מהנדס', 'מר.', 'sabbatical', 'mr', 'mrs', 'dr',
];

export function sanitizeBorrowerName(name) {
  if (!name || typeof name !== 'string') return name;
  let cleaned = name.trim();
  for (let pass = 0; pass < 2; pass++) {
    const firstWord = cleaned.split(/\s+/)[0] || '';
    const isNoise = NAME_NOISE_PREFIXES.some(p => firstWord === p || firstWord.replace(/["'.]/g, '') === p.replace(/["'.]/g, ''));
    if (isNoise) {
      cleaned = cleaned.slice(firstWord.length).trim();
    } else break;
  }
  return cleaned || name.trim();
}

// ── Deterministic correction: within ONE extraction result (a single file), if any borrower
// has real ID-card evidence (id_expiry_date / id_issue_date — fields the model should only
// populate when it actually saw an ID card) and another borrower in the SAME result does not,
// the one without evidence cannot have their own ID document in this file. This directly
// encodes the ת.ז./ספח sharing rule (a ספח has exactly one primary holder — anyone else
// mentioned in it is, by definition, not independently verified) independent of whether the
// model's own id_document_found boolean got it right on this particular run. Cross-chunk
// promotion (a later file correcting an earlier one) is handled separately below — this only
// ever downgrades true→false within a single already-received result, never upgrades.
export function correctUnverifiedBorrowerIds(borrowers) {
  if (!Array.isArray(borrowers) || borrowers.length < 2) return borrowers;
  const hasIdCardEvidence = (b) => !!(b?.id_expiry_date || b?.id_issue_date);
  if (!borrowers.some(hasIdCardEvidence)) return borrowers;
  return borrowers.map(b => (hasIdCardEvidence(b) ? b : { ...b, id_document_found: false }));
}

/**
 * @param {object[]} results - per-file extraction results (each already internally merged)
 * @returns {object|null} one combined case-level object, or null if results is empty
 */
export function mergeExtractedDocuments(results) {
  // Excludes error-shaped results (either extractSingleChunk's { error, _failed: true } or
  // extractDocData's { error, error_code }) so a failed file never contaminates the merge.
  const safe = (results || []).filter(r => r && typeof r === 'object' && !r.error && !r._failed);
  if (!safe.length) return null;
  const merged = { ...(safe[0] || {}) };
  if (Array.isArray(merged.borrowers)) merged.borrowers = correctUnverifiedBorrowerIds(merged.borrowers);

  for (let i = 1; i < safe.length; i++) {
    const r = { ...(safe[i] || {}) };
    if (Array.isArray(r.borrowers)) r.borrowers = correctUnverifiedBorrowerIds(r.borrowers);

    ARRAY_KEYS.forEach(k => { merged[k] = [...(merged[k] || []), ...(r[k] || [])]; });
    SET_KEYS.forEach(k => { merged[k] = [...new Set([...(merged[k] || []), ...(r[k] || [])])]; });

    // borrowers — merged by ID/name key; fields only fill when currently empty (never overwrite
    // a real value with an empty one), except payslips_found_count which takes the max seen.
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
            if (f === 'payslips_found_count') {
              if ((b[f] || 0) > (existing[f] || 0)) existing[f] = b[f];
              return;
            }
            const ev = existing[f];
            if (ev === null || ev === undefined || ev === '') existing[f] = b[f];
          });
        } else { byKey.set(k, b); cur.push(b); }
      });
      merged.borrowers = cur;
    }

    // existing_mortgage — field-by-field fill, except tracks[] which is additive (concat, never
    // replaced) since different files/chunks can each surface tracks the others missed.
    if (isMeaningfulObject(r.existing_mortgage)) {
      const cur = isMeaningfulObject(merged.existing_mortgage) ? { ...merged.existing_mortgage } : {};
      Object.keys(r.existing_mortgage).forEach(f => {
        const cv = cur[f];
        const rv = r.existing_mortgage[f];
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

    SCALAR_FILL_KEYS.forEach(k => { if (!merged[k] && r[k]) merged[k] = r[k]; });
    BOOLEAN_OR_KEYS.forEach(k => { merged[k] = !!merged[k] || !!r[k]; });

    // id_document_found: additive true, but ONLY when corroborated by actual ID-card fields
    // (id_expiry_date / id_issue_date) on that same borrower record — this lets a real ID/ספח
    // chunk correct an earlier chunk that had no opinion (e.g. a payslip, which isn't an ID
    // document and so correctly reports false as its default). Without the corroboration check,
    // a single misclassified chunk anywhere in the file set — one that merely mentions someone's
    // name without ever having seen their ID — could flip a correctly-false "spouse known only
    // from a ספח" into an incorrectly-true "has their own ID document", silently overriding the
    // one chunk that actually got it right. A missing/undefined value must never read as
    // verified — see the same rule applied in normalizeDocData/buildQuickReport/buildUnderwriterReport.
    if (r.borrowers?.length && merged.borrowers?.length) {
      r.borrowers.forEach(rb => {
        const mb = merged.borrowers.find(b => b.id === rb.id || b.name === rb.name);
        const hasIdCardEvidence = !!(rb.id_expiry_date || rb.id_issue_date);
        if (mb && rb.id_document_found === true && hasIdCardEvidence) mb.id_document_found = true;
      });
    }
  }

  if (Array.isArray(merged.borrowers)) {
    merged.borrowers = merged.borrowers.map(b => b && b.name ? { ...b, name: sanitizeBorrowerName(b.name) } : b);
  }

  return merged;
}
