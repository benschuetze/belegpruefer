import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

describe("Commit-Größe: über 400 geänderte Zeilen wird der Commit abgelehnt", () => {
  it("ein kleiner gestagter Commit geht durch", () => {
    staged("app/a.ts", 120);
    expect(bash('git commit -m "feat: a"')).toMatchObject({ status: 0, decision: undefined });
  });

  it("genau 400 Zeilen gehen durch, 401 nicht", () => {
    staged("app/a.ts", 400);
    expect(bash("git commit -m x").decision).toBeUndefined();
    repo.write("app/b.ts", lines(1));
    repo.stage("app/b.ts");
    const result = bash("git commit -m x");
    expect(result.decision).toBe("deny");
    expect(result.reason).toContain("401");
    expect(result.reason).toContain("app/a.ts (400)");
    expect(result.reason).toContain("aufteilen");
  });

  it("Lockfile, Migrationen und Eval-Daten zählen nicht mit", () => {
    repo = makeRepo({});
    for (const path of [
      "pnpm-lock.yaml",
      "drizzle/0001_x.sql",
      "drizzle/meta/0001_snapshot.json",
      "evals/ergebnis.json",
      "evals/runs/2026-10-14.json",
    ]) {
      repo.write(path, lines(2000));
      repo.stage(path);
    }
    repo.write("app/a.ts", lines(50));
    repo.stage("app/a.ts");
    expect(bash("git commit -m x").decision).toBeUndefined();
  });

  it("eine Datei, die aus einem ausgenommenen Ordner herausverschoben wird, zählt am neuen Ort", () => {
    repo = makeRepo({ "evals/runs/big.json": lines(500), "app/.keep": "" });
    repo.git("mv", "evals/runs/big.json", "app/big.ts");
    repo.write("app/big.ts", lines(500) + lines(450, "neu"));
    repo.stage("app/big.ts");
    const result = bash("git commit -m x");
    expect(result.decision).toBe("deny");
    expect(result.reason).toContain("app/big.ts (450)");
  });

  it("nur Gestagtes zählt; nicht gestagte Änderungen bleiben außen vor", () => {
    repo = makeRepo({ "app/a.ts": "x\n" });
    repo.write("app/a.ts", lines(900));
    repo.write("app/small.ts", lines(10));
    repo.stage("app/small.ts");
    expect(bash("git commit -m x").decision).toBeUndefined();
  });

  it("mit -a zählt alles gegenüber HEAD, Gestagtes und Ungestagtes zusammen", () => {
    repo = makeRepo({ "app/a.ts": "x\n", "app/b.ts": "x\n" });
    repo.write("app/a.ts", lines(300));
    repo.stage("app/a.ts");
    repo.write("app/b.ts", lines(300));
    expect(bash('git commit -am "fix: x"').decision).toBe("deny");
    expect(bash("git commit --all -m x").decision).toBe("deny");
    expect(bash("git commit -m x").decision).toBeUndefined();
  });

  it("Pfade im Commit nehmen deren Stand aus dem Arbeitsverzeichnis", () => {
    repo = makeRepo({ "app/a.ts": "x\n" });
    repo.write("app/a.ts", lines(600));
    expect(bash("git commit app/a.ts -m x").decision).toBe("deny");
    expect(bash("git commit -m x -- app/a.ts").decision).toBe("deny");
  });

  it("--amend misst den ganzen neuen Commit, nicht nur den Nachtrag", () => {
    staged("app/a.ts", 300);
    repo.git("commit", "-qm", "erster Teil");
    repo.write("app/b.ts", lines(200));
    repo.stage("app/b.ts");
    expect(bash("git commit -m x").decision).toBeUndefined();
    expect(bash("git commit --amend --no-edit").decision).toBe("deny");
  });

  it("stagen und committen im selben Aufruf wird abgelehnt, weil sich die Größe vorher nicht messen lässt", () => {
    repo = makeRepo({});
    repo.write("app/a.ts", lines(10));
    const result = bash("git add -A && git commit -m x");
    expect(result.decision).toBe("deny");
    expect(result.reason).toContain("eigenen Aufruf");
  });

  it("Pfade im Commit gelten vom Unterordner aus, in dem er läuft", () => {
    repo = makeRepo({ "drizzle/0000_init.sql": "x\n", "app/lib/a.ts": "x\n" });
    repo.write("drizzle/0000_init.sql", "y\n");
    expect(bash("git commit -m x 0000_init.sql", join(repo.root, "drizzle")).decision).toBe("deny");
    repo.write("app/lib/a.ts", lines(10));
    expect(bash("git commit -m x -- a.ts", join(repo.root, "app/lib")).decision).toBeUndefined();
  });

  it("git-Befehle, die Index oder Arbeitsbaum ändern, vor dem Commit im selben Aufruf: abgelehnt", () => {
    staged("app/a.ts", 300);
    repo.git("commit", "-qm", "eins");
    for (const command of [
      "git reset --soft HEAD~1 && git commit -m squash",
      "git stash pop && git commit -am x",
      "git checkout main -- app && git commit -m x",
      "git add y; sh -c 'git commit -m x'",
    ]) {
      const result = bash(command);
      expect(result.decision, command).toBe("deny");
      expect(result.reason, command).toContain("eigenen Aufruf");
    }
    expect(bash("git status && git diff --stat && git commit -m x").decision).toBeUndefined();
  });

  it("Alltagsbefehle: Umleitung, Heredoc-Nachricht, Verzeichnis aus Variable (Zerlegung im Detail: shell.test.ts)", () => {
    staged("app/a.ts", 500);
    expect(bash("git commit -m x 2>&1 | tail -3").decision).toBe("deny");
    expect(bash(`cd "${repo.root}" && git commit -q -m x`, "/").decision).toBe("deny");
    expect(bash('git -C "$W" commit -m x').decision).toBe("ask");
    repo.git("reset", "-q");
    repo.write("app/small.ts", lines(10));
    repo.stage("app/small.ts");
    expect(
      bash(`git commit -m "$(cat <<'EOF'\nfix: don't count -a (here)\nEOF\n)" 2>&1 | tail -2`).decision,
    ).toBeUndefined();
    expect(bash("git status").decision).toBeUndefined();
  });

  it("die Grenze lässt sich nur über die Umgebung von Claude Code anheben, nicht per Präfix im Befehl", () => {
    staged("app/a.ts", 600);
    expect(bash("BELEGPRUEFER_MAX_COMMIT_LINES=9999 git commit -m x").decision).toBe("deny");
    expect(bash("git commit -m x", repo.root, { BELEGPRUEFER_MAX_COMMIT_LINES: "1000" }).decision).toBeUndefined();
    expect(bash("git commit -m x", repo.root, { BELEGPRUEFER_MAX_COMMIT_LINES: "-1" }).decision).toBe("deny");
  });

  it("über einen Symlink erreicht bleibt es das eigene Repository und wird geprüft", () => {
    staged("app/a.ts", 600);
    const link = join(mkdtempSync(join(tmpdir(), "link-")), "repo");
    symlinkSync(repo.root, link);
    expect(bash("git commit -m x", link).decision).toBe("deny");
    rmSync(dirname(link), { recursive: true, force: true });
  });

  it("sudo und abgekürztes --amen ändern nichts an der Prüfung", () => {
    repo = makeRepo({ "app/a.ts": lines(300) });
    repo.write("app/b.ts", lines(300));
    repo.stage("app/b.ts");
    expect(bash("sudo -u ben git commit -m x").decision).toBeUndefined();
    expect(bash("git commit --amen --no-edit").decision).toBe("deny");
  });
});
