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
