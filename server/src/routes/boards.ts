import type { IncomingMessage, ServerResponse } from 'node:http';
import { getPool } from '../db.js';
import { nanoid } from 'nanoid';
import { executeBoardAICommand } from '../ai/boardAgent.js';
import { isAIEnabled } from '../ai/featureFlags.js';
import { checkAIRateLimit } from '../ai/rateLimit.js';

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

  if (req.method === 'GET' && url.pathname === '/api/boards') {
    const ownerId = url.searchParams.get('userId') || userId;
    if (!ownerId) return json(res, 400, { error: 'userId required' });

    const { rows } = await db.query(
      'SELECT id, name, owner_id, created_at, updated_at FROM boards WHERE owner_id = $1 ORDER BY updated_at DESC',
      [ownerId]
    );
    return json(res, 200, rows);
  }

  if (req.method === 'POST' && url.pathname === '/api/boards') {
    const body = await parseBody(req);
    const id = (body.id as string) || nanoid(12);
    const name = (body.name as string) || 'Untitled Board';
    const ownerId = userId || (body.userId as string) || 'anonymous';

    await db.query(
      'INSERT INTO boards (id, name, owner_id) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
      [id, name, ownerId]
    );
    return json(res, 201, { id, name, owner_id: ownerId });
  }

  const aiCommandMatch = url.pathname.match(/^\/api\/boards\/([^/]+)\/ai\/command$/);
  if (req.method === 'POST' && aiCommandMatch) {
    if (!isAIEnabled()) {
      return json(res, 404, { error: 'AI feature is disabled' });
    }

    const id = aiCommandMatch[1]!;
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

  const patchMatch = url.pathname.match(/^\/api\/boards\/([^/]+)$/);
  if (req.method === 'PATCH' && patchMatch) {
    const id = patchMatch[1]!;
    const body = await parseBody(req);
    if (body.name) {
      await db.query(
        'UPDATE boards SET name = $1, updated_at = NOW() WHERE id = $2',
        [body.name, id]
      );
    }
    return json(res, 200, { ok: true });
  }

  const deleteMatch = url.pathname.match(/^\/api\/boards\/([^/]+)$/);
  if (req.method === 'DELETE' && deleteMatch) {
    const id = deleteMatch[1]!;
    await db.query('DELETE FROM boards WHERE id = $1', [id]);
    return json(res, 200, { ok: true });
  }

  return false;
}
