import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { WorkspaceContext } from '../../types';
import { buildInitialWorkspaceContext, saveContextToStorage } from './shared';

const slice = createSlice({
  name: 'autocalib',
  initialState: buildInitialWorkspaceContext() as WorkspaceContext,
  reducers: {
    setDeviceId(state, action: PayloadAction<string>) {
      state.deviceId = action.payload;
      saveContextToStorage(state);
    },

    removeRecentDevice(state, action: PayloadAction<{ client: string; deviceId: string }>) {
      state.recentDevices = state.recentDevices.filter(
        (d) => !(d.client === action.payload.client && d.deviceId === action.payload.deviceId),
      );
      saveContextToStorage(state);
    },

    toggleSidebar(state) {
      state.sidebarExpanded = !state.sidebarExpanded;
      saveContextToStorage(state);
    }
  },
});

export const contextReducer = slice.reducer;
export const { setDeviceId, removeRecentDevice, toggleSidebar } = slice.actions;
