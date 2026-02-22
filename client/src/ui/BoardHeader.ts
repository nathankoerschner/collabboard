import { getBoard, renameBoard } from '../api.js';
import { openBoardOptionsModal } from '../components/boardOptionsModal.js';

interface BoardHeaderOptions {
  boardId: string;
  nameEl: HTMLElement;
  optionsBtn: HTMLElement;
  userId?: string;
}

export class BoardHeader {
  private boardId: string;
  private nameEl: HTMLElement;
  private currentName = '';
  private isOwner = false;

  constructor(opts: BoardHeaderOptions) {
    this.boardId = opts.boardId;
    this.nameEl = opts.nameEl;

    getBoard(this.boardId).then((board) => {
      const b = board as { name?: string; owner_id?: string; role?: string };
      if (b?.name) {
        this.currentName = b.name;
        this.nameEl.textContent = this.currentName;
      }
      this.isOwner = b?.role === 'owner' || b?.owner_id === opts.userId;
    }).catch(() => {});

    this.nameEl.addEventListener('click', () => this.startRename());

    opts.optionsBtn.addEventListener('click', () => {
      openBoardOptionsModal({
        boardId: this.boardId,
        boardName: this.currentName || 'Untitled Board',
        isOwner: this.isOwner,
        onRename: (newName) => {
          this.currentName = newName;
          this.nameEl.textContent = newName;
        },
        onClose: () => {},
      });
    });
  }

  private startRename(): void {
    if (!this.currentName) return;
    const input = document.createElement('input');
    input.className = 'board-name-input';
    input.value = this.currentName;
    this.nameEl.textContent = '';
    this.nameEl.appendChild(input);
    input.focus();
    input.select();

    const finish = (save: boolean) => {
      const newName = input.value.trim();
      if (save && newName && newName !== this.currentName) {
        this.currentName = newName;
        renameBoard(this.boardId, newName).catch(() => {});
      }
      this.nameEl.textContent = this.currentName;
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); finish(false); input.remove(); }
    });
    input.addEventListener('blur', () => finish(true));
  }

  destroy(): void {
    // No cleanup needed — DOM elements are removed when container is cleared
  }
}
