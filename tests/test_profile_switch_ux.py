"""
Tests for profile-switch UX improvements.

Covered behavior:
- switchToProfile() shows a spinner during the async switch and reverts on error.
- Non-visible refresh work runs after the visible switch completes.
- Session-list refreshes animate rows with row-level FLIP motion.
"""
import re
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent.resolve()
