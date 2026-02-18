import { nanoid } from 'nanoid';
import * as Y from 'yjs';
import type { Point, MutationSummary } from '../../../shared/types.js';
import {
  clampNumber,
  clampText,
  normalizeAngle,
  normalizeViewportCenter,
  sanitizeColor,
  validateToolArgs,
} from './schema.js';

const BASE_MIN_SIZE = 24;

interface BoardObjectData {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  createdBy: string;
  createdAt?: number;
  parentFrameId: string | null;
  text?: string;
  content?: string;
  color?: string;
  strokeColor?: string;
  title?: string;
  children?: string[];
  fromId?: string | null;
  toId?: string | null;
  fromPort?: string | null;
  toPort?: string | null;
  fromPoint?: Point | null;
  toPoint?: Point | null;
  style?: string | { bold: boolean; italic: boolean; size: string };
  points?: Point[];
  [key: string]: unknown;
}

interface ToolCallEntry {
  toolName: string;
  args: Record<string, unknown>;
  result: unknown;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function yMapToObject(yMap: Y.Map<unknown>): BoardObjectData {
  const out: Record<string, unknown> = {};
  yMap.forEach((value, key) => {
    out[key] = value;
  });
  return out as BoardObjectData;
}

function toYMap(obj: Record<string, unknown>, YMapCtor: typeof Y.Map): Y.Map<unknown> {
  const y = new YMapCtor();
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) y.set(k, v);
  }
  return y;
}

export class BoardToolRunner {
  doc: Y.Doc;
  objects: Map<string, BoardObjectData>;
  order: string[];
  actorId: string;
  viewportCenter: Point;
  now: () => number;
  placementCount = 0;

  createdIds = new Set<string>();
  updatedIds = new Set<string>();
  deletedIds = new Set<string>();
  toolCalls: ToolCallEntry[] = [];

  static fromYDoc(doc: Y.Doc, options: { viewportCenter?: unknown; actorId?: string; now?: () => number } = {}): BoardToolRunner {
    const objectsMap = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
    const zOrder = doc.getArray('zOrder') as Y.Array<string>;

    const objects = new Map<string, BoardObjectData>();
    for (const [id, yObj] of objectsMap.entries()) {
      objects.set(id, yMapToObject(yObj));
    }

    const order: string[] = [];
    for (let i = 0; i < zOrder.length; i++) {
      const id = zOrder.get(i);
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

  constructor({ doc, objects, order, viewportCenter, actorId, now }: {
    doc: Y.Doc;
    objects: Map<string, BoardObjectData>;
    order: string[];
    viewportCenter?: unknown;
    actorId?: string;
    now?: () => number;
  }) {
    this.doc = doc;
    this.objects = objects;
    this.order = order;
    this.actorId = actorId || `ai:${nanoid(8)}`;
    this.viewportCenter = normalizeViewportCenter(viewportCenter);
    this.now = now || Date.now;
  }

  invoke(toolName: string, rawArgs: Record<string, unknown> = {}): unknown {
    if (typeof (this as unknown as Record<string, unknown>)[toolName] !== 'function') {
      throw new Error(`Unsupported tool: ${toolName}`);
    }

    const args = validateToolArgs(toolName, rawArgs);
    const result = (this as unknown as Record<string, (args: Record<string, unknown>) => unknown>)[toolName](args);

    this.toolCalls.push({ toolName, args, result });
    return result;
  }

  private _nextPlacement(defaultWidth = 200, defaultHeight = 120): Point {
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

  private _touchUpdated(id: string): void {
    if (!this.createdIds.has(id) && this.objects.has(id)) {
      this.updatedIds.add(id);
    }
  }

  private _markDeleted(id: string): void {
    this.createdIds.delete(id);
    this.updatedIds.delete(id);
    this.deletedIds.add(id);
  }

  private _setObject(obj: BoardObjectData, { created = false } = {}): void {
    this.objects.set(obj.id, obj);

    if (!this.order.includes(obj.id)) {
      this.order.push(obj.id);
    }

    if (created) {
      this.createdIds.add(obj.id);
      this.deletedIds.delete(obj.id);
      return;
    }

    this._touchUpdated(obj.id);
  }

  private _deleteObject(id: string): boolean {
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

  private _createBase(type: string, x: number, y: number, width: number, height: number): BoardObjectData {
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
    const placement = args.x == null || args.y == null ? this._nextPlacement(150, 150) : { x: args.x as number, y: args.y as number };

    const obj: BoardObjectData = {
      ...this._createBase('sticky', placement.x, placement.y, 150, 150),
      text: args.text as string,
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

    const type = args.type === 'ellipse' ? 'ellipse' : 'rectangle';
    const defaults = type === 'ellipse' ? { color: 'teal' } : { color: 'blue' };
    const obj: BoardObjectData = {
      ...this._createBase(type, placement.x, placement.y, args.width as number, args.height as number),
      color: sanitizeColor(args.color, defaults.color),
      strokeColor: 'gray',
    };

    this._setObject(obj, { created: true });
    return { id: obj.id };
  }

  createFrame(raw: Record<string, unknown> = {}): { id: string } {
    const args = validateToolArgs('createFrame', raw);
    const placement = args.x == null || args.y == null
      ? this._nextPlacement(args.width as number, args.height as number)
      : { x: args.x as number, y: args.y as number };

    const obj: BoardObjectData = {
      ...this._createBase('frame', placement.x, placement.y, args.width as number, args.height as number),
      title: (args.title as string) || 'Frame',
      color: 'gray',
      children: [],
    };

    this._setObject(obj, { created: true });
    return { id: obj.id };
  }

  createConnector(raw: Record<string, unknown> = {}): { id: string } {
    const args = validateToolArgs('createConnector', raw);

    const fromId = args.fromId && this.objects.has(args.fromId as string) ? args.fromId as string : null;
    const toId = args.toId && this.objects.has(args.toId as string) ? args.toId as string : null;

    const defaultPoint = this._nextPlacement(0, 0);

    const fromPoint = fromId
      ? null
      : ((args.fromPoint as Point) || { x: defaultPoint.x, y: defaultPoint.y });
    const toPoint = toId
      ? null
      : ((args.toPoint as Point) || { x: defaultPoint.x + 180, y: defaultPoint.y + 60 });

    const obj: BoardObjectData = {
      ...this._createBase('connector', defaultPoint.x, defaultPoint.y, 0, 0),
      fromId,
      toId,
      fromPort: null,
      toPort: null,
      fromPoint,
      toPoint,
      style: (args.style as string) || 'arrow',
      points: [],
    };

    this._setObject(obj, { created: true });
    return { id: obj.id };
  }

  createText(raw: Record<string, unknown> = {}): { id: string } {
    const args = validateToolArgs('createText', raw);
    const placement = args.x == null || args.y == null ? this._nextPlacement(220, 60) : { x: args.x as number, y: args.y as number };

    const obj: BoardObjectData = {
      ...this._createBase('text', placement.x, placement.y, 220, 60),
      content: args.content as string,
      color: sanitizeColor(args.color, 'gray'),
      style: {
        bold: args.bold as boolean,
        italic: args.italic as boolean,
        size: args.fontSize as string,
      },
    };

    this._setObject(obj, { created: true });
    return { id: obj.id };
  }

  moveObject(raw: Record<string, unknown> = {}): { ok: boolean; error?: string } {
    const args = validateToolArgs('moveObject', raw);
    const obj = this.objects.get(args.objectId as string);
    if (!obj) return { ok: false, error: 'Object not found' };
    if (obj.type === 'connector') return { ok: false, error: 'Connectors cannot be moved directly' };

    const next = { ...obj, x: args.x as number, y: args.y as number };
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
      this._setObject({ ...obj, content: args.newText as string });
      return { ok: true };
    }

    if (obj.type === 'sticky') {
      this._setObject({ ...obj, text: args.newText as string });
      return { ok: true };
    }

    return { ok: false, error: 'Object type does not support text updates' };
  }

  changeColor(raw: Record<string, unknown> = {}): { ok: boolean; error?: string } {
    const args = validateToolArgs('changeColor', raw);
    const obj = this.objects.get(args.objectId as string);
    if (!obj) return { ok: false, error: 'Object not found' };
    if (obj.type === 'connector') return { ok: false, error: 'Connectors do not support palette color updates' };

    this._setObject({ ...obj, color: sanitizeColor(args.color, obj.color || 'gray') });
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

  getCompactBoardState(): unknown {
    const objects: Record<string, unknown>[] = [];
    for (const id of this.order) {
      const obj = this.objects.get(id);
      if (!obj) continue;
      objects.push({
        id: obj.id,
        type: obj.type,
        x: clampNumber(obj.x, -100000, 100000, 0),
        y: clampNumber(obj.y, -100000, 100000, 0),
        width: clampNumber(obj.width, 0, 100000, 0),
        height: clampNumber(obj.height, 0, 100000, 0),
        rotation: normalizeAngle(obj.rotation || 0),
        color: typeof obj.color === 'string' ? obj.color : undefined,
        text: obj.type === 'sticky' ? clampText(obj.text || '', 160) : undefined,
        content: obj.type === 'text' ? clampText(obj.content || '', 160) : undefined,
        title: obj.type === 'frame' ? clampText(obj.title || '', 80) : undefined,
        fromId: obj.type === 'connector' ? obj.fromId : undefined,
        toId: obj.type === 'connector' ? obj.toId : undefined,
        fromPoint: obj.type === 'connector' ? obj.fromPoint : undefined,
        toPoint: obj.type === 'connector' ? obj.toPoint : undefined,
        style: obj.type === 'connector' ? obj.style : undefined,
      });
    }

    return {
      objectCount: objects.length,
      viewportCenter: this.viewportCenter,
      objects,
    };
  }

  applyToDoc(): MutationSummary {
    const objectsMap = this.doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
    const zOrder = this.doc.getArray('zOrder') as Y.Array<string>;

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
        objectsMap.set(id, toYMap(clone(obj) as unknown as Record<string, unknown>, Y.Map));
      }

      if (deletedIds.length) {
        for (let i = zOrder.length - 1; i >= 0; i--) {
          const id = zOrder.get(i);
          if (deletedIds.includes(id)) zOrder.delete(i, 1);
        }
      }

      if (createdIds.length) {
        const live = new Set<string>();
        for (let i = 0; i < zOrder.length; i++) {
          live.add(zOrder.get(i));
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
