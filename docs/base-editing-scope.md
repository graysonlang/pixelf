# Base editing scope

Status: product baseline.

This document records the baseline viewing, format, transform, processing, and brush capabilities Pixelf should support.
It defines product meaning and ownership before individual controls are designed.

The baseline is deliberately backend-neutral.
An operation can use CPU, GPU, or a mixed path without changing its name or authored meaning.

## 1. Capability groups

| Group | Baseline capabilities |
| --- | --- |
| Info | Pixel size, print resolution, color space, EXIF metadata, and pixel color under the pointer. |
| Format | Conversion, compression, format-specific settings such as an embedded thumbnail, embedded profile, and metadata. |
| Transforms | Scale or resize, crop, rotate, and rectify. |
| Processing | Levels, curves, white balance, invert, and isolated channel manipulation. |
| Brush operations | Cleanup, masking, and a localized median filter. |

These groups do not all become the same kind of document node.
Information is derived, format choices belong primarily to targets and export, transforms and processing are reversible processors, and brush work requires localized authored strokes or an explicit raster boundary.

## 2. Product rules

- Use ordinary image-editing language in the common interface rather than renderer terminology.
- Preserve the imported source by default.
- Keep source facts, working interpretation, target intent, and export encoding distinct.
- Make any operation that replaces source pixels explicit, labeled, undoable, and precise about asset ownership.
- Keep information views and hover samples out of canonical project meaning.
- Make every authored transform, processing operation, metadata edit, and brush gesture enter through a document command.
- Preserve keyboard, mouse, pen, and touch access without requiring a precision-only gesture.
- Let format restrictions disable or explain incompatible settings before export begins.

## 3. Current foundation and remaining work

| Group | Existing foundation | Baseline additions |
| --- | --- | --- |
| Info | Target and asset pixel dimensions, target color space, histograms, channel distributions, alpha coverage, and vectorscope analysis. | Print-resolution metadata, imported EXIF storage and viewing, explicit source/working/output color-space presentation, and hover sampling from the rendered target. |
| Format | PNG, JPEG, and WebP targets; target dimensions, channel layout, bit depth, alpha policy, sRGB or Display P3 labeling, and discard/preserve/rewrite metadata policy. | Durable codec settings, compression or quality controls, embedded-profile handling, editable metadata fields, and supported embedded-thumbnail settings. |
| Transforms | Reversible crop, canvas resize, and affine transform operations. | Clear separation between target resize, content scale, and resampling; rotate controls and presets; and a defined rectification transform. |
| Processing | Levels, white balance, channel inspection, masks, and a broader photographic adjustment set. | Curves, image invert, and per-channel editing rather than inspection alone. |
| Brush operations | Typed masks and tiled invalidation foundations. | A localized stroke document, brush interaction, cleanup semantics, painted masks, and localized median evaluation. |

The existing implementation is a foundation, not evidence that a baseline capability is product-complete.
A capability is complete only when its document meaning, controls, undo behavior, evaluation, persistence, accessibility, and export effect agree.

## 4. Information

Information surfaces describe the selected source, node output, or target without mutating it.
The interface must label which of those scopes is being inspected.

### 4.1 Size

Show pixel width and height for imported assets and targets.
When a selected transform changes bounds, show both its input and output dimensions where that distinction is useful.

Physical size is derived from pixel dimensions and print resolution.
It is not interchangeable with pixel size.

### 4.2 Print resolution

Store print resolution as explicit horizontal and vertical pixels-per-inch metadata with a unit-aware UI.
Changing print resolution without resampling changes physical-size interpretation only.
Changing pixel dimensions is a separate resize operation and must be labeled as such.

The first UI can present one linked PPI value while the contract retains both axes for imported files that differ.

### 4.3 Color space

Show these concepts separately when they differ:

- The source asset's embedded or assumed profile.
- The project's working color space and precision.
- The target's output color intent and embedded profile.
- The display conversion used for the current preview.

An absent embedded profile is an explicit `unlabeled` or `assumed` state rather than silently becoming an authored profile.

### 4.4 EXIF metadata

Imported EXIF is source metadata.
Viewing it does not dirty the project.

The information view should begin with a useful normalized set such as capture time, camera and lens, exposure, focal length, orientation, dimensions, resolution, software, copyright, and location availability.
Unknown fields remain available in a structured details view without requiring a bespoke control for each tag.

Sensitive metadata such as precise location must be clearly identified before preserve or export decisions.

### 4.5 Pixel color on hover

Hover sampling is a derived viewport tool.
It samples the rendered target coordinate beneath the pointer rather than the canvas backing pixel.

The default readout shows target coordinates, RGBA values in a familiar encoded representation, and transparency.
An expanded readout may also show working linear values and the active color-space interpretation.

Sampling must remain correct through zoom, pan, device-pixel scaling, transforms, and targets larger than the current GPU texture limit.
Transparent pixels preserve meaningful zero-alpha handling rather than displaying leaked premultiplied RGB.

## 5. Format

Format settings belong to the target and export plan unless the user explicitly invokes source conversion or replacement.
Ordinary conversion creates a new encoded result and does not rewrite the imported asset.

### 5.1 Conversion

The target chooses output format, channel layout, bit depth, alpha policy, color intent, and encoding settings.
Changing those settings is reversible authored intent.

An explicit Replace source or Convert source command can be added later when destructive source conversion is actually desired.

### 5.2 Compression and format settings

Each codec exposes only settings it can honor.
Examples include lossy quality, lossless mode, compression effort, chroma behavior, progressive encoding, and an embedded preview or thumbnail where supported.

The common UI should lead with a useful quality control and estimated consequences.
Codec-specific advanced fields use progressive disclosure.

The word thumbnail in this section means a thumbnail embedded in or emitted with an encoded artifact.
It is separate from structure-list and viewport thumbnails, which are derived editor caches.

### 5.3 Embedded profile

Profile policy distinguishes preserve source profile, convert and embed target profile, assign an explicit profile, and omit a profile when the format permits it.
Assign and convert are different operations and must not share a label.

The current sRGB and Display P3 enum is a starting point rather than a complete embedded-profile model.
Supporting arbitrary ICC payloads requires explicit asset ownership, validation, conversion, serialization, and export contracts.

### 5.4 Metadata

Metadata has both field content and an export policy.
Discard, preserve, and rewrite remain visible choices, while individual editable fields live in a metadata editor.

Preserve means preserve compatible supplied fields where the encoder can do so.
Rewrite means emit the current authored field set and normalized structural fields.
Neither policy promises blind byte-for-byte copying across incompatible formats.

## 6. Transforms

Transforms remain reversible processors unless the user explicitly rasterizes or replaces pixels.

### 6.1 Scale and resize

The UI distinguishes three operations:

- Resize target changes the destination pixel dimensions.
- Scale content changes the placement and sampled size of a layer or branch inside its target.
- Resample source creates or replaces a raster asset through an explicit destructive boundary.

Resampling exposes the algorithm in user language and records it as authored data where it affects export pixels.
Preview sampling policy remains a renderer concern.

### 6.2 Crop

Crop changes the visible region without deleting the underlying source by default.
It supports direct handles, numeric bounds, aspect constraints, reset, and a clear path to apply or rasterize only when requested.

### 6.3 Rotate

Rotate is an affine transform with direct manipulation, numeric angle, quarter-turn actions, pivot behavior, and predictable bounds handling.
It does not need a separate engine primitive from affine placement unless a later implementation proves otherwise.

### 6.4 Rectify

Rectify means correcting geometry that an affine rotation alone cannot correct.
The expected baseline is perspective or quadrilateral correction through four directly manipulable corners, backed by a projective transform with defined input-region propagation and sampling.

Lens-profile correction, automatic horizon detection, and automatic document detection are not implied by the baseline and require separate authorization.

## 7. Processing

Processing operations are reversible unary processors and can be limited by typed masks.
They use the same registry for parameters, validation, properties, regions, CPU reference behavior, GPU routing, persistence, and insertion actions.

### 7.1 Levels

Levels retains black, white, gamma, and output endpoints.
It gains an explicit composite or individual-channel target so the same operation can edit all color channels or one selected channel.

### 7.2 Curves

Curves stores stable ordered control points and a selected composite or individual channel.
The curve representation, interpolation, endpoint behavior, monotonicity policy, and serialization precision must be deterministic.

The UI includes a usable direct curve editor plus keyboard and numeric alternatives for selecting, adding, moving, and deleting points.

### 7.3 White balance

White balance retains approachable temperature and tint controls.
An eyedropper can derive a command from a sampled neutral point without storing the transient sampling gesture in the project.

### 7.4 Invert

Image invert is a processing operation distinct from mask inversion.
It can target the composite RGB result or an individual channel while preserving alpha unless an explicit alpha operation is selected.

### 7.5 Isolated channel manipulation

The baseline means that tonal tools such as levels, curves, and invert can target composite RGB or an individual red, green, blue, or alpha channel where valid.
Channel inspection remains a separate derived or bypassable view and does not itself alter pixels.

A broader channel mixer or arbitrary channel algebra is not implied until separately specified.

## 8. Brush operations

Brush operations require a dedicated design slice before UI implementation.
They introduce potentially long pointer streams, localized invalidation, stroke replay, per-gesture undo, and authored raster ownership.

The baseline model should satisfy these rules:

- One completed brush gesture is one undo unit.
- Pointer samples before commit remain editor state.
- Each stroke records the minimum deterministic geometry and tool parameters needed for replay, or crosses an explicit raster boundary when replay is inappropriate.
- Tile invalidation is bounded by the stroke footprint plus the operation's halo.
- Canceling a gesture restores the previous document and preview.
- Touch can pan when not intentionally brushing, and a stylus is useful without being required.
- Brush cursors and effects remain perceivable without relying on color alone.

### 8.1 Cleanup

Cleanup is a brush-scoped correction family rather than one assumed algorithm.
The first implementation must choose and label a precise behavior such as clone, heal, or content-aware replacement before the document contract is finalized.

Any sampled source point, alignment mode, radius, hardness, opacity, and blending behavior needed to reproduce a cleanup stroke becomes authored data.

### 8.2 Masking

Mask brush gestures add to, subtract from, or replace a typed mask.
They preserve the existing mask invert, density, feather, and transform behavior rather than creating a separate mask ownership model.

The list summarizes the mask dependency; individual strokes do not become top-level structure rows.

### 8.3 Median filter

The brush median filter applies a median neighborhood within the stroke footprint.
Its radius defines a tile halo, and its mask or coverage edge must agree between isolated tiles and full evaluation.

A global median processor can reuse the same deterministic evaluator, but the baseline request is the localized brush form.

## 9. Structure-list projection

The compact structure UI presents these capabilities according to document meaning:

- Targets surface information and format properties through their properties and actions.
- Layers and sources surface scoped information such as dimensions, profile, metadata, and hover-sample context.
- Transforms and processing operations appear as reorderable processor rows.
- Masks appear as dependency state with direct navigation and brush actions.
- A brush operation appears as one summarized authored operation or mask, not one row per stroke.
- Format conversion and export actions do not masquerade as processor rows unless they create an actual document node.

This keeps the list compact while leaving every authored result re-enterable.

## 10. Delivery order

The structure-list foundation can proceed while the capability baseline guides fixtures, actions, badges, and property contexts.

After the static structure-list slice, implementation should proceed through focused product slices:

1. Information and format contracts: print resolution, metadata storage and viewing, profile distinctions, hover sampling, and codec settings.
2. Transform completion: explicit resize semantics, rotate controls, and projective rectification.
3. Processing completion: curves, image invert, and composite or per-channel targeting for tonal tools.
4. Brush architecture: stroke document, localized invalidation, pointer arbitration, and undo.
5. Brush tools: masking first, then median and the precisely selected cleanup behavior.

Each slice includes document and command semantics, headless evaluation tests, persistence, accessible controls, and isolated browser validation where visible.

## 11. Open decisions

1. Does format thumbnail mean an embedded codec thumbnail, a separately exported thumbnail artifact, or both?
2. Which print-resolution units should be editable in the first UI beyond PPI presentation?
3. Which embedded profiles and ICC workflows belong in the first expansion beyond sRGB and Display P3?
4. Which compression controls are required for PNG, JPEG, and WebP in the first format-settings UI?
5. Does rectify begin with manual four-corner perspective correction, or is another geometry intended?
6. Which cleanup behavior should ship first: clone, heal, or another precisely defined correction?
7. Should the localized median brush also create a reusable global median processor in the first implementation?
