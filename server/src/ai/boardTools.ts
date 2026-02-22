import { nanoid } from 'nanoid';
import type * as YTypes from 'yjs';
import {
  clampNumber,
  clampText,
  normalizeAngle,
  normalizeViewportCenter,
  sanitizeColor,
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

const READ_ONLY_TOOLS = new Set<string>(['getBoardState']);
const DEFERRED_CREATE_TOOLS = new Set<string>(['createFrame']);
const LAYOUT_UPDATE_TOOLS = new Set<string>(['moveObject', 'resizeObject']);

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
    if (!READ_ONLY_TOOLS.has(toolName) && this._shouldFlushImmediately(toolName, args)) {
      // Flush mutating changes immediately so clients can render updates
      // while the agent continues planning/finalizing subsequent steps.
      this.applyToDoc({ normalizeFrameWrap: false });
    }
    return result;
  }

  _shouldFlushImmediately(toolName: string, args: Record<string, unknown>): boolean {
    // Frame template generation is often iterative (create -> move/resize).
    // Defer frame writes to avoid visible reflow during AI planning.
    if (DEFERRED_CREATE_TOOLS.has(toolName)) return false;

    // If an object was created in this same command, defer follow-up layout
    // updates so it appears at its final coordinates in one render.
    if (LAYOUT_UPDATE_TOOLS.has(toolName)) {
      const objectId = typeof args.objectId === 'string' ? args.objectId : null;
      if (objectId && this.createdIds.has(objectId)) return false;
    }

    return true;
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
        next.fromT = null;
        changed = true;
      }
      if (next.toId === id) {
        next.toId = null;
        next.toPort = null;
        next.toT = null;
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

    const shapeKind = args.type === 'ellipse' ? 'ellipse' : 'rectangle';
    const defaults = shapeKind === 'ellipse' ? { color: 'teal' } : { color: 'blue' };
    const obj = {
      ...this._createBase('shape', placement.x, placement.y, args.width as number, args.height as number),
      shapeKind,
      color: sanitizeColor(args.color, defaults.color),
      strokeColor: '#64748b',
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

    const fromT = fromId && args.fromT != null ? args.fromT as number : null;
    const toT = toId && args.toT != null ? args.toT as number : null;

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
      fromT,
      toT,
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
      color: sanitizeColor(args.color, 'black'),
      style: {
        bold: args.bold,
        italic: args.italic,
        size: args.fontSize,
      },
    };

    this._setObject(obj, { created: true });
    return { id: obj.id as string };
  }

  createTable(raw: Record<string, unknown> = {}): { id: string } {
    const args = validateToolArgs('createTable', raw);
    const headers = args.headers as string[];
    const data = args.data as string[][];
    const numCols = args.numColumns as number;
    const numRows = args.numRows as number;

    // Generate column and row IDs
    const columns: string[] = [];
    for (let i = 0; i < numCols; i++) columns.push(`c${i + 1}`);

    // Total rows = 1 header row + data rows (or numRows if no data)
    const totalRows = data.length ? data.length + (headers.length ? 1 : 0) : numRows;
    const rows: string[] = [];
    for (let i = 0; i < totalRows; i++) rows.push(`r${i + 1}`);

    const columnWidths: Record<string, number> = {};
    for (const col of columns) columnWidths[col] = 120;

    const rowHeights: Record<string, number> = {};
    for (const row of rows) rowHeights[row] = 32;

    // Build cells from headers + data
    const cells: Record<string, string> = {};
    if (headers.length) {
      for (let c = 0; c < Math.min(headers.length, numCols); c++) {
        if (headers[c]) cells[`r1:${columns[c]}`] = headers[c]!;
      }
    }
    const dataStartRow = headers.length ? 1 : 0;
    for (let r = 0; r < data.length; r++) {
      const row = data[r]!;
      for (let c = 0; c < Math.min(row.length, numCols); c++) {
        if (row[c]) cells[`${rows[r + dataStartRow]}:${columns[c]}`] = row[c]!;
      }
    }

    const width = numCols * 120;
    const height = 32 + totalRows * 32; // title bar + rows
    const placement = args.x == null || args.y == null
      ? this._nextPlacement(width, height)
      : { x: args.x as number, y: args.y as number };

    const obj = {
      ...this._createBase('table', placement.x, placement.y, width, height),
      title: args.title as string,
      columns,
      rows,
      columnWidths,
      rowHeights,
      cells,
      color: args.color as string,
    };

    this._setObject(obj, { created: true });
    return { id: obj.id };
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

  arrangeObjectsInGrid(raw: Record<string, unknown> = {}): { ok: boolean; error?: string; movedIds?: string[] } {
    const args = validateToolArgs('arrangeObjectsInGrid', raw);
    const requestedIds = (args.objectIds as string[]) || [];
    const uniqueIds = [...new Set(requestedIds)];
    const movable = uniqueIds
      .map((id) => this.objects.get(id))
      .filter((obj): obj is Record<string, unknown> => !!obj && obj.type !== 'connector')
      .filter((obj) => ['sticky', 'text', 'rectangle', 'ellipse', 'frame', 'table'].includes(String(obj.type)));

    if (!movable.length) return { ok: false, error: 'No valid objects to arrange' };

    const sorted = [...movable].sort((a, b) => {
      const ay = Number(a.y || 0);
      const by = Number(b.y || 0);
      if (ay !== by) return ay - by;
      return Number(a.x || 0) - Number(b.x || 0);
    });

    const columns = Math.max(
      1,
      Math.min(
        24,
        Number.isFinite(args.columns as number)
          ? Math.round(args.columns as number)
          : Math.ceil(Math.sqrt(sorted.length))
      )
    );
    const gapX = Number(args.gapX || 24);
    const gapY = Number(args.gapY || 24);
    const cellWidth = Math.max(...sorted.map((obj) => Number(obj.width || 0)));
    const cellHeight = Math.max(...sorted.map((obj) => Number(obj.height || 0)));
    const minX = Math.min(...sorted.map((obj) => Number(obj.x || 0)));
    const minY = Math.min(...sorted.map((obj) => Number(obj.y || 0)));
    const originX = typeof args.originX === 'number' ? Number(args.originX) : minX;
    const originY = typeof args.originY === 'number' ? Number(args.originY) : minY;

    const movedIds: string[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const obj = sorted[i]!;
      const col = i % columns;
      const row = Math.floor(i / columns);
      const x = Math.round(originX + col * (cellWidth + gapX) + (cellWidth - Number(obj.width || 0)) / 2);
      const y = Math.round(originY + row * (cellHeight + gapY) + (cellHeight - Number(obj.height || 0)) / 2);
      this._setObject({ ...obj, x, y });
      movedIds.push(String(obj.id));
    }

    return { ok: true, movedIds };
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

    if (obj.type === 'table') {
      this._setObject({ ...obj, title: args.newText });
      return { ok: true };
    }

    return { ok: false, error: 'Object type does not support text updates' };
  }

  changeColor(raw: Record<string, unknown> = {}): { ok: boolean; error?: string } {
    const args = validateToolArgs('changeColor', raw);
    const obj = this.objects.get(args.objectId as string);
    if (!obj) return { ok: false, error: 'Object not found' };
    if (obj.type === 'connector') return { ok: false, error: 'Connectors do not support palette color updates' };
    if (obj.type === 'frame') return { ok: false, error: 'Frames do not support color changes' };

    this._setObject({ ...obj, color: sanitizeColor(args.color, (obj.color as string) || 'black') });
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
    const objects = [];
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
        title: obj.type === 'frame' || obj.type === 'table' ? clampText(obj.title || '', 80) : undefined,
        fromId: obj.type === 'connector' ? obj.fromId : undefined,
        toId: obj.type === 'connector' ? obj.toId : undefined,
        fromPoint: obj.type === 'connector' ? obj.fromPoint : undefined,
        toPoint: obj.type === 'connector' ? obj.toPoint : undefined,
        fromT: obj.type === 'connector' ? obj.fromT : undefined,
        toT: obj.type === 'connector' ? obj.toT : undefined,
        style: obj.type === 'connector' ? obj.style : undefined,
      });
    }

    return {
      objectCount: objects.length,
      viewportCenter: this.viewportCenter,
      objects,
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

    let outerFrame = (titledCandidates.length ? titledCandidates : generatedFrames)[0]!;
    let maxArea = -Infinity;
    for (const frame of titledCandidates.length ? titledCandidates : generatedFrames) {
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

  applyToDoc({ normalizeFrameWrap = true }: { normalizeFrameWrap?: boolean } = {}): { createdIds: string[]; updatedIds: string[]; deletedIds: string[]; toolCalls: ToolCallEntry[] } {
    if (normalizeFrameWrap) {
      this._normalizeGeneratedFrameWrap();
    }

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
