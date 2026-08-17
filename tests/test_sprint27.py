"""
Sprint 27 Tests: configurable assistant display name (bot_name).
Tests cover settings API round-trip, empty/missing input defaults,
login page rendering, and server-side sanitization.
"""
import json
import urllib.error
import urllib.request

from tests._pytest_port import BASE


def get(path):
    with urllib.request.urlopen(BASE + path, timeout=10) as r:
        return json.loads(r.read()), r.status


def get_raw(path):
    with urllib.request.urlopen(BASE + path, timeout=10) as r:
        return r.read().decode(), r.status


def post(path, body=None):
    data = json.dumps(body or {}).encode()
    req = urllib.request.Request(BASE + path, data=data,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read()), r.status
    except urllib.error.HTTPError as e:
        return json.loads(e.read()), e.code


# ── Default value ─────────────────────────────────────────────────────────

def test_settings_default_bot_name():
    """GET /api/settings should return bot_name defaulting to 'Hermes'."""
    d, status = get("/api/settings")
    assert status == 200
    assert "bot_name" in d
    assert d["bot_name"] == "Hermes"


# ── Round-trip ────────────────────────────────────────────────────────────

def test_settings_set_bot_name():
    """POST /api/settings with bot_name should persist and round-trip."""
    try:
        d, status = post("/api/settings", {"bot_name": "TestBot"})
        assert status == 200
        assert d.get("bot_name") == "TestBot"
        d2, _ = get("/api/settings")
        assert d2.get("bot_name") == "TestBot"
    finally:
        post("/api/settings", {"bot_name": "Hermes"})


def test_settings_bot_name_special_chars():
    """bot_name with safe special characters should persist correctly."""
    try:
        d, status = post("/api/settings", {"bot_name": "My Assistant 2.0"})
        assert status == 200
        d2, _ = get("/api/settings")
        assert d2.get("bot_name") == "My Assistant 2.0"
    finally:
        post("/api/settings", {"bot_name": "Hermes"})


# ── Server-side sanitization ──────────────────────────────────────────────

def test_settings_empty_bot_name_defaults_to_hermes():
    """Posting an empty bot_name should default to 'Hermes' server-side."""
    try:
        d, status = post("/api/settings", {"bot_name": ""})
        assert status == 200
        assert d.get("bot_name") == "Hermes"
        d2, _ = get("/api/settings")
        assert d2.get("bot_name") == "Hermes"
    finally:
        post("/api/settings", {"bot_name": "Hermes"})


def test_settings_whitespace_bot_name_defaults_to_hermes():
    """Posting a whitespace-only bot_name should default to 'Hermes'."""
    try:
        d, status = post("/api/settings", {"bot_name": "   "})
        assert status == 200
        assert d.get("bot_name") == "Hermes"
    finally:
        post("/api/settings", {"bot_name": "Hermes"})


# ── Login page rendering ──────────────────────────────────────────────────

def test_login_page_is_locale_neutral_shell():
    """GET /login serves the locale-neutral React shell, not a server-rendered page.

    bot_name / locale are no longer server-rendered into the login HTML; the
    React LoginPage reads them from the API and renders client-side. So the
    shell is identical regardless of settings.language, and never contains a
    server-rendered bot-name heading. (bot_name XSS safety is now React's JSX
    escaping + the JSON API; settings persistence is covered by the
    test_settings_*_bot_name tests above.)
    """
    import urllib.error

    def _fetch():
        req = urllib.request.Request(BASE + "/login")
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return r.read().decode(), r.status
        except urllib.error.HTTPError as e:
            return e.read().decode(), e.code

    prev = get("/api/settings")[0].get("language") or "en"
    try:
        post("/api/settings", {"language": "ru"})
        html_ru, status_ru = _fetch()
        post("/api/settings", {"language": "zh-Hant"})
        html_zh, status_zh = _fetch()
    finally:
        post("/api/settings", {"language": prev})

    # Both build states are valid; the shell must not vary by language.
    assert status_ru in (200, 503) and status_zh in (200, 503)
    assert html_ru == html_zh
    assert "<h1>Hermes</h1>" not in html_ru
    assert "static/login.js" not in html_ru
    assert 'lang="zh' not in html_ru and 'lang="ru' not in html_ru
