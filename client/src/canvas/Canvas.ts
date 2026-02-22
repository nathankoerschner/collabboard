import type { BoardObject, CanvasCallbacks, RevealEntry, RevealState, ShapeKind, ToolName } from '../types.js';
import { Camera } from './Camera.js';
import { copySelection, pasteClipboard, duplicateSelection } from './Clipboard.js';
import { pointInObject } from './Geometry.js';
import { Renderer } from './Renderer.js';
import { InputHandler } from './InputHandler.js';
import { TextEditor } from './TextEditor.js';
import { ObjectStore } from '../board/ObjectStore.js';
import { UndoRedoManager } from '../board/UndoRedoManager.js';
import { CursorManager } from '../board/CursorManager.js';
import { SHAPE_DEFS } from '../board/ShapeDefs.js';

export class Canvas {
  canvasEl: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  camera: Camera;
  objectStore: ObjectStore;
  cursorManager: CursorManager | null;
  callbacks: CanvasCallbacks;
  selectedIds: string[] = [];
  animFrameId: number | null = null;
  aiRevealMap = new Map<string, RevealEntry>();
  seenObjectIds = new Set<string>();
  reduceMotion: boolean;
  renderer: Renderer;
  textEditor: TextEditor;
  inputHandler: InputHandler;
  undoRedoManager!: UndoRedoManager;
  resizeObserver: ResizeObserver;

  constructor(canvasEl: HTMLCanvasElement, objectStore: ObjectStore, cursorManager: CursorManager | null, callbacks: CanvasCallbacks = {}) {
    this.canvasEl = canvasEl;
    this.ctx = canvasEl.getContext('2d')!;
    this.camera = new Camera();
    this.objectStore = objectStore;
    this.cursorManager = cursorManager;
    this.callbacks = callbacks;
    this.reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.undoRedoManager = new UndoRedoManager(objectStore);
    this.renderer = new Renderer(this.objectStore.getPalette());

    this.textEditor = new TextEditor(canvasEl, this.camera, {
      onTextChange: (id, text) => {
        this.objectStore.withOrigin('text-edit', () => this.objectStore.updateText(id, text));
      },
      onTextStyleChange: (id, patch) => {
        this.objectStore.withOrigin('text-edit', () => this.objectStore.updateTextStyle(id, patch));
      },
      onResize: (id, _w, h) => {
        const obj = this.objectStore.getObject(id);
        if (!obj) return;
        if (h > obj.height) {
          this.objectStore.withOrigin('text-edit', () => this.objectStore.resizeObject(id, obj.x, obj.y, obj.width, h));
        }
      },
      onEditEnd: () => {
        this.objectStore.transactionOrigin = 'local';
        this.undoRedoManager.stopCapturing();
      },
    });

    this.inputHandler = new InputHandler(canvasEl, this.camera, () => this.objectStore.getAll(), {
      onSelectionChange: (ids) => {
        this.selectedIds = ids;
        this.inputHandler.setSelection(ids);
        this.callbacks.onSelectionChange?.(ids);
      },
      onMoveSelection: (ids, dx, dy) => {
        this.objectStore.withOrigin('gesture', () => this.objectStore.moveObjects(ids, dx, dy));
      },
      onResizeObject: (id, x, y, w, h) => {
        this.objectStore.withOrigin('gesture', () => this.objectStore.resizeObject(id, x, y, w, h));
      },
      onRotateSelection: (ids, delta, pivot) => {
        this.objectStore.withOrigin('gesture', () => this.objectStore.rotateObjects(ids, delta, pivot));
      },
      onCreate: (type, x, y, w, h, extra) => {
        const obj = this.objectStore.createObject(type, x, y, w, h, extra || {});
        this.selectedIds = [obj.id];
        if (type === 'sticky' || type === 'text') {
          setTimeout(() => {
            if (this.textEditor.getEditingId()) return;
            this.textEditor.startEditing(obj);
          }, 30);
        }
        this.inputHandler.setSelection(this.selectedIds);
        return obj;
      },
      onDeleteSelection: (ids) => {
        if (ids.includes(this.textEditor.getEditingId()!)) {
          this.textEditor.stopEditing();
        }
        this.objectStore.deleteObjects(ids);
        this.selectedIds = [];
        this.inputHandler.setSelection([]);
      },
      onCopySelection: (ids) => this.copySelection(ids),
      onPaste: () => this.pasteClipboard(),
      onDuplicateSelection: (ids) => this.duplicateSelection(ids),
      onToolAutoReset: (tool) => {
        this.setTool(tool);
        this.callbacks.onToolChange?.(tool);
      },
      onEditObject: (id) => {
        const obj = this.objectStore.getObject(id);
        if (obj && (obj.type === 'sticky' || obj.type === 'text')) {
          this.textEditor.startEditing(obj);
        }
      },
      onBringToFront: (id) => this.objectStore.bringToFront(id),
      onCursorMove: (wx, wy) => this.cursorManager?.sendCursor(wx, wy),
      onStartConnector: (wx, wy, attach) => {
        this.objectStore.transactionOrigin = 'gesture';
        const conn = this.objectStore.startConnector(wx, wy);

        if (attach) {
          this.objectStore.updateConnectorEndpoint(conn.id, 'start', {
            objectId: attach.objectId,
            t: attach.t,
          });
          this.objectStore.updateConnectorEndpoint(conn.id, 'end', {
            point: { x: wx, y: wy },
          });
        } else {
          this.objectStore.updateConnectorEndpoint(conn.id, 'start', { point: { x: wx, y: wy } });
          this.objectStore.updateConnectorEndpoint(conn.id, 'end', { point: { x: wx, y: wy } });
        }

        return conn;
      },
      onResolveAttach: (wx, wy, connectorId, excludeSourceId) => {
        // Exclude both the connector itself and the source object
        const excludeIds = [connectorId, excludeSourceId].filter((id): id is string => !!id);
        return this.objectStore.getAttachableAtPoint(wx, wy, excludeIds, this.camera.scale);
      },
      onConnectorEndpoint: (id, side, payload) => {
        this.objectStore.withOrigin('gesture', () => this.objectStore.updateConnectorEndpoint(id, side, payload));
      },
      onFinishConnector: () => {
        this.objectStore.withOrigin('local', () => this.undoRedoManager.stopCapturing());
      },
      onGestureEnd: () => {
        this.objectStore.withOrigin('local', () => this.undoRedoManager.stopCapturing());
      },
      onUndo: () => {
        this.undoRedoManager.undo();
        this.selectedIds = [];
        this.inputHandler.setSelection([]);
        this.callbacks.onSelectionChange?.([]);
      },
      onRedo: () => {
        this.undoRedoManager.redo();
        this.selectedIds = [];
        this.inputHandler.setSelection([]);
        this.callbacks.onSelectionChange?.([]);
      },
    });

    canvasEl.addEventListener('dblclick', (e) => {
      const rect = canvasEl.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const { x: wx, y: wy } = this.camera.screenToWorld(sx, sy);
      const objects = this.objectStore.getAll();
      for (let i = objects.length - 1; i >= 0; i--) {
        const obj = objects[i]!;
        if ((obj.type === 'sticky' || obj.type === 'text') && this._pointInObjectAabb(wx, wy, obj)) {
          this.textEditor.startEditing(obj);
          break;
        }
      }
    });

    this.resizeObserver = new ResizeObserver(() => this._resize());
    this.resizeObserver.observe(canvasEl.parentElement!);
    this._resize();
    this._startRenderLoop();
  }

  _pointInObjectAabb(wx: number, wy: number, obj: BoardObject): boolean {
    return pointInObject(wx, wy, obj);
  }

  _resize(): void {
    const parent = this.canvasEl.parentElement!;
    const dpr = window.devicePixelRatio || 1;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    this.canvasEl.width = w * dpr;
    this.canvasEl.height = h * dpr;
    this.canvasEl.style.width = `${w}px`;
    this.canvasEl.style.height = `${h}px`;
  }

  _startRenderLoop(): void {
    const render = () => {
      this.animFrameId = requestAnimationFrame(render);
      this._draw();
    };
    render();
  }

  _draw(): void {
    const { ctx, canvasEl } = this;
    const dpr = window.devicePixelRatio || 1;
    const w = canvasEl.width;
    const h = canvasEl.height;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);

    this.camera.applyTransform(ctx, dpr);
    this.renderer.drawBackground(ctx, this.camera, w / dpr, h / dpr);

    const objects = this.objectStore.getAll();
    const byId = new Map(objects.map((o) => [o.id, o]));
    const editingId = this.textEditor.getEditingId();
    this._trackAIReveals(objects);

    for (const obj of objects) {
      this.renderer.drawObject(ctx, obj, byId, {
        skipText: obj.id === editingId,
        reveal: this._getRevealState(obj),
      });
    }

    // Draw hitbox ring glow for hovered/drag-target shapes
    this.inputHandler.getHitboxRing().draw(ctx, byId, this.camera, this.renderer);

    const selectedObjects = this.selectedIds.map((id) => byId.get(id)).filter((o): o is BoardObject => !!o);
    this.renderer.drawSelection(ctx, selectedObjects, this.camera, byId);

    for (const obj of selectedObjects) {
      if (this.textEditor.getEditingId() === obj.id) {
        this.textEditor.updatePosition(obj);
      }
    }

    const shapePreview = this.inputHandler.getShapePreviewRect();
    const previewKind = this.inputHandler.activeShapeKind;
    if (shapePreview && shapePreview.width > 0 && shapePreview.height > 0 && previewKind) {
      const def = SHAPE_DEFS.get(previewKind);
      if (def) {
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = this.renderer.color('blue', '#bfdbfe');
        ctx.strokeStyle = this.renderer.color('gray', '#64748b');
        ctx.lineWidth = 2;
        def.draw(ctx, shapePreview.x, shapePreview.y, shapePreview.width, shapePreview.height);
        ctx.restore();
      }
    }

    const marqueeRect = this.inputHandler.getMarqueeRect();
    if (marqueeRect) {
      const hoveredIds = this.inputHandler.getMarqueeHoveredIds();
      for (const id of hoveredIds) {
        const obj = byId.get(id);
        if (obj) this.renderer.drawMarqueeHover(ctx, obj, this.camera, byId);
      }
      this.renderer.drawMarquee(ctx, marqueeRect, this.camera);
    }

    if (this.cursorManager) {
      const cursors = this.cursorManager.getCursors();
      for (const cursor of cursors) {
        this.renderer.drawCursor(ctx, cursor, this.camera);
      }
    }
  }

  copySelection(ids: string[] = this.selectedIds): void {
    copySelection(ids, this.objectStore);
  }

  pasteClipboard(): void {
    const center = this.camera.screenToWorld(this.canvasEl.clientWidth / 2, this.canvasEl.clientHeight / 2);
    const pastedIds = pasteClipboard(this.objectStore, center);
    if (pastedIds.length) {
      this.selectedIds = pastedIds;
      this.inputHandler.setSelection(pastedIds);
    }
  }

  duplicateSelection(ids: string[] = this.selectedIds): void {
    const duplicated = duplicateSelection(ids, this.objectStore);
    if (duplicated.length) {
      this.selectedIds = duplicated;
      this.inputHandler.setSelection(duplicated);
    }
  }

  setTool(tool: ToolName): void {
    this.inputHandler.setTool(tool);
  }

  setShapeKind(kind: ShapeKind): void {
    this.inputHandler.setShapeKind(kind);
  }

  getViewportCenter() {
    return this.camera.screenToWorld(this.canvasEl.clientWidth / 2, this.canvasEl.clientHeight / 2);
  }

  getViewportSnapshot(): {
    center: { x: number; y: number };
    widthPx: number;
    heightPx: number;
    topLeftWorld: { x: number; y: number };
    bottomRightWorld: { x: number; y: number };
    scale: number;
  } {
    const widthPx = this.canvasEl.clientWidth;
    const heightPx = this.canvasEl.clientHeight;
    const center = this.getViewportCenter();
    const topLeftWorld = this.camera.screenToWorld(0, 0);
    const bottomRightWorld = this.camera.screenToWorld(widthPx, heightPx);
    return {
      center,
      widthPx,
      heightPx,
      topLeftWorld,
      bottomRightWorld,
      scale: this.camera.scale,
    };
  }

  getSelectedIds(): string[] {
    return [...this.selectedIds];
  }

  destroy(): void {
    if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
    this.resizeObserver.disconnect();
    this.inputHandler.destroy();
    this.textEditor.destroy();
    this.undoRedoManager.destroy();
  }

  _trackAIReveals(objects: BoardObject[]): void {
    const now = performance.now();
    const currentIds = new Set(objects.map((obj) => obj.id));
    let staggerIndex = 0;

    for (const obj of objects) {
      if (this.seenObjectIds.has(obj.id)) continue;
      this.seenObjectIds.add(obj.id);

      const isAICreated = typeof obj.createdBy === 'string' && obj.createdBy.startsWith('ai:');
      if (!isAICreated || this.reduceMotion) continue;

      this.aiRevealMap.set(obj.id, {
        startAt: now + staggerIndex * 50,
        durationMs: 180,
      });
      staggerIndex += 1;
    }

    for (const id of [...this.aiRevealMap.keys()]) {
      if (!currentIds.has(id)) this.aiRevealMap.delete(id);
    }
  }

  _getRevealState(obj: BoardObject): RevealState | null {
    const reveal = this.aiRevealMap.get(obj.id);
    if (!reveal) return null;

    const now = performance.now();
    const elapsed = now - reveal.startAt;
    if (elapsed <= 0) return { alpha: 0, scale: 0.92 };
    if (elapsed >= reveal.durationMs) {
      this.aiRevealMap.delete(obj.id);
      return null;
    }

    const t = elapsed / reveal.durationMs;
    return {
      alpha: t,
      scale: 0.92 + 0.08 * t,
    };
  }
}
