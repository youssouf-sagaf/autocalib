/**
 * Autocalib store modules (phase 2b nested state + combineReducers).
 *
 * State shape: `autocalib.{ absmap, calib, pairing, context, directory, ui }`
 */
export {
  assembleDirtySavePayload,
  markProdSlotDeleted,
  markProdSlotDirty,
  resetAbsmapDirtyTracking,
} from '../../utils/absmap-dirty';
export {
  pairingLinksFromMap,
  removePairingForBbox,
  removePairingForSlot,
  setPairingLink,
  syncPairingMapFromLinks,
  type PairingBySlotId,
} from '../../utils/pairing-map';
export { ensureDraftSlot, isProdSlotId, slotKey } from '../../utils/slot-key';
export type { AutocalibRootState, AbsmapDomainState, LegacyAutocalibState } from './nested-state';
export { flatToNested, nestedToFlat, legacyAutocalibFromRoot } from './nested-state';
export { autocalibInitialState } from './initial-state';
