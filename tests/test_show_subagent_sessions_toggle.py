"""Tests for the show_subagent_sessions sidebar toggle.

Delegated subagent child sessions (state.db ``source='subagent'``) are hidden
from the default sidebar unless ``show_subagent_sessions`` is enabled, mirroring
the existing cron/webhook/kanban background-session toggles (#2841 pattern).
"""
import pathlib

from api.models import _hide_from_default_sidebar

ROOT = pathlib.Path(__file__).parent.parent


def _read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


# --- _hide_from_default_sidebar behaviour ---

def test_subagent_hidden_by_default():
    assert _hide_from_default_sidebar({'source_tag': 'subagent', 'session_id': 'sa_abc'}) is True


def test_subagent_visible_when_show_subagent_true():
    assert _hide_from_default_sidebar(
        {'source_tag': 'subagent', 'session_id': 'sa_abc'},
        show_subagent=True,
    ) is False


def test_subagent_hidden_with_explicit_false():
    assert _hide_from_default_sidebar(
        {'source_tag': 'subagent', 'session_id': 'sa_abc'},
        show_subagent=False,
    ) is True


def test_subagent_does_not_leak_when_other_toggles_enabled():
    assert _hide_from_default_sidebar(
        {'source_tag': 'subagent', 'session_id': 'sa_abc'},
        show_cron=True,
        show_webhook=True,
        show_kanban=True,
    ) is True


def test_subagent_source_via_other_keys():
    # The source can surface through any of the canonical source fields.
    for key in ('source', 'raw_source', 'session_source'):
        assert _hide_from_default_sidebar({key: 'subagent', 'session_id': 'sa_abc'}) is True, key


def test_normal_webui_session_still_visible():
    assert _hide_from_default_sidebar({'source_tag': 'webui', 'session_id': 'w1'}) is False


# --- api/config.py string-scan ---

def test_show_subagent_sessions_in_defaults():
    src = _read("api/config.py")
    assert '"show_subagent_sessions": False' in src, (
        '"show_subagent_sessions": False must appear in _SETTINGS_DEFAULTS'
    )


def test_show_subagent_sessions_in_bool_keys():
    src = _read("api/config.py")
    assert '"show_subagent_sessions"' in src, (
        '"show_subagent_sessions" must appear in _SETTINGS_BOOL_KEYS'
    )
    # Verify it appears at least twice: once in _SETTINGS_DEFAULTS, once in _SETTINGS_BOOL_KEYS
    assert src.count('"show_subagent_sessions"') >= 2, (
        '"show_subagent_sessions" must appear in both _SETTINGS_DEFAULTS and _SETTINGS_BOOL_KEYS'
    )


# --- api/routes.py string-scan ---

def test_show_subagent_sessions_kwarg_passthrough():
    src = _read("api/routes.py")
    assert "show_subagent_sessions=show_subagent_sessions" in src, (
        "show_subagent_sessions kwarg must be forwarded at the _dedupe_cli_sidebar_sessions_for_api call site"
    )
    assert "show_subagent=show_subagent_sessions" in src, (
        "show_subagent kwarg must be forwarded to _hide_background in _dedupe_cli_sidebar_sessions_for_api"
    )


def test_show_subagent_sessions_invalidates_session_cache_on_settings_save():
    src = _read("api/routes.py")
    invalidation_block = src.split("Settings that change which sessions appear in the sidebar", 1)[1]
    invalidation_block = invalidation_block.split("auth_enabled_after", 1)[0]
    assert '"show_subagent_sessions"' in invalidation_block, (
        "settings POST must explicitly invalidate /api/sessions cache when show_subagent_sessions changes"
    )


# --- source_filter override ---

def test_subagent_source_filter_overrides_default_hide():
    """An explicit subagent source_filter is a deliberate request to view
    subagent rows, so _dedupe_cli_sidebar_sessions_for_api must reveal them
    even though show_subagent_sessions is False (mirrors cron/webhook/kanban)."""
    from api.routes import _dedupe_cli_sidebar_sessions_for_api

    subagent_row = {"session_id": "sa1", "source": "subagent", "message_count": 3}
    # Default (no filter): subagent is hidden.
    hidden = _dedupe_cli_sidebar_sessions_for_api(
        [dict(subagent_row)], set(), show_subagent_sessions=False, source_filter=None
    )
    assert not any(s["session_id"] == "sa1" for s in hidden), (
        "subagent row must be hidden by default with no source_filter"
    )
    # Explicit subagent filter: revealed despite show_subagent_sessions=False.
    revealed = _dedupe_cli_sidebar_sessions_for_api(
        [dict(subagent_row)], set(), show_subagent_sessions=False, source_filter="subagent"
    )
    assert any(s["session_id"] == "sa1" for s in revealed), (
        "explicit subagent source_filter must override the default hide"
    )
