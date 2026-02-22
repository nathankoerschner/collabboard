import type { TableObject } from '../types.js';
import { Camera } from './Camera.js';
import { ObjectStore } from '../board/ObjectStore.js';

const DEFAULT_ROW_HEIGHT = 32;
const TITLE_HEIGHT = 28;
const CELL_FONT = '400 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const CELL_LINE_HEIGHT = 14;
const CELL_PAD_X = 6;
const CELL_PAD_Y = 4;

export class TableControls {
  private camera: Camera;
  private objectStore: ObjectStore;
  private container: HTMLElement;
  private el: HTMLDivElement;
  private _raf: number | null = null;
  private _tableId: string | null = null;

  // Cell editing state
  private _editingTableId: string | null = null;
  private _editingRowId: string | null = null;
  private _editingColId: string | null = null;
  private _cellEditor: HTMLTextAreaElement | null = null;
  private _measureCanvas: HTMLCanvasElement;

  // Title editing state
  private _editingTitleTableId: string | null = null;
  private _titleEditor: HTMLInputElement | null = null;

  constructor(container: HTMLElement, camera: Camera, objectStore: ObjectStore) {
    this.camera = camera;
    this.objectStore = objectStore;
    this.container = container;

    this.el = document.createElement('div');
    this.el.className = 'table-controls';
    this.el.style.display = 'none';
    this.el.addEventListener('mousedown', (e) => e.stopPropagation());
    container.appendChild(this.el);

    this._measureCanvas = document.createElement('canvas');

    this._startPositionLoop();
  }

  update(selectedIds: string[], isTextEditing: boolean): void {
    if (isTextEditing || selectedIds.length !== 1) {
      this._hide();
      return;
    }

    const obj = this.objectStore.getObject(selectedIds[0]!);
    if (!obj || obj.type !== 'table') {
      this._hide();
      return;
    }

    this._tableId = obj.id;
    this.el.style.display = '';
    this._rebuild();
    this._reposition();
  }

  getEditingCellKey(): string | null {
    if (!this._editingTableId || !this._editingRowId || !this._editingColId) return null;
    return `${this._editingRowId}:${this._editingColId}`;
  }

  getEditingTableId(): string | null {
    return this._editingTableId;
  }

  getEditingTitleTableId(): string | null {
    return this._editingTitleTableId;
  }

  startTitleEditing(tableId: string): void {
    this.stopTitleEditing();
    this.stopCellEditing();

    const obj = this.objectStore.getObject(tableId);
    if (!obj || obj.type !== 'table') return;
    const table = obj as TableObject;

    this._editingTitleTableId = tableId;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'table-title-editor';
    input.value = table.title || '';
    this.container.appendChild(input);
    this._titleEditor = input;

    this._positionTitleEditor();

    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });

    input.addEventListener('input', this._onTitleInput);
    input.addEventListener('blur', this._onTitleBlur);
    input.addEventListener('keydown', this._onTitleKeydown);
    input.addEventListener('mousedown', (e) => e.stopPropagation());
  }

  stopTitleEditing(): void {
    if (!this._titleEditor) return;
    this._titleEditor.removeEventListener('input', this._onTitleInput);
    this._titleEditor.removeEventListener('blur', this._onTitleBlur);
    this._titleEditor.removeEventListener('keydown', this._onTitleKeydown);
    this._titleEditor.remove();
    this._titleEditor = null;
    this._editingTitleTableId = null;
  }

  private _onTitleInput = (): void => {
    if (!this._titleEditor || !this._editingTitleTableId) return;
    this.objectStore.updateObject(this._editingTitleTableId, { title: this._titleEditor.value });
  };

  private _onTitleBlur = (): void => {
    this.stopTitleEditing();
  };

  private _onTitleKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' || e.key === 'Enter') {
      e.preventDefault();
      this._titleEditor?.blur();
    }
    e.stopPropagation();
  };

  private _positionTitleEditor(): void {
    if (!this._titleEditor || !this._editingTitleTableId) return;
    const obj = this.objectStore.getObject(this._editingTitleTableId);
    if (!obj || obj.type !== 'table') return;

    const topLeft = this.camera.worldToScreen(obj.x, obj.y);
    const topRight = this.camera.worldToScreen(obj.x + obj.width, obj.y + TITLE_HEIGHT);
    const screenW = topRight.x - topLeft.x;
    const screenH = topRight.y - topLeft.y;

    this._titleEditor.style.left = `${topLeft.x}px`;
    this._titleEditor.style.top = `${topLeft.y}px`;
    this._titleEditor.style.width = `${screenW}px`;
    this._titleEditor.style.height = `${screenH}px`;
    this._titleEditor.style.fontSize = `${12 * this.camera.scale}px`;
  }

  startCellEditing(tableId: string, rowId: string, colId: string): void {
    this.stopCellEditing();

    const obj = this.objectStore.getObject(tableId);
    if (!obj || obj.type !== 'table') return;
    const table = obj as TableObject;

    this._editingTableId = tableId;
    this._editingRowId = rowId;
    this._editingColId = colId;

    const cellKey = `${rowId}:${colId}`;
    const existingText = (table.cells || {})[cellKey] || '';

    const textarea = document.createElement('textarea');
    textarea.className = 'table-cell-editor';
    textarea.value = existingText;
    this.container.appendChild(textarea);
    this._cellEditor = textarea;

    this._positionCellEditor();

    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    });

    textarea.addEventListener('input', this._onCellInput);
    textarea.addEventListener('blur', this._onCellBlur);
    textarea.addEventListener('keydown', this._onCellKeydown);
    textarea.addEventListener('mousedown', (e) => e.stopPropagation());
  }

  stopCellEditing(): void {
    if (!this._cellEditor) return;
    this._cellEditor.removeEventListener('input', this._onCellInput);
    this._cellEditor.removeEventListener('blur', this._onCellBlur);
    this._cellEditor.removeEventListener('keydown', this._onCellKeydown);
    this._cellEditor.remove();
    this._cellEditor = null;
    this._editingTableId = null;
    this._editingRowId = null;
    this._editingColId = null;
  }

  destroy(): void {
    this.stopCellEditing();
    this.stopTitleEditing();
    if (this._raf) cancelAnimationFrame(this._raf);
    this.el.remove();
  }

  private _onCellInput = (): void => {
    if (!this._cellEditor || !this._editingTableId || !this._editingRowId || !this._editingColId) return;
    const text = this._cellEditor.value;
    this.objectStore.updateTableCell(this._editingTableId, this._editingRowId, this._editingColId, text);
    this._recalcRowHeight();
    this._positionCellEditor();
  };

  private _onCellBlur = (): void => {
    this.stopCellEditing();
  };

  private _onCellKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      this._cellEditor?.blur();
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      this._cellEditor?.blur();
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      this._advanceCell(e.shiftKey);
    }
    e.stopPropagation();
  };

  private _advanceCell(reverse: boolean): void {
    if (!this._editingTableId || !this._editingRowId || !this._editingColId) return;
    const obj = this.objectStore.getObject(this._editingTableId);
    if (!obj || obj.type !== 'table') return;
    const table = obj as TableObject;
    const cols = table.columns || [];
    const rows = table.rows || [];
    const ci = cols.indexOf(this._editingColId);
    const ri = rows.indexOf(this._editingRowId);
    if (ci === -1 || ri === -1) return;

    let nextCi = ci + (reverse ? -1 : 1);
    let nextRi = ri;
    if (nextCi >= cols.length) { nextCi = 0; nextRi++; }
    if (nextCi < 0) { nextCi = cols.length - 1; nextRi--; }
    if (nextRi >= rows.length || nextRi < 0) {
      this.stopCellEditing();
      return;
    }
    this.startCellEditing(this._editingTableId, rows[nextRi]!, cols[nextCi]!);
  }

  private _recalcRowHeight(): void {
    if (!this._editingTableId || !this._editingRowId) return;
    const obj = this.objectStore.getObject(this._editingTableId);
    if (!obj || obj.type !== 'table') return;
    const table = obj as TableObject;

    const cols = table.columns || [];
    const colWidths = table.columnWidths || {};
    const cells = table.cells || {};

    let maxHeight = DEFAULT_ROW_HEIGHT;
    for (const cid of cols) {
      const text = cells[`${this._editingRowId}:${cid}`] || '';
      if (!text) continue;
      const cw = colWidths[cid] || 120;
      const textMaxWidth = cw - CELL_PAD_X * 2;
      const lines = this._measureWrappedLines(text, textMaxWidth);
      const neededHeight = lines * CELL_LINE_HEIGHT + CELL_PAD_Y * 2;
      if (neededHeight > maxHeight) maxHeight = neededHeight;
    }

    const currentRowHeight = (table.rowHeights || {})[this._editingRowId] || DEFAULT_ROW_HEIGHT;
    if (Math.abs(maxHeight - currentRowHeight) > 1) {
      this.objectStore.updateTableRowHeight(this._editingTableId, this._editingRowId, maxHeight);
    }
  }

  private _measureWrappedLines(text: string, maxWidth: number): number {
    const mCtx = this._measureCanvas.getContext('2d')!;
    mCtx.font = CELL_FONT;
    let lines = 0;
    const paragraphs = String(text).split('\n');
    for (const para of paragraphs) {
      if (!para.length) { lines++; continue; }
      const words = para.split(/\s+/);
      let line = '';
      for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        if (mCtx.measureText(test).width > maxWidth && line) {
          lines++;
          line = word;
        } else {
          line = test;
        }
      }
      if (line) lines++;
    }
    return Math.max(1, lines);
  }

  private _positionCellEditor(): void {
    if (!this._cellEditor || !this._editingTableId || !this._editingRowId || !this._editingColId) return;
    const obj = this.objectStore.getObject(this._editingTableId);
    if (!obj || obj.type !== 'table') return;
    const table = obj as TableObject;

    const cols = table.columns || [];
    const rows = table.rows || [];
    const colWidths = table.columnWidths || {};
    const rowHeights = table.rowHeights || {};

    let cellWx = obj.x;
    for (const cid of cols) {
      if (cid === this._editingColId) break;
      cellWx += colWidths[cid] || 120;
    }
    let cellWy = obj.y + TITLE_HEIGHT;
    for (const rid of rows) {
      if (rid === this._editingRowId) break;
      cellWy += rowHeights[rid] || DEFAULT_ROW_HEIGHT;
    }
    const cellW = colWidths[this._editingColId] || 120;
    const cellH = rowHeights[this._editingRowId] || DEFAULT_ROW_HEIGHT;

    const topLeft = this.camera.worldToScreen(cellWx, cellWy);
    const bottomRight = this.camera.worldToScreen(cellWx + cellW, cellWy + cellH);
    const screenW = bottomRight.x - topLeft.x;
    const screenH = bottomRight.y - topLeft.y;

    this._cellEditor.style.left = `${topLeft.x}px`;
    this._cellEditor.style.top = `${topLeft.y}px`;
    this._cellEditor.style.width = `${screenW}px`;
    this._cellEditor.style.height = `${screenH}px`;
    this._cellEditor.style.fontSize = `${11 * this.camera.scale}px`;
  }

  private _hide(): void {
    this._tableId = null;
    this.el.style.display = 'none';
  }

  private _rebuild(): void {
    if (!this._tableId) return;
    const obj = this.objectStore.getObject(this._tableId);
    if (!obj || obj.type !== 'table') return;
    const table = obj as TableObject;

    this.el.innerHTML = '';

    // Add column button (right edge)
    const addCol = this._btn('+', 'table-add-btn table-add-col');
    addCol.title = 'Add column';
    addCol.addEventListener('click', (e) => {
      e.stopPropagation();
      this.objectStore.addTableColumn(this._tableId!);
      this._rebuild();
      this._reposition();
    });
    this.el.appendChild(addCol);

    // Add row button (bottom edge)
    const addRow = this._btn('+', 'table-add-btn table-add-row');
    addRow.title = 'Add row';
    addRow.addEventListener('click', (e) => {
      e.stopPropagation();
      this.objectStore.addTableRow(this._tableId!);
      this._rebuild();
      this._reposition();
    });
    this.el.appendChild(addRow);

    // Delete column buttons (above each column)
    if (table.columns.length > 1) {
      for (const colId of table.columns) {
        const del = this._btn('\u00d7', 'table-delete-btn table-delete-col');
        del.title = 'Delete column';
        del.dataset.colId = colId;
        del.addEventListener('click', (e) => {
          e.stopPropagation();
          this.objectStore.deleteTableColumn(this._tableId!, colId);
          this._rebuild();
          this._reposition();
        });
        this.el.appendChild(del);
      }
    }

    // Delete row buttons (left of each row)
    if (table.rows.length > 1) {
      for (const rowId of table.rows) {
        const del = this._btn('\u00d7', 'table-delete-btn table-delete-row');
        del.title = 'Delete row';
        del.dataset.rowId = rowId;
        del.addEventListener('click', (e) => {
          e.stopPropagation();
          this.objectStore.deleteTableRow(this._tableId!, rowId);
          this._rebuild();
          this._reposition();
        });
        this.el.appendChild(del);
      }
    }
  }

  private _btn(label: string, className: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = className;
    btn.textContent = label;
    return btn;
  }

  private _startPositionLoop(): void {
    const tick = () => {
      this._raf = requestAnimationFrame(tick);
      if (this.el.style.display === 'none' && !this._cellEditor && !this._titleEditor) return;
      this._reposition();
      if (this._cellEditor) this._positionCellEditor();
      if (this._titleEditor) this._positionTitleEditor();
    };
    this._raf = requestAnimationFrame(tick);
  }

  private _reposition(): void {
    if (!this._tableId) return;
    const obj = this.objectStore.getObject(this._tableId);
    if (!obj || obj.type !== 'table') return;
    const table = obj as TableObject;

    const cols = table.columns || [];
    const rows = table.rows || [];
    const colWidths = table.columnWidths || {};
    const rowHeights = table.rowHeights || {};

    // Add column button: right edge, vertically centered in grid area
    const addCol = this.el.querySelector('.table-add-col') as HTMLElement | null;
    if (addCol) {
      const pos = this.camera.worldToScreen(obj.x + obj.width, obj.y + TITLE_HEIGHT + (obj.height - TITLE_HEIGHT) / 2);
      addCol.style.left = `${pos.x + 8}px`;
      addCol.style.top = `${pos.y}px`;
    }

    // Add row button: bottom edge, horizontally centered
    const addRow = this.el.querySelector('.table-add-row') as HTMLElement | null;
    if (addRow) {
      const pos = this.camera.worldToScreen(obj.x + obj.width / 2, obj.y + obj.height);
      addRow.style.left = `${pos.x}px`;
      addRow.style.top = `${pos.y + 8}px`;
    }

    // Delete column buttons: above each column header, centered in column
    const delCols = this.el.querySelectorAll('.table-delete-col') as NodeListOf<HTMLElement>;
    let cx = obj.x;
    for (const el of delCols) {
      const cId = el.dataset.colId!;
      const cw = colWidths[cId] || (obj.width / cols.length);
      const pos = this.camera.worldToScreen(cx + cw / 2, obj.y);
      el.style.left = `${pos.x}px`;
      el.style.top = `${pos.y - 16}px`;
      cx += cw;
    }

    // Delete row buttons: left of each row, vertically centered in row
    const delRows = this.el.querySelectorAll('.table-delete-row') as NodeListOf<HTMLElement>;
    let rowY = obj.y + TITLE_HEIGHT;
    let rowIdx = 0;
    for (const el of delRows) {
      const rh = rowHeights[rows[rowIdx]!] || DEFAULT_ROW_HEIGHT;
      const ry = rowY + rh / 2;
      const pos = this.camera.worldToScreen(obj.x, ry);
      el.style.left = `${pos.x - 16}px`;
      el.style.top = `${pos.y}px`;
      rowY += rh;
      rowIdx++;
    }
  }
}
