import type { BoardObject, Bounds, Point, Port, ShapeObject } from '../types.js';
import { SHAPE_DEFS } from '../board/ShapeDefs.js';

export const ROTATION_HANDLE_OFFSET = 28;

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function normalizeAngle(deg: number): number {
  let a = deg % 360;
  if (a < 0) a += 360;
  return a;
}

export function getObjectCenter(obj: BoardObject): Point {
  return {
    x: obj.x + obj.width / 2,
    y: obj.y + obj.height / 2,
  };
}

export function rotatePoint(px: number, py: number, cx: number, cy: number, angleDeg: number): Point {
  const a = degToRad(angleDeg || 0);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const dx = px - cx;
  const dy = py - cy;
  return {
    x: cx + dx * cos - dy * sin,
    y: cy + dx * sin + dy * cos,
  };
}

export function inverseRotatePoint(px: number, py: number, cx: number, cy: number, angleDeg: number): Point {
  return rotatePoint(px, py, cx, cy, -(angleDeg || 0));
}

export function getObjectCorners(obj: BoardObject): Point[] {
  const c = getObjectCenter(obj);
  const points: Point[] = [
    { x: obj.x, y: obj.y },
    { x: obj.x + obj.width, y: obj.y },
    { x: obj.x + obj.width, y: obj.y + obj.height },
    { x: obj.x, y: obj.y + obj.height },
  ];
  const angle = obj.rotation || 0;
  if (!angle) return points;
  return points.map((p) => rotatePoint(p.x, p.y, c.x, c.y, angle));
}

export function getObjectAABB(obj: BoardObject): Bounds {
  const corners = getObjectCorners(obj);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const p of corners) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function getSelectionBounds(objects: BoardObject[], objectsById?: Map<string, BoardObject>): Bounds | null {
  if (!objects.length) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const obj of objects) {
    if (obj.type === 'connector' && objectsById) {
      const { start, end } = getConnectorEndpoints(obj, objectsById);
      if (start && end) {
        minX = Math.min(minX, start.x, end.x);
        minY = Math.min(minY, start.y, end.y);
        maxX = Math.max(maxX, start.x, end.x);
        maxY = Math.max(maxY, start.y, end.y);
      }
      continue;
    }
    const box = getObjectAABB(obj);
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function pointInRotatedRect(px: number, py: number, obj: BoardObject): boolean {
  const c = getObjectCenter(obj);
  const local = inverseRotatePoint(px, py, c.x, c.y, obj.rotation || 0);
  return local.x >= obj.x && local.x <= obj.x + obj.width && local.y >= obj.y && local.y <= obj.y + obj.height;
}

export function pointInPath2D(px: number, py: number, path: Path2D): boolean {
  // Use an offscreen canvas to test point in path
  const c = _getTestCtx();
  return c.isPointInPath(path, px, py);
}

let _testCtx: CanvasRenderingContext2D | null = null;
function _getTestCtx(): CanvasRenderingContext2D {
  if (!_testCtx) {
    const canvas = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(1, 1)
      : document.createElement('canvas');
    _testCtx = (canvas as HTMLCanvasElement).getContext('2d')!;
  }
  return _testCtx;
}

export function pointInObject(px: number, py: number, obj: BoardObject): boolean {
  if (obj.type === 'connector') return false;

  const c = getObjectCenter(obj);
  const local = inverseRotatePoint(px, py, c.x, c.y, obj.rotation || 0);
  const lx = local.x;
  const ly = local.y;

  if (obj.type === 'shape') {
    const def = SHAPE_DEFS.get((obj as ShapeObject).shapeKind);
    if (def) {
      const localX = obj.x;
      const localY = obj.y;
      const p = def.path(localX, localY, obj.width, obj.height);
      return pointInPath2D(lx, ly, p);
    }
    // fallback to AABB
    return lx >= obj.x && lx <= obj.x + obj.width && ly >= obj.y && ly <= obj.y + obj.height;
  }

  if (obj.type === 'ellipse') {
    const cx = obj.x + obj.width / 2;
    const cy = obj.y + obj.height / 2;
    const rx = obj.width / 2;
    const ry = obj.height / 2;
    if (rx <= 0 || ry <= 0) return false;
    const nx = (lx - cx) / rx;
    const ny = (ly - cy) / ry;
    return nx * nx + ny * ny <= 1;
  }

  return lx >= obj.x && lx <= obj.x + obj.width && ly >= obj.y && ly <= obj.y + obj.height;
}

export function objectContainsObject(container: BoardObject, child: BoardObject): boolean {
  const corners = getObjectCorners(child);
  return corners.every((p) => pointInRotatedRect(p.x, p.y, container));
}

function distancePointToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) {
    const sx = px - ax;
    const sy = py - ay;
    return Math.sqrt(sx * sx + sy * sy);
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  const ox = px - cx;
  const oy = py - cy;
  return Math.sqrt(ox * ox + oy * oy);
}

export function hitTestConnector(px: number, py: number, connector: BoardObject, objectsById: Map<string, BoardObject>, tolerance = 8): boolean {
  const { start, end } = getConnectorEndpoints(connector, objectsById);
  if (!start || !end) return false;
  return distancePointToSegment(px, py, start.x, start.y, end.x, end.y) <= tolerance;
}

export function getPortList(obj: BoardObject): Port[] {
  // New shape types (non-rectangle, non-ellipse) have no connector ports
  if (obj.type === 'shape') {
    const kind = (obj as ShapeObject).shapeKind;
    if (kind !== 'rectangle' && kind !== 'rounded-rectangle' && kind !== 'ellipse' && kind !== 'circle') {
      return [];
    }
  }

  const x = obj.x;
  const y = obj.y;
  const w = obj.width;
  const h = obj.height;
  const base: [string, number, number][] = [
    ['n', x + w / 2, y],
    ['e', x + w, y + h / 2],
    ['s', x + w / 2, y + h],
    ['w', x, y + h / 2],
    ['nw', x, y],
    ['ne', x + w, y],
    ['se', x + w, y + h],
    ['sw', x, y + h],
  ];

  const c = getObjectCenter(obj);
  const a = obj.rotation || 0;
  return base.map(([name, px, py]) => {
    const p = a ? rotatePoint(px, py, c.x, c.y, a) : { x: px, y: py };
    return { name, x: p.x, y: p.y };
  });
}

export function getPortPosition(obj: BoardObject, portName: string): Point | null {
  const ports = getPortList(obj);
  const port = ports.find((p) => p.name === portName);
  return port ? { x: port.x, y: port.y } : null;
}

export function findClosestPort(obj: BoardObject, px: number, py: number): Port | null {
  const ports = getPortList(obj);
  let best: Port | null = null;
  let bestDist = Infinity;
  for (const port of ports) {
    const dx = px - port.x;
    const dy = py - port.y;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = port;
    }
  }
  return best;
}

export function getConnectorEndpoints(connector: BoardObject, objectsById: Map<string, BoardObject>): { start: Point | null; end: Point | null } {
  const conn = connector as import('../types.js').Connector;
  const fromObj = conn.fromId ? objectsById.get(conn.fromId) ?? null : null;
  const toObj = conn.toId ? objectsById.get(conn.toId) ?? null : null;

  const start = fromObj && conn.fromPort
    ? getPortPosition(fromObj, conn.fromPort)
    : conn.fromPoint || null;

  const end = toObj && conn.toPort
    ? getPortPosition(toObj, conn.toPort)
    : conn.toPoint || null;

  return { start, end };
}

export function getFrameHitArea(px: number, py: number, frame: BoardObject): string | null {
  if (!pointInObject(px, py, frame)) return null;

  const c = getObjectCenter(frame);
  const local = inverseRotatePoint(px, py, c.x, c.y, frame.rotation || 0);
  const ly = local.y;
  const lx = local.x;

  const border = 12;
  const titleHeight = 32;

  if (ly <= frame.y + titleHeight) return 'title';

  const nearBorder =
    Math.abs(lx - frame.x) <= border ||
    Math.abs(lx - (frame.x + frame.width)) <= border ||
    Math.abs(ly - frame.y) <= border ||
    Math.abs(ly - (frame.y + frame.height)) <= border;

  return nearBorder ? 'border' : 'inside';
}

export function getRotationHandlePoint(bounds: Bounds): Point {
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y - ROTATION_HANDLE_OFFSET,
  };
}
