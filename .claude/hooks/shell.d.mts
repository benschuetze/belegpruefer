export type Commit = {
  /** Directory the commit runs in; null when it comes from a variable or substitution. */
  dir: string | null;
  /** First earlier git subcommand in the same shell command that changes index or working tree. */
  stagesFirst: string | null;
  all: boolean;
  amend: boolean;
  include: boolean;
  /** `--pathspec-from-file`: the paths are in a file the hook does not read. */
  pathspecFile: boolean;
  /** A GIT_INDEX_FILE, GIT_DIR or similar prefix that points git elsewhere; null if none. */
  gitEnv: string | null;
  paths: string[];
};

export function findCommits(text: string, base: string): Commit[];

/**
 * Absolute paths that commands before the last commit may write (known writers and output redirections), and the
 * first command or path whose writes could not be determined.
 */
export function writtenPaths(text: string, base: string): { paths: string[]; unknown: string | null };
