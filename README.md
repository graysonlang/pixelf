# repo-template

The starting point for a new project: [`@graysonlang/esp`](https://github.com/graysonlang/esp) build tooling and VS Code integration, plus the repo support shape — agent guidance, TypeScript validation, a test harness, and CI — that every project ends up needing anyway.

## What this is

`esp` is a set of esbuild plugins and a build runner designed to streamline frontend development. This repo is the starting point for a new esp-based project, and doubles as a check that esp's example configuration and VS Code integration work correctly outside of the esp repo itself — i.e., as a real consumer would use it.

Beyond the build wiring it carries four things that are tedious to rebuild per project and prone to drifting apart when you do:

- [AGENTS.md](AGENTS.md) — the coding, markdown, and commit conventions AI assistants are held to
- [tsconfig.json](tsconfig.json) + [types/](types/) — type validation over JS and TS alike, including declarations for the untyped things the bundler provides
- [scripts/test.mjs](scripts/test.mjs) — a dependency-free test harness over `node --test`
- [.github/workflows/ci.yml](.github/workflows/ci.yml) — the same four gates you run locally

Everything that can be a dependency still lives in esp; nothing above adds a runtime dependency.

## Using this as a template

This repo is a GitHub template — click **Use this template** to start a new project from it, or clone it directly. There is no scaffolding CLI and no prompts; everything that can be a dependency lives in `esp`, so the checked-in surface is small enough to adjust by hand.

After creating your repo, edit [package.json](package.json):

- `name`, `version`, `description`, `homepage`, `bugs.url`, `repository.url` — point these at your project
- keep `private: true` unless you actually intend to publish

Leave `config.esp_dev_cert_name` alone — it names the shared esp local development certificate used by the `https` scripts, not anything specific to this project.

Then replace [app/](app/) and [src/](src/) with your own sources, updating `entryPoints` in [scripts/build.mjs](scripts/build.mjs) to match. The VS Code workspace file is [main.code-workspace](main.code-workspace) — deliberately generic, so there is nothing to rename.

Two more files want a look before you start:

- [AGENTS.md](AGENTS.md) — replace the **Project** section with what your project is. Everything under **Hard rules** is meant to carry across projects unchanged.
- [test/build-info.test.js](test/build-info.test.js) — an example test that also pins the template's only export. Delete it once you have tests of your own; `npm test` fails on an empty `test/` rather than passing vacuously, which is deliberate.

Ports are derived from the absolute path of `scripts/build.mjs`, so every clone and worktree gets its own http/https/debug ports and two of them never collide — there is nothing to configure. Run `npm run ports` to see the ones for your checkout.

## Output directory convention

Two output directories, with fixed meanings across esp-based projects:

- **`www/`** — the built web content: the demo/app page, what the dev server serves and what deploys to GitHub Pages. This is what `scripts/build.mjs` emits, and it is never published to npm.
- **`dist/`** — the source distribution: a packaged library bundle plus type declarations, pointed at by `main`/`types`/`exports` and listed in `files`. Emitted by a separate `scripts/dist.mjs` using esbuild and `tsc` directly, not by esp's runner.

This template only produces `www/`, since it is an app rather than a library. `dist/` is gitignored anyway so that adding a library build later needs no other changes — the two never contend for the same directory.

## GitHub Pages

[.github/workflows/pages.yml](.github/workflows/pages.yml) builds `www/` and deploys it to GitHub Pages, but it is **off by default** — a repo created from this template will not try to publish, and will not fail CI, until you ask it to.

To publish, first point Pages at Actions once: **Settings → Pages → Build and deployment → Source → GitHub Actions**. The default there is branch-based, which this workflow cannot deploy to.

Then either publish on demand — **Actions → Deploy to GitHub Pages → Run workflow** — or deploy on every push to `main` by adding an Actions variable (**Settings → Secrets and variables → Actions → Variables → New repository variable**):

| Name | Value |
| --- | --- |
| `ENABLE_PAGES` | `true` |

Without the variable, pushes skip the job — a neutral result rather than a failed run. Manual runs work either way.

## Build info

[scripts/build.mjs](scripts/build.mjs) substitutes two constants at build time via esbuild's `define`: `__APP_VERSION__` (from `package.json`) and `__COMMIT_SHA__` (`git rev-parse --short HEAD`, falling back to `GITHUB_SHA` for detached CI checkouts, then `unknown`). [src/index.js](src/index.js) reads them and re-exports them as a frozen `buildInfo` object, so nothing outside that module touches the raw globals:

```js
import { buildInfo } from './src/index.js';
console.info(`${buildInfo.version} (${buildInfo.commit})`);
```

Because these are compile-time substitutions rather than runtime lookups, there is no `package.json` read and no `child_process` in the shipped bundle.

The substitution map lives in [scripts/defines.mjs](scripts/defines.mjs) rather than inline in the build, because the test runner bundles `src/` too and needs the identical map — a test bundle without it throws `ReferenceError` the first time anything reads `buildInfo`.

## Verification

Four gates, cheapest first. [.github/workflows/ci.yml](.github/workflows/ci.yml) runs the same four under the same names, and `npm run check` chains them locally:

```sh
npm run typecheck   # tsc --noEmit
npm run lint        # biome check .
npm test            # bundle tests, then node --test
npm run build       # esbuild, via esp's runner
```

### Linting and formatting

[biome.jsonc](biome.jsonc) covers both, replacing ESLint and `@stylistic/eslint-plugin` — 2 installed packages instead of ~75. Beyond the size difference it buys two things:

- **TypeScript is actually linted.** ESLint silently skipped `.ts` files here, so a TypeScript file passed `npm run lint` without being looked at. Closing that under ESLint needs `typescript-eslint`; under Biome it is the default.
- **Correctness rules, not just formatting.** The old config was `@stylistic` only, which checks layout and nothing else.

`npm run lint:fix` applies formatting and safe fixes. `lineWidth` is 100 rather than Biome's default 80, chosen from the line-length distribution across these projects.

One exclusion matters: `.vscode/launch_template.json` is not valid JSON — it holds `{{debug}}` placeholders that esp substitutes when rendering `launch.json` — so Biome must not try to parse it. Every esp-based repo has this file, so the exclusion belongs in every biome.jsonc.

The one rule with no Biome equivalent is `space-before-function-paren`, whose anonymous/named/asyncArrow split Biome's formatter does not model.

### Type validation

[tsconfig.json](tsconfig.json) is `strict`, `noEmit`, and — the part that matters for a JS-first template — `allowJs` + `checkJs`. Plain `.js` files are typechecked from inference and JSDoc, so the gate is real before a single `.ts` file exists, and adding one changes nothing about the setup.

That only works if the type system can see what the bundler injects, which is what [types/](types/) is for:

- [types/globals.d.ts](types/globals.d.ts) — the `define` constants (`__APP_VERSION__`, `__COMMIT_SHA__`) and the `*.html` asset-import shape. Add a block here for any new `loader` entry in the build, or typecheck will not find it.
- [types/esp.d.ts](types/esp.d.ts) — esp ships plain JS with no declarations, so this describes the subpaths the template imports. Without it, `checkJs` reports every esp import as an implicit `any`. Delete it if esp ever ships its own types.

**Known gap:** ESLint does not lint `.ts` files here — it silently skips them rather than erroring, so a TypeScript file passes `npm run lint` without being looked at. Closing that means adding `typescript-eslint`. Typechecking does cover `.ts`, so this is a style-and-correctness-rules gap, not a type-safety one.

### Testing

[scripts/test.mjs](scripts/test.mjs) globs `test/**/*.test.{js,mjs,ts,mts}`, bundles each entry with esbuild into the gitignored `dist-tests/`, then runs `node --test` over the output. No test framework, no test dependency — [`node:test`](https://nodejs.org/api/test.html) and `node:assert` are the whole surface.

The bundling step is what earns its keep. Node's built-in type stripping cannot resolve TypeScript's `.js` import specifiers back to the `.ts` files they name, so `node --test` on its own breaks as soon as a test imports typed source. esbuild's resolver maps `.js` to `.ts` and inlines the graph, so one code path covers both languages. It also means tests resolve `src/` exactly the way the real build does — a test cannot pass against an import shape the bundler would reject. Real dependencies stay external, and inline source maps plus `--enable-source-maps` keep failures pointing at your line rather than the bundled one.

## Structure

- [scripts/build.mjs](scripts/build.mjs) — the build script, which wires up esp's `runBuild` runner with project-specific esbuild options (entry points, plugins, output directory, etc.)
- [scripts/defines.mjs](scripts/defines.mjs) — the build-time constant map, shared by the build and the test runner
- [scripts/test.mjs](scripts/test.mjs) — the test runner (bundle, then `node --test`)
- [app/main.js](app/main.js) — the app entry point
- [src/index.js](src/index.js) — the library entry point, exporting `buildInfo` (see below)
- [test/](test/) — tests, discovered as `**/*.test.{js,mjs,ts,mts}`
- [types/](types/) — ambient declarations for the untyped surfaces the build relies on
- [AGENTS.md](AGENTS.md) — conventions for AI coding assistants; the hard rules are meant to travel between projects unchanged
- [.editorconfig](.editorconfig) — the same indentation and whitespace rules at the editor level, so hand edits match too
- [.vscode/extensions.json](.vscode/extensions.json) — recommended extensions for this workspace
- [.vscode/tasks.json](.vscode/tasks.json) — VS Code tasks that invoke the `vscode:build` and `vscode:debug` npm scripts, with a custom problem matcher to surface esbuild errors and warnings inline in the editor
- [.vscode/launch_template.json](.vscode/launch_template.json) — source of truth for the VS Code launch configurations that attach Chrome to the dev server with source maps, using the debug tasks as `preLaunchTask`. The runner renders it to `.vscode/launch.json` (gitignored, since the ports are per-checkout) on `npm install` and on every serve/watch; render it by hand with `npm run sync:launch`

## Usage

Install dependencies:

```sh
npm install
```

**Build** (one-shot, minified):

```sh
npm run build
```

**Dev server** (watch mode, source maps, auto-launches browser):

```sh
npm run dev
```

**VS Code** — open the workspace (`main.code-workspace`), then use the default build task (`Cmd+Shift+B`) to build, or launch "Debug in Chrome" from the Run and Debug panel to start the dev server and attach the debugger.

## VS Code integration notes

The tasks in [.vscode/tasks.json](.vscode/tasks.json) use a `background` problem matcher that watches for the `[esbuild-ready]` sentinel line emitted by esp's dev server, which tells VS Code when the initial build is complete and the browser can be launched. The "Kill debug server" task tears down the watch process when the debug session ends.
