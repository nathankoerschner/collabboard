export interface ColorEntry {
  name: string;
  value: string; // the value passed to onSelect (named string for stickies, hex for shapes)
  hex: string;   // display hex
}

export class ColorPicker {
  private container: HTMLElement;
  private el: HTMLDivElement;
  private onSelect: (color: string) => void;
  private colors: ColorEntry[] = [];
  private activeColor: string | null = null;

  constructor(opts: {
    container: HTMLElement;
    onSelect: (color: string) => void;
  }) {
    this.container = opts.container;
    this.onSelect = opts.onSelect;

    this.el = document.createElement('div');
    this.el.className = 'color-picker-popover';
    this.el.style.display = 'none';

    this.el.addEventListener('click', (e) => {
      e.stopPropagation();
      const swatch = (e.target as HTMLElement).closest('[data-color]') as HTMLElement | null;
      if (!swatch) return;
      const color = swatch.dataset.color!;
      this.onSelect(color);
      this.close();
    });

    this.container.appendChild(this.el);
  }

  open(anchorEl: HTMLElement, colors: ColorEntry[], activeColor: string | null): void {
    this.colors = colors;
    this.activeColor = activeColor;
    this._render();

    const anchorRect = anchorEl.getBoundingClientRect();
    const containerRect = this.container.getBoundingClientRect();

    let left = anchorRect.left - containerRect.left + anchorRect.width / 2;
    let top = anchorRect.bottom - containerRect.top + 6;

    this.el.style.display = '';

    // Clamp horizontally
    const elW = this.el.offsetWidth || 160;
    left = Math.max(elW / 2 + 4, Math.min(containerRect.width - elW / 2 - 4, left));

    // Flip above if near bottom
    const elH = this.el.offsetHeight || 100;
    if (top + elH > containerRect.height - 8) {
      top = anchorRect.top - containerRect.top - elH - 6;
    }

    this.el.style.left = `${left}px`;
    this.el.style.top = `${top}px`;
  }

  close(): void {
    this.el.style.display = 'none';
  }

  isOpen(): boolean {
    return this.el.style.display !== 'none';
  }

  destroy(): void {
    this.el.remove();
  }

  private _render(): void {
    this.el.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'color-picker-grid';

    for (const entry of this.colors) {
      const swatch = document.createElement('button');
      swatch.className = 'swatch';
      swatch.dataset.color = entry.value;
      swatch.title = entry.name;
      swatch.setAttribute('aria-label', entry.name);
      swatch.style.background = entry.hex;

      if (entry.hex === '#ffffff' || entry.hex === '#e5e7eb') {
        swatch.classList.add('light');
      }

      if (this.activeColor === entry.value) {
        swatch.classList.add('active');
      }

      grid.appendChild(swatch);
    }

    this.el.appendChild(grid);
  }
}

// ── Palette definitions ──

export const STICKY_COLORS: ColorEntry[] = [
  { name: 'Yellow',  value: 'yellow',  hex: '#fef08a' },
  { name: 'Blue',    value: 'blue',    hex: '#bfdbfe' },
  { name: 'Green',   value: 'green',   hex: '#bbf7d0' },
  { name: 'Pink',    value: 'pink',    hex: '#fecdd3' },
  { name: 'Purple',  value: 'purple',  hex: '#e9d5ff' },
  { name: 'Orange',  value: 'orange',  hex: '#fed7aa' },
  { name: 'Red',     value: 'red',     hex: '#fecaca' },
  { name: 'Teal',    value: 'teal',    hex: '#99f6e4' },
  { name: 'Gray',    value: 'gray',    hex: '#e5e7eb' },
  { name: 'White',   value: 'white',   hex: '#ffffff' },
];

export const SHAPE_COLORS: ColorEntry[] = [
  // Pastel row
  { name: 'Blue',    value: '#bfdbfe', hex: '#bfdbfe' },
  { name: 'Green',   value: '#bbf7d0', hex: '#bbf7d0' },
  { name: 'Pink',    value: '#fecdd3', hex: '#fecdd3' },
  { name: 'Purple',  value: '#e9d5ff', hex: '#e9d5ff' },
  { name: 'Orange',  value: '#fed7aa', hex: '#fed7aa' },
  { name: 'Red',     value: '#fecaca', hex: '#fecaca' },
  { name: 'Teal',    value: '#99f6e4', hex: '#99f6e4' },
  { name: 'Gray',    value: '#e5e7eb', hex: '#e5e7eb' },
  { name: 'White',   value: '#ffffff', hex: '#ffffff' },
  { name: 'Yellow',  value: '#fef08a', hex: '#fef08a' },
  // Saturated row
  { name: 'Blue (bold)',    value: '#3b82f6', hex: '#3b82f6' },
  { name: 'Green (bold)',   value: '#22c55e', hex: '#22c55e' },
  { name: 'Pink (bold)',    value: '#f43f5e', hex: '#f43f5e' },
  { name: 'Purple (bold)',  value: '#a855f7', hex: '#a855f7' },
  { name: 'Orange (bold)',  value: '#f97316', hex: '#f97316' },
  { name: 'Red (bold)',     value: '#ef4444', hex: '#ef4444' },
  { name: 'Teal (bold)',    value: '#14b8a6', hex: '#14b8a6' },
  { name: 'Gray (bold)',    value: '#6b7280', hex: '#6b7280' },
  { name: 'Slate',          value: '#475569', hex: '#475569' },
  { name: 'Yellow (bold)',  value: '#eab308', hex: '#eab308' },
];
