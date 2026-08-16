import { atom, createStore } from 'jotai/vanilla'
import type { WorkspaceEntry } from '@/api/workspace'

/**
 * Workspace right-panel state (Task 5.2).
 *
 * Ports the legacy demand-driven panel (static/boot.js `_setWorkspacePanelMode`):
 * the panel is CLOSED by default and only opens while the user is actively
 * browsing (`browse`) or previewing a file (`preview`). Open/closed state is
 * persisted across reloads — the legacy code stored it on
 * `document.documentElement.dataset.workspacePanel`; React controls first
 * paint here, so a plain localStorage-backed Jotai atom replaces the
 * preload-marker trick.
 */

export type WorkspacePanelMode = 'closed' | 'browse' | 'preview'

export const WORKSPACE_PANEL_MODE_STORAGE_KEY = 'hermescn:workspace-panel-mode'
export const WORKSPACE_PANEL_WIDTH_STORAGE_KEY = 'hermescn:workspace-panel-width'

export const WORKSPACE_PANEL_MIN_WIDTH = 280
export const WORKSPACE_PANEL_MAX_WIDTH = 600
export const WORKSPACE_PANEL_DEFAULT_WIDTH = 360

/** Single store instance shared by every workspace feature consumer. */
export const workspaceStore = createStore()

function readStoredMode(): WorkspacePanelMode {
  try {
    const v = localStorage.getItem(WORKSPACE_PANEL_MODE_STORAGE_KEY)
    if (v === 'browse' || v === 'preview') return v
  } catch {
    /* storage unavailable — fall through to closed */
  }
  return 'closed'
}

function readStoredWidth(): number {
  try {
    const v = parseInt(localStorage.getItem(WORKSPACE_PANEL_WIDTH_STORAGE_KEY) ?? '', 10)
    if (!Number.isNaN(v)) {
      return Math.min(WORKSPACE_PANEL_MAX_WIDTH, Math.max(WORKSPACE_PANEL_MIN_WIDTH, v))
    }
  } catch {
    /* storage unavailable — fall through to default */
  }
  return WORKSPACE_PANEL_DEFAULT_WIDTH
}

export const workspacePanelModeAtom = atom<WorkspacePanelMode>(readStoredMode())
export const workspacePanelWidthAtom = atom<number>(readStoredWidth())

// Persist every write through the shared store (fires only on change).
workspaceStore.sub(workspacePanelModeAtom, () => {
  try {
    localStorage.setItem(WORKSPACE_PANEL_MODE_STORAGE_KEY, workspaceStore.get(workspacePanelModeAtom))
  } catch {
    /* storage unavailable */
  }
})
workspaceStore.sub(workspacePanelWidthAtom, () => {
  try {
    localStorage.setItem(
      WORKSPACE_PANEL_WIDTH_STORAGE_KEY,
      String(workspaceStore.get(workspacePanelWidthAtom)),
    )
  } catch {
    /* storage unavailable */
  }
})

// ── file-kind classification (legacy static/workspace.js + static/ui.js) ──

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.bmp', '.avif'])
const MD_EXTS = new Set(['.md', '.markdown', '.mdown'])
const BINARY_EXTS = new Set([
  '.pdf', '.zip', '.gz', '.tar', '.tgz', '.bz2', '.xz', '.7z', '.rar',
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.mp3', '.mp4', '.wav', '.ogg', '.oga', '.flac', '.webm', '.mov', '.avi', '.mkv', '.m4a', '.aac',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.class', '.pyc',
  '.woff', '.woff2', '.ttf', '.otf', '.eot', '.wasm',
])

export type FileKind = 'image' | 'markdown' | 'text' | 'binary'

/** Classify a workspace file path for preview routing. */
export function getFileKind(path: string): FileKind {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase()
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (MD_EXTS.has(ext)) return 'markdown'
  if (BINARY_EXTS.has(ext)) return 'binary'
  return 'text'
}

/** Icon categories mirroring the legacy `fileIcon()` mapping (static/ui.js). */
export type FileIconKind =
  | 'folder'
  | 'image'
  | 'markdown'
  | 'python'
  | 'javascript'
  | 'config'
  | 'shell'
  | 'download'
  | 'file'

export function getFileIconKind(name: string, type: WorkspaceEntry['type']): FileIconKind {
  if (type === 'dir') return 'folder'
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (MD_EXTS.has(ext)) return 'markdown'
  if (ext === '.py') return 'python'
  if (ext === '.js' || ext === '.ts' || ext === '.jsx' || ext === '.tsx') return 'javascript'
  if (ext === '.json' || ext === '.yaml' || ext === '.yml' || ext === '.toml') return 'config'
  if (ext === '.sh' || ext === '.bash') return 'shell'
  if (ext === '.pdf') return 'download'
  return 'file'
}
