import type { Point } from '../types.js';

export class Camera {
  offsetX = 0;
  offsetY = 0;
  scale = 1;
  readonly minScale = 0.1;
  readonly maxScale = 5.0;

  applyTransform(ctx: CanvasRenderingContext2D, dpr = 1): void {
    ctx.setTransform(this.scale * dpr, 0, 0, this.scale * dpr, this.offsetX * dpr, this.offsetY * dpr);
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

  private _animId: number | null = null;

  animateToScale(target: number, cx: number, cy: number, duration = 250): void {
    if (this._animId !== null) cancelAnimationFrame(this._animId);

    const startScale = this.scale;
    const startOffsetX = this.offsetX;
    const startOffsetY = this.offsetY;
    const startTime = performance.now();

    const step = (now: number) => {
      const t = Math.min((now - startTime) / duration, 1);
      // ease-out cubic
      const ease = 1 - Math.pow(1 - t, 3);

      const newScale = startScale + (target - startScale) * ease;
      const factor = newScale / startScale;
      this.offsetX = cx - (cx - startOffsetX) * factor;
      this.offsetY = cy - (cy - startOffsetY) * factor;
      this.scale = newScale;

      if (t < 1) {
        this._animId = requestAnimationFrame(step);
      } else {
        this._animId = null;
      }
    };

    this._animId = requestAnimationFrame(step);
  }
}
