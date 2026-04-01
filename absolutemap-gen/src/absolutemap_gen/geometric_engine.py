"""Geometric post-processing: recover missed parking spots using mask geometry and row structure.

Sits between YOLO-OBB detection (stage 03) and GeoJSON export (stage 05).
Uses the segmentation mask shape and detected-spot geometry to fill gaps,
extend rows, and recover uncovered regions.

Stages:
  A — Cluster detections into rows (union-find on angle + proximity)
  B — Gap filling and bidirectional row extension (distance-transform-guided)
  C — Uncovered mask region recovery (PCA orientation + propagation)
  D — Deduplication via polygon intersection and mask validation
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional

import cv2
import numpy as np

from absolutemap_gen.detection import SpotDetection, SpotDetectionResult

__all__ = ["GeometricEngine", "PostProcessedSpot"]


@dataclass
class PostProcessedSpot:
    """Internal representation used during geometric post-processing.

    Carries a ``row_id`` for cluster bookkeeping and ``source`` to track provenance.
    Converted to/from :class:`SpotDetection` at the engine boundary.
    """

    center_x: float
    center_y: float
    width: float
    height: float
    angle_rad: float
    confidence: float
    class_id: int
    source: str
    row_id: Optional[int] = None


class GeometricEngine:
    """Enrich YOLO-OBB detections with geometrically inferred parking spots.

    Uses distance-transform-guided propagation to fill gaps in detected rows,
    extend rows to mask boundaries, and seed new rows in uncovered mask regions.

    Args:
        dt_threshold_fraction: Propagation stops when the distance-transform value
            falls below ``dt_threshold_fraction * row_depth_px``.  Controls how
            close to the mask edge new spots are allowed.
    """

    def __init__(self, dt_threshold_fraction: float = 0.25) -> None:
        self.dt_threshold_fraction = dt_threshold_fraction

    # ------------------------------------------------------------------
    # Geometry helpers
    # ------------------------------------------------------------------

    @staticmethod
    def get_corners(
        cx: float, cy: float, w: float, h: float, angle_rad: float,
    ) -> np.ndarray:
        """Four integer corners of an oriented rectangle (depth along *angle_rad*)."""
        h_vec = np.array([math.cos(angle_rad), math.sin(angle_rad)]) * (h / 2.0)
        w_vec = np.array([-math.sin(angle_rad), math.cos(angle_rad)]) * (w / 2.0)
        c = np.array([cx, cy])
        return np.int32([c + h_vec + w_vec, c - h_vec + w_vec,
                         c - h_vec - w_vec, c + h_vec - w_vec])

    @staticmethod
    def _angle_diff(a1: float, a2: float) -> float:
        """Unsigned angular distance in [0, pi/2], accounting for pi-periodicity."""
        d = (a1 - a2) % np.pi
        if d > np.pi / 2:
            d = np.pi - d
        return abs(d)

    # ------------------------------------------------------------------
    # Type bridging
    # ------------------------------------------------------------------

    @staticmethod
    def _from_detections(spot_result: SpotDetectionResult) -> list[PostProcessedSpot]:
        """Convert pipeline detections to the internal representation.
        
        Re-extracts geometry from corner points to ensure:
        - width is always the shorter dimension (slot width)
        - height is always the longer dimension (slot depth)
        - angle is normalized to [-π/2, π/2] canonical range
        """
        spots = []
        for s in spot_result.spots:
            corners = np.array(s.corners)
            
            v1 = corners[1] - corners[0]
            v2 = corners[2] - corners[1]
            len1 = np.linalg.norm(v1)
            len2 = np.linalg.norm(v2)
            
            if len1 < len2:
                w, h = len1, len2
                dir_vec = v2 / len2 if len2 != 0 else np.array([1.0, 0.0])
            else:
                w, h = len2, len1
                dir_vec = v1 / len1 if len1 != 0 else np.array([1.0, 0.0])
            
            ang = math.atan2(dir_vec[1], dir_vec[0])
            ang = (ang + np.pi / 2) % np.pi - np.pi / 2
            
            spots.append(PostProcessedSpot(
                center_x=s.center_x, center_y=s.center_y,
                width=float(w), height=float(h), angle_rad=float(ang),
                confidence=s.confidence, class_id=s.class_id, source="yolo",
            ))
        
        return spots

    # ------------------------------------------------------------------
    # Stage A — Row clustering
    # ------------------------------------------------------------------

    def cluster_into_rows(
        self, spots: list[PostProcessedSpot],
    ) -> list[list[PostProcessedSpot]]:
        """Group spots sharing similar orientation and spatial alignment (union-find)."""
        if not spots:
            return []

        n = len(spots)
        parent = list(range(n))

        def find(i: int) -> int:
            while parent[i] != i:
                parent[i] = parent[parent[i]]
                i = parent[i]
            return i

        def union(i: int, j: int) -> None:
            ri, rj = find(i), find(j)
            if ri != rj:
                parent[ri] = rj

        for i in range(n):
            for j in range(i + 1, n):
                s1, s2 = spots[i], spots[j]
                if self._angle_diff(s1.angle_rad, s2.angle_rad) > math.radians(25):
                    continue

                row_axis = np.array([math.cos(s1.angle_rad), math.sin(s1.angle_rad)])
                row_normal = np.array([-math.sin(s1.angle_rad), math.cos(s1.angle_rad)])
                vec = np.array([s2.center_x - s1.center_x, s2.center_y - s1.center_y])

                avg_w = (s1.width + s2.width) / 2.0
                avg_h = (s1.height + s2.height) / 2.0

                if abs(np.dot(vec, row_normal)) < 0.8 * avg_h and abs(np.dot(vec, row_axis)) < 4.0 * avg_w:
                    union(i, j)

        clusters: dict[int, list[PostProcessedSpot]] = {}
        for i in range(n):
            root = find(i)
            clusters.setdefault(root, [])
            spots[i].row_id = root
            clusters[root].append(spots[i])

        return list(clusters.values())

    # ------------------------------------------------------------------
    # Stage B — Gap filling + row extension
    # ------------------------------------------------------------------

    def process_row(
        self,
        row: list[PostProcessedSpot],
        dt_mask: np.ndarray,
        mask: np.ndarray,
    ) -> list[PostProcessedSpot]:
        """Fill internal gaps and extend the row bidirectionally while the mask allows."""
        if len(row) < 2:
            return []

        row_wp = float(np.median([s.width for s in row]))
        row_hp = float(np.median([s.height for s in row]))
        row_theta = float(np.median([s.angle_rad for s in row]))
        row_axis = np.array([math.cos(row_theta), math.sin(row_theta)])

        projections = [
            (float(np.dot(np.array([s.center_x, s.center_y]), row_axis)), s)
            for s in row
        ]
        projections.sort(key=lambda x: x[0])
        sorted_spots = [p[1] for p in projections]

        new_spots: list[PostProcessedSpot] = []
        h_max, w_max = dt_mask.shape[:2]

        # --- Internal gap filling ---
        for i in range(len(sorted_spots) - 1):
            s1, s2 = sorted_spots[i], sorted_spots[i + 1]
            vec = np.array([s2.center_x - s1.center_x, s2.center_y - s1.center_y])
            dist = np.linalg.norm(vec)
            if dist == 0:
                continue

            street_dir = vec / dist
            derived_angle = math.atan2(street_dir[1], street_dir[0]) + (math.pi / 2.0)
            dist_proj = float(np.dot(vec, row_axis))

            if dist_proj > 1.5 * row_wp:
                n_fill = max(1, round(dist_proj / row_wp) - 1)
                for k in range(1, n_fill + 1):
                    t = k / (n_fill + 1)
                    cx = s1.center_x + t * vec[0]
                    cy = s1.center_y + t * vec[1]
                    iy, ix = int(cy), int(cx)
                    if 0 <= iy < h_max and 0 <= ix < w_max and dt_mask[iy, ix] > 0:
                        new_spots.append(PostProcessedSpot(
                            center_x=cx, center_y=cy, width=row_wp, height=row_hp,
                            angle_rad=derived_angle, confidence=0.75, class_id=0,
                            source="gap_fill", row_id=s1.row_id,
                        ))

        # --- Bidirectional extrapolation ---
        def _extrapolate(start: PostProcessedSpot, ref: PostProcessedSpot, sign: float) -> None:
            curr = np.array([start.center_x, start.center_y])
            vec = np.array([start.center_x - ref.center_x, start.center_y - ref.center_y])
            norm = np.linalg.norm(vec)
            street_dir = vec / norm if norm > 0 else row_axis
            derived_angle = math.atan2(street_dir[1], street_dir[0]) + (math.pi / 2.0)
            step = sign * row_wp * street_dir

            for _ in range(25):
                curr = curr + step
                cx, cy = float(curr[0]), float(curr[1])
                iy, ix = int(cy), int(cx)
                if not (0 <= iy < h_max and 0 <= ix < w_max):
                    break
                if dt_mask[iy, ix] < self.dt_threshold_fraction * row_hp:
                    break
                new_spots.append(PostProcessedSpot(
                    center_x=cx, center_y=cy, width=row_wp, height=row_hp,
                    angle_rad=derived_angle, confidence=0.75, class_id=0,
                    source="row_extension", row_id=start.row_id,
                ))

        _extrapolate(sorted_spots[-1], sorted_spots[-2], 1.0)
        _extrapolate(sorted_spots[0], sorted_spots[1], -1.0)

        return new_spots

    # ------------------------------------------------------------------
    # Stage C — Uncovered mask region recovery
    # ------------------------------------------------------------------

    @staticmethod
    def _get_pca_angle(mask_region: np.ndarray) -> float:
        """Dominant orientation of a binary mask region via PCA."""
        ys, xs = np.where(mask_region > 0)
        if len(xs) < 10:
            return 0.0
        pts = np.vstack((xs, ys)).T.astype(np.float64)
        _, eigenvectors, _ = cv2.PCACompute2(pts, mean=None)
        v = eigenvectors[0]
        street_dir = v / np.linalg.norm(v)
        angle = math.atan2(street_dir[1], street_dir[0]) + (math.pi / 2.0)
        return float((angle + np.pi / 2) % np.pi - np.pi / 2)

    def recover_uncovered_regions(
        self,
        current_spots: list[PostProcessedSpot],
        mask: np.ndarray,
        dt_mask: np.ndarray,
        yolo_spots: list[PostProcessedSpot],
    ) -> list[PostProcessedSpot]:
        """Find mask regions with no detection coverage and fill them via PCA + propagation."""
        if not yolo_spots:
            return []

        global_wp = float(np.median([s.width for s in yolo_spots]))
        global_hp = float(np.median([s.height for s in yolo_spots]))

        cov_map = np.zeros_like(mask)
        for spot in current_spots:
            large_box = self.get_corners(
                spot.center_x, spot.center_y,
                spot.width * 1.5, spot.height * 1.2,
                spot.angle_rad,
            )
            cv2.drawContours(cov_map, [large_box], 0, 255, -1)

        uncovered = cv2.bitwise_and(mask, cv2.bitwise_not(cov_map))
        num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(uncovered, connectivity=8)

        new_spots: list[PostProcessedSpot] = []
        h_max, w_max = mask.shape[:2]

        for label_idx in range(1, num_labels):
            area = stats[label_idx, cv2.CC_STAT_AREA]
            if area < 1.5 * global_wp * global_hp:
                continue

            island = np.zeros_like(mask)
            island[labels == label_idx] = 255

            island_dt = cv2.bitwise_and(dt_mask, dt_mask, mask=island)
            _, max_val, _, max_loc = cv2.minMaxLoc(island_dt)
            if max_val < 0.25 * global_hp:
                continue

            seed_x, seed_y = max_loc
            pca_angle = self._get_pca_angle(island)
            street_dir = np.array([
                math.cos(pca_angle - math.pi / 2),
                math.sin(pca_angle - math.pi / 2),
            ])

            def _fill_island(direction_sign: float) -> None:
                curr = np.array([seed_x, seed_y], dtype=float)
                step = direction_sign * global_wp * street_dir

                if direction_sign == 1.0:
                    new_spots.append(PostProcessedSpot(
                        center_x=float(seed_x), center_y=float(seed_y),
                        width=global_wp, height=global_hp,
                        angle_rad=pca_angle, confidence=0.65, class_id=0,
                        source="mask_recovery",
                    ))

                for _ in range(50):
                    curr = curr + step
                    cx, cy = float(curr[0]), float(curr[1])
                    iy, ix = int(cy), int(cx)
                    if not (0 <= iy < h_max and 0 <= ix < w_max):
                        break
                    if mask[iy, ix] == 0:
                        break
                    if dt_mask[iy, ix] < self.dt_threshold_fraction * global_hp:
                        break
                    new_spots.append(PostProcessedSpot(
                        center_x=cx, center_y=cy, width=global_wp, height=global_hp,
                        angle_rad=pca_angle, confidence=0.65, class_id=0,
                        source="mask_recovery",
                    ))

            _fill_island(1.0)
            _fill_island(-1.0)

        return new_spots

    # ------------------------------------------------------------------
    # Stage D — Deduplication and mask validation
    # ------------------------------------------------------------------

    def dedup_and_validate(
        self,
        all_spots: list[PostProcessedSpot],
        mask: np.ndarray,
    ) -> list[PostProcessedSpot]:
        """Remove overlapping spots (polygon IoU) and reject those outside the mask.

        YOLO originals are always prioritised regardless of confidence.
        """
        all_spots.sort(
            key=lambda s: (1 if s.source == "yolo" else 0, s.confidence),
            reverse=True,
        )

        kept: list[PostProcessedSpot] = []
        h_max, w_max = mask.shape[:2]

        for spot in all_spots:
            iy, ix = int(spot.center_y), int(spot.center_x)
            if not (0 <= iy < h_max and 0 <= ix < w_max):
                continue
            if mask[iy, ix] == 0:
                continue

            spot_box = np.float32(self.get_corners(
                spot.center_x, spot.center_y, spot.width, spot.height, spot.angle_rad,
            ))
            spot_area = spot.width * spot.height
            overlap = False

            for k_spot in kept:
                dist = math.hypot(
                    spot.center_x - k_spot.center_x, spot.center_y - k_spot.center_y,
                )
                if dist < 1.5 * max(spot.width, spot.height):
                    k_box = np.float32(self.get_corners(
                        k_spot.center_x, k_spot.center_y,
                        k_spot.width, k_spot.height, k_spot.angle_rad,
                    ))
                    intersect_area, _ = cv2.intersectConvexConvex(spot_box, k_box)
                    if intersect_area > 0.15 * min(spot_area, k_spot.width * k_spot.height):
                        overlap = True
                        break

            if not overlap:
                kept.append(spot)

        return kept

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def enrich(
        self,
        spot_result: SpotDetectionResult,
        mask_uint8: np.ndarray,
    ) -> SpotDetectionResult:
        """Run stages A → D and return an enriched detection result.

        Args:
            spot_result: YOLO-OBB detection output from stage 03.
            mask_uint8: Binary parkable mask (H, W) from segmentation, uint8 0/255.

        Returns:
            A new :class:`SpotDetectionResult` containing both the original YOLO
            spots and all geometrically inferred spots.
        """
        _, binary_mask = cv2.threshold(mask_uint8, 127, 255, cv2.THRESH_BINARY)
        dt_mask = cv2.distanceTransform(binary_mask, cv2.DIST_L2, 5)

        yolo_spots = self._from_detections(spot_result)

        rows = self.cluster_into_rows(yolo_spots)

        extended_spots: list[PostProcessedSpot] = []
        for row in rows:
            extended_spots.extend(self.process_row(row, dt_mask, binary_mask))

        all_stage_ab = yolo_spots + extended_spots
        recovered_spots = self.recover_uncovered_regions(
            all_stage_ab, binary_mask, dt_mask, yolo_spots,
        )

        all_spots = all_stage_ab + recovered_spots
        final_spots = self.dedup_and_validate(all_spots, binary_mask)

        # Convert from Daniel's depth-direction angle to the rotation angle
        # expected by SpotDetection.corners and _oriented_rect (GeoJSON export).
        # Daniel: angle points along the LONG side (depth).
        # SpotDetection: angle is a standard rotation where the first axis
        #   (width) goes along (cos θ, sin θ).
        # The width axis is perpendicular to the depth axis → offset by π/2.
        enriched = [
            SpotDetection(
                center_x=s.center_x, center_y=s.center_y,
                width=s.width, height=s.height,
                angle_rad=s.angle_rad + math.pi / 2.0,
                confidence=s.confidence, class_id=s.class_id,
                occupied=(s.class_id == 1),
                source=s.source,
            )
            for s in final_spots
        ]

        return SpotDetectionResult(
            spots=enriched,
            image_height=spot_result.image_height,
            image_width=spot_result.image_width,
            class_names=spot_result.class_names,
        )
