import type { ShapeKind } from '../types.js';
import { SHAPE_DEFS } from '../board/ShapeDefs.js';

interface ShapesDrawerOptions {
  anchorEl: HTMLElement;
  boardViewEl: HTMLElement;
  onSelect: (kind: ShapeKind) => void;
}

export class ShapesDrawer {
  private drawerEl: HTMLElement;
  private anchorEl: HTMLElement;
  private boardViewEl: HTMLElement;
  private open = false;

  private readonly onDocClick: (e: MouseEvent) => void;
  private readonly onDocKeydown: (e: KeyboardEvent) => void;

  constructor(opts: ShapesDrawerOptions) {
    this.anchorEl = opts.anchorEl;
    this.boardViewEl = opts.boardViewEl;

    this.drawerEl = document.createElement('div');
    this.drawerEl.className = 'shapes-drawer';
    this.drawerEl.innerHTML = `<div class="shapes-grid"></div>`;
    this.boardViewEl.appendChild(this.drawerEl);

    const grid = this.drawerEl.querySelector('.shapes-grid')!;
    for (const [kind, def] of SHAPE_DEFS) {
      const btn = document.createElement('button');
      btn.className = 'shape-icon-btn';
      btn.dataset.shapeKind = kind;
      btn.title = def.label;
      btn.innerHTML = def.icon;
      grid.appendChild(btn);
    }

    this.anchorEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });

    grid.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-shape-kind]') as HTMLElement | null;
      if (!btn) return;
      const kind = btn.dataset.shapeKind as ShapeKind;
      opts.onSelect(kind);
      this.close();
    });

    this.onDocClick = (e: MouseEvent) => {
      if (this.open && !this.drawerEl.contains(e.target as Node) && e.target !== this.anchorEl && !this.anchorEl.contains(e.target as Node)) {
        this.close();
      }
    };

    this.onDocKeydown = (e: KeyboardEvent) => {
      if (this.open && e.key === 'Escape') {
        this.close();
      }
    };

    document.addEventListener('click', this.onDocClick);
    document.addEventListener('keydown', this.onDocKeydown);
  }

  toggle(): void {
    this.setOpen(!this.open);
  }

  close(): void {
    this.setOpen(false);
  }

  private setOpen(open: boolean): void {
    this.open = open;
    this.drawerEl.classList.toggle('open', open);
    if (open) {
      const rect = this.anchorEl.getBoundingClientRect();
      const boardRect = this.boardViewEl.getBoundingClientRect();
      this.drawerEl.style.left = `${rect.left - boardRect.left + rect.width / 2}px`;
      this.drawerEl.style.top = `${rect.bottom - boardRect.top + 8}px`;
    }
  }

  destroy(): void {
    document.removeEventListener('click', this.onDocClick);
    document.removeEventListener('keydown', this.onDocKeydown);
    this.drawerEl.remove();
  }
}
