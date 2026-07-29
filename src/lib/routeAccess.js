// ────────────────────────────────────────────────────────────────────────────
// Pure decision logic for ProtectedRoute — kept separate from the component
// so it can be unit-tested without rendering/mocking React.
// ────────────────────────────────────────────────────────────────────────────

/**
 * @param {object} params
 * @param {boolean} params.isLoadingAuth
 * @param {boolean} params.isLoadingPublicSettings
 * @param {{type: string}|null} params.authError
 * @param {boolean} params.isAuthenticated
 * @param {{role?: string}|null} params.user
 * @param {boolean} params.requireAdmin
 * @returns {'loading'|'unregistered'|'unauthenticated'|'forbidden'|'allowed'}
 */
export function resolveRouteAccess({ isLoadingAuth, isLoadingPublicSettings, authError, isAuthenticated, user, requireAdmin }) {
  if (isLoadingPublicSettings || isLoadingAuth) return 'loading';
  if (authError?.type === 'user_not_registered') return 'unregistered';
  if (authError) return 'unauthenticated';
  if (!isAuthenticated) return 'unauthenticated';
  if (requireAdmin && user?.role !== 'admin') return 'forbidden';
  return 'allowed';
}
