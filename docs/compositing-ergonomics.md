# Canvas, layers, effects, and destructive edits

## Status

This note records the canvas-first layer-stack direction established by the first ergonomics spike.
It refines how Pixelf presents its target-first document without replacing the canonical ownership and evaluation model.

## Working document and flattened files

A Pixelf editing session is always a Pixelf project, regardless of how its first asset entered the application.
Opening a PNG, JPEG, WebP, or other flat image imports that image as a source asset into a project.
Save writes the Pixelf working format and does not silently re-encode the imported file.
Export evaluates a chosen canvas contract and produces a flattened deliverable.

There is no round-trip mode in which a flat source file sometimes behaves like the working document.
This avoids hidden format promotion, JPEG recompression on save, and format-dependent save behavior after the first layered edit.

## Empty workspace and canvas contract

The editor may begin with no layers, no source assets, and no determined pixel extent.
The viewport is an unbounded workspace that can show a theme background or transparency checkerboard without implying export pixels.

The Canvas row is the base of the visible layer stack.
It presents the canonical target contract: export bounds, resolution, channel layout, output encoding, alpha policy, working precision, and color intent.
It is not a bitmap layer and does not introduce a Photoshop-style opaque background exception.

An empty session may defer creating or fully resolving a target contract.
Export remains unavailable until the chosen canvas has explicit pixel bounds and every automatic color choice can be resolved deterministically.
Importing the first image may offer its dimensions as a convenient canvas default, but the source asset does not own the canvas extent.

Internally, the target remains the root that owns the ordered layer branches.
The layer panel deliberately inverts that ownership for familiar compositing ergonomics: the highest layer is shown at the top and Canvas is shown at the bottom.

## Layer and source bounds

A layer is a compositing participant, not a document-sized pixel allocation.
Its source asset retains its native pixels, native bounds, source encoding metadata, and content identity.
Layer placement and affine transforms are authored properties evaluated at preview and export time.
Pixels outside the canvas remain available after transforms or canvas-bound changes.

Sampling outside a finite source is transparent by default.
An effect or transform that needs clamp, repeat, mirror, background fill, or another edge behavior must declare that behavior explicitly.
JPEG does not acquire a special opaque background layer merely because its encoded format lacks alpha.

## Layer pipeline

The common layer pipeline is:

```text
source pixels
-> source-to-working color conversion
-> authored transform
-> Fill
-> ordered layer-local effects and adjustments
-> layer mask
-> Opacity
-> blend into accumulated layers below
```

Fill and Opacity remain distinct authored stages.
Fill controls pixels entering the layer effect chain, while Opacity controls the completed contribution of the layer.

Layer-local effects, such as Gaussian blur, exposure, or sharpen, are reversible children of the layer by default.
Their order is visible and editable.
A user may explicitly rasterize or bake a selected branch when a destructive workflow is clearer or more efficient.
That command must state whether it creates a new asset or replaces an owned asset, and undo must retain the prior project meaning.

## Adjustment layers and scope

Pixelf should distinguish a layer-local adjustment from an adjustment layer.
A layer-local adjustment processes one layer branch.
An adjustment layer is a z-stack participant that processes the accumulated result beneath it within a declared scope.

Groups provide the natural scope boundary for adjustment layers and pass-through compositing.
Masks may limit a complete layer, an individual effect, an adjustment layer, or a group through typed dependencies rather than hidden ownership.
This keeps the common stack legible while preserving explicit wiring for relationships that do not fit strict nesting.

The first ergonomics spike continues to expose existing layer-local operations.
Adjustment-layer scope and group pass-through behavior require a separate document-semantic slice before they appear as authoring controls.

## Color handling

Each imported bitmap asset records its source color description independently of the canvas.
The original encoded bytes should remain available when asset policy permits, along with ICC, CICP, transfer-function, primaries, and alpha-interpretation metadata that are needed to decode the asset faithfully.

A GPU texture format is not itself a complete color-space description.
Sampling therefore performs an explicit source-to-working conversion before filtering and compositing in premultiplied linear light.
Different source assets do not need to be destructively converted into one document pixel store.

An empty session may present working color as Automatic.
Automatic is a deterministic policy, not an unspecified renderer choice: preview and export resolve it from the canvas color intent and participating asset metadata, and the saved project retains the authored policy.
The compositor still evaluates a request in one explicit linear working space so blending between differently encoded sources is well-defined.

## User-interface mapping

The primary layer panel is a Photoshop-like z-order stack with the topmost layer first and Canvas last.
Layer sources and reversible effects remain disclosed beneath their owning layer instead of becoming peer rows that obscure compositing order.

Duplicate and Delete live in the layer context menu and remain available from the keyboard.
Layer order changes by direct drag and by an equivalent keyboard gesture; persistent Up and Down buttons are not part of the panel.

The left tool rail owns the main menu, move/select, brush, eyedropper, and foreground/background paint colors.
Properties remain separate from the layer stack so choosing Canvas exposes export and color settings without making them look like pixels.

## Follow-up semantic slices

- Add a canonical untitled session that can have no layers and no resolved pixel extent.
- Separate authored automatic color policy from its resolved compositor space.
- Preserve and validate richer source profile and alpha metadata through decode, sampling, save, relink, and export.
- Define adjustment-layer and group pass-through scope in the project document.
- Define per-operation edge sampling and make destructive rasterization labels precise in the command history and UI.
