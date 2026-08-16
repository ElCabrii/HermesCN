import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { LoginPage } from '@/features/auth/LoginPage'
import { RequireAuth } from '@/features/auth/RequireAuth'

/**
 * Placeholder home shell — the chat surface lands in Phase 3.
 */
function HomePage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-2">
      <h1 className="text-xl font-semibold">HermesCN</h1>
      <p className="text-sm text-muted-foreground">Chat coming soon.</p>
    </div>
  )
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <HomePage />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
