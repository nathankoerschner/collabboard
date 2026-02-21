# ERD Table Component Spec

## Overview

A new `erd-table` object type for the collaborative board that provides a generic, editable table grid. Users define their own column semantics — the table imposes no schema constraints (no enforced "name", "type", "PK" columns). Designed for ERD-style database schema modeling but flexible enough for any tabular data.

---

## Data Model

### Object Type

New top-level type `'erd-table'` added to the `ObjectType` union, with its own dedicated Yjs storage structure.

### Yjs Storage (cell-level keys)

Each table is a `Y.Map` in `doc.getMap('objects')` containing:

| Key | Type | Description |
|-----|------|-------------|
| `id` | string | Object UUID |
| `type` | `'erd-table'` | Object type discriminator |
| `x`, `y` | number | Top-left position on canvas |
| `width`, `height` | number | Computed from column widths + row heights (auto-resize) |
| `rotation` | number | Rotation in radians (standard base field) |
| `createdBy` | string | User ID |
| `parentFrameId` | string \| null | Frame containment (tables nest inside frames) |
| `rowIds` | Y.Array\<string\> | Ordered list of stable row UUIDs |
| `colIds` | Y.Array\<string\> | Ordered list of stable column UUIDs |
| `colWidths` | Y.Map\<number\> | Map of `colId → width` in px (default: 120) |
| `rowHeights` | Y.Map\<number\> | Map of `rowId → height` in px (default: 32, auto-grows) |
| `cell_{rowId}_{colId}` | string | Cell text content |
| `cellColor_{rowId}_{colId}` | string \| null | Per-cell background color (hex). Null = transparent. |
| `cellColspan_{rowId}_{colId}` | number | Horizontal merge span (default 1). Cells absorbed by a merge are marked hidden. |

### Identity & Reindexing

- **Rows and columns use stable UUIDs** (short nanoid, ~6 chars). Connectors reference `rowId`, not row index.
- Deleting a row removes its ID from `rowIds` and deletes all associated `cell_*`, `cellColor_*`, `cellColspan_*` keys in a single `doc.transact()`.
- No reindexing required — all references are by ID, not position.

### Horizontal Cell Merging

- `cellColspan_{rowId}_{colId}` > 1 means the cell spans that many columns to the right.
- Absorbed cells (those covered by a merge) have their `cellColspan` set to `0` (hidden marker).
- Renderer skips cells with `colspan === 0` and draws the spanning cell across the combined width.
- Unmerging sets all involved cells back to `colspan = 1` and restores independent content.

---

## Visual Design

### Style: Minimal/Flat

- Thin 1px borders between cells (`#d1d5db` or similar neutral gray)
- No outer drop shadow, no rounded corners on the table itself
- Flat white/transparent default cell background
- No title bar — all rows are equal. Users apply cell colors to distinguish a "header row" by convention.
- No alternating row tint (zebra stripes) by default

### Default Dimensions

- Default creation size: **3 columns × 3 rows**
- Default column width: **120px**
- Default row height: **32px**
- Initial table footprint: **360px × 96px**

### Auto-Resize Behavior

- Table `width` = sum of all column widths
- Table `height` = sum of all row heights
- Adding a row increases table height by the default row height (32px)
- Adding a column increases table width by the default column width (120px)
- Row height auto-grows to fit the tallest cell's text content (multi-line wrapping)
- **Overlap allowed** — table growth does not push other objects on the canvas

---

## Interaction Model

### Selection States

Three-state model:

1. **Table selected** (single click on table): Shows resize handles on the table bounding box. Can drag to move, rotate, delete. Color picker targets the table's overall border/background.
2. **Cell selected** (double-click on table → lands on a cell): Cell is highlighted. Color picker targets the selected cell. Arrow keys move cell selection.
3. **Cell editing** (double-click a cell, or press Enter while cell is selected): Custom inline editor opens in that cell. Tab/Enter navigation active.

Escape backs up one level: editing → cell-selected → table-selected → deselected.

### Cell Editing (Custom Inline Editor)

- A positioned `<div>` with a `<textarea>` or `contenteditable` element overlaid precisely on the cell bounds, accounting for camera transform.
- Supports:
  - **Tab** → move to next cell (right), wrap to first column of next row at end of row
  - **Shift+Tab** → move to previous cell (left), wrap backwards
  - **Enter** → move to cell below, auto-create new row at bottom if on last row
  - **Escape** → exit editing, return to cell-selected state
  - **Arrow keys** → when at text boundary, move to adjacent cell
- Tab past last column of last row auto-creates a new row
- Enter past last row auto-creates a new row

### Column Width Dragging

- Hovering near a column border (within ~4px) shows a resize cursor (`col-resize`)
- Dragging the border changes only that column's width
- Table width grows/shrinks accordingly (grow-table mode, not redistribute)
- Other columns remain unchanged

### Row Height (Auto-Grow)

- Row height expands to fit the tallest cell's content after text edit completes
- Minimum row height: 32px
- No manual row height dragging

### Adding Rows & Columns (Hover-Triggered Buttons)

- Hovering near the **bottom edge** of the table reveals a `+` button to append a new row
- Hovering near the **right edge** of the table reveals a `+` button to append a new column
- Right-click a row/column for contextual insert (insert above/below, insert left/right)

### Deleting Rows & Columns (Hover Delete Button)

- Hovering a row shows a small `×` button on the left edge of that row
- Hovering a column header area shows a small `×` button above that column
- Clicking `×` deletes the row/column:
  - Removes the ID from `rowIds`/`colIds`
  - Deletes all associated cell keys
  - Detaches any connectors referencing a deleted row → converts to `fromPoint`/`toPoint` (free-floating at last known position)

---

## Connector Integration (Row-Level Ports)

### Port Indicators

- When the user hovers near a row in a table, **small circles appear on both left and right edges** of that row (at the row's y-center).
- Clicking a port dot initiates a connector from that specific row.
- Connector endpoint routes to the exact y-position of the attached row on the table's edge.

### Connector Storage

Connectors reference table rows via:

| Field | Value |
|-------|-------|
| `fromId` / `toId` | The `erd-table` object's ID |
| `fromRowId` / `toRowId` | The stable row UUID (new fields on connectors) |
| `fromT` / `toT` | Not used for table row ports — row ports use fixed left (t=0) or right (t=1) |

### Resolution

- `getConnectorEndpoints()` checks if the attached object is an `erd-table`
- If so, resolves the endpoint to: `table.x` (left port) or `table.x + table.width` (right port) at the y-center of the referenced row
- Falls back to `fromPoint`/`toPoint` if the row ID no longer exists

### Row Deletion Behavior

- When a row with attached connectors is deleted, connectors detach to free-floating points at the last known position (consistent with existing object deletion behavior)

---

## Per-Cell Coloring

### Color Application

- **Table selected state**: Color picker changes the table's outer border color or overall background tint
- **Cell selected state**: Color picker changes the selected cell's `cellColor_{rowId}_{colId}`
- Cell colors are individual — each cell can have its own background hex color
- Default cell color: `null` (transparent / white)

---

## Copy-Paste Support

### TSV/CSV Paste

- When editing a cell and pasting, clipboard text is checked for tab or comma delimiters
- If delimiters are detected:
  - Parse into a 2D array of strings
  - Populate cells starting from the currently selected cell
  - Auto-expand the table (add rows/columns) if paste data exceeds current bounds
- If no delimiters: paste raw text into the active cell

### Table Creation via Paste

- If no table is selected and TSV/CSV data is pasted onto the canvas, create a new `erd-table` pre-populated with the parsed data at the paste location

---

## Toolbar

### Placement

- New **top-level tool button** in the toolbar alongside sticky, rectangle, ellipse, text, frame, shape
- Icon: a grid/table icon
- Tool name: `'erd-table'`

### Creation Flow

- Select the table tool → click on canvas → create a **3×3 table** at default size at click position
- Tool auto-resets to `'select'` after creation (consistent with other tools)

---

## Undo/Redo

- Each cell text edit is an individually undoable transaction
- Cell color change is an individually undoable transaction
- Row/column add is a single undo step (removes all created keys)
- Row/column delete is a single undo step (restores all removed keys)
- Column resize is a single undo step per drag operation
- Cell merge/unmerge is a single undo step
- Uses existing `UndoRedoManager` with standard transaction origin tracking (`'gesture'`, `'text-edit'`, `'local'`)

---

## Frame Nesting

- Tables can live inside frames like any other object
- `parentFrameId` works normally — auto-containment logic applies
- Frame cascade-delete includes tables
- Moving a frame moves its contained tables

---

## AI Integration (CommandBar Tools)

### New Tool Schemas

| Tool | Parameters | Description |
|------|-----------|-------------|
| `create_table` | `x, y, rows, cols, cellData?` | Create a new table, optionally pre-populated with a 2D array of cell text |
| `add_row` | `tableId, afterRowId?` | Add a row (append or insert after a specific row) |
| `add_column` | `tableId, afterColId?` | Add a column (append or insert after a specific column) |
| `delete_row` | `tableId, rowId` | Delete a row by its stable ID |
| `delete_column` | `tableId, colId` | Delete a column by its stable ID |
| `set_cell` | `tableId, rowId, colId, text` | Set a cell's text content |
| `set_cell_color` | `tableId, rowId, colId, color` | Set a cell's background color (hex) |
| `merge_cells` | `tableId, rowId, colId, colspan` | Horizontally merge a cell across N columns |
| `resize_column` | `tableId, colId, width` | Set a column's width in px |

### AI Capabilities

- AI can create fully styled ERD schemas from natural language (e.g., "create a users table with id, name, email, created_at")
- AI can set cell colors (e.g., color header rows), merge cells, and adjust column widths
- No size limits enforced — AI and users can create tables of any dimension

---

## Files to Modify

| File | Changes |
|------|---------|
| `client/src/types.ts` | Add `ErdTableObject` interface, add `'erd-table'` to `ObjectType` union, add `fromRowId`/`toRowId` to `Connector` |
| `client/src/board/ObjectStore.ts` | Add table defaults in `_buildDefaultObject()`, add table-specific CRUD methods (addRow, addColumn, deleteRow, etc.), handle table in `deleteObjects()` for connector detachment |
| `client/src/canvas/Renderer.ts` | Add `drawErdTable()` method: draw grid, cell text, cell colors, merged cells, hover buttons, row port dots |
| `client/src/canvas/InputHandler.ts` | Add `'erd-table'` tool, handle three-state selection (table → cell → editing), column resize dragging, row port hover/click for connectors |
| `client/src/canvas/Canvas.ts` | Wire up table callbacks, integrate custom cell editor, handle auto-text-editing on table creation |
| `client/src/canvas/Geometry.ts` | Add table hit-testing (which cell was clicked), table bounding box, row-level port resolution |
| `client/src/canvas/HitTest.ts` | Add table-aware hit detection (cell-level precision) |
| `client/src/canvas/TextEditor.ts` (or new `TableCellEditor.ts`) | Custom inline cell editor with Tab/Enter/Escape navigation, auto-row-creation |
| `server/src/ai/tools.ts` | Add 9 new tool schemas for table operations |
| `server/src/ai/agent.js` | Implement tool handlers for table CRUD |
| Toolbar UI component | Add table tool button with grid icon |

---

## Size & Performance Notes

- No hard limits on table size — users and AI are trusted
- Cell-level Yjs keys mean a 50×20 table creates ~1000 keys. Yjs handles this fine.
- Renderer should skip off-screen cells (viewport culling) for large tables
- Consider lazy text measurement caching for auto-grow row height calculations
