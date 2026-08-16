import { api } from './client'

/**
 * Model catalog client for GET /api/models (routes.py `_handle_models` →
 * api/config.py `get_available_models`).
 *
 * Response shape (verified against config.py):
 * ```
 * {
 *   active_provider: string | null,
 *   default_model: string,
 *   groups: [{ provider: string, models: [{ id: string, label: string }] }]
 * }
 * ```
 */

/** One selectable model within a provider group. */
export interface CatalogModel {
  id: string
  label: string
}

/** Models offered by one provider. */
export interface ModelGroup {
  provider: string
  models: CatalogModel[]
  /** Canonical provider id (server emits it; the model picker ignores it). */
  provider_id?: string
  /**
   * Catalog overflow tail (server emits it for large provider catalogs).
   * Not rendered as picker options — only the slash autocomplete reaches it.
   */
  extra_models?: CatalogModel[]
}

/** Full /api/models response. */
export interface ModelsCatalog {
  active_provider: string | null
  default_model: string
  groups: ModelGroup[]
  /** Model alias map (config.yaml `model.aliases`), e.g. { haiku: 'anthropic/...' }. */
  aliases?: Record<string, string>
}

/** Fetch the model catalog grouped by provider. */
export function getModels(): Promise<ModelsCatalog> {
  return api<ModelsCatalog>('/api/models', { credentials: 'include' })
}
