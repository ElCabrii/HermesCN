import json
import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


def test_session_search_preview_trims_long_body_with_ellipses():
    from api.routes import _session_search_preview

    body = "Intro " + ("before " * 20) + "generated audio for the Psalm study" + (" after" * 20)
    preview = _session_search_preview(body, "Psalm", max_len=92)
    assert preview.startswith("...")
    assert preview.endswith("...")
    assert "Psalm" in preview
    assert len(preview) <= 98


def test_session_search_preview_handles_empty_or_unavailable_body():
    from api.routes import _session_search_message_text, _session_search_preview

    assert _session_search_preview("", "psalm") == ""
    assert _session_search_preview(None, "psalm") == ""
    assert _session_search_preview("No matching body", "psalm") == ""
    assert _session_search_preview("Some body", "") == ""
    assert _session_search_message_text({}) == ""
    assert _session_search_message_text({"content": [{"type": "text", "text": "Psalm body"}]}) == "Psalm body"
