"""Phase 0 contract tests for Stable Assistant Turn Anchors (#3926).

The first implementation slice was intentionally non-visual. Later slices keep
the same inventory contract while adding narrow, tested wiring points.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PHASE0_DOC = REPO / "docs" / "architecture" / "stable-assistant-turn-anchor-phase0.md"
NODE = shutil.which("node")


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_phase0_inventory_doc_matches_scaffold_contract():
    doc = _read(PHASE0_DOC)
    for marker in [
        "RuntimeAdapter / run-journal Event Envelope",
        "Run journal replay events",
        "Server settled transcript",
        "`S.messages`",
        "`INFLIGHT`",
        "Stream closure state",
        "Live DOM",
        "Slice 7 Dual-Run Reconciler",
        "`HermesAssistantTurnAnchors.reconcileAssistantTurnAnchorActivityScene()`",
        "`activity_scene_reconciliation_v1`",
        "Dedupe Invariant",
        "`event_id`",
        "`run_id + seq`",
        "`session_id + source_event_type + local_id + seq`",
    ]:
        assert marker in doc
