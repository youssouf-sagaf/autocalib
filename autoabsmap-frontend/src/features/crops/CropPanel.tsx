import { useAppSelector, useAppDispatch } from '../../store/hooks';
import { removeCrop, clearCrops, launchJob, saveSession, resetSession, toggleOverlay } from '../../store/autoabsmap-slice';
import { JobProgress } from '../pipeline/JobProgress';
import type { EditMode, OverlayLayer } from '../../types';
import styles from './CropPanel.module.css';

interface CropPanelProps {
  isDrawing: boolean;
  onStartDraw: () => void;
  onStopDraw: () => void;
  onToggleAddMode?: () => void;
  onConfirmAdd?: () => void;
  onCancelAdd?: () => void;
  hasPendingSlot?: boolean;
  onToggleDeleteMode?: () => void;
  onConfirmDelete?: () => void;
  onCancelDelete?: () => void;
  onToggleBulkDeleteMode?: () => void;
  onConfirmBulkDelete?: () => void;
  onCancelBulkDelete?: () => void;
  bulkPreviewCount?: number;
  bulkHasPreview?: boolean;
  onToggleCopyMode?: () => void;
  onToggleModifyMode?: () => void;
  onCancelModify?: () => void;
  onToggleStraightenMode?: () => void;
  onCancelStraighten?: () => void;
  onToggleReprocessMode?: () => void;
  onAcceptReprocess?: () => void;
  onRejectReprocess?: () => void;
  onCancelReprocess?: () => void;
  reprocessStep?: 'idle' | 'drawingScope' | 'placingRefSlot' | 'waitingForReview';
  hasPendingRef?: boolean;
  reprocessProposedCount?: number;
  reprocessLoading?: boolean;
  reprocessError?: string | null;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}

export function CropPanel({
  isDrawing,
  onStartDraw,
  onStopDraw,
  onToggleAddMode,
  onConfirmAdd,
  onCancelAdd,
  hasPendingSlot = false,
  onToggleDeleteMode,
  onConfirmDelete,
  onCancelDelete,
  onToggleBulkDeleteMode,
  onConfirmBulkDelete,
  onCancelBulkDelete,
  bulkPreviewCount = 0,
  bulkHasPreview = false,
  onToggleCopyMode,
  onToggleModifyMode,
  onCancelModify,
  onToggleStraightenMode,
  onCancelStraighten,
  onToggleReprocessMode,
  onAcceptReprocess,
  onRejectReprocess,
  onCancelReprocess,
  reprocessStep = 'idle',
  hasPendingRef = false,
  reprocessProposedCount = 0,
  reprocessLoading = false,
  reprocessError = null,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
}: CropPanelProps) {
  const dispatch = useAppDispatch();
  const crops = useAppSelector((s) => s.absmap.crops);
  const job = useAppSelector((s) => s.absmap.job);
  const slotCount = useAppSelector((s) => s.absmap.slots.length);
  const baselineCount = useAppSelector((s) => s.absmap.baselineSlots.length);
  const displayCount = slotCount || baselineCount;
  const dualMapActive = useAppSelector((s) => s.absmap.dualMapActive);
  const overlayVisibility = useAppSelector((s) => s.absmap.overlayVisibility);
  const editMode: EditMode = useAppSelector((s) => s.absmap.editMode);
  const isAddMode = editMode === 'add';
  const isDeleteMode = editMode === 'delete';
  const isBulkDeleteMode = editMode === 'bulk_delete';
  const isCopyMode = editMode === 'copy';
  const isModifyMode = editMode === 'modify';
  const isStraightenMode = editMode === 'straighten';
  const isReprocessMode = editMode === 'reprocess';
  const straightenLoading = useAppSelector((s) => s.absmap.straightenLoading);
  const straightenError = useAppSelector((s) => s.absmap.straightenError);
  const straightenAnchorId = useAppSelector((s) => s.absmap.straightenAnchorSlotId);
  const isDirty = useAppSelector((s) => s.absmap.isDirty);
  const isSaving = useAppSelector((s) => s.absmap.isSaving);
  const lastSavedAt = useAppSelector((s) => s.absmap.lastSavedAt);
  const saveError = useAppSelector((s) => s.absmap.saveError);
  const isRunning = job?.status === 'running' || job?.status === 'pending';
  const hasSlots = displayCount > 0;
  /** Server-backed AI assist (reprocess): needs a finished job + result in store. */
  const hasResults = job?.status === 'done' && displayCount > 0;
  const reprocessDisabledTitle =
    !hasSlots
      ? 'No slots available'
      : !job?.id
        ? 'Run slot mapping first — reprocess needs a job id on the server'
        : job.status !== 'done'
          ? 'Wait until the current mapping job has finished'
          : '';

  return (
    <div className={styles.panel}>
      <div className={styles.section}>
        <h3 className={styles.heading}>ROI Crops</h3>

        <button
          className={`${styles.drawBtn} ${isDrawing ? styles.drawing : ''}`}
          onClick={isDrawing ? onStopDraw : onStartDraw}
          disabled={isRunning}
        >
          {isDrawing ? (
            <>
              <span className={styles.icon}>✕</span> Stop Drawing
            </>
          ) : (
            <>
              <span className={styles.icon}>⬠</span> Draw ROI
            </>
          )}
        </button>

        {crops.length > 0 ? (
          <>
            <ul className={styles.cropList}>
              {crops.map((_crop, i) => (
                <li key={i} className={styles.cropItem}>
                  <span className={styles.cropLabel}>ROI {i + 1}</span>
                  <button
                    className={styles.removeBtn}
                    onClick={() => dispatch(removeCrop(i))}
                    disabled={isRunning}
                    title="Remove this ROI"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
            {crops.length > 1 && !isRunning && (
              <button
                className={styles.clearBtn}
                onClick={() => dispatch(clearCrops())}
              >
                Clear all
              </button>
            )}
          </>
        ) : (
          !isDrawing && (
            <p className={styles.hint}>
              Click on the map to place polygon vertices around the parking
              area. Double-click or click the first point to close.
            </p>
          )
        )}
      </div>

      <div className={styles.section}>
        <button
          className={styles.launchBtn}
          disabled={crops.length === 0 || isRunning}
          onClick={() => void dispatch(launchJob())}
        >
          {isRunning
            ? 'Mapping…'
            : `Launch Slot Mapping${crops.length > 0 ? ` (${crops.length})` : ''}`}
        </button>

        <JobProgress />

        {hasSlots && (
          <div className={styles.resultSummary}>
            {displayCount} slot{displayCount !== 1 ? 's' : ''}
            {job?.status === 'done' ? ' detected' : ' in session'}
            {slotCount === 0 && baselineCount > 0 && (
              <span className={styles.resultNote}> (baseline)</span>
            )}
          </div>
        )}
      </div>

      {hasResults && dualMapActive && (
        <div className={styles.section}>
          <h3 className={styles.heading}>Map Overlays</h3>
          <div className={styles.overlayToggles}>
            {([
              { key: 'detection' as OverlayLayer, label: 'Detection', color: '#e67e22' },
              { key: 'mask' as OverlayLayer, label: 'Seg. Mask', color: '#27ae60' },
              { key: 'postprocess' as OverlayLayer, label: 'Post-process', color: '#3498db' },
            ]).map(({ key, label, color }) => (
              <button
                key={key}
                className={`${styles.overlayBtn} ${overlayVisibility[key] ? styles.overlayActive : ''}`}
                style={{ '--overlay-color': color } as React.CSSProperties}
                onClick={() => dispatch(toggleOverlay(key))}
              >
                <span
                  className={styles.overlayDot}
                  style={{ background: overlayVisibility[key] ? color : 'transparent', borderColor: color }}
                />
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={styles.section}>
        <h3 className={styles.heading}>Lightning Edition</h3>
        <div className={styles.actionGrid2}>
          <button
            className={`${styles.actionBtn} ${isAddMode ? styles.actionBtnActive : ''}`}
            onClick={onToggleAddMode}
            disabled={!hasSlots}
            title="Press A to toggle — click map to place a slot"
          >
            <span className={styles.actionIcon}>+</span>
            <span>Add <kbd className={styles.kbd}>A</kbd></span>
          </button>
          <button
            className={`${styles.actionBtn} ${isDeleteMode ? styles.actionBtnActive : ''}`}
            onClick={onToggleDeleteMode}
            disabled={!hasSlots}
            title="Press D to toggle — click a slot to remove it"
          >
            <span className={styles.actionIcon}>&minus;</span>
            <span>Delete <kbd className={styles.kbd}>D</kbd></span>
          </button>
          <button
            className={`${styles.actionBtn} ${isBulkDeleteMode ? styles.actionBtnActive : ''}`}
            onClick={onToggleBulkDeleteMode}
            disabled={!hasSlots}
            title="Press B — draw a lasso; Enter confirms removal of all slots inside"
          >
            <span className={styles.actionIcon}>&#x29C9;</span>
            <span>Bulk <kbd className={styles.kbd}>B</kbd></span>
          </button>
          <button
            className={`${styles.actionBtn} ${isCopyMode ? styles.actionBtnActive : ''}`}
            onClick={onToggleCopyMode}
            disabled={!hasSlots}
            title="Press C to toggle — click a slot to duplicate it"
          >
            <span className={styles.actionIcon}>&#x2398;</span>
            <span>Copy <kbd className={styles.kbd}>C</kbd></span>
          </button>
          <button
            className={`${styles.actionBtn} ${isModifyMode ? styles.actionBtnActive : ''}`}
            onClick={onToggleModifyMode}
            disabled={!hasSlots}
            title="Press M to toggle — click a slot to reposition/rotate it"
          >
            <span className={styles.actionIcon}>&#x270E;</span>
            <span>Modify <kbd className={styles.kbd}>M</kbd></span>
          </button>
        </div>
        <div className={styles.actionGrid2}>
          <button
            className={styles.actionBtn}
            onClick={onUndo}
            disabled={!canUndo}
            title="Undo last edit"
          >
            <span className={styles.actionIcon}>&#x21B6;</span>
            <span>Undo <kbd className={styles.kbd}>Z</kbd></span>
          </button>
          <button
            className={styles.actionBtn}
            onClick={onRedo}
            disabled={!canRedo}
            title="Redo last undone edit"
          >
            <span className={styles.actionIcon}>&#x21B7;</span>
            <span>Redo <kbd className={styles.kbd}>&#x21E7;Z</kbd></span>
          </button>
        </div>

        {isAddMode && (
          <div className={styles.modeBar}>
            <span className={styles.modeBarLabel}>
              {hasPendingSlot
                ? 'Move mouse to rotate · Click to confirm'
                : 'Click on the map to place a slot'}
            </span>
            {hasPendingSlot && (
              <div className={styles.modeBarActions}>
                <button className={styles.confirmBtn} onClick={onConfirmAdd}>
                  Save <kbd className={styles.kbd}>Enter</kbd>
                </button>
                <button className={styles.cancelBtn} onClick={onCancelAdd}>
                  Cancel <kbd className={styles.kbd}>Esc</kbd>
                </button>
              </div>
            )}
          </div>
        )}

        {isDeleteMode && (
          <div className={styles.modeBar}>
            <span className={styles.modeBarLabel}>Click a slot to select, then confirm</span>
            <div className={styles.modeBarActions}>
              <button className={styles.confirmBtn} onClick={onConfirmDelete}>
                Confirm <kbd className={styles.kbd}>Enter</kbd>
              </button>
              <button className={styles.cancelBtn} onClick={onCancelDelete}>
                Cancel <kbd className={styles.kbd}>Esc</kbd>
              </button>
            </div>
          </div>
        )}

        {isBulkDeleteMode && (
          <div className={styles.modeBar}>
            <span className={styles.modeBarLabel}>
              {bulkHasPreview && bulkPreviewCount > 0
                ? `${bulkPreviewCount} slot${bulkPreviewCount !== 1 ? 's' : ''} selected — confirm to remove`
                : bulkHasPreview && bulkPreviewCount === 0
                  ? 'No slots in region — draw again'
                  : 'Draw a lasso on the map (double-click or close on first point)'}
            </span>
            <div className={styles.modeBarActions}>
              <button
                className={styles.confirmBtn}
                onClick={onConfirmBulkDelete}
                disabled={!bulkPreviewCount}
              >
                Remove <kbd className={styles.kbd}>Enter</kbd>
              </button>
              <button className={styles.cancelBtn} onClick={onCancelBulkDelete}>
                Exit <kbd className={styles.kbd}>Esc</kbd>
              </button>
            </div>
          </div>
        )}

        {isCopyMode && (
          <div className={styles.modeBar}>
            <span className={styles.modeBarLabel}>Click a slot to duplicate it</span>
          </div>
        )}

        {isModifyMode && (
          <div className={styles.modeBar}>
            <span className={styles.modeBarLabel}>Click a slot · Drag to move · Click to rotate · Click to confirm</span>
            <div className={styles.modeBarActions}>
              <button className={styles.cancelBtn} onClick={onCancelModify}>
                Cancel <kbd className={styles.kbd}>Esc</kbd>
              </button>
            </div>
          </div>
        )}
      </div>

      <div className={styles.section}>
        <h3 className={styles.heading}>AI Assist</h3>
        <div className={styles.actionGrid2}>
          <button
            className={`${styles.actionBtn} ${isReprocessMode ? styles.actionBtnActive : ''}`}
            onClick={onToggleReprocessMode}
            disabled={!hasResults}
            title={
              hasResults
                ? 'Press R — trace zone, place reference slot, review proposals (Detections map if dual view)'
                : reprocessDisabledTitle
            }
          >
            <span className={styles.actionIcon}>&#x21BB;</span>
            <span>Reprocess <kbd className={styles.kbd}>R</kbd></span>
          </button>
          <button
            className={`${styles.actionBtn} ${isStraightenMode ? styles.actionBtnActive : ''}`}
            onClick={onToggleStraightenMode}
            disabled={!hasSlots}
            title={
              !hasSlots
                ? 'No slots available'
                : 'Press S — two anchors on the same row (needs a completed job on the server; Undo with Z)'
            }
          >
            <span className={styles.actionIcon}>&#x2261;</span>
            <span>Straighten <kbd className={styles.kbd}>S</kbd></span>
          </button>
        </div>

        {isStraightenMode && (
          <div className={styles.modeBar}>
            <span className={styles.modeBarLabel}>
              {straightenLoading
                ? 'Aligning row…'
                : straightenAnchorId
                  ? 'Click second anchor on the same row'
                  : 'Click first anchor on the row'}
            </span>
            {straightenError && (
              <span className={styles.saveError}>{straightenError}</span>
            )}
            <div className={styles.modeBarActions}>
              <button className={styles.cancelBtn} onClick={onCancelStraighten}>
                Done <kbd className={styles.kbd}>Esc</kbd>
              </button>
            </div>
          </div>
        )}

        {isReprocessMode && (
          <div className={styles.modeBar}>
            <span className={styles.modeBarLabel}>
              {reprocessLoading
                ? 'Running reprocess…'
                : reprocessStep === 'drawingScope'
                  ? 'Trace the zone to fill (click corners, double-click to close)'
                  : reprocessStep === 'placingRefSlot'
                    ? hasPendingRef
                      ? 'Move to rotate · Click to confirm the reference slot'
                      : 'Click inside the zone to place a reference slot'
                    : reprocessStep === 'waitingForReview'
                      ? `${reprocessProposedCount} proposed slot${reprocessProposedCount !== 1 ? 's' : ''} — accept or reject`
                      : ''}
            </span>
            {reprocessError && (
              <span className={styles.saveError}>{reprocessError}</span>
            )}
            <div className={styles.modeBarActions}>
              {reprocessStep === 'waitingForReview' && (
                <>
                  <button className={styles.confirmBtn} onClick={onAcceptReprocess}>
                    Accept All
                  </button>
                  <button className={styles.cancelBtn} onClick={onRejectReprocess}>
                    Reject All
                  </button>
                </>
              )}
              {reprocessStep !== 'waitingForReview' && (
                <button className={styles.cancelBtn} onClick={onCancelReprocess}>
                  Cancel <kbd className={styles.kbd}>Esc</kbd>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className={styles.section}>
        <h3 className={styles.heading}>Session</h3>
        <div className={styles.actionGrid2}>
          <button
            className={`${styles.actionBtn} ${isDirty ? styles.actionBtnDirty : ''}`}
            disabled={!isDirty || isSaving || !job?.id}
            onClick={() => void dispatch(saveSession())}
            title={isDirty ? 'Save slots + edit trace to server' : 'No unsaved changes'}
          >
            <span className={styles.actionIcon}>{isSaving ? '⏳' : '&#x2713;'}</span>
            {isSaving ? 'Saving…' : 'Save'}
          </button>
          <button className={styles.actionBtn} disabled title="Download GeoJSON file">
            <span className={styles.actionIcon}>&#x21E9;</span>
            Export
          </button>
        </div>
        {lastSavedAt && !isDirty && (
          <div className={styles.savedNote}>
            Saved {new Date(lastSavedAt).toLocaleTimeString()}
          </div>
        )}
        {saveError && (
          <div className={styles.saveError}>{saveError}</div>
        )}
        <button
          className={styles.resetBtn}
          onClick={() => dispatch(resetSession())}
        >
          Reset Session
        </button>
      </div>
    </div>
  );
}
