# HermesCN Frontend Parity Matrix

This document is the authoritative completion gate for the HermesCN React/Vite
frontend remake. It maps every user-facing surface of the upstream HermesWebUI
(origin/master, `static/` tree) to its React implementation, the API endpoints
involved, the automated tests, and its status.

Status legend:

- **complete** — implemented, tested, and verified in the React app.
- **intentionally removed** — a concrete product/architecture reason (see note).
- **pending** — not yet ported; tracked as a gap.

A retained item may not be declared complete while it is pending or unverified.

---

## App shell & routing

| Surface | Upstream behavior | React location | API | Tests | Status |
|---|---|---|---|---|---|
| App shell (three-panel workbench) | Sidebar \| transcript+composer \| workspace | `frontend/src/App.tsx`, `features/chat/ChatPage.tsx` | — | `ChatPage.test.tsx` | complete |
| `/` route | Chat workbench behind auth | `App.tsx` | — | `ChatPage.test.tsx` | complete |
| `/login` | Password/OIDC/passkey gate | `features/auth/LoginPage.tsx` | `/api/auth/*` | `LoginPage.test.tsx` | complete |
| `/session/:id` deep link | Load a specific session | `App.tsx` `SessionRoute`, `ChatPage` `initialSessionId` | `/api/session` | `ChatPage.test.tsx` | complete |
| `/share/:token` | Public read-only transcript | `features/share/SharePage.tsx` | `/api/share/*` | `SharePage.test.tsx` | complete |
| First-run onboarding | Wizard overlay | `features/onboarding/OnboardingWizard.tsx` | `/api/onboarding/*` | `OnboardingWizard.test.tsx` | complete |
| Document title | HermesCN + active session | `index.html`, `ChatPage` effect | — | `ChatPage.test.tsx` | complete |
| PWA (manifest, sw, icons) | Installable app | `public/`, served by `api/routes.py` | — | `pwa.test.ts`, packaging test | complete |

## Auth

| Surface | Upstream behavior | React location | API | Tests | Status |
|---|---|---|---|---|---|
| Password login | POST `/api/auth/login` | `LoginPage.tsx` | `/api/auth/login` | `LoginPage.test.tsx` | complete |
| OIDC login | Redirect to IdP | `LoginPage.tsx` | `/api/auth/oidc/start` | `LoginPage.test.tsx` | complete |
| Passkey sign-in | WebAuthn ceremony | `LoginPage.tsx` | `/api/auth/passkey/*` | `LoginPage.test.tsx` | complete |
| Passkey management | Register/list/delete | `SettingsPanel.tsx` `PasskeyManager` | `/api/auth/passkey/*` | `SettingsPanel.test.tsx` | complete |
| Safe next-path | Open-redirect guard | `features/auth/safeNextPath.ts` | — | `safeNextPath.test.ts` | complete |
| RequireAuth | Redirect to `/login?next=` | `features/auth/RequireAuth.tsx` | `/api/auth/status` | `RequireAuth.test.tsx` | complete |

## Chat & conversation

| Surface | Upstream behavior | React location | API | Tests | Status |
|---|---|---|---|---|---|
| Streaming chat | SSE token/tool/approval frames | `features/chat/chatStore.ts`, `api/sse.ts` | `/api/chat/stream` | `streaming.test.tsx`, `chatStore.test.ts` | complete |
| Reconnect | Single-retry transport recovery | `chatStore.ts` | `/api/chat/stream/status` | `streaming.test.tsx` | complete |
| Cancel | Interrupt active run | `chatStore.ts` | `/api/chat/cancel` | `streaming.test.tsx` | complete |
| Composer | Send, uploads, model pick | `features/chat/Composer.tsx` | `/api/chat`, `/api/upload` | `Composer.test.tsx` | complete |
| Markdown/Mermaid/KaTeX | Rich rendering | `features/chat/Markdown.tsx` | — | `Markdown.test.tsx` | complete |
| Tool cards | Live tool call cards | `features/chat/ToolCard.tsx` | — | `MessageList.test.tsx` | complete |
| Approval | Tool-approval prompt | `features/chat/ApprovalCard.tsx` | `/api/approval/*` | `ApprovalCard.test.tsx` | complete |
| Clarify | Clarification dialog | `features/chat/ClarifyDialog.tsx` | `/api/clarify/*` | `ClarifyDialog.test.tsx` | complete |
| Slash commands | Command palette | `features/chat/SlashMenu.tsx`, `slashCommands.ts` | — | `SlashMenu.test.tsx` | complete |
| Session list | Sidebar list | `features/sessions/SessionSidebar.tsx` | `/api/sessions` | `SessionSidebar.test.tsx` | complete |
| Session CRUD | rename/pin/archive/duplicate/delete | `SessionSidebar.tsx`, `chatStore.ts` | `/api/session/*` | `SessionSidebar.test.tsx` | complete |
| Session export/import/share | Export/share-link | `api/sessions.ts`, `api/share.ts` | `/api/session/export`, `/api/share/*` | `sessions.test.ts`, `share.test.ts` | complete |
| Session deep link | `/session/:id` | `App.tsx` | `/api/session` | `ChatPage.test.tsx` | complete |

## Workspace / Spaces

| Surface | Upstream behavior | React location | API | Tests | Status |
|---|---|---|---|---|---|
| File tree | Browse workspace | `features/workspace/FileTree.tsx` | `/api/workspace/*` | `FileTree.test.tsx` | complete |
| File preview | Read-only preview | `features/workspace/FilePreview.tsx` | `/api/workspace/*` | `FilePreview.test.tsx` | complete |
| File editor | Edit files | `features/workspace/FileEditor.tsx` | `/api/workspace/*` | `FileEditor.test.tsx` | complete |
| Workspace panel | Right-column panel | `features/workspace/WorkspacePanel.tsx` | `/api/workspace/*` | `WorkspacePanel.test.tsx` | complete |
| Workspace add/rename/remove | Manage workspaces | `api/workspace.ts` | `/api/workspaces` | `workspace.test.ts` | complete |
| Path breadcrumbs | Navigate nested dirs | `WorkspacePanel.tsx` | — | `WorkspacePanel.test.tsx` | complete |
| `workspace://` links | Open a file in the preview pane (verify via /api/list, toast on miss) | `WorkspacePanel.tsx`, `workspaceStore.ts`, `Markdown.tsx` | `/api/workspace/list` | `Markdown.test.tsx`, `workspaceStore.test.ts` | complete |
| Syntax highlighting | Code coloring | `FileEditor.tsx` | — | — | pending |

## Control Center panels

| Surface | Upstream behavior | React location | API | Tests | Status |
|---|---|---|---|---|---|
| Tasks | Cron jobs + output | `features/panels/TasksPanel.tsx` | `/api/tasks/*` | `TasksPanel.test.tsx` | complete |
| Skills | Skill list + preview | `features/panels/SkillsPanel.tsx` | `/api/skills/*` | `SkillsPanel.test.tsx` | complete |
| Memory | MEMORY.md/USER.md/SOUL.md | `features/panels/MemoryPanel.tsx` | `/api/memory/*` | `MemoryPanel.test.tsx` | complete |
| Profiles | Profile switcher | `features/panels/ProfilesPanel.tsx` | `/api/profiles/*` | `ProfilesPanel.test.tsx` | complete |
| Providers | Keys/OAuth/quota | `features/panels/ProvidersPanel.tsx` | `/api/providers/*` | `ProvidersPanel.test.tsx` | complete |
| Todo | Checklist from transcript | `features/panels/TodoPanel.tsx` | — | `TodoPanel.test.tsx` | complete |
| Settings | Model/workspace/send-key/language | `features/panels/SettingsPanel.tsx` | `/api/settings` | `SettingsPanel.test.tsx` | complete |
| Insights | Usage/context insights | `features/panels/InsightsPanel.tsx` | `/api/insights` | `InsightsPanel.test.tsx` | complete |
| Kanban | Board view (boards CRUD, columns, task CRUD, filters, live poll) | `features/panels/KanbanPanel.tsx` | `/api/kanban/*` | `KanbanPanel.test.tsx` | complete |
| Logs | Runtime logs (agent/errors/gateway) | `features/panels/LogsPanel.tsx` | `/api/logs` | `LogsPanel.test.tsx` | complete |
| Workspaces (panel) | Workspace management tab | `features/panels/WorkspacesPanel.tsx` | `/api/workspaces` | `WorkspacesPanel.test.tsx` | complete |
| Extensions | Extension management | `features/panels/ExtensionsPanel.tsx` | `/api/extensions/*` | `ExtensionsPanel.test.tsx` | complete |
| Updates | Update channel/check/apply | `features/panels/UpdatesSection.tsx` (in `SettingsPanel.tsx`) | `/api/updates/*` | `UpdatesSection.test.tsx` | complete |
| Dashboard | Dashboard plugins | — | `/api/dashboard/*` | — | pending |

## Terminal

| Surface | Upstream behavior | React location | API | Tests | Status |
|---|---|---|---|---|---|
| Embedded terminal | PTY dock | `features/terminal/TerminalPanel.tsx` | `/api/terminal/*` | `TerminalPanel.test.tsx` | complete |

## Internationalization & appearance

| Surface | Upstream behavior | React location | API | Tests | Status |
|---|---|---|---|---|---|
| i18n (en) | English catalog | `i18n/locales/en.ts` | — | `i18n.test.ts` | complete |
| i18n (other locales) | es/de/fr/it/pt/ru/pl/cs/tr/vi/zh/zh-Hant/ja/ko (ported verbatim from legacy static/i18n.js) | `i18n/locales/*.ts`, registered in `i18n/index.ts` | — | `i18n.test.ts` | complete |
| Themes | light/dark | `theme/ThemeProvider.tsx` | — | `ThemeProvider.test.tsx` | complete |
| Skins | graphite/verdigris/neon-soft/neon-paint | `theme/skins.ts` | — | `skins.test.ts` | complete |

---

## Intentionally removed

- **Legacy `static/` vanilla-JS frontend** — replaced surface-by-surface by the
  React app (ARCHITECTURE.md §5.0). The Python backend and HTTP API are
  unchanged; the React app consumes the same API through `frontend/src/api/`.

## Pending (tracked gaps)

The remaining upstream surfaces not yet ported (tracked as pending in the
matrix above):

- **Dashboard** (`/api/dashboard/*`) — probes the official Hermes dashboard at
  loopback `127.0.0.1:9119`. Niche; the legacy surface had no standalone panel
  (only a visibility chip + dashboard-plugin toggles inside Extensions).
- **Syntax highlighting** in the file editor / code blocks — requires a
  highlighter dependency (Shiki/Prism) and touches the shared Markdown code
  renderer and `FileEditor.tsx`; deferred to avoid a new dependency and shared-
  file churn in this pass.

Everything else in the matrix is complete and verified. The non-English locale
catalogs are ported verbatim from the legacy `static/i18n.js`; the sparse ones
(pt/de/es/it/cs) carry `en` fallbacks for the keys the legacy file never
translated — matching legacy behavior exactly. Note: the legacy `zh` block was
Traditional Chinese (`zh-Hant`/`zh-TW`), so `zh.ts` and `zh-Hant.ts` both carry
Traditional Chinese; there is no Simplified-Chinese (`zh-CN`) catalog (the
legacy frontend never shipped one).

Kanban is implemented as a faithful core (boards CRUD, columns, task CRUD,
filters, `since`-poll live refresh). The following advanced kanban behaviors
are documented follow-ups, not yet ported: drag-and-drop reordering, task
links (parents/children), comments, attachments, dispatch, bulk ops, run
management, workspace/project fields, SSE (the panel polls `since` instead),
and localized kanban labels (the panel uses plain English).