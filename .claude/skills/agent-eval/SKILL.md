---
name: agent-eval
description: Use when changing a prompt, a model, the decision thresholds, the account list or the tax keys of the booking agents. Measure before and after, update the ablation table.
---

# Agenten ändern und messen

`pnpm eval` ruft das echte Modell und kostet Guthaben. **Vorher Benjamin fragen** und die geschätzten Kosten nennen (Runner zeigt sie mit `--dry-run`).

1. Ausgangslage: letztes Ergebnis in `evals/ergebnis.json` (Datum, Modelle, Prompt-Versionen) notieren.
2. Änderung machen. Bei Prompt-Änderung `PROMPT_VERSIONS` in `app/lib/agents/prompts.ts` hochzählen.
3. Unit-Tests: `pnpm test` (Prompt-Aufbau, Schema, Injection, Entscheidung). Kein echtes Modell.
4. Kosten schätzen: `pnpm eval --dry-run`. Benjamin fragen.
5. Messen: `pnpm eval` (alle vier Varianten) oder `pnpm eval --variante 4` (nur volle Aufstellung) oder `--limit 30` für einen schnellen Blick.
6. Vergleichen: Die wichtigste Zahl ist „falsch trotz automatisch“. Eine Änderung, die sie erhöht, kommt nicht rein, auch wenn die Genauigkeit steigt.
7. Schwelle nur aus der Kalibrierung ableiten (`evals/ergebnis.json` → `calibration`), nicht schätzen. Begründung in README und `threshold.reason`.
8. README-Tabelle aus `evals/ergebnis.json` aktualisieren: Datum, Modell-IDs, vier Zeilen, zwei Sätze Fazit.
9. Erwartungswerte in `evals/belege.json` nie an Modellantworten anpassen. Zweifelhafte Fälle mit `tax-reviewer` prüfen und Benjamin vorlegen.
