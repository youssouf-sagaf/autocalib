import { createAsyncThunk, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type {
  CropRequest,
  EditEvent,
  EditMode,
  OrchestratorProgress,
  OverlayLayer,
  OverlayVisibility,
  PipelineJob,
  Slot,
} from '../types';
import * as api from '../api/autoabsmap-api';
import { createLogger } from '../utils/logger';

const log = createLogger('store');

interface AbsmapState {
  dualMapActive: boolean;
  crops: CropRequest[];
  job: PipelineJob | null;
  slots: Slot[];
  baselineSlots: Slot[];
  selection: string[];
  editMode: EditMode;
  editHistory: EditEvent[];
  editIndex: number;
  isDirty: boolean;
  isSaving: boolean;
  lastSavedAt: string | null;
  saveError: string | null;
  overlayVisibility: OverlayVisibility;
  maskPolygons: GeoJSON.FeatureCollection | null;
  detectionOverlay: GeoJSON.FeatureCollection | null;
  postprocessOverlay: GeoJSON.FeatureCollection | null;
}

const initialState: AbsmapState = {
  dualMapActive: false,
  crops: [],
  job: null,
  slots: [],
  baselineSlots: [],
  selection: [],
  editMode: 'none',
  editHistory: [],
  editIndex: 0,
  isDirty: false,
  isSaving: false,
  lastSavedAt: null,
  saveError: null,
  overlayVisibility: { detection: false, mask: false, postprocess: false },
  maskPolygons: null,
  detectionOverlay: null,
  postprocessOverlay: null,
};

function truncateFuture(state: AbsmapState) {
  if (state.editIndex < state.editHistory.length) {
    state.editHistory = state.editHistory.slice(0, state.editIndex);
  }
}

function applyEvent(state: AbsmapState, evt: EditEvent) {
  for (const slot of evt.before) {
    const idx = state.slots.findIndex((s) => s.slot_id === slot.slot_id);
    if (idx !== -1) state.slots.splice(idx, 1);
  }
  for (const slot of evt.after) {
    state.slots.push(slot);
  }
}

function reverseEvent(state: AbsmapState, evt: EditEvent) {
  for (const slot of evt.after) {
    const idx = state.slots.findIndex((s) => s.slot_id === slot.slot_id);
    if (idx !== -1) state.slots.splice(idx, 1);
  }
  for (const slot of evt.before) {
    state.slots.push(slot);
  }
}

export const launchJob = createAsyncThunk(
  'absmap/launchJob',
  async (_, { getState }) => {
    const { absmap } = getState() as { absmap: AbsmapState };
    log.info(`Submitting job with ${absmap.crops.length} crop(s)`);
    const job = await api.submitJob({ crops: absmap.crops });
    log.info(`Job created: ${job.id}, status=${job.status}`);
    return job;
  },
);

export const fetchJobResult = createAsyncThunk(
  'absmap/fetchJobResult',
  async (jobId: string) => {
    log.info(`Fetching result for job ${jobId}`);
    const result = await api.getJobResult(jobId);
    log.info(`Result received: ${result.slots.length} slots, ${result.baseline_slots.length} baseline`);
    return result;
  },
);

export const saveSession = createAsyncThunk(
  'absmap/saveSession',
  async (_, { getState }) => {
    const { absmap } = getState() as { absmap: AbsmapState };
    const jobId = absmap.job?.id;
    if (!jobId) throw new Error('No active job to save');
    log.info(`Saving session for job ${jobId} (${absmap.slots.length} slots, ${absmap.editHistory.length} edits)`);
    const result = await api.saveSession({
      job_id: jobId,
      slots: absmap.slots,
      edit_history: absmap.editHistory.slice(0, absmap.editIndex),
      saved_at: new Date().toISOString(),
    });
    log.info(`Session saved at ${result.saved_at}`);
    return result;
  },
);

const absmapSlice = createSlice({
  name: 'absmap',
  initialState,
  reducers: {
    addCrop(state, action: PayloadAction<CropRequest>) {
      state.crops.push(action.payload);
      log.info(`Crop added (#${state.crops.length})`);
    },
    removeCrop(state, action: PayloadAction<number>) {
      log.info(`Crop removed (#${action.payload + 1})`);
      state.crops.splice(action.payload, 1);
    },
    clearCrops(state) {
      state.crops = [];
    },
    updateJobProgress(state, action: PayloadAction<OrchestratorProgress>) {
      if (state.job) {
        state.job.status = 'running';
        state.job.progress = action.payload;
        const p = action.payload;
        log.debug(`Progress: crop ${p.crop_index + 1}/${p.crop_total} — ${p.stage} ${p.percent}%`);
      }
    },
    toggleDualMap(state) {
      if (state.slots.length > 0 || state.baselineSlots.length > 0) {
        state.dualMapActive = !state.dualMapActive;
      }
    },
    markJobFailed(state, action: PayloadAction<string>) {
      if (state.job) {
        state.job.status = 'failed';
        state.job.error = action.payload;
        state.job.progress = undefined;
      }
    },
    toggleOverlay(state, action: PayloadAction<OverlayLayer>) {
      const layer = action.payload;
      state.overlayVisibility[layer] = !state.overlayVisibility[layer];
    },
    setEditMode(state, action: PayloadAction<EditMode>) {
      state.editMode = action.payload;
    },

    addSlot(state, action: PayloadAction<Slot>) {
      truncateFuture(state);
      const slot = action.payload;
      const evt: EditEvent = {
        type: 'add',
        timestamp: Date.now(),
        slot_ids: [slot.slot_id],
        before: [],
        after: [slot],
      };
      state.editHistory.push(evt);
      state.editIndex++;
      applyEvent(state, evt);
      state.isDirty = true;
      log.info(`Slot added: ${slot.slot_id.slice(0, 8)}…`);
    },

    deleteSlot(state, action: PayloadAction<string>) {
      const slotId = action.payload;
      const slot = state.slots.find((s) => s.slot_id === slotId);
      if (!slot) return;
      truncateFuture(state);
      const evt: EditEvent = {
        type: 'delete',
        timestamp: Date.now(),
        slot_ids: [slotId],
        before: [slot],
        after: [],
      };
      state.editHistory.push(evt);
      state.editIndex++;
      applyEvent(state, evt);
      state.isDirty = true;
      log.info(`Slot deleted: ${slotId.slice(0, 8)}…`);
    },

    modifySlot(state, action: PayloadAction<Slot>) {
      const updated = action.payload;
      const original = state.slots.find((s) => s.slot_id === updated.slot_id);
      if (!original) return;
      truncateFuture(state);
      const evt: EditEvent = {
        type: 'modify',
        timestamp: Date.now(),
        slot_ids: [updated.slot_id],
        before: [{ ...original }],
        after: [updated],
      };
      state.editHistory.push(evt);
      state.editIndex++;
      const idx = state.slots.findIndex((s) => s.slot_id === updated.slot_id);
      if (idx !== -1) state.slots[idx] = updated;
      state.isDirty = true;
      log.info(`Slot modified: ${updated.slot_id.slice(0, 8)}…`);
    },

    undo(state) {
      if (state.editIndex <= 0) return;
      state.editIndex--;
      const evt = state.editHistory[state.editIndex]!;
      reverseEvent(state, evt);
      state.isDirty = true;
      log.info(`Undo: ${evt.type}`);
    },

    redo(state) {
      if (state.editIndex >= state.editHistory.length) return;
      const evt = state.editHistory[state.editIndex]!;
      applyEvent(state, evt);
      state.editIndex++;
      state.isDirty = true;
      log.info(`Redo: ${evt.type}`);
    },

    resetSession(state) {
      state.slots = [];
      state.baselineSlots = [];
      state.job = null;
      state.crops = [];
      state.editMode = 'none';
      state.editHistory = [];
      state.editIndex = 0;
      state.isDirty = false;
      state.isSaving = false;
      state.lastSavedAt = null;
      state.saveError = null;
      state.overlayVisibility = { detection: false, mask: false, postprocess: false };
      state.maskPolygons = null;
      state.detectionOverlay = null;
      state.postprocessOverlay = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(launchJob.fulfilled, (state, action) => {
        state.job = action.payload;
      })
      .addCase(launchJob.rejected, (state, action) => {
        state.job = {
          id: '',
          status: 'failed',
          error: action.error.message ?? 'Failed to submit job',
        };
      })
      .addCase(saveSession.pending, (state) => {
        state.isSaving = true;
        state.saveError = null;
      })
      .addCase(saveSession.fulfilled, (state, action) => {
        state.isSaving = false;
        state.isDirty = false;
        state.lastSavedAt = action.payload.saved_at;
      })
      .addCase(saveSession.rejected, (state, action) => {
        state.isSaving = false;
        state.saveError = action.error.message ?? 'Save failed';
      })
      .addCase(fetchJobResult.fulfilled, (state, action) => {
        state.slots = action.payload.slots;
        state.baselineSlots = action.payload.baseline_slots;
        state.maskPolygons = action.payload.mask_polygons ?? null;
        state.detectionOverlay = action.payload.detection_overlay ?? null;
        state.postprocessOverlay = action.payload.postprocess_overlay ?? null;
        if (state.job) {
          state.job.status = 'done';
          state.job.progress = undefined;
        }
        const totalSlots = action.payload.slots.length + action.payload.baseline_slots.length;
        if (totalSlots > 0) {
          state.dualMapActive = true;
          state.overlayVisibility.postprocess = true;
        }
      });
  },
});

export const {
  addCrop,
  removeCrop,
  clearCrops,
  updateJobProgress,
  markJobFailed,
  toggleDualMap,
  toggleOverlay,
  setEditMode,
  addSlot,
  deleteSlot,
  modifySlot,
  undo,
  redo,
  resetSession,
} = absmapSlice.actions;

export default absmapSlice.reducer;
