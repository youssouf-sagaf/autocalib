#!/usr/bin/env python3
"""Délègue au pipeline unique. Préférer: python run.py ..."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pipeline import run_pipeline


def main() -> None:
    parser = argparse.ArgumentParser(description="Calib–slots pipeline (lecture directe)")
    parser.add_argument("--device", default="device_00000000d6a21d5e")
    parser.add_argument("--strategy", choices=["angle", "distance", "delaunay", "row_grid"], default="row_grid")
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()

    result = run_pipeline(
        device_id=args.device,
        strategy=args.strategy,
        out_path=args.out,
        visualize=False,
        visualize_web=False,
    )

    if "error" in result:
        print(f"ERROR: {result['error']}")
        sys.exit(1)
    pairing = result.get("pairing")
    if pairing:
        print(f"Pairing ({pairing['strategy']}): {pairing['n_paired']} pairs")
        for a, b in pairing["paired"][:15]:
            print(f"  {a} -> {b}  [{'OK' if a == b else 'diff'}]")
    if args.out:
        print(f"Result: {args.out}")


if __name__ == "__main__":
    main()
