# Pixelf

Pixelf is a lightweight image editor and processing workspace.
The aim is to make capable image work approachable without inheriting the dense chrome and destructive workflows of traditional desktop editors or the narrow, irreversible paths of many simplified photo apps.

The name is pronounced "pixel elf": a small tool that helps with pixels without hiding how the result was made.

## Status

Pixelf has a target-first project document, direct-DOM layer editor, deterministic tiled CPU compositor, and WebGPU presentation path.
It uses the same core stack as Amoire: TypeScript, `@graysonlang/esp`, Solid's fine-grained reactive primitives, and direct real-DOM bindings.
There is deliberately no JSX or TSX compilation and no Solid framework renderer.

The current processing vocabulary includes crop, canvas bounds, affine transform, opacity, exposure, levels, white balance, contrast, saturation, channel inspection, blur, sharpen, masks, and a focused set of linear-light blend modes.
The operation registry drives insertion, property controls, validation, region behavior, CPU evaluation, GPU routing, and serialization.
Operations not yet implemented as dedicated shaders are evaluated by the CPU oracle and uploaded through the WebGPU presentation path, preserving one visible result while GPU coverage grows.
Viewport work planning limits preview evaluation to visible and prefetched tiles, splits work to the device texture limit, and rejects stale generations before they publish pixels.
[PLAN.md](PLAN.md) defines the remaining vertical slices for durable projects, export, and advanced wiring.

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
- Local-first operation: opening, editing, saving, and exporting should not require an account or remote service.
- Fidelity is explicit: color space, alpha semantics, resolution, precision, sampling, and export encoding are data rather than hidden renderer choices.

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

This model is intentionally not a flat Photoshop-style layer list and not an unrestricted node canvas.
The goal is a re-entrant hybrid where ordinary work stays legible as layers and advanced relationships remain possible when they are useful.

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

## Compositor lineage

`../mixaic/src/compositor/` is the starting implementation source for Pixelf's rendering core.
Its useful contracts already include pure graph-to-pixels evaluation, backward input-region propagation for effect halos, isolated tile rendering and caching, affine placement, premultiplied linear compositing, alpha-safe mip sampling, blend modes, WebGPU acquisition and presentation, upload paths, and budgeted resource pooling.

Pixelf will adapt that code into an internal compositor boundary rather than importing a sibling checkout at runtime.
The CPU path should remain the deterministic reference while the WebGPU path grows against shared conformance fixtures.
Pixelf-specific target contracts, nested layer semantics, persistence, and UI stay outside the low-level compositor.

Amoire is the reference for Solid reactive ownership, direct DOM construction, commands, and the separation between documents and GPU projections.
Filfre is a source of practical image-effect, graph, schema-driven property, and animation ideas.
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
Source decoding, working precision, display conversion, and export encoding remain separate steps.
WebGPU is the primary execution backend, while a small CPU reference path provides deterministic tests and a correctness oracle for foundational operations.
GPU readback conformance allows an absolute difference of at most two 8-bit encoded values per RGB channel and requires alpha to match byte-for-byte.

The first implementation should favor correctness and observability over shader fusion.
Optimization follows measured tile reuse, memory pressure, and pass cost rather than obscuring the document model.

## Development

Install dependencies with `npm install` and use the checked-in VS Code workspace for the normal esp build and debug flow.

`npm run check` runs type checking, linting, tests, and the production build.

The planned renderer requires WebGPU and a secure browser context.
Localhost served through the esp development workflow satisfies the secure-context requirement.

## License

MIT - see [LICENSE.md](LICENSE.md).
