# Pixelf implementation plan

## Status

This plan turns the direction in [README.md](README.md) into complete, testable vertical slices.
It should be updated when a phase materially changes direction or is completed.

- [x] Phase 0 - Project and reactive foundation
- [x] Phase 1 - Canonical target-first document
- [x] Phase 2 - Tiled CPU reference compositor
- [x] Phase 3 - First WebGPU image path
- [x] Phase 4 - Target-first layer editor
- [x] Phase 5 - Reversible processing vocabulary
- [x] Phase 6 - Demand-driven tiles and large images
- [x] Phase 7 - Durable projects and faithful export
- [x] Phase 8 - Advanced wiring and extensibility
- [ ] Phase 9 - Canvas-first layer-stack ergonomics

The completed phases establish the architectural foundation rather than the final product surface.
[The base editing scope](docs/base-editing-scope.md) defines the viewing and manipulation capabilities for the next product slices, while [the structure-list design](docs/structure-list.md) defines their compact primary navigation surface.
[The compositing ergonomics note](docs/compositing-ergonomics.md) records the current pivot from an engine-shaped target tree toward a canvas-based z-stack without discarding the target-first canonical document.

## Working rules

- Keep the project document canonical and prefer rendered pixels as derived projections.
- Allow destructive, bake, rasterize, and replace actions when they are explicit, visibly labeled, and precise about asset ownership, cache invalidation, and undo behavior.
- A target asset is always the root of an evaluable composition and owns the complete destination contract.
- Child nesting expresses primary ownership and image flow; wires express declared secondary dependencies.
- Data flows from child sources through parent processors toward the target root, even though the tree is displayed target-first.
- All authored mutations enter through commands with explicit undo boundaries.
- Keep document, validation, evaluation, and CPU compositor modules independent of Solid, the DOM, and WebGPU handles.
- Use Solid's reactive core directly; do not add JSX, TSX, a JSX transform, or a framework renderer.
- Require region and halo behavior from every spatial processor before it can participate in tiled evaluation.
- Treat color, alpha, sampling, precision, and conversion behavior as part of an operation's contract.
- Preserve keyboard access, readable labeling, focus behavior, and reduced-motion support as features are introduced.
- Finish every implementation phase with the repository verification gate green.

## Phase 0 - Project and reactive foundation

Goal: replace the repository-template identity with a minimal Pixelf application and durable architectural direction.

- Adopt the Pixelf package metadata and workspace identity.
- Add `solid-js` as the reactive core and WebGPU declarations for the planned renderer.
- Move the application entry to TypeScript without adding JSX configuration.
- Exercise signals, a memo, an effect, and lifecycle cleanup through local image selection and preview.
- Record the target-first layer model, Mixaic compositor lineage, fidelity rules, and implementation sequence.

Completion criteria:

- The package, README, agent guidance, application shell, and this plan agree on Pixelf's direction.
- The build contains Solid's reactive primitives but no JSX or TSX source or compiler setup.
- Selecting a replacement image releases the previous object URL when its reactive owner is disposed.

## Phase 1 - Canonical target-first document

Goal: define the smallest persistent image project without coupling it to a renderer.

- Define a versioned `PixelfProject` with stable opaque IDs and explicit migration handling.
- Define target roots with width, height, channel layout, working precision, color space, output file format, output bit depth, and alpha policy.
- Define ordered layer children, unary processing children, source leaves, and typed secondary input ports.
- Keep the primary relation single-parent so each nested operation has one obvious result context.
- Define whether a source asset is embedded, content-addressed, or externally referenced, including missing-asset behavior.
- Add a schema-driven node registry for parameters, defaults, port types, region behavior, and user-facing descriptions.
- Validate references, child kinds, duplicate ownership, unsupported formats, invalid parameters, incompatible wires, and cycles.
- Add byte-stable serialization and explicit format errors.
- Add editor state and commands for selection, insertion, removal, reorder, parameter edits, transactions, undo, and redo.

Completion criteria:

- A project with one imported source under one target round-trips byte-stably.
- The target contract is sufficient to evaluate without consulting a canvas, source image size, or UI control.
- Invalid trees and wires fail before entering canonical state with actionable errors.
- Playback, selection, panel disclosure, and renderer state cannot dirty a project.

## Phase 2 - Tiled CPU reference compositor

Goal: establish deterministic region evaluation and correctness fixtures before GPU optimization.

- Adapt the internal contract from `../mixaic/src/compositor/`; do not add a runtime dependency on the sibling checkout.
- Preserve its `Region` and premultiplied-linear `Surface` foundations and its pure graph-to-pixels behavior.
- Preserve backward input-region propagation so each effect declares the source region and halo needed for an output region.
- Adapt source rasterization, affine placement, alpha-safe mip generation and sampling, Porter-Duff over, and the initial blend modes.
- Adapt tile rendering and cache behavior behind Pixelf-owned identifiers and target-format keys.
- Project the Pixelf target tree into the low-level compositor contract in a separate adapter.
- Keep Mixaic host state, document types, and UI concepts out of the engine.
- Add fixtures for full-region versus isolated-tile equality, transparent-edge sampling, linear-light blending, affine placement, and cache invalidation.

Completion criteria:

- The same project, target contract, region, scale, and quality request always produces identical reference pixels.
- A tile rendered alone matches the same pixel rectangle cut from a full render, including halo-requiring effects.
- Source and parameter revisions invalidate only cache entries whose identities depend on them.
- The entire reference suite runs headlessly without a DOM or GPU.

## Phase 3 - First WebGPU image path

Goal: display one target through WebGPU while retaining the CPU path as its oracle.

- Acquire the adapter, device, queue, and canvas context asynchronously and expose a useful unsupported state.
- Rebuild all GPU projections after device loss without mutating the project.
- Adapt Mixaic's presentation, upload, explicit alpha-safe mip chain, and budgeted resource-pool foundations.
- Render an imported image through affine placement into the target's requested region.
- Add explicit texture formats, bind-group layouts, aligned uniform buffers, pipeline caching, and shader diagnostics.
- Separate source decoding, working color arithmetic, intermediate storage, canvas presentation, and output encoding.
- Add deterministic GPU readback and comparison against the CPU fixtures with documented tolerances.

Completion criteria:

- One imported image renders after startup, resize, zoom, and device reconstruction.
- Transparent edges, minification, magnification, and linear compositing agree with the reference within tolerance.
- Repeated frames reuse compatible pipelines and resources and do not grow memory without bound.

## Phase 4 - Target-first layer editor

Goal: make the document's result-to-source structure directly understandable and editable.

- Replace the foundation sidebar with a hierarchical target, layer, processor, and source view.
- Make target resolution, format, bit depth, color intent, and export policy visible at the root.
- Add stage pan, zoom, fit, 100%, pixel-grid, transparency, and before-or-after inspection controls.
- Add schema-driven properties for the selected item with immediate preview and coherent undo grouping.
- Add keyboard insertion, reorder, nesting, disclosure, deletion, and traversal before pointer-only gestures.
- Introduce wires only for the first real secondary relationship, such as a mask, rather than presenting an empty general node canvas.
- Make focus, selection, processing state, missing assets, unsupported GPU state, and errors distinguishable without color alone.

Completion criteria:

- A user can import an image, create a target, add and reorder layers or processors, adjust parameters, and undo the result.
- The UI reads from canonical and editor state; no document is reconstructed from DOM order.
- The common single-image workflow does not require graph terminology or precision pointer gestures.

## Phase 5 - Reversible processing vocabulary

Goal: support a compact, useful editing set through one uniform operation contract.

- Add crop, canvas resize, affine transform, opacity, and layer compositing.
- Add exposure, brightness, levels, white balance, contrast, highlights, shadows, whites, blacks, clarity, vibrance, saturation, and channel inspection from the Artifactorial adjustment vocabulary.
- Add blur, sharpen, and noise reduction as halo-requiring spatial operations, plus target-aware vignette and deterministic tile-stable grain.
- Add masks with invert, density, feather, and transform behavior, and let typed masks limit either a complete layer or one adjustment.
- Add Photoshop-style separable and non-separable blend modes with specified linear-light and premultiplied-alpha semantics.
- Keep Fill before the layer effect chain and Opacity after the chain so the two authored controls remain structurally distinct.
- Let every operation declare parameters, secondary ports, input-region mapping, quality behavior, and CPU and GPU runners.
- Add bypass, compare, reorder, duplicate, reuse, and delete without implicitly baking source pixels.
- Define explicit bake or rasterize commands, including whether they create a new asset or replace one, what undo retains, and when old derived tiles can be released.

Completion criteria:

- Ordinary authored operations can be changed or removed after save and reload; destructive boundaries are visible and retain their declared history behavior.
- Operation registration drives insertion UI, properties, validation, evaluation, and serialization.
- CPU and GPU fixtures cover each operation's color, alpha, edge, and tile-boundary behavior.

## Phase 6 - Demand-driven tiles and large images

Goal: keep interaction responsive and memory bounded when sources and targets exceed the viewport or GPU limits.

- Request only visible preview tiles plus a small prioritized prefetch margin.
- Propagate region, scale, halo, and quality requirements backward through reachable branches.
- Key derived tiles by target contract, node and asset revisions, region, scale, quality, and relevant color state.
- Reuse unaffected upstream tiles after localized edits.
- Add separate CPU, decoded-source, GPU texture, and derived-tile budgets with observable accounting.
- Schedule foreground, refinement, thumbnail, and export work with cancellation or generation checks for stale results.
- Split operations that exceed device texture limits without introducing seams.
- Measure decode, evaluation, upload, command encoding, GPU execution, readback, cache hit rate, and eviction before optimizing.

Completion criteria:

- Panning or zooming a large image does not evaluate the whole target at preview quality.
- Repeated editing, zooming, and target switching keep resource use within configured budgets.
- Canceled or stale work cannot replace pixels from a newer project revision.
- Tile boundaries remain invisible for neighborhood, resampling, mask, and compositing operations.

## Phase 7 - Durable projects and faithful export

Goal: make edits safely re-entrant across sessions and produce predictable deliverables.

- Add project open, save, recovery, explicit version migration, and missing-asset relinking.
- Decide and document embedded versus linked asset policies before promising portable project files.
- Add autosave or recovery state separately from the user's named project file.
- Evaluate export from the authored target contract rather than the current viewport.
- Add PNG first, including explicit 8-bit and higher-precision policy where browser encoders permit it.
- Add JPEG, WebP, and other formats only with clear alpha, metadata, color-profile, and bit-depth behavior.
- Preserve or intentionally rewrite metadata through visible export choices.
- Add chunked or tiled export so large outputs do not require an unnecessary full-resolution intermediate in JavaScript memory.

Completion criteria:

- A saved project reopens with the same structure, parameters, asset identity, and deterministic reference pixels.
- Exported dimensions, bit depth, format, alpha, and color interpretation match the target root.
- Recovery never silently overwrites a named user file.

## Phase 8 - Advanced wiring and extensibility

Goal: expand expressive power without turning the approachable layer model into an unrestricted graph by default.

- Add reusable branches and shared sources with explicit ownership and cache lifetime.
- Add multi-input composites, procedural masks, adjustment groups, and scoped group effects as real use cases require them.
- Add scalar or animation wiring only after its time, determinism, and export contracts are defined.
- Add histogram, scopes, and diagnostics as derived views rather than serialized image state.
- Evaluate compute-based operations, iterative filters, and persistent simulations through an explicit bounded work-plan contract.
- Consider a plugin or shared-package boundary only after multiple in-repo consumers demonstrate the same stable interface.

Completion criteria:

- Advanced relationships remain visible and navigable from the target-first tree.
- Shared or wired branches have deterministic invalidation, lifetime, and serialization behavior.
- The simple layer workflow stays available without exposing general graph machinery.

## Deferred until separately authorized

- Cloud projects, accounts, collaboration, or server-side processing
- Generative AI editing features
- Video timelines and encoded video export
- A WebGL fallback
- A general shader language or whole-graph shader fusion
- Third-party plugins or arbitrary shader loading
- Cross-repository compositor package publication
