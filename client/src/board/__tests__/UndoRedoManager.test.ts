import { beforeEach, describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import { ObjectStore } from '../ObjectStore.js';
import { UndoRedoManager } from '../UndoRedoManager.js';

let doc: Y.Doc;
let store: ObjectStore;
let undoRedo: UndoRedoManager;

beforeEach(() => {
  doc = new Y.Doc();
  store = new ObjectStore(doc);
  undoRedo = new UndoRedoManager(store);
});

describe('UndoRedoManager', () => {
  test('first local undo enables redo and disables undo', () => {
    const created = store.createObject('sticky', 10, 10, 120, 120, { text: 'a' });
    expect(store.getObject(created.id)).not.toBeNull();
    expect(undoRedo.canUndo()).toBe(true);
    expect(undoRedo.canRedo()).toBe(false);

    undoRedo.undo();

    expect(store.getObject(created.id)).toBeNull();
    expect(undoRedo.canUndo()).toBe(false);
    expect(undoRedo.canRedo()).toBe(true);
  });

  test('can undo local change then undo AI change', () => {
    undoRedo.snapshotForAI();
    store.transactionOrigin = 'remote-ai';
    const aiObj = store.createObject('sticky', 100, 100, 120, 120, { text: 'ai' });
    store.transactionOrigin = 'local';
    undoRedo.pushAIUndoEntry({ createdIds: [aiObj.id] });

    const localObj = store.createObject('sticky', 200, 200, 120, 120, { text: 'local' });

    expect(undoRedo.canUndo()).toBe(true);
    expect(undoRedo.canRedo()).toBe(false);
    expect(store.getObject(aiObj.id)).not.toBeNull();
    expect(store.getObject(localObj.id)).not.toBeNull();

    undoRedo.undo();

    expect(store.getObject(localObj.id)).toBeNull();
    expect(store.getObject(aiObj.id)).not.toBeNull();
    expect(undoRedo.canUndo()).toBe(true);
    expect(undoRedo.canRedo()).toBe(true);

    undoRedo.undo();

    expect(store.getObject(aiObj.id)).toBeNull();
    expect(undoRedo.canUndo()).toBe(false);
    expect(undoRedo.canRedo()).toBe(true);
  });

  test('redo survives yjs redo when AI entries are also in redo stack', () => {
    const first = store.createObject('sticky', 10, 10, 120, 120, { text: 'first' });
    undoRedo.stopCapturing();

    undoRedo.snapshotForAI();
    store.transactionOrigin = 'remote-ai';
    const aiObj = store.createObject('sticky', 100, 100, 120, 120, { text: 'ai' });
    store.transactionOrigin = 'local';
    undoRedo.pushAIUndoEntry({ createdIds: [aiObj.id] });

    const last = store.createObject('sticky', 200, 200, 120, 120, { text: 'last' });
    undoRedo.stopCapturing();

    undoRedo.undo(); // undo last local
    undoRedo.undo(); // undo ai
    undoRedo.undo(); // undo first local

    expect(store.getObject(first.id)).toBeNull();
    expect(store.getObject(aiObj.id)).toBeNull();
    expect(store.getObject(last.id)).toBeNull();
    expect(undoRedo.canRedo()).toBe(true);

    undoRedo.redo(); // redo first local
    expect(store.getObject(first.id)).not.toBeNull();
    expect(undoRedo.canRedo()).toBe(true);

    undoRedo.redo(); // redo ai
    expect(store.getObject(aiObj.id)).not.toBeNull();
    expect(undoRedo.canRedo()).toBe(true);

    undoRedo.redo(); // redo last local
    expect(store.getObject(last.id)).not.toBeNull();
    expect(undoRedo.canRedo()).toBe(false);
  });
});
