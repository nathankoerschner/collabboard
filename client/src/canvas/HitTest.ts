import type { BoardObject, Bounds, Port, ShapeObject } from '../types.js';
import {
  getConnectorEndpoints,
  getFrameHitArea,
  getObjectCenter,
  getPortList,
  getRotationHandlePoint,
  hitTestConnector,
  inverseRotatePoint,
  pointInObject,
  pointInPath2D,
  rotatePoint,
} from './Geometry.js';
import { SHAPE_DEFS } from '../board/ShapeDefs.js';

const HANDLE_SIZE = 8;

let _hitCtx: CanvasRenderingContext2D | null = null;
function _getHitCtx(): CanvasRenderingContext2D {
  if (!_hitCtx) {
    const canvas = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(1, 1)
      : document.createElement('canvas');
    _hitCtx = canvas.getContext('2d') as CanvasRenderingContext2D;
  }
  return _hitCtx;
}

export function hitTestObjects(wx: number, wy: number, objects: BoardObject[]): { object: BoardObject; area: string } | null {
  const objectsById = new Map(objects.map((o) => [o.id, o]));

  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i]!;

    if (obj.type === 'connector') {
      if (hitTestConnector(wx, wy, obj, objectsById, 8)) {
        return { object: obj, area: 'line' };
      }
      continue;
    }

    if (obj.type === 'frame') {
      const area = getFrameHitArea(wx, wy, obj);
      if (area) return { object: obj, area };
      continue;
    }

    if (pointInObject(wx, wy, obj)) {
      return { object: obj, area: 'body' };
    }
  }

  return null;
}

export function hitTestHandle(wx: number, wy: number, obj: BoardObject, scale = 1): string | null {
  if (!obj || obj.type === 'connector') return null;
  const hs = (HANDLE_SIZE / scale) * 1.5;
  const handles = getHandlePositions(obj);

  for (const [name, hx, hy] of handles) {
    if (Math.abs(wx - hx) <= hs && Math.abs(wy - hy) <= hs) {
      return name;
    }
  }
  return null;
}

export function hitTestRotationHandle(wx: number, wy: number, bounds: Bounds, scale = 1): boolean {
  const p = getRotationHandlePoint(bounds);
  const radius = 10 / scale;
  const dx = wx - p.x;
  const dy = wy - p.y;
  return dx * dx + dy * dy <= radius * radius;
}

export function getHandlePositions(obj: BoardObject): [string, number, number][] {
  const { x, y, width: w, height: h } = obj;
  const center = getObjectCenter(obj);
  const angle = obj.rotation || 0;

  const localHandles: [string, number, number][] = [
    ['nw', x, y],
    ['n', x + w / 2, y],
    ['ne', x + w, y],
    ['e', x + w, y + h / 2],
    ['se', x + w, y + h],
    ['s', x + w / 2, y + h],
    ['sw', x, y + h],
    ['w', x, y + h / 2],
  ];

  return localHandles.map(([name, px, py]): [string, number, number] => {
    const p = angle ? rotatePoint(px, py, center.x, center.y, angle) : { x: px, y: py };
    return [name, p.x, p.y];
  });
}

export function getConnectorHitEndpoint(wx: number, wy: number, connector: BoardObject, objectsById: Map<string, BoardObject>, scale = 1): string | null {
  const { start, end } = getConnectorEndpoints(connector, objectsById);
  const radius = 10 / scale;
  if (start) {
    const dx = wx - start.x;
    const dy = wy - start.y;
    if (dx * dx + dy * dy <= radius * radius) return 'start';
  }
  if (end) {
    const dx = wx - end.x;
    const dy = wy - end.y;
    if (dx * dx + dy * dy <= radius * radius) return 'end';
  }
  return null;
}

export function hitTestPort(wx: number, wy: number, obj: BoardObject, scale = 1): Port | null {
  const ports = getPortList(obj);
  const radius = 8 / scale;
  for (const p of ports) {
    const dx = wx - p.x;
    const dy = wy - p.y;
    if (dx * dx + dy * dy <= radius * radius) return p;
  }
  return null;
}

/** Returns true if (wx,wy) is in the outer ring zone around a shape (outside body, inside expanded bounds) */
export function hitTestOuterRing(wx: number, wy: number, obj: BoardObject, ringPx: number, scale: number): boolean {
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

  // Path2D-based shapes (hexagon, arrow, star, etc.)
  if (obj.type === 'shape') {
    const def = SHAPE_DEFS.get((obj as ShapeObject).shapeKind);
    if (def) {
      const innerPath = def.path(obj.x, obj.y, obj.width, obj.height);
      const insideInner = pointInPath2D(lx, ly, innerPath);
      // For the outer check, sample the nearest point on the shape outline.
      // Use a stroke-width-based isPointInStroke: build a thick-stroked version.
      if (insideInner) return false;
      const ctx = _getHitCtx();
      ctx.lineWidth = ring * 2;
      ctx.lineJoin = 'round';
      return ctx.isPointInStroke(innerPath, lx, ly);
    }
  }

  // Rect-like shapes (sticky, rectangle, text, frame fallback)
  const inside = lx >= obj.x && lx <= obj.x + obj.width && ly >= obj.y && ly <= obj.y + obj.height;
  const insideExpanded =
    lx >= obj.x - ring && lx <= obj.x + obj.width + ring && ly >= obj.y - ring && ly <= obj.y + obj.height + ring;

  return !inside && insideExpanded;
}

/** Returns the topmost shape whose outer ring is hit, skipping frames and connectors */
export function hitTestOuterRingTopmost(
  wx: number,
  wy: number,
  objects: BoardObject[],
  ringPx: number,
  scale: number,
): BoardObject | null {
  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i]!;
    if (obj.type === 'connector' || obj.type === 'frame' || obj.type === 'text') continue;
    if (hitTestOuterRing(wx, wy, obj, ringPx, scale)) return obj;
  }
  return null;
}

export { HANDLE_SIZE };
