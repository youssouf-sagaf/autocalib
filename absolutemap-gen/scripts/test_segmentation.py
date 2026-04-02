#!/usr/bin/env python3
"""Script standalone pour tester la segmentation sur une image satellite.

Usage:
    python scripts/test_segmentation.py --geotiff path/to/image.tif --out results/

Ce script :
    - Charge une image GeoTIFF (ou un crop via --bbox/--window)
    - Applique le modèle de segmentation SegFormer
    - Sauvegarde les masques brut et raffiné
    - Génère une overlay pour visualisation
    - Exporte les zones parkables en GeoJSON (si le raster a un CRS)
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image

_REPO_ROOT = Path(__file__).resolve().parents[1]
_SRC = _REPO_ROOT / "src"
if _SRC.is_dir():
    sys.path.insert(0, str(_SRC))

from absolutemap_gen.config import load_dotenv_if_present, segmentation_settings_from_env
from absolutemap_gen.export_geojson import (
    feature_collection,
    shapely_to_geojson_feature,
    transform_geometry_pixels_to_wgs84,
)
from absolutemap_gen.io_geotiff import crop_geotiff_by_bounds, crop_geotiff_by_pixels, read_geotiff_rgb
from absolutemap_gen.segmentation import SegFormerParkableSegmenter, refined_mask_to_multipolygon


def create_overlay(rgb_hwc: np.ndarray, mask_refined: np.ndarray, alpha: float = 0.5) -> np.ndarray:
    """Crée une overlay en superposant le masque coloré sur l'image RGB.
    
    Args:
        rgb_hwc: Image RGB originale (H, W, 3)
        mask_refined: Masque binaire raffiné (H, W), valeurs 0 ou 255
        alpha: Transparence du masque (0.0 = transparent, 1.0 = opaque)
    
    Returns:
        Image RGB avec overlay (H, W, 3)
    """
    overlay = rgb_hwc.copy()
    
    # Applique une couleur verte sur les zones parkables
    green_mask = np.zeros_like(rgb_hwc)
    green_mask[:, :, 1] = 255  # Canal vert
    
    # Applique le masque avec transparence
    parkable_pixels = mask_refined > 0
    overlay[parkable_pixels] = (
        rgb_hwc[parkable_pixels] * (1 - alpha) + green_mask[parkable_pixels] * alpha
    ).astype(np.uint8)
    
    return overlay


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


def main() -> int:
    load_dotenv_if_present()
    
    parser = argparse.ArgumentParser(
        description="Test standalone de la segmentation sur une image satellite"
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
        "--overlay-alpha",
        type=float,
        default=0.5,
        help="Transparence de l'overlay (0.0-1.0, défaut: 0.5)",
    )
    
    args = parser.parse_args()
    
    geotiff = args.geotiff.resolve()
    if not geotiff.is_file():
        print(f"Erreur : Fichier GeoTIFF introuvable : {geotiff}", file=sys.stderr)
        return 2
    
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
        
        # Crée un objet slice compatible
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
    transform = slice_.transform
    crs = slice_.crs
    
    print(f"   Dimensions : {rgb.shape[0]}×{rgb.shape[1]} pixels")
    
    # Initialise le segmenteur
    print(f"\n🤖 Chargement du modèle de segmentation...")
    settings = segmentation_settings_from_env(require_checkpoint=True)
    print(f"   SegFormer dir : {settings.segformer_checkpoint_dir}")
    
    segmenter = SegFormerParkableSegmenter(settings)
    
    # Lance la prédiction
    print(f"\n🔮 Exécution de la segmentation...")
    seg_output = segmenter.predict(rgb)
    
    print(f"   ✓ Masque brut généré")
    print(f"   ✓ Masque raffiné généré")
    
    # Sauvegarde les masques
    print(f"\n💾 Sauvegarde des résultats dans : {out_dir}")
    
    mask_raw_path = out_dir / "mask_raw.png"
    Image.fromarray(seg_output.mask_raw, mode="L").save(mask_raw_path)
    print(f"   ✓ {mask_raw_path.name}")
    
    mask_refined_path = out_dir / "mask_refined.png"
    Image.fromarray(seg_output.mask_refined, mode="L").save(mask_refined_path)
    print(f"   ✓ {mask_refined_path.name}")
    
    # Crée et sauvegarde l'overlay
    overlay = create_overlay(rgb, seg_output.mask_refined, alpha=args.overlay_alpha)
    overlay_path = out_dir / "overlay_segmentation.png"
    Image.fromarray(overlay, mode="RGB").save(overlay_path)
    print(f"   ✓ {overlay_path.name}")
    
    # Sauvegarde l'image originale pour référence
    rgb_path = out_dir / "rgb_original.png"
    Image.fromarray(rgb, mode="RGB").save(rgb_path)
    print(f"   ✓ {rgb_path.name}")
    
    # Export GeoJSON si le raster a un CRS
    if crs is not None:
        mp = refined_mask_to_multipolygon(seg_output.mask_refined)
        if mp is not None and not mp.is_empty:
            mp_wgs = transform_geometry_pixels_to_wgs84(mp, transform, crs)
            parkable_fc = feature_collection([shapely_to_geojson_feature(mp_wgs, {"layer": "parkable"})])
            
            import json
            geojson_path = out_dir / "parkable_zones.geojson"
            with open(geojson_path, "w") as f:
                json.dump(parkable_fc, f, indent=2)
            print(f"   ✓ {geojson_path.name} (zones en WGS84)")
        else:
            print(f"   ⚠ Aucune zone parkable détectée")
    else:
        print(f"   ⚠ Pas de CRS : export GeoJSON non disponible")
    
    # Statistiques
    total_pixels = rgb.shape[0] * rgb.shape[1]
    parkable_pixels = np.sum(seg_output.mask_refined > 0)
    parkable_pct = (parkable_pixels / total_pixels) * 100 if total_pixels > 0 else 0
    
    print(f"\n📊 Statistiques :")
    print(f"   Pixels totaux : {total_pixels:,}")
    print(f"   Pixels parkables : {parkable_pixels:,} ({parkable_pct:.2f}%)")
    
    print(f"\n✅ Test de segmentation terminé !")
    
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
