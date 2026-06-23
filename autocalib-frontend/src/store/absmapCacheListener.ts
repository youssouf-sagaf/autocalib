import { createListenerMiddleware, isAnyOf } from '@reduxjs/toolkit';
import type { JobResult } from '../types';
import type { RootState } from './store';
import { fetchJobResult } from './autocalib-slice';
import { saveAbsmapJobId } from '../utils/absmapLocalCache';

/**
 * Persist the last successfully loaded absmap job id so `/absmap` can refetch
 * GeoJSON after a reload (redux is otherwise ephemeral).
 */
export const absmapCacheListener = createListenerMiddleware();

absmapCacheListener.startListening({
  matcher: isAnyOf(fetchJobResult.fulfilled),
  effect: (action, listenerApi) => {
    const payload = action.payload as JobResult;
    const jobId = payload.job_id;
    const { clientName, deviceId } = (listenerApi.getState() as RootState).autocalib.context;
    if (!clientName || !deviceId || !jobId) return;
    saveAbsmapJobId(clientName, deviceId, jobId);
  },
});
