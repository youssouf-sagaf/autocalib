import type { RootState } from './store';
import { hasAbsmapEditableSlots } from '../utils/slot-geometry';

export const selectAutocalib = (s: RootState) => s.autocalib;
export const selectAbsmap = (s: RootState) => s.autocalib.absmap;
export const selectCalib = (s: RootState) => s.autocalib.calib;
export const selectPairing = (s: RootState) => s.autocalib.pairing;
export const selectWorkspaceContext = (s: RootState) => s.autocalib.context;
export const selectDirectory = (s: RootState) => s.autocalib.directory;
export const selectUi = (s: RootState) => s.autocalib.ui;

export const selectSlots = (s: RootState) => s.autocalib.absmap.slots;
export const selectBaselineSlots = (s: RootState) => s.autocalib.absmap.baselineSlots;
export const selectCrops = (s: RootState) => s.autocalib.absmap.crops;
export const selectAbsmapJob = (s: RootState) => s.autocalib.absmap.job;
export const selectEditMode = (s: RootState) => s.autocalib.absmap.editMode;
export const selectIsDirty = (s: RootState) => s.autocalib.absmap.isDirty;
export const selectWorkspaceMode = (s: RootState) => s.autocalib.ui.workspaceMode;
export const selectSaveFeedback = (s: RootState) => s.autocalib.ui.saveFeedback;

export const selectHasAbsmapEditableSlots = (s: RootState) =>
  hasAbsmapEditableSlots(
    s.autocalib.absmap.slots,
    s.autocalib.absmap.baselineSlots,
    s.autocalib.absmap.b2bSnapshotAtLoad,
  );
