import { describe, test, expect } from 'vitest';
import {
  clampNumber,
  normalizeViewportCenter,
  normalizeAngle,
  sanitizeColor,
  clampText,
  validateToolArgs,
} from '../schema.js';

describe('clampNumber', () => {
  test('in range returns value', () => {
    expect(clampNumber(5, 0, 10)).toBe(5);
  });

  test('below min returns min', () => {
    expect(clampNumber(-5, 0, 10)).toBe(0);
  });

  test('above max returns max', () => {
    expect(clampNumber(15, 0, 10)).toBe(10);
  });

  test('NaN returns fallback', () => {
    expect(clampNumber(NaN, 0, 10, 7)).toBe(7);
  });

  test('non-number returns fallback', () => {
    expect(clampNumber('hello' as any, 0, 10, 3)).toBe(3);
  });

  test('default fallback is min', () => {
    expect(clampNumber(undefined as any, 5, 10)).toBe(5);
  });
});

describe('normalizeViewportCenter', () => {
  test('valid object', () => {
    const result = normalizeViewportCenter({ x: 100, y: 200 });
    expect(result).toEqual({ x: 100, y: 200 });
  });

  test('null returns default', () => {
    const result = normalizeViewportCenter(null);
    expect(result).toEqual({ x: 0, y: 0 });
  });

  test('non-object returns default', () => {
    expect(normalizeViewportCenter('hello')).toEqual({ x: 0, y: 0 });
    expect(normalizeViewportCenter(42)).toEqual({ x: 0, y: 0 });
  });

  test('out-of-range values are clamped', () => {
    const result = normalizeViewportCenter({ x: 999999, y: -999999 });
    expect(result.x).toBe(100000);
    expect(result.y).toBe(-100000);
  });
});

describe('normalizeAngle', () => {
  test.each([
    [0, 0],
    [90, 90],
    [-90, -90],
    [360, 0],
    [-360, 0],
    [720, 0],
    [270, -90],
    [180, 180],
    [-180, 180],
  ])('normalizeAngle(%d) = %d', (input, expected) => {
    expect(normalizeAngle(input)).toBeCloseTo(expected);
  });

  test('NaN returns 0', () => {
    expect(normalizeAngle(NaN)).toBe(0);
  });

  test('non-number returns 0', () => {
    expect(normalizeAngle('hello' as any)).toBe(0);
  });
});

describe('sanitizeColor', () => {
  test.each([
    ['yellow', 'yellow'],
    ['blue', 'blue'],
    ['green', 'green'],
    ['pink', 'pink'],
    ['purple', 'purple'],
    ['orange', 'orange'],
    ['red', 'red'],
    ['teal', 'teal'],
    ['gray', 'gray'],
    ['white', 'white'],
  ])('valid palette name %s returns itself', (input, expected) => {
    expect(sanitizeColor(input)).toBe(expected);
  });

  test('invalid string returns fallback', () => {
    expect(sanitizeColor('magenta')).toBe('gray');
    expect(sanitizeColor('#ff0000')).toBe('gray');
  });

  test('non-string returns fallback', () => {
    expect(sanitizeColor(42 as any)).toBe('gray');
    expect(sanitizeColor(null as any)).toBe('gray');
  });

  test('custom fallback', () => {
    expect(sanitizeColor('nope', 'blue')).toBe('blue');
  });
});

describe('clampText', () => {
  test('within limit returns value', () => {
    expect(clampText('hello', 10)).toBe('hello');
  });

  test('over limit is truncated', () => {
    expect(clampText('hello world', 5)).toBe('hello');
  });

  test('non-string returns fallback', () => {
    expect(clampText(42 as any, 10, 'default')).toBe('default');
  });

  test('default fallback is empty string', () => {
    expect(clampText(null as any)).toBe('');
  });
});

describe('validateToolArgs', () => {
  describe('createStickyNote', () => {
    test('valid args', () => {
      const result = validateToolArgs('createStickyNote', { text: 'hi', x: 10, y: 20, width: 180, height: 140, color: 'blue' });
      expect(result.text).toBe('hi');
      expect(result.x).toBe(10);
      expect(result.y).toBe(20);
      expect(result.width).toBe(180);
      expect(result.height).toBe(140);
      expect(result.color).toBe('blue');
    });

    test('missing optional x/y default to null', () => {
      const result = validateToolArgs('createStickyNote', { text: 'hi' });
      expect(result.x).toBeNull();
      expect(result.y).toBeNull();
      expect(result.width).toBe(150);
      expect(result.height).toBe(150);
    });

    test('invalid color falls back to yellow', () => {
      const result = validateToolArgs('createStickyNote', { text: 'hi', color: 'magenta' });
      expect(result.color).toBe('yellow');
    });
  });

  describe('createShape', () => {
    test('valid rectangle', () => {
      const result = validateToolArgs('createShape', { type: 'rectangle', width: 200, height: 100 });
      expect(result.type).toBe('rectangle');
      expect(result.width).toBe(200);
      expect(result.height).toBe(100);
    });

    test('invalid type defaults to rectangle', () => {
      const result = validateToolArgs('createShape', { type: 'triangle' });
      expect(result.type).toBe('rectangle');
    });

    test('size clamping', () => {
      const result = validateToolArgs('createShape', { type: 'rectangle', width: 1, height: 5000 });
      expect(result.width).toBe(24);
      expect(result.height).toBe(2000);
    });
  });

  describe('createFrame', () => {
    test('valid args', () => {
      const result = validateToolArgs('createFrame', { title: 'My Frame', width: 500, height: 400 });
      expect(result.title).toBe('My Frame');
    });

    test('default title', () => {
      const result = validateToolArgs('createFrame', {});
      expect(result.title).toBe('Frame');
    });
  });

  describe('createConnector', () => {
    test('with fromId/toId', () => {
      const result = validateToolArgs('createConnector', { fromId: 'a', toId: 'b', style: 'line' });
      expect(result.fromId).toBe('a');
      expect(result.toId).toBe('b');
      expect(result.style).toBe('line');
    });

    test('with points', () => {
      const result = validateToolArgs('createConnector', {
        fromPoint: { x: 10, y: 20 },
        toPoint: { x: 30, y: 40 },
      });
      expect(result.fromPoint).toEqual({ x: 10, y: 20 });
      expect(result.toPoint).toEqual({ x: 30, y: 40 });
    });

    test('invalid style defaults to arrow', () => {
      const result = validateToolArgs('createConnector', { style: 'zigzag' });
      expect(result.style).toBe('arrow');
    });
  });

  describe('createText', () => {
    test('valid args', () => {
      const result = validateToolArgs('createText', { content: 'Hello', width: 300, height: 90, fontSize: 'large', bold: true, italic: false });
      expect(result.content).toBe('Hello');
      expect(result.width).toBe(300);
      expect(result.height).toBe(90);
      expect(result.fontSize).toBe('large');
      expect(result.bold).toBe(true);
      expect(result.italic).toBe(false);
    });

    test('invalid fontSize defaults to medium', () => {
      const result = validateToolArgs('createText', { content: 'Hi', fontSize: 'huge' });
      expect(result.fontSize).toBe('medium');
    });
  });

  describe('moveObject', () => {
    test('valid args', () => {
      const result = validateToolArgs('moveObject', { objectId: 'abc', x: 100, y: 200 });
      expect(result.objectId).toBe('abc');
      expect(result.x).toBe(100);
      expect(result.y).toBe(200);
    });

    test('non-string objectId returns null', () => {
      const result = validateToolArgs('moveObject', { objectId: 123, x: 0, y: 0 });
      expect(result.objectId).toBeNull();
    });
  });

  describe('resizeObject', () => {
    test('valid args', () => {
      const result = validateToolArgs('resizeObject', { objectId: 'abc', width: 300, height: 200 });
      expect(result.objectId).toBe('abc');
      expect(result.width).toBe(300);
      expect(result.height).toBe(200);
    });

    test('size clamping', () => {
      const result = validateToolArgs('resizeObject', { objectId: 'abc', width: 1, height: 9999 });
      expect(result.width).toBe(24);
      expect(result.height).toBe(4000);
    });
  });

  describe('updateText', () => {
    test('valid args', () => {
      const result = validateToolArgs('updateText', { objectId: 'abc', newText: 'updated' });
      expect(result.newText).toBe('updated');
    });

    test('missing text defaults to empty', () => {
      const result = validateToolArgs('updateText', { objectId: 'abc' });
      expect(result.newText).toBe('');
    });
  });

  describe('changeColor', () => {
    test('valid color', () => {
      const result = validateToolArgs('changeColor', { objectId: 'abc', color: 'red' });
      expect(result.color).toBe('red');
    });

    test('invalid color falls back to gray', () => {
      const result = validateToolArgs('changeColor', { objectId: 'abc', color: 'neon' });
      expect(result.color).toBe('gray');
    });
  });

  describe('rotateObject', () => {
    test('valid args', () => {
      const result = validateToolArgs('rotateObject', { objectId: 'abc', angleDegrees: 45 });
      expect(result.angleDegrees).toBe(45);
    });

    test('angle is normalized', () => {
      const result = validateToolArgs('rotateObject', { objectId: 'abc', angleDegrees: 400 });
      expect(result.angleDegrees).toBeCloseTo(40);
    });
  });

  describe('deleteObject', () => {
    test('valid args', () => {
      const result = validateToolArgs('deleteObject', { objectId: 'abc' });
      expect(result.objectId).toBe('abc');
    });
  });

  describe('getBoardState', () => {
    test('returns empty object', () => {
      const result = validateToolArgs('getBoardState', {});
      expect(result).toEqual({});
    });
  });

  describe('unknown tool', () => {
    test('returns empty object', () => {
      const result = validateToolArgs('unknownTool', { foo: 'bar' });
      expect(result).toEqual({});
    });
  });
});
