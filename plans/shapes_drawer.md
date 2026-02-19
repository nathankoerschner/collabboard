# Shapes Drawer — Implementation Spec

## Summary

Replace the separate rectangle and ellipse toolbar buttons with a single **Shapes** button that opens a popover grid of shape options. Introduce a unified `shape` object type with a `shapeKind` field. Migrate existing rectangles and ellipses to the new type on board load.

---

## Toolbar Changes

### Button
- Remove the **rectangle** and **ellipse** toolbar buttons.
- Add a single **Shapes** button in their place with a static icon (overlapping square + circle).
- Remove the `r` and `e` keyboard shortcuts. No keyboard shortcut for the drawer.

### Drawer UI
- **Popover** anchored directly below the Shapes button, with a subtle upward-pointing arrow. White background, `border-radius: 12px`, `box-shadow: var(--shadow-md)`, `z-index: 25` (above toolbar).
- **Flat grid** of static SVG icons — no category headers, no tabs. 4-5 columns, compact spacing.
- Clicking a shape icon **closes the drawer immediately** and activates that shape tool (crosshair cursor).
- **Dismiss**: click-away anywhere outside the drawer, press Escape, or click the Shapes button again.
- Clicking the canvas while the drawer is open dismisses it (does not place a shape).

---

## Data Model

### New unified `shape` type
All shapes (including migrated rectangles and ellipses) use a single Yjs object type:

```
{
  id, type: 'shape', shapeKind: string,
  x, y, width, height, rotation,
  color, strokeColor,
  createdBy, parentFrameId
}
```

- `shapeKind` values: `rectangle`, `roundedRectangle`, `ellipse`, `triangle`, `diamond`, `pentagon`, `hexagon`, `star5`, `star6`, `starburst`, `badge`, `arrowRight`, `arrowLeft`, `arrowUp`, `arrowDown`, `arrowDouble`, `speechBubble`, `callout`, `heart`, `cloud`, `cross`, `cylinder`, `parallelogram`, `trapezoid`
- No `text` field — new shapes do not support inline text editing.
- No connector anchor ports on new shapes initially (except migrated rectangle/ellipse which retain standard 4 ports).

### Migration
- On board load, `ObjectStore` scans all objects. Any with `type: 'rectangle'` are converted to `type: 'shape', shapeKind: 'rectangle'`. Same for `type: 'ellipse'` → `shapeKind: 'ellipse'`.
- Migration happens inside a single `doc.transact()` call.
- This is a **breaking change** — old clients will not understand migrated objects.
- Migrated rectangles and ellipses retain all existing fields (text, connector ports, etc.).

---

## Shape Definitions (`ShapeDefs.js`)

New file: `client/src/board/ShapeDefs.js`

Each shape kind maps to:
```js
{
  kind: string,
  label: string,              // Display name for tooltips
  icon: string,               // SVG string for the drawer grid
  defaultWidth: number,
  defaultHeight: number,
  draw(ctx, x, y, w, h),     // Parametric Canvas2D draw function (fill + stroke path)
}
```

### Default sizes (per-shape)
- Symmetric shapes (ellipse, star5, star6, starburst, badge, heart, cross, pentagon, hexagon): **120 × 120**
- Rectangles, rounded rectangles: **200 × 120**
- Directional shapes (arrows, parallelogram, trapezoid, cylinder): **200 × 120**
- Diamond: **140 × 140**
- Speech bubble / callout: **200 × 140**
- Cloud: **180 × 120**
- Triangle: **160 × 140**

### Color defaults
All shapes share the **same** default: blue fill (`#bfdbfe`) + gray stroke (`#e5e7eb`), matching current rectangle behavior.

---

## Rendering

### Renderer changes
- `Renderer.js` imports `ShapeDefs` and delegates to the appropriate `draw()` function.
- Existing `drawRectangle` and `drawEllipse` methods are replaced by a single `drawShape(ctx, obj)` that looks up `obj.shapeKind` in `ShapeDefs` and calls the draw function inside `_drawRotatedBox`.
- Each `draw()` function receives local coordinates (already translated/rotated by `_drawRotatedBox`) and is responsible for `ctx.fill()` + `ctx.stroke()`.

### Hit Testing
- `HitTest.js` gets a new `hitTestShape(point, obj)` method.
- For each shape, use **precise point-in-polygon** testing against the shape's actual path.
- `ShapeDefs` entries include a `path(x, y, w, h)` method that returns a list of polygon points (or a `Path2D` for curves) used by both rendering and hit-testing.
- For shapes with curves (ellipse, cloud, heart, speech bubble), use `ctx.isPointInPath()` with a cached `Path2D`.

---

## Placement Interaction

### Click-to-place (default)
- Click canvas → shape appears at default size centered on click point. Same as current behavior.
- Tool auto-resets to `select` after placement.

### Click-and-drag to size
- If the user clicks and drags (mouse moves > 5px before mouseup), the drag defines the shape's bounding box.
- `InputHandler` detects the drag during `mousedown` → `mousemove` → `mouseup` and creates the shape with the dragged dimensions instead of defaults.
- During drag, render a dashed outline preview of the bounding box.
- Tool still auto-resets to `select` after placement.

---

## Resize Behavior

- **Free-form stretching** for all shapes, matching current rectangle behavior.
- No aspect-ratio locking. Shapes like stars will stretch/squish proportionally to the bounding box.

---

## Connector Behavior

### Existing connectors unchanged
- The connector tool is **not** part of the shapes drawer. It remains a separate toolbar button.
- **Enhancement**: Add styling options (color, thickness, dash pattern) to connectors. This is a separate follow-up, not part of the initial shapes drawer implementation.

### Anchor ports on new shapes
- New shape kinds (star, arrow, etc.) do **not** get connector anchor ports in v1.
- Migrated rectangles and ellipses retain their standard 4 ports (top, right, bottom, left).

---

## Clipboard

- Copy/paste preserves `shapeKind` as-is. No special handling needed — the existing ID-remapping logic in `Clipboard.js` copies all fields including `shapeKind`.

---

## AI Agent Updates

- Replace `create_rectangle` and `create_ellipse` tools with a single **`create_shape`** tool.
- Schema: `{ shapeKind: string, x: number, y: number, width?: number, height?: number, color?: string }`
- `shapeKind` is required. Width/height default to the shape's defaults from `ShapeDefs`.
- Update `server/src/ai/tools.js` schema and `agent.js` handler.

---

## Files to Modify

| File | Change |
|------|--------|
| `client/src/board/ShapeDefs.js` | **NEW** — shape definitions, draw functions, icons, defaults |
| `client/src/board/Schema.js` | Add `shape` type defaults, remove `rectangle`/`ellipse` as separate types |
| `client/src/board/ObjectStore.js` | Migration logic on load, `createObject` handles `shape` type with `shapeKind` |
| `client/src/board/Clipboard.js` | No changes needed (shapeKind copies automatically) |
| `client/src/canvas/Renderer.js` | Replace `drawRectangle`/`drawEllipse` with `drawShape`, import ShapeDefs |
| `client/src/canvas/InputHandler.js` | New `_createForTool` handling for shape kinds, click-and-drag sizing, remove `r`/`e` shortcuts |
| `client/src/canvas/HitTest.js` | Add `hitTestShape` with point-in-polygon for each shape kind |
| `client/src/canvas/Canvas.js` | Wire up new tool type, pass shapeKind through |
| `client/src/views/board.ts` | Replace rect+ellipse buttons with Shapes button, add drawer DOM + event handlers, remove `r`/`e` shortcuts |
| `client/src/styles/board.css` | Styles for `.shapes-drawer` popover, grid layout, hover states |
| `server/src/ai/tools.js` | Replace `create_rectangle`/`create_ellipse` with `create_shape` |
| `server/src/ai/agent.js` | Handle `create_shape` tool calls |

---

## Out of Scope (v1)

- Text inside new shapes (only migrated rect/ellipse retain text support)
- Connector anchor ports on new shapes
- Connector styling enhancements (color, thickness, dash)
- Keyboard shortcuts for the shapes drawer
- Shape search/filter in drawer
- Aspect-ratio locking on resize
