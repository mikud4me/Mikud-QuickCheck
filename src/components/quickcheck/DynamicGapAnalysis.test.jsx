import { describe, it, expect } from 'vitest';
import { computeGapItems, computeSummary } from './DynamicGapAnalysis';

describe('computeGapItems', () => {
  it('flags missing ID as critical when no ID number was found anywhere', () => {
    const result = { borrower_info: {} };
    const items = computeGapItems(result, null, '');
    const idItem = items.find(i => i.category === 'זהות');
    expect(idItem.status).toBe('missing');
    expect(idItem.priority).toBe('critical');
  });

  it('marks ID as "partial" when the number was found but no ID document was uploaded', () => {
    const result = {
      borrower_info: { id: '123456789', name: 'ישראל ישראלי' },
      borrower_id_document_found: { b1: false },
    };
    const items = computeGapItems(result, null, '');
    const idItem = items.find(i => i.category === 'זהות');
    expect(idItem.status).toBe('partial');
    expect(idItem.priority).toBeNull();
  });

  it('marks ID as "ok" when both the number and the document are present', () => {
    const result = {
      borrower_info: { id: '123456789', name: 'ישראל ישראלי' },
      borrower_id_document_found: { b1: true },
    };
    const items = computeGapItems(result, null, '');
    const idItem = items.find(i => i.category === 'זהות');
    expect(idItem.status).toBe('ok');
  });

  it('marks the second borrower\'s ID as "partial" (not "ok") when known only from a ספח, never their own document', () => {
    const result = {
      borrower_info: {
        id: '123456789', name: 'פמלה קצב',
        id_2: '032557852', name_2: 'דורון קצב',
      },
      borrower_id_document_found: { b1: true, b2: false },
    };
    const items = computeGapItems(result, null, '');
    const idItems = items.filter(i => i.category === 'זהות');
    const spouseIdItem = idItems.find(i => i.label.includes('דורון קצב'));
    expect(spouseIdItem.status).toBe('partial');
    expect(spouseIdItem.status).not.toBe('ok');
  });

  it('does not treat a missing/undefined borrower_id_document_found as "verified" for either borrower', () => {
    const result = {
      borrower_info: {
        id: '123456789', name: 'פמלה קצב',
        id_2: '032557852', name_2: 'דורון קצב',
      },
      // borrower_id_document_found intentionally omitted — must default to the safe state, not "ok"
    };
    const items = computeGapItems(result, null, '');
    const idItems = items.filter(i => i.category === 'זהות');
    idItems.forEach(item => expect(item.status).not.toBe('ok'));
  });

  it('requires tax reports + CPA letter instead of payslips for self-employed borrowers', () => {
    const result = {
      borrower_info: { employment_type: 'עצמאי', avg_income: 15000 },
    };
    const items = computeGapItems(result, null, '');
    const categories = items.map(i => i.category);
    expect(categories).toContain('הכנסה (עצמאי)');
    expect(categories).not.toContain('הכנסה');
  });

  it('requires a "return to work" letter instead of payslips for a borrower on sabbatical', () => {
    const result = {
      borrower_info: { employment_type: 'שבתון', avg_income: 15000 },
    };
    const items = computeGapItems(result, null, '');
    const item = items.find(i => i.label.includes('מכתב חזרה לעבודה'));
    expect(item).toBeDefined();
    expect(item.status).toBe('ok');
  });

  it('marks payslips "partial" when fewer than 3 months were found', () => {
    const result = {
      borrower_info: { avg_income: 15000 },
      _rawPayslipsCountB1: 2,
    };
    const items = computeGapItems(result, null, '');
    const item = items.find(i => i.label.includes('תלושי שכר'));
    expect(item.status).toBe('partial');
  });

  it('requires an updated mortgage payoff statement for refinance cases, not for purchase cases', () => {
    const refinanceResult = { borrower_info: {}, detected_case_types: ['מחזור משכנתא'] };
    const refinanceItems = computeGapItems(refinanceResult, null, '');
    expect(refinanceItems.some(i => i.category === 'מחזור / יתרת משכנתא')).toBe(true);

    const purchaseResult = { borrower_info: {}, detected_case_types: ['רכישת נכס'] };
    const purchaseItems = computeGapItems(purchaseResult, null, '');
    expect(purchaseItems.some(i => i.category === 'מחזור / יתרת משכנתא')).toBe(false);
  });

  it('does not require liquid-asset evidence for refinance/consolidation cases', () => {
    const refinanceResult = { borrower_info: {}, detected_case_types: ['מחזור משכנתא'] };
    const items = computeGapItems(refinanceResult, null, '');
    expect(items.some(i => i.category === 'חוזקות נוספות')).toBe(false);
  });
});

describe('computeSummary', () => {
  it('scores 100 when every item is ok', () => {
    const items = [{ status: 'ok' }, { status: 'ok' }];
    expect(computeSummary(items)).toEqual({ ok: 2, missing: 0, partial: 0, total: 2, score: 100 });
  });

  it('scores 0 when every item is missing', () => {
    const items = [{ status: 'missing' }, { status: 'missing' }];
    expect(computeSummary(items).score).toBe(0);
  });

  it('weights partial items at half credit', () => {
    // 1 ok + 1 partial (0.5) out of 2 total => 75%
    const items = [{ status: 'ok' }, { status: 'partial' }];
    expect(computeSummary(items)).toEqual({ ok: 1, missing: 0, partial: 1, total: 2, score: 75 });
  });
});
