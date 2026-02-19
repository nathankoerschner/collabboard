import type { IncomingMessage, ServerResponse } from 'node:http';
import { getPool } from '../db.js';
import { nanoid } from 'nanoid';
import { executeBoardAICommand } from '../ai/boardAgent.js';
import { checkAIRateLimit } from '../ai/rateLimit.js';
import { getBoardRole } from '../permissions.js';

const authEnabled = (): boolean => !!process.env.CLERK_SECRET_KEY;

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

export async function handleBoardRoutes(req: IncomingMessage, res: ServerResponse, userId: string | null): Promise<void | false> {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const db = getPool();

  if (!db) {
    return json(res, 503, { error: 'Database not configured' });
  }

  // GET /api/boards — list boards the user has access to
  if (req.method === 'GET' && url.pathname === '/api/boards') {
    if (authEnabled() && !userId) return json(res, 401, { error: 'Authentication required' });
    const effectiveUserId = userId || url.searchParams.get('userId') || 'anonymous';
    const filter = url.searchParams.get('filter'); // 'owned' | 'shared' | null

    let query: string;
    let params: string[];

    if (filter === 'owned') {
      query = `SELECT b.id, b.name, b.owner_id, b.created_at, b.updated_at, 'owner' AS role
               FROM boards b
               WHERE b.owner_id = $1
               ORDER BY b.updated_at DESC`;
      params = [effectiveUserId];
    } else if (filter === 'shared') {
      query = `SELECT b.id, b.name, b.owner_id, b.created_at, b.updated_at, bc.role
               FROM boards b
               JOIN board_collaborators bc ON bc.board_id = b.id AND bc.user_id = $1
               WHERE bc.role = 'collaborator'
               ORDER BY b.updated_at DESC`;
      params = [effectiveUserId];
    } else {
      // All boards: owned + collaborating on
      query = `SELECT b.id, b.name, b.owner_id, b.created_at, b.updated_at, bc.role
               FROM boards b
               JOIN board_collaborators bc ON bc.board_id = b.id AND bc.user_id = $1
               ORDER BY b.updated_at DESC`;
      params = [effectiveUserId];
    }

    const { rows } = await db.query(query, params);
    return json(res, 200, rows);
  }

  // POST /api/boards — create board
  if (req.method === 'POST' && url.pathname === '/api/boards') {
    if (authEnabled() && !userId) return json(res, 401, { error: 'Authentication required' });
    const body = await parseBody(req);
    const id = (body.id as string) || nanoid(12);
    const name = (body.name as string) || 'Untitled Board';
    const ownerId = userId || (body.userId as string) || 'anonymous';

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO boards (id, name, owner_id) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
        [id, name, ownerId]
      );
      await client.query(
        'INSERT INTO board_collaborators (board_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (board_id, user_id) DO NOTHING',
        [id, ownerId, 'owner']
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return json(res, 201, { id, name, owner_id: ownerId });
  }

  // GET /api/boards/:id
  const getOneMatch = url.pathname.match(/^\/api\/boards\/([^/]+)$/);
  if (req.method === 'GET' && getOneMatch) {
    const id = getOneMatch[1]!;
    const role = await getBoardRole(id, userId);
    if (authEnabled() && !role) return json(res, 403, { error: 'Access denied' });

    const { rows } = await db.query(
      'SELECT id, name, owner_id, link_sharing_enabled, created_at, updated_at FROM boards WHERE id = $1',
      [id]
    );
    if (rows.length === 0) return json(res, 404, { error: 'Board not found' });
    return json(res, 200, { ...rows[0], role });
  }

  // POST /api/boards/:id/duplicate
  const duplicateMatch = url.pathname.match(/^\/api\/boards\/([^/]+)\/duplicate$/);
  if (req.method === 'POST' && duplicateMatch) {
    const sourceId = duplicateMatch[1]!;
    const role = await getBoardRole(sourceId, userId);
    if (authEnabled() && !role) return json(res, 403, { error: 'Access denied' });

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const { rows: sourceRows } = await client.query(
        'SELECT id, name, owner_id FROM boards WHERE id = $1',
        [sourceId]
      );
      if (sourceRows.length === 0) {
        await client.query('ROLLBACK');
        return json(res, 404, { error: 'Board not found' });
      }
      const source = sourceRows[0] as { id: string; name: string; owner_id: string };
      const newId = nanoid(12);
      const newName = `Copy of ${source.name}`;
      const ownerId = userId || source.owner_id;

      await client.query(
        'INSERT INTO boards (id, name, owner_id) VALUES ($1, $2, $3)',
        [newId, newName, ownerId]
      );
      await client.query(
        'INSERT INTO board_collaborators (board_id, user_id, role) VALUES ($1, $2, $3)',
        [newId, ownerId, 'owner']
      );
      await client.query(
        'INSERT INTO board_snapshots (board_id, data) SELECT $1, data FROM board_snapshots WHERE board_id = $2',
        [newId, sourceId]
      );
      await client.query(
        'INSERT INTO board_updates (board_id, data) SELECT $1, data FROM board_updates WHERE board_id = $2 ORDER BY id',
        [newId, sourceId]
      );
      await client.query('COMMIT');

      const { rows: newRows } = await client.query(
        'SELECT id, name, owner_id, created_at, updated_at FROM boards WHERE id = $1',
        [newId]
      );
      return json(res, 201, newRows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // POST /api/boards/:id/ai/command
  const aiCommandMatch = url.pathname.match(/^\/api\/boards\/([^/]+)\/ai\/command$/);
  if (req.method === 'POST' && aiCommandMatch) {
    const id = aiCommandMatch[1]!;
    const role = await getBoardRole(id, userId);
    if (authEnabled() && !role) return json(res, 403, { error: 'Access denied' });

    const body = await parseBody(req);
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    if (!prompt) return json(res, 400, { error: 'prompt required' });

    const requestUserId = userId || (body.userId as string) || 'anonymous';
    const limiter = checkAIRateLimit(`${requestUserId}:${id}`);
    if (!limiter.allowed) {
      return json(res, 429, {
        error: 'Rate limit exceeded',
        resetAt: limiter.resetAt,
        limit: limiter.limit,
      });
    }

    try {
      const result = await executeBoardAICommand({
        boardId: id,
        prompt,
        viewportCenter: body.viewportCenter,
        userId: requestUserId,
      });
      return json(res, 200, result);
    } catch (err: unknown) {
      console.error('AI command execution failed:', (err as Error).message);
      return json(res, 500, { error: (err as Error).message || 'AI command failed' });
    }
  }

  // PATCH /api/boards/:id — owner only
  const patchMatch = url.pathname.match(/^\/api\/boards\/([^/]+)$/);
  if (req.method === 'PATCH' && patchMatch) {
    const id = patchMatch[1]!;
    const role = await getBoardRole(id, userId);
    if (authEnabled() && role !== 'owner') return json(res, 403, { error: 'Owner access required' });

    const body = await parseBody(req);
    if (body.name) {
      await db.query(
        'UPDATE boards SET name = $1, updated_at = NOW() WHERE id = $2',
        [body.name, id]
      );
    }
    return json(res, 200, { ok: true });
  }

  // DELETE /api/boards/:id — owner only
  const deleteMatch = url.pathname.match(/^\/api\/boards\/([^/]+)$/);
  if (req.method === 'DELETE' && deleteMatch) {
    const id = deleteMatch[1]!;
    const role = await getBoardRole(id, userId);
    if (authEnabled() && role !== 'owner') return json(res, 403, { error: 'Owner access required' });

    await db.query('DELETE FROM boards WHERE id = $1', [id]);
    return json(res, 200, { ok: true });
  }

  return false;
}
