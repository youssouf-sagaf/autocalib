#!/usr/bin/env python3
"""Fine-tune SegFormer for binary parkable segmentation (manual / local GPU).

Matches ``segformer/finetune_segformer_colab.ipynb`` layout: ``DATA_DIR/images``,
``DATA_DIR/masks``, ``train.txt`` / ``val.txt`` / ``test.txt`` (image stems).

Example::

    python finetune_segformer_parking.py \\
        --data-dir /path/to/combined_dataset_segmentation \\
        --output-dir ./segformer-b0-parkable-best
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from PIL import Image
from torch.utils.data import DataLoader, Dataset
from tqdm.auto import tqdm
from transformers import AutoImageProcessor, SegformerForSemanticSegmentation, get_scheduler


class ParkingDataset(Dataset):
    """Same contract as the Colab notebook."""

    def __init__(self, data_dir: Path, split: str, processor, img_size: int):
        with open(data_dir / f"{split}.txt", encoding="utf-8") as f:
            self.ids = [ln.strip() for ln in f if ln.strip()]
        self.data_dir = data_dir
        self.processor = processor
        self.img_size = img_size

    def __len__(self) -> int:
        return len(self.ids)

    def __getitem__(self, idx: int):
        sid = self.ids[idx]
        img_path = self.data_dir / "images" / f"{sid}.png"
        if not img_path.exists():
            img_path = self.data_dir / "images" / f"{sid}.jpg"
        mask_path = self.data_dir / "masks" / f"{sid}.png"
        if not mask_path.exists():
            mask_path = self.data_dir / "masks" / f"{sid}.jpg"

        image = Image.open(img_path).convert("RGB").resize(
            (self.img_size, self.img_size), Image.BILINEAR,
        )
        mask = Image.open(mask_path).convert("L").resize(
            (self.img_size, self.img_size), Image.NEAREST,
        )

        mask_np = np.array(mask, dtype=np.int64)
        mask_np[mask_np == 255] = 1

        pixel_values = self.processor(images=image, return_tensors="pt")["pixel_values"].squeeze(0)
        labels = torch.tensor(mask_np, dtype=torch.long)
        return pixel_values, labels


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--data-dir", type=Path, required=True)
    p.add_argument("--output-dir", type=Path, required=True)
    p.add_argument("--backbone", type=str, default="b0", help="SegFormer size: b0, b1, …")
    p.add_argument("--img-size", type=int, default=512)
    p.add_argument("--batch-size", type=int, default=8)
    p.add_argument("--epochs", type=int, default=30)
    p.add_argument("--lr", type=float, default=6e-5)
    p.add_argument("--num-workers", type=int, default=2)
    args = p.parse_args()

    model_id = f"nvidia/segformer-{args.backbone}-finetuned-cityscapes-1024-1024"
    num_classes = 2
    id2label = {0: "background", 1: "parkable"}
    label2id = {"background": 0, "parkable": 1}

    device = "cuda" if torch.cuda.is_available() else "cpu"

    processor = AutoImageProcessor.from_pretrained(model_id)
    model = SegformerForSemanticSegmentation.from_pretrained(
        model_id,
        num_labels=num_classes,
        id2label=id2label,
        label2id=label2id,
        ignore_mismatched_sizes=True,
    ).to(device)

    train_loader = DataLoader(
        ParkingDataset(args.data_dir, "train", processor, args.img_size),
        batch_size=args.batch_size,
        shuffle=True,
        num_workers=args.num_workers,
    )
    val_loader = DataLoader(
        ParkingDataset(args.data_dir, "val", processor, args.img_size),
        batch_size=args.batch_size,
        shuffle=False,
        num_workers=args.num_workers,
    )
    test_path = args.data_dir / "test.txt"
    if test_path.exists() and test_path.read_text(encoding="utf-8").strip():
        test_loader = DataLoader(
            ParkingDataset(args.data_dir, "test", processor, args.img_size),
            batch_size=args.batch_size,
            shuffle=False,
            num_workers=args.num_workers,
        )
    else:
        test_loader = None

    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.01)
    num_steps = len(train_loader) * args.epochs
    lr_scheduler = get_scheduler(
        "cosine",
        optimizer=optimizer,
        num_warmup_steps=int(0.1 * num_steps),
        num_training_steps=num_steps,
    )

    args.output_dir.mkdir(parents=True, exist_ok=True)
    best_miou = 0.0
    history: list[dict] = []

    for epoch in range(1, args.epochs + 1):
        model.train()
        train_loss = 0.0
        bar = tqdm(train_loader, desc=f"Epoch {epoch}/{args.epochs} [train]")
        for px, lb in bar:
            px, lb = px.to(device), lb.to(device)
            logits = model(pixel_values=px).logits
            up = nn.functional.interpolate(
                logits, size=lb.shape[1:], mode="bilinear", align_corners=False,
            )
            loss = nn.functional.cross_entropy(up, lb, ignore_index=255)
            loss.backward()
            optimizer.step()
            lr_scheduler.step()
            optimizer.zero_grad()
            train_loss += loss.item()
            bar.set_postfix(loss=f"{loss.item():.4f}")

        model.eval()
        val_loss = 0.0
        ious_bg, ious_pk = [], []
        with torch.no_grad():
            for px, lb in val_loader:
                px, lb = px.to(device), lb.to(device)
                logits = model(pixel_values=px).logits
                up = nn.functional.interpolate(
                    logits, size=lb.shape[1:], mode="bilinear", align_corners=False,
                )
                val_loss += nn.functional.cross_entropy(up, lb, ignore_index=255).item()
                preds = up.argmax(dim=1)
                for cls, store in [(0, ious_bg), (1, ious_pk)]:
                    inter = ((preds == cls) & (lb == cls)).sum().item()
                    union = ((preds == cls) | (lb == cls)).sum().item()
                    if union > 0:
                        store.append(inter / union)

        bg = float(np.mean(ious_bg)) if ious_bg else 0.0
        pk = float(np.mean(ious_pk)) if ious_pk else 0.0
        miou = (bg + pk) / 2
        avg_tl = train_loss / max(len(train_loader), 1)
        avg_vl = val_loss / max(len(val_loader), 1)

        print(
            f"  train_loss={avg_tl:.4f} | val_loss={avg_vl:.4f} | "
            f"bg_IoU={bg:.4f} | park_IoU={pk:.4f} | mIoU={miou:.4f}",
        )
        history.append({
            "epoch": epoch,
            "train_loss": avg_tl,
            "val_loss": avg_vl,
            "bg_iou": bg,
            "parkable_iou": pk,
            "miou": miou,
        })

        if miou > best_miou:
            best_miou = miou
            best_dir = args.output_dir / "best"
            model.save_pretrained(best_dir)
            processor.save_pretrained(best_dir)
            print(f"  -> Best model saved (mIoU={miou:.4f})")

    last_dir = args.output_dir / "last"
    model.save_pretrained(last_dir)
    processor.save_pretrained(last_dir)
    hist_path = args.output_dir / f"history_{args.backbone}.json"
    hist_path.write_text(json.dumps(history, indent=2), encoding="utf-8")
    print(f"\nDone! Best mIoU: {best_miou:.4f}")

    if test_loader is not None:
        best_ckpt = args.output_dir / "best"
        if best_ckpt.is_dir():
            eval_model = SegformerForSemanticSegmentation.from_pretrained(best_ckpt).to(device)
            eval_model.eval()
            test_bg, test_pk = [], []
            with torch.no_grad():
                for px, lb in tqdm(test_loader, desc="Test"):
                    px, lb = px.to(device), lb.to(device)
                    logits = eval_model(pixel_values=px).logits
                    up = nn.functional.interpolate(
                        logits, size=lb.shape[1:], mode="bilinear", align_corners=False,
                    )
                    preds = up.argmax(dim=1)
                    for cls, store in [(0, test_bg), (1, test_pk)]:
                        inter = ((preds == cls) & (lb == cls)).sum().item()
                        union = ((preds == cls) | (lb == cls)).sum().item()
                        if union > 0:
                            store.append(inter / union)
            tbg = float(np.mean(test_bg)) if test_bg else 0.0
            tpk = float(np.mean(test_pk)) if test_pk else 0.0
            print(f"Test — bg_IoU={tbg:.4f} | parkable_IoU={tpk:.4f} | mIoU={(tbg+tpk)/2:.4f}")


if __name__ == "__main__":
    main()
