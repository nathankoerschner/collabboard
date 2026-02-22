import { nanoid } from 'nanoid';
import * as Y from 'yjs';
import type { AttachResult, BoardObject, ConnectorEndpointPayload, ObjectType, Palette, Point, TextStyle } from '../types.js';
import {
  findClosestPort,
  getConnectorEndpoints,
  getObjectAABB,
  getObjectCenter,
  getPortPosition,
  nearestPerimeterT,
  normalizeAngle,
  objectContainsObject,
  perimeterPoint,
  rotatePoint,
} from '../canvas/Geometry.js';

const PALETTE: Palette = {
  yellow: '#fef08a',
  blue: '#bfdbfe',
  green: '#bbf7d0',
  pink: '#fecdd3',
  purple: '#e9d5ff',
  orange: '#fed7aa',
  red: '#fecaca',
  teal: '#99f6e4',
};

const BASE_MIN_SIZE = 24;

const UNIVERSAL_KEYS = [
  'id', 'type', 'x', 'y', 'width', 'height', 'rotation', 'createdBy', 'parentFrameId',
  'text', 'color', 'content', 'style', 'strokeColor', 'shapeKind',
  'fromId', 'toId', 'fromPort', 'toPort', 'fromPoint', 'toPoint', 'fromT', 'toT', 'points',
  'title', 'children',
  'columns', 'rows', 'columnWidths', 'rowHeights', 'cells',
] as const;

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  // Only reach here for objects/arrays (style, points, children, fromPoint, toPoint)
  // These change infrequently — JSON.stringify is acceptable for the rare case
  return JSON.stringify(a) === JSON.stringify(b);
}

export class ObjectStore {
  doc: Y.Doc;
  objectsMap: Y.Map<Y.Map<unknown>>;
  zOrder: Y.Array<string>;
  transactionOrigin: string = 'local';
  private _pendingContainmentIds: Set<string> | null = null;

  constructor(doc: Y.Doc) {
    this.doc = doc;
    this.objectsMap = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
    this.zOrder = doc.getArray('zOrder') as Y.Array<string>;
  }

  withOrigin(origin: string, fn: () => void): void {
    const prev = this.transactionOrigin;
    this.transactionOrigin = origin;
    try { fn(); } finally { this.transactionOrigin = prev; }
  }

  private _deferContainment(id: string): void {
    if (this._pendingContainmentIds) {
      this._pendingContainmentIds.add(id);
    } else {
      this._syncContainmentAfterMutation(id);
    }
  }

  private _flushContainment(): void {
    const pending = this._pendingContainmentIds;
    this._pendingContainmentIds = null;
    if (!pending || pending.size === 0) return;
    for (const id of pending) {
      this._syncContainmentAfterMutation(id);
    }
  }

  migrateV1Shapes(): void {
    const toMigrate: string[] = [];
    this.objectsMap.forEach((_yObj, id) => {
      const yObj = this.objectsMap.get(id);
      if (!yObj) return;
      const type = yObj.get('type');
      if (type === 'rectangle' || type === 'ellipse') {
        toMigrate.push(id);
      }
    });

    if (!toMigrate.length) return;

    this.doc.transact(() => {
      for (const id of toMigrate) {
        const yObj = this.objectsMap.get(id);
        if (!yObj) continue;
        const oldType = yObj.get('type') as string;
        yObj.set('type', 'shape');
        yObj.set('shapeKind', oldType); // 'rectangle' or 'ellipse'
      }
    }, this.transactionOrigin);
  }

  createObject(type: ObjectType, x: number, y: number, width: number, height: number, extra: Record<string, unknown> = {}): BoardObject {
    const id = nanoid(12);
    const obj = this._buildDefaultObject(id, type, x, y, width, height, extra);

    this.doc.transact(() => {
      this._setObject(obj);
      this.zOrder.push([id]);
      this._syncContainmentAfterMutation(id);
    }, this.transactionOrigin);

    return obj;
  }

  /** Recreate an object from a full snapshot (used by AI undo/redo). */
  createObjectFromSnapshot(obj: BoardObject): void {
    this.doc.transact(() => {
      this._setObject(obj);
      if (this._zIndexOf(obj.id) === -1) {
        this.zOrder.push([obj.id]);
      }
    }, this.transactionOrigin);
  }

  updateObject(id: string, patch: Record<string, unknown> = {}): void {
    const obj = this.getObject(id);
    if (!obj) return;

    this.doc.transact(() => {
      const next = { ...obj, ...patch } as BoardObject;
      next.rotation = normalizeAngle(next.rotation || 0);
      if (next.width < BASE_MIN_SIZE) next.width = BASE_MIN_SIZE;
      if (next.height < BASE_MIN_SIZE) next.height = BASE_MIN_SIZE;
      this._setObject(next);
      this._syncContainmentAfterMutation(id);
    }, this.transactionOrigin);
  }

  moveObject(id: string, x: number, y: number): void {
    const obj = this.getObject(id);
    if (!obj) return;
    const dx = x - obj.x;
    const dy = y - obj.y;
    this.moveObjects([id], dx, dy);
  }

  moveObjects(ids: string[], dx: number, dy: number): void {
    if (!ids.length || (dx === 0 && dy === 0)) return;

    const moveSet = new Set(ids);
    for (const id of ids) {
      const obj = this.getObject(id);
      if (obj?.type === 'frame') {
        for (const childId of this._getFrameDescendants(id)) {
          if (!moveSet.has(childId)) moveSet.add(childId);
        }
      }
    }

    this._pendingContainmentIds = new Set();
    this.doc.transact(() => {
      for (const id of moveSet) {
        const obj = this.getObject(id);
        if (!obj) continue;
        this._setObject({ ...obj, x: obj.x + dx, y: obj.y + dy } as BoardObject);
      }

      for (const id of moveSet) {
        this._deferContainment(id);
      }
    }, this.transactionOrigin);
    this._flushContainment();
  }

  resizeObject(id: string, x: number, y: number, width: number, height: number): void {
    const obj = this.getObject(id);
    if (!obj || obj.type === 'connector') return;

    const next = {
      ...obj,
      x,
      y,
      width: Math.max(BASE_MIN_SIZE, width),
      height: Math.max(BASE_MIN_SIZE, height),
    } as BoardObject;

    this.doc.transact(() => {
      this._setObject(next);
      this._syncContainmentAfterMutation(id);
    }, this.transactionOrigin);
  }

  rotateObjects(ids: string[], deltaAngle: number, pivot: Point | null = null): void {
    if (!ids.length || deltaAngle === 0) return;

    const current = ids.map((id) => this.getObject(id)).filter((o): o is BoardObject => !!o);
    if (!current.length) return;

    const rotationPivot = pivot || (() => {
      const boxes = current.map((o) => getObjectAABB(o));
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const b of boxes) {
        minX = Math.min(minX, b.x);
        minY = Math.min(minY, b.y);
        maxX = Math.max(maxX, b.x + b.width);
        maxY = Math.max(maxY, b.y + b.height);
      }
      return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    })();

    this._pendingContainmentIds = new Set();
    this.doc.transact(() => {
      for (const obj of current) {
        if (obj.type === 'connector') continue;

        const c = getObjectCenter(obj);
        const nextCenter = rotatePoint(c.x, c.y, rotationPivot.x, rotationPivot.y, deltaAngle);
        const next = {
          ...obj,
          x: nextCenter.x - obj.width / 2,
          y: nextCenter.y - obj.height / 2,
          rotation: normalizeAngle((obj.rotation || 0) + deltaAngle),
        } as BoardObject;
        this._setObject(next);
      }

      for (const obj of current) {
        this._deferContainment(obj.id);
      }
    }, this.transactionOrigin);
    this._flushContainment();
  }

  updateText(id: string, value: string): void {
    const obj = this.getObject(id);
    if (!obj) return;

    this.doc.transact(() => {
      if (obj.type === 'text') {
        this._setObject({ ...obj, content: value } as BoardObject);
      } else {
        this._setObject({ ...obj, text: value } as BoardObject);
      }
    }, this.transactionOrigin);
  }

  updateTextStyle(id: string, stylePatch: Partial<TextStyle>): void {
    const obj = this.getObject(id);
    if (!obj || obj.type !== 'text') return;

    const style = { ...(obj.style || {}), ...stylePatch };
    this.doc.transact(() => {
      this._setObject({ ...obj, style } as BoardObject);
    }, this.transactionOrigin);
  }

  updateColor(id: string, color: string): void {
    const obj = this.getObject(id);
    if (!obj) return;
    this.doc.transact(() => {
      this._setObject({ ...obj, color } as BoardObject);
    }, this.transactionOrigin);
  }

  updateConnectorEndpoint(id: string, side: string, payload: ConnectorEndpointPayload): void {
    const obj = this.getObject(id);
    if (!obj || obj.type !== 'connector') return;

    const keyPrefix = side === 'start' ? 'from' : 'to';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const next: any = { ...obj };

    if ('t' in payload) {
      // t-based perimeter attach
      next[`${keyPrefix}Id`] = payload.objectId;
      next[`${keyPrefix}T`] = payload.t;
      next[`${keyPrefix}Port`] = null;
      next[`${keyPrefix}Point`] = null;
    } else if ('port' in payload) {
      // Legacy port-based attach
      next[`${keyPrefix}Id`] = payload.objectId;
      next[`${keyPrefix}Port`] = payload.port || null;
      next[`${keyPrefix}T`] = null;
      next[`${keyPrefix}Point`] = null;
    } else if ('point' in payload) {
      next[`${keyPrefix}Id`] = null;
      next[`${keyPrefix}Port`] = null;
      next[`${keyPrefix}T`] = null;
      next[`${keyPrefix}Point`] = { x: payload.point.x, y: payload.point.y };
    }

    this.doc.transact(() => {
      this._setObject(next as BoardObject);
    }, this.transactionOrigin);
  }

  startConnector(x: number, y: number): BoardObject {
    return this.createObject('connector', x, y, 0, 0, {
      fromPoint: { x, y },
      toPoint: { x, y },
      style: 'arrow',
      points: [],
    });
  }

  deleteObjects(ids: string[]): void {
    if (!ids.length) return;
    const unique = [...new Set(ids)];

    this.doc.transact(() => {
      const expanded = new Set(unique);
      for (const id of unique) {
        const obj = this.getObject(id);
        if (obj?.type === 'frame') {
          for (const childId of this._getFrameDescendants(id)) {
            expanded.add(childId);
          }
        }
      }

      const deleting = [...expanded].map((id) => this.getObject(id)).filter((o): o is BoardObject => !!o);
      const deletingIds = new Set(deleting.map((o) => o.id));
      const all = this.getAll();

      for (const conn of all) {
        if (conn.type !== 'connector' || deletingIds.has(conn.id)) continue;
        let dirty = false;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const next: any = { ...conn };

        if (conn.fromId && deletingIds.has(conn.fromId)) {
          // Resolve current position before detaching
          next.fromPoint = getConnectorEndpoints(conn, new Map(all.map((o) => [o.id, o]))).start;
          next.fromId = null;
          next.fromPort = null;
          next.fromT = null;
          dirty = true;
        }

        if (conn.toId && deletingIds.has(conn.toId)) {
          next.toPoint = getConnectorEndpoints(conn, new Map(all.map((o) => [o.id, o]))).end;
          next.toId = null;
          next.toPort = null;
          next.toT = null;
          dirty = true;
        }

        if (dirty) this._setObject(next as BoardObject);
      }

      for (const obj of deleting) {
        if (obj.parentFrameId) {
          this._removeFrameChild(obj.parentFrameId, obj.id);
        }
      }

      for (const id of deletingIds) {
        this.objectsMap.delete(id);
        this._removeFromZOrder(id);
      }
    }, this.transactionOrigin);
  }

  deleteObject(id: string): void {
    this.deleteObjects([id]);
  }

  bringToFront(id: string): void {
    const idx = this._zIndexOf(id);
    if (idx === -1) return;

    this.doc.transact(() => {
      this.zOrder.delete(idx, 1);
      this.zOrder.push([id]);
    }, this.transactionOrigin);
  }

  duplicateSelection(ids: string[], offset: Point = { x: 20, y: 20 }): string[] {
    const payload = this.serializeSelection(ids);
    return this.pasteSerialized(payload, offset, true);
  }

  serializeSelection(ids: string[]): BoardObject[] {
    const unique = new Set(ids);
    const selected = this.getAll().filter((obj) => unique.has(obj.id));
    const selectedIds = new Set(selected.map((o) => o.id));

    return selected.map((obj) => {
      const clone = structuredClone(obj);
      if (clone.type === 'connector') {
        if (clone.fromId && !selectedIds.has(clone.fromId)) {
          clone.fromPoint = this._resolveConnectorPoint(clone, 'from');
          clone.fromId = null;
          clone.fromPort = null;
        }
        if (clone.toId && !selectedIds.has(clone.toId)) {
          clone.toPoint = this._resolveConnectorPoint(clone, 'to');
          clone.toId = null;
          clone.toPort = null;
        }
      }
      return clone;
    });
  }

  pasteSerialized(serializedObjects: BoardObject[], placement: Point = { x: 0, y: 0 }, relativeOffset = false): string[] {
    if (!serializedObjects?.length) return [];

    const idMap = new Map<string, string>();
    for (const obj of serializedObjects) {
      idMap.set(obj.id, nanoid(12));
    }

    const clones = serializedObjects.map((obj) => {
      const next = structuredClone(obj);
      next.id = idMap.get(obj.id)!;
      next.createdBy = 'local';
      return next;
    });

    for (const obj of clones) {
      if (obj.type === 'connector') {
        if (obj.fromId) obj.fromId = idMap.get(obj.fromId) || null;
        if (obj.toId) obj.toId = idMap.get(obj.toId) || null;
      }
      if (obj.type === 'frame') {
        obj.children = (obj.children || []).map((id) => idMap.get(id)).filter((id): id is string => !!id);
      }
      if (obj.parentFrameId) {
        obj.parentFrameId = idMap.get(obj.parentFrameId) || null;
      }
    }

    const placeable = clones.filter((o) => o.type !== 'connector');
    if (placeable.length) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const obj of placeable) {
        minX = Math.min(minX, obj.x);
        minY = Math.min(minY, obj.y);
        maxX = Math.max(maxX, obj.x + obj.width);
        maxY = Math.max(maxY, obj.y + obj.height);
      }

      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const dx = relativeOffset ? placement.x : placement.x - cx;
      const dy = relativeOffset ? placement.y : placement.y - cy;

      for (const obj of clones) {
        if (obj.type === 'connector') {
          if (obj.fromPoint) obj.fromPoint = { x: obj.fromPoint.x + dx, y: obj.fromPoint.y + dy };
          if (obj.toPoint) obj.toPoint = { x: obj.toPoint.x + dx, y: obj.toPoint.y + dy };
        } else {
          obj.x += dx;
          obj.y += dy;
        }
      }
    }

    this._pendingContainmentIds = new Set();
    this.doc.transact(() => {
      for (const obj of clones) {
        this._setObject(obj);
        this.zOrder.push([obj.id]);
      }
      for (const obj of clones) {
        this._deferContainment(obj.id);
      }
    }, this.transactionOrigin);
    this._flushContainment();

    return clones.map((o) => o.id);
  }

  getPalette(): Palette {
    return PALETTE;
  }

  getObject(id: string): BoardObject | null {
    const yObj = this.objectsMap.get(id);
    if (!yObj) return null;
    return this._yMapToObj(yObj);
  }

  getAll(): BoardObject[] {
    const all: BoardObject[] = [];
    for (let i = 0; i < this.zOrder.length; i++) {
      const id = this.zOrder.get(i);
      const yObj = this.objectsMap.get(id);
      if (yObj) all.push(this._yMapToObj(yObj));
    }

    const frames = all.filter((o) => o.type === 'frame');
    const others = all.filter((o) => o.type !== 'frame');
    return [...frames, ...others];
  }

  _buildDefaultObject(id: string, type: ObjectType, x: number, y: number, width: number, height: number, extra: Record<string, unknown>): BoardObject {
    // Start with all universal keys set to null
    const obj: Record<string, unknown> = {};
    for (const key of UNIVERSAL_KEYS) {
      obj[key] = null;
    }

    // Base fields
    obj.id = id;
    obj.type = type;
    obj.x = x;
    obj.y = y;
    obj.width = width;
    obj.height = height;
    obj.rotation = 0;
    obj.createdBy = 'local';

    // Type-specific defaults
    if (type === 'sticky') {
      obj.text = '';
      obj.color = 'yellow';
    } else if (type === 'rectangle') {
      obj.color = 'blue';
      obj.strokeColor = '#64748b';
    } else if (type === 'ellipse') {
      obj.color = 'teal';
      obj.strokeColor = '#64748b';
    } else if (type === 'text') {
      obj.content = '';
      obj.color = '#334155';
      obj.style = { bold: false, italic: false, size: 'medium' };
    } else if (type === 'connector') {
      obj.width = 0;
      obj.height = 0;
      obj.fromId = null;
      obj.toId = null;
      obj.fromPort = null;
      obj.toPort = null;
      obj.fromPoint = null;
      obj.toPoint = null;
      obj.fromT = null;
      obj.toT = null;
      obj.style = 'arrow';
      obj.points = [];
    } else if (type === 'frame') {
      obj.title = 'Frame';
      obj.color = '#E3E8EF';
      obj.children = [];
    } else if (type === 'shape') {
      obj.shapeKind = 'rectangle';
      obj.color = 'blue';
      obj.strokeColor = '#64748b';
    } else if (type === 'table') {
      const cols = ['c1', 'c2', 'c3'];
      const rowIds = ['r1', 'r2', 'r3'];
      obj.title = 'Table';
      obj.columns = cols;
      obj.rows = rowIds;
      obj.columnWidths = { c1: 120, c2: 120, c3: 120 };
      obj.rowHeights = { r1: 32, r2: 32, r3: 32 };
      obj.cells = {};
      obj.color = '#e2e8f0';
    }

    // Apply overrides
    Object.assign(obj, extra);

    return obj as unknown as BoardObject;
  }

  _resolveConnectorPoint(connector: BoardObject, side: 'from' | 'to'): Point | null {
    const conn = connector as import('../types.js').Connector;
    const keyId = side === 'from' ? 'fromId' : 'toId';
    const keyT = side === 'from' ? 'fromT' : 'toT';
    const keyPort = side === 'from' ? 'fromPort' : 'toPort';
    const keyPoint = side === 'from' ? 'fromPoint' : 'toPoint';

    if (conn[keyId]) {
      const obj = this.getObject(conn[keyId]!);
      if (obj) {
        // Try t-based first
        if (conn[keyT] != null) {
          return perimeterPoint(obj, conn[keyT]!);
        }
        // Fallback to port-based
        if (conn[keyPort]) {
          const p = getPortPosition(obj, conn[keyPort]!);
          if (p) return p;
        }
      }
    }
    return conn[keyPoint] || null;
  }

  _setObject(obj: BoardObject): void {
    const existing = this.objectsMap.get(obj.id);
    if (existing) {
      // In-place update: only touch changed keys so UndoManager sees field-level diffs
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rec = obj as any;
      for (const key of UNIVERSAL_KEYS) {
        const newVal = rec[key] ?? null;
        const oldVal = existing.get(key);
        // Fast path: skip when both are null (most keys for any given type)
        if (oldVal == null && newVal == null) continue;
        // Fast path: identical primitives (covers x, y, width, height, etc.)
        if (oldVal === newVal) continue;
        // Slow path: deep compare for objects/arrays (style, points, children, etc.)
        if (!valuesEqual(oldVal, newVal)) {
          existing.set(key, newVal);
        }
      }
    } else {
      // New object: create Y.Map with all universal keys
      const yObj = new Y.Map();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rec = obj as any;
      for (const key of UNIVERSAL_KEYS) {
        const val = rec[key];
        yObj.set(key, val ?? null);
      }
      this.objectsMap.set(obj.id, yObj as Y.Map<unknown>);
    }
  }

  _yMapToObj(yMap: Y.Map<unknown>): BoardObject {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const obj: any = {};
    yMap.forEach((val, key) => {
      obj[key] = val;
    });
    if (obj.rotation == null) obj.rotation = 0;
    if (obj.parentFrameId == null) obj.parentFrameId = null;
    return obj as BoardObject;
  }

  _zIndexOf(id: string): number {
    for (let i = 0; i < this.zOrder.length; i++) {
      if (this.zOrder.get(i) === id) return i;
    }
    return -1;
  }

  _removeFromZOrder(id: string): void {
    const idx = this._zIndexOf(id);
    if (idx >= 0) this.zOrder.delete(idx, 1);
  }

  _getFrameDescendants(frameId: string): string[] {
    const out: string[] = [];
    const walk = (id: string) => {
      const frame = this.getObject(id);
      if (!frame || frame.type !== 'frame') return;
      for (const childId of frame.children || []) {
        out.push(childId);
        const child = this.getObject(childId);
        if (child?.type === 'frame') walk(childId);
      }
    };
    walk(frameId);
    return out;
  }

  _removeFrameChild(frameId: string, childId: string): void {
    const frame = this.getObject(frameId);
    if (!frame || frame.type !== 'frame') return;
    frame.children = (frame.children || []).filter((id) => id !== childId);
    this._setObject(frame);
  }

  _addFrameChild(frameId: string, childId: string): void {
    const frame = this.getObject(frameId);
    if (!frame || frame.type !== 'frame') return;
    const children = frame.children || [];
    if (!children.includes(childId)) {
      frame.children = [...children, childId];
      this._setObject(frame);
    }
  }

  _syncContainmentAfterMutation(id: string): void {
    const obj = this.getObject(id);
    if (!obj || obj.type === 'connector') return;

    // Find the smallest containing frame for this object (frames and non-frames alike)
    const descendants = obj.type === 'frame' ? new Set(this._getFrameDescendants(id)) : null;
    const allFrames = this.getAll().filter((o) => o.type === 'frame' && o.id !== id);
    const currentParentId = obj.parentFrameId;
    const currentParent = currentParentId ? this.getObject(currentParentId) : null;

    let nextParent: BoardObject | null = null;
    for (const frame of allFrames) {
      // Prevent circular containment: a frame can't be parented to its own descendant
      if (descendants && descendants.has(frame.id)) continue;
      if (objectContainsObject(frame, obj)) {
        if (!nextParent || frame.width * frame.height < nextParent.width * nextParent.height) {
          nextParent = frame;
        }
      }
    }

    if (currentParent && (!nextParent || nextParent.id !== currentParent.id)) {
      this._removeFrameChild(currentParent.id, obj.id);
    }

    if (nextParent) {
      this._addFrameChild(nextParent.id, obj.id);
    }

    if ((nextParent?.id || null) !== (currentParentId || null)) {
      this._setObject({ ...obj, parentFrameId: nextParent ? nextParent.id : null } as BoardObject);
    }

    // If the mutated object is a frame, also re-sync its children
    if (obj.type === 'frame') {
      const all = this.getAll();
      for (const child of all) {
        if (child.id === id || child.type === 'connector') continue;
        if (child.parentFrameId === id || objectContainsObject(obj, child)) {
          this._syncContainmentAfterMutation(child.id);
        }
      }
    }
  }

  updateTableCell(tableId: string, rowId: string, colId: string, text: string): void {
    const obj = this.getObject(tableId);
    if (!obj || obj.type !== 'table') return;
    const table = obj as import('../types.js').TableObject;
    const cells = { ...(table.cells || {}), [`${rowId}:${colId}`]: text };
    this.updateObject(tableId, { cells });
  }

  updateTableRowHeight(tableId: string, rowId: string, height: number): void {
    const obj = this.getObject(tableId);
    if (!obj || obj.type !== 'table') return;
    const table = obj as import('../types.js').TableObject;
    const rowHeights = { ...(table.rowHeights || {}), [rowId]: height };
    const titleHeight = 28;
    let totalHeight = titleHeight;
    for (const rid of table.rows || []) {
      totalHeight += rowHeights[rid] || 32;
    }
    this.updateObject(tableId, { rowHeights, height: totalHeight });
  }

  addTableColumn(id: string): void {
    const obj = this.getObject(id);
    if (!obj || obj.type !== 'table') return;
    const table = obj as import('../types.js').TableObject;
    const colId = 'c' + nanoid(6);
    const columns = [...(table.columns || []), colId];
    const columnWidths = { ...(table.columnWidths || {}), [colId]: 120 };
    const width = columns.reduce((sum, c) => sum + (columnWidths[c] || 120), 0);
    this.updateObject(id, { columns, columnWidths, width });
  }

  deleteTableColumn(id: string, colId: string): void {
    const obj = this.getObject(id);
    if (!obj || obj.type !== 'table') return;
    const table = obj as import('../types.js').TableObject;
    if ((table.columns || []).length <= 1) return;
    const columns = (table.columns || []).filter((c) => c !== colId);
    const columnWidths = { ...(table.columnWidths || {}) };
    delete columnWidths[colId];
    const cells = { ...(table.cells || {}) };
    for (const rowId of table.rows || []) {
      delete cells[`${rowId}:${colId}`];
    }
    const width = columns.reduce((sum, c) => sum + (columnWidths[c] || 120), 0);
    this.updateObject(id, { columns, columnWidths, cells, width });
  }

  addTableRow(id: string): void {
    const obj = this.getObject(id);
    if (!obj || obj.type !== 'table') return;
    const table = obj as import('../types.js').TableObject;
    const rowId = 'r' + nanoid(6);
    const rows = [...(table.rows || []), rowId];
    const rowHeights = { ...(table.rowHeights || {}), [rowId]: 32 };
    const titleHeight = 28;
    let totalHeight = titleHeight;
    for (const rid of rows) {
      totalHeight += rowHeights[rid] || 32;
    }
    this.updateObject(id, { rows, rowHeights, height: totalHeight });
  }

  deleteTableRow(id: string, rowId: string): void {
    const obj = this.getObject(id);
    if (!obj || obj.type !== 'table') return;
    const table = obj as import('../types.js').TableObject;
    if ((table.rows || []).length <= 1) return;
    const rows = (table.rows || []).filter((r) => r !== rowId);
    const cells = { ...(table.cells || {}) };
    for (const colId of table.columns || []) {
      delete cells[`${rowId}:${colId}`];
    }
    const rowHeights = { ...(table.rowHeights || {}) };
    delete rowHeights[rowId];
    const titleHeight = 28;
    let totalHeight = titleHeight;
    for (const rid of rows) {
      totalHeight += rowHeights[rid] || 32;
    }
    this.updateObject(id, { rows, cells, rowHeights, height: totalHeight });
  }

  getAttachableAtPoint(wx: number, wy: number, excludeIds: string | string[] | null = null, _scale = 1): AttachResult | null {
    const excluded = new Set(Array.isArray(excludeIds) ? excludeIds : excludeIds ? [excludeIds] : []);
    const all = this.getAll().filter((o) => o.type !== 'connector' && o.type !== 'frame' && o.type !== 'text' && !excluded.has(o.id));
    const snapDist = 20;

    for (let i = all.length - 1; i >= 0; i--) {
      const obj = all[i]!;
      // Check if point is inside the shape or within snap distance of AABB
      const aabb = getObjectAABB(obj);
      const nearX = wx >= aabb.x - snapDist && wx <= aabb.x + aabb.width + snapDist;
      const nearY = wy >= aabb.y - snapDist && wy <= aabb.y + aabb.height + snapDist;
      if (nearX && nearY) {
        // Tables: snap to nearest row port
        if (obj.type === 'table') {
          const port = findClosestPort(obj, wx, wy);
          if (port) {
            return { object: obj, t: 0, port: port.name };
          }
        }
        const t = nearestPerimeterT(obj, wx, wy);
        return { object: obj, t };
      }
    }
    return null;
  }
}
