import { Link, useLoaderData } from "react-router";
import { LedgerLine } from "~/components/ledger";
import { UploadForm } from "~/components/upload-form";
import { currentTenant, isDemo } from "~/lib/auth.server";
import { getDb } from "~/lib/db/client";
import { overview } from "~/lib/queries.server";
import type { Route } from "./+types/home";

export const meta: Route.MetaFunction = () => [{ title: "Heute · Belegprüfer" }];

export async function loader({ request }: Route.LoaderArgs) {
  const db = getDb();
  const tenant = await currentTenant(db, request);
  return { tenant: tenant.name, numbers: await overview(db, tenant.id), demo: isDemo() };
}

export default function Home() {
  const { tenant, numbers, demo } = useLoaderData<typeof loader>();
  const done = numbers.automatic + numbers.confirmed + numbers.locked;
  return (
    <div className="space-y-8">
      <section aria-labelledby="heute" className="space-y-3">
        <p className="pixel" id="heute">
          Heute · {tenant}
        </p>
        <h1 className="sr-only">Wie viele Belege brauchen dich?</h1>
        <p>
          <span className="summe" data-testid="brauchen-dich">
            {numbers.needYou}
          </span>
        </p>
        <p className="text-[20px] leading-[26px]">
          {numbers.needYou === 0
            ? "Nichts wartet auf dich."
            : numbers.needYou === 1
              ? "Beleg braucht dich."
              : "Belege brauchen dich."}{" "}
          <span className="text-muted-ink">{done} sind fertig.</span>
        </p>
        {numbers.needYou > 0 ? (
          <p>
            <Link to="/belege?filter=pruefen" className="btn no-underline">
              Jetzt prüfen
            </Link>
          </p>
        ) : null}
      </section>

      <details className="ink-card max-w-xl" open>
        <summary className="cursor-pointer font-semibold">Wie gerechnet?</summary>
        <div className="mt-3 space-y-1">
          <LedgerLine label="Eingegangen" testId="eingegangen">
            {numbers.received}
          </LedgerLine>
          <LedgerLine label="Automatisch gebucht">{numbers.automatic}</LedgerLine>
          <LedgerLine label="Von dir bestätigt">{numbers.confirmed}</LedgerLine>
          <LedgerLine label="Festgeschrieben">{numbers.locked}</LedgerLine>
          <LedgerLine label="Zu prüfen">{numbers.review}</LedgerLine>
          <LedgerLine label="Nicht lesbar oder abgebrochen">{numbers.failed}</LedgerLine>
          <p className="pt-2 text-[13px] text-muted-ink">
            Brauchen dich = zu prüfen + nicht lesbar. Fertig = automatisch + bestätigt + festgeschrieben.
          </p>
        </div>
      </details>

      <section className="max-w-xl">
        <UploadForm disabled={demo} />
      </section>
    </div>
  );
}
