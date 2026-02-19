import type { BoardObject, TextEditorCallbacks, TextStyle } from '../types.js';
import { Camera } from './Camera.js';

export class TextEditor {
  canvasEl: HTMLCanvasElement;
  camera: Camera;
  callbacks: TextEditorCallbacks;
  input: HTMLTextAreaElement | null = null;
  toolbar: HTMLDivElement | null = null;
  editingId: string | null = null;
  editingType: string | null = null;
  private readonly _onBeforeUnload: () => void;
  private readonly _onPageHide: () => void;

  constructor(canvasEl: HTMLCanvasElement, camera: Camera, callbacks: TextEditorCallbacks) {
    this.canvasEl = canvasEl;
    this.camera = camera;
    this.callbacks = callbacks;
    this._onBeforeUnload = this.flushActiveEdit.bind(this);
    this._onPageHide = this.flushActiveEdit.bind(this);
    window.addEventListener('beforeunload', this._onBeforeUnload);
    window.addEventListener('pagehide', this._onPageHide);
  }

  startEditing(obj: BoardObject): void {
    if (!obj) return;
    if (this.editingId === obj.id && this.input) return;

    this.stopEditing();
    this.editingId = obj.id;
    this.editingType = obj.type;

    const input = document.createElement('textarea');
    input.className = 'text-editor-overlay';
    input.value = obj.type === 'text' ? (obj.content || '') : (obj.type === 'sticky' ? (obj.text || '') : '');

    this._positionInput(input, obj);

    input.addEventListener('input', () => {
      this.callbacks.onTextChange?.(this.editingId!, input.value);
      this._autoGrow(input);
    });
    input.addEventListener('beforeinput', (e) => {
      const predicted = this._predictBeforeInputValue(input, e);
      if (predicted == null) return;
      this.callbacks.onTextChange?.(this.editingId!, predicted);
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

    this.canvasEl.parentElement!.appendChild(input);
    this.input = input;

    if (obj.type === 'text') {
      this.toolbar = this._buildTextToolbar(obj);
      this.canvasEl.parentElement!.appendChild(this.toolbar);
      this._positionToolbar(this.toolbar, obj);
    }

    input.focus();
    const length = input.value.length;
    input.setSelectionRange(length, length);
  }

  stopEditing(): void {
    const wasEditing = !!this.editingId;
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
    if (wasEditing) {
      this.callbacks.onEditEnd?.();
    }
  }

  getEditingId(): string | null {
    return this.editingId;
  }

  updatePosition(obj: BoardObject): void {
    if (this.input && this.editingId === obj.id) {
      this._positionInput(this.input, obj);
      if (this.toolbar) this._positionToolbar(this.toolbar, obj);
    }
  }

  _buildTextToolbar(obj: BoardObject): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.className = 'text-editor-toolbar';

    const btn = (label: string, onClick: () => void, active = false): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `text-editor-toolbar-btn${active ? ' active' : ''}`;
      b.textContent = label;
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', onClick);
      return b;
    };

    const textObj = obj as import('../types.js').TextObject;
    const defaults: TextStyle = { bold: false, italic: false, size: 'medium' };
    const current: TextStyle = Object.assign(defaults, textObj.style || {});
    const state: TextStyle = { ...current };
    const emit = (patch: Partial<TextStyle>) => this.callbacks.onTextStyleChange?.(obj.id, patch);

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
      state.size = size.value as import('../types.js').TextSize;
      emit({ size: state.size });
    });
    wrap.appendChild(size);

    return wrap;
  }

  _positionInput(input: HTMLTextAreaElement, obj: BoardObject): void {
    const scale = this.camera.scale;
    const innerW = Math.max(20, (obj.width - 20) * scale);
    const innerH = Math.max(20, (obj.height - 20) * scale);
    const fontSize = 14 * scale;
    const lineHeight = 18 * scale;
    const firstLineOffset = this._firstLineOffset(fontSize, lineHeight, scale);

    // Position from object center so rotation pivots correctly
    const cx = obj.x + obj.width / 2;
    const cy = obj.y + obj.height / 2;
    const { x: scx, y: scy } = this.camera.worldToScreen(cx, cy);

    input.style.position = 'absolute';
    input.style.left = `${scx - innerW / 2}px`;
    input.style.top = `${scy - innerH / 2 - firstLineOffset}px`;
    input.style.width = `${innerW}px`;
    input.style.height = `${innerH + firstLineOffset}px`;
    input.style.transform = `rotate(${obj.rotation || 0}deg)`;
    input.style.fontSize = `${fontSize}px`;
    input.style.lineHeight = `${lineHeight}px`;
    input.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    input.style.border = 'none';
    input.style.outline = 'none';
    input.style.background = 'transparent';
    input.style.appearance = 'none';
    input.style.resize = 'none';
    input.style.overflow = 'hidden';
    input.style.padding = '0';
    input.style.margin = '0';
    input.style.overflowWrap = 'break-word';
    input.style.whiteSpace = 'pre-wrap';
    input.style.zIndex = '40';
    input.style.color = '#1a1a2e';
    input.style.borderRadius = '0';
  }

  _positionToolbar(toolbar: HTMLDivElement, obj: BoardObject): void {
    const cx = obj.x + obj.width / 2;
    const cy = obj.y + obj.height / 2;
    const { x: scx, y: scy } = this.camera.worldToScreen(cx, cy);
    const halfH = (obj.height / 2) * this.camera.scale;
    toolbar.style.left = `${scx}px`;
    toolbar.style.top = `${scy - halfH - 38}px`;
    toolbar.style.transform = 'translateX(-50%)';
  }

  destroy(): void {
    this.flushActiveEdit();
    window.removeEventListener('beforeunload', this._onBeforeUnload);
    window.removeEventListener('pagehide', this._onPageHide);
    this.stopEditing();
  }

  private _autoGrow(input: HTMLTextAreaElement): void {
    if (!this.editingId) return;
    const scale = this.camera.scale;
    const padding = 20; // matches the 10px inset on each side in world coords
    const fontSize = parseFloat(input.style.fontSize) || (14 * scale);
    const lineHeight = parseFloat(input.style.lineHeight) || (18 * scale);
    const firstLineOffset = this._firstLineOffset(fontSize, lineHeight, scale);
    // Temporarily shrink to measure true scrollHeight
    input.style.height = '0';
    const neededH = input.scrollHeight / scale + padding;
    input.style.height = `${Math.max(20, (neededH - padding) * scale) + firstLineOffset}px`;
    this.callbacks.onResize?.(this.editingId, 0, neededH);
  }

  private _firstLineOffset(fontSize: number, lineHeight: number, scale: number): number {
    const leadingOffset = Math.max(0, (lineHeight - fontSize) / 2);
    const intrinsicTextareaInset = 0.5 * scale;
    return leadingOffset + intrinsicTextareaInset;
  }

  private flushActiveEdit(): void {
    if (!this.input || !this.editingId) return;
    this.callbacks.onTextChange?.(this.editingId, this.input.value);
  }

  private _predictBeforeInputValue(input: HTMLTextAreaElement, event: InputEvent): string | null {
    const current = input.value;
    const start = input.selectionStart ?? current.length;
    const end = input.selectionEnd ?? start;
    const replace = (text: string): string => `${current.slice(0, start)}${text}${current.slice(end)}`;

    switch (event.inputType) {
      case 'insertText':
      case 'insertCompositionText':
      case 'insertFromPaste':
      case 'insertFromDrop':
      case 'insertReplacementText':
        return replace(event.data || '');
      case 'insertLineBreak':
      case 'insertParagraph':
        return replace('\n');
      case 'deleteContentBackward':
        if (start !== end) return replace('');
        if (start <= 0) return current;
        return `${current.slice(0, start - 1)}${current.slice(end)}`;
      case 'deleteContentForward':
        if (start !== end) return replace('');
        if (start >= current.length) return current;
        return `${current.slice(0, start)}${current.slice(start + 1)}`;
      default:
        return null;
    }
  }
}
