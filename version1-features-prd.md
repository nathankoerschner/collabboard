# CollabBoard Version 1 — Features PRD

## Implementation Priority

Canvas features first. All canvas primitives (shapes, connectors, frames, rotation, text) must be solid before AI agent work begins.

---

## Data Model

**Clean break from MVP schema.** Existing boards do not need migration. The Yjs document structure will be redesigned from scratch to support rotation, connectors, parent-child frames, and new object types.

**Persistence:** Keep current approach — 100-update compaction threshold, full Yjs snapshots in PostgreSQL. 500 objects with additional properties remain well within Yjs binary format limits (<1MB).

### Object Types

All objects share a common base:

```
Base: { id, type, x, y, width, height, rotation, createdBy, parentFrameId? }
```

| Type | Additional Properties |
| --- | --- |
| `sticky` | `text`, `color` (from fixed palette) |
| `rectangle` | `color`, `strokeColor` |
| `ellipse` | `color`, `strokeColor` |
| `text` | `content` (rich text: bold, italic, font size), `color` |
| `connector` | `fromId?`, `toId?`, `fromPort?`, `toPort?`, `fromPoint?`, `toPoint?`, `style` (line/arrow), `points[]` |
| `frame` | `title`, `color`, `children[]` (ordered list of child object IDs) |

### Connectors as First-Class Objects

Connectors are independent objects in the object store, not metadata on other objects. Key behaviors:

- **Delete behavior:** Deleting a connected object causes the connector's endpoint to dangle at the last known position of the deleted object. The connector is NOT cascade-deleted.
- **Copy behavior:** Connectors are selectable, copyable, and duplicatable like any other object. When a group of objects including connectors is copied, connector references are remapped to the new copies.
- **Anchor ports:** 8 ports per object — 4 midpoints (top, right, bottom, left) + 4 corners. Ports rotate with the object.
- **Rendering:** Straight lines only (no orthogonal routing, no bezier curves). Arrow or plain line styles.
- **Unattached connectors:** A connector can exist with one or both endpoints unattached (freestanding line/arrow with arbitrary start/end coordinates).

---

## Canvas Features

### Shapes

| Shape | Details |
| --- | --- |
| Sticky Notes | Fixed color palette (8-12 curated colors). Text editable via double-click. |
| Rectangles | Solid fill + stroke. Resizable via handles. |
| Ellipses | Independent width/height (not constrained to circles). Resizable on each axis independently. |
| Connectors | Straight-line segments with optional arrowheads. Snap to 8 anchor ports on objects. |
| Text | Standalone text elements with basic rich text (bold, italic, font size). Single color per element. |
| Frames | Labeled container regions with true parent-child containment. |

### Color Palette

Fixed palette of 8-12 curated colors. Applies to sticky notes, shapes, and text. No custom color picker. Colors should be easy for the AI agent to reference by name.

Suggested palette (refine during implementation):
- Yellow, Blue, Green, Pink, Purple, Orange, Red, Teal, Gray, White

### Rich Text (Text Elements)

Text elements support basic inline formatting:
- **Bold** and *italic* toggling
- Font size (small, medium, large — or a few fixed sizes)
- Single text color per element (from the fixed palette)

Implementation: Inline spans within a single text block. Rendered on canvas with `measureText` and manual line-breaking. Edited via the existing overlay text editor, extended with formatting controls.

### Frames (True Containment)

Frames are visual containers with parent-child hierarchy:

- **Parenting:** Objects placed inside a frame's bounds become children of that frame (stored in the frame's `children[]` array).
- **Move propagation:** Moving a frame moves all its children.
- **Delete propagation:** Deleting a frame deletes all children.
- **Unframing:** Spatial auto-unparent — dragging an object fully outside the frame's bounds automatically detaches it from the frame's children list.
- **Rendering:** Frames render as labeled rectangular regions with a title bar. Drawn behind their children in z-order.
- **Nesting:** Frames can contain other frames (nested containment).

### Rotation

- **Free rotation** at any angle via a rotation handle (circular handle above the object).
- **Hit-testing:** Must account for rotated bounding boxes (OBB — oriented bounding box collision detection, not AABB).
- **Connector ports:** Rotate with the object. Port positions are computed relative to the object's rotated transform.
- **Multi-select rotation:** Group rotation — the entire selection rotates as a unit around the selection bounding box center. Each object's position and individual rotation are updated.

### Selection

- **Shift-click** to add/remove from selection.
- **Marquee drag** to select all objects within the drag rectangle (existing behavior, extended to new types).
- **Connectors are selectable** — click on the line to select.
- **Frame selection:** Clicking a frame's title bar or border selects the frame. Clicking inside selects the child object.

### Operations

| Operation | Behavior |
| --- | --- |
| Duplicate | Clone selected objects with a small offset (+20px, +20px). Remap connector references within the duplicated group. |
| Copy/Paste | Serialize selected objects to a portable format. Supports **cross-board paste** — copy from Board A, navigate to Board B, paste. Must handle ID regeneration and connector remapping. |
| Delete | Remove selected objects. Connectors attached to deleted objects dangle (see Connectors section). |

### Cross-Board Copy/Paste

Objects are serialized to a JSON clipboard format stored in-memory (or localStorage) on the client. On paste:
1. Generate new IDs for all pasted objects.
2. Remap connector `fromId`/`toId` to new IDs (if both endpoints are in the pasted set).
3. Remap frame `children[]` references.
4. Place at the paste target's viewport center with offset.

---

## Performance Targets

| Metric | Target |
| --- | --- |
| Frame rate | 60 FPS during pan, zoom, object manipulation |
| Object sync latency | <100ms |
| Cursor sync latency | <50ms |
| Object capacity | 500+ objects without performance drops |

---

## Reconnection & Offline Behavior

- **Auto-retry with exponential backoff** on WebSocket disconnection.
- **Visual banner:** "Reconnecting..." displayed at the top of the canvas during disconnection.
- **Offline edits:** Edits made while disconnected are queued locally and synced on reconnect (Yjs handles this natively via state vectors).
- **No edit blocking:** Users can continue editing while disconnected.

---

## Testing Scenarios

1. 2 users editing simultaneously in different browsers
2. One user refreshing mid-edit (state persistence)
3. Rapid creation and movement of objects (sync performance)
4. Network throttling and disconnection recovery (banner appears, edits sync on reconnect)
5. 5+ concurrent users without degradation
6. Copy objects from Board A, navigate to Board B, paste (cross-board clipboard)
7. Create objects inside a frame, drag them out (auto-unparent), drag frame (children follow)
8. Delete object with connectors attached (connectors dangle, not cascade-deleted)
9. Rotate selection of multiple objects (group rotation around selection center)
