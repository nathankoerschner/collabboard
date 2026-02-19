# Connector Hitbox Glow — Spec

## Overview
When hovering over any shape (except frames), a blue semi-transparent glow appears around the shape's edge as an outer ring. Clicking and dragging from this ring initiates connector creation. This replaces the dedicated connector toolbar tool entirely.

---

## Visual Design

### Glow Appearance
- **Style**: Blue (`#4A90D9` or similar) at ~40% opacity, rendered as a border glow around the shape's exact outline.
- **Ring thickness**: ~8–10px in **screen pixels** (constant regardless of zoom level). The renderer must divide by the current camera zoom to get the canvas-space thickness.
- **Shape conformance**: The glow follows the exact rotated outline of the shape (rectangles follow the rotated rect, ellipses follow the rotated ellipse), expanded outward by the ring thickness.
- **Cursor**: No cursor change — the glow is the sole indicator that the hitbox zone is active.

### When to Show the Glow
- **On hover**: Glow appears immediately when the mouse enters the outer ring zone of any non-frame shape.
- **On selected shapes**: Glow is **suppressed** unless the cursor specifically enters the outer ring zone (i.e., the glow doesn't show on general hover over a selected shape's body — only when the cursor is in the ring).
- **During multi-select**: Glow is **fully suppressed** when shift is held or during marquee drag.
- **During connector drag (target)**: The same blue glow appears on any shape the cursor hovers over, indicating it's a valid drop target.

---

## Interaction Model

### Zones
Each shape has two distinct zones:
1. **Inner body** — clicking here selects/drags the shape (existing behavior, unchanged).
2. **Outer ring** — clicking here initiates connector creation. The ring extends outward from the shape's outline by ~8–10 screen pixels.

### Z-Order Conflicts
When shapes overlap, the **topmost shape (highest z-index) always wins**. Its body area blocks hitbox rings of shapes beneath it.

### Starting a Connector
1. User hovers near a shape's edge → glow appears.
2. User clicks and drags from the outer ring zone.
3. A straight line is drawn from the shape's edge (nearest point) to the current cursor position.
4. The source attachment point is the **exact point on the shape's perimeter** nearest to where the drag started.

### Completing a Connector
- **On a target shape**: If the drag ends over another shape's body or hitbox ring, the connector snaps to the **nearest point on that shape's perimeter**. The target glow indicates valid targets during drag.
- **On empty canvas**: A dangling connector is created with a **floating endpoint** at the exact canvas coordinate. This endpoint can later be dragged and snapped onto a shape.

### What This Replaces
The dedicated connector tool in the toolbar is **removed**. The hitbox glow is the sole way to create connectors.

---

## Edge Attachment & Storage

### Parameterization
Connectors no longer use the 4 predefined anchor ports (top/right/bottom/left). Instead, attachment points are stored as a **normalized parameter `t` (0–1)** along the shape's perimeter.

- **Rectangles**: `t` maps linearly along the perimeter starting from the top-left corner, going clockwise. `0.0` = top-left, `0.25` = top-right, `0.5` = bottom-right, `0.75` = bottom-left, `1.0` = back to top-left.
- **Ellipses**: `t` uses **arc-length parameterization** — `0–1` maps to equal-distance steps along the ellipse perimeter. This avoids point bunching near narrow ends of elongated ellipses. Requires numerical integration (precomputed lookup table or iterative approximation).
- **Stickies**: Same as rectangles (they're visually rounded rects).

### Resize/Move Behavior
When a shape is resized or moved, the connector endpoint stays at the **same proportional position** (`t` value) along the perimeter. The `t` parameter is invariant to scale and translation — the renderer recomputes the actual (x, y) from `t` and the shape's current geometry.

### Schema Changes
Connector objects gain new fields:
- `fromT: number` (0–1) — normalized perimeter parameter on the source shape.
- `toT: number` (0–1) — normalized perimeter parameter on the target shape.
- `fromPoint` / `toPoint` — retained for dangling/floating endpoints (canvas coordinates as `"x,y"` string).
- `fromPort` / `toPort` — **deprecated**, kept for backward compat but ignored if `fromT`/`toT` are present.

---

## Hit Detection Details

### Outer Ring Detection (for rotated shapes)
To determine if a point is in the outer ring of a rotated shape:
1. Transform the mouse point into the shape's local (unrotated) coordinate space.
2. Check if the point is **outside** the shape's outline but **inside** the outline expanded by `ringThickness / zoom`.
3. For rectangles: point is outside the rect but inside a rect expanded by the ring thickness on all sides.
4. For ellipses: point is outside the ellipse but inside an ellipse with semi-axes expanded by the ring thickness.

### Connector-to-Connector
Not supported. Connectors are always shape-to-shape or shape-to-floating-point. No branching or T-junctions.

---

## Touch / Mobile
Not in scope for this iteration. Desktop mouse interaction only. Touch support to be addressed separately.

---

## Implementation Notes

### Renderer Changes
- New drawing pass: after drawing shapes but before drawing selection handles, draw the glow ring for the hovered shape (and target shape during connector drag).
- Glow is drawn by stroking the shape's outline with `lineWidth = ringThickness * 2` (since stroke is centered), clipped to only show the outer half.

### InputHandler Changes
- On `mousemove`: check if cursor is in any shape's outer ring (topmost z-index first). If so, set a `hoveredHitbox` state.
- On `mousedown` in the outer ring: enter connector-drag mode instead of select/move mode.
- On `mousemove` during connector drag: draw the preview line, check for target shapes.
- On `mouseup`: finalize the connector (attached to target shape's nearest perimeter point, or floating endpoint).
- Suppress hitbox glow when shift is held or marquee is active.

### HitTest Changes
- New function: `hitTestOuterRing(point, shape, ringThickness)` — returns true if point is in the outer ring zone.
- Must handle rotation by transforming point into local space first.
- For ellipses: check distance from center against `(a, b)` and `(a + ring, b + ring)` semi-axes.

### Perimeter Math
- `perimeterPoint(shape, t)` — given a shape and `t` (0–1), returns the (x, y) canvas coordinate.
- `nearestPerimeterT(shape, point)` — given a shape and a point, returns the nearest `t` value.
- For ellipses, arc-length parameterization requires a precomputed LUT (e.g., 64 samples) that maps `t` → angle, with linear interpolation.

### Migration
- Existing connectors with `fromPort`/`toPort` should be migrated to `fromT`/`toT` on load. Map: `top` → 0.125, `right` → 0.375, `bottom` → 0.625, `left` → 0.875 (for rectangles, where perimeter starts at top-left corner going clockwise).
