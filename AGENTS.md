# Agent Guidance

How AI coding assistants (Claude, Codex, etc.) work in this repo. This file is about *how to work*; what the project *is* belongs in [README.md](README.md) and `docs/`.

## Project

Pixelf is a lightweight, accessible image editor built around a primarily non-destructive target-first layer tree and a tiled WebGPU compositor.
Target assets are the roots of compositions and declare destination resolution, bit depth, pixel format, and color intent; layers, sources, masks, and processing operations are upstream child nodes whose pixels flow back toward those roots.

The application uses Solid's reactive core for signals, derivations, effects, and disposal, with TypeScript and real DOM APIs for the view.
Do not introduce JSX or TSX, a JSX transform, the Solid compiler, Babel, or a framework renderer.
Keep canonical document and compositor modules independent of Solid and the DOM so they remain deterministic and headless-testable.
Prefer reversible authored operations, but do not make non-destructive behavior an absolute constraint.
Destructive, bake, rasterize, or replace operations must be explicit in the document or command history, visibly labeled in the UI, and precise about asset ownership and undo behavior.

Read [README.md](README.md) and [PLAN.md](PLAN.md) before changing document semantics, the target-first tree, layer or wire behavior, tiling, color handling, or the WebGPU boundary.
The compositor in `../mixaic/src/compositor/` is the implementation reference for region evaluation, tile halos and caching, premultiplied linear color, alpha-safe sampling, and GPU resource ownership.
Adapt it behind a Pixelf-owned internal contract with focused conformance tests; do not create runtime imports across sibling repositories or copy host-specific Mixaic application state.
Use `../amoire` as the reference for the JSX-free Solid and command-driven application structure, and `../filfre` as a reference for image-effect vocabulary and graph authoring concepts.
Use `../skitsaro` as the reference for ABR parsing, deterministic brush stamping, coalesced and predicted pen input, stylus dynamics, and touch or stylus arbitration.
Adapt those behaviors behind Pixelf-owned document, command, tiling, color, and rendering contracts; do not create runtime imports across the sibling repository.

## Hard rules

These are not stylistic preferences. Violating one produces a diff the owner has to undo by hand.

### Markdown

Do not hard-wrap paragraphs to a fixed column. The renderer re-wraps, so a fixed width only makes diffs noisy. Break lines at sentence or phrase boundaries instead — that is where edits land, so it plays nicely with source control. Applies to every `.md` in the repo except `LICENSE.md`.

The same rule governs prose inside HTML content (e.g. `app/index.html`): keep each sentence or phrase on its own line. The browser re-wraps it anyway.

### Source character set

Source code stays 7-bit ASCII (bytes 0x00-0x7F), comments and string literals included. No em-dash, en-dash, arrows, multiplication signs, check marks, or smart quotes. Use the low-ASCII equivalent: ` - `, `-`, `->`, `x`, straight quotes.

This governs source files (`.js`, `.mjs`, `.ts`, `.rs`, `.swift`, `.py`, `.sh`, and the like). Markdown prose may use non-ASCII freely.

### Configuration files

JSON configs are strict JSON: no comments, no trailing commas. If a config genuinely needs commentary, put it in the README rather than switching the file to JSONC.

### Language

US English spelling throughout — code, comments, UI strings, and docs. color (not colour), center, gray, behavior, license, honor, canceled, labeled, and -ize verbs (serialize, normalize, recognize).

### Commits

No AI-attribution trailers of any kind: no `Co-Authored-By: Claude`, no "Generated with" line. Write the message as the author's own.

Commit incremental, logically grouped changes as you go. The message is a concise one-liner.

## Working in this repo

### Verification gate

A change is done when all four are green:

```sh
npm run typecheck   # tsc --noEmit
npm run lint        # biome check .
npm test            # node --test, over an esbuild bundle
npm run build       # esbuild, via esp's runner
```

`npm run check` chains all four. Run them before claiming a change works. If one fails, say so with the output rather than describing the change as complete.

Formatting is Biome's job, not yours. Do not hand-format to match the surrounding code and do not argue with the formatter — run `npm run lint:fix` and take what it produces. The one thing worth knowing: `.vscode/launch_template.json` is deliberately excluded from Biome, because the `{{debug}}` placeholders in it are not valid JSON.

### Use an isolated preview server

Do not run `npm run dev` or `npm run serve` for routine validation unless the user explicitly asks.
Those commands belong to the owner's visible development workflow and use its automatically deduced port.

For browser validation, an agent may start its own isolated preview without additional authorization by using `node scripts/build.mjs --serve --port=<agent-reserved-port> --sourcemap`.
The port must be explicitly reserved for that agent rather than automatically selected, and the agent must navigate to the exact emitted URL and stop the preview when validation finishes.

`npm run build` is the right check that something compiles.

### Playwright tool availability

Browser automation is provisioned by the repository: `.mcp.json` registers the project's pinned Playwright MCP server through `playwright-mcp.config.json`, which runs the browser headless and isolated so automation never raises a window over the owner's work and every run starts from blank browser state.
The registration needs one-time approval per collaborator, and MCP servers connect at session start, so a session started before approval or before a config change must be restarted to see the tools.

When browser validation is required, attempt to invoke the Playwright MCP `browser_navigate` tool directly rather than inferring availability from memory, prior messages, or other browser mechanisms.
If that invocation fails because the tool is absent, report that browser validation was unavailable and that a restarted, approved session is the likely fix; do not fall back to the owner's own browser.

To watch a run while debugging automation, temporarily set `browser.launchOptions.headless` to `false` in `playwright-mcp.config.json` and restart the session.
That file is read at startup, and changing it neither alters `.mcp.json` nor requires re-approving the server.

### Browser validation

For browser-visible changes, validate with the Playwright MCP server against an isolated preview: start it on the agent's explicitly reserved port as described above, navigate to the exact emitted URL, and stop the preview afterward.
Never start `npm run dev` or `npm run serve` for verification, and do not drive the owner's own browser or running application; the headless isolated browser exists so validation never interferes with their work.

Start ordinary control inspection from an accessibility snapshot and prefer semantic roles, names, labels, or test IDs.
Snapshot element references are valid only for the snapshot that produced them, so selectors and test IDs are the durable way to address controls across steps.
Use `browser_evaluate` to read precise DOM state such as `hidden`, ARIA attributes, computed positions, and the active element, and use screenshots for visual layout and Canvas or WebGPU results rather than as the primary way to locate ordinary DOM controls.
Canvas and WebGPU verification should combine application or DOM state, browser runtime evidence, and rendered pixels where each applies.
For GPU-path changes, confirm that `navigator.gpu` exists and that Pixelf acquired an adapter before treating the rendered result as WebGPU evidence; a headless adapter validates the browser path but does not substitute for hardware- or driver-specific testing.
Pass screenshot and snapshot file paths under `.playwright-mcp/`, which is gitignored; a bare relative filename lands in the repository root.
Playwright refuses to click a target covered by another element, such as a control beneath an open menu or a point the Canvas intercepts, so choose an uncovered target rather than forcing the click.

After load and interaction, inspect unexpected console errors and relevant failed network requests, including HTTP, WebGPU, WASM, worker, and asset failures.
Wait for observable state rather than fixed sleeps; a delay belongs in a check only when the behavior under test is itself time-dependent, and then it should be the smallest interval that discriminates.
Report the exercised flow, assertions, console and network results, GPU availability when relevant, and visual checks; if browser validation was unavailable, say so explicitly rather than describing the change as verified.

### Where not to look

When searching for source, skip generated and dependency directories — `www/`, `dist/`, `dist-tests/`, `node_modules/` — unless the user expressly asks you to inspect them. Hits there are stale copies of real source and will send you down the wrong path.

## Response preferences

Keep final responses compact. Lead with the meaningful outcome.

Do not list verification commands or local URLs unless the user asks for them, or a check failed and it explains the blocker.

Do not use clickable markdown links for local files — the enumerated changes list at the end of the chat already covers them.

Do not include a hyperlink "open" card for the built `index.html`.

## Anti-patterns

- Treating chat history as authoritative. Externalize durable decisions into markdown; a long conversation is not a source of truth.
- Continuing a sprawling conversation instead of formalizing the decision and starting fresh.
- Introducing terminology that conflicts with names already in the codebase.
- Widening scope past what was asked. Discovered work is a new item, not growth of the current one.
- Adding a dependency where a few lines of local code would do. The dependency graph here is deliberately tight.
