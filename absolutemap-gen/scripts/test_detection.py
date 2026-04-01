#!/usr/bin/env python3
"""Script standalone pour tester la détection de véhicules sur une image satellite.

Usage:
    python scripts/test_detection.py --geotiff path/to/image.tif --out results/

    # Avec masque de segmentation (recommandé)
    python scripts/test_detection.py \
      --geotiff path/to/image.tif \
      --mask path/to/mask_refined.png \
      --out results/

Ce script :
    - Charge une image GeoTIFF (ou un crop via --bbox/--window)
    - Optionnellement utilise un masque de segmentation pour filtrer les détections
    - Applique le modèle de détection YOLO
    - Sauvegarde les détections en JSON
    - Génère une overlay avec les boîtes de détection
    - Affiche des statistiques
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

_REPO_ROOT = Path(__file__).resolve().parents[1]
_SRC = _REPO_ROOT / "src"
if _SRC.is_dir():
    sys.path.insert(0, str(_SRC))

from absolutemap_gen.config import detection_settings_from_env, load_dotenv_if_present
from absolutemap_gen.detection import (
    YoloVehicleDetector,
    annotate_detections_overlay,
    detections_to_serializable_dict,
    tag_detections_with_mask,
)
from absolutemap_gen.io_geotiff import crop_geotiff_by_bounds, crop_geotiff_by_pixels, read_geotiff_rgb


def parse_bbox(s: str) -> tuple[float, float, float, float]:
    """Parse une bbox de format 'west,south,east,north'."""
    parts = [p.strip() for p in s.split(",")]
    if len(parts) != 4:
        raise argparse.ArgumentTypeError("bbox doit être west,south,east,north (4 valeurs séparées par des virgules)")
    try:
        return tuple(float(p) for p in parts)  # type: ignore[return-value]
    except ValueError as exc:
        raise argparse.ArgumentTypeError("Les valeurs de bbox doivent être des nombres") from exc


def parse_window(s: str) -> tuple[int, int, int, int]:
    """Parse une window de format 'col_off,row_off,width,height'."""
    parts = [p.strip() for p in s.split(",")]
    if len(parts) != 4:
        raise argparse.ArgumentTypeError(
            "window doit être col_off,row_off,width,height (4 entiers séparés par des virgules)"
        )
    try:
        return tuple(int(p) for p in parts)  # type: ignore[return-value]
    except ValueError as exc:
        raise argparse.ArgumentTypeError("Les valeurs de window doivent être des entiers") from exc


def load_mask(mask_path: Path, target_shape: tuple[int, int]) -> np.ndarray:
    """Charge un masque PNG et le redimensionne si nécessaire.
    
    Args:
        mask_path: Chemin vers le masque PNG
        target_shape: (height, width) cible
    
    Returns:
        Masque uint8 binaire (0 ou 255) de la forme (H, W)
    """
    mask_img = Image.open(mask_path).convert("L")
    mask_array = np.array(mask_img)
    
    # Redimensionne si nécessaire
    if mask_array.shape != target_shape:
        print(f"   ⚠ Redimensionnement du masque de {mask_array.shape} vers {target_shape}")
        mask_img_resized = mask_img.resize((target_shape[1], target_shape[0]), Image.NEAREST)
        mask_array = np.array(mask_img_resized)
    
    # Binarise (au cas où le masque n'est pas exactement 0/255)
    mask_array = (mask_array > 127).astype(np.uint8) * 255
    
    return mask_array


def main() -> int:
    load_dotenv_if_present()
    
    parser = argparse.ArgumentParser(
        description="Test standalone de la détection de véhicules sur une image satellite"
    )
    parser.add_argument(
        "--geotiff",
        type=Path,
        required=True,
        help="Chemin vers le fichier GeoTIFF d'entrée",
    )
    parser.add_argument(
        "--out",
        type=Path,
        required=True,
        help="Dossier de sortie pour les résultats",
    )
    parser.add_argument(
        "--mask",
        type=Path,
        default=None,
        help="Masque de segmentation (PNG) pour filtrer les détections (optionnel)",
    )
    parser.add_argument(
        "--bbox",
        type=parse_bbox,
        default=None,
        metavar="W,S,E,N",
        help="Recadrer par coordonnées géographiques : west,south,east,north",
    )
    parser.add_argument(
        "--window",
        type=parse_window,
        default=None,
        metavar="COL,ROW,W,H",
        help="Recadrer par pixels : col_off,row_off,width,height",
    )
    parser.add_argument(
        "--conf",
        type=float,
        default=None,
        help="Seuil de confiance pour YOLO (défaut: depuis .env)",
    )
    parser.add_argument(
        "--iou",
        type=float,
        default=None,
        help="Seuil IoU pour NMS (défaut: depuis .env)",
    )
    
    args = parser.parse_args()
    
    geotiff = args.geotiff.resolve()
    if not geotiff.is_file():
        print(f"Erreur : Fichier GeoTIFF introuvable : {geotiff}", file=sys.stderr)
        return 2
    
    if args.mask is not None:
        mask_path = args.mask.resolve()
        if not mask_path.is_file():
            print(f"Erreur : Fichier masque introuvable : {mask_path}", file=sys.stderr)
            return 2
    else:
        mask_path = None
    
    out_dir = args.out.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    
    print(f"📂 Chargement de l'image : {geotiff}")
    
    # Charge l'image (entière ou recadrée)
    if args.bbox is not None and args.window is not None:
        print("Erreur : Spécifiez soit --bbox, soit --window, pas les deux", file=sys.stderr)
        return 2
    
    if args.bbox is not None:
        west, south, east, north = args.bbox
        print(f"   Recadrage par bbox : W={west}, S={south}, E={east}, N={north}")
        slice_ = crop_geotiff_by_bounds(geotiff, args.bbox)
    elif args.window is not None:
        col_off, row_off, width, height = args.window
        print(f"   Recadrage par window : col={col_off}, row={row_off}, w={width}, h={height}")
        slice_ = crop_geotiff_by_pixels(geotiff, col_off=col_off, row_off=row_off, width=width, height=height)
    else:
        print("   Chargement du fichier entier")
        rgb, transform, crs, nodata = read_geotiff_rgb(geotiff)
        h, w = int(rgb.shape[0]), int(rgb.shape[1])
        
        from dataclasses import dataclass
        
        @dataclass
        class GeoRasterSlice:
            rgb: np.ndarray
            transform: object
            crs: object
            width: int
            height: int
            nodata: float | None
        
        slice_ = GeoRasterSlice(rgb=rgb, transform=transform, crs=crs, width=w, height=h, nodata=nodata)
    
    rgb = slice_.rgb
    h, w = rgb.shape[0], rgb.shape[1]
    
    print(f"   Dimensions : {h}×{w} pixels")
    
    # Charge le masque (optionnel)
    if mask_path is not None:
        print(f"\n🎭 Chargement du masque : {mask_path}")
        parkable_mask = load_mask(mask_path, (h, w))
        parkable_pixels = np.sum(parkable_mask > 0)
        print(f"   Pixels parkables : {parkable_pixels:,} ({(parkable_pixels/(h*w)*100):.2f}%)")
    else:
        parkable_mask = None
        print(f"\n🎭 Pas de masque fourni : détection sur toute l'image")

    # Initialise le détecteur
    print(f"\n🤖 Chargement du modèle de détection YOLO...")
    try:
        settings = detection_settings_from_env(require_weights=True)
    except ValueError as e:
        print(f"Erreur : {e}", file=sys.stderr)
        print("\nVérifiez que YOLO_WEIGHTS_PATH est configuré dans votre .env", file=sys.stderr)
        return 2

    print(f"   Poids YOLO : {settings.yolo_weights_path}")
    print(f"   Seuil de confiance : {args.conf if args.conf is not None else settings.conf_threshold}")
    print(f"   Seuil IoU NMS : {args.iou if args.iou is not None else settings.iou_nms_threshold}")

    detector = YoloVehicleDetector(settings)

    # Lance la détection (indépendante du masque)
    print(f"\n🚗 Exécution de la détection...")
    detection_result = detector.predict(rgb, conf=args.conf, iou=args.iou)

    total_detections = len(detection_result.boxes)
    print(f"   ✓ Détections totales : {total_detections}")

    # Applique le filtrage par masque si fourni
    if parkable_mask is not None:
        detection_result = tag_detections_with_mask(
            detection_result,
            parkable_mask,
            mode=settings.in_mask_mode,
            min_area_fraction=settings.min_mask_area_fraction,
        )
        in_mask_detections = len(detection_result.boxes_in_mask())
        filtered_out = total_detections - in_mask_detections
        print(f"   ✓ Dans zones parkables : {in_mask_detections}")
        if filtered_out > 0:
            print(f"   ✓ Filtrées (hors zones) : {filtered_out}")
    else:
        in_mask_detections = total_detections
    
    # Sauvegarde les résultats
    print(f"\n💾 Sauvegarde des résultats dans : {out_dir}")
    
    # JSON des détections
    detections_dict = detections_to_serializable_dict(detection_result)
    json_path = out_dir / "detections.json"
    with open(json_path, "w") as f:
        json.dump(detections_dict, f, indent=2)
    print(f"   ✓ {json_path.name}")
    
    # Overlay avec les boîtes
    overlay = annotate_detections_overlay(
        rgb,
        detection_result,
        in_mask_color=(0, 255, 0),      # Vert pour les détections valides
        out_mask_color=(255, 128, 0),   # Orange pour les détections filtrées
        thickness=2,
    )
    overlay_path = out_dir / "overlay_detections.png"
    Image.fromarray(overlay, mode="RGB").save(overlay_path)
    print(f"   ✓ {overlay_path.name}")
    
    # Sauvegarde l'image originale
    rgb_path = out_dir / "rgb_original.png"
    Image.fromarray(rgb, mode="RGB").save(rgb_path)
    print(f"   ✓ {rgb_path.name}")
    
    # Si un masque a été utilisé, sauvegarde-le aussi
    if mask_path is not None:
        mask_out_path = out_dir / "parkable_mask.png"
        Image.fromarray(parkable_mask, mode="L").save(mask_out_path)
        print(f"   ✓ {mask_out_path.name}")
    
    # Statistiques détaillées
    print(f"\n📊 Statistiques détaillées :")
    print(f"   Image : {h}×{w} pixels")
    print(f"   Détections totales : {total_detections}")
    print(f"   Détections valides : {in_mask_detections}")
    
    if in_mask_detections > 0:
        confidences = [b.confidence for b in detection_result.boxes_in_mask()]
        print(f"   Confiance moyenne : {np.mean(confidences):.3f}")
        print(f"   Confiance min/max : {np.min(confidences):.3f} / {np.max(confidences):.3f}")
        
        # Compte par classe
        class_counts: dict[int, int] = {}
        for b in detection_result.boxes_in_mask():
            class_counts[b.class_id] = class_counts.get(b.class_id, 0) + 1
        
        if class_counts:
            print(f"   Classes détectées :")
            for class_id, count in sorted(class_counts.items()):
                print(f"      Classe {class_id} : {count} véhicule(s)")
    
    print(f"\n✅ Test de détection terminé !")
    print(f"\n💡 Légende de l'overlay :")
    print(f"   🟢 Vert   = véhicule dans une zone parkable")
    print(f"   🟠 Orange = véhicule hors zone parkable (filtré)")
    
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
