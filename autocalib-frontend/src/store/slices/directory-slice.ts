import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { DeviceSummary } from '../../types';
import { clientDirectoryKeyFromSummary, clientLocationFromSummary } from '../../utils/clientContext';
import { persistClientsCache, persistDevicesForClient } from '../../utils/directoryCache';
import { getInitialDirectoryState } from '../directory-state';
import {
  fetchClients,
  fetchDevicesForClient,
  parseFetchDevicesArg,
  type FetchDevicesForClientArg,
} from '../autocalib-thunks';
import { log } from './shared';

const slice = createSlice({
  name: 'autocalib',
  initialState: getInitialDirectoryState(),
  reducers: {
    directorySeedStaleDevices(state, action: PayloadAction<{ clientId: string; devices: DeviceSummary[] }>) {
      const { clientId, devices } = action.payload;
      if (!devices.length) return;
      if (state.devicesStatus[clientId] === 'loading') return;
      const existing = state.devicesByClient[clientId]?.length ?? 0;
      if (existing > 0) return;
      state.devicesByClient[clientId] = devices.map((d) => ({ ...d }));
      if (state.devicesStatus[clientId] !== 'ready') {
        state.devicesStatus[clientId] = 'idle';
      }
      state.devicesError[clientId] = null;
    },

    invalidateDirectoryListing(state) {
      state.clientsStatus = 'idle';
      state.clientsError = null;
      state.devicesByClient = {};
      state.devicesStatus = {};
      state.devicesError = {};
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchClients.pending, (state) => {
        state.clientsStatus = 'loading';
        state.clientsError = null;
      })
      .addCase(fetchClients.fulfilled, (state, action) => {
        state.clients = action.payload;
        state.clientsStatus = 'ready';
        state.clientsError = null;
        for (const client of action.payload) {
          const key = clientDirectoryKeyFromSummary(client);
          state.clientLocations[key] = clientLocationFromSummary(client);
          state.clientLocationStatus[key] = 'ready';
        }
        persistClientsCache(action.payload);
      })
      .addCase(fetchClients.rejected, (state, action) => {
        state.clientsStatus = 'error';
        state.clientsError = action.error.message ?? 'Failed to load clients';
        log.error(`fetchClients rejected: ${action.error.message}`);
      })
      .addCase(fetchDevicesForClient.pending, (state, action) => {
        const cid = parseFetchDevicesArg(action.meta.arg as FetchDevicesForClientArg).directoryKey;
        state.devicesStatus[cid] = 'loading';
        state.devicesError[cid] = null;
      })
      .addCase(fetchDevicesForClient.fulfilled, (state, action) => {
        const { clientId, devices } = action.payload;
        state.devicesByClient[clientId] = devices;
        state.devicesStatus[clientId] = 'ready';
        state.devicesError[clientId] = null;
        persistDevicesForClient(clientId, devices);
      })
      .addCase(fetchDevicesForClient.rejected, (state, action) => {
        const cid = parseFetchDevicesArg(action.meta.arg as FetchDevicesForClientArg).directoryKey;
        state.devicesStatus[cid] = 'error';
        state.devicesError[cid] = action.error.message ?? 'Failed to load devices';
        log.error(`fetchDevicesForClient(${cid}) rejected: ${action.error.message}`);
      });
  },
});

export const directoryReducer = slice.reducer;
export const { directorySeedStaleDevices, invalidateDirectoryListing } = slice.actions;
