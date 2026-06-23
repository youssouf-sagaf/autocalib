"""Pairing persistence — one JSON file per device."""

from pathlib import Path

from pairing.pairing_store.store import PairingStore

# Runtime JSON drafts: pairing/pairings/<device_id>.json (gitignored contents)
PAIRING_DATA_DIR = Path(__file__).resolve().parent.parent / "pairings"

__all__ = ["PairingStore", "PAIRING_DATA_DIR"]
