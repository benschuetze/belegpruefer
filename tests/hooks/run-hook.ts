import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const HOOKS = join(import.meta.dirname, "../../.claude/hooks");

export type HookResult = {
  status: number | null;
  stderr: string;
  decision?: "allow" | "deny" | "ask";
  reason?: string;
  context?: string;
};

/**
 * The test's own environment without what would leak into the hook or into git: a limit set for the developer's
 * session, a CLAUDE_PROJECT_DIR of the real checkout, GIT_DIR from a git hook running `pnpm check`.
 */
function cleanEnv(extra: Record<string, string>) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (
      value === undefined ||
      key.startsWith("GIT_") ||
      key.startsWith("BELEGPRUEFER_") ||
      key === "CLAUDE_PROJECT_DIR"
    )
      continue;
    env[key] = value;
  }
  return { ...env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", ...extra };
}

/** Runs a hook script the way Claude Code does: payload on stdin, decision as JSON on stdout. */
export function runHook(script: string, stdin: string, env: Record<string, string> = {}): HookResult {
  const result = spawnSync(process.execPath, [join(HOOKS, script)], {
    input: stdin,
    encoding: "utf8",
    env: cleanEnv(env),
  });
  const out = result.stdout.trim();
  const parsed = out ? JSON.parse(out).hookSpecificOutput : {};
  return {
    status: result.status,
    stderr: result.stderr,
    decision: parsed.permissionDecision,
    reason: parsed.permissionDecisionReason,
    context: parsed.additionalContext,
  };
}

/** A throwaway git repository with one initial commit, so tracked and staged files behave as in the real repo. */
export function makeRepo(files: Record<string, string>) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "hook-test-")));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "ignore"], env: cleanEnv({}), encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  for (const [path, content] of Object.entries({ "README.md": "x\n", ...files })) write(path, content);
  git("add", "-A");
  git("commit", "-qm", "init");
  return {
    root,
    write,
    git,
    stage: (...paths: string[]) => git("add", "--", ...paths),
    remove: () => rmSync(root, { recursive: true, force: true }),
  };
}

export const lines = (n: number, prefix = "line") =>
  `${Array.from({ length: n }, (_, i) => `${prefix} ${i}`).join("\n")}\n`;
