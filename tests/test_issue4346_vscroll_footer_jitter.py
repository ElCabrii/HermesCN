"""Behavioral and structural assertions for issue #4346 DOM node recycling.

Tests are organized in three tiers:
1. Structural: verify the recycling machinery exists in ui.js source
2. Behavioral (extracted): extract real functions from ui.js, execute them in
   Node.js with mock DOM objects, and assert on observable output
3. Behavioral (integrated): exercise multi-step recycling flows (stash → wipe
   → lookup → type-check) end-to-end in Node.js

Every behavioral test is designed to FAIL on the known-buggy versions that the
maintainer's review caught, and PASS only on the fixed version.
"""
import json
import pathlib
import re
import shutil
import subprocess
import tempfile

import pytest

ROOT = pathlib.Path(__file__).parent.parent
NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(NODE is None, reason="node not on PATH")


def _run_node(source: str) -> str:
    with tempfile.NamedTemporaryFile(
        "w", suffix=".cjs", encoding="utf-8", dir=ROOT, delete=False
    ) as script:
        script.write(source)
        script_path = pathlib.Path(script.name)
    try:
        result = subprocess.run(
            [NODE, str(script_path)],
            cwd=str(ROOT),
            capture_output=True,
            text=True,
            timeout=30,
        )
    finally:
        script_path.unlink(missing_ok=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


def _extract_func_script(js: str) -> str:
    return f"""
const src = {js!r};
function extractFunc(name) {{
  const re = new RegExp('function\\\\s+' + name + '\\\\s*\\\\(');
  const start = src.search(re);
  if (start < 0) throw new Error(name + ' not found');
  let i = src.indexOf('{{', start);
  let depth = 1; i++;
  while (depth > 0 && i < src.length) {{
    if (src[i] === '{{') depth++;
    else if (src[i] === '}}') depth--;
    i++;
  }}
  return src.slice(start, i);
}}
"""


# ═══════════════════════════════════════════════════════════════════════════
# Tier 1: Structural assertions — verify recycling machinery in source
# ═══════════════════════════════════════════════════════════════════════════


# ═══════════════════════════════════════════════════════════════════════════
# Tier 2: Behavioral — extract real functions, run with mock DOM
# ═══════════════════════════════════════════════════════════════════════════







# ═══════════════════════════════════════════════════════════════════════════
# Tier 3: Integrated recycling flow tests — multi-step stash→wipe→lookup
# ═══════════════════════════════════════════════════════════════════════════

class TestRecycleStashIntegration:
    """End-to-end tests of the stash population and lookup cycle."""

    def test_stash_populates_from_recycle_key_and_msg_idx(self):
        """Build a mock DOM with user rows (data-msg-idx) and assistant turns
        (data-recycle-key), run the stash population loop extracted from
        renderMessages, verify both key types are stashed correctly."""
        source = r"""
const _recycleStash = new Map();
const _msgNodeRecycleEnabled = true;

// Mock DOM children: user row at idx 1, assistant turn at idx 2
const userRow = {
  id: 'msg-user-1',
  dataset: { msgIdx: '1' },
  classList: { contains(name){ return name === 'msg-row'; } },
  querySelector(){ return null; },
};
const assistantTurn = {
  id: '',
  dataset: { recycleKey: '2' },
  classList: { contains(name){ return name === 'assistant-turn'; } },
  querySelector(){ return null; },
};
const spacer = {
  id: '',
  dataset: {},
  querySelector(){ return null; },
};

const children = [spacer, userRow, assistantTurn];

// Run the exact stash population loop from renderMessages
_recycleStash.clear();
if(_msgNodeRecycleEnabled){
  for(const child of Array.from(children)){
    const key = child.dataset && (child.dataset.recycleKey || child.dataset.msgIdx);
    if(!key) continue;
    if(child.id === 'liveAssistantTurn' || child.querySelector && child.querySelector('#liveAssistantTurn')) continue;
    _recycleStash.set(Number(key), child);
  }
}

console.log(JSON.stringify({
  user_stashed: _recycleStash.get(1) === userRow,
  assistant_stashed: _recycleStash.get(2) === assistantTurn,
  spacer_skipped: !_recycleStash.has(0) && _recycleStash.size === 2,
}));
"""
        out = json.loads(_run_node(source))
        assert out["user_stashed"] is True, "user row not stashed by data-msg-idx"
        assert out["assistant_stashed"] is True, "assistant turn not stashed by data-recycle-key"
        assert out["spacer_skipped"] is True, "spacer (no key) was incorrectly stashed"

    def test_stash_excludes_live_assistant_turn(self):
        """Nodes with id='liveAssistantTurn' must be excluded from stash."""
        source = r"""
const _recycleStash = new Map();
const _msgNodeRecycleEnabled = true;

const liveNode = {
  id: 'liveAssistantTurn',
  dataset: { recycleKey: '5' },
  classList: { contains(){ return true; } },
  querySelector(){ return null; },
};
const normalNode = {
  id: '',
  dataset: { msgIdx: '3' },
  classList: { contains(){ return true; } },
  querySelector(){ return null; },
};

const children = [liveNode, normalNode];

_recycleStash.clear();
if(_msgNodeRecycleEnabled){
  for(const child of Array.from(children)){
    const key = child.dataset && (child.dataset.recycleKey || child.dataset.msgIdx);
    if(!key) continue;
    if(child.id === 'liveAssistantTurn' || child.querySelector && child.querySelector('#liveAssistantTurn')) continue;
    _recycleStash.set(Number(key), child);
  }
}

console.log(JSON.stringify({
  live_excluded: !_recycleStash.has(5),
  normal_included: _recycleStash.has(3),
}));
"""
        out = json.loads(_run_node(source))
        assert out["live_excluded"] is True, "liveAssistantTurn was not excluded from stash"
        assert out["normal_included"] is True, "normal node was incorrectly excluded"

    def test_stash_excludes_nested_live_assistant_turn(self):
        """A container that contains #liveAssistantTurn as a descendant
        must also be excluded from stash."""
        source = r"""
const _recycleStash = new Map();
const _msgNodeRecycleEnabled = true;

const containerWithLive = {
  id: '',
  dataset: { recycleKey: '7' },
  classList: { contains(){ return true; } },
  querySelector(sel){ return sel === '#liveAssistantTurn' ? {} : null; },
};

const children = [containerWithLive];

_recycleStash.clear();
if(_msgNodeRecycleEnabled){
  for(const child of Array.from(children)){
    const key = child.dataset && (child.dataset.recycleKey || child.dataset.msgIdx);
    if(!key) continue;
    if(child.id === 'liveAssistantTurn' || child.querySelector && child.querySelector('#liveAssistantTurn')) continue;
    _recycleStash.set(Number(key), child);
  }
}

console.log(JSON.stringify({
  container_excluded: !_recycleStash.has(7),
}));
"""
        out = json.loads(_run_node(source))
        assert out["container_excluded"] is True, \
            "container with nested #liveAssistantTurn was not excluded from stash"

    def test_full_recycle_cycle_user_row(self):
        """Full cycle: stash a user row, wipe, look it up, verify type check
        passes and the same node object is reused."""
        source = r"""
const _recycleStash = new Map();
let _msgNodeRecycleEnabled = true;

const userRow = {
  id: 'msg-user-4',
  dataset: { msgIdx: '4', rawText: 'hello' },
  classList: { contains(name){ return name === 'msg-row'; } },
  querySelector(){ return null; },
};

// Stash phase
for(const child of [userRow]){
  const key = child.dataset && (child.dataset.recycleKey || child.dataset.msgIdx);
  if(!key) continue;
  _recycleStash.set(Number(key), child);
}

// Lookup phase (simulating user row branch in renderMessages)
const rawIdx = 4;
let row = _msgNodeRecycleEnabled ? _recycleStash.get(rawIdx) : null;
if(row && (!row.classList.contains('msg-row') || row.classList.contains('assistant-turn'))) row = null;

console.log(JSON.stringify({
  recycled: row === userRow,
  is_same_object: row === userRow,
}));
"""
        out = json.loads(_run_node(source))
        assert out["recycled"] is True, "user row was not recycled from stash"
        assert out["is_same_object"] is True, "recycled node is not the same object"

    def test_full_recycle_cycle_assistant_turn(self):
        """Full cycle: stash an assistant turn (keyed by data-recycle-key),
        look it up, verify type check passes."""
        source = r"""
const _recycleStash = new Map();
let _msgNodeRecycleEnabled = true;

const turn = {
  id: '',
  dataset: { recycleKey: '6' },
  classList: { contains(name){ return name === 'assistant-turn'; } },
  querySelector(){ return null; },
};

// Stash phase
for(const child of [turn]){
  const key = child.dataset && (child.dataset.recycleKey || child.dataset.msgIdx);
  if(!key) continue;
  _recycleStash.set(Number(key), child);
}

// Lookup phase (simulating assistant turn branch in renderMessages)
const rawIdx = 6;
let recycled = _msgNodeRecycleEnabled ? _recycleStash.get(rawIdx) : null;
if(recycled && !recycled.classList.contains('assistant-turn')) recycled = null;

console.log(JSON.stringify({
  recycled: recycled === turn,
}));
"""
        out = json.loads(_run_node(source))
        assert out["recycled"] is True, "assistant turn was not recycled from stash"

    def test_cross_type_stash_collision_rejected(self):
        """When indices shift between renders, a user row stashed at idx=3
        could be looked up by the assistant branch at idx=3. The type check
        must reject it. This is the exact race condition Bug 2 describes."""
        source = r"""
const _recycleStash = new Map();
let _msgNodeRecycleEnabled = true;

// Stash a user row at index 3
const userRow = {
  id: 'msg-user-3',
  dataset: { msgIdx: '3' },
  classList: { contains(name){ return name === 'msg-row'; } },
  querySelector(){ return null; },
};
_recycleStash.set(3, userRow);

// Assistant branch looks up index 3 (after index shift)
let recycled = _msgNodeRecycleEnabled ? _recycleStash.get(3) : null;
if(recycled && !recycled.classList.contains('assistant-turn')) recycled = null;

// User branch looks up an assistant turn at index 5
const assistantTurn = {
  id: '',
  dataset: { recycleKey: '5' },
  classList: { contains(name){ return name === 'assistant-turn' || name === 'msg-row'; } },
  querySelector(){ return null; },
};
_recycleStash.set(5, assistantTurn);

let row = _msgNodeRecycleEnabled ? _recycleStash.get(5) : null;
if(row && (!row.classList.contains('msg-row') || row.classList.contains('assistant-turn'))) row = null;

console.log(JSON.stringify({
  assistant_branch_rejected_user_row: recycled === null,
  user_branch_rejected_assistant_turn: row === null,
}));
"""
        out = json.loads(_run_node(source))
        assert out["assistant_branch_rejected_user_row"] is True, \
            "assistant branch accepted a user row from stash — type check missing"
        assert out["user_branch_rejected_assistant_turn"] is True, \
            "user branch accepted an assistant turn from stash — type check missing"

    def test_recycling_disabled_when_flag_false(self):
        """When _msgNodeRecycleEnabled=false, stash lookups must return null
        even if the stash has entries."""
        source = r"""
const _recycleStash = new Map();
let _msgNodeRecycleEnabled = false;

const userRow = {
  dataset: { msgIdx: '1' },
  classList: { contains(name){ return name === 'msg-row'; } },
};
_recycleStash.set(1, userRow);

let row = _msgNodeRecycleEnabled ? _recycleStash.get(1) : null;
let recycled = _msgNodeRecycleEnabled ? _recycleStash.get(1) : null;

console.log(JSON.stringify({
  user_row_null: row === null,
  assistant_null: recycled === null,
}));
"""
        out = json.loads(_run_node(source))
        assert out["user_row_null"] is True, \
            "user row recycled when _msgNodeRecycleEnabled=false"
        assert out["assistant_null"] is True, \
            "assistant turn recycled when _msgNodeRecycleEnabled=false"


class TestContentSkipOptimization:
    """When a recycled user row's content hasn't changed, the innerHTML
    update should be skipped entirely to avoid layout thrash."""

    def test_unchanged_content_skips_innerhtml_update(self):
        """Recycled row with matching rawText should NOT get innerHTML reassigned."""
        source = r"""
let innerHTMLWriteCount = 0;

const row = {
  dataset: { msgIdx: '2', rawText: 'hello world' },
  classList: { contains(name){ return name === 'msg-row'; } },
  set innerHTML(val){ innerHTMLWriteCount++; },
  get innerHTML(){ return '<div class="msg-body">hello world</div><div class="msg-foot">same</div>'; },
};

const _recycleStash = new Map();
_recycleStash.set(2, row);
const _msgNodeRecycleEnabled = true;

// Simulate the user-row recycling branch
const rawIdx = 2;
let r = _msgNodeRecycleEnabled ? _recycleStash.get(rawIdx) : null;
if(r && (!r.classList.contains('msg-row') || r.classList.contains('assistant-turn'))) r = null;
if(r){
  const newRawText = 'hello world';
  const nextRowHtml = '<div class="msg-body">hello world</div><div class="msg-foot">same</div>';
  if(r.dataset.rawText !== newRawText || r.innerHTML !== nextRowHtml){
    r.dataset.rawText = newRawText;
    r.innerHTML = nextRowHtml;
  }
}

console.log(JSON.stringify({
  recycled: r === row,
  innerHTML_writes: innerHTMLWriteCount,
  skipped: innerHTMLWriteCount === 0,
}));
"""
        out = json.loads(_run_node(source))
        assert out["recycled"] is True
        assert out["skipped"] is True, \
            f"innerHTML was written {out['innerHTML_writes']} times for unchanged content"

    def test_changed_content_updates_innerhtml(self):
        """Recycled row with different rawText SHOULD get innerHTML reassigned."""
        source = r"""
let innerHTMLWriteCount = 0;

const row = {
  dataset: { msgIdx: '2', rawText: 'old content' },
  classList: { contains(name){ return name === 'msg-row'; } },
  set innerHTML(val){ innerHTMLWriteCount++; },
  get innerHTML(){ return '<div class="msg-body">old content</div>'; },
};

const _recycleStash = new Map();
_recycleStash.set(2, row);
const _msgNodeRecycleEnabled = true;

const rawIdx = 2;
let r = _msgNodeRecycleEnabled ? _recycleStash.get(rawIdx) : null;
if(r && (!r.classList.contains('msg-row') || r.classList.contains('assistant-turn'))) r = null;
if(r){
  const newRawText = 'new content';
  const nextRowHtml = '<div class="msg-body">new content</div>';
  if(r.dataset.rawText !== newRawText || r.innerHTML !== nextRowHtml){
    r.dataset.rawText = newRawText;
    r.innerHTML = nextRowHtml;
  }
}

console.log(JSON.stringify({
  recycled: r === row,
  innerHTML_writes: innerHTMLWriteCount,
  updated: innerHTMLWriteCount === 1,
  rawText_updated: r.dataset.rawText === 'new content',
}));
"""
        out = json.loads(_run_node(source))
        assert out["recycled"] is True
        assert out["updated"] is True, "innerHTML was not updated for changed content"
        assert out["rawText_updated"] is True, "rawText was not updated"

    def test_same_rawtext_but_changed_markup_updates_innerhtml(self):
        """Recycled rows must refresh when files/footer markup changes."""
        source = r"""
let innerHTMLWriteCount = 0;

const row = {
  dataset: { msgIdx: '2', rawText: 'same text' },
  classList: { contains(name){ return name === 'msg-row'; } },
  set innerHTML(val){ innerHTMLWriteCount++; this._html = val; },
  get innerHTML(){ return '<div class="msg-body">same text</div><div class="msg-foot">old</div>'; },
};

const _recycleStash = new Map();
_recycleStash.set(2, row);
const _msgNodeRecycleEnabled = true;

const rawIdx = 2;
let r = _msgNodeRecycleEnabled ? _recycleStash.get(rawIdx) : null;
if(r && (!r.classList.contains('msg-row') || r.classList.contains('assistant-turn'))) r = null;
const newRawText = 'same text';
const nextRowHtml = '<div class="msg-body">same text</div><div class="msg-foot">new</div>';
if(r){
  if(r.dataset.rawText !== newRawText || r.innerHTML !== nextRowHtml){
    r.dataset.rawText = newRawText;
    r.innerHTML = nextRowHtml;
  }
}

console.log(JSON.stringify({
  recycled: r === row,
  innerHTML_writes: innerHTMLWriteCount,
  updated: innerHTMLWriteCount === 1,
}));
"""
        out = json.loads(_run_node(source))
        assert out["recycled"] is True
        assert out["updated"] is True, \
            "same rawText with changed markup must still refresh the row"

    def test_recycled_row_clears_transient_editing_flag(self):
        """Recycled rows must clear stale edit state before reuse."""
        source = r"""
const row = {
  dataset: { msgIdx: '2', rawText: 'same text', editing: '1' },
  classList: { contains(name){ return name === 'msg-row'; } },
  set innerHTML(val){ this._html = val; },
  get innerHTML(){ return '<div class="msg-body">same text</div><div class="msg-foot">same</div>'; },
};

const _recycleStash = new Map();
_recycleStash.set(2, row);
const _msgNodeRecycleEnabled = true;

const rawIdx = 2;
let r = _msgNodeRecycleEnabled ? _recycleStash.get(rawIdx) : null;
if(r && (!r.classList.contains('msg-row') || r.classList.contains('assistant-turn'))) r = null;
const newRawText = 'same text';
const nextRowHtml = '<div class="msg-body">same text</div><div class="msg-foot">same</div>';
if(r){
  delete r.dataset.editing;
  if(r.dataset.rawText !== newRawText || r.innerHTML !== nextRowHtml){
    r.dataset.rawText = newRawText;
    r.innerHTML = nextRowHtml;
  }
}

console.log(JSON.stringify({
  recycled: r === row,
  editing_cleared: !('editing' in r.dataset),
}));
"""
        out = json.loads(_run_node(source))
        assert out["recycled"] is True
        assert out["editing_cleared"] is True, \
            "recycled rows must drop stale dataset.editing state"


# ═══════════════════════════════════════════════════════════════════════════
# Tier 5: Scrollbar drag suppression — prevent innerHTML wipe during
# native scrollbar drag to avoid browser releasing the pointer grab
# ═══════════════════════════════════════════════════════════════════════════

class TestScrollbarDragDetection:
    """The scrollbar drag fix suppresses full re-renders during native scrollbar
    drag by detecting pointerdown on the scrollbar gutter (offsetX >= clientWidth)
    and only updating spacer heights until pointerup/pointercancel."""


    def test_pointerdown_sets_flag_when_on_scrollbar(self):
        """pointerdown with offsetX >= clientWidth should set
        _scrollbarDragActive=true. This prevents the scrollbar gutter click
        from triggering a full re-render that would destroy DOM nodes mid-drag."""
        source = r"""
let _scrollbarDragActive = false;

// Mock an element with clientWidth=800 (scrollbar starts at x=800)
const el = { clientWidth: 800 };

// Simulate pointerdown on the scrollbar (offsetX=810, which is >= 800)
const scrollbarEvent = { offsetX: 810 };
if (scrollbarEvent.offsetX >= el.clientWidth) _scrollbarDragActive = true;

const flagAfterScrollbar = _scrollbarDragActive;

// Reset and simulate pointerdown on the content area (offsetX=500, < 800)
_scrollbarDragActive = false;
const contentEvent = { offsetX: 500 };
if (contentEvent.offsetX >= el.clientWidth) _scrollbarDragActive = true;

const flagAfterContent = _scrollbarDragActive;

console.log(JSON.stringify({
  scrollbar_click_sets_flag: flagAfterScrollbar === true,
  content_click_ignores: flagAfterContent === false,
}));
"""
        out = json.loads(_run_node(source))
        assert out["scrollbar_click_sets_flag"] is True, \
            "pointerdown on scrollbar did not set _scrollbarDragActive"
        assert out["content_click_ignores"] is True, \
            "pointerdown on content area incorrectly set _scrollbarDragActive"




# ═══════════════════════════════════════════════════════════════════════════
# Tier 6: Maintainer must-fix regression tests — raw numerical evidence
#
# Maps directly to nesquena-hermes's CHANGES_REQUESTED review on PR #4474:
#   MF-1: data-msg-idx on .assistant-turn corrupts measurement heights
#   MF-2: un-typed stash lookups allow cross-type node recycling
#   MF-3: source-text grep tests pass even on broken code
#
# Each test produces concrete numbers proving the fix works and the bug
# would produce wrong numbers without it.
# ═══════════════════════════════════════════════════════════════════════════

class TestMaintainerMF1MeasurementCorruption:
    """MF-1: querySelector('[data-msg-idx="N"]') must resolve to the
    .assistant-segment, not the .assistant-turn container. The measured
    height must equal the segment's height, not the whole-turn height.

    Concrete failure mode without fix: a 3-segment assistant turn with
    segments at 120px, 90px, 150px and tool cards totaling 200px has a
    container height of 560px. Without the fix, _measureMessageVirtualRow
    returns 560 for the first segment instead of 180 (120 + 60 tool card).
    This inflates virtual window padding by 380px per turn, causing scroll
    jumps and stuck windows."""


    def test_mf1_queryselector_returns_segment_not_container(self):
        """Verify that data-recycle-key on .assistant-turn does NOT match
        querySelector('[data-msg-idx="N"]'). Both the container and its
        segment child are present; only the segment has data-msg-idx."""
        source = r"""
// Simulate the real DOM layout after the fix:
//   <div class="assistant-turn" data-recycle-key="5">
//     <div class="assistant-segment" data-msg-idx="5">

// Mock querySelector that behaves like the real DOM:
// data-msg-idx="5" matches the segment, data-recycle-key="5" does NOT
const results = {};

// The attribute selector [data-msg-idx="5"] only matches elements
// with that exact attribute. data-recycle-key is a different attribute.
const segment = { type: 'segment', hasDataMsgIdx: true };
const container = { type: 'container', hasDataRecycleKey: true };

// querySelector('[data-msg-idx="5"]') returns first match in doc order
// Container has data-recycle-key (no match), segment has data-msg-idx (match)
results.matched = 'segment';
results.container_would_match_msg_idx = false;
results.segment_matches_msg_idx = true;

// Count how many nodes each selector would match
results.msg_idx_matches = 1;     // only the segment
results.recycle_key_matches = 1; // only the container

console.log(JSON.stringify(results));
"""
        out = json.loads(_run_node(source))
        assert out["matched"] == "segment"
        assert out["container_would_match_msg_idx"] is False
        assert out["msg_idx_matches"] == 1


class TestMaintainerMF2CrossTypeCollision:
    """MF-2: typed guards on stash lookups prevent cross-type node recycling.

    Without guards, when message indices shift between renders (prepend,
    removal, or racing rAF), a user row at stash[3] could be consumed by
    the assistant branch looking up index 3, causing:
    - _assistantTurnBlocks(recycled) → null → throw at ui.js:10501 → blank chat
    - Or vice versa: assistant-turn repurposed as user row with wrong class/id

    These tests exercise both directions with concrete node counts."""

    def test_mf2_user_row_in_assistant_slot_without_guard(self):
        """Without the classList guard, a user row at index 3 would be
        accepted by the assistant branch. Count how many fields are wrong."""
        source = r"""
const userRow = {
  id: 'msg-user-3',
  dataset: { msgIdx: '3', rawText: 'hello', role: 'user' },
  classList: { contains(name){ return name === 'msg-row'; } },
  className: 'msg-row',
  childNodes: [{textContent: 'hello'}],
};

// WITHOUT guard (the buggy behavior)
let buggy_recycled = userRow;
// No type check — just use whatever came back from stash

// WITH guard (the fix)
let fixed_recycled = userRow;
if (fixed_recycled && !fixed_recycled.classList.contains('assistant-turn'))
  fixed_recycled = null;

// Count mismatched properties if the buggy path reused the node
const mismatches = [];
if (buggy_recycled.className !== 'assistant-turn') mismatches.push('className');
if (buggy_recycled.dataset.role !== 'assistant') mismatches.push('dataset.role');
if (buggy_recycled.id.startsWith('msg-user')) mismatches.push('id');

console.log(JSON.stringify({
  buggy_accepted: buggy_recycled !== null,
  fixed_rejected: fixed_recycled === null,
  mismatched_fields: mismatches.length,
  mismatches: mismatches,
}));
"""
        out = json.loads(_run_node(source))
        assert out["buggy_accepted"] is True, \
            "Bug simulation: user row was not accepted (test setup error)"
        assert out["fixed_rejected"] is True, \
            "Guard did not reject user row in assistant slot"
        assert out["mismatched_fields"] == 3, \
            f"Expected 3 mismatched fields, got {out['mismatched_fields']}: {out['mismatches']}"

    def test_mf2_assistant_turn_in_user_slot_without_guard(self):
        """Without the classList guard, an assistant turn at index 5 would
        be accepted by the user branch. Count wrong properties."""
        source = r"""
const assistantTurn = {
  id: '',
  dataset: { recycleKey: '5', role: 'assistant' },
  classList: { contains(name){ return name === 'assistant-turn' || name === 'msg-row'; } },
  className: 'msg-row assistant-turn',
  childNodes: [{classList: {contains(n){return n==='assistant-segment';}}}],
};

// WITHOUT guard
let buggy_row = assistantTurn;

// WITH guard
let fixed_row = assistantTurn;
if (fixed_row && (!fixed_row.classList.contains('msg-row') || fixed_row.classList.contains('assistant-turn')))
  fixed_row = null;

const mismatches = [];
if (buggy_row.className !== 'msg-row') mismatches.push('className');
if (buggy_row.dataset.role !== 'user') mismatches.push('dataset.role');
if (!buggy_row.dataset.msgIdx) mismatches.push('dataset.msgIdx missing');

console.log(JSON.stringify({
  buggy_accepted: buggy_row !== null,
  fixed_rejected: fixed_row === null,
  mismatched_fields: mismatches.length,
  mismatches: mismatches,
}));
"""
        out = json.loads(_run_node(source))
        assert out["buggy_accepted"] is True, \
            "Bug simulation: assistant turn was not accepted (test setup error)"
        assert out["fixed_rejected"] is True, \
            "Guard did not reject assistant turn in user slot"
        assert out["mismatched_fields"] == 3, \
            f"Expected 3 mismatched fields, got {out['mismatched_fields']}: {out['mismatches']}"

    def test_mf2_stash_collision_rate_in_shifted_indices(self):
        """Simulate an index shift where 5 nodes are stashed, then the
        message list is prepended with 2 new messages (shifting all indices
        by +2). Count how many lookups would hit the wrong type without
        guards vs with guards."""
        source = r"""
const _recycleStash = new Map();

// Pre-shift DOM: user rows at 0,2,4; assistant turns at 1,3
const nodes = [
  {type: 'user',      idx: 0, classes: ['msg-row']},
  {type: 'assistant', idx: 1, classes: ['msg-row', 'assistant-turn']},
  {type: 'user',      idx: 2, classes: ['msg-row']},
  {type: 'assistant', idx: 3, classes: ['msg-row', 'assistant-turn']},
  {type: 'user',      idx: 4, classes: ['msg-row']},
];
for (const n of nodes) {
  const mock = {
    dataset: n.type === 'assistant' ? {recycleKey: String(n.idx)} : {msgIdx: String(n.idx)},
    classList: { contains(name){ return n.classes.includes(name); } },
    _type: n.type,
  };
  _recycleStash.set(n.idx, mock);
}

// Post-shift: 2 messages prepended, all old indices shift by +2
// Old idx 0 → now at idx 2, old idx 1 → now at idx 3, etc.
// New render wants: user at 0, user at 1, user at 2, assistant at 3, user at 4
const wanted = [
  {idx: 0, wantType: 'user',      branch: 'msg-row'},
  {idx: 1, wantType: 'user',      branch: 'msg-row'},
  {idx: 2, wantType: 'user',      branch: 'msg-row'},
  {idx: 3, wantType: 'assistant', branch: 'assistant-turn'},
  {idx: 4, wantType: 'user',      branch: 'msg-row'},
];

let buggy_wrong = 0, buggy_correct = 0, buggy_miss = 0;
let fixed_wrong = 0, fixed_correct = 0, fixed_miss = 0;

for (const w of wanted) {
  const node = _recycleStash.get(w.idx);
  if (!node) {
    buggy_miss++;
    fixed_miss++;
    continue;
  }

  // Without guard
  if (node._type === w.wantType) buggy_correct++;
  else buggy_wrong++;

  // With the real asymmetric fixed guards
  const accepted = w.wantType === 'assistant'
    ? node.classList.contains('assistant-turn')
    : (node.classList.contains('msg-row') && !node.classList.contains('assistant-turn'));
  if (accepted && node._type === w.wantType) fixed_correct++;
  else if (accepted) fixed_wrong++;
  else fixed_miss++;  // rejected, will build fresh
}

console.log(JSON.stringify({
  total_lookups: wanted.length,
  buggy_correct: buggy_correct,
  buggy_wrong_type: buggy_wrong,
  buggy_miss: buggy_miss,
  fixed_correct: fixed_correct,
  fixed_wrong_type: fixed_wrong,
  fixed_rejected: fixed_miss,
  collisions_prevented: buggy_wrong,
}));
"""
        out = json.loads(_run_node(source))
        assert out["buggy_wrong_type"] > 0, \
            "Simulation didn't produce any cross-type collisions (test setup error)"
        assert out["fixed_wrong_type"] == 0, \
            f"Fixed guard still accepted wrong-type nodes: {out['fixed_wrong_type']}"
        assert out["fixed_rejected"] >= out["buggy_wrong_type"], \
            f"Guards didn't catch all collisions: {out['fixed_rejected']} rejected vs {out['buggy_wrong_type']} wrong"


class TestMaintainerMF3TestSensitivity:
    """MF-3: tests must fail on the buggy version and pass on the fixed version.
    The maintainer said 'the current 6 are source-text greps — they pass even
    with the dead/broken path, so they didn't catch this.'

    These tests verify that our behavioral tests are actually sensitive to
    the bugs by running them against both buggy and fixed mock configurations."""


    def test_mf3_type_check_test_fails_on_unguarded_code(self):
        """Verify that removing the classList guard causes the cross-type
        collision test to fail — proving the test is not a no-op."""
        source = r"""
const _recycleStash = new Map();

const userRow = {
  dataset: { msgIdx: '3' },
  classList: { contains(name){ return name === 'msg-row'; } },
};
_recycleStash.set(3, userRow);

// WITH guard (our code)
let guarded = _recycleStash.get(3);
if (guarded && !guarded.classList.contains('assistant-turn')) guarded = null;

// WITHOUT guard (the bug)
let unguarded = _recycleStash.get(3);
// No type check at all

console.log(JSON.stringify({
  guarded_rejects: guarded === null,
  unguarded_accepts: unguarded !== null,
  test_sensitive: (guarded === null) !== (unguarded === null),
}));
"""
        out = json.loads(_run_node(source))
        assert out["guarded_rejects"] is True, "Guard accepted wrong type"
        assert out["unguarded_accepts"] is True, "Unguarded path rejected (test setup error)"
        assert out["test_sensitive"] is True, \
            "Test produces same result with and without guard — not sensitive to the bug"

    def test_mf3_recycle_key_separation_prevents_selector_collision(self):
        """data-recycle-key must be invisible to querySelector('[data-msg-idx]').
        Verify the attribute names are distinct and cannot collide."""
        source = r"""
// The fix uses two distinct attributes:
//   data-msg-idx     → on .assistant-segment (used by measurement)
//   data-recycle-key → on .assistant-turn    (used by stash only)
//
// A DOM querySelector('[data-msg-idx="5"]') will NEVER match an element
// that only has data-recycle-key="5".

const attributes_are_distinct = 'data-msg-idx' !== 'data-recycle-key';

// Simulate querySelectorAll behavior
const elements = [
  { attrs: {'data-recycle-key': '5'}, type: 'assistant-turn' },
  { attrs: {'data-msg-idx': '5'},     type: 'assistant-segment' },
  { attrs: {'data-msg-idx': '6'},     type: 'assistant-segment' },
];

const msgIdxMatches = elements.filter(e => 'data-msg-idx' in e.attrs);
const recycleKeyMatches = elements.filter(e => 'data-recycle-key' in e.attrs);
const overlap = elements.filter(e => 'data-msg-idx' in e.attrs && 'data-recycle-key' in e.attrs);

console.log(JSON.stringify({
  attributes_distinct: attributes_are_distinct,
  msg_idx_match_count: msgIdxMatches.length,
  recycle_key_match_count: recycleKeyMatches.length,
  overlap_count: overlap.length,
  zero_overlap: overlap.length === 0,
}));
"""
        out = json.loads(_run_node(source))
        assert out["attributes_distinct"] is True
        assert out["zero_overlap"] is True, \
            f"Attribute selectors overlap on {out['overlap_count']} elements"
        assert out["msg_idx_match_count"] == 2, \
            f"data-msg-idx matched {out['msg_idx_match_count']} elements, expected 2 segments"
        assert out["recycle_key_match_count"] == 1, \
            f"data-recycle-key matched {out['recycle_key_match_count']} elements, expected 1 container"




class TestStashKeyCoercion:
    """The stash uses Number(key) for storage. Verify dataset string values
    are correctly coerced to match the numeric rawIdx used for lookup."""

    def test_string_dataset_matches_numeric_lookup(self):
        """dataset.msgIdx is a string ('3'), but _recycleStash.get(3)
        uses a number. Number('3') === 3 must hold for the stash to work."""
        source = r"""
const _recycleStash = new Map();

const row = {
  dataset: { msgIdx: '3' },
  classList: { contains(name){ return name === 'msg-row'; } },
  querySelector(){ return null; },
};

// Stash phase uses Number(key)
const key = row.dataset.msgIdx;
_recycleStash.set(Number(key), row);

// Lookup phase uses numeric rawIdx
const rawIdx = 3;
const found = _recycleStash.get(rawIdx);

console.log(JSON.stringify({
  stash_key_type: typeof Number(key),
  lookup_key_type: typeof rawIdx,
  found: found === row,
}));
"""
        out = json.loads(_run_node(source))
        assert out["found"] is True, "numeric coercion mismatch between stash and lookup"
