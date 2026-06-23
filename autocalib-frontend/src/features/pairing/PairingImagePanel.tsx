import { useCallback, useRef, useEffect, useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import {
  pairingSelectBbox,
  pairingSetDrawingPoints,
  pairingSetActiveZone,
  calibSetZoom,
  calibSetPan,
  calibAlignBboxesToImageSize,
} from '../../store/autocalib-slice';
import { PAIR_PALETTE } from '../../types';
import { calibFrameUrl, deviceCalibrationImageDataUrl } from '../../api/autocalib-api';
import { VerticalZoomBar } from '../../ui/VerticalZoomBar';
import { usePairingDeviceContext } from '../../hooks/usePairingDeviceContext';
import { usePairingVisuals } from '../../hooks/usePairingVisuals';
import { visibleCalibBboxes } from '../../utils/calibVisibility';
import { withCalibBboxTransform } from '../../utils/calib-canvas-draw';
import { Kbd } from '../../ui/Kbd';
import styles from './PairingImagePanel.module.css';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 10;
const ZOOM_STEP = 1.25;

/** Same sampling as calib lasso (image space, scaled by zoom). */
const LASSO_MIN_SAMPLE_PX_CANVAS = 1.35;

/** Same convention as Calibration reference view: `/frames/0` is the reference merged image. */
const PAIRING_FRAME_INDEX = 0;

/** Pointer coords in bitmap pixels (handles CSS sizing vs backing store). */
function canvasPixelCoords(canvas: HTMLCanvasElement, clientX: number, clientY: number): [number, number] {
  const rect = canvas.getBoundingClientRect();
  const sx = canvas.width / rect.width || 1;
  const sy = canvas.height / rect.height || 1;
  return [(clientX - rect.left) * sx, (clientY - rect.top) * sy];
}

interface PreviewZoneImage {
  polygon: { points: [number, number][] };
  bboxIds: number[];
}

interface PairingImagePanelProps {
  panelRef?: React.RefObject<HTMLDivElement | null>;
  onFinishDrawing?: () => void;
  previewZone?: PreviewZoneImage;
}

export function PairingImagePanel({ panelRef, onFinishDrawing, previewZone }: PairingImagePanelProps) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const bboxes = useAppSelector((s) => s.autocalib.calib.bboxes);
  const confidenceThreshold = useAppSelector((s) => s.autocalib.calib.confidenceThreshold);
  const visibleBboxes = useMemo(
    () => visibleCalibBboxes(bboxes, confidenceThreshold),
    [bboxes, confidenceThreshold],
  );
  const pairing = useAppSelector((s) => s.autocalib.pairing);
  const { hasClient, hasCocospot, client: ctxClient, deviceId: ctxDeviceId, cocospotLabel } =
    usePairingDeviceContext();
  const { activeTool, selectedBboxId, zones, activeZoneId, drawingImagePoints } = pairing;
  const {
    linkedBboxIds,
    bboxColorMap,
    selectionPreviewColor,
  } = usePairingVisuals();

  const canvasPanX = useAppSelector((s) => s.autocalib.calib.canvasPanX);
  const canvasPanY = useAppSelector((s) => s.autocalib.calib.canvasPanY);
  const canvasZoom = useAppSelector((s) => s.autocalib.calib.canvasZoom);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bgCanvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const frameCount = useAppSelector((s) => s.autocalib.calib.frameCount);
  const jobId = useAppSelector((s) => s.autocalib.calib.jobId);
  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);

  const panDragging = useRef(false);
  const [isPanDragging, setIsPanDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const panAnchor = useRef({ x: 0, y: 0 });

  const imageLassoRef = useRef<[number, number][] | null>(null);
  const imageLassoLiveRef = useRef<[number, number] | null>(null);
  const canvasZoomRef = useRef(canvasZoom);
  canvasZoomRef.current = canvasZoom;

  const fitImageRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!jobId || frameCount === 0) return;
    setBgImage(null);
    let cancelled = false;

    const loadFromUrl = (url: string) => {
      fetch(url)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.blob();
        })
        .then((blob) => {
          if (cancelled) return;
          const objectUrl = URL.createObjectURL(blob);
          const img = new Image();
          img.onload = () => {
            if (cancelled) {
              URL.revokeObjectURL(objectUrl);
              return;
            }
            setBgImage(img);
            dispatch(calibAlignBboxesToImageSize({ width: img.naturalWidth, height: img.naturalHeight }));
            URL.revokeObjectURL(objectUrl);
          };
          img.onerror = () => URL.revokeObjectURL(objectUrl);
          img.src = objectUrl;
        })
        .catch(() => {});
    };

    if (jobId === 'db-static' && ctxDeviceId) {
      void deviceCalibrationImageDataUrl(ctxDeviceId, false).then((dataUrl) => {
        if (cancelled || !dataUrl) return;
        loadFromUrl(dataUrl);
      });
      return () => {
        cancelled = true;
      };
    }

    loadFromUrl(calibFrameUrl(jobId, PAIRING_FRAME_INDEX));
    return () => {
      cancelled = true;
    };
  }, [jobId, frameCount, ctxDeviceId, dispatch]);

  const imgBounds = useMemo(() => {
    if (visibleBboxes.length === 0) return null;
    let maxX = 0, maxY = 0;
    for (const b of visibleBboxes) {
      maxX = Math.max(maxX, b.x + b.width);
      maxY = Math.max(maxY, b.y + b.height);
    }
    return { width: maxX * 1.1, height: maxY * 1.1 };
  }, [visibleBboxes]);

  const fitImage = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pw = canvas.width || (canvas.parentElement?.clientWidth ?? 0);
    const ph = canvas.height || (canvas.parentElement?.clientHeight ?? 0);
    if (pw <= 0 || ph <= 0) return;

    let contentW: number;
    let contentH: number;
    if (bgImage) {
      contentW = bgImage.width;
      contentH = bgImage.height;
    } else if (imgBounds) {
      contentW = imgBounds.width;
      contentH = imgBounds.height;
    } else return;

    const scaleX = pw / contentW;
    const scaleY = ph / contentH;
    const scale = Math.min(scaleX, scaleY) * 0.95;
    const panX = (pw - contentW * scale) / 2;
    const panY = (ph - contentH * scale) / 2;
    dispatch(calibSetZoom(scale));
    dispatch(calibSetPan({ x: panX, y: panY }));
  }, [dispatch, bgImage, imgBounds]);

  fitImageRef.current = fitImage;

  /* Layer 1 — background (image only). Cheap to compute, expensive to
   * paint. Only redraws when the image or the transform changes. */
  const drawBg = useCallback(() => {
    const canvas = bgCanvasRef.current;
    if (!canvas || canvas.width === 0 || canvas.height === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!bgImage) return;
    const z = canvasZoom <= 0 ? 1 : canvasZoom;
    ctx.save();
    ctx.translate(canvasPanX, canvasPanY);
    ctx.scale(z, z);
    ctx.drawImage(bgImage, 0, 0);
    ctx.restore();
  }, [bgImage, canvasZoom, canvasPanX, canvasPanY]);

  const drawBgRef = useRef(drawBg);
  drawBgRef.current = drawBg;

  useEffect(() => {
    drawBg();
  }, [drawBg]);

  /* Layer 2 — overlay (vectors). Cheap paint. Redraws on every selection,
   * hover, edit. The `drawImage` call is no longer in this hot path. */
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || canvas.width === 0 || canvas.height === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const z = canvasZoom <= 0 ? 1 : canvasZoom;

    ctx.save();
    ctx.translate(canvasPanX, canvasPanY);
    ctx.scale(z, z);

    for (const zone of zones) {
      if (zone.imagePolygon.points.length < 3) continue;
      const zColor = PAIR_PALETTE[zone.colorIndex % PAIR_PALETTE.length] ?? '#37bc9b';
      const isActive = zone.id === activeZoneId;
      ctx.beginPath();
      const pts = zone.imagePolygon.points;
      for (let i = 0; i < pts.length; i++) {
        const pti = pts[i]!;
        if (i === 0) ctx.moveTo(pti[0], pti[1]);
        else ctx.lineTo(pti[0], pti[1]);
      }
      ctx.closePath();
      ctx.globalAlpha = isActive ? 0.25 : 0.12;
      ctx.fillStyle = zColor;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = zColor;
      ctx.lineWidth = (isActive ? 2.5 : 1.5) / z;
      ctx.stroke();
    }

    if (previewZone && previewZone.polygon.points.length >= 3) {
      const pvPts = previewZone.polygon.points;
      ctx.beginPath();
      for (let i = 0; i < pvPts.length; i++) {
        const pt = pvPts[i]!;
        if (i === 0) ctx.moveTo(pt[0], pt[1]);
        else ctx.lineTo(pt[0], pt[1]);
      }
      ctx.closePath();
      ctx.globalAlpha = 0.15;
      ctx.fillStyle = '#37bc9b';
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#37bc9b';
      ctx.lineWidth = 2 / z;
      ctx.setLineDash([4 / z, 3 / z]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // In-progress image lasso (stroke) or committed stroke from Redux
    const lassoStroke = imageLassoRef.current;
    const lassoLive = imageLassoLiveRef.current;
    const committed = drawingImagePoints;
    if ((lassoStroke && lassoStroke.length > 0) || committed.length > 0) {
      const pts = lassoStroke && lassoStroke.length > 0 ? lassoStroke : committed;
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const dpi = pts[i]!;
        if (i === 0) ctx.moveTo(dpi[0], dpi[1]);
        else ctx.lineTo(dpi[0], dpi[1]);
      }
      if (lassoLive && pts.length > 0) {
        ctx.lineTo(lassoLive[0], lassoLive[1]);
      }
      ctx.strokeStyle = '#f6bb42';
      ctx.lineWidth = 2 / z;
      ctx.stroke();
    }

    const previewBboxSet = new Set(
      (previewZone?.bboxIds ?? []).filter((id) => visibleBboxes.some((b) => b.spot_id === id)),
    );

    // Bboxes (same visibility as Calibration slider)
    for (const bbox of visibleBboxes) {
      const bx = bbox.x;
      const by = bbox.y;
      const bw = bbox.width;
      const bh = bbox.height;

      const isSelected = bbox.spot_id === selectedBboxId;
      const isLinked = linkedBboxIds.has(bbox.spot_id);
      const isPreview = previewBboxSet.has(bbox.spot_id);

      let color = '#ffffff';
      if (isPreview) color = '#37bc9b';
      else if (isLinked) color = bboxColorMap.get(bbox.spot_id) ?? '#37bc9b';
      else if (
        isSelected
        && activeTool === 'pair'
        && selectionPreviewColor
      ) {
        color = selectionPreviewColor;
      }

      withCalibBboxTransform(ctx, bbox, () => {
        ctx.strokeStyle = color;
        ctx.lineWidth = (isSelected ? 3 : isPreview ? 2.5 : 1.5) / z;
        ctx.strokeRect(bx, by, bw, bh);
        if (isSelected) {
          ctx.fillStyle = `${color}33`;
          ctx.fillRect(bx, by, bw, bh);
        }
      });
    }

    ctx.restore();
  }, [
    visibleBboxes,
    zones,
    activeZoneId,
    drawingImagePoints,
    selectedBboxId,
    activeTool,
    selectionPreviewColor,
    linkedBboxIds,
    bboxColorMap,
    canvasPanX,
    canvasPanY,
    canvasZoom,
    previewZone,
  ]);

  const drawRef = useRef(draw);
  drawRef.current = draw;

  useEffect(() => {
    if (zones.length === 0 && drawingImagePoints.length === 0) {
      imageLassoRef.current = null;
      imageLassoLiveRef.current = null;
      drawRef.current();
    }
  }, [zones.length, drawingImagePoints.length]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    if (bboxes.length === 0) return;
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;

    const ro = new ResizeObserver(() => {
      const w = wrapper.clientWidth;
      const h = wrapper.clientHeight;
      if (w <= 0 || h <= 0) return;
      canvas.width = w;
      canvas.height = h;
      const bgCanvas = bgCanvasRef.current;
      if (bgCanvas) {
        bgCanvas.width = w;
        bgCanvas.height = h;
      }
      fitImageRef.current();
      queueMicrotask(() => {
        drawBgRef.current();
        drawRef.current();
      });
    });
    ro.observe(wrapper);
    return () => ro.disconnect();
  }, [bboxes.length, confidenceThreshold]);

  useEffect(() => {
    fitImageRef.current();
  }, [bgImage, imgBounds]);

  /** Screen px → image coordinates (matching calib canvas). */
  const toImageCoords = useCallback((cx: number, cy: number): [number, number] => {
    const z = canvasZoom <= 0 ? 1 : canvasZoom;
    return [(cx - canvasPanX) / z, (cy - canvasPanY) / z];
  }, [canvasPanX, canvasPanY, canvasZoom]);

  const bboxAtImagePoint = useCallback(
    (ix: number, iy: number, tol = 0): number | null => {
      for (const bbox of visibleBboxes) {
        if (
          ix >= bbox.x - tol &&
          ix <= bbox.x + bbox.width + tol &&
          iy >= bbox.y - tol &&
          iy <= bbox.y + bbox.height + tol
        ) {
          return bbox.spot_id;
        }
      }
      return null;
    },
    [visibleBboxes],
  );

  const finalizeImageLasso = useCallback(() => {
    const ptsOrig = imageLassoRef.current;
    if (!ptsOrig) return;
    const tail = imageLassoLiveRef.current;
    imageLassoRef.current = null;
    imageLassoLiveRef.current = null;

    const zz = canvasZoomRef.current <= 0 ? 1 : canvasZoomRef.current;
    let poly: [number, number][] = ptsOrig.slice() as [number, number][];
    if (tail && poly.length > 0) {
      const last = poly[poly.length - 1]!;
      const t2 = (0.35 / zz) ** 2;
      const dx = tail[0] - last[0];
      const dy = tail[1] - last[1];
      if (dx * dx + dy * dy >= t2) {
        poly.push([tail[0], tail[1]]);
      }
    }
    dispatch(pairingSetDrawingPoints({ target: 'image', points: poly }));
    drawRef.current();
    if (poly.length >= 3) {
      onFinishDrawing?.();
    }
  }, [dispatch, onFinishDrawing]);

  const onImageLassoPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (activeTool !== 'draw_zone' || e.button !== 0) return;
      e.preventDefault();
      const canvas = canvasRef.current;
      if (!canvas) return;
      const [cx, cy] = canvasPixelCoords(canvas, e.clientX, e.clientY);
      const [ix, iy] = toImageCoords(cx, cy);
      imageLassoRef.current = [[ix, iy]];
      imageLassoLiveRef.current = [ix, iy];
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      drawRef.current();
    },
    [activeTool, toImageCoords],
  );

  const onImageLassoPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!imageLassoRef.current || activeTool !== 'draw_zone') return;
      e.preventDefault();
      const canvas = canvasRef.current;
      if (!canvas) return;
      const [cx, cy] = canvasPixelCoords(canvas, e.clientX, e.clientY);
      const [ix, iy] = toImageCoords(cx, cy);
      const pts = imageLassoRef.current;
      const last = pts[pts.length - 1]!;
      const dz = canvasZoomRef.current <= 0 ? 1 : canvasZoomRef.current;
      const dx = ix - last[0];
      const dy = iy - last[1];
      const minDistSq = (LASSO_MIN_SAMPLE_PX_CANVAS / dz) ** 2;
      if (dx * dx + dy * dy >= minDistSq) {
        pts.push([ix, iy]);
      }
      imageLassoLiveRef.current = [ix, iy];
      drawRef.current();
    },
    [activeTool, toImageCoords],
  );

  const onImageLassoPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!imageLassoRef.current) return;
      e.preventDefault();
      try {
        if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch {
        /* ignore */
      }
      finalizeImageLasso();
    },
    [finalizeImageLasso],
  );

  useEffect(() => {
    if (activeTool !== 'draw_zone') return;
    window.addEventListener('pointerup', finalizeImageLasso);
    window.addEventListener('pointercancel', finalizeImageLasso);
    return () => {
      window.removeEventListener('pointerup', finalizeImageLasso);
      window.removeEventListener('pointercancel', finalizeImageLasso);
    };
  }, [activeTool, finalizeImageLasso]);

  useEffect(() => {
    if (activeTool === 'draw_zone') return;
    imageLassoRef.current = null;
    imageLassoLiveRef.current = null;
    queueMicrotask(() => drawRef.current());
  }, [activeTool]);

  const applyZoomAroundPoint = useCallback(
    (factor: number, cx: number, cy: number) => {
      const z = canvasZoom <= 0 ? 1 : canvasZoom;
      const newZ = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * factor));
      const nextPanX = cx - (cx - canvasPanX) * (newZ / z);
      const nextPanY = cy - (cy - canvasPanY) * (newZ / z);
      dispatch(calibSetZoom(newZ));
      dispatch(calibSetPan({ x: nextPanX, y: nextPanY }));
    },
    [canvasPanX, canvasPanY, canvasZoom, dispatch],
  );

  const zoomIn = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    applyZoomAroundPoint(ZOOM_STEP, cx, cy);
  }, [applyZoomAroundPoint]);

  const zoomOut = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    applyZoomAroundPoint(1 / ZOOM_STEP, cx, cy);
  }, [applyZoomAroundPoint]);

  const imgPointInPolygon = useCallback(
    (px: number, py: number, polygon: [number, number][]) => {
      let inside = false;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const pi = polygon[i]!, pj = polygon[j]!;
        const xi = pi[0], yi = pi[1];
        const xj = pj[0], yj = pj[1];
        if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
          inside = !inside;
        }
      }
      return inside;
    },
    [],
  );

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (activeTool !== 'none') return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const [cx, cy] = canvasPixelCoords(canvas, e.clientX, e.clientY);
      const [ix, iy] = toImageCoords(cx, cy);
      for (const zone of zones) {
        if (zone.imagePolygon.points.length >= 3 && imgPointInPolygon(ix, iy, zone.imagePolygon.points)) {
          const toggle = zone.id === activeZoneId;
          dispatch(pairingSetActiveZone({ zoneId: toggle ? null : zone.id, side: toggle ? null : 'image' }));
          return;
        }
      }
      if (activeZoneId) dispatch(pairingSetActiveZone({ zoneId: null, side: null }));
    },
    [activeTool, zones, activeZoneId, dispatch, toImageCoords, imgPointInPolygon],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || bboxes.length === 0) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const [cx, cy] = canvasPixelCoords(canvas, e.clientX, e.clientY);
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      applyZoomAroundPoint(factor, cx, cy);
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [applyZoomAroundPoint, bboxes.length, confidenceThreshold]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || bboxes.length === 0) return;

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (activeTool === 'draw_zone') return;

      const [cx, cy] = canvasPixelCoords(canvas, e.clientX, e.clientY);
      const [ix, iy] = toImageCoords(cx, cy);

      if (activeTool === 'pair' || activeTool === 'unpair') {
        const tolScreen = 6;
        const z = canvasZoom <= 0 ? 1 : canvasZoom;
        const hit = bboxAtImagePoint(ix, iy, tolScreen / z);
        if (hit != null) {
          dispatch(pairingSelectBbox(hit));
          return;
        }
      }

      panDragging.current = true;
      setIsPanDragging(true);
      dragStart.current = { x: e.clientX, y: e.clientY };
      panAnchor.current = { x: canvasPanX, y: canvasPanY };
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!panDragging.current) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const sx = canvas.width / rect.width || 1;
      const sy = canvas.height / rect.height || 1;
      const dx = (e.clientX - dragStart.current.x) * sx;
      const dy = (e.clientY - dragStart.current.y) * sy;
      dispatch(
        calibSetPan({
          x: panAnchor.current.x + dx,
          y: panAnchor.current.y + dy,
        }),
      );
    };

    const onMouseUp = () => {
      panDragging.current = false;
      setIsPanDragging(false);
    };

    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [activeTool, bboxes.length, confidenceThreshold, bboxAtImagePoint, canvasPanX, canvasPanY, dispatch, toImageCoords]);

  const canvasCursor =
    activeTool === 'draw_zone'
      ? 'crosshair'
      : isPanDragging
        ? 'grabbing'
        : 'grab';

  return (
    <div
      className={styles.panel}
      ref={(el) => {
        if (panelRef && 'current' in panelRef) {
          (panelRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
        }
      }}
    >
      <div className={styles.canvasWrap} ref={wrapperRef}>
        {bboxes.length === 0 ? (
          <div className={styles.emptyState}>
            {hasCocospot ? (
              <>
                <p className={styles.emptyTitle}>{t('pairingImage.noBboxesTitle')}</p>
                <p className={styles.emptyDeviceLine}>
                  <strong>{cocospotLabel}</strong>
                  <span className={styles.emptyMeta}> · {ctxClient}</span>
                </p>
                <small className={styles.emptyHint} title={ctxDeviceId ? t('calib.deviceIdLine', { id: ctxDeviceId }) : undefined}>
                  {t('pairingImage.noBboxesHint')}
                </small>
              </>
            ) : hasClient ? (
              <>
                <p className={styles.emptyTitle}>{t('pairingImage.selectDeviceTitle')}</p>
                <p className={styles.emptyDeviceLine}>
                  <strong>{ctxClient}</strong>
                </p>
                <small className={styles.emptyHint}>
                  <Trans i18nKey="pairingImage.selectDeviceHint" components={{ kCmdD: <Kbd size="sm">⌘D</Kbd> }} />
                </small>
              </>
            ) : (
              <>
                <p className={styles.emptyTitle}>{t('pairingImage.selectClientTitle')}</p>
                <small className={styles.emptyHint}>
                  <Trans i18nKey="pairingImage.selectClientHint" components={{ kCmdD: <Kbd size="sm">⌘D</Kbd> }} />
                </small>
              </>
            )}
          </div>
        ) : (
          <>
            <canvas ref={bgCanvasRef} className={styles.bgCanvas} />
            <canvas
              ref={canvasRef}
              className={styles.canvas}
              style={{ cursor: canvasCursor }}
              onClick={handleCanvasClick}
              onPointerDown={onImageLassoPointerDown}
              onPointerMove={onImageLassoPointerMove}
              onPointerUp={onImageLassoPointerUp}
              onPointerCancel={onImageLassoPointerUp}
            />
            <VerticalZoomBar
              side="right"
              onZoomIn={zoomIn}
              onZoomOut={zoomOut}
              ariaLabel={t('pairingImage.zoomImageAria')}
            />
          </>
        )}
      </div>
      {bboxes.length > 0 && visibleBboxes.length === 0 && (
        <div className={styles.filterBanner} role="status">
          {t('pairingImage.filterBanner')}
        </div>
      )}

    </div>
  );
}
