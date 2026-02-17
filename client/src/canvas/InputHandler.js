import { hitTestObjects, hitTestHandle } from './HitTest.js';

export class InputHandler {
  constructor(canvas, camera, getObjects, callbacks) {
    this.canvasEl = canvas;
    this.camera = camera;
    this.getObjects = getObjects;
    this.callbacks = callbacks; // { onSelect, onMove, onResize, onCreate, onDelete }

    this.tool = 'select'; // 'select' | 'sticky' | 'rectangle'
    this.dragging = false;
    this.dragType = null; // 'pan' | 'move' | 'resize' | 'marquee'
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.dragObjStartX = 0;
    this.dragObjStartY = 0;
    this.dragObjStartW = 0;
    this.dragObjStartH = 0;
    this.resizeHandle = null;
    this.selectedId = null;
    this.spaceHeld = false;
    this.marqueeRect = null; // { x, y, width, height } in world coords

    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
    this._onWheel = this._onWheel.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);

    canvas.addEventListener('mousedown', this._onMouseDown);
    canvas.addEventListener('mousemove', this._onMouseMove);
    canvas.addEventListener('mouseup', this._onMouseUp);
    canvas.addEventListener('wheel', this._onWheel, { passive: false });
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
  }

  setTool(tool) {
    this.tool = tool;
    this.canvasEl.style.cursor = tool === 'select' ? 'default' : 'crosshair';
  }

  getSelectedId() {
    return this.selectedId;
  }

  getMarqueeRect() {
    return this.marqueeRect;
  }

  _onMouseDown(e) {
    const rect = this.canvasEl.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const { x: wx, y: wy } = this.camera.screenToWorld(sx, sy);

    if (this.tool === 'sticky') {
      this.callbacks.onCreate?.('sticky', wx - 75, wy - 75, 150, 150);
      this.setTool('select');
      return;
    }

    if (this.tool === 'rectangle') {
      this.callbacks.onCreate?.('rectangle', wx - 100, wy - 60, 200, 120);
      this.setTool('select');
      return;
    }

    // Select tool
    const objects = this.getObjects();

    // Check resize handles on selected object first
    if (this.selectedId) {
      const selObj = objects.find(o => o.id === this.selectedId);
      if (selObj) {
        const handleScale = 8 / this.camera.scale;
        const handle = hitTestHandle(wx, wy, { ...selObj }, handleScale);
        if (handle) {
          this.dragging = true;
          this.dragType = 'resize';
          this.resizeHandle = handle;
          this.dragStartX = wx;
          this.dragStartY = wy;
          this.dragObjStartX = selObj.x;
          this.dragObjStartY = selObj.y;
          this.dragObjStartW = selObj.width;
          this.dragObjStartH = selObj.height;
          return;
        }
      }
    }

    const hit = hitTestObjects(wx, wy, objects);
    if (hit) {
      this.selectedId = hit.id;
      this.callbacks.onSelect?.(hit.id);
      this.dragging = true;
      this.dragType = 'move';
      this.dragStartX = wx;
      this.dragStartY = wy;
      this.dragObjStartX = hit.x;
      this.dragObjStartY = hit.y;
    } else if (this.spaceHeld || e.button === 1) {
      // Space+drag or middle-click → pan
      this.dragging = true;
      this.dragType = 'pan';
      this.dragStartX = sx;
      this.dragStartY = sy;
    } else {
      // Marquee select on empty space
      this.selectedId = null;
      this.callbacks.onSelect?.(null);
      this.dragging = true;
      this.dragType = 'marquee';
      this.dragStartX = wx;
      this.dragStartY = wy;
      this.marqueeRect = { x: wx, y: wy, width: 0, height: 0 };
    }
  }

  _onMouseMove(e) {
    const rect = this.canvasEl.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const { x: wx, y: wy } = this.camera.screenToWorld(sx, sy);

    // Emit cursor position for awareness
    this.callbacks.onCursorMove?.(wx, wy);

    if (!this.dragging) return;

    if (this.dragType === 'pan') {
      const dx = sx - this.dragStartX;
      const dy = sy - this.dragStartY;
      this.camera.pan(dx, dy);
      this.dragStartX = sx;
      this.dragStartY = sy;
    } else if (this.dragType === 'move' && this.selectedId) {
      const dx = wx - this.dragStartX;
      const dy = wy - this.dragStartY;
      this.callbacks.onMove?.(this.selectedId, this.dragObjStartX + dx, this.dragObjStartY + dy);
    } else if (this.dragType === 'resize' && this.selectedId) {
      this._handleResize(wx, wy);
    } else if (this.dragType === 'marquee') {
      const mx = Math.min(this.dragStartX, wx);
      const my = Math.min(this.dragStartY, wy);
      const mw = Math.abs(wx - this.dragStartX);
      const mh = Math.abs(wy - this.dragStartY);
      this.marqueeRect = { x: mx, y: my, width: mw, height: mh };
    }
  }

  _onMouseUp() {
    if (this.dragType === 'marquee' && this.marqueeRect) {
      const { x, y, width, height } = this.marqueeRect;
      if (width > 2 || height > 2) {
        const objects = this.getObjects();
        const selected = objects.filter(obj =>
          obj.x >= x && obj.y >= y &&
          obj.x + obj.width <= x + width &&
          obj.y + obj.height <= y + height
        );
        if (selected.length > 0) {
          const ids = selected.map(o => o.id);
          this.selectedId = ids.length === 1 ? ids[0] : null;
          this.callbacks.onMarqueeSelect?.(ids);
        }
      }
      this.marqueeRect = null;
    }
    this.dragging = false;
    this.dragType = null;
    this.resizeHandle = null;
  }

  _onWheel(e) {
    e.preventDefault();
    const rect = this.canvasEl.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    if (e.ctrlKey) {
      // Pinch-to-zoom on trackpad (browser sets ctrlKey for pinch gestures)
      // or Ctrl+scroll on mouse wheel
      const factor = e.deltaY > 0 ? 0.95 : 1.05;
      this.camera.zoom(factor, cx, cy);
    } else {
      // Two-finger scroll on trackpad → pan
      // Mouse scroll wheel without Ctrl → also pan
      this.camera.pan(-e.deltaX, -e.deltaY);
    }
  }

  _onKeyDown(e) {
    if (e.key === ' ') {
      e.preventDefault();
      this.spaceHeld = true;
      this.canvasEl.style.cursor = 'grab';
    }
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedId) {
      this.callbacks.onDelete?.(this.selectedId);
      this.selectedId = null;
    }
  }

  _onKeyUp(e) {
    if (e.key === ' ') {
      this.spaceHeld = false;
      this.canvasEl.style.cursor = this.tool === 'select' ? 'default' : 'crosshair';
    }
  }

  _handleResize(wx, wy) {
    const dx = wx - this.dragStartX;
    const dy = wy - this.dragStartY;
    let { x, y, width, height } = {
      x: this.dragObjStartX,
      y: this.dragObjStartY,
      width: this.dragObjStartW,
      height: this.dragObjStartH,
    };
    const MIN = 50;
    const h = this.resizeHandle;

    if (h.includes('e')) width = Math.max(MIN, width + dx);
    if (h.includes('w')) { x = x + dx; width = Math.max(MIN, width - dx); }
    if (h.includes('s')) height = Math.max(MIN, height + dy);
    if (h.includes('n')) { y = y + dy; height = Math.max(MIN, height - dy); }

    this.callbacks.onResize?.(this.selectedId, x, y, width, height);
  }

  destroy() {
    this.canvasEl.removeEventListener('mousedown', this._onMouseDown);
    this.canvasEl.removeEventListener('mousemove', this._onMouseMove);
    this.canvasEl.removeEventListener('mouseup', this._onMouseUp);
    this.canvasEl.removeEventListener('wheel', this._onWheel);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
  }
}
