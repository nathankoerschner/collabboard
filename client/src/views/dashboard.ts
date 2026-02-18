import { navigateTo } from '../router.js';
import { nanoid } from 'nanoid';
import { getUser, mountUserButton, getClerk, signOut } from '../auth.js';
import { listBoards, createBoard, renameBoard, deleteBoard, duplicateBoard, removeCollaborator } from '../api.js';
import { confirmModal } from '../components/confirmModal.js';

interface BoardItem {
  id: string;
  name: string;
  owner_id: string;
  role?: string;
  created_at: string;
  updated_at: string;
}

type FilterTab = 'all' | 'owned' | 'shared';

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function timeAgo(dateStr: string): string {
  if (!dateStr) return '';
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
  return Math.floor(seconds / 86400) + 'd ago';
}

// ─── State ──────────────────────────────────────────────────────────
let boards: BoardItem[] = [];
let selectMode = false;
let selectedIds = new Set<string>();
let searchQuery = '';
let activeRenameId: string | null = null;
let activeFilter: FilterTab = 'all';

let boardListEl: HTMLElement | null = null;
let dashboardActionsEl: HTMLElement | null = null;
let bulkBarEl: HTMLElement | null = null;
let filterTabsEl: HTMLElement | null = null;

// ─── Context Menu ───────────────────────────────────────────────────
let activeMenu: HTMLElement | null = null;

function closeContextMenu() {
  if (activeMenu) {
    activeMenu.remove();
    activeMenu = null;
  }
}

function openContextMenu(boardId: string, anchorEl: HTMLElement) {
  closeContextMenu();
  const board = boards.find(b => b.id === boardId);
  const isShared = board?.role === 'collaborator';
  const rect = anchorEl.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.className = 'context-menu';

  if (isShared) {
    menu.innerHTML = `
      <button class="context-menu-item" data-action="duplicate">Duplicate</button>
      <button class="context-menu-item context-menu-item--danger" data-action="leave">Leave</button>
    `;
  } else {
    menu.innerHTML = `
      <button class="context-menu-item" data-action="rename">Rename</button>
      <button class="context-menu-item" data-action="duplicate">Duplicate</button>
      <button class="context-menu-item context-menu-item--danger" data-action="delete">Delete</button>
    `;
  }
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.left = `${rect.left}px`;

  menu.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.context-menu-item') as HTMLElement | null;
    if (!btn) return;
    const action = btn.dataset.action;
    closeContextMenu();
    if (action === 'rename') startRename(boardId);
    else if (action === 'duplicate') doDuplicate(boardId);
    else if (action === 'delete') doDelete(boardId);
    else if (action === 'leave') doLeave(boardId);
  });

  document.body.appendChild(menu);
  activeMenu = menu;

  // Reposition if overflowing right edge
  const menuRect = menu.getBoundingClientRect();
  if (menuRect.right > window.innerWidth) {
    menu.style.left = `${rect.right - menuRect.width}px`;
  }

  requestAnimationFrame(() => {
    const close = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node)) {
        closeContextMenu();
        document.removeEventListener('click', close);
      }
    };
    document.addEventListener('click', close);
  });
}

// ─── Actions ────────────────────────────────────────────────────────
function startRename(boardId: string) {
  activeRenameId = boardId;
  const card = boardListEl?.querySelector(`.board-card[data-id="${boardId}"]`) as HTMLElement | null;
  if (!card) return;
  const nameEl = card.querySelector('.board-card-name') as HTMLElement;
  const board = boards.find(b => b.id === boardId);
  if (!board) return;

  const input = document.createElement('input');
  input.className = 'board-card-rename-input';
  input.value = board.name;
  nameEl.textContent = '';
  nameEl.appendChild(input);
  input.focus();
  input.select();

  const finish = (save: boolean) => {
    const newName = input.value.trim();
    activeRenameId = null;
    if (save && newName && newName !== board.name) {
      board.name = newName;
      renameBoard(boardId, newName).catch(() => {});
    }
    rerender();
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
}

async function doDelete(boardId: string) {
  const board = boards.find(b => b.id === boardId);
  if (!board) return;
  const ok = await confirmModal({
    title: 'Delete Board',
    message: `Are you sure you want to delete "${escapeHtml(board.name)}"? This cannot be undone.`,
    confirmLabel: 'Delete',
    confirmDanger: true,
  });
  if (!ok) return;
  await deleteBoard(boardId);
  boards = boards.filter(b => b.id !== boardId);
  selectedIds.delete(boardId);
  rerender();
}

async function doLeave(boardId: string) {
  const board = boards.find(b => b.id === boardId);
  if (!board) return;
  const user = getUser();
  const ok = await confirmModal({
    title: 'Leave Board',
    message: `Are you sure you want to leave "${escapeHtml(board.name)}"? You will lose access unless re-invited.`,
    confirmLabel: 'Leave',
    confirmDanger: true,
  });
  if (!ok) return;
  await removeCollaborator(boardId, user?.id || 'anonymous');
  boards = boards.filter(b => b.id !== boardId);
  rerender();
}

async function doDuplicate(boardId: string) {
  try {
    const newBoard = await duplicateBoard(boardId) as BoardItem;
    boards.unshift(newBoard);
    rerender();
  } catch (err) {
    console.error('Duplicate failed:', err);
  }
}

// ─── Bulk Operations ────────────────────────────────────────────────
async function bulkDelete() {
  const count = selectedIds.size;
  if (count === 0) return;
  const ok = await confirmModal({
    title: 'Delete Boards',
    message: `Are you sure you want to delete ${count} board${count > 1 ? 's' : ''}? This cannot be undone.`,
    confirmLabel: 'Delete',
    confirmDanger: true,
  });
  if (!ok) return;
  await Promise.all([...selectedIds].map(id => deleteBoard(id)));
  boards = boards.filter(b => !selectedIds.has(b.id));
  exitSelectMode();
}

async function bulkDuplicate() {
  if (selectedIds.size === 0) return;
  const results = await Promise.all([...selectedIds].map(id => duplicateBoard(id))) as BoardItem[];
  boards.unshift(...results);
  exitSelectMode();
}

function enterSelectMode() {
  selectMode = true;
  selectedIds.clear();
  rerender();
  renderActions();
  renderBulkBar();
  if (boardListEl) boardListEl.style.paddingBottom = '4.5rem';
}

function exitSelectMode() {
  selectMode = false;
  selectedIds.clear();
  rerender();
  renderActions();
  renderBulkBar();
  if (boardListEl) boardListEl.style.paddingBottom = '';
}

function toggleSelection(id: string) {
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
  rerender();
  renderBulkBar();
}

function selectAll() {
  const filtered = getFilteredBoards();
  if (selectedIds.size === filtered.length) {
    selectedIds.clear();
  } else {
    filtered.forEach(b => selectedIds.add(b.id));
  }
  rerender();
  renderBulkBar();
}

// ─── Filter ─────────────────────────────────────────────────────────
async function setFilter(filter: FilterTab) {
  activeFilter = filter;
  renderFilterTabs();
  try {
    const apiFilter = filter === 'all' ? undefined : filter;
    boards = await listBoards(apiFilter) as BoardItem[];
    rerender();
  } catch {
    boards = [];
    rerender();
  }
}

function renderFilterTabs() {
  if (!filterTabsEl) return;
  const tabs: { id: FilterTab; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'owned', label: 'My Boards' },
    { id: 'shared', label: 'Shared with Me' },
  ];
  filterTabsEl.innerHTML = tabs.map(t =>
    `<button class="filter-tab ${t.id === activeFilter ? 'active' : ''}" data-filter="${t.id}">${t.label}</button>`
  ).join('');

  filterTabsEl.querySelectorAll('.filter-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const filter = (btn as HTMLElement).dataset.filter as FilterTab;
      setFilter(filter);
    });
  });
}

// ─── Filtering ──────────────────────────────────────────────────────
function getFilteredBoards(): BoardItem[] {
  if (!searchQuery) return boards;
  const q = searchQuery.toLowerCase();
  return boards.filter(b => b.name.toLowerCase().includes(q));
}

// ─── Render ─────────────────────────────────────────────────────────
function renderActions() {
  if (!dashboardActionsEl) return;
  if (selectMode) {
    dashboardActionsEl.innerHTML = `
      <h2>My Boards</h2>
      <button class="btn btn-secondary" id="select-done-btn">Done</button>
    `;
    dashboardActionsEl.querySelector('#select-done-btn')!.addEventListener('click', exitSelectMode);
  } else {
    dashboardActionsEl.innerHTML = `
      <h2>My Boards</h2>
      <div class="dashboard-actions-right">
        <button class="btn btn-secondary" id="select-mode-btn">Select</button>
        <button class="btn btn-primary" id="create-board">+ New Board</button>
      </div>
    `;
    dashboardActionsEl.querySelector('#select-mode-btn')!.addEventListener('click', enterSelectMode);
    dashboardActionsEl.querySelector('#create-board')!.addEventListener('click', async () => {
      const user = getUser();
      const id = nanoid(12);
      try {
        await createBoard({ id, userId: user?.id });
      } catch {
        // DB might not be configured
      }
      navigateTo(`#/board/${id}`);
    });
  }
}

function renderBulkBar() {
  if (!bulkBarEl) return;
  if (!selectMode) {
    bulkBarEl.style.display = 'none';
    bulkBarEl.innerHTML = '';
    return;
  }
  bulkBarEl.style.display = '';
  const count = selectedIds.size;
  bulkBarEl.innerHTML = `
    <span class="bulk-bar-count">${count} selected</span>
    <div class="bulk-bar-actions">
      <button class="btn btn-secondary" id="bulk-select-all">Select All</button>
      <button class="btn btn-secondary" id="bulk-duplicate" ${count === 0 ? 'disabled' : ''}>Duplicate</button>
      <button class="btn btn-danger" id="bulk-delete" ${count === 0 ? 'disabled' : ''}>Delete</button>
    </div>
  `;
  bulkBarEl.querySelector('#bulk-select-all')!.addEventListener('click', selectAll);
  bulkBarEl.querySelector('#bulk-duplicate')!.addEventListener('click', bulkDuplicate);
  bulkBarEl.querySelector('#bulk-delete')!.addEventListener('click', bulkDelete);
}

function rerender() {
  if (!boardListEl) return;
  const filtered = getFilteredBoards();

  if (filtered.length === 0) {
    boardListEl.innerHTML = `
      <div class="empty-state">
        <p>${searchQuery ? 'No boards match your search.' : 'No boards yet. Create your first board!'}</p>
      </div>
    `;
    return;
  }

  boardListEl.innerHTML = filtered.map(board => {
    const isSelected = selectedIds.has(board.id);
    const isShared = board.role === 'collaborator';
    return `
      <div class="board-card ${isSelected ? 'board-card--selected' : ''}" data-id="${board.id}">
        ${selectMode ? `<input type="checkbox" class="board-card-checkbox" ${isSelected ? 'checked' : ''}>` : `<button class="board-card-menu-btn" data-id="${board.id}" aria-label="Board options">&#x22EE;</button>`}
        ${isShared ? '<div class="board-card-badge">Shared</div>' : ''}
        <div class="board-card-name">${escapeHtml(board.name)}</div>
        <div class="board-card-time">${timeAgo(board.updated_at)}</div>
      </div>
    `;
  }).join('');
}

// ─── View Export ─────────────────────────────────────────────────────
export const dashboardView = {
  async render(container: HTMLElement, _params: Record<string, string>): Promise<void> {
    // Reset state
    boards = [];
    selectMode = false;
    selectedIds = new Set();
    searchQuery = '';
    activeRenameId = null;
    activeFilter = 'all';
    closeContextMenu();

    container.innerHTML = `
      <div class="dashboard">
        <header class="dashboard-header">
          <h1 class="dashboard-logo">CollabBoard</h1>
          <div class="dashboard-header-right">
            <div id="clerk-user-button"></div>
            <button class="btn btn-logout" id="logout-btn">Log out</button>
          </div>
        </header>
        <div class="dashboard-content">
          <div class="dashboard-actions" id="dashboard-actions"></div>
          <div class="dashboard-filter-tabs" id="filter-tabs"></div>
          <div class="search-bar" id="search-bar">
            <input type="text" class="search-input" id="search-input" placeholder="Search boards...">
          </div>
          <div id="board-list" class="board-grid">
            <div class="loading">Loading boards...</div>
          </div>
        </div>
        <div class="bulk-bar" id="bulk-bar" style="display:none"></div>
      </div>
    `;

    boardListEl = document.getElementById('board-list');
    dashboardActionsEl = document.getElementById('dashboard-actions');
    bulkBarEl = document.getElementById('bulk-bar');
    filterTabsEl = document.getElementById('filter-tabs');

    renderActions();
    renderFilterTabs();

    const userBtnEl = document.getElementById('clerk-user-button');
    if (getClerk()) {
      mountUserButton(userBtnEl);
    }

    container.querySelector('#logout-btn')!.addEventListener('click', async () => {
      await signOut();
      navigateTo('#/');
    });

    // Search
    const searchInput = document.getElementById('search-input') as HTMLInputElement;
    searchInput.addEventListener('input', () => {
      searchQuery = searchInput.value;
      rerender();
    });

    // Event delegation on board list
    boardListEl!.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;

      // Three-dot menu button
      const menuBtn = target.closest('.board-card-menu-btn') as HTMLElement | null;
      if (menuBtn) {
        e.stopPropagation();
        openContextMenu(menuBtn.dataset.id!, menuBtn);
        return;
      }

      // Checkbox
      if (target.classList.contains('board-card-checkbox')) {
        e.stopPropagation();
        const card = target.closest('.board-card') as HTMLElement;
        if (card) toggleSelection(card.dataset.id!);
        return;
      }

      // Card click
      const card = target.closest('.board-card') as HTMLElement | null;
      if (!card) return;
      if (activeRenameId) return;
      if (selectMode) {
        toggleSelection(card.dataset.id!);
        return;
      }
      navigateTo(`#/board/${card.dataset.id}`);
    });

    // Load boards
    try {
      boards = await listBoards() as BoardItem[];
      rerender();
    } catch {
      boardListEl!.innerHTML = `
        <div class="empty-state">
          <p>Could not load boards right now. You can still create a new board.</p>
        </div>
      `;
    }
  },

  destroy() {
    closeContextMenu();
    boardListEl = null;
    dashboardActionsEl = null;
    bulkBarEl = null;
    filterTabsEl = null;
  },
};
