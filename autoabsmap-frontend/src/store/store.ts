import { configureStore } from '@reduxjs/toolkit';
import absmapReducer from './autoabsmap-slice';

export const store = configureStore({
  reducer: {
    absmap: absmapReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
