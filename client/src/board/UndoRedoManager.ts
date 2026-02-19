import * as Y from 'yjs';
import type { BoardObject } from '../types.js';
import type { ObjectStore } from './ObjectStore.js';

const STACK_CAP = 100;

interface AIUndoData {
  createdIds: string[];
  deletedObjects: BoardObject[];
  updatedObjects: { before: BoardObject; after: BoardObject }[];
  // Populated lazily on first undo so redo can recreate them
  _createdObjects?: BoardObject[];
}

type UndoEntry = { kind: 'yjs' } | { kind: 'ai'; data: AIUndoData };

export class UndoRedoManager {
  private undoManager: Y.UndoManager;
  private objectStore: ObjectStore;
  private stackChangeListeners: Array<() => void> = [];

  // Meta-stacks tracking interleaved order of yjs + AI undo entries
  private metaUndo: UndoEntry[] = [];
  private metaRedo: UndoEntry[] = [];

  // Snapshot taken before an AI command for building undo data
  private aiSnapshot: Map<string, BoardObject> | null = null;

  constructor(objectStore: ObjectStore) {
    this.objectStore = objectStore;
    this.undoManager = new Y.UndoManager(
      [objectStore.objectsMap, objectStore.zOrder],
      {
        captureTimeout: 500,
        trackedOrigins: new Set(['local', 'gesture', 'text-edit']),
      },
    );

    this.undoManager.on('stack-item-added', () => {
      this.metaUndo.push({ kind: 'yjs' });
      this.metaRedo = [];
      this._trimStacks();
      this._notifyStackChange();
    });

    this.undoManager.on('stack-item-popped', () => {
      this._notifyStackChange();
    });
  }

  /** Take a snapshot of all objects before an AI command. */
  snapshotForAI(): void {
    this.aiSnapshot = new Map(
      this.objectStore.getAll().map((o) => [o.id, structuredClone(o)]),
    );
  }

  /** After an AI command returns, build and push a precise undo entry. */
  pushAIUndoEntry(result: {
    createdIds?: string[];
    updatedIds?: string[];
    deletedIds?: string[];
  }): void {
    const snapshot = this.aiSnapshot;
    this.aiSnapshot = null;
    if (!snapshot) return;

    const createdIds = result.createdIds || [];
    const updatedIds = result.updatedIds || [];
    const deletedIds = result.deletedIds || [];

    if (!createdIds.length && !updatedIds.length && !deletedIds.length) return;

    const deletedObjects: BoardObject[] = [];
    for (const id of deletedIds) {
      const before = snapshot.get(id);
      if (before) deletedObjects.push(before);
    }

    const updatedObjects: { before: BoardObject; after: BoardObject }[] = [];
    for (const id of updatedIds) {
      const before = snapshot.get(id);
      const after = this.objectStore.getObject(id);
      if (before && after) {
        updatedObjects.push({ before, after: structuredClone(after) });
      }
    }

    const data: AIUndoData = { createdIds, deletedObjects, updatedObjects };
    this.metaUndo.push({ kind: 'ai', data });
    this.metaRedo = [];
    this._trimStacks();
    this._notifyStackChange();
  }

  undo(): void {
    const entry = this.metaUndo.at(-1);
    if (!entry) return;

    if (entry.kind === 'yjs') {
      if (this.undoManager.undoStack.length === 0) return;
      this.metaUndo.pop();
      this.metaRedo.push({ kind: 'yjs' });
      this.undoManager.undo();
    } else {
      this.metaUndo.pop();
      this._applyAIReverse(entry.data);
      this.metaRedo.push(entry);
      this._notifyStackChange();
    }
  }

  redo(): void {
    const entry = this.metaRedo.at(-1);
    if (!entry) return;

    if (entry.kind === 'yjs') {
      if (this.undoManager.redoStack.length === 0) return;
      this.metaRedo.pop();
      this.metaUndo.push({ kind: 'yjs' });
      this.undoManager.redo();
    } else {
      this.metaRedo.pop();
      this._applyAIForward(entry.data);
      this.metaUndo.push(entry);
      this._notifyStackChange();
    }
  }

  canUndo(): boolean {
    return this.metaUndo.length > 0;
  }

  canRedo(): boolean {
    return this.metaRedo.length > 0;
  }

  stopCapturing(): void {
    this.undoManager.stopCapturing();
  }

  onStackChange(cb: () => void): void {
    this.stackChangeListeners.push(cb);
  }

  destroy(): void {
    this.undoManager.destroy();
    this.stackChangeListeners.length = 0;
  }

  /** Undo AI: delete created, recreate deleted, restore updated to before-state. */
  private _applyAIReverse(data: AIUndoData): void {
    const store = this.objectStore;
    const prevOrigin = store.transactionOrigin;
    store.transactionOrigin = '__ai-undo__';

    // Snapshot created objects before deleting so redo can recreate them
    if (!data._createdObjects) {
      data._createdObjects = data.createdIds
        .map((id) => store.getObject(id))
        .filter((o): o is BoardObject => !!o)
        .map((o) => structuredClone(o));
    }

    if (data.createdIds.length) {
      store.deleteObjects(data.createdIds);
    }
    for (const obj of data.deletedObjects) {
      store.createObjectFromSnapshot(obj);
    }
    for (const { before } of data.updatedObjects) {
      store.updateObject(before.id, before as unknown as Record<string, unknown>);
    }

    store.transactionOrigin = prevOrigin;
  }

  /** Redo AI: recreate created, delete previously-deleted, restore updated to after-state. */
  private _applyAIForward(data: AIUndoData): void {
    const store = this.objectStore;
    const prevOrigin = store.transactionOrigin;
    store.transactionOrigin = '__ai-undo__';

    for (const obj of data.deletedObjects) {
      store.deleteObjects([obj.id]);
    }
    if (data._createdObjects) {
      for (const obj of data._createdObjects) {
        store.createObjectFromSnapshot(obj);
      }
    }
    for (const { after } of data.updatedObjects) {
      store.updateObject(after.id, after as unknown as Record<string, unknown>);
    }

    store.transactionOrigin = prevOrigin;
  }

  private _trimStacks(): void {
    while (this.metaUndo.length > STACK_CAP) {
      const removed = this.metaUndo.shift()!;
      if (removed.kind === 'yjs' && this.undoManager.undoStack.length > 0) {
        this.undoManager.undoStack.shift();
      }
    }
  }

  private _notifyStackChange(): void {
    for (const cb of this.stackChangeListeners) {
      cb();
    }
  }
}
