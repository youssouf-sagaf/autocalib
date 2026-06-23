import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createLogger } from '../../utils/logger';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import {
  calibSetZoom,
  calibSetPan,
  calibAddBbox,
  calibModifyBbox,
  calibSelectBbox,
  calibSetSelection,
  calibClearSelection,
  calibAlignBboxesToImageSize,
} from '../../store/autocalib-slice';
import type { CalibBbox } from '../../types';
import { fillCalibBbox, strokeCalibBbox } from '../../utils/calib-canvas-draw';
import { pointInRing } from '../../utils/geoHitTest';

const log = createLogger('calib-canvas');

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 10;
const ZOOM_STEP = 1.25;
const LASSO_MIN_SAMPLE_PX_CANVAS = 1.35;
/** Map pointer position to canvas backing-store pixels (handles CSS scaling vs bitmap size). */
function canvasPixelCoords(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): [number, number] {
  const rect = canvas.getBoundingClientRect();
  const sx = canvas.width / rect.width || 1;
  const sy = canvas.height / rect.height || 1;
  return [(clientX - rect.left) * sx, (clientY - rect.top) * sy];
}

/** Bbox overlaps axis-aligned marquee in image coords (better than center-only for drag-select). */
function bboxIntersectsMarquee(b: CalibBbox, x1: number, y1: number, x2: number, y2: number): boolean {
  return b.x <= x2 && b.x + b.width >= x1 && b.y <= y2 && b.y + b.height >= y1;
}

/** True if center or any corner sits inside closed polygon on mouse-up. */
function bboxInsideLassoPolygon(b: CalibBbox, closed: [number, number][]): boolean {
  const pts: [number, number][] = [
    [b.center_x, b.center_y],
    [b.x, b.y],
    [b.x + b.width, b.y],
    [b.x, b.y + b.height],
    [b.x + b.width, b.y + b.height],
  ];
  return pts.some(([x, y]) => pointInRing(x, y, closed));
}

export function useCalibCanvas(canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  const dispatch = useAppDispatch();
  const calib = useAppSelector((s) => s.autocalib.calib);
  const {
    bboxes,
    selectedBboxIds,
    lockedBboxIds,
    editMode,
    confidenceThreshold,
    showCalibEditorResult,
  } = calib;

  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [hoveredBboxId, setHoveredBboxId] = useState<number | null>(null);

  const zoom = useRef(1);
  const panX = useRef(0);
  const panY = useRef(0);
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const panDragAnchor = useRef({ x: 0, y: 0 });

  const modifyingBbox = useRef<CalibBbox | null>(null);
  const modifyOffset = useRef({ x: 0, y: 0 });

  /* Rectangle marquee (select mode): drag from empty canvas area; on release,
   * all visible bboxes whose center lies inside the axis-aligned rect are selected. */
  const marqueeStart = useRef<[number, number] | null>(null);
  const marqueeEnd = useRef<[number, number] | null>(null);
  const marqueeAdditive = useRef(false);

  /* Free polygon (lasso_select): sampled vertices + live pointer tip for fluid preview. */
  const lassoPoints = useRef<[number, number][] | null>(null);
  /** Current pointer in image coords (extends path visually between samples). */
  const lassoLive = useRef<[number, number] | null>(null);
  const lassoAdditive = useRef(false);

  /** While non-null, pointer is captured — don't treat pointerleave as cancel. */
  const dragCapturePointerId = useRef<number | null>(null);

  /** Batches repaint during lasso strokes to one animation frame where possible. */
  const lassoDrawRaf = useRef<number | null>(null);

  const visibleBboxes = useMemo(
    () =>
      showCalibEditorResult ? bboxes.filter((b) => b.confidence >= confidenceThreshold) : [],
    [bboxes, confidenceThreshold, showCalibEditorResult],
  );

  const drawRef = useRef<() => void>(() => {});
  const fitImageRef = useRef<() => void>(() => {});

  const clearImage = useCallback(() => {
    setImageUrl(null);
    setImage(null);
  }, []);

  const onLoadErrorRef = useRef<((status: number) => void) | null>(null);

  const loadImage = useCallback((url: string, onError?: (status: number) => void) => {
    onLoadErrorRef.current = onError ?? null;
    setImageUrl(url);
    setImage(null);
    fetch(url)
      .then((res) => {
        if (!res.ok) {
          onLoadErrorRef.current?.(res.status);
          throw new Error(`HTTP ${res.status}`);
        }
        return res.blob();
      })
      .then((blob) => {
        const objectUrl = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          setImage(img);
          dispatch(calibAlignBboxesToImageSize({ width: img.naturalWidth, height: img.naturalHeight }));
          URL.revokeObjectURL(objectUrl);
        };
        img.onerror = () => {
          log.warn('Failed to decode frame image');
          URL.revokeObjectURL(objectUrl);
        };
        img.src = objectUrl;
      })
      .catch((err) => log.warn('Failed to fetch frame image:', err));
  }, [dispatch]);

  const toImage = useCallback(
    (cx: number, cy: number): [number, number] => {
      return [(cx - panX.current) / zoom.current, (cy - panY.current) / zoom.current];
    },
    [],
  );

  const hitTest = useCallback(
    (cx: number, cy: number): CalibBbox | null => {
      const [ix, iy] = toImage(cx, cy);
      for (let i = visibleBboxes.length - 1; i >= 0; i--) {
        const b = visibleBboxes[i]!;
        if (ix >= b.x && ix <= b.x + b.width && iy >= b.y && iy <= b.y + b.height) {
          return b;
        }
      }
      return null;
    },
    [toImage, visibleBboxes],
  );

  /* ── Draw ── */

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);

    ctx.save();
    ctx.translate(panX.current, panY.current);
    ctx.scale(zoom.current, zoom.current);

    if (image) {
      ctx.drawImage(image, 0, 0);
    }

    const selectedSet = new Set(selectedBboxIds);
    const lockedSet = new Set(lockedBboxIds);

    for (const bbox of visibleBboxes) {
      const isSelected = selectedSet.has(bbox.spot_id);
      const isLocked = lockedSet.has(bbox.spot_id);

      const lw = 1.5 / zoom.current;
      ctx.lineWidth = lw;

      if (isLocked && isSelected) {
        ctx.strokeStyle = '#e8a317';
        ctx.fillStyle = 'rgba(246, 187, 66, 0.35)';
      } else if (isLocked) {
        ctx.strokeStyle = '#f6bb42';
        ctx.fillStyle = 'rgba(246, 187, 66, 0.2)';
      } else if (isSelected) {
        ctx.strokeStyle = '#37bc9b';
        ctx.fillStyle = 'rgba(55, 188, 155, 0.3)';
      } else {
        ctx.strokeStyle = '#ffffff';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
      }

      fillCalibBbox(ctx, bbox);
      strokeCalibBbox(ctx, bbox);

      // Center dot
      ctx.beginPath();
      ctx.arc(bbox.center_x, bbox.center_y, 2 / zoom.current, 0, Math.PI * 2);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fill();

      // Lock icon: small padlock glyph top-right
      if (isLocked) {
        const iconSize = 8 / zoom.current;
        const ix = bbox.x + bbox.width - iconSize * 0.3;
        const iy = bbox.y - iconSize * 0.3;
        ctx.save();
        ctx.fillStyle = '#f6bb42';
        ctx.strokeStyle = '#c07d10';
        ctx.lineWidth = 0.8 / zoom.current;
        // padlock body
        ctx.fillRect(ix, iy + iconSize * 0.4, iconSize, iconSize * 0.6);
        ctx.strokeRect(ix, iy + iconSize * 0.4, iconSize, iconSize * 0.6);
        // shackle arc
        ctx.beginPath();
        ctx.arc(ix + iconSize / 2, iy + iconSize * 0.4, iconSize * 0.35, Math.PI, 0);
        ctx.stroke();
        ctx.restore();
      }

      // Selection handles: small squares at corners
      if (isSelected && !isLocked) {
        const hs = 3 / zoom.current;
        ctx.fillStyle = '#37bc9b';
        const corners = [
          [bbox.x, bbox.y],
          [bbox.x + bbox.width, bbox.y],
          [bbox.x, bbox.y + bbox.height],
          [bbox.x + bbox.width, bbox.y + bbox.height],
        ];
        for (const corner of corners) {
          ctx.fillRect(corner[0]! - hs / 2, corner[1]! - hs / 2, hs, hs);
        }
      }
    }

    // Marquee preview (select mode)
    const ms = marqueeStart.current;
    const me = marqueeEnd.current;
    if (ms && me) {
      const x1 = Math.min(ms[0], me[0]);
      const y1 = Math.min(ms[1], me[1]);
      const x2 = Math.max(ms[0], me[0]);
      const y2 = Math.max(ms[1], me[1]);
      ctx.strokeStyle = 'rgba(55, 188, 155, 0.95)';
      ctx.lineWidth = 1.25 / zoom.current;
      ctx.setLineDash([5 / zoom.current, 4 / zoom.current]);
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(55, 188, 155, 0.12)';
      ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
    }

    const lp = lassoPoints.current;
    const live = lassoLive.current;
    if (lp && lp.length > 0) {
      ctx.strokeStyle = 'rgba(45, 200, 160, 0.98)';
      ctx.lineWidth = 2 / zoom.current;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowColor = 'rgba(0, 40, 30, 0.45)';
      ctx.shadowBlur = 3 / zoom.current;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(lp[0]![0], lp[0]![1]);
      for (let i = 1; i < lp.length; i++) {
        ctx.lineTo(lp[i]![0], lp[i]![1]);
      }
      if (live) {
        ctx.lineTo(live[0], live[1]);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      const closeFrom = live ?? lp[lp.length - 1]!;
      const sx = lp[0]![0];
      const sy = lp[0]![1];
      ctx.setLineDash([4 / zoom.current, 5 / zoom.current]);
      ctx.strokeStyle = 'rgba(200, 245, 225, 0.85)';
      ctx.lineWidth = 1.1 / zoom.current;
      ctx.beginPath();
      ctx.moveTo(closeFrom[0], closeFrom[1]);
      ctx.lineTo(sx, sy);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Drag preview
    if (modifyingBbox.current) {
      const mb = modifyingBbox.current;
      ctx.lineWidth = 2 / zoom.current;
      ctx.strokeStyle = '#da4453';
      ctx.setLineDash([4 / zoom.current, 4 / zoom.current]);
      ctx.strokeRect(mb.x, mb.y, mb.width, mb.height);
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(mb.center_x, mb.center_y, 2 / zoom.current, 0, Math.PI * 2);
      ctx.fillStyle = '#da4453';
      ctx.fill();
    }

    ctx.restore();
  }, [canvasRef, image, visibleBboxes, selectedBboxIds, lockedBboxIds]);

  drawRef.current = draw;

  const scheduleRedraw = useCallback(() => {
    if (lassoDrawRaf.current != null) return;
    lassoDrawRaf.current = requestAnimationFrame(() => {
      lassoDrawRaf.current = null;
      drawRef.current();
    });
  }, []);

  const cancelScheduledRedraw = useCallback(() => {
    if (lassoDrawRaf.current != null) {
      cancelAnimationFrame(lassoDrawRaf.current);
      lassoDrawRaf.current = null;
    }
  }, []);

  const tryGrabPointer = (canvas: HTMLCanvasElement, e: PointerEvent) => {
    if (dragCapturePointerId.current !== null) return;
    dragCapturePointerId.current = e.pointerId;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      dragCapturePointerId.current = null;
    }
  };

  const releaseGrabbedPointer = (canvas: HTMLCanvasElement) => {
    const pid = dragCapturePointerId.current;
    if (pid === null) return;
    dragCapturePointerId.current = null;
    try {
      if (canvas.hasPointerCapture(pid)) canvas.releasePointerCapture(pid);
    } catch {
      /* ignore */
    }
  };

  /* ── Fit / zoom helpers ── */

  const fitImage = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let contentW: number;
    let contentH: number;

    if (image) {
      contentW = image.width;
      contentH = image.height;
    } else if (visibleBboxes.length > 0) {
      const maxX = Math.max(...visibleBboxes.map((b) => b.x + b.width));
      const maxY = Math.max(...visibleBboxes.map((b) => b.y + b.height));
      contentW = maxX + 20;
      contentH = maxY + 20;
    } else {
      return;
    }

    const scaleX = canvas.width / contentW;
    const scaleY = canvas.height / contentH;
    const scale = Math.min(scaleX, scaleY) * 0.95;
    zoom.current = scale;
    panX.current = (canvas.width - contentW * scale) / 2;
    panY.current = (canvas.height - contentH * scale) / 2;
    dispatch(calibSetZoom(scale));
    dispatch(calibSetPan({ x: panX.current, y: panY.current }));
    drawRef.current();
  }, [canvasRef, image, visibleBboxes, dispatch]);

  fitImageRef.current = fitImage;

  const applyZoom = useCallback(
    (factor: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom.current * factor));
      panX.current = cx - (cx - panX.current) * (newZoom / zoom.current);
      panY.current = cy - (cy - panY.current) * (newZoom / zoom.current);
      zoom.current = newZoom;
      dispatch(calibSetZoom(newZoom));
      dispatch(calibSetPan({ x: panX.current, y: panY.current }));
      drawRef.current();
    },
    [canvasRef, dispatch],
  );

  const zoomIn = useCallback(() => applyZoom(ZOOM_STEP), [applyZoom]);
  const zoomOut = useCallback(() => applyZoom(1 / ZOOM_STEP), [applyZoom]);

  // Redraw on any change
  useEffect(() => {
    draw();
  }, [draw]);

  // Fit when image loads or bbox count changes — not on every selection/edit (that reset zoom).
  useEffect(() => {
    if (!image && visibleBboxes.length === 0) return;
    fitImageRef.current();
  }, [image, visibleBboxes.length]);

  // Resize observer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const ro = new ResizeObserver(() => {
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
      if (image || visibleBboxes.length > 0) fitImageRef.current();
      else drawRef.current();
    });
    ro.observe(parent);
    return () => ro.disconnect();
  }, [canvasRef, image, visibleBboxes.length]);

  /* ── Canvas events ── */

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      const canvas = canvasRef.current;
      if (!canvas) return;
      const [cx, cy] = canvasPixelCoords(canvas, e.clientX, e.clientY);
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom.current * factor));
      panX.current = cx - (cx - panX.current) * (newZoom / zoom.current);
      panY.current = cy - (cy - panY.current) * (newZoom / zoom.current);
      zoom.current = newZoom;
      dispatch(calibSetZoom(newZoom));
      dispatch(calibSetPan({ x: panX.current, y: panY.current }));
      drawRef.current();
    },
    [canvasRef, dispatch],
  );

  const handlePointerDown = useCallback(
    (e: PointerEvent) => {
      if (e.button !== 0) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const [cx, cy] = canvasPixelCoords(canvas, e.clientX, e.clientY);
      const lockedSet = new Set(lockedBboxIds);

      // ── Modify: drag to move (locked bboxes blocked)
      if (editMode === 'modify') {
        const hit = hitTest(cx, cy);
        if (hit && !lockedSet.has(hit.spot_id)) {
          modifyingBbox.current = { ...hit };
          const [ix, iy] = toImage(cx, cy);
          modifyOffset.current = { x: ix - hit.x, y: iy - hit.y };
          tryGrabPointer(canvas, e);
          return;
        }
        // Fall through to pan
      }

      // ── Add: click to place
      if (editMode === 'add') {
        const [ix, iy] = toImage(cx, cy);
        const size = 10;
        const half = size / 2;
        const nextId = bboxes.length > 0 ? Math.max(...bboxes.map((b) => b.spot_id)) + 1 : 0;
        dispatch(
          calibAddBbox({
            spot_id: nextId,
            center_x: Math.round(ix * 10) / 10,
            center_y: Math.round(iy * 10) / 10,
            x: Math.round((ix - half) * 10) / 10,
            y: Math.round((iy - half) * 10) / 10,
            width: size,
            height: size,
            n_frames: 1,
            confidence: 1.0,
          }),
        );
        return;
      }

      // ── Select: click bbox toggles membership; empty → rectangle marquee
      if (editMode === 'select') {
        const hit = hitTest(cx, cy);
        if (hit) {
          dispatch(calibSelectBbox(hit.spot_id));
          draw();
          return;
        }
        // Empty space → rectangle marquee
        const [ix, iy] = toImage(cx, cy);
        marqueeStart.current = [ix, iy];
        marqueeEnd.current = [ix, iy];
        marqueeAdditive.current = e.shiftKey;
        if (!e.shiftKey) {
          dispatch(calibClearSelection());
        }
        tryGrabPointer(canvas, e);
        return;
      }

      // ── Lasso: same click on bbox toggles; empty → trace free polygon
      if (editMode === 'lasso_select') {
        const hitLasso = hitTest(cx, cy);
        if (hitLasso) {
          dispatch(calibSelectBbox(hitLasso.spot_id));
          draw();
          return;
        }
        if (e.pointerType === 'touch') e.preventDefault();
        const [ixl, iyl] = toImage(cx, cy);
        lassoPoints.current = [[ixl, iyl]];
        lassoLive.current = [ixl, iyl];
        lassoAdditive.current = e.shiftKey;
        if (!e.shiftKey) {
          dispatch(calibClearSelection());
        }
        tryGrabPointer(canvas, e);
        return;
      }

      // ── Browse (none): click replaces selection / Shift+click toggles; empty → pan
      if (editMode === 'none') {
        const hitNone = hitTest(cx, cy);
        if (hitNone) {
          if (e.shiftKey) {
            dispatch(calibSelectBbox(hitNone.spot_id));
          } else {
            dispatch(calibSetSelection([hitNone.spot_id]));
          }
          draw();
          return;
        }

        if (!e.shiftKey) {
          dispatch(calibClearSelection());
        }

        isDragging.current = true;
        dragStart.current = { x: e.clientX, y: e.clientY };
        panDragAnchor.current = { x: panX.current, y: panY.current };
        tryGrabPointer(canvas, e);
        return;
      }

      // Modify missed bbox → pan (same as previous fall-through)
      isDragging.current = true;
      dragStart.current = { x: e.clientX, y: e.clientY };
      panDragAnchor.current = { x: panX.current, y: panY.current };
      tryGrabPointer(canvas, e);
    },
    [canvasRef, editMode, hitTest, toImage, dispatch, bboxes, lockedBboxIds, draw],
  );

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      if (modifyingBbox.current) {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const [cx, cy] = canvasPixelCoords(canvas, e.clientX, e.clientY);
        const [ix, iy] = toImage(cx, cy);
        const w = modifyingBbox.current.width;
        const h = modifyingBbox.current.height;
        modifyingBbox.current = {
          ...modifyingBbox.current,
          x: Math.round((ix - modifyOffset.current.x) * 10) / 10,
          y: Math.round((iy - modifyOffset.current.y) * 10) / 10,
          center_x: Math.round((ix - modifyOffset.current.x + w / 2) * 10) / 10,
          center_y: Math.round((iy - modifyOffset.current.y + h / 2) * 10) / 10,
        };
        draw();
        return;
      }
      if (lassoPoints.current) {
        const canvasL = canvasRef.current;
        if (!canvasL) return;
        const [clx, cly] = canvasPixelCoords(canvasL, e.clientX, e.clientY);
        const [ixl, iyl] = toImage(clx, cly);
        lassoLive.current = [ixl, iyl];
        const pts = lassoPoints.current;
        const last = pts[pts.length - 1]!;
        const dx = ixl - last[0];
        const dy = iyl - last[1];
        const minDistSq = (LASSO_MIN_SAMPLE_PX_CANVAS / zoom.current) ** 2;
        if (dx * dx + dy * dy >= minDistSq) {
          pts.push([ixl, iyl]);
        }
        scheduleRedraw();
        return;
      }
      if (marqueeStart.current) {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const [cx, cy] = canvasPixelCoords(canvas, e.clientX, e.clientY);
        const [ix, iy] = toImage(cx, cy);
        marqueeEnd.current = [ix, iy];
        draw();
        return;
      }
      if (isDragging.current) {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const sx = canvas.width / rect.width || 1;
        const sy = canvas.height / rect.height || 1;
        const dx = (e.clientX - dragStart.current.x) * sx;
        const dy = (e.clientY - dragStart.current.y) * sy;
        panX.current = panDragAnchor.current.x + dx;
        panY.current = panDragAnchor.current.y + dy;
        dispatch(calibSetPan({ x: panX.current, y: panY.current }));
        drawRef.current();
        return;
      }

      if (editMode === 'none') {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const [cx, cy] = canvasPixelCoords(canvas, e.clientX, e.clientY);
        const hit = hitTest(cx, cy);
        setHoveredBboxId(hit?.spot_id ?? null);
      }
    },
    [canvasRef, toImage, draw, dispatch, scheduleRedraw, editMode, hitTest],
  );

  const handlePointerUp = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas) releaseGrabbedPointer(canvas);
    cancelScheduledRedraw();

    if (modifyingBbox.current) {
      dispatch(calibModifyBbox(modifyingBbox.current));
      modifyingBbox.current = null;
      draw();
    }
    if (lassoPoints.current !== null) {
      const committed = lassoPoints.current;
      const tail = lassoLive.current;
      const additive = lassoAdditive.current;
      lassoPoints.current = null;
      lassoLive.current = null;
      lassoAdditive.current = false;

      const poly: [number, number][] = committed.slice();
      if (tail) {
        const last = poly[poly.length - 1]!;
        const t2 = (0.35 / zoom.current) ** 2;
        const dx = tail[0] - last[0];
        const dy = tail[1] - last[1];
        if (dx * dx + dy * dy >= t2) {
          poly.push([tail[0], tail[1]]);
        }
      }
      if (poly.length >= 3) {
        const inside: number[] = [];
        for (const bbox of visibleBboxes) {
          if (bboxInsideLassoPolygon(bbox, poly)) {
            inside.push(bbox.spot_id);
          }
        }
        if (inside.length > 0) {
          if (additive) {
            const merged = Array.from(new Set([...selectedBboxIds, ...inside]));
            dispatch(calibSetSelection(merged));
          } else {
            dispatch(calibSetSelection(inside));
          }
        }
      }
      draw();
    }
    if (marqueeStart.current) {
      const a = marqueeStart.current;
      const b = marqueeEnd.current ?? a;
      let x1 = Math.min(a[0], b[0]);
      let y1 = Math.min(a[1], b[1]);
      let x2 = Math.max(a[0], b[0]);
      let y2 = Math.max(a[1], b[1]);
      const wMarq = x2 - x1;
      const hMarq = y2 - y1;
      // Image-space equivalents of a few CSS pixels (~3 px) — rejects pure click jitter.
      const minDragPx = 3 / zoom.current;
      if (Math.max(wMarq, hMarq) < minDragPx) {
        marqueeStart.current = null;
        marqueeEnd.current = null;
        marqueeAdditive.current = false;
        draw();
        isDragging.current = false;
        return;
      }
      // Horizontal- or vertical-only drags kept w+h tests from ever succeeding; inflate thin bands.
      const minThickness = Math.max(2 / zoom.current, 1e-3);
      if (wMarq < minThickness) {
        const mx = (x1 + x2) / 2;
        x1 = mx - minThickness / 2;
        x2 = mx + minThickness / 2;
      }
      if (hMarq < minThickness) {
        const my = (y1 + y2) / 2;
        y1 = my - minThickness / 2;
        y2 = my + minThickness / 2;
      }
      const inside: number[] = [];
      for (const bbox of visibleBboxes) {
        if (bboxIntersectsMarquee(bbox, x1, y1, x2, y2)) {
          inside.push(bbox.spot_id);
        }
      }
      if (inside.length > 0) {
        if (marqueeAdditive.current) {
          const merged = Array.from(new Set([...selectedBboxIds, ...inside]));
          dispatch(calibSetSelection(merged));
        } else {
          dispatch(calibSetSelection(inside));
        }
      }
      marqueeStart.current = null;
      marqueeEnd.current = null;
      marqueeAdditive.current = false;
      draw();
    }
    isDragging.current = false;
  }, [dispatch, draw, visibleBboxes, selectedBboxIds, cancelScheduledRedraw]);

  const handlePointerLeave = useCallback(() => {
    setHoveredBboxId(null);
    if (dragCapturePointerId.current !== null) return;
    handlePointerUp();
  }, [handlePointerUp]);

  // Attach canvas events
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerup', handlePointerUp);
    canvas.addEventListener('pointercancel', handlePointerUp);
    canvas.addEventListener('pointerleave', handlePointerLeave);
    return () => {
      canvas.removeEventListener('wheel', handleWheel);
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerup', handlePointerUp);
      canvas.removeEventListener('pointercancel', handlePointerUp);
      canvas.removeEventListener('pointerleave', handlePointerLeave);
    };
  }, [canvasRef, handleWheel, handlePointerDown, handlePointerMove, handlePointerUp, handlePointerLeave]);

  /* ── Cursor style ── */
  const cursorStyle = (() => {
    switch (editMode) {
      case 'add':
        return 'crosshair';
      case 'modify':
        return 'move';
      case 'remove':
        return 'default';
      case 'none':
        return hoveredBboxId !== null ? 'pointer' : 'grab';
      case 'select':
        return 'pointer';
      case 'lasso_select':
        return 'crosshair';
      default:
        return 'default';
    }
  })();

  return { loadImage, clearImage, fitImage, image, imageUrl, zoom: zoom.current, draw, zoomIn, zoomOut, cursorStyle };
}
