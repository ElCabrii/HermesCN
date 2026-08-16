"""Regression tests for the Settings → Extensions diagnostics and toggles."""
from pathlib import Path
import re


ROOT = Path(__file__).parent.parent
DOCS_EXTENSIONS = (ROOT / "docs" / "EXTENSIONS.md").read_text(encoding="utf-8")
ROUTES_PY = (ROOT / "api" / "routes.py").read_text(encoding="utf-8")


def _locale_string(block: str, key: str) -> str:
    match = re.search(rf"\b{re.escape(key)}:\s*([\"'])(.*?)\1", block, re.DOTALL)
    assert match, f"{key} not found in locale block"
    return match.group(2)


def _contains_post_method(block: str) -> bool:
    """Return True when a JS block contains a method: 'POST' style mutation."""
    return bool(re.search(r"\bmethod\s*:\s*([\"'`])POST\1", block))


def test_extensions_do_not_add_generic_backend_settings_write_route():
    assert "/api/extensions/settings" not in ROUTES_PY
    assert "/api/extensions/storage" not in ROUTES_PY
    assert "set_extension_settings" not in ROUTES_PY
    assert "write_extension_settings" not in ROUTES_PY


def test_extensions_docs_mentions_settings_panel_without_install_or_proxy_claims():
    diagnostics_section = DOCS_EXTENSIONS[DOCS_EXTENSIONS.index("## Diagnostics"):]

    assert "Settings → Extensions" in diagnostics_section
    assert "`POST /api/extensions/toggle`" in diagnostics_section
    assert "WebUI-managed override" in diagnostics_section
    assert "does not edit extension" in diagnostics_section
    assert "manifests" in diagnostics_section
    assert "fetch new extension assets" in diagnostics_section
    assert "uninstall files" in diagnostics_section
    assert "GET /api/extensions/status" in diagnostics_section
    assert "`POST /api/extensions/sidecar-proxy-consent`" in diagnostics_section
    assert "sanitized loopback sidecars" in diagnostics_section
    assert "credentials: 'omit'" in diagnostics_section
    assert "fixed per-extension sidecar path" in diagnostics_section
    assert "WebUI strips `Cookie`, `Authorization`, and CSRF headers" in diagnostics_section
    assert "does not create arbitrary extension-owned backend routes" in diagnostics_section
    assert "optional top-level `runtime` object" in diagnostics_section
    assert "allowlisted scalar fields" in diagnostics_section
    assert "browser-local controls" in diagnostics_section
    assert "`window.HermesExtensionSettings`" in DOCS_EXTENSIONS
    assert "does not store extension settings or expose a generic settings write route" in DOCS_EXTENSIONS
    assert "Settings persist only non-default overrides" in DOCS_EXTENSIONS
    assert "do **not**" in diagnostics_section
    assert "return `HERMES_WEBUI_EXTENSION_DIR`" in diagnostics_section
    assert "override state-file path" in diagnostics_section
