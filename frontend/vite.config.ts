import { defineConfig, configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import type { Plugin, ProxyOptions } from 'vite'

/**
 * Dev-mode substitute for the Python server's index.html placeholder pass.
 *
 * `api/routes.py` rewrites `__MAX_UPLOAD_BYTES__` and `__CSRF_TOKEN_JSON__`
 * before serving the shell. Vite does not — the same `index.html` is loaded
 * verbatim — which throws `ReferenceError: __MAX_UPLOAD_BYTES__ is not
 * defined` on every dev page load. This plugin performs the same substitution
 * against the file Vite is about to serve, using a safe upper bound for the
 * upload cap (the real number is enforced by the backend; this only needs to
 * be non-undefined so the inline script runs) and an empty CSRF token (the
 * backend cookie/header pair handles dev auth when it is enabled).
 */
const DEV_MAX_UPLOAD_BYTES = '104857600' // 100 MiB placeholder; backend enforces the real cap.
const DEV_CSRF_TOKEN_JSON = '""'

function hermesIndexShellPlugin(): Plugin {
  return {
    name: 'hermes-index-shell',
    // Run in both serve and build so the built dist/ matches what the Python
    // server would otherwise produce (the server still overrides these values
    // at request time in production, but a `pnpm preview` against the built
    // shell must not throw).
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return html
          .replace(/__MAX_UPLOAD_BYTES__/g, DEV_MAX_UPLOAD_BYTES)
          .replace(/__CSRF_TOKEN_JSON__/g, DEV_CSRF_TOKEN_JSON)
      },
    },
  }
}

/**
 * Dev proxy to the Python backend.
 *
 * The target is configurable (HERMES_WEBUI_PROXY_TARGET) so the Playwright E2E
 * suite can point at an isolated backend on a non-default port with a temporary
 * state directory.
 *
 * `changeOrigin` rewrites Host but NOT Origin, so every request still announced
 * itself as coming from the Vite dev server. The backend's CSRF check compares
 * the two and rejected the mismatch, which made every write — new conversation,
 * send, rename, delete, settings — fail with 403 "Cross-origin mismatch" in
 * `pnpm dev`. Rewriting Origin to the target restores same-origin semantics,
 * which is exactly what the proxy is pretending to provide.
 */
function devProxy(): ProxyOptions {
  const target = process.env.HERMES_WEBUI_PROXY_TARGET || 'http://127.0.0.1:8787'
  return {
    target,
    changeOrigin: true,
    configure(proxy) {
      proxy.on('proxyReq', (proxyReq) => {
        proxyReq.setHeader('origin', target)
        proxyReq.setHeader('referer', `${target}/`)
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), hermesIndexShellPlugin()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // Bundle budget: the initial path is ~370 KB (gzip ~118 KB) after lazy-
    // loading the Control Center, terminal, and onboarding. The only chunk
    // above this limit is the lazy-loaded mermaid/cytoscape dependency, which
    // is fetched only when a Mermaid diagram renders — never on initial load.
    // Raise this only with a documented reason; it is an enforceable budget.
    chunkSizeWarningLimit: 700,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': devProxy(),
      '/static': devProxy(),
      '/health': devProxy(),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    css: true,
    exclude: [...configDefaults.exclude, 'e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Thresholds set from measured coverage (2026-08-16: statements 81.6%,
      // branches 67.5%, functions 82.1%, lines 84.4%). They are meaningful
      // gates, not artificial — raise them as coverage improves.
      thresholds: {
        statements: 75,
        branches: 60,
        functions: 75,
        lines: 78,
      },
    },
  },
})
