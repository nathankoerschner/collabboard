import { BoardManager } from '../board/BoardManager.js';
import { CursorManager } from '../board/CursorManager.js';
import { PresencePanel } from '../board/PresencePanel.js';
import { Canvas } from '../canvas/Canvas.js';
import { getUser, getToken } from '../auth.js';
import { navigateTo } from '../router.js';
import { runAICommand, getBoard, renameBoard } from '../api.js';
import { openBoardOptionsModal } from '../components/boardOptionsModal.js';
import type { BoardObject, ShapeKind, ToolName } from '../types.js';
import { SHAPE_DEFS } from '../board/ShapeDefs.js';
import { SelectionToolbar } from '../canvas/SelectionToolbar.js';
import { ColorPicker, STICKY_COLORS, SHAPE_COLORS } from '../canvas/ColorPicker.js';

let boardManager: BoardManager | null = null;
let canvas: Canvas | null = null;
let cursorManager: CursorManager | null = null;
let presencePanel: PresencePanel | null = null;
let zoomInterval: ReturnType<typeof setInterval> | null = null;
let selectionToolbar: SelectionToolbar | null = null;
let colorPicker: ColorPicker | null = null;
let aiPanelOpen = false;
let aiSubmitting = false;

declare global {
  interface Window {
    _boardKeyHandler?: ((e: KeyboardEvent) => void) | null;
    __collabboardDebug?: {
      getObjectCount: () => number;
      getObjectIds: () => string[];
    } | null;
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
    window.__collabboardDebug = {
      getObjectCount: () => boardManager?.getObjectStore().getAll().length || 0,
      getObjectIds: () => boardManager?.getObjectStore().getAll().map((obj) => obj.id) || [],
    };

    const userId = user?.id || (user as Record<string, unknown>)?.sub;
    cursorManager = new CursorManager(boardManager.getAwareness(), { name: userName, id: typeof userId === 'string' ? userId : undefined });

    const canvasEl = document.getElementById('board-canvas') as HTMLCanvasElement;
    const toolbar = document.getElementById('toolbar')!;
    const aiToggleBtn = document.getElementById('ai-chat-toggle');

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
        // Refresh toolbar swatch
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

    // Click-away to close color picker
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

    const shapesDrawer = document.createElement('div');
    shapesDrawer.className = 'shapes-drawer';
    shapesDrawer.innerHTML = `<div class="shapes-grid"></div>`;
    boardViewEl.appendChild(shapesDrawer);

    const shapesGrid = shapesDrawer.querySelector('.shapes-grid')!;
    for (const [kind, def] of SHAPE_DEFS) {
      const btn = document.createElement('button');
      btn.className = 'shape-icon-btn';
      btn.dataset.shapeKind = kind;
      btn.title = def.label;
      btn.innerHTML = def.icon;
      shapesGrid.appendChild(btn);
    }

    let shapesDrawerOpen = false;
    const toggleShapesDrawer = (open: boolean) => {
      shapesDrawerOpen = open;
      shapesDrawer.classList.toggle('open', open);
      if (open) {
        const rect = shapesBtn.getBoundingClientRect();
        const boardRect = boardViewEl.getBoundingClientRect();
        shapesDrawer.style.left = `${rect.left - boardRect.left + rect.width / 2}px`;
        shapesDrawer.style.top = `${rect.bottom - boardRect.top + 8}px`;
      }
    };

    shapesBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleShapesDrawer(!shapesDrawerOpen);
    });

    shapesGrid.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-shape-kind]') as HTMLElement | null;
      if (!btn) return;
      const kind = btn.dataset.shapeKind as ShapeKind;
      canvas!.setTool('shape');
      canvas!.setShapeKind(kind);
      toggleShapesDrawer(false);
      toolbar.querySelectorAll('.toolbar-btn[data-tool]').forEach((b) => b.classList.remove('active'));
      shapesBtn.classList.add('active');
    });

    document.addEventListener('click', (e) => {
      if (shapesDrawerOpen && !shapesDrawer.contains(e.target as Node) && e.target !== shapesBtn && !shapesBtn.contains(e.target as Node)) {
        toggleShapesDrawer(false);
      }
    });

    document.addEventListener('keydown', (e) => {
      if (shapesDrawerOpen && e.key === 'Escape') {
        toggleShapesDrawer(false);
      }
    });

    presencePanel = new PresencePanel(boardViewEl, boardManager.getAwareness());

    document.getElementById('back-to-dashboard')!.addEventListener('click', () => {
      navigateTo('/dashboard');
    });

    toolbar.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-tool]') as HTMLElement | null;
      if (!btn) return;
      const tool = btn.dataset.tool as ToolName;
      if (tool === 'shape') return; // handled by shapes drawer toggle above
      canvas!.setTool(tool);
      toolbar.querySelectorAll('.toolbar-btn[data-tool]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });

    const aiBar = document.getElementById('ai-command-bar')!;
    const aiForm = document.getElementById('ai-command-form')!;
    const aiInput = document.getElementById('ai-command-input') as HTMLInputElement;
    const aiBackdrop = document.getElementById('ai-backdrop')!;
    const aiToast = document.getElementById('ai-toast')!;
    const aiWorking = document.getElementById('ai-working')!;
    const aiBubble = document.getElementById('ai-bubble')!;
    let toastTimer: ReturnType<typeof setTimeout> | null = null;
    let bubbleTimer: ReturnType<typeof setTimeout> | null = null;

    const showBubble = (message: string) => {
      aiBubble.textContent = message;
      aiBubble.classList.add('visible');
      if (bubbleTimer) clearTimeout(bubbleTimer);
      bubbleTimer = setTimeout(() => {
        aiBubble.classList.remove('visible');
        bubbleTimer = null;
      }, 3000);
    };

    const showToast = (message: string) => {
      aiToast.textContent = message;
      aiToast.classList.add('visible');
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        aiToast.classList.remove('visible');
        toastTimer = null;
      }, 4000);
    };

    const syncAiPanel = (isOpen: boolean) => {
      aiPanelOpen = isOpen;
      aiBar.classList.toggle('visible', isOpen);
      aiBackdrop.classList.toggle('visible', isOpen);
      aiBar.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
      aiToggleBtn?.classList.toggle('active', isOpen);

      if (isOpen && aiSubmitting) {
        // Show "Working..." state
        aiForm.hidden = true;
        aiWorking.hidden = false;
      } else if (isOpen) {
        // Show normal input state
        aiForm.hidden = false;
        aiWorking.hidden = true;
        aiInput.focus();
      }

      if (!isOpen) {
        aiInput.value = '';
      }
    };

    const submitAICommand = async (prompt: string): Promise<void> => {
      const trimmedPrompt = prompt.trim();
      if (!trimmedPrompt || aiSubmitting) return;

      aiSubmitting = true;
      // Close bar immediately and start toolbar spinner
      syncAiPanel(false);
      aiToggleBtn?.classList.add('ai-processing');

      try {
        const viewport = canvas!.getViewportSnapshot();
        const result = await runAICommand(boardId, {
          prompt: trimmedPrompt,
          viewportCenter: {
            x: viewport.center.x,
            y: viewport.center.y,
            widthPx: viewport.widthPx,
            heightPx: viewport.heightPx,
            topLeftWorld: viewport.topLeftWorld,
            bottomRightWorld: viewport.bottomRightWorld,
            scale: viewport.scale,
          },
          selectedObjectIds: canvas!.getSelectedIds(),
          userId: user?.id || (user as Record<string, unknown>)?.sub || 'anonymous',
        });

        const r = result as { createdIds?: string[]; updatedIds?: string[]; deletedIds?: string[] };
        const totalMutations = (r.createdIds?.length || 0) + (r.updatedIds?.length || 0) + (r.deletedIds?.length || 0);
        if (totalMutations === 0) {
          showBubble("Not sure what to do with that");
        }
      } catch (err: unknown) {
        showToast((err as Error)?.message || 'AI command failed');
      } finally {
        aiSubmitting = false;
        // Fade out highlight immediately, let spin finish its current cycle
        if (aiToggleBtn) {
          aiToggleBtn.classList.add('ai-stopping');
          const svg = aiToggleBtn.querySelector('svg');
          const onCycleEnd = () => {
            aiToggleBtn!.classList.remove('ai-processing', 'ai-stopping');
            svg?.removeEventListener('animationiteration', onCycleEnd);
          };
          svg?.addEventListener('animationiteration', onCycleEnd);
          // Safety fallback if the event doesn't fire (e.g. tab hidden)
          setTimeout(onCycleEnd, 2000);
        }
      }
    };

    aiToggleBtn?.addEventListener('click', () => {
      syncAiPanel(!aiPanelOpen);
    });

    aiBackdrop.addEventListener('click', () => {
      syncAiPanel(false);
    });

    aiForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await submitAICommand(aiInput.value);
    });

    window._boardKeyHandler = (e: KeyboardEvent) => {
      const isInput = (e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA';
      const isCommandToggle = (e.metaKey || e.ctrlKey) && e.key?.toLowerCase() === 'k';
      if (isCommandToggle) {
        e.preventDefault();
        syncAiPanel(!aiPanelOpen);
        return;
      }

      if (isInput) return;
      const keyMap: Record<string, ToolName> = { v: 'select', s: 'sticky', t: 'text', f: 'frame' };
      const tool = keyMap[e.key?.toLowerCase()];
      if (tool && !e.metaKey && !e.ctrlKey) {
        canvas!.setTool(tool);
        toolbar.querySelectorAll('.toolbar-btn[data-tool]').forEach((b) => b.classList.remove('active'));
        toolbar.querySelector(`[data-tool="${tool}"]`)?.classList.add('active');
      }
    };
    window.addEventListener('keydown', window._boardKeyHandler);

    // Fetch board data + click-to-rename
    const boardNameEl = document.getElementById('board-name')!;
    let currentBoardName = '';
    let boardIsOwner = false;

    getBoard(boardId).then((board) => {
      const b = board as { name?: string; owner_id?: string; role?: string };
      if (b?.name) {
        currentBoardName = b.name;
        boardNameEl.textContent = currentBoardName;
      }
      boardIsOwner = b?.role === 'owner' || b?.owner_id === user?.id;
    }).catch(() => {});

    boardNameEl.addEventListener('click', () => {
      if (!currentBoardName) return;
      const input = document.createElement('input');
      input.className = 'board-name-input';
      input.value = currentBoardName;
      boardNameEl.textContent = '';
      boardNameEl.appendChild(input);
      input.focus();
      input.select();

      const finish = (save: boolean) => {
        const newName = input.value.trim();
        if (save && newName && newName !== currentBoardName) {
          currentBoardName = newName;
          renameBoard(boardId, newName).catch(() => {});
        }
        boardNameEl.textContent = currentBoardName;
      };

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { e.preventDefault(); finish(false); input.remove(); }
      });
      input.addEventListener('blur', () => finish(true));
    });

    // Board Options button
    document.getElementById('board-options-btn')!.addEventListener('click', () => {
      openBoardOptionsModal({
        boardId,
        boardName: currentBoardName || 'Untitled Board',
        isOwner: boardIsOwner,
        onRename: (newName) => {
          currentBoardName = newName;
          boardNameEl.textContent = newName;
        },
        onClose: () => {},
      });
    });

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
    aiPanelOpen = false;
    aiSubmitting = false;
    colorPicker?.destroy();
    selectionToolbar?.destroy();
    presencePanel?.destroy();
    canvas?.destroy();
    cursorManager?.destroy();
    boardManager?.destroy();
    colorPicker = null;
    selectionToolbar = null;
    presencePanel = null;
    canvas = null;
    cursorManager = null;
    boardManager = null;
    window.__collabboardDebug = null;
  },
};
