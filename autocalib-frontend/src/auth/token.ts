import { auth } from './firebase';

/** Keep Cocopilot-compatible `localStorage.token` for backend-b2b Bearer auth. */
export async function syncFirebaseIdToken(forceRefresh = false): Promise<string | null> {
  if (!auth?.currentUser) {
    localStorage.removeItem('token');
    return null;
  }
  const token = await auth.currentUser.getIdToken(forceRefresh);
  localStorage.setItem('token', token);
  return token;
}

export function clearStoredAuthToken(): void {
  localStorage.removeItem('token');
}
