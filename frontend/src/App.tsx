import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router'
import { lazy, Suspense } from 'react'
import { LoginPage } from '@/features/auth/LoginPage'
import { RequireAuth } from '@/features/auth/RequireAuth'
import { ChatPage } from '@/features/chat/ChatPage'
import { SharePage } from '@/features/share/SharePage'
import { ThemeProvider } from '@/theme/ThemeProvider'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Toaster } from '@/components/ui/sonner'

// The onboarding wizard is only shown on first run; lazy-load it so it does
// not inflate the initial bundle for already-configured users.
const OnboardingWizard = lazy(() =>
  import('@/features/onboarding/OnboardingWizard').then((m) => ({
    default: m.OnboardingWizard,
  })),
)

/**
 * App shell (ARCHITECTURE.md §5.0): routes + first-run onboarding overlay.
 *
 * - `/login` — password/OIDC/passkey gate (RequireAuth redirects here).
 * - `/` — the three-panel chat workbench behind RequireAuth.
 * - `/session/:id` — deep link to a specific session (RequireAuth preserves
 *   the path through the auth redirect so a logged-out deep link lands back
 *   on the intended session).
 * - `/share/:token` — public read-only transcript snapshot (no auth).
 * - `*` — redirect to `/`.
 *
 * The onboarding wizard is self-gating: it renders nothing when
 * GET /api/onboarding/status reports `completed` (or is unreachable), so
 * CLI-configured users never see it. It overlays the whole app (fixed
 * inset-0) while first-run setup is pending.
 */
function ShareRoute() {
  const { token } = useParams<{ token: string }>()
  return <SharePage token={token ?? ''} />
}

function SessionRoute() {
  const { id } = useParams<{ id: string }>()
  return <ChatPage initialSessionId={id} />
}

function App() {
  return (
    <ThemeProvider>
      <ErrorBoundary>
        <BrowserRouter>
          <Suspense fallback={null}>
            <OnboardingWizard />
          </Suspense>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/"
              element={
                <RequireAuth>
                  <ChatPage />
                </RequireAuth>
              }
            />
            <Route
              path="/session/:id"
              element={
                <RequireAuth>
                  <SessionRoute />
                </RequireAuth>
              }
            />
            <Route path="/share/:token" element={<ShareRoute />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          {/* Toast host. Every toast() call in the app (session delete, slash
              command feedback, upload and stream errors) routes here; without
              it those messages were raised and silently dropped. */}
          <Toaster />
        </BrowserRouter>
      </ErrorBoundary>
    </ThemeProvider>
  )
}

export default App