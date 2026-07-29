import { describe, it, expect } from 'vitest';
import { minifyResult, minifyPartialResults } from './minifyExtractedData';

describe('minifyResult', () => {
  it('returns an empty object for non-object input', () => {
    expect(minifyResult(null)).toEqual({});
    expect(minifyResult(undefined)).toEqual({});
    expect(minifyResult('string')).toEqual({});
  });

  it('strips heavy/noisy fields', () => {
    const partial = {
      id_number: '123456789',
      raw_text: 'a huge blob of ocr text',
      page_numbers: [1, 2, 3],
      _extraction_model: 'gemini-pro',
    };
    expect(minifyResult(partial)).toEqual({ id_number: '123456789' });
  });

  it('drops empty strings, empty arrays, and empty objects at any depth', () => {
    const partial = {
      full_name: 'ישראל ישראלי',
      empty_string: '',
      empty_array: [],
      empty_object: {},
      nested: { keep: 'value', drop: '' },
    };
    expect(minifyResult(partial)).toEqual({
      full_name: 'ישראל ישראלי',
      nested: { keep: 'value' },
    });
  });

  it('recursively strips inside arrays and removes emptied-out items', () => {
    const partial = {
      payslips: [
        { month: '01/2024', raw_text: 'blob' },
        { month: '', raw_text: 'blob only' },
      ],
    };
    expect(minifyResult(partial)).toEqual({
      payslips: [{ month: '01/2024' }],
    });
  });

  it('preserves numeric and boolean values, including falsy-but-meaningful ones', () => {
    const partial = { amount: 0, is_verified: false };
    expect(minifyResult(partial)).toEqual({ amount: 0, is_verified: false });
  });
});

describe('minifyPartialResults', () => {
  it('returns an empty array for non-array input', () => {
    expect(minifyPartialResults(null)).toEqual([]);
    expect(minifyPartialResults({})).toEqual([]);
  });

  it('minifies each entry and drops entries that become fully empty', () => {
    const input = [
      { id_number: '123456789', raw_text: 'blob' },
      { raw_text: 'only heavy fields', page_numbers: [1] },
      { full_name: 'דוד כהן' },
    ];
    expect(minifyPartialResults(input)).toEqual([
      { id_number: '123456789' },
      { full_name: 'דוד כהן' },
    ]);
  });
});
