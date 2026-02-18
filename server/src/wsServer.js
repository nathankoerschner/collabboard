import { WebSocketServer } from 'ws';
import { setupWSConnection, setPersistence } from 'y-websocket/bin/utils';
import { getPersistence } from './persistence.js';
import { verifyToken } from './auth.js';

const wss = new WebSocketServer({ noServer: true });

// Persistence must be initialized lazily (after dotenv loads DATABASE_URL)
export function initPersistence() {
  const persistence = getPersistence();
  if (persistence) {
    setPersistence(persistence);
    console.log('Yjs persistence enabled');
  }
}

wss.on('connection', (ws, req, { docName }) => {
  setupWSConnection(ws, req, { docName });
});

// Room cleanup timeouts
const roomCleanupTimers = new Map();

function rejectUpgrade(socket, statusCode, reason) {
  socket.write(`HTTP/1.1 ${statusCode} ${reason}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

export async function handleUpgrade(req, socket, head) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const match = url.pathname.match(/^\/ws\/([^/]+)$/);

    if (!match) {
      rejectUpgrade(socket, 404, 'Not Found');
      return;
    }

    const boardId = decodeURIComponent(match[1]);

    // Verify auth token if Clerk is configured
    if (process.env.CLERK_SECRET_KEY) {
      const token = url.searchParams.get('token');
      const decoded = await verifyToken(token);
      if (!decoded) {
        console.warn(`WebSocket auth rejected for board ${boardId}`);
        rejectUpgrade(socket, 401, 'Unauthorized');
        return;
      }
    }

    // Cancel cleanup timer if someone reconnects
    if (roomCleanupTimers.has(boardId)) {
      clearTimeout(roomCleanupTimers.get(boardId));
      roomCleanupTimers.delete(boardId);
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, { docName: boardId });
    });
  } catch (err) {
    console.error('WebSocket upgrade failed:', err.message);
    if (!socket.destroyed) {
      rejectUpgrade(socket, 500, 'Internal Server Error');
    } else {
      return;
    }
  }
}

export { wss };
