// ────────────────────────────────────────────────────────────────────────────
// Cache-invalidation heuristics for a cached MortgageCase.score_data object.
// Extracted from UnderwriterDashboard's loadCaseAndAnalyze so a known-bad
// cached score is detected and forces a fresh re-analysis instead of being
// shown to the underwriter.
// ────────────────────────────────────────────────────────────────────────────

/** Detects the old sanitizer bug: id_number in a document starts with 000. */
export function hasThreeZeroBug(cachedScore) {
  return (cachedScore?.documents || []).some(doc =>
    doc.extracted_data?.id_number && String(doc.extracted_data.id_number).replace(/\D/g, '').startsWith('000')
  );
}

/** Detects a mismatch caused by an employee number being read as the real ID. */
export function hasEmployeeIdMismatch(cachedScore) {
  return (cachedScore?.documents || []).some(doc =>
    doc.document_type === 'salary_slip' &&
    doc.overall_status === 'mismatch' &&
    doc.extracted_data?.id_number === null
  );
}

/**
 * Detects a cached score that was penalized by the (now-fixed) Identity Lock
 * guard clause — forcing re-analysis so the corrected pipeline recomputes it.
 */
export function hasCachedIdentityLockPenalty(cachedScore) {
  return (cachedScore?.riskAnalysis?.penalty_list || []).some(
    p => p.label && p.label.includes('Identity Lock')
  );
}

/** True if any known cache-corruption heuristic matches — the cached score should be discarded. */
export function shouldForceReanalysis(cachedScore) {
  return hasThreeZeroBug(cachedScore) || hasEmployeeIdMismatch(cachedScore) || hasCachedIdentityLockPenalty(cachedScore);
}
