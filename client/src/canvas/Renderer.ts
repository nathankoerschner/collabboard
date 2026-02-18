import type { BoardObject, ConnectorObject, Rect, TextSize } from '../../../shared/types.js';
import { getHandlePositions, HANDLE_SIZE } from './HitTest.js';
import {
  getConnectorEndpoints,
  getObjectAABB,
  getObjectCenter,
  getPortList,
  getRotationHandlePoint,
  getSelectionBounds,
} from './Geometry.js';
import type { Camera } from './Camera.js';
import type { RenderedCursor } from '../board/CursorManager.js';

export interface RevealState {
  alpha: number;
  scale: number;
}

export interface DrawObjectOptions {
  skipText?: boolean;
  reveal?: RevealState | null;
}

export class Renderer {
  palette: Record<string, string>;

  constructor(palette: Record<string, string> = {}) {
    this.palette = palette;
  }

  drawBackground(ctx: CanvasRenderingContext2D, camera: Camera, canvasWidth: number, canvasHeight: number): void {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#f8f9fa';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    ctx.restore();

    const dotSpacing = 40;
    const { x: startX, y: startY } = camera.screenToWorld(0, 0);
    const { x: endX, y: endY } = camera.screenToWorld(canvasWidth, canvasHeight);
    const gridStartX = Math.floor(startX / dotSpacing) * dotSpacing;
    const gridStartY = Math.floor(startY / dotSpacing) * dotSpacing;

    ctx.fillStyle = '#d1d5db';
    const dotSize = Math.max(1, 1.5 / camera.scale);
    for (let x = gridStartX; x <= endX; x += dotSpacing) {
      for (let y = gridStartY; y <= endY; y += dotSpacing) {
        ctx.beginPath();
        ctx.arc(x, y, dotSize, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  drawObject(ctx: CanvasRenderingContext2D, obj: BoardObject, objectsById: Map<string, BoardObject>, { skipText = false, reveal = null }: DrawObjectOptions = {}): void {
    if (reveal) {
      const center = getObjectCenter(obj);
      ctx.save();
      ctx.globalAlpha = reveal.alpha;
      ctx.translate(center.x, center.y);
      ctx.scale(reveal.scale, reveal.scale);
      ctx.translate(-center.x, -center.y);
    }

    if (obj.type === 'sticky') return this._finishReveal(ctx, () => this.drawStickyNote(ctx, obj, skipText), reveal);
    if (obj.type === 'rectangle') return this._finishReveal(ctx, () => this.drawRectangle(ctx, obj), reveal);
    if (obj.type === 'ellipse') return this._finishReveal(ctx, () => this.drawEllipse(ctx, obj), reveal);
    if (obj.type === 'text') return this._finishReveal(ctx, () => this.drawText(ctx, obj, skipText), reveal);
    if (obj.type === 'connector') return this._finishReveal(ctx, () => this.drawConnector(ctx, obj, objectsById), reveal);
    if (obj.type === 'frame') return this._finishReveal(ctx, () => this.drawFrame(ctx, obj), reveal);

    if (reveal) ctx.restore();
  }

  private _finishReveal(ctx: CanvasRenderingContext2D, draw: () => void, reveal: RevealState | null): void {
    draw();
    if (reveal) ctx.restore();
  }

  drawStickyNote(ctx: CanvasRenderingContext2D, obj: BoardObject & { type: 'sticky' }, skipText = false): void {
    const color = this._color(obj.color, '#fef08a');
    this._drawRotatedBox(ctx, obj, (lx, ly, w, h) => {
      ctx.fillStyle = color;
      this.roundRect(ctx, lx, ly, w, h, 6);
      ctx.fill();

      ctx.strokeStyle = 'rgba(0,0,0,0.1)';
      ctx.lineWidth = 1;
      this.roundRect(ctx, lx, ly, w, h, 6);
      ctx.stroke();

      if (!skipText && obj.text) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(lx + 8, ly + 8, w - 16, h - 16);
        ctx.clip();
        this._drawWrappedText(ctx, obj.text, lx + 10, ly + 10, w - 20, 18, '14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', '#1a1a2e');
        ctx.restore();
      }
    });
  }

  drawRectangle(ctx: CanvasRenderingContext2D, obj: BoardObject & { type: 'rectangle' }): void {
    const fill = this._color(obj.color, '#bfdbfe');
    const stroke = this._color(obj.strokeColor, '#64748b');

    this._drawRotatedBox(ctx, obj, (lx, ly, w, h) => {
      ctx.fillStyle = fill;
      this.roundRect(ctx, lx, ly, w, h, 8);
      ctx.fill();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      this.roundRect(ctx, lx, ly, w, h, 8);
      ctx.stroke();
    });
  }

  drawEllipse(ctx: CanvasRenderingContext2D, obj: BoardObject & { type: 'ellipse' }): void {
    const fill = this._color(obj.color, '#99f6e4');
    const stroke = this._color(obj.strokeColor, '#64748b');

    this._drawRotatedBox(ctx, obj, (lx, ly, w, h) => {
      const cx = lx + w / 2;
      const cy = ly + h / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      ctx.stroke();
    });
  }

  drawText(ctx: CanvasRenderingContext2D, obj: BoardObject & { type: 'text' }, skipText = false): void {
    if (skipText) return;

    this._drawRotatedBox(ctx, obj, (lx, ly, w, h) => {
      const size = this._textSizePx(obj.style?.size || 'medium');
      const font = `${obj.style?.italic ? 'italic ' : ''}${obj.style?.bold ? '700 ' : '400 '}${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      this._drawWrappedText(ctx, obj.content || '', lx + 6, ly + 6, Math.max(20, w - 12), size * 1.3, font, this._color(obj.color, '#334155'));
    });
  }

  drawFrame(ctx: CanvasRenderingContext2D, obj: BoardObject & { type: 'frame' }): void {
    const stroke = this._color(obj.color, '#94a3b8');

    this._drawRotatedBox(ctx, obj, (lx, ly, w, h) => {
      ctx.fillStyle = 'rgba(148, 163, 184, 0.08)';
      this.roundRect(ctx, lx, ly, w, h, 10);
      ctx.fill();

      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      this.roundRect(ctx, lx, ly, w, h, 10);
      ctx.stroke();

      const titleHeight = 30;
      ctx.fillStyle = 'rgba(148, 163, 184, 0.2)';
      this.roundRect(ctx, lx + 1, ly + 1, Math.max(40, w - 2), titleHeight, 8);
      ctx.fill();

      ctx.fillStyle = '#334155';
      ctx.font = '600 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(obj.title || 'Frame', lx + 10, ly + titleHeight / 2 + 1);
    });
  }

  drawConnector(ctx: CanvasRenderingContext2D, obj: ConnectorObject, objectsById: Map<string, BoardObject>): void {
    const { start, end } = getConnectorEndpoints(obj, objectsById);
    if (!start || !end) return;

    ctx.save();
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();

    if (obj.style === 'arrow') {
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const size = 10;
      const bx = end.x - ux * size;
      const by = end.y - uy * size;
      ctx.fillStyle = '#334155';
      ctx.beginPath();
      ctx.moveTo(end.x, end.y);
      ctx.lineTo(bx - uy * 5, by + ux * 5);
      ctx.lineTo(bx + uy * 5, by - ux * 5);
      ctx.closePath();
      ctx.fill();
    }

    if (!obj.fromId && start) {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#334155';
      ctx.beginPath();
      ctx.arc(start.x, start.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    if (!obj.toId && end) {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#334155';
      ctx.beginPath();
      ctx.arc(end.x, end.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    ctx.restore();
  }

  drawSelection(ctx: CanvasRenderingContext2D, selectedObjects: BoardObject[], camera: Camera): void {
    if (!selectedObjects.length) return;

    if (selectedObjects.length === 1) {
      const obj = selectedObjects[0];
      this.drawSelectionHandles(ctx, obj, camera);
      return;
    }

    const bounds = getSelectionBounds(selectedObjects);
    if (!bounds) return;

    ctx.save();
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 1.5 / camera.scale;
    ctx.setLineDash([6 / camera.scale, 5 / camera.scale]);
    ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
    ctx.setLineDash([]);

    const rh = getRotationHandlePoint(bounds);
    ctx.beginPath();
    ctx.arc(rh.x, rh.y, 6 / camera.scale, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(bounds.x + bounds.width / 2, bounds.y);
    ctx.lineTo(rh.x, rh.y + 6 / camera.scale);
    ctx.stroke();

    ctx.restore();
  }

  drawSelectionHandles(ctx: CanvasRenderingContext2D, obj: BoardObject, camera: Camera): void {
    const size = HANDLE_SIZE / camera.scale;
    const handles = getHandlePositions(obj);

    ctx.save();
    for (const [, hx, hy] of handles) {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#2563eb';
      ctx.lineWidth = 1.5 / camera.scale;
      ctx.beginPath();
      ctx.arc(hx, hy, size / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    if (obj.type !== 'connector') {
      const box = getObjectAABB(obj);
      ctx.strokeStyle = '#2563eb';
      ctx.lineWidth = 1.5 / camera.scale;
      ctx.setLineDash([5 / camera.scale, 4 / camera.scale]);
      ctx.strokeRect(box.x, box.y, box.width, box.height);
      ctx.setLineDash([]);

      const rotHandle = getRotationHandlePoint(box);
      ctx.beginPath();
      ctx.arc(rotHandle.x, rotHandle.y, 6 / camera.scale, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(box.x + box.width / 2, box.y);
      ctx.lineTo(rotHandle.x, rotHandle.y + 6 / camera.scale);
      ctx.stroke();

      const ports = getPortList(obj);
      for (const p of ports) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3.5 / camera.scale, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 1 / camera.scale;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawCursor(ctx: CanvasRenderingContext2D, cursor: RenderedCursor, camera: Camera): void {
    const { x, y, name, color } = cursor;

    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + 18);
    ctx.lineTo(x + 5, y + 14);
    ctx.lineTo(x + 11, y + 22);
    ctx.lineTo(x + 14, y + 20);
    ctx.lineTo(x + 8, y + 12);
    ctx.lineTo(x + 14, y + 10);
    ctx.closePath();
    ctx.fill();

    if (name) {
      const fontSize = 11 / camera.scale;
      ctx.font = `${fontSize}px -apple-system, sans-serif`;
      const textWidth = ctx.measureText(name).width;
      const padding = 4 / camera.scale;
      const labelX = x + 16 / camera.scale;
      const labelY = y + 16 / camera.scale;

      ctx.fillStyle = color;
      this.roundRect(ctx, labelX - padding, labelY - padding, textWidth + padding * 2, fontSize + padding * 2, 3 / camera.scale);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(name, labelX, labelY);
    }
    ctx.restore();
  }

  drawMarqueeHover(ctx: CanvasRenderingContext2D, obj: BoardObject, camera: Camera): void {
    const box = getObjectAABB(obj);
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 1.5 / camera.scale;
    ctx.setLineDash([4 / camera.scale, 4 / camera.scale]);
    ctx.strokeRect(box.x, box.y, box.width, box.height);
    ctx.setLineDash([]);

    ctx.fillStyle = 'rgba(37, 99, 235, 0.06)';
    ctx.fillRect(box.x, box.y, box.width, box.height);
  }

  drawMarquee(ctx: CanvasRenderingContext2D, rect: Rect, camera: Camera): void {
    const { x, y, width, height } = rect;
    ctx.fillStyle = 'rgba(37, 99, 235, 0.08)';
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 1 / camera.scale;
    ctx.setLineDash([4 / camera.scale, 4 / camera.scale]);
    ctx.strokeRect(x, y, width, height);
    ctx.setLineDash([]);
  }

  roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  private _drawWrappedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number, font: string, color: string): void {
    ctx.fillStyle = color;
    ctx.font = font;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    const words = String(text).split(/\s+/);
    let line = '';
    let cy = y;

    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        ctx.fillText(line, x, cy);
        line = word;
        cy += lineHeight;
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, x, cy);
  }

  private _drawRotatedBox(ctx: CanvasRenderingContext2D, obj: BoardObject, drawFn: (lx: number, ly: number, w: number, h: number) => void): void {
    const center = getObjectCenter(obj);
    ctx.save();
    ctx.translate(center.x, center.y);
    ctx.rotate(((obj.rotation || 0) * Math.PI) / 180);
    drawFn(-obj.width / 2, -obj.height / 2, obj.width, obj.height);
    ctx.restore();
  }

  private _color(nameOrHex: string | undefined, fallback: string): string {
    if (!nameOrHex) return fallback;
    if (nameOrHex.startsWith?.('#')) return nameOrHex;
    return this.palette[nameOrHex] || fallback;
  }

  private _textSizePx(size: TextSize): number {
    if (size === 'small') return 14;
    if (size === 'large') return 24;
    return 18;
  }
}
