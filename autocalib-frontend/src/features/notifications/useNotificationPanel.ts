import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import {
  markAllSessionNotificationsRead,
  markSessionNotificationRead,
} from '../../store/autocalib-slice';

export function useNotificationPanel() {
  const dispatch = useAppDispatch();
  const notifications = useAppSelector((s) => s.autocalib.ui.sessionNotifications);
  const [open, setOpen] = useState(false);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications],
  );

  const toggle = useCallback(() => {
    setOpen((prev) => !prev);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  const markRead = useCallback(
    (id: string) => {
      dispatch(markSessionNotificationRead(id));
    },
    [dispatch],
  );

  const markAllRead = useCallback(() => {
    dispatch(markAllSessionNotificationsRead());
  }, [dispatch]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  return {
    open,
    toggle,
    close,
    notifications,
    unreadCount,
    markRead,
    markAllRead,
  };
}
