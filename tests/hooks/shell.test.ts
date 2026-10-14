import { describe, expect, it } from "vitest";
import { findCommits } from "../../.claude/hooks/shell.mjs";

const BASE = "/repo";
const one = (command: string) => {
  const commits = findCommits(command, BASE);
  const [commit, ...rest] = commits;
  if (!commit || rest.length > 0) throw new Error(`expected exactly one commit in: ${command}`);
  return commit;
};

describe("findCommits: jeder git commit im Befehl wird gefunden", () => {
  it.each([
    "git commit -m x",
    "pnpm check && git commit -m x",
    "git status; git commit -q -m x",
    "(git commit -m x)",
    "/usr/bin/git commit -m x",
    "sh -c 'git commit -m x'",
    "bash -lc 'git commit -m x'",
    "command git commit -m x",
    "env -u FOO git commit -m x",
    "FOO=1 git commit -m x",
    "time git commit -m x",
    "{ git commit -m x; }",
    "if true; then git commit -m x; fi",
  ])("%s", (command) => {
    expect(one(command)).toMatchObject({ dir: BASE, stagesFirst: null, paths: [] });
  });

  it("findet mehrere Commits in einem Befehl", () => {
    expect(findCommits("git commit -m a && git commit -am b", BASE).map((c) => c.all)).toEqual([false, true]);
  });

  it("lässt Befehle ohne Commit in Ruhe, auch wenn das Wort vorkommt", () => {
    for (const command of ["git status", "git log --grep commit", 'echo "git commit"', "git show HEAD"]) {
      expect(findCommits(command, BASE), command).toEqual([]);
    }
  });
});

describe("findCommits: Verzeichnis des Commits", () => {
  it("folgt cd und git -C, relativ und absolut, mit Anführungszeichen", () => {
    expect(one("cd app && git commit -m x").dir).toBe("/repo/app");
    expect(one('cd "/other dir" && git commit -m x').dir).toBe("/other dir");
    expect(one("git -C sub commit -m x").dir).toBe("/repo/sub");
    expect(one('git -C "/abs" commit -m x').dir).toBe("/abs");
  });

  it("ein Verzeichnis aus Variable, Ersetzung oder ~ ist unbekannt (null)", () => {
    expect(one('git -C "$W" commit -m x').dir).toBeNull();
    expect(one("cd ~ && git commit -m x").dir).toBeNull();
    expect(one("cd $(mktemp -d) && git commit -m x").dir).toBeNull();
  });

  it("ein absolutes cd danach macht es wieder bekannt", () => {
    expect(one("cd ~; cd /abs && git commit -m x").dir).toBe("/abs");
  });
});

describe("findCommits: Optionen, Pfade und was keine Pfade sind", () => {
  it("erkennt -a, --all, --amend, -i und Pfade", () => {
    expect(one("git commit -am x")).toMatchObject({ all: true, paths: [] });
    expect(one("git commit --all -m x")).toMatchObject({ all: true });
    expect(one("git commit --amend --no-edit")).toMatchObject({ amend: true, paths: [] });
    expect(one("git commit a.ts b.ts -m x")).toMatchObject({ paths: ["a.ts", "b.ts"] });
    expect(one("git commit -i a.ts -m x")).toMatchObject({ include: true, paths: ["a.ts"] });
    expect(one("git commit -m x -- a.ts")).toMatchObject({ paths: ["a.ts"] });
  });

  it("-uall und -S<keyid> nehmen den Rest des Worts als Wert", () => {
    expect(one("git commit -uall -m x")).toMatchObject({ all: false, paths: [] });
    expect(one("git commit -SABC123 -m x")).toMatchObject({ all: false, paths: [] });
  });

  it("-ma ist -m mit der Nachricht a, nicht -a", () => {
    expect(one("git commit -ma")).toMatchObject({ all: false, paths: [] });
  });

  it.each([
    "git commit -m x 2>&1 | tail -3",
    "git commit -m x >/dev/null",
    "git commit -q -m x 2> /dev/null",
    "git commit -m x &>/dev/null",
    "git commit -F - <<'EOF'\nfix: x\n\ngit add -A\nEOF",
    "git commit -F- <<<'fix: x'",
  ])("Umleitungen und Heredocs sind keine Pfade: %s", (command) => {
    expect(one(command).paths).toEqual([]);
  });

  it("Wörter in der Nachricht sind weder Optionen noch Befehle", () => {
    expect(one('git commit -m "fix: handle -a && git add in messages"')).toMatchObject({ all: false, paths: [] });
    const heredoc = `git commit -m "$(cat <<'EOF'\nfix: don't count -a (here\n\nCo-Authored-By: x\nEOF\n)"`;
    expect(one(heredoc)).toMatchObject({ all: false, paths: [], stagesFirst: null });
  });
});

describe("findCommits: was im selben Aufruf vorher den Index ändert", () => {
  it.each([
    ["git add -A && git commit -m x", "add"],
    ["git reset --soft HEAD~2 && git commit -m squash", "reset"],
    ["git stash pop && git commit -am x", "stash"],
    ["git checkout main -- app && git commit -m x", "checkout"],
    ["git add y; sh -c 'git commit -m x'", "add"],
  ])("%s", (command, sub) => {
    expect(one(command).stagesFirst).toBe(sub);
  });

  it("lesende git-Befehle davor sind in Ordnung", () => {
    expect(one("git status && git diff --stat && git log -1 && git commit -m x").stagesFirst).toBeNull();
  });
});

describe("findCommits: kaputte Eingabe wirft nicht", () => {
  it.each(['git commit -m "x', "git commit -m $(", "<<", "cd", "git -C", ""])("%s", (command) => {
    expect(() => findCommits(command, BASE)).not.toThrow();
  });
});
