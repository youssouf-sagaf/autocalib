import { signOut } from 'firebase/auth';
import type { NavigateFunction } from 'react-router-dom';
import { auth } from './firebase';

/** Same sequence as Cocopilot MainLayout handleLogOut: clear storage, Firebase signOut, login route. */
export async function performLogout(navigate: NavigateFunction): Promise<void> {
  localStorage.clear();
  sessionStorage.clear();
  if (auth) {
    await signOut(auth);
  }
  navigate('/login', { replace: true });
}
