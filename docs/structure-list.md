# Structure list

Status: in progress. Implementation phases 0 through 2 are complete.

The structure list is a compact, touch-friendly projection of Pixelf's target-first document tree.
It is intended to replace the current layer tree and its separate strip of top-level actions without exposing renderer implementation details in the common workflow.

The first consumer is the pinned structure panel inside Pixelf.
The headless parts should avoid Pixelf document imports where that costs little, but portability to other products is a review criterion rather than a promise to build speculative adapters.

## 1. Product boundary

Pixelf should retain GPU-specific execution capabilities without making GPU concepts part of ordinary authoring.
Users author targets, layers, masks, adjustments, and sources.
The engine chooses how to evaluate those operations.

The existing operation registry and runtime are the foundation for this separation:

- Operation definitions retain CPU and GPU runner information, region and quality behavior, and any future feature, format, limit, cancellation, or bounded-work requirements.
- Runtime state retains adapter acquisition, device loss, pipeline diagnostics, resource budgets, scheduling, fallback routing, and performance metrics.
- The project document never stores which backend happened to render a preview.
- The ordinary interface describes results and actionable problems, not shaders, uploads, workgroups, pipelines, or texture formats.
- Detailed backend information belongs in an optional diagnostics view under settings.

The canvas should be exposed as an edited image preview rather than a WebGPU preview.
The visible status surface should report states such as rendering, preview unavailable, or reduced-performance compatibility rendering.
It should mention a GPU only when that detail helps the user resolve a problem.

This is presentation-level progressive disclosure, not a reduction in engine capability.

## 2. Terminology

The word *tile* is already taken by region evaluation in the compositor.
It must not be reused for a list element.

| Term | Meaning |
| --- | --- |
| Structure list | The complete headless model, interaction logic, view, and active container adapter. |
| Chiclet | One visual list element representing one document node. |
| Row | The headless model of one visible node. |
| Interior | Pluggable content inside a chiclet, such as a thumbnail, glyph, label, or synthetic summary. |
| Rail | The ordered inline actions revealed for a chiclet. |
| Action | A UI declaration that produces either a document command or an editor-state effect. |
| Arbiter | The pointer-intent state machine. |
| Adapter | The mapping from a host snapshot to rows, legal drop plans, actions, and presentation metadata. |
| Visual boundary | A position between visible rows before host document semantics are applied. |
| Drop plan | One adapter-produced, validated result used for both preview and commit. |

An action is distinct from a document command.
A document command is the authored mutation and undo boundary, while an action can also open properties, change expansion, focus a group, or invoke another editor-only behavior.

## 3. Goals

- Make the target-first layer structure approachable without flattening away its meaning.
- Give keyboard, mouse, pen, and touch access to the same capabilities, while allowing modality-appropriate gesture initiation.
- Support direct, cancelable reorder and reparent interactions whose preview cannot disagree with the committed result.
- Remain legible as panel width and row density shrink.
- Declare actions once and derive the rail, overflow, context, quick-action, and keyboard surfaces from that declaration.
- Keep the properties panel optional for navigation and common actions, but available for detailed editing.
- Keep document meaning separate from selection, focus, expansion, drag, thumbnail, and renderer state.
- Keep geometry, selection, pointer intent, drop resolution, density, and action derivation deterministic and headless-testable.

## 4. Non-goals

- Replacing the properties panel.
- Rendering wires as ordered rows.
- Creating a general drag-and-drop framework.
- Creating a general node-canvas UI.
- Exposing GPU routing as an authoring choice in the common interface.
- Implementing multi-select drag in the first slice.
- Implementing virtualization before document sizes and measurements justify it.
- Building canvas-stack, slide-sorter, asset-library, or cross-repository consumers before the pinned Pixelf panel proves the contract.
- Adding animation polish beyond clear state and drop feedback.

## 5. Pixelf structure semantics

The structure list presents Pixelf's canonical primary tree, not a generic nested collection.

A target owns an ordered list of layers.
A layer owns one primary child.
Processors also own one primary child.
Sources are leaves.
Wires express secondary dependencies and do not participate in primary ordering.

```text
Target
|-- Layer A
|   `-- Exposure
|       `-- Imported source
`-- Layer B
    `-- Blur
        `-- Generated source
```

These distinctions affect move semantics:

- Moving a layer within or between targets changes an ordered child position.
- Inserting or moving a processor at a point in a unary branch rewrites a primary edge.
- Reordering processors can require one atomic structural command rather than a simple parent-and-index move.
- A source cannot accept a primary child.
- A layer cannot become the unary child of another layer or processor.
- A target cannot become another node's child.

The structure-list engine resolves pointer geometry into a visual boundary and requested depth.
The Pixelf adapter resolves that intent into document semantics.
This prevents a generic tree algorithm from inventing invalid meanings for unary chains.

## 6. Architecture

The structure list has a headless core and a direct-DOM view.

```text
                         +---------------------------+
                         |      structure list       |
                         | rows, focus, selection,   |
                         | arbiter, geometry, density|
                         +---------------------------+
                            |        |        |
             +--------------+        |        +----------------+
             v                       v                         v
       interior policy       action surfaces            host adapter
       and badge slots       and focus handoff       rows and drop plans
             |                       |                         |
             +-----------------------+-------------------------+
                                     |
                                     v
                           direct-DOM list view
```

The engine does not interpret node kinds, document commands, badge meanings, thumbnails, or editor effects.
The Pixelf adapter is the only structure-list module that understands targets, layers, processors, sources, wires, and `ProjectCommand`.

The existing `src/ui/actions.ts` should grow into the shared action declaration used by quick actions and structure-list surfaces.
The structure list must not introduce an unrelated second action registry.

### 6.1 Proposed module layout

```text
src/ui/actions.ts                         shared UI action declarations
src/ui/structure-list/
  index.ts                               public surface
  model.ts                               rows, flattening, focus, selection
  arbiter.ts                             pointer intent state machine
  drop.ts                                visual boundaries and depth requests
  density.ts                             tier and interior policy
  action-surfaces.ts                     rail and overflow derivation
  view/
    list-view.ts                         direct DOM and Solid primitives
    chiclet.ts
    rail.ts
    badges.ts
    drag-layer.ts
  adapters/
    pixelf-document.ts                   project snapshot to rows and commands
    pinned-panel.ts                      active container policy
  structure-list.css
test/structure-list/
  model.test.ts
  arbiter.test.ts
  drop.test.ts
  action-surfaces.test.ts
docs/structure-list.md
```

Only `view/` touches the DOM or imports Solid.
The Pixelf adapter can import canonical project and command modules, but the headless structure-list core cannot.

## 7. Core contracts

Source examples remain 7-bit ASCII.

```ts
export type NodeId = string;

export type Density = "micro" | "compact" | "standard" | "expanded";

export type PrimaryRelation = "root" | "ordered-child" | "unary-child";

export interface Row {
  nodeId: NodeId;
  parentId: NodeId | null;
  depth: number;
  documentIndex: number;
  relation: PrimaryRelation;
  kind: string;
  name: string;
  hasChildren: boolean;
  expanded: boolean;
  selectable: boolean;
  acceptsVisualDepth: boolean;
  height: number;
}

export interface ListModel {
  rows: readonly Row[];
  rowTop: Float32Array;
  totalHeight: number;
}

export interface VisualDropIntent {
  moving: readonly NodeId[];
  beforeId: NodeId | null;
  afterId: NodeId | null;
  requestedDepth: number;
  boundaryIndex: number;
}

export interface DropPlacement {
  boundaryIndex: number;
  depth: number;
  announcement: string;
}

export interface DropPlan<TCommand> {
  command: TCommand;
  placement: DropPlacement;
  snapshotRevision: string;
}

export interface StructureAdapter<TSnapshot, TCommand> {
  childOrder: "document" | "reversed";

  revisionOf(snapshot: TSnapshot): string;
  rootsOf(snapshot: TSnapshot): readonly NodeId[];
  childrenOf(snapshot: TSnapshot, id: NodeId): readonly NodeId[];
  describe(snapshot: TSnapshot, id: NodeId): Omit<Row, "depth" | "documentIndex" | "height">;

  planDrop(snapshot: TSnapshot, intent: VisualDropIntent): DropPlan<TCommand> | null;
}
```

`rowTop` has `rows.length + 1` entries so it includes the end boundary.
Pointer coordinates are normalized into list-content coordinates before they reach the headless resolver.

`documentIndex` is always the canonical child index, even when display order is reversed.
Display position is the row's array index.
Keeping the two distinct prevents a top-first layer panel from committing the wrong canonical index.

### 7.1 One plan for preview and commit

The adapter returns the complete command during planning.
The preview renders `DropPlan.placement`, and release dispatches that exact `DropPlan.command`.

The adapter must call a canonical Pixelf structural planner rather than duplicating validation rules in the UI.
The command boundary still validates the resulting project.

If the project revision changes during a gesture, the adapter replans from the current pointer intent.
If replanning returns null, the gesture shows a rejected state and release cancels.

This avoids both rule drift and a time-of-check/time-of-use mismatch.

### 7.2 Pixelf drop targets

The Pixelf structural planner distinguishes at least these semantic targets:

```ts
export type PixelfDropTarget =
  | { kind: "target-layer-position"; targetId: string; index: number }
  | { kind: "primary-edge"; parentId: string; childId: string }
  | { kind: "empty-primary-slot"; parentId: string };
```

The eventual command may be a `move-node`, a batch, or a dedicated atomic chain-reorder command.
The structure-list contract does not assume which command representation Pixelf uses.

## 8. Focus and selection

The first implementation is a single-select tree with selection following focus.
This matches the existing editor behavior and keeps the properties panel synchronized with keyboard traversal.

Focus and selection remain separate fields in the headless model even while their behavior is coupled.
That preserves a path to multi-select without changing row rendering or accessibility state later.

Multi-select is deferred until these semantics are specified and tested:

- Selection containing both an ancestor and its descendant must normalize to independent highest selected roots before a move.
- Non-contiguous rows must preserve relative document order when moved.
- Hidden descendants of a collapsed node need an explicit selection policy.
- Range selection must define whether it follows display order or canonical document order.
- One multi-item drop must still commit as one document command.

## 9. Interaction model

### 9.1 Tap, click, disclosure, and edit

| Input | Result |
| --- | --- |
| Tap or click a chiclet | Focus and select it, showing its properties. |
| Tap or click the disclosure affordance | Toggle expansion without changing selection. |
| Double click the label with a precise pointer | Rename inline when rename is available. |
| Activate Rename from the rail or overflow | Rename with keyboard, touch, mouse, or pen. |
| Right click or two-finger tap | Open the same ordered action set as the rail plus overflow. |

A second tap on an already selected chiclet does not silently enter another mode.
Direct editing is an explicit action.

### 9.2 Keyboard

The structure list is one stop in the page tab sequence.
Tab and Shift+Tab leave the tree as expected for a composite widget.

| Key | Action |
| --- | --- |
| Up / Down | Move focus and selection to the previous or next visible row. |
| Home / End | Move focus and selection to the first or last visible row. |
| Left | Collapse an open row, or move to its parent. |
| Right | Expand a closed row, or move to its first child. |
| Enter | Invoke the row's primary editor action, normally showing or focusing properties. |
| Space | Select the focused row. |
| F2 | Rename when available. |
| Cmd/Ctrl + Up/Down | Move the selected item through an ordered sibling list when legal. |
| Registered move-in/move-out shortcuts | Request a shallower or deeper legal structural plan. |
| Cmd/Ctrl + . | Open the action toolbar or overflow at the focused row. |
| Escape | Close edit, menu, toolbar, or drill-in state in that order and return focus to the row. |

The final move-in and move-out shortcuts require platform testing before they are fixed.
They must not consume Tab and must not conflict with tree type-ahead.

The tree supports type-ahead by node name.
Unmodified single-letter action accelerators are not used while the tree owns focus.

### 9.3 Pointer intent

Pointer gestures move through a small, immutable latch state machine.

```text
idle -> pending -> latched(kind) -> committed
                              \
                               -> canceled
```

For mouse and pen, movement beyond a small slop radius can latch vertical reorder or horizontal rail reveal by axis dominance.
Once latched, the gesture kind does not change.

Touch uses a stricter baseline:

- Vertical movement on the row belongs to native scrolling.
- Horizontal movement on the row reveals the rail.
- Reorder begins from a visible leading grab region with `touch-action: none` set before pointerdown.
- The rest of the row uses `touch-action: pan-y`.
- Long-press reorder is not a baseline requirement because changing `touch-action` after pointerdown cannot reliably take a gesture away from native panning.

The grab region provides capability parity without making scrolling fragile.
It must have an accessible name and a large enough hit area for touch even when the interior is visually dense.

See the Pointer Events specification's rules for the [`touch-action` property](https://www.w3.org/TR/pointerevents/#the-touch-action-css-property).

### 9.4 Reorder geometry

At lift, the dragged visual subtree is removed from the row geometry and represented by one lifted chiclet.
Geometry is snapshotted into `rowTop`, and pointermove does not call `getBoundingClientRect`.

Vertical position selects a visual boundary by binary search.
Horizontal offset requests a depth relative to the lift origin.
The engine passes the boundary and requested depth to the adapter.

The adapter can resolve to a nearby legal depth, but it must return the resolved placement that will actually be committed.
If no legal plan exists, the preview shows a rejected state and release cancels.

Depth and density are frozen for the duration of the gesture.
Panel resize or responsive traversal changes cannot reinterpret an active drag.

Auto-scroll engages near the viewport ends and continues to update the visual boundary from content coordinates.
Its speed curve and activation distance are tuning values established by pointer traces and browser testing rather than fixed architectural constants.

### 9.5 Commit

A drag dispatches exactly one planned command on release.
Intermediate pointer positions remain editor state and never enter the document or undo stack.

Release without a current legal plan is a cancel.
Escape and `pointercancel` also cancel and restore the pre-gesture focus presentation.

## 10. Density and legibility

Density is a presentation policy based on both row height and available inline space.
Height chooses the interior's information budget, while width determines labels, metadata, and rail capacity.

| Tier | Visual interior | Label | Rail |
| --- | --- | --- | --- |
| micro | Type glyph plus representative-color chip, with no raster request | Truncated single line | Overflow only |
| compact | Low-LOD thumbnail plus glyph | Single line | Up to two actions when space permits |
| standard | Thumbnail primary | Label plus secondary metadata | Up to four actions when space permits |
| expanded | Large thumbnail with inline metadata | Full | Full rail |

Container policies provide minimum interactive hit areas independently of visual density.
The pinned touch presentation must not turn a micro visual into a micro touch target.

The representative-color chip comes from the smallest available alpha-safe mip.
It is an average-like summary, not a promise to identify a mathematically dominant color.

At narrow widths, content drops by declared priority rather than shrinking below legibility.
The policy must be stable around thresholds and must preserve focus and selection through a density transition.

### 10.1 Thumbnail requests

The interior renderer requests a thumbnail of the represented node's evaluated output in its target context.
It does not assume every row maps directly to a source asset.

- Request an explicit output region at an explicit scale through the shared scheduler.
- Select an alpha-safe mip level appropriate to the box size and device pixel ratio.
- Include the node and reachable dependency revisions, target format, quality, and selected LOD in cache identity.
- Reject stale generations before they publish.
- Cancel or deprioritize requests when their rows leave the active window.
- Do not enqueue thumbnail work at micro density.

Thumbnail generation remains a derived runtime projection and never enters the project document.

## 11. Badge slots

Badges use fixed anchors and a fixed priority so adapters cannot create conflicting placement rules.

| Slot | Meaning | Notes |
| --- | --- | --- |
| Edge tint or border | Type identity | Always present and independent of selection. |
| NW corner | Primary structure | Disclosure and optional child count. |
| NE corner | Ownership or link state | Shared source, external asset, or relink needed. |
| SE corner | Secondary dependencies | Mask, effect, or wire dependency. |
| SW corner | Runtime state | Evaluating, stale, warning, or error. |
| Interior scrim | Whole-item state | Hidden, bypassed, or locked when those semantics exist. |

Selection uses an offset ring outside the chiclet so it does not erase type identity.
At micro density, only the edge identity, disclosure, and whole-item scrim are retained.

The structure list does not assume that every host supports visibility, locking, grouping, or isolation.
Those badges and actions appear only when the adapter declares real semantics for them.

## 12. Shared action declarations

Actions are declared once and projected into several surfaces.

```ts
export type ActionSurface =
  | "rail"
  | "overflow"
  | "context"
  | "properties"
  | "menu"
  | "quick-actions"
  | "keyboard";

export type ActionResult<TCommand, TEditorEffect> =
  | { kind: "command"; command: TCommand }
  | { kind: "editor"; effect: TEditorEffect };

export interface UiAction<TContext, TCommand, TEditorEffect> {
  id: string;
  label: string;
  glyph?: string;
  group: string;
  priority: number;
  surfaces: readonly ActionSurface[];
  shortcut?: string;
  keywords?: readonly string[];
  visible?(context: TContext): boolean;
  enabled?(context: TContext): boolean;
  invoke(context: TContext): ActionResult<TCommand, TEditorEffect>;
}
```

The existing quick-action palette consumes these declarations rather than maintaining duplicate labels and enabled rules.

Surface derivation follows one ordering:

- The rail receives the highest-priority visible actions that fit its measured capacity.
- Overflow receives the remaining visible rail-capable actions in the same order.
- The context menu receives the complete visible context-capable set in the same group order.
- The properties panel receives actions explicitly declared for that surface.
- The main menu receives actions explicitly declared for that surface.
- Quick actions receives searchable actions explicitly declared for that surface.
- Keyboard invokes the same action ID and therefore the same enabled rule and result.

Rail and overflow are a disjoint partition for a given context and capacity.
An action has one label regardless of surface.

There is no universal baseline action list.
The Pixelf adapter initially declares only actions backed by current document or editor semantics, such as add layer, add operation, add mask, duplicate, rename, delete, show properties, and legal movement.

### 12.1 Rail focus

The tree row remains the single focusable tree item.
The rail is rendered as an anchored toolbar outside the tree item's interactive subtree.

Pointer and touch can invoke a visible rail button directly.
Keyboard opens the toolbar or overflow explicitly, transfers focus into it, and Escape returns focus to the originating tree item.
Collapsed or hover-only rail controls are not inserted into the page tab sequence.

Nothing is available only on hover or only on long press.

## 13. Wires and secondary dependencies

Wires are not ordered rows.
A wire has no meaningful layer index, and putting it in the flattened primary list would create false reorder semantics.

A dependent node instead shows an SE dependency badge.
Activating it opens a secondary-input disclosure that lists the port, connected source, status, and legal actions.
The properties panel presents the same dependency information in expanded form.

Every connected source must remain reachable, selectable, editable, relinkable, and disconnectable through those surfaces.
Removing wired sources from the primary row list must not make them invisible to keyboard or assistive-technology users.

## 14. Traversal and containers

The pinned Pixelf panel uses inline accordion traversal in the first implementation.
Its panel remains a content-height float and gains internal scrolling only when bounded by the viewport.

Drill-in navigation may later be added when real depth and narrow-screen testing show that indentation consumes too much width.
An automatic transition must use hysteresis, preserve the active node and breadcrumb, and never occur during a pointer gesture or inline edit.
An explicit focus-group action remains available if drill-in is introduced.

Candidate future containers are recorded without being implementation commitments:

| Adapter | Possible presentation | Status |
| --- | --- | --- |
| pinned-panel | Vertical compact accordion | First consumer. |
| canvas-stack | Collapsed stack expanding in place | Deferred until Pixelf has a concrete workspace use case. |
| navigator | Vertical or grid thumbnail navigation | Deferred until a multi-page artifact exists. |
| asset-library | Grid or drill-in browser | Cross-product review only after a second consumer proves the boundary. |

Expansion is editor state keyed by node ID and may be stored in session or recovery state.
It is not canonical project meaning.

## 15. Accessibility

The pinned container uses `role="tree"` and each chiclet uses `role="treeitem"` with `aria-level`, `aria-posinset`, `aria-setsize`, `aria-expanded` where applicable, and `aria-selected`.
The first implementation is single-select and does not set `aria-multiselectable`.

Roving tabindex or `aria-activedescendant` may implement composite focus, but the chosen approach must preserve focus through rerender, expansion, density changes, and action-toolbar handoff.
Tab enters and exits the tree.
Arrow keys navigate within it according to the WAI-ARIA tree-view pattern.

See the [WAI-ARIA tree-view pattern](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/) and [keyboard-interface guidance](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/).

Every change of resolved drop is announced through a polite live region using the plan's announcement string.
Pointer and keyboard moves produce the same announcement for the same plan.

Stable browser selectors use node and action IDs:

```text
data-testid="structure-row-<nodeId>"
data-testid="structure-action-<actionId>"
```

Runtime state, dependency state, and selection must remain distinguishable without color alone.
Reduced-motion preferences apply to gap, lift, and rail transitions.

## 16. Performance

- Row heights are analytic within a frozen density tier.
- `rowTop` is a prefix array and boundary lookup is a binary search.
- Pointermove performs no layout reads.
- The lifted chiclet moves with transforms.
- Coalesced pointer samples may inform the latest position, but resolution and painting happen at most once per animation frame.
- Thumbnail work uses the existing generation-aware scheduler and cannot publish stale results.
- Micro density suppresses thumbnail requests entirely.
- Performance budgets are measured before fixed thresholds are adopted.

Virtualization is added only after representative projects demonstrate a need.
If introduced, the focused and selected rows remain mounted, ARIA set metadata describes the complete logical tree, and browser tests cover screen-reader-relevant state across window changes.

## 17. Testing

### 17.1 Headless tests

`model.test.ts` covers flattening, canonical versus reversed display order, expansion, focus, single selection, and row geometry.

`arbiter.test.ts` covers pointer slop, immutable latch behavior, rail versus reorder intent, grab-region touch initiation, Escape, and pointercancel.

`drop.test.ts` covers visual boundary lookup, requested depth, content-coordinate normalization, revision changes, rejected plans, target layer positions, unary edges, empty unary slots, and ancestor-cycle rejection.

`action-surfaces.test.ts` verifies that rail and overflow are disjoint, action labels do not vary by surface, ordering is stable, and unavailable surfaces cannot invoke an action.

Pixelf adapter tests assert that preview and commit use the same command and that every accepted command passes canonical project validation.

### 17.2 Browser tests

Browser validation uses the repository's isolated Playwright MCP workflow.

- Inspect the initial tree through an accessibility snapshot.
- Exercise selection, expansion, type-ahead, Home, End, arrow navigation, Tab exit, and property synchronization.
- Reorder layer siblings with pointer and keyboard and compare resulting document state.
- Insert or move a processor at a unary edge once that command exists.
- Emulate touch scrolling, horizontal rail reveal, and grab-region reorder.
- Confirm rail-toolbar focus transfer and Escape return.
- Capture each implemented density tier and dependency badge state.
- Confirm that micro density does not enqueue thumbnail work.
- Inspect console errors and failed image, worker, WASM, WebGPU, and thumbnail requests.
- Record GPU availability when the exercised flow depends on the GPU path, while keeping the visible assertions backend-neutral.

## 18. Implementation sequence

The implementation proceeds through vertical slices in the pinned Pixelf panel.

| Phase | Scope | Completion condition |
| --- | --- | --- |
| 0 | Adopt backend-neutral preview and rendering terminology; generalize shared UI action declarations without changing behavior. | The common UI no longer presents WebGPU as an authoring concept, and existing quick actions use the shared declaration. |
| 1 | Add headless model and density policy plus a static direct-DOM pinned list from fixture data. | Fixture trees render legibly at implemented widths and densities with no interaction. |
| 2 | Add single-select focus, expansion, type-ahead, properties synchronization, and action-toolbar focus. | Keyboard behavior matches the accessibility contract and the tree is one tab stop. |
| 3 | Add canonical Pixelf drop planning for ordered layer positions and one-command pointer and keyboard commit. | Layer reorder preview and committed state agree, including reversed display order. |
| 4 | Add atomic unary-edge insertion and processor reorder semantics, then connect them to visual depth requests. | Valid processor moves preserve one-child structure and commit as one undo unit. |
| 5 | Add touch grab reorder, horizontal rail reveal, pointer intent, auto-scroll, and responsive density locking. | Touch can scroll, reveal actions, and reorder without gesture ambiguity. |
| 6 | Add thumbnails, badges, and secondary-input disclosure through the scheduler. | Stale thumbnails cannot publish, micro enqueues none, and wired sources remain fully navigable. |
| 7 | Review the proven headless boundary for a second in-repo consumer. | No speculative adapter is added; portability changes are driven by concrete use. |

Each phase ends with the repository verification gate green.
Browser-visible phases also complete the browser validation described above.

## 19. Open decisions

1. Which non-Tab shortcuts should represent move-in and move-out on macOS, Windows, and Linux?
2. Should the pinned layer panel display target children in reversed compositing order from its first release?
3. Which atomic document command best represents processor-chain reorder and insertion?
4. Should selecting a dependency in the secondary-input disclosure replace primary-tree selection or open a tethered dependency inspector?
5. Which density tiers are useful in the first pinned panel, and what minimum width triggers drill-in exploration?
6. Should a narrow mobile properties surface be a tethered panel, a bottom sheet, or an explicit full-screen inspector?
7. Which renderer details and copy belong in the optional diagnostics view?

## 20. Prototype note

Before pointer behavior hardens, build an instrumented fixture list with a latch-state readout, visual boundary, requested depth, resolved placement, snapshot revision, and density controls.
Recorded pointer traces from mouse, pen, and touch become deterministic arbiter and drop fixtures.

The prototype should include a realistic Pixelf target with multiple layers, unary processor chains, a mask dependency, a missing linked source, and an evaluating row.
That fixture tests the actual product model instead of proving only a generic nested list.
