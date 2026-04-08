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
  onToggleCopyMode?: () => void;
  onToggleModifyMode?: () => void;
  onCancelModify?: () => void;
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
  onToggleCopyMode,
  onToggleModifyMode,
  onCancelModify,
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
  const isCopyMode = editMode === 'copy';
  const isModifyMode = editMode === 'modify';
  const isDirty = useAppSelector((s) => s.absmap.isDirty);
  const isSaving = useAppSelector((s) => s.absmap.isSaving);
  const lastSavedAt = useAppSelector((s) => s.absmap.lastSavedAt);
  const saveError = useAppSelector((s) => s.absmap.saveError);
  const isRunning = job?.status === 'running' || job?.status === 'pending';
  const hasResults = job?.status === 'done' && displayCount > 0;

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
                  <span className={styles.cropLabel}>Crop {i + 1}</span>
                  <button
                    className={styles.removeBtn}
                    onClick={() => dispatch(removeCrop(i))}
                    disabled={isRunning}
                    title="Remove this crop"
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

        {job?.status === 'done' && displayCount > 0 && (
          <div className={styles.resultSummary}>
            {displayCount} slot{displayCount !== 1 ? 's' : ''} detected
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
            disabled={!hasResults}
            title="Press A to toggle — click map to place a slot"
          >
            <span className={styles.actionIcon}>+</span>
            <span>Add <kbd className={styles.kbd}>A</kbd></span>
          </button>
          <button
            className={`${styles.actionBtn} ${isDeleteMode ? styles.actionBtnActive : ''}`}
            onClick={onToggleDeleteMode}
            disabled={!hasResults}
            title="Press D to toggle — click a slot to remove it"
          >
            <span className={styles.actionIcon}>&minus;</span>
            <span>Delete <kbd className={styles.kbd}>D</kbd></span>
          </button>
          <button
            className={`${styles.actionBtn} ${isCopyMode ? styles.actionBtnActive : ''}`}
            onClick={onToggleCopyMode}
            disabled={!hasResults}
            title="Press C to toggle — click a slot to duplicate it"
          >
            <span className={styles.actionIcon}>&#x2398;</span>
            <span>Copy <kbd className={styles.kbd}>C</kbd></span>
          </button>
          <button
            className={`${styles.actionBtn} ${isModifyMode ? styles.actionBtnActive : ''}`}
            onClick={onToggleModifyMode}
            disabled={!hasResults}
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
          <button className={styles.actionBtn} disabled title="Ref slot + scope region → auto-fill missed area">
            <span className={styles.actionIcon}>&#x21BB;</span>
            <span>Reprocess <kbd className={styles.kbd}>R</kbd></span>
          </button>
          <button className={styles.actionBtn} disabled title="Click one slot → align entire row (mise au carré)">
            <span className={styles.actionIcon}>&#x2261;</span>
            <span>Straighten</span>
          </button>
        </div>
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
