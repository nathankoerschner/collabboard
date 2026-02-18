import { getPool } from './db.js';
import { getCachedRole, setCachedRole } from './permissionCache.js';

export type BoardRole = 'owner' | 'collaborator' | 'link' | null;

export async function getBoardRole(boardId: string, userId: string | null): Promise<BoardRole> {
  // Dev fallback: no auth configured = everyone is owner
  if (!process.env.CLERK_SECRET_KEY) return 'owner';
  if (!userId) return null;

  // Check cache first
  const cached = getCachedRole(boardId, userId);
  if (cached !== undefined) return cached;

  const db = getPool();
  if (!db) return null;

  const { rows } = await db.query(
    'SELECT role FROM board_collaborators WHERE board_id = $1 AND user_id = $2',
    [boardId, userId]
  );
  if (rows.length > 0) {
    const role = rows[0].role as 'owner' | 'collaborator';
    setCachedRole(boardId, userId, role);
    return role;
  }

  // Check link sharing
  const { rows: boardRows } = await db.query(
    'SELECT link_sharing_enabled FROM boards WHERE id = $1',
    [boardId]
  );
  if (boardRows.length > 0 && boardRows[0].link_sharing_enabled) {
    setCachedRole(boardId, userId, 'link');
    return 'link';
  }

  setCachedRole(boardId, userId, null);
  return null;
}
