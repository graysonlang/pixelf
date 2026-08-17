// Ambient declarations for things the bundler provides that the type system
// cannot infer on its own. Nothing here emits; these exist so `npm run
// typecheck` sees the same world the build does.

// Build-time constants substituted by esbuild's `define` (see scripts/build.mjs).
// They are not runtime globals - after bundling, the literal value is inlined.
declare const __APP_VERSION__: string;
declare const __COMMIT_SHA__: string;

// Asset imports handled by esbuild loaders rather than by module resolution.
// Each resolves to the emitted file's path at build time. Add a block here for
// any new loader entry in scripts/build.mjs, or typecheck will not find it.
declare module '*.html' {
  const path: string;
  export default path;
}
