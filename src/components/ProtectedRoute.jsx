import { useAuth } from '@/lib/AuthContext';
import { resolveRouteAccess } from '@/lib/routeAccess';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';

const LoadingFallback = () => (
  <div className="fixed inset-0 flex items-center justify-center">
    <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
  </div>
);

const AccessDenied = () => (
  <div className="fixed inset-0 flex flex-col items-center justify-center gap-3 text-center px-6" dir="rtl">
    <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center text-3xl">
      🔒
    </div>
    <h1 className="text-xl font-bold text-slate-900">אין לך הרשאה לצפות בעמוד זה</h1>
    <p className="text-slate-500 text-sm max-w-sm">
      עמוד זה מיועד לצוות מיקוד משכנתאות בלבד. אם לדעתך מדובר בטעות, פנה למנהל המערכת.
    </p>
  </div>
);

/**
 * Wraps a page element and only renders it once the user satisfies the
 * required access level. Defense-in-depth alongside server-side checks —
 * see [[project-base44-platform]] memory note on why this alone isn't
 * sufficient.
 */
export default function ProtectedRoute({ children, requireAdmin = false }) {
  const { user, isAuthenticated, isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

  const access = resolveRouteAccess({
    isLoadingAuth,
    isLoadingPublicSettings,
    authError,
    isAuthenticated,
    user,
    requireAdmin,
  });

  switch (access) {
    case 'loading':
      return <LoadingFallback />;
    case 'unregistered':
      return <UserNotRegisteredError />;
    case 'unauthenticated':
      navigateToLogin();
      return null;
    case 'forbidden':
      return <AccessDenied />;
    default:
      return children;
  }
}
