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
let zoomInterval = null;

export const boardView = {
  async render(container, { boardId }) {
    container.innerHTML = `
      <div class="board-view" id="board-view">
        <button class="back-to-dashboard" id="back-to-dashboard" title="Back to Dashboard" aria-label="Back to dashboard">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>

        <div class="board-toolbar" id="toolbar">
          <div class="toolbar-group">
            <button class="toolbar-btn active" data-tool="select" data-tooltip="Select" aria-label="Select tool">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/>
                <path d="M13 13l6 6"/>
              </svg>
            </button>
            <button class="toolbar-btn" data-tool="sticky" data-tooltip="Sticky Note" aria-label="Sticky tool">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3z"/>
                <polyline points="14 3 14 8 21 8"/>
              </svg>
            </button>
            <button class="toolbar-btn" data-tool="rectangle" data-tooltip="Rectangle" aria-label="Rectangle tool">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
              </svg>
            </button>
            <button class="toolbar-btn" data-tool="ellipse" data-tooltip="Ellipse" aria-label="Ellipse tool">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
              </svg>
            </button>
            <button class="toolbar-btn" data-tool="text" data-tooltip="Text" aria-label="Text tool">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="4 7 4 4 20 4 20 7"/>
                <line x1="9.5" y1="20" x2="14.5" y2="20"/>
                <line x1="12" y1="4" x2="12" y2="20"/>
              </svg>
            </button>
            <button class="toolbar-btn" data-tool="frame" data-tooltip="Frame" aria-label="Frame tool">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="7" y1="2" x2="7" y2="22"/>
                <line x1="17" y1="2" x2="17" y2="22"/>
                <line x1="2" y1="7" x2="22" y2="7"/>
                <line x1="2" y1="17" x2="22" y2="17"/>
              </svg>
            </button>
            <button class="toolbar-btn" data-tool="connector" data-tooltip="Connector" aria-label="Connector tool">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="5" y1="19" x2="19" y2="5"/>
                <polyline points="15 5 19 5 19 9"/>
              </svg>
            </button>
          </div>
          <div class="toolbar-zoom" id="zoom-indicator">100%</div>
        </div>

        <div class="board-status" id="board-status"></div>
        <canvas id="board-canvas"></canvas>
      </div>
    `;

    const user = getUser();
    const token = await getToken();
    const userName = user?.fullName || user?.firstName || `User ${Math.floor(Math.random() * 1000)}`;

    boardManager = new BoardManager(boardId, {
      token,
      onStatusChange: (status) => {
        const statusEl = document.getElementById('board-status');
        if (!statusEl) return;
        if (status === 'connected') {
          statusEl.textContent = '';
          statusEl.classList.remove('visible');
        } else if (status === 'disconnected') {
          statusEl.textContent = 'Reconnecting...';
          statusEl.classList.add('visible');
        }
      },
    });

    cursorManager = new CursorManager(boardManager.getAwareness(), { name: userName });

    const canvasEl = document.getElementById('board-canvas');
    const toolbar = document.getElementById('toolbar');

    canvas = new Canvas(canvasEl, boardManager.getObjectStore(), cursorManager, {
      onToolChange: (tool) => {
        toolbar.querySelectorAll('.toolbar-btn').forEach((b) => b.classList.remove('active'));
        toolbar.querySelector(`[data-tool="${tool}"]`)?.classList.add('active');
      },
    });

    const boardViewEl = document.getElementById('board-view');
    presencePanel = new PresencePanel(boardViewEl, boardManager.getAwareness());

    document.getElementById('back-to-dashboard').addEventListener('click', () => {
      navigateTo('/dashboard');
    });

    toolbar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tool]');
      if (!btn) return;
      const tool = btn.dataset.tool;
      canvas.setTool(tool);
      toolbar.querySelectorAll('.toolbar-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });

    window._boardKeyHandler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      const keyMap = { v: 'select', s: 'sticky', r: 'rectangle', e: 'ellipse', t: 'text', f: 'frame', c: 'connector' };
      const tool = keyMap[e.key?.toLowerCase()];
      if (tool && !e.metaKey && !e.ctrlKey) {
        canvas.setTool(tool);
        toolbar.querySelectorAll('.toolbar-btn').forEach((b) => b.classList.remove('active'));
        toolbar.querySelector(`[data-tool="${tool}"]`)?.classList.add('active');
      }
    };
    window.addEventListener('keydown', window._boardKeyHandler);

    const zoomIndicator = document.getElementById('zoom-indicator');
    zoomInterval = setInterval(() => {
      if (canvas?.camera) {
        zoomIndicator.textContent = `${Math.round(canvas.camera.scale * 100)}%`;
      }
    }, 150);
  },

  destroy() {
    if (window._boardKeyHandler) {
      window.removeEventListener('keydown', window._boardKeyHandler);
      window._boardKeyHandler = null;
    }
    if (zoomInterval) {
      clearInterval(zoomInterval);
      zoomInterval = null;
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
