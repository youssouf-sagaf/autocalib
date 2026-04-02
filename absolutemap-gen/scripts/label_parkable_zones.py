#!/usr/bin/env python3
"""Interactive tool to draw parkable zone polygons on dataset images.

Opens each image that lacks a label file in artifacts/parkable_labels/.
Click to place polygon vertices, then use keyboard shortcuts to manage.

Controls:
    Left click   — add vertex to current polygon
    Right click  — undo last vertex
    Enter        — close current polygon and start a new one
    S            — save label file and move to next image
    D            — skip image (no label saved)
    Q            — quit

Output format (YOLO segmentation):
    0 x1 y1 x2 y2 ... xN yN   (normalised coords, one polygon per line)
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import matplotlib
matplotlib.use("TkAgg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.lines import Line2D
from PIL import Image
import numpy as np


class PolygonDrawer:
    """Matplotlib-based interactive polygon drawing on a single image."""

    def __init__(self, img_path: Path, save_path: Path) -> None:
        self.img_path = img_path
        self.save_path = save_path
        self.img = np.array(Image.open(img_path))
        self.h, self.w = self.img.shape[:2]

        self.polygons: list[list[tuple[float, float]]] = []
        self.current_poly: list[tuple[float, float]] = []
        self.result: str = "skip"

        self.fig, self.ax = plt.subplots(1, 1, figsize=(12, 12))
        self.ax.imshow(self.img)
        self.ax.set_title(
            f"{img_path.stem}\n"
            "Click=vertex | RightClick=undo | Enter=close poly | S=save | D=skip | Q=quit",
            fontsize=10,
        )
        self.ax.axis("off")

        self._current_line, = self.ax.plot([], [], "r.-", linewidth=1.5, markersize=6)
        self._poly_patches: list[plt.Polygon] = []

        self.fig.canvas.mpl_connect("button_press_event", self._on_click)
        self.fig.canvas.mpl_connect("key_press_event", self._on_key)

    def _redraw_current(self) -> None:
        if self.current_poly:
            xs = [p[0] for p in self.current_poly]
            ys = [p[1] for p in self.current_poly]
            self._current_line.set_data(xs, ys)
        else:
            self._current_line.set_data([], [])
        self.fig.canvas.draw_idle()

    def _close_current_polygon(self) -> None:
        if len(self.current_poly) < 3:
            return
        self.polygons.append(self.current_poly[:])
        patch = plt.Polygon(
            self.current_poly, closed=True,
            fill=True, facecolor=(0, 1, 0, 0.2), edgecolor="lime", linewidth=2,
        )
        self.ax.add_patch(patch)
        self.current_poly = []
        self._redraw_current()

    def _on_click(self, event) -> None:
        if event.inaxes != self.ax:
            return
        if event.button == 1:
            self.current_poly.append((event.xdata, event.ydata))
            self._redraw_current()
        elif event.button == 3:
            if self.current_poly:
                self.current_poly.pop()
                self._redraw_current()

    def _on_key(self, event) -> None:
        if event.key == "enter":
            self._close_current_polygon()
        elif event.key == "s":
            self._close_current_polygon()
            self._save()
            self.result = "saved"
            plt.close(self.fig)
        elif event.key == "d":
            self.result = "skip"
            plt.close(self.fig)
        elif event.key == "q":
            self.result = "quit"
            plt.close(self.fig)

    def _save(self) -> None:
        if not self.polygons:
            return
        self.save_path.parent.mkdir(parents=True, exist_ok=True)
        lines = []
        for poly in self.polygons:
            coords = []
            for x_px, y_px in poly:
                coords.append(f"{x_px / self.w:.10f}")
                coords.append(f"{y_px / self.h:.10f}")
            lines.append("0 " + " ".join(coords))
        self.save_path.write_text("\n".join(lines) + "\n")

    def run(self) -> str:
        plt.show(block=True)
        return self.result


def main() -> int:
    parser = argparse.ArgumentParser(description="Draw parkable zone polygons on dataset images.")
    parser.add_argument(
        "--dataset",
        type=Path,
        default="artifacts/mapbox_detection_dataset",
        help="Directory containing .png images (default: artifacts/mapbox_detection_dataset)",
    )
    parser.add_argument(
        "--labels",
        type=Path,
        default="artifacts/parkable_labels",
        help="Directory for output label files (default: artifacts/parkable_labels)",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Show all images, including those that already have labels",
    )
    parser.add_argument(
        "--filter",
        type=str,
        default=None,
        help="Only show images whose name contains this string (e.g. 'levallois')",
    )
    args = parser.parse_args()

    dataset_dir = args.dataset.resolve()
    labels_dir = args.labels.resolve()

    images = sorted(dataset_dir.glob("*.png"))
    if not images:
        print(f"No .png images found in {dataset_dir}", file=sys.stderr)
        return 1

    if args.filter:
        images = [p for p in images if args.filter.lower() in p.stem.lower()]

    if not args.all:
        images = [p for p in images if not (labels_dir / f"{p.stem}.txt").exists()]

    if not images:
        print("All images already have labels (use --all to re-annotate).")
        return 0

    print(f"{len(images)} images to annotate in {dataset_dir}")
    print(f"Labels will be saved to {labels_dir}\n")

    for i, img_path in enumerate(images):
        label_path = labels_dir / f"{img_path.stem}.txt"
        print(f"[{i + 1}/{len(images)}] {img_path.stem}", end=" ... ")

        drawer = PolygonDrawer(img_path, label_path)
        result = drawer.run()

        if result == "saved":
            n_polys = len(drawer.polygons)
            print(f"saved ({n_polys} polygon{'s' if n_polys != 1 else ''})")
        elif result == "skip":
            print("skipped")
        elif result == "quit":
            print("quit")
            break

    print("\nDone.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
