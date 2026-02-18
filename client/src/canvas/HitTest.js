import {
  getConnectorEndpoints,
  getFrameHitArea,
  getObjectCenter,
  getPortList,
  getRotationHandlePoint,
  hitTestConnector,
  pointInObject,
  rotatePoint,
} from './Geometry.js';

const HANDLE_SIZE = 8;

export function hitTestObjects(wx, wy, objects) {
  const objectsById = new Map(objects.map((o) => [o.id, o]));

  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i];

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

export function hitTestHandle(wx, wy, obj, scale = 1) {
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

export function hitTestRotationHandle(wx, wy, bounds, scale = 1) {
  const p = getRotationHandlePoint(bounds);
  const radius = 10 / scale;
  const dx = wx - p.x;
  const dy = wy - p.y;
  return dx * dx + dy * dy <= radius * radius;
}

export function getHandlePositions(obj) {
  const { x, y, width: w, height: h } = obj;
  const center = getObjectCenter(obj);
  const angle = obj.rotation || 0;

  const localHandles = [
    ['nw', x, y],
    ['n', x + w / 2, y],
    ['ne', x + w, y],
    ['e', x + w, y + h / 2],
    ['se', x + w, y + h],
    ['s', x + w / 2, y + h],
    ['sw', x, y + h],
    ['w', x, y + h / 2],
  ];

  return localHandles.map(([name, px, py]) => {
    const p = angle ? rotatePoint(px, py, center.x, center.y, angle) : { x: px, y: py };
    return [name, p.x, p.y];
  });
}

export function getConnectorHitEndpoint(wx, wy, connector, objectsById, scale = 1) {
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

export function hitTestPort(wx, wy, obj, scale = 1) {
  const ports = getPortList(obj);
  const radius = 8 / scale;
  for (const p of ports) {
    const dx = wx - p.x;
    const dy = wy - p.y;
    if (dx * dx + dy * dy <= radius * radius) return p;
  }
  return null;
}

export { HANDLE_SIZE };
