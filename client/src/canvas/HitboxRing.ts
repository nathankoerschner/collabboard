import type { BoardObject, ShapeObject, TableObject } from '../types.js';
import { getObjectCenter, getOffscreenCtx, getTableRowPorts, inverseRotatePoint, pointInPath2D } from './Geometry.js';
import { Camera } from './Camera.js';
import { SHAPE_DEFS } from '../board/ShapeDefs.js';
import type { Renderer } from './Renderer.js';

const RING_PX = 20;

export class HitboxRing {
  hoveredId: string | null = null;
  dragTargetId: string | null = null;

  /** Pixel radius used for ring hit detection and minimum connector length. */
  static readonly RING_PX = RING_PX;

  // ── Input hooks ──

  /** Called on mousemove when not dragging. Returns 'crosshair' if a ring is hovered, null otherwise. */
  updateHover(wx: number, wy: number, objects: BoardObject[], scale: number): string | null {
    const hit = this._hitTestTopmost(wx, wy, objects, scale);
    if (hit) {
      this.hoveredId = hit.id;
      return 'crosshair';
    }
    if (this.hoveredId) {
      this.hoveredId = null;
    }
    return null;
  }

  /** Returns the currently hovered object from the list, or null. */
  getHoveredObject(objects: BoardObject[]): BoardObject | null {
    if (!this.hoveredId) return null;
    return objects.find((o) => o.id === this.hoveredId) || null;
  }

  /** Test if a point is in the outer ring of a specific object. */
  isInRing(wx: number, wy: number, obj: BoardObject, scale: number): boolean {
    return _hitTestOuterRing(wx, wy, obj, RING_PX, scale);
  }

  setDragTarget(id: string | null): void {
    this.dragTargetId = id;
  }

  clear(): void {
    this.hoveredId = null;
    this.dragTargetId = null;
  }

  // ── Rendering ──

  /** Draw glow for hovered and/or drag-target objects. */
  draw(ctx: CanvasRenderingContext2D, objectsById: Map<string, BoardObject>, camera: Camera, renderer: Renderer): void {
    if (this.hoveredId) {
      const obj = objectsById.get(this.hoveredId);
      if (obj) {
        this._drawGlow(ctx, obj, camera, renderer);
        if (obj.type === 'table') this._drawTableRowPorts(ctx, obj as TableObject, camera);
      }
    }
    if (this.dragTargetId && this.dragTargetId !== this.hoveredId) {
      const obj = objectsById.get(this.dragTargetId);
      if (obj) {
        this._drawGlow(ctx, obj, camera, renderer);
        if (obj.type === 'table') this._drawTableRowPorts(ctx, obj as TableObject, camera);
      }
    }
  }

  // ── Private ──

  private _hitTestTopmost(wx: number, wy: number, objects: BoardObject[], scale: number): BoardObject | null {
    for (let i = objects.length - 1; i >= 0; i--) {
      const obj = objects[i]!;
      if (obj.type === 'connector' || obj.type === 'frame' || obj.type === 'text') continue;
      if (_hitTestOuterRing(wx, wy, obj, RING_PX, scale)) return obj;
    }
    return null;
  }

  private _drawGlow(ctx: CanvasRenderingContext2D, obj: BoardObject, camera: Camera, renderer: Renderer): void {
    const ring = 10 / camera.scale;
    const halfRing = ring / 2;

    ctx.save();
    ctx.strokeStyle = 'rgba(37, 99, 235, 0.18)';
    ctx.lineWidth = ring;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    renderer._drawRotatedBox(ctx, obj, (lx, ly, w, h) => {
      if (
        obj.type === 'ellipse' ||
        (obj.type === 'shape' &&
          ((obj as ShapeObject).shapeKind === 'ellipse' || (obj as ShapeObject).shapeKind === 'circle'))
      ) {
        ctx.beginPath();
        ctx.ellipse(lx + w / 2, ly + h / 2, w / 2 + halfRing, h / 2 + halfRing, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (obj.type === 'shape') {
        const def = SHAPE_DEFS.get((obj as ShapeObject).shapeKind);
        if (def) {
          const p = def.path(lx - halfRing, ly - halfRing, w + ring, h + ring);
          ctx.stroke(p);
        }
      } else {
        const r = obj.type === 'sticky' || obj.type === 'table' ? 6 : 8;
        renderer.roundRect(ctx, lx - halfRing, ly - halfRing, w + ring, h + ring, r + halfRing);
        ctx.stroke();
      }
    });

    ctx.restore();
  }

  private _drawTableRowPorts(ctx: CanvasRenderingContext2D, table: TableObject, camera: Camera): void {
    const ports = getTableRowPorts(table);
    const radius = 5 / camera.scale;

    ctx.save();
    for (const port of ports) {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#2563eb';
      ctx.lineWidth = 1.5 / camera.scale;
      ctx.beginPath();
      ctx.arc(port.x, port.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }
}

// ── Standalone hit-test math (moved from HitTest.ts) ──

function _hitTestOuterRing(wx: number, wy: number, obj: BoardObject, ringPx: number, scale: number): boolean {
  const c = getObjectCenter(obj);
  const local = inverseRotatePoint(wx, wy, c.x, c.y, obj.rotation || 0);
  const lx = local.x;
  const ly = local.y;
  const ring = ringPx / scale;

  if (
    obj.type === 'ellipse' ||
    (obj.type === 'shape' && ((obj as ShapeObject).shapeKind === 'ellipse' || (obj as ShapeObject).shapeKind === 'circle'))
  ) {
    const cx = obj.x + obj.width / 2;
    const cy = obj.y + obj.height / 2;
    const rx = obj.width / 2;
    const ry = obj.height / 2;
    if (rx <= 0 || ry <= 0) return false;

    const nx = (lx - cx) / rx;
    const ny = (ly - cy) / ry;
    const inner = nx * nx + ny * ny;

    const orx = rx + ring;
    const ory = ry + ring;
    const onx = (lx - cx) / orx;
    const ony = (ly - cy) / ory;
    const outer = onx * onx + ony * ony;

    return inner > 1 && outer <= 1;
  }

  if (obj.type === 'shape') {
    const def = SHAPE_DEFS.get((obj as ShapeObject).shapeKind);
    if (def) {
      const innerPath = def.path(obj.x, obj.y, obj.width, obj.height);
      const insideInner = pointInPath2D(lx, ly, innerPath);
      if (insideInner) return false;
      const ctx = getOffscreenCtx();
      ctx.lineWidth = ring * 2;
      ctx.lineJoin = 'round';
      return ctx.isPointInStroke(innerPath, lx, ly);
    }
  }

  const inside = lx >= obj.x && lx <= obj.x + obj.width && ly >= obj.y && ly <= obj.y + obj.height;
  const insideExpanded =
    lx >= obj.x - ring && lx <= obj.x + obj.width + ring && ly >= obj.y - ring && ly <= obj.y + obj.height + ring;

  return !inside && insideExpanded;
}
