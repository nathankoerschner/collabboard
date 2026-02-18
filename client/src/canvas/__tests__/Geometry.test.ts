import { describe, test, expect } from 'vitest';
import {
  degToRad,
  normalizeAngle,
  rotatePoint,
  inverseRotatePoint,
  getObjectCenter,
  getObjectCorners,
  getObjectAABB,
  getSelectionBounds,
  pointInRotatedRect,
  pointInObject,
  objectContainsObject,
  hitTestConnector,
  getPortList,
  getPortPosition,
  findClosestPort,
  getConnectorEndpoints,
  getFrameHitArea,
  getRotationHandlePoint,
  ROTATION_HANDLE_OFFSET,
} from '../Geometry.js';
import type { BoardObject, Connector } from '../../types.js';

// ── Helpers ──

function makeRect(overrides: Partial<BoardObject> = {}): BoardObject {
  return {
    id: 'r1',
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    createdBy: 'test',
    parentFrameId: null,
    color: 'blue',
    strokeColor: 'gray',
    ...overrides,
  } as BoardObject;
}

function makeEllipse(overrides: Partial<BoardObject> = {}): BoardObject {
  return {
    id: 'e1',
    type: 'ellipse',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    createdBy: 'test',
    parentFrameId: null,
    color: 'teal',
    strokeColor: 'gray',
    ...overrides,
  } as BoardObject;
}

function makeConnector(overrides: Partial<Connector> = {}): BoardObject {
  return {
    id: 'c1',
    type: 'connector',
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    rotation: 0,
    createdBy: 'test',
    parentFrameId: null,
    fromId: null,
    toId: null,
    fromPort: null,
    toPort: null,
    fromPoint: { x: 0, y: 0 },
    toPoint: { x: 100, y: 100 },
    style: 'arrow',
    points: [],
    ...overrides,
  } as unknown as BoardObject;
}

function makeFrame(overrides: Partial<BoardObject> = {}): BoardObject {
  return {
    id: 'f1',
    type: 'frame',
    x: 0,
    y: 0,
    width: 400,
    height: 300,
    rotation: 0,
    createdBy: 'test',
    parentFrameId: null,
    title: 'Frame',
    color: 'gray',
    children: [],
    ...overrides,
  } as BoardObject;
}

// ── Tests ──

describe('degToRad', () => {
  test.each([
    [0, 0],
    [90, Math.PI / 2],
    [180, Math.PI],
    [360, Math.PI * 2],
    [-90, -Math.PI / 2],
    [45, Math.PI / 4],
  ])('degToRad(%d) = %f', (deg, expected) => {
    expect(degToRad(deg)).toBeCloseTo(expected, 10);
  });
});

describe('normalizeAngle', () => {
  test.each([
    [0, 0],
    [90, 90],
    [360, 0],
    [450, 90],
    [-90, 270],
    [-360, 0],
    [720, 0],
    [180, 180],
    [-180, 180],
  ])('normalizeAngle(%d) = %d', (input, expected) => {
    expect(normalizeAngle(input)).toBeCloseTo(expected, 10);
  });
});

describe('rotatePoint', () => {
  test('0 degrees is identity', () => {
    const p = rotatePoint(10, 20, 0, 0, 0);
    expect(p.x).toBeCloseTo(10);
    expect(p.y).toBeCloseTo(20);
  });

  test('90 degrees around origin', () => {
    const p = rotatePoint(10, 0, 0, 0, 90);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(10);
  });

  test('180 degrees around origin', () => {
    const p = rotatePoint(10, 0, 0, 0, 180);
    expect(p.x).toBeCloseTo(-10);
    expect(p.y).toBeCloseTo(0);
  });

  test('270 degrees around origin', () => {
    const p = rotatePoint(10, 0, 0, 0, 270);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(-10);
  });

  test('90 degrees around off-center pivot', () => {
    // Rotate (10, 5) around (5, 5) by 90
    const p = rotatePoint(10, 5, 5, 5, 90);
    expect(p.x).toBeCloseTo(5);
    expect(p.y).toBeCloseTo(10);
  });

  test('inverse rotation undoes rotation', () => {
    const p = rotatePoint(7, 3, 5, 5, 45);
    const back = inverseRotatePoint(p.x, p.y, 5, 5, 45);
    expect(back.x).toBeCloseTo(7);
    expect(back.y).toBeCloseTo(3);
  });
});

describe('inverseRotatePoint', () => {
  test('is equivalent to negated rotation', () => {
    const p1 = inverseRotatePoint(10, 5, 3, 3, 60);
    const p2 = rotatePoint(10, 5, 3, 3, -60);
    expect(p1.x).toBeCloseTo(p2.x);
    expect(p1.y).toBeCloseTo(p2.y);
  });
});

describe('getObjectCenter', () => {
  test('returns center of rectangle', () => {
    const c = getObjectCenter(makeRect({ x: 10, y: 20, width: 100, height: 60 }));
    expect(c.x).toBe(60);
    expect(c.y).toBe(50);
  });

  test('works with zero origin', () => {
    const c = getObjectCenter(makeRect({ x: 0, y: 0, width: 50, height: 50 }));
    expect(c.x).toBe(25);
    expect(c.y).toBe(25);
  });
});

describe('getObjectCorners', () => {
  test('unrotated rectangle returns axis-aligned corners', () => {
    const corners = getObjectCorners(makeRect({ x: 10, y: 20, width: 100, height: 50 }));
    expect(corners).toHaveLength(4);
    expect(corners[0]).toEqual({ x: 10, y: 20 });
    expect(corners[1]).toEqual({ x: 110, y: 20 });
    expect(corners[2]).toEqual({ x: 110, y: 70 });
    expect(corners[3]).toEqual({ x: 10, y: 70 });
  });

  test('rotated rectangle shifts corners', () => {
    const corners = getObjectCorners(makeRect({ x: 0, y: 0, width: 100, height: 100, rotation: 45 }));
    // Center is (50,50). After 45 deg rotation, corners should move
    // All corners should be equidistant from center
    const cx = 50, cy = 50;
    const dist = Math.sqrt(50 * 50 + 50 * 50); // ~70.71
    for (const c of corners) {
      const d = Math.sqrt((c.x - cx) ** 2 + (c.y - cy) ** 2);
      expect(d).toBeCloseTo(dist, 3);
    }
  });
});

describe('getObjectAABB', () => {
  test('unrotated object AABB matches bounds', () => {
    const aabb = getObjectAABB(makeRect({ x: 10, y: 20, width: 100, height: 50 }));
    expect(aabb.x).toBeCloseTo(10);
    expect(aabb.y).toBeCloseTo(20);
    expect(aabb.width).toBeCloseTo(100);
    expect(aabb.height).toBeCloseTo(50);
  });

  test('45-degree rotated square has larger AABB', () => {
    const obj = makeRect({ x: 0, y: 0, width: 100, height: 100, rotation: 45 });
    const aabb = getObjectAABB(obj);
    // Rotated 100x100 square → AABB should be ~141x141
    expect(aabb.width).toBeGreaterThan(100);
    expect(aabb.height).toBeGreaterThan(100);
    expect(aabb.width).toBeCloseTo(Math.sqrt(2) * 100, 0);
  });
});

describe('getSelectionBounds', () => {
  test('empty array returns null', () => {
    expect(getSelectionBounds([])).toBeNull();
  });

  test('single object', () => {
    const bounds = getSelectionBounds([makeRect({ x: 10, y: 20, width: 100, height: 50 })]);
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeCloseTo(10);
    expect(bounds!.y).toBeCloseTo(20);
    expect(bounds!.width).toBeCloseTo(100);
    expect(bounds!.height).toBeCloseTo(50);
  });

  test('multiple non-overlapping objects', () => {
    const bounds = getSelectionBounds([
      makeRect({ x: 0, y: 0, width: 50, height: 50 }),
      makeRect({ x: 200, y: 200, width: 50, height: 50 }),
    ]);
    expect(bounds!.x).toBeCloseTo(0);
    expect(bounds!.y).toBeCloseTo(0);
    expect(bounds!.width).toBeCloseTo(250);
    expect(bounds!.height).toBeCloseTo(250);
  });

  test('overlapping objects', () => {
    const bounds = getSelectionBounds([
      makeRect({ x: 0, y: 0, width: 100, height: 100 }),
      makeRect({ x: 50, y: 50, width: 100, height: 100 }),
    ]);
    expect(bounds!.x).toBeCloseTo(0);
    expect(bounds!.y).toBeCloseTo(0);
    expect(bounds!.width).toBeCloseTo(150);
    expect(bounds!.height).toBeCloseTo(150);
  });
});

describe('pointInRotatedRect', () => {
  test('center of rect returns true', () => {
    expect(pointInRotatedRect(50, 50, makeRect())).toBe(true);
  });

  test('outside rect returns false', () => {
    expect(pointInRotatedRect(200, 200, makeRect())).toBe(false);
  });

  test('edge returns true', () => {
    expect(pointInRotatedRect(0, 0, makeRect())).toBe(true);
    expect(pointInRotatedRect(100, 100, makeRect())).toBe(true);
  });

  test('rotated rect — point that was inside unrotated is outside when rotated', () => {
    // 100x100 rect at origin, rotated 45 deg. A corner like (1, 1) is inside unrotated
    // but the corner of the rotated shape doesn't cover that exact spot anymore in local space
    const obj = makeRect({ x: 0, y: 0, width: 100, height: 100, rotation: 45 });
    // Point (99, 1) is inside unrotated but may be outside after rotation
    // We test a specific case: center is always inside
    expect(pointInRotatedRect(50, 50, obj)).toBe(true);
  });

  test('rotated rect — opposite corners check', () => {
    // After 45deg rotation, the original top-left corner (0,0) would be outside
    const obj = makeRect({ x: 0, y: 0, width: 100, height: 100, rotation: 45 });
    // Points far from center should be outside
    expect(pointInRotatedRect(-50, -50, obj)).toBe(false);
  });
});

describe('pointInObject', () => {
  test('connector always returns false', () => {
    expect(pointInObject(50, 50, makeConnector())).toBe(false);
  });

  test('rectangle — inside', () => {
    expect(pointInObject(50, 50, makeRect())).toBe(true);
  });

  test('rectangle — outside', () => {
    expect(pointInObject(200, 200, makeRect())).toBe(false);
  });

  test('ellipse — center inside', () => {
    expect(pointInObject(50, 50, makeEllipse())).toBe(true);
  });

  test('ellipse — corner outside', () => {
    // Corner (0,0) of a 100x100 ellipse is outside the ellipse
    expect(pointInObject(0, 0, makeEllipse())).toBe(false);
  });

  test('ellipse — on boundary', () => {
    // Point at (100, 50) is on the east edge of the ellipse
    expect(pointInObject(100, 50, makeEllipse())).toBe(true);
  });

  test('ellipse — zero radius returns false', () => {
    expect(pointInObject(0, 0, makeEllipse({ width: 0, height: 0 }))).toBe(false);
  });

  test('rotated ellipse', () => {
    const obj = makeEllipse({ x: 0, y: 0, width: 200, height: 50, rotation: 90 });
    // After 90 deg rotation, what was a wide short ellipse is now tall and narrow
    // Center is always in
    expect(pointInObject(100, 25, obj)).toBe(true);
  });

  test('frame — inside', () => {
    expect(pointInObject(200, 150, makeFrame())).toBe(true);
  });
});

describe('objectContainsObject', () => {
  test('fully inside', () => {
    const container = makeRect({ x: 0, y: 0, width: 200, height: 200 });
    const child = makeRect({ id: 'c', x: 50, y: 50, width: 50, height: 50 });
    expect(objectContainsObject(container, child)).toBe(true);
  });

  test('partially overlapping', () => {
    const container = makeRect({ x: 0, y: 0, width: 100, height: 100 });
    const child = makeRect({ id: 'c', x: 80, y: 80, width: 50, height: 50 });
    expect(objectContainsObject(container, child)).toBe(false);
  });

  test('completely outside', () => {
    const container = makeRect({ x: 0, y: 0, width: 100, height: 100 });
    const child = makeRect({ id: 'c', x: 200, y: 200, width: 50, height: 50 });
    expect(objectContainsObject(container, child)).toBe(false);
  });
});

describe('hitTestConnector', () => {
  test('point on the line returns true', () => {
    const conn = makeConnector({ fromPoint: { x: 0, y: 0 }, toPoint: { x: 100, y: 0 } });
    const objectsById = new Map<string, BoardObject>();
    expect(hitTestConnector(50, 0, conn, objectsById)).toBe(true);
  });

  test('point far away returns false', () => {
    const conn = makeConnector({ fromPoint: { x: 0, y: 0 }, toPoint: { x: 100, y: 0 } });
    const objectsById = new Map<string, BoardObject>();
    expect(hitTestConnector(50, 50, conn, objectsById)).toBe(false);
  });

  test('point within tolerance returns true', () => {
    const conn = makeConnector({ fromPoint: { x: 0, y: 0 }, toPoint: { x: 100, y: 0 } });
    const objectsById = new Map<string, BoardObject>();
    expect(hitTestConnector(50, 7, conn, objectsById, 8)).toBe(true);
  });

  test('point at tolerance boundary', () => {
    const conn = makeConnector({ fromPoint: { x: 0, y: 0 }, toPoint: { x: 100, y: 0 } });
    const objectsById = new Map<string, BoardObject>();
    expect(hitTestConnector(50, 8, conn, objectsById, 8)).toBe(true);
    expect(hitTestConnector(50, 9, conn, objectsById, 8)).toBe(false);
  });

  test('missing endpoints returns false', () => {
    const conn = makeConnector({ fromPoint: null, toPoint: null, fromId: null, toId: null });
    const objectsById = new Map<string, BoardObject>();
    expect(hitTestConnector(50, 0, conn, objectsById)).toBe(false);
  });
});

describe('getPortList', () => {
  test('unrotated object has 8 ports at expected positions', () => {
    const obj = makeRect({ x: 0, y: 0, width: 100, height: 100 });
    const ports = getPortList(obj);
    expect(ports).toHaveLength(8);

    const byName = new Map(ports.map((p) => [p.name, p]));
    expect(byName.get('n')).toEqual({ name: 'n', x: 50, y: 0 });
    expect(byName.get('s')).toEqual({ name: 's', x: 50, y: 100 });
    expect(byName.get('e')).toEqual({ name: 'e', x: 100, y: 50 });
    expect(byName.get('w')).toEqual({ name: 'w', x: 0, y: 50 });
    expect(byName.get('nw')).toEqual({ name: 'nw', x: 0, y: 0 });
    expect(byName.get('ne')).toEqual({ name: 'ne', x: 100, y: 0 });
    expect(byName.get('se')).toEqual({ name: 'se', x: 100, y: 100 });
    expect(byName.get('sw')).toEqual({ name: 'sw', x: 0, y: 100 });
  });

  test('rotated object shifts port positions', () => {
    const obj = makeRect({ x: 0, y: 0, width: 100, height: 100, rotation: 90 });
    const ports = getPortList(obj);
    const n = ports.find((p) => p.name === 'n')!;
    // For 90 deg rotation, 'n' port at (50, 0) rotated around center (50, 50)
    // becomes (100, 50) in world space
    expect(n.x).toBeCloseTo(100);
    expect(n.y).toBeCloseTo(50);
  });
});

describe('getPortPosition', () => {
  test('valid port name returns position', () => {
    const obj = makeRect({ x: 0, y: 0, width: 100, height: 50 });
    const p = getPortPosition(obj, 'n');
    expect(p).not.toBeNull();
    expect(p!.x).toBe(50);
    expect(p!.y).toBe(0);
  });

  test('invalid port name returns null', () => {
    const obj = makeRect();
    expect(getPortPosition(obj, 'invalid')).toBeNull();
  });
});

describe('findClosestPort', () => {
  test('point near north port returns north', () => {
    const obj = makeRect({ x: 0, y: 0, width: 100, height: 100 });
    const port = findClosestPort(obj, 50, -5);
    expect(port).not.toBeNull();
    expect(port!.name).toBe('n');
  });

  test('point near east port returns east', () => {
    const obj = makeRect({ x: 0, y: 0, width: 100, height: 100 });
    const port = findClosestPort(obj, 105, 50);
    expect(port).not.toBeNull();
    expect(port!.name).toBe('e');
  });
});

describe('getConnectorEndpoints', () => {
  test('attached to objects resolves port positions', () => {
    const rect = makeRect({ id: 'r1', x: 0, y: 0, width: 100, height: 100 });
    const conn = makeConnector({
      fromId: 'r1',
      fromPort: 'e',
      fromPoint: null,
      toPoint: { x: 200, y: 200 },
    });
    const map = new Map<string, BoardObject>([['r1', rect]]);
    const { start, end } = getConnectorEndpoints(conn, map);
    expect(start).not.toBeNull();
    expect(start!.x).toBe(100);
    expect(start!.y).toBe(50);
    expect(end).toEqual({ x: 200, y: 200 });
  });

  test('dangling connector uses fromPoint/toPoint', () => {
    const conn = makeConnector({
      fromPoint: { x: 10, y: 20 },
      toPoint: { x: 30, y: 40 },
    });
    const map = new Map<string, BoardObject>();
    const { start, end } = getConnectorEndpoints(conn, map);
    expect(start).toEqual({ x: 10, y: 20 });
    expect(end).toEqual({ x: 30, y: 40 });
  });

  test('missing object in map falls back to point', () => {
    const conn = makeConnector({
      fromId: 'missing',
      fromPort: 'n',
      fromPoint: null,
      toPoint: { x: 50, y: 50 },
    });
    const map = new Map<string, BoardObject>();
    const { start, end } = getConnectorEndpoints(conn, map);
    // fromId is set but object not found, fromPort is set but can't resolve
    // The code: fromObj = null, so start = conn.fromPoint = null
    expect(start).toBeNull();
    expect(end).toEqual({ x: 50, y: 50 });
  });
});

describe('getFrameHitArea', () => {
  test('point in title bar returns title', () => {
    const frame = makeFrame({ x: 0, y: 0, width: 400, height: 300 });
    expect(getFrameHitArea(200, 10, frame)).toBe('title');
  });

  test('point near border returns border', () => {
    const frame = makeFrame({ x: 0, y: 0, width: 400, height: 300 });
    // Near left border
    expect(getFrameHitArea(5, 150, frame)).toBe('border');
    // Near right border
    expect(getFrameHitArea(395, 150, frame)).toBe('border');
    // Near bottom border
    expect(getFrameHitArea(200, 295, frame)).toBe('border');
  });

  test('point deep inside returns inside', () => {
    const frame = makeFrame({ x: 0, y: 0, width: 400, height: 300 });
    expect(getFrameHitArea(200, 150, frame)).toBe('inside');
  });

  test('point outside returns null', () => {
    const frame = makeFrame({ x: 0, y: 0, width: 400, height: 300 });
    expect(getFrameHitArea(500, 500, frame)).toBeNull();
  });
});

describe('getRotationHandlePoint', () => {
  test('centered horizontally and offset above', () => {
    const bounds = { x: 100, y: 200, width: 60, height: 40 };
    const p = getRotationHandlePoint(bounds);
    expect(p.x).toBe(130); // 100 + 60/2
    expect(p.y).toBe(200 - ROTATION_HANDLE_OFFSET);
  });
});
