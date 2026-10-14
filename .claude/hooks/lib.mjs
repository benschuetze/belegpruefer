// Shared helpers for the PreToolUse hooks. Plain Node, no dependencies: hooks run before `pnpm install` and on any OS.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

/**
 * Reads the hook payload from stdin. Returns null on anything unexpected: a guard that throws surfaces as a
 * confusing hook error. The deny rules in settings.json cover the paths that must never change regardless.
 */
export async function readInput() {
  try {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Prints a PreToolUse decision. `ask` makes the harness prompt Ben, even in auto mode; the model cannot approve it. */
export function decide(permissionDecision, permissionDecisionReason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision, permissionDecisionReason },
    }),
  );
}

/** Lets the call through the normal permission flow, with a note for the model next to the tool result. */
export function note(additionalContext) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext } }));
}

/**
 * Resolves symlinks in the deepest existing part of the path, so `ln -s drizzle mig` and `mig/0000.sql` lead to the
 * real file. The rest (a file Write is about to create) is appended unchanged.
 */
export function realPath(path) {
  let head = resolve(path);
  const tail = [];
  while (!existsSync(head)) {
    const parent = dirname(head);
    if (parent === head) return resolve(path);
    tail.unshift(basename(head));
    head = parent;
  }
  try {
    return join(realpathSync.native(head), ...tail);
  } catch {
    return resolve(path);
  }
}

/** Nearest directory with a `.git` (a directory, or a file in a worktree). */
export function findRepoRoot(path) {
  let dir = path;
  while (true) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * True for the project itself and its worktrees. The hooks run git, and git runs whatever a repository's config
 * names (core.fsmonitor and friends) outside any sandbox, so a repository planted elsewhere must not be touched.
 * Without CLAUDE_PROJECT_DIR (tests, manual runs) every repository counts.
 */
export function isProjectRepo(root) {
  const project = process.env.CLAUDE_PROJECT_DIR;
  if (!project) return true;
  const projectRoot = realPath(project);
  if (root === projectRoot) return true;
  try {
    const gitdir = /^gitdir:\s*(.+)$/m.exec(readFileSync(join(root, ".git"), "utf8"))?.[1]?.trim();
    return !!gitdir && realPath(resolve(root, gitdir)).startsWith(join(projectRoot, ".git", "worktrees") + sep);
  } catch {
    return false;
  }
}

/**
 * Path relative to the repo root with forward slashes and in lower case: rules then read the same on Windows, and
 * `Drizzle/` cannot slip past on the case-insensitive file systems of macOS and Windows.
 */
export function repoRelative(root, path) {
  return relative(root, path).split(sep).join("/").toLowerCase();
}

/** git with the repository's command-running settings switched off. */
export function git(cwd, args) {
  return execFileSync("git", ["-c", "core.fsmonitor=false", "--no-pager", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_OPTIONAL_LOCKS: "0" },
  });
}

/** Code of skr03.ts without comments and whitespace: any difference is a fachliche change. */
export function skr03Code(text) {
  return (
    text
      // Only comments that start a line: "//" inside a string must not hide the code next to it.
      .replace(/^\s*\/\*[\s\S]*?\*\//gm, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\s+/g, "")
  );
}

/** Numbers that differ between two versions, for the message; the decision itself rests on skr03Code. */
export function changedNumbers(before, after) {
  const count = (text) => {
    const map = new Map();
    for (const [n] of text.matchAll(/\d[\d_]*/g)) map.set(n, (map.get(n) ?? 0) + 1);
    return map;
  };
  const a = count(before);
  const b = count(after);
  const diff = (x, y) => [...x].filter(([n, k]) => k > (y.get(n) ?? 0)).map(([n]) => n);
  return { removed: diff(a, b), added: diff(b, a) };
}

export const SKR03_PATH = "app/lib/skr03.ts";
