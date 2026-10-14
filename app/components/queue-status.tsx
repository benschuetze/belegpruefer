import { useEffect, useRef } from "react";
import { useFetcher, useLocation } from "react-router";

/** After a round that found nothing to do (another tab or run is on it), wait a moment before asking again. */
const IDLE_RETRY_MS = 2000;

/**
 * Shows how many documents are waiting and keeps the queue moving: one short request per round, the page data
 * refreshes after each. Stops by itself once nothing waits.
 */
export function QueueStatus({ waiting }: { waiting: number }) {
  const fetcher = useFetcher<{ processed: number; waiting: number }>();
  const location = useLocation();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (waiting === 0 || fetcher.state !== "idle") return;
    const delay = fetcher.data && fetcher.data.processed === 0 ? IDLE_RETRY_MS : 0;
    timer.current = setTimeout(() => fetcher.submit(null, { method: "post", action: "/verarbeiten" }), delay);
    return () => clearTimeout(timer.current);
  }, [waiting, fetcher.state, fetcher.data, fetcher.submit]);

  if (waiting === 0) return null;
  return (
    <section role="status" aria-label="Warteschlange" className="ink-card flex flex-wrap items-center gap-3">
      <p className="flex-1">
        <span className="num font-semibold">{waiting}</span> {waiting === 1 ? "Beleg wird" : "Belege werden"} gerade
        geprüft. Du kannst die Seite offen lassen oder weiterarbeiten.
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
