import type { BoardObject } from '../types.js';
import { Camera } from './Camera.js';
import { getSelectionBounds } from './Geometry.js';

export class SelectionToolbar {
  private container: HTMLElement;
  private camera: Camera;
  private getSelectedObjects: () => BoardObject[];
  private el: HTMLDivElement;
  private swatchBtn: HTMLButtonElement;
  private onSwatchClick: (() => void) | null = null;
  private _raf: number | null = null;

  constructor(
    container: HTMLElement,
    camera: Camera,
    getSelectedObjects: () => BoardObject[],
  ) {
    this.container = container;
    this.camera = camera;
    this.getSelectedObjects = getSelectedObjects;

    this.el = document.createElement('div');
    this.el.className = 'selection-toolbar';
    this.el.style.display = 'none';

    this.swatchBtn = document.createElement('button');
    this.swatchBtn.className = 'color-swatch-btn';
    this.swatchBtn.title = 'Change color';
    this.swatchBtn.setAttribute('aria-label', 'Change color');
    this.el.appendChild(this.swatchBtn);

    this.swatchBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onSwatchClick?.();
    });

    container.appendChild(this.el);
    this._startPositionLoop();
  }

  setOnSwatchClick(fn: () => void): void {
    this.onSwatchClick = fn;
  }

  update(_ids: string[], isTextEditing: boolean): void {
    const objects = this.getSelectedObjects();

    // Hide for empty selection, connector-only, or text editing
    const colorable = objects.filter((o) => o.type !== 'connector' && o.type !== 'frame');
    if (!colorable.length || isTextEditing) {
      this.el.style.display = 'none';
      return;
    }

    // Show current color on swatch
    const firstColor = (colorable[0] as { color?: string }).color || '#ffffff';
    const allSame = colorable.every((o) => (o as { color?: string }).color === firstColor);
    if (allSame) {
      this.swatchBtn.style.background = this._resolveDisplayColor(firstColor);
      this.swatchBtn.classList.remove('mixed');
    } else {
      this.swatchBtn.style.background = 'conic-gradient(#bfdbfe, #fecdd3, #bbf7d0, #e9d5ff, #bfdbfe)';
      this.swatchBtn.classList.add('mixed');
    }

    this.el.style.display = '';
    this._reposition();
  }

  hide(): void {
    this.el.style.display = 'none';
  }

  getSwatchButton(): HTMLButtonElement {
    return this.swatchBtn;
  }

  getActiveColor(): string | null {
    const objects = this.getSelectedObjects().filter((o) => o.type !== 'connector' && o.type !== 'frame');
    if (!objects.length) return null;
    const first = (objects[0] as { color?: string }).color || '#ffffff';
    const allSame = objects.every((o) => (o as { color?: string }).color === first);
    return allSame ? first : null;
  }

  destroy(): void {
    if (this._raf) cancelAnimationFrame(this._raf);
    this.el.remove();
  }

  private _startPositionLoop(): void {
    const tick = () => {
      this._raf = requestAnimationFrame(tick);
      if (this.el.style.display === 'none') return;
      this._reposition();
    };
    this._raf = requestAnimationFrame(tick);
  }

  private _reposition(): void {
    const objects = this.getSelectedObjects().filter((o) => o.type !== 'connector' && o.type !== 'frame');
    if (!objects.length) return;

    const bounds = getSelectionBounds(objects);
    if (!bounds) return;

    const topCenter = this.camera.worldToScreen(
      bounds.x + bounds.width / 2,
      bounds.y,
    );

    const containerRect = this.container.getBoundingClientRect();
    let left = topCenter.x;
    let top = topCenter.y - 48;

    // Clamp to viewport
    const elW = this.el.offsetWidth || 40;
    left = Math.max(elW / 2 + 4, Math.min(containerRect.width - elW / 2 - 4, left));
    top = Math.max(4, top);

    this.el.style.left = `${left}px`;
    this.el.style.top = `${top}px`;
  }

  private _resolveDisplayColor(color: string): string {
    // Named sticky colors — map to hex for display
    const PALETTE: Record<string, string> = {
      yellow: '#fef08a', blue: '#bfdbfe', green: '#bbf7d0', pink: '#fecdd3',
      purple: '#e9d5ff', orange: '#fed7aa', red: '#fecaca', teal: '#99f6e4',
      black: '#000000',
    };
    return PALETTE[color] || color;
  }
}
