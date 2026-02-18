import { Camera } from './Camera.js';
import { Renderer } from './Renderer.js';
import { InputHandler } from './InputHandler.js';
import { TextEditor } from './TextEditor.js';

const CLIPBOARD_KEY = 'collabboard.clipboard.v1';

export class Canvas {
  constructor(canvasEl, objectStore, cursorManager, callbacks = {}) {
    this.canvasEl = canvasEl;
    this.ctx = canvasEl.getContext('2d');
    this.camera = new Camera();
    this.objectStore = objectStore;
    this.cursorManager = cursorManager;
    this.callbacks = callbacks;
    this.selectedIds = [];
    this.animFrameId = null;
    this.aiRevealMap = new Map();
    this.seenObjectIds = new Set();
    this.reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.renderer = new Renderer(this.objectStore.getPalette());

    this.textEditor = new TextEditor(canvasEl, this.camera, {
      onTextChange: (id, text) => this.objectStore.updateText(id, text),
      onTextStyleChange: (id, patch) => this.objectStore.updateTextStyle(id, patch),
    });

    this.inputHandler = new InputHandler(canvasEl, this.camera, () => this.objectStore.getAll(), {
      onSelectionChange: (ids) => {
        this.selectedIds = ids;
        this.inputHandler.setSelection(ids);
      },
      onMoveSelection: (ids, dx, dy) => this.objectStore.moveObjects(ids, dx, dy),
      onResizeObject: (id, x, y, w, h) => this.objectStore.resizeObject(id, x, y, w, h),
      onRotateSelection: (ids, delta, pivot) => this.objectStore.rotateObjects(ids, delta, pivot),
      onCreate: (type, x, y, w, h) => {
        const obj = this.objectStore.createObject(type, x, y, w, h);
        this.selectedIds = [obj.id];
        if (type === 'sticky' || type === 'text') {
          setTimeout(() => this.textEditor.startEditing(obj), 30);
        }
        this.inputHandler.setSelection(this.selectedIds);
        return obj;
      },
      onDeleteSelection: (ids) => {
        if (ids.includes(this.textEditor.getEditingId())) {
          this.textEditor.stopEditing();
        }
        this.objectStore.deleteObjects(ids);
        this.selectedIds = [];
        this.inputHandler.setSelection([]);
      },
      onCopySelection: (ids) => this.copySelection(ids),
      onPaste: () => this.pasteClipboard(),
      onDuplicateSelection: (ids) => this.duplicateSelection(ids),
      onToolShortcut: (tool) => {
        this.setTool(tool);
        this.callbacks.onToolChange?.(tool);
      },
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
      onStartConnector: (wx, wy) => {
        const attach = this.objectStore.getAttachableAtPoint(wx, wy);
        const conn = this.objectStore.startConnector(wx, wy);

        if (attach) {
          this.objectStore.updateConnectorEndpoint(conn.id, 'start', {
            objectId: attach.object.id,
            port: attach.port.name,
          });
          this.objectStore.updateConnectorEndpoint(conn.id, 'end', {
            objectId: attach.object.id,
            port: attach.port.name,
          });
        } else {
          this.objectStore.updateConnectorEndpoint(conn.id, 'start', { point: { x: wx, y: wy } });
          this.objectStore.updateConnectorEndpoint(conn.id, 'end', { point: { x: wx, y: wy } });
        }

        return conn;
      },
      onResolveAttach: (wx, wy, connectorId) => this.objectStore.getAttachableAtPoint(wx, wy, connectorId),
      onConnectorEndpoint: (id, side, payload) => this.objectStore.updateConnectorEndpoint(id, side, payload),
      onFinishConnector: () => {},
    });

    canvasEl.addEventListener('dblclick', (e) => {
      const rect = canvasEl.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const { x: wx, y: wy } = this.camera.screenToWorld(sx, sy);
      const objects = this.objectStore.getAll();
      for (let i = objects.length - 1; i >= 0; i--) {
        const obj = objects[i];
        if ((obj.type === 'sticky' || obj.type === 'text') && this._pointInObjectAabb(wx, wy, obj)) {
          this.textEditor.startEditing(obj);
          break;
        }
      }
    });

    this.resizeObserver = new ResizeObserver(() => this._resize());
    this.resizeObserver.observe(canvasEl.parentElement);
    this._resize();
    this._startRenderLoop();
  }

  _pointInObjectAabb(wx, wy, obj) {
    return wx >= obj.x && wx <= obj.x + obj.width && wy >= obj.y && wy <= obj.y + obj.height;
  }

  _resize() {
    const parent = this.canvasEl.parentElement;
    this.canvasEl.width = parent.clientWidth;
    this.canvasEl.height = parent.clientHeight;
  }

  _startRenderLoop() {
    const render = () => {
      this.animFrameId = requestAnimationFrame(render);
      this._draw();
    };
    render();
  }

  _draw() {
    const { ctx, canvasEl } = this;
    const w = canvasEl.width;
    const h = canvasEl.height;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);

    this.camera.applyTransform(ctx);
    this.renderer.drawBackground(ctx, this.camera, w, h);

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

    const selectedObjects = this.selectedIds.map((id) => byId.get(id)).filter(Boolean);
    this.renderer.drawSelection(ctx, selectedObjects, this.camera);

    for (const obj of selectedObjects) {
      if (this.textEditor.getEditingId() === obj.id) {
        this.textEditor.updatePosition(obj);
      }
    }

    const marqueeRect = this.inputHandler.getMarqueeRect();
    if (marqueeRect) {
      const hoveredIds = this.inputHandler.getMarqueeHoveredIds();
      for (const id of hoveredIds) {
        const obj = byId.get(id);
        if (obj) this.renderer.drawMarqueeHover(ctx, obj, this.camera);
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

  copySelection(ids = this.selectedIds) {
    if (!ids?.length) return;
    const payload = this.objectStore.serializeSelection(ids);
    const data = JSON.stringify({ version: 1, objects: payload, copiedAt: Date.now() });
    localStorage.setItem(CLIPBOARD_KEY, data);
  }

  pasteClipboard() {
    const raw = localStorage.getItem(CLIPBOARD_KEY);
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw);
      if (!parsed?.objects?.length) return;
      const center = this.camera.screenToWorld(this.canvasEl.width / 2, this.canvasEl.height / 2);
      const pastedIds = this.objectStore.pasteSerialized(parsed.objects, { x: center.x + 20, y: center.y + 20 }, false);
      this.selectedIds = pastedIds;
      this.inputHandler.setSelection(pastedIds);
    } catch {
      // ignore invalid clipboard data
    }
  }

  duplicateSelection(ids = this.selectedIds) {
    if (!ids?.length) return;
    const duplicated = this.objectStore.duplicateSelection(ids, { x: 20, y: 20 });
    this.selectedIds = duplicated;
    this.inputHandler.setSelection(duplicated);
  }

  setTool(tool) {
    this.inputHandler.setTool(tool);
  }

  getViewportCenter() {
    return this.camera.screenToWorld(this.canvasEl.width / 2, this.canvasEl.height / 2);
  }

  getSelectedIds() {
    return [...this.selectedIds];
  }

  destroy() {
    if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
    this.resizeObserver.disconnect();
    this.inputHandler.destroy();
    this.textEditor.destroy();
  }

  _trackAIReveals(objects) {
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

  _getRevealState(obj) {
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
