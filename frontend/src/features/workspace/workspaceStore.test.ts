import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  WORKSPACE_PANEL_DEFAULT_WIDTH,
  WORKSPACE_PANEL_MAX_WIDTH,
  WORKSPACE_PANEL_MIN_WIDTH,
  WORKSPACE_PANEL_MODE_STORAGE_KEY,
  WORKSPACE_PANEL_WIDTH_STORAGE_KEY,
  consumeOpenFileRequest,
  getFileIconKind,
  getFileKind,
  openFileRequestAtom,
  parseWorkspaceHref,
  requestOpenWorkspaceFile,
  workspacePanelModeAtom,
  workspacePanelWidthAtom,
  workspaceStore,
} from './workspaceStore'

beforeEach(() => {
  localStorage.clear()
  // Reset atoms so tests never leak mode/width across cases.
  workspaceStore.set(workspacePanelModeAtom, 'closed')
  workspaceStore.set(workspacePanelWidthAtom, WORKSPACE_PANEL_DEFAULT_WIDTH)
})

describe('workspaceStore — panel mode', () => {
  it('defaults to closed', () => {
    expect(workspaceStore.get(workspacePanelModeAtom)).toBe('closed')
  })

  it('persists every mode change to localStorage', () => {
    workspaceStore.set(workspacePanelModeAtom, 'browse')
    expect(localStorage.getItem(WORKSPACE_PANEL_MODE_STORAGE_KEY)).toBe('browse')
    workspaceStore.set(workspacePanelModeAtom, 'preview')
    expect(localStorage.getItem(WORKSPACE_PANEL_MODE_STORAGE_KEY)).toBe('preview')
    workspaceStore.set(workspacePanelModeAtom, 'closed')
    expect(localStorage.getItem(WORKSPACE_PANEL_MODE_STORAGE_KEY)).toBe('closed')
  })

  it('restores a persisted mode when the module loads (demand-driven reopen)', async () => {
    localStorage.setItem(WORKSPACE_PANEL_MODE_STORAGE_KEY, 'preview')
    vi.resetModules()
    const fresh = await import('./workspaceStore')
    expect(fresh.workspaceStore.get(fresh.workspacePanelModeAtom)).toBe('preview')
  })

  it('treats an unknown persisted value as closed', async () => {
    localStorage.setItem(WORKSPACE_PANEL_MODE_STORAGE_KEY, 'sideways')
    vi.resetModules()
    const fresh = await import('./workspaceStore')
    expect(fresh.workspaceStore.get(fresh.workspacePanelModeAtom)).toBe('closed')
  })
})

describe('workspaceStore — panel width', () => {
  it('defaults to the standard width', () => {
    expect(workspaceStore.get(workspacePanelWidthAtom)).toBe(WORKSPACE_PANEL_DEFAULT_WIDTH)
  })

  it('persists width changes to localStorage', () => {
    workspaceStore.set(workspacePanelWidthAtom, 420)
    expect(localStorage.getItem(WORKSPACE_PANEL_WIDTH_STORAGE_KEY)).toBe('420')
  })

  it('clamps stored widths to the 280–600px range', async () => {
    localStorage.setItem(WORKSPACE_PANEL_WIDTH_STORAGE_KEY, '9999')
    vi.resetModules()
    const fresh = await import('./workspaceStore')
    expect(fresh.workspaceStore.get(fresh.workspacePanelWidthAtom)).toBe(WORKSPACE_PANEL_MAX_WIDTH)

    localStorage.setItem(WORKSPACE_PANEL_WIDTH_STORAGE_KEY, '10')
    vi.resetModules()
    const fresh2 = await import('./workspaceStore')
    expect(fresh2.workspaceStore.get(fresh2.workspacePanelWidthAtom)).toBe(WORKSPACE_PANEL_MIN_WIDTH)
  })
})

describe('workspaceStore — file kind helpers', () => {
  it('classifies image extensions', () => {
    for (const p of ['img/hero.png', 'a.jpg', 'b.jpeg', 'c.gif', 'd.svg', 'e.webp', 'f.ico', 'g.bmp', 'h.avif']) {
      expect(getFileKind(p)).toBe('image')
    }
  })

  it('classifies markdown extensions', () => {
    expect(getFileKind('README.md')).toBe('markdown')
    expect(getFileKind('docs/guide.markdown')).toBe('markdown')
    expect(getFileKind('notes.mdown')).toBe('markdown')
  })

  it('classifies known binary extensions', () => {
    for (const p of ['docs/report.pdf', 'a.zip', 'b.gz', 'c.tar', 'd.docx', 'e.xlsx', 'f.mp3', 'g.mp4', 'h.woff2', 'i.pyc']) {
      expect(getFileKind(p)).toBe('binary')
    }
  })

  it('defaults everything else to text', () => {
    expect(getFileKind('src/app.py')).toBe('text')
    expect(getFileKind('notes.txt')).toBe('text')
    expect(getFileKind('Makefile')).toBe('text')
    expect(getFileKind('file.with.unknown.ext')).toBe('text')
  })

  it('is case-insensitive', () => {
    expect(getFileKind('IMG/PHOTO.PNG')).toBe('image')
    expect(getFileKind('README.MD')).toBe('markdown')
  })
})

describe('workspaceStore — file icon mapping (legacy port)', () => {
  it('maps folders, images, markdown, code, config, shell, and downloads', () => {
    expect(getFileIconKind('src', 'dir')).toBe('folder')
    expect(getFileIconKind('hero.png', 'file')).toBe('image')
    expect(getFileIconKind('README.md', 'file')).toBe('markdown')
    expect(getFileIconKind('app.py', 'file')).toBe('python')
    expect(getFileIconKind('app.js', 'file')).toBe('javascript')
    expect(getFileIconKind('app.ts', 'file')).toBe('javascript')
    expect(getFileIconKind('app.tsx', 'file')).toBe('javascript')
    expect(getFileIconKind('package.json', 'file')).toBe('config')
    expect(getFileIconKind('config.yaml', 'file')).toBe('config')
    expect(getFileIconKind('run.sh', 'file')).toBe('shell')
    expect(getFileIconKind('report.pdf', 'file')).toBe('download')
  })

  it('falls back to a generic file icon', () => {
    expect(getFileIconKind('LICENSE', 'file')).toBe('file')
    expect(getFileIconKind('link', 'symlink')).toBe('file')
  })
})

describe('workspaceStore — workspace:// deep links', () => {
  beforeEach(() => {
    localStorage.clear()
    workspaceStore.set(workspacePanelModeAtom, 'closed')
    workspaceStore.set(openFileRequestAtom, null)
  })

  it('parseWorkspaceHref extracts the relative path and strips ~​/ and ./ prefixes', () => {
    expect(parseWorkspaceHref('workspace://docs/report.md')).toBe('docs/report.md')
    expect(parseWorkspaceHref('workspace://~/src/a.ts')).toBe('src/a.ts')
    expect(parseWorkspaceHref('workspace://./main.py')).toBe('main.py')
    expect(parseWorkspaceHref('WORKSPACE://a/b.txt')).toBe('a/b.txt')
  })

  it('parseWorkspaceHref returns null for non-workspace hrefs or empty paths', () => {
    expect(parseWorkspaceHref('https://example.com')).toBeNull()
    expect(parseWorkspaceHref('workspace://')).toBeNull()
    expect(parseWorkspaceHref('not a url')).toBeNull()
  })

  it('requestOpenWorkspaceFile opens the panel to preview and queues the request', () => {
    requestOpenWorkspaceFile('docs/report.md')
    expect(workspaceStore.get(workspacePanelModeAtom)).toBe('preview')
    const req = workspaceStore.get(openFileRequestAtom)
    expect(req).not.toBeNull()
    expect(req?.path).toBe('docs/report.md')
    expect(typeof req?.nonce).toBe('number')
  })

  it('consumeOpenFileRequest returns and clears the pending request (one-shot)', () => {
    requestOpenWorkspaceFile('a/b.ts')
    const first = consumeOpenFileRequest()
    expect(first?.path).toBe('a/b.ts')
    expect(workspaceStore.get(openFileRequestAtom)).toBeNull()
    // A second consume returns nothing.
    expect(consumeOpenFileRequest()).toBeNull()
  })
})
