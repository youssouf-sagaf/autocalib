import { signInWithEmailAndPassword } from 'firebase/auth';
import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation } from 'react-router-dom';
import cocoLogo from '../../assets/logos/coco-logo.png';
import { useAuth } from '../../auth/AuthProvider';
import { auth, firebaseReady } from '../../auth/firebase';
import { syncFirebaseIdToken } from '../../auth/token';
import styles from './LoginPage.module.css';

export function LoginPage() {
  const { t } = useTranslation();
  const { user, profileError, handoffError } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const from =
    (location.state as { from?: string } | null)?.from ?? '/';

  if (user) {
    return <Navigate to={from} replace />;
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!firebaseReady || !auth) {
      setError(t('auth.firebaseNotConfigured'));
      return;
    }

    setSubmitting(true);
    try {
      const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
      localStorage.setItem('user_id', credential.user.uid);
      localStorage.setItem('original_user_id', credential.user.uid);
      await syncFirebaseIdToken(true);
    } catch {
      setError(t('auth.invalidCredentials'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.stack}>
        <img className={styles.logo} src={cocoLogo} alt="Cocoparks" />

        <form className={styles.card} onSubmit={onSubmit}>
          <h1 className={styles.welcome}>{t('auth.loginWelcome')}</h1>
          <p className={styles.subtitle}>{t('auth.loginSubtitle')}</p>

          <label className={styles.field}>
            <span className={styles.label}>{t('auth.email')}</span>
            <input
              className={styles.input}
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>{t('auth.password')}</span>
            <input
              className={styles.input}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>

          {error && <p className={styles.error}>{error}</p>}
          {handoffError === 'handoff_failed' && !error && (
            <p className={styles.error}>{t('auth.handoffFailed')}</p>
          )}
          {profileError && !error && handoffError !== 'handoff_failed' && (
            <p className={styles.error}>{t('auth.profileLoadFailed')}</p>
          )}

          <button className={styles.submit} type="submit" disabled={submitting}>
            {submitting ? t('auth.signingIn') : t('auth.signIn')}
          </button>
        </form>
      </div>
    </div>
  );
}
