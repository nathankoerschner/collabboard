import type { BoardObject, Bounds } from '../types.js';
import {
  getConnectorEndpoints,
  getFrameHitArea,
  getObjectCenter,
  getRotationHandlePoint,
  hitTestConnector,
  pointInObject,
  rotatePoint,
} from './Geometry.js';

const HANDLE_SIZE = 8;

export function hitTestObjects(wx: number, wy: number, objects: BoardObject[]): { object: BoardObject; area: string } | null {
  const objectsById = new Map(objects.map((o) => [o.id, o]));

  // Track the first frame whose interior was hit so we can fall through
  // to objects rendered below it (e.g. child frames or shapes).
  let firstFrameInside: { object: BoardObject; area: string } | null = null;

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
      if (area === 'title' || area === 'border') return { object: obj, area };
      // For 'inside', remember it but keep looking for children underneath
      if (area === 'inside' && !firstFrameInside) {
        firstFrameInside = { object: obj, area };
      }
      continue;
    }

    if (pointInObject(wx, wy, obj)) {
      return { object: obj, area: 'body' };
    }
  }

  return firstFrameInside;
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

export { HANDLE_SIZE };
