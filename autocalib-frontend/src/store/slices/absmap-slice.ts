import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type {
  CropRequest,
  EditEvent,
  EditMode,
  ImagerySource,
  MarkerDisplayMode,
  OrchestratorProgress,
  OverlayLayer,
  OrientedRect,
  ParkingSlotType,
  Slot,
} from '../../types';
import { ensureDraftSlot, normalizeSlotId, slotKey } from '../../utils/slot-key';
import {
  markProdDeletesForRemovedSlot,
  markProdDeletesForRemovedSlots,
  markProdSlotDeleted,
  markProdSlotDirty,
} from '../../utils/absmap-dirty';
import {
  excludeSlotsOverlappingExisting,
  generateRowProposals,
  mergeSlotsForPlacementHints,
  sanitizeTileRowProposals,
} from '../../utils/slot-geometry';
import {
  cloneSlotForHistory,
  cloneCropForHistory,
  recordCropHistory,
  markAbsmapDirty,
  truncateFuture,
  applyEvent,
  reverseEvent,
  clearTileRowWizard,
  coalesceTrailingCropEvents,
  isPipelineLoadEvent,
  saveImagerySourceToStorage,
  log,
} from './shared';
import type { AbsmapDomainState } from './nested-state';
import { absmapInitialState } from './initial-state';

function resolveSlotForTypeChange(
  state: AbsmapDomainState,
  slotId: string,
): { before: Slot; inBaseline: boolean } | null {
  const inEditable = state.slots.find((s) => slotKey(s) === slotId);
  if (inEditable) return { before: inEditable, inBaseline: false };

  const bIdx = state.baselineSlots.findIndex((s) => slotKey(s) === slotId);
  if (bIdx !== -1) return { before: state.baselineSlots[bIdx]!, inBaseline: true };

  const inProd = state.b2bSnapshotAtLoad.find((s) => s.slot_id.trim() === slotId);
  if (inProd) return { before: inProd, inBaseline: false };

  return null;
}

function applyBulkSlotParkingType(
  state: AbsmapDomainState,
  slotIds: string[],
  slot_type: ParkingSlotType,
): void {
  const before: Slot[] = [];
  const after: Slot[] = [];

  for (const slotId of slotIds) {
    const resolved = resolveSlotForTypeChange(state, slotId);
    if (!resolved) continue;

    const { before: slotBefore, inBaseline } = resolved;
    if ((slotBefore.slot_type ?? 'common') === slot_type) continue;

    const updated: Slot = { ...slotBefore, slot_type };

    if (inBaseline) {
      const bIdx = state.baselineSlots.findIndex((s) => slotKey(s) === slotId);
      if (bIdx !== -1) state.baselineSlots[bIdx] = updated;
    }

    const idx = state.slots.findIndex((s) => slotKey(s) === slotId);
    if (idx !== -1) {
      state.slots[idx] = updated;
    } else {
      state.slots.push(updated);
    }

    before.push(cloneSlotForHistory(slotBefore));
    after.push(cloneSlotForHistory(updated));
  }

  if (before.length === 0) return;

  truncateFuture(state);
  const evt: EditEvent = {
    type: 'modify',
    timestamp: Date.now(),
    slot_ids: after.map((s) => slotKey(s)),
    before,
    after,
  };
  state.editHistory.push(evt);
  state.editIndex++;
  for (const slot of after) {
    if (slot.slot_id.trim()) {
      markProdSlotDirty(state, slot.slot_id);
    }
  }
  markAbsmapDirty(state);
  log.info(
    before.length === 1
      ? `Slot type set: ${slotKey(before[0]!).slice(0, 8)}… → ${slot_type}`
      : `Slot type set (${before.length} slots) → ${slot_type}`,
  );
}

const slice = createSlice({
  name: 'autocalib',
  initialState: absmapInitialState as AbsmapDomainState,
  reducers: {
    setAbsmapViewState(state, action: PayloadAction<{ longitude: number; latitude: number; zoom: number }>) {
      state.absmapViewState = action.payload;
    },

    setImagerySource(state, action: PayloadAction<ImagerySource>) {
      state.imagerySource = action.payload;
      saveImagerySourceToStorage(action.payload);
    },

    addCrop(state, action: PayloadAction<CropRequest>) {
      const cropsBefore = state.crops.map(cloneCropForHistory);
      state.crops.push(action.payload);
      state.overlayVisibility.roi = true;
      recordCropHistory(state, cropsBefore);
      markAbsmapDirty(state);
      log.info(`Crop added (#${state.crops.length})`);
    },

    removeCrop(state, action: PayloadAction<number>) {
      if (action.payload < 0 || action.payload >= state.crops.length) return;
      const cropsBefore = state.crops.map(cloneCropForHistory);
      state.crops.splice(action.payload, 1);
      if (state.crops.length === 0) {
        state.overlayVisibility.roi = false;
      }
      recordCropHistory(state, cropsBefore);
      markAbsmapDirty(state);
      log.info(`Crop removed (#${action.payload + 1})`);
    },

    clearCrops(state) {
      if (state.crops.length === 0) return;
      const cropsBefore = state.crops.map(cloneCropForHistory);
      state.crops = [];
      state.overlayVisibility.roi = false;
      recordCropHistory(state, cropsBefore);
      markAbsmapDirty(state);
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

    setSlotSelection(state, action: PayloadAction<string[]>) {
      state.selection = action.payload
        .map((id) => normalizeSlotId(id))
        .filter(Boolean);
    },

    toggleSlotInSelection(state, action: PayloadAction<string>) {
      const id = normalizeSlotId(action.payload);
      if (!id) return;
      const idx = state.selection.indexOf(id);
      if (idx >= 0) {
        state.selection.splice(idx, 1);
      } else {
        state.selection.push(id);
      }
    },

    clearSlotSelection(state) {
      state.selection = [];
    },

    setMarkerDisplayMode(state, action: PayloadAction<MarkerDisplayMode>) {
      state.markerDisplayMode = action.payload;
    },

    straightenSetAnchor(state, action: PayloadAction<string | null>) {
      state.straightenAnchorSlotId = action.payload;
      state.straightenError = null;
    },

    addSlot(state, action: PayloadAction<Slot>) {
      truncateFuture(state);
      const slot = ensureDraftSlot(action.payload);
      const evt: EditEvent = {
        type: 'add',
        timestamp: Date.now(),
        slot_ids: [slotKey(slot)],
        before: [],
        after: [slot],
      };
      state.editHistory.push(evt);
      state.editIndex++;
      applyEvent(state, evt);
      markAbsmapDirty(state);
      log.info(`Slot added: ${slotKey(slot).slice(0, 8)}…`);
    },

    deleteMapSlot(state, action: PayloadAction<string>) {
      const slotId = action.payload;
      const inWorking = state.slots.find((s) => slotKey(s) === slotId);
      if (inWorking) {
        truncateFuture(state);
        const baseline_before = state.baselineSlots.map(cloneSlotForHistory);
        const baseline_after = state.baselineSlots
          .filter((s) => slotKey(s) !== slotId)
          .map(cloneSlotForHistory);
        const baselineChanged = baseline_after.length !== baseline_before.length;
        const evt: EditEvent = {
          type: 'delete',
          timestamp: Date.now(),
          slot_ids: [slotId],
          before: [cloneSlotForHistory(inWorking)],
          after: [],
          ...(baselineChanged ? { baseline_before, baseline_after } : {}),
        };
        state.editHistory.push(evt);
        state.editIndex++;
        applyEvent(state, evt);
        markProdDeletesForRemovedSlot(state, inWorking, slotId);
        markAbsmapDirty(state);
        log.info(`Slot deleted: ${slotId.slice(0, 8)}…`);
        return;
      }
      const inBaseline = state.baselineSlots.find((s) => slotKey(s) === slotId);
      if (inBaseline) {
        truncateFuture(state);
        const baseline_before = state.baselineSlots.map(cloneSlotForHistory);
        const baseline_after = state.baselineSlots
          .filter((s) => slotKey(s) !== slotId)
          .map(cloneSlotForHistory);
        const evt: EditEvent = {
          type: 'delete',
          timestamp: Date.now(),
          slot_ids: [slotId],
          before: [cloneSlotForHistory(inBaseline)],
          after: [],
          baseline_before,
          baseline_after,
        };
        state.editHistory.push(evt);
        state.editIndex++;
        applyEvent(state, evt);
        markProdDeletesForRemovedSlot(state, inBaseline, slotId);
        markAbsmapDirty(state);
        log.info(`Baseline slot deleted: ${slotId.slice(0, 8)}…`);
        return;
      }

      const inProd = state.b2bSnapshotAtLoad.find((s) => s.slot_id.trim() === slotId);
      if (inProd) {
        truncateFuture(state);
        const evt: EditEvent = {
          type: 'delete',
          timestamp: Date.now(),
          slot_ids: [slotId],
          before: [cloneSlotForHistory(inProd)],
          after: [],
        };
        state.editHistory.push(evt);
        state.editIndex++;
        markProdSlotDeleted(state, slotId);
        markAbsmapDirty(state);
        log.info(`Prod slot deleted: ${slotId.slice(0, 8)}…`);
      }
    },

    bulkDeleteSlots(state, action: PayloadAction<string[]>) {
      const idSet = new Set(action.payload);
      const before: Slot[] = [];
      const prodOnly: Slot[] = [];
      for (const id of action.payload) {
        const inSession = state.slots.find((s) => slotKey(s) === id);
        if (inSession) {
          before.push(cloneSlotForHistory(inSession));
          continue;
        }
        const inBaseline = state.baselineSlots.find((s) => slotKey(s) === id);
        if (inBaseline) {
          before.push(cloneSlotForHistory(inBaseline));
          continue;
        }
        const inProd = state.b2bSnapshotAtLoad.find((s) => s.slot_id.trim() === id);
        if (inProd) prodOnly.push(cloneSlotForHistory(inProd));
      }
      const baseline_before = state.baselineSlots.map(cloneSlotForHistory);
      const baseline_after = state.baselineSlots
        .filter((s) => !idSet.has(slotKey(s)))
        .map(cloneSlotForHistory);
      const baselineChanged = baseline_after.length !== baseline_before.length;

      if (before.length === 0 && prodOnly.length === 0) return;
      truncateFuture(state);
      if (before.length > 0) {
        const evt: EditEvent = {
          type: 'bulk_delete',
          timestamp: Date.now(),
          slot_ids: before.map((s) => slotKey(s)),
          before,
          after: [],
          ...(baselineChanged ? { baseline_before, baseline_after } : {}),
        };
        state.editHistory.push(evt);
        state.editIndex++;
        applyEvent(state, evt);
        markProdDeletesForRemovedSlots(state, before, before.map((s) => slotKey(s)));
      }
      for (const prod of prodOnly) {
        const prodId = prod.slot_id.trim();
        if (!prodId) continue;
        const evt: EditEvent = {
          type: 'delete',
          timestamp: Date.now(),
          slot_ids: [prodId],
          before: [prod],
          after: [],
        };
        state.editHistory.push(evt);
        state.editIndex++;
        markProdSlotDeleted(state, prodId);
      }
      markAbsmapDirty(state);
      log.info(`Bulk delete: ${before.length} session, ${prodOnly.length} prod slot(s)`);
    },

    modifySlot(state, action: PayloadAction<Slot>) {
      const updated = action.payload;
      const slotId = slotKey(updated);

      const applyModify = (before: Slot) => {
        truncateFuture(state);
        const evt: EditEvent = {
          type: 'modify',
          timestamp: Date.now(),
          slot_ids: [slotId],
          before: [{ ...before }],
          after: [updated],
        };
        state.editHistory.push(evt);
        state.editIndex++;
        if (updated.slot_id.trim()) {
          markProdSlotDirty(state, updated.slot_id);
        }
        markAbsmapDirty(state);
      };

      const upsertWorkingSlot = () => {
        const idx = state.slots.findIndex((s) => slotKey(s) === slotId);
        if (idx !== -1) {
          state.slots[idx] = updated;
        } else {
          state.slots.push(updated);
        }
      };

      const inWorking = state.slots.find((s) => slotKey(s) === slotId);
      if (inWorking) {
        applyModify(inWorking);
        upsertWorkingSlot();
        log.info(`Slot modified: ${slotId.slice(0, 8)}…`);
        return;
      }

      const bIdx = state.baselineSlots.findIndex((s) => slotKey(s) === slotId);
      if (bIdx !== -1) {
        const before = state.baselineSlots[bIdx]!;
        state.baselineSlots[bIdx] = updated;
        applyModify(before);
        upsertWorkingSlot();
        log.info(`Baseline slot modified: ${slotId.slice(0, 8)}…`);
        return;
      }

      const inProd = state.b2bSnapshotAtLoad.find((s) => s.slot_id.trim() === slotId);
      if (inProd) {
        applyModify(inProd);
        upsertWorkingSlot();
        log.info(`Prod slot modified: ${slotId.slice(0, 8)}…`);
      }
    },

    setSlotParkingType(
      state,
      action: PayloadAction<{ slotId: string; slot_type: ParkingSlotType }>,
    ) {
      applyBulkSlotParkingType(state, [action.payload.slotId], action.payload.slot_type);
    },

    bulkSetSlotsParkingType(
      state,
      action: PayloadAction<{ slotIds: string[]; slot_type: ParkingSlotType }>,
    ) {
      applyBulkSlotParkingType(state, action.payload.slotIds, action.payload.slot_type);
    },

    undo(state) {
      if (state.editIndex <= 0) return;
      coalesceTrailingCropEvents(state);

      const evt = state.editHistory[state.editIndex - 1]!;
      state.editIndex -= 1;
      reverseEvent(state, evt);
      if (evt.type === 'tile_row') {
        clearTileRowWizard(state);
      }
      markAbsmapDirty(state);
      if (evt.type === 'add' && evt.after.length > 1) {
        log.info(`Undo: add (${evt.after.length} slots)`);
      } else if (evt.type === 'crops') {
        log.info(`Undo: crops (${evt.crops_after?.length ?? 0} ROI)`);
      } else if (isPipelineLoadEvent(evt)) {
        log.info('Undo: launch');
      } else {
        log.info(`Undo: ${evt.type}`);
      }
    },

    redo(state) {
      if (state.editIndex >= state.editHistory.length) return;
      const evt = state.editHistory[state.editIndex]!;
      applyEvent(state, evt);
      state.editIndex++;
      markAbsmapDirty(state);
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
      markAbsmapDirty(state);

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

    tileRowSetROI(state, action: PayloadAction<OrientedRect | null>) {
      state.tileRowROI = action.payload;
    },

    tileRowPushSeed(state, action: PayloadAction<Slot>) {
      state.tileRowSeeds.push(action.payload);
      const roi = state.tileRowROI;
      const seeds = state.tileRowSeeds;
      if (!roi || seeds.length === 0) {
        state.tileRowProposed = [];
        return;
      }
      const orientationSource = seeds[0];
      state.tileRowProposed = sanitizeTileRowProposals(
        seeds.flatMap((s) =>
          generateRowProposals(roi, s, { orientationSource }),
        ),
        roi,
      );
    },

    tileRowPopSeed(state) {
      state.tileRowSeeds.pop();
      const roi = state.tileRowROI;
      const seeds = state.tileRowSeeds;
      if (!roi || seeds.length === 0) {
        state.tileRowProposed = [];
        return;
      }
      const orientationSource = seeds[0];
      state.tileRowProposed = sanitizeTileRowProposals(
        seeds.flatMap((s) =>
          generateRowProposals(roi, s, { orientationSource }),
        ),
        roi,
      );
    },

    tileRowSetProposed(state, action: PayloadAction<Slot[]>) {
      state.tileRowProposed = action.payload;
    },

    tileRowAccept(state) {
      const proposed = state.tileRowProposed;
      if (proposed.length === 0) return;

      const existingFootprints = mergeSlotsForPlacementHints(
        state.slots,
        state.baselineSlots,
        state.b2bSnapshotAtLoad,
      );
      const knownKeys = new Set(existingFootprints.map((s) => slotKey(s)));
      const toCommit = excludeSlotsOverlappingExisting(
        proposed.filter((s) => !knownKeys.has(slotKey(s))),
        existingFootprints,
      );
      if (toCommit.length === 0) {
        clearTileRowWizard(state);
        return;
      }

      truncateFuture(state);
      const evt: EditEvent = {
        type: 'tile_row',
        timestamp: Date.now(),
        slot_ids: toCommit.map((s) => s.slot_id),
        before: [],
        after: toCommit.map(cloneSlotForHistory),
      };
      state.editHistory.push(evt);
      state.editIndex++;
      applyEvent(state, evt);
      markAbsmapDirty(state);

      clearTileRowWizard(state);
      log.info(`Tile-row accepted: ${toCommit.length} slots committed`);
    },

    cloneRowAccept(state) {
      const proposed = state.tileRowProposed;
      if (proposed.length === 0) return;

      const knownIds = new Set([
        ...state.slots.map((s) => s.slot_id),
        ...state.baselineSlots.map((s) => s.slot_id),
      ]);
      const toCommit = proposed.filter((s) => !knownIds.has(s.slot_id));
      if (toCommit.length === 0) {
        clearTileRowWizard(state);
        return;
      }

      truncateFuture(state);
      const evt: EditEvent = {
        type: 'add',
        timestamp: Date.now(),
        slot_ids: toCommit.map((s) => s.slot_id),
        before: [],
        after: toCommit.map(cloneSlotForHistory),
      };
      state.editHistory.push(evt);
      state.editIndex++;
      applyEvent(state, evt);
      markAbsmapDirty(state);

      clearTileRowWizard(state);
      log.info(`Row duplicate accepted: ${toCommit.length} slot(s) committed`);
    },

    tileRowReject(state) {
      const n = state.tileRowProposed.length;
      state.tileRowROI = null;
      state.tileRowSeeds = [];
      state.tileRowProposed = [];
      log.info(`Tile-row rejected: ${n} proposals discarded`);
    },

    tileRowReset(state) {
      state.tileRowROI = null;
      state.tileRowSeeds = [];
      state.tileRowProposed = [];
    }
  },
});

export const absmapReducer = slice.reducer;
export const {
  setAbsmapViewState,
  setImagerySource,
  addCrop,
  removeCrop,
  clearCrops,
  updateJobProgress,
  toggleDualMap,
  markJobFailed,
  toggleOverlay,
  setEditMode,
  straightenSetAnchor,
  addSlot,
  deleteMapSlot,
  bulkDeleteSlots,
  modifySlot,
  setSlotParkingType,
  bulkSetSlotsParkingType,
  undo,
  redo,
  rejectStraighten,
  reprocessSetRef,
  reprocessSetScope,
  reprocessAccept,
  reprocessReject,
  reprocessReset,
  tileRowSetROI,
  tileRowPushSeed,
  tileRowPopSeed,
  tileRowSetProposed,
  tileRowAccept,
  cloneRowAccept,
  tileRowReject,
  tileRowReset,
  setSlotSelection,
  toggleSlotInSelection,
  clearSlotSelection,
  setMarkerDisplayMode,
} = slice.actions;
