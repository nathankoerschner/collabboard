import { nanoid } from 'nanoid';
import type * as YTypes from 'yjs';
import {
  clampNumber,
  clampText,
  normalizeAngle,
  normalizeViewportCenter,
  sanitizeColor,
  TEMPLATE_TYPES,
  validateToolArgs,
} from './schema.js';
import type { Point } from './schema.js';

const BASE_MIN_SIZE = 24;
const FRAME_SIDE_PADDING = 24;
const FRAME_TOP_PADDING = 24;
const FRAME_TITLE_BAR_HEIGHT = 32;

function clone<T>(value: T): T {
  return structuredClone(value);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function yMapToObject(yMap: YTypes.Map<any>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  yMap.forEach((value: unknown, key: string) => {
    out[key] = value;
  });
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toYMap(obj: Record<string, unknown>, YMapCtor: new () => YTypes.Map<any>): YTypes.Map<any> {
  const y = new YMapCtor();
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) y.set(k, v);
  }
  return y;
}

interface ToolCallEntry {
  toolName: string;
  args: Record<string, unknown>;
  result: unknown;
}

interface CompactObject {
  id: unknown;
  type: unknown;
  shapeKind?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  color?: string;
  text?: string;
  content?: string;
  title?: string;
  fromId?: unknown;
  toId?: unknown;
  fromPoint?: unknown;
  toPoint?: unknown;
  style?: unknown;
}

export class BoardToolRunner {
  doc: YTypes.Doc;
  objects: Map<string, Record<string, unknown>>;
  order: string[];
  actorId: string;
  viewportCenter: Point;
  now: () => number;
  placementCount = 0;

  createdIds = new Set<string>();
  updatedIds = new Set<string>();
  deletedIds = new Set<string>();
  toolCalls: ToolCallEntry[] = [];

  static fromYDoc(doc: YTypes.Doc, options: { viewportCenter?: unknown; actorId?: string; now?: () => number } = {}): BoardToolRunner {
    const objectsMap = doc.getMap('objects');
    const zOrder = doc.getArray('zOrder');

    const objects = new Map<string, Record<string, unknown>>();
    for (const [id, yObj] of objectsMap.entries()) {
      objects.set(id, yMapToObject(yObj as YTypes.Map<unknown>));
    }

    const order: string[] = [];
    for (let i = 0; i < zOrder.length; i++) {
      const id = zOrder.get(i) as string;
      if (objects.has(id)) order.push(id);
    }

    return new BoardToolRunner({
      doc,
      objects,
      order,
      viewportCenter: options.viewportCenter,
      actorId: options.actorId,
      now: options.now,
    });
  }

  constructor({ doc, objects, order, viewportCenter, actorId, now }: { doc: YTypes.Doc; objects: Map<string, Record<string, unknown>>; order: string[]; viewportCenter?: unknown; actorId?: string; now?: () => number }) {
    this.doc = doc;
    this.objects = objects;
    this.order = order;
    this.actorId = actorId || `ai:${nanoid(8)}`;
    this.viewportCenter = normalizeViewportCenter(viewportCenter);
    this.now = now || Date.now;
  }

  invoke(toolName: string, rawArgs: Record<string, unknown> = {}): unknown {
    if (typeof (this as Record<string, unknown>)[toolName] !== 'function') {
      throw new Error(`Unsupported tool: ${toolName}`);
    }

    const args = validateToolArgs(toolName, rawArgs);
    const result = (this as Record<string, unknown> as Record<string, (args: Record<string, unknown>) => unknown>)[toolName]!(args);

    this.toolCalls.push({ toolName, args, result });
    return result;
  }

  _nextPlacement(defaultWidth = 200, defaultHeight = 120): Point {
    const col = this.placementCount % 3;
    const row = Math.floor(this.placementCount / 3);
    this.placementCount += 1;

    const gapX = 230;
    const gapY = 170;
    const originX = this.viewportCenter.x - gapX;
    const originY = this.viewportCenter.y - gapY;

    return {
      x: Math.round(originX + col * gapX - defaultWidth / 2),
      y: Math.round(originY + row * gapY - defaultHeight / 2),
    };
  }

  _touchUpdated(id: string): void {
    if (!this.createdIds.has(id) && this.objects.has(id)) {
      this.updatedIds.add(id);
    }
  }

  _markDeleted(id: string): void {
    this.createdIds.delete(id);
    this.updatedIds.delete(id);
    this.deletedIds.add(id);
  }

  _setObject(obj: Record<string, unknown>, { created = false } = {}): void {
    this.objects.set(obj.id as string, obj);

    if (!this.order.includes(obj.id as string)) {
      this.order.push(obj.id as string);
    }

    if (created) {
      this.createdIds.add(obj.id as string);
      this.deletedIds.delete(obj.id as string);
      return;
    }

    this._touchUpdated(obj.id as string);
  }

  _deleteObject(id: string): boolean {
    if (!this.objects.has(id)) return false;

    this.objects.delete(id);
    this.order = this.order.filter((oid) => oid !== id);

    for (const obj of this.objects.values()) {
      if (obj.type !== 'connector') continue;
      let changed = false;
      const next = { ...obj };
      if (next.fromId === id) {
        next.fromId = null;
        next.fromPort = null;
        changed = true;
      }
      if (next.toId === id) {
        next.toId = null;
        next.toPort = null;
        changed = true;
      }
      if (changed) this._setObject(next);
    }

    this._markDeleted(id);
    return true;
  }

  _createBase(type: string, x: number, y: number, width: number, height: number): { id: string; type: string; x: number; y: number; width: number; height: number; rotation: number; createdBy: string; createdAt: number; parentFrameId: null } {
    return {
      id: nanoid(12),
      type,
      x,
      y,
      width,
      height,
      rotation: 0,
      createdBy: this.actorId,
      createdAt: this.now(),
      parentFrameId: null,
    };
  }

  createStickyNote(raw: Record<string, unknown> = {}): { id: string } {
    const args = validateToolArgs('createStickyNote', raw);
    const width = args.width as number;
    const height = args.height as number;
    const placement = args.x == null || args.y == null ? this._nextPlacement(width, height) : { x: args.x as number, y: args.y as number };

    const obj = {
      ...this._createBase('sticky', placement.x, placement.y, width, height),
      text: args.text,
      color: sanitizeColor(args.color, 'yellow'),
    };
    this._setObject(obj, { created: true });
    return { id: obj.id };
  }

  createShape(raw: Record<string, unknown> = {}): { id: string } {
    const args = validateToolArgs('createShape', raw);
    const placement = args.x == null || args.y == null
      ? this._nextPlacement(args.width as number, args.height as number)
      : { x: args.x as number, y: args.y as number };

    const shapeKind = (args.shapeKind as string) || 'rectangle';
    const defaultColor = (shapeKind === 'ellipse' || shapeKind === 'circle') ? 'teal' : 'blue';
    const obj = {
      ...this._createBase('shape', placement.x, placement.y, args.width as number, args.height as number),
      shapeKind,
      color: sanitizeColor(args.color, defaultColor),
      strokeColor: 'gray',
    };

    this._setObject(obj, { created: true });
    return { id: obj.id as string };
  }

  createFrame(raw: Record<string, unknown> = {}): { id: string } {
    const args = validateToolArgs('createFrame', raw);
    const placement = args.x == null || args.y == null
      ? this._nextPlacement(args.width as number, args.height as number)
      : { x: args.x as number, y: args.y as number };

    const obj = {
      ...this._createBase('frame', placement.x, placement.y, args.width as number, args.height as number),
      title: args.title || 'Frame',
      color: 'gray',
      children: [],
    };

    this._setObject(obj, { created: true });
    return { id: obj.id as string };
  }

  createConnector(raw: Record<string, unknown> = {}): { id: string } {
    const args = validateToolArgs('createConnector', raw);

    const fromId = args.fromId && this.objects.has(args.fromId as string) ? args.fromId : null;
    const toId = args.toId && this.objects.has(args.toId as string) ? args.toId : null;

    const defaultPoint = this._nextPlacement(0, 0);

    const fromPoint = fromId
      ? null
      : (args.fromPoint || { x: defaultPoint.x, y: defaultPoint.y });
    const toPoint = toId
      ? null
      : (args.toPoint || { x: defaultPoint.x + 180, y: defaultPoint.y + 60 });

    const obj = {
      ...this._createBase('connector', defaultPoint.x, defaultPoint.y, 0, 0),
      fromId,
      toId,
      fromPort: null,
      toPort: null,
      fromPoint,
      toPoint,
      style: args.style || 'arrow',
      points: [],
    };

    this._setObject(obj, { created: true });
    return { id: obj.id as string };
  }

  createText(raw: Record<string, unknown> = {}): { id: string } {
    const args = validateToolArgs('createText', raw);
    const width = args.width as number;
    const height = args.height as number;
    const placement = args.x == null || args.y == null ? this._nextPlacement(width, height) : { x: args.x as number, y: args.y as number };

    const obj = {
      ...this._createBase('text', placement.x, placement.y, width, height),
      content: args.content,
      color: sanitizeColor(args.color, 'gray'),
      style: {
        bold: args.bold,
        italic: args.italic,
        size: args.fontSize,
      },
    };

    this._setObject(obj, { created: true });
    return { id: obj.id as string };
  }

  moveObject(raw: Record<string, unknown> = {}): { ok: boolean; error?: string } {
    const args = validateToolArgs('moveObject', raw);
    const obj = this.objects.get(args.objectId as string);
    if (!obj) return { ok: false, error: 'Object not found' };
    if (obj.type === 'connector') return { ok: false, error: 'Connectors cannot be moved directly' };

    const next = { ...obj, x: args.x, y: args.y };
    this._setObject(next);
    return { ok: true };
  }

  resizeObject(raw: Record<string, unknown> = {}): { ok: boolean; error?: string } {
    const args = validateToolArgs('resizeObject', raw);
    const obj = this.objects.get(args.objectId as string);
    if (!obj) return { ok: false, error: 'Object not found' };
    if (obj.type === 'connector') return { ok: false, error: 'Connectors cannot be resized' };

    const next = {
      ...obj,
      width: Math.max(BASE_MIN_SIZE, args.width as number),
      height: Math.max(BASE_MIN_SIZE, args.height as number),
    };
    this._setObject(next);
    return { ok: true };
  }

  updateText(raw: Record<string, unknown> = {}): { ok: boolean; error?: string } {
    const args = validateToolArgs('updateText', raw);
    const obj = this.objects.get(args.objectId as string);
    if (!obj) return { ok: false, error: 'Object not found' };

    if (obj.type === 'text') {
      this._setObject({ ...obj, content: args.newText });
      return { ok: true };
    }

    if (obj.type === 'sticky') {
      this._setObject({ ...obj, text: args.newText });
      return { ok: true };
    }

    return { ok: false, error: 'Object type does not support text updates' };
  }

  changeColor(raw: Record<string, unknown> = {}): { ok: boolean; error?: string } {
    const args = validateToolArgs('changeColor', raw);
    const obj = this.objects.get(args.objectId as string);
    if (!obj) return { ok: false, error: 'Object not found' };
    if (obj.type === 'connector') return { ok: false, error: 'Connectors do not support palette color updates' };

    this._setObject({ ...obj, color: sanitizeColor(args.color, (obj.color as string) || 'gray') });
    return { ok: true };
  }

  rotateObject(raw: Record<string, unknown> = {}): { ok: boolean; error?: string } {
    const args = validateToolArgs('rotateObject', raw);
    const obj = this.objects.get(args.objectId as string);
    if (!obj) return { ok: false, error: 'Object not found' };
    if (obj.type === 'connector') return { ok: false, error: 'Connectors cannot be rotated' };

    this._setObject({ ...obj, rotation: normalizeAngle(args.angleDegrees) });
    return { ok: true };
  }

  deleteObject(raw: Record<string, unknown> = {}): { ok: boolean } {
    const args = validateToolArgs('deleteObject', raw);
    const deleted = this._deleteObject(args.objectId as string);
    return { ok: deleted };
  }

  getBoardState(): unknown {
    return this.getCompactBoardState();
  }

  _toCompactObject(obj: Record<string, unknown>): CompactObject {
    return {
      id: obj.id,
      type: obj.type,
      x: clampNumber(obj.x, -100000, 100000, 0),
      y: clampNumber(obj.y, -100000, 100000, 0),
      width: clampNumber(obj.width, 0, 100000, 0),
      height: clampNumber(obj.height, 0, 100000, 0),
      rotation: normalizeAngle(obj.rotation || 0),
      shapeKind: obj.type === 'shape' && typeof obj.shapeKind === 'string' ? obj.shapeKind : undefined,
      color: typeof obj.color === 'string' ? obj.color : undefined,
      text: obj.type === 'sticky' ? clampText(obj.text || '', 160) : undefined,
      content: obj.type === 'text' ? clampText(obj.content || '', 160) : undefined,
      title: obj.type === 'frame' ? clampText(obj.title || '', 80) : undefined,
      fromId: obj.type === 'connector' ? obj.fromId : undefined,
      toId: obj.type === 'connector' ? obj.toId : undefined,
      fromPoint: obj.type === 'connector' ? obj.fromPoint : undefined,
      toPoint: obj.type === 'connector' ? obj.toPoint : undefined,
      style: obj.type === 'connector' ? obj.style : undefined,
    };
  }

  _runBatch(raw: Record<string, unknown>, allowedToolNames: readonly string[]): {
    results: Array<{ toolName: string; result?: unknown; error?: string }>;
    okCount: number;
    errorCount: number;
  } {
    const args = validateToolArgs('createObjectsBatch', raw);
    const operations = (args.operations as Array<{ toolName: string; args: Record<string, unknown> }>) || [];
    const results: Array<{ toolName: string; result?: unknown; error?: string }> = [];
    let okCount = 0;
    let errorCount = 0;

    for (const op of operations) {
      if (!allowedToolNames.includes(op.toolName)) {
        results.push({ toolName: op.toolName, error: `Unsupported tool in batch: ${op.toolName}` });
        errorCount += 1;
        continue;
      }

      try {
        const result = this.invoke(op.toolName, op.args || {});
        results.push({ toolName: op.toolName, result });
        okCount += 1;
      } catch (err: unknown) {
        results.push({ toolName: op.toolName, error: (err as Error).message });
        errorCount += 1;
      }
    }

    return { results, okCount, errorCount };
  }

  getCompactBoardState(): unknown {
    const objects = [];
    for (const id of this.order) {
      const obj = this.objects.get(id);
      if (!obj) continue;
      objects.push(this._toCompactObject(obj));
    }

    return {
      objectCount: objects.length,
      viewportCenter: this.viewportCenter,
      objects,
    };
  }

  getObjectById(raw: Record<string, unknown> = {}): { found: boolean; object?: CompactObject } {
    const args = validateToolArgs('getObjectById', raw);
    const obj = this.objects.get(args.objectId as string);
    if (!obj) return { found: false };
    return { found: true, object: this._toCompactObject(obj) };
  }

  listObjectsByType(raw: Record<string, unknown> = {}): { count: number; objects: CompactObject[] } {
    const args = validateToolArgs('listObjectsByType', raw);
    const type = args.type as string | null;
    const limit = args.limit as number;
    const objects: CompactObject[] = [];

    for (const id of this.order) {
      const obj = this.objects.get(id);
      if (!obj) continue;
      if (type && obj.type !== type) continue;
      objects.push(this._toCompactObject(obj));
      if (objects.length >= limit) break;
    }

    return { count: objects.length, objects };
  }

  getObjectsInViewport(raw: Record<string, unknown> = {}): { count: number; viewport: Record<string, number>; objects: CompactObject[] } {
    const args = validateToolArgs('getObjectsInViewport', raw);
    const cx = args.centerX as number;
    const cy = args.centerY as number;
    const width = args.width as number;
    const height = args.height as number;
    const limit = args.limit as number;

    const left = cx - width / 2;
    const top = cy - height / 2;
    const right = left + width;
    const bottom = top + height;

    const objects: CompactObject[] = [];
    for (const id of this.order) {
      const obj = this.objects.get(id);
      if (!obj) continue;

      const x = clampNumber(obj.x, -100000, 100000, 0);
      const y = clampNumber(obj.y, -100000, 100000, 0);
      const w = clampNumber(obj.width, 0, 100000, 0);
      const h = clampNumber(obj.height, 0, 100000, 0);
      const intersects = x <= right && x + w >= left && y <= bottom && y + h >= top;
      if (!intersects) continue;

      objects.push(this._toCompactObject(obj));
      if (objects.length >= limit) break;
    }

    return {
      count: objects.length,
      viewport: { centerX: cx, centerY: cy, width, height },
      objects,
    };
  }

  createObjectsBatch(raw: Record<string, unknown> = {}): {
    results: Array<{ toolName: string; result?: unknown; error?: string }>;
    okCount: number;
    errorCount: number;
  } {
    const args = validateToolArgs('createObjectsBatch', raw);
    return this._runBatch(args, ['createStickyNote', 'createShape', 'createFrame', 'createConnector', 'createText']);
  }

  updateObjectsBatch(raw: Record<string, unknown> = {}): {
    results: Array<{ toolName: string; result?: unknown; error?: string }>;
    okCount: number;
    errorCount: number;
  } {
    const args = validateToolArgs('updateObjectsBatch', raw);
    return this._runBatch(args, ['moveObject', 'resizeObject', 'updateText', 'changeColor', 'rotateObject']);
  }

  deleteObjectsBatch(raw: Record<string, unknown> = {}): {
    results: Array<{ toolName: string; result?: unknown; error?: string }>;
    okCount: number;
    errorCount: number;
  } {
    const args = validateToolArgs('deleteObjectsBatch', raw);
    return this._runBatch(args, ['deleteObject']);
  }

  createStructuredTemplate(raw: Record<string, unknown> = {}): {
    template: string;
    outerFrameId: string;
    sectionFrameIds: string[];
  } {
    const args = validateToolArgs('createStructuredTemplate', raw);
    const template = (TEMPLATE_TYPES as readonly string[]).includes(args.template as string) ? (args.template as string) : 'swot';
    const title = clampText(args.title, 120, template.toUpperCase().replace('_', ' '));
    const gap = 24;

    // Each template type has its own layout: section count, column count, and dimensions.
    // "grid" templates (swot, 2x2) use wide+short sections in a grid.
    // "column" templates (kanban, retro, pros/cons) use narrow+tall sections in a single row.
    let sectionTitles: string[] = [];
    let cols = 2;
    let sectionW = 546;
    let sectionH = 404;

    if (template === 'swot') {
      sectionTitles = ['Strengths', 'Weaknesses', 'Opportunities', 'Threats'];
      cols = 2;
      sectionW = 546;
      sectionH = 404;
    } else if (template === 'kanban') {
      sectionTitles = ['Backlog', 'Todo', 'In Progress', 'Done'];
      cols = 4;
      sectionW = 280;
      sectionH = 600;
    } else if (template === 'retrospective') {
      sectionTitles = ['Went Well', 'To Improve', 'Action Items'];
      cols = 3;
      sectionW = 360;
      sectionH = 600;
    } else if (template === 'pros_cons') {
      sectionTitles = ['Pros', 'Cons'];
      cols = 2;
      sectionW = 460;
      sectionH = 600;
    } else {
      sectionTitles = ['Q1', 'Q2', 'Q3', 'Q4'];
      cols = 2;
      sectionW = 546;
      sectionH = 404;
    }

    const customTitles = (args.sectionTitles as string[]) || [];
    if (customTitles.length) {
      sectionTitles = [...customTitles];
      // For custom titles, lay out as columns in a single row (up to 6), then wrap.
      cols = Math.min(sectionTitles.length, 6);
      if (sectionTitles.length <= 2) {
        sectionW = 460;
      } else if (sectionTitles.length <= 4) {
        sectionW = 360;
      } else {
        sectionW = 280;
      }
      sectionH = 600;
    }

    const rows = Math.ceil(sectionTitles.length / cols);
    const contentWidth = cols * sectionW + (cols - 1) * gap;
    const contentHeight = rows * sectionH + (rows - 1) * gap;
    const startX = args.x == null ? Math.round(this.viewportCenter.x - contentWidth / 2) : (args.x as number);
    const startY = args.y == null ? Math.round(this.viewportCenter.y - contentHeight / 2) : (args.y as number);

    const sectionFrameIds: string[] = [];
    for (let i = 0; i < sectionTitles.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = startX + col * (sectionW + gap);
      const y = startY + row * (sectionH + gap);
      const section = this.createFrame({
        title: sectionTitles[i],
        x,
        y,
        width: sectionW,
        height: sectionH,
      });
      sectionFrameIds.push(section.id);
    }

    const minInnerX = startX;
    const minInnerY = startY;
    const maxInnerRight = startX + contentWidth;
    const maxInnerBottom = startY + contentHeight;
    const outer = this.createFrame({
      title: title || 'Template',
      x: Math.round(minInnerX - FRAME_SIDE_PADDING),
      y: Math.round(minInnerY - (FRAME_TITLE_BAR_HEIGHT + FRAME_TOP_PADDING)),
      width: Math.round(maxInnerRight + FRAME_SIDE_PADDING - (minInnerX - FRAME_SIDE_PADDING)),
      height: Math.round(maxInnerBottom + FRAME_SIDE_PADDING - (minInnerY - (FRAME_TITLE_BAR_HEIGHT + FRAME_TOP_PADDING))),
    });

    return {
      template,
      outerFrameId: outer.id,
      sectionFrameIds,
    };
  }

  _normalizeGeneratedFrameWrap(): void {
    const generatedFrames = [...this.createdIds]
      .map((id) => this.objects.get(id))
      .filter((obj): obj is Record<string, unknown> => !!obj && obj.type === 'frame');

    // Only normalize structured template generations (e.g. SWOT) with many frames.
    if (generatedFrames.length < 3) return;

    const outerTitlePattern = /(analysis|template|board|matrix|kanban|retro|swot|container|outer)/i;
    const titledCandidates = generatedFrames.filter((frame) => outerTitlePattern.test(String(frame.title || '')));
    if (!titledCandidates.length) return;

    let outerFrame = titledCandidates[0]!;
    let maxArea = -Infinity;
    for (const frame of titledCandidates) {
      const area = Number(frame.width || 0) * Number(frame.height || 0);
      if (area > maxArea) {
        maxArea = area;
        outerFrame = frame;
      }
    }

    const innerFrames = generatedFrames.filter((f) => f.id !== outerFrame.id);
    if (!innerFrames.length) return;

    let minInnerX = Infinity;
    let minInnerY = Infinity;
    let maxInnerRight = -Infinity;
    let maxInnerBottom = -Infinity;

    for (const frame of innerFrames) {
      const x = Number(frame.x || 0);
      const y = Number(frame.y || 0);
      const width = Number(frame.width || 0);
      const height = Number(frame.height || 0);
      minInnerX = Math.min(minInnerX, x);
      minInnerY = Math.min(minInnerY, y);
      maxInnerRight = Math.max(maxInnerRight, x + width);
      maxInnerBottom = Math.max(maxInnerBottom, y + height);
    }

    if (![minInnerX, minInnerY, maxInnerRight, maxInnerBottom].every(Number.isFinite)) return;

    const nextX = Math.round(minInnerX - FRAME_SIDE_PADDING);
    const nextY = Math.round(minInnerY - (FRAME_TITLE_BAR_HEIGHT + FRAME_TOP_PADDING));
    const nextWidth = Math.max(BASE_MIN_SIZE, Math.round(maxInnerRight + FRAME_SIDE_PADDING - nextX));
    const nextHeight = Math.max(BASE_MIN_SIZE, Math.round(maxInnerBottom + FRAME_SIDE_PADDING - nextY));

    if (
      Number(outerFrame.x) === nextX &&
      Number(outerFrame.y) === nextY &&
      Number(outerFrame.width) === nextWidth &&
      Number(outerFrame.height) === nextHeight
    ) return;

    this._setObject({
      ...outerFrame,
      x: nextX,
      y: nextY,
      width: nextWidth,
      height: nextHeight,
    });
  }

  _framesOverlap(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
    const ax = Number(a.x || 0);
    const ay = Number(a.y || 0);
    const aw = Number(a.width || 0);
    const ah = Number(a.height || 0);
    const bx = Number(b.x || 0);
    const by = Number(b.y || 0);
    const bw = Number(b.width || 0);
    const bh = Number(b.height || 0);

    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  _normalizeGeneratedSwotQuadrants(): void {
    const generatedFrames = [...this.createdIds]
      .map((id) => this.objects.get(id))
      .filter((obj): obj is Record<string, unknown> => !!obj && obj.type === 'frame');
    if (generatedFrames.length < 4) return;

    const byTitle = new Map(generatedFrames.map((frame) => [String(frame.title || '').trim().toLowerCase(), frame]));
    const strengths = byTitle.get('strengths');
    const weaknesses = byTitle.get('weaknesses');
    const opportunities = byTitle.get('opportunities');
    const threats = byTitle.get('threats');
    if (!strengths || !weaknesses || !opportunities || !threats) return;

    const quadrants = [strengths, weaknesses, opportunities, threats];
    let hasOverlap = false;
    for (let i = 0; i < quadrants.length; i++) {
      for (let j = i + 1; j < quadrants.length; j++) {
        if (this._framesOverlap(quadrants[i]!, quadrants[j]!)) {
          hasOverlap = true;
          break;
        }
      }
      if (hasOverlap) break;
    }
    if (!hasOverlap) return;

    const widths = quadrants.map((frame) => Number(frame.width || 0)).filter((width) => Number.isFinite(width) && width > 0);
    const heights = quadrants.map((frame) => Number(frame.height || 0)).filter((height) => Number.isFinite(height) && height > 0);
    const quadWidth = widths.length ? Math.max(...widths) : 546;
    const quadHeight = heights.length ? Math.max(...heights) : 404;

    const gap = 24;
    const contentWidth = quadWidth * 2 + gap;
    const contentHeight = quadHeight * 2 + gap;
    const leftX = Math.round(this.viewportCenter.x - contentWidth / 2);
    const topY = Math.round(this.viewportCenter.y - contentHeight / 2);
    const rightX = leftX + quadWidth + gap;
    const bottomY = topY + quadHeight + gap;

    const updates: Array<{ frame: Record<string, unknown>; x: number; y: number }> = [
      { frame: strengths, x: leftX, y: topY },
      { frame: weaknesses, x: rightX, y: topY },
      { frame: opportunities, x: leftX, y: bottomY },
      { frame: threats, x: rightX, y: bottomY },
    ];

    for (const { frame, x, y } of updates) {
      this._setObject({
        ...frame,
        x,
        y,
      });
    }
  }

  applyToDoc(): { createdIds: string[]; updatedIds: string[]; deletedIds: string[]; toolCalls: ToolCallEntry[] } {
    this._normalizeGeneratedSwotQuadrants();
    this._normalizeGeneratedFrameWrap();

    const objectsMap = this.doc.getMap('objects');
    const zOrder = this.doc.getArray('zOrder');
    const YMapCtor = objectsMap.constructor as new () => YTypes.Map<unknown>;

    const createdIds = [...this.createdIds];
    const updatedIds = [...this.updatedIds].filter((id) => !this.createdIds.has(id));
    const deletedIds = [...this.deletedIds];

    this.doc.transact(() => {
      for (const id of deletedIds) {
        objectsMap.delete(id);
      }

      for (const id of [...createdIds, ...updatedIds]) {
        const obj = this.objects.get(id);
        if (!obj) continue;
        objectsMap.set(id, toYMap(clone(obj), YMapCtor));
      }

      if (deletedIds.length) {
        for (let i = zOrder.length - 1; i >= 0; i--) {
          const id = zOrder.get(i) as string;
          if (deletedIds.includes(id)) zOrder.delete(i, 1);
        }
      }

      if (createdIds.length) {
        const live = new Set<string>();
        for (let i = 0; i < zOrder.length; i++) {
          live.add(zOrder.get(i) as string);
        }
        const toAppend = createdIds.filter((id) => !live.has(id));
        if (toAppend.length) zOrder.push(toAppend);
      }
    }, this.actorId);

    return {
      createdIds,
      updatedIds,
      deletedIds,
      toolCalls: this.toolCalls,
    };
  }
}
