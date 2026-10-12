import { data, Form, useActionData, useSearchParams } from "react-router";
import { z } from "zod";
import { logIn, loginConfigured, passwordMatches } from "~/lib/auth.server";
import { getDb } from "~/lib/db/client";
import { clearLoginAttempts, takeLoginAttempt } from "~/lib/login-throttle.server";
import { clientIp, hashIp } from "~/lib/security.server";
import type { Route } from "./+types/login";

export const meta: Route.MetaFunction = () => [{ title: "Anmelden · Belegprüfer" }];

export async function action({ request }: Route.ActionArgs) {
  if (!loginConfigured()) {
    return data(
      { error: "Login ist hier nicht eingerichtet: APP_PASSWORD und SESSION_SECRET fehlen." },
      { status: 503 },
    );
  }
  const db = getDb();
  const ip = hashIp(clientIp(request));
  // Counted before the password: while blocked, even the right password gets no answer about being right.
  if (!(await takeLoginAttempt(db, ip))) {
    return data({ error: "Zu viele Versuche. Bitte in 15 Minuten erneut versuchen." }, { status: 429 });
  }
  const form = z
    .object({ password: z.string().max(500), next: z.string().max(500).default("/") })
    .safeParse(Object.fromEntries(await request.formData()));
  if (!form.success || !passwordMatches(form.data.password)) {
    return data({ error: "Passwort stimmt nicht." }, { status: 400 });
  }
  await clearLoginAttempts(db, ip);
  return logIn(request, form.data.next);
}

export default function Login() {
  const actionData = useActionData<typeof action>();
  const [params] = useSearchParams();
  return (
    <div className="mx-auto mt-16 max-w-sm space-y-6">
      <h1 className="masthead text-[36px] leading-10">Belegprüfer</h1>
      <Form method="post" className="ink-card space-y-4">
        <input type="hidden" name="next" value={params.get("next") ?? "/"} />
        <div className="flex flex-col gap-2">
          <label htmlFor="password" className="font-semibold">
            Passwort
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            aria-invalid={actionData?.error ? true : undefined}
            aria-describedby={actionData?.error ? "password-error" : undefined}
          />
          {actionData?.error ? (
            <p id="password-error" role="alert" className="text-[13px] text-danger">
              {actionData.error}
            </p>
          ) : null}
        </div>
        <button type="submit" className="btn w-full">
          Anmelden
        </button>
      </Form>
    </div>
  );
}
