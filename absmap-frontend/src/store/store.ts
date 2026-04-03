import { configureStore } from "@reduxjs/toolkit";
import absmapReducer from "./absmap-slice";

export const store = configureStore({
  reducer: {
    absmap: absmapReducer,
  },
  middleware: (getDefault) =>
    getDefault({
      serializableCheck: {
        ignoredPaths: ["absmap.slots", "absmap.baselineSlots", "absmap.existingSlots"],
      },
    }),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
