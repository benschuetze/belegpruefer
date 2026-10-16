// Reads `git commit` out of a shell command the way the shell would split it. Pure apart from findRepoRoot, so the
// parsing is unit-tested on its own (tests/hooks/shell.test.ts) and the hook only does the git side.
import { existsSync, readdirSync } from "node:fs";
import { basename, isAbsolute, join, parse, resolve, sep } from "node:path";
import { findRepoRoot } from "./lib.mjs";

/** Long options of `git commit`; git accepts any unique prefix of them (`--amen`, `--mess x`). */
// biome-ignore format: a word list reads better in a block
const COMMIT_LONG = [
  "--all", "--patch", "--reuse-message", "--reedit-message", "--fixup", "--squash", "--reset-author", "--short",
  "--branch", "--porcelain", "--long", "--null", "--file", "--author", "--date", "--message", "--template",
  "--signoff", "--no-signoff", "--trailer", "--no-verify", "--verify", "--allow-empty", "--allow-empty-message",
  "--cleanup", "--edit", "--no-edit", "--amend", "--no-post-rewrite", "--include", "--only", "--pathspec-from-file",
  "--pathspec-file-nul", "--untracked-files", "--verbose", "--quiet", "--dry-run", "--status", "--no-status",
  "--gpg-sign", "--no-gpg-sign", "--interactive",
];
/** Long options that take the next word as their value. */
// biome-ignore format: a word list reads better on one line
const VALUE_LONG = new Set(["--message", "--file", "--reuse-message", "--reedit-message", "--author", "--date", "--fixup", "--squash", "--trailer", "--cleanup", "--template", "--pathspec-from-file"]);
const VALUE_SHORT = "mFCct";

/** Full name of a long option from its exact name or a unique prefix; null when git would refuse it as ambiguous. */
function resolveLongOption(key) {
  if (COMMIT_LONG.includes(key)) return key;
  const candidates = COMMIT_LONG.filter((o) => o.startsWith(key));
  return candidates.length === 1 ? (candidates[0] ?? null) : null;
}

/** Options of git itself that take the next word as their value (`git -C dir`, `git -c key=value`). */
const GIT_VALUE_OPTIONS = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--config-env",
  "--exec-path",
]);

/** git subcommands that leave index and working tree alone; any other before a commit changes what it commits. */
// biome-ignore format: a word list reads better on one line
const READ_ONLY_GIT = new Set(["status", "diff", "log", "show", "rev-parse", "ls-files", "describe", "blame", "grep", "shortlog", "fetch", "remote", "branch", "tag", "config", "worktree"]);
/** Words that run the next word as the program. */
// biome-ignore format: a word list reads better on one line
const PREFIXES = new Set(["command", "env", "time", "timeout", "exec", "nohup", "nice", "sudo", "then", "do", "else", "elif", "if", "while", "until", "!", "{"]);
/** Options of the wrappers that take the next word as their value (`sudo -u ben`, `env -u FOO`, `nice -n 5`). */
const PREFIX_VALUES = {
  // biome-ignore format: a word list reads better on one line
  sudo: new Set(["-u", "-g", "-h", "-p", "-C", "-D", "-U", "-r", "-t", "-R", "-T", "--user", "--group", "--host", "--chdir", "--chroot", "--prompt", "--role", "--type", "--other-user", "--close-from", "--command-timeout"]),
  env: new Set(["-u", "-C", "-S", "--unset", "--chdir", "--split-string"]),
  nice: new Set(["-n", "--adjustment"]),
  exec: new Set(["-a"]),
  timeout: new Set(["-s", "-k", "--signal", "--kill-after"]),
};

/** Index of the actual program in a simple command, after `VAR=value` and the wrappers with their options. */
function programIndex(plain) {
  let i = 0;
  while (i < plain.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(plain[i] ?? "") || PREFIXES.has(plain[i] ?? ""))) {
    const prefix = plain[i] ?? "";
    const values = PREFIX_VALUES[prefix] ?? new Set();
    i++;
    if (prefix === "{") continue;
    // `env -i`, `nice -n 5`, `sudo -u ben`: options of the wrapper, not the program.
    while (plain[i]?.startsWith("-")) i += values.has(plain[i] ?? "") ? 2 : 1;
    // `timeout 30 git commit`: the duration is a positional argument.
    if (prefix === "timeout") i++;
  }
  return i;
}

/**
 * Where `cd <word>` (or `git -C <word>`) leads from `dir`. `$(git rev-parse --show-toplevel)` is the repo root; any
 * other variable, substitution or `~` makes the directory unknown (null).
 */
function cdTarget(dir, target) {
  if (target?.text === "$(git rev-parse --show-toplevel)") return dir && findRepoRoot(dir);
  // `cd -` goes back to a directory this parser does not track.
  if (target?.text === "-") return null;
  if (!target || target.dynamic) return null;
  if (isAbsolute(target.text)) return target.text;
  return dir ? resolve(dir, target.text) : null;
}

/**
 * Every `git commit` in a shell command, with the directory it runs in (`cd`, `git -C`, null when it comes from a
 * variable), its options, and the first earlier git command that changes what gets committed. Best effort: merge,
 * cherry-pick, rebase, aliases and plumbing create commits without the word and are not covered.
 */
export function findCommits(text, base, state = { dir: base, changedBy: null, stack: [] }) {
  const found = [];
  for (const words of splitCommands(text)) {
    // A `cd` inside ( ... ) ends with the subshell.
    if (words.group === "open") state.stack.push(state.dir);
    if (words.group === "close" && state.stack.length > 0) state.dir = state.stack.pop() ?? null;
    if (words.group) continue;
    const plain = words.map((w) => w.text);
    let i = programIndex(plain);
    const program = basename(plain[i] ?? "").replace(/\.exe$/i, "");
    if (["sh", "bash", "zsh"].includes(program)) {
      const at = plain.findIndex((w, k) => k > i && /^-[a-z]*c[a-z]*$/.test(w));
      if (at !== -1 && plain[at + 1]) found.push(...findCommits(plain[at + 1], base, state));
      continue;
    }
    if (program === "cd" || program === "pushd") {
      state.dir = cdTarget(state.dir, words[i + 1]);
      continue;
    }
    if (program === "popd") {
      state.dir = null;
      continue;
    }
    if (program !== "git") continue;
    let at = state.dir;
    i++;
    while (i < plain.length && plain[i]?.startsWith("-")) {
      const flag = plain[i] ?? "";
      if (["-C", "--git-dir", "--work-tree"].includes(flag)) {
        const target = words[i + 1];
        if (flag === "-C" || flag === "--work-tree") at = cdTarget(at, target);
        i += 2;
      } else if (["-c", "--namespace", "--exec-path", "--config-env"].includes(flag)) {
        i += 2;
      } else {
        if (flag.startsWith("--work-tree=")) at = at ? resolve(at, flag.slice(12)) : null;
        i++;
      }
    }
    const sub = plain[i] ?? "";
    if (sub !== "commit") {
      if (sub && !READ_ONLY_GIT.has(sub)) state.changedBy ??= sub;
      continue;
    }
    found.push({ dir: at, stagesFirst: state.changedBy, ...parseCommitArgs(plain.slice(i + 1)) });
  }
  return found;
}

function parseCommitArgs(args) {
  const out = { all: false, amend: false, include: false, paths: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    if (a === "--") {
      out.paths.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const key = resolveLongOption(eq === -1 ? a : a.slice(0, eq));
      if (key === "--all") out.all = true;
      else if (key === "--amend") out.amend = true;
      else if (key === "--include") out.include = true;
      if (key && VALUE_LONG.has(key) && eq === -1) i++;
      continue;
    }
    if (a.startsWith("-") && a.length > 1) {
      for (const [k, ch] of [...a.slice(1)].entries()) {
        if (ch === "u" || ch === "S") break; // -uall, -S<keyid>: the rest of the word is the value
        if (ch === "a") out.all = true;
        if (ch === "i") out.include = true;
        if (VALUE_SHORT.includes(ch)) {
          if (k === a.length - 2) i++; // value is the next word, not attached
          break;
        }
      }
      continue;
    }
    out.paths.push(a);
  }
  return out;
}

/**
 * Splits a shell command into simple commands of words, honouring quotes and $( ) so a commit message or a quoted
 * path stays one word. Words built from $, ` or ~ are marked dynamic: their value is only known to the shell.
 */
function splitCommands(text, keepTargets = false) {
  const commands = [];
  let words = [];
  let word = null;
  // After a redirection the next word is its target (a file, /dev/null, &1), and after << the heredoc delimiter;
  // neither is an argument. The heredoc body is skipped at the next newline.
  let skipNext = null;
  const heredocs = [];
  const finishWord = () => {
    if (word && skipNext === "target") {
      skipNext = null;
      if (keepTargets) words.push({ ...word, target: true });
    } else if (word && skipNext === "input") {
      // The file of `< file` or `<<< word` is read, not written.
      skipNext = null;
    } else if (word && skipNext === "heredoc") {
      heredocs.push(word.text);
      skipNext = null;
    } else if (word) words.push(word);
    word = null;
  };
  const finishCommand = () => {
    finishWord();
    if (words.length > 0) commands.push(words);
    words = [];
  };
  const append = (s, dynamic = false) => {
    word ??= { text: "", dynamic: false };
    word.text += s;
    word.dynamic ||= dynamic;
  };
  const substitution = (start) => {
    // From "$(" to its matching ")". Quotes inside are not tracked: a heredoc message with "don't" would otherwise
    // swallow the rest of the command, and unbalanced parentheses in a message are rarer than apostrophes.
    let depth = 0;
    for (let j = start; j < text.length; j++) {
      if (text[j] === "(") depth++;
      else if (text[j] === ")" && --depth === 0) return j + 1;
    }
    return text.length;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i] ?? "";
    if (c === "'") {
      const end = text.indexOf("'", i + 1);
      append(text.slice(i + 1, end === -1 ? text.length : end));
      i = end === -1 ? text.length : end;
    } else if (c === '"') {
      let j = i + 1;
      let s = "";
      let dynamic = false;
      while (j < text.length && text[j] !== '"') {
        if (text[j] === "\\" && j + 1 < text.length) {
          s += text[j + 1];
          j += 2;
        } else if (text[j] === "$" && text[j + 1] === "(") {
          const end = substitution(j + 1);
          s += text.slice(j, end);
          dynamic = true;
          j = end;
        } else {
          if (text[j] === "$" || text[j] === "`") dynamic = true;
          s += text[j];
          j++;
        }
      }
      append(s, dynamic);
      i = j;
    } else if (c === "$" && text[i + 1] === "(") {
      const end = substitution(i + 1);
      append(text.slice(i, end), true);
      i = end - 1;
    } else if (c === "\\" && i + 1 < text.length) {
      append(text[i + 1] ?? "");
      i++;
    } else if (c === ">" || c === "<" || (c === "&" && text[i + 1] === ">")) {
      if (word && /^\d+$/.test(word.text)) word = null; // the file descriptor in 2>
      finishWord();
      if (text.startsWith("<<<", i)) {
        i += 2;
        skipNext = "input";
      } else if (text.startsWith("<<", i)) {
        i += text[i + 2] === "-" ? 2 : 1;
        skipNext = "heredoc";
      } else {
        const input = c === "<" && text[i + 1] !== ">";
        while (i + 1 < text.length && "<>&|".includes(text[i + 1] ?? "")) i++;
        skipNext = input ? "input" : "target";
      }
    } else if (/\s/.test(c) && c !== "\n") {
      finishWord();
    } else if (c === "\n") {
      finishCommand();
      while (heredocs.length > 0) {
        const delimiter = heredocs.shift();
        let end = text.indexOf("\n", i + 1);
        while (end !== -1 && text.slice(i + 1, end).trim() !== delimiter) {
          i = end;
          end = text.indexOf("\n", i + 1);
        }
        i = end === -1 ? text.length : end;
      }
    } else if (";&|()".includes(c)) {
      finishCommand();
      if (c === "(" || c === ")") commands.push(Object.assign([], { group: c === "(" ? "open" : "close" }));
    } else {
      append(c, c === "$" || c === "`" || (c === "~" && !word));
    }
  }
  finishCommand();
  return commands;
}

/** Programs that write every path they are given (for chmod and friends, after the mode or owner). */
const WRITES_ALL = new Set(["rm", "rmdir", "unlink", "touch", "truncate", "shred", "tee", "mv", "mkdir"]);
const WRITES_AFTER_FIRST = new Set(["chmod", "chown", "chgrp", "chflags"]);
/** Programs that write only their last path argument. */
const WRITES_LAST = new Set(["cp", "ln", "install", "rsync", "ditto", "scp"]);
/** git subcommands that write the paths they name; the others that rewrite the tree make the result unknown. */
const GIT_WRITES_PATHS = new Set(["rm", "mv"]);
// biome-ignore format: a word list reads better on one line
const GIT_WRITES_TREE = new Set(["reset", "stash", "apply", "am", "clean", "merge", "rebase", "pull", "cherry-pick", "revert"]);
const INTERPRETERS = new Set(["node", "python", "python3", "ruby", "perl", "deno", "bun", "osascript", "tsx"]);

const plainArgs = (args) => args.filter((w) => !w.text.startsWith("-"));

/** The words a command writes to (redirections aside), or "unknown" when it may write files it does not name. */
function writes(words) {
  const program = basename(words[0]?.text ?? "");
  const args = words.slice(1).filter((w) => !w.target);
  const texts = args.map((w) => w.text);
  if (WRITES_ALL.has(program)) return plainArgs(args);
  if (WRITES_AFTER_FIRST.has(program)) return plainArgs(args).slice(1);
  if (WRITES_LAST.has(program)) return plainArgs(args).slice(-1);
  if (program === "dd")
    return args.filter((w) => w.text.startsWith("of=")).map((w) => ({ ...w, text: w.text.slice(3) }));
  const inPlace = texts.some((a) => /^-[a-zA-Z]*i/.test(a) || a.startsWith("--in-place"));
  if (program === "sed" || (program === "perl" && inPlace)) {
    if (!texts.some((a) => /^-[a-zA-Z]*i/.test(a) || a.startsWith("--in-place"))) {
      return program === "perl" && texts.some((a) => /^-[a-zA-Z]*e$/.test(a)) ? "unknown" : [];
    }
    return plainArgs(args).filter((w) => !/^s(.).*\1.*\1[a-z]*$/.test(w.text));
  }
  if (program === "awk" || program === "gawk") return texts.includes("inplace") ? plainArgs(args).slice(1) : [];
  if (program === "find") {
    if (!texts.some((a) => ["-delete", "-exec", "-execdir", "-ok", "-okdir"].includes(a))) return [];
    const roots = [];
    for (const w of args) {
      if (w.text.startsWith("-") || w.text === "(" || w.text === "!") break;
      roots.push(w);
    }
    return roots;
  }
  if (program === "patch" || program === "unzip" || program === "tar") return "unknown";
  // Inline code (`-c`, `-e`, `--eval`) or a script read from stdin (`python3 - <<EOF`, no script at all) may write
  // anything. A named script is not seen.
  if (INTERPRETERS.has(program)) {
    const inline = texts.some((a) => /^-[a-zA-Z]*[cepE]$/.test(a) || /^--(eval|print|command)\b/.test(a));
    if (inline || texts.includes("-") || plainArgs(args).length === 0) return "unknown";
  }
  if (program === "git") {
    let k = 0;
    while (k < texts.length && texts[k]?.startsWith("-")) k += GIT_VALUE_OPTIONS.has(texts[k] ?? "") ? 2 : 1;
    const sub = texts[k];
    const rest = args.slice(k + 1);
    if (!sub) return [];
    if (GIT_WRITES_PATHS.has(sub)) return plainArgs(rest.filter((w) => w.text !== "--"));
    if (sub === "switch") return rest.some((w) => /^(-c|-C|--create|--force-create)$/.test(w.text)) ? [] : "unknown";
    if (sub === "checkout" || sub === "restore") {
      if (rest.some((w) => /^(-b|-B|--orphan)$/.test(w.text))) return [];
      const dashes = rest.findIndex((w) => w.text === "--");
      if (dashes !== -1) return rest.slice(dashes + 1);
      return sub === "restore" && plainArgs(rest).length > 0 ? plainArgs(rest) : "unknown";
    }
    return GIT_WRITES_TREE.has(sub) ? "unknown" : [];
  }
  return [];
}

/**
 * The files an unquoted glob in a written path matches now, the way the shell expands it (`*` and `?` do not match
 * a leading dot). No match: the shell passes the word on literally, so it is returned as it is.
 */
function expandGlob(path) {
  if (!/[*?[]/.test(path)) return [path];
  let found = [parse(path).root];
  for (const part of path.split(sep).filter(Boolean)) {
    if (!/[*?[]/.test(part)) {
      found = found.map((base) => join(base, part));
      continue;
    }
    const pattern = part
      .replace(/[.+^${}()|\\]/g, "\\$&")
      .replace(/\[!/g, "[^")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".");
    const re = new RegExp(`^${pattern}$`);
    const next = [];
    for (const base of found) {
      let names = [];
      try {
        names = readdirSync(base);
      } catch {
        // Not a directory: nothing below it matches.
      }
      for (const name of names) {
        if (re.test(name) && (part.startsWith(".") || !name.startsWith("."))) next.push(join(base, name));
      }
    }
    found = next.slice(0, 1000);
  }
  return found.length > 0 ? found : [path];
}

/** Simple commands of the shell command with the directory each runs in, `sh -c` and subshells included. */
function steps(text, state, out) {
  for (const words of splitCommands(text, true)) {
    if (words.group === "open") state.stack.push(state.dir);
    if (words.group === "close" && state.stack.length > 0) state.dir = state.stack.pop() ?? null;
    if (words.group) continue;
    const plain = words.map((w) => w.text);
    const i = programIndex(plain);
    const program = basename(plain[i] ?? "");
    if (["sh", "bash", "zsh"].includes(program)) {
      const at = plain.findIndex((w, k) => k > i && /^-[a-z]*c[a-z]*$/.test(w));
      const script = plain[at + 1];
      if (at !== -1 && script) {
        // A child shell: its `cd` does not reach the commands after it.
        const dir = state.dir;
        steps(script, { dir, stack: [] }, out);
        state.dir = dir;
      }
      continue;
    }
    if (program === "cd" || program === "pushd") {
      state.dir = cdTarget(state.dir, words[i + 1]);
      continue;
    }
    if (program === "popd") {
      state.dir = null;
      continue;
    }
    let k = i + 1;
    while (program === "git" && k < plain.length && plain[k]?.startsWith("-")) {
      k += GIT_VALUE_OPTIONS.has(plain[k] ?? "") ? 2 : 1;
    }
    out.push({
      words: words.slice(i),
      targets: words.filter((w) => w.target),
      dir: state.dir,
      commit: program === "git" && plain[k] === "commit",
    });
  }
  return out;
}

/**
 * What the commands before the last `git commit` in the shell command write: arguments of known writers (rm, mv,
 * cp/ln/rsync targets, tee, touch, mkdir, dd of=, sed/perl -i, awk inplace, find -delete/-exec, git rm/mv/checkout/
 * restore) and every output redirection, each resolved against the directory its command runs in (`cd`, subshells,
 * `sh -c`). Readers and input redirections do not count, so naming a protected file to read it asks nothing.
 * `unknown` names the first command or path whose writes could not be determined: a variable or unknown directory,
 * or a command that may write files it does not name (patch, tar, git apply/pull/merge, inline interpreter code).
 * Writes after the last commit do not change it. Programs not listed (formatters, build tools) are not seen.
 */
export function writtenPaths(text, base) {
  const all = steps(text, { dir: base, stack: [] }, []);
  const last = all.findLastIndex((s) => s.commit);
  const paths = [];
  let unknown = null;
  for (const { words, targets, dir } of all.slice(0, Math.max(last, 0))) {
    const named = writes(words);
    if (named === "unknown") {
      unknown ??= words
        .slice(0, 2)
        .map((w) => w.text)
        .join(" ");
      continue;
    }
    for (const word of [...named, ...targets]) {
      // `2>&1` leaves `1`, `>&-` leaves `-`: file descriptors, not files.
      if (word.text === "" || word.text.startsWith("/dev/") || /^(\d+|-)$/.test(word.text)) continue;
      if (dir === null || word.dynamic) {
        unknown ??= word.text;
        continue;
      }
      paths.push(...expandGlob(resolve(dir, word.text)));
    }
  }
  return { paths, unknown };
}
