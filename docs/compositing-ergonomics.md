# Composite, layers, effects, and destructive edits

## Status

This note records the composite-first layer-stack direction established by the ergonomics spike.
It refines how Pixelf presents its target-first document without replacing the canonical ownership and evaluation model.

## Working document and flattened files

A Pixelf editing session is always a Composite, regardless of how its first asset entered the application.
Opening a PNG, JPEG, WebP, or other flat image imports that image as a source asset into a project.
Save writes the Pixelf Composite working format and does not silently re-encode the imported file.
Export opens a dialog for choosing the flattened file format and metadata policy, then evaluates the Composite export contract.

The Composite owns one editable file name.
Save adds the Pixelf working-format extension, while Export adds the extension chosen in its dialog.

There is no round-trip mode in which a flat source file sometimes behaves like the working document.
This avoids hidden format promotion, JPEG recompression on save, and format-dependent save behavior after the first layered edit.

## Empty workspace and Composite contract

The editor may begin with no layers, no source assets, and no determined pixel extent.
The viewport is an unbounded workspace that can show a theme background or transparency checkerboard without implying export pixels.

The Composite row is the base of the visible layer stack and reflects the editable Composite file name.
It presents the canonical target contract: export bounds, resolution, channel layout, output bit depth, alpha policy, working precision, and color intent.
Flattened file format and metadata policy are per-export choices shown in the Export dialog rather than the Composite properties or main menu.
It is not a bitmap layer and does not introduce a Photoshop-style opaque background exception.

An empty session may defer creating or fully resolving a target contract.
Export remains unavailable until the Composite has explicit pixel bounds and every automatic color choice can be resolved deterministically.
Importing the first image may offer its dimensions as a convenient export-bounds default, but the source asset does not own that extent.

Internally, the target remains the root that owns the ordered layer branches.
The layer panel deliberately inverts that ownership for familiar compositing ergonomics: the highest layer is shown at the top and Composite is shown at the bottom.

## Layer and source bounds

A layer is a compositing participant, not a document-sized pixel allocation.
Its source asset retains its native pixels, native bounds, source encoding metadata, and content identity.
Layer placement and affine transforms are authored properties evaluated at preview and export time.
Pixels outside the Composite export bounds remain available after transforms or bounds changes.

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

Filters may be authored non-destructively as Filter Layers rather than baking a bitmap operation.
A user may explicitly rasterize or bake a selected branch when a destructive workflow is clearer or more efficient.
That command must state whether it creates a new asset or replaces an owned asset, and undo must retain the prior project meaning.

## Stack items, Filter Layers, and layer effects

The Add flyout names four peer concepts in the z-stack:

- Layer owns paint or imported pixel content.
- Group organizes stack items and establishes an effect or compositing scope.
- Content Layer generates content such as a fill, gradient, or pattern without pretending that it is imported pixels.
- Filter Layer processes the accumulated result beneath it within its scope. Adjustment, Gaussian blur, and clarity belong to this family.

Layer effects are not peer stack items.
They hang from a Layer or Group, consume the owner's rendered pixels and coverage or opacity input, and remain visually attached to that owner.
Drop shadow, background blur, and inner glow belong to this family.
A layer effect may declare a backdrop dependency when the effect needs pixels behind its owner, but that dependency does not give the effect an independent z-order position.

Groups provide the natural scope boundary for Filter Layers and pass-through compositing.
Masks may limit a complete Layer, an individual layer effect, a Filter Layer, or a Group through typed dependencies rather than hidden ownership.
This keeps the common stack legible while preserving explicit wiring for relationships that do not fit strict nesting.

Filter Layer is a stable generic stack-item identity with a switchable operation type.
Its switcher is populated from the registry's interchangeable filter family, currently including photographic adjustments, channel inspection, blur, sharpen, noise reduction, vignette, and grain.
Changing the operation preserves the Filter Layer ID, z-order, mask wires, bypass state, and parameter values whose keys remain compatible; parameters unique to the new operation receive its declared defaults.

The existing unary `process/*` nodes remain the implementation vocabulary for reversible processing inside an owned Layer branch.
A Filter Layer reuses that operation vocabulary but applies the selected operation to the accumulated stack beneath its own z-order position.
Structural processors such as crop, transform, composite, and adjustment-group boundaries are not interchangeable Filter Layer types.
Group scope, procedural content, and attached layer-effect ownership still require their own document-semantic slices rather than superficial menu aliases.

## Color handling

Each imported bitmap asset records its source color description independently of the Composite.
The original encoded bytes should remain available when asset policy permits, along with ICC, CICP, transfer-function, primaries, and alpha-interpretation metadata that are needed to decode the asset faithfully.

A GPU texture format is not itself a complete color-space description.
Sampling therefore performs an explicit source-to-working conversion before filtering and compositing in premultiplied linear light.
Different source assets do not need to be destructively converted into one document pixel store.

An empty session may present working color as Automatic.
Automatic is a deterministic policy, not an unspecified renderer choice: preview and export resolve it from the Composite color intent and participating asset metadata, and the saved project retains the authored policy.
The compositor still evaluates a request in one explicit linear working space so blending between differently encoded sources is well-defined.

## User-interface mapping

The primary layer panel is a Photoshop-like z-order stack with the topmost layer first and Composite last.
An imported bitmap source is implicit in its owning Layer row and contributes its asset status and dimensions there rather than appearing as a second selectable row.
This prevents the primary UI from deleting a source independently and leaving an empty Layer behind.
Reversible processors and attached layer effects remain disclosed beneath their owning Layer, and advanced source relationships remain explicit where they are useful.

Layer and Filter Layer rows use a quiet borderless treatment with hover and selection fills rather than individual card outlines.
Each stack item stores authored visibility and lock state.
Visibility removes that item from Composite evaluation without discarding its content or settings.
Lock follows the Figma and Place3D interaction meaning: it excludes the item from direct-canvas picking and manipulation, while the layer panel remains able to select, reorder, inspect, unlock, or otherwise edit it.
Inactive visibility and lock controls may recede until row hover or selection, while hidden and locked states remain visibly indicated.

Duplicate and Delete live in the layer context menu and remain available from the keyboard.
Rows do not reserve a persistent overflow button for that menu; right-click and the keyboard context-menu gesture open the same hovering action surface.
Layer order changes by direct drag and by an equivalent keyboard gesture; persistent Up and Down buttons are not part of the panel.

Opening an image through the file picker starts a new Composite.
Dropping an image while a Composite is already active imports that file as a new topmost Layer in one undoable command, preserving the existing Composite name, export bounds, color intent, and other target settings.

The left tool rail owns the main menu, move/select, brush, eyedropper, and foreground/background paint colors.
Properties remain separate from the layer stack so choosing Composite exposes the file name, export contract, and color settings without making them look like pixels.

## Runtime history

Each open Composite owns one runtime history cursor over at most 50 immutable project states.
The initial open state and every committed command carry a user-facing label, timestamp, canonical project snapshot, and selected-node context.
Continuous control edits may coalesce by merge key within a short window, while an explicit transaction commits a complete gesture as one state.
Commands whose canonical serialization does not change create no history state.

Undo, redo, and the History dialog all move the same cursor.
The dialog lists the newest state first, distinguishes the current, saved, and undone states, and lets the user jump directly to any retained state.
Moving backward does not itself author a new project command; a subsequent edit discards the future branch before appending its state, matching ordinary undo history semantics.
Restoring a state also restores its selected-node context when that node exists in the restored project.

Save marks the current canonical serialization as the saved state and blocks the next edit from coalescing across that boundary.
Dirty state remains derived by comparing the current project with that saved serialization.

History is editor state rather than Composite meaning.
It is not included in `.pixelf` serialization or recovery snapshots, and opening another Composite creates an independent history.
A future durable append-only change log would need its own versioned storage, asset-retention, compaction, and state-addressing contract rather than silently expanding the working document.

## Follow-up semantic slices

- Add a canonical untitled session that can have no layers and no resolved pixel extent.
- Separate authored automatic color policy from its resolved compositor space.
- Preserve and validate richer source profile and alpha metadata through decode, sampling, save, relink, and export.
- Define Group pass-through scope, Content Layer generators, and attached layer-effect ownership in the project document.
- Define per-operation edge sampling and make destructive rasterization labels precise in the command history and UI.
