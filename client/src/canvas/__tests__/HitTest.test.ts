import { describe, test, expect } from 'vitest';
import {
  hitTestObjects,
  hitTestHandle,
  hitTestRotationHandle,
  getHandlePositions,
  getConnectorHitEndpoint,
} from '../HitTest.js';
import type { BoardObject, Connector } from '../../types.js';

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
    toPoint: { x: 100, y: 0 },
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

describe('hitTestObjects', () => {
  test('returns topmost object hit (z-order)', () => {
    const r1 = makeRect({ id: 'r1', x: 0, y: 0, width: 100, height: 100 });
    const r2 = makeRect({ id: 'r2', x: 0, y: 0, width: 100, height: 100 });
    // r2 is later in z-order, so it's on top
    const result = hitTestObjects(50, 50, [r1, r2]);
    expect(result).not.toBeNull();
    expect(result!.object.id).toBe('r2');
    expect(result!.area).toBe('body');
  });

  test('miss returns null', () => {
    const r1 = makeRect({ x: 0, y: 0, width: 100, height: 100 });
    expect(hitTestObjects(200, 200, [r1])).toBeNull();
  });

  test('connector returns line area', () => {
    const conn = makeConnector({ fromPoint: { x: 0, y: 0 }, toPoint: { x: 100, y: 0 } });
    const result = hitTestObjects(50, 0, [conn]);
    expect(result).not.toBeNull();
    expect(result!.area).toBe('line');
  });

  test('frame returns title/border/inside', () => {
    const frame = makeFrame({ x: 0, y: 0, width: 400, height: 300 });
    // Title bar
    const titleHit = hitTestObjects(200, 10, [frame]);
    expect(titleHit!.area).toBe('title');

    // Inside
    const insideHit = hitTestObjects(200, 150, [frame]);
    expect(insideHit!.area).toBe('inside');
  });

  test('z-order priority: later objects occlude earlier', () => {
    const frame = makeFrame({ id: 'f1', x: 0, y: 0, width: 400, height: 300 });
    const rect = makeRect({ id: 'r1', x: 100, y: 100, width: 50, height: 50 });
    // Rect is on top (later in array)
    const result = hitTestObjects(125, 125, [frame, rect]);
    expect(result!.object.id).toBe('r1');
  });

  test('empty objects array returns null', () => {
    expect(hitTestObjects(50, 50, [])).toBeNull();
  });
});

describe('hitTestHandle', () => {
  test('hit nw handle', () => {
    const obj = makeRect({ x: 0, y: 0, width: 100, height: 100 });
    expect(hitTestHandle(0, 0, obj, 1)).toBe('nw');
  });

  test('hit se handle', () => {
    const obj = makeRect({ x: 0, y: 0, width: 100, height: 100 });
    expect(hitTestHandle(100, 100, obj, 1)).toBe('se');
  });

  test('hit n handle', () => {
    const obj = makeRect({ x: 0, y: 0, width: 100, height: 100 });
    expect(hitTestHandle(50, 0, obj, 1)).toBe('n');
  });

  test('miss returns null', () => {
    const obj = makeRect({ x: 0, y: 0, width: 100, height: 100 });
    expect(hitTestHandle(50, 50, obj, 1)).toBeNull();
  });

  test('connector always returns null', () => {
    const conn = makeConnector();
    expect(hitTestHandle(0, 0, conn, 1)).toBeNull();
  });

  test('respects scale factor', () => {
    const obj = makeRect({ x: 0, y: 0, width: 100, height: 100 });
    // At scale 0.5, handle hit area is larger in world space
    expect(hitTestHandle(0, 0, obj, 0.5)).toBe('nw');
  });
});

describe('hitTestRotationHandle', () => {
  test('inside radius returns true', () => {
    const bounds = { x: 0, y: 0, width: 100, height: 100 };
    // Rotation handle is at (50, -28)
    expect(hitTestRotationHandle(50, -28, bounds, 1)).toBe(true);
  });

  test('outside radius returns false', () => {
    const bounds = { x: 0, y: 0, width: 100, height: 100 };
    expect(hitTestRotationHandle(50, -50, bounds, 1)).toBe(false);
  });

  test('respects scale', () => {
    const bounds = { x: 0, y: 0, width: 100, height: 100 };
    // At smaller scale, radius in world coords is larger
    expect(hitTestRotationHandle(50, -28 + 15, bounds, 0.5)).toBe(true);
  });
});

describe('getHandlePositions', () => {
  test('returns 8 handles for unrotated object', () => {
    const obj = makeRect({ x: 0, y: 0, width: 100, height: 100 });
    const handles = getHandlePositions(obj);
    expect(handles).toHaveLength(8);
    const byName = new Map(handles.map(([name, x, y]) => [name, { x, y }]));
    expect(byName.get('nw')).toEqual({ x: 0, y: 0 });
    expect(byName.get('ne')).toEqual({ x: 100, y: 0 });
    expect(byName.get('se')).toEqual({ x: 100, y: 100 });
    expect(byName.get('sw')).toEqual({ x: 0, y: 100 });
    expect(byName.get('n')).toEqual({ x: 50, y: 0 });
    expect(byName.get('e')).toEqual({ x: 100, y: 50 });
    expect(byName.get('s')).toEqual({ x: 50, y: 100 });
    expect(byName.get('w')).toEqual({ x: 0, y: 50 });
  });

  test('rotated object shifts handle positions', () => {
    const obj = makeRect({ x: 0, y: 0, width: 100, height: 100, rotation: 90 });
    const handles = getHandlePositions(obj);
    const byName = new Map(handles.map(([name, x, y]) => [name, { x, y }]));
    // 'nw' (0,0) rotated 90 around center (50,50) → (100, 0)
    expect(byName.get('nw')!.x).toBeCloseTo(100);
    expect(byName.get('nw')!.y).toBeCloseTo(0);
  });
});

describe('getConnectorHitEndpoint', () => {
  test('hit start endpoint', () => {
    const conn = makeConnector({ fromPoint: { x: 0, y: 0 }, toPoint: { x: 100, y: 0 } });
    const map = new Map<string, BoardObject>();
    expect(getConnectorHitEndpoint(0, 0, conn, map, 1)).toBe('start');
  });

  test('hit end endpoint', () => {
    const conn = makeConnector({ fromPoint: { x: 0, y: 0 }, toPoint: { x: 100, y: 0 } });
    const map = new Map<string, BoardObject>();
    expect(getConnectorHitEndpoint(100, 0, conn, map, 1)).toBe('end');
  });

  test('miss both returns null', () => {
    const conn = makeConnector({ fromPoint: { x: 0, y: 0 }, toPoint: { x: 100, y: 0 } });
    const map = new Map<string, BoardObject>();
    expect(getConnectorHitEndpoint(50, 0, conn, map, 1)).toBeNull();
  });

  test('respects scale', () => {
    const conn = makeConnector({ fromPoint: { x: 0, y: 0 }, toPoint: { x: 100, y: 0 } });
    const map = new Map<string, BoardObject>();
    // At scale 0.5, the radius in world coords is larger (20)
    expect(getConnectorHitEndpoint(15, 0, conn, map, 0.5)).toBe('start');
  });
});

