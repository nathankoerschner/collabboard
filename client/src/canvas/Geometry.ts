import type { BoardObject, Bounds, Point, Port, ShapeObject, TableObject } from '../types.js';
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
  const c = getOffscreenCtx();
  return c.isPointInPath(path, px, py);
}

let _offscreenCtx: CanvasRenderingContext2D | null = null;
export function getOffscreenCtx(): CanvasRenderingContext2D {
  if (!_offscreenCtx) {
    const canvas = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(1, 1)
      : document.createElement('canvas');
    _offscreenCtx = (canvas as HTMLCanvasElement).getContext('2d')!;
  }
  return _offscreenCtx;
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
  // Text objects have no connector ports
  if (obj.type === 'text') return [];

  // New shape types (non-rectangle, non-ellipse) have no connector ports
  if (obj.type === 'shape') {
    const kind = (obj as ShapeObject).shapeKind;
    if (kind !== 'rectangle' && kind !== 'rounded-rectangle' && kind !== 'ellipse' && kind !== 'circle') {
      return [];
    }
  }

  // Table objects: generate per-row ports on left and right sides
  if (obj.type === 'table') {
    return getTableRowPorts(obj as TableObject);
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

/** Generate connector ports on left and right side of each table row. */
export function getTableRowPorts(table: TableObject): Port[] {
  const TITLE_HEIGHT = 28;
  const rows = table.rows || [];
  const rowHeights = table.rowHeights || {};
  const x = table.x;
  const w = table.width;
  const c = getObjectCenter(table);
  const a = table.rotation || 0;

  const ports: Port[] = [];
  let rowY = table.y + TITLE_HEIGHT;
  for (const rowId of rows) {
    const rh = rowHeights[rowId] || 32;
    const centerY = rowY + rh / 2;
    const leftPt = a ? rotatePoint(x, centerY, c.x, c.y, a) : { x, y: centerY };
    const rightPt = a ? rotatePoint(x + w, centerY, c.x, c.y, a) : { x: x + w, y: centerY };
    ports.push({ name: `row:${rowId}:w`, x: leftPt.x, y: leftPt.y });
    ports.push({ name: `row:${rowId}:e`, x: rightPt.x, y: rightPt.y });
    rowY += rh;
  }
  return ports;
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

// ── Perimeter Parameterization ──

const ELLIPSE_LUT_SAMPLES = 64;

function buildEllipseArcLengthLUT(rx: number, ry: number): number[] {
  const N = ELLIPSE_LUT_SAMPLES;
  const lut: number[] = [0];
  const startTheta = -Math.PI / 2;
  let prevX = Math.cos(startTheta) * rx;
  let prevY = Math.sin(startTheta) * ry;

  for (let i = 1; i <= N; i++) {
    const theta = startTheta + (i / N) * Math.PI * 2;
    const x = Math.cos(theta) * rx;
    const y = Math.sin(theta) * ry;
    const dx = x - prevX;
    const dy = y - prevY;
    lut.push(lut[i - 1]! + Math.sqrt(dx * dx + dy * dy));
    prevX = x;
    prevY = y;
  }
  return lut;
}

/** Map t ∈ [0,1] clockwise from top-left along rect perimeter → world-space Point */
export function perimeterPointRect(obj: BoardObject, t: number): Point {
  const w = obj.width;
  const h = obj.height;
  const P = 2 * (w + h);
  const d = ((t % 1) + 1) % 1 * P;

  let lx: number, ly: number;
  if (d <= w) {
    lx = obj.x + d;
    ly = obj.y;
  } else if (d <= w + h) {
    lx = obj.x + w;
    ly = obj.y + (d - w);
  } else if (d <= 2 * w + h) {
    lx = obj.x + w - (d - w - h);
    ly = obj.y + h;
  } else {
    lx = obj.x;
    ly = obj.y + h - (d - 2 * w - h);
  }

  const c = getObjectCenter(obj);
  const angle = obj.rotation || 0;
  if (angle) return rotatePoint(lx, ly, c.x, c.y, angle);
  return { x: lx, y: ly };
}

/** Arc-length parameterized ellipse perimeter point, t ∈ [0,1] clockwise from top */
export function perimeterPointEllipse(obj: BoardObject, t: number): Point {
  const rx = obj.width / 2;
  const ry = obj.height / 2;
  const cx = obj.x + rx;
  const cy = obj.y + ry;

  const lut = buildEllipseArcLengthLUT(rx, ry);
  const totalLen = lut[ELLIPSE_LUT_SAMPLES]!;
  const targetLen = ((t % 1) + 1) % 1 * totalLen;

  let lo = 0;
  let hi = ELLIPSE_LUT_SAMPLES;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (lut[mid]! < targetLen) lo = mid + 1;
    else hi = mid;
  }

  const segIdx = Math.max(0, lo - 1);
  const segStart = lut[segIdx]!;
  const segEnd = lut[segIdx + 1] ?? totalLen;
  const segLen = segEnd - segStart;
  const frac = segLen > 0 ? (targetLen - segStart) / segLen : 0;

  const startTheta = -Math.PI / 2;
  const theta = startTheta + ((segIdx + frac) / ELLIPSE_LUT_SAMPLES) * Math.PI * 2;
  const lx = cx + Math.cos(theta) * rx;
  const ly = cy + Math.sin(theta) * ry;

  const center = getObjectCenter(obj);
  const angle = obj.rotation || 0;
  if (angle) return rotatePoint(lx, ly, center.x, center.y, angle);
  return { x: lx, y: ly };
}

// ── Shape (Path2D) perimeter via ray-casting ──

const SHAPE_PERIM_SAMPLES = 128;

/**
 * Sample SHAPE_PERIM_SAMPLES points on a Path2D shape outline by casting rays
 * from the center outward at evenly-spaced angles, binary-searching for the
 * boundary. Returns local-space points (no rotation applied).
 */
function sampleShapeOutline(obj: BoardObject): Point[] {
  const def = SHAPE_DEFS.get((obj as ShapeObject).shapeKind);
  if (!def) return [];

  const path = def.path(obj.x, obj.y, obj.width, obj.height);
  const ctx = getOffscreenCtx();
  const cx = obj.x + obj.width / 2;
  const cy = obj.y + obj.height / 2;
  const maxR = Math.sqrt(obj.width * obj.width + obj.height * obj.height);

  const points: Point[] = [];
  // Start from top (-π/2) going clockwise, matching rect convention
  const startAngle = -Math.PI / 2;

  for (let i = 0; i < SHAPE_PERIM_SAMPLES; i++) {
    const angle = startAngle + (i / SHAPE_PERIM_SAMPLES) * Math.PI * 2;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);

    // Binary search: find the boundary along this ray
    let lo = 0;
    let hi = maxR;
    for (let step = 0; step < 20; step++) {
      const mid = (lo + hi) / 2;
      if (ctx.isPointInPath(path, cx + dx * mid, cy + dy * mid)) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    points.push({ x: cx + dx * lo, y: cy + dy * lo });
  }
  return points;
}

/** Build arc-length LUT from sampled outline points */
function buildShapeArcLengthLUT(pts: Point[]): number[] {
  const n = pts.length;
  const lut = new Array<number>(n + 1);
  lut[0] = 0;
  for (let i = 1; i <= n; i++) {
    const prev = pts[i - 1]!;
    const curr = pts[i % n]!;
    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;
    lut[i] = lut[i - 1]! + Math.sqrt(dx * dx + dy * dy);
  }
  return lut;
}

/** Map t → world-space point on a Path2D shape perimeter */
function perimeterPointShape(obj: BoardObject, t: number): Point {
  const pts = sampleShapeOutline(obj);
  if (pts.length === 0) return perimeterPointRect(obj, t);

  const lut = buildShapeArcLengthLUT(pts);
  const totalLen = lut[pts.length]!;
  const targetLen = ((t % 1) + 1) % 1 * totalLen;

  // Binary search in LUT
  let lo = 0;
  let hi = pts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (lut[mid]! < targetLen) lo = mid + 1;
    else hi = mid;
  }

  const segIdx = Math.max(0, lo - 1);
  const segStart = lut[segIdx]!;
  const segEnd = lut[segIdx + 1] ?? totalLen;
  const segLen = segEnd - segStart;
  const frac = segLen > 0 ? (targetLen - segStart) / segLen : 0;

  const a = pts[segIdx]!;
  const b = pts[(segIdx + 1) % pts.length]!;
  const lx = a.x + frac * (b.x - a.x);
  const ly = a.y + frac * (b.y - a.y);

  // Apply rotation
  const angle = obj.rotation || 0;
  if (angle) {
    const center = getObjectCenter(obj);
    return rotatePoint(lx, ly, center.x, center.y, angle);
  }
  return { x: lx, y: ly };
}

/** Inverse: local point → closest t on Path2D shape perimeter */
function nearestPerimeterTShape(obj: BoardObject, lx: number, ly: number): number {
  const pts = sampleShapeOutline(obj);
  if (pts.length === 0) return nearestPerimeterTRect(obj, lx, ly);

  const lut = buildShapeArcLengthLUT(pts);
  const totalLen = lut[pts.length]!;

  let bestDist = Infinity;
  let bestArcLen = 0;

  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    const edx = b.x - a.x;
    const edy = b.y - a.y;
    const segLen = Math.sqrt(edx * edx + edy * edy);
    if (segLen === 0) continue;

    const t = Math.max(0, Math.min(1, ((lx - a.x) * edx + (ly - a.y) * edy) / (segLen * segLen)));
    const cx = a.x + t * edx;
    const cy = a.y + t * edy;
    const dist = (lx - cx) * (lx - cx) + (ly - cy) * (ly - cy);

    if (dist < bestDist) {
      bestDist = dist;
      bestArcLen = lut[i]! + t * segLen;
    }
  }

  return totalLen > 0 ? bestArcLen / totalLen : 0;
}

/** Dispatcher: perimeterPoint for any object type */
export function perimeterPoint(obj: BoardObject, t: number): Point {
  if (obj.type === 'ellipse') return perimeterPointEllipse(obj, t);
  if (obj.type === 'shape') {
    const kind = (obj as ShapeObject).shapeKind;
    if (kind === 'ellipse' || kind === 'circle') return perimeterPointEllipse(obj, t);
    return perimeterPointShape(obj, t);
  }
  return perimeterPointRect(obj, t);
}

/** Inverse: world point → closest t on rect perimeter */
function nearestPerimeterTRect(obj: BoardObject, lx: number, ly: number): number {
  const ox = obj.x;
  const oy = obj.y;
  const w = obj.width;
  const h = obj.height;
  const P = 2 * (w + h);

  const edges: [number, number, number, number, number][] = [
    [ox, oy, ox + w, oy, 0],
    [ox + w, oy, ox + w, oy + h, w],
    [ox + w, oy + h, ox, oy + h, w + h],
    [ox, oy + h, ox, oy, 2 * w + h],
  ];

  let bestDist = Infinity;
  let bestD = 0;

  for (const [ax, ay, bx, by, dOffset] of edges) {
    const edx = bx - ax;
    const edy = by - ay;
    const segLen = Math.sqrt(edx * edx + edy * edy);
    if (segLen === 0) continue;

    const t = Math.max(0, Math.min(1, ((lx - ax) * edx + (ly - ay) * edy) / (segLen * segLen)));
    const cx = ax + t * edx;
    const cy = ay + t * edy;
    const dist = (lx - cx) * (lx - cx) + (ly - cy) * (ly - cy);

    if (dist < bestDist) {
      bestDist = dist;
      bestD = dOffset + t * segLen;
    }
  }

  return bestD / P;
}

/** Inverse: world point → closest t on ellipse perimeter */
function nearestPerimeterTEllipse(obj: BoardObject, lx: number, ly: number): number {
  const cx = obj.x + obj.width / 2;
  const cy = obj.y + obj.height / 2;
  const rx = obj.width / 2;
  const ry = obj.height / 2;

  const angle = Math.atan2(ly - cy, lx - cx);
  const startTheta = -Math.PI / 2;
  let angleFrac = (angle - startTheta) / (Math.PI * 2);
  angleFrac = ((angleFrac % 1) + 1) % 1;

  const lut = buildEllipseArcLengthLUT(rx, ry);
  const totalLen = lut[ELLIPSE_LUT_SAMPLES]!;

  const samplePos = angleFrac * ELLIPSE_LUT_SAMPLES;
  const lo = Math.floor(samplePos);
  const hi = Math.min(lo + 1, ELLIPSE_LUT_SAMPLES);
  const frac = samplePos - lo;
  const arcLen = lut[lo]! + frac * (lut[hi]! - lut[lo]!);

  return arcLen / totalLen;
}

/** Inverse: world point → closest perimeter t for any object */
export function nearestPerimeterT(obj: BoardObject, px: number, py: number): number {
  const c = getObjectCenter(obj);
  const local = inverseRotatePoint(px, py, c.x, c.y, obj.rotation || 0);

  if (obj.type === 'ellipse') return nearestPerimeterTEllipse(obj, local.x, local.y);
  if (obj.type === 'shape') {
    const kind = (obj as ShapeObject).shapeKind;
    if (kind === 'ellipse' || kind === 'circle') return nearestPerimeterTEllipse(obj, local.x, local.y);
    return nearestPerimeterTShape(obj, local.x, local.y);
  }
  return nearestPerimeterTRect(obj, local.x, local.y);
}

// ── Connector Endpoints ──

export function getConnectorEndpoints(connector: BoardObject, objectsById: Map<string, BoardObject>): { start: Point | null; end: Point | null } {
  const conn = connector as import('../types.js').Connector;
  const fromObj = conn.fromId ? objectsById.get(conn.fromId) ?? null : null;
  const toObj = conn.toId ? objectsById.get(conn.toId) ?? null : null;

  // Resolution order: fromT → fromPort → fromPoint
  let start: Point | null;
  if (fromObj && conn.fromT != null) {
    start = perimeterPoint(fromObj, conn.fromT);
  } else if (fromObj && conn.fromPort) {
    start = getPortPosition(fromObj, conn.fromPort);
  } else {
    start = conn.fromPoint || null;
  }

  let end: Point | null;
  if (toObj && conn.toT != null) {
    end = perimeterPoint(toObj, conn.toT);
  } else if (toObj && conn.toPort) {
    end = getPortPosition(toObj, conn.toPort);
  } else {
    end = conn.toPoint || null;
  }

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
    x: bounds.x - ROTATION_HANDLE_OFFSET,
    y: bounds.y + bounds.height / 2,
  };
}
