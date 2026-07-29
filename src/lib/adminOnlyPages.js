// ────────────────────────────────────────────────────────────────────────────
// Single source of truth for which page names require an admin-role user.
// Used by both Layout.jsx (to hide nav links from non-admins) and App.jsx
// (to actually enforce the restriction via ProtectedRoute) — keeping one
// list here avoids the nav and the route guard drifting out of sync.
// ────────────────────────────────────────────────────────────────────────────
export const ADMIN_ONLY_PAGES = [
  // Linked in the nav today (Layout.jsx) with adminOnly: true
  'Dashboard',
  'BankSubmissions',
  'BankOffers',
  'BankAnalytics',
  'LeadsManagement',
  'UnderwriterDashboard',
  'UnderwriterPortal',
  'CreditCenter',
  'ExecutiveDashboard',
  'SmartCRMQueue',
  'SecurityVault',
  // Internal/staff-only tools reachable by direct URL but not linked in the nav
  'DocumentsAuditDashboard',
  'BankAuthorizationsManagement',
  'ImportLead',
  'CreditUnderwriterPortal',
  'ClientCreditDashboard',
  'AdminChatPage',
  'ValidationDashboard',
  'ReportsAndCompliance',
  'ConversionReports',
  'SherlockSandbox',
];

export function isAdminOnlyPage(pageName) {
  return ADMIN_ONLY_PAGES.includes(pageName);
}
