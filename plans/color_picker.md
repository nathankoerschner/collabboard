# Color Picker — PRD

## Summary

Allow users to change the fill color of any selected object (sticky note, shape, frame, text) via a floating color picker that appears above the selection. Stickies use named colors from the existing palette; shapes/frames/text use hex values. Connectors have no fill color and are excluded.

---

## Current State

- **Palette** (`ObjectStore.ts`): 10 named sticky colors — yellow, blue, green, pink, purple, orange, red, teal, gray, white — each mapped to a hex value.
- **Shapes** (`rectangle`, `ellipse`, `shape`): store `color` as a hex string (fill) and `strokeColor` as a hex string (border).
- **Text**: stores `color` as a hex string (text color).
- **ObjectStore**: already has `updateColor(id, color)` that writes to the Yjs doc.

---

## UX Design

### Trigger
- When one or more objects are selected, a **floating toolbar** appears above the selection bounding box.
- The toolbar contains a **color swatch button** showing the current fill color of the selection (or a mixed indicator if multiple colors are selected).
- Clicking the swatch opens the **color picker popover**.
- when clicking

### Color Picker Popover
- **Position**: anchored below the floating toolbar swatch button, centered horizontally. Falls back to above if near the bottom of the viewport.
- **Style**: white background, `border-radius: 8px`, `box-shadow: var(--shadow-md)`, `z-index: 30` (above everything).
- **Layout**:
  - A grid of circular color swatches (5 columns).
  - The currently active color has a visible checkmark or ring indicator.
- **Dismiss**: click-away, Escape key, or clicking the swatch button again.

### Color Swatches

#### For Sticky Notes
Show the 10 named palette colors:
| yellow | blue | green | pink | purple |
|--------|------|-------|------|--------|
| orange | red  | teal  | gray | white  |

Stored as the named string (e.g. `"blue"`), rendered via the existing palette lookup.

#### For Shapes (rectangle, ellipse, shape type)
Show a curated set of 10 fill hex colors:
| #bfdbfe (blue) | #bbf7d0 (green) | #fecdd3 (pink) | #e9d5ff (purple) | #fed7aa (orange) |
|----------------|-----------------|----------------|------------------|-----------------|
| #fecaca (red)  | #99f6e4 (teal)  | #e5e7eb (gray) | #ffffff (white)  | #fef08a (yellow) |

These intentionally match the sticky palette hex values for visual consistency.

Optionally, a second row of stronger/saturated variants:
| #3b82f6 | #22c55e | #f43f5e | #a855f7 | #f97316 |
|---------|---------|---------|---------|---------|
| #ef4444 | #14b8a6 | #6b7280 | #0f172a | #eab308 |

#### For Frames
Same hex grid as shapes — changes the frame border color.

#### For Text
Same hex grid but applied to the text content color.

### Multi-Selection Behavior
- If all selected objects share the same color, show that color as active.
- If colors differ, show no active indicator (all swatches appear neutral).
- Clicking a swatch applies the new color to **all** selected objects.
- Mixed object types (e.g. sticky + shape) are supported — stickies get the named color, shapes get the hex equivalent.

---

## Keyboard Shortcut

- No dedicated keyboard shortcut for opening the picker.
- Arrow keys do not navigate inside the picker — it is click-only.

---

## Data Model Changes

**None.** The `color` field already exists on all relevant object types. `updateColor()` already exists in `ObjectStore`. No schema migration needed.

---

## Implementation Plan

### 1. Floating Selection Toolbar (`client/src/canvas/SelectionToolbar.ts` — new file)
- Renders a small DOM element positioned in screen-space above the selection bounding box.
- Repositions on camera pan/zoom and selection move.
- Contains the color swatch button (and later, other actions like delete, duplicate).
- Hidden when nothing is selected or during drag/resize operations.

### 2. Color Picker Popover (`client/src/canvas/ColorPicker.ts` — new file)
- Renders the swatch grid as a DOM popover.
- Accepts a config: `{ colors: Array<{name: string, hex: string}>, activeColor: string, onSelect: (color: string) => void }`.
- For stickies, `onSelect` emits the named color string.
- For shapes/frames/text, `onSelect` emits the hex string.

### 3. Wire Up in `board.ts`
- On `onSelectionChange`, create/update/hide the `SelectionToolbar`.
- On swatch click, call `objectStore.updateColor(id, color)` for each selected object.
- Connectors are excluded from color changes (skip silently).

### 4. Renderer — No Changes
- `_color()` already handles both named strings and hex values. No renderer changes needed.

### 5. InputHandler — Passthrough
- Expose selection change events (already done via `onSelectionChange` callback).
- During drag/resize, emit a signal to hide the toolbar temporarily.

---

## Edge Cases

- **Newly created objects**: toolbar appears after the creation click completes and the object becomes selected.
- **Text editing mode**: hide the color picker toolbar while the TextEditor is active (avoid conflicting UI).
- **Zoom**: toolbar size stays constant in screen-space (does not scale with canvas zoom).
- **Connectors in multi-select**: silently ignored when applying color — no error, no UI indication.
- **Undo**: color changes go through `doc.transact()`, so they are undoable via Yjs undo.

---

## Out of Scope (v1)

- Stroke/border color picker (separate control, future work).
- Custom hex input field.
- Recent colors / eyedropper.
- Opacity/transparency slider.
- Gradient fills.
- Per-object color in the AI tool schemas (already supported — no change needed).
