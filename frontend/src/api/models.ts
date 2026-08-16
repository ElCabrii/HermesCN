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
}

/** Full /api/models response. */
export interface ModelsCatalog {
  active_provider: string | null
  default_model: string
  groups: ModelGroup[]
}

/** Fetch the model catalog grouped by provider. */
export function getModels(): Promise<ModelsCatalog> {
  return api<ModelsCatalog>('/api/models', { credentials: 'include' })
}
