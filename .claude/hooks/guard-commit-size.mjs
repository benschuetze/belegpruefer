// PreToolUse guard for Bash `git commit`:
// - more than LIMIT changed lines → refused, split it;
// - a committed migration changed or removed → refused, write a new one (catches `sed -i` and other Bash edits that
//   guard-paths.mjs never sees);
// - code in skr03.ts changed → Ben is asked.
//
// Why 400: reviews find defects reliably up to about 200–400 changed lines and much less beyond that (SmartBear/Cisco
// code review study). Every change here is reviewed by a person and two review agents, and a typical change in this
// repo (logic plus its test) is 20–150 lines, so 400 leaves room for a feature with tests and stops the 1000-line
// mixed commit. Generated or data files are not counted: nobody reviews them line by line.
//
// Only Ben can raise the limit, by starting Claude Code with BELEGPRUEFER_MAX_COMMIT_LINES set: the hook reads the
// environment of the Claude Code process, which a prefix on the Bash command does not reach, and settings files that
// could set it are guarded by guard-paths.mjs.
import { readFileSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { decide, findRepoRoot, git, isProjectRepo, note, readInput, realPath, SKR03_PATH, skr03Code } from "./lib.mjs";
import { findCommits, writtenPaths } from "./shell.mjs";

const fromEnv = Number(process.env.BELEGPRUEFER_MAX_COMMIT_LINES);
const LIMIT = Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : 400;
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/** Lockfile, migrations and their snapshots (drizzle-kit), eval data and results (scripts). */
const EXCLUDED = [
  /(^|\/)pnpm-lock\.yaml$/,
  /^drizzle\//,
  /^evals\/belege\.json$/,
  /^evals\/ergebnis\.json$/,
  /^evals\/runs\//,
  /^evals\/pdfs\//,
];

/** Changed by Bash, these slip past guard-paths.mjs; at commit time Ben is asked (skr03.ts and migrations have their own checks). */
const GUARDED = [
  /^\.github\/workflows\//,
  /^evals\/belege\.json$/,
  /^evals\/generate\.ts$/,
  /^\.claude\/hooks\//,
  /^\.claude\/settings(\.local)?\.json$/,
];

/**
 * Guarded files and folders as plain prefixes, to tell whether a folder a shell command writes holds one:
 * `rm -rf app` removes skr03.ts, `rm -rf .` everything.
 */
const GUARDED_PREFIXES = [
  ".claude/hooks/",
  ".claude/settings.json",
  ".claude/settings.local.json",
  ".github/workflows/",
  "evals/belege.json",
  "evals/generate.ts",
  "drizzle/",
  SKR03_PATH,
];
const holdsGuarded = (rel) => rel === "" || GUARDED_PREFIXES.some((p) => p.startsWith(`${rel}/`));

const input = await readInput();
const command = input?.tool_input?.command;
if (typeof command !== "string") process.exit(0);

try {
  const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
  const commits = findCommits(command, cwd);
  // What Bash writes in the same call is not in any diff yet, because the hook runs first.
  const written = commits.length > 0 ? writtenPaths(command, cwd) : { paths: [], unknown: null };
  const verdicts = commits.map((commit) => check(commit, written)).filter(Boolean);
  const denied = verdicts.find((v) => v.decision === "deny");
  const asked = verdicts.find((v) => v.decision === "ask");
  if (denied) decide("deny", denied.reason);
  else if (asked) decide("ask", asked.reason);
} catch {
  // A bug in the parser must not break every Bash call; CI and review still see the commit. Say so, though.
  note("Commit-Hook konnte den Befehl nicht prüfen (interner Fehler); Größe und geschützte Pfade sind ungeprüft.");
}

function check(commit, written) {
  if (commit.stagesFirst) {
    return {
      decision: "deny",
      reason: `git ${commit.stagesFirst} und git commit im selben Aufruf: Was committet wird, steht erst nach dem ersten Befehl fest und lässt sich vorher nicht messen. Erst in einem eigenen Aufruf vorbereiten, dann committen.`,
    };
  }
  if (!commit.dir) {
    return {
      decision: "ask",
      reason:
        "Commit in einem Verzeichnis aus Variable oder Ersetzung: Größe und geschützte Dateien ließen sich nicht prüfen. Ben fragen oder den Pfad ausschreiben.",
    };
  }
  // Resolved before the repo is judged: a symlink inside the project can point into a foreign repository, whose
  // config (clean filters, fsmonitor) git would otherwise run.
  const dir = realPath(commit.dir);
  const root = findRepoRoot(dir);
  if (!root) return null;
  if (!isProjectRepo(root)) return null;
  if (commit.gitEnv || commit.pathspecFile) {
    return {
      decision: "ask",
      reason: `${commit.gitEnv ?? "--pathspec-from-file"} lenkt den Commit auf einen Index oder Pfade, die der Hook nicht misst. Ben fragen oder ohne diesen Zusatz committen.`,
    };
  }

  let base = "HEAD";
  try {
    git(root, ["rev-parse", "--verify", "--quiet", commit.amend ? "HEAD~1" : "HEAD"]);
    if (commit.amend) base = "HEAD~1";
  } catch {
    base = EMPTY_TREE; // Root commit, or an amend of it.
  }

  let changes;
  try {
    changes = measure(dir, base, commit);
  } catch {
    return { decision: "ask", reason: "git diff ist gescheitert; Größe des Commits unbekannt. Ben fragen." };
  }

  const touchedMigration = changes.find(
    (c) => c.oldPath && /^drizzle\/[^/]+\.sql$/i.test(c.oldPath) && c.status !== "A",
  );
  if (touchedMigration) {
    return {
      decision: "deny",
      reason: `Der Commit ändert die committete Migration ${touchedMigration.oldPath}. Sie lief womöglich schon gegen die Demo-Datenbank; Änderung zurücknehmen (git restore --staged --worktree ${touchedMigration.oldPath}) und eine neue Migration schreiben (Skill db-change).`,
    };
  }

  const files = changes.filter((c) => c.lines !== null && !EXCLUDED.some((re) => re.test(c.path.toLowerCase())));
  const total = files.reduce((sum, f) => sum + f.lines, 0);
  if (total > LIMIT) {
    const largest = files
      .sort((a, b) => b.lines - a.lines)
      .slice(0, 5)
      .map((f) => `${f.path} (${f.lines})`)
      .join(", ");
    return {
      decision: "deny",
      reason:
        `Commit zu groß: ${total} geänderte Zeilen, Grenze ${LIMIT} (ohne Lockfile, drizzle/, Eval-Daten). Größte Dateien: ${largest}. ` +
        "In kleinere Commits aufteilen, die jeder für sich grün sind, z. B. Schema+Migration, Logik+Tests, UI+E2E: " +
        "git restore --staged <datei> und einzeln committen. Lässt es sich wirklich nicht teilen, Ben fragen; er kann " +
        "Claude Code mit BELEGPRUEFER_MAX_COMMIT_LINES neu starten.",
    };
  }

  const guarded = changes
    .flatMap((c) => [c.path, c.oldPath])
    .find((p) => p && GUARDED.some((re) => re.test(p.toLowerCase())));
  if (guarded) {
    return {
      decision: "ask",
      reason: `Der Commit ändert ${guarded}, einen Pfad aus „Nicht ohne Rückfrage ändern“ bzw. die Leitplanken selbst (CLAUDE.md). Frag Ben, falls er diese Änderung nicht schon freigegeben hat.`,
    };
  }

  const named = written.paths
    .map((p) => relative(root, realPath(p)).split(sep).join("/"))
    .find((rel) => {
      const lower = rel.toLowerCase();
      if (rel.startsWith("..") || isAbsolute(rel)) return false;
      return (
        holdsGuarded(lower) ||
        GUARDED.some((re) => re.test(lower)) ||
        /^drizzle\/[^/]+\.sql$/.test(lower) ||
        lower === SKR03_PATH
      );
    });
  if (named !== undefined) {
    return {
      decision: "ask",
      reason: `Im selben Aufruf schreibt ein Shell-Befehl auf ${named || "."} (Leitplanken, „Nicht ohne Rückfrage ändern“ oder eine Migration, auch als Ordner darüber). Der Hook sieht diese Änderung vor dem Commit nicht. Erst ändern, dann in einem eigenen Aufruf committen, oder Ben fragen.`,
    };
  }
  // `-a` and `git commit <paths>` take tracked files from the working tree, where those writes land: their size is
  // not visible before the command runs.
  if (commit.all || commit.paths.length > 0) {
    const inside = written.paths
      .map((p) => relative(root, realPath(p)).split(sep).join("/"))
      .filter((rel) => rel !== "" && !rel.startsWith("..") && !isAbsolute(rel));
    const tracked = inside.length > 0 ? trackedAmong(root, inside) : [];
    if (tracked.length > 0) {
      return {
        decision: "ask",
        reason: `Im selben Aufruf schreibt ein Shell-Befehl vor dem Commit auf ${tracked.slice(0, 3).join(", ")}; was das zum Commit beiträgt, sieht der Hook vorher nicht. Erst in einem eigenen Aufruf ausführen, dann committen.`,
      };
    }
  }
  if (written.unknown) {
    return {
      decision: "ask",
      reason: `\`${written.unknown}\` vor dem Commit schreibt womöglich auf Dateien, die der Hook nicht auflösen kann (Variable, unbekanntes Verzeichnis oder ein Befehl wie patch oder git apply). Erst in einem eigenen Aufruf ausführen, dann committen, oder Ben fragen.`,
    };
  }

  if (changes.some((c) => c.path.toLowerCase() === SKR03_PATH)) {
    const before = show(root, `${base}:${SKR03_PATH}`);
    const after = commit.all || commit.paths.length > 0 ? readWorktree(root, SKR03_PATH) : show(root, `:${SKR03_PATH}`);
    if (skr03Code(before) !== skr03Code(after)) {
      return {
        decision: "ask",
        reason: `Der Commit ändert Code in ${SKR03_PATH} (Konten, BU-Schlüssel, Grenzen). Laut CLAUDE.md nicht ohne Rückfrage, Agent tax-reviewer. Frag Ben, falls er diese Änderung nicht schon freigegeben hat.`,
      };
    }
  }
  return null;
}

/**
 * Changed files with line counts (null for binary) and, from --name-status, the old path and status. Runs in the
 * commit's directory, because paths given to `git commit` are relative to it; the output is relative to the root.
 */
function measure(dir, base, commit) {
  const variants = [];
  if (commit.paths.length > 0) {
    // `git commit <paths>` takes those files from the working tree; with -i the index comes along.
    if (commit.include) variants.push(["--cached", base]);
    variants.push([base, "--", ...commit.paths]);
  } else {
    variants.push(commit.all ? [base] : ["--cached", base]);
  }
  const byPath = new Map();
  for (const args of variants) {
    const numstat = git(dir, [
      "diff",
      "--no-relative",
      "--no-ext-diff",
      "--no-textconv",
      "--find-renames",
      "--numstat",
      "-z",
      ...args,
    ]);
    const status = git(dir, [
      "diff",
      "--no-relative",
      "--no-ext-diff",
      "--find-renames",
      "--name-status",
      "-z",
      ...args,
    ]);
    const statusByPath = parseNameStatus(status);
    for (const entry of parseNumstat(numstat)) {
      byPath.set(entry.path, { ...entry, ...statusByPath.get(entry.path) });
    }
  }
  return [...byPath.values()];
}

function parseNumstat(text) {
  const parts = text.split("\0");
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const [added, deleted, path] = (parts[i] ?? "").split("\t");
    if (added === undefined || deleted === undefined || path === undefined) continue;
    const lines = added === "-" ? null : Number(added) + Number(deleted);
    if (path === "") {
      // Rename: the old and the new path follow as their own fields.
      out.push({ path: parts[i + 2] ?? "", lines });
      i += 2;
    } else {
      out.push({ path, lines });
    }
  }
  return out;
}

function parseNameStatus(text) {
  const parts = text.split("\0");
  const map = new Map();
  for (let i = 0; i < parts.length; i++) {
    const status = parts[i]?.[0];
    if (!status) continue;
    if (status === "R" || status === "C") {
      map.set(parts[i + 2] ?? "", { status, oldPath: parts[i + 1] });
      i += 2;
    } else {
      map.set(parts[i + 1] ?? "", { status, oldPath: parts[i + 1] });
      i += 1;
    }
  }
  return map;
}

/** The paths (files or folders) among `rels` that hold tracked files; all of them if git cannot tell. */
function trackedAmong(root, rels) {
  try {
    const files = git(root, ["ls-files", "-z", "--", ...rels])
      .split("\0")
      .filter(Boolean);
    return rels.filter((rel) => files.some((f) => f === rel || f.startsWith(`${rel}/`)));
  } catch {
    return rels;
  }
}

function show(root, spec) {
  try {
    return git(root, ["show", spec]);
  } catch {
    return "";
  }
}

function readWorktree(root, path) {
  try {
    return readFileSync(join(root, path), "utf8");
  } catch {
    return "";
  }
}
