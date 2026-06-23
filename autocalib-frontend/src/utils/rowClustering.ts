/**
 * Row-based clustering for auto-suggest pairing.
 *
 * Groups items into horizontal rows by Y-coordinate proximity,
 * then provides helpers to match rows between map slots and image bboxes.
 */

// ─── Generic row clustering ─────────────────────────────────────────────────

export interface RowCluster<T> {
  items: T[];
  meanY: number;
}

/**
 * Adaptive tolerance: median of consecutive Y-gaps, clamped to a reasonable range.
 * Falls back to `fallback` when fewer than 2 items.
 */
export function computeRowTolerance(
  sortedYs: number[],
  fallback: number,
): number {
  if (sortedYs.length < 2) return fallback;
  const gaps: number[] = [];
  for (let i = 1; i < sortedYs.length; i++) {
    gaps.push(Math.abs(sortedYs[i]! - sortedYs[i - 1]!));
  }
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)]!;
  return Math.max(fallback * 0.1, median * 0.6);
}

/**
 * Cluster items into horizontal rows.
 * Items must be pre-sorted by Y ascending (top-to-bottom).
 * Items within the same row (Y difference < tolerance) are grouped together,
 * then sorted left-to-right by X.
 */
export function clusterIntoRows<T>(
  items: T[],
  getY: (item: T) => number,
  getX: (item: T) => number,
  tolerance: number,
): RowCluster<T>[] {
  if (items.length === 0) return [];

  const sorted = [...items].sort((a, b) => getY(a) - getY(b));
  const rows: RowCluster<T>[] = [];
  let currentRow: T[] = [sorted[0]!];
  let currentY = getY(sorted[0]!);

  for (let i = 1; i < sorted.length; i++) {
    const y = getY(sorted[i]!);
    if (Math.abs(y - currentY) <= tolerance) {
      currentRow.push(sorted[i]!);
    } else {
      rows.push(finalizeRow(currentRow, getY, getX));
      currentRow = [sorted[i]!];
      currentY = y;
    }
  }
  rows.push(finalizeRow(currentRow, getY, getX));
  return rows;
}

function finalizeRow<T>(
  items: T[],
  getY: (item: T) => number,
  getX: (item: T) => number,
): RowCluster<T> {
  const sorted = [...items].sort((a, b) => getX(a) - getX(b));
  const meanY = sorted.reduce((sum, it) => sum + getY(it), 0) / sorted.length;
  return { items: sorted, meanY };
}

// ─── Polygon builder ────────────────────────────────────────────────────────

/**
 * Build a padded bounding-box polygon around a set of 2D points.
 * Used to generate zone overlays for auto-suggested rows.
 */
export function buildRowPolygon(
  points: [number, number][],
  padX: number,
  padY: number,
): [number, number][] {
  if (points.length === 0) return [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return [
    [minX - padX, minY - padY],
    [maxX + padX, minY - padY],
    [maxX + padX, maxY + padY],
    [minX - padX, maxY + padY],
  ];
}

// ─── Spatial cluster proposal ───────────────────────────────────────────────

/**
 * Given N items selected on one side, find up to `maxProposals` candidate
 * groups of exactly N items from `candidates`, ranked by spatial compactness.
 *
 * Strategy: cluster candidates into rows, then find rows (or consecutive row
 * combinations) that sum to exactly N items. Score each by spatial spread
 * (lower = more compact = better). Return top K distinct proposals.
 */
export function findBestClusters<T>(
  candidates: T[],
  targetCount: number,
  getX: (item: T) => number,
  getY: (item: T) => number,
  maxProposals: number,
): T[][] {
  if (candidates.length < targetCount || targetCount === 0) return [];

  const ys = candidates.map(getY).sort((a, b) => a - b);
  const tol = computeRowTolerance(ys, 10);
  const rows = clusterIntoRows(candidates, getY, getX, tol);

  const results: { items: T[]; score: number }[] = [];

  // Single rows that match count exactly
  for (const row of rows) {
    if (row.items.length === targetCount) {
      results.push({ items: row.items, score: spreadScore(row.items, getX, getY) });
    }
  }

  // Consecutive row combinations
  for (let start = 0; start < rows.length; start++) {
    let count = 0;
    const items: T[] = [];
    for (let end = start; end < rows.length; end++) {
      count += rows[end]!.items.length;
      items.push(...rows[end]!.items);
      if (count === targetCount) {
        results.push({ items: [...items], score: spreadScore(items, getX, getY) });
        break;
      }
      if (count > targetCount) break;
    }
  }

  // If no row-based match, try nearest-neighbor greedy approach
  if (results.length === 0) {
    const sorted = [...candidates].sort((a, b) => getY(a) - getY(b) || getX(a) - getX(b));
    for (let start = 0; start <= sorted.length - targetCount; start++) {
      const group = sorted.slice(start, start + targetCount);
      results.push({ items: group, score: spreadScore(group, getX, getY) });
    }
  }

  results.sort((a, b) => a.score - b.score);

  // Deduplicate and return top K
  const seen = new Set<string>();
  const output: T[][] = [];
  for (const r of results) {
    const key = r.items.map((it) => `${getX(it).toFixed(4)},${getY(it).toFixed(4)}`).sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(r.items);
    if (output.length >= maxProposals) break;
  }
  return output;
}

function spreadScore<T>(items: T[], getX: (t: T) => number, getY: (t: T) => number): number {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const it of items) {
    const x = getX(it), y = getY(it);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return (maxX - minX) + (maxY - minY);
}
