import Y from './yjs.js';
import type * as YTypes from 'yjs';
import { getPool } from './db.js';

const COMPACT_THRESHOLD = 100;
const HYDRATION_ORIGIN = 'persistence:hydrate';
const updateCounts = new Map<string, number>();
const pendingCompactions = new Map<string, Promise<void>>();
const pendingWrites = new Map<string, Promise<void>>();

interface Persistence {
  bindState: (docName: string, doc: YTypes.Doc) => Promise<void>;
  writeState: (docName: string, doc: YTypes.Doc) => Promise<void>;
}

export function getPersistence(): Persistence | null {
  const db = getPool();
  if (!db) return null;

  return {
    bindState: async (docName, doc) => {
      // Wait for any in-flight compaction from a previous doc instance
      // (race between writeState on close and bindState on reconnect)
      const inflight = pendingCompactions.get(docName);
      if (inflight) {
        await inflight.catch(() => {});
        pendingCompactions.delete(docName);
      }

      let loaded = false;
      const pendingUpdates: Buffer[] = [];

      doc.on('update', (update: Uint8Array, origin: unknown) => {
        if (origin === HYDRATION_ORIGIN) return;

        const buffered = Buffer.from(update);
        if (!loaded) {
          pendingUpdates.push(buffered);
          return;
        }

        void enqueueWrite(docName, async () => {
          try {
            await db.query(
              'INSERT INTO board_updates (board_id, data) VALUES ($1, $2)',
              [docName, buffered]
            );

            const count = (updateCounts.get(docName) || 0) + 1;
            updateCounts.set(docName, count);

            if (count >= COMPACT_THRESHOLD) {
              await compact(docName, doc);
            }
          } catch (err: unknown) {
            console.error(`Failed to persist update for ${docName}:`, (err as Error).message);
          }
        });
      });

      try {
        const { rows: snapRows } = await db.query(
          'SELECT data FROM board_snapshots WHERE board_id = $1',
          [docName]
        );
        if (snapRows.length > 0) {
          const snapshot = new Uint8Array(snapRows[0].data);
          Y.applyUpdate(doc, snapshot, HYDRATION_ORIGIN);
        }

        const { rows: updateRows } = await db.query(
          'SELECT data FROM board_updates WHERE board_id = $1 ORDER BY id',
          [docName]
        );
        for (const row of updateRows) {
          Y.applyUpdate(doc, new Uint8Array(row.data), HYDRATION_ORIGIN);
        }

        updateCounts.set(docName, updateRows.length);

        loaded = true;
        if (pendingUpdates.length > 0) {
          const buffered = pendingUpdates.splice(0, pendingUpdates.length);
          await enqueueWrite(docName, async () => {
            for (const buf of buffered) {
              try {
                await db.query(
                  'INSERT INTO board_updates (board_id, data) VALUES ($1, $2)',
                  [docName, buf]
                );
                const count = (updateCounts.get(docName) || 0) + 1;
                updateCounts.set(docName, count);
              } catch (err: unknown) {
                console.error(`Failed to persist buffered update for ${docName}:`, (err as Error).message);
              }
            }
          });
          const count = updateCounts.get(docName) || 0;
          if (count >= COMPACT_THRESHOLD) {
            await enqueueWrite(docName, async () => {
              await compact(docName, doc);
            });
          }
        }
      } catch (err: unknown) {
        console.error(`Failed to bind persistence for ${docName}:`, (err as Error).message);
        updateCounts.set(docName, 0);
        loaded = true;
      }
    },

    writeState: async (docName, doc) => {
      const compactionPromise = enqueueWrite(docName, async () => {
        await compact(docName, doc);
      }).catch((err: unknown) => {
        console.error(`Failed to write state for ${docName}:`, (err as Error).message);
      });
      pendingCompactions.set(docName, compactionPromise);
      await compactionPromise;
      pendingCompactions.delete(docName);
    },
  };
}

async function compact(docName: string, doc: YTypes.Doc): Promise<void> {
  const db = getPool();
  if (!db) return;

  const state = Y.encodeStateAsUpdate(doc);
  const client = await db.connect();

  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO board_snapshots (board_id, data, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (board_id) DO UPDATE SET data = $2, updated_at = NOW()`,
      [docName, Buffer.from(state)]
    );
    await client.query('DELETE FROM board_updates WHERE board_id = $1', [docName]);
    await client.query('COMMIT');
    updateCounts.set(docName, 0);
    console.log(`Compacted ${docName}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function enqueueWrite(docName: string, task: () => Promise<void>): Promise<void> {
  const prev = pendingWrites.get(docName) || Promise.resolve();
  const next = prev.catch(() => {}).then(task);
  pendingWrites.set(docName, next);
  return next.finally(() => {
    if (pendingWrites.get(docName) === next) {
      pendingWrites.delete(docName);
    }
  });
}
