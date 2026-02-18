import type { Point } from '../../../shared/types.js';

export class Camera {
  offsetX = 0;
  offsetY = 0;
  scale = 1;
  minScale = 0.1;
  maxScale = 5.0;

  applyTransform(ctx: CanvasRenderingContext2D): void {
    ctx.setTransform(this.scale, 0, 0, this.scale, this.offsetX, this.offsetY);
  }

  screenToWorld(sx: number, sy: number): Point {
    return {
      x: (sx - this.offsetX) / this.scale,
      y: (sy - this.offsetY) / this.scale,
    };
  }

  worldToScreen(wx: number, wy: number): Point {
    return {
      x: wx * this.scale + this.offsetX,
      y: wy * this.scale + this.offsetY,
    };
  }

  pan(dx: number, dy: number): void {
    this.offsetX += dx;
    this.offsetY += dy;
  }

  zoom(factor: number, cx: number, cy: number): void {
    const newScale = Math.min(this.maxScale, Math.max(this.minScale, this.scale * factor));
    const actualFactor = newScale / this.scale;
    this.offsetX = cx - (cx - this.offsetX) * actualFactor;
    this.offsetY = cy - (cy - this.offsetY) * actualFactor;
    this.scale = newScale;
  }
}
