"""Regression coverage for notification clicks reusing an open WebUI tab (#4109)."""

from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
ROUTES_SRC = (ROOT / "api" / "routes.py").read_text(encoding="utf-8")


@pytest.fixture(scope="session", autouse=True)
def test_server():
    """This module only reads static source; it does not need the HTTP fixture."""
