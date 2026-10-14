import { useEffect, useRef } from "react";
import { useFetcher, useLocation } from "react-router";

/** After a round that found nothing to do (another tab or run is on it), wait a moment before asking again. */
const IDLE_RETRY_MS = 2000;
/** After a failed round, longer: whatever broke (database, deploy) needs a moment. */
const ERROR_RETRY_MS = 10_000;

/**
 * Shows how many documents are waiting and keeps the queue moving: one short request per round, the page data
 * refreshes after each. Stops by itself once nothing waits.
 */
export function QueueStatus({ waiting, demo }: { waiting: number; demo: boolean }) {
  const fetcher = useFetcher<{ processed: number; waiting: number; error?: string }>();
  const location = useLocation();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    // The demo is read-only: /verarbeiten would answer 403, so it is never called there.
    if (demo || waiting === 0 || fetcher.state !== "idle") return;
    const delay = fetcher.data?.error ? ERROR_RETRY_MS : fetcher.data?.processed === 0 ? IDLE_RETRY_MS : 0;
    timer.current = setTimeout(() => fetcher.submit(null, { method: "post", action: "/verarbeiten" }), delay);
    return () => clearTimeout(timer.current);
  }, [demo, waiting, fetcher.state, fetcher.data, fetcher.submit]);

  if (demo || waiting === 0) return null;
  return (
    <section role="status" aria-label="Warteschlange" className="ink-card flex flex-wrap items-center gap-3">
      <p className="flex-1">
        <span className="num font-semibold">{waiting}</span> {waiting === 1 ? "Beleg wird" : "Belege werden"} gerade
        geprüft. Du kannst die Seite offen lassen oder weiterarbeiten.
        {fetcher.data?.error ? (
          <span className="block text-[13px] text-danger">Gerade unterbrochen, gleich geht es weiter.</span>
        ) : null}
      </p>
      <fetcher.Form method="post" action="/verarbeiten">
        <input type="hidden" name="zurueck" value={location.pathname + location.search} />
        <button type="submit" className="btn" disabled={fetcher.state !== "idle"}>
          {fetcher.state !== "idle" ? "Läuft …" : "Weiter prüfen"}
        </button>
      </fetcher.Form>
    </section>
  );
}
