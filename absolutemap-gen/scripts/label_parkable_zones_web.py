#!/usr/bin/env python3
"""Web-based tool to draw parkable-zone polygons on dataset images.

Launches a local HTTP server with an HTML5 Canvas interface.
Zero external dependencies — uses only the Python standard library.

Usage:
    python scripts/label_parkable_zones_web.py [--dataset DIR] [--labels DIR] [--port PORT]

Output format (YOLO segmentation):
    0 x1 y1 x2 y2 ... xN yN   (normalised [0-1] coords, one polygon per line)
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import sys
import webbrowser
from functools import partial
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse

# ---------------------------------------------------------------------------
# Paths (resolved at startup, overridable via CLI)
# ---------------------------------------------------------------------------
DATASET_DIR: Path = Path("artifacts/mapbox_detection_dataset")
LABELS_DIR: Path = Path("artifacts/segmentation_labels")


# ---------------------------------------------------------------------------
# Data helpers
# ---------------------------------------------------------------------------

def _image_names() -> list[str]:
    return sorted(p.stem for p in DATASET_DIR.glob("*.png"))


def _label_path(stem: str) -> Path:
    return LABELS_DIR / f"{stem}.txt"


def _read_label(stem: str) -> list[list[list[float]]]:
    lp = _label_path(stem)
    if not lp.exists():
        return []
    polygons: list[list[list[float]]] = []
    for line in lp.read_text().strip().splitlines():
        parts = line.strip().split()
        if len(parts) < 7:
            continue
        coords = list(map(float, parts[1:]))
        poly = [[coords[i], coords[i + 1]] for i in range(0, len(coords), 2)]
        polygons.append(poly)
    return polygons


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):
        pass

    # ---------- routing ----------

    def do_GET(self):
        path = urlparse(self.path).path

        if path == "/":
            self._html()
        elif path == "/api/images":
            self._api_images()
        elif path.startswith("/api/images/") and path.endswith("/file"):
            name = path.split("/")[3]
            self._api_image_file(name)
        elif path.startswith("/api/images/") and path.endswith("/label"):
            name = path.split("/")[3]
            self._api_get_label(name)
        else:
            self._respond(404, "text/plain", b"not found")

    def do_POST(self):
        path = urlparse(self.path).path
        if path.startswith("/api/images/") and path.endswith("/label"):
            name = path.split("/")[3]
            self._api_save_label(name)
        else:
            self._respond(404, "text/plain", b"not found")

    def do_DELETE(self):
        path = urlparse(self.path).path
        if path.startswith("/api/images/") and path.endswith("/label"):
            name = path.split("/")[3]
            self._api_delete_label(name)
        else:
            self._respond(404, "text/plain", b"not found")

    # ---------- helpers ----------

    def _respond(self, code: int, content_type: str, body: bytes):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj, code: int = 200):
        self._respond(code, "application/json", json.dumps(obj).encode())

    def _read_body(self) -> bytes:
        length = int(self.headers.get("Content-Length", 0))
        return self.rfile.read(length)

    # ---------- endpoints ----------

    def _api_images(self):
        names = _image_names()
        items = [{"name": n, "has_label": _label_path(n).exists()} for n in names]
        self._json(items)

    def _api_image_file(self, name: str):
        img_path = DATASET_DIR / f"{name}.png"
        if not img_path.exists():
            self._respond(404, "text/plain", b"not found")
            return
        data = img_path.read_bytes()
        self._respond(200, "image/png", data)

    def _api_get_label(self, name: str):
        self._json({"polygons": _read_label(name)})

    def _api_save_label(self, name: str):
        body = json.loads(self._read_body())
        polygons: list[list[list[float]]] = body.get("polygons", [])

        LABELS_DIR.mkdir(parents=True, exist_ok=True)
        lines: list[str] = []
        for poly in polygons:
            coords = []
            for x_norm, y_norm in poly:
                coords.append(f"{x_norm:.10f}")
                coords.append(f"{y_norm:.10f}")
            lines.append("0 " + " ".join(coords))
        _label_path(name).write_text("\n".join(lines) + "\n")
        self._json({"ok": True, "polygons_saved": len(polygons)})

    def _api_delete_label(self, name: str):
        lp = _label_path(name)
        if lp.exists():
            lp.unlink()
        self._json({"ok": True})

    # ---------- SPA ----------

    def _html(self):
        self._respond(200, "text/html; charset=utf-8", HTML_PAGE.encode())


# ---------------------------------------------------------------------------
# Embedded single-page frontend
# ---------------------------------------------------------------------------

HTML_PAGE = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Parkable Zone Labeler</title>
<style>
  :root {
    --bg: #1a1a2e;
    --surface: #16213e;
    --accent: #0f3460;
    --highlight: #e94560;
    --text: #eee;
    --text-muted: #888;
    --green: #00c853;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: system-ui, -apple-system, sans-serif;
    background: var(--bg);
    color: var(--text);
    display: flex;
    height: 100vh;
    overflow: hidden;
  }

  /* ---- sidebar ---- */
  #sidebar {
    width: 280px;
    min-width: 280px;
    background: var(--surface);
    display: flex;
    flex-direction: column;
    border-right: 1px solid #333;
  }
  #sidebar h2 {
    padding: 16px;
    font-size: 15px;
    border-bottom: 1px solid #333;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  #sidebar h2 span { color: var(--text-muted); font-weight: 400; font-size: 12px; }
  #filter-bar {
    padding: 8px 16px;
    border-bottom: 1px solid #333;
  }
  #filter-bar input {
    width: 100%;
    padding: 6px 10px;
    border-radius: 6px;
    border: 1px solid #444;
    background: var(--bg);
    color: var(--text);
    font-size: 13px;
    outline: none;
  }
  #filter-bar input:focus { border-color: var(--highlight); }
  #image-list {
    flex: 1;
    overflow-y: auto;
    list-style: none;
  }
  #image-list li {
    padding: 8px 16px;
    cursor: pointer;
    font-size: 13px;
    border-bottom: 1px solid #222;
    display: flex;
    justify-content: space-between;
    align-items: center;
    transition: background .15s;
  }
  #image-list li:hover { background: var(--accent); }
  #image-list li.active { background: var(--highlight); }
  .badge {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 10px;
    font-weight: 600;
    flex-shrink: 0;
  }
  .badge.labeled { background: var(--green); color: #000; }
  .badge.unlabeled { background: #444; color: #aaa; }

  /* ---- main ---- */
  #main {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* toolbar */
  #toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 16px;
    background: var(--surface);
    border-bottom: 1px solid #333;
    flex-wrap: wrap;
  }
  #toolbar button {
    padding: 6px 14px;
    border: none;
    border-radius: 6px;
    font-size: 13px;
    cursor: pointer;
    font-weight: 600;
    transition: opacity .15s;
  }
  #toolbar button:hover { opacity: .85; }
  .btn-primary { background: var(--highlight); color: #fff; }
  .btn-secondary { background: #444; color: #ddd; }
  .btn-success { background: var(--green); color: #000; }
  .btn-danger { background: #c62828; color: #fff; }
  #toolbar .info {
    margin-left: auto;
    font-size: 12px;
    color: var(--text-muted);
  }

  /* canvas area */
  #canvas-wrap {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    position: relative;
    background: #111;
  }
  #canvas-wrap canvas { cursor: crosshair; }

  /* keyboard help */
  #help {
    padding: 8px 16px;
    background: var(--surface);
    border-top: 1px solid #333;
    font-size: 11px;
    color: var(--text-muted);
    display: flex;
    gap: 20px;
    flex-wrap: wrap;
  }
  kbd {
    display: inline-block;
    padding: 1px 5px;
    border: 1px solid #555;
    border-radius: 3px;
    font-size: 11px;
    background: #333;
    color: #ddd;
  }
</style>
</head>
<body>

<!-- Sidebar -->
<div id="sidebar">
  <h2>Images <span id="counter"></span></h2>
  <div id="filter-bar"><input id="filter" type="text" placeholder="Filter images…"></div>
  <ul id="image-list"></ul>
</div>

<!-- Main area -->
<div id="main">
  <div id="toolbar">
    <button class="btn-secondary" onclick="undoVertex()" title="Undo last vertex (Ctrl+Z)">Undo vertex</button>
    <button class="btn-primary" onclick="closePoly()" title="Close current polygon (Enter)">Close polygon</button>
    <button class="btn-success" onclick="saveLabel()" title="Save all polygons (S)">Save</button>
    <button class="btn-danger" onclick="deleteLabel()" title="Delete label file">Delete label</button>
    <button class="btn-secondary" onclick="clearAll()" title="Clear all unsaved polygons">Clear all</button>
    <button class="btn-secondary" onclick="navPrev()" title="Previous image (←)">&larr; Prev</button>
    <button class="btn-secondary" onclick="navNext()" title="Next image (→)">Next &rarr;</button>
    <div class="info" id="status-text">Select an image</div>
  </div>
  <div id="canvas-wrap">
    <canvas id="cv"></canvas>
  </div>
  <div id="help">
    <span><kbd>Click</kbd> add vertex</span>
    <span><kbd>Right-click</kbd> undo vertex</span>
    <span><kbd>Enter</kbd> close polygon</span>
    <span><kbd>S</kbd> save</span>
    <span><kbd>Ctrl+Z</kbd> undo vertex</span>
    <span><kbd>&larr;</kbd><kbd>&rarr;</kbd> prev / next</span>
    <span><kbd>Delete</kbd> delete label</span>
  </div>
</div>

<script>
const cv = document.getElementById("cv");
const ctx = cv.getContext("2d");
const listEl = document.getElementById("image-list");
const filterEl = document.getElementById("filter");
const counterEl = document.getElementById("counter");
const statusEl = document.getElementById("status-text");

let images = [];
let filteredImages = [];
let currentIdx = -1;
let currentName = null;
let img = null;
let imgW = 0, imgH = 0;

let polygons = [];
let currentPoly = [];
let hoverPos = null;

// ---- data loading ----

async function loadImages() {
  const resp = await fetch("/api/images");
  images = await resp.json();
  applyFilter();
}

function applyFilter() {
  const q = filterEl.value.trim().toLowerCase();
  filteredImages = q ? images.filter(i => i.name.toLowerCase().includes(q)) : [...images];
  renderList();
}

function renderList() {
  const labeled = filteredImages.filter(i => i.has_label).length;
  counterEl.textContent = `${labeled}/${filteredImages.length} labeled`;
  listEl.innerHTML = "";
  filteredImages.forEach((item, idx) => {
    const li = document.createElement("li");
    const nameSpan = document.createElement("span");
    nameSpan.textContent = item.name;
    nameSpan.style.overflow = "hidden";
    nameSpan.style.textOverflow = "ellipsis";
    nameSpan.style.whiteSpace = "nowrap";
    nameSpan.style.marginRight = "8px";
    li.appendChild(nameSpan);
    if (item.name === currentName) li.classList.add("active");
    const badge = document.createElement("span");
    badge.className = "badge " + (item.has_label ? "labeled" : "unlabeled");
    badge.textContent = item.has_label ? "labeled" : "—";
    li.appendChild(badge);
    li.addEventListener("click", () => selectImage(idx));
    listEl.appendChild(li);
  });
}

filterEl.addEventListener("input", applyFilter);

async function selectImage(idx) {
  if (idx < 0 || idx >= filteredImages.length) return;
  currentIdx = idx;
  currentName = filteredImages[idx].name;

  statusEl.textContent = `Loading ${currentName}…`;
  polygons = [];
  currentPoly = [];
  hoverPos = null;

  img = new Image();
  img.onload = async () => {
    imgW = img.naturalWidth;
    imgH = img.naturalHeight;
    fitCanvas();

    const resp = await fetch(`/api/images/${currentName}/label`);
    const data = await resp.json();
    polygons = (data.polygons || []).map(p => p.map(([x, y]) => ({x: x * imgW, y: y * imgH})));
    draw();
    renderList();
    statusEl.textContent = `${currentName}  (${imgW}×${imgH})  —  ${polygons.length} polygon(s)`;
  };
  img.src = `/api/images/${currentName}/file`;
}

// ---- canvas sizing ----

function fitCanvas() {
  const wrap = document.getElementById("canvas-wrap");
  const maxW = wrap.clientWidth - 20;
  const maxH = wrap.clientHeight - 20;
  const scale = Math.min(maxW / imgW, maxH / imgH, 1);
  cv.width = Math.round(imgW * scale);
  cv.height = Math.round(imgH * scale);
  cv.dataset.scale = scale;
}

window.addEventListener("resize", () => { if (img) { fitCanvas(); draw(); } });

// ---- drawing ----

function draw() {
  if (!img) return;
  const s = parseFloat(cv.dataset.scale);
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.drawImage(img, 0, 0, cv.width, cv.height);

  polygons.forEach(poly => {
    ctx.beginPath();
    poly.forEach((p, i) => {
      const px = p.x * s, py = p.y * s;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.fillStyle = "rgba(0, 200, 80, 0.20)";
    ctx.fill();
    ctx.strokeStyle = "#00e676";
    ctx.lineWidth = 2;
    ctx.stroke();
    poly.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x * s, p.y * s, 4, 0, Math.PI * 2);
      ctx.fillStyle = "#00e676";
      ctx.fill();
    });
  });

  if (currentPoly.length > 0) {
    ctx.beginPath();
    currentPoly.forEach((p, i) => {
      const px = p.x * s, py = p.y * s;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    if (hoverPos) ctx.lineTo(hoverPos.x * s, hoverPos.y * s);
    ctx.strokeStyle = "#ff1744";
    ctx.lineWidth = 2;
    ctx.stroke();
    currentPoly.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x * s, p.y * s, 4, 0, Math.PI * 2);
      ctx.fillStyle = "#ff1744";
      ctx.fill();
    });
  }
}

// ---- mouse events ----

function canvasToImg(e) {
  const rect = cv.getBoundingClientRect();
  const s = parseFloat(cv.dataset.scale);
  return { x: (e.clientX - rect.left) / s, y: (e.clientY - rect.top) / s };
}

cv.addEventListener("mousedown", e => {
  if (!img) return;
  e.preventDefault();
  const pos = canvasToImg(e);
  if (e.button === 0) { currentPoly.push(pos); draw(); }
  else if (e.button === 2) { undoVertex(); }
});

cv.addEventListener("mousemove", e => {
  if (!img || currentPoly.length === 0) return;
  hoverPos = canvasToImg(e);
  draw();
});

cv.addEventListener("contextmenu", e => e.preventDefault());

// ---- actions ----

function undoVertex() {
  if (currentPoly.length > 0) { currentPoly.pop(); draw(); }
}

function closePoly() {
  if (currentPoly.length < 3) return;
  polygons.push([...currentPoly]);
  currentPoly = [];
  hoverPos = null;
  draw();
  statusEl.textContent = `${currentName}  —  ${polygons.length} polygon(s)  (unsaved)`;
}

async function saveLabel() {
  if (!currentName) return;
  if (currentPoly.length >= 3) closePoly();
  if (polygons.length === 0) { statusEl.textContent = "Nothing to save"; return; }
  const payload = polygons.map(poly => poly.map(p => [p.x / imgW, p.y / imgH]));
  const resp = await fetch(`/api/images/${currentName}/label`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({polygons: payload}),
  });
  const result = await resp.json();
  statusEl.textContent = `Saved ${result.polygons_saved} polygon(s) for ${currentName}`;
  const item = images.find(i => i.name === currentName);
  if (item) item.has_label = true;
  applyFilter();
}

async function deleteLabel() {
  if (!currentName) return;
  if (!confirm(`Delete label for ${currentName}?`)) return;
  await fetch(`/api/images/${currentName}/label`, {method: "DELETE"});
  polygons = [];
  currentPoly = [];
  draw();
  const item = images.find(i => i.name === currentName);
  if (item) item.has_label = false;
  applyFilter();
  statusEl.textContent = `Deleted label for ${currentName}`;
}

function clearAll() {
  polygons = [];
  currentPoly = [];
  hoverPos = null;
  draw();
  statusEl.textContent = "Cleared (not saved yet)";
}

function navPrev() { if (currentIdx > 0) selectImage(currentIdx - 1); }
function navNext() { if (currentIdx < filteredImages.length - 1) selectImage(currentIdx + 1); }

// ---- keyboard shortcuts ----

document.addEventListener("keydown", e => {
  if (e.target.tagName === "INPUT") return;
  if (e.key === "Enter") { closePoly(); e.preventDefault(); }
  else if (e.key === "s" || e.key === "S") { saveLabel(); e.preventDefault(); }
  else if (e.key === "ArrowLeft") { navPrev(); e.preventDefault(); }
  else if (e.key === "ArrowRight") { navNext(); e.preventDefault(); }
  else if (e.key === "Delete" || e.key === "Backspace") { deleteLabel(); e.preventDefault(); }
  else if ((e.metaKey || e.ctrlKey) && e.key === "z") { undoVertex(); e.preventDefault(); }
});

// ---- boot ----
loadImages().then(() => { if (filteredImages.length) selectImage(0); });
</script>
</body>
</html>
"""


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(
        description="Web-based parkable zone polygon labeler (no external deps).",
    )
    parser.add_argument(
        "--dataset", type=Path,
        default=Path("artifacts/mapbox_detection_dataset"),
        help="Directory with .png images (default: artifacts/mapbox_detection_dataset)",
    )
    parser.add_argument(
        "--labels", type=Path,
        default=Path("artifacts/segmentation_labels"),
        help="Directory for label .txt files (default: artifacts/segmentation_labels)",
    )
    parser.add_argument(
        "--port", type=int, default=5050,
        help="HTTP port (default: 5050)",
    )
    args = parser.parse_args()

    global DATASET_DIR, LABELS_DIR
    DATASET_DIR = args.dataset.resolve()
    LABELS_DIR = args.labels.resolve()

    if not DATASET_DIR.is_dir():
        print(f"Dataset directory not found: {DATASET_DIR}", file=sys.stderr)
        return 1

    n_images = len(list(DATASET_DIR.glob("*.png")))
    n_labeled = len(list(LABELS_DIR.glob("*.txt"))) if LABELS_DIR.is_dir() else 0
    print(f"Dataset : {DATASET_DIR}  ({n_images} images)")
    print(f"Labels  : {LABELS_DIR}  ({n_labeled} existing)")
    print(f"Open    : http://localhost:{args.port}\n")

    webbrowser.open(f"http://localhost:{args.port}")

    server = HTTPServer(("127.0.0.1", args.port), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
