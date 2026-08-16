# Agent instructions for HermesCN

HermesCN is a fork of Hermes WebUI. The Python backend is kept as-is; the
frontend is being remade in React + Vite + shadcn/ui (see ARCHITECTURE.md).

This file is the shared entry point for AI assistants working in this
repository. Keep it project-specific and safe to publish. Do not put personal
machine setup, private network details, credentials, tokens, or local-only
workflow notes here.

## Read first

Before making changes, read:

1. `README.md`
2. `CONTRIBUTING.md`
3. `docs/CONTRACTS.md`
4. `CHANGELOG.md`

For architecture, testing, or setup work, also read the matching reference:

- `ARCHITECTURE.md` for design constraints and current module layout
- `TESTING.md` for local verification commands and manual test guidance
- `docs/onboarding.md` for first-run onboarding behavior
- `docs/troubleshooting.md` for diagnostic flows
- `docs/rfcs/README.md` for larger RFCs and state/durability contracts

For UI or UX work, read `docs/UIUX-GUIDE.md` and `DESIGN.md` before
changing layout, interaction flow, themes, chat rendering, or composer chrome.
For work in `frontend/`, also read the frontend remake section of
`ARCHITECTURE.md` (Section 5.0) and follow the migration rules there.

## Frontend remake (HermesCN)

The frontend is being remade in React + Vite + shadcn/ui while the Python
backend stays unchanged. Target layout and rules:

- `frontend/` is the new app; the Python backend stays at the repo root.
  No Turborepo: there is a single JS package and a Python app it cannot
  orchestrate.
- Seam: the existing HTTP API (SSE streaming included) is the contract. The
  frontend consumes it through a hand-written typed client in
  `frontend/src/api/`, grown per migrated surface. No tRPC (requires a TS
  backend).
- Dev: the Vite dev server proxies `/api` and `/static` to the Python server
  (default http://127.0.0.1:8787).
- Prod: the Python server serves `frontend/dist/` instead of `static/` once
  parity is reached; until then `static/` remains the fallback.
- Migration is surface-by-surface (login → chat → sessions → workspace →
  panels). Each migrated surface replaces its `static/` counterpart and its
  frontend-coupled pytest tests; new frontend tests live in `frontend/`
  (Vitest + Playwright).
- Backend changes during the remake are limited to what the frontend strictly
  needs (e.g. serving `dist/`). The Python test suite must keep passing.

## Onboarding and reinstall support

If the task involves install, reinstall, bootstrap, first-run onboarding,
provider setup, local model server setup, Docker onboarding, WSL onboarding, or
support for a failed first run, read `docs/onboarding-agent-checklist.md`
before running commands or inspecting logs.

Follow that checklist's safety rules:

- use isolated `HERMES_HOME` and `HERMES_WEBUI_STATE_DIR` for trials unless the
  human explicitly asks to use real state
- do not delete or overwrite a real `~/.hermes` directory without explicit
  approval
- do not print API keys, OAuth tokens, cookies, full `.env` files, full
  `auth.json` files, or password hashes
- collect non-secret status and log evidence before recommending a fix

## Contribution style

- Keep one logical change per PR; split unrelated refactors or cleanup.
- Read `docs/CONTRACTS.md` and the linked contract/RFC for the touched
  subsystem before editing.
- For local pytest runs, use `./scripts/test.sh` instead of bare `python3`,
  `python -m pytest`, or `pytest`. The script creates/uses the repo `.venv`,
  pins execution to Python 3.11-3.13, and installs missing dev test dependencies.
  `HERMES_WEBUI_TEST_PYTHON` selects the supported base interpreter used to
  create or rebuild `.venv`; it must not install test dependencies into a
  system/Homebrew interpreter directly.
  If a direct pytest invocation reports an unsupported interpreter, rerun through
  `./scripts/test.sh` before debugging product code.
- The Python backend (server.py, api/, tests/) is the stable core and stays
  Python at the repo root. Do not port it to TypeScript or move it.
- New frontend work goes in `frontend/` (React + Vite + TypeScript + Tailwind +
  shadcn/ui). `static/` is the legacy vanilla-JS frontend: frozen except for
  critical bug fixes, and removed surface-by-surface as `frontend/` reaches
  parity. Do not add new features to `static/`.
- The HTTP API is the contract between the two. Frontend code talks to it only
  through the typed client in `frontend/src/api/`; do not change API behavior
  without updating that client and the affected backend tests.
- Update docs when changing setup, onboarding, runtime behavior, architecture,
  testing guidance, or user-facing workflows.
- Do not edit `CHANGELOG.md` in ordinary contributor PRs. The release workflow
  owns changelog updates through release commits. If a change is release-note
  worthy, include concise release-note wording in the PR body instead.
- For UI or UX changes, include before/after evidence and test relevant
  desktop, narrow, and mobile states.
- For behavior changes, add or update automated tests where practical and list
  the manual verification performed.
- For runtime, streaming, recovery, replay, compression, or sidebar metadata
  changes, name the state layer being mutated and prove the relevant invariant.
- For Docker build changes in `docker_init.bash`, mirror directory exclusions
  in both the `rsync` and `cp -a` paths — `/opt/hermes` may contain subdirectories
  with restricted permissions (e.g. `.playwright/`).

## Before you open a PR — the change guidelines

Read [`docs/GUIDELINES.md`](docs/GUIDELINES.md) in full before non-trivial work. It is the
distilled set of habits that get a change merged in one review round instead of several. The
compressed form:

1. **Fix the class, not the instance.** A bug usually has siblings — other call sites, backends,
   companion endpoints, layouts, exit paths. Find them all and fix the shared chokepoint, or name
   the ones you left out of scope.
2. **Trace one authoritative value end-to-end** (`input → normalize → decision → action → persist →
   cleanup`); the code that *decides* and the code that *acts* must use the same resolved value.
3. **When you can't confirm something, fail closed and say so.** Never take the permissive branch on
   uncertainty; never report a failure as success. "Unknown" is not "allowed."
4. **Enumerate the state-space before editing** — entry point, backend, item count (0/1/many), every
   lifecycle exit (success/error/cancel/replace/teardown), auth on/off, concurrency, hostile input —
   and cover each or mark it out of scope. Most redo rounds are one un-considered dimension.
5. **Assume inputs and check-then-use gaps are adversarial** — validate at the point of use (hold a
   handle, don't re-resolve a path), scope caches by complete identity, handle crafted input.
6. **A test must fail before your fix and pass after it.** Assert observable behavior, not a source
   string or a mock of the thing under test; use multiple items if selection is what's being tested.
7. **Name the owner of every piece of state and prove it's released on every exit** (success, error,
   cancel, replace, shrink, teardown) — not just the happy path.
8. **Fallbacks/defaults are contracts — extend the mechanism, don't copy it.** Editing N parallel
   blocks identically means you missed a chokepoint (e.g. new copy goes in the `en` locale only).
9. **The diff is the task and nothing else.** Extras go in the PR description, not the diff; run the
   affected + neighboring tests before opening.
10. **A visible control costs attention on every visit** — place it by frequency of use and by where
    mainstream chat apps put the equivalent, not by where your diff already is; verify with
    before/after images at desktop and narrow widths.

Show the work in the PR body: the siblings you found, proof the test failed before the fix, the
verification run, before/after images for visible changes, and an explicit list of what you could
not verify.

## Local state and secrets

Hermes WebUI can read and write real agent state, sessions, workspaces,
credentials, and cron data. Treat local validation as potentially destructive
unless you have confirmed the active state directories.

Prefer isolated trial state for experiments:

```bash
HERMES_HOME=/tmp/hermes-webui-agent-home \
HERMES_WEBUI_STATE_DIR=/tmp/hermes-webui-agent-state \
HERMES_WEBUI_PORT=8789 \
python3 bootstrap.py
```

Do not include private machine instructions in this tracked file. Use a
git-ignored local note for personal workflow details.

## Skills (mandatory)

Before replying, scan the skills below. If a skill matches or is even partially
relevant to your task, you MUST load it with skill_view(name) and follow its
instructions. Err on the side of loading — it is always better to have context
you don't need than to miss critical steps, pitfalls, or established workflows.
Skills contain specialized knowledge — API endpoints, tool-specific commands,
and proven workflows that outperform general-purpose approaches. Load the skill
even if you think you could handle the task with basic tools like web_search or
terminal. Skills also encode the user's preferred approach, conventions, and
quality standards for tasks like code review, planning, and testing — load them
even for tasks you already know how to do, because the skill defines how it
should be done here.
Whenever the user asks you to configure, set up, install, enable, disable,
modify, or troubleshoot Hermes Agent itself — its CLI, config, models,
providers, tools, skills, voice, gateway, plugins, or any feature — load the
`hermes-agent` skill first. It has the actual commands (e.g. `hermes config set
…`, `hermes tools`, `hermes setup`) so you don't have to guess or invent
workarounds.
If a skill has issues, fix it with skill_manage(action='patch').
After difficult/iterative tasks, offer to save as a skill. If a skill you loaded
was missing steps, had wrong commands, or needed pitfalls you discovered, update
it before finishing.
