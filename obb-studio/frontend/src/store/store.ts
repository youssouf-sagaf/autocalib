import { configureStore } from '@reduxjs/toolkit';
import studioReducer from './studio-slice';

export const store = configureStore({
  reducer: {
    studio: studioReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
