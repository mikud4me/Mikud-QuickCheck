import { describe, it, expect } from 'vitest';
import { mergeExtractedDocuments, sanitizeBorrowerName, correctUnverifiedBorrowerIds } from './mergeExtractedDocuments.js';

describe('mergeExtractedDocuments', () => {
  it('returns null for an empty or all-invalid input', () => {
    expect(mergeExtractedDocuments([])).toBeNull();
    expect(mergeExtractedDocuments([null, undefined, 'x'])).toBeNull();
  });

  it('excludes error-shaped results from either extraction convention, keeping the successful ones', () => {
    const good = { loans: [{ description: 'real loan' }] };
    const failedA = { error: 'boom', _failed: true }; // extractSingleChunk's failure shape
    const failedB = { error: 'boom', error_code: 'EXTRACTION_FAILED' }; // extractDocData's failure shape
    const merged = mergeExtractedDocuments([good, failedA, failedB]);
    expect(merged.loans).toEqual([{ description: 'real loan' }]);
  });

  it('returns null when every result is error-shaped', () => {
    expect(mergeExtractedDocuments([{ error: 'x', _failed: true }])).toBeNull();
  });

  it('concatenates array fields across files instead of overwriting them', () => {
    const a = { loans: [{ description: 'loan-a' }] };
    const b = { loans: [{ description: 'loan-b' }] };
    const merged = mergeExtractedDocuments([a, b]);
    expect(merged.loans).toEqual([{ description: 'loan-a' }, { description: 'loan-b' }]);
  });

  it('deduplicates set-style fields', () => {
    const a = { detected_case_types: ['רכישת נכס חדש'] };
    const b = { detected_case_types: ['רכישת נכס חדש', 'מחזור משכנתא'] };
    const merged = mergeExtractedDocuments([a, b]);
    expect(merged.detected_case_types).toEqual(['רכישת נכס חדש', 'מחזור משכנתא']);
  });

  it('additively concatenates existing_mortgage.tracks instead of replacing the array', () => {
    const a = { existing_mortgage: { bank_name: 'הפועלים', tracks: [{ track_type: 'פריים' }] } };
    const b = { existing_mortgage: { tracks: [{ track_type: 'קבועה צמודה' }] } };
    const merged = mergeExtractedDocuments([a, b]);
    expect(merged.existing_mortgage.tracks).toEqual([{ track_type: 'פריים' }, { track_type: 'קבועה צמודה' }]);
    expect(merged.existing_mortgage.bank_name).toBe('הפועלים');
  });

  it('fills other existing_mortgage fields only when currently empty, never overwriting a real value', () => {
    const a = { existing_mortgage: { remaining_balance: 500000 } };
    const b = { existing_mortgage: { remaining_balance: 999999 } };
    const merged = mergeExtractedDocuments([a, b]);
    expect(merged.existing_mortgage.remaining_balance).toBe(500000);
  });

  it('merges borrowers by ID, filling missing fields without overwriting existing ones', () => {
    const a = { borrowers: [{ id: '123456782', name: 'ישראל ישראלי', employer: null }] };
    const b = { borrowers: [{ id: '123456782', name: 'ישראל ישראלי', employer: 'עיריית תל אביב' }] };
    const merged = mergeExtractedDocuments([a, b]);
    expect(merged.borrowers).toHaveLength(1);
    expect(merged.borrowers[0].employer).toBe('עיריית תל אביב');
  });

  it('takes the maximum payslips_found_count across chunks rather than the first value', () => {
    const a = { borrowers: [{ id: '123456782', payslips_found_count: 1 }] };
    const b = { borrowers: [{ id: '123456782', payslips_found_count: 3 }] };
    const c = { borrowers: [{ id: '123456782', payslips_found_count: 2 }] };
    const merged = mergeExtractedDocuments([a, b, c]);
    expect(merged.borrowers[0].payslips_found_count).toBe(3);
  });

  it('keeps id_document_found=true once set, even if a later chunk reports false', () => {
    const a = { borrowers: [{ id: '123456782', name: 'א', id_document_found: true }] };
    const b = { borrowers: [{ id: '123456782', name: 'א', id_document_found: false }] };
    const merged = mergeExtractedDocuments([a, b]);
    expect(merged.borrowers[0].id_document_found).toBe(true);
  });

  it('promotes id_document_found to true from a later chunk when corroborated by real ID-card fields', () => {
    // chunk 1: a payslip — not an ID document, correctly reports false with no ID-card evidence
    const a = { borrowers: [{ id: '123456782', name: 'יעקב', id_document_found: false }] };
    // chunk 2: the actual ID card — true, backed by id_expiry_date/id_issue_date
    const b = { borrowers: [{ id: '123456782', name: 'יעקב', id_document_found: true, id_expiry_date: '01/01/2030' }] };
    const merged = mergeExtractedDocuments([a, b]);
    expect(merged.borrowers[0].id_document_found).toBe(true);
  });

  it('does not let an uncorroborated true from an unrelated chunk override a correctly-false spouse-on-ספח determination', () => {
    // chunk 1: the primary holder's ת.ז./ספח — correctly flags the spouse as false (known via
    // ספח, no ID document of their own uploaded)
    const a = {
      borrowers: [
        { id: '123456782', name: 'פמלה קצב', id_document_found: true, id_expiry_date: '01/01/2030' },
        { id: '032557852', name: 'דורון קצב', id_document_found: false },
      ],
    };
    // chunk 2: some unrelated document (e.g. a bank statement) merely mentions the spouse's name
    // and misclassifies id_document_found=true, with no actual ID-card fields to back it up
    const b = { borrowers: [{ id: '032557852', name: 'דורון קצב', id_document_found: true }] };
    const merged = mergeExtractedDocuments([a, b]);
    const spouse = merged.borrowers.find(x => x.name === 'דורון קצב');
    expect(spouse.id_document_found).toBe(false);
  });

  it('does not merge two borrowers with different IDs into one', () => {
    const a = { borrowers: [{ id: '123456782', name: 'לווה א' }] };
    const b = { borrowers: [{ id: '111111118', name: 'לווה ב' }] };
    const merged = mergeExtractedDocuments([a, b]);
    expect(merged.borrowers).toHaveLength(2);
  });

  it('fills business_data/tabu_data/disability_info only when currently empty', () => {
    const a = { business_data: { cpa_monthly_income: 15000 } };
    const b = { business_data: { cpa_monthly_income: 99999 } };
    const merged = mergeExtractedDocuments([a, b]);
    expect(merged.business_data.cpa_monthly_income).toBe(15000);
  });

  it('OR-accumulates boolean red-flag fields — true is never overwritten back to false', () => {
    const a = { gambling_detected: true };
    const b = { gambling_detected: false };
    const merged = mergeExtractedDocuments([a, b]);
    expect(merged.gambling_detected).toBe(true);
  });

  it('fills scalar fields only when currently empty', () => {
    const a = { property_value: 1500000 };
    const b = { property_value: 999 };
    const merged = mergeExtractedDocuments([a, b]);
    expect(merged.property_value).toBe(1500000);
  });

  it('sanitizes an employment-status noise prefix off a borrower name in the final result', () => {
    const a = { borrowers: [{ id: '123456782', name: 'שבתון דורון קצב' }] };
    const merged = mergeExtractedDocuments([a]);
    expect(merged.borrowers[0].name).toBe('דורון קצב');
  });
});

describe('sanitizeBorrowerName', () => {
  it('strips a single noise prefix', () => {
    expect(sanitizeBorrowerName('שבתון דורון קצב')).toBe('דורון קצב');
  });

  it('strips a quoted-title prefix like עו"ד', () => {
    expect(sanitizeBorrowerName('עו"ד שרה לוי')).toBe('שרה לוי');
  });

  it('leaves a clean name untouched', () => {
    expect(sanitizeBorrowerName('ישראל ישראלי')).toBe('ישראל ישראלי');
  });

  it('returns non-string input unchanged', () => {
    expect(sanitizeBorrowerName(null)).toBeNull();
    expect(sanitizeBorrowerName(undefined)).toBeUndefined();
  });
});

describe('correctUnverifiedBorrowerIds', () => {
  it('forces id_document_found=false for a borrower with no ID-card evidence when another borrower in the same result has it — even if the model said true for both', () => {
    const borrowers = [
      { name: 'פמלה קצב', id: '123456782', id_document_found: true, id_expiry_date: '01/01/2030' },
      { name: 'דורון קצב', id: '032557852', id_document_found: true }, // model got this wrong — no evidence
    ];
    const corrected = correctUnverifiedBorrowerIds(borrowers);
    expect(corrected[0].id_document_found).toBe(true);
    expect(corrected[1].id_document_found).toBe(false);
  });

  it('leaves borrowers unchanged when neither has ID-card evidence (e.g. a payslip-only chunk)', () => {
    const borrowers = [
      { name: 'א', id: '1', id_document_found: false },
      { name: 'ב', id: '2', id_document_found: false },
    ];
    const corrected = correctUnverifiedBorrowerIds(borrowers);
    expect(corrected).toEqual(borrowers);
  });

  it('leaves borrowers unchanged when both have ID-card evidence (two separate ID cards uploaded together)', () => {
    const borrowers = [
      { name: 'א', id: '1', id_document_found: true, id_expiry_date: '01/01/2030' },
      { name: 'ב', id: '2', id_document_found: true, id_issue_date: '01/01/2020' },
    ];
    const corrected = correctUnverifiedBorrowerIds(borrowers);
    expect(corrected[0].id_document_found).toBe(true);
    expect(corrected[1].id_document_found).toBe(true);
  });

  it('does nothing for a single borrower or non-array input', () => {
    expect(correctUnverifiedBorrowerIds([{ id_document_found: true }])).toEqual([{ id_document_found: true }]);
    expect(correctUnverifiedBorrowerIds(null)).toBeNull();
    expect(correctUnverifiedBorrowerIds(undefined)).toBeUndefined();
  });

  it('mergeExtractedDocuments applies the correction within a single file result (no merge needed to trigger it)', () => {
    // this is the exact reported scenario: ONE uploaded file (wife\'s ID + ספח mentioning
    // the husband) produces both borrowers in a single extraction result — the bug can
    // happen even with only one file, no cross-chunk merge involved at all.
    const singleFileResult = {
      borrowers: [
        { name: 'פמלה קצב', id: '123456782', id_document_found: true, id_expiry_date: '01/01/2030' },
        { name: 'דורון קצב', id: '032557852', id_document_found: true },
      ],
    };
    const merged = mergeExtractedDocuments([singleFileResult]);
    const spouse = merged.borrowers.find(b => b.name === 'דורון קצב');
    expect(spouse.id_document_found).toBe(false);
  });
});
