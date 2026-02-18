import dotenv from 'dotenv';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleUpgrade } from './wsServer.js';
import { migrate, getPool } from './db.js';
import { handleBoardRoutes } from './routes/boards.js';
import { verifyToken } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProductionRuntime = process.env.NODE_ENV === 'production' || Boolean(process.env.K_SERVICE);
if (!isProductionRuntime) {
  dotenv.config({ path: path.resolve(__dirname, '../../.env') });
  dotenv.config();
}
const PORT = process.env.PORT || 3001;

const server = http.createServer(async (req, res) => {
  // CORS headers for dev
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

  // Board API routes
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/api/boards')) {
    try {
      // Extract user from token if available
      let userId = null;
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        const decoded = await verifyToken(authHeader.slice(7));
        userId = decoded?.sub || null;
      }
      const handled = await handleBoardRoutes(req, res, userId);
      if (handled !== false) return;
    } catch (err) {
      console.error('Board route error:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
      return;
    }
  }

  // In production, serve static files from client/dist
  const distPath = path.join(__dirname, '../../client/dist');
  if (fs.existsSync(distPath)) {
    // Strip query string for file lookup
    const cleanPath = url.pathname;
    const filePath = path.join(distPath, cleanPath === '/' ? 'index.html' : cleanPath);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      const mimeTypes = {
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
    // SPA fallback
    res.writeHead(200, { 'Content-Type': 'text/html' });
    fs.createReadStream(path.join(distPath, 'index.html')).pipe(res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

// WebSocket upgrade
server.on('upgrade', (req, socket, head) => {
  handleUpgrade(req, socket, head).catch((err) => {
    console.error('Unhandled WebSocket upgrade error:', err.message);
    if (!socket.destroyed) {
      socket.write('HTTP/1.1 500 Internal Server Error\r\nConnection: close\r\n\r\n');
      socket.destroy();
    }
  });
});

// Run migrations on startup
migrate().then(() => {
  server.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Migration failed:', err);
  // Start anyway (DB might not be configured)
  server.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT} (without DB)`);
  });
});

export { server };
