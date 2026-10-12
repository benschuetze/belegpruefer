---
name: ship
description: Use when a feature or fix is done and should be committed, pushed and deployed.
---

# Feature abschließen

1. `git diff` lesen. Nichts committen, was nicht zur Aufgabe gehört.
2. Keine echten Firmen, Personen, Belege, `.env`-Werte und keine privaten Notizen im Diff.
3. Skill `verify` abgeschlossen: `pnpm check` mit Exit 0, UI im Browser angesehen.
4. Schema geändert: Skill `db-change` abgeschlossen. Agenten geändert: Skill `agent-eval`.
5. Agent `code-reviewer` (und bei Routen, DB, Agenten `security-reviewer`) über den Diff laufen lassen, Befunde beheben oder begründet ablehnen.
6. Branch, Conventional Commits, push, PR. CI abwarten; rot heißt Ursache finden, nicht neu starten.
7. Nach dem Merge: Vercel-Deployment abwarten, Demo-URL öffnen, die geänderte Stelle ansehen, Laufzeit-Logs lesen.
8. In einer Zeile sagen, was live ist, mit URL. Erst wenn es live gesehen wurde.
