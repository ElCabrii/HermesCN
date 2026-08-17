import { Component, type ErrorInfo, type ReactNode } from 'react'
import { RotateCcwIcon, TriangleAlertIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Top-level render guard.
 *
 * Without it a single throw anywhere in the tree unmounts the whole app and
 * leaves the user staring at a blank page with no way back — the transcript,
 * the sidebar, and the composer all disappear at once. Here we keep the shell
 * alive, name what happened, and offer the two recoveries that actually work:
 * re-render the subtree, or reload the document.
 */
interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep the stack in the console for bug reports; the UI stays calm.
    console.error('[hermes] render error:', error, info.componentStack)
  }

  private reset = () => {
    this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div
        role="alert"
        data-testid="error-boundary"
        className="flex h-dvh flex-col items-center justify-center gap-5 bg-background px-6 text-center text-foreground"
      >
        <div className="grid size-11 place-items-center rounded-xl border border-destructive/30 bg-destructive/10 text-destructive">
          <TriangleAlertIcon className="size-5" />
        </div>
        <div className="flex flex-col gap-1.5">
          <h1 className="text-base font-semibold tracking-tight">Something broke in the interface</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            Your conversations are safe on the server. Retry to re-render this view, or reload
            the page for a clean start.
          </p>
        </div>
        <pre className="max-h-32 max-w-lg overflow-auto rounded-md border border-border bg-muted px-3 py-2 text-left font-mono text-xs text-muted-foreground">
          {error.message || String(error)}
        </pre>
        <div className="flex items-center gap-2">
          <Button onClick={this.reset}>
            <RotateCcwIcon />
            Retry
          </Button>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Reload page
          </Button>
        </div>
      </div>
    )
  }
}
