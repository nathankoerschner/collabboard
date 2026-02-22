import { describe, test, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { BoardToolRunner } from '../boardTools.js';

let doc: Y.Doc;
let runner: BoardToolRunner;

beforeEach(() => {
  doc = new Y.Doc();
  runner = BoardToolRunner.fromYDoc(doc, { viewportCenter: { x: 500, y: 500 } });
});

// ── Helpers ──

function createSticky(text = 'hello', extra: Record<string, unknown> = {}): { id: string } {
  return runner.createStickyNote({ text, ...extra });
}

function createShape(type = 'rectangle', extra: Record<string, unknown> = {}): { id: string } {
  return runner.createShape({ type, ...extra });
}

// ── Tests ──

describe('invoke', () => {
  test('dispatches to correct method', () => {
    const result = runner.invoke('createStickyNote', { text: 'hi' }) as { id: string };
    expect(result.id).toBeTruthy();
  });

  test('unknown tool throws', () => {
    expect(() => runner.invoke('nonexistent', {})).toThrow('Unsupported tool');
  });

  test('records tool call', () => {
    runner.invoke('createStickyNote', { text: 'hi' });
    expect(runner.toolCalls).toHaveLength(1);
    expect(runner.toolCalls[0]!.toolName).toBe('createStickyNote');
  });
});

describe('createStickyNote', () => {
  test('default placement uses viewport center grid', () => {
    const result = createSticky('note1');
    const obj = runner.objects.get(result.id)!;
    expect(obj.type).toBe('sticky');
    expect(obj.text).toBe('note1');
    // Should be near viewport center
    expect(typeof obj.x).toBe('number');
    expect(typeof obj.y).toBe('number');
  });

  test('explicit x/y', () => {
    const result = runner.createStickyNote({ text: 'hi', x: 100, y: 200 });
    const obj = runner.objects.get(result.id)!;
    expect(obj.x).toBe(100);
    expect(obj.y).toBe(200);
  });

  test('default color is yellow', () => {
    const result = createSticky();
    const obj = runner.objects.get(result.id)!;
    expect(obj.color).toBe('yellow');
    expect(obj.width).toBe(150);
    expect(obj.height).toBe(150);
  });

  test('custom color', () => {
    const result = runner.createStickyNote({ text: 'hi', color: 'blue' });
    const obj = runner.objects.get(result.id)!;
    expect(obj.color).toBe('blue');
  });

  test('custom size', () => {
    const result = runner.createStickyNote({ text: 'hi', width: 220, height: 180 });
    const obj = runner.objects.get(result.id)!;
    expect(obj.width).toBe(220);
    expect(obj.height).toBe(180);
  });

  test('is tracked in createdIds', () => {
    const result = createSticky();
    expect(runner.createdIds.has(result.id)).toBe(true);
  });
});

describe('createShape', () => {
  test('rectangle defaults', () => {
    const result = createShape('rectangle');
    const obj = runner.objects.get(result.id)!;
    expect(obj.type).toBe('shape');
    expect(obj.shapeKind).toBe('rectangle');
    expect(obj.color).toBe('blue');
  });

  test('ellipse defaults', () => {
    const result = createShape('ellipse');
    const obj = runner.objects.get(result.id)!;
    expect(obj.type).toBe('shape');
    expect(obj.shapeKind).toBe('ellipse');
    expect(obj.color).toBe('teal');
  });

  test('min/max size clamping', () => {
    const result = runner.createShape({ type: 'rectangle', width: 1, height: 5000 });
    const obj = runner.objects.get(result.id)!;
    expect(obj.width).toBe(24);
    expect(obj.height).toBe(2000);
  });
});

describe('createFrame', () => {
  test('default title', () => {
    const result = runner.createFrame({});
    const obj = runner.objects.get(result.id)!;
    expect(obj.title).toBe('Frame');
  });

  test('custom title', () => {
    const result = runner.createFrame({ title: 'My Frame' });
    const obj = runner.objects.get(result.id)!;
    expect(obj.title).toBe('My Frame');
  });

  test('size clamping', () => {
    const result = runner.createFrame({ width: 10, height: 10 });
    const obj = runner.objects.get(result.id)!;
    expect(obj.width).toBe(120);
    expect(obj.height).toBe(120);
  });
});

describe('createConnector', () => {
  test('fromId/toId referencing existing objects', () => {
    const a = createShape('rectangle');
    const b = createShape('rectangle');
    const conn = runner.createConnector({ fromId: a.id, toId: b.id });
    const obj = runner.objects.get(conn.id)!;
    expect(obj.fromId).toBe(a.id);
    expect(obj.toId).toBe(b.id);
  });

  test('dangling with fromPoint/toPoint', () => {
    const conn = runner.createConnector({
      fromPoint: { x: 10, y: 20 },
      toPoint: { x: 30, y: 40 },
    });
    const obj = runner.objects.get(conn.id)!;
    expect(obj.fromPoint).toEqual({ x: 10, y: 20 });
    expect(obj.toPoint).toEqual({ x: 30, y: 40 });
  });

  test('invalid IDs are ignored', () => {
    const conn = runner.createConnector({ fromId: 'nonexistent', toId: 'also_fake' });
    const obj = runner.objects.get(conn.id)!;
    expect(obj.fromId).toBeNull();
    expect(obj.toId).toBeNull();
  });

  test('default style is arrow', () => {
    const conn = runner.createConnector({});
    const obj = runner.objects.get(conn.id)!;
    expect(obj.style).toBe('arrow');
  });
});

describe('createText', () => {
  test('creates text with content', () => {
    const result = runner.createText({ content: 'Hello' });
    const obj = runner.objects.get(result.id)!;
    expect(obj.content).toBe('Hello');
    expect(obj.width).toBe(220);
    expect(obj.height).toBe(60);
  });

  test('fontSize defaults to medium', () => {
    const result = runner.createText({ content: 'Hi' });
    const obj = runner.objects.get(result.id)!;
    expect((obj.style as any).size).toBe('medium');
  });

  test('bold/italic defaults to false', () => {
    const result = runner.createText({ content: 'Hi' });
    const obj = runner.objects.get(result.id)!;
    expect((obj.style as any).bold).toBe(false);
    expect((obj.style as any).italic).toBe(false);
  });

  test('supports custom dimensions', () => {
    const result = runner.createText({ content: 'Hi', width: 320, height: 100 });
    const obj = runner.objects.get(result.id)!;
    expect(obj.width).toBe(320);
    expect(obj.height).toBe(100);
  });
});

describe('moveObject', () => {
  test('success', () => {
    const shape = createShape();
    const result = runner.moveObject({ objectId: shape.id, x: 300, y: 400 });
    expect(result.ok).toBe(true);
    const obj = runner.objects.get(shape.id)!;
    expect(obj.x).toBe(300);
    expect(obj.y).toBe(400);
  });

  test('missing object returns error', () => {
    const result = runner.moveObject({ objectId: 'nope', x: 0, y: 0 });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  test('connector returns error', () => {
    const conn = runner.createConnector({});
    const result = runner.moveObject({ objectId: conn.id, x: 0, y: 0 });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Connector');
  });
});

describe('arrangeObjectsInGrid', () => {
  test('repositions selected objects into a deterministic grid', () => {
    const a = createSticky('a', { x: 500, y: 400 });
    const b = createSticky('b', { x: 100, y: 100 });
    const c = createSticky('c', { x: 300, y: 200 });
    const d = createSticky('d', { x: 400, y: 300 });

    const result = runner.arrangeObjectsInGrid({ objectIds: [a.id, b.id, c.id, d.id], columns: 2, gapX: 20, gapY: 10 });
    expect(result.ok).toBe(true);
    expect(result.movedIds).toHaveLength(4);

    const objs = [a.id, b.id, c.id, d.id].map((id) => runner.objects.get(id)!);
    const xs = [...new Set(objs.map((obj) => Number(obj.x)))].sort((x, y) => x - y);
    const ys = [...new Set(objs.map((obj) => Number(obj.y)))].sort((x, y) => x - y);
    expect(xs).toHaveLength(2);
    expect(ys).toHaveLength(2);
  });

  test('returns error when no movable IDs are provided', () => {
    const result = runner.arrangeObjectsInGrid({ objectIds: ['missing-id'] });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('No valid objects');
  });
});

describe('resizeObject', () => {
  test('success', () => {
    const shape = createShape();
    const result = runner.resizeObject({ objectId: shape.id, width: 300, height: 200 });
    expect(result.ok).toBe(true);
    const obj = runner.objects.get(shape.id)!;
    expect(obj.width).toBe(300);
    expect(obj.height).toBe(200);
  });

  test('enforces min size', () => {
    const shape = createShape();
    runner.resizeObject({ objectId: shape.id, width: 1, height: 1 });
    const obj = runner.objects.get(shape.id)!;
    expect(obj.width).toBe(24);
    expect(obj.height).toBe(24);
  });

  test('connector returns error', () => {
    const conn = runner.createConnector({});
    const result = runner.resizeObject({ objectId: conn.id, width: 100, height: 100 });
    expect(result.ok).toBe(false);
  });
});

describe('updateText', () => {
  test('sticky sets text', () => {
    const sticky = createSticky('old');
    const result = runner.updateText({ objectId: sticky.id, newText: 'new' });
    expect(result.ok).toBe(true);
    const obj = runner.objects.get(sticky.id)!;
    expect(obj.text).toBe('new');
  });

  test('text object sets content', () => {
    const text = runner.createText({ content: 'old' });
    const result = runner.updateText({ objectId: text.id, newText: 'new' });
    expect(result.ok).toBe(true);
    const obj = runner.objects.get(text.id)!;
    expect(obj.content).toBe('new');
  });

  test('other type returns error', () => {
    const shape = createShape();
    const result = runner.updateText({ objectId: shape.id, newText: 'oops' });
    expect(result.ok).toBe(false);
  });
});

describe('changeColor', () => {
  test('valid color', () => {
    const shape = createShape();
    const result = runner.changeColor({ objectId: shape.id, color: 'red' });
    expect(result.ok).toBe(true);
    expect(runner.objects.get(shape.id)!.color).toBe('red');
  });

  test('invalid falls back to black (sanitizeColor default)', () => {
    const shape = createShape();
    runner.changeColor({ objectId: shape.id, color: 'neon' });
    // sanitizeColor('neon', currentColor) — but changeColor passes the current color as fallback
    // Since args go through validateToolArgs first, color is already sanitized to 'black'
    expect(runner.objects.get(shape.id)!.color).toBe('black');
  });

  test('connector returns error', () => {
    const conn = runner.createConnector({});
    const result = runner.changeColor({ objectId: conn.id, color: 'red' });
    expect(result.ok).toBe(false);
  });
});

describe('rotateObject', () => {
  test('sets normalized angle', () => {
    const shape = createShape();
    runner.rotateObject({ objectId: shape.id, angleDegrees: 45 });
    expect(runner.objects.get(shape.id)!.rotation).toBeCloseTo(45);
  });

  test('normalizes angle', () => {
    const shape = createShape();
    runner.rotateObject({ objectId: shape.id, angleDegrees: 400 });
    expect(runner.objects.get(shape.id)!.rotation).toBeCloseTo(40);
  });

  test('connector returns error', () => {
    const conn = runner.createConnector({});
    const result = runner.rotateObject({ objectId: conn.id, angleDegrees: 45 });
    expect(result.ok).toBe(false);
  });
});

describe('deleteObject', () => {
  test('deletes existing object', () => {
    const shape = createShape();
    const result = runner.deleteObject({ objectId: shape.id });
    expect(result.ok).toBe(true);
    expect(runner.objects.has(shape.id)).toBe(false);
  });

  test('deleting nonexistent returns ok:false', () => {
    const result = runner.deleteObject({ objectId: 'nope' });
    expect(result.ok).toBe(false);
  });

  test('cleans up connector references', () => {
    const a = createShape();
    const b = createShape();
    const conn = runner.createConnector({ fromId: a.id, toId: b.id });

    runner.deleteObject({ objectId: a.id });

    const connObj = runner.objects.get(conn.id)!;
    expect(connObj.fromId).toBeNull();
    expect(connObj.toId).toBe(b.id);
  });

  test('is tracked in deletedIds', () => {
    const shape = createShape();
    const id = shape.id;
    runner.deleteObject({ objectId: id });
    expect(runner.deletedIds.has(id)).toBe(true);
  });
});

describe('getBoardState', () => {
  test('returns all objects with correct shape', () => {
    createSticky('note');
    createShape('rectangle');
    const state = runner.getBoardState() as any;
    expect(state.objectCount).toBe(2);
    expect(state.objects).toHaveLength(2);
    expect(state.viewportCenter).toEqual({ x: 500, y: 500 });
  });

  test('truncates text', () => {
    const longText = 'a'.repeat(300);
    createSticky(longText);
    const state = runner.getBoardState() as any;
    const sticky = state.objects.find((o: any) => o.type === 'sticky');
    expect(sticky.text.length).toBeLessThanOrEqual(160);
  });
});

describe('applyToDoc', () => {
  test('creates propagate into Y.Doc', () => {
    const shape = createShape();
    runner.applyToDoc();

    const objectsMap = doc.getMap('objects');
    expect(objectsMap.has(shape.id)).toBe(true);
  });

  test('updates propagate into Y.Doc', () => {
    const shape = createShape();
    runner.applyToDoc();

    // Create new runner, update, apply again
    const runner2 = BoardToolRunner.fromYDoc(doc, { viewportCenter: { x: 500, y: 500 } });
    runner2.moveObject({ objectId: shape.id, x: 999, y: 888 });
    runner2.applyToDoc();

    const objectsMap = doc.getMap('objects');
    const yObj = objectsMap.get(shape.id) as Y.Map<unknown>;
    expect(yObj.get('x')).toBe(999);
    expect(yObj.get('y')).toBe(888);
  });

  test('deletes propagate into Y.Doc', () => {
    const shape = createShape();
    runner.applyToDoc();

    const runner2 = BoardToolRunner.fromYDoc(doc, { viewportCenter: { x: 500, y: 500 } });
    runner2.deleteObject({ objectId: shape.id });
    const result = runner2.applyToDoc();

    expect(result.deletedIds).toContain(shape.id);
    expect(doc.getMap('objects').has(shape.id)).toBe(false);
  });

  test('zOrder reflects created objects', () => {
    const a = createShape();
    const b = createSticky();
    runner.applyToDoc();

    const zOrder = doc.getArray('zOrder');
    const ids: string[] = [];
    for (let i = 0; i < zOrder.length; i++) {
      ids.push(zOrder.get(i) as string);
    }
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
  });

  test('createdIds/updatedIds/deletedIds tracking', () => {
    const a = createShape();
    const b = createShape();
    runner.moveObject({ objectId: a.id, x: 100, y: 100 });

    // a was created then moved — should still be in createdIds only
    // b was created — in createdIds
    const result = runner.applyToDoc();
    expect(result.createdIds).toContain(a.id);
    expect(result.createdIds).toContain(b.id);
    // updatedIds filters out createdIds
    expect(result.updatedIds).not.toContain(a.id);
  });

  test('normalizes structured frame layouts so outer frame wraps all generated inner frames', () => {
    const outer = runner.createFrame({ title: 'SWOT Analysis', x: 0, y: 0, width: 360, height: 240 });
    runner.createFrame({ title: 'Strengths', x: 100, y: 120, width: 372, height: 578 });
    runner.createFrame({ title: 'Weaknesses', x: 500, y: 120, width: 372, height: 578 });
    runner.createFrame({ title: 'Opportunities', x: 100, y: 730, width: 372, height: 578 });
    runner.createFrame({ title: 'Threats', x: 500, y: 730, width: 372, height: 578 });

    runner.applyToDoc();

    const yObj = doc.getMap('objects').get(outer.id) as Y.Map<unknown>;
    expect(yObj.get('x')).toBe(76); // minInnerX(100) - 24
    expect(yObj.get('y')).toBe(64); // minInnerY(120) - (32 + 24)
    expect(yObj.get('width')).toBe(820); // maxInnerRight(872) + 24 - x(76)
    expect(yObj.get('height')).toBe(1268); // maxInnerBottom(1308) + 24 - y(64)
  });

  test('does not auto-wrap when fewer than 3 frames are generated', () => {
    const outer = runner.createFrame({ title: 'Container', x: 0, y: 0, width: 360, height: 240 });
    runner.createFrame({ title: 'Section', x: 100, y: 120, width: 372, height: 578 });
    runner.applyToDoc();

    const yObj = doc.getMap('objects').get(outer.id) as Y.Map<unknown>;
    expect(yObj.get('x')).toBe(0);
    expect(yObj.get('y')).toBe(0);
    expect(yObj.get('width')).toBe(360);
    expect(yObj.get('height')).toBe(240);
  });
});

describe('placement grid', () => {
  test('sequential creates fill 3-column grid', () => {
    const results: { id: string }[] = [];
    for (let i = 0; i < 6; i++) {
      results.push(createSticky(`note${i}`));
    }

    const positions = results.map((r) => {
      const obj = runner.objects.get(r.id)!;
      return { x: obj.x as number, y: obj.y as number };
    });

    // First 3 should share the same y, next 3 a different y
    expect(positions[0]!.y).toBe(positions[1]!.y);
    expect(positions[1]!.y).toBe(positions[2]!.y);
    expect(positions[3]!.y).toBe(positions[4]!.y);
    expect(positions[4]!.y).toBe(positions[5]!.y);
    expect(positions[0]!.y).not.toBe(positions[3]!.y);

    // Each row should have 3 different x values
    const row1x = [positions[0]!.x, positions[1]!.x, positions[2]!.x];
    expect(new Set(row1x).size).toBe(3);
  });
});
