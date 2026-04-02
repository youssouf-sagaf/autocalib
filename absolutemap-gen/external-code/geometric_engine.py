import os
import glob
import math
import cv2
import numpy as np
from dataclasses import dataclass
from typing import List, Optional
from ultralytics import YOLO

@dataclass
class PostProcessedSpot:
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
    def __init__(self, dt_threshold_fraction=0.25):
        self.dt_threshold_fraction = dt_threshold_fraction

    def get_corners(self, cx, cy, w, h, angle_rad):
        # angle_rad is the angle of the length (depth) vector of the parking spot.
        h_vec = np.array([math.cos(angle_rad), math.sin(angle_rad)]) * (h / 2.0)
        w_vec = np.array([-math.sin(angle_rad), math.cos(angle_rad)]) * (w / 2.0)
        
        c = np.array([cx, cy])
        p1 = c + h_vec + w_vec
        p2 = c - h_vec + w_vec
        p3 = c - h_vec - w_vec
        p4 = c + h_vec - w_vec
        
        return np.int32([p1, p2, p3, p4])

    def parse_yolo_detections(self, results) -> List[PostProcessedSpot]:
        spots = []
        if not results or not results[0].obb: return spots
        
        # Use exact 4 corners to extract pure geometry
        corners_list = results[0].obb.xyxyxyxy.cpu().numpy()
        confs = results[0].obb.conf.cpu().numpy()
        cls = results[0].obb.cls.cpu().numpy()
        
        for i in range(len(corners_list)):
            corners = corners_list[i]
            cx, cy = np.mean(corners[:, 0]), np.mean(corners[:, 1])
            
            v1 = corners[1] - corners[0]
            v2 = corners[2] - corners[1]
            len1 = np.linalg.norm(v1)
            len2 = np.linalg.norm(v2)
            
            if len1 < len2:
                w, h = len1, len2
                dir_vec = v2 / h if h != 0 else np.array([1.0, 0.0])
            else:
                w, h = len2, len1
                dir_vec = v1 / h if h != 0 else np.array([1.0, 0.0])
                
            ang = math.atan2(dir_vec[1], dir_vec[0])
            ang = (ang + np.pi/2) % np.pi - np.pi/2
            
            spots.append(PostProcessedSpot(
                center_x=float(cx), center_y=float(cy),
                width=float(w), height=float(h), angle_rad=float(ang),
                confidence=float(confs[i]), class_id=int(cls[i]),
                source="yolo"
            ))
        return spots

    def angle_diff(self, a1, a2):
        d = (a1 - a2) % np.pi
        if d > np.pi/2: d = np.pi - d
        return abs(d)

    def cluster_into_rows(self, spots: List[PostProcessedSpot]) -> List[List[PostProcessedSpot]]:
        if not spots: return []
        n = len(spots)
        parent = list(range(n))
        
        def find(i):
            if parent[i] == i: return i
            parent[i] = find(parent[i])
            return parent[i]
            
        def union(i, j):
            root_i = find(i)
            root_j = find(j)
            if root_i != root_j: parent[root_i] = root_j

        for i in range(n):
            for j in range(i + 1, n):
                s1, s2 = spots[i], spots[j]
                
                if self.angle_diff(s1.angle_rad, s2.angle_rad) > math.radians(25):
                    continue
                
                avg_angle = s1.angle_rad # Roughly
                row_axis = np.array([math.cos(avg_angle), math.sin(avg_angle)])
                row_normal = np.array([-math.sin(avg_angle), math.cos(avg_angle)])
                
                vec = np.array([s2.center_x - s1.center_x, s2.center_y - s1.center_y])
                proj_axis = abs(np.dot(vec, row_axis))
                proj_norm = abs(np.dot(vec, row_normal))
                
                avg_w = (s1.width + s2.width) / 2.0
                avg_h = (s1.height + s2.height) / 2.0
                
                if proj_norm < 0.8 * avg_h and proj_axis < 4.0 * avg_w:
                    union(i, j)

        clusters = {}
        for i in range(n):
            root = find(i)
            if root not in clusters: clusters[root] = []
            spots[i].row_id = root
            clusters[root].append(spots[i])
            
        return list(clusters.values())

    def process_row(self, row: List[PostProcessedSpot], dt_mask: np.ndarray, mask: np.ndarray) -> List[PostProcessedSpot]:
        row_wp = np.median([s.width for s in row])
        row_hp = np.median([s.height for s in row])
        row_theta = np.median([s.angle_rad for s in row])
        row_axis = np.array([math.cos(row_theta), math.sin(row_theta)])
        
        proj = []
        for s in row:
            v_center = np.array([s.center_x, s.center_y])
            p = np.dot(v_center, row_axis)
            proj.append((p, s))
            
        proj.sort(key=lambda x: x[0])
        sorted_spots = [item[1] for item in proj]
        
        new_spots = []
        if len(sorted_spots) < 2: return []
        
        # Internal Gap Filling
        for i in range(len(sorted_spots) - 1):
            s1 = sorted_spots[i]
            s2 = sorted_spots[i+1]
            vec = np.array([s2.center_x - s1.center_x, s2.center_y - s1.center_y])
            dist_centers = np.linalg.norm(vec)
            if dist_centers == 0: continue
            
            street_dir = vec / dist_centers
            derived_angle = math.atan2(street_dir[1], street_dir[0]) + (math.pi / 2.0)
            dist_proj = np.dot(vec, row_axis)
            
            if dist_proj > 1.5 * row_wp:
                n_fill = max(1, round(dist_proj / row_wp) - 1)
                for k in range(1, n_fill + 1):
                    t = k / (n_fill + 1)
                    cx = s1.center_x + t * vec[0]
                    cy = s1.center_y + t * vec[1]
                    
                    iy, ix = int(cy), int(cx)
                    if 0 <= iy < dt_mask.shape[0] and 0 <= ix < dt_mask.shape[1]:
                        if dt_mask[iy, ix] > 0:
                            new_spots.append(PostProcessedSpot(
                                center_x=cx, center_y=cy, width=row_wp, height=row_hp,
                                angle_rad=derived_angle, confidence=0.75, class_id=0,
                                source="gap_fill", row_id=s1.row_id
                            ))

        # Bidirectional Extrapolation
        def extrapolate(start_spot, ref_spot, direction_sign):
            curr_pos = np.array([start_spot.center_x, start_spot.center_y])
            vec = np.array([start_spot.center_x - ref_spot.center_x, start_spot.center_y - ref_spot.center_y])
            
            if np.linalg.norm(vec) == 0: street_dir = row_axis
            else: street_dir = vec / np.linalg.norm(vec)
                
            derived_angle = math.atan2(street_dir[1], street_dir[0]) + (math.pi / 2.0)
            step_vec = direction_sign * row_wp * street_dir
            
            for _ in range(25):
                curr_pos += step_vec
                cx, cy = curr_pos[0], curr_pos[1]
                iy, ix = int(cy), int(cx)
                
                if not (0 <= iy < dt_mask.shape[0] and 0 <= ix < dt_mask.shape[1]): break
                if dt_mask[iy, ix] < self.dt_threshold_fraction * row_hp: break
                    
                new_spots.append(PostProcessedSpot(
                    center_x=cx, center_y=cy, width=row_wp, height=row_hp,
                    angle_rad=derived_angle, confidence=0.75, class_id=0,
                    source="row_extension", row_id=start_spot.row_id
                ))
                
        extrapolate(sorted_spots[-1], sorted_spots[-2], 1.0)
        extrapolate(sorted_spots[0], sorted_spots[1], -1.0)
        
        return new_spots

    def get_pca_angle(self, mask_region: np.ndarray):
        ys, xs = np.where(mask_region > 0)
        if len(xs) < 10: return 0.0
        pts = np.vstack((xs, ys)).T.astype(np.float64)
        mean, eigenvectors, eigenvalues = cv2.PCACompute2(pts, mean=None)
        
        v = eigenvectors[0] # Dominant
        street_dir = v / np.linalg.norm(v)
        
        derived_angle = math.atan2(street_dir[1], street_dir[0]) + (math.pi / 2.0)
        derived_angle = (derived_angle + np.pi/2) % np.pi - np.pi/2
        return derived_angle
        
    def recover_uncovered_regions(self, current_spots: List[PostProcessedSpot], mask: np.ndarray, 
                                  dt_mask: np.ndarray, yolo_spots: List[PostProcessedSpot]) -> List[PostProcessedSpot]:
        if not yolo_spots: return []
        
        global_wp = np.median([s.width for s in yolo_spots])
        global_hp = np.median([s.height for s in yolo_spots])
        
        cov_map = np.zeros_like(mask)
        for spot in current_spots:
            expanded_w = spot.width * 1.5
            expanded_h = spot.height * 1.2
            large_box = self.get_corners(spot.center_x, spot.center_y, expanded_w, expanded_h, spot.angle_rad)
            cv2.drawContours(cov_map, [large_box], 0, 255, -1)
            
        uncovered = cv2.bitwise_and(mask, cv2.bitwise_not(cov_map))
        num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(uncovered, connectivity=8)
        
        new_spots = []
        for i in range(1, num_labels):
            area = stats[i, cv2.CC_STAT_AREA]
            if area < 1.5 * global_wp * global_hp: continue
                
            island = np.zeros_like(mask)
            island[labels == i] = 255
            
            island_dt = cv2.bitwise_and(dt_mask, dt_mask, mask=island)
            min_val, max_val, min_loc, max_loc = cv2.minMaxLoc(island_dt)
            
            if max_val < 0.25 * global_hp: continue
                
            seed_x, seed_y = max_loc
            pca_angle = self.get_pca_angle(island)
            street_dir = np.array([math.cos(pca_angle - math.pi/2), math.sin(pca_angle - math.pi/2)])
            
            def fill_island(direction_sign):
                curr_pos = np.array([seed_x, seed_y], dtype=float)
                step_vec = direction_sign * global_wp * street_dir
                
                if direction_sign == 1.0:
                    new_spots.append(PostProcessedSpot(
                        center_x=seed_x, center_y=seed_y, width=global_wp, height=global_hp,
                        angle_rad=pca_angle, confidence=0.65, class_id=0, source="mask_recovery"
                    ))
                    
                for _ in range(50):
                    curr_pos += step_vec
                    cx, cy = curr_pos[0], curr_pos[1]
                    iy, ix = int(cy), int(cx)
                    
                    if not (0 <= iy < mask.shape[0] and 0 <= ix < mask.shape[1]): break
                    if mask[iy, ix] == 0: break
                    if dt_mask[iy, ix] < self.dt_threshold_fraction * global_hp: break
                    
                    new_spots.append(PostProcessedSpot(
                        center_x=cx, center_y=cy, width=global_wp, height=global_hp,
                        angle_rad=pca_angle, confidence=0.65, class_id=0, source="mask_recovery"
                    ))
                    
            fill_island(1.0)
            fill_island(-1.0)
            
        return new_spots

    def dedup_and_validate(self, all_spots: List[PostProcessedSpot], mask: np.ndarray) -> List[PostProcessedSpot]:
        # Force YOLO spots to ALWAYS be processed first, regardless of their confidence score!
        all_spots.sort(key=lambda s: (1 if s.source == "yolo" else 0, s.confidence), reverse=True)
        
        kept = []
        for spot in all_spots:
            iy, ix = int(spot.center_y), int(spot.center_x)
            if not (0 <= iy < mask.shape[0] and 0 <= ix < mask.shape[1]): continue
            if mask[iy, ix] == 0: continue
                
            is_overlap = False
            spot_box = np.float32(self.get_corners(spot.center_x, spot.center_y, spot.width, spot.height, spot.angle_rad))
            spot_area = spot.width * spot.height
            
            for k_spot in kept:
                # Fast distance pre-check
                dist = math.hypot(spot.center_x - k_spot.center_x, spot.center_y - k_spot.center_y)
                if dist < 1.5 * max(spot.width, spot.height):
                    # Rigorous Polygon Intersection calculation
                    k_box = np.float32(self.get_corners(k_spot.center_x, k_spot.center_y, k_spot.width, k_spot.height, k_spot.angle_rad))
                    intersect_area, _ = cv2.intersectConvexConvex(spot_box, k_box)
                    k_spot_area = k_spot.width * k_spot.height
                    
                    # If more than 15% of the spot is overlapping another spot, instantly delete it
                    if intersect_area > 0.15 * min(spot_area, k_spot_area): 
                        is_overlap = True
                        break
                    
            if not is_overlap: kept.append(spot)
                
        return kept

    def run(self, image_path, mask_path, model, output_dir):
        img = cv2.imread(image_path)
        if img is None: return
        mask = cv2.imread(mask_path, cv2.IMREAD_GRAYSCALE)
        if mask is None: return
        
        _, binary_mask = cv2.threshold(mask, 127, 255, cv2.THRESH_BINARY)
        dt_mask = cv2.distanceTransform(binary_mask, cv2.DIST_L2, 5)

        results = model(img, verbose=False)
        yolo_spots = self.parse_yolo_detections(results)
        
        rows = self.cluster_into_rows(yolo_spots)
        extended_spots = []
        for row in rows:
            new_spots = self.process_row(row, dt_mask, binary_mask)
            extended_spots.extend(new_spots)
            
        all_stage_a_b = yolo_spots + extended_spots
        recovered_spots = self.recover_uncovered_regions(all_stage_a_b, binary_mask, dt_mask, yolo_spots)
        
        all_spots = all_stage_a_b + recovered_spots
        final_spots = self.dedup_and_validate(all_spots, binary_mask)
        
        vis_img = img.copy()
        color_mask = np.zeros_like(vis_img)
        color_mask[binary_mask == 255] = (40, 40, 40)
        vis_img = cv2.addWeighted(vis_img, 1.0, color_mask, 0.5, 0)

        for spot in final_spots:
            box = self.get_corners(spot.center_x, spot.center_y, spot.width, spot.height, spot.angle_rad)
            
            if spot.source == "yolo":
                color = (0, 255, 0) if spot.class_id == 1 else (255, 255, 0)
            elif spot.source == "mask_recovery":
                color = (0, 165, 255) # Orange for Stage C mask recovery
            else:
                color = (255, 0, 255) # Magenta for Stage B extensions
                
            thick = 2
            cv2.drawContours(vis_img, [box], 0, color, thick)
            cv2.circle(vis_img, (int(spot.center_x), int(spot.center_y)), 3, color, -1)
            
        base_name = os.path.basename(image_path)
        out_path = os.path.join(output_dir, f"ge_{base_name}")
        cv2.imwrite(out_path, vis_img)
        print(f"Processed: {base_name} | YOLO: {len(yolo_spots)} | Extensions: {len(extended_spots)} | StageC: {len(recovered_spots)}")

if __name__ == "__main__":
    DATASET_DIR = r"f:\dataset"
    IMG_DIR = os.path.join(DATASET_DIR, "images")
    MASK_DIR = os.path.join(DATASET_DIR, "masks")
    OUT_DIR = os.path.join(DATASET_DIR, "outputs")
    MODEL_PATH = os.path.join(DATASET_DIR, "best.pt")
    
    os.makedirs(OUT_DIR, exist_ok=True)
    
    print("Loading YOLOv8-OBB model...")
    model = YOLO(MODEL_PATH)
    engine = GeometricEngine()
    
    image_files = glob.glob(os.path.join(IMG_DIR, "*.png"))
    for img_path in image_files:
        mask_name = os.path.basename(img_path).replace(".png", "_mask.png")
        mask_path = os.path.join(MASK_DIR, mask_name)
        if os.path.exists(mask_path):
            engine.run(img_path, mask_path, model, OUT_DIR)
    
    print(f"All done! Results saved to {OUT_DIR}")
