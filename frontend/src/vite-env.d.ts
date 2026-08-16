/// <reference types="vite/client" />

/**
 * Server-injected runtime configuration.
 *
 * The Python server substitutes the __CSRF_TOKEN_JSON__ / __MAX_UPLOAD_BYTES__
 * placeholders in the served index.html (see api/routes.py `handle_get` and
 * static/index.html for the legacy convention). The api client reads
 * csrfToken from here to attach X-Hermes-CSRF-Token on unsafe requests.
 */
interface HermesConfig {
  maxUploadBytes?: number
  csrfToken?: string
}

interface Window {
  __HERMES_CONFIG__?: HermesConfig
}
