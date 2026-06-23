import {
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { createUserSession, fetchUserProfile } from './b2bUser';
import { auth } from './firebase';
import { performLogout } from './logout';
import { clearStoredAuthToken, syncFirebaseIdToken } from './token';
import type { UserProfile } from './types';

type AuthUser = {
  uid: string;
  email: string;
  displayName: string;
};

type AuthContextValue = {
  user: AuthUser | null;
  /** Active Cocopilot profile (may differ under impersonation). */
  activeProfile: UserProfile | null;
  /** Real signed-in user — used for staff gate and session tracking. */
  originalProfile: UserProfile | null;
  isStaff: boolean;
  profileLoading: boolean;
  profileError: string | null;
  sessionId: string | null;
  setSessionId: (id: string | null) => void;
  loading: boolean;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function toAuthUser(user: User): AuthUser {
  const email = user.email ?? '';
  const fallbackName = email.split('@')[0] ?? 'User';
  return {
    uid: user.uid,
    email,
    displayName: user.displayName?.trim() || fallbackName,
  };
}

async function loadProfiles(firebaseUid: string): Promise<{
  activeProfile: UserProfile;
  originalProfile: UserProfile;
}> {
  const originalUid =
    localStorage.getItem('original_user_id')?.trim() || firebaseUid;

  const originalProfile = await fetchUserProfile(originalUid);
  const activeProfile =
    originalUid === firebaseUid
      ? originalProfile
      : await fetchUserProfile(firebaseUid);

  return { activeProfile, originalProfile };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [activeProfile, setActiveProfile] = useState<UserProfile | null>(null);
  const [originalProfile, setOriginalProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const isStaff = originalProfile?.is_staff === true;

  const bootstrapProfile = useCallback(async (firebaseUser: User) => {
    setProfileLoading(true);
    setProfileError(null);
    setActiveProfile(null);
    setOriginalProfile(null);
    setSessionId(null);

    try {
      await syncFirebaseIdToken();
      const { activeProfile: active, originalProfile: original } = await loadProfiles(
        firebaseUser.uid,
      );
      setActiveProfile(active);
      setOriginalProfile(original);

      if (!original.is_staff) {
        return;
      }

      const session = await createUserSession({
        userId: original.user_id,
        clientId: active.client,
        userEmail: original.email,
        userDisplayName: original.display_name,
        clientDisplayName: active.client_display_name,
        sendSlackNotification: false,
      });
      setSessionId(session.id);
    } catch {
      setProfileError('profile_load_failed');
      clearStoredAuthToken();
    } finally {
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!auth) {
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser) {
        localStorage.setItem('user_id', firebaseUser.uid);
        if (!localStorage.getItem('original_user_id')) {
          localStorage.setItem('original_user_id', firebaseUser.uid);
        }
        setUser(toAuthUser(firebaseUser));
        void bootstrapProfile(firebaseUser);
      } else {
        localStorage.removeItem('user_id');
        localStorage.removeItem('original_user_id');
        clearStoredAuthToken();
        setUser(null);
        setActiveProfile(null);
        setOriginalProfile(null);
        setSessionId(null);
        setProfileError(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [bootstrapProfile]);

  const logout = useCallback(async () => {
    setSessionId(null);
    setActiveProfile(null);
    setOriginalProfile(null);
    await performLogout(navigate);
    setUser(null);
  }, [navigate]);

  const value = useMemo(
    () => ({
      user,
      activeProfile,
      originalProfile,
      isStaff,
      profileLoading,
      profileError,
      sessionId,
      setSessionId,
      loading,
      logout,
    }),
    [
      user,
      activeProfile,
      originalProfile,
      isStaff,
      profileLoading,
      profileError,
      sessionId,
      loading,
      logout,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
