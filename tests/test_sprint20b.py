"""
Sprint 21 Tests: Send button polish — hidden until content, pop-in animation,
icon-only circle design.
"""
import re
import urllib.request

from tests._pytest_port import BASE


def get_text(path):
    with urllib.request.urlopen(BASE + path, timeout=10) as r:
        return r.read().decode(), r.status


def _find_global_selector(css, selector):
    """Find the GLOBAL (unscoped) occurrence of a selector in style.css.

    Skin-scoped rules of the form ``:root[data-skin="..."] .selector{...}``
    can appear earlier in the file than the global ``.selector{...}`` rule,
    so a naive ``css.find(".selector{")`` would match the wrong block.
    This walks every occurrence and returns the first one whose preceding
    context on the same line does NOT include ``:root[data-skin=``.

    See references/skin-scoped-css-test-trap.md.
    """
    pos = 0
    while True:
        idx = css.find(selector, pos)
        if idx == -1:
            return -1
        line_start = css.rfind('\n', 0, idx) + 1
        line_prefix = css[line_start:idx]
        # Skip skin-scoped rules. Skins use both `:root[data-skin="x"]` and the
        # dark-variant `:root.dark[data-skin="x"]` (#3164 Neon), so match the
        # `[data-skin=` marker generically rather than the bare `:root[` form.
        if '[data-skin=' not in line_prefix:
            return idx
        pos = idx + 1


# ── index.html ────────────────────────────────────────────────────────────


# ── style.css ────────────────────────────────────────────────────────────


def _extract_keyframe(css, name):
    """Extract the full @keyframes block for the given animation name."""
    # Find '@keyframes <name>' directly (forward search) to avoid hitting
    # an earlier keyframe when multiple are defined on the same line.
    kf_start = css.find('@keyframes ' + name)
    assert kf_start != -1, f"@keyframes {name} not found in CSS"
    depth = 0
    kf_end = kf_start
    for i, ch in enumerate(css[kf_start:], kf_start):
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                kf_end = i
                break
    return css[kf_start:kf_end]


# ── ui.js ─────────────────────────────────────────────────────────────────


# ── boot.js ──────────────────────────────────────────────────────────────


# ── messages.js ───────────────────────────────────────────────────────────


# ── Regression: existing behaviour unchanged ──────────────────────────────
