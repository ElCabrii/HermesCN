/**
 * Placeholder shown while a session transcript is in flight.
 *
 * Mirrors the real rhythm of the transcript — a right-aligned user bubble
 * followed by left-aligned prose lines — so the column keeps its shape and the
 * switch reads as loading rather than as an empty or broken conversation.
 */
export function TranscriptSkeleton({ className }: { className?: string }) {
  return (
    <div
      data-testid="transcript-skeleton"
      aria-hidden="true"
      className={className}
    >
      <div className="flex animate-pulse flex-col gap-6">
        {[0, 1].map((turn) => (
          <div key={turn} className="flex flex-col gap-6">
            <div className="flex justify-end">
              <div className="h-9 w-1/2 rounded-2xl rounded-br-md bg-muted" />
            </div>
            <div className="flex flex-col gap-2">
              <div className="h-3.5 w-[92%] rounded bg-muted" />
              <div className="h-3.5 w-[84%] rounded bg-muted" />
              <div className="h-3.5 w-[63%] rounded bg-muted" />
              <div className="mt-1 h-6 w-32 rounded-md bg-muted/70" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
