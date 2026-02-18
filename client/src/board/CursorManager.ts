import type { CursorData, RemoteCursor } from '../types.js';

const CURSOR_PALETTE = [
  '#e74c3c', '#3498db', '#2ecc71', '#9b59b6',
  '#e67e22', '#1abc9c', '#e84393', '#00b894',
  '#fdcb6e', '#6c5ce7', '#00cec9', '#d63031',
];

const SEND_INTERVAL = 1000 / 15; // 15Hz
const LERP_FACTOR = 0.15;

// y-websocket awareness type is complex; use a minimal interface
interface Awareness {
  clientID: number;
  setLocalStateField(field: string, value: unknown): void;
  getStates(): Map<number, Record<string, unknown>>;
  on(event: string, cb: () => void): void;
  off(event: string, cb: () => void): void;
}

export class CursorManager {
  awareness: Awareness;
  localUser: { name?: string };
  remoteCursors = new Map<number, RemoteCursor>();
  lastSendTime = 0;

  private readonly _onAwarenessChange: () => void;

  constructor(awareness: Awareness, localUser: { name?: string } = {}) {
    this.awareness = awareness;
    this.localUser = localUser;

    awareness.setLocalStateField('user', {
      name: localUser.name || 'Anonymous',
      color: CURSOR_PALETTE[awareness.clientID % CURSOR_PALETTE.length],
    });

    this._onAwarenessChange = this._handleAwarenessChange.bind(this);
    awareness.on('change', this._onAwarenessChange);
  }

  sendCursor(wx: number, wy: number): void {
    const now = Date.now();
    if (now - this.lastSendTime < SEND_INTERVAL) return;
    this.lastSendTime = now;
    this.awareness.setLocalStateField('cursor', { x: wx, y: wy });
  }

  getCursors(): CursorData[] {
    const result: CursorData[] = [];
    const now = Date.now();
    for (const [clientId, cursor] of this.remoteCursors) {
      cursor.currentX += (cursor.targetX - cursor.currentX) * LERP_FACTOR;
      cursor.currentY += (cursor.targetY - cursor.currentY) * LERP_FACTOR;
      if (now - cursor.lastUpdate > 5000) continue;
      result.push({
        x: cursor.currentX,
        y: cursor.currentY,
        name: cursor.name,
        color: cursor.color,
        clientId,
      });
    }
    return result;
  }

  private _handleAwarenessChange(): void {
    const states = this.awareness.getStates();
    const localClientId = this.awareness.clientID;

    for (const clientId of this.remoteCursors.keys()) {
      if (!states.has(clientId)) {
        this.remoteCursors.delete(clientId);
      }
    }

    for (const [clientId, state] of states) {
      if (clientId === localClientId) continue;
      const cursor = state.cursor as { x: number; y: number } | undefined;
      if (!cursor) continue;

      const existing = this.remoteCursors.get(clientId);
      const user = (state.user || {}) as { name?: string; color?: string };
      const color = user.color || CURSOR_PALETTE[clientId % CURSOR_PALETTE.length]!;

      if (existing) {
        existing.targetX = cursor.x;
        existing.targetY = cursor.y;
        existing.name = user.name || 'Anonymous';
        existing.color = color;
        existing.lastUpdate = Date.now();
      } else {
        this.remoteCursors.set(clientId, {
          targetX: cursor.x,
          targetY: cursor.y,
          currentX: cursor.x,
          currentY: cursor.y,
          name: user.name || 'Anonymous',
          color,
          lastUpdate: Date.now(),
        });
      }
    }
  }

  destroy(): void {
    this.awareness.off('change', this._onAwarenessChange);
  }
}
