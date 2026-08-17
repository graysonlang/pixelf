# Agent Guidance

How AI coding assistants (Claude, Codex, etc.) work in this repo. This file is about *how to work*; what the project *is* belongs in [README.md](README.md) and `docs/`.

Replace the Project section below when you use this template. Everything under Hard rules is intended to carry across projects unchanged.

## Project

<!-- Replace: one paragraph on what this is, plus pointers to the docs an agent should read before writing code. -->

This is a template repo built on [`@graysonlang/esp`](https://github.com/graysonlang/esp) — an esbuild plugin set and build runner. The checked-in surface is deliberately small; anything that can be a dependency lives in esp.

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

### Do not start the dev server

Do not run `npm run dev` or `npm run serve` for routine validation unless the user explicitly asks. The owner keeps the app open and refreshes it; a second server collides with that workflow, and a fresh browser window has no useful application state anyway.

`npm run build` is the right check that something compiles.

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
