import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { PairingEditEvent, PairingLink, PairingTool, PairingZone, PairingZonePolygon } from '../../types';
import { PAIR_PALETTE } from '../../types';
import type { PairingState } from '../autocalib-state-types';
import {
  pairingInitial,
  truncatePairingFuture,
  applyPairingEvent,
  reversePairingEvent,
  log,
} from './shared';

let pairingLinkCounter = 0;
let pairingZoneCounter = 0;

const slice = createSlice({
  name: 'autocalib',
  initialState: pairingInitial as PairingState,
  reducers: {
    pairingSetTool(state, action: PayloadAction<PairingTool>) {
      const prev = state.activeTool;
      const next = action.payload;
      state.activeTool = next;
      state.selectedSlotId = null;
      state.selectedBboxId = null;
      state.suggestion = null;

      /* Keep in-progress lassos only while staying in draw_zone; clear on exit. */
      if (next !== 'draw_zone') {
        state.drawingMapPoints = [];
        state.drawingImagePoints = [];
      } else if (prev !== 'draw_zone') {
        state.drawingMapPoints = [];
        state.drawingImagePoints = [];
      }
    },

    pairingSelectSlot(state, action: PayloadAction<string>) {
      const slotId = action.payload;
      const { activeTool } = state;

      if (activeTool === 'pair') {
        state.selectedSlotId = slotId;
        if (state.selectedBboxId !== null) {
          const bboxId = state.selectedBboxId;
          const already = state.links.find(
            (l) => l.slotId === slotId && l.bboxSpotId === bboxId,
          );
          if (!already) {
            truncatePairingFuture(state);
            pairingLinkCounter++;
            const newLink: PairingLink = {
              id: `link-${pairingLinkCounter}`,
              slotId,
              bboxSpotId: bboxId,
              colorIndex: pairingLinkCounter % PAIR_PALETTE.length,
            };
            const evt: PairingEditEvent = { type: 'links_added', links: [newLink] };
            state.editHistory.push(evt);
            state.editIndex++;
            applyPairingEvent(state, evt);
            log.info(`Pairing: slot=${slotId} ↔ bbox=${bboxId}`);
          }
          state.selectedSlotId = null;
          state.selectedBboxId = null;
        }
      } else if (activeTool === 'unpair') {
        const link = state.links.find((l) => l.slotId === slotId);
        if (!link) return;
        truncatePairingFuture(state);
        const evt: PairingEditEvent = { type: 'links_removed', links: [{ ...link }] };
        state.editHistory.push(evt);
        state.editIndex++;
        applyPairingEvent(state, evt);
        log.info(`Pairing removed: ${link.id}`);
      }
    },

    pairingSelectBbox(state, action: PayloadAction<number>) {
      const bboxId = action.payload;
      const { activeTool } = state;

      if (activeTool === 'pair') {
        state.selectedBboxId = bboxId;
        if (state.selectedSlotId !== null) {
          const slotId = state.selectedSlotId;
          const already = state.links.find(
            (l) => l.slotId === slotId && l.bboxSpotId === bboxId,
          );
          if (!already) {
            truncatePairingFuture(state);
            pairingLinkCounter++;
            const newLink: PairingLink = {
              id: `link-${pairingLinkCounter}`,
              slotId,
              bboxSpotId: bboxId,
              colorIndex: pairingLinkCounter % PAIR_PALETTE.length,
            };
            const evt: PairingEditEvent = { type: 'links_added', links: [newLink] };
            state.editHistory.push(evt);
            state.editIndex++;
            applyPairingEvent(state, evt);
            log.info(`Pairing: slot=${slotId} ↔ bbox=${bboxId}`);
          }
          state.selectedSlotId = null;
          state.selectedBboxId = null;
        }
      } else if (activeTool === 'unpair') {
        const link = state.links.find((l) => l.bboxSpotId === bboxId);
        if (!link) return;
        truncatePairingFuture(state);
        const evt: PairingEditEvent = { type: 'links_removed', links: [{ ...link }] };
        state.editHistory.push(evt);
        state.editIndex++;
        applyPairingEvent(state, evt);
        log.info(`Pairing removed: ${link.id}`);
      }
    },

    pairingAddDrawingPoint(state, action: PayloadAction<{ target: 'map' | 'image'; point: [number, number] }>) {
      const { target, point } = action.payload;
      if (target === 'map') {
        state.drawingMapPoints.push(point);
      } else {
        state.drawingImagePoints.push(point);
      }
    },

    pairingSetDrawingPoints(
      state,
      action: PayloadAction<{ target: 'map' | 'image'; points: [number, number][] }>,
    ) {
      const { target, points } = action.payload;
      if (target === 'map') {
        state.drawingMapPoints = points;
      } else {
        state.drawingImagePoints = points;
      }
    },

    pairingClearDrawing(state, action: PayloadAction<'map' | 'image'>) {
      if (action.payload === 'map') {
        state.drawingMapPoints = [];
      } else {
        state.drawingImagePoints = [];
      }
    },

    pairingCommitZone(state, action: PayloadAction<{
      mapPolygon: PairingZonePolygon;
      imagePolygon: PairingZonePolygon;
      mapSlotIds: string[];
      imageBboxIds: number[];
    }>) {
      const { mapPolygon, imagePolygon, mapSlotIds, imageBboxIds } = action.payload;

      if (mapSlotIds.length !== imageBboxIds.length || mapSlotIds.length === 0) {
        state.zoneMismatchError =
          mapSlotIds.length === 0 && imageBboxIds.length === 0
            ? 'Both zones are empty — draw around some items.'
            : `Count mismatch: ${mapSlotIds.length} slots vs ${imageBboxIds.length} bboxes. Redraw to match.`;
        log.debug('pairingCommitZone rejected', {
          mapSlotIds,
          imageBboxIds,
          error: state.zoneMismatchError,
        });
        state.activeTool = 'none';
        state.drawingMapPoints = [];
        state.drawingImagePoints = [];
        return;
      }

      state.zoneMismatchError = null;
      pairingZoneCounter++;
      const zoneColorIdx = (pairingZoneCounter - 1) % PAIR_PALETTE.length;
      const zone: PairingZone = {
        id: `zone-${pairingZoneCounter}`,
        mapPolygon,
        imagePolygon,
        mapSlotIds,
        imageBboxIds,
        matched: true,
        colorIndex: zoneColorIdx,
      };

      const autoLinks: PairingLink[] = mapSlotIds.map((slotId, i) => {
        pairingLinkCounter++;
        return {
          id: `link-${pairingLinkCounter}`,
          slotId,
          bboxSpotId: imageBboxIds[i]!,
          colorIndex: pairingLinkCounter % PAIR_PALETTE.length,
        };
      });

      truncatePairingFuture(state);
      const evt: PairingEditEvent = { type: 'zone_added', zone, autoLinks };
      state.editHistory.push(evt);
      state.editIndex++;
      applyPairingEvent(state, evt);

      state.activeTool = 'none';
      state.selectedSlotId = null;
      state.selectedBboxId = null;
      state.drawingMapPoints = [];
      state.drawingImagePoints = [];
      log.info(`Zone committed + auto-paired: ${zone.id} (${autoLinks.length} pairs, color=${zoneColorIdx})`);
      log.debug('pairingCommitZone ok', {
        zoneId: zone.id,
        pairs: autoLinks.map((l) => `${l.slotId.slice(0, 8)}…↔#${l.bboxSpotId}`),
        pairingBySlotId: Object.keys(state.pairingBySlotId).length,
      });
    },

    pairingDismissMismatchError(state) {
      state.zoneMismatchError = null;
    },

    pairingSetActiveZone(state, action: PayloadAction<{ zoneId: string | null; side: 'map' | 'image' | null }>) {
      state.activeZoneId = action.payload.zoneId;
      state.activeZoneSide = action.payload.zoneId ? action.payload.side : null;
      state.suggestion = null;
    },

    pairingReverseZoneLinks(state, action: PayloadAction<{
      side: 'map' | 'image';
      zoneId?: string;
      slotIds: string[];
      bboxSpotIds: number[];
    }>) {
      const { zoneId, side, slotIds, bboxSpotIds } = action.payload;
      if (slotIds.length !== bboxSpotIds.length || slotIds.length === 0) return;

      const zone = zoneId ? state.zones.find((z) => z.id === zoneId) : undefined;
      if (zoneId && (!zone || !zone.matched)) return;

      const slotSet = new Set(slotIds);
      const bboxSet = new Set(bboxSpotIds);
      const oldLinks = state.links.filter(
        (l) => slotSet.has(l.slotId) && bboxSet.has(l.bboxSpotId),
      );
      if (oldLinks.length === 0) return;

      const newSlotIds = side === 'map' ? [...slotIds].reverse() : [...slotIds];
      const newBboxIds = side === 'image' ? [...bboxSpotIds].reverse() : [...bboxSpotIds];
      const oldColorBySlot = new Map(oldLinks.map((l) => [l.slotId, l.colorIndex]));
      const newLinks: PairingLink[] = newSlotIds.map((slotId, i) => {
        pairingLinkCounter++;
        return {
          id: `link-${pairingLinkCounter}`,
          slotId,
          bboxSpotId: newBboxIds[i]!,
          colorIndex: oldColorBySlot.get(slotId) ?? (pairingLinkCounter % PAIR_PALETTE.length),
        };
      });

      truncatePairingFuture(state);
      const evt: PairingEditEvent = {
        type: 'zone_reversed',
        zoneId,
        side,
        oldLinks: oldLinks.map((l) => ({ ...l })),
        newLinks,
      };
      state.editHistory.push(evt);
      state.editIndex++;
      applyPairingEvent(state, evt);
      log.info(
        zoneId
          ? `Zone ${zoneId} ${side}-side toggled (${newLinks.length} pairs)`
          : `Prod pairing ${side}-side reversed (${newLinks.length} pairs)`,
      );
    },

    pairingDeleteZone(state, action: PayloadAction<string>) {
      const zoneId = action.payload;
      const zone = state.zones.find((z) => z.id === zoneId);
      if (!zone) return;
      const slotSet = new Set(zone.mapSlotIds);
      const bboxSet = new Set(zone.imageBboxIds);
      const zoneLinks = state.links.filter(
        (l) => slotSet.has(l.slotId) && bboxSet.has(l.bboxSpotId),
      );
      truncatePairingFuture(state);
      const evt: PairingEditEvent = {
        type: 'zone_deleted',
        zone: { ...zone },
        links: zoneLinks.map((l) => ({ ...l })),
      };
      state.editHistory.push(evt);
      state.editIndex++;
      applyPairingEvent(state, evt);
      log.info(`Zone deleted: ${zoneId} (${zoneLinks.length} links)`);
    },

    pairingSuggestForZone(state, action: PayloadAction<{ zoneId: string; reversed: boolean }>) {
      const { zoneId, reversed } = action.payload;
      const zone = state.zones.find((z) => z.id === zoneId);
      if (!zone || !zone.matched) return;

      const slotIds = [...zone.mapSlotIds];
      const bboxIds = reversed ? [...zone.imageBboxIds].reverse() : [...zone.imageBboxIds];

      const suggestedLinks: PairingLink[] = slotIds.map((slotId, i) => ({
        id: `sug-${zoneId}-${i}`,
        slotId,
        bboxSpotId: bboxIds[i]!,
      }));

      state.suggestion = { zoneId, links: suggestedLinks, reversed };
      log.info(`Zone suggestion: ${suggestedLinks.length} links for zone ${zoneId} (reversed=${reversed})`);
    },

    pairingConfirmSuggestion(state) {
      const { suggestion } = state;
      if (!suggestion) return;
      const added: PairingLink[] = [];
      for (const link of suggestion.links) {
        const exists = state.links.find(
          (l) => l.slotId === link.slotId && l.bboxSpotId === link.bboxSpotId,
        );
        if (!exists) {
          pairingLinkCounter++;
          added.push({
            ...link,
            id: `link-${pairingLinkCounter}`,
            colorIndex: pairingLinkCounter % PAIR_PALETTE.length,
          });
        }
      }
      if (added.length > 0) {
        truncatePairingFuture(state);
        const evt: PairingEditEvent = { type: 'links_added', links: added };
        state.editHistory.push(evt);
        state.editIndex++;
        state.links.push(...added);
      }
      log.info(`Zone suggestion applied: ${suggestion.links.length} pairs (${added.length} new)`);
      state.suggestion = null;
    },

    pairingRejectSuggestion(state) {
      state.suggestion = null;
    },

    pairingUnpairActiveZone(state) {
      const zoneId = state.activeZoneId;
      if (!zoneId) return;
      const zone = state.zones.find((z) => z.id === zoneId);
      if (!zone) return;
      const slotSet = new Set(zone.mapSlotIds);
      const bboxSet = new Set(zone.imageBboxIds);
      const zoneLinks = state.links.filter(
        (l) => slotSet.has(l.slotId) && bboxSet.has(l.bboxSpotId),
      );
      truncatePairingFuture(state);
      const evt: PairingEditEvent = {
        type: 'zone_deleted',
        zone: { ...zone },
        links: zoneLinks.map((l) => ({ ...l })),
      };
      state.editHistory.push(evt);
      state.editIndex++;
      applyPairingEvent(state, evt);
      log.info(`Zone unpair: ${zoneLinks.length} link(s) removed + zone ${zoneId} deleted`);
    },

    pairingUndo(state) {
      if (state.editIndex <= 0) return;
      state.editIndex--;
      const evt = state.editHistory[state.editIndex]!;
      reversePairingEvent(state, evt);
      log.info(`Pairing undo: ${evt.type}`);
    },

    pairingRedo(state) {
      if (state.editIndex >= state.editHistory.length) return;
      const evt = state.editHistory[state.editIndex]!;
      applyPairingEvent(state, evt);
      state.editIndex++;
      log.info(`Pairing redo: ${evt.type}`);
    },

    pairingReset(state) {
      Object.assign(state, pairingInitial);
    },

    pairingBulkAddLinks(state, action: PayloadAction<PairingLink[]>) {
      const added: PairingLink[] = [];
      for (const link of action.payload) {
        const exists = state.links.find(
          (l) => l.slotId === link.slotId && l.bboxSpotId === link.bboxSpotId,
        );
        if (!exists) {
          pairingLinkCounter++;
          added.push({
            ...link,
            id: `link-${pairingLinkCounter}`,
            colorIndex: pairingLinkCounter % PAIR_PALETTE.length,
          });
        }
      }
      if (added.length === 0) return;
      truncatePairingFuture(state);
      const evt: PairingEditEvent = { type: 'links_added', links: added };
      state.editHistory.push(evt);
      state.editIndex++;
      applyPairingEvent(state, evt);
    },

    pairingToggleAutoSuggestMode(state) {
      state.autoSuggestMode = !state.autoSuggestMode;
      state.autoSuggest = null;
      if (state.autoSuggestMode) {
        state.activeTool = 'none';
      }
      log.info(`Auto-suggest mode: ${state.autoSuggestMode ? 'ON' : 'OFF'}`);
    },

    pairingAcceptAutoSuggestion(state) {
      const as = state.autoSuggest;
      if (!as || as.proposalIndex >= as.proposals.length) return;
      const proposal = as.proposals[as.proposalIndex]!;

      pairingZoneCounter++;
      const zoneColorIdx = (pairingZoneCounter - 1) % PAIR_PALETTE.length;
      const zone: PairingZone = {
        id: `zone-${pairingZoneCounter}`,
        mapPolygon: proposal.mapPolygon,
        imagePolygon: proposal.imagePolygon,
        mapSlotIds: proposal.mapSlotIds,
        imageBboxIds: proposal.imageBboxIds,
        matched: true,
        colorIndex: zoneColorIdx,
      };

      const autoLinks: PairingLink[] = proposal.mapSlotIds.map((slotId, i) => {
        pairingLinkCounter++;
        return {
          id: `link-${pairingLinkCounter}`,
          slotId,
          bboxSpotId: proposal.imageBboxIds[i]!,
          colorIndex: pairingLinkCounter % PAIR_PALETTE.length,
        };
      });

      truncatePairingFuture(state);
      const evt: PairingEditEvent = { type: 'zone_added', zone, autoLinks };
      state.editHistory.push(evt);
      state.editIndex++;
      applyPairingEvent(state, evt);

      state.autoSuggest = null;
      log.info(`Auto-suggest accepted: ${zone.id} (${autoLinks.length} pairs)`);
    },

    pairingRejectAutoSuggestion(state) {
      const as = state.autoSuggest;
      if (!as) return;
      const nextIdx = as.proposalIndex + 1;
      if (nextIdx >= as.proposals.length) {
        state.autoSuggest = null;
        state.zoneMismatchError = 'No more proposals — draw the other zone manually.';
        log.info('Auto-suggest: all proposals rejected');
      } else {
        as.proposalIndex = nextIdx;
        log.info(`Auto-suggest: rejected, showing proposal ${nextIdx + 1}/${as.proposals.length}`);
      }
    },

    pairingCancelAutoSuggest(state) {
      state.autoSuggest = null;
      log.info('Auto-suggest proposal cancelled');
    }
  },
});

export const pairingReducer = slice.reducer;
export const {
  pairingSetTool,
  pairingSelectSlot,
  pairingSelectBbox,
  pairingAddDrawingPoint,
  pairingSetDrawingPoints,
  pairingClearDrawing,
  pairingCommitZone,
  pairingDismissMismatchError,
  pairingSetActiveZone,
  pairingReverseZoneLinks,
  pairingDeleteZone,
  pairingSuggestForZone,
  pairingConfirmSuggestion,
  pairingRejectSuggestion,
  pairingUnpairActiveZone,
  pairingUndo,
  pairingRedo,
  pairingReset,
  pairingBulkAddLinks,
  pairingToggleAutoSuggestMode,
  pairingAcceptAutoSuggestion,
  pairingRejectAutoSuggestion,
  pairingCancelAutoSuggest,
} = slice.actions;
