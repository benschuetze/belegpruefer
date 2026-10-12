import type { ReactNode } from "react";
import { formatCents } from "~/lib/money";

/** One ledger line: label, dotted leader, value right-aligned in mono. */
export function LedgerLine({
  label,
  children,
  testId,
  text = false,
}: {
  label: ReactNode;
  children: ReactNode;
  testId?: string;
  /** Words rather than a number: no mono, may wrap. */
  text?: boolean;
}) {
  return (
    <div className="ledger-line" data-testid={testId}>
      <span className="shrink-0">{label}</span>
      <span className="leader" aria-hidden="true" />
      <span className={text ? "min-w-0 text-right" : "num"}>{children}</span>
    </div>
  );
}

export function Amount({ cents }: { cents: number }) {
  return <span className={`num whitespace-nowrap ${cents < 0 ? "text-danger" : ""}`}>{formatCents(cents)}</span>;
}

const STATUS_LABEL: Record<string, string> = {
  neu: "neu",
  verarbeitung: "läuft",
  automatisch: "automatisch",
  pruefen: "prüfen",
  bestaetigt: "bestätigt",
  festgeschrieben: "festgeschrieben",
  fehler: "Fehler",
};

export function StatusChip({ status }: { status: string }) {
  const needsYou = status === "pruefen" || status === "fehler";
  return (
    <span
      className={`inline-block rounded-sm border-2 px-2 py-0.5 text-[12px] font-semibold ${
        status === "fehler" ? "border-danger text-danger" : needsYou ? "border-pen text-pen" : "border-ink"
      } ${status === "festgeschrieben" ? "bg-ink text-paper" : "bg-card"}`}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
