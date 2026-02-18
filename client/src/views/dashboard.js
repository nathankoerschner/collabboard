import { navigateTo } from '../router.js';
import { nanoid } from 'nanoid';
import { getUser, mountUserButton, getClerk, signOut } from '../auth.js';
import { listBoards, createBoard } from '../api.js';

export const dashboardView = {
  async render(container) {
    const user = getUser();

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
          <div class="dashboard-actions">
            <h2>My Boards</h2>
            <button class="btn btn-primary" id="create-board">+ New Board</button>
          </div>
          <div id="board-list" class="board-grid">
            <div class="loading">Loading boards...</div>
          </div>
        </div>
      </div>
    `;

    // Mount Clerk user button
    const userBtnEl = document.getElementById('clerk-user-button');
    if (getClerk()) {
      mountUserButton(userBtnEl);
    }

    // Logout handler
    container.querySelector('#logout-btn').addEventListener('click', async () => {
      await signOut();
      navigateTo('#/');
    });

    // Create board handler
    container.querySelector('#create-board').addEventListener('click', async () => {
      const id = nanoid(12);
      try {
        await createBoard({ id, userId: user?.id });
      } catch {
        // DB might not be configured, that's ok
      }
      navigateTo(`#/board/${id}`);
    });

    // Load boards
    const boardList = document.getElementById('board-list');
    try {
      const boards = await listBoards(user?.id || 'anonymous');
      if (boards.length === 0) {
        boardList.innerHTML = `
          <div class="empty-state">
            <p>No boards yet. Create your first board!</p>
          </div>
        `;
      } else {
        boardList.innerHTML = boards.map(board => `
          <div class="board-card" data-id="${board.id}">
            <div class="board-card-name">${board.name}</div>
            <div class="board-card-time">${timeAgo(board.updated_at)}</div>
          </div>
        `).join('');

        boardList.addEventListener('click', (e) => {
          const card = e.target.closest('.board-card');
          if (card) navigateTo(`#/board/${card.dataset.id}`);
        });
      }
    } catch {
      // Failed to load boards (auth/network/DB). Keep CTA available.
      boardList.innerHTML = `
        <div class="empty-state">
          <p>Could not load boards right now. You can still create a new board.</p>
        </div>
      `;
    }
  },
  destroy() {},
};

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
  return Math.floor(seconds / 86400) + 'd ago';
}
