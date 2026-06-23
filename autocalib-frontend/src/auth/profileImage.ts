import { getDownloadURL, getStorage, ref } from 'firebase/storage';
import { env } from '../config/env';
import { app } from './firebase';

const DEFAULT_PROFILE_STORAGE_PATH =
  'b2b_specific/images/users/profiles/LOGO_small.png';

export const DEFAULT_PROFILE_AVATAR_URL = '/user.png';

function sanitizeStoragePath(path: string): string {
  return path.replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/');
}

/** Resolve Cocopilot-style profile photo from Firebase Storage (same paths as Cocopilot-FE). */
export async function resolveProfileImageUrl(photoUrl?: string | null): Promise<string> {
  if (!app) return DEFAULT_PROFILE_AVATAR_URL;

  const path = sanitizeStoragePath(photoUrl?.trim() || DEFAULT_PROFILE_STORAGE_PATH);
  if (!path) return DEFAULT_PROFILE_AVATAR_URL;

  try {
    const storage = getStorage(app);
    const objectPath = env.firebaseBucketLink
      ? `${env.firebaseBucketLink}/${path}`
      : path;
    const url = await getDownloadURL(ref(storage, objectPath));
    return url || DEFAULT_PROFILE_AVATAR_URL;
  } catch {
    return DEFAULT_PROFILE_AVATAR_URL;
  }
}
