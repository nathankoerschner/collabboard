import { beforeEach, describe, expect, test, vi } from 'vitest';
import Y from '../yjs.js';

vi.mock('../db.js', () => ({
  getPool: vi.fn(),
}));

import { getPool } from '../db.js';
import { getPersistence } from '../persistence.js';

type UpdateRow = { id: number; data: Buffer };

function createMockPool() {
  const snapshots = new Map<string, Buffer>();
  const updates = new Map<string, UpdateRow[]>();
  let nextUpdateId = 1;

  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    const normalized = sql.replace(/\s+/g, ' ').trim().toUpperCase();

    if (normalized.startsWith('SELECT DATA FROM BOARD_SNAPSHOTS WHERE BOARD_ID = $1')) {
      const boardId = String(params[0]);
      const snap = snapshots.get(boardId);
      return { rows: snap ? [{ data: snap }] : [] };
    }

    if (normalized.startsWith('SELECT DATA FROM BOARD_UPDATES WHERE BOARD_ID = $1 ORDER BY ID')) {
      const boardId = String(params[0]);
      const rows = updates.get(boardId) || [];
      return { rows: rows.map((r) => ({ data: r.data })) };
    }

    if (normalized.startsWith('INSERT INTO BOARD_UPDATES (BOARD_ID, DATA) VALUES ($1, $2)')) {
      const boardId = String(params[0]);
      const data = Buffer.from(params[1] as Buffer);
      const list = updates.get(boardId) || [];
      list.push({ id: nextUpdateId++, data });
      updates.set(boardId, list);
      return { rows: [] };
    }

    if (normalized.startsWith('INSERT INTO BOARD_SNAPSHOTS (BOARD_ID, DATA, UPDATED_AT) VALUES ($1, $2, NOW())')) {
      const boardId = String(params[0]);
      const data = Buffer.from(params[1] as Buffer);
      snapshots.set(boardId, data);
      return { rows: [] };
    }

    if (normalized.startsWith('DELETE FROM BOARD_UPDATES WHERE BOARD_ID = $1')) {
      const boardId = String(params[0]);
      updates.set(boardId, []);
      return { rows: [] };
    }

    if (normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK') {
      return { rows: [] };
    }

    throw new Error(`Unhandled query: ${sql}`);
  });

  return {
    query,
    connect: vi.fn(async () => ({
      query,
      release: vi.fn(),
    })),
    readState(boardId: string) {
      return {
        snapshot: snapshots.get(boardId) || null,
        updates: (updates.get(boardId) || []).map((u) => u.data),
      };
    },
  };
}

function addItem(doc: Y.Doc, id: string): void {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const zOrder = doc.getArray<string>('zOrder');
  doc.transact(() => {
    const yObj = new Y.Map<unknown>();
    yObj.set('id', id);
    yObj.set('type', 'sticky');
    yObj.set('x', 0);
    yObj.set('y', 0);
    yObj.set('width', 120);
    yObj.set('height', 120);
    yObj.set('rotation', 0);
    yObj.set('createdBy', 'local');
    yObj.set('parentFrameId', null);
    yObj.set('text', id);
    yObj.set('color', 'yellow');
    objects.set(id, yObj);
    zOrder.push([id]);
  });
}

function getIds(doc: Y.Doc): string[] {
  const zOrder = doc.getArray<string>('zOrder');
  const ids: string[] = [];
  for (let i = 0; i < zOrder.length; i++) {
    ids.push(zOrder.get(i));
  }
  return ids;
}

async function flushAsyncWrites(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('persistence refresh flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('persists all items across repeated refreshes', async () => {
    const pool = createMockPool();
    vi.mocked(getPool).mockReturnValue(pool as never);

    const persistence = getPersistence();
    expect(persistence).not.toBeNull();

    const boardId = 'board-refresh';

    const doc1 = new Y.Doc();
    await persistence!.bindState(boardId, doc1);
    addItem(doc1, 'item-1');
    addItem(doc1, 'item-2');
    addItem(doc1, 'item-3');
    await flushAsyncWrites();
    await persistence!.writeState(boardId, doc1);

    const doc2 = new Y.Doc();
    await persistence!.bindState(boardId, doc2);
    expect(getIds(doc2)).toEqual(['item-1', 'item-2', 'item-3']);

    addItem(doc2, 'item-4');
    addItem(doc2, 'item-5');
    await flushAsyncWrites();
    await persistence!.writeState(boardId, doc2);

    const doc3 = new Y.Doc();
    await persistence!.bindState(boardId, doc3);
    expect(getIds(doc3)).toEqual(['item-1', 'item-2', 'item-3', 'item-4', 'item-5']);

    const persisted = pool.readState(boardId);
    expect(persisted.snapshot).toBeTruthy();
    expect(persisted.updates.length).toBe(0);
  });
});
