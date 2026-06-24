import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { AccessDeniedPage } from './AccessDeniedPage';
import { LoginPage } from '../login/LoginPage';
import { SessionHeartbeat } from './SessionHeartbeat';

function AuthLoading() {
  const { t } = useTranslation();
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: 'var(--color-text-muted)',
      }}
    >
      {t('common.loading')}
    </div>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { user, loading, profileLoading, profileError, isStaff, originalProfile, handoffLoading } = useAuth();
  const location = useLocation();

  if (loading || handoffLoading || (user && profileLoading)) {
    return <AuthLoading />;
  }

  if (!user) {
    if (location.pathname === '/login') {
      return <LoginPage />;
    }
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (profileError) {
    if (location.pathname === '/login') {
      return <LoginPage />;
    }
    return <Navigate to="/login" replace />;
  }

  if (originalProfile && !isStaff) {
    return <AccessDeniedPage />;
  }

  if (location.pathname === '/login') {
    return <Navigate to="/" replace />;
  }

  return (
    <>
      <SessionHeartbeat />
      {children}
    </>
  );
}
