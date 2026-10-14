// PreToolUse guard for Read/Edit/Write/MultiEdit/NotebookEdit: the paths CLAUDE.md lists under "Nicht ohne Rückfrage
// ändern", plus the guardrails themselves. settings.json denies the hard cases too; this hook adds the reason and the
// way forward, and handles what a glob cannot express (committed vs. new migration, comments vs. code in skr03.ts).
// Changes made around it through Bash are caught at commit time by guard-commit-size.mjs.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  changedNumbers,
  decide,
  findRepoRoot,
  git,
  isProjectRepo,
  note,
  readInput,
  realPath,
  repoRelative,
  SKR03_PATH,
  skr03Code,
} from "./lib.mjs";

const input = await readInput();
const toolInput = input?.tool_input;
const rawPath = toolInput?.file_path ?? toolInput?.notebook_path;
if (typeof rawPath !== "string" || rawPath === "") process.exit(0);

const filePath = realPath(resolve(typeof input.cwd === "string" ? input.cwd : process.cwd(), rawPath));
const root = findRepoRoot(filePath);
if (!root) process.exit(0);
const rel = repoRelative(root, filePath);
if (rel.startsWith("../")) process.exit(0);
const name = rel.split("/").pop() ?? "";
const reading = input.tool_name === "Read";

const ASK_BEN = "Frag Ben im Chat mit dem geplanten Diff und warte auf sein Ja.";

if (/^\.env(\..*)?$/.test(name) && name !== ".env.example") {
  decide(
    "deny",
    `${rel} enthält Zugangsdaten und ist für Claude gesperrt, lesend und schreibend. Neue Variablen gehören nach .env.example; Werte setzt Ben selbst (lokal oder per vercel env add).`,
  );
} else if (reading) {
  // Everything else may be read.
} else if (rel.startsWith(".claude/hooks/") || /^\.claude\/settings(\.local)?\.json$/.test(rel)) {
  decide(
    "ask",
    `${rel} gehört zu den Leitplanken selbst; wer sie ändert, kann sie abschalten (disableAllHooks, Grenze, Ausnahme). ${ASK_BEN}`,
  );
} else if (rel.startsWith(".github/workflows/")) {
  decide(
    "ask",
    `${rel}: Workflows stehen in CLAUDE.md unter „Nicht ohne Rückfrage ändern“ (Actions auf Commit-SHA gepinnt, minimale permissions). ${ASK_BEN}`,
  );
} else if (rel.startsWith("drizzle/meta/")) {
  decide(
    "deny",
    `${rel} erzeugt drizzle-kit. Schema in app/lib/db/schema.ts ändern und pnpm db:generate (Skill db-change).`,
  );
} else if (rel.startsWith("drizzle/")) {
  const committed = inHead(root, rel);
  if (committed === true) {
    decide(
      "deny",
      `${rel} ist schon committet und lief womöglich schon gegen die Demo-Datenbank. Eine Korrektur ist eine neue Migration: pnpm drizzle-kit generate --custom --name … (Skill db-change).`,
    );
  } else if (committed === undefined) {
    decide("ask", `${rel}: Ob die Migration schon committet ist, ließ sich nicht prüfen (git). ${ASK_BEN}`);
  }
  // Not in HEAD: the fresh --custom migration that db-change says to write by hand.
} else if (rel === "evals/belege.json") {
  decide(
    "deny",
    `${rel} erzeugt evals/generate.ts aus von Hand festgelegten Vorlagen. Erwartungswerte dort ändern, nach Rückfrage bei Ben, dann pnpm tsx evals/generate.ts; Agent tax-reviewer prüft.`,
  );
} else if (rel === "evals/generate.ts") {
  decide(
    "ask",
    `${rel} legt die Erwartungswerte der Eval fest (CLAUDE.md: nicht ohne Rückfrage, nie vom Modell). Agent tax-reviewer prüft. ${ASK_BEN}`,
  );
} else if (rel === SKR03_PATH) {
  let before = "";
  try {
    before = readFileSync(filePath, "utf8");
  } catch {}
  const after = applyEdit(before, input.tool_name, toolInput);
  if (after === null) process.exit(0); // The edit does not apply; the tool itself will refuse it.
  if (skr03Code(before) === skr03Code(after)) {
    note(`${rel}: nur Kommentare oder Leerraum geändert, geht durch. Jede Code-Änderung hier braucht eine Rückfrage.`);
  } else {
    const { removed, added } = changedNumbers(skr03Code(before), skr03Code(after));
    const numbers =
      removed.length + added.length > 0
        ? ` Zahlen weg: ${removed.join(", ") || "–"}; neu: ${added.join(", ") || "–"}.`
        : "";
    decide(
      "ask",
      `${rel}: Konten, BU-Schlüssel, Grenzen und Merkmale (risk, asset) sind fachlich geprüft; laut CLAUDE.md nicht ohne Rückfrage ändern, Agent tax-reviewer.${numbers} ${ASK_BEN}`,
    );
  }
}

/** true: in HEAD; false: not in HEAD (or no HEAD yet); undefined: git did not run or the repository is not ours. */
function inHead(cwd, path) {
  if (!isProjectRepo(cwd)) return undefined;
  try {
    git(cwd, ["rev-parse", "--verify", "--quiet", "HEAD"]);
  } catch (error) {
    return error?.code === "ENOENT" ? undefined : false;
  }
  // Compared in lower case: on macOS and Windows "Drizzle/0000.sql" is the committed file, and on Linux refusing a
  // look-alike new file costs a question, not data.
  try {
    const committed = git(cwd, ["ls-tree", "-r", "--name-only", "-z", "HEAD"]);
    return committed.split("\0").some((p) => p.toLowerCase() === path);
  } catch (error) {
    return error?.code === "ENOENT" ? undefined : false;
  }
}

/** The file as it will be after the tool call, or null when an edit does not match. */
function applyEdit(text, toolName, args) {
  if (toolName === "Write") return String(args.content ?? "");
  const edits = Array.isArray(args.edits) ? args.edits : [args];
  let out = text;
  for (const e of edits) {
    const oldString = String(e?.old_string ?? "");
    const newString = String(e?.new_string ?? "");
    if (oldString === "" || !out.includes(oldString)) return null;
    out = e?.replace_all ? out.split(oldString).join(newString) : out.replace(oldString, () => newString);
  }
  return out;
}
