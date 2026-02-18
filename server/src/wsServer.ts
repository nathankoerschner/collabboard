import { WebSocketServer } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
// @ts-expect-error y-websocket/bin/utils has no types
import { setupWSConnection, setPersistence } from 'y-websocket/bin/utils';
import { getPersistence } from './persistence.js';
import { verifyToken } from './auth.js';

const wss = new WebSocketServer({ noServer: true });

export function initPersistence(): void {
  const persistence = getPersistence();
  if (persistence) {
    setPersistence(persistence);
    console.log('Yjs persistence enabled');
  }
}

wss.on('connection', (ws: unknown, req: unknown, { docName }: { docName: string }) => {
  setupWSConnection(ws, req, { docName });
});

const roomCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

function rejectUpgrade(socket: Duplex, statusCode: number, reason: string): void {
  socket.write(`HTTP/1.1 ${statusCode} ${reason}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

export async function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
  try {
    const url = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
    const match = url.pathname.match(/^\/ws\/([^/]+)$/);

    if (!match) {
      rejectUpgrade(socket, 404, 'Not Found');
      return;
    }

    const boardId = decodeURIComponent(match[1]!);

    if (process.env.CLERK_SECRET_KEY) {
      const token = url.searchParams.get('token');
      const decoded = await verifyToken(token);
      if (!decoded) {
        console.warn(`WebSocket auth rejected for board ${boardId}`);
        rejectUpgrade(socket, 401, 'Unauthorized');
        return;
      }
    }

    if (roomCleanupTimers.has(boardId)) {
      clearTimeout(roomCleanupTimers.get(boardId));
      roomCleanupTimers.delete(boardId);
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, { docName: boardId });
    });
  } catch (err: unknown) {
    console.error('WebSocket upgrade failed:', (err as Error).message);
    if (!socket.destroyed) {
      rejectUpgrade(socket, 500, 'Internal Server Error');
    }
  }
}

export { wss };
