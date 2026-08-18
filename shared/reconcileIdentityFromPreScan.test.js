import { describe, it, expect } from 'vitest';
import { reconcileIdentityFromPreScan } from './reconcileIdentityFromPreScan.js';

describe('reconcileIdentityFromPreScan', () => {
  it('returns extractedData unchanged when there is no pre-scan result', () => {
    const data = { borrowers: [{ name: 'דנה כהן', id: '123456782' }] };
    expect(reconcileIdentityFromPreScan(data, null)).toBe(data);
  });

  it('returns extractedData unchanged when pre-scan found no identities', () => {
    const data = { borrowers: [{ name: 'דנה כהן' }] };
    const result = reconcileIdentityFromPreScan(data, { id_cards_found: [], spouse_mentioned_on_sepach: [] });
    expect(result).toBe(data);
  });

  it('fills a missing id on a matched borrower without touching other fields', () => {
    const data = { borrowers: [{ name: 'דנה כהן', id: null, employer: 'חברת בדיקה' }] };
    const preScan = { id_cards_found: [{ full_name: 'דנה כהן', id_number: '123456782', id_expiry_date: '01.01.2030' }] };
    const result = reconcileIdentityFromPreScan(data, preScan);
    expect(result.borrowers[0].id).toBe('123456782');
    expect(result.borrowers[0].id_expiry_date).toBe('01.01.2030');
    expect(result.borrowers[0].employer).toBe('חברת בדיקה'); // untouched
  });

  it('never overwrites a value extraction already has', () => {
    const data = { borrowers: [{ name: 'דנה כהן', id: '999999999' }] };
    const preScan = { id_cards_found: [{ full_name: 'דנה כהן', id_number: '123456782' }] };
    const result = reconcileIdentityFromPreScan(data, preScan);
    expect(result.borrowers[0].id).toBe('999999999'); // extraction's own value wins
  });

  it('adds a second borrower pre-scan found that extraction missed entirely', () => {
    const data = { borrowers: [{ name: 'דנה כהן', id: '123456782' }] };
    const preScan = {
      id_cards_found: [
        { full_name: 'דנה כהן', id_number: '123456782' },
        { full_name: 'יוסי לוי', id_number: '300000007' },
      ],
    };
    const result = reconcileIdentityFromPreScan(data, preScan);
    expect(result.borrowers).toHaveLength(2);
    expect(result.borrowers[1]).toMatchObject({ name: 'יוסי לוי', id: '300000007', id_document_found: true, _identity_source: 'pre_scan' });
  });

  it('does not add a third borrower beyond the 2-borrower cap', () => {
    const data = { borrowers: [{ name: 'א', id: '111111118' }, { name: 'ב', id: '222222229' }] };
    const preScan = { id_cards_found: [{ full_name: 'ג', id_number: '300000007' }] };
    const result = reconcileIdentityFromPreScan(data, preScan);
    expect(result.borrowers).toHaveLength(2);
  });

  it('adds a spouse_mentioned_on_sepach person with id_document_found=false', () => {
    const data = { borrowers: [{ name: 'יעקב', id: '123456782' }] };
    const preScan = { spouse_mentioned_on_sepach: [{ full_name: 'אורטל ארמה', id_number: '032557852', mentioned_on: 'יעקב' }] };
    const result = reconcileIdentityFromPreScan(data, preScan);
    expect(result.borrowers[1]).toMatchObject({ name: 'אורטל ארמה', id: '032557852', id_document_found: false });
  });

  it('matches an existing borrower by name when extraction has no id yet', () => {
    const data = { borrowers: [{ name: 'דנה כהן' }] };
    const preScan = { id_cards_found: [{ full_name: 'דנה כהן', id_number: '123456782' }] };
    const result = reconcileIdentityFromPreScan(data, preScan);
    expect(result.borrowers).toHaveLength(1);
    expect(result.borrowers[0].id).toBe('123456782');
  });

  it('does not mutate the original extractedData object', () => {
    const data = { borrowers: [{ name: 'דנה כהן', id: null }] };
    const preScan = { id_cards_found: [{ full_name: 'דנה כהן', id_number: '123456782' }] };
    reconcileIdentityFromPreScan(data, preScan);
    expect(data.borrowers[0].id).toBeNull();
  });
});
