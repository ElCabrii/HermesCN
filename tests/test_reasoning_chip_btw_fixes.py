"""Regression tests for PR #934 UI fixes.

Four invariants this file locks in place:

1. `#composerReasoningDropdown` lives OUTSIDE `.composer-left` (as a sibling of
   the other composer dropdowns), so it isn't clipped by that container's
   `overflow-y: hidden`.  Regresses to invisible-dropdown if moved back.

2. The reasoning chip label uses an SVG icon (`stroke="currentColor"`) instead
   of the `🧠` emoji, matching every other composer chip.

3. `cmdReasoning()` calls `_applyReasoningChip(eff)` directly with the
   server-confirmed effort, not `syncReasoningChip()` which re-applies the
   stale cached value.

4. `attachBtwStream()` sets a `_streamDone` flag in `done`/`apperror` and
   gates `onerror`'s row removal on `!_streamDone` — otherwise the browser's
   post-`stream_end` error event wipes the just-rendered answer.
"""
from __future__ import annotations

import pathlib
import re


REPO = pathlib.Path(__file__).resolve().parent.parent


# ── #1 dropdown escapes composer-left ─────────────────────────────────────────


# ── #2 monochrome SVG replaces emoji ──────────────────────────────────────────


# ── #1068 None/default reasoning chip stays visible ──────────────────────────


# ── #3 /reasoning immediately updates chip ────────────────────────────────────


# ── #4 /btw answer not wiped by onerror after clean close ─────────────────────


# ── #5 resize handler symmetry (non-blocking polish) ─────────────────────────
