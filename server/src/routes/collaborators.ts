import type { IncomingMessage, ServerResponse } from 'node:http';
import { getPool } from '../db.js';
import { getBoardRole } from '../permissions.js';
import { invalidateBoard } from '../permissionCache.js';
import { disconnectUser } from '../wsServer.js';

const authEnabled = (): boolean => !!process.env.CLERK_SECRET_KEY;

let clerkClient: { users: { getUserList: (opts: { userId: string[] }) => Promise<{ data: Array<{ id: string; firstName: string | null; lastName: string | null; emailAddresses: Array<{ emailAddress: string }>; imageUrl: string | null }> }> } } | null = null;

async function loadClerkClient(): Promise<typeof clerkClient> {
  if (!process.env.CLERK_SECRET_KEY) return null;
  try {
    const clerk = await import('@clerk/backend');
    return clerk.createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
  } catch {
    return null;
  }
}

async function resolveUserInfo(userIds: string[]): Promise<Map<string, { name: string; email: string; image_url: string | null }>> {
  const result = new Map<string, { name: string; email: string; image_url: string | null }>();
  if (userIds.length === 0) return result;

  if (!clerkClient) clerkClient = await loadClerkClient();
  if (!clerkClient) return result;

  try {
    const response = await clerkClient.users.getUserList({ userId: userIds });
    const users = response.data || response;
    for (const u of users as Array<{ id: string; firstName: string | null; lastName: string | null; emailAddresses: Array<{ emailAddress: string }>; imageUrl: string | null }>) {
      result.set(u.id, {
        name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.id,
        email: u.emailAddresses?.[0]?.emailAddress || '',
        image_url: u.imageUrl || null,
      });
    }
  } catch (err) {
    console.error('Failed to resolve user info:', (err as Error).message);
  }
  return result;
}

function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: string) => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

export async function handleCollaboratorRoutes(req: IncomingMessage, res: ServerResponse, userId: string | null): Promise<void | false> {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const db = getPool();
  if (!db) return json(res, 503, { error: 'Database not configured' });

  // GET /api/boards/:id/collaborators
  const getCollabMatch = url.pathname.match(/^\/api\/boards\/([^/]+)\/collaborators$/);
  if (req.method === 'GET' && getCollabMatch) {
    const boardId = getCollabMatch[1]!;
    const role = await getBoardRole(boardId, userId);
    if (authEnabled() && !role) return json(res, 403, { error: 'Access denied' });

    const { rows } = await db.query(
      'SELECT user_id, role, created_at FROM board_collaborators WHERE board_id = $1 ORDER BY created_at',
      [boardId]
    );

    const userIds = rows.map((r: { user_id: string }) => r.user_id);
    const userInfo = await resolveUserInfo(userIds);

    const collaborators = rows.map((r: { user_id: string; role: string; created_at: string }) => {
      const info = userInfo.get(r.user_id);
      return {
        user_id: r.user_id,
        role: r.role,
        name: info?.name || r.user_id,
        email: info?.email || '',
        image_url: info?.image_url || null,
      };
    });

    // Also return link_sharing_enabled
    const { rows: boardRows } = await db.query(
      'SELECT link_sharing_enabled FROM boards WHERE id = $1',
      [boardId]
    );
    const linkSharingEnabled = boardRows[0]?.link_sharing_enabled || false;

    return json(res, 200, { collaborators, link_sharing_enabled: linkSharingEnabled });
  }

  // POST /api/boards/:id/collaborators — owner only
  const addCollabMatch = url.pathname.match(/^\/api\/boards\/([^/]+)\/collaborators$/);
  if (req.method === 'POST' && addCollabMatch) {
    const boardId = addCollabMatch[1]!;
    const role = await getBoardRole(boardId, userId);
    if (authEnabled() && role !== 'owner') return json(res, 403, { error: 'Owner access required' });

    const body = await parseBody(req);
    const targetUserId = body.userId as string;
    if (!targetUserId) return json(res, 400, { error: 'userId required' });

    await db.query(
      'INSERT INTO board_collaborators (board_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (board_id, user_id) DO NOTHING',
      [boardId, targetUserId, 'collaborator']
    );
    invalidateBoard(boardId);
    return json(res, 201, { ok: true });
  }

  // DELETE /api/boards/:id/collaborators/:userId
  const removeCollabMatch = url.pathname.match(/^\/api\/boards\/([^/]+)\/collaborators\/([^/]+)$/);
  if (req.method === 'DELETE' && removeCollabMatch) {
    const boardId = removeCollabMatch[1]!;
    const targetUserId = decodeURIComponent(removeCollabMatch[2]!);
    const role = await getBoardRole(boardId, userId);

    // Owner can remove anyone; non-owner can only remove self (leave)
    if (authEnabled()) {
      if (role !== 'owner' && userId !== targetUserId) {
        return json(res, 403, { error: 'Access denied' });
      }
      if (!role) return json(res, 403, { error: 'Access denied' });
    }

    // Don't allow removing the owner
    const { rows } = await db.query(
      'SELECT role FROM board_collaborators WHERE board_id = $1 AND user_id = $2',
      [boardId, targetUserId]
    );
    if (rows[0]?.role === 'owner') {
      return json(res, 400, { error: 'Cannot remove the owner' });
    }

    await db.query(
      'DELETE FROM board_collaborators WHERE board_id = $1 AND user_id = $2',
      [boardId, targetUserId]
    );
    invalidateBoard(boardId);

    // Disconnect the revoked user's WebSocket
    disconnectUser(boardId, targetUserId);

    return json(res, 200, { ok: true });
  }

  // PATCH /api/boards/:id/sharing — owner only, toggle link_sharing_enabled
  const sharingMatch = url.pathname.match(/^\/api\/boards\/([^/]+)\/sharing$/);
  if (req.method === 'PATCH' && sharingMatch) {
    const boardId = sharingMatch[1]!;
    const role = await getBoardRole(boardId, userId);
    if (authEnabled() && role !== 'owner') return json(res, 403, { error: 'Owner access required' });

    const body = await parseBody(req);
    const enabled = Boolean(body.link_sharing_enabled);

    await db.query(
      'UPDATE boards SET link_sharing_enabled = $1, updated_at = NOW() WHERE id = $2',
      [enabled, boardId]
    );
    invalidateBoard(boardId);
    return json(res, 200, { ok: true, link_sharing_enabled: enabled });
  }

  return false;
}
