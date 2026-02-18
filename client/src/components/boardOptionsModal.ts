import { renameBoard, duplicateBoard, deleteBoard } from '../api.js';
import { confirmModal } from './confirmModal.js';
import { navigateTo } from '../router.js';

interface BoardOptionsConfig {
  boardId: string;
  boardName: string;
  isOwner: boolean;
  onRename: (newName: string) => void;
  onClose: () => void;
}

type TabId = 'general' | 'sharing' | 'danger';

export function openBoardOptionsModal(config: BoardOptionsConfig): void {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay board-options-modal';

  const tabs: { id: TabId; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'sharing', label: 'Sharing' },
  ];
  if (config.isOwner) {
    tabs.push({ id: 'danger', label: 'Danger Zone' });
  }

  let activeTab: TabId = 'general';
  let sharingTabRenderer: ((container: HTMLElement) => void) | null = null;

  function close() {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    config.onClose();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }

  function render() {
    overlay.innerHTML = `
      <div class="modal-card">
        <div class="board-options-header">
          <h2>Board Options</h2>
          <button class="board-options-close" aria-label="Close">&times;</button>
        </div>
        <div class="board-options-tabs">
          ${tabs.map(t => `
            <button class="board-options-tab ${t.id === activeTab ? 'active' : ''}" data-tab="${t.id}">${t.label}</button>
          `).join('')}
        </div>
        <div class="board-options-content" id="board-options-tab-content"></div>
      </div>
    `;

    overlay.querySelector('.board-options-close')!.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    overlay.querySelectorAll('.board-options-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        activeTab = (btn as HTMLElement).dataset.tab as TabId;
        render();
      });
    });

    const content = overlay.querySelector('#board-options-tab-content')!;
    if (activeTab === 'general') renderGeneralTab(content as HTMLElement);
    else if (activeTab === 'sharing') renderSharingTab(content as HTMLElement);
    else if (activeTab === 'danger') renderDangerTab(content as HTMLElement);
  }

  function renderGeneralTab(container: HTMLElement) {
    container.innerHTML = `
      <div class="board-options-field">
        <label class="board-options-label" for="board-name-input">Board Name</label>
        <input class="board-options-input" id="board-name-input" type="text" value="" />
      </div>
      <div class="board-options-actions">
        <button class="btn btn-secondary" id="duplicate-btn">Duplicate Board</button>
      </div>
    `;

    const nameInput = container.querySelector('#board-name-input') as HTMLInputElement;
    nameInput.value = config.boardName;

    const saveName = () => {
      const newName = nameInput.value.trim();
      if (newName && newName !== config.boardName) {
        config.boardName = newName;
        renameBoard(config.boardId, newName).catch(() => {});
        config.onRename(newName);
      }
    };

    nameInput.addEventListener('blur', saveName);
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); nameInput.blur(); }
    });

    container.querySelector('#duplicate-btn')!.addEventListener('click', async () => {
      try {
        const newBoard = await duplicateBoard(config.boardId) as { id: string };
        close();
        navigateTo(`#/board/${newBoard.id}`);
      } catch (err) {
        console.error('Duplicate failed:', err);
      }
    });
  }

  function renderSharingTab(container: HTMLElement) {
    if (sharingTabRenderer) {
      sharingTabRenderer(container);
    } else {
      container.innerHTML = '<div style="color: var(--color-muted); font-size: 0.875rem;">Loading sharing settings...</div>';
      import('./sharingTab.js').then(mod => {
        sharingTabRenderer = (c: HTMLElement) => mod.renderSharingTab(c, {
          boardId: config.boardId,
          isOwner: config.isOwner,
        });
        sharingTabRenderer(container);
      }).catch(() => {
        container.innerHTML = '<div style="color: var(--color-muted); font-size: 0.875rem;">Sharing is not available.</div>';
      });
    }
  }

  function renderDangerTab(container: HTMLElement) {
    container.innerHTML = `
      <div class="danger-zone-section">
        <div class="danger-zone-title">Delete this board</div>
        <div class="danger-zone-desc">Once deleted, this board and all its contents cannot be recovered.</div>
        <button class="btn btn-danger" id="delete-board-btn">Delete Board</button>
      </div>
    `;

    container.querySelector('#delete-board-btn')!.addEventListener('click', async () => {
      const ok = await confirmModal({
        title: 'Delete Board',
        message: `Are you sure you want to delete "${config.boardName}"? This cannot be undone.`,
        confirmLabel: 'Delete',
        confirmDanger: true,
      });
      if (!ok) return;
      try {
        await deleteBoard(config.boardId);
        close();
        navigateTo('/dashboard');
      } catch (err) {
        console.error('Delete failed:', err);
      }
    });
  }

  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  render();
}
