import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import {
  calibSetActiveFrame,
  calibSetEditMode,
  calibUndo,
  calibRedo,
  calibToggleLock,
  calibBulkRemove,
  calibClearSelection,
  loadDeviceCalibration,
  submitCalibJob,
  setDeviceContext,
  calibRevealEditorResult,
  calibSetViewTab,
} from '../../store/autocalib-slice';
import { AppShell } from '../layout/AppShell';
import { CalibStatusBar } from './CalibStatusBar';
import { CalibCanvas, type CalibCanvasHandle } from './CalibCanvas';
import { CalibEditRail } from './CalibEditRail';
import { CalibBottomBar } from './CalibBottomBar';
import { CalibViewTabs } from './CalibViewTabs';
import { CalibPreviewDrawer } from './CalibPreviewDrawer';
import { usePreviewDrawerResize } from './usePreviewDrawerResize';
import {
  CalibLoadingPanel,
  CalibNoDataPanel,
  CalibProdExistsPanel,
} from './CalibEmptyStatePanel';
import { IconLoader } from '../../ui/ToolbarIcons';
import { Banner } from '../../ui/Banner';
import { VerticalZoomBar } from '../../ui/VerticalZoomBar';
import type { CalibEditMode, CalibTab } from '../../types';
import { getRecentDeviceDisplayName } from '../../utils/recentDeviceDisplay';
import styles from './CalibWorkspace.module.css';

function calibStatusUppercase(t: (key: string) => string, editMode: CalibEditMode): string {
  switch (editMode) {
    case 'none':
    case 'remove':
      return t('common.browse');
    case 'select':
      return t('common.select');
    case 'lasso_select':
      return t('common.lasso');
    case 'add':
      return t('common.add');
    case 'modify':
      return t('common.modify');
    case 'bulk_delete':
      return t('common.bulkDelete');
    case 'multi_resize':
      return t('common.multiResize');
    default:
      return t('common.browse');
  }
}

function normalizeCalibTab(tab: string): CalibTab {
  return tab === 'generate' ? 'generate' : 'production';
}

export function CalibWorkspace() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const calib = useAppSelector((s) => s.autocalib.calib);
  const contextClientId = useAppSelector((s) => s.autocalib.context.clientId);
  const contextClientName = useAppSelector((s) => s.autocalib.context.clientName);
  const contextClient = contextClientName || contextClientId;
  const contextDeviceId = useAppSelector((s) => s.autocalib.context.deviceId);

  const {
    jobStatus, jobProgress, jobError,
    frameCount, bboxes, activeFrameIndex, confidenceThreshold,
    editMode, selectedBboxIds, lockedBboxIds,
    deviceId: calibDeviceIdStore,
    client: calibClientStore,
    jobId: calibJobIdStore,
    lastCalibSubmitConfidenceThreshold,
    showCalibEditorResult,
    calibrationLoadedFromDb,
    calibrationLoading,
  } = calib;

  const deviceId = calibDeviceIdStore || contextDeviceId;
  const client = calibClientStore || contextClient;

  const directoryDevicesByClient = useAppSelector((s) => s.autocalib.directory.devicesByClient);
  const recentDevices = useAppSelector((s) => s.autocalib.context.recentDevices);

  const [activeTab, setActiveTab] = useState<CalibTab>(() => normalizeCalibTab(calib.viewTab));
  const canvasAreaRef = useRef<HTMLDivElement>(null);
  const [previewDrawerOpen, setPreviewDrawerOpen] = useState(false);
  const {
    widthPct: previewWidthPct,
    isResizing: isPreviewResizing,
    handleResizeMouseDown: handlePreviewResizeMouseDown,
  } = usePreviewDrawerResize(canvasAreaRef);

  const cocospotLabel = useMemo(() => {
    if (!client || !deviceId) return null;
    const recent = recentDevices.find((d) => d.client === client && d.deviceId === deviceId);
    if (recent) return getRecentDeviceDisplayName(recent, directoryDevicesByClient);
    const list = directoryDevicesByClient[client];
    const row = list?.find((d) => d.device_id === deviceId);
    if (row?.display_name?.trim()) return row.display_name.trim();
    if (row?.short_name?.trim()) return row.short_name.trim();
    return deviceId;
  }, [client, deviceId, recentDevices, directoryDevicesByClient]);

  const canvasRef = useRef<CalibCanvasHandle>(null);
  const tabDeviceKeyRef = useRef('');
  const prodLoadSettledRef = useRef(false);
  const userPickedTabRef = useRef(false);

  const deviceKey = `${contextClient ?? ''}\0${contextDeviceId ?? ''}`;

  const hasSavedProdCalib =
    bboxes.length > 0 && (calibrationLoadedFromDb || calibJobIdStore === 'db-static');

  const hasMlResult =
    showCalibEditorResult &&
    frameCount > 0 &&
    calibJobIdStore !== 'db-static' &&
    calibJobIdStore !== null;

  const prodLoadSettled = prodLoadSettledRef.current && !calibrationLoading;

  // Re-route on each visit to /calib (same device may already be selected).
  useEffect(() => {
    prodLoadSettledRef.current = false;
    userPickedTabRef.current = false;
  }, []);

  // Always load prod calibration when device context changes (all tabs).
  useEffect(() => {
    if (!contextDeviceId || !contextClient) return;
    dispatch(loadDeviceCalibration({ client: contextClient, deviceId: contextDeviceId }));
  }, [dispatch, contextDeviceId, contextClient]);

  useEffect(() => {
    if (deviceKey !== tabDeviceKeyRef.current) {
      tabDeviceKeyRef.current = deviceKey;
      prodLoadSettledRef.current = false;
      userPickedTabRef.current = false;
      setPreviewDrawerOpen(false);
    }
  }, [deviceKey]);

  // Route tab after prod load settles: calib prod → Éditer, else → Construction.
  useEffect(() => {
    if (!contextDeviceId || !contextClient || calibrationLoading) return;
    if (deviceKey !== tabDeviceKeyRef.current) return;

    if (!prodLoadSettledRef.current) {
      prodLoadSettledRef.current = true;
      const nextTab = hasSavedProdCalib ? 'production' : 'generate';
      setActiveTab(nextTab);
      dispatch(calibSetViewTab(nextTab));
      return;
    }

    if (
      hasSavedProdCalib &&
      activeTab === 'generate' &&
      !hasMlResult &&
      !userPickedTabRef.current
    ) {
      setActiveTab('production');
      dispatch(calibSetViewTab('production'));
    }
  }, [
    deviceKey,
    calibrationLoading,
    hasSavedProdCalib,
    hasMlResult,
    activeTab,
    contextDeviceId,
    contextClient,
    dispatch,
  ]);

  useEffect(() => {
    dispatch(calibSetViewTab(activeTab));
  }, [activeTab, dispatch]);

  useEffect(() => {
    if (activeTab !== 'production') return;
    if (!hasSavedProdCalib || showCalibEditorResult) return;
    dispatch(calibRevealEditorResult());
  }, [activeTab, dispatch, hasSavedProdCalib, showCalibEditorResult]);

  const handleTabChange = useCallback(
    (tab: CalibTab) => {
      userPickedTabRef.current = true;
      setActiveTab(tab);
      dispatch(calibSetViewTab(tab));
      if (tab === 'production' && deviceId && client) {
        dispatch(loadDeviceCalibration({ client, deviceId }));
        dispatch(calibRevealEditorResult());
      }
    },
    [dispatch, deviceId, client],
  );

  const handleFrameSelect = useCallback(
    (index: number) => dispatch(calibSetActiveFrame(index)),
    [dispatch],
  );

  const handleGenerate = useCallback(() => {
    if (deviceId && (contextClientName || contextClientId)) {
      dispatch(
        setDeviceContext({
          deviceId,
          clientId: contextClientId,
          clientName: contextClientName || client,
        }),
      );
    }
    dispatch(calibRevealEditorResult());
    if (jobStatus === 'pending' || jobStatus === 'running') return;
    const hasFreshMlResult =
      jobStatus === 'done' &&
      calibJobIdStore != null &&
      calibJobIdStore !== 'db-static' &&
      (bboxes.length > 0 || frameCount > 0) &&
      lastCalibSubmitConfidenceThreshold === confidenceThreshold;
    if (hasFreshMlResult) return;
    dispatch(submitCalibJob());
  }, [
    dispatch,
    deviceId,
    client,
    contextClientId,
    contextClientName,
    jobStatus,
    calibJobIdStore,
    bboxes.length,
    frameCount,
    lastCalibSubmitConfidenceThreshold,
    confidenceThreshold,
  ]);

  const handleZoomIn = useCallback(() => canvasRef.current?.zoomIn(), []);
  const handleZoomOut = useCallback(() => canvasRef.current?.zoomOut(), []);

  const isRef = activeFrameIndex === -1;
  const isProductionTab = activeTab === 'production';
  const isGenerateTab = activeTab === 'generate';

  useEffect(() => {
    if (!isRef) {
      dispatch(calibSetEditMode('none'));
      dispatch(calibClearSelection());
    }
  }, [isRef, dispatch]);

  useEffect(() => {
    if (activeTab !== 'production') {
      setPreviewDrawerOpen(false);
    }
  }, [activeTab]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      const key = e.key.toLowerCase();
      const mod = e.metaKey || e.ctrlKey;

      if (key === '+' || key === '=') {
        e.preventDefault();
        handleZoomIn();
        return;
      }
      if (key === '-' || key === '_') {
        e.preventDefault();
        handleZoomOut();
        return;
      }

      if (key === 'escape') {
        e.preventDefault();
        if (editMode === 'select' || editMode === 'lasso_select') {
          dispatch(calibSetEditMode('none'));
          return;
        }
        dispatch(calibSetEditMode('none'));
        dispatch(calibClearSelection());
        return;
      }

      if (!isRef) return;

      if ((e.ctrlKey || e.metaKey) && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) dispatch(calibRedo());
        else dispatch(calibUndo());
        return;
      }
      if ((e.ctrlKey || e.metaKey) && key === 'y') {
        e.preventDefault();
        dispatch(calibRedo());
        return;
      }

      if (key === 'delete' || key === 'backspace') {
        if (selectedBboxIds.length > 0) {
          e.preventDefault();
          const lockedSet = new Set(lockedBboxIds);
          const unlocked = selectedBboxIds.filter((id) => !lockedSet.has(id));
          if (unlocked.length > 0) dispatch(calibBulkRemove(unlocked));
        }
        return;
      }

      if (!mod && !e.altKey && key === 'k') {
        if (selectedBboxIds.length > 0) {
          e.preventDefault();
          dispatch(calibToggleLock(selectedBboxIds));
        }
        return;
      }

      const modeMap: Record<string, CalibEditMode> = {
        v: 'select',
        l: 'lasso_select',
        a: 'add',
        m: 'modify',
      };
      if (!mod && !e.altKey && modeMap[key]) {
        e.preventDefault();
        dispatch(calibSetEditMode(editMode === modeMap[key] ? 'none' : modeMap[key]));
        return;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    activeTab,
    dispatch,
    editMode,
    selectedBboxIds,
    lockedBboxIds,
    handleZoomIn,
    handleZoomOut,
    isRef,
  ]);

  const editorHasBboxes = isProductionTab
    ? hasSavedProdCalib && showCalibEditorResult
    : hasMlResult;

  const visibleBboxCount = editorHasBboxes
    ? bboxes.filter((b) => b.confidence >= confidenceThreshold).length
    : 0;

  const isCalibJobLoading =
    isGenerateTab && showCalibEditorResult && (jobStatus === 'pending' || jobStatus === 'running');

  const resultReadyAwaitingReveal =
    isGenerateTab &&
    !hasMlResult &&
    !hasSavedProdCalib &&
    !calibrationLoading &&
    jobStatus === 'done' &&
    frameCount > 0 &&
    calibJobIdStore !== 'db-static';

  const bottomChromeEnabled = editorHasBboxes && !isCalibJobLoading;
  const generateLabel = hasMlResult ? t('calib.regenerate') : t('calib.generate');

  const bottomChrome =
    bottomChromeEnabled ? (
      <CalibBottomBar
        frameCount={frameCount}
        activeFrameIndex={activeFrameIndex}
        onFrameSelect={handleFrameSelect}
        isReference={isRef}
        disabled={isCalibJobLoading}
      />
    ) : null;

  const selectedSuffix =
    selectedBboxIds.length > 0
      ? t('calib.statusSelected', { count: selectedBboxIds.length })
      : '';

  const headerTabs = (
    <CalibViewTabs active={activeTab} onChange={handleTabChange} />
  );

  const showProdLoading = isProductionTab && calibrationLoading;
  const showGenerateLoading = isGenerateTab && calibrationLoading;
  const showGenerateEmpty =
    isGenerateTab &&
    prodLoadSettled &&
    !hasMlResult &&
    !isCalibJobLoading &&
    !resultReadyAwaitingReveal &&
    !jobError;
  const showGenerateProdExists = showGenerateEmpty && hasSavedProdCalib;
  const showGenerateNoData = showGenerateEmpty && !hasSavedProdCalib;

  return (
    <AppShell
      headerCenter={headerTabs}
      workspaceCommands={{ calib: { runDetection: handleGenerate } }}
      leftRail={
        <CalibEditRail
          isReference={isRef}
          interactive={editorHasBboxes && !isCalibJobLoading}
        />
      }
      floatingToolbar={bottomChrome}
      statusBar={
        <CalibStatusBar
          editMode={editMode}
          bboxCount={visibleBboxCount}
          selectedCount={selectedBboxIds.length}
        />
      }
    >
      <div className={styles.workspace}>
        {!isRef && editorHasBboxes ? (
          <Banner
            variant="warning"
            subline={
              <button
                type="button"
                className={styles.switchRefBtn}
                onClick={() => dispatch(calibSetActiveFrame(-1))}
              >
                {t('calib.switchToReference')}
              </button>
            }
          >
            <Trans
              i18nKey="calib.viewOnlyBanner"
              values={{ frame: activeFrameIndex + 1 }}
              components={{ strong: <strong /> }}
            />
          </Banner>
        ) : null}

        <div className={styles.body}>
          <div
            ref={canvasAreaRef}
            className={`${styles.canvasArea} ${isPreviewResizing ? styles.canvasAreaResizing : ''}`}
          >
            <div
              className={`${styles.canvasMain} ${previewDrawerOpen ? styles.canvasMainWithPreview : ''} ${isPreviewResizing ? styles.canvasMainResizing : ''}`}
              style={
                previewDrawerOpen
                  ? { width: `${100 - previewWidthPct}%` }
                  : undefined
              }
            >
            <div className={styles.canvasWrap}>
              {isCalibJobLoading && (
                <div className={styles.progressOverlay}>
                  <div className={styles.progressSpinnerWrap} aria-hidden>
                    <IconLoader size={44} />
                  </div>
                  <span className={styles.progressStage}>
                    {jobProgress ? `${jobProgress.stage} — ${jobProgress.percent}%` : t('calib.starting')}
                  </span>
                  <div className={styles.progressBarOuter}>
                    <div
                      className={styles.progressBarInner}
                      style={{ width: `${jobProgress?.percent ?? 0}%` }}
                    />
                  </div>
                </div>
              )}

              {showProdLoading && <CalibLoadingPanel />}

              {isProductionTab &&
                !showProdLoading &&
                !hasSavedProdCalib &&
                !jobError && (
                <div className={styles.emptyState}>
                  {deviceId && client ? (
                    <>
                      <p className={styles.emptyTitle}>{t('calib.noProdSaved')}</p>
                      <p className={styles.emptyDeviceLine}>
                        <strong>{cocospotLabel}</strong>
                        <span className={styles.emptyMeta} title={deviceId}>
                          {' '}
                          · {client}
                        </span>
                      </p>
                    </>
                  ) : (
                    <p className={styles.emptyTitle}>{t('calib.pickCocospotTitle')}</p>
                  )}
                  <button
                    type="button"
                    className={styles.primaryCta}
                    onClick={() => handleTabChange('generate')}
                  >
                    {t('calib.goToConstructionTab')}
                  </button>
                </div>
              )}

              {resultReadyAwaitingReveal && (
                <div className={styles.emptyState}>
                  <p className={styles.emptyTitle}>{t('calib.detectionFinishedTitle')}</p>
                  <p>{t('calib.detectionFinishedHint')}</p>
                  {deviceId && client ? (
                    <p className={styles.emptyDeviceLine}>
                      <strong>{cocospotLabel}</strong>
                      <span className={styles.emptyMeta} title={deviceId}>
                        {' '}
                        · {client}
                      </span>
                    </p>
                  ) : null}
                  <button
                    type="button"
                    className={styles.primaryCta}
                    onClick={handleGenerate}
                    disabled={!deviceId || !client}
                  >
                    {generateLabel}
                  </button>
                </div>
              )}

              {showGenerateLoading && <CalibLoadingPanel />}

              {showGenerateProdExists && (
                <CalibProdExistsPanel
                  cocospotLabel={cocospotLabel}
                  client={client}
                  deviceId={deviceId}
                  bboxCount={bboxes.length}
                  onEdit={() => handleTabChange('production')}
                  onGenerate={handleGenerate}
                  generateDisabled={!deviceId || !client}
                />
              )}

              {showGenerateNoData && (
                <CalibNoDataPanel
                  cocospotLabel={cocospotLabel}
                  client={client}
                  deviceId={deviceId}
                  onGenerate={handleGenerate}
                  onPickDevice={() => window.dispatchEvent(new Event('autocalib:open-device-picker'))}
                  generateDisabled={!deviceId || !client}
                  generateLabel={generateLabel}
                />
              )}

              {jobError && isGenerateTab && !isCalibJobLoading && (
                <div className={styles.emptyState}>
                  <p className={styles.errorTitle}>{t('calib.generationFailed')}</p>
                  <p className={styles.errorBody}>{jobError}</p>
                  <button
                    type="button"
                    className={styles.primaryCta}
                    onClick={handleGenerate}
                    disabled={!deviceId || !client}
                  >
                    {t('calib.retry')}
                  </button>
                  {deviceId && client && (
                    <small>{t('calib.deviceIdLine', { id: deviceId })}</small>
                  )}
                </div>
              )}

              {editorHasBboxes ? <CalibCanvas ref={canvasRef} /> : null}
              {editorHasBboxes && !isCalibJobLoading && (
                <VerticalZoomBar
                  onZoomIn={handleZoomIn}
                  onZoomOut={handleZoomOut}
                  ariaLabel={t('calib.zoomCanvasAria')}
                />
              )}
            </div>

            <div className={styles.statusBar}>
              <span>
                {t('calib.statusBboxes', { count: visibleBboxCount })}
                {selectedSuffix}
              </span>
              <span>
                {frameCount > 0 && editorHasBboxes
                  ? isRef
                    ? t('calib.reference')
                    : t('calib.frameLabel', { current: activeFrameIndex + 1, total: frameCount })
                  : ''}
              </span>
              <span>
                {!isRef
                  ? t('common.viewOnly')
                  : calibStatusUppercase(t, editMode)}
              </span>
            </div>
            </div>

            {isProductionTab && deviceId ? (
              <CalibPreviewDrawer
                open={previewDrawerOpen}
                onOpenChange={setPreviewDrawerOpen}
                deviceId={deviceId}
                widthPct={previewWidthPct}
                isResizing={isPreviewResizing}
                onResizeMouseDown={handlePreviewResizeMouseDown}
              />
            ) : null}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
