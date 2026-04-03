import { createSlice, createAsyncThunk, type PayloadAction } from "@reduxjs/toolkit";
import { v4 as uuid } from "uuid";
import * as api from "../api/absmap-api";
import type {
  CropRequest,
  EditEvent,
  EditEventType,
  JobResult,
  OrchestratorProgress,
  PipelineJob,
  Slot,
} from "../types";

// ── State ───────────────────────────────────────────────────────────────

export interface AbsmapState {
  existingSlots: Slot[];
  crops: CropRequest[];
  job: PipelineJob | null;
  slots: Slot[];
  baselineSlots: Slot[];
  selection: string[];
  editHistory: EditEvent[];
  editIndex: number;
  isDirty: boolean;
}

const initialState: AbsmapState = {
  existingSlots: [],
  crops: [],
  job: null,
  slots: [],
  baselineSlots: [],
  selection: [],
  editHistory: [],
  editIndex: -1,
  isDirty: false,
};

// ── Async thunks ────────────────────────────────────────────────────────

export const launchJob = createAsyncThunk(
  "absmap/launchJob",
  async (_, { getState, dispatch }) => {
    const state = (getState() as { absmap: AbsmapState }).absmap;
    if (state.crops.length === 0) throw new Error("No crops drawn");

    const pj = await api.submitJob({ crops: state.crops });
    dispatch(setJob(pj));

    return new Promise<JobResult>((resolve, reject) => {
      api.streamJobProgress(
        pj.id,
        (progress) => dispatch(updateJobProgress(progress)),
        async () => {
          try {
            const result = await api.getJobResult(pj.id);
            dispatch(receiveJobResult(result));
            resolve(result);
          } catch (err) {
            reject(err);
          }
        },
        () => reject(new Error("SSE stream error")),
      );
    });
  },
);

export const saveSession = createAsyncThunk(
  "absmap/saveSession",
  async (
    payload: {
      difficultyTags: string[];
      otherNote?: string;
    },
    { getState },
  ) => {
    const state = (getState() as { absmap: AbsmapState }).absmap;
    const sessionId = uuid();
    return api.saveSession(sessionId, {
      final_slots: state.slots,
      edit_events: state.editHistory,
      reprocessed_steps: [],
      difficulty_tags: payload.difficultyTags as any,
      other_difficulty_note: payload.otherNote,
    });
  },
);

// ── Slice ───────────────────────────────────────────────────────────────

const absmapSlice = createSlice({
  name: "absmap",
  initialState,
  reducers: {
    setExistingSlots(state, action: PayloadAction<Slot[]>) {
      state.existingSlots = action.payload;
    },

    addCrop(state, action: PayloadAction<CropRequest>) {
      state.crops.push(action.payload);
    },

    removeCrop(state, action: PayloadAction<number>) {
      state.crops.splice(action.payload, 1);
    },

    clearCrops(state) {
      state.crops = [];
    },

    setJob(state, action: PayloadAction<PipelineJob>) {
      state.job = action.payload;
    },

    updateJobProgress(state, action: PayloadAction<OrchestratorProgress>) {
      if (state.job) {
        state.job = { ...state.job, status: "running", progress: action.payload };
      }
    },

    receiveJobResult(state, action: PayloadAction<JobResult>) {
      if (state.job) {
        state.job = { ...state.job, status: "done", progress: undefined };
      }
      state.slots = action.payload.slots;
      state.baselineSlots = action.payload.baseline_slots;
      state.editHistory = [];
      state.editIndex = -1;
      state.isDirty = false;
    },

    setSelection(state, action: PayloadAction<string[]>) {
      state.selection = action.payload;
    },

    toggleSlotSelection(state, action: PayloadAction<string>) {
      const id = action.payload;
      const idx = state.selection.indexOf(id);
      if (idx >= 0) {
        state.selection.splice(idx, 1);
      } else {
        state.selection.push(id);
      }
    },

    clearSelection(state) {
      state.selection = [];
    },

    // ── Edit operations (all record an EditEvent) ───────────────────

    addSlot(state, action: PayloadAction<Slot>) {
      const slot = action.payload;
      state.slots.push(slot);
      _pushEdit(state, "add", [slot.slot_id], [], [slot]);
    },

    deleteSlots(state, action: PayloadAction<string[]>) {
      const ids = new Set(action.payload);
      const removed = state.slots.filter((s) => ids.has(s.slot_id));
      state.slots = state.slots.filter((s) => !ids.has(s.slot_id));
      state.selection = state.selection.filter((id) => !ids.has(id));
      const type: EditEventType = ids.size > 1 ? "bulk_delete" : "delete";
      _pushEdit(state, type, action.payload, removed, []);
    },

    modifySlot(state, action: PayloadAction<Slot>) {
      const updated = action.payload;
      const idx = state.slots.findIndex((s) => s.slot_id === updated.slot_id);
      if (idx < 0) return;
      const before = state.slots[idx];
      state.slots[idx] = updated;
      _pushEdit(state, "modify", [updated.slot_id], [before], [updated]);
    },

    applyAlignment(state, action: PayloadAction<Slot[]>) {
      const corrected = action.payload;
      const ids = corrected.map((s) => s.slot_id);
      const befores: Slot[] = [];
      for (const s of corrected) {
        const idx = state.slots.findIndex((x) => x.slot_id === s.slot_id);
        if (idx >= 0) {
          befores.push(state.slots[idx]);
          state.slots[idx] = s;
        }
      }
      _pushEdit(state, "align", ids, befores, corrected);
    },

    applyReprocess(state, action: PayloadAction<Slot[]>) {
      const proposed = action.payload;
      for (const s of proposed) {
        state.slots.push(s);
      }
      _pushEdit(
        state,
        "reprocess",
        proposed.map((s) => s.slot_id),
        [],
        proposed,
      );
    },

    // ── Undo / Redo ─────────────────────────────────────────────────

    undo(state) {
      if (state.editIndex < 0) return;
      const event = state.editHistory[state.editIndex];
      _revertEdit(state, event);
      state.editIndex -= 1;
      state.isDirty = state.editIndex >= 0;
    },

    redo(state) {
      if (state.editIndex >= state.editHistory.length - 1) return;
      state.editIndex += 1;
      const event = state.editHistory[state.editIndex];
      _applyEdit(state, event);
      state.isDirty = true;
    },

    resetSession(state) {
      Object.assign(state, { ...initialState, existingSlots: state.existingSlots });
    },
  },

  extraReducers: (builder) => {
    builder
      .addCase(launchJob.rejected, (state, action) => {
        if (state.job) {
          state.job = { ...state.job, status: "failed", error: action.error.message };
        }
      })
      .addCase(saveSession.fulfilled, (state) => {
        state.isDirty = false;
      });
  },
});

// ── Helpers ─────────────────────────────────────────────────────────────

function _pushEdit(
  state: AbsmapState,
  type: EditEventType,
  slotIds: string[],
  before: Slot[],
  after: Slot[],
) {
  // Truncate any redo history beyond the current pointer
  state.editHistory = state.editHistory.slice(0, state.editIndex + 1);
  state.editHistory.push({
    type,
    timestamp: Date.now(),
    slot_ids: slotIds,
    before,
    after,
  });
  state.editIndex = state.editHistory.length - 1;
  state.isDirty = true;
}

function _revertEdit(state: AbsmapState, event: EditEvent) {
  switch (event.type) {
    case "add":
    case "reprocess": {
      const ids = new Set(event.slot_ids);
      state.slots = state.slots.filter((s) => !ids.has(s.slot_id));
      break;
    }
    case "delete":
    case "bulk_delete":
      state.slots.push(...event.before);
      break;
    case "modify":
    case "align":
      for (const b of event.before) {
        const idx = state.slots.findIndex((s) => s.slot_id === b.slot_id);
        if (idx >= 0) state.slots[idx] = b;
      }
      break;
  }
}

function _applyEdit(state: AbsmapState, event: EditEvent) {
  switch (event.type) {
    case "add":
    case "reprocess":
      state.slots.push(...event.after);
      break;
    case "delete":
    case "bulk_delete": {
      const ids = new Set(event.slot_ids);
      state.slots = state.slots.filter((s) => !ids.has(s.slot_id));
      break;
    }
    case "modify":
    case "align":
      for (const a of event.after) {
        const idx = state.slots.findIndex((s) => s.slot_id === a.slot_id);
        if (idx >= 0) state.slots[idx] = a;
      }
      break;
  }
}

export const {
  setExistingSlots,
  addCrop,
  removeCrop,
  clearCrops,
  setJob,
  updateJobProgress,
  receiveJobResult,
  setSelection,
  toggleSlotSelection,
  clearSelection,
  addSlot,
  deleteSlots,
  modifySlot,
  applyAlignment,
  applyReprocess,
  undo,
  redo,
  resetSession,
} = absmapSlice.actions;

export default absmapSlice.reducer;
