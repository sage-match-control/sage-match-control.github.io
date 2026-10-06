// The baseline tree (site-engine-spec §6.3): the repo at the merge-base with
// main, checked out into a temporary git worktree and removed when the run
// ends. The BASE environment variable names another commit.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SITE_ROOT } from './paths.mjs';

const git = (...args) => execFileSync('git', args, { cwd: SITE_ROOT, encoding: 'utf8' }).trim();

export function baselineCommit() {
  return process.env.BASE || git('merge-base', 'HEAD', 'main');
}

/** Check the baseline out. Returns `{ dir, commit, remove() }`. */
export function checkoutBaseline() {
  const commit = baselineCommit();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sage-baseline-'));
  git('worktree', 'add', '--detach', dir, commit);
  return {
    dir,
    commit,
    remove() {
      try { git('worktree', 'remove', '--force', dir); } catch { /* already gone */ }
      try { git('worktree', 'prune'); } catch { /* ignore */ }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
