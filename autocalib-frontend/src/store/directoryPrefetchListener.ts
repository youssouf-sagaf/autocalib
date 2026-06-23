import { createListenerMiddleware } from '@reduxjs/toolkit';
import type { RootState } from './store';
import { fetchClients } from './autocalib-slice';
import { activeClientDirectoryKey } from '../utils/clientContext';
import { scheduleDirectoryDevicePrefetch } from '../utils/deviceDirectoryPrefetch';

/** After the client directory resolves from the API, prefetch device lists so “Switch device” is warm (priority: current client + récents). */
export const directoryPrefetchListener = createListenerMiddleware();

directoryPrefetchListener.startListening({
  actionCreator: fetchClients.fulfilled,
  effect: (_action, api) => {
    const state = api.getState() as RootState;
    const ctx = state.autocalib.context;
    const dir = state.autocalib.directory;
    if (dir.clientsStatus !== 'ready') return;
    scheduleDirectoryDevicePrefetch(
      api.dispatch,
      dir,
      activeClientDirectoryKey(ctx),
      ctx.recentDevices.map((r) => r.client),
    );
  },
});
