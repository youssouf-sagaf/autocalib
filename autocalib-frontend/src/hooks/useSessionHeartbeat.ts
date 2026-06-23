import { useCallback, useEffect, useRef } from 'react';
import { updateUserSessionActivity } from '../auth/b2bUser';
import { useAuth } from '../auth/AuthProvider';

const HEARTBEAT_MS = 2 * 60 * 1000;

/** Cocopilot MainLayout parity — keep B2B user session alive while tab is visible. */
export function useSessionHeartbeat(): void {
  const { sessionId, originalProfile, activeProfile, setSessionId } = useAuth();
  const intervalRef = useRef<number | null>(null);

  const sendHeartbeat = useCallback(async () => {
    if (!sessionId || document.visibilityState !== 'visible') return;
    try {
      const result = await updateUserSessionActivity({
        sessionId,
        userEmail: originalProfile?.email,
        userDisplayName: originalProfile?.display_name,
        clientDisplayName: activeProfile?.client_display_name,
        sendSlackNotification: true,
      });
      if (result?.new_session_id) {
        setSessionId(result.new_session_id);
      }
    } catch {
      // Non-blocking — session tracking must not break the operator UI.
    }
  }, [sessionId, originalProfile, activeProfile, setSessionId]);

  useEffect(() => {
    if (!sessionId) return;

    if (document.visibilityState === 'visible') {
      void sendHeartbeat();
    }

    intervalRef.current = window.setInterval(() => {
      void sendHeartbeat();
    }, HEARTBEAT_MS);

    return () => {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [sessionId, sendHeartbeat]);
}
