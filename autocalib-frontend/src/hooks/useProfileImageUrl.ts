import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import {
  DEFAULT_PROFILE_AVATAR_URL,
  resolveProfileImageUrl,
} from '../auth/profileImage';

export function useProfileImageUrl(): string {
  const { activeProfile } = useAuth();
  const [url, setUrl] = useState(DEFAULT_PROFILE_AVATAR_URL);

  useEffect(() => {
    let cancelled = false;
    void resolveProfileImageUrl(activeProfile?.photo_url).then((resolved) => {
      if (!cancelled) setUrl(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [activeProfile?.photo_url, activeProfile?.user_id]);

  return url;
}
