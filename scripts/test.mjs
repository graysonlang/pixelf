// Test runner: bundle every test file with esbuild, then hand the output to
// `node --test`.
//
// The bundling step is not incidental. Node's built-in type stripping cannot
// resolve TypeScript's `.js` import specifiers back to the `.ts` files they
// name, so `node --test` alone breaks the moment a test imports typed source.
// esbuild's resolver maps `.js` -> `.ts` and inlines the module graph, so one
// code path covers plain JS and TypeScript tests alike.
//
// Bundling also means tests reach `src/` through the same resolution rules the
// real build uses, rather than through Node's, so a test cannot pass against an
// import shape the bundler would reject.

import { spawn } from 'node:child_process';
import { glob, rm } from 'node:fs/promises';
import { build } from 'esbuild';
import { createDefines } from './defines.mjs';

const OUT = 'dist-tests';
const PATTERNS = [
  'test/**/*.test.js',
  'test/**/*.test.mjs',
  'test/**/*.test.ts',
  'test/**/*.test.mts',
];

const entryPoints = [];
for await (const file of glob(PATTERNS)) entryPoints.push(file);

if (entryPoints.length === 0) {
  console.error(`No test files matched:\n  ${PATTERNS.join('\n  ')}`);
  process.exit(1);
}

await rm(OUT, { recursive: true, force: true });

await build({
  entryPoints,
  outdir: OUT,
  define: createDefines(),
  outbase: 'test',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'esnext',
  sourcemap: 'inline',
  logLevel: 'warning',
  // Keep real dependencies external so tests exercise the installed package,
  // not a copy inlined into the bundle.
  packages: 'external',
});

// `--enable-source-maps` makes the inline maps above resolve, so a failing
// assertion points at the test's own line rather than the bundled one.
const child = spawn(process.execPath, ['--enable-source-maps', '--test', `${OUT}/**/*.test.mjs`], {
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
