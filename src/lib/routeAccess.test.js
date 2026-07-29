import { describe, it, expect } from 'vitest';
import { resolveRouteAccess } from './routeAccess.js';

const base = {
  isLoadingAuth: false,
  isLoadingPublicSettings: false,
  authError: null,
  isAuthenticated: true,
  user: { role: 'admin' },
  requireAdmin: false,
};

describe('resolveRouteAccess', () => {
  it('returns "loading" while auth or public settings are still resolving', () => {
    expect(resolveRouteAccess({ ...base, isLoadingAuth: true })).toBe('loading');
    expect(resolveRouteAccess({ ...base, isLoadingPublicSettings: true })).toBe('loading');
  });

  it('returns "unregistered" when the auth error is specifically user_not_registered', () => {
    expect(resolveRouteAccess({ ...base, authError: { type: 'user_not_registered' } })).toBe('unregistered');
  });

  it('returns "unauthenticated" for any other auth error', () => {
    expect(resolveRouteAccess({ ...base, authError: { type: 'auth_required' } })).toBe('unauthenticated');
    expect(resolveRouteAccess({ ...base, authError: { type: 'unknown' } })).toBe('unauthenticated');
  });

  it('returns "unauthenticated" when there is no auth error but the user is not logged in', () => {
    expect(resolveRouteAccess({ ...base, isAuthenticated: false })).toBe('unauthenticated');
  });

  it('returns "forbidden" when the route requires admin but the user is not an admin', () => {
    expect(resolveRouteAccess({ ...base, requireAdmin: true, user: { role: 'client' } })).toBe('forbidden');
  });

  it('returns "forbidden" when the route requires admin and there is no user object at all', () => {
    expect(resolveRouteAccess({ ...base, requireAdmin: true, user: null })).toBe('forbidden');
  });

  it('returns "allowed" for an admin user on an admin-only route', () => {
    expect(resolveRouteAccess({ ...base, requireAdmin: true, user: { role: 'admin' } })).toBe('allowed');
  });

  it('returns "allowed" for any authenticated user on a non-admin route', () => {
    expect(resolveRouteAccess({ ...base, requireAdmin: false, user: { role: 'client' } })).toBe('allowed');
  });

  it('prioritizes the loading state over everything else', () => {
    expect(resolveRouteAccess({ ...base, isLoadingAuth: true, isAuthenticated: false, authError: { type: 'auth_required' } })).toBe('loading');
  });

  it('prioritizes unregistered over a generic unauthenticated state', () => {
    expect(resolveRouteAccess({ ...base, isAuthenticated: false, authError: { type: 'user_not_registered' } })).toBe('unregistered');
  });
});
