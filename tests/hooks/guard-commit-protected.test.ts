import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { lines, makeRepo, runHook } from "./run-hook";

let repo: ReturnType<typeof makeRepo>;
afterEach(() => repo?.remove());

const bash = (command: string, cwd = repo.root, env: Record<string, string> = {}) =>
  runHook("guard-commit-size.mjs", JSON.stringify({ tool_name: "Bash", cwd, tool_input: { command } }), {
    CLAUDE_PROJECT_DIR: repo.root,
    ...env,
  });

/** Repository with `path` staged at `n` lines. */
function staged(path: string, n: number, files: Record<string, string> = {}) {
  repo = makeRepo(files);
  repo.write(path, lines(n));
  repo.stage(path);
}

describe("was guard-paths nicht sieht, fängt der Commit ab (Änderungen per Bash)", () => {
  it("eine geänderte oder gelöschte committete Migration wird abgelehnt", () => {
    repo = makeRepo({ "drizzle/0000_init.sql": "create table x();\n" });
    repo.write("drizzle/0000_init.sql", "create table y();\n");
    repo.stage("drizzle/0000_init.sql");
    const result = bash("git commit -m x");
    expect(result.decision).toBe("deny");
    expect(result.reason).toContain("drizzle/0000_init.sql");
    repo.git("reset", "-q", "--hard");
    repo.git("rm", "-q", "drizzle/0000_init.sql");
    expect(bash("git commit -m x").decision).toBe("deny");
  });

  it("eine neue Migration und ein geänderter Snapshot gehen durch", () => {
    repo = makeRepo({ "drizzle/0000_init.sql": "x\n", "drizzle/meta/_journal.json": "{}\n" });
    repo.write("drizzle/0001_neu.sql", "y\n");
    repo.write("drizzle/meta/_journal.json", '{"n":1}\n');
    repo.stage("drizzle");
    expect(bash("git commit -m x").decision).toBeUndefined();
  });

  it("Workflows, Eval-Vorlagen, Erwartungswerte und Leitplanken per Bash geändert: Rückfrage beim Commit", () => {
    for (const path of [
      ".github/workflows/ci.yml",
      "evals/generate.ts",
      "evals/belege.json",
      ".claude/hooks/guard-paths.mjs",
      ".claude/settings.local.json",
    ]) {
      staged(path, 3);
      expect(bash("git commit -m x").decision, path).toBe("ask");
      repo.remove();
    }
    repo = makeRepo({});
  });

  it("geänderter Code in skr03.ts fragt nach, ein geänderter Kommentar nicht", () => {
    repo = makeRepo({ "app/lib/skr03.ts": '// Konten\nexport const A = "4930";\n' });
    repo.write("app/lib/skr03.ts", '// Konten, Stand Oktober\nexport const A = "4930";\n');
    repo.stage("app/lib/skr03.ts");
    expect(bash("git commit -m x").decision).toBeUndefined();
    repo.write("app/lib/skr03.ts", '// Konten\nexport const A = "4940";\n');
    repo.stage("app/lib/skr03.ts");
    expect(bash("git commit -m x").decision).toBe("ask");
  });
});

describe("Sicherheit des Hooks selbst", () => {
  it("in einem fremden Repository startet der Hook kein git (core.fsmonitor liefe sonst ohne Sandbox)", () => {
    staged("app/a.ts", 10);
    const evil = makeRepo({});
    const marker = join(evil.root, "fsmonitor-ran");
    evil.git("config", "core.fsmonitor", `touch ${marker}`);
    try {
      expect(bash(`cd ${evil.root} && git commit -m x`, "/").decision).toBeUndefined();
      expect(existsSync(marker)).toBe(false);
    } finally {
      evil.remove();
    }
  });

  it("im eigenen Repository ist core.fsmonitor abgeschaltet", () => {
    staged("app/a.ts", 10);
    const marker = join(repo.root, "fsmonitor-ran");
    repo.git("config", "core.fsmonitor", `touch ${marker}`);
    bash("git commit -m x");
    expect(existsSync(marker)).toBe(false);
  });
});

describe("kaputte Eingabe: der Hook wirft nicht und entscheidet nichts", () => {
  it.each([
    ["leer", ""],
    ["kein JSON", "nicht json"],
    ["ohne command", JSON.stringify({ tool_name: "Bash", tool_input: {} })],
    ["command keine Zeichenkette", JSON.stringify({ tool_name: "Bash", tool_input: { command: ["git", "commit"] } })],
    ["kein Repository", JSON.stringify({ tool_name: "Bash", cwd: "/", tool_input: { command: "git commit -m x" } })],
    [
      "offene Anführungszeichen",
      JSON.stringify({ tool_name: "Bash", cwd: "/", tool_input: { command: 'git commit -m "x' } }),
    ],
  ])("%s", (_name, stdin) => {
    expect(runHook("guard-commit-size.mjs", stdin)).toMatchObject({ status: 0, stderr: "", decision: undefined });
  });
});
