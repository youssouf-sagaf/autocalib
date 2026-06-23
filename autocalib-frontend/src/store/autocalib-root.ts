import { combineReducers, type UnknownAction } from '@reduxjs/toolkit';
import { absmapReducer } from './slices/absmap-slice';
import { calibReducer } from './slices/calib-slice';
import { pairingReducer } from './slices/pairing-slice';
import { contextReducer } from './slices/context-slice';
import { directoryReducer } from './slices/directory-slice';
import { uiReducer } from './slices/ui-slice';
import { crossSliceReducer } from './cross-slice-reducer';
import { autocalibInitialState } from './slices/initial-state';
import type { AutocalibRootState } from './slices/nested-state';

const domainReducer = combineReducers({
  absmap: absmapReducer,
  calib: calibReducer,
  pairing: pairingReducer,
  context: contextReducer,
  directory: directoryReducer,
  ui: uiReducer,
});

/** Nested autocalib root: per-domain reducers + cross-slice pass for thunks and multi-domain actions. */
export default function autocalibRootReducer(
  state: AutocalibRootState | undefined,
  action: UnknownAction,
): AutocalibRootState {
  const prev = state ?? autocalibInitialState;
  const next = domainReducer(prev, action);
  return crossSliceReducer(next, action, prev);
}

export { autocalibInitialState };
