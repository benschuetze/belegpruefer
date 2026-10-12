import { isoDate } from "~/lib/beleg";
import { previousMonth } from "~/lib/dates";

/** Period from the query string, falling back to last month. Anything malformed is the fallback, not an error. */
export function periodFrom(url: URL, today: string): { from: string; to: string } {
  const fallback = previousMonth(today);
  const from = isoDate.safeParse(url.searchParams.get("von"));
  const to = isoDate.safeParse(url.searchParams.get("bis"));
  if (!from.success || !to.success || from.data > to.data) return fallback;
  return { from: from.data, to: to.data };
}
