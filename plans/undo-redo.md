# Undo/Redo Specification

## Overview
Add full undo/redo support to CollabBoard using Yjs's built-in `UndoManager`, with gesture-level grouping for local changes and batch-level grouping for AI agent changes. Keyboard shortcuts (Cmd+Z / Cmd+Shift+Z) and UI buttons in the top toolbar.

---

## Engine: Yjs UndoManager

Use `Y.UndoManager` tracking the `objectsMap` (Y.Map) and `zOrder` (Y.Array) shared types.

### Required Refactor: `_setObject` → Granular Key Updates
The current `_setObject` replaces the entire `Y.Map` on every call (creates a new `Y.Map()` and sets it via `objectsMap.set()`). This must be refactored to **update keys in-place** on the existing `Y.Map` so that UndoManager sees granular field-level diffs instead of whole-object delete+insert.

New behavior:
- If the Y.Map already exists for the object ID, iterate the patch and call `yMap.set(key, value)` for each changed key.
- If a key exists on the Y.Map but is absent/null in the new state, explicitly set it to `null` (not delete) — see normalization below.
- Only create a new `Y.Map` if the object doesn't exist yet (i.e., `createObject`).

### Data Model Normalization
Normalize all object types to always have all their keys present (set to `null` when unused). This ensures undo diffs are clean and prevents missing-key bugs.

Example: a connector should always have `fromId`, `fromPort`, `fromT`, `fromPoint`, `toId`, `toPort`, `toT`, `toPoint` — never omit keys.

### History Limit
Cap the UndoManager at **100 undo steps**. Old steps silently drop off.

### Persistence
Undo stack is **in-memory only**. Resets on page refresh. This matches Figma/Miro/Google Docs.

### Redo Clearing
**Standard linear model**: making a new change after undoing clears the redo stack.

---

## Undo Granularity: Gesture-Level Grouping

Each user interaction gesture maps to one undo step:

| Gesture | Undo Step |
|---------|-----------|
| Drag-move (mousedown → mouseup) | One step: entire move |
| Resize (mousedown → mouseup) | One step: entire resize |
| Rotate (mousedown → mouseup) | One step: entire rotation |
| Text editing session (focus → blur) | One step: all text changes |
| Create object | One step |
| Delete object(s) | One step (includes all side effects) |
| Color change | One step |
| Paste / Duplicate | One step |
| Bring to front | One step |

### Implementation Approach
Use Yjs UndoManager's `captureTransaction` origin tracking:
- **Discrete actions** (create, delete, color, paste): each `doc.transact()` is its own undo step — no special handling needed.
- **Continuous gestures** (drag, resize, rotate): use a transaction origin like `'gesture'` during the drag, and call `undoManager.stopCapturing()` on mouseup. All transactions with the same origin that occur before `stopCapturing()` merge into one step.
- **Text editing**: while the text editor is focused, all text mutations use origin `'text-edit'`. On blur, call `stopCapturing()`.

---

## AI Agent Undo: Batch Collapsing

### Requirement
All mutations from a single AI command invocation collapse into **one undo step**, regardless of how many tool calls or transactions the agent makes. If the user makes changes in the middle of an AI execution, the AI changes still group together as a single unit.

### Implementation: Origin-Based Grouping
- The AI agent's Yjs client uses a distinct transaction origin (e.g., `'ai-agent'`).
- On the client side, configure UndoManager to track the AI agent's origin.
- Use UndoManager's `captureTransaction` / origin filtering so all `'ai-agent'` transactions merge into a single undo step.
- The server sends `ai-batch-start` and `ai-batch-end` awareness messages over the existing WebSocket/Yjs awareness protocol.
- On `ai-batch-start`: client begins capturing AI transactions as one group.
- On `ai-batch-end`: client calls `stopCapturing()` to finalize the AI batch as one undo step.
- User's own changes that occur between `ai-batch-start` and `ai-batch-end` use a different origin (`'local'`) and are tracked as separate undo steps.

### Mid-Execution Undo
If the user presses Cmd+Z while the AI is still executing:
- **Only local changes are undone.** The in-progress AI batch is not undoable until the AI finishes.
- Once the AI batch completes (and `ai-batch-end` fires), the entire batch becomes available as one undo step.

---

## Side Effects & Delete Undo

The `deleteObjects` method already wraps all side effects in a single `doc.transact()`:
- Cascade deletion of frame children
- Connector detachment (setting `fromId`/`toId` to null on surviving connectors)
- Frame-child relationship cleanup

Since these are all in one transaction, Yjs UndoManager will reverse them atomically as one undo step. This means:
- Undoing a delete **restores the deleted objects** and **re-attaches connectors** that were detached as a side effect.
- Frame children are restored with their exact original parent relationships.

### Frame Restoration
When undoing a frame delete, the frame is restored with its **exact original children list**. No containment re-sync is run — objects created by other users in the frame's area during the deletion period are NOT auto-adopted.

### Multiplayer Conflict Resolution
Trust Yjs CRDT merge for concurrent edits. If User B moves a sticky while User A deletes it, and User A undoes the delete, Yjs merges both operations — the sticky comes back with User B's position.

---

## Text Edit Scoped Undo

While a text editor overlay is active (editing sticky text or text object content):
- **Cmd+Z undoes text changes only** (within the text editing session).
- **Cmd+Shift+Z redoes text changes only.**
- Text undo can be handled by the browser's native contenteditable undo or by the Yjs UndoManager with a `'text-edit'` origin scope.
- After exiting text edit (blur), Cmd+Z resumes undoing board-level actions.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+Z` (Mac) / `Ctrl+Z` (Win) | Undo |
| `Cmd+Shift+Z` (Mac) / `Ctrl+Shift+Z` (Win) | Redo |
| `Cmd+Y` (Win fallback) | Redo (optional) |

### Integration with InputHandler
- Add keyboard listeners in `InputHandler._handleKeyDown`.
- Check if text editor is active — if so, let the browser/text-editor handle Cmd+Z natively; do NOT trigger board-level undo.
- If no text editor is active, call `undoManager.undo()` / `undoManager.redo()` and `preventDefault()`.

---

## UI: Top Toolbar Buttons

### Placement
Add undo/redo buttons in the **top toolbar area** near the tool selection controls.

### Design
- Two icon buttons: ↶ (undo) and ↷ (redo).
- **Enabled/disabled state only** — no tooltips, no step counts, no action names.
- Disabled (grayed out / reduced opacity) when the respective stack is empty.
- Click handler calls `undoManager.undo()` / `undoManager.redo()`.

### State Updates
Listen to UndoManager's `'stack-item-added'`, `'stack-item-popped'`, and `'stack-cleared'` events to update button enabled/disabled state reactively.

---

## Implementation Steps

### Phase 1: Core Refactor
1. Refactor `ObjectStore._setObject()` to do in-place Y.Map key updates instead of full replacement.
2. Normalize all object types to always include all keys (null for unused).
3. Instantiate `Y.UndoManager` in `Canvas.js` (or a new `UndoRedoManager` module), tracking `objectsMap` and `zOrder`.
4. Set history cap to 100.

### Phase 2: Gesture Grouping
5. Add transaction origins to all ObjectStore mutations (`'local'`, `'gesture'`, `'text-edit'`).
6. On mousedown (drag/resize/rotate start): begin capturing with `'gesture'` origin.
7. On mouseup: call `stopCapturing()`.
8. On text editor blur: call `stopCapturing()` for `'text-edit'` origin.

### Phase 3: Keyboard Shortcuts
9. Add Cmd+Z / Cmd+Shift+Z handling in `InputHandler._handleKeyDown`.
10. Gate on text editor active state for scoped undo.

### Phase 4: AI Batch Undo
11. Tag AI agent transactions with `'ai-agent'` origin on the server side.
12. Add `ai-batch-start` / `ai-batch-end` awareness messages from the server.
13. Client listens for batch boundary messages and manages AI undo grouping.
14. Skip AI in-progress batches when user triggers undo.

### Phase 5: UI
15. Add undo/redo buttons to the top toolbar.
16. Wire up enabled/disabled state to UndoManager stack events.
17. Wire click handlers to `undo()` / `redo()`.
