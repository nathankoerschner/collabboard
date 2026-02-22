import type { BoardObject, Bounds, InputHandlerCallbacks, Point, ShapeKind, ToolName } from '../types.js';
import { SHAPE_DEFS } from '../board/ShapeDefs.js';
import {
  hitTestHandle,
  hitTestObjects,
  hitTestRotationHandle,
  selectionPadding,
} from './HitTest.js';
import { findClosestPort, getConnectorEndpoints, getObjectAABB, getSelectionBounds, nearestPerimeterT, pointInObject } from './Geometry.js';
import { Camera } from './Camera.js';
import { HitboxRing } from './HitboxRing.js';
import type { Renderer } from './Renderer.js';

type DragType = 'pan' | 'move' | 'resize' | 'rotate' | 'marquee' | 'connector-end' | 'shape-create' | null;

export class InputHandler {
  canvasEl: HTMLCanvasElement;
  camera: Camera;
  getObjects: () => BoardObject[];
  callbacks: InputHandlerCallbacks;

  tool: ToolName = 'select';
  dragging = false;
  dragType: DragType = null;
  dragStartX = 0;
  dragStartY = 0;
  dragObjStartX = 0;
  dragObjStartY = 0;
  dragObjStartW = 0;
  dragObjStartH = 0;
  resizeHandle: string | null = null;
  selectedIds: string[] = [];
  spaceHeld = false;
  marqueeRect: Bounds | null = null;
  marqueeHoveredIds: string[] = [];
  rotationPivot: Point | null = null;
  rotationStartAngle = 0;
  rotationAppliedDelta = 0;
  activeConnectorId: string | null = null;
  connectorSourceObjectId: string | null = null;
  activeShapeKind: ShapeKind | null = null;
  shapePreviewRect: Bounds | null = null;
  hitboxRing = new HitboxRing();
  renderer: Renderer | null = null;

  private readonly _onMouseDown: (e: MouseEvent) => void;
  private readonly _onMouseMove: (e: MouseEvent) => void;
  private readonly _onMouseUp: (e: MouseEvent) => void;
  private readonly _onWheel: (e: WheelEvent) => void;
  private readonly _onKeyDown: (e: KeyboardEvent) => void;
  private readonly _onKeyUp: (e: KeyboardEvent) => void;

  constructor(canvas: HTMLCanvasElement, camera: Camera, getObjects: () => BoardObject[], callbacks: InputHandlerCallbacks) {
    this.canvasEl = canvas;
    this.camera = camera;
    this.getObjects = getObjects;
    this.callbacks = callbacks;

    this._onMouseDown = this._handleMouseDown.bind(this);
    this._onMouseMove = this._handleMouseMove.bind(this);
    this._onMouseUp = this._handleMouseUp.bind(this);
    this._onWheel = this._handleWheel.bind(this);
    this._onKeyDown = this._handleKeyDown.bind(this);
    this._onKeyUp = this._handleKeyUp.bind(this);

    canvas.addEventListener('mousedown', this._onMouseDown);
    canvas.addEventListener('mousemove', this._onMouseMove);
    canvas.addEventListener('mouseup', this._onMouseUp);
    canvas.addEventListener('wheel', this._onWheel, { passive: false });
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
  }

  setTool(tool: ToolName): void {
    this.tool = tool;
    this.canvasEl.style.cursor = tool === 'select' ? 'default' : 'crosshair';
    if (tool !== 'shape') {
      this.activeShapeKind = null;
      this.shapePreviewRect = null;
    }
  }

  setShapeKind(kind: ShapeKind): void {
    this.activeShapeKind = kind;
  }

  getShapePreviewRect(): Bounds | null {
    return this.shapePreviewRect;
  }

  setSelection(ids: string[]): void {
    this.selectedIds = [...ids];
  }

  getHitboxRing(): HitboxRing {
    return this.hitboxRing;
  }

  getMarqueeRect(): Bounds | null {
    return this.marqueeRect;
  }

  getMarqueeHoveredIds(): string[] {
    return this.marqueeHoveredIds;
  }

  _eventWorld(e: MouseEvent): { sx: number; sy: number; wx: number; wy: number } {
    const rect = this.canvasEl.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const world = this.camera.screenToWorld(sx, sy);
    return { sx, sy, wx: world.x, wy: world.y };
  }

  private _handleMouseDown(e: MouseEvent): void {
    const { sx, sy, wx, wy } = this._eventWorld(e);

    if (this.tool === 'shape' && this.activeShapeKind) {
      this.dragging = true;
      this.dragType = 'shape-create';
      this.dragStartX = wx;
      this.dragStartY = wy;
      this.shapePreviewRect = { x: wx, y: wy, width: 0, height: 0 };
      return;
    }

    if (this.tool !== 'select') {
      const created = this._createForTool(wx, wy);
      if (created) {
        this._setSelection([created.id]);
        this.callbacks.onToolAutoReset?.('select');
      }
      return;
    }

    // Hitbox ring → start connector from perimeter
    if (this.hitboxRing.hoveredId && !e.shiftKey) {
      const objects = this.getObjects();
      const hoveredObj = this.hitboxRing.getHoveredObject(objects);
      if (hoveredObj) {
        let attach: { objectId: string; t: number } | { objectId: string; port: string };
        if (hoveredObj.type === 'table') {
          const port = findClosestPort(hoveredObj, wx, wy);
          attach = port ? { objectId: hoveredObj.id, port: port.name } : { objectId: hoveredObj.id, t: nearestPerimeterT(hoveredObj, wx, wy) };
        } else {
          attach = { objectId: hoveredObj.id, t: nearestPerimeterT(hoveredObj, wx, wy) };
        }
        const conn = this.callbacks.onStartConnector?.(wx, wy, attach);
        if (conn) {
          this.activeConnectorId = conn.id;
          this.connectorSourceObjectId = hoveredObj.id;
          this.dragging = true;
          this.dragType = 'connector-end';
          this._setSelection([conn.id]);
        }
        return;
      }
    }

    const objects = this.getObjects();
    const selected = objects.filter((o) => this.selectedIds.includes(o.id));
    const selectionBounds = selected.length ? getSelectionBounds(selected) : null;

    const singleTable = selected.length === 1 && selected[0]!.type === 'table';
    const rotPad = selected.length === 1 ? selectionPadding(selected[0]!, this.camera.scale) : undefined;
    if (!singleTable && selectionBounds && hitTestRotationHandle(wx, wy, selectionBounds, this.camera.scale, rotPad)) {
      this.dragging = true;
      this.dragType = 'rotate';
      this.rotationPivot = {
        x: selectionBounds.x + selectionBounds.width / 2,
        y: selectionBounds.y + selectionBounds.height / 2,
      };
      this.rotationStartAngle = Math.atan2(wy - this.rotationPivot.y, wx - this.rotationPivot.x);
      this.rotationAppliedDelta = 0;
      return;
    }

    if (this.selectedIds.length === 1) {
      const sel = objects.find((o) => o.id === this.selectedIds[0]);
      if (sel && sel.type !== 'connector') {
        const handle = hitTestHandle(wx, wy, sel, this.camera.scale);
        if (handle) {
          this.dragging = true;
          this.dragType = 'resize';
          this.resizeHandle = handle;
          this.dragStartX = wx;
          this.dragStartY = wy;
          this.dragObjStartX = sel.x;
          this.dragObjStartY = sel.y;
          this.dragObjStartW = sel.width;
          this.dragObjStartH = sel.height;
          return;
        }
      }
    }

    const hit = hitTestObjects(wx, wy, objects);
    if (hit) {
      if (hit.object.type === 'frame' && hit.area === 'inside') {
        this._beginEmptyDrag(e, sx, sy, wx, wy);
        return;
      }

      const hitId = hit.object.id;
      const alreadySelected = this.selectedIds.includes(hitId);
      if (e.shiftKey) {
        if (alreadySelected) {
          this._setSelection(this.selectedIds.filter((id) => id !== hitId));
        } else {
          this._setSelection([...this.selectedIds, hitId]);
        }
      } else if (!alreadySelected) {
        this._setSelection([hitId]);
      }

      this.callbacks.onBringToFront?.(hitId);

      if (this.selectedIds.includes(hitId)) {
        this.dragging = true;
        this.dragType = 'move';
        this.dragStartX = wx;
        this.dragStartY = wy;
      }
      return;
    }

    this._beginEmptyDrag(e, sx, sy, wx, wy);
  }

  _createForTool(wx: number, wy: number): BoardObject | undefined {
    if (this.tool === 'sticky') return this.callbacks.onCreate?.('sticky', wx - 75, wy - 75, 150, 150);
    if (this.tool === 'rectangle') return this.callbacks.onCreate?.('rectangle', wx - 100, wy - 60, 200, 120);
    if (this.tool === 'ellipse') return this.callbacks.onCreate?.('ellipse', wx - 100, wy - 60, 200, 120);
    if (this.tool === 'text') return this.callbacks.onCreate?.('text', wx - 90, wy - 24, 180, 48);
    if (this.tool === 'frame') return this.callbacks.onCreate?.('frame', wx - 180, wy - 120, 360, 240);
    if (this.tool === 'table') return this.callbacks.onCreate?.('table', wx - 180, wy - 64, 360, 128);
    return undefined;
  }

  _beginEmptyDrag(e: MouseEvent, sx: number, sy: number, wx: number, wy: number): void {
    if (this.spaceHeld || e.button === 1) {
      this.dragging = true;
      this.dragType = 'pan';
      this.dragStartX = sx;
      this.dragStartY = sy;
      return;
    }

    if (!e.shiftKey) {
      this._setSelection([]);
    }

    this.dragging = true;
    this.dragType = 'marquee';
    this.dragStartX = wx;
    this.dragStartY = wy;
    this.marqueeRect = { x: wx, y: wy, width: 0, height: 0 };
  }

  private _handleMouseMove(e: MouseEvent): void {
    const { sx, sy, wx, wy } = this._eventWorld(e);
    this.callbacks.onCursorMove?.(wx, wy);

    if (!this.dragging) {
      // Hover detection for hitbox ring (only in select mode)
      if (this.tool === 'select' && !e.shiftKey) {
        const cursor = this.hitboxRing.updateHover(wx, wy, this.getObjects(), this.camera.scale);
        this.canvasEl.style.cursor = cursor || 'default';
      }
      return;
    }

    if (this.dragType === 'pan') {
      const dx = sx - this.dragStartX;
      const dy = sy - this.dragStartY;
      this.camera.pan(dx, dy);
      this.dragStartX = sx;
      this.dragStartY = sy;
      return;
    }

    if (this.dragType === 'move' && this.selectedIds.length) {
      const dx = wx - this.dragStartX;
      const dy = wy - this.dragStartY;
      this.callbacks.onMoveSelection?.(this.selectedIds, dx, dy);
      this.dragStartX = wx;
      this.dragStartY = wy;
      return;
    }

    if (this.dragType === 'resize' && this.selectedIds.length === 1) {
      this._handleResize(wx, wy);
      return;
    }

    if (this.dragType === 'rotate' && this.selectedIds.length) {
      const angle = Math.atan2(wy - this.rotationPivot!.y, wx - this.rotationPivot!.x);
      const totalDelta = ((angle - this.rotationStartAngle) * 180) / Math.PI;
      const incremental = totalDelta - this.rotationAppliedDelta;
      if (incremental) {
        this.callbacks.onRotateSelection?.(this.selectedIds, incremental, this.rotationPivot!);
        this.rotationAppliedDelta = totalDelta;
      }
      return;
    }

    if (this.dragType === 'shape-create') {
      const sx = Math.min(this.dragStartX, wx);
      const sy = Math.min(this.dragStartY, wy);
      const sw = Math.abs(wx - this.dragStartX);
      const sh = Math.abs(wy - this.dragStartY);
      this.shapePreviewRect = { x: sx, y: sy, width: sw, height: sh };
      return;
    }

    if (this.dragType === 'connector-end' && this.activeConnectorId) {
      // Update fromT/fromPort only when cursor is crossing over the source object
      if (this.connectorSourceObjectId) {
        const objects = this.getObjects();
        const srcObj = objects.find((o) => o.id === this.connectorSourceObjectId);
        if (srcObj && (pointInObject(wx, wy, srcObj) || this.hitboxRing.isInRing(wx, wy, srcObj, this.camera.scale))) {
          if (srcObj.type === 'table') {
            const port = findClosestPort(srcObj, wx, wy);
            if (port) {
              this.callbacks.onConnectorEndpoint?.(this.activeConnectorId, 'start', {
                objectId: srcObj.id,
                port: port.name,
              });
            }
          } else {
            const fromT = nearestPerimeterT(srcObj, wx, wy);
            this.callbacks.onConnectorEndpoint?.(this.activeConnectorId, 'start', {
              objectId: srcObj.id,
              t: fromT,
            });
          }
        }
      }

      // Resolve target (exclude source object to prevent self-connection)
      const attach = this.callbacks.onResolveAttach?.(wx, wy, this.activeConnectorId, this.connectorSourceObjectId);
      if (attach) {
        this.hitboxRing.setDragTarget(attach.object.id);
        if (attach.port) {
          this.callbacks.onConnectorEndpoint?.(this.activeConnectorId, 'end', {
            objectId: attach.object.id,
            port: attach.port,
          });
        } else {
          this.callbacks.onConnectorEndpoint?.(this.activeConnectorId, 'end', {
            objectId: attach.object.id,
            t: attach.t,
          });
        }
      } else {
        this.hitboxRing.setDragTarget(null);
        this.callbacks.onConnectorEndpoint?.(this.activeConnectorId, 'end', {
          point: { x: wx, y: wy },
        });
      }
      return;
    }

    if (this.dragType === 'marquee') {
      const mx = Math.min(this.dragStartX, wx);
      const my = Math.min(this.dragStartY, wy);
      const mw = Math.abs(wx - this.dragStartX);
      const mh = Math.abs(wy - this.dragStartY);
      this.marqueeRect = { x: mx, y: my, width: mw, height: mh };

      if (mw > 2 || mh > 2) {
        const objects = this.getObjects();
        const objectsById = new Map(objects.map((o) => [o.id, o]));
        this.marqueeHoveredIds = objects
          .filter((obj) => {
            if (obj.type === 'connector') {
              const { start, end } = getConnectorEndpoints(obj, objectsById);
              if (!start || !end) return false;
              const cx = Math.min(start.x, end.x);
              const cy = Math.min(start.y, end.y);
              const cw = Math.abs(end.x - start.x);
              const ch = Math.abs(end.y - start.y);
              return cx < mx + mw && cx + cw > mx && cy < my + mh && cy + ch > my;
            }
            const box = getObjectAABB(obj);
            return box.x < mx + mw && box.x + box.width > mx && box.y < my + mh && box.y + box.height > my;
          })
          .map((o) => o.id);
      } else {
        this.marqueeHoveredIds = [];
      }
    }
  }

  private _handleMouseUp(e: MouseEvent): void {
    if (this.dragType === 'shape-create' && this.activeShapeKind) {
      const def = SHAPE_DEFS.get(this.activeShapeKind);
      const preview = this.shapePreviewRect;
      const dragDist = preview ? Math.max(preview.width, preview.height) : 0;

      let x: number, y: number, w: number, h: number;
      if (dragDist < 5 || !preview) {
        // Click: create at default size centered on click
        const dw = def?.defaultWidth ?? 120;
        const dh = def?.defaultHeight ?? 120;
        x = this.dragStartX - dw / 2;
        y = this.dragStartY - dh / 2;
        w = dw;
        h = dh;
      } else {
        x = preview.x;
        y = preview.y;
        w = preview.width;
        h = preview.height;
      }

      const created = this.callbacks.onCreate?.('shape', x, y, w, h, { shapeKind: this.activeShapeKind });
      if (created) {
        this._setSelection([created.id]);
      }

      this.shapePreviewRect = null;
      this.callbacks.onToolAutoReset?.('select');
      this.dragging = false;
      this.dragType = null;
      return;
    }

    if (this.dragType === 'marquee' && this.marqueeRect) {
      const ids = this.marqueeHoveredIds;
      if (ids.length) {
        if (e.shiftKey) {
          const merged = new Set([...this.selectedIds, ...ids]);
          this._setSelection([...merged]);
        } else {
          this._setSelection(ids);
        }
      }
      this.marqueeRect = null;
      this.marqueeHoveredIds = [];
    }

    if (this.dragType === 'connector-end' && this.activeConnectorId) {
      // Delete the connector if it's too short (click without meaningful drag)
      const objects = this.getObjects();
      const connObj = objects.find((o) => o.id === this.activeConnectorId);
      if (connObj) {
        const objectsById = new Map(objects.map((o) => [o.id, o]));
        const { start, end } = getConnectorEndpoints(connObj, objectsById);
        if (start && end) {
          const cdx = end.x - start.x;
          const cdy = end.y - start.y;
          const dist = Math.sqrt(cdx * cdx + cdy * cdy);
          if (dist < HitboxRing.RING_PX / this.camera.scale) {
            this.callbacks.onDeleteSelection?.([this.activeConnectorId]);
          }
        }
      }
      this.callbacks.onFinishConnector?.(this.activeConnectorId);
      this.activeConnectorId = null;
      this.connectorSourceObjectId = null;
      this.hitboxRing.clear();
    }

    if (this.dragType === 'move' || this.dragType === 'resize' || this.dragType === 'rotate') {
      this.callbacks.onGestureEnd?.();
    }

    this.dragging = false;
    this.dragType = null;
    this.resizeHandle = null;
  }

  private _handleWheel(e: WheelEvent): void {
    e.preventDefault();
    const rect = this.canvasEl.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    // Check if scrolling over a sticky with text overflow
    if (!e.ctrlKey && this.renderer) {
      const { x: wx, y: wy } = this.camera.screenToWorld(cx, cy);
      const objects = this.getObjects();
      for (let i = objects.length - 1; i >= 0; i--) {
        const obj = objects[i]!;
        if (obj.type !== 'sticky' || !obj.text) continue;
        if (!pointInObject(wx, wy, obj)) continue;
        const ctx = this.canvasEl.getContext('2d')!;
        const overflow = this.renderer.stickyTextOverflow(ctx, obj);
        if (overflow > 0) {
          this.renderer.scrollSticky(obj.id, e.deltaY * 0.5, overflow);
          return;
        }
        break;
      }
    }

    if (e.ctrlKey) {
      this.camera.zoom(e.deltaY > 0 ? 0.95 : 1.05, cx, cy);
    } else {
      this.camera.pan(-e.deltaX, -e.deltaY);
    }
  }

  private _handleKeyDown(e: KeyboardEvent): void {
    if (e.target instanceof HTMLElement && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) return;

    const key = e.key.toLowerCase();

    if ((e.metaKey || e.ctrlKey) && key === 'z') {
      e.preventDefault();
      e.shiftKey ? this.callbacks.onRedo?.() : this.callbacks.onUndo?.();
      return;
    }

    if (e.key === ' ') {
      e.preventDefault();
      this.spaceHeld = true;
      this.canvasEl.style.cursor = 'grab';
      return;
    }

    if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedIds.length) {
      this.callbacks.onDeleteSelection?.(this.selectedIds);
      this._setSelection([]);
      return;
    }

    if ((e.metaKey || e.ctrlKey) && key === 'd') {
      e.preventDefault();
      this.callbacks.onDuplicateSelection?.(this.selectedIds);
      return;
    }

    if ((e.metaKey || e.ctrlKey) && key === 'c') {
      e.preventDefault();
      this.callbacks.onCopySelection?.(this.selectedIds);
      return;
    }

    if ((e.metaKey || e.ctrlKey) && key === 'v') {
      e.preventDefault();
      this.callbacks.onPaste?.();
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      return;
    }

    if (key === 'enter' && this.selectedIds.length === 1) {
      this.callbacks.onEditObject?.(this.selectedIds[0]!);
      return;
    }
  }

  private _handleKeyUp(e: KeyboardEvent): void {
    if (e.key === ' ') {
      this.spaceHeld = false;
      this.canvasEl.style.cursor = this.tool === 'select' ? 'default' : 'crosshair';
    }
  }

  _handleResize(wx: number, wy: number): void {
    const dx = wx - this.dragStartX;
    const dy = wy - this.dragStartY;
    let x = this.dragObjStartX;
    let y = this.dragObjStartY;
    let width = this.dragObjStartW;
    let height = this.dragObjStartH;
    const min = 24;
    const h = this.resizeHandle!;

    if (h.includes('e')) width = Math.max(min, width + dx);
    if (h.includes('w')) {
      x = x + dx;
      width = Math.max(min, width - dx);
      if (width === min) x = this.dragObjStartX + (this.dragObjStartW - min);
    }
    if (h.includes('s')) height = Math.max(min, height + dy);
    if (h.includes('n')) {
      y = y + dy;
      height = Math.max(min, height - dy);
      if (height === min) y = this.dragObjStartY + (this.dragObjStartH - min);
    }

    this.callbacks.onResizeObject?.(this.selectedIds[0]!, x, y, width, height);
  }

  _setSelection(ids: string[]): void {
    this.selectedIds = [...new Set(ids)];
    this.callbacks.onSelectionChange?.(this.selectedIds);
  }

  destroy(): void {
    this.canvasEl.removeEventListener('mousedown', this._onMouseDown);
    this.canvasEl.removeEventListener('mousemove', this._onMouseMove);
    this.canvasEl.removeEventListener('mouseup', this._onMouseUp);
    this.canvasEl.removeEventListener('wheel', this._onWheel);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
  }
}
