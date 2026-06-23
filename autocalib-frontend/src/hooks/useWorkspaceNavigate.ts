import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppSelector } from '../store/hooks';
import { buildWorkspaceHref } from '../utils/workspaceNavigation';

/** Navigate between absmap / calib / pairing while preserving active client and device in the URL. */
export function useWorkspaceNavigate() {
  const navigate = useNavigate();
  const context = useAppSelector((s) => s.autocalib.context);

  return useCallback(
    (path: string) => {
      navigate(buildWorkspaceHref(path, context));
    },
    [navigate, context.clientId, context.clientName, context.deviceId],
  );
}
