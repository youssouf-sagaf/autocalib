import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { uiInitialState } from './initial-state';

const slice = createSlice({
  name: 'autocalib',
  initialState: uiInitialState,
  reducers: {
    setWorkspaceMode(state, action: PayloadAction<'absmap' | 'calib' | 'pairing'>) {
      state.workspaceMode = action.payload;
    },

    closeSaveFeedback(state) {
      state.saveFeedback.open = false;
    }
  },
});

export const uiReducer = slice.reducer;
export const { setWorkspaceMode, closeSaveFeedback } = slice.actions;
