"""
Generate side-by-side comparison images: original | overlay | binary mask
"""

from pathlib import Path
from PIL import Image

INPUT_DIR = Path(__file__).resolve().parent.parent / "artifacts" / "mapbox_detection_dataset"
INFERENCE_DIR = Path(__file__).resolve().parent / "output" / "mapbox_b2_inference"
OUTPUT_DIR = Path(__file__).resolve().parent / "output" / "mapbox_b2_comparison"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

images = sorted(INPUT_DIR.glob("*.png"))

for img_path in images:
    name = img_path.stem
    overlay_path = INFERENCE_DIR / f"{name}_overlay.png"
    seg_path = INFERENCE_DIR / f"{name}_seg.png"

    if not overlay_path.exists() or not seg_path.exists():
        continue

    original = Image.open(img_path).convert("RGB")
    overlay = Image.open(overlay_path).convert("RGB")
    seg = Image.open(seg_path).convert("RGB")

    # Resize all to same height
    h = original.height
    w = original.width
    overlay = overlay.resize((w, h), Image.BILINEAR)
    seg = seg.resize((w, h), Image.NEAREST)

    # Concatenate side by side
    grid = Image.new("RGB", (w * 3, h))
    grid.paste(original, (0, 0))
    grid.paste(overlay, (w, 0))
    grid.paste(seg, (w * 2, 0))

    grid.save(OUTPUT_DIR / f"{name}_comparison.png")

print(f"Done! {len(list(OUTPUT_DIR.glob('*.png')))} comparisons saved to {OUTPUT_DIR}")
