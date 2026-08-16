"""
Tests for issue #1038 — iOS PWA auth-expiry redirect.

When a 401 is returned by any API endpoint, the client-side JS should redirect
to login rather than showing a raw error toast. On iOS PWA standalone mode a
server-side 302→login can break out of the PWA shell into Safari, so the fix is
client-side: workspace.js api() intercepts 401 before throwing and calls a
relative login URL that also works under subpath mounts like /hermes/.

These are static regression tests that verify the JS source contains the
correct guard patterns.
"""

import re
from pathlib import Path

ROOT = Path(__file__).parent.parent
