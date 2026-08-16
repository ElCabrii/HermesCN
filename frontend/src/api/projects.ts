import { api } from './client'
import type { JsonObject } from './types'

/** One project row from GET /api/projects (extra fields allowed). */
export interface Project extends JsonObject {
  project_id: string
  name: string
  color?: string
  profile?: string
}

/**
 * Response of GET /api/projects (routes.py:~13413). `projects` is scoped to
 * the active profile unless `all_profiles` was requested; `other_profile_count`
 * reports how many rows were filtered out.
 */
export interface ProjectsResponse extends JsonObject {
  projects: Project[]
  all_profiles: boolean
  active_profile: string
  other_profile_count: number
}

/** Fetch the project catalog for project chips in the sidebar. */
export function getProjects(): Promise<ProjectsResponse> {
  return api<ProjectsResponse>('/api/projects', {
    credentials: 'include',
  })
}
