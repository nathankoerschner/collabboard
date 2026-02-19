import type { CursorData, RemoteCursor } from '../types.js';
import { getPresenceColor } from './presenceColor.js';

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
  localUser: { name?: string; id?: string };
  remoteCursors = new Map<number, RemoteCursor>();
  lastSendTime = 0;

  private readonly _onAwarenessChange: () => void;

  constructor(awareness: Awareness, localUser: { name?: string; id?: string } = {}) {
    this.awareness = awareness;
    this.localUser = localUser;

    const localPresenceUser = {
      id: localUser.id,
      name: localUser.name || 'Anonymous',
    };
    const localStateUser: Record<string, unknown> = {
      ...localPresenceUser,
      color: getPresenceColor(localPresenceUser, awareness.clientID),
    };
    awareness.setLocalStateField('user', localStateUser);

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
    const latestClientByUserKey = new Map<string, number>();

    for (const [clientId, state] of states) {
      if (clientId === localClientId) continue;
      const cursor = state.cursor as { x: number; y: number } | undefined;
      if (!cursor) continue;

      const user = (state.user || {}) as { id?: string; sub?: string };
      const userKey = this._getUserKey(clientId, user);
      const existingClientId = latestClientByUserKey.get(userKey);
      if (existingClientId === undefined || clientId > existingClientId) {
        latestClientByUserKey.set(userKey, clientId);
      }
    }

    const activeClientIds = new Set(latestClientByUserKey.values());

    for (const clientId of this.remoteCursors.keys()) {
      if (!states.has(clientId) || !activeClientIds.has(clientId)) {
        this.remoteCursors.delete(clientId);
      }
    }

    for (const [clientId, state] of states) {
      if (!activeClientIds.has(clientId)) continue;
      if (clientId === localClientId) continue;
      const cursor = state.cursor as { x: number; y: number } | undefined;
      if (!cursor) continue;

      const existing = this.remoteCursors.get(clientId);
      const user = (state.user || {}) as { id?: string; sub?: string; name?: string; color?: string };
      const color = user.color || getPresenceColor(user, clientId);

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

  private _getUserKey(clientId: number, user: { id?: string; sub?: string }): string {
    const stableId = user.id || user.sub;
    if (typeof stableId === 'string' && stableId.length > 0) return stableId;
    return `client:${clientId}`;
  }

  destroy(): void {
    this.awareness.off('change', this._onAwarenessChange);
  }
}
