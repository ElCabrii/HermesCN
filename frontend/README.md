# HermesCN frontend

The HermesCN web UI — a React + Vite + TypeScript + Tailwind + shadcn/ui app
that talks to the Python backend through a typed HTTP client in `src/api/`.

## Setup

Requires Node 22+ and pnpm.

```bash
pnpm install --frozen-lockfile
```

## Development

Start the Python backend first (from the repo root), then run Vite with its dev
proxy (`/api`, `/static`, `/health` → `http://127.0.0.1:8787`):

```bash
# repo root
python3 bootstrap.py

# frontend/
pnpm dev        # Vite on http://localhost:5173
```

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Vite dev server with the backend proxy |
| `pnpm build` | Type-check (`tsc -b`) then build to `dist/` |
| `pnpm lint` | Oxlint |
| `pnpm test` | Vitest unit/component tests |
| `pnpm test:watch` | Vitest watch mode |
| `pnpm test:e2e` | Playwright end-to-end tests |
| `pnpm preview` | Preview the built `dist/` |

## Architecture

- `src/api/` — typed HTTP client. The frontend talks to the backend **only**
  through this layer; do not call endpoints directly from components.
- `src/features/` — feature modules: `chat/`, `sessions/`, `workspace/`,
  `panels/` (Control Center), `terminal/`, `auth/`, `onboarding/`, `share/`.
- `src/theme/` — themes and skins.
- `src/i18n/` — locale catalogs.
- `src/components/ui/` — shadcn/ui primitives.

The Python server serves `dist/` at `/` in production. A source checkout must
build the frontend explicitly (`pnpm install --frozen-lockfile && pnpm build`);
Docker and release builds produce the assets automatically.

## Testing

- Unit/component tests run under Vitest with jsdom (`pnpm test`).
- E2E tests run under Playwright (`pnpm test:e2e`). They boot an isolated
  backend with a temporary state directory and never touch real user state.

## Parity

The upstream surface-by-surface parity status is tracked in
[`docs/FRONTEND-PARITY.md`](../docs/FRONTEND-PARITY.md).
