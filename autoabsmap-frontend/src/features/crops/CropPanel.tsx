import { useAppSelector, useAppDispatch } from '../../store/hooks';
import { removeCrop, clearCrops, launchJob } from '../../store/autoabsmap-slice';
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
  const isRunning = job?.status === 'running' || job?.status === 'pending';

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
              <span className={styles.icon}>▭</span> Draw ROI
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
              Draw rectangles on the map to define areas for parking slot
              detection.
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
            ? 'Processing…'
            : `Launch Pipeline${crops.length > 0 ? ` (${crops.length})` : ''}`}
        </button>

        <JobProgress />

        {job?.status === 'done' && slotCount > 0 && (
          <div className={styles.resultSummary}>
            {slotCount} slot{slotCount !== 1 ? 's' : ''} detected
          </div>
        )}
      </div>
    </div>
  );
}
