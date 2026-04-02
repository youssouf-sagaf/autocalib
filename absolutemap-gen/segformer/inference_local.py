"""
Run SegFormer inference on mapbox_detection_dataset using fine-tuned checkpoints.
Saves segmentation masks and overlays.
"""

import numpy as np
import torch
import torch.nn as nn
from pathlib import Path
from PIL import Image
from transformers import AutoImageProcessor, SegformerForSemanticSegmentation
from tqdm import tqdm

# ── Paths ──────────────────────────────────────────────────────────────────────
SCRIPT_DIR = Path(__file__).resolve().parent
CHECKPOINT = SCRIPT_DIR.parent / "artifacts" / "checkpoints" / "segformer-b2-parkable-best"
INPUT_DIR = SCRIPT_DIR.parent / "artifacts" / "mapbox_detection_dataset"
OUTPUT_DIR = SCRIPT_DIR / "output" / "mapbox_b2_inference"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

PALETTE = np.array([[0, 0, 0], [0, 255, 128]], dtype=np.uint8)

# ── Load model ─────────────────────────────────────────────────────────────────
device = "mps" if torch.backends.mps.is_available() else "cuda" if torch.cuda.is_available() else "cpu"
print(f"Device: {device}")
print(f"Checkpoint: {CHECKPOINT}")

processor = AutoImageProcessor.from_pretrained(CHECKPOINT)
model = SegformerForSemanticSegmentation.from_pretrained(CHECKPOINT).to(device)
model.eval()

# ── Inference ──────────────────────────────────────────────────────────────────
images = sorted(INPUT_DIR.glob("*.png"))
print(f"Found {len(images)} images in {INPUT_DIR}\n")

for img_path in tqdm(images, desc="Inference"):
    image = Image.open(img_path).convert("RGB")
    orig_size = image.size  # (W, H)

    inputs = processor(images=image, return_tensors="pt").to(device)

    with torch.no_grad():
        logits = model(**inputs).logits
        up = nn.functional.interpolate(
            logits, size=(orig_size[1], orig_size[0]),
            mode="bilinear", align_corners=False,
        )
        pred = up.argmax(dim=1).squeeze().cpu().numpy()

    # Colored segmentation mask
    pred_color = Image.fromarray(PALETTE[pred])
    pred_color.save(OUTPUT_DIR / f"{img_path.stem}_seg.png")

    # Overlay
    overlay = Image.blend(image, pred_color.resize(image.size), alpha=0.4)
    overlay.save(OUTPUT_DIR / f"{img_path.stem}_overlay.png")

print(f"\nDone! Results in {OUTPUT_DIR}")
