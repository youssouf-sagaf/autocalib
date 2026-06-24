import axios from 'axios';
import { createAsyncThunk } from '@reduxjs/toolkit';
import { normalizeSlotParkingType } from '../theme/slotTypes';
import type { Slot } from '../types';
import {
  clientDirectoryKey,
  isB2bClientId,
  resolveClientFromDirectoryKey,
} from '../utils/clientContext';
import * as api from '../api/autocalib-api';
import { createLogger } from '../utils/logger';
import { loadCalibLocalCache } from '../utils/calibLocalCache';
import {
  buildCalibrationSaveRequest,
  buildCalibBboxProdMetaFromLoad,
  buildCalibrationBboxesByKey,
  calibrationBboxKeysRemoved,
  calibrationSlotKeysAdded,
  diffCalibrationBboxes,
  diffPairingBySlotId,
  formatCalibrationSlotLabels,
  formatRemovedCalibBboxLabels,
} from '../utils/calibrationDb';
import { clearAbsmapJobCache, loadAbsmapJobId } from '../utils/absmapLocalCache';
import { assembleDirtySavePayload } from '../utils/absmap-dirty';
import { resolveAbsmapDisplaySlots } from '../utils/absmapDisplaySlots';
import { formatPairingSaveLabels } from '../utils/pairing-map';
import { dirtyPayloadExpectsCreates } from '../utils/slots-save';
import type { AutocalibRootState, LegacyAutocalibState } from './slices/nested-state';
import { legacyAutocalibFromRoot } from './slices/nested-state';
import { slotsSnapshotForStraighten } from './slices/shared';

const thunkLog = createLogger('store');

function readAutocalib(getState: () => unknown): LegacyAutocalibState {
  const { autocalib } = getState() as { autocalib: AutocalibRootState };
  return legacyAutocalibFromRoot(autocalib);
}

/* ── Calib async thunks ── */

export const submitCalibJob = createAsyncThunk(
  'autocalib/submitCalibJob',
  async (_, { getState }) => {
    const autocalib = readAutocalib(getState);
    const deviceId = autocalib.calib.deviceId || autocalib.context.deviceId;
    const client =
      autocalib.calib.client ||
      autocalib.context.clientName ||
      autocalib.context.clientId;
    const { confidenceThreshold } = autocalib.calib;
    thunkLog.info(`Submitting calib job for device ${deviceId}`);
    const job = await api.submitCalibJob({
      device_id: deviceId,
      client,
      confidence_threshold: confidenceThreshold,
    });
    thunkLog.info(`Calib job created: ${job.id}`);
    return job;
  },
  {
    condition(_, { getState }) {
      const autocalib = readAutocalib(getState);
      const deviceId = autocalib.calib.deviceId || autocalib.context.deviceId;
      const client =
        autocalib.calib.client ||
        autocalib.context.clientName ||
        autocalib.context.clientId;
      if (!deviceId.trim() || !client.trim()) {
        return false;
      }
      const { jobStatus } = autocalib.calib;
      if (jobStatus === 'pending' || jobStatus === 'running') {
        return false;
      }
      return true;
    },
  },
);

export const fetchCalibResult = createAsyncThunk(
  'autocalib/fetchCalibResult',
  async (jobId: string) => {
    thunkLog.info(`Fetching calib result for job ${jobId}`);
    const result = await api.getCalibJobResult(jobId);
    thunkLog.info(`Calib result: ${result.calib_bboxes.length} bboxes from ${result.frame_count} frames`);
    return result;
  },
);

/** Restore calib editor state from localStorage for the given client/device (or empty calib if none). */
export const hydrateCalibFromLocalCache = createAsyncThunk(
  'autocalib/hydrateCalibFromLocalCache',
  async ({ client, deviceId }: { client: string; deviceId: string }, { getState }) => {
    const revisionAtDispatch = readAutocalib(getState).calib.sessionRevision;
    const snap = loadCalibLocalCache(client, deviceId);
    return { snap, revisionAtDispatch };
  },
);

/** Load calibration from prod static_data; fall back to localStorage draft on 404/503. */
export const loadDeviceCalibration = createAsyncThunk(
  'autocalib/loadDeviceCalibration',
  async ({ client, deviceId }: { client: string; deviceId: string }, { dispatch, getState }) => {
    const revisionAtDispatch = readAutocalib(getState).calib.sessionRevision;
    thunkLog.info(`Loading device calibration from DB for ${deviceId}`);
    try {
      const data = await api.getDeviceCalibration(deviceId);
      thunkLog.info(`DB calibration: ${data.bboxes.length} bbox(es) for ${deviceId}`);
      return { source: 'db' as const, data, client, deviceId, revisionAtDispatch };
    } catch (error) {
      if (
        axios.isAxiosError(error) &&
        (error.response?.status === 404 || error.response?.status === 503)
      ) {
        thunkLog.info(`No DB calibration for ${deviceId} — local cache fallback`);
        await dispatch(hydrateCalibFromLocalCache({ client, deviceId })).unwrap();
        return { source: 'local' as const, client, deviceId, revisionAtDispatch };
      }
      throw error;
    }
  },
);

export const saveDeviceCalibration = createAsyncThunk(
  'autocalib/saveDeviceCalibration',
  async (_, { getState }) => {
    const autocalib = readAutocalib(getState);
    const deviceId = autocalib.context.deviceId || autocalib.calib.deviceId;
    if (!deviceId) {
      throw new Error('No device selected');
    }
    const pairingSave = autocalib.workspaceMode === 'pairing';
    const dbBboxKeys = autocalib.calib.calibrationDbBboxKeys;
    const absmapSlots = resolveAbsmapDisplaySlots({
      slots: autocalib.slots,
      baselineSlots: autocalib.baselineSlots,
      b2bSnapshotAtLoad: autocalib.b2bSnapshotAtLoad,
      slotMapDisplayMode: autocalib.slotMapDisplayMode,
      deletedProdIds: autocalib.deletedProdIds,
    });
    thunkLog.debug('saveDeviceCalibration pre-build', {
      deviceId,
      pairingSave,
      workspaceMode: autocalib.workspaceMode,
      pairingBySlotId: Object.entries(autocalib.pairing.pairingBySlotId).map(
        ([slotId, spotId]) => `${slotId.slice(0, 8)}…↔#${spotId}`,
      ),
      zones: autocalib.pairing.zones.length,
      absmap: {
        workspace: autocalib.slots.length,
        baseline: autocalib.baselineSlots.length,
        b2bSnapshot: autocalib.b2bSnapshotAtLoad.length,
        display: absmapSlots.length,
        mode: autocalib.slotMapDisplayMode,
      },
    });
    const pairingBySlotIdForSave = pairingSave
      ? autocalib.pairing.pairingBySlotId
      : autocalib.calib.prodPairingBySlotId;
    const body = buildCalibrationSaveRequest({
      bboxes: autocalib.calib.bboxes,
      pairingBySlotId: pairingBySlotIdForSave,
      absmapSlots,
      imageWidth: autocalib.calib.imageWidth,
      imageHeight: autocalib.calib.imageHeight,
      dbSlots: autocalib.calib.calibrationDbSlots,
      pairingSave,
    });
    const removedBboxKeys = calibrationBboxKeysRemoved(dbBboxKeys, body.bboxes);
    const removedBboxLabels = formatRemovedCalibBboxLabels(
      removedBboxKeys,
      autocalib.calib.calibrationDbBboxMeta,
      autocalib.pairing.pairingBySlotId,
    );
    thunkLog.info(
      `Saving calibration to DB for ${deviceId}: ${body.bboxes.length} bbox(es), ` +
        `${Object.keys(body.slots).length} slot(s), reset=${body.reset}, ` +
        `removed=${removedBboxKeys.length}` +
        (removedBboxLabels.length > 0 ? ` [${removedBboxLabels.join(', ')}]` : ''),
    );
    if (pairingSave && Object.keys(body.slots).length === 0) {
      thunkLog.warn(
        'Pairing save: calibration.slots is empty — Cocopilot will not allocate slots',
        { pairingLinks: Object.keys(autocalib.pairing.pairingBySlotId).length },
      );
    }
    const result = await api.saveDeviceCalibration(deviceId, body);
    const savedBboxKeys = body.bboxes
      .map((b) => (b.slot_id ?? '').trim() || String(b.spot_id).trim())
      .filter(Boolean);
    const savedSlotKeys = Object.keys(body.slots);
    const addedSlotKeys = calibrationSlotKeysAdded(autocalib.calib.calibrationDbSlots, body.slots);
    const pairedLabels = formatPairingSaveLabels(
      autocalib.pairing.pairingBySlotId,
      autocalib.calib.bboxes,
    );
    const pairingSummary = pairingSave
      ? (() => {
          const previous = autocalib.calib.prodPairingBySlotId;
          const diff = diffPairingBySlotId(previous, autocalib.pairing.pairingBySlotId);
          return {
            created: diff.added,
            updated: diff.modified,
            deleted: diff.deleted,
            total_slots: savedSlotKeys.length,
          };
        })()
      : undefined;
    const calibSummary = !pairingSave
      ? (() => {
          const diff = diffCalibrationBboxes(
            autocalib.calib.calibrationDbBboxesByKey,
            body.bboxes,
          );
          return {
            created: diff.added,
            updated: diff.modified,
            deleted: diff.deleted,
            total_slots: body.bboxes.length,
          };
        })()
      : undefined;
    const saveSummary = pairingSummary ?? calibSummary;
    if (saveSummary) {
      thunkLog.debug('calibration save diff', saveSummary);
    }
    return {
      result,
      deviceId,
      bboxCount: body.bboxes.length,
      removedBboxKeys,
      removedBboxLabels,
      savedSlots: body.slots,
      savedBboxKeys,
      savedBboxMeta: buildCalibBboxProdMetaFromLoad(body.bboxes),
      savedBboxesByKey: buildCalibrationBboxesByKey(body.bboxes),
      slotCount: savedSlotKeys.length,
      savedSlotLabels: formatCalibrationSlotLabels(savedSlotKeys),
      addedSlotCount: addedSlotKeys.length,
      addedSlotLabels: formatCalibrationSlotLabels(addedSlotKeys),
      pairedCount: pairedLabels.length,
      pairedLabels,
      saveSummary,
      pairingSave,
    };
  },
);

/** Alias — calib and pairing headers use the same prod save path. */
export const saveCalibrationFromState = saveDeviceCalibration;

/* ── Directory async thunks (clients + devices) ── */

export type FetchDevicesForClientArg =
  | string
  | {
      clientId: string;
      displayName: string;
      directoryKey: string;
      refreshUpstream?: boolean;
    };

export function parseFetchDevicesArg(arg: FetchDevicesForClientArg): {
  clientId: string;
  displayName: string;
  directoryKey: string;
  refreshUpstream: boolean;
} {
  if (typeof arg === 'string') {
    const key = arg.trim();
    return { clientId: isB2bClientId(key) ? key : '', displayName: isB2bClientId(key) ? '' : key, directoryKey: key, refreshUpstream: false };
  }
  return {
    clientId: arg.clientId,
    displayName: arg.displayName,
    directoryKey: arg.directoryKey,
    refreshUpstream: Boolean(arg.refreshUpstream),
  };
}

export const fetchClients = createAsyncThunk(
  'autocalib/fetchClients',
  async (refreshUpstream?: boolean) => {
    thunkLog.info(refreshUpstream ? 'Fetching client directory (upstream cache bypass)' : 'Fetching client directory');
    const clients = await api.getClients(refreshUpstream ? { refresh: true } : undefined);
    thunkLog.info(`Client directory: ${clients.length} clients`);
    return clients;
  },
  {
    /** Skip duplicates unless forcing upstream reload; still defer when already loading. */
    condition: (refreshUpstream, { getState }) => {
      const autocalib = readAutocalib(getState);
      const status = autocalib.directory.clientsStatus;
      if (refreshUpstream === true) return status !== 'loading';
      return status !== 'loading' && status !== 'ready';
    },
  },
);

export const fetchDevicesForClient = createAsyncThunk(
  'autocalib/fetchDevicesForClient',
  async (rawArg: FetchDevicesForClientArg, { getState }) => {
    const autocalib = readAutocalib(getState);
    let { clientId, displayName, directoryKey, refreshUpstream } = parseFetchDevicesArg(rawArg);
    if (typeof rawArg === 'string' && autocalib.directory.clients.length > 0) {
      const resolved = resolveClientFromDirectoryKey(rawArg, autocalib.directory.clients);
      clientId = resolved.clientId;
      displayName = resolved.clientName;
      directoryKey = clientDirectoryKey(resolved.clientId, resolved.clientName);
    }
    thunkLog.info(
      `Fetching devices for ${displayName || clientId}${refreshUpstream ? ' (upstream cache bypass)' : ''}`,
    );
    const devices = await api.getDevicesForClient(clientId || displayName, {
      displayName: displayName || undefined,
      refresh: refreshUpstream,
    });
    thunkLog.info(`Devices for ${directoryKey}: ${devices.length}`);
    return { clientId: directoryKey, devices };
  },
  {
    condition: (rawArg, { getState }) => {
      const { directoryKey, refreshUpstream } = parseFetchDevicesArg(rawArg);
      const autocalib = readAutocalib(getState);
      const status = autocalib.directory.devicesStatus[directoryKey];
      if (refreshUpstream) return status !== 'loading';
      return status !== 'loading' && status !== 'ready';
    },
  },
);

/* ── Pairing async thunks ── */

/** @deprecated Use saveCalibrationFromState — pairing JSON store removed. */
export const savePairings = createAsyncThunk(
  'autocalib/savePairings',
  async (_, { dispatch }) => {
    const calibResult = await dispatch(saveCalibrationFromState()).unwrap();
    return {
      ok: true,
      device_id: calibResult.deviceId,
      saved_at: new Date().toISOString(),
      saved_to: 'cocospot static_data.calibration',
      bbox_count: calibResult.bboxCount,
    };
  },
);

/** @deprecated Pairing zones JSON store removed — zones are session-only. */
export const loadPairings = createAsyncThunk(
  'autocalib/loadPairings',
  async () => null,
);

/* ── Absmap async thunks ── */

export const launchJob = createAsyncThunk(
  'autocalib/launchJob',
  async (_, { getState }) => {
    const autocalib = readAutocalib(getState);
    thunkLog.info(
      `Submitting job with ${autocalib.crops.length} crop(s) (imagery=${autocalib.imagerySource})`,
    );
    const job = await api.submitJob({
      crops: autocalib.crops,
      imagery_source: autocalib.imagerySource,
    });
    thunkLog.info(`Job created: ${job.id}, status=${job.status}`);
    return job;
  },
);

export type FetchJobResultArg =
  | string
  | { jobId: string; markDirty?: boolean };

export function parseFetchJobResultArg(
  arg: FetchJobResultArg,
): { jobId: string; markDirty: boolean } {
  if (typeof arg === 'string') {
    return { jobId: arg, markDirty: true };
  }
  return { jobId: arg.jobId, markDirty: arg.markDirty ?? true };
}

export type FetchJobResultReject = { code: 'JOB_NOT_FOUND'; jobId: string };

export const fetchJobResult = createAsyncThunk(
  'autocalib/fetchJobResult',
  async (arg: FetchJobResultArg, { rejectWithValue }) => {
    const { jobId } = parseFetchJobResultArg(arg);
    thunkLog.info(`Fetching result for job ${jobId}`);
    try {
      const result = await api.getJobResult(jobId);
      thunkLog.info(
        `Result received: ${result.slots.length} slots, ${result.baseline_slots.length} baseline`,
      );
      return result;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return rejectWithValue({ code: 'JOB_NOT_FOUND', jobId } satisfies FetchJobResultReject);
      }
      throw error;
    }
  },
);

/** After reload, restore the last merged result for this client/device if bookmarked locally. */
export const restoreAbsmapJobFromCache = createAsyncThunk(
  'autocalib/restoreAbsmapJobFromCache',
  async (
    { clientName, deviceId }: { clientName: string; deviceId: string },
    { dispatch, getState },
  ) => {
    if (!clientName || !deviceId) return;
    const autocalib = readAutocalib(getState);
    if (autocalib.workspaceMode !== 'absmap') return;

    const cached = loadAbsmapJobId(clientName, deviceId);
    if (!cached) return;

    const hasSlots =
      autocalib.slots.length > 0 || autocalib.baselineSlots.length > 0;
    if (autocalib.job?.id === cached && hasSlots) {
      return;
    }

    if (
      autocalib.job?.id === cached &&
      (autocalib.job.status === 'pending' || autocalib.job.status === 'running')
    ) {
      return;
    }

    try {
      await dispatch(fetchJobResult({ jobId: cached, markDirty: false })).unwrap();
    } catch {
      clearAbsmapJobCache(clientName, deviceId);
      thunkLog.info(
        `Absmap cache stale for ${clientName} (job ${cached.slice(0, 8)}… missing on API — relaunch if needed)`,
      );
    }
  },
);

export const saveSlotsToB2b = createAsyncThunk(
  'autocalib/saveSlotsToB2b',
  async (_, { getState }) => {
    const autocalib = readAutocalib(getState);
    if (!autocalib.isDirty) {
      return { skipped: true as const };
    }
    const clientId = autocalib.context.clientId.trim();
    const clientDisplayName = autocalib.context.clientName.trim();
    if (!clientId && !clientDisplayName) {
      throw new Error('No client selected');
    }
    const jobId = autocalib.job?.id;
    const { dirtySlots, deletedProdIds } = assembleDirtySavePayload(autocalib);
    const expectsCreates = dirtyPayloadExpectsCreates(dirtySlots);
    thunkLog.info(
      `Saving ${dirtySlots.length} dirty slot(s), ${deletedProdIds.length} prod delete(s) for client ${clientId || clientDisplayName}`,
    );
    const result = await api.saveClientSlots(
      clientId || clientDisplayName,
      {
        slots: dirtySlots,
        deleted_prod_ids: deletedProdIds,
        baseline_slots: autocalib.baselineSlots,
        edit_events: autocalib.editHistory
          .slice(0, autocalib.editIndex)
          .filter((evt) => evt.type !== 'crops')
          .map(({ baseline_before: _bb, baseline_after: _ba, crops_before: _cb, crops_after: _ca, ...evt }) => ({
            ...evt,
            type: evt.type === 'tile_row' ? 'add' : evt.type,
          })),
        reprocessed_steps: autocalib.reprocessedSteps,
        difficulty_tags: [],
        client_display_name: clientDisplayName || undefined,
        job_id: jobId,
      },
      { displayName: clientDisplayName || undefined },
    );
    thunkLog.info(
      `B2B save ok: created=${result.save_summary.created} updated=${result.save_summary.updated} deleted=${result.save_summary.deleted}`,
    );
    return {
      skipped: false as const,
      result,
      clientId: clientId || clientDisplayName,
      expectsCreates,
    };
  },
);

function parseReferenceSlot(raw: Record<string, unknown>): Slot {
  const center = raw.center as { lat: number; lng: number };
  return normalizeSlotParkingType({
    slot_id: String(raw.slot_id),
    center: { lat: center.lat, lng: center.lng },
    polygon: raw.polygon as GeoJSON.Polygon,
    source: 'manual',
    confidence: Number(raw.confidence ?? 1),
    status: 'unknown',
    slot_type: (raw.slot_type as Slot['slot_type']) ?? 'common',
  });
}

function cropCentroid(crops: { polygon: GeoJSON.Polygon }[]): { lat: number; lng: number } | null {
  if (!crops.length) return null;
  const ring = crops[0]!.polygon.coordinates[0];
  if (!ring?.length) return null;
  let latSum = 0;
  let lngSum = 0;
  let n = 0;
  for (const coord of ring) {
    const lng = coord[0];
    const lat = coord[1];
    if (lng == null || lat == null) continue;
    latSum += lat;
    lngSum += lng;
    n += 1;
  }
  if (!n) return null;
  return { lat: latSum / n, lng: lngSum / n };
}

export const loadClientSlots = createAsyncThunk(
  'autocalib/loadClientSlots',
  async (_, { getState }) => {
    const t0 = performance.now();
    const autocalib = readAutocalib(getState);
    const clientId = autocalib.context.clientId.trim();
    const clientName = autocalib.context.clientName.trim();
    if (!clientId && !clientName) return [];

    const hasB2bId = isB2bClientId(clientId);
    const cropCenter = cropCentroid(autocalib.crops);
    const directoryKey = clientDirectoryKey(clientId, clientName);
    const clientLoc = directoryKey
      ? autocalib.directory.clientLocations[directoryKey] ?? null
      : null;
    const geoCenter =
      cropCenter ??
      (clientLoc ? { lat: clientLoc.lat, lng: clientLoc.lng } : undefined);

    if (!hasB2bId && !geoCenter) {
      thunkLog.info('Reference overlay: waiting for B2B client location or ROI');
      return [];
    }

    const cropRadiusM = autocalib.crops.length > 0 ? 500 : 2500;
    const setupMs = Math.round(performance.now() - t0);

    const tApi = performance.now();
    const data = await api.fetchReferenceSlots({
      clientId,
      displayName: clientName || undefined,
      cropCenter: hasB2bId ? undefined : geoCenter,
      cropRadiusM,
    });
    const apiMs = Math.round(performance.now() - tApi);

    const tParse = performance.now();
    const parsed = data.results.map(parseReferenceSlot);
    const parseMs = Math.round(performance.now() - tParse);

    thunkLog.info(
      `loadClientSlots: setup=${setupMs}ms, api=${apiMs}ms, parse=${parseMs}ms, total=${Math.round(performance.now() - t0)}ms → ${parsed.length} slot(s)`,
    );
    return parsed;
  },
  {
    condition: (_, { getState }) => !readAutocalib(getState).isRefreshingReferenceOverlay,
  },
);

export const reprocessArea = createAsyncThunk(
  'autocalib/reprocessArea',
  async (
    args: { referenceSlot: Slot; scopePolygon: GeoJSON.Polygon },
    { getState },
  ) => {
    const autocalib = readAutocalib(getState);
    const jobId = autocalib.job?.id;
    if (!jobId) throw new Error('No active job');
    thunkLog.info(
      `Reprocess request: ref=${args.referenceSlot.slot_id.slice(0, 8)}… on job ${jobId}`,
    );
    const result = await api.reprocessArea(jobId, {
      reference_slot: args.referenceSlot,
      scope_polygon: args.scopePolygon,
    });
    thunkLog.info(`Reprocess response: ${result.proposed_slots.length} proposed slots`);
    return result.proposed_slots as Slot[];
  },
);

export const straightenRow = createAsyncThunk(
  'autocalib/straightenRow',
  async (
    anchors: { slot_id_a: string; slot_id_b: string },
    { getState },
  ) => {
    const autocalib = readAutocalib(getState);
    const slotsSnapshot = slotsSnapshotForStraighten(autocalib.slots, autocalib.baselineSlots);
    if (slotsSnapshot.length === 0) {
      throw new Error('No slots to align');
    }
    const jobId = autocalib.job?.id ?? crypto.randomUUID();
    thunkLog.info(
      `Straighten request: ${anchors.slot_id_a.slice(0, 8)}… / ${anchors.slot_id_b.slice(0, 8)}… (${slotsSnapshot.length} slots in snapshot)`,
    );
    const result = await api.straightenRow(jobId, {
      ...anchors,
      slots: slotsSnapshot,
    });
    const proposed = result.proposed_slots as Slot[];
    thunkLog.info(`Straighten response: ${proposed.length} corrected slots`);
    return { proposed };
  },
);


