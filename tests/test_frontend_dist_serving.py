"""Task 8.4 — the Python server must serve frontend/dist/ when a build exists.

Contract:
- When frontend/dist/index.html exists, GET / (and /index.html) serves it
  with the same per-request substitutions as the legacy shell
  (__WEBUI_VERSION__, __MAX_UPLOAD_BYTES__, __CSRF_TOKEN_JSON__).
- GET /assets/* serves hashed build assets from frontend/dist/assets/ with
  the same sandbox + per-file cache + ETag behavior as /static/*.
- When frontend/dist is absent, the legacy static/ behavior is unchanged.
- /assets/* is auth-exempt like /static/* (assets are referenced by the
  pre-auth login page and the public shell).

dist/ is gitignored and may or may not exist in a checkout; the fixtures
below materialize a minimal fake build and restore the previous state (real
build included) on teardown, so the tests are safe to run either way.
"""
from __future__ import annotations

import shutil
from pathlib import Path
from types import SimpleNamespace

import pytest

import api.routes as routes

ROOT = Path(__file__).resolve().parent.parent
DIST_DIR = ROOT / "frontend" / "dist"
DIST_INDEX = DIST_DIR / "index.html"
DIST_ASSETS = DIST_DIR / "assets"
DIST_FAKE_JS = DIST_ASSETS / "app.js"

DIST_INDEX_BYTES = (
    b"<html>dist-index __WEBUI_VERSION__ __MAX_UPLOAD_BYTES__ "
    b"csrfToken:__CSRF_TOKEN_JSON__</html>"
)
DIST_FAKE_JS_BYTES = b"console.log('dist app');\n"


class _FakeHandler:
    def __init__(self, request_headers=None):
        self.status = None
        self.sent_headers = []
        self.body = bytearray()
        self.headers = dict(request_headers or {})
        self.wfile = self

    def send_response(self, status):
        self.status = status

    def send_header(self, name, value):
        self.sent_headers.append((name, value))

    def end_headers(self):
        pass

    def write(self, data):
        self.body.extend(data)

    def header(self, name):
        for key, value in self.sent_headers:
            if key.lower() == name.lower():
                return value
        return None


def _get(path, request_headers=None):
    handler = _FakeHandler(request_headers)
    routes.handle_get(handler, SimpleNamespace(path=path, query=""))
    return handler


@pytest.fixture
def fake_dist(monkeypatch):
    """Materialize a minimal fake frontend/dist build, restoring the prior
    state (including a real build if one exists) on teardown."""
    DIST_ASSETS.mkdir(parents=True, exist_ok=True)
    restored = []
    created = []
    for path in (DIST_INDEX, DIST_FAKE_JS):
        if path.exists():
            backup = path.with_name(path.name + ".bak")
            shutil.move(str(path), str(backup))
            restored.append((path, backup))
        else:
            created.append(path)
    DIST_INDEX.write_bytes(DIST_INDEX_BYTES)
    DIST_FAKE_JS.write_bytes(DIST_FAKE_JS_BYTES)
    # The shell-template and static caches key on (path, size, mtime); reset
    # them so the fake build is served instead of stale entries.
    monkeypatch.setattr(routes, "_INDEX_SHELL_CACHE", {})
    monkeypatch.setattr(routes, "_STATIC_CACHE", {})
    yield
    for path, backup in restored:
        shutil.move(str(backup), str(path))
    for path in created:
        path.unlink(missing_ok=True)
    for directory in (DIST_ASSETS, DIST_DIR):
        try:
            directory.rmdir()
        except OSError:
            pass


@pytest.fixture
def no_dist(monkeypatch):
    """Temporarily hide frontend/dist (real build included) to exercise the
    legacy static/ fallback."""
    if not DIST_DIR.exists():
        yield
        return
    backup = DIST_DIR.with_name("dist.testbak")
    shutil.move(str(DIST_DIR), str(backup))
    monkeypatch.setattr(routes, "_INDEX_SHELL_CACHE", {})
    monkeypatch.setattr(routes, "_STATIC_CACHE", {})
    try:
        yield
    finally:
        shutil.move(str(backup), str(DIST_DIR))


def test_dist_index_served_with_token_substitution(fake_dist):
    handler = _get("/")
    assert handler.status == 200
    assert handler.header("Content-Type") == "text/html; charset=utf-8"
    body = bytes(handler.body).decode("utf-8")
    assert "dist-index" in body
    # Process-constant tokens are substituted by _render_index_shell_base...
    assert "__WEBUI_VERSION__" not in body
    assert "__MAX_UPLOAD_BYTES__" not in body
    # ...and the per-request CSRF token is substituted by the / branch.
    assert "__CSRF_TOKEN_JSON__" not in body
    assert 'csrfToken:""' in body


def test_dist_index_served_on_index_html_path(fake_dist):
    handler = _get("/index.html")
    assert handler.status == 200
    assert "dist-index" in bytes(handler.body).decode("utf-8")


def test_dist_asset_served_with_mime_and_etag(fake_dist):
    handler = _get("/assets/app.js")
    assert handler.status == 200
    assert handler.header("Content-Type") == "application/javascript; charset=utf-8"
    assert bytes(handler.body) == DIST_FAKE_JS_BYTES
    etag = handler.header("ETag")
    assert etag and etag.startswith('W/"')


def test_dist_asset_304_on_matching_etag(fake_dist):
    first = _get("/assets/app.js")
    etag = first.header("ETag")
    assert etag
    second = _get("/assets/app.js", request_headers={"If-None-Match": etag})
    assert second.status == 304
    assert second.header("ETag") == etag


def test_dist_asset_path_traversal_blocked(fake_dist):
    handler = _get("/assets/../api/routes.py")
    assert handler.status == 404


def test_legacy_fallback_when_dist_absent(no_dist):
    handler = _get("/")
    assert handler.status == 200
    body = bytes(handler.body).decode("utf-8")
    assert "dist-index" not in body
    assert "pwa-startup" in body  # legacy shell marker

    missing = _get("/assets/app.js")
    assert missing.status == 404


def test_dist_assets_auth_exempt(monkeypatch):
    monkeypatch.setenv("HERMES_WEBUI_PASSWORD", "test-password")

    from api.auth import check_auth, _invalidate_password_hash_cache

    _invalidate_password_hash_cache()
    handler = _FakeHandler()
    assert check_auth(handler, SimpleNamespace(path="/assets/app.js", query="")) is True
    # /static/ baseline still exempt (regression guard)
    handler = _FakeHandler()
    assert check_auth(handler, SimpleNamespace(path="/static/style.css", query="")) is True
