import { nanoid } from 'nanoid';
import {
  clampNumber,
  clampText,
  normalizeAngle,
  normalizeViewportCenter,
  sanitizeColor,
  validateToolArgs,
} from './schema.js';

const BASE_MIN_SIZE = 24;

function clone(value) {
  return structuredClone(value);
}

function yMapToObject(yMap) {
  const out = {};
  yMap.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function toYMap(obj, YMapCtor) {
  const y = new YMapCtor();
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) y.set(k, v);
  }
  return y;
}

export class BoardToolRunner {
  static fromYDoc(doc, options = {}) {
    const objectsMap = doc.getMap('objects');
    const zOrder = doc.getArray('zOrder');

    const objects = new Map();
    for (const [id, yObj] of objectsMap.entries()) {
      objects.set(id, yMapToObject(yObj));
    }

    const order = [];
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

  constructor({ doc, objects, order, viewportCenter, actorId, now }) {
    this.doc = doc;
    this.objects = objects;
    this.order = order;
    this.actorId = actorId || `ai:${nanoid(8)}`;
    this.viewportCenter = normalizeViewportCenter(viewportCenter);
    this.now = now || Date.now;
    this.placementCount = 0;

    this.createdIds = new Set();
    this.updatedIds = new Set();
    this.deletedIds = new Set();
    this.toolCalls = [];
  }

  invoke(toolName, rawArgs = {}) {
    if (typeof this[toolName] !== 'function') {
      throw new Error(`Unsupported tool: ${toolName}`);
    }

    const args = validateToolArgs(toolName, rawArgs);
    const result = this[toolName](args);

    this.toolCalls.push({ toolName, args, result });
    return result;
  }

  _nextPlacement(defaultWidth = 200, defaultHeight = 120) {
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

  _touchUpdated(id) {
    if (!this.createdIds.has(id) && this.objects.has(id)) {
      this.updatedIds.add(id);
    }
  }

  _markDeleted(id) {
    this.createdIds.delete(id);
    this.updatedIds.delete(id);
    this.deletedIds.add(id);
  }

  _setObject(obj, { created = false } = {}) {
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

  _deleteObject(id) {
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

  _createBase(type, x, y, width, height) {
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

  createStickyNote(raw = {}) {
    const args = validateToolArgs('createStickyNote', raw);
    const placement = args.x == null || args.y == null ? this._nextPlacement(150, 150) : { x: args.x, y: args.y };

    const obj = {
      ...this._createBase('sticky', placement.x, placement.y, 150, 150),
      text: args.text,
      color: sanitizeColor(args.color, 'yellow'),
    };
    this._setObject(obj, { created: true });
    return { id: obj.id };
  }

  createShape(raw = {}) {
    const args = validateToolArgs('createShape', raw);
    const placement = args.x == null || args.y == null
      ? this._nextPlacement(args.width, args.height)
      : { x: args.x, y: args.y };

    const type = args.type === 'ellipse' ? 'ellipse' : 'rectangle';
    const defaults = type === 'ellipse' ? { color: 'teal' } : { color: 'blue' };
    const obj = {
      ...this._createBase(type, placement.x, placement.y, args.width, args.height),
      color: sanitizeColor(args.color, defaults.color),
      strokeColor: 'gray',
    };

    this._setObject(obj, { created: true });
    return { id: obj.id };
  }

  createFrame(raw = {}) {
    const args = validateToolArgs('createFrame', raw);
    const placement = args.x == null || args.y == null
      ? this._nextPlacement(args.width, args.height)
      : { x: args.x, y: args.y };

    const obj = {
      ...this._createBase('frame', placement.x, placement.y, args.width, args.height),
      title: args.title || 'Frame',
      color: 'gray',
      children: [],
    };

    this._setObject(obj, { created: true });
    return { id: obj.id };
  }

  createConnector(raw = {}) {
    const args = validateToolArgs('createConnector', raw);

    const fromId = args.fromId && this.objects.has(args.fromId) ? args.fromId : null;
    const toId = args.toId && this.objects.has(args.toId) ? args.toId : null;

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
    return { id: obj.id };
  }

  createText(raw = {}) {
    const args = validateToolArgs('createText', raw);
    const placement = args.x == null || args.y == null ? this._nextPlacement(220, 60) : { x: args.x, y: args.y };

    const obj = {
      ...this._createBase('text', placement.x, placement.y, 220, 60),
      content: args.content,
      color: sanitizeColor(args.color, 'gray'),
      style: {
        bold: args.bold,
        italic: args.italic,
        size: args.fontSize,
      },
    };

    this._setObject(obj, { created: true });
    return { id: obj.id };
  }

  moveObject(raw = {}) {
    const args = validateToolArgs('moveObject', raw);
    const obj = this.objects.get(args.objectId);
    if (!obj) return { ok: false, error: 'Object not found' };
    if (obj.type === 'connector') return { ok: false, error: 'Connectors cannot be moved directly' };

    const next = { ...obj, x: args.x, y: args.y };
    this._setObject(next);
    return { ok: true };
  }

  resizeObject(raw = {}) {
    const args = validateToolArgs('resizeObject', raw);
    const obj = this.objects.get(args.objectId);
    if (!obj) return { ok: false, error: 'Object not found' };
    if (obj.type === 'connector') return { ok: false, error: 'Connectors cannot be resized' };

    const next = {
      ...obj,
      width: Math.max(BASE_MIN_SIZE, args.width),
      height: Math.max(BASE_MIN_SIZE, args.height),
    };
    this._setObject(next);
    return { ok: true };
  }

  updateText(raw = {}) {
    const args = validateToolArgs('updateText', raw);
    const obj = this.objects.get(args.objectId);
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

  changeColor(raw = {}) {
    const args = validateToolArgs('changeColor', raw);
    const obj = this.objects.get(args.objectId);
    if (!obj) return { ok: false, error: 'Object not found' };
    if (obj.type === 'connector') return { ok: false, error: 'Connectors do not support palette color updates' };

    this._setObject({ ...obj, color: sanitizeColor(args.color, obj.color || 'gray') });
    return { ok: true };
  }

  rotateObject(raw = {}) {
    const args = validateToolArgs('rotateObject', raw);
    const obj = this.objects.get(args.objectId);
    if (!obj) return { ok: false, error: 'Object not found' };
    if (obj.type === 'connector') return { ok: false, error: 'Connectors cannot be rotated' };

    this._setObject({ ...obj, rotation: normalizeAngle(args.angleDegrees) });
    return { ok: true };
  }

  deleteObject(raw = {}) {
    const args = validateToolArgs('deleteObject', raw);
    const deleted = this._deleteObject(args.objectId);
    return { ok: deleted };
  }

  getBoardState() {
    return this.getCompactBoardState();
  }

  getCompactBoardState() {
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

  applyToDoc() {
    const objectsMap = this.doc.getMap('objects');
    const zOrder = this.doc.getArray('zOrder');
    const YMapCtor = objectsMap.constructor;

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
          const id = zOrder.get(i);
          if (deletedIds.includes(id)) zOrder.delete(i, 1);
        }
      }

      if (createdIds.length) {
        const live = new Set();
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
