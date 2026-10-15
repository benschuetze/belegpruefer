import { useEffect } from "react";
import {
  data,
  Form,
  isRouteErrorResponse,
  Link,
  Links,
  Meta,
  NavLink,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
  useRouteLoaderData,
} from "react-router";
import { allowedTenants, currentTenant, guard, isDemo, isLoggedIn } from "~/lib/auth.server";
import { getDb } from "~/lib/db/client";
import { applySecurityHeaders, isCrossSiteWrite } from "~/lib/security.server";
import type { Route } from "./+types/root";
import { useNonce } from "./nonce";
import "./app.css";

export const middleware: Route.MiddlewareFunction[] = [
  async ({ request }, next) => {
    try {
      if (isCrossSiteWrite(request)) {
        throw new Response("Anfrage von fremder Seite abgelehnt.", { status: 403 });
      }
      await guard(request, getDb());
    } catch (error) {
      if (error instanceof Response) applySecurityHeaders(error.headers);
      throw error;
    }
    const response = await next();
    applySecurityHeaders(response.headers);
    return response;
  },
];

export async function loader({ request }: Route.LoaderArgs) {
  const demo = isDemo();
  const loggedIn = demo || (await isLoggedIn(request));
  if (!loggedIn) return data({ demo, loggedIn, tenants: [], tenantId: null });
  const db = getDb();
  const [tenants, tenant] = await Promise.all([allowedTenants(db), currentTenant(db, request)]);
  return data({
    demo,
    loggedIn,
    tenants: tenants.map((t) => ({ id: t.id, name: t.name })),
    tenantId: tenant.id,
  });
}

const NAV = [
  { to: "/", label: "Heute", end: true },
  { to: "/belege", label: "Belege", end: false },
  { to: "/protokoll", label: "Protokoll", end: false },
  { to: "/export", label: "Export", end: false },
  { to: "/eval", label: "Eval", end: false },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const root = useRouteLoaderData<typeof loader>("root");
  const nonce = useNonce();
  const location = useLocation();
  // Marks the moment React has taken over the server-rendered page; E2E tests wait for it before clicking.
  useEffect(() => {
    document.documentElement.dataset.hydrated = "true";
  }, []);
  return (
    <html lang="de">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <meta name="theme-color" content="#f3efe5" />
        <Meta />
        <Links />
      </head>
      <body className="min-h-dvh">
        <a href="#inhalt" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 btn">
          Zum Inhalt
        </a>
        {root?.demo ? (
          <p className="note rounded-none border-x-0 border-t-0 text-center">
            <span className="pixel mr-2 text-pen">Mockdaten</span>
            Demo mit erfundenen Firmen und Rechnungen. Nur lesen, Hochladen und Buchen sind abgeschaltet.
          </p>
        ) : null}
        {root?.loggedIn ? (
          <header className="border-b-2 border-ink bg-paper">
            <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
              <Link to="/" className="masthead text-ink no-underline">
                Belegprüfer
              </Link>
              <div className="flex flex-wrap items-center gap-2">
                <Form
                  method="post"
                  action="/mandant"
                  className="flex flex-wrap items-center gap-2"
                  aria-label="Mandant"
                >
                  <span className="pixel">Mandant</span>
                  <input
                    type="hidden"
                    name="next"
                    value={location.pathname.startsWith("/belege/") ? "/belege" : location.pathname}
                  />
                  {root.tenants.map((t) => (
                    <button
                      key={t.id}
                      type="submit"
                      name="tenantId"
                      value={t.id}
                      className="chip"
                      aria-pressed={t.id === root.tenantId}
                    >
                      {t.name}
                    </button>
                  ))}
                </Form>
                {root.demo ? null : (
                  <Form method="post" action="/logout">
                    <button type="submit" className="chip">
                      Abmelden
                    </button>
                  </Form>
                )}
              </div>
            </div>
            <nav aria-label="Hauptnavigation" className="mx-auto flex max-w-5xl flex-wrap gap-2 px-4 pb-3">
              {NAV.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end} prefetch="intent" className="chip">
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </header>
        ) : null}
        <main id="inhalt" className="mx-auto max-w-5xl px-4 py-6">
          {children}
        </main>
        <footer className="mx-auto max-w-5xl px-4 pb-10 text-[13px] text-muted-ink">
          Belegprüfer · Eingangsrechnungen kontieren mit einem Agenten-Team ·{" "}
          <a href="https://github.com/benschuetze/belegpruefer" rel="noopener noreferrer">
            Code auf GitHub
          </a>
        </footer>
        <ScrollRestoration nonce={nonce} />
        <Scripts nonce={nonce} />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Etwas ist schiefgelaufen";
  let details = "Ein unerwarteter Fehler ist aufgetreten.";
  if (isRouteErrorResponse(error)) {
    title = error.status === 404 ? "Nicht gefunden" : `Fehler ${error.status}`;
    details =
      typeof error.data === "string" && error.data && !error.data.startsWith("Error:")
        ? error.data
        : error.status === 404
          ? "Diese Seite oder diesen Beleg gibt es hier nicht."
          : error.statusText;
  } else if (import.meta.env.DEV && error instanceof Error) {
    details = error.message;
  }
  return (
    <div className="space-y-3">
      <h1>{title}</h1>
      <p>{details}</p>
      <p>
        <Link to="/">Zur Startseite</Link>
      </p>
    </div>
  );
}
