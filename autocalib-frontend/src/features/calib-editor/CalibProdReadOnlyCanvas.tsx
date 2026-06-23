import { useEffect, useRef } from 'react';
import type { CalibBbox } from '../../types';
import { strokeCalibBbox } from '../../utils/calib-canvas-draw';

interface CalibProdReadOnlyCanvasProps {
  imageUrl: string | null;
  bboxes: CalibBbox[];
  className?: string;
}

export function CalibProdReadOnlyCanvas({
  imageUrl,
  bboxes,
  className,
}: CalibProdReadOnlyCanvasProps) {
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

      if (!imageUrl) return;

      const img = new Image();
      img.onload = () => {
        const iw = img.naturalWidth;
        const ih = img.naturalHeight;
        const scale = Math.min(cw / iw, ch / ih);
        const dw = iw * scale;
        const dh = ih * scale;
        const ox = (cw - dw) / 2;
        const oy = (ch - dh) / 2;

        ctx.clearRect(0, 0, cw, ch);
        ctx.drawImage(img, ox, oy, dw, dh);

        ctx.save();
        ctx.translate(ox, oy);
        ctx.scale(scale, scale);
        ctx.strokeStyle = '#22d3ee';
        ctx.lineWidth = 2;
        for (const bbox of bboxes) {
          strokeCalibBbox(ctx, bbox);
        }
        ctx.restore();
      };
      img.src = imageUrl;
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(container);
    return () => ro.disconnect();
  }, [imageUrl, bboxes]);

  return (
    <div ref={containerRef} className={className} style={{ width: '100%', height: '100%' }}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
    </div>
  );
}
