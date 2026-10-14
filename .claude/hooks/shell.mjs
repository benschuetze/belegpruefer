// Reads `git commit` out of a shell command the way the shell would split it. Pure apart from findRepoRoot, so the
// parsing is unit-tested on its own (tests/hooks/shell.test.ts) and the hook only does the git side.
import { basename, isAbsolute, resolve } from "node:path";
import { findRepoRoot } from "./lib.mjs";

/** Options of `git commit` that take the next word as their value. */
const VALUE_LONG =
  /^--(message|file|reuse-message|reedit-message|author|date|fixup|squash|trailer|cleanup|template|pathspec-from-file)$/;
const VALUE_SHORT = "mFCct";

/** git subcommands that leave index and working tree alone; any other before a commit changes what it commits. */
// biome-ignore format: a word list reads better on one line
const READ_ONLY_GIT = new Set(["status", "diff", "log", "show", "rev-parse", "ls-files", "describe", "blame", "grep", "shortlog", "fetch", "remote", "branch", "tag", "config", "worktree"]);
/** Words that run the next word as the program. */
// biome-ignore format: a word list reads better on one line
const PREFIXES = new Set(["command", "env", "time", "exec", "nohup", "nice", "then", "do", "else", "elif", "if", "while", "until", "!", "{"]);

/**
 * Every `git commit` in a shell command, with the directory it runs in (`cd`, `git -C`, null when it comes from a
 * variable), its options, and the first earlier git command that changes what gets committed. Best effort: merge,
 * cherry-pick, rebase, aliases and plumbing create commits without the word and are not covered.
 */
export function findCommits(text, base, state = { dir: base, changedBy: null }) {
  const found = [];
  for (const words of splitCommands(text)) {
    const plain = words.map((w) => w.text);
    let i = 0;
    while (i < plain.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(plain[i] ?? "") || PREFIXES.has(plain[i] ?? ""))) {
      i++;
      // `env -i`, `nice -n 5`: options of the wrapper, not the program.
      while (plain[i - 1] !== "{" && plain[i]?.startsWith("-")) i += /^-[nu]$/.test(plain[i] ?? "") ? 2 : 1;
    }
    const program = basename(plain[i] ?? "").replace(/\.exe$/i, "");
    if (["sh", "bash", "zsh"].includes(program)) {
      const at = plain.findIndex((w, k) => k > i && /^-[a-z]*c[a-z]*$/.test(w));
      if (at !== -1 && plain[at + 1]) found.push(...findCommits(plain[at + 1], base, state));
      continue;
    }
    if (program === "cd") {
      const target = words[i + 1];
      if (target?.text === "$(git rev-parse --show-toplevel)" && state.dir) state.dir = findRepoRoot(state.dir);
      else if (!target || target.dynamic) state.dir = null;
      else if (isAbsolute(target.text)) state.dir = target.text;
      else state.dir = state.dir ? resolve(state.dir, target.text) : null;
      continue;
    }
    if (program !== "git") continue;
    let at = state.dir;
    i++;
    while (i < plain.length && plain[i]?.startsWith("-")) {
      const flag = plain[i] ?? "";
      if (["-C", "--git-dir", "--work-tree"].includes(flag)) {
        const target = words[i + 1];
        if (flag === "-C" || flag === "--work-tree") {
          at =
            !target || target.dynamic ? null : isAbsolute(target.text) ? target.text : at && resolve(at, target.text);
        }
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
      if (a === "--all") out.all = true;
      else if (a === "--amend") out.amend = true;
      else if (a === "--include") out.include = true;
      else if (VALUE_LONG.test(a)) i++;
      continue;
    }
    if (a.startsWith("-") && a.length > 1) {
      for (const [k, ch] of [...a.slice(1)].entries()) {
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
function splitCommands(text) {
  const commands = [];
  let words = [];
  let word = null;
  // After a redirection the next word is its target (a file, /dev/null, &1), and after << the heredoc delimiter;
  // neither is an argument. The heredoc body is skipped at the next newline.
  let skipNext = null;
  const heredocs = [];
  const finishWord = () => {
    if (word && skipNext === "target") skipNext = null;
    else if (word && skipNext === "heredoc") {
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
        skipNext = "target";
      } else if (text.startsWith("<<", i)) {
        i += text[i + 2] === "-" ? 2 : 1;
        skipNext = "heredoc";
      } else {
        while (i + 1 < text.length && "<>&|".includes(text[i + 1] ?? "")) i++;
        skipNext = "target";
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
    } else {
      append(c, c === "$" || c === "`" || (c === "~" && !word));
    }
  }
  finishCommand();
  return commands;
}
