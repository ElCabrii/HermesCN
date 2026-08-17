import { useContext } from "react"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"
import { ThemeContext } from "@/theme/ThemeProvider"

/**
 * Toast host.
 *
 * Reads the appearance from HermesCN's own ThemeProvider (the app does not use
 * next-themes — the shadcn default wired to it silently reported "system" and
 * toasts rendered against the wrong palette). Outside a provider (tests,
 * embedders) it falls back to "system".
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const themeContext = useContext(ThemeContext)
  const theme = themeContext?.theme ?? "system"

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      position="bottom-right"
      // The composer already owns the bottom-center of the screen; offset the
      // stack so a toast never lands on top of the send button.
      offset={16}
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius-lg)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
