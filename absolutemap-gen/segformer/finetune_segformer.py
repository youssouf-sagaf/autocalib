"""
Fine-tune SegFormer on the merged_dataset (binary segmentation: background vs parkable).
==========================================================================================
Usage:
    python finetune_segformer.py                          # default b0
    python finetune_segformer.py --backbone b2            # use b2
    python finetune_segformer.py --epochs 50 --lr 3e-5    # custom hyperparams
"""

import argparse
import json
import os
import numpy as np
import torch
import torch.nn as nn
from pathlib import Path
from PIL import Image
from torch.utils.data import Dataset, DataLoader
from transformers import (
    AutoImageProcessor,
    SegformerForSemanticSegmentation,
    get_scheduler,
)
from tqdm import tqdm

# ── Paths ──────────────────────────────────────────────────────────────────────
SCRIPT_DIR = Path(__file__).resolve().parent
DATA_DIR = SCRIPT_DIR.parent / "data" / "combined_dataset_segmentation"
CHECKPOINTS_DIR = SCRIPT_DIR / "checkpoints"
CHECKPOINTS_DIR.mkdir(exist_ok=True)

# ── Model IDs per backbone ─────────────────────────────────────────────────────
BACKBONE_TO_MODEL = {
    "b0": "nvidia/segformer-b0-finetuned-cityscapes-1024-1024",
    "b1": "nvidia/segformer-b1-finetuned-cityscapes-1024-1024",
    "b2": "nvidia/segformer-b2-finetuned-cityscapes-1024-1024",
    "b3": "nvidia/segformer-b3-finetuned-cityscapes-1024-1024",
    "b4": "nvidia/segformer-b4-finetuned-cityscapes-1024-1024",
    "b5": "nvidia/segformer-b5-finetuned-cityscapes-1024-1024",
}

# ── Labels ─────────────────────────────────────────────────────────────────────
ID2LABEL = {0: "background", 1: "parkable"}
LABEL2ID = {"background": 0, "parkable": 1}
NUM_CLASSES = 2


class ParkingDataset(Dataset):
    """Binary segmentation dataset: background (0) vs parkable (1)."""

    def __init__(self, split_file: Path, image_dir: Path, mask_dir: Path, processor, img_size: int = 512):
        self.image_dir = image_dir
        self.mask_dir = mask_dir
        self.processor = processor
        self.img_size = img_size

        with open(split_file) as f:
            self.ids = [line.strip() for line in f if line.strip()]

    def __len__(self):
        return len(self.ids)

    def __getitem__(self, idx):
        sample_id = self.ids[idx]

        # Try common extensions
        img_path = self.image_dir / f"{sample_id}.png"
        if not img_path.exists():
            img_path = self.image_dir / f"{sample_id}.jpg"

        mask_path = self.mask_dir / f"{sample_id}.png"
        if not mask_path.exists():
            mask_path = self.mask_dir / f"{sample_id}.jpg"

        image = Image.open(img_path).convert("RGB")
        mask = Image.open(mask_path).convert("L")

        # Resize both to fixed size
        image = image.resize((self.img_size, self.img_size), Image.BILINEAR)
        mask = mask.resize((self.img_size, self.img_size), Image.NEAREST)

        # Convert mask: 255 -> 1 (parkable), 0 -> 0 (background)
        mask_np = np.array(mask, dtype=np.int64)
        mask_np[mask_np == 255] = 1

        # Process image with SegFormer processor
        inputs = self.processor(images=image, return_tensors="pt")
        pixel_values = inputs["pixel_values"].squeeze(0)  # (3, H, W)

        labels = torch.tensor(mask_np, dtype=torch.long)  # (H, W)

        return pixel_values, labels


def compute_metrics(preds: torch.Tensor, labels: torch.Tensor, num_classes: int = NUM_CLASSES):
    """Compute per-class IoU and mean IoU."""
    ious = []
    for cls in range(num_classes):
        pred_mask = preds == cls
        label_mask = labels == cls
        intersection = (pred_mask & label_mask).sum().item()
        union = (pred_mask | label_mask).sum().item()
        if union == 0:
            ious.append(float("nan"))
        else:
            ious.append(intersection / union)
    return ious


def train(args):
    device = (
        "mps" if torch.backends.mps.is_available()
        else "cuda" if torch.cuda.is_available()
        else "cpu"
    )
    print(f"Device: {device}")

    model_id = BACKBONE_TO_MODEL[args.backbone]
    print(f"Base model: {model_id}")

    # ── Load processor & model ─────────────────────────────────────────────
    processor = AutoImageProcessor.from_pretrained(model_id)

    model = SegformerForSemanticSegmentation.from_pretrained(
        model_id,
        num_labels=NUM_CLASSES,
        id2label=ID2LABEL,
        label2id=LABEL2ID,
        ignore_mismatched_sizes=True,  # classifier head changes from 19 -> 2
    )

    # MPS workaround: .view() fails on non-contiguous tensors (forward + backward)
    # Global patch: fallback to .contiguous().view() when .view() fails
    if device == "mps":
        _orig_view = torch.Tensor.view
        def _safe_view(self, *args):
            try:
                return _orig_view(self, *args)
            except RuntimeError:
                return _orig_view(self.contiguous(), *args)
        torch.Tensor.view = _safe_view
        print("  [MPS] Patched torch.Tensor.view for non-contiguous tensor compatibility")

    model.to(device)

    # ── Datasets & loaders ─────────────────────────────────────────────────
    image_dir = DATA_DIR / "images"
    mask_dir = DATA_DIR / "masks"

    train_ds = ParkingDataset(DATA_DIR / "train.txt", image_dir, mask_dir, processor, args.img_size)
    val_ds = ParkingDataset(DATA_DIR / "val.txt", image_dir, mask_dir, processor, args.img_size)

    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True, num_workers=0)
    val_loader = DataLoader(val_ds, batch_size=args.batch_size, shuffle=False, num_workers=0)

    print(f"Train: {len(train_ds)} | Val: {len(val_ds)} | Img size: {args.img_size}")

    # ── Optimizer & scheduler ──────────────────────────────────────────────
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.01)
    num_training_steps = len(train_loader) * args.epochs
    lr_scheduler = get_scheduler(
        "cosine",
        optimizer=optimizer,
        num_warmup_steps=int(0.1 * num_training_steps),
        num_training_steps=num_training_steps,
    )

    # ── Training loop ──────────────────────────────────────────────────────
    best_miou = 0.0
    history = []

    for epoch in range(1, args.epochs + 1):
        # --- Train ---
        model.train()
        train_loss = 0.0

        pbar = tqdm(train_loader, desc=f"Epoch {epoch}/{args.epochs} [train]")
        for pixel_values, labels in pbar:
            pixel_values = pixel_values.to(device)
            labels = labels.to(device)

            outputs = model(pixel_values=pixel_values)
            # Compute loss manually to avoid MPS .view() stride bug
            logits = outputs.logits
            upsampled_logits = nn.functional.interpolate(
                logits, size=labels.shape[1:], mode="bilinear", align_corners=False
            ).contiguous()
            loss = nn.functional.cross_entropy(upsampled_logits, labels, ignore_index=255)

            loss.backward()
            optimizer.step()
            lr_scheduler.step()
            optimizer.zero_grad()

            train_loss += loss.item()
            pbar.set_postfix(loss=f"{loss.item():.4f}")

        avg_train_loss = train_loss / len(train_loader)

        # --- Validation ---
        model.eval()
        val_loss = 0.0
        all_ious = []

        with torch.no_grad():
            for pixel_values, labels in tqdm(val_loader, desc=f"Epoch {epoch}/{args.epochs} [val]"):
                pixel_values = pixel_values.to(device)
                labels = labels.to(device)

                outputs = model(pixel_values=pixel_values)
                # Compute val loss manually (same as train)
                logits = outputs.logits
                upsampled = nn.functional.interpolate(
                    logits,
                    size=labels.shape[1:],
                    mode="bilinear",
                    align_corners=False,
                ).contiguous()
                val_loss += nn.functional.cross_entropy(
                    upsampled, labels, ignore_index=255
                ).item()
                preds = upsampled.argmax(dim=1)
                ious = compute_metrics(preds.cpu(), labels.cpu())
                all_ious.append(ious)

        avg_val_loss = val_loss / len(val_loader)

        # Per-class IoU
        ious_array = np.array(all_ious)
        bg_iou = np.nanmean(ious_array[:, 0])
        park_iou = np.nanmean(ious_array[:, 1])
        miou = np.nanmean([bg_iou, park_iou])

        print(
            f"  Epoch {epoch}: train_loss={avg_train_loss:.4f} | val_loss={avg_val_loss:.4f} | "
            f"bg_IoU={bg_iou:.4f} | parkable_IoU={park_iou:.4f} | mIoU={miou:.4f}"
        )

        history.append({
            "epoch": epoch,
            "train_loss": avg_train_loss,
            "val_loss": avg_val_loss,
            "bg_iou": float(bg_iou),
            "parkable_iou": float(park_iou),
            "miou": float(miou),
        })

        # Save best model
        if miou > best_miou:
            best_miou = miou
            save_dir = CHECKPOINTS_DIR / f"segformer-{args.backbone}-parkable-best"
            model.save_pretrained(save_dir)
            processor.save_pretrained(save_dir)
            print(f"  -> Best model saved (mIoU={miou:.4f}) to {save_dir}")

    # Save last checkpoint
    save_dir = CHECKPOINTS_DIR / f"segformer-{args.backbone}-parkable-last"
    model.save_pretrained(save_dir)
    processor.save_pretrained(save_dir)

    # Save training history
    with open(CHECKPOINTS_DIR / f"history_{args.backbone}.json", "w") as f:
        json.dump(history, f, indent=2)

    print(f"\nDone! Best mIoU: {best_miou:.4f}")
    print(f"Checkpoints in: {CHECKPOINTS_DIR}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fine-tune SegFormer on parking dataset")
    parser.add_argument("--backbone", type=str, default="b0", choices=list(BACKBONE_TO_MODEL.keys()))
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--batch_size", type=int, default=4)
    parser.add_argument("--lr", type=float, default=6e-5)
    parser.add_argument("--img_size", type=int, default=512)
    args = parser.parse_args()

    train(args)
