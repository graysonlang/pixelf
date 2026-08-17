// Example test, and a real one: it pins the shape of the only thing this
// template exports. Delete it once the project has tests of its own.
//
// Note the import specifier is `../src/index.js` even though the runner
// bundles first - that is the same path the app uses, and esbuild resolves it
// the same way. If `src/index.js` becomes `src/index.ts`, this line does not
// change.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildInfo } from '../src/index.js';

describe('buildInfo', () => {
  it('exposes version and commit as strings', () => {
    assert.equal(typeof buildInfo.version, 'string');
    assert.equal(typeof buildInfo.commit, 'string');
  });

  it('is frozen, so nothing can rewrite build provenance at runtime', () => {
    assert.ok(Object.isFrozen(buildInfo));
  });
});
