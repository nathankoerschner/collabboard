# Board Options Page — Feature Spec

## Overview

Each board gets a settings modal accessible via a three-dot (kebab) menu in the top-right corner of the board view. The modal uses tabbed sections: **General**, **Sharing**, and **Danger Zone**. Non-owner collaborators see a limited read-only view (board info, collaborator list, and a "Leave board" button) — no access to sharing controls or delete.

---

## Auth & Privacy Model

- **Auth is now required for everything.** No more anonymous board creation or access. Users must sign in via Clerk.
- **Boards are private by default.** Only the owner and explicitly added collaborators can access a board.
- **Unauthenticated users** hitting a board URL are redirected to the Clerk sign-in page. After auth, permissions are checked — if they don't have access, show a generic "Board not found" or "No access" page.
- **Access enforcement on both REST API and WebSocket.** All board endpoints (GET/PATCH/DELETE) and the WebSocket upgrade handler verify the requesting user has permission for the target board.

## Permissions Model

Simple two-role model:

| Role | Capabilities |
|------|-------------|
| **Owner** | Full control: rename, delete, share, revoke, toggle link sharing |
| **Collaborator** | Edit board content (via Yjs), view collaborator list, leave board |

No viewer role in v1. All access grants full edit capability.

---

## Database Changes

### New table: `board_collaborators`

```sql
CREATE TABLE board_collaborators (
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'collaborator',  -- 'owner' or 'collaborator'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (board_id, user_id)
);

CREATE INDEX idx_board_collaborators_user_id ON board_collaborators(user_id);
```

### New column on `boards`

```sql
ALTER TABLE boards ADD COLUMN link_sharing_enabled BOOLEAN NOT NULL DEFAULT FALSE;
```

- `ON DELETE CASCADE` ensures collaborator records are silently removed when a board is hard-deleted.
- When a board is created, an entry with `role = 'owner'` is inserted into `board_collaborators` for the creating user.

---

## WebSocket Auth Enhancement

- On WebSocket upgrade (`/ws/:boardId`), extract and verify the JWT token from the query parameter.
- Query the DB (or in-memory cache) to check if the user is the board owner, a collaborator, or if `link_sharing_enabled = true` on the board.
- **Permission cache:** Cache board permissions in-memory with a **60-second TTL** to reduce DB load. Cache is invalidated on share/revoke/delete actions.
- If unauthorized: reject with 401/403.
- On access revocation: immediately close the revoked user's WebSocket connection (push disconnect).

## REST API Auth Enhancement

All board-specific endpoints (`GET /api/boards/:id`, `PATCH /api/boards/:id`, `DELETE /api/boards/:id`) must verify the requesting user has appropriate access:

- **GET**: owner, collaborator, or link_sharing_enabled
- **PATCH** (rename): owner only
- **DELETE**: owner only

### Existing Endpoints (reuse as-is, add auth checks)

These endpoints already exist in `server/src/routes/boards.ts` and `client/src/api.ts`. They should be reused by the options modal — **do not create new endpoints for these operations**. Just add permission checks:

| Method | Path | Client function | Auth added |
|--------|------|----------------|------------|
| `PATCH` | `/api/boards/:id` | `renameBoard()` | Owner only |
| `DELETE` | `/api/boards/:id` | `deleteBoard()` | Owner only |
| `POST` | `/api/boards/:id/duplicate` | `duplicateBoard()` | Authenticated user (owner or collaborator) |

**Duplicate board**: Uses a dedicated duplicate endpoint (being built separately) that server-side copies the board's Yjs state into a new board. The duplicate is owned by the current user and does not copy collaborators.

### New API Endpoints (sharing only)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/boards/:id/collaborators` | List collaborators (owner + collaborators can view) |
| `POST` | `/api/boards/:id/collaborators` | Add a collaborator by user ID or email (owner only) |
| `DELETE` | `/api/boards/:id/collaborators/:userId` | Remove a collaborator (owner only, or self for "leave") |
| `PATCH` | `/api/boards/:id/sharing` | Toggle `link_sharing_enabled` (owner only) |

---

## UI: Board Options Modal

### Entry Point

- Three-dot kebab menu (`...`) in the **top-right corner** of the board view.
- Clicking it opens the options modal as a centered overlay on top of the canvas.
- **Not accessible from the dashboard** in v1 (board view only).

### Modal Structure

Tabbed layout with three tabs:

#### Tab 1: General

- **Board name**: Editable text input, pre-filled with current name. Save on blur or Enter. Uses the existing `renameBoard()` client function (`PATCH /api/boards/:id`).
- **Duplicate board**: Button to clone the board. Uses the existing `duplicateBoard()` endpoint (`POST /api/boards/:id/duplicate`), which handles server-side Yjs state copying. The duplicate is owned by the current user with no collaborators carried over.

#### Tab 2: Sharing

**Owner view:**

- **Link sharing toggle**: On/Off switch. When enabled, shows the board URL in a read-only input field with a copy icon button next to it.
- **Add collaborator**: Input field to search existing Clerk users or enter an email address.
  - For existing users: search/autocomplete, add immediately.
  - For non-existing users (email): generate a unique invite link that the owner copies and shares manually. No system-sent emails.
- **Collaborator list**: Shows all current collaborators with:
  - Avatar + display name + email
  - "Remove" button next to each collaborator
  - Owner is shown but without a remove button

**Collaborator view:**

- Read-only collaborator list (same display: avatar + name + email)
- No link sharing toggle or add/remove controls
- **"Leave board"** button at the bottom

#### Tab 3: Danger Zone (Owner only)

- **Delete board** button (red/destructive styling). Uses the existing `deleteBoard()` client function (`DELETE /api/boards/:id`).
- Clicking triggers a **simple confirm dialog**: "Are you sure you want to delete this board? This cannot be undone." with Cancel and Delete buttons.
- On confirm: hard delete via the existing endpoint. Active collaborators are immediately disconnected with a "Board deleted" message. All data (snapshots, updates, collaborator records) cascade-deleted.

**Collaborator view:** This tab is hidden entirely for non-owners.

---

## Link Sharing Behavior

- When `link_sharing_enabled = true`: any authenticated user with the board URL can connect and edit.
- Link users get **ephemeral access** — they do NOT appear in the collaborator list and lose access if link sharing is turned off.
- The shareable link is the standard board URL: `#/board/:id` (no separate invite token).
- Copy interaction: read-only input field displaying the URL + copy icon button.

---

## Invite Flow (Specific User)

1. Owner types a name/email in the "Add collaborator" input.
2. System searches existing Clerk users by name or email.
3. If found: add them as a collaborator directly (insert into `board_collaborators`).
4. If not found (email entered): generate an invite link. The system does NOT send emails. The owner copies the link and shares it manually.
5. When the invited user visits the link and signs up/signs in via Clerk, they gain access to the board.

For email-based invites, a lightweight `board_invites` table may be needed:

```sql
CREATE TABLE board_invites (
  id TEXT PRIMARY KEY,           -- nanoid token
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  claimed_by TEXT
);
```

When an invited user signs in with a matching email, the invite is claimed and they're added to `board_collaborators`.

---

## Access Revocation

- Owner clicks "Remove" next to a collaborator in the Sharing tab.
- Server deletes the `board_collaborators` record.
- If the revoked user is currently connected via WebSocket, their connection is **immediately closed** with an "Access revoked" message.
- Permission cache is invalidated for this board.

---

## Dashboard Changes

- Dashboard gets **filter tabs**: `All` | `My Boards` | `Shared with Me`
- `GET /api/boards` endpoint is updated to support a `filter` query param:
  - `?filter=owned` — boards where user is owner
  - `?filter=shared` — boards where user is collaborator (not owner)
  - Default (no filter / `all`) — returns both
- Shared boards display with a visual "Shared" badge or indicator.

---

## Implementation Order (Suggested)

1. **Database migration**: `board_collaborators` table, `link_sharing_enabled` column, `board_invites` table
2. **Server auth middleware**: permission checking utility for REST + WebSocket
3. **REST API endpoints**: collaborator CRUD, sharing toggle, updated board endpoints with auth
4. **WebSocket auth**: enforce permissions on upgrade, implement immediate disconnect on revoke
5. **Permission cache**: in-memory cache with 60s TTL
6. **Client: Options modal UI**: three-dot menu entry point, tabbed modal with General/Sharing/Danger Zone
7. **Client: Sharing interactions**: link toggle, collaborator add/remove, invite link generation
8. **Client: Dashboard filters**: tab filtering for owned vs. shared boards
9. **Remove anonymous access**: enforce Clerk auth on all routes
