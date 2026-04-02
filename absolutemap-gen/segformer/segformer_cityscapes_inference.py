"""
SegFormer Cityscapes Inference Script
=====================================
1. Downloads all SegFormer models fine-tuned on Cityscapes (b0-b5)
2. Downloads sample street/urban images for inference
3. Runs semantic segmentation and saves colored output images
"""

import os
import torch
import numpy as np
import requests
from PIL import Image
from pathlib import Path
from transformers import (
    AutoImageProcessor,
    SegformerForSemanticSegmentation,
)

# ── Cityscapes 19-class color palette ──────────────────────────────────────────
# Standard Cityscapes color map (RGB)
CITYSCAPES_PALETTE = [
    (128, 64, 128),   # 0  road
    (244, 35, 232),   # 1  sidewalk
    (70, 70, 70),     # 2  building
    (102, 102, 156),  # 3  wall
    (190, 153, 153),  # 4  fence
    (153, 153, 153),  # 5  pole
    (250, 170, 30),   # 6  traffic light
    (220, 220, 0),    # 7  traffic sign
    (107, 142, 35),   # 8  vegetation
    (152, 251, 152),  # 9  terrain
    (70, 130, 180),   # 10 sky
    (220, 20, 60),    # 11 person
    (255, 0, 0),      # 12 rider
    (0, 0, 142),      # 13 car
    (0, 0, 70),       # 14 truck
    (0, 60, 100),     # 15 bus
    (0, 80, 100),     # 16 train
    (0, 0, 230),      # 17 motorcycle
    (119, 11, 32),    # 18 bicycle
]

CITYSCAPES_LABELS = [
    "road", "sidewalk", "building", "wall", "fence", "pole",
    "traffic light", "traffic sign", "vegetation", "terrain", "sky",
    "person", "rider", "car", "truck", "bus", "train", "motorcycle", "bicycle",
]

# ── Cityscapes SegFormer model IDs ─────────────────────────────────────────────

 = [
    "nvidia/segformer-b0-finetuned-cityscapes-1024-1024",
    "nvidia/segformer-b1-finetuned-cityscapes-1024-1024",
    "nvidia/segformer-b2-finetuned-cityscapes-1024-1024",
    "nvidia/segformer-b3-finetuned-cityscapes-1024-1024",
    "nvidia/segformer-b4-finetuned-cityscapes-1024-1024",
    "nvidia/segformer-b5-finetuned-cityscapes-1024-1024",
]

# ── Sample urban/street images for testing ─────────────────────────────────────
SAMPLE_IMAGES = {
    "street_scene_1.jpg": "https://huggingface.co/datasets/huggingface/documentation-images/resolve/main/transformers/tasks/segmentation_input.jpg",
    "cityscapes_demo.png": "http://images.cocodataset.org/val2017/000000039769.jpg",
    "urban_street.jpg": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/New_york_times_square-terabass.jpg/800px-New_york_times_square-terabass.jpg",
}

# ── Paths ──────────────────────────────────────────────────────────────────────
SCRIPT_DIR = Path(__file__).resolve().parent
INPUT_DIR = SCRIPT_DIR / "input_images"
OUTPUT_DIR = SCRIPT_DIR / "output"
WEIGHTS_DIR = SCRIPT_DIR / "weights"

INPUT_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)
WEIGHTS_DIR.mkdir(exist_ok=True)


def colorize_segmentation(seg_map: np.ndarray) -> Image.Image:
    """Convert a segmentation map (H, W) with class indices to an RGB PIL image."""
    h, w = seg_map.shape
    color_img = np.zeros((h, w, 3), dtype=np.uint8)
    for class_id, color in enumerate(CITYSCAPES_PALETTE):
        color_img[seg_map == class_id] = color
    return Image.fromarray(color_img)


def download_sample_images():
    """Download sample images for inference."""
    print("\n=== Downloading sample images ===")
    for name, url in SAMPLE_IMAGES.items():
        path = INPUT_DIR / name
        if path.exists():
            print(f"  [skip] {name} already exists")
            continue
        print(f"  Downloading {name} ...")
        try:
            resp = requests.get(url, timeout=30, stream=True)
            resp.raise_for_status()
            with open(path, "wb") as f:
                for chunk in resp.iter_content(chunk_size=8192):
                    f.write(chunk)
            print(f"  [ok]   saved to {path}")
        except Exception as e:
            print(f"  [FAIL] {name}: {e}")


def download_and_cache_models():
    """Download all Cityscapes SegFormer models (weights cached by HF)."""
    print("\n=== Downloading SegFormer Cityscapes models ===")
    for model_id in CITYSCAPES_MODELS:
        short = model_id.split("/")[-1]
        cache_dir = WEIGHTS_DIR / short
        print(f"\n  Loading {model_id} ...")
        try:
            processor = AutoImageProcessor.from_pretrained(model_id, cache_dir=str(cache_dir))
            model = SegformerForSemanticSegmentation.from_pretrained(model_id, cache_dir=str(cache_dir))
            print(f"  [ok]   {short} — num_labels={model.config.num_labels}")
        except Exception as e:
            print(f"  [FAIL] {short}: {e}")


def run_inference():
    """Run inference with every Cityscapes model on every input image."""
    device = "mps" if torch.backends.mps.is_available() else "cuda" if torch.cuda.is_available() else "cpu"
    print(f"\n=== Running inference on device: {device} ===")

    # Collect input images
    image_paths = sorted(
        p for p in INPUT_DIR.iterdir()
        if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff"}
    )
    if not image_paths:
        print("  No input images found in", INPUT_DIR)
        return

    print(f"  Found {len(image_paths)} input image(s)")

    for model_id in CITYSCAPES_MODELS:
        short = model_id.split("/")[-1]
        cache_dir = WEIGHTS_DIR / short
        print(f"\n--- Model: {short} ---")

        processor = AutoImageProcessor.from_pretrained(model_id, cache_dir=str(cache_dir))
        model = SegformerForSemanticSegmentation.from_pretrained(model_id, cache_dir=str(cache_dir))
        model.to(device)
        model.eval()

        model_out_dir = OUTPUT_DIR / short
        model_out_dir.mkdir(exist_ok=True)

        for img_path in image_paths:
            image = Image.open(img_path).convert("RGB")
            original_size = image.size  # (W, H)

            inputs = processor(images=image, return_tensors="pt").to(device)

            with torch.no_grad():
                outputs = model(**inputs)

            logits = outputs.logits  # (1, num_labels, H/4, W/4)

            # Upsample logits to original image size
            upsampled = torch.nn.functional.interpolate(
                logits,
                size=(original_size[1], original_size[0]),  # (H, W)
                mode="bilinear",
                align_corners=False,
            )
            seg_map = upsampled.argmax(dim=1).squeeze().cpu().numpy()

            # Save colored segmentation
            seg_img = colorize_segmentation(seg_map)
            out_name = f"{img_path.stem}_seg.png"
            seg_img.save(model_out_dir / out_name)

            # Save overlay (original + segmentation blended)
            overlay = Image.blend(image.resize((seg_img.width, seg_img.height)), seg_img, alpha=0.5)
            overlay_name = f"{img_path.stem}_overlay.png"
            overlay.save(model_out_dir / overlay_name)

            print(f"  {img_path.name:30s} -> {out_name}, {overlay_name}")

        # Free memory
        del model
        if device == "cuda":
            torch.cuda.empty_cache()

    print(f"\n=== Done! Results saved to {OUTPUT_DIR} ===")


if __name__ == "__main__":
    # Step 1: Download sample images
    download_sample_images()

    # Step 2: Download all Cityscapes SegFormer weights (b0-b5)
    download_and_cache_models()

    # Step 3: Run inference and save segmented images
    run_inference()
