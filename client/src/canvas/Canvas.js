import { Camera } from './Camera.js';
import { Renderer } from './Renderer.js';
import { InputHandler } from './InputHandler.js';
import { TextEditor } from './TextEditor.js';

export class Canvas {
  constructor(canvasEl, objectStore, cursorManager) {
    this.canvasEl = canvasEl;
    this.ctx = canvasEl.getContext('2d');
    this.camera = new Camera();
    this.renderer = new Renderer();
    this.objectStore = objectStore;
    this.cursorManager = cursorManager;
    this.selectedId = null;
    this.selectedIds = []; // for marquee multi-select
    this.animFrameId = null;

    this.textEditor = new TextEditor(canvasEl, this.camera, {
      onTextChange: (id, text) => this.objectStore.updateText(id, text),
    });

    this.inputHandler = new InputHandler(canvasEl, this.camera, () => this.objectStore.getAll(), {
      onSelect: (id) => { this.selectedId = id; this.selectedIds = id ? [id] : []; if (id) this.objectStore.bringToFront(id); },
      onMarqueeSelect: (ids) => { this.selectedIds = ids; this.selectedId = ids.length === 1 ? ids[0] : null; },
      onMove: (id, x, y) => this.objectStore.moveObject(id, x, y),
      onResize: (id, x, y, w, h) => this.objectStore.resizeObject(id, x, y, w, h),
      onCreate: (type, x, y, w, h) => {
        const obj = this.objectStore.createObject(type, x, y, w, h);
        this.selectedId = obj.id;
        if (type === 'sticky') {
          // Open text editor on newly created sticky
          setTimeout(() => this.textEditor.startEditing(obj), 50);
        }
      },
      onDelete: (id) => {
        if (this.textEditor.getEditingId() === id) {
          this.textEditor.stopEditing();
        }
        this.objectStore.deleteObject(id);
        this.selectedId = null;
        this.selectedIds = [];
      },
      onCursorMove: (wx, wy) => this.cursorManager?.sendCursor(wx, wy),
    });

    // Double-click to edit sticky text
    canvasEl.addEventListener('dblclick', (e) => {
      const rect = canvasEl.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const { x: wx, y: wy } = this.camera.screenToWorld(sx, sy);
      const objects = this.objectStore.getAll();
      for (let i = objects.length - 1; i >= 0; i--) {
        const obj = objects[i];
        if (obj.type === 'sticky' && wx >= obj.x && wx <= obj.x + obj.width && wy >= obj.y && wy <= obj.y + obj.height) {
          this.textEditor.startEditing(obj);
          break;
        }
      }
    });

    // Resize observer
    this.resizeObserver = new ResizeObserver(() => this._resize());
    this.resizeObserver.observe(canvasEl.parentElement);
    this._resize();
    this._startRenderLoop();
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
    const editingId = this.textEditor.getEditingId();
    for (const obj of objects) {
      this.renderer.drawObject(ctx, obj, { skipText: obj.id === editingId });
    }

    // Selection handles
    const idsToHighlight = this.selectedIds.length > 0 ? this.selectedIds : (this.selectedId ? [this.selectedId] : []);
    for (const id of idsToHighlight) {
      const selObj = objects.find(o => o.id === id);
      if (selObj) {
        this.renderer.drawSelectionHandles(ctx, selObj, this.camera);
        if (this.textEditor.getEditingId() === selObj.id) {
          this.textEditor.updatePosition(selObj);
        }
      }
    }

    // Marquee rectangle and hover previews
    const marqueeRect = this.inputHandler.getMarqueeRect();
    if (marqueeRect) {
      const hoveredIds = this.inputHandler.getMarqueeHoveredIds();
      for (const id of hoveredIds) {
        const obj = objects.find(o => o.id === id);
        if (obj) {
          this.renderer.drawMarqueeHover(ctx, obj, this.camera);
        }
      }
      this.renderer.drawMarquee(ctx, marqueeRect, this.camera);
    }

    // Remote cursors
    if (this.cursorManager) {
      const cursors = this.cursorManager.getCursors();
      for (const cursor of cursors) {
        this.renderer.drawCursor(ctx, cursor, this.camera);
      }
    }
  }

  setTool(tool) {
    this.inputHandler.setTool(tool);
  }

  destroy() {
    if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
    this.resizeObserver.disconnect();
    this.inputHandler.destroy();
    this.textEditor.destroy();
  }
}
