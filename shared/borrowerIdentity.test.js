import { describe, it, expect } from 'vitest';
import { verifyBorrowerIdentity } from './borrowerIdentity.js';

const rawData = (overrides = {}) => ({
  borrowers: [{ id: '123456782' }],
  payslips_borrower1: [],
  payslips_borrower2: [],
  payslips: [],
  ...overrides,
});

describe('verifyBorrowerIdentity', () => {
  it('flags a minor (age < 18) as a critical identity error and returns early', () => {
    const b = { age: 12, id: '123456782' };
    const { risks, missingDocs } = verifyBorrowerIdentity(b, 'לווה 1', rawData());
    expect(risks).toHaveLength(1);
    expect(risks[0].severity).toBe('critical');
    expect(risks[0].category).toContain('קטין');
    expect(missingDocs).toHaveLength(1);
  });

  it('flags a missing physical ID document when id_document_found is false', () => {
    const b = { id: '123456782', id_document_found: false };
    const { risks, missingDocs } = verifyBorrowerIdentity(b, 'לווה 1', rawData());
    expect(risks.some(r => r.category.includes('תעודת זהות חסרה'))).toBe(true);
    expect(missingDocs.some(d => d.includes('לווה 1'))).toBe(true);
  });

  it('flags missing/incomplete ID number as a required-field gap', () => {
    const b = { id: '123' }; // too short
    const { risks } = verifyBorrowerIdentity(b, 'לווה 1', rawData());
    expect(risks.some(r => r.category.includes('נתוני ת.ז. חלקיים'))).toBe(true);
  });

  it('does not flag missing fields when the physical document itself is already flagged missing (avoids double-counting)', () => {
    const b = { id: '123', id_document_found: false };
    const { risks } = verifyBorrowerIdentity(b, 'לווה 1', rawData());
    expect(risks.some(r => r.category.includes('נתוני ת.ז. חלקיים'))).toBe(false);
  });

  it('flags an expired ID document as a critical block', () => {
    const b = { id: '123456782', id_expiry_date: '01/01/2020' };
    const { risks, missingDocs } = verifyBorrowerIdentity(b, 'לווה 1', rawData());
    expect(risks.some(r => r.category.includes('פגת תוקף'))).toBe(true);
    expect(missingDocs.some(d => d.includes('בתוקף'))).toBe(true);
  });

  it('warns (does not block) when the ID expires within 6 months', () => {
    const soon = new Date();
    soon.setMonth(soon.getMonth() + 2);
    const dateStr = `${String(soon.getDate()).padStart(2, '0')}/${String(soon.getMonth() + 1).padStart(2, '0')}/${soon.getFullYear()}`;
    const b = { id: '123456782', id_expiry_date: dateStr };
    const { risks, missingDocs } = verifyBorrowerIdentity(b, 'לווה 1', rawData());
    expect(risks.some(r => r.category.includes('תוקף מסתיים בקרוב'))).toBe(true);
    expect(missingDocs).toHaveLength(0);
  });

  it('does not warn about an ID with plenty of validity left', () => {
    const farFuture = new Date();
    farFuture.setFullYear(farFuture.getFullYear() + 5);
    const dateStr = `${String(farFuture.getDate()).padStart(2, '0')}/${String(farFuture.getMonth() + 1).padStart(2, '0')}/${farFuture.getFullYear()}`;
    const b = { id: '123456782', id_expiry_date: dateStr };
    const { risks } = verifyBorrowerIdentity(b, 'לווה 1', rawData());
    expect(risks).toHaveLength(0);
  });

  it('flags a cross-match mismatch when the ID does not appear in any payslip', () => {
    // 111111118 is a different, also-checksum-valid ID, so it survives the isValidIsraeliId
    // filter inside verifyBorrowerIdentity and is genuinely available to mismatch against.
    const b = { id: '123456782' };
    const data = rawData({ payslips_borrower1: [{ id_number: '111111118' }] });
    const { risks } = verifyBorrowerIdentity(b, 'לווה 1', data);
    expect(risks.some(r => r.category.includes('אי-התאמת ת.ז.'))).toBe(true);
  });

  it('does not flag a cross-match mismatch when the ID matches a payslip', () => {
    const b = { id: '123456782' };
    const data = rawData({ payslips_borrower1: [{ id_number: '123456782' }] });
    const { risks } = verifyBorrowerIdentity(b, 'לווה 1', data);
    expect(risks.some(r => r.category.includes('אי-התאמת ת.ז.'))).toBe(false);
  });

  it('returns no risks and no missing docs for a fully clean, complete borrower', () => {
    const b = { id: '123456782' };
    const { risks, missingDocs } = verifyBorrowerIdentity(b, 'לווה 1', rawData());
    expect(risks).toHaveLength(0);
    expect(missingDocs).toHaveLength(0);
  });
});
