import { createAsyncThunk, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type {
  CropRequest,
  EditEvent,
  EditMode,
  OrchestratorProgress,
  OverlayLayer,
  OverlayVisibility,
  PipelineJob,
  ReprocessStep,
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
  straightenAnchorSlotId: string | null;
  straightenLoading: boolean;
  straightenError: string | null;
  reprocessRefSlotId: string | null;
  reprocessScopePolygon: GeoJSON.Polygon | null;
  reprocessProposedSlots: Slot[];
  reprocessLoading: boolean;
  reprocessError: string | null;
  reprocessedSteps: ReprocessStep[];
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
  straightenAnchorSlotId: null,
  straightenLoading: false,
  straightenError: null,
  reprocessRefSlotId: null,
  reprocessScopePolygon: null,
  reprocessProposedSlots: [],
  reprocessLoading: false,
  reprocessError: null,
  reprocessedSteps: [],
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

/** Apply aligned slot geometries as a single undoable align event (no preview step). */
/** Same slot list as MapPanel uses for markers (dual-map detection-only view → baseline ids). */
function slotsSnapshotForStraighten(s: AbsmapState): Slot[] {
  const hasOverlayData =
    (s.overlayVisibility.detection && s.detectionOverlay != null) ||
    (s.overlayVisibility.mask && s.maskPolygons != null) ||
    (s.overlayVisibility.postprocess && s.postprocessOverlay != null);

  if (
    s.dualMapActive &&
    hasOverlayData &&
    s.overlayVisibility.detection &&
    !s.overlayVisibility.postprocess &&
    s.baselineSlots.length > 0
  ) {
    return s.baselineSlots;
  }
  return s.slots.length > 0 ? s.slots : s.baselineSlots;
}

function commitStraightenAligned(state: AbsmapState, proposed: Slot[]) {
  truncateFuture(state);
  const beforeSlots: Slot[] = [];
  for (const p of proposed) {
    const existing = state.slots.find((s) => s.slot_id === p.slot_id);
    if (existing) beforeSlots.push({ ...existing });
  }
  const evt: EditEvent = {
    type: 'align',
    timestamp: Date.now(),
    slot_ids: proposed.map((s) => s.slot_id),
    before: beforeSlots,
    after: proposed,
  };
  state.editHistory.push(evt);
  state.editIndex++;
  applyEvent(state, evt);
  state.isDirty = true;
  log.info(`Straighten applied: ${proposed.length} slots aligned`);
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
    const result = await api.saveSession(jobId, {
      final_slots: absmap.slots,
      baseline_slots: absmap.baselineSlots,
      edit_events: absmap.editHistory.slice(0, absmap.editIndex),
      reprocessed_steps: absmap.reprocessedSteps,
      difficulty_tags: [],
    });
    log.info(`Session saved at ${result.saved_at}`);
    return result;
  },
);

export const reprocessArea = createAsyncThunk(
  'absmap/reprocessArea',
  async (
    args: { referenceSlot: Slot; scopePolygon: GeoJSON.Polygon },
    { getState },
  ) => {
    const { absmap } = getState() as { absmap: AbsmapState };
    const jobId = absmap.job?.id;
    if (!jobId) throw new Error('No active job');
    log.info(
      `Reprocess request: ref=${args.referenceSlot.slot_id.slice(0, 8)}… on job ${jobId}`,
    );
    const result = await api.reprocessArea(jobId, {
      reference_slot: args.referenceSlot,
      scope_polygon: args.scopePolygon,
    });
    log.info(`Reprocess response: ${result.proposed_slots.length} proposed slots`);
    return result.proposed_slots as Slot[];
  },
);

export const straightenRow = createAsyncThunk(
  'absmap/straightenRow',
  async (
    anchors: { slot_id_a: string; slot_id_b: string },
    { getState },
  ) => {
    const { absmap } = getState() as { absmap: AbsmapState };
    const jobId = absmap.job?.id;
    if (!jobId) throw new Error('No active job');
    const slotsSnapshot = slotsSnapshotForStraighten(absmap);
    if (slotsSnapshot.length === 0) {
      throw new Error('No slots to align');
    }
    log.info(
      `Straighten request: ${anchors.slot_id_a.slice(0, 8)}… / ${anchors.slot_id_b.slice(0, 8)}… on job ${jobId} (${slotsSnapshot.length} slots in snapshot)`,
    );
    const result = await api.straightenRow(jobId, {
      ...anchors,
      slots: slotsSnapshot,
    });
    const proposed = result.proposed_slots as Slot[];
    log.info(`Straighten response: ${proposed.length} corrected slots`);
    const touchesEditable = proposed.some((p) =>
      absmap.slots.some((s) => s.slot_id === p.slot_id),
    );
    return { proposed, touchesEditable };
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

    straightenSetAnchor(state, action: PayloadAction<string | null>) {
      state.straightenAnchorSlotId = action.payload;
      state.straightenError = null;
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

    bulkDeleteSlots(state, action: PayloadAction<string[]>) {
      const idSet = new Set(action.payload);
      const before: Slot[] = [];
      for (const slot of state.slots) {
        if (idSet.has(slot.slot_id)) before.push({ ...slot });
      }
      if (before.length === 0) return;
      truncateFuture(state);
      const evt: EditEvent = {
        type: 'bulk_delete',
        timestamp: Date.now(),
        slot_ids: before.map((s) => s.slot_id),
        before,
        after: [],
      };
      state.editHistory.push(evt);
      state.editIndex++;
      applyEvent(state, evt);
      state.isDirty = true;
      log.info(`Bulk delete: ${before.length} slot(s)`);
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

    rejectStraighten(state) {
      state.straightenAnchorSlotId = null;
      log.info('Straighten mode cleared');
    },

    reprocessSetRef(state, action: PayloadAction<string | null>) {
      state.reprocessRefSlotId = action.payload;
      state.reprocessError = null;
    },

    reprocessSetScope(state, action: PayloadAction<GeoJSON.Polygon | null>) {
      state.reprocessScopePolygon = action.payload;
    },

    reprocessAccept(state) {
      const proposed = state.reprocessProposedSlots;
      if (proposed.length === 0) return;
      const refId = state.reprocessRefSlotId;
      const scope = state.reprocessScopePolygon;

      // Commit as undoable reprocess event
      truncateFuture(state);
      const evt: EditEvent = {
        type: 'reprocess',
        timestamp: Date.now(),
        slot_ids: proposed.map((s) => s.slot_id),
        before: [],
        after: proposed,
      };
      state.editHistory.push(evt);
      state.editIndex++;
      applyEvent(state, evt);
      state.isDirty = true;

      // Record reprocess step with accepted = proposed
      if (refId && scope) {
        state.reprocessedSteps.push({
          trigger_slot_id: refId,
          scope_polygon: scope,
          proposed,
          accepted: proposed,
        });
      }

      // Reset reprocess UI state
      state.reprocessRefSlotId = null;
      state.reprocessScopePolygon = null;
      state.reprocessProposedSlots = [];
      state.reprocessError = null;
      log.info(`Reprocess accepted: ${proposed.length} slots committed`);
    },

    reprocessReject(state) {
      const proposed = state.reprocessProposedSlots;
      const refId = state.reprocessRefSlotId;
      const scope = state.reprocessScopePolygon;

      // Record rejection as learning signal (accepted = [])
      if (refId && scope) {
        state.reprocessedSteps.push({
          trigger_slot_id: refId,
          scope_polygon: scope,
          proposed,
          accepted: [],
        });
      }

      // Reset reprocess UI state
      state.reprocessRefSlotId = null;
      state.reprocessScopePolygon = null;
      state.reprocessProposedSlots = [];
      state.reprocessError = null;
      log.info(`Reprocess rejected: ${proposed.length} proposals discarded (signal saved)`);
    },

    reprocessReset(state) {
      state.reprocessRefSlotId = null;
      state.reprocessScopePolygon = null;
      state.reprocessProposedSlots = [];
      state.reprocessLoading = false;
      state.reprocessError = null;
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
      state.straightenAnchorSlotId = null;
      state.straightenLoading = false;
      state.straightenError = null;
      state.reprocessRefSlotId = null;
      state.reprocessScopePolygon = null;
      state.reprocessProposedSlots = [];
      state.reprocessLoading = false;
      state.reprocessError = null;
      state.reprocessedSteps = [];
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(launchJob.fulfilled, (state, action) => {
        state.job = action.payload;
        state.overlayVisibility = { detection: false, mask: false, postprocess: false };
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
        }
      })
      .addCase(reprocessArea.pending, (state) => {
        state.reprocessLoading = true;
        state.reprocessError = null;
      })
      .addCase(reprocessArea.fulfilled, (state, action) => {
        state.reprocessLoading = false;
        state.reprocessProposedSlots = action.payload;
        if (action.payload.length === 0) {
          state.reprocessError = 'No slots proposed for this area. Try a different reference slot or wider scope.';
        }
      })
      .addCase(reprocessArea.rejected, (state, action) => {
        state.reprocessLoading = false;
        state.reprocessError = action.error.message ?? 'Reprocess failed';
        log.error(`Reprocess failed: ${action.error.message}`);
      })
      .addCase(straightenRow.pending, (state) => {
        state.straightenLoading = true;
        state.straightenError = null;
      })
      .addCase(straightenRow.fulfilled, (state, action) => {
        state.straightenLoading = false;
        const { proposed, touchesEditable } = action.payload;
        if (proposed.length === 0) {
          state.straightenError =
            'No slots aligned for this pair. Pick two markers on the same row, or different anchors.';
          /* Keep straightenAnchorSlotId so the user can click another second slot. */
          return;
        }
        state.straightenAnchorSlotId = null;
        state.straightenError = null;
        if (touchesEditable) {
          commitStraightenAligned(state, proposed);
          return;
        }
        /* Baseline-ID proposal vs post-process layer: replace auto slots, keep manual. */
        truncateFuture(state);
        const manual = state.slots.filter((s) => s.source === 'manual');
        const beforeAll = [...state.slots];
        const after = [...proposed, ...manual];
        const evt: EditEvent = {
          type: 'align',
          timestamp: Date.now(),
          slot_ids: proposed.map((s) => s.slot_id),
          before: beforeAll,
          after,
        };
        state.editHistory.push(evt);
        state.editIndex++;
        applyEvent(state, evt);
        state.isDirty = true;
        log.info(`Straighten applied (baseline snapshot): ${proposed.length} slots`);
      })
      .addCase(straightenRow.rejected, (state, action) => {
        state.straightenLoading = false;
        /* Keep first anchor so user can retry the second pick without starting over. */
        state.straightenError = action.error.message ?? 'Straighten failed';
        log.error(`Straighten failed: ${action.error.message}`);
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
  straightenSetAnchor,
  addSlot,
  deleteSlot,
  bulkDeleteSlots,
  modifySlot,
  rejectStraighten,
  reprocessSetRef,
  reprocessSetScope,
  reprocessAccept,
  reprocessReject,
  reprocessReset,
  undo,
  redo,
  resetSession,
} = absmapSlice.actions;

export default absmapSlice.reducer;
