import * as Y from 'yjs';
import { getPool } from './db.js';

const COMPACT_THRESHOLD = 100;
const updateCounts = new Map();

export function getPersistence() {
  const db = getPool();
  if (!db) return null;

  return {
    bindState: async (docName, doc) => {
      try {
        // Load snapshot
        const { rows: snapRows } = await db.query(
          'SELECT data FROM board_snapshots WHERE board_id = $1',
          [docName]
        );
        if (snapRows.length > 0) {
          const snapshot = new Uint8Array(snapRows[0].data);
          Y.applyUpdate(doc, snapshot);
        }

        // Load incremental updates
        const { rows: updateRows } = await db.query(
          'SELECT data FROM board_updates WHERE board_id = $1 ORDER BY id',
          [docName]
        );
        for (const row of updateRows) {
          Y.applyUpdate(doc, new Uint8Array(row.data));
        }

        updateCounts.set(docName, updateRows.length);

        // Listen for new updates
        doc.on('update', async (update) => {
          try {
            await db.query(
              'INSERT INTO board_updates (board_id, data) VALUES ($1, $2)',
              [docName, Buffer.from(update)]
            );

            const count = (updateCounts.get(docName) || 0) + 1;
            updateCounts.set(docName, count);

            if (count >= COMPACT_THRESHOLD) {
              await compact(docName, doc);
            }
          } catch (err) {
            console.error(`Failed to persist update for ${docName}:`, err.message);
          }
        });
      } catch (err) {
        // Avoid crashing websocket handshake when DB is temporarily unavailable.
        console.error(`Failed to bind persistence for ${docName}:`, err.message);
        updateCounts.set(docName, 0);
      }
    },

    writeState: async (docName, doc) => {
      try {
        await compact(docName, doc);
      } catch (err) {
        console.error(`Failed to write state for ${docName}:`, err.message);
      }
    },
  };
}

async function compact(docName, doc) {
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
