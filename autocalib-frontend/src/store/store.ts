import { configureStore } from '@reduxjs/toolkit';
import autocalibReducer from './autocalib-root';
import { absmapCacheListener } from './absmapCacheListener';
import { calibCacheListener } from './calibCacheListener';
import { directoryPrefetchListener } from './directoryPrefetchListener';

export const store = configureStore({
  reducer: {
    autocalib: autocalibReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware()
      .prepend(directoryPrefetchListener.middleware)
      .prepend(calibCacheListener.middleware)
      .prepend(absmapCacheListener.middleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
