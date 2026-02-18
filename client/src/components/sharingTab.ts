import {
  getCollaborators,
  addCollaborator,
  removeCollaborator,
  updateLinkSharing,
  searchUsers,
} from '../api.js';

interface SharingConfig {
  boardId: string;
  isOwner: boolean;
}

interface Collaborator {
  user_id: string;
  role: string;
  name?: string;
  email?: string;
  image_url?: string;
}

interface SearchUser {
  id: string;
  name: string;
  email: string;
  image_url?: string;
}

export function renderSharingTab(container: HTMLElement, config: SharingConfig): void {
  let collaborators: Collaborator[] = [];
  let linkSharingEnabled = false;
  let searchQuery = '';
  let searchResults: SearchUser[] = [];
  let searchTimeout: ReturnType<typeof setTimeout> | null = null;
  let showDropdown = false;

  async function loadData() {
    try {
      const data = await getCollaborators(config.boardId) as { collaborators: Collaborator[]; link_sharing_enabled: boolean };
      collaborators = data.collaborators || [];
      linkSharingEnabled = data.link_sharing_enabled || false;
    } catch {
      collaborators = [];
      linkSharingEnabled = false;
    }
    render();
  }

  function getBoardUrl(): string {
    return `${location.origin}/#/board/${config.boardId}`;
  }

  function getInitials(name?: string): string {
    if (!name) return '?';
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  }

  function render() {
    const linkSection = config.isOwner ? `
      <div class="sharing-section">
        <div class="sharing-section-title">Link Sharing</div>
        <div class="sharing-toggle-row">
          <span class="sharing-toggle-label">Anyone with the link can access</span>
          <button class="sharing-toggle ${linkSharingEnabled ? 'active' : ''}" id="link-toggle" aria-label="Toggle link sharing"></button>
        </div>
        ${linkSharingEnabled ? `
          <div class="sharing-link-row">
            <input class="sharing-link-input" readonly value="${getBoardUrl()}" />
            <button class="sharing-copy-btn" id="copy-link-btn">Copy</button>
          </div>
        ` : ''}
      </div>
    ` : '';

    const addUserSection = config.isOwner ? `
      <div class="sharing-section">
        <div class="sharing-section-title">Add Collaborator</div>
        <div class="user-search-container">
          <input class="user-search-input" id="user-search" type="text" placeholder="Search by name or email..." value="${escapeAttr(searchQuery)}" autocomplete="off" />
          ${showDropdown ? renderSearchDropdown() : ''}
        </div>
      </div>
    ` : '';

    const collabList = collaborators.length > 0 ? `
      <div class="sharing-section">
        <div class="sharing-section-title">Collaborators</div>
        <div class="collaborator-list">
          ${collaborators.map(c => `
            <div class="collaborator-item" data-user-id="${c.user_id}">
              ${c.image_url
                ? `<img class="collaborator-avatar" src="${escapeAttr(c.image_url)}" alt="" />`
                : `<div class="collaborator-avatar-placeholder">${getInitials(c.name)}</div>`
              }
              <div class="collaborator-info">
                <div class="collaborator-name">${escapeHtml(c.name || c.user_id)}</div>
                <div class="collaborator-role">${c.role === 'owner' ? 'Owner' : 'Collaborator'}${c.email ? ` · ${escapeHtml(c.email)}` : ''}</div>
              </div>
              ${c.role !== 'owner' ? (config.isOwner
                ? `<button class="collaborator-remove" data-remove="${c.user_id}">Remove</button>`
                : `<button class="collaborator-remove" data-remove="${c.user_id}">Leave</button>`
              ) : ''}
            </div>
          `).join('')}
        </div>
      </div>
    ` : '';

    container.innerHTML = linkSection + addUserSection + collabList;

    // Wire events
    const linkToggle = container.querySelector('#link-toggle');
    if (linkToggle) {
      linkToggle.addEventListener('click', async () => {
        linkSharingEnabled = !linkSharingEnabled;
        render();
        try {
          await updateLinkSharing(config.boardId, linkSharingEnabled);
        } catch {
          linkSharingEnabled = !linkSharingEnabled;
          render();
        }
      });
    }

    const copyBtn = container.querySelector('#copy-link-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(getBoardUrl()).then(() => {
          (copyBtn as HTMLElement).textContent = 'Copied!';
          setTimeout(() => { (copyBtn as HTMLElement).textContent = 'Copy'; }, 2000);
        });
      });
    }

    const searchInput = container.querySelector('#user-search') as HTMLInputElement | null;
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        searchQuery = searchInput.value;
        if (searchTimeout) clearTimeout(searchTimeout);
        if (searchQuery.length < 2) {
          showDropdown = false;
          searchResults = [];
          render();
          return;
        }
        searchTimeout = setTimeout(async () => {
          try {
            searchResults = await searchUsers(searchQuery) as SearchUser[];
            // Filter out users already in collaborator list
            const existingIds = new Set(collaborators.map(c => c.user_id));
            searchResults = searchResults.filter(u => !existingIds.has(u.id));
            showDropdown = true;
          } catch {
            searchResults = [];
            showDropdown = true;
          }
          render();
          // Re-focus and restore cursor
          const newInput = container.querySelector('#user-search') as HTMLInputElement | null;
          if (newInput) {
            newInput.focus();
            newInput.setSelectionRange(searchQuery.length, searchQuery.length);
          }
        }, 300);
      });

      searchInput.addEventListener('blur', () => {
        // Delay to allow click on dropdown item
        setTimeout(() => {
          showDropdown = false;
          render();
        }, 200);
      });
    }

    // Add collaborator from search results
    container.querySelectorAll('.user-search-item').forEach(item => {
      item.addEventListener('click', async () => {
        const userId = (item as HTMLElement).dataset.userId!;
        showDropdown = false;
        searchQuery = '';
        searchResults = [];
        try {
          await addCollaborator(config.boardId, userId);
          await loadData();
        } catch (err) {
          console.error('Add collaborator failed:', err);
          render();
        }
      });
    });

    // Remove collaborator
    container.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const userId = (btn as HTMLElement).dataset.remove!;
        try {
          await removeCollaborator(config.boardId, userId);
          collaborators = collaborators.filter(c => c.user_id !== userId);
          render();
        } catch (err) {
          console.error('Remove collaborator failed:', err);
        }
      });
    });
  }

  function renderSearchDropdown(): string {
    if (searchResults.length === 0) {
      return `<div class="user-search-dropdown"><div class="user-search-empty">No users found</div></div>`;
    }
    return `
      <div class="user-search-dropdown">
        ${searchResults.map(u => `
          <button class="user-search-item" data-user-id="${u.id}">
            ${u.image_url
              ? `<img class="user-search-avatar" src="${escapeAttr(u.image_url)}" alt="" />`
              : `<div class="user-search-avatar" style="display:flex;align-items:center;justify-content:center;font-size:0.7rem;font-weight:700;color:var(--color-primary)">${getInitials(u.name)}</div>`
            }
            <div>
              <div class="user-search-name">${escapeHtml(u.name)}</div>
              <div class="user-search-email">${escapeHtml(u.email)}</div>
            </div>
          </button>
        `).join('')}
      </div>
    `;
  }

  loadData();
}

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
