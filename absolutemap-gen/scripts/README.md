# Manual retraining scripts (R&D)

These scripts mirror the Colab notebooks under `notebooks/` and `segformer/` but run locally with explicit paths. They do **not** import `autoabsmap` (training stack is separate from the production package).

## End-to-end order

1. **Run mapping + save session** via `autoabsmap-api` so `sessions/<job_id>/per_crop/*/rgb.png` and masks exist (orchestrator writes crop artifacts under the API working directory, usually `sessions/` next to where uvicorn runs).

2. **Export** training packs from the monorepo root (Python ≥ 3.11, package installed):

   ```bash
   pip install -e ./autoabsmap
   python -m autoabsmap.learning_loop.export_training_layout \
     --sessions-root ./sessions \
     --out ./training_export \
     --task both \
     --train-ratio 0.85
   ```

   This creates `training_export/segformer_pack/` (images, masks, `train.txt`, `val.txt`) and `training_export/yolo_pack/` (YOLO layout + `data.yaml`).

3. **Merge** into your existing historical dataset (Colab/Google Drive layout):

   ```bash
   python -m autoabsmap.learning_loop.merge_training_datasets \
     --task segformer \
     --base /path/to/combined_dataset_segmentation \
     --increment ./training_export/segformer_pack \
     --collision-policy prefix

   python -m autoabsmap.learning_loop.merge_training_datasets \
     --task yolo \
     --base /path/to/yolo_dataset_root \
     --increment ./training_export/yolo_pack \
     --collision-policy prefix
   ```

   Use `--dry-run` first. SegFormer merge updates `train.txt` / `val.txt`; YOLO merge copies into `train/` and `val/` trees and writes `merge_report.json`.

4. **Train** (install `ultralytics` / `torch` / `transformers` in your environment):

   ```bash
   cd absolutemap-gen/scripts
   pip install ultralytics torch transformers

   python train_yolo_obb_parking.py --data /path/to/yolo_dataset_root/data.yaml

   python finetune_segformer_parking.py \
     --data-dir /path/to/combined_dataset_segmentation \
     --output-dir ./segformer-out
   ```

## Notes

- **YOLO labels** use normalized OBB polygons; class `0` = empty, `1` = occupied (`SlotStatus` from the saved session).
- **Session split**: export assigns whole sessions to train or val (reduces leakage across tiles from the same job).
- **Collisions**: `prefix` renames stems with a short hash; `skip` ignores duplicate filenames in the base dataset.
