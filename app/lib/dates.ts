/** Today in Germany as yyyy-mm-dd. The server runs in UTC; an invoice uploaded at 00:30 belongs to the German day. */
export function todayInGermany(now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(now);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "–";
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}

/** First and last day of the month before `today`: the usual export period. */
export function previousMonth(today: string): { from: string; to: string } {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const y = month === 1 ? year - 1 : year;
  const m = month === 1 ? 12 : month - 1;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, "0")}` };
}
