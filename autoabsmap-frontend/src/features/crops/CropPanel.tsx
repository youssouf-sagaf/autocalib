import { useAppSelector, useAppDispatch } from '../../store/hooks';
import { removeCrop, clearCrops, launchJob, resetSession } from '../../store/autoabsmap-slice';
import { JobProgress } from '../pipeline/JobProgress';
import styles from './CropPanel.module.css';

interface CropPanelProps {
  isDrawing: boolean;
  onStartDraw: () => void;
  onStopDraw: () => void;
}

export function CropPanel({
  isDrawing,
  onStartDraw,
  onStopDraw,
}: CropPanelProps) {
  const dispatch = useAppDispatch();
  const crops = useAppSelector((s) => s.absmap.crops);
  const job = useAppSelector((s) => s.absmap.job);
  const slotCount = useAppSelector((s) => s.absmap.slots.length);
  const baselineCount = useAppSelector((s) => s.absmap.baselineSlots.length);
  const displayCount = slotCount || baselineCount;
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
            ? 'Generating…'
            : `Generate Slots${crops.length > 0 ? ` (${crops.length})` : ''}`}
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

      {hasResults && (
        <>
          <div className={styles.section}>
            <h3 className={styles.heading}>Lightning Edition</h3>
            <div className={styles.actionGrid}>
              <button className={styles.actionBtn} disabled title="Hold A + click to place a slot">
                <span className={styles.actionIcon}>+</span>
                <span>Add <kbd className={styles.kbd}>A</kbd></span>
              </button>
              <button className={styles.actionBtn} disabled title="Click a slot to remove it">
                <span className={styles.actionIcon}>&minus;</span>
                <span>Delete <kbd className={styles.kbd}>D</kbd></span>
              </button>
              <button className={styles.actionBtn} disabled title="Lasso select + confirm delete">
                <span className={styles.actionIcon}>&#x25AD;</span>
                <span>Bulk Delete</span>
              </button>
              <button className={styles.actionBtn} disabled title="Duplicate a reference slot">
                <span className={styles.actionIcon}>&#x2398;</span>
                <span>Copy <kbd className={styles.kbd}>C</kbd></span>
              </button>
              <button className={styles.actionBtn} disabled title="Adjust orientation / geometry">
                <span className={styles.actionIcon}>&#x270E;</span>
                <span>Modify <kbd className={styles.kbd}>M</kbd></span>
              </button>
              <button className={styles.actionBtn} disabled title="Undo last edit">
                <span className={styles.actionIcon}>&#x21B6;</span>
                <span>Undo <kbd className={styles.kbd}>Z</kbd></span>
              </button>
            </div>
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
              <button className={styles.actionBtn} disabled title="Save slots + edit trace + difficulty tags">
                <span className={styles.actionIcon}>&#x2713;</span>
                Save
              </button>
              <button className={styles.actionBtn} disabled title="Download GeoJSON file">
                <span className={styles.actionIcon}>&#x21E9;</span>
                Export
              </button>
            </div>
            <button
              className={styles.resetBtn}
              onClick={() => dispatch(resetSession())}
            >
              Reset Session
            </button>
          </div>
        </>
      )}
    </div>
  );
}
