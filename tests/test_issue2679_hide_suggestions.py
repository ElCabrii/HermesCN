"""Regression coverage for #2679: optional hiding of empty-chat suggestions."""
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CONFIG = REPO_ROOT / "api" / "config.py"
CHANGELOG = REPO_ROOT / "CHANGELOG.md"


def test_hide_suggestions_setting_is_default_off_and_allowed():
    src = CONFIG.read_text(encoding="utf-8")
    assert '"hide_empty_state_suggestions": False' in src
    assert '"hide_empty_state_suggestions",' in src
