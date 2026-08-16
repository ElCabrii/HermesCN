"""Tests for font size setting (#833) — Small/Default/Large/Extra Large in Appearance."""
import os
import re

_SRC = os.path.join(os.path.dirname(__file__), "..")

def _read(name):
    return open(os.path.join(_SRC, name), encoding="utf-8").read()








class TestFontSizeI18nCoverage:
    """All locales must include the font size i18n keys."""

    def _get_locale_keys(self, src, locale_marker_after, stop_marker):
        """Extract keys from a locale block."""
        start = src.find(locale_marker_after)
        if start < 0:
            return set()
        end = src.find(stop_marker, start)
        block = src[start:end if end > 0 else start + 20000]
        return set(re.findall(r"(\w[\w_]+):", block))

    REQUIRED_KEYS = {
        "settings_label_font_size",
        "font_size_small",
        "font_size_default",
        "font_size_large",
        "font_size_xlarge",
    }


class TestFontSizeSettingsValidation:
    """The backend settings contract must accept the persisted xlarge value."""

    def test_config_allows_extra_large_font_size(self):
        config = _read("api/config.py")
        assert '"font_size": {"small", "default", "large", "xlarge"}' in config, (
            "api/config.py must accept xlarge as a persisted font_size value"
        )
