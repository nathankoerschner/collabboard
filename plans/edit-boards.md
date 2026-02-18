# Edit Boards — Dashboard Management Features

## Overview

Add board management capabilities to the dashboard page: rename, delete, duplicate, multi-select with bulk operations, sort, and search. No sharing features (handled separately).

---

## Features

### 1. Three-Dot Context Menu (per card)

Each board card gets a `...` (three-dot) icon button in the top-right corner. Clicking it opens a dropdown context menu with:

1. **Rename** — triggers inline rename on the card
2. **Duplicate** — clones the board and adds it to the dashboard
3. **Delete** — styled in red, destructive action

The menu closes on outside click or Escape. The three-dot button should be visible on hover (desktop) and always visible on mobile/touch.

Clicking the three-dot button must **not** navigate to the board (stop propagation on the card click handler).

### 2. Rename (Inline)

When "Rename" is selected from the context menu:
- The card's name text transforms into a text input, pre-filled with the current name, auto-focused and text-selected.
- **Enter** saves the new name via `PATCH /api/boards/:id` with `{ name }`.
- **Escape** or blur (click away) cancels the rename and reverts to the original name.
- Empty names are rejected (revert to original).
- While in rename mode, clicking the card should not navigate.

### 3. Delete (Single)

When "Delete" is selected from the context menu:
- A **custom styled modal** appears: "Delete `<board name>`? This cannot be undone."
- Two buttons: **Cancel** (secondary) and **Delete** (red/destructive).
- On confirm, calls `DELETE /api/boards/:id`, removes the card from the grid with a brief fade-out.
- On cancel, modal closes, no action.

### 4. Duplicate

When "Duplicate" is selected from the context menu:
- Calls `POST /api/boards/:id/duplicate` (new endpoint).
- Server creates a new board with:
  - New `id` (nanoid)
  - Name: `"Copy of <original name>"`
  - `owner_id` set to the requesting user
  - Cloned `board_snapshots` data (binary copy, no Yjs mutation — creator fields stay as-is for now)
  - Cloned `board_updates` data
- The new board card appears in the grid on the dashboard (user stays on dashboard).
- No navigation to the new board.

### 5. Select Mode + Bulk Operations

A **"Select"** button in the header area enters selection mode. When active:

- Each board card shows a checkbox in the top-left corner.
- Clicking a card toggles its selection (does **not** navigate to the board).
- The **"+ New Board"** button and **search input** are hidden/disabled.
- A **sticky bottom bar** appears at the viewport bottom showing:
  - Left: `"X selected"` count
  - Right: **Duplicate** button (secondary style) and **Delete** button (red/destructive style)
  - A **"Cancel"** or **"Done"** button to exit select mode
- **Select All** / **Deselect All** toggle in the bar or header.

**Bulk Delete:**
- Opens the same custom styled modal: "Delete X boards? This cannot be undone."
- On confirm, calls `DELETE /api/boards/:id` for each selected board (or a future bulk endpoint).
- Removed cards fade out. Exits select mode.

**Bulk Duplicate:**
- Calls `POST /api/boards/:id/duplicate` for each selected board.
- New cards appear in the grid. Exits select mode.

### 6. Sort & Search

**Search:**
- An always-visible search input sits between the header ("My Boards" / actions) and the board grid.
- Filters the displayed board cards by name (client-side, case-insensitive substring match).
- Clearing the input shows all boards again.
- Placeholder text: "Search boards..."

**Sort:**
- Default sort: **last modified** (most recent first) — requires `ORDER BY updated_at DESC` on the API query.
- No additional sort toggles for now (just last-modified default).

### 7. Confirmation Modal (Shared Component)

A reusable custom modal component for destructive confirmations:
- Overlay dims the background.
- Centered card with:
  - Title text (e.g., "Delete board?")
  - Description text (e.g., "This cannot be undone.")
  - Cancel button (secondary) and Confirm button (destructive/red).
- Closes on Escape, overlay click, or Cancel.
- Styled with existing CSS custom properties (`--color-surface`, `--shadow-lg`, `--radius`, etc.).

---

## API Changes

### Existing (no changes needed)
- `PATCH /api/boards/:id` — already supports `{ name }` for rename
- `DELETE /api/boards/:id` — already exists with cascade

### New Endpoint
- `POST /api/boards/:id/duplicate`
  - Auth: same as other routes (optional Clerk JWT)
  - Reads the source board row + `board_snapshots` + `board_updates`
  - Creates a new board: `{ id: nanoid(12), name: "Copy of <original>", owner_id: <requesting user> }`
  - Copies snapshot and update binary data to the new board ID
  - Returns the new board object `{ id, name, owner_id, created_at, updated_at }`

### Query Update
- `GET /api/boards?userId=<id>` — add `ORDER BY updated_at DESC` to sort by last modified

---

## Files to Modify

### Client
- `client/src/views/dashboard.ts` — main dashboard logic: context menu, select mode, inline rename, search, bulk bar
- `client/src/styles/dashboard.css` — styles for context menu, select mode, bulk bar, search input, modal
- `client/src/api.ts` — add `duplicateBoard(id)` function

### Server
- `server/src/routes/boards.ts` — add `POST /api/boards/:id/duplicate` route, add `ORDER BY updated_at DESC` to list query

---

## Design Notes

- All new UI uses existing CSS custom properties for consistency.
- Context menu, modal, and bulk bar are built with vanilla DOM (no framework) matching the existing codebase pattern of `innerHTML` templates + event delegation.
- No new dependencies required.
- Sharing/permissions are explicitly out of scope (handled in a separate effort).
- Board thumbnail previews are deferred to a future iteration.
- Yjs ownership mutation on duplicate is deferred — binary data is copied as-is.
