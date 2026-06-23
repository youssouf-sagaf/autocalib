"""File-based pairing store — one JSON file per device id."""

from __future__ import annotations

import logging
from pathlib import Path

from pairing.models import PairingSet

logger = logging.getLogger(__name__)


class PairingStore:
    """Filesystem persistence for ``PairingSet`` records.

    Each device is stored as ``<root>/<device_id>.json`` (default
    ``pairing/pairings/``). Writes are
    atomic via tmp-then-rename so a concurrent reader never sees a
    half-written file.
    """

    def __init__(self, root: Path) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    def save(self, pairing_set: PairingSet) -> Path:
        path = self._path_for(pairing_set.device_id)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(pairing_set.model_dump_json(indent=2))
        tmp.replace(path)
        logger.info(
            "Pairings persisted: %s — %d links, %d zones → %s",
            pairing_set.device_id,
            len(pairing_set.links),
            len(pairing_set.zones),
            path,
        )
        return path

    def load(self, device_id: str) -> PairingSet | None:
        path = self._path_for(device_id)
        if not path.exists():
            return None
        return PairingSet.model_validate_json(path.read_text())

    def _path_for(self, device_id: str) -> Path:
        return self.root / f"{device_id}.json"
