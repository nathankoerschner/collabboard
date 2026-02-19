import { getPresenceColor } from './presenceColor.js';

interface Awareness {
  clientID: number;
  getStates(): Map<number, Record<string, unknown>>;
  on(event: string, cb: () => void): void;
  off(event: string, cb: () => void): void;
}

export class PresencePanel {
  awareness: Awareness;
  el: HTMLDivElement;

  private readonly _onAwarenessChange: () => void;

  constructor(container: HTMLElement, awareness: Awareness) {
    this.awareness = awareness;
    this.el = document.createElement('div');
    this.el.className = 'presence-panel';
    container.appendChild(this.el);

    this._onAwarenessChange = () => this._render();
    awareness.on('change', this._onAwarenessChange);
    this._render();
  }

  _render(): void {
    const states = this.awareness.getStates();
    const localId = this.awareness.clientID;

    // Deduplicate: keep only the highest clientId per user key
    // (reconnects create new clientIds; old awareness states may linger)
    const latestClientByUserKey = new Map<string, number>();
    for (const [clientId, state] of states) {
      const user = (state.user || {}) as { id?: string; sub?: string; name?: string };
      if (!user.name && !user.id && !user.sub) continue; // skip headless/empty states
      const userKey = this._getUserKey(clientId, user);
      const existing = latestClientByUserKey.get(userKey);
      if (existing === undefined || clientId > existing) {
        latestClientByUserKey.set(userKey, clientId);
      }
    }
    const activeClientIds = new Set(latestClientByUserKey.values());

    let html = '';
    for (const clientId of activeClientIds) {
      const state = states.get(clientId);
      if (!state) continue;
      const user = (state.user || {}) as { id?: string; sub?: string; name?: string; color?: string };
      const name = user.name || 'Anonymous';
      const color = user.color || getPresenceColor(user, clientId);
      const isLocal = clientId === localId;
      const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
      const label = isLocal ? `${name} (you)` : name;

      html += `
        <div class="presence-user">
          <div class="presence-avatar" style="background: ${color}">${initials}</div>
          <div class="presence-tooltip">${label}</div>
        </div>
      `;
    }

    this.el.innerHTML = html;
  }

  private _getUserKey(clientId: number, user: { id?: string; sub?: string }): string {
    const stableId = user.id || user.sub;
    if (typeof stableId === 'string' && stableId.length > 0) return stableId;
    return `client:${clientId}`;
  }

  destroy(): void {
    this.awareness.off('change', this._onAwarenessChange);
    this.el.remove();
  }
}
