import { BoardManager } from '../board/BoardManager.js';
import { CursorManager } from '../board/CursorManager.js';
import { PresencePanel } from '../board/PresencePanel.js';
import { Canvas } from '../canvas/Canvas.js';
import { getUser, getToken } from '../auth.js';
import { navigateTo } from '../router.js';
import { runAICommand, getBoard, renameBoard } from '../api.js';
import { openBoardOptionsModal } from '../components/boardOptionsModal.js';
import type { ToolName } from '../types.js';

let boardManager: BoardManager | null = null;
let canvas: Canvas | null = null;
let cursorManager: CursorManager | null = null;
let presencePanel: PresencePanel | null = null;
let zoomInterval: ReturnType<typeof setInterval> | null = null;
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
          <div class="toolbar-group">
            <button class="toolbar-btn" id="ai-chat-toggle" data-tooltip="Ask AI" aria-label="Open AI chat">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.937A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.582a.5.5 0 0 1 0 .962L15.5 14.063A2 2 0 0 0 14.063 15.5l-1.582 6.135a.5.5 0 0 1-.962 0z"/>
                <path d="M20 3v4"/>
                <path d="M22 5h-4"/>
                <path d="M4 17v2"/>
                <path d="M5 18H3"/>
              </svg>
            </button>
          </div>
          <div class="toolbar-zoom" id="zoom-indicator">100%</div>
        </div>

        <div class="board-status" id="board-status"></div>
        <div class="ai-command-bar" id="ai-command-bar" aria-hidden="true">
          <form class="ai-command-form" id="ai-command-form">
            <label class="ai-command-title" for="ai-command-input">Ask AI</label>
            <div class="ai-command-row">
              <input id="ai-command-input" class="ai-command-input" type="text" placeholder="Create a SWOT analysis" autocomplete="off" />
              <button type="submit" class="ai-command-submit" id="ai-command-submit">Run</button>
            </div>
            <div class="ai-command-meta">
              <div class="ai-command-spinner" id="ai-command-spinner" hidden></div>
              <div class="ai-command-error" id="ai-command-error"></div>
            </div>
            <div class="ai-suggestions" id="ai-suggestions">
              <button type="button" class="ai-suggestion-chip">Create a SWOT analysis</button>
              <button type="button" class="ai-suggestion-chip">Make a retro board with columns</button>
              <button type="button" class="ai-suggestion-chip">Arrange selected notes in a grid</button>
            </div>
          </form>
        </div>
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

    cursorManager = new CursorManager(boardManager.getAwareness(), { name: userName });

    const canvasEl = document.getElementById('board-canvas') as HTMLCanvasElement;
    const toolbar = document.getElementById('toolbar')!;
    const aiToggleBtn = document.getElementById('ai-chat-toggle');
    const aiEnabled = true;

    canvas = new Canvas(canvasEl, boardManager.getObjectStore(), cursorManager, {
      onToolChange: (tool) => {
        toolbar.querySelectorAll('.toolbar-btn[data-tool]').forEach((b) => b.classList.remove('active'));
        toolbar.querySelector(`[data-tool="${tool}"]`)?.classList.add('active');
      },
    });

    const boardViewEl = document.getElementById('board-view')!;
    presencePanel = new PresencePanel(boardViewEl, boardManager.getAwareness());

    document.getElementById('back-to-dashboard')!.addEventListener('click', () => {
      navigateTo('/dashboard');
    });

    toolbar.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-tool]') as HTMLElement | null;
      if (!btn) return;
      const tool = btn.dataset.tool as ToolName;
      canvas!.setTool(tool);
      toolbar.querySelectorAll('.toolbar-btn[data-tool]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });

    const aiBar = document.getElementById('ai-command-bar')!;
    const aiForm = document.getElementById('ai-command-form')!;
    const aiInput = document.getElementById('ai-command-input') as HTMLInputElement;
    const aiSpinner = document.getElementById('ai-command-spinner')!;
    const aiError = document.getElementById('ai-command-error')!;
    const aiSuggestions = document.getElementById('ai-suggestions')!;
    const syncAiPanel = (isOpen: boolean) => {
      aiPanelOpen = isOpen;
      aiBar.classList.toggle('visible', aiPanelOpen);
      aiBar.setAttribute('aria-hidden', aiPanelOpen ? 'false' : 'true');
      aiToggleBtn?.classList.toggle('active', aiPanelOpen);
      if (aiPanelOpen) aiInput.focus();
    };

    if (!aiEnabled) {
      aiBar.remove();
      aiToggleBtn?.remove();
    } else {
      const submitAICommand = async (prompt: string): Promise<void> => {
        const trimmedPrompt = prompt.trim();
        if (!trimmedPrompt || aiSubmitting) return;

        aiSubmitting = true;
        aiError.textContent = '';
        (aiSpinner as HTMLElement).hidden = false;

        try {
          const center = canvas!.getViewportCenter();
          await runAICommand(boardId, {
            prompt: trimmedPrompt,
            viewportCenter: {
              x: center.x,
              y: center.y,
            },
            userId: user?.id || (user as Record<string, unknown>)?.sub || 'anonymous',
          });

          aiInput.value = '';
          syncAiPanel(false);
        } catch (err: unknown) {
          aiError.textContent = (err as Error)?.message || 'AI command failed';
        } finally {
          aiSubmitting = false;
          (aiSpinner as HTMLElement).hidden = true;
        }
      };

      aiToggleBtn?.addEventListener('click', () => {
        syncAiPanel(!aiPanelOpen);
      });

      aiSuggestions.addEventListener('click', async (e) => {
        const chip = (e.target as HTMLElement).closest('.ai-suggestion-chip') as HTMLElement | null;
        if (!chip) return;
        const prompt = chip.textContent || '';
        aiInput.value = prompt;
        await submitAICommand(prompt);
      });

      aiForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await submitAICommand(aiInput.value);
      });
    }

    window._boardKeyHandler = (e: KeyboardEvent) => {
      const isInput = (e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA';
      const isCommandToggle = (e.metaKey || e.ctrlKey) && e.key?.toLowerCase() === 'k';
      if (isCommandToggle && aiEnabled) {
        e.preventDefault();
        syncAiPanel(!aiPanelOpen);
        return;
      }

      if (isInput) return;
      const keyMap: Record<string, ToolName> = { v: 'select', s: 'sticky', r: 'rectangle', e: 'ellipse', t: 'text', f: 'frame', c: 'connector' };
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
    presencePanel?.destroy();
    canvas?.destroy();
    cursorManager?.destroy();
    boardManager?.destroy();
    presencePanel = null;
    canvas = null;
    cursorManager = null;
    boardManager = null;
    window.__collabboardDebug = null;
  },
};
