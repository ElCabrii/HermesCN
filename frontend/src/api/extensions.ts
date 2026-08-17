import { api } from './client'
import type { JsonObject } from './types'

/**
 * Extensions API client: extension diagnostics/status, the installable
 * gallery registry, and the toggle/install/uninstall mutations.
 *
 * Every contract below was verified against the handlers in `api/extensions.py`
 * and the routes in `api/routes.py` (and the legacy `static/panels.js` it
 * served). The extension surface is opt-in: when no extension directory is
 * configured, `getExtensionStatus()` still returns a well-formed payload with
 * `enabled: false` and an empty `extensions` array.
 */

// ── GET /api/extensions/status ─────────────────────────────────────────────

/** One manifest extension row in GET /api/extensions/status. */
export interface ExtensionStatusRow extends JsonObject {
  id: string
  name: string
  manifest_enabled: boolean
  user_enabled: boolean
  user_disabled: boolean
  effective_enabled: boolean
  can_toggle: boolean
  reload_required: boolean
  storage_owned: boolean
  settings_schema: unknown
  status: string
}

/** One gallery-installed extension record (keyed by id). */
export interface GalleryInstalledEntry extends JsonObject {
  version: string
  files: string[]
  installed_at: string
}

/** GET /api/extensions/status response. */
export interface ExtensionStatus extends JsonObject {
  enabled: boolean
  extension_dir_configured: boolean
  extension_dir_valid: boolean
  script_urls: string[]
  stylesheet_urls: string[]
  sidecars: unknown[]
  counts: {
    script_urls: number
    stylesheet_urls: number
    sidecars: number
    manifest_extensions: number
    user_disabled: number
  }
  manifest: JsonObject
  extensions: ExtensionStatusRow[]
  gallery_installed: Record<string, GalleryInstalledEntry>
  warnings: string[]
}

// ── GET /api/extensions/registry ───────────────────────────────────────────

/** One installable extension in the gallery registry. */
export interface ExtensionRegistryEntry extends JsonObject {
  id: string
  name?: string
  author?: string
  version?: string
  description?: string
  capabilities?: string[]
  permissions?: unknown
  lifecycle?: {
    restart_required?: boolean
    webui_restart_required?: boolean
    sidecar_start_required?: boolean
    native_host_start_required?: boolean
  }
  download_url?: string
  download?: string
  sha256?: string
  post_install?: string
  source?: string
}

/** GET /api/extensions/registry response. */
export interface ExtensionRegistryResponse extends JsonObject {
  entries: ExtensionRegistryEntry[]
  error?: string
}

// ── Mutations ──────────────────────────────────────────────────────────────

/** POST /api/extensions/toggle returns a fresh status snapshot. */
export type ExtensionToggleResponse = ExtensionStatus

/** POST /api/extensions/install response. */
export interface ExtensionInstallResponse extends JsonObject {
  installed: true
  id: string
  version: string
}

/** POST /api/extensions/uninstall response. */
export interface ExtensionUninstallResponse extends JsonObject {
  uninstalled: true
  id: string
}

// ── Client functions ────────────────────────────────────────────────────────

/** Fetch extension diagnostics/status (installed manifest extensions, counts). */
export function getExtensionStatus(): Promise<ExtensionStatus> {
  return api<ExtensionStatus>('/api/extensions/status', { credentials: 'include' })
}

/** Fetch the installable gallery registry (5-minute server-side TTL cache). */
export function getExtensionRegistry(): Promise<ExtensionRegistryResponse> {
  return api<ExtensionRegistryResponse>('/api/extensions/registry', { credentials: 'include' })
}

/** Set the WebUI-managed enabled override for an installed manifest extension. */
export function toggleExtension(id: string, enabled: boolean): Promise<ExtensionToggleResponse> {
  return api<ExtensionToggleResponse>('/api/extensions/toggle', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({ id, enabled }),
  })
}

/** Download, verify, and extract a gallery extension (requires its sha256). */
export function installExtension(
  id: string,
  downloadUrl: string,
  sha256: string,
): Promise<ExtensionInstallResponse> {
  return api<ExtensionInstallResponse>('/api/extensions/install', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({ id, download_url: downloadUrl, sha256 }),
  })
}

/** Remove a gallery-installed extension's files and manifest entry. */
export function uninstallExtension(id: string): Promise<ExtensionUninstallResponse> {
  return api<ExtensionUninstallResponse>('/api/extensions/uninstall', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({ id }),
  })
}
