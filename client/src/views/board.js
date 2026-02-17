import { BoardManager } from '../board/BoardManager.js';
import { CursorManager } from '../board/CursorManager.js';
import { PresencePanel } from '../board/PresencePanel.js';
import { Canvas } from '../canvas/Canvas.js';
import { getUser, getToken } from '../auth.js';
import { navigateTo } from '../router.js';

let boardManager = null;
let canvas = null;
let cursorManager = null;
let presencePanel = null;

export const boardView = {
  async render(container, { boardId }) {
    container.innerHTML = `
      <div class="board-view" id="board-view">
        <button class="back-to-dashboard" id="back-to-dashboard" title="Back to Dashboard">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <div class="board-toolbar" id="toolbar">
          <div class="toolbar-group">
            <button class="toolbar-btn active" data-tool="select" title="Select (V)">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/>
              </svg>
            </button>
            <button class="toolbar-btn" data-tool="sticky" title="Sticky Note (S)">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <path d="M3 15h6v6"/>
              </svg>
            </button>
            <button class="toolbar-btn" data-tool="rectangle" title="Rectangle (R)">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
              </svg>
            </button>
          </div>
          <div class="toolbar-zoom" id="zoom-indicator">100%</div>
        </div>
        <div class="board-status" id="board-status"></div>
        <canvas id="board-canvas"></canvas>
      </div>
    `;

    // Get auth info
    const user = getUser();
    const token = await getToken();
    const userName = user?.fullName || user?.firstName || 'User ' + Math.floor(Math.random() * 1000);

    // Initialize board manager (Yjs + WebSocket)
    boardManager = new BoardManager(boardId, {
      token,
      onStatusChange: (status) => {
        const statusEl = document.getElementById('board-status');
        if (statusEl) {
          if (status === 'connected') {
            statusEl.textContent = '';
            statusEl.classList.remove('visible');
          } else if (status === 'disconnected') {
            statusEl.textContent = 'Reconnecting...';
            statusEl.classList.add('visible');
          }
        }
      },
    });

    // Cursor manager
    cursorManager = new CursorManager(boardManager.getAwareness(), {
      name: userName,
    });

    // Canvas
    const canvasEl = document.getElementById('board-canvas');
    canvas = new Canvas(canvasEl, boardManager.getObjectStore(), cursorManager);

    // Presence panel
    const boardViewEl = document.getElementById('board-view');
    presencePanel = new PresencePanel(boardViewEl, boardManager.getAwareness());

    // Back to dashboard
    document.getElementById('back-to-dashboard').addEventListener('click', () => {
      navigateTo('/dashboard');
    });

    // Toolbar event handling
    const toolbar = document.getElementById('toolbar');
    toolbar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tool]');
      if (!btn) return;
      const tool = btn.dataset.tool;
      canvas.setTool(tool);
      toolbar.querySelectorAll('.toolbar-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });

    // Keyboard shortcuts for tools
    window._boardKeyHandler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      const keyMap = { v: 'select', s: 'sticky', r: 'rectangle' };
      if (keyMap[e.key]) {
        canvas.setTool(keyMap[e.key]);
        toolbar.querySelectorAll('.toolbar-btn').forEach(b => b.classList.remove('active'));
        toolbar.querySelector(`[data-tool="${keyMap[e.key]}"]`)?.classList.add('active');
      }
    };
    window.addEventListener('keydown', window._boardKeyHandler);

    // Zoom indicator update
    const zoomIndicator = document.getElementById('zoom-indicator');
    setInterval(() => {
      if (canvas?.camera) {
        zoomIndicator.textContent = Math.round(canvas.camera.scale * 100) + '%';
      }
    }, 200);
  },

  destroy() {
    if (window._boardKeyHandler) {
      window.removeEventListener('keydown', window._boardKeyHandler);
      window._boardKeyHandler = null;
    }
    presencePanel?.destroy();
    canvas?.destroy();
    cursorManager?.destroy();
    boardManager?.destroy();
    presencePanel = null;
    canvas = null;
    cursorManager = null;
    boardManager = null;
  },
};
