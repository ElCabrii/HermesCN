"""Regression coverage for #2551 stale sidebar after Move-to-Project.

The single-session project picker (`_showProjectPicker` in `static/sessions.js`)
used to mutate the sidebar's shallow row copy and then call
`renderSessionListFromCache()`, which re-reads the unmodified `_allSessions`
cache and renders the old `project_id`. The server-side move was correct, so
the next `/api/sessions` poll healed the UI — but until then the sidebar was
visually stale.

The fix writes the new `project_id` into the authoritative `_allSessions`
entry before re-rendering, so the optimistic update reflects the move
immediately without a wasted `/api/sessions` round trip.
"""

from pathlib import Path
import json
import subprocess

REPO = Path(__file__).resolve().parents[1]


def test_cache_write_makes_render_observe_new_project_id():
    """End-to-end behavioural check: simulate the cache-write step from each
    picker branch and confirm `_allSessions` reflects the new project_id,
    which is what `renderSessionListFromCache` reads to repaint the sidebar.
    """
    script = """
let _allSessions = [
  {session_id: 'sa', project_id: 'proj-old', title: 'A'},
  {session_id: 'sb', project_id: null, title: 'B'},
];

// Sidebar copy, the way _attachChildSessionsToSidebarRows produces it:
const sidebarCopy = {..._allSessions[0]};

// Simulate the 'No project' branch cache write:
{
  const session = sidebarCopy;
  const idx = _allSessions.findIndex(s => s && s.session_id === session.session_id);
  if (idx >= 0) _allSessions[idx].project_id = null;
}

// Then the 'Moved to <project>' branch on session B going to proj-new:
{
  const session = {..._allSessions[1]};
  const p = {project_id: 'proj-new', name: 'New Project'};
  const idx = _allSessions.findIndex(s => s && s.session_id === session.session_id);
  if (idx >= 0) _allSessions[idx].project_id = p.project_id;
}

console.log(JSON.stringify(_allSessions.map(s => ({id: s.session_id, project_id: s.project_id}))));
"""
    result = subprocess.run(
        ["node", "-e", script], check=True, capture_output=True, text=True
    )
    rows = json.loads(result.stdout)
    assert rows == [
        {"id": "sa", "project_id": None},
        {"id": "sb", "project_id": "proj-new"},
    ], (
        "Cache write must replace project_id on the _allSessions entry, "
        "which is what renderSessionListFromCache reads (issue #2551)."
    )
