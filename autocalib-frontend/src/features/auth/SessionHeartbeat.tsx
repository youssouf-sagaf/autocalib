import { useSessionHeartbeat } from '../../hooks/useSessionHeartbeat';

/** Mount once under AuthGate for staff sessions. */
export function SessionHeartbeat() {
  useSessionHeartbeat();
  return null;
}
