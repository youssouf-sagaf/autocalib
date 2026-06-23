import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { ObAnnotation, TileDetail } from '../../types';

function drawObbOnCanvas(
  ctx: CanvasRenderingContext2D,
  obb: [number, number, number, number, number],
  stroke: string,
) {
  const [cx, cy, w, h, angle] = obb;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const hw = w / 2;
  const hh = h / 2;
  const corners = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([lx, ly]) => ({
    x: cx + lx! * cos - ly! * sin,
    y: cy + lx! * sin + ly! * cos,
  }));
  ctx.beginPath();
  ctx.moveTo(corners[0]!.x, corners[0]!.y);
  for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i]!.x, corners[i]!.y);
  ctx.closePath();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.stroke();
}

export interface AnnotationStageProps {
  tile: TileDetail | null;
  tileId: string | null;
  annotations: ObAnnotation[];
  obbClicks: { x: number; y: number }[];
  pendingObb: [number, number, number, number, number] | null;
  onCanvasClick: (ev: React.MouseEvent<HTMLCanvasElement>) => void;
}

export function AnnotationStage({
  tile,
  tileId,
  annotations,
  obbClicks,
  pendingObb,
  onCanvasClick,
}: AnnotationStageProps) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !tile?.width || !tile?.height) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const classColor = { vehicle: '#ff6a4a' } as const;
    for (const ann of annotations) {
      if (ann.class === 'background') continue;
      drawObbOnCanvas(ctx, ann.obb, classColor[ann.class]);
    }
    if (pendingObb) drawObbOnCanvas(ctx, pendingObb, '#3bafda');
    ctx.fillStyle = '#f6bb42';
    for (const p of obbClicks) {
      const sx = (p.x / tile.width!) * canvas.width;
      const sy = (p.y / tile.height!) * canvas.height;
      ctx.beginPath();
      ctx.arc(sx, sy, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [annotations, obbClicks, pendingObb, tile]);

  if (!tileId) {
    return (
      <div className="annotation-stage annotation-stage-empty">
        <p>{t('annotate.selectTile')}</p>
      </div>
    );
  }

  if (!tile?.image_url) {
    return (
      <div className="annotation-stage annotation-stage-empty">
        <p>{t('annotate.loadingTile')}</p>
      </div>
    );
  }

  return (
    <div className="annotation-stage">
      <div className="annotation-stage-header mono">
        {tile.name ?? tile.id.slice(0, 12)}
        {tile.width && tile.height ? ` · ${tile.width}×${tile.height}` : ''}
      </div>
      <div className="annotation-stage-body">
        <img src={tile.image_url} alt="" className="annotation-stage-image" />
        <canvas
          ref={canvasRef}
          width={tile.width ?? 1024}
          height={tile.height ?? 1024}
          className="annotation-stage-canvas"
          onClick={onCanvasClick}
        />
      </div>
    </div>
  );
}
