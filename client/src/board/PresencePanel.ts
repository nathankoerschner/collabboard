import type { Awareness } from 'y-protocols/awareness';

const CURSOR_PALETTE = [
  '#e74c3c', '#3498db', '#2ecc71', '#9b59b6',
  '#e67e22', '#1abc9c', '#e84393', '#00b894',
  '#fdcb6e', '#6c5ce7', '#00cec9', '#d63031',
];

export class PresencePanel {
  awareness: Awareness;
  el: HTMLDivElement;
  private _onAwarenessChange: () => void;

  constructor(container: HTMLElement, awareness: Awareness) {
    this.awareness = awareness;
    this.el = document.createElement('div');
    this.el.className = 'presence-panel';
    container.appendChild(this.el);

    this._onAwarenessChange = () => this._render();
    awareness.on('change', this._onAwarenessChange);
    this._render();
  }

  private _render(): void {
    const states = this.awareness.getStates() as Map<number, Record<string, unknown>>;
    const localId = this.awareness.clientID;
    let html = '';

    for (const [clientId, state] of states) {
      const user = (state.user || {}) as { name?: string; color?: string };
      const name = user.name || 'Anonymous';
      const color = user.color || CURSOR_PALETTE[clientId % CURSOR_PALETTE.length];
      const isLocal = clientId === localId;
      const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

      html += `
        <div class="presence-user" title="${name}${isLocal ? ' (you)' : ''}">
          <div class="presence-avatar" style="background: ${color}">${initials}</div>
          <span class="presence-name">${name}${isLocal ? ' (you)' : ''}</span>
        </div>
      `;
    }

    this.el.innerHTML = html || '<div class="presence-empty">No users</div>';
  }

  destroy(): void {
    this.awareness.off('change', this._onAwarenessChange);
    this.el.remove();
  }
}
