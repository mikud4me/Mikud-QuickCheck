import { describe, it, expect } from 'vitest';
import { ADMIN_ONLY_PAGES, isAdminOnlyPage } from './adminOnlyPages.js';

describe('isAdminOnlyPage', () => {
  it('recognizes every page currently in the admin-only list', () => {
    for (const page of ADMIN_ONLY_PAGES) {
      expect(isAdminOnlyPage(page)).toBe(true);
    }
  });

  it('returns false for public/client-facing pages', () => {
    expect(isAdminOnlyPage('Home')).toBe(false);
    expect(isAdminOnlyPage('Calculator')).toBe(false);
    expect(isAdminOnlyPage('ClientPortal')).toBe(false);
    expect(isAdminOnlyPage('ClientWorkflow')).toBe(false);
  });

  it('is case-sensitive (page names are exact route keys, not free text)', () => {
    expect(isAdminOnlyPage('dashboard')).toBe(false);
    expect(isAdminOnlyPage('DASHBOARD')).toBe(false);
  });

  it('returns false for an unknown page name without throwing', () => {
    expect(isAdminOnlyPage('SomeNonexistentPage')).toBe(false);
    expect(isAdminOnlyPage(undefined)).toBe(false);
    expect(isAdminOnlyPage(null)).toBe(false);
  });

  it('contains the specific high-sensitivity pages this list exists to protect', () => {
    // Anchors the list against the exact gap flagged during the security review:
    // admin nav items were hidden client-side but the routes themselves were unguarded.
    expect(ADMIN_ONLY_PAGES).toEqual(expect.arrayContaining([
      'ExecutiveDashboard', 'SecurityVault', 'UnderwriterDashboard', 'UnderwriterPortal',
      'LeadsManagement', 'CreditCenter', 'CreditUnderwriterPortal',
    ]));
  });
});
