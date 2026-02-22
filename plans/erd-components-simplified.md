# ERD Table Component — Simplified Spec

## What It Is

A new `erd-table` object type for the collaborative board: an editable table grid with no enforced schema. Users define their own columns and content. Designed for ERD-style database modeling but usable for any tabular data.

---

## Data Model

Each table stores:

- **Position & size**: x, y on the canvas; width and height computed automatically from column widths + row heights
- **Rows & columns**: Ordered lists of stable UUIDs (not indices)
- **Column widths**: Per-column, default 120px
- **Row heights**: Per-row, default 32px, auto-grows to fit content
- **Cell text**: One string per cell, keyed by `(rowId, colId)`
- **Cell color**: Optional per-cell background color (hex), default transparent
- **Cell merging**: Horizontal only — a cell can span N columns to the right

Standard base fields apply (id, type, rotation, createdBy, parentFrameId).

---

## Visual Design

- **Minimal/flat style**: Thin 1px gray borders, no shadows, no rounded corners, no title bar
- **All rows are equal** — users color a "header row" by convention, not by structure
- **No zebra striping** by default
- **Default creation size**: 3 columns × 3 rows (360px × 96px)

---

## Auto-Resize

- Table width = sum of all column widths
- Table height = sum of all row heights
- Adding rows/columns grows the table; row height auto-expands for multi-line text
- Table growth does not push other objects (overlap allowed)

---

## Selection & Editing

Three-level interaction:

1. **Table selected** (single click): Move, rotate, delete, resize handles visible. Color picker targets the table.
2. **Cell selected** (double-click table): One cell highlighted. Arrow keys navigate cells. Color picker targets the cell.
3. **Cell editing** (double-click cell or Enter): Inline text editor in the cell.

**Escape** backs up one level at each stage.

### Cell Editor Navigation

- **Tab** → next cell (right), wraps to next row
- **Shift+Tab** → previous cell, wraps backwards
- **Enter** → cell below; auto-creates a new row if on the last row
- **Escape** → exit editing
- **Arrow keys** → move to adjacent cell at text boundary
- Tab/Enter past the last cell auto-creates a new row

---

## Column Resize

- Drag a column border to resize that column only
- Table width adjusts accordingly; other columns unchanged

---

## Adding Rows & Columns

- Hover near the **bottom edge** → `+` button to append a row
- Hover near the **right edge** → `+` button to append a column
- Right-click a row/column for contextual insert (above/below, left/right)

---

## Deleting Rows & Columns

- Hover a row → `×` button on the left edge
- Hover a column → `×` button above
- Deletion removes the row/column and all its cell data
- Connectors attached to a deleted row detach to free-floating points

---

## Connector Integration (Row-Level Ports)

- Hovering near a table row reveals **port dots on the left and right edges** of that row
- Clicking a port initiates a connector from that specific row
- Connectors attach to a table + row ID, resolving to the row's y-center on the table edge
- If the referenced row is deleted, the connector falls back to a free-floating point

---

## Per-Cell Coloring

- When a **cell** is selected, the color picker sets that cell's background
- When the **table** is selected, the color picker targets the table's border/background
- Each cell can have an independent color

---

## Horizontal Cell Merging

- A cell can span multiple columns to the right
- Absorbed cells are hidden; the spanning cell draws across the combined width
- Unmerging restores all cells to independent state

---

## Copy-Paste

- **Paste into a cell**: If clipboard contains tab/comma-delimited text, parse into a 2D grid and fill cells starting from the selected cell. Auto-expand the table if data exceeds bounds. Otherwise, paste as plain text.
- **Paste onto canvas** (no table selected): If clipboard is TSV/CSV, create a new pre-populated table at the paste location.

---

## Toolbar

- New top-level tool button in the toolbar (grid/table icon)
- Click canvas with the tool active → create a 3×3 table at click position
- Tool resets to `select` after creation

---

## AI Integration

The AI (via CommandBar) can:

- Create tables from natural language (e.g., "create a users table with id, name, email, created_at")
- Add/delete rows and columns
- Set cell text and cell colors
- Merge cells horizontally
- Resize columns

---

## Undo/Redo

Each of the following is a single undo step:
- Cell text edit
- Cell color change
- Row/column add
- Row/column delete
- Column resize
- Cell merge/unmerge

---

## Frame Nesting

Tables can live inside frames. Standard frame behavior applies: auto-containment, cascade delete, move with frame.

---

## No Hard Limits

No enforced size limits on tables. Users and AI are trusted.
