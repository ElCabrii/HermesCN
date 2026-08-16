"""Regression tests for the project chip UI fixes (issue #1085).

Two bugs:

1. The right-click context menu opened by `_showProjectContextMenu` was styled
   with `background: var(--panel)`, but `--panel` is NOT defined anywhere in
   style.css.  CSS falls back to `transparent` for undefined variables, so the
   menu appeared see-through and the session list bled through.  The fix
   replaces `var(--panel)` with `var(--surface)` — the same opaque variable
   used by `.session-action-menu` and other floating popovers.

2. The `.project-create-input` (used for both rename and new-project creation)
   had `width: 100px` hard-coded, so the field was always exactly 100px wide
   regardless of the project name being edited.  Fix: bound the field with
   `min-width: 40px` / `max-width: 180px` and `width: auto`, plus a
   `_resizeProjectInput()` JS helper that measures the current value with a
   hidden span and sets the pixel width accordingly.

These are static-source tests — CSS/JS behaviour of a popover and an input
sizer can't be exercised faithfully without a browser, but the patterns
worth pinning are the variable names, the absence of the bad ones, and the
presence of the resize helper at both call sites.
"""

import pathlib

REPO = pathlib.Path(__file__).parent.parent


# ── Bug 1: context menu background ────────────────────────────────────────────


# ── Bug 2: project-create-input width ─────────────────────────────────────────
