"""Tests for #1431 / PR #1433 — composer-footer toolsets chip is responsive.

The chip's responsive CSS/JS behavior now lives in the React frontend
(frontend/) and is covered by frontend tests. This file keeps only the
backend contract: the /api/session/toolsets endpoint must stay registered.
"""


def test_session_toolsets_endpoint_exists():
    """The api/session/toolsets endpoint must still be registered."""
    # Check api/routes.py for the endpoint
    try:
        with open("api/routes.py", encoding="utf-8") as f:
            src = f.read()
    except FileNotFoundError:
        # If routes.py is named differently, search
        import os
        found = False
        for root, _, files in os.walk("api"):
            for f in files:
                if f.endswith(".py"):
                    with open(os.path.join(root, f)) as fp:
                        if "session/toolsets" in fp.read():
                            found = True
                            break
            if found:
                break
        assert found, "api/session/toolsets endpoint must exist somewhere in api/"
        return
    assert "session/toolsets" in src, (
        "/api/session/toolsets endpoint must still be registered "
        "(only the visual chip is hidden, not the underlying state)"
    )
