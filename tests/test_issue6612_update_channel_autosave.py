"""Regression tests for issue #6612: update_channel autosave ownership.

The fix removes update_channel from the generic preferences autosave payload
(_preferencesPayloadFromUi) and gives the settingsUpdateChannel selector a
dedicated write path (_saveUpdateChannelFromSelector) that sends only
update_channel and re-syncs the selector from the confirmed server response.

Node tests execute the real JS under controlled stubs; server-side tests call
save_settings() directly. Node tests are skipped when node is not on PATH.
"""
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

# ---------------------------------------------------------------------------
# Module-scope sources and fixtures
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).parent.parent.resolve()

_REPRO_PATH = REPO_ROOT / "tests" / "fixtures" / "issue6612_update_channel_repro.json"
with _REPRO_PATH.open(encoding="utf-8") as _f:
    _REPRO = json.load(_f)

STALE_AUTOSAVE_PAYLOAD = _REPRO["stale_autosave_payload"]
EXPLICIT_CHANNEL_PAYLOADS = _REPRO["explicit_channel_payloads"]
NORMALIZATION_CASES = _REPRO["normalization_cases"]
EXPECTED_AFTER_STALE = _REPRO["expected_persisted_channel_after_stale_autosave"]
SEQUENCE = _REPRO["sequence"]

NODE = shutil.which("node")


def _run_node(source: str) -> str:
    result = subprocess.run(
        [NODE],
        input=source,
        cwd=str(REPO_ROOT),
        capture_output=True,
        encoding="utf-8",
        text=True,
        timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr or result.stdout)
    return result.stdout.strip()


def _base_panels_js() -> str:
    r = subprocess.run(
        ["git", "show", "320789ae:static/panels.js"],
        cwd=str(REPO_ROOT),
        capture_output=True,
        encoding="utf-8",
        timeout=30,
    )
    if r.returncode != 0:
        pytest.skip(f"cannot read base panels.js: {r.stderr.strip()}")
    return r.stdout


def _node_prelude(panels_src: str) -> str:
    """Embed panels_src and define extractFunc. Sets _channelSaveSeq and
    _confirmedUpdateChannel on global so the extracted async function can
    access them via indirect eval (global scope)."""
    return f"""
const panelsSrc = {panels_src!r};
function extractFunc(src, name) {{
  const re = new RegExp('(?:async\\\\s+)?function\\\\s+' + name + '\\\\s*\\\\(');
  const start = src.search(re);
  if (start < 0) throw new Error(name + ' not found in source');
  let i = src.indexOf('{{', start);
  let depth = 1; i++;
  while (depth > 0 && i < src.length) {{
    if (src[i] === '{{') depth++;
    else if (src[i] === '}}') depth--;
    i++;
  }}
  return src.slice(start, i);
}}
// Module-scope variables referenced as free variables inside the extracted functions.
global._channelSaveSeq = 0;
global._confirmedUpdateChannel = null;
global._settingsPanelPostQueue = Promise.resolve();
"""


def _preference_payload_script(panels_src: str, stale_selector_value: str = "experimental") -> str:
    """Node script that executes _preferencesPayloadFromUi() under controlled stubs.

    Stubs $() to return:
    - settingsShowTps         -> {checked: true}            (unrelated preference)
    - settingsUpdateChannel   -> {value: stale_selector}    (stale or current value)
    - all other selectors     -> null

    On base code: payload.update_channel = stale_selector_value (the bug).
    On head code: selector never read -> update_channel absent (the fix).
    """
    return _node_prelude(panels_src) + f"""
global.$ = function(id) {{
  if (id === 'settingsShowTps') return {{ checked: true }};
  if (id === 'settingsUpdateChannel') return {{ value: {json.dumps(stale_selector_value)} }};
  return null;
}};
global._speechPreferencesPayloadFromUi = function() {{ return {{}}; }};
global._preferencesPayloadFromUi = (0, eval)('(' + extractFunc(panelsSrc, '_preferencesPayloadFromUi') + ')');
const payload = _preferencesPayloadFromUi();
console.log(JSON.stringify(payload));
"""


def _function_block(src: str, name: str) -> str:
    marker = re.search(
        rf"(^|\n)(?:async\s+)?function\s+{re.escape(name)}\(", src
    )
    assert marker is not None, f"{name}() not found in panels.js"
    start = marker.start()
    next_marker = re.search(
        r"\n(?:function\s+\w+\(|async\s+function\s+\w+\()", src[start + 1:]
    )
    end = start + 1 + next_marker.start() if next_marker else len(src)
    return src[start:end]


def _channel_writer_script_prelude(panels_src: str) -> str:
    """Shared prelude for node tests that exercise _saveUpdateChannelFromSelector."""
    return _node_prelude(panels_src) + """
global._saveUpdateChannelFromSelector = (0, eval)(
  '(' + extractFunc(panelsSrc, '_saveUpdateChannelFromSelector') + ')'
);
global._enqueueSettingsPost = (0, eval)(
  '(' + extractFunc(panelsSrc, '_enqueueSettingsPost') + ')'
);
"""


# ---------------------------------------------------------------------------
# 1. Reproduction: stale tab overwrite
#    Drive the full REPRO["sequence"] step-by-step.
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# 2. Negative space: explicit channel change
# ---------------------------------------------------------------------------


def test_explicit_channel_payloads_persist(tmp_path, monkeypatch):
    """Server-side: both REPRO explicit_channel_payloads persist correctly."""
    import api.config as config
    settings_file = tmp_path / "settings.json"
    monkeypatch.setattr(config, "SETTINGS_FILE", settings_file)

    for payload in EXPLICIT_CHANNEL_PAYLOADS:
        expected = payload["update_channel"]
        result = config.save_settings(payload)
        assert result.get("update_channel") == expected, (
            f"explicit payload {payload!r} must persist {expected!r}; got {result.get('update_channel')!r}"
        )
        assert config.load_settings().get("update_channel") == expected


# ---------------------------------------------------------------------------
# 3. Unrelated preference preservation
# ---------------------------------------------------------------------------


def test_unrelated_autosave_does_not_touch_channel(tmp_path, monkeypatch):
    """Server-side: posting an unrelated preference must leave the channel unchanged."""
    import api.config as config
    settings_file = tmp_path / "settings.json"
    monkeypatch.setattr(config, "SETTINGS_FILE", settings_file)

    config.save_settings({"update_channel": "stable"})
    config.save_settings({"show_tps": True})
    assert config.load_settings().get("update_channel") == "stable"


# ---------------------------------------------------------------------------
# 4. Normalization: invalid/missing values leave the persisted channel unchanged
#    (api/config.py ignores keys whose value is not in _SETTINGS_ENUM_VALUES[k];
#     the persisted value is NOT overwritten or normalized to stable)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("case", NORMALIZATION_CASES)
def test_normalization_invalid_channel_leaves_unchanged(tmp_path, monkeypatch, case):
    """Unknown, empty, and missing update_channel values leave the persisted
    channel unchanged. Seeded to 'experimental' so that the expected value
    in each case is 'experimental' — discriminating between "left alone" and
    "overwritten" and "silently set to stable".
    """
    import api.config as config
    settings_file = tmp_path / "settings.json"
    monkeypatch.setattr(config, "SETTINGS_FILE", settings_file)

    config.save_settings({"update_channel": "experimental"})
    result = config.save_settings(case["input"])
    # invalid/missing keys are ignored by save_settings; persisted value unchanged
    assert result.get("update_channel") == case["expected"], (
        f"normalization_case {case!r}: got {result.get('update_channel')!r}"
    )


# ---------------------------------------------------------------------------
# 5. Mode and state matrix
#    stale/current tab x unrelated/explicit change x stable/experimental/invalid/missing
# ---------------------------------------------------------------------------

# (tab_kind, change_kind, channel_value, initial_persisted, expected_persisted)
#
# tab_kind:
#   "stale"   = the selector holds channel_value while the persisted state is
#               initial_persisted (set by another tab); initial != channel_value
#               for unrelated rows — the core bug scenario.
#   "current" = selector matches initial_persisted.
#
# change_kind:
#   "unrelated" = generic autosave fires; payload has no update_channel.
#                 channel_value describes what the stale/current selector holds.
#   "explicit"  = user selects channel_value; raw value sent to server.
#
# channel_value for explicit rows: "invalid" = "nightly", "missing" = send {}.
# Server ignores invalid/missing -> persisted stays at initial_persisted.

_MATRIX = [
    # stale/unrelated — the primary bug scenario and its variants
    ("stale",   "unrelated", "experimental", "stable",       "stable"),       # BUG CASE: stale:exp, persisted:stable
    ("stale",   "unrelated", "stable",       "experimental", "experimental"), # stale:stable, persisted:exp
    ("stale",   "unrelated", "invalid",      "stable",       "stable"),       # stale selector holds invalid value
    ("stale",   "unrelated", "missing",      "stable",       "stable"),       # stale selector empty
    # current/unrelated
    ("current", "unrelated", "stable",       "stable",       "stable"),
    ("current", "unrelated", "experimental", "experimental", "experimental"),
    # current/explicit — user makes a deliberate channel selection
    ("current", "explicit",  "stable",       "experimental", "stable"),       # switch to stable
    ("current", "explicit",  "experimental", "stable",       "experimental"), # switch to experimental
    ("current", "explicit",  "invalid",      "experimental", "experimental"), # 'nightly' ignored -> stays experimental
    ("current", "explicit",  "missing",      "experimental", "experimental"), # {} -> no key -> stays experimental
]


# ---------------------------------------------------------------------------
# 6. Behavioral coverage for _saveUpdateChannelFromSelector edge cases
# ---------------------------------------------------------------------------
