import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { EventEmitter } from 'node:events';

// Mock modules before importing the handler
vi.mock('../../db.js', () => ({
  getPool: vi.fn(),
}));

vi.mock('../../ai/boardAgent.js', () => ({
  executeBoardAICommand: vi.fn(),
}));

vi.mock('../../ai/featureFlags.js', () => ({
  isAIEnabled: vi.fn(),
}));

vi.mock('../../ai/rateLimit.js', () => ({
  checkAIRateLimit: vi.fn(),
}));

import { handleBoardRoutes } from '../boards.js';
import { getPool } from '../../db.js';
import { executeBoardAICommand } from '../../ai/boardAgent.js';
import { isAIEnabled } from '../../ai/featureFlags.js';
import { checkAIRateLimit } from '../../ai/rateLimit.js';

// ── Helpers ──

function createMockReq(method: string, url: string, body?: Record<string, unknown>): IncomingMessage {
  const emitter = new EventEmitter() as IncomingMessage;
  emitter.method = method;
  emitter.url = url;
  emitter.headers = { host: 'localhost:3001' };

  // Simulate body streaming
  if (body) {
    process.nextTick(() => {
      emitter.emit('data', JSON.stringify(body));
      emitter.emit('end');
    });
  } else {
    process.nextTick(() => {
      emitter.emit('end');
    });
  }

  return emitter;
}

function createMockRes() {
  const res = {
    _status: 0,
    _body: null as unknown,
    _headers: {} as Record<string, string>,
    writeHead(status: number, headers?: Record<string, string>) {
      res._status = status;
      if (headers) Object.assign(res._headers, headers);
      return res;
    },
    end(data?: string) {
      if (data) {
        try {
          res._body = JSON.parse(data);
        } catch {
          res._body = data;
        }
      }
    },
  };
  return res as typeof res & ServerResponse;
}

function mockPool(overrides: Record<string, unknown> = {}) {
  const pool = {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    ...overrides,
  };
  vi.mocked(getPool).mockReturnValue(pool as any);
  return pool;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ──

describe('GET /api/boards', () => {
  test('returns boards for userId', async () => {
    const rows = [{ id: 'b1', name: 'Board 1', owner_id: 'u1' }];
    const pool = mockPool();
    pool.query.mockResolvedValue({ rows });

    const req = createMockReq('GET', '/api/boards?userId=u1');
    const res = createMockRes();
    await handleBoardRoutes(req, res, 'u1');

    expect(res._status).toBe(200);
    expect(res._body).toEqual(rows);
  });

  test('400 without userId', async () => {
    mockPool();
    const req = createMockReq('GET', '/api/boards');
    const res = createMockRes();
    await handleBoardRoutes(req, res, null);

    expect(res._status).toBe(400);
  });

  test('503 without db', async () => {
    vi.mocked(getPool).mockReturnValue(null);
    const req = createMockReq('GET', '/api/boards');
    const res = createMockRes();
    await handleBoardRoutes(req, res, 'u1');

    expect(res._status).toBe(503);
  });
});

describe('POST /api/boards', () => {
  test('creates board with generated ID', async () => {
    const pool = mockPool();
    const req = createMockReq('POST', '/api/boards', { name: 'New Board' });
    const res = createMockRes();
    await handleBoardRoutes(req, res, 'u1');

    expect(res._status).toBe(201);
    expect((res._body as any).name).toBe('New Board');
    expect((res._body as any).id).toBeTruthy();
    expect(pool.query).toHaveBeenCalled();
  });

  test('uses custom ID if provided', async () => {
    mockPool();
    const req = createMockReq('POST', '/api/boards', { id: 'custom-id', name: 'Board' });
    const res = createMockRes();
    await handleBoardRoutes(req, res, 'u1');

    expect(res._status).toBe(201);
    expect((res._body as any).id).toBe('custom-id');
  });

  test('default name is Untitled Board', async () => {
    mockPool();
    const req = createMockReq('POST', '/api/boards', {});
    const res = createMockRes();
    await handleBoardRoutes(req, res, 'u1');

    expect((res._body as any).name).toBe('Untitled Board');
  });
});

describe('PATCH /api/boards/:id', () => {
  test('updates name', async () => {
    const pool = mockPool();
    const req = createMockReq('PATCH', '/api/boards/b1', { name: 'Updated' });
    const res = createMockRes();
    await handleBoardRoutes(req, res, 'u1');

    expect(res._status).toBe(200);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE boards'),
      ['Updated', 'b1']
    );
  });
});

describe('DELETE /api/boards/:id', () => {
  test('deletes board', async () => {
    const pool = mockPool();
    const req = createMockReq('DELETE', '/api/boards/b1');
    const res = createMockRes();
    await handleBoardRoutes(req, res, 'u1');

    expect(res._status).toBe(200);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM boards'),
      ['b1']
    );
  });
});

describe('POST /api/boards/:id/ai/command', () => {
  test('404 when AI disabled', async () => {
    mockPool();
    vi.mocked(isAIEnabled).mockReturnValue(false);
    const req = createMockReq('POST', '/api/boards/b1/ai/command', { prompt: 'do stuff' });
    const res = createMockRes();
    await handleBoardRoutes(req, res, 'u1');

    expect(res._status).toBe(404);
  });

  test('400 without prompt', async () => {
    mockPool();
    vi.mocked(isAIEnabled).mockReturnValue(true);
    vi.mocked(checkAIRateLimit).mockReturnValue({ allowed: true, remaining: 10, resetAt: 0, limit: 20 });
    const req = createMockReq('POST', '/api/boards/b1/ai/command', {});
    const res = createMockRes();
    await handleBoardRoutes(req, res, 'u1');

    expect(res._status).toBe(400);
  });

  test('429 on rate limit', async () => {
    mockPool();
    vi.mocked(isAIEnabled).mockReturnValue(true);
    vi.mocked(checkAIRateLimit).mockReturnValue({ allowed: false, remaining: 0, resetAt: 99999, limit: 20 });
    const req = createMockReq('POST', '/api/boards/b1/ai/command', { prompt: 'do stuff' });
    const res = createMockRes();
    await handleBoardRoutes(req, res, 'u1');

    expect(res._status).toBe(429);
  });

  test('500 on execution error', async () => {
    mockPool();
    vi.mocked(isAIEnabled).mockReturnValue(true);
    vi.mocked(checkAIRateLimit).mockReturnValue({ allowed: true, remaining: 10, resetAt: 0, limit: 20 });
    vi.mocked(executeBoardAICommand).mockRejectedValue(new Error('LLM failed'));
    const req = createMockReq('POST', '/api/boards/b1/ai/command', { prompt: 'do stuff' });
    const res = createMockRes();
    await handleBoardRoutes(req, res, 'u1');

    expect(res._status).toBe(500);
    expect((res._body as any).error).toContain('LLM failed');
  });

  test('200 on success', async () => {
    mockPool();
    vi.mocked(isAIEnabled).mockReturnValue(true);
    vi.mocked(checkAIRateLimit).mockReturnValue({ allowed: true, remaining: 10, resetAt: 0, limit: 20 });
    vi.mocked(executeBoardAICommand).mockResolvedValue({ ok: true } as any);
    const req = createMockReq('POST', '/api/boards/b1/ai/command', { prompt: 'create a sticky' });
    const res = createMockRes();
    await handleBoardRoutes(req, res, 'u1');

    expect(res._status).toBe(200);
  });
});
