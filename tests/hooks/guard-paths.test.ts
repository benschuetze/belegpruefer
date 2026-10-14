import { existsSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { makeRepo, runHook } from "./run-hook";

const SKR03 = `/** Kontenauszug. */
export const EXPENSE_ACCOUNTS = [
  { number: "4930", name: "Bürobedarf" },
  { number: "4940", name: "Zeitschriften, Bücher" },
  { number: "0420", name: "Büroeinrichtung", asset: true },
] as const;
export const GWG_LIMIT_NET_CENTS = 80_000;
export function taxKeyForRate(rate: number) {
  if (rate === 19) return "9";
  return "";
}
`;

const repo = makeRepo({
  "drizzle/0000_init.sql": "create table x();\n",
  "drizzle/meta/0000_snapshot.json": "{}\n",
  "evals/belege.json": "[]\n",
  "evals/generate.ts": "export {};\n",
  "app/lib/skr03.ts": SKR03,
  "app/lib/money.ts": "export {};\n",
});
afterAll(() => repo.remove());

const hook = (tool_name: string, tool_input: Record<string, unknown>, cwd = repo.root, env = {}) =>
  runHook("guard-paths.mjs", JSON.stringify({ tool_name, cwd, tool_input }), {
    CLAUDE_PROJECT_DIR: repo.root,
    ...env,
  });
const edit = (path: string, extra: Record<string, unknown> = {}) =>
  hook("Edit", { file_path: join(repo.root, path), old_string: "a", new_string: "b", ...extra });

describe("geschützte Pfade aus „Nicht ohne Rückfrage ändern“", () => {
  it("normale Quelldateien lässt der Hook ohne Einspruch durch", () => {
    expect(edit("app/lib/money.ts")).toMatchObject({ status: 0, decision: undefined, context: undefined });
  });

  it("Workflows ändern geht nur nach Rückfrage bei Ben", () => {
    const result = edit(".github/workflows/ci.yml");
    expect(result.decision).toBe("ask");
    expect(result.reason).toContain("Frag Ben");
  });

  it("eine committete Migration ist gesperrt und der Hinweis nennt den Weg über eine neue Migration", () => {
    const result = edit("drizzle/0000_init.sql");
    expect(result.decision).toBe("deny");
    expect(result.reason).toContain("--custom");
  });

  it("eine neue Custom-Migration darf von Hand geschrieben werden, auch schon gestagt (Skill db-change)", () => {
    expect(edit("drizzle/0001_trigger.sql").decision).toBeUndefined();
    repo.write("drizzle/0002_staged.sql", "-- leer\n");
    repo.stage("drizzle/0002_staged.sql");
    expect(edit("drizzle/0002_staged.sql").decision).toBeUndefined();
  });

  it("Snapshots unter drizzle/meta sind immer gesperrt", () => {
    expect(edit("drizzle/meta/0001_snapshot.json").decision).toBe("deny");
  });

  it("die Erwartungswerte sind gesperrt, ihre Vorlagen in generate.ts brauchen eine Rückfrage", () => {
    const result = edit("evals/belege.json");
    expect(result.decision).toBe("deny");
    expect(result.reason).toContain("evals/generate.ts");
    expect(edit("evals/generate.ts").decision).toBe("ask");
  });

  it(".env-Dateien sind gesperrt, lesend und schreibend, in jeder Tiefe; .env.example nicht", () => {
    for (const path of [".env", ".env.local", ".env.test", ".env.production.local", ".vercel/.env.production.local"]) {
      expect(edit(path).decision, path).toBe("deny");
      expect(hook("Read", { file_path: join(repo.root, path) }).decision, path).toBe("deny");
    }
    expect(edit(".env.example").decision).toBeUndefined();
    expect(hook("Read", { file_path: join(repo.root, ".env.example") }).decision).toBeUndefined();
  });

  it("Lesen anderer geschützter Dateien bleibt erlaubt", () => {
    expect(hook("Read", { file_path: join(repo.root, "drizzle/0000_init.sql") }).decision).toBeUndefined();
  });

  it("die Leitplanken selbst sind geschützt: Hooks und Einstellungen nur nach Rückfrage", () => {
    for (const path of [".claude/hooks/guard-paths.mjs", ".claude/settings.json", ".claude/settings.local.json"]) {
      expect(edit(path).decision, path).toBe("ask");
    }
  });

  it("gilt für Write, MultiEdit und NotebookEdit genauso wie für Edit", () => {
    const file_path = join(repo.root, "evals/belege.json");
    expect(hook("Write", { file_path, content: "[]" }).decision).toBe("deny");
    expect(hook("MultiEdit", { file_path, edits: [{ old_string: "[", new_string: "{" }] }).decision).toBe("deny");
    expect(hook("NotebookEdit", { notebook_path: join(repo.root, "drizzle/meta/x.ipynb") }).decision).toBe("deny");
  });
});

describe("Umwege über die Schreibweise des Pfads", () => {
  it("relative Pfade gelten vom Arbeitsverzeichnis der Session aus", () => {
    expect(hook("Edit", { file_path: "drizzle/meta/x.json", old_string: "a", new_string: "b" }).decision).toBe("deny");
  });

  it("Groß- und Kleinschreibung ändert nichts (macOS und Windows unterscheiden sie nicht)", () => {
    expect(edit("EVALS/belege.json").decision).toBe("deny");
    expect(edit(".GitHub/Workflows/ci.yml").decision).toBe("ask");
  });

  it("ein Symlink auf ein geschütztes Verzeichnis führt zur echten Datei", () => {
    symlinkSync(join(repo.root, "drizzle"), join(repo.root, "mig"));
    expect(edit("mig/0000_init.sql").decision).toBe("deny");
  });

  it("in einem Worktree des Projekts gelten dieselben Regeln", () => {
    const wt = `${repo.root}-wt`;
    repo.git("worktree", "add", "-q", wt);
    try {
      const result = hook("Edit", { file_path: join(wt, "drizzle/0000_init.sql"), old_string: "a", new_string: "b" });
      expect(result.decision).toBe("deny");
    } finally {
      repo.git("worktree", "remove", "--force", wt);
    }
  });

  it("in einem fremden Repository startet der Hook kein git (core.fsmonitor liefe sonst ohne Sandbox)", () => {
    const evil = makeRepo({ "drizzle/0000.sql": "x\n" });
    const marker = join(evil.root, "fsmonitor-ran");
    evil.git("config", "core.fsmonitor", `touch ${marker}`);
    try {
      const result = hook("Edit", { file_path: join(evil.root, "drizzle/0000.sql"), old_string: "x", new_string: "y" });
      expect(existsSync(marker)).toBe(false);
      expect(result.decision).toBe("ask");
    } finally {
      evil.remove();
    }
  });
});

describe("skr03.ts: Kommentare frei, jede Code-Änderung nur nach Rückfrage", () => {
  const skr = (old_string: string, new_string: string, extra = {}) =>
    edit("app/lib/skr03.ts", { old_string, new_string, ...extra });

  it("ein geänderter Kommentar geht mit Hinweis durch", () => {
    const result = skr("/** Kontenauszug. */", "/** Kontenauszug, Stand Oktober. */");
    expect(result.decision).toBeUndefined();
    expect(result.context).toContain("nur Kommentare");
  });

  it("eine geänderte Kontonummer fragt nach und nennt alte und neue Nummer", () => {
    const result = skr('{ number: "4930"', '{ number: "4931"');
    expect(result.decision).toBe("ask");
    expect(result.reason).toContain("4930");
    expect(result.reason).toContain("4931");
  });

  it("auch Teil-Ausschnitte, vertauschte Nummern, Merkmale, Grenzen und Steuerlogik fragen nach", () => {
    expect(skr('number: "493', 'number: "494').decision).toBe("ask");
    expect(skr('"4930", name: "Bürobedarf"', '"4930", name: "Zeitschriften, Bücher"').decision).toBe("ask");
    expect(skr(", asset: true", "").decision).toBe("ask");
    expect(skr("80_000", "100_000").decision).toBe("ask");
    expect(skr("rate === 19", "rate === 7").decision).toBe("ask");
  });

  it("// in einer Zeichenkette ist kein Kommentar", () => {
    const file_path = join(repo.root, "app/lib/skr03.ts");
    const current = readFileSync(file_path, "utf8");
    const withUrl = `${current}export const SOURCE = { url: "https://example.invalid", konto: "4400" };\n`;
    const write = (content: string) => hook("Write", { file_path, content });
    // Compared against the file on disk, so both versions differ from it; what matters is that the number is seen.
    expect(write(withUrl.replace('"4400"', '"4900"')).reason).toContain("4900");
  });

  it("Write der ganzen Datei vergleicht mit dem Stand auf der Platte", () => {
    const file_path = join(repo.root, "app/lib/skr03.ts");
    const current = readFileSync(file_path, "utf8");
    expect(hook("Write", { file_path, content: `// Kopf\n${current}` }).decision).toBeUndefined();
    expect(hook("Write", { file_path, content: current.replace("Bürobedarf", "Büromaterial") }).decision).toBe("ask");
  });

  it("MultiEdit wird Schritt für Schritt angewendet", () => {
    const result = hook("MultiEdit", {
      file_path: join(repo.root, "app/lib/skr03.ts"),
      edits: [
        { old_string: "/** Kontenauszug. */", new_string: "/** Auszug. */" },
        { old_string: '"4940"', new_string: '"4900"' },
      ],
    });
    expect(result.decision).toBe("ask");
  });
});

describe("kaputte Eingabe: der Hook wirft nicht und entscheidet nichts", () => {
  it.each([
    ["leer", ""],
    ["kein JSON", "{nicht json"],
    ["JSON ohne tool_input", "{}"],
    ["Array", "[]"],
    ["file_path keine Zeichenkette", JSON.stringify({ tool_name: "Edit", tool_input: { file_path: 42 } })],
    ["Pfad außerhalb eines Repos", JSON.stringify({ tool_name: "Edit", tool_input: { file_path: "/nirgends/x.ts" } })],
    [
      "Edit, das in skr03.ts nicht passt",
      JSON.stringify({
        tool_name: "Edit",
        tool_input: { file_path: join(repo.root, "app/lib/skr03.ts"), old_string: "gibt es nicht", new_string: "x" },
      }),
    ],
  ])("%s", (_name, stdin) => {
    expect(runHook("guard-paths.mjs", stdin)).toMatchObject({ status: 0, stderr: "", decision: undefined });
  });
});
