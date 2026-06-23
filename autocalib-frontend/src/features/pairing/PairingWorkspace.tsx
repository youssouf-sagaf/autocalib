import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import {
  pairingSetTool,
  pairingCommitZone,
  pairingClearDrawing,
  pairingSetActiveZone,
  pairingDeleteZone,
  pairingDismissMismatchError,
  pairingAutoSuggestZoneDrawn,
  pairingAcceptAutoSuggestion,
  pairingRejectAutoSuggestion,
  pairingCancelAutoSuggest,
  pairingRedo,
  pairingUndo,
  pairingToggleAutoSuggestMode,
  loadDeviceCalibration,
  loadClientSlots,
} from '../../store/autocalib-slice';
import { activeClientDirectoryKey, isB2bClientId } from '../../utils/clientContext';
import { PAIR_PALETTE } from '../../types';
import { AppShell } from '../layout/AppShell';
import { PairingStatusBar } from './PairingStatusBar';
import { PairingMapPanel } from './PairingMapPanel';
import { PairingImagePanel } from './PairingImagePanel';
import { PairingEditRail } from './PairingEditRail';
import { PairingLinkOverlay } from './PairingLinkOverlay';
import { Banner } from '../../ui/Banner';
import { Kbd } from '../../ui/Kbd';
import { useAbsmapDisplaySlots } from '../../hooks/useAbsmapDisplaySlots';
import { pointInRing, slotInLngLatLasso } from '../../utils/geoHitTest';
import type { PairingTool } from '../../types';
import { visibleCalibBboxes } from '../../utils/calibVisibility';
import { createLogger } from '../../utils/logger';
import { usePairingSaveConfirm } from '../../hooks/usePairingSaveConfirm';
import { usePairingVisuals } from '../../hooks/usePairingVisuals';
import { usePairingReverse } from '../../hooks/usePairingReverse';
import { invokePairingSaveRequest } from '../../hooks/pairingSaveGate';
import { PairingUnpairConfirmModal } from './PairingUnpairConfirmModal';
import { PairingZoneConfirmModal } from './PairingZoneConfirmModal';
import styles from './PairingWorkspace.module.css';

const zoneLog = createLogger('pairing-zone');

const PAIRING_SPLIT_STORAGE_KEY = 'autocalib.pairing.splitTopRatio';
const SPLIT_MIN = 0.15;
const SPLIT_MAX = 0.85;

function readStoredSplitRatio(): number {
  try {
    const raw = sessionStorage.getItem(PAIRING_SPLIT_STORAGE_KEY);
    if (raw == null) return 0.5;
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n)) return 0.5;
    return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, n));
  } catch {
    return 0.5;
  }
}

export function PairingWorkspace() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const pairing = useAppSelector((s) => s.autocalib.pairing);
  const { pendingChanges } = usePairingVisuals();
  const pairingSaveConfirm = usePairingSaveConfirm();
  const { canReverse, handleReverse } = usePairingReverse();
  const slots = useAbsmapDisplaySlots();
  const bboxes = useAppSelector((s) => s.autocalib.calib.bboxes);
  const confidenceThreshold = useAppSelector((s) => s.autocalib.calib.confidenceThreshold);
  const pairingVisibleBboxes = useMemo(
    () => visibleCalibBboxes(bboxes, confidenceThreshold),
    [bboxes, confidenceThreshold],
  );
  const calibDeviceId = useAppSelector((s) => s.autocalib.calib.deviceId);
  const calibClient = useAppSelector((s) => s.autocalib.calib.client);
  const calibJobId = useAppSelector((s) => s.autocalib.calib.jobId);
  const calibJobStatus = useAppSelector((s) => s.autocalib.calib.jobStatus);
  const contextClient = useAppSelector((s) =>
    s.autocalib.context.clientName || s.autocalib.context.clientId,
  );
  const contextDeviceId = useAppSelector((s) => s.autocalib.context.deviceId);
  const contextDirectoryKey = useAppSelector((s) => activeClientDirectoryKey(s.autocalib.context));
  const contextB2bClientId = useAppSelector((s) => s.autocalib.context.clientId.trim());
  const contextClientNameForRef = useAppSelector((s) => s.autocalib.context.clientName.trim());
  const cropsLen = useAppSelector((s) => s.autocalib.absmap.crops.length);
  const clientLocation = useAppSelector((s) =>
    contextDirectoryKey
      ? s.autocalib.directory.clientLocations[contextDirectoryKey] ?? null
      : null,
  );

  useEffect(() => {
    if (!contextClientNameForRef && !contextB2bClientId) return;
    const canLoadWithB2bId = isB2bClientId(contextB2bClientId);
    const canLoadWithGeo = cropsLen > 0 || clientLocation != null;
    if (canLoadWithB2bId || canLoadWithGeo) {
      void dispatch(loadClientSlots());
    }
  }, [
    dispatch,
    contextB2bClientId,
    contextClientNameForRef,
    cropsLen,
    clientLocation?.lat,
    clientLocation?.lng,
  ]);

  useEffect(() => {
    if (!contextDeviceId || !contextClient) return;

    const aligned =
      calibDeviceId === contextDeviceId &&
      calibClient === contextClient;

    const hasResolvedCalib =
      aligned &&
      calibJobStatus === 'done' &&
      Boolean(calibJobId);

    if (hasResolvedCalib) {
      return;
    }

    if (!calibDeviceId || calibDeviceId !== contextDeviceId || calibClient !== contextClient) {
      dispatch(loadDeviceCalibration({ client: contextClient, deviceId: contextDeviceId }));
    }
  }, [
    dispatch,
    contextDeviceId,
    contextClient,
    calibDeviceId,
    calibClient,
    calibJobStatus,
    calibJobId,
  ]);

  const { activeTool, links, zones, drawingMapPoints, drawingImagePoints, zoneMismatchError, activeZoneId, activeZoneSide, autoSuggestMode, autoSuggest } = pairing;
  const hasProposal = autoSuggest !== null;
  const currentProposal = hasProposal ? autoSuggest.proposals[autoSuggest.proposalIndex] ?? null : null;

  const zonePairedCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const zone of zones) {
      const slotSet = new Set(zone.mapSlotIds);
      const bboxSet = new Set(zone.imageBboxIds);
      const paired = links.filter((l) => slotSet.has(l.slotId) && bboxSet.has(l.bboxSpotId)).length;
      counts.set(zone.id, paired);
    }
    return counts;
  }, [zones, links]);

  const mapPanelRef = useRef<HTMLDivElement>(null);
  const imagePanelRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelsRef = useRef<HTMLDivElement>(null);
  const splitDraggingRef = useRef(false);
  const topRatioRef = useRef(0.5);

  const [topSplitRatio, setTopSplitRatio] = useState(() => readStoredSplitRatio());
  const [zoneConfirmOpen, setZoneConfirmOpen] = useState(false);
  topRatioRef.current = topSplitRatio;

  const updateSplitFromClientY = useCallback((clientY: number) => {
    const el = panelsRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const h = rect.height;
    if (h <= 0) return;
    const r = (clientY - rect.top) / h;
    setTopSplitRatio(Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, r)));
  }, []);

  const persistSplitRatio = useCallback((r: number) => {
    try {
      sessionStorage.setItem(PAIRING_SPLIT_STORAGE_KEY, String(r));
    } catch {
      /* ignore quota / private mode */
    }
  }, []);

  const onSplitPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!e.isPrimary) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      splitDraggingRef.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      updateSplitFromClientY(e.clientY);
    },
    [updateSplitFromClientY],
  );

  const onSplitPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!splitDraggingRef.current || !e.isPrimary) return;
      updateSplitFromClientY(e.clientY);
    },
    [updateSplitFromClientY],
  );

  const onSplitPointerUpOrCancel = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* capture already cleared */
    }
  }, []);

  const onSplitLostPointerCapture = useCallback(() => {
    if (!splitDraggingRef.current) return;
    splitDraggingRef.current = false;
    persistSplitRatio(topRatioRef.current);
  }, [persistSplitRatio]);

  const onSplitDoubleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setTopSplitRatio(0.5);
    persistSplitRatio(0.5);
  }, [persistSplitRatio]);

  /** Commit zone when both polygons are ready. */
  const zoneDraft = useMemo(() => {
    if (drawingMapPoints.length < 3 || drawingImagePoints.length < 3) return null;

    const mapSlotIds = slots
      .filter((s) => slotInLngLatLasso(s, drawingMapPoints))
      .sort((a, b) => a.center.lng - b.center.lng || a.center.lat - b.center.lat)
      .map((s) => s.slot_id);
    const imageBboxIds = pairingVisibleBboxes
      .filter((b) => pointInRing(b.center_x, b.center_y, drawingImagePoints))
      .sort((a, b) => a.center_x - b.center_x || a.center_y - b.center_y)
      .map((b) => b.spot_id);

    return { mapSlotIds, imageBboxIds };
  }, [drawingMapPoints, drawingImagePoints, slots, pairingVisibleBboxes]);

  const commitBothZones = useCallback(() => {
    if (!zoneDraft) return;

    zoneLog.debug('commitBothZones', {
      displaySlotsPool: slots.length,
      mapLassoPts: drawingMapPoints.length,
      imageLassoPts: drawingImagePoints.length,
      mapSlotIds: zoneDraft.mapSlotIds,
      imageBboxIds: zoneDraft.imageBboxIds,
      match: zoneDraft.mapSlotIds.length === zoneDraft.imageBboxIds.length,
    });

    dispatch(pairingCommitZone({
      mapPolygon: { points: drawingMapPoints },
      imagePolygon: { points: drawingImagePoints },
      mapSlotIds: zoneDraft.mapSlotIds,
      imageBboxIds: zoneDraft.imageBboxIds,
    }));
  }, [dispatch, drawingMapPoints, drawingImagePoints, slots.length, zoneDraft]);

  const requestZoneCommit = useCallback(() => {
    if (!zoneDraft) return;
    setZoneConfirmOpen(true);
  }, [zoneDraft]);

  const confirmZoneCommit = useCallback(() => {
    setZoneConfirmOpen(false);
    commitBothZones();
    invokePairingSaveRequest();
  }, [commitBothZones]);

  const cancelZoneCommit = useCallback(() => {
    setZoneConfirmOpen(false);
  }, []);

  /** Map lasso done → auto-suggest mode proposes image side; normal mode chains. */
  const handleMapZoneFinished = useCallback(() => {
    if (drawingMapPoints.length < 3) return;
    if (autoSuggestMode) {
      const mapSlotIds = slots
        .filter((s) => slotInLngLatLasso(s, drawingMapPoints))
        .sort((a, b) => a.center.lng - b.center.lng || a.center.lat - b.center.lat)
        .map((s) => s.slot_id);
      dispatch(pairingAutoSuggestZoneDrawn({
        side: 'map',
        polygon: { points: drawingMapPoints },
        slotIds: mapSlotIds,
        bboxIds: [],
      }));
      return;
    }
    if (drawingImagePoints.length >= 3) {
      requestZoneCommit();
    }
  }, [dispatch, drawingMapPoints, drawingImagePoints, requestZoneCommit, autoSuggestMode, slots]);

  /** Image lasso done → auto-suggest mode proposes map side; normal mode chains. */
  const handleImageZoneFinished = useCallback(() => {
    if (drawingImagePoints.length < 3) return;
    if (autoSuggestMode) {
      const imageBboxIds = pairingVisibleBboxes
        .filter((b) => pointInRing(b.center_x, b.center_y, drawingImagePoints))
        .sort((a, b) => a.center_x - b.center_x || a.center_y - b.center_y)
        .map((b) => b.spot_id);
      dispatch(pairingAutoSuggestZoneDrawn({
        side: 'image',
        polygon: { points: drawingImagePoints },
        slotIds: [],
        bboxIds: imageBboxIds,
      }));
      return;
    }
    if (drawingMapPoints.length >= 3) {
      requestZoneCommit();
    }
  }, [dispatch, drawingImagePoints, drawingMapPoints, requestZoneCommit, autoSuggestMode, pairingVisibleBboxes]);

  /**
   * Auto-commit when the second zone's lasso completes (its drawing points
   * jump from 0 to >=3) and the first zone is already drawn.
   */
  const prevImagePtsLen = useRef(0);
  const prevMapPtsLen = useRef(0);
  useEffect(() => {
    const imgLen = drawingImagePoints.length;
    const mapLen = drawingMapPoints.length;

    const imgJustDrawn = imgLen >= 3 && prevImagePtsLen.current === 0;
    const mapJustDrawn = mapLen >= 3 && prevMapPtsLen.current === 0;

    if (activeTool === 'draw_zone') {
      if (imgJustDrawn && mapLen >= 3) {
        requestZoneCommit();
      } else if (mapJustDrawn && imgLen >= 3) {
        requestZoneCommit();
      }
    }

    prevImagePtsLen.current = imgLen;
    prevMapPtsLen.current = mapLen;
  }, [activeTool, drawingImagePoints, drawingMapPoints, requestZoneCommit]);

  useEffect(() => {
    if (!zoneConfirmOpen) return;
    if (drawingMapPoints.length < 3 || drawingImagePoints.length < 3) {
      setZoneConfirmOpen(false);
    }
  }, [zoneConfirmOpen, drawingMapPoints.length, drawingImagePoints.length]);

  useEffect(() => {
    if (!zoneMismatchError) return;
    const t = setTimeout(() => dispatch(pairingDismissMismatchError()), 5000);
    return () => clearTimeout(t);
  }, [dispatch, zoneMismatchError]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      const key = e.key.toLowerCase();
      const mod = e.metaKey || e.ctrlKey;

      if (zoneConfirmOpen) {
        if (key === 'enter') {
          e.preventDefault();
          if (
            zoneDraft
            && zoneDraft.mapSlotIds.length === zoneDraft.imageBboxIds.length
            && zoneDraft.mapSlotIds.length > 0
          ) {
            confirmZoneCommit();
          }
          return;
        }
        if (key === 'escape') {
          e.preventDefault();
          cancelZoneCommit();
          return;
        }
        return;
      }

      if (hasProposal) {
        if (key === 'enter') {
          e.preventDefault();
          dispatch(pairingAcceptAutoSuggestion());
          return;
        }
        if (key === 'escape') {
          e.preventDefault();
          dispatch(pairingCancelAutoSuggest());
          return;
        }
        if (key === 'n' || key === 'arrowright') {
          e.preventDefault();
          dispatch(pairingRejectAutoSuggestion());
          return;
        }
        return;
      }

      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) dispatch(pairingRedo());
        else dispatch(pairingUndo());
        return;
      }
      if (mod && key === 'y') {
        e.preventDefault();
        dispatch(pairingRedo());
        return;
      }

      if (key === 'escape') {
        e.preventDefault();
        dispatch(pairingSetTool('none'));
        return;
      }

      const toolMap: Record<string, PairingTool> = {
        p: 'pair',
        u: 'unpair',
        z: 'draw_zone',
      };
      if (!mod && !e.altKey && toolMap[key]) {
        e.preventDefault();
        dispatch(pairingSetTool(activeTool === toolMap[key] ? 'none' : toolMap[key]));
        return;
      }

      if (!mod && !e.altKey && key === 'q') {
        e.preventDefault();
        dispatch(pairingToggleAutoSuggestMode());
        return;
      }

      if (key === 'backspace' || key === 'delete') {
        if (activeTool === 'draw_zone') {
          if (drawingMapPoints.length >= 3 && drawingImagePoints.length < 3) {
            dispatch(pairingClearDrawing('map'));
          } else if (drawingImagePoints.length >= 3 && drawingMapPoints.length < 3) {
            dispatch(pairingClearDrawing('image'));
          } else {
            dispatch(pairingClearDrawing('map'));
            dispatch(pairingClearDrawing('image'));
          }
        } else if (activeZoneId) {
          e.preventDefault();
          dispatch(pairingDeleteZone(activeZoneId));
        }
        return;
      }

      if (key === 'f' || key === 'enter') {
        if (activeTool === 'draw_zone') {
          if (drawingMapPoints.length >= 3 && drawingImagePoints.length >= 3) {
            e.preventDefault();
            requestZoneCommit();
            return;
          }
          if (drawingMapPoints.length >= 3) {
            e.preventDefault();
            handleMapZoneFinished();
            return;
          }
          if (drawingImagePoints.length >= 3) {
            e.preventDefault();
            handleImageZoneFinished();
            return;
          }
        }
      }

      if (key === 'r' && canReverse && activeTool === 'none') {
        e.preventDefault();
        handleReverse();
        return;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dispatch, activeTool, activeZoneId, hasProposal, zoneConfirmOpen, zoneDraft, drawingMapPoints, drawingImagePoints, handleMapZoneFinished, handleImageZoneFinished, requestZoneCommit, confirmZoneCommit, cancelZoneCommit, canReverse, handleReverse]);

  return (
    <AppShell
      statusBar={
        <PairingStatusBar
          activeTool={activeTool}
          pairsCount={links.length}
          bboxCount={pairingVisibleBboxes.length}
          zonesCount={zones.length}
          autoSuggestMode={autoSuggestMode}
          pendingChanges={pendingChanges}
          mapPtsLen={drawingMapPoints.length}
          imgPtsLen={drawingImagePoints.length}
          zoneMismatchError={zoneMismatchError}
        />
      }
    >
      <div className={styles.workspace} ref={containerRef}>
        {/* Proposal review banner (actions need inline buttons) */}
        {hasProposal && currentProposal && autoSuggest ? (
          <Banner
            variant="primary"
            subline={
              <span className={styles.suggestActions}>
                <button type="button" className={styles.suggestAccept} onClick={() => dispatch(pairingAcceptAutoSuggestion())}>
                  {t('pairing.accept')} <Kbd tone="accent">Enter</Kbd>
                </button>
                <button type="button" className={styles.suggestReject} onClick={() => dispatch(pairingRejectAutoSuggestion())}>
                  {t('pairing.skip')} <Kbd tone="accent">→</Kbd>
                </button>
                <button type="button" className={styles.suggestCancel} onClick={() => dispatch(pairingCancelAutoSuggest())}>
                  {t('common.cancel')} <Kbd tone="accent">Esc</Kbd>
                </button>
              </span>
            }
          >
            <Trans
              i18nKey="pairing.proposalBanner"
              values={{
                current: autoSuggest.proposalIndex + 1,
                total: autoSuggest.proposals.length,
                slots: currentProposal.mapSlotIds.length,
                bboxes: currentProposal.imageBboxIds.length,
              }}
              components={{ strong: <strong /> }}
            />
          </Banner>
        ) : null}

        <div className={styles.panels} ref={panelsRef}>
          <div className={styles.pairPane} style={{ flex: `${topSplitRatio} 1 0px` }}>
            <PairingMapPanel
              panelRef={mapPanelRef}
              onFinishDrawing={handleMapZoneFinished}
              previewZone={currentProposal ? { polygon: currentProposal.mapPolygon, slotIds: currentProposal.mapSlotIds } : undefined}
            />
          </div>

          <div className={styles.splitHandleArea}>
            <div
              className={styles.splitDragZone}
              role="separator"
              aria-orientation="horizontal"
              aria-label={t('pairing.splitResizeAria')}
              aria-valuemin={Math.round(SPLIT_MIN * 100)}
              aria-valuemax={Math.round(SPLIT_MAX * 100)}
              aria-valuenow={Math.round(topSplitRatio * 100)}
              onPointerDown={onSplitPointerDown}
              onPointerMove={onSplitPointerMove}
              onPointerUp={onSplitPointerUpOrCancel}
              onPointerCancel={onSplitPointerUpOrCancel}
              onLostPointerCapture={onSplitLostPointerCapture}
              onDoubleClick={onSplitDoubleClick}
            />
            <div className={styles.pairingRailFloating}>
              <PairingEditRail />
            </div>
          </div>

          <div className={styles.pairPane} style={{ flex: `${1 - topSplitRatio} 1 0px` }}>
            <PairingImagePanel
              panelRef={imagePanelRef}
              onFinishDrawing={handleImageZoneFinished}
              previewZone={currentProposal ? { polygon: currentProposal.imagePolygon, bboxIds: currentProposal.imageBboxIds } : undefined}
            />
          </div>

          <PairingLinkOverlay
            mapPanelRef={mapPanelRef}
            imagePanelRef={imagePanelRef}
            containerRef={containerRef}
          />
        </div>

        {/* Zone chips bar */}
        {zones.length > 0 && (
          <div className={styles.zoneBar}>
            {zones.map((zone) => {
              const zColor = PAIR_PALETTE[zone.colorIndex % PAIR_PALETTE.length] ?? '#37bc9b';
              const isActive = zone.id === activeZoneId;
              return (
                <button
                  key={zone.id}
                  className={`${styles.zoneChip} ${isActive ? styles.zoneChipActive : ''}`}
                  style={{
                    borderColor: zColor,
                    backgroundColor: isActive ? `${zColor}30` : undefined,
                  }}
                  onClick={() => {
                    dispatch(pairingSetActiveZone({ zoneId: isActive ? null : zone.id, side: isActive ? null : activeZoneSide }));
                    dispatch(pairingSetTool('none'));
                  }}
                  title={t('pairing.zoneChipTitle', {
                    slots: zone.mapSlotIds.length,
                    bboxes: zone.imageBboxIds.length,
                  })}
                >
                  <span
                    className={styles.zoneColorDot}
                    style={{ backgroundColor: zColor }}
                  />
                  <span className={styles.zoneCounts}>
                    {zone.mapSlotIds.length}↔{zone.imageBboxIds.length}
                  </span>
                  {(zonePairedCounts.get(zone.id) ?? 0) > 0 && (
                    <span className={styles.zonePaired}>
                      {zonePairedCounts.get(zone.id)} {t('common.paired')}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <PairingUnpairConfirmModal
        open={pairingSaveConfirm.open}
        deletedCount={pairingSaveConfirm.deletedCount}
        onConfirm={pairingSaveConfirm.confirmSave}
        onCancel={pairingSaveConfirm.cancelSave}
      />
      <PairingZoneConfirmModal
        open={zoneConfirmOpen}
        slotCount={zoneDraft?.mapSlotIds.length ?? 0}
        bboxCount={zoneDraft?.imageBboxIds.length ?? 0}
        onConfirm={confirmZoneCommit}
        onCancel={cancelZoneCommit}
      />
    </AppShell>
  );
}
