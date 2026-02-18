import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { ObjectStore } from './ObjectStore.js';
import type { Awareness } from 'y-protocols/awareness';

export interface BoardManagerOptions {
  token?: string | null;
  onStatusChange?: (status: string) => void;
}

export class BoardManager {
  boardId: string;
  doc: Y.Doc;
  objectStore: ObjectStore;
  provider: WebsocketProvider;
  awareness: Awareness;
  onStatusChange: ((status: string) => void) | null;

  constructor(boardId: string, options: BoardManagerOptions = {}) {
    this.boardId = boardId;
    this.doc = new Y.Doc();
    this.objectStore = new ObjectStore(this.doc);

    // Determine WebSocket URL
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}/ws`;

    this.provider = new WebsocketProvider(wsUrl, boardId, this.doc, {
      params: options.token ? { token: options.token } : {},
    });

    this.awareness = this.provider.awareness;
    this.onStatusChange = options.onStatusChange || null;

    this.provider.on('status', ({ status }: { status: string }) => {
      this.onStatusChange?.(status);
    });
  }

  getObjectStore(): ObjectStore {
    return this.objectStore;
  }

  getAwareness(): Awareness {
    return this.awareness;
  }

  getDoc(): Y.Doc {
    return this.doc;
  }

  destroy(): void {
    this.provider.disconnect();
    this.doc.destroy();
  }
}
