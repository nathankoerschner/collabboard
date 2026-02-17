import { getHandlePositions, HANDLE_SIZE } from './HitTest.js';

const STICKY_COLORS = {
  yellow: '#fef08a',
  blue: '#bfdbfe',
  green: '#bbf7d0',
  pink: '#fecdd3',
  purple: '#e9d5ff',
};

export class Renderer {
  drawBackground(ctx, camera, canvasWidth, canvasHeight) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#f8f9fa';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    ctx.restore();

    // Dot grid
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

  drawObject(ctx, obj, { skipText = false } = {}) {
    if (obj.type === 'sticky') {
      this.drawStickyNote(ctx, obj, skipText);
    } else if (obj.type === 'rectangle') {
      this.drawRectangle(ctx, obj);
    }
  }

  drawStickyNote(ctx, obj, skipText = false) {
    const { x, y, width, height, color = 'yellow', text = '' } = obj;
    const bgColor = STICKY_COLORS[color] || STICKY_COLORS.yellow;

    // Shadow
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.15)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;

    // Background
    ctx.fillStyle = bgColor;
    this.roundRect(ctx, x, y, width, height, 4);
    ctx.fill();
    ctx.restore();

    // Border
    ctx.strokeStyle = 'rgba(0,0,0,0.08)';
    ctx.lineWidth = 1;
    this.roundRect(ctx, x, y, width, height, 4);
    ctx.stroke();

    // Text (skip if being edited to avoid doubling)
    if (text && !skipText) {
      ctx.fillStyle = '#1a1a2e';
      ctx.font = '14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      this.wrapText(ctx, text, x + 10, y + 10, width - 20, 18);
    }
  }

  drawRectangle(ctx, obj) {
    const { x, y, width, height, color = '#4361ee' } = obj;

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.1)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;

    ctx.fillStyle = color + '22';
    this.roundRect(ctx, x, y, width, height, 6);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    this.roundRect(ctx, x, y, width, height, 6);
    ctx.stroke();
  }

  drawSelectionHandles(ctx, obj, camera) {
    const handles = getHandlePositions(obj);
    const size = HANDLE_SIZE / camera.scale;

    for (const [, hx, hy] of handles) {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#4361ee';
      ctx.lineWidth = 1.5 / camera.scale;
      ctx.beginPath();
      ctx.arc(hx, hy, size / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Selection border
    ctx.strokeStyle = '#4361ee';
    ctx.lineWidth = 1.5 / camera.scale;
    ctx.setLineDash([4 / camera.scale, 4 / camera.scale]);
    ctx.strokeRect(obj.x, obj.y, obj.width, obj.height);
    ctx.setLineDash([]);
  }

  drawCursor(ctx, cursor, camera) {
    const { x, y, name, color } = cursor;

    ctx.save();
    // Arrow
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

    // Name label
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

  roundRect(ctx, x, y, w, h, r) {
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

  drawMarquee(ctx, rect, camera) {
    const { x, y, width, height } = rect;
    ctx.fillStyle = 'rgba(67, 97, 238, 0.08)';
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = '#4361ee';
    ctx.lineWidth = 1 / camera.scale;
    ctx.setLineDash([4 / camera.scale, 4 / camera.scale]);
    ctx.strokeRect(x, y, width, height);
    ctx.setLineDash([]);
  }

  wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = text.split(' ');
    let line = '';
    let currentY = y;

    for (const word of words) {
      const testLine = line + (line ? ' ' : '') + word;
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && line) {
        ctx.fillText(line, x, currentY);
        line = word;
        currentY += lineHeight;
      } else {
        line = testLine;
      }
    }
    ctx.fillText(line, x, currentY);
  }
}
