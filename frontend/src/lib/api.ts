/**
 * Thin re-export of the canonical API client (src/api/client.ts).
 * Kept so existing imports keep working; new code should import from '@/api/client'.
 */
export { api, ApiError } from '@/api/client'
