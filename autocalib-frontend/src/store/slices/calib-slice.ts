import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { CalibBbox, CalibEditEvent, CalibEditMode, CalibProgress, CalibTab } from '../../types';
import { scaleCalibBbox } from '../../utils/calib-geometry';
import type { CalibState } from '../autocalib-state-types';
import { calibInitial } from './initial-state';

const slice = createSlice({
  name: 'autocalib',
  initialState: calibInitial as CalibState,
  reducers: {
    calibSetDevice(state, action: PayloadAction<{ deviceId: string; client: string }>) {
      state.deviceId = action.payload.deviceId;
      state.client = action.payload.client;
    },

    calibSetConfidence(state, action: PayloadAction<number>) {
      state.confidenceThreshold = action.payload;
    },

    calibSetActiveFrame(state, action: PayloadAction<number>) {
      state.activeFrameIndex = action.payload;
    },

    calibSetEditMode(state, action: PayloadAction<CalibEditMode>) {
      const raw = action.payload as unknown as string;
      const normalized =
        raw === 'drag_pan' || raw === 'empty_filler' ? 'none' : action.payload;
      state.editMode = normalized as CalibEditMode;
      if (normalized === 'add') {
        state.selectedBboxIds = [];
      }
    },

    calibSelectBbox(state, action: PayloadAction<number>) {
      const id = action.payload;
      const idx = state.selectedBboxIds.indexOf(id);
      if (idx === -1) {
        state.selectedBboxIds.push(id);
      } else {
        state.selectedBboxIds.splice(idx, 1);
      }
    },

    calibSetSelection(state, action: PayloadAction<number[]>) {
      state.selectedBboxIds = action.payload;
    },

    calibClearSelection(state) {
      state.selectedBboxIds = [];
    },

    calibToggleLock(state, action: PayloadAction<number[]>) {
      const ids = [...new Set(action.payload)];
      if (ids.length === 0) return;
      const locked = state.lockedBboxIds;
      const lockedSet = new Set(locked);
      const allSelectedLocked = ids.every((id) => lockedSet.has(id));
      if (allSelectedLocked) {
        const drop = new Set(ids);
        state.lockedBboxIds = locked.filter((id) => !drop.has(id));
      } else {
        for (const id of ids) {
          if (!lockedSet.has(id)) {
            locked.push(id);
            lockedSet.add(id);
          }
        }
      }
    },

    calibAddBbox(state, action: PayloadAction<CalibBbox>) {
      const bbox = action.payload;
      const evt: CalibEditEvent = {
        type: 'add',
        timestamp: Date.now(),
        before: [],
        after: [bbox],
      };
      if (state.editIndex < state.editHistory.length) {
        state.editHistory = state.editHistory.slice(0, state.editIndex);
      }
      state.editHistory.push(evt);
      state.editIndex++;
      state.bboxes.push(bbox);
      state.sessionRevision += 1;
    },

    calibRemoveBbox(state, action: PayloadAction<number>) {
      const spotId = action.payload;
      const bbox = state.bboxes.find((b) => b.spot_id === spotId);
      if (!bbox) return;
      const evt: CalibEditEvent = {
        type: 'remove',
        timestamp: Date.now(),
        before: [bbox],
        after: [],
      };
      if (state.editIndex < state.editHistory.length) {
        state.editHistory = state.editHistory.slice(0, state.editIndex);
      }
      state.editHistory.push(evt);
      state.editIndex++;
      state.bboxes = state.bboxes.filter((b) => b.spot_id !== spotId);
      state.sessionRevision += 1;
    },

    calibModifyBbox(state, action: PayloadAction<CalibBbox>) {
      const updated = action.payload;
      const original = state.bboxes.find((b) => b.spot_id === updated.spot_id);
      if (!original) return;
      const evt: CalibEditEvent = {
        type: 'modify',
        timestamp: Date.now(),
        before: [{ ...original }],
        after: [updated],
      };
      if (state.editIndex < state.editHistory.length) {
        state.editHistory = state.editHistory.slice(0, state.editIndex);
      }
      state.editHistory.push(evt);
      state.editIndex++;
      const idx = state.bboxes.findIndex((b) => b.spot_id === updated.spot_id);
      if (idx !== -1) state.bboxes[idx] = updated;
      state.sessionRevision += 1;
    },

    calibBulkRemove(state, action: PayloadAction<number[]>) {
      const ids = new Set(action.payload);
      const removed = state.bboxes.filter((b) => ids.has(b.spot_id));
      if (removed.length === 0) return;
      const evt: CalibEditEvent = {
        type: 'bulk_remove',
        timestamp: Date.now(),
        before: removed,
        after: [],
      };
      if (state.editIndex < state.editHistory.length) {
        state.editHistory = state.editHistory.slice(0, state.editIndex);
      }
      state.editHistory.push(evt);
      state.editIndex++;
      state.bboxes = state.bboxes.filter((b) => !ids.has(b.spot_id));
      state.sessionRevision += 1;
    },

    calibMultiResize(state, action: PayloadAction<{ spotIds: number[]; newSize: number }>) {
      const { spotIds, newSize } = action.payload;
      const ids = new Set(spotIds);
      const half = newSize / 2;
      const before: CalibBbox[] = [];
      const after: CalibBbox[] = [];
      for (const bbox of state.bboxes) {
        if (!ids.has(bbox.spot_id)) continue;
        before.push({ ...bbox });
        const updated = {
          ...bbox,
          x: Math.round((bbox.center_x - half) * 10) / 10,
          y: Math.round((bbox.center_y - half) * 10) / 10,
          width: newSize,
          height: newSize,
        };
        after.push(updated);
      }
      if (before.length === 0) return;
      const evt: CalibEditEvent = { type: 'resize', timestamp: Date.now(), before, after };
      if (state.editIndex < state.editHistory.length) {
        state.editHistory = state.editHistory.slice(0, state.editIndex);
      }
      state.editHistory.push(evt);
      state.editIndex++;
      for (const u of after) {
        const idx = state.bboxes.findIndex((b) => b.spot_id === u.spot_id);
        if (idx !== -1) state.bboxes[idx] = u;
      }
      state.sessionRevision += 1;
    },

    calibUndo(state) {
      if (state.editIndex <= 0) return;
      state.editIndex--;
      const evt = state.editHistory[state.editIndex]!;
      for (const bbox of evt.after) {
        state.bboxes = state.bboxes.filter((b) => b.spot_id !== bbox.spot_id);
      }
      for (const bbox of evt.before) {
        state.bboxes.push(bbox);
      }
      state.sessionRevision += 1;
    },

    calibRedo(state) {
      if (state.editIndex >= state.editHistory.length) return;
      const evt = state.editHistory[state.editIndex]!;
      for (const bbox of evt.before) {
        state.bboxes = state.bboxes.filter((b) => b.spot_id !== bbox.spot_id);
      }
      for (const bbox of evt.after) {
        state.bboxes.push(bbox);
      }
      state.editIndex++;
      state.sessionRevision += 1;
    },

    calibUpdateProgress(state, action: PayloadAction<CalibProgress>) {
      state.jobProgress = action.payload;
      state.jobStatus = 'running';
    },

    calibMarkFailed(state, action: PayloadAction<string>) {
      state.jobStatus = 'failed';
      state.jobError = action.payload;
      state.jobProgress = null;
    },

    calibReset(state) {
      Object.assign(state, calibInitial);
    },

    calibRevealEditorResult(state) {
      state.showCalibEditorResult = true;
    },

    calibSetViewTab(state, action: PayloadAction<CalibTab>) {
      state.viewTab = action.payload;
    },

    calibSetZoom(state, action: PayloadAction<number>) {
      state.canvasZoom = action.payload;
    },

    calibSetPan(state, action: PayloadAction<{ x: number; y: number }>) {
      state.canvasPanX = action.payload.x;
      state.canvasPanY = action.payload.y;
    },

    /** Align bbox pixel coords with the loaded image natural size (prod DB load). */
    calibAlignBboxesToImageSize(state, action: PayloadAction<{ width: number; height: number }>) {
      const { width, height } = action.payload;
      if (width <= 0 || height <= 0) return;
      if (state.imageWidth === width && state.imageHeight === height) return;

      if (state.bboxes.length > 0 && state.jobId === 'db-static') {
        const sx = width / state.imageWidth;
        const sy = height / state.imageHeight;
        state.bboxes = state.bboxes.map((bbox) => scaleCalibBbox(bbox, sx, sy));
        for (const key of Object.keys(state.calibrationDbBboxesByKey)) {
          const bbox = state.calibrationDbBboxesByKey[key];
          if (bbox) {
            state.calibrationDbBboxesByKey[key] = scaleCalibBbox(bbox, sx, sy);
          }
        }
      }

      state.imageWidth = width;
      state.imageHeight = height;
    },
  },
});

export const calibReducer = slice.reducer;
export const {
  calibSetDevice,
  calibSetConfidence,
  calibSetActiveFrame,
  calibSetEditMode,
  calibSelectBbox,
  calibSetSelection,
  calibClearSelection,
  calibToggleLock,
  calibAddBbox,
  calibRemoveBbox,
  calibModifyBbox,
  calibBulkRemove,
  calibMultiResize,
  calibUndo,
  calibRedo,
  calibUpdateProgress,
  calibMarkFailed,
  calibReset,
  calibRevealEditorResult,
  calibSetViewTab,
  calibSetZoom,
  calibSetPan,
  calibAlignBboxesToImageSize,
} = slice.actions;
