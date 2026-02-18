export class TextEditor {
  constructor(canvasEl, camera, callbacks) {
    this.canvasEl = canvasEl;
    this.camera = camera;
    this.callbacks = callbacks;
    this.input = null;
    this.toolbar = null;
    this.editingId = null;
    this.editingType = null;
  }

  startEditing(obj) {
    if (!obj) return;

    this.stopEditing();
    this.editingId = obj.id;
    this.editingType = obj.type;

    const input = document.createElement('textarea');
    input.className = 'text-editor-overlay';
    input.value = obj.type === 'text' ? (obj.content || '') : (obj.text || '');

    this._positionInput(input, obj);

    input.addEventListener('input', () => {
      this.callbacks.onTextChange?.(this.editingId, input.value);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.metaKey) {
        e.preventDefault();
        this.stopEditing();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        this.stopEditing();
      }
    });

    input.addEventListener('blur', () => {
      setTimeout(() => this.stopEditing(), 100);
    });

    this.canvasEl.parentElement.appendChild(input);
    this.input = input;

    if (obj.type === 'text') {
      this.toolbar = this._buildTextToolbar(obj);
      this.canvasEl.parentElement.appendChild(this.toolbar);
      this._positionToolbar(this.toolbar, obj);
    }

    input.focus();
    input.select();
  }

  stopEditing() {
    if (this.input) {
      this.input.remove();
      this.input = null;
    }
    if (this.toolbar) {
      this.toolbar.remove();
      this.toolbar = null;
    }
    this.editingId = null;
    this.editingType = null;
  }

  getEditingId() {
    return this.editingId;
  }

  updatePosition(obj) {
    if (this.input && this.editingId === obj.id) {
      this._positionInput(this.input, obj);
      if (this.toolbar) this._positionToolbar(this.toolbar, obj);
    }
  }

  _buildTextToolbar(obj) {
    const wrap = document.createElement('div');
    wrap.className = 'text-editor-toolbar';

    const btn = (label, onClick, active = false) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `text-editor-toolbar-btn${active ? ' active' : ''}`;
      b.textContent = label;
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', onClick);
      return b;
    };

    const current = { bold: false, italic: false, size: 'medium', ...(obj.style || {}) };
    const state = { ...current };
    const emit = (patch) => this.callbacks.onTextStyleChange?.(obj.id, patch);

    const boldBtn = btn('B', () => {
      state.bold = !state.bold;
      boldBtn.classList.toggle('active', state.bold);
      emit({ bold: state.bold });
    }, !!current.bold);
    wrap.appendChild(boldBtn);

    const italicBtn = btn('I', () => {
      state.italic = !state.italic;
      italicBtn.classList.toggle('active', state.italic);
      emit({ italic: state.italic });
    }, !!current.italic);
    wrap.appendChild(italicBtn);

    const size = document.createElement('select');
    size.className = 'text-editor-toolbar-select';
    size.innerHTML = `
      <option value="small">Small</option>
      <option value="medium">Medium</option>
      <option value="large">Large</option>
    `;
    size.value = current.size || 'medium';
    size.addEventListener('change', () => {
      state.size = size.value;
      emit({ size: state.size });
    });
    wrap.appendChild(size);

    return wrap;
  }

  _positionInput(input, obj) {
    const { x: sx, y: sy } = this.camera.worldToScreen(obj.x, obj.y);
    const scale = this.camera.scale;

    input.style.position = 'absolute';
    input.style.left = `${sx + 6 * scale}px`;
    input.style.top = `${sy + 6 * scale}px`;
    input.style.width = `${Math.max(20, (obj.width - 12) * scale)}px`;
    input.style.height = `${Math.max(20, (obj.height - 12) * scale)}px`;
    input.style.fontSize = `${14 * scale}px`;
    input.style.lineHeight = `${18 * scale}px`;
    input.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    input.style.border = 'none';
    input.style.outline = 'none';
    input.style.background = 'rgba(255,255,255,0.8)';
    input.style.resize = 'none';
    input.style.overflow = 'hidden';
    input.style.padding = '0';
    input.style.margin = '0';
    input.style.wordWrap = 'break-word';
    input.style.whiteSpace = 'pre-wrap';
    input.style.zIndex = '40';
    input.style.color = '#0f172a';
    input.style.borderRadius = '4px';
  }

  _positionToolbar(toolbar, obj) {
    const { x: sx, y: sy } = this.camera.worldToScreen(obj.x, obj.y);
    toolbar.style.left = `${sx}px`;
    toolbar.style.top = `${sy - 38}px`;
  }

  destroy() {
    this.stopEditing();
  }
}
