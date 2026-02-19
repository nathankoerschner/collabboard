import { describe, expect, test } from 'vitest';
import { CursorManager } from '../CursorManager.js';

type AwarenessState = Record<string, unknown>;

class MockAwareness {
  clientID: number;
  private states: Map<number, AwarenessState>;
  private listeners = new Map<string, Set<() => void>>();

  constructor(clientID: number, initialStates: Map<number, AwarenessState> = new Map()) {
    this.clientID = clientID;
    this.states = initialStates;
  }

  setLocalStateField(field: string, value: unknown): void {
    const current = this.states.get(this.clientID) || {};
    this.states.set(this.clientID, { ...current, [field]: value });
    this.emit('change');
  }

  getStates(): Map<number, AwarenessState> {
    return this.states;
  }

  on(event: string, cb: () => void): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
  }

  off(event: string, cb: () => void): void {
    this.listeners.get(event)?.delete(cb);
  }

  emit(event: string): void {
    for (const cb of this.listeners.get(event) || []) cb();
  }
}

describe('CursorManager', () => {
  test('does not render duplicate cursors for same user during refresh overlap', () => {
    const awareness = new MockAwareness(1);
    const manager = new CursorManager(awareness, { name: 'Me' });

    awareness.getStates().set(2, {
      user: { id: 'user-1', name: 'Alice', color: '#f00' },
      cursor: { x: 100, y: 100 },
    });
    awareness.getStates().set(3, {
      user: { id: 'user-1', name: 'Alice', color: '#0f0' },
      cursor: { x: 120, y: 100 },
    });
    awareness.emit('change');

    expect(manager.getCursors()).toHaveLength(1);
  });
});
