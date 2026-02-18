import { describe, test, expect } from 'vitest';
import { Camera } from '../Camera.js';

describe('Camera', () => {
  test('default state', () => {
    const cam = new Camera();
    expect(cam.offsetX).toBe(0);
    expect(cam.offsetY).toBe(0);
    expect(cam.scale).toBe(1);
  });

  describe('screenToWorld / worldToScreen', () => {
    test('round-trip identity at default transform', () => {
      const cam = new Camera();
      const screen = cam.worldToScreen(100, 200);
      const world = cam.screenToWorld(screen.x, screen.y);
      expect(world.x).toBeCloseTo(100);
      expect(world.y).toBeCloseTo(200);
    });

    test('round-trip after pan', () => {
      const cam = new Camera();
      cam.pan(50, -30);
      const screen = cam.worldToScreen(100, 200);
      const world = cam.screenToWorld(screen.x, screen.y);
      expect(world.x).toBeCloseTo(100);
      expect(world.y).toBeCloseTo(200);
    });

    test('round-trip after zoom', () => {
      const cam = new Camera();
      cam.zoom(2, 0, 0);
      const screen = cam.worldToScreen(100, 200);
      const world = cam.screenToWorld(screen.x, screen.y);
      expect(world.x).toBeCloseTo(100);
      expect(world.y).toBeCloseTo(200);
    });

    test('round-trip after combined pan + zoom', () => {
      const cam = new Camera();
      cam.pan(100, 200);
      cam.zoom(1.5, 300, 300);
      const screen = cam.worldToScreen(42, 77);
      const world = cam.screenToWorld(screen.x, screen.y);
      expect(world.x).toBeCloseTo(42);
      expect(world.y).toBeCloseTo(77);
    });

    test('screenToWorld accounts for offset', () => {
      const cam = new Camera();
      cam.offsetX = 100;
      cam.offsetY = 50;
      const w = cam.screenToWorld(100, 50);
      expect(w.x).toBe(0);
      expect(w.y).toBe(0);
    });

    test('worldToScreen accounts for scale', () => {
      const cam = new Camera();
      cam.scale = 2;
      const s = cam.worldToScreen(10, 20);
      expect(s.x).toBe(20);
      expect(s.y).toBe(40);
    });
  });

  describe('pan', () => {
    test('offsets accumulate', () => {
      const cam = new Camera();
      cam.pan(10, 20);
      cam.pan(-5, 15);
      expect(cam.offsetX).toBe(5);
      expect(cam.offsetY).toBe(35);
    });
  });

  describe('zoom', () => {
    test('clamps to minScale', () => {
      const cam = new Camera();
      cam.zoom(0.001, 0, 0);
      expect(cam.scale).toBe(cam.minScale);
    });

    test('clamps to maxScale', () => {
      const cam = new Camera();
      cam.zoom(100, 0, 0);
      expect(cam.scale).toBe(cam.maxScale);
    });

    test('zoom factor of 1 is a no-op', () => {
      const cam = new Camera();
      cam.pan(50, 50);
      const prevOffsetX = cam.offsetX;
      const prevOffsetY = cam.offsetY;
      cam.zoom(1, 100, 100);
      expect(cam.scale).toBe(1);
      expect(cam.offsetX).toBe(prevOffsetX);
      expect(cam.offsetY).toBe(prevOffsetY);
    });

    test('zoom toward a point keeps that point fixed', () => {
      const cam = new Camera();
      cam.pan(100, 100);
      const fixedScreenX = 300;
      const fixedScreenY = 250;

      // Get world coords of the fixed point before zoom
      const before = cam.screenToWorld(fixedScreenX, fixedScreenY);

      cam.zoom(2, fixedScreenX, fixedScreenY);

      // After zoom, the same screen point should map to same world coords
      const after = cam.screenToWorld(fixedScreenX, fixedScreenY);
      expect(after.x).toBeCloseTo(before.x, 5);
      expect(after.y).toBeCloseTo(before.y, 5);
    });

    test('zoom at origin', () => {
      const cam = new Camera();
      cam.zoom(2, 0, 0);
      expect(cam.scale).toBe(2);
      expect(cam.offsetX).toBe(0);
      expect(cam.offsetY).toBe(0);
    });
  });
});
