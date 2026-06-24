import { signInWithCustomToken } from 'firebase/auth';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { exchangeAuthHandoff } from '../api/auth-handoff-api';
import { auth, firebaseReady } from '../auth/firebase';
import { syncFirebaseIdToken } from '../auth/token';
import { createLogger } from '../utils/logger';

const log = createLogger('authHandoff');

export type AuthHandoffError = 'handoff_failed' | null;

/**
 * Consume `?handoff=` from Cocopilot and sign in via Firebase custom token.
 */
export function useAuthHandoff(): { handoffLoading: boolean; handoffError: AuthHandoffError } {
  const location = useLocation();
  const navigate = useNavigate();
  const appliedRef = useRef<string | null>(null);
  const [handoffLoading, setHandoffLoading] = useState(false);
  const [handoffError, setHandoffError] = useState<AuthHandoffError>(null);

  const handoffCode = new URLSearchParams(location.search).get('handoff')?.trim() ?? '';

  useEffect(() => {
    if (!handoffCode || !firebaseReady || !auth) {
      return;
    }

    if (auth.currentUser) {
      const next = new URLSearchParams(location.search);
      if (!next.has('handoff')) return;
      next.delete('handoff');
      const search = next.toString();
      navigate(`${location.pathname}${search ? `?${search}` : ''}`, { replace: true });
      return;
    }

    const searchKey = `${location.pathname}${location.search}`;
    if (appliedRef.current === searchKey) {
      return;
    }

    let cancelled = false;
    setHandoffLoading(true);
    setHandoffError(null);

    void (async () => {
      try {
        log.info('Exchanging Cocopilot handoff code');
        const customToken = await exchangeAuthHandoff(handoffCode);
        await signInWithCustomToken(auth!, customToken);
        await syncFirebaseIdToken(true);

        const next = new URLSearchParams(location.search);
        next.delete('handoff');
        const search = next.toString();
        const target = `${location.pathname}${search ? `?${search}` : ''}`;
        navigate(target, { replace: true });
        appliedRef.current = target;
        log.info('Handoff sign-in succeeded');
      } catch (error) {
        if (!cancelled) {
          log.warn('Handoff sign-in failed', error);
          setHandoffError('handoff_failed');
          appliedRef.current = searchKey;
        }
      } finally {
        if (!cancelled) {
          setHandoffLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [handoffCode, location.pathname, location.search, navigate]);

  return { handoffLoading, handoffError };
}
