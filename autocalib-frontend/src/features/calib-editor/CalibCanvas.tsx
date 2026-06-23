import { useCallback, useEffect, useImperativeHandle, useRef, forwardRef } from 'react';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { calibReset } from '../../store/autocalib-slice';
import { calibFrameUrl, deviceCalibrationImageDataUrl } from '../../api/autocalib-api';
import { removeCalibLocalCache } from '../../utils/calibLocalCache';
import { useCalibCanvas } from './useCalibCanvas';

export interface CalibCanvasHandle {
  zoomIn: () => void;
  zoomOut: () => void;
}

export const CalibCanvas = forwardRef<CalibCanvasHandle, { className?: string }>(
  function CalibCanvas({ className }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const dispatch = useAppDispatch();
    const { loadImage, clearImage, fitImage, image, zoomIn, zoomOut, cursorStyle } = useCalibCanvas(canvasRef);

    const jobId = useAppSelector((s) => s.autocalib.calib.jobId);
    const client = useAppSelector((s) => s.autocalib.calib.client);
    const deviceId = useAppSelector((s) => s.autocalib.calib.deviceId);
    const activeFrame = useAppSelector((s) => s.autocalib.calib.activeFrameIndex);
    const frameCount = useAppSelector((s) => s.autocalib.calib.frameCount);
    const showCalibEditorResult = useAppSelector((s) => s.autocalib.calib.showCalibEditorResult);

    useImperativeHandle(ref, () => ({ zoomIn, zoomOut }), [zoomIn, zoomOut]);

    const handleLoadError = useCallback(
      (status: number) => {
        if (status === 404 && client && deviceId) {
          removeCalibLocalCache(client, deviceId);
          dispatch(calibReset());
        }
      },
      [dispatch, client, deviceId],
    );

    useEffect(() => {
      if (!showCalibEditorResult || !jobId || frameCount === 0) {
        clearImage();
        return;
      }
      if (jobId === 'db-static' && deviceId) {
        let cancelled = false;
        void deviceCalibrationImageDataUrl(deviceId, false).then((dataUrl) => {
          if (cancelled) return;
          if (dataUrl) {
            loadImage(dataUrl);
          } else {
            clearImage();
          }
        });
        return () => {
          cancelled = true;
        };
      }
      const idx = activeFrame === -1 ? 0 : activeFrame;
      const url = calibFrameUrl(jobId, idx);
      loadImage(url, handleLoadError);
    }, [
      showCalibEditorResult,
      jobId,
      deviceId,
      activeFrame,
      frameCount,
      loadImage,
      clearImage,
      handleLoadError,
    ]);

    useEffect(() => {
      fitImage();
    }, [image, fitImage]);

    return (
      <canvas
        ref={canvasRef}
        className={className}
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          cursor: cursorStyle,
          touchAction: 'none',
        }}
      />
    );
  },
);
