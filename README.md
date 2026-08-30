# Pixelf

Pixelf is a lightweight image editor and processing workspace.
The aim is to make capable image work approachable without inheriting the dense chrome and destructive workflows of traditional desktop editors or the narrow, irreversible paths of many simplified photo apps.

The name is pronounced "pixel elf": a small tool that helps with pixels without hiding how the result was made.

## Status

Pixelf has a target-first project document, direct-DOM layer editor, deterministic tiled CPU compositor, and WebGPU presentation path.
It uses the same core stack as Amoire: TypeScript, `@graysonlang/esp`, Solid's fine-grained reactive primitives, and direct real-DOM bindings.
There is deliberately no JSX or TSX compilation and no Solid framework renderer.

The current processing vocabulary includes crop, canvas bounds, affine transform, opacity, exposure, brightness, levels, white balance, contrast, highlights, shadows, whites, blacks, clarity, vibrance, saturation, channel inspection, blur, sharpen, noise reduction, vignette, and deterministic grain.
Layers expose Photoshop-style blend modes plus distinct Fill and Opacity stages: Fill controls the source entering the effect chain, while Opacity controls the completed layer contribution.
Typed masks can limit a complete layer or an individual adjustment and retain invert, density, feather, and transform behavior.
Images can be opened with the file picker or dropped anywhere on the application workspace.
The operation registry drives insertion, property controls, validation, region behavior, CPU evaluation, GPU routing, and serialization.
Filter Layers are generic z-stack items that apply a registry operation to the accumulated result beneath them; their operation type can change in place while identity, ordering, masks, bypass state, and compatible parameter values remain intact.
Operations not yet implemented as dedicated shaders are evaluated by the CPU oracle and uploaded through the WebGPU presentation path, preserving one visible result while GPU coverage grows.
Viewport work planning limits preview evaluation to visible and prefetched tiles, splits work to the device texture limit, and rejects stale generations before they publish pixels.
Named project persistence, separate recovery storage, missing-asset relinking, and target-driven PNG, JPEG, and WebP export are available through explicit contracts.
Shared image branches, typed two-input composites, procedural masks, scoped adjustment groups, derived image scopes, and bounded iterative work extend the same target-first model without replacing it with an unrestricted graph.
[PLAN.md](PLAN.md) records the completed implementation sequence and the deliberately deferred product areas.

## Product direction

Pixelf should feel simple at first contact without putting the user on rails.
Most edits should remain inspectable, reorderable, reusable, and reversible, and ordinary preview rendering should not rewrite source assets.
This is the primary authoring model rather than an absolute prohibition: explicit bake, rasterize, replace, or destructive pixel operations are valid when they are clearer or materially more efficient.
Those boundaries must be visible, scoped, and integrated with asset ownership and command history.
The document should support returning to any layer or operation, changing it, and allowing only the affected downstream tiles to update.

The initial principles are:

- Reversible by default: authored operations and source references are canonical for ordinary editing, while destructive actions are explicit and history-aware.
- Target-first composition: the desired artifact owns its output contract rather than inheriting accidental properties from the last operation.
- Layers for the common path, wiring for relationships that do not fit a strict stack.
- Region-based evaluation: processors request only the upstream pixels and halos needed for the visible or exported region.
- Accessible interaction: progressive disclosure, clear names, useful defaults, keyboard operation, and no requirement to understand shader terminology.
- Sparse workspace chrome: the preview owns the window while structure and property panels float at content height and scroll internally only when bounded by the viewport.
- Local-first operation: opening, editing, saving, and exporting should not require an account or remote service.
- Fidelity is explicit: color space, alpha semantics, resolution, precision, sampling, and export encoding are data rather than hidden renderer choices.

[The base editing scope](docs/base-editing-scope.md) records the viewing, format, transform, processing, and brush capabilities that define the next product baseline.
[The compositing ergonomics note](docs/compositing-ergonomics.md) records how the canonical target-first document is presented as a familiar Composite-based z-stack, including save/export, source bounds, effects, destructive edits, and color handling.

## Target-first layers and wiring

The primary authoring structure reads from result to source.
A target asset is a root entity that declares destination width, height, bit depth or working precision, pixel format, color intent, and export policy.
Its ordered child branches are layers, and each layer contains the upstream processors and sources that produce it.
Evaluation travels in the opposite direction: sources produce pixels through their parent processors and layers until the root receives its final image.

```text
Target asset: 2400 x 1600, RGBA, working precision, output encoding
|-- Layer: subject
|   `-- Levels
|       `-- Imported image
`-- Layer: atmosphere
    `-- Blur
        `-- Generated texture
```

Nesting makes the primary image path readable and gives every operation an obvious result context.
Wires complement the tree for secondary inputs such as masks, adjustment controls, shared sources, and multi-input composites.
They must not create a second hidden ownership model: the target tree owns composition and ordering, while wires express declared data dependencies.
Cycles are rejected before evaluation.

This model is intentionally not a flat Photoshop document model and not an unrestricted node canvas.
The primary layer panel presents the ordered target children as a familiar z-stack, with the highest layer first and the target contract shown as the Composite row at the bottom.
An imported bitmap source is implicit in its owning Layer row rather than appearing as a second selectable item; reversible effects remain disclosed beneath that Layer, while advanced relationships remain explicit when they are useful.

Shared images remain source leaves in the owning layer branch and expose their dependency as a typed wire below that leaf.
Their serialized cache lifetime is target, project, or editor session; cache identity includes reachable nodes, wires, and source assets plus the selected lifetime owner.
Two-input composites use the same declared-wire model for a secondary image, while procedural checker masks remain visible mask dependencies.
Adjustment groups are named unary scope boundaries, so the basic layer workflow and keyboard tree navigation remain unchanged.

Histograms, channel distributions, alpha coverage, and vectorscope samples are derived from rendered surfaces and never enter the project document.
Iterative or persistent GPU operations must first produce a bounded plan with explicit dimensions, iteration count, workgroup count, ping-pong memory, and cancellation.
Scalar or animation wiring is not serialized yet because Pixelf has not defined a time and export contract.
Third-party plugins and a shared compositor package remain deferred until another in-repo consumer proves a stable boundary.

## Architecture

A versioned project document is the source of truth.
It stores stable node and asset IDs, target contracts, child ordering, parameters, wires, and durable layout choices.
Selection, hover, open panels, view zoom, GPU handles, decoded pixels, cached tiles, and undo stacks are editor or runtime state and are not serialized as project meaning.

Commands are the authored mutation boundary and establish undo and redo units.
Solid projects document and editor state into small reactive DOM updates.
The evaluator projects document plus an explicit region and quality request into deterministic image work.
The WebGPU runtime owns device resources and execution but never becomes the save format.

```text
UI input -> command -> canonical project document
                         |              |
                         v              v
                   reactive view   region evaluator
                                         |
                                         v
                                tile work plan/cache
                                         |
                                         v
                                  WebGPU or export
```

Document, command, validation, and reference-compositor modules must remain usable in headless tests without importing Solid, the DOM, or live GPU objects.
The GPU is a projection that can always be discarded and rebuilt after device loss.

Rasterization is an explicit command boundary.
It either creates a new asset and replaces the selected processing branch with an imported-source leaf, or replaces the bytes of an existing imported asset while retaining its asset ID.
Undo retains the prior project and asset metadata; derived tiles for the old graph may be released after the command commits because undo can deterministically evaluate them again.

## Projects, assets, and recovery

Pixelf project files are canonical UTF-8 JSON with a `.pixelf` extension.
Named saves write only to a destination the user explicitly selected.
Recovery snapshots use a separate project-ID key and restoring one changes the in-memory session only; it cannot overwrite a named file until the user invokes save.

Imported browser files are linked by default so a small project file does not silently duplicate large source assets.
The project stores the content hash, dimensions, media type, and last known file identity.
Relinking requires the same content hash and dimensions; choosing different pixels is an explicit asset replacement or rasterization command.
Embedded assets remain supported when portability is more important than project size, and their encoded bytes live in the project document by deliberate choice.

## Export

Export always evaluates the authored target contract, never the current viewport or canvas backing size.
The native PNG writer supports 8-bit and 16-bit output, grayscale and RGB channel layouts, preserved alpha or explicit compositing against black, sRGB labeling, and Display P3 `cICP` labeling.
It renders horizontal source tiles into one scanline at a time and emits bounded uncompressed deflate blocks, avoiding a full-resolution JavaScript pixel intermediate.

JPEG and WebP use a supplied browser raster encoder, are explicitly limited to 8-bit output, and declare alpha behavior before encoding.
Because ordinary browser encoders are not streamable, Pixelf applies a pixel limit and directs oversized work to PNG instead of allocating an unbounded full-frame buffer.
Metadata policy is a visible export choice: discard, preserve supplied fields, or rewrite them.

## Compositor lineage

`../mixaic/src/compositor/` is the starting implementation source for Pixelf's rendering core, and `../artifactorial/` is the source vocabulary for the initial photographic adjustment set.
Its useful contracts already include pure graph-to-pixels evaluation, backward input-region propagation for effect halos, isolated tile rendering and caching, affine placement, premultiplied linear compositing, alpha-safe mip sampling, blend modes, WebGPU acquisition and presentation, upload paths, and budgeted resource pooling.

Pixelf adapts sibling behavior into an internal compositor boundary rather than importing a sibling checkout at runtime.
Artifactorial's authored controls become deterministic linear-light engine operations rather than copied CSS preview filters; clarity is a real local-contrast effect and grain is stable across isolated tiles.
The CPU path should remain the deterministic reference while the WebGPU path grows against shared conformance fixtures.
Pixelf-specific target contracts, nested layer semantics, persistence, and UI stay outside the low-level compositor.

Amoire is the reference for Solid reactive ownership, direct DOM construction, commands, and the separation between documents and GPU projections.
Filfre is a source of practical image-effect, graph, schema-driven property, and animation ideas.
Skitsaro is the reference for ABR parsing, deterministic brush stamping, pressure and tilt dynamics, coalesced and predicted pen input, and touch or stylus arbitration.
Pixelf adapts those behaviors behind its own target-first document, command, tiled-evaluation, color, and renderer boundaries rather than importing the sibling checkout at runtime.
Place3D is the reference for sparse workspace geometry: content-sized panels float over the primary viewport instead of reserving permanent side columns.
Neither application model should be copied wholesale: Pixelf's target-first image document is its own contract.

## Tiling and fidelity

Preview, zoom, panning, thumbnails, and export should all request explicit pixel regions at explicit scales.
Evaluation walks upstream to discover dependencies and expands requests by each operation's halo, so a blurred or resampled tile agrees with the same region rendered as part of the full image.
Cache identity must include source and parameter revisions, target format, quality, scale, and tile coordinates.

Derived tiles are cached per entity rather than per complete graph, so a localized layer edit can reuse unaffected branches.
CPU working memory, decoded sources, derived tiles, and GPU textures have separate observable budgets.
Foreground, refinement, thumbnail, and export work share a generation-aware scheduler; a newer preview generation cancels or rejects older results before presentation.
Render metrics cover decode, evaluation, cache lookup, upload, command encoding, GPU execution, and readback.

Color arithmetic and filtering happen in linear light with explicit premultiplied-alpha boundaries.
Viewport presentation uses alpha-safe box-filtered mip levels with bilinear/trilinear reduction, then transitions toward nearest-neighbor sampling under magnification and snaps exact integer mappings so 100% remains pixel-sharp.
Source decoding, working precision, display conversion, and export encoding remain separate steps.
WebGPU is the primary execution backend, while a small CPU reference path provides deterministic tests and a correctness oracle for foundational operations.
GPU readback conformance allows an absolute difference of at most two 8-bit encoded values per RGB channel and requires alpha to match byte-for-byte.

The first implementation should favor correctness and observability over shader fusion.
Optimization follows measured tile reuse, memory pressure, and pass cost rather than obscuring the document model.

## Development

Install dependencies with `npm install` and use the checked-in VS Code workspace for the normal esp build and debug flow.

`npm run check` runs type checking, linting, tests, and the production build.

`.mcp.json` and `playwright-mcp.config.json` provision the project's pinned Playwright MCP server as a headless, isolated browser for coding-agent validation.
See [AGENTS.md](AGENTS.md) for the browser validation workflow.

The planned renderer requires WebGPU and a secure browser context.
Localhost served through the esp development workflow satisfies the secure-context requirement.

## License

MIT - see [LICENSE.md](LICENSE.md).
