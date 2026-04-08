import { createAsyncThunk, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type {
  CropRequest,
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
  isDirty: boolean;
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
  isDirty: false,
  overlayVisibility: { detection: false, mask: false, postprocess: false },
  maskPolygons: null,
  detectionOverlay: null,
  postprocessOverlay: null,
};

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
    resetSession(state) {
      state.slots = [];
      state.baselineSlots = [];
      state.job = null;
      state.crops = [];
      state.isDirty = false;
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
  resetSession,
} = absmapSlice.actions;

export default absmapSlice.reducer;
