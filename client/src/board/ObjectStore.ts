import { nanoid } from 'nanoid';
import * as Y from 'yjs';
import type { BoardObject, ConnectorObject, ObjectType, PaletteName, Point, PortName, TextStyle } from '../../../shared/types.js';
import {
  findClosestPort,
  getConnectorEndpoints,
  getObjectAABB,
  getObjectCenter,
  getPortPosition,
  normalizeAngle,
  objectContainsObject,
  PortInfo,
  rotatePoint,
} from '../canvas/Geometry.js';

const PALETTE: Record<PaletteName, string> = {
  yellow: '#fef08a',
  blue: '#bfdbfe',
  green: '#bbf7d0',
  pink: '#fecdd3',
  purple: '#e9d5ff',
  orange: '#fed7aa',
  red: '#fecaca',
  teal: '#99f6e4',
  gray: '#e5e7eb',
  white: '#ffffff',
};

const BASE_MIN_SIZE = 24;

export class ObjectStore {
  doc: Y.Doc;
  objectsMap: Y.Map<Y.Map<unknown>>;
  zOrder: Y.Array<string>;

  constructor(doc: Y.Doc) {
    this.doc = doc;
    this.objectsMap = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
    this.zOrder = doc.getArray('zOrder') as Y.Array<string>;
  }

  createObject(type: ObjectType, x: number, y: number, width: number, height: number, extra: Record<string, unknown> = {}): BoardObject {
    const id = nanoid(12);
    const obj = this._buildDefaultObject(id, type, x, y, width, height, extra);

    this.doc.transact(() => {
      this._setObject(obj);
      this.zOrder.push([id]);
      this._syncContainmentAfterMutation(id);
    });

    return obj;
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
    });
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

    this.doc.transact(() => {
      for (const id of moveSet) {
        const obj = this.getObject(id);
        if (!obj) continue;
        this._setObject({ ...obj, x: obj.x + dx, y: obj.y + dy } as BoardObject);
      }

      for (const id of moveSet) {
        this._syncContainmentAfterMutation(id);
      }
    });
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
    });
  }

  rotateObjects(ids: string[], deltaAngle: number, pivot: Point | null = null): void {
    if (!ids.length || deltaAngle === 0) return;

    const current = ids.map((id) => this.getObject(id)).filter((o): o is BoardObject => o !== null);
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
        this._syncContainmentAfterMutation(obj.id);
      }
    });
  }

  updateText(id: string, value: string): void {
    const obj = this.getObject(id);
    if (!obj) return;

    this.doc.transact(() => {
      if (obj.type === 'text') {
        this._setObject({ ...obj, content: value });
      } else if (obj.type === 'sticky') {
        this._setObject({ ...obj, text: value });
      }
    });
  }

  updateTextStyle(id: string, stylePatch: Partial<TextStyle>): void {
    const obj = this.getObject(id);
    if (!obj || obj.type !== 'text') return;

    const style: TextStyle = { ...obj.style, ...stylePatch };
    this.doc.transact(() => {
      this._setObject({ ...obj, style });
    });
  }

  updateColor(id: string, color: string): void {
    const obj = this.getObject(id);
    if (!obj) return;
    this.doc.transact(() => {
      this._setObject({ ...obj, color } as BoardObject);
    });
  }

  updateConnectorEndpoint(id: string, side: 'start' | 'end', payload: { objectId?: string; port?: string; point?: Point }): void {
    const obj = this.getObject(id);
    if (!obj || obj.type !== 'connector') return;

    const keyPrefix = side === 'start' ? 'from' : 'to';
    const next = { ...obj } as Record<string, unknown>;

    if (payload?.objectId) {
      next[`${keyPrefix}Id`] = payload.objectId;
      next[`${keyPrefix}Port`] = payload.port || null;
      next[`${keyPrefix}Point`] = null;
    } else if (payload?.point) {
      next[`${keyPrefix}Id`] = null;
      next[`${keyPrefix}Port`] = null;
      next[`${keyPrefix}Point`] = { x: payload.point.x, y: payload.point.y };
    }

    this.doc.transact(() => {
      this._setObject(next as unknown as BoardObject);
    });
  }

  startConnector(x: number, y: number): ConnectorObject {
    return this.createObject('connector', x, y, 0, 0, {
      fromPoint: { x, y },
      toPoint: { x, y },
      style: 'arrow',
      points: [],
    }) as ConnectorObject;
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

      const deleting = [...expanded].map((id) => this.getObject(id)).filter((o): o is BoardObject => o !== null);
      const deletingIds = new Set(deleting.map((o) => o.id));
      const all = this.getAll();

      for (const conn of all) {
        if (conn.type !== 'connector' || deletingIds.has(conn.id)) continue;
        let dirty = false;
        const next = { ...conn };

        if (conn.fromId && deletingIds.has(conn.fromId)) {
          const deleted = deleting.find((o) => o.id === conn.fromId);
          next.fromPoint = deleted && conn.fromPort ? getPortPosition(deleted, conn.fromPort) : getConnectorEndpoints(conn, new Map(all.map((o) => [o.id, o]))).start;
          next.fromId = null;
          next.fromPort = null;
          dirty = true;
        }

        if (conn.toId && deletingIds.has(conn.toId)) {
          const deleted = deleting.find((o) => o.id === conn.toId);
          next.toPoint = deleted && conn.toPort ? getPortPosition(deleted, conn.toPort) : getConnectorEndpoints(conn, new Map(all.map((o) => [o.id, o]))).end;
          next.toId = null;
          next.toPort = null;
          dirty = true;
        }

        if (dirty) this._setObject(next);
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
    });
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
    });
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
        obj.children = (obj.children || []).map((id) => idMap.get(id)).filter((id): id is string => id != null);
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

    this.doc.transact(() => {
      for (const obj of clones) {
        this._setObject(obj);
        this.zOrder.push([obj.id]);
      }
      for (const obj of clones) {
        this._syncContainmentAfterMutation(obj.id);
      }
    });

    return clones.map((o) => o.id);
  }

  getPalette(): Record<PaletteName, string> {
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

  getAttachableAtPoint(wx: number, wy: number, excludeId: string | null = null): { object: BoardObject; port: PortInfo } | null {
    const all = this.getAll().filter((o) => o.type !== 'connector' && o.id !== excludeId);
    for (let i = all.length - 1; i >= 0; i--) {
      const obj = all[i];
      const port = findClosestPort(obj, wx, wy);
      if (!port) continue;
      const dx = port.x - wx;
      const dy = port.y - wy;
      if (dx * dx + dy * dy <= 20 * 20) {
        return { object: obj, port };
      }
    }
    return null;
  }

  private _buildDefaultObject(id: string, type: ObjectType, x: number, y: number, width: number, height: number, extra: Record<string, unknown>): BoardObject {
    const base = {
      id,
      type,
      x,
      y,
      width,
      height,
      rotation: 0,
      createdBy: 'local',
      parentFrameId: null,
    };

    if (type === 'sticky') {
      return { ...base, type: 'sticky', text: '', color: 'yellow', ...extra } as BoardObject;
    }
    if (type === 'rectangle') {
      return { ...base, type: 'rectangle', color: 'blue', strokeColor: 'gray', ...extra } as BoardObject;
    }
    if (type === 'ellipse') {
      return { ...base, type: 'ellipse', color: 'teal', strokeColor: 'gray', ...extra } as BoardObject;
    }
    if (type === 'text') {
      return {
        ...base,
        type: 'text',
        content: '',
        color: 'gray',
        style: { bold: false, italic: false, size: 'medium' as const },
        ...extra,
      } as BoardObject;
    }
    if (type === 'connector') {
      return {
        ...base,
        type: 'connector',
        width: 0,
        height: 0,
        fromId: null,
        toId: null,
        fromPort: null,
        toPort: null,
        fromPoint: null,
        toPoint: null,
        style: 'arrow' as const,
        points: [],
        ...extra,
      } as BoardObject;
    }
    if (type === 'frame') {
      return {
        ...base,
        type: 'frame',
        title: 'Frame',
        color: 'gray',
        children: [],
        ...extra,
      } as BoardObject;
    }

    return { ...base, ...extra } as BoardObject;
  }

  private _resolveConnectorPoint(connector: ConnectorObject, side: 'from' | 'to'): Point | null {
    const keyId = side === 'from' ? 'fromId' : 'toId' as const;
    const keyPort = side === 'from' ? 'fromPort' : 'toPort' as const;
    const keyPoint = side === 'from' ? 'fromPoint' : 'toPoint' as const;

    if (connector[keyId] && connector[keyPort]) {
      const obj = this.getObject(connector[keyId]!);
      if (obj) {
        const p = getPortPosition(obj, connector[keyPort]!);
        if (p) return p;
      }
    }
    return connector[keyPoint] || null;
  }

  private _setObject(obj: BoardObject): void {
    const yObj = new Y.Map();
    for (const [key, val] of Object.entries(obj)) {
      yObj.set(key, val);
    }
    this.objectsMap.set(obj.id, yObj as Y.Map<unknown>);
  }

  private _yMapToObj(yMap: Y.Map<unknown>): BoardObject {
    const obj: Record<string, unknown> = {};
    yMap.forEach((val, key) => {
      obj[key] = val;
    });
    if (obj.rotation == null) obj.rotation = 0;
    if (obj.parentFrameId == null) obj.parentFrameId = null;
    return obj as unknown as BoardObject;
  }

  private _zIndexOf(id: string): number {
    for (let i = 0; i < this.zOrder.length; i++) {
      if (this.zOrder.get(i) === id) return i;
    }
    return -1;
  }

  private _removeFromZOrder(id: string): void {
    const idx = this._zIndexOf(id);
    if (idx >= 0) this.zOrder.delete(idx, 1);
  }

  private _getFrameDescendants(frameId: string): string[] {
    const out: string[] = [];
    const walk = (id: string): void => {
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

  private _removeFrameChild(frameId: string, childId: string): void {
    const frame = this.getObject(frameId);
    if (!frame || frame.type !== 'frame') return;
    const updated = { ...frame, children: (frame.children || []).filter((id) => id !== childId) };
    this._setObject(updated);
  }

  private _addFrameChild(frameId: string, childId: string): void {
    const frame = this.getObject(frameId);
    if (!frame || frame.type !== 'frame') return;
    const children = frame.children || [];
    if (!children.includes(childId)) {
      const updated = { ...frame, children: [...children, childId] };
      this._setObject(updated);
    }
  }

  private _syncContainmentAfterMutation(id: string): void {
    const obj = this.getObject(id);
    if (!obj || obj.type === 'connector') return;

    if (obj.type === 'frame') {
      const all = this.getAll();
      for (const child of all) {
        if (child.id === id || child.type === 'connector') continue;
        if (child.parentFrameId === id || objectContainsObject(obj, child)) {
          this._syncContainmentAfterMutation(child.id);
        }
      }
      return;
    }

    const allFrames = this.getAll().filter((o) => o.type === 'frame' && o.id !== id);
    const currentParentId = obj.parentFrameId;
    const currentParent = currentParentId ? this.getObject(currentParentId) : null;

    let nextParent: BoardObject | null = null;
    for (const frame of allFrames) {
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
  }
}
