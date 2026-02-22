import { BoardManager } from '../board/BoardManager.js';
import { CursorManager } from '../board/CursorManager.js';
import { PresencePanel } from '../board/PresencePanel.js';
import { Canvas } from '../canvas/Canvas.js';
import { getUser, getToken } from '../auth.js';
import { navigateTo } from '../router.js';
import type { BoardObject, ShapeKind, ToolName } from '../types.js';
import { SelectionToolbar } from '../canvas/SelectionToolbar.js';
import { ColorPicker, STICKY_COLORS, SHAPE_COLORS } from '../canvas/ColorPicker.js';
import { AiCommandBar } from '../ui/AiCommandBar.js';
import { ShapesDrawer } from '../ui/ShapesDrawer.js';
import { BoardHeader } from '../ui/BoardHeader.js';

let boardManager: BoardManager | null = null;
let canvas: Canvas | null = null;
let cursorManager: CursorManager | null = null;
let presencePanel: PresencePanel | null = null;
let zoomInterval: ReturnType<typeof setInterval> | null = null;
let selectionToolbar: SelectionToolbar | null = null;
let colorPicker: ColorPicker | null = null;
let aiCommandBar: AiCommandBar | null = null;
let shapesDrawer: ShapesDrawer | null = null;
let boardHeader: BoardHeader | null = null;

declare global {
  interface Window {
    _boardKeyHandler?: ((e: KeyboardEvent) => void) | null;
    __collabboardDebug?: {
      getObjectCount: () => number;
      getObjectIds: () => string[];
    } | null;
    devAddObjects?: ((n: number) => void) | null;
  }
}

export const boardView = {
  async render(container: HTMLElement, params: Record<string, string>): Promise<void> {
    const boardId = params.boardId!;
    container.innerHTML = `
      <div class="board-view" id="board-view">
        <button class="back-to-dashboard" id="back-to-dashboard" title="Back to Dashboard" aria-label="Back to dashboard">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>

        <div class="board-name" id="board-name"></div>

        <button class="board-options-btn" id="board-options-btn" title="Board options" aria-label="Board options">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <circle cx="12" cy="5" r="1.5"/>
            <circle cx="12" cy="12" r="1.5"/>
            <circle cx="12" cy="19" r="1.5"/>
          </svg>
        </button>

        <div class="board-toolbar" id="toolbar">
          <div class="toolbar-group toolbar-undo-redo">
            <button class="toolbar-btn" id="undo-btn" data-tooltip="Undo | ⌘Z" aria-label="Undo" disabled>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 7v6h6"/>
                <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6.69 3L3 13"/>
              </svg>
            </button>
            <button class="toolbar-btn" id="redo-btn" data-tooltip="Redo | ⌘⇧Z" aria-label="Redo" disabled>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 7v6h-6"/>
                <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6.69 3L21 13"/>
              </svg>
            </button>
          </div>
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
            <button class="toolbar-btn" id="shapes-btn" data-tool="shape" data-tooltip="Shapes" aria-label="Shapes tool">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="10" height="10" rx="1"/>
                <circle cx="16" cy="16" r="6"/>
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
            <button class="toolbar-btn" data-tool="table" data-tooltip="Table" aria-label="Table tool">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <line x1="3" y1="9" x2="21" y2="9"/>
                <line x1="3" y1="15" x2="21" y2="15"/>
                <line x1="9" y1="3" x2="9" y2="21"/>
                <line x1="15" y1="3" x2="15" y2="21"/>
              </svg>
            </button>
          </div>
          <div class="toolbar-group">
            <button class="toolbar-btn" id="ai-chat-toggle" data-tooltip="Ask AI | ⌘K" aria-label="Open AI chat">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.937A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.582a.5.5 0 0 1 0 .962L15.5 14.063A2 2 0 0 0 14.063 15.5l-1.582 6.135a.5.5 0 0 1-.962 0z"/>
                <path d="M20 3v4"/>
                <path d="M22 5h-4"/>
                <path d="M4 17v2"/>
                <path d="M5 18H3"/>
              </svg>
              <div class="ai-bubble" id="ai-bubble"></div>
            </button>
          </div>
          <div class="toolbar-zoom" id="zoom-indicator">100%</div>
        </div>

        <div class="board-status" id="board-status"></div>
        <div class="ai-backdrop" id="ai-backdrop"></div>
        <div class="ai-command-bar" id="ai-command-bar" aria-hidden="true">
          <form class="ai-command-form" id="ai-command-form">
            <div class="ai-command-row">
              <input id="ai-command-input" class="ai-command-input" type="text" placeholder="Ask AI anything..." autocomplete="off" />
              <button type="submit" class="ai-command-submit" id="ai-command-submit">Run</button>
            </div>
          </form>
          <div class="ai-working" id="ai-working" hidden>Working...</div>
        </div>
        <div class="ai-toast" id="ai-toast"></div>
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
      onAccessRevoked: () => {
        navigateTo('/dashboard');
      },
    });

    // ── Debug hooks ──
    window.__collabboardDebug = {
      getObjectCount: () => boardManager?.getObjectStore().getAll().length || 0,
      getObjectIds: () => boardManager?.getObjectStore().getAll().map((obj) => obj.id) || [],
    };

    window.devAddObjects = (n: number) => {
      if (!objectStore || n <= 0) return;
      const stickyColors: string[] = ['yellow', 'blue', 'green', 'pink', 'purple', 'orange', 'red', 'teal'];
      const shapeKinds: ShapeKind[] = ['rectangle', 'rounded-rectangle', 'ellipse', 'circle', 'diamond', 'hexagon', 'star', 'triangle'];
      const shapeColors: string[] = ['#bfdbfe', '#bbf7d0', '#fecdd3', '#e9d5ff', '#fed7aa', '#99f6e4', '#fecaca'];
      const textSamples = ['Hello', 'TODO', 'Important', 'Note', 'Idea', 'Review', 'Draft', 'Question?', 'Done!', 'WIP'];

      const radius = Math.sqrt(n) * 150;
      const cx = canvas?.getViewportCenter().x ?? 0;
      const cy = canvas?.getViewportCenter().y ?? 0;

      const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]!;
      const rand = (min: number, max: number) => min + Math.random() * (max - min);

      for (let i = 0; i < n; i++) {
        const x = cx + (Math.random() - 0.5) * 2 * radius;
        const y = cy + (Math.random() - 0.5) * 2 * radius;
        const roll = Math.random();

        if (roll < 0.4) {
          const size = rand(120, 200);
          objectStore.createObject('sticky', x, y, size, size, {
            text: pick(textSamples),
            color: pick(stickyColors),
          });
        } else if (roll < 0.75) {
          const w = rand(80, 200);
          const h = rand(80, 200);
          objectStore.createObject('shape', x, y, w, h, {
            shapeKind: pick(shapeKinds),
            color: pick(shapeColors),
            strokeColor: '#64748b',
          });
        } else {
          objectStore.createObject('text', x, y, rand(100, 250), 40, {
            content: pick(textSamples),
            color: '#334155',
            style: { bold: Math.random() > 0.7, italic: false, size: pick(['small', 'medium', 'large']) },
          });
        }
      }
      console.log(`devAddObjects: added ${n} objects (radius=${Math.round(radius)})`);
    };

    const userId = user?.id || (user as Record<string, unknown>)?.sub;
    cursorManager = new CursorManager(boardManager.getAwareness(), { name: userName, id: typeof userId === 'string' ? userId : undefined });

    const canvasEl = document.getElementById('board-canvas') as HTMLCanvasElement;
    const toolbar = document.getElementById('toolbar')!;
    const shapesBtn = document.getElementById('shapes-btn')!;
    const boardViewEl = document.getElementById('board-view')!;
    const objectStore = boardManager.getObjectStore();

    canvas = new Canvas(canvasEl, objectStore, cursorManager, {
      onToolChange: (tool) => {
        toolbar.querySelectorAll('.toolbar-btn[data-tool]').forEach((b) => b.classList.remove('active'));
        if (tool === 'shape') {
          shapesBtn.classList.add('active');
        } else {
          toolbar.querySelector(`[data-tool="${tool}"]`)?.classList.add('active');
        }
      },
      onSelectionChange: (ids) => {
        const isTextEditing = !!canvas?.textEditor.getEditingId();
        selectionToolbar?.update(ids, isTextEditing);
        colorPicker?.close();
      },
    });

    // ── Undo / Redo buttons ──
    const undoBtn = document.getElementById('undo-btn') as HTMLButtonElement;
    const redoBtn = document.getElementById('redo-btn') as HTMLButtonElement;
    undoBtn.addEventListener('click', () => canvas?.undoRedoManager.undo());
    redoBtn.addEventListener('click', () => canvas?.undoRedoManager.redo());
    canvas.undoRedoManager.onStackChange(() => {
      undoBtn.disabled = !canvas?.undoRedoManager.canUndo();
      redoBtn.disabled = !canvas?.undoRedoManager.canRedo();
    });

    // ── Selection Toolbar + Color Picker ──
    selectionToolbar = new SelectionToolbar(
      boardViewEl,
      canvas.camera,
      () => {
        const ids = canvas?.getSelectedIds() || [];
        return ids.map((id) => objectStore.getObject(id)).filter((o): o is BoardObject => !!o);
      },
    );

    colorPicker = new ColorPicker({
      container: boardViewEl,
      onSelect: (color) => {
        const ids = canvas?.getSelectedIds() || [];
        for (const id of ids) {
          const obj = objectStore.getObject(id);
          if (!obj || obj.type === 'connector' || obj.type === 'frame') continue;
          objectStore.updateColor(id, color);
        }
        const isTextEditing = !!canvas?.textEditor.getEditingId();
        selectionToolbar?.update(ids, isTextEditing);
      },
    });

    selectionToolbar.setOnSwatchClick(() => {
      if (colorPicker!.isOpen()) {
        colorPicker!.close();
        return;
      }
      const objects = (canvas?.getSelectedIds() || [])
        .map((id) => objectStore.getObject(id))
        .filter((o): o is BoardObject => !!o && o.type !== 'connector' && o.type !== 'frame');
      if (!objects.length) return;

      const allSticky = objects.every((o) => o.type === 'sticky');
      const colors = allSticky ? STICKY_COLORS : SHAPE_COLORS;
      const activeColor = selectionToolbar!.getActiveColor();

      colorPicker!.open(selectionToolbar!.getSwatchButton(), colors, activeColor);
    });

    document.addEventListener('click', (e) => {
      if (colorPicker?.isOpen() && !(e.target as HTMLElement).closest('.color-picker-popover') && !(e.target as HTMLElement).closest('.color-swatch-btn')) {
        colorPicker.close();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (colorPicker?.isOpen() && e.key === 'Escape') {
        colorPicker.close();
      }
    });

    // ── Shapes Drawer ──
    shapesDrawer = new ShapesDrawer({
      anchorEl: shapesBtn,
      boardViewEl,
      onSelect: (kind) => {
        canvas!.setTool('shape');
        canvas!.setShapeKind(kind);
        toolbar.querySelectorAll('.toolbar-btn[data-tool]').forEach((b) => b.classList.remove('active'));
        shapesBtn.classList.add('active');
      },
    });

    // ── Toolbar tool buttons ──
    toolbar.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-tool]') as HTMLElement | null;
      if (!btn) return;
      const tool = btn.dataset.tool as ToolName;
      if (tool === 'shape') return; // handled by shapes drawer
      canvas!.setTool(tool);
      toolbar.querySelectorAll('.toolbar-btn[data-tool]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });

    // ── AI Command Bar ──
    const aiToggleBtn = document.getElementById('ai-chat-toggle');
    aiCommandBar = new AiCommandBar({
      container: boardViewEl,
      boardId,
      getCanvas: () => canvas,
      getUser: () => user as Record<string, unknown>,
      aiToggleBtn,
    });

    // ── Cmd+K global shortcut ──
    window._boardKeyHandler = (e: KeyboardEvent) => {
      const isCommandToggle = (e.metaKey || e.ctrlKey) && e.key?.toLowerCase() === 'k';
      if (isCommandToggle) {
        e.preventDefault();
        aiCommandBar?.toggle();
      }
    };
    window.addEventListener('keydown', window._boardKeyHandler);

    // ── Board Header (name + options) ──
    boardHeader = new BoardHeader({
      boardId,
      nameEl: document.getElementById('board-name')!,
      optionsBtn: document.getElementById('board-options-btn')!,
      userId: typeof userId === 'string' ? userId : undefined,
    });

    // ── Presence ──
    presencePanel = new PresencePanel(boardViewEl, boardManager.getAwareness());

    document.getElementById('back-to-dashboard')!.addEventListener('click', () => {
      navigateTo('/dashboard');
    });

    // ── Zoom indicator ──
    const zoomIndicator = document.getElementById('zoom-indicator')!;
    zoomIndicator.style.cursor = 'pointer';
    zoomIndicator.title = 'Reset to 100%';
    zoomIndicator.addEventListener('click', () => {
      if (canvas?.camera && canvas.camera.scale !== 1) {
        const cx = canvas.canvasEl.width / (2 * devicePixelRatio);
        const cy = canvas.canvasEl.height / (2 * devicePixelRatio);
        canvas.camera.animateToScale(1, cx, cy);
      }
    });
    zoomInterval = setInterval(() => {
      if (canvas?.camera) {
        zoomIndicator.textContent = `${Math.round(canvas.camera.scale * 100)}%`;
      }
    }, 150);
  },

  destroy(): void {
    if (window._boardKeyHandler) {
      window.removeEventListener('keydown', window._boardKeyHandler);
      window._boardKeyHandler = null;
    }
    if (zoomInterval) {
      clearInterval(zoomInterval);
      zoomInterval = null;
    }
    aiCommandBar?.destroy();
    shapesDrawer?.destroy();
    boardHeader?.destroy();
    colorPicker?.destroy();
    selectionToolbar?.destroy();
    presencePanel?.destroy();
    canvas?.destroy();
    cursorManager?.destroy();
    boardManager?.destroy();
    aiCommandBar = null;
    shapesDrawer = null;
    boardHeader = null;
    colorPicker = null;
    selectionToolbar = null;
    presencePanel = null;
    canvas = null;
    cursorManager = null;
    boardManager = null;
    window.__collabboardDebug = null;
    window.devAddObjects = null;
  },
};
