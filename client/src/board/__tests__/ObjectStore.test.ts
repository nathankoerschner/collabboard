import { describe, test, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { ObjectStore } from '../ObjectStore.js';
import type { BoardObject, Connector, Frame, StickyNote, TextObject } from '../../types.js';

let doc: Y.Doc;
let store: ObjectStore;

beforeEach(() => {
  doc = new Y.Doc();
  store = new ObjectStore(doc);
});

// ── Helpers ──

function createSticky(text = 'hello', extra: Record<string, unknown> = {}): BoardObject {
  return store.createObject('sticky', 100, 100, 150, 150, { text, ...extra });
}

function createRect(extra: Record<string, unknown> = {}): BoardObject {
  return store.createObject('rectangle', 0, 0, 100, 100, extra);
}

function createFrame(x = 0, y = 0, w = 400, h = 300, extra: Record<string, unknown> = {}): BoardObject {
  return store.createObject('frame', x, y, w, h, extra);
}

// ── Tests ──

describe('createObject', () => {
  test('creates sticky with defaults', () => {
    const obj = createSticky('test note');
    expect(obj.type).toBe('sticky');
    expect((obj as StickyNote).text).toBe('test note');
    expect((obj as StickyNote).color).toBe('yellow');
    expect(obj.rotation).toBe(0);
    expect(obj.parentFrameId).toBeNull();
  });

  test('creates rectangle with defaults', () => {
    const obj = store.createObject('rectangle', 10, 20, 100, 50);
    expect(obj.type).toBe('rectangle');
    expect(obj.x).toBe(10);
    expect(obj.y).toBe(20);
  });

  test('creates ellipse with defaults', () => {
    const obj = store.createObject('ellipse', 0, 0, 100, 80);
    expect(obj.type).toBe('ellipse');
  });

  test('creates text with defaults', () => {
    const obj = store.createObject('text', 0, 0, 200, 40);
    expect(obj.type).toBe('text');
    const t = obj as TextObject;
    expect(t.content).toBe('');
    expect(t.style).toEqual({ bold: false, italic: false, size: 'medium' });
  });

  test('creates connector with defaults', () => {
    const obj = store.createObject('connector', 0, 0, 0, 0, {
      fromPoint: { x: 0, y: 0 },
      toPoint: { x: 100, y: 100 },
      style: 'arrow',
      points: [],
    });
    expect(obj.type).toBe('connector');
    const c = obj as unknown as Connector;
    expect(c.fromId).toBeNull();
    expect(c.toId).toBeNull();
  });

  test('creates frame with defaults', () => {
    const obj = store.createObject('frame', 0, 0, 400, 300);
    expect(obj.type).toBe('frame');
    const f = obj as Frame;
    expect(f.title).toBe('Frame');
    expect(f.children).toEqual([]);
  });

  test('generates unique IDs', () => {
    const a = createSticky('a');
    const b = createSticky('b');
    expect(a.id).not.toBe(b.id);
  });

  test('object appears in getAll()', () => {
    const obj = createSticky();
    const all = store.getAll();
    expect(all.some((o) => o.id === obj.id)).toBe(true);
  });

  test('object appears in zOrder', () => {
    const obj = createSticky();
    let found = false;
    for (let i = 0; i < store.zOrder.length; i++) {
      if (store.zOrder.get(i) === obj.id) found = true;
    }
    expect(found).toBe(true);
  });
});

describe('getObject / getAll', () => {
  test('returns null for unknown ID', () => {
    expect(store.getObject('nonexistent')).toBeNull();
  });

  test('getAll returns frames first then others', () => {
    createRect();
    createFrame();
    createSticky();

    const all = store.getAll();
    const firstFrameIdx = all.findIndex((o) => o.type === 'frame');
    const firstNonFrameIdx = all.findIndex((o) => o.type !== 'frame');
    if (firstFrameIdx !== -1 && firstNonFrameIdx !== -1) {
      expect(firstFrameIdx).toBeLessThan(firstNonFrameIdx);
    }
  });
});

describe('updateObject', () => {
  test('patches fields', () => {
    const obj = createRect();
    store.updateObject(obj.id, { color: 'red' });
    const updated = store.getObject(obj.id)!;
    expect((updated as any).color).toBe('red');
  });

  test('enforces min size', () => {
    const obj = createRect();
    store.updateObject(obj.id, { width: 1, height: 5 });
    const updated = store.getObject(obj.id)!;
    expect(updated.width).toBe(24);
    expect(updated.height).toBe(24);
  });

  test('normalizes rotation', () => {
    const obj = createRect();
    store.updateObject(obj.id, { rotation: -90 });
    const updated = store.getObject(obj.id)!;
    expect(updated.rotation).toBe(270);
  });

  test('no-op for unknown ID', () => {
    expect(() => store.updateObject('nope', { color: 'red' })).not.toThrow();
  });
});

describe('moveObject / moveObjects', () => {
  test('moves single object', () => {
    const obj = createRect();
    store.moveObject(obj.id, 50, 50);
    const moved = store.getObject(obj.id)!;
    expect(moved.x).toBe(50);
    expect(moved.y).toBe(50);
  });

  test('moveObjects with dx=0, dy=0 is a no-op', () => {
    const obj = createRect();
    const before = store.getObject(obj.id)!;
    store.moveObjects([obj.id], 0, 0);
    const after = store.getObject(obj.id)!;
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
  });

  test('moving a frame also moves its children', () => {
    const frame = createFrame(0, 0, 400, 300);
    // Create a rect inside the frame
    const child = store.createObject('rectangle', 50, 50, 80, 80);
    // Force containment
    const childObj = store.getObject(child.id)!;

    // Move frame by dx=100, dy=100
    store.moveObjects([frame.id], 100, 100);

    const movedFrame = store.getObject(frame.id)!;
    expect(movedFrame.x).toBe(100);
    expect(movedFrame.y).toBe(100);

    // Child should also have moved if it was a frame descendant
    const movedChild = store.getObject(child.id)!;
    if (childObj.parentFrameId === frame.id) {
      expect(movedChild.x).toBe(150);
      expect(movedChild.y).toBe(150);
    }
  });

  test('moveObject with unknown ID does not throw', () => {
    expect(() => store.moveObject('nope', 10, 10)).not.toThrow();
  });
});

describe('resizeObject', () => {
  test('resizes object', () => {
    const obj = createRect();
    store.resizeObject(obj.id, 10, 20, 200, 150);
    const resized = store.getObject(obj.id)!;
    expect(resized.x).toBe(10);
    expect(resized.y).toBe(20);
    expect(resized.width).toBe(200);
    expect(resized.height).toBe(150);
  });

  test('enforces min size', () => {
    const obj = createRect();
    store.resizeObject(obj.id, 0, 0, 5, 5);
    const resized = store.getObject(obj.id)!;
    expect(resized.width).toBe(24);
    expect(resized.height).toBe(24);
  });

  test('ignores connectors', () => {
    const conn = store.createObject('connector', 0, 0, 0, 0, {
      fromPoint: { x: 0, y: 0 },
      toPoint: { x: 100, y: 100 },
      style: 'arrow',
      points: [],
    });
    store.resizeObject(conn.id, 10, 10, 200, 200);
    const after = store.getObject(conn.id)!;
    expect(after.width).toBe(0);
  });
});

describe('rotateObjects', () => {
  test('single object self-rotation', () => {
    const obj = createRect();
    store.rotateObjects([obj.id], 45);
    const rotated = store.getObject(obj.id)!;
    expect(rotated.rotation).toBeCloseTo(45);
  });

  test('rotation normalizes angle', () => {
    const obj = createRect();
    store.rotateObjects([obj.id], 400);
    const rotated = store.getObject(obj.id)!;
    expect(rotated.rotation).toBeCloseTo(40);
  });

  test('skips connectors', () => {
    const conn = store.createObject('connector', 0, 0, 0, 0, {
      fromPoint: { x: 0, y: 0 },
      toPoint: { x: 100, y: 100 },
      style: 'arrow',
      points: [],
    });
    store.rotateObjects([conn.id], 45);
    const after = store.getObject(conn.id)!;
    expect(after.rotation).toBe(0);
  });

  test('multi-object rotation around calculated pivot', () => {
    const a = store.createObject('rectangle', 0, 0, 100, 100);
    const b = store.createObject('rectangle', 200, 0, 100, 100);
    store.rotateObjects([a.id, b.id], 180);
    const ra = store.getObject(a.id)!;
    const rb = store.getObject(b.id)!;
    // After 180 rotation, positions should be swapped around the center
    expect(ra.rotation).toBeCloseTo(180);
    expect(rb.rotation).toBeCloseTo(180);
  });

  test('custom pivot', () => {
    const obj = store.createObject('rectangle', 0, 0, 100, 100);
    store.rotateObjects([obj.id], 90, { x: 0, y: 0 });
    const rotated = store.getObject(obj.id)!;
    expect(rotated.rotation).toBeCloseTo(90);
  });

  test('deltaAngle 0 is a no-op', () => {
    const obj = createRect();
    store.rotateObjects([obj.id], 0);
    const after = store.getObject(obj.id)!;
    expect(after.rotation).toBe(0);
  });

  test('empty ids is a no-op', () => {
    expect(() => store.rotateObjects([], 45)).not.toThrow();
  });
});

describe('updateText', () => {
  test('sticky updates text field', () => {
    const obj = createSticky('old');
    store.updateText(obj.id, 'new');
    const updated = store.getObject(obj.id) as StickyNote;
    expect(updated.text).toBe('new');
  });

  test('text object updates content field', () => {
    const obj = store.createObject('text', 0, 0, 200, 40);
    store.updateText(obj.id, 'hello world');
    const updated = store.getObject(obj.id) as TextObject;
    expect(updated.content).toBe('hello world');
  });

  test('unknown ID does not throw', () => {
    expect(() => store.updateText('nope', 'val')).not.toThrow();
  });
});

describe('updateTextStyle', () => {
  test('merges partial style', () => {
    const obj = store.createObject('text', 0, 0, 200, 40);
    store.updateTextStyle(obj.id, { bold: true });
    const updated = store.getObject(obj.id) as TextObject;
    expect(updated.style.bold).toBe(true);
    expect(updated.style.italic).toBe(false);
  });

  test('ignores non-text objects', () => {
    const obj = createRect();
    expect(() => store.updateTextStyle(obj.id, { bold: true })).not.toThrow();
  });
});

describe('updateColor', () => {
  test('updates color field', () => {
    const obj = createRect();
    store.updateColor(obj.id, 'red');
    const updated = store.getObject(obj.id)!;
    expect((updated as any).color).toBe('red');
  });
});

describe('updateConnectorEndpoint', () => {
  test('attach side sets objectId/port, clears point', () => {
    const rect = createRect();
    const conn = store.startConnector(0, 0);
    store.updateConnectorEndpoint(conn.id, 'start', { objectId: rect.id, port: 'n' });
    const updated = store.getObject(conn.id) as unknown as Connector;
    expect(updated.fromId).toBe(rect.id);
    expect(updated.fromPort).toBe('n');
    expect(updated.fromPoint).toBeNull();
  });

  test('point side sets point, clears objectId/port', () => {
    const conn = store.startConnector(0, 0);
    store.updateConnectorEndpoint(conn.id, 'end', { point: { x: 50, y: 60 } });
    const updated = store.getObject(conn.id) as unknown as Connector;
    expect(updated.toId).toBeNull();
    expect(updated.toPort).toBeNull();
    expect(updated.toPoint).toEqual({ x: 50, y: 60 });
  });

  test('ignores non-connector', () => {
    const obj = createRect();
    expect(() => store.updateConnectorEndpoint(obj.id, 'start', { point: { x: 0, y: 0 } })).not.toThrow();
  });
});

describe('startConnector', () => {
  test('creates connector with from/to point at given coords', () => {
    const conn = store.startConnector(10, 20);
    expect(conn.type).toBe('connector');
    const c = conn as unknown as Connector;
    expect(c.fromPoint).toEqual({ x: 10, y: 20 });
    expect(c.toPoint).toEqual({ x: 10, y: 20 });
  });
});

describe('deleteObjects', () => {
  test('single delete', () => {
    const obj = createRect();
    store.deleteObjects([obj.id]);
    expect(store.getObject(obj.id)).toBeNull();
  });

  test('batch delete', () => {
    const a = createRect();
    const b = createSticky();
    store.deleteObjects([a.id, b.id]);
    expect(store.getObject(a.id)).toBeNull();
    expect(store.getObject(b.id)).toBeNull();
  });

  test('frame cascade deletes children', () => {
    const frame = createFrame(0, 0, 400, 300);
    const child = store.createObject('rectangle', 50, 50, 80, 80);
    // Check if the child was auto-parented
    const childObj = store.getObject(child.id)!;
    if (childObj.parentFrameId === frame.id) {
      store.deleteObjects([frame.id]);
      expect(store.getObject(child.id)).toBeNull();
    }
  });

  test('connector detachment when attached object is deleted', () => {
    const rect = createRect();
    const conn = store.startConnector(0, 0);
    store.updateConnectorEndpoint(conn.id, 'start', { objectId: rect.id, port: 'e' });

    store.deleteObjects([rect.id]);

    const updatedConn = store.getObject(conn.id) as unknown as Connector;
    expect(updatedConn.fromId).toBeNull();
    expect(updatedConn.fromPort).toBeNull();
    // Should have a fallback fromPoint
  });

  test('removes from zOrder', () => {
    const obj = createRect();
    const id = obj.id;
    store.deleteObjects([id]);
    let found = false;
    for (let i = 0; i < store.zOrder.length; i++) {
      if (store.zOrder.get(i) === id) found = true;
    }
    expect(found).toBe(false);
  });

  test('empty array is a no-op', () => {
    expect(() => store.deleteObjects([])).not.toThrow();
  });
});

describe('bringToFront', () => {
  test('moves object to end of zOrder', () => {
    const a = createRect();
    const b = createSticky();
    // a is first, b is second. Bring a to front.
    store.bringToFront(a.id);
    const lastIdx = store.zOrder.length - 1;
    expect(store.zOrder.get(lastIdx)).toBe(a.id);
  });

  test('already-at-front is a no-op', () => {
    createRect();
    createSticky('last');
    const all = store.getAll();
    const lastObj = all[all.length - 1]!;
    store.bringToFront(lastObj.id);
    const lastIdx = store.zOrder.length - 1;
    expect(store.zOrder.get(lastIdx)).toBe(lastObj.id);
  });
});

describe('duplicateSelection', () => {
  test('cloned objects get new IDs', () => {
    const obj = createRect();
    const newIds = store.duplicateSelection([obj.id]);
    expect(newIds).toHaveLength(1);
    expect(newIds[0]).not.toBe(obj.id);
    expect(store.getObject(newIds[0]!)).not.toBeNull();
  });

  test('connector fromId/toId are remapped', () => {
    const a = createRect();
    const b = store.createObject('rectangle', 200, 0, 100, 100);
    const conn = store.startConnector(0, 0);
    store.updateConnectorEndpoint(conn.id, 'start', { objectId: a.id, port: 'e' });
    store.updateConnectorEndpoint(conn.id, 'end', { objectId: b.id, port: 'w' });

    const newIds = store.duplicateSelection([a.id, b.id, conn.id]);
    expect(newIds).toHaveLength(3);

    // Find the cloned connector
    for (const id of newIds) {
      const obj = store.getObject(id)!;
      if (obj.type === 'connector') {
        const c = obj as unknown as Connector;
        // fromId and toId should be remapped to new IDs, not the originals
        if (c.fromId) {
          expect(newIds).toContain(c.fromId);
          expect(c.fromId).not.toBe(a.id);
        }
        if (c.toId) {
          expect(newIds).toContain(c.toId);
          expect(c.toId).not.toBe(b.id);
        }
      }
    }
  });

  test('offset is applied', () => {
    const obj = store.createObject('rectangle', 100, 100, 50, 50);
    const newIds = store.duplicateSelection([obj.id], { x: 30, y: 30 });
    const cloned = store.getObject(newIds[0]!)!;
    expect(cloned.x).toBe(130);
    expect(cloned.y).toBe(130);
  });
});

describe('serializeSelection / pasteSerialized', () => {
  test('connectors with one end outside selection become dangling', () => {
    const inside = createRect();
    const outside = store.createObject('rectangle', 500, 500, 100, 100);
    const conn = store.startConnector(0, 0);
    store.updateConnectorEndpoint(conn.id, 'start', { objectId: inside.id, port: 'e' });
    store.updateConnectorEndpoint(conn.id, 'end', { objectId: outside.id, port: 'w' });

    const serialized = store.serializeSelection([inside.id, conn.id]);
    const connSerialized = serialized.find((o) => o.type === 'connector') as unknown as Connector;
    expect(connSerialized.fromId).toBe(inside.id); // inside selection
    expect(connSerialized.toId).toBeNull(); // outside selection → dangling
  });

  test('empty input returns []', () => {
    expect(store.pasteSerialized([])).toEqual([]);
  });

  test('paste at absolute position', () => {
    const obj = store.createObject('rectangle', 0, 0, 100, 100);
    const serialized = store.serializeSelection([obj.id]);
    const newIds = store.pasteSerialized(serialized, { x: 500, y: 500 }, false);
    const pasted = store.getObject(newIds[0]!)!;
    // Should be centered around (500, 500)
    expect(pasted.x).toBeCloseTo(450);
    expect(pasted.y).toBeCloseTo(450);
  });
});

describe('containment', () => {
  test('creating an object inside a frame auto-parents it', () => {
    const frame = createFrame(0, 0, 400, 300);
    const child = store.createObject('rectangle', 50, 50, 80, 80);
    const childObj = store.getObject(child.id)!;
    expect(childObj.parentFrameId).toBe(frame.id);
  });

  test('creating an object outside a frame does not parent it', () => {
    createFrame(0, 0, 100, 100);
    const child = store.createObject('rectangle', 500, 500, 80, 80);
    const childObj = store.getObject(child.id)!;
    expect(childObj.parentFrameId).toBeNull();
  });

  test('moving object out of frame un-parents it', () => {
    const frame = createFrame(0, 0, 400, 300);
    const child = store.createObject('rectangle', 50, 50, 80, 80);
    expect(store.getObject(child.id)!.parentFrameId).toBe(frame.id);

    store.moveObject(child.id, 1000, 1000);
    expect(store.getObject(child.id)!.parentFrameId).toBeNull();
  });

  test('picks smallest containing frame', () => {
    /* bigFrame = */ createFrame(0, 0, 500, 500);
    const smallFrame = store.createObject('frame', 50, 50, 200, 200);
    const child = store.createObject('rectangle', 100, 100, 50, 50);
    const childObj = store.getObject(child.id)!;
    expect(childObj.parentFrameId).toBe(smallFrame.id);
  });
});

describe('getAttachableAtPoint', () => {
  test('finds nearest port when within range', () => {
    const rect = store.createObject('rectangle', 0, 0, 100, 100);
    const result = store.getAttachableAtPoint(100, 50);
    expect(result).not.toBeNull();
    expect(result!.object.id).toBe(rect.id);
    expect(result!.port.name).toBe('e');
  });

  test('returns null when too far from any port', () => {
    store.createObject('rectangle', 0, 0, 100, 100);
    const result = store.getAttachableAtPoint(500, 500);
    expect(result).toBeNull();
  });

  test('excludes specified ID', () => {
    const rect = store.createObject('rectangle', 0, 0, 100, 100);
    const result = store.getAttachableAtPoint(100, 50, rect.id);
    expect(result).toBeNull();
  });
});
