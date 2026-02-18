import dotenv from 'dotenv';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Duplex } from 'node:stream';
import { handleUpgrade, initPersistence } from './wsServer.js';
import { migrate } from './db.js';
import { handleBoardRoutes } from './routes/boards.js';
import { verifyToken } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProductionRuntime = process.env.NODE_ENV === 'production' || Boolean(process.env.K_SERVICE);
if (!isProductionRuntime) {
  dotenv.config({ path: path.resolve(__dirname, '../../.env') });
  dotenv.config();
}
const PORT = process.env.PORT || 3001;

initPersistence();

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.url === '/api/runtime-config') {
    const clerkPublishableKey = process.env.CLERK_PUBLISHABLE_KEY || process.env.VITE_CLERK_PUBLISHABLE_KEY || null;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ clerkPublishableKey }));
    return;
  }

  const url = new URL(req.url!, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/api/boards')) {
    try {
      let userId: string | null = null;
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        const decoded = await verifyToken(authHeader.slice(7));
        userId = (decoded?.sub as string) || null;
      }
      const handled = await handleBoardRoutes(req, res, userId);
      if (handled !== false) return;
    } catch (err: unknown) {
      console.error('Board route error:', (err as Error).message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
      return;
    }
  }

  const distPath = path.join(__dirname, '../../client/dist');
  if (fs.existsSync(distPath)) {
    const cleanPath = url.pathname;
    const filePath = path.join(distPath, cleanPath === '/' ? 'index.html' : cleanPath);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      const mimeTypes: Record<string, string> = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.svg': 'image/svg+xml',
        '.woff2': 'font/woff2',
        '.woff': 'font/woff',
      };
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    fs.createReadStream(path.join(distPath, 'index.html')).pipe(res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.on('upgrade', (req, socket: Duplex, head) => {
  handleUpgrade(req, socket, head).catch((err: unknown) => {
    console.error('Unhandled WebSocket upgrade error:', (err as Error).message);
    if (!socket.destroyed) {
      socket.write('HTTP/1.1 500 Internal Server Error\r\nConnection: close\r\n\r\n');
      socket.destroy();
    }
  });
});

migrate().then(() => {
  server.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
}).catch((err: unknown) => {
  console.error('Migration failed:', err);
  server.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT} (without DB)`);
  });
});

export { server };
