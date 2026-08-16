"""Regression coverage for #6160: optional hiding of the full new-chat welcome panel."""
from pathlib import Path
import json
import shutil
import subprocess

REPO_ROOT = Path(__file__).resolve().parent.parent
CONFIG = REPO_ROOT / "api" / "config.py"


def test_hide_welcome_panel_setting_is_default_off_and_boolean():
    src = CONFIG.read_text(encoding="utf-8")
    assert '"hide_empty_state_panel": False' in src
    assert '"hide_empty_state_panel",' in src


def test_hide_welcome_panel_setting_persists_and_coerces_boolean(monkeypatch, tmp_path):
    import api.config as config

    settings_path = tmp_path / "settings.json"
    monkeypatch.setattr(config, "SETTINGS_FILE", settings_path)

    assert config.load_settings()["hide_empty_state_panel"] is False

    saved = config.save_settings({"hide_empty_state_panel": True})
    assert saved["hide_empty_state_panel"] is True
    assert json.loads(settings_path.read_text(encoding="utf-8"))["hide_empty_state_panel"] is True

    saved = config.save_settings({"hide_empty_state_panel": 0})
    assert saved["hide_empty_state_panel"] is False
    assert config.load_settings()["hide_empty_state_panel"] is False


def _boot_function(boot: str, name: str) -> str:
    start = boot.index(f"function {name}()")
    end = boot.index("\n}\n", start) + 2
    return boot[start:end]
