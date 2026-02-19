import type { ShapeKind } from '../types.js';

export interface ShapeDef {
  kind: ShapeKind;
  label: string;
  icon: string;
  defaultWidth: number;
  defaultHeight: number;
  draw: (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => void;
  path: (x: number, y: number, w: number, h: number) => Path2D;
}

function rectPath(x: number, y: number, w: number, h: number, r = 0): Path2D {
  const p = new Path2D();
  if (r <= 0) {
    p.rect(x, y, w, h);
  } else {
    p.moveTo(x + r, y);
    p.lineTo(x + w - r, y);
    p.quadraticCurveTo(x + w, y, x + w, y + r);
    p.lineTo(x + w, y + h - r);
    p.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    p.lineTo(x + r, y + h);
    p.quadraticCurveTo(x, y + h, x, y + h - r);
    p.lineTo(x, y + r);
    p.quadraticCurveTo(x, y, x + r, y);
  }
  p.closePath();
  return p;
}

function ellipsePath(x: number, y: number, w: number, h: number): Path2D {
  const p = new Path2D();
  p.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  return p;
}

function polygonPath(x: number, y: number, w: number, h: number, pts: [number, number][]): Path2D {
  const p = new Path2D();
  for (let i = 0; i < pts.length; i++) {
    const px = x + pts[i]![0] * w;
    const py = y + pts[i]![1] * h;
    if (i === 0) p.moveTo(px, py);
    else p.lineTo(px, py);
  }
  p.closePath();
  return p;
}

function starPath(x: number, y: number, w: number, h: number, points: number, innerRatio: number): Path2D {
  const p = new Path2D();
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rx = w / 2;
  const ry = h / 2;
  const step = Math.PI / points;
  const startAngle = -Math.PI / 2;

  for (let i = 0; i < points * 2; i++) {
    const angle = startAngle + i * step;
    const r = i % 2 === 0 ? 1 : innerRatio;
    const px = cx + Math.cos(angle) * rx * r;
    const py = cy + Math.sin(angle) * ry * r;
    if (i === 0) p.moveTo(px, py);
    else p.lineTo(px, py);
  }
  p.closePath();
  return p;
}

function drawPath(ctx: CanvasRenderingContext2D, p: Path2D): void {
  ctx.fill(p);
  ctx.stroke(p);
}

function makeDef(
  kind: ShapeKind,
  label: string,
  icon: string,
  defaultWidth: number,
  defaultHeight: number,
  pathFn: (x: number, y: number, w: number, h: number) => Path2D,
): ShapeDef {
  return {
    kind,
    label,
    icon,
    defaultWidth,
    defaultHeight,
    path: pathFn,
    draw(ctx, x, y, w, h) {
      drawPath(ctx, pathFn(x, y, w, h));
    },
  };
}

// SVG icon helpers — small 18x18 icons for the drawer
const ico = (d: string) =>
  `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

export const SHAPE_DEFS: Map<ShapeKind, ShapeDef> = new Map([
  // ── Basic shapes ──
  ['rectangle', makeDef('rectangle', 'Rectangle', ico('<rect x="3" y="3" width="18" height="18" rx="2"/>'), 200, 120,
    (x, y, w, h) => rectPath(x, y, w, h, 0))],

  ['rounded-rectangle', makeDef('rounded-rectangle', 'Rounded Rectangle', ico('<rect x="3" y="3" width="18" height="18" rx="5"/>'), 200, 120,
    (x, y, w, h) => rectPath(x, y, w, h, Math.min(w, h) * 0.15))],

  ['ellipse', makeDef('ellipse', 'Ellipse', ico('<ellipse cx="12" cy="12" rx="10" ry="8"/>'), 200, 120,
    ellipsePath)],

  ['circle', makeDef('circle', 'Circle', ico('<circle cx="12" cy="12" r="10"/>'), 120, 120,
    ellipsePath)],

  // ── Polygons ──
  ['triangle', makeDef('triangle', 'Triangle', ico('<polygon points="12,2 22,22 2,22"/>'), 120, 120,
    (x, y, w, h) => polygonPath(x, y, w, h, [[0.5, 0], [1, 1], [0, 1]]))],

  ['right-triangle', makeDef('right-triangle', 'Right Triangle', ico('<polygon points="2,22 22,22 2,2"/>'), 120, 120,
    (x, y, w, h) => polygonPath(x, y, w, h, [[0, 0], [1, 1], [0, 1]]))],

  ['diamond', makeDef('diamond', 'Diamond', ico('<polygon points="12,2 22,12 12,22 2,12"/>'), 140, 140,
    (x, y, w, h) => polygonPath(x, y, w, h, [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]]))],

  ['pentagon', makeDef('pentagon', 'Pentagon', ico('<polygon points="12,2 22,9 18,22 6,22 2,9"/>'), 120, 120,
    (x, y, w, h) => {
      const pts: [number, number][] = [];
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (2 * Math.PI * i) / 5;
        pts.push([0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)]);
      }
      return polygonPath(x, y, w, h, pts);
    })],

  ['hexagon', makeDef('hexagon', 'Hexagon', ico('<polygon points="12,2 21,7 21,17 12,22 3,17 3,7"/>'), 120, 120,
    (x, y, w, h) => {
      const pts: [number, number][] = [];
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + (2 * Math.PI * i) / 6;
        pts.push([0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)]);
      }
      return polygonPath(x, y, w, h, pts);
    })],

  ['octagon', makeDef('octagon', 'Octagon', ico('<polygon points="8,2 16,2 22,8 22,16 16,22 8,22 2,16 2,8"/>'), 120, 120,
    (x, y, w, h) => {
      const pts: [number, number][] = [];
      for (let i = 0; i < 8; i++) {
        const a = -Math.PI / 2 + (2 * Math.PI * i) / 8;
        pts.push([0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)]);
      }
      return polygonPath(x, y, w, h, pts);
    })],

  // ── Stars ──
  ['star', makeDef('star', 'Star', ico('<polygon points="12,2 15,9 22,9 16,14 18,22 12,18 6,22 8,14 2,9 9,9"/>'), 120, 120,
    (x, y, w, h) => starPath(x, y, w, h, 5, 0.38))],

  ['star-4', makeDef('star-4', '4-Point Star', ico('<polygon points="12,2 15,9 22,12 15,15 12,22 9,15 2,12 9,9"/>'), 120, 120,
    (x, y, w, h) => starPath(x, y, w, h, 4, 0.38))],

  // ── Arrows ──
  ['arrow-right', makeDef('arrow-right', 'Arrow Right', ico('<polygon points="2,8 14,8 14,3 22,12 14,21 14,16 2,16"/>'), 200, 120,
    (x, y, w, h) => polygonPath(x, y, w, h, [[0, 0.3], [0.6, 0.3], [0.6, 0], [1, 0.5], [0.6, 1], [0.6, 0.7], [0, 0.7]]))],

  ['arrow-left', makeDef('arrow-left', 'Arrow Left', ico('<polygon points="22,8 10,8 10,3 2,12 10,21 10,16 22,16"/>'), 200, 120,
    (x, y, w, h) => polygonPath(x, y, w, h, [[1, 0.3], [0.4, 0.3], [0.4, 0], [0, 0.5], [0.4, 1], [0.4, 0.7], [1, 0.7]]))],

  ['arrow-up', makeDef('arrow-up', 'Arrow Up', ico('<polygon points="8,22 8,10 3,10 12,2 21,10 16,10 16,22"/>'), 120, 200,
    (x, y, w, h) => polygonPath(x, y, w, h, [[0.3, 1], [0.3, 0.4], [0, 0.4], [0.5, 0], [1, 0.4], [0.7, 0.4], [0.7, 1]]))],

  ['arrow-down', makeDef('arrow-down', 'Arrow Down', ico('<polygon points="8,2 8,14 3,14 12,22 21,14 16,14 16,2"/>'), 120, 200,
    (x, y, w, h) => polygonPath(x, y, w, h, [[0.3, 0], [0.3, 0.6], [0, 0.6], [0.5, 1], [1, 0.6], [0.7, 0.6], [0.7, 0]]))],

  // ── Special ──
  ['cross', makeDef('cross', 'Cross', ico('<polygon points="8,2 16,2 16,8 22,8 22,16 16,16 16,22 8,22 8,16 2,16 2,8 8,8"/>'), 120, 120,
    (x, y, w, h) => polygonPath(x, y, w, h, [
      [0.33, 0], [0.67, 0], [0.67, 0.33], [1, 0.33], [1, 0.67], [0.67, 0.67],
      [0.67, 1], [0.33, 1], [0.33, 0.67], [0, 0.67], [0, 0.33], [0.33, 0.33],
    ]))],

  ['heart', makeDef('heart', 'Heart', ico('<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>'), 120, 120,
    (x, y, w, h) => {
      const p = new Path2D();
      const cx = x + w / 2;
      const topY = y + h * 0.3;
      p.moveTo(cx, y + h);
      p.bezierCurveTo(x - w * 0.1, y + h * 0.55, x, y - h * 0.05, cx, topY);
      p.bezierCurveTo(x + w, y - h * 0.05, x + w * 1.1, y + h * 0.55, cx, y + h);
      p.closePath();
      return p;
    })],

  ['cloud', makeDef('cloud', 'Cloud', ico('<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>'), 200, 120,
    (x, y, w, h) => {
      const p = new Path2D();
      const cx = x + w / 2;
      const cy = y + h * 0.55;
      p.moveTo(x + w * 0.25, cy + h * 0.2);
      p.bezierCurveTo(x, cy + h * 0.2, x, cy - h * 0.15, x + w * 0.2, cy - h * 0.15);
      p.bezierCurveTo(x + w * 0.15, y, x + w * 0.4, y, cx, y + h * 0.15);
      p.bezierCurveTo(x + w * 0.6, y, x + w * 0.85, y, x + w * 0.8, cy - h * 0.15);
      p.bezierCurveTo(x + w, cy - h * 0.15, x + w, cy + h * 0.2, x + w * 0.75, cy + h * 0.2);
      p.closePath();
      return p;
    })],

  ['callout', makeDef('callout', 'Callout', ico('<path d="M3 5h18v12H9l-4 4v-4H3V5z"/>'), 200, 140,
    (x, y, w, h) => {
      const p = new Path2D();
      const bodyH = h * 0.75;
      p.moveTo(x, y);
      p.lineTo(x + w, y);
      p.lineTo(x + w, y + bodyH);
      p.lineTo(x + w * 0.35, y + bodyH);
      p.lineTo(x + w * 0.15, y + h);
      p.lineTo(x + w * 0.15, y + bodyH);
      p.lineTo(x, y + bodyH);
      p.closePath();
      return p;
    })],

  ['parallelogram', makeDef('parallelogram', 'Parallelogram', ico('<polygon points="6,3 22,3 18,21 2,21"/>'), 200, 120,
    (x, y, w, h) => polygonPath(x, y, w, h, [[0.15, 0], [1, 0], [0.85, 1], [0, 1]]))],

  ['trapezoid', makeDef('trapezoid', 'Trapezoid', ico('<polygon points="6,3 18,3 22,21 2,21"/>'), 200, 120,
    (x, y, w, h) => polygonPath(x, y, w, h, [[0.2, 0], [0.8, 0], [1, 1], [0, 1]]))],

  ['cylinder', makeDef('cylinder', 'Cylinder', ico('<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/>'), 120, 160,
    (x, y, w, h) => {
      const p = new Path2D();
      const ry = h * 0.1;
      p.ellipse(x + w / 2, y + ry, w / 2, ry, 0, 0, Math.PI * 2);
      p.moveTo(x, y + ry);
      p.lineTo(x, y + h - ry);
      p.ellipse(x + w / 2, y + h - ry, w / 2, ry, 0, Math.PI, 0, true);
      p.lineTo(x + w, y + ry);
      return p;
    })],

  ['document', makeDef('document', 'Document', ico('<path d="M4 3h16v16c0 0-4 2-8 0s-8 0-8 0V3z"/>'), 160, 200,
    (x, y, w, h) => {
      const p = new Path2D();
      p.moveTo(x, y);
      p.lineTo(x + w, y);
      p.lineTo(x + w, y + h * 0.85);
      p.bezierCurveTo(x + w * 0.75, y + h, x + w * 0.5, y + h * 0.75, x + w * 0.25, y + h * 0.9);
      p.bezierCurveTo(x + w * 0.1, y + h * 0.95, x, y + h, x, y + h * 0.85);
      p.closePath();
      return p;
    })],
]);

export const SHAPE_KINDS: ShapeKind[] = [...SHAPE_DEFS.keys()];
