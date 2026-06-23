import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { setActiveClient } from '../store/autocalib-slice';
import {
  isB2bClientId,
  syncWorkspaceClientFromDirectory,
} from '../utils/clientContext';

/**
 * When the B2B roster lists the active ops city, copy its Firestore ``client_id`` into context.
 */
export function useEnsureActiveClientB2bId(): void {
  const dispatch = useAppDispatch();
  const context = useAppSelector((s) => s.autocalib.context);
  const clients = useAppSelector((s) => s.autocalib.directory.clients);

  useEffect(() => {
    if (isB2bClientId(context.clientId)) return;

    const synced = syncWorkspaceClientFromDirectory(context, clients);
    if (synced.clientId && synced.clientId !== context.clientId) {
      dispatch(setActiveClient(synced));
    }
  }, [dispatch, context, clients]);
}
