import { useEffect, useRef } from 'react';
import type { CalibPreviewDetection } from '../../types';
import { previewLabelColor } from './calib-preview-utils';

interface CalibPreviewCanvasProps {
  imageUrl: string | null;
  imageWidth: number;
  imageHeight: number;
  detections: CalibPreviewDetection[];
  className?: string;
}

function drawPreviewOverlays(
  ctx: CanvasRenderingContext2D,
  detections: CalibPreviewDetection[],
  w: number,
  h: number,
): void {
  for (const det of detections) {
    const x = det.x_norm * w;
    const y = det.y_norm * h;
    const bw = det.width_norm * w;
    const bh = det.height_norm * h;
    const color = previewLabelColor(det.label_name);

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, bw, bh);

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(det.center_x_norm * w, det.center_y_norm * h, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function CalibPreviewCanvas({
  imageUrl,
  imageWidth,
  imageHeight,
  detections,
  className,
}: CalibPreviewCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const draw = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const cw = container.clientWidth;
      const ch = container.clientHeight;
      if (cw <= 0 || ch <= 0) return;

      canvas.width = cw;
      canvas.height = ch;
      ctx.clearRect(0, 0, cw, ch);

      if (!imageUrl || imageWidth <= 0 || imageHeight <= 0) return;

      const img = new Image();
      img.onload = () => {
        const scale = Math.min(cw / imageWidth, ch / imageHeight);
        const dw = imageWidth * scale;
        const dh = imageHeight * scale;
        const ox = (cw - dw) / 2;
        const oy = (ch - dh) / 2;

        ctx.clearRect(0, 0, cw, ch);
        ctx.drawImage(img, ox, oy, dw, dh);

        ctx.save();
        ctx.translate(ox, oy);
        ctx.scale(scale, scale);
        drawPreviewOverlays(ctx, detections, imageWidth, imageHeight);
        ctx.restore();
      };
      img.src = imageUrl;
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(container);
    return () => ro.disconnect();
  }, [imageUrl, imageWidth, imageHeight, detections]);

  return (
    <div ref={containerRef} className={className} style={{ width: '100%', height: '100%' }}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
    </div>
  );
}
