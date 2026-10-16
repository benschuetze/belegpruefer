export type Commit = {
  /** Directory the commit runs in; null when it comes from a variable or substitution. */
  dir: string | null;
  /** First earlier git subcommand in the same shell command that changes index or working tree. */
  stagesFirst: string | null;
  all: boolean;
  amend: boolean;
  include: boolean;
  paths: string[];
};

export function findCommits(text: string, base: string): Commit[];

/**
 * Absolute paths that commands before the last commit may write (known writers and output redirections), and the
 * first command or path whose writes could not be determined.
 */
export function writtenPaths(text: string, base: string): { paths: string[]; unknown: string | null };
