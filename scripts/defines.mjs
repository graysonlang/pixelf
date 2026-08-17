// Build-time constants, shared by the build (scripts/build.mjs) and the test
// runner (scripts/test.mjs). Both bundle `src/`, so both have to substitute
// these - a test bundle without them throws ReferenceError on first use.
//
// The matching ambient declarations live in types/globals.d.ts.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url);

/**
 * Best-effort description of a thrown value, preferring a subprocess's stderr.
 * @param {unknown} err
 * @returns {string}
 */
function describeError(err) {
  if (typeof err === 'object' && err !== null && 'stderr' in err) {
    const { stderr } = /** @type {{ stderr?: unknown }} */ (err);
    if (typeof stderr === 'string' && stderr.trim()) return stderr.trim();
  }
  return err instanceof Error ? err.message : String(err);
}

/** @returns {string} */
function readCommitSha() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (err) {
    // Detached CI checkouts have no git dir but do export GITHUB_SHA.
    const sha = (process.env.GITHUB_SHA ?? 'unknown').slice(0, 12);
    console.warn(`Could not read commit SHA, using "${sha}" (${describeError(err)}).`);
    return sha;
  }
}

/**
 * esbuild `define` map for the build-time constants.
 * @returns {Record<string, string>}
 */
export function createDefines() {
  const pkg = JSON.parse(readFileSync(new URL('package.json', ROOT), 'utf8'));
  return {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __COMMIT_SHA__: JSON.stringify(readCommitSha()),
  };
}
