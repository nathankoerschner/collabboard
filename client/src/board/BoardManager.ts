import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { IndexeddbPersistence } from 'y-indexeddb';
import { ObjectStore } from './ObjectStore.js';

interface BoardManagerOptions {
  token?: string | null;
  onStatusChange?: ((status: string) => void) | null;
  onAccessRevoked?: (() => void) | null;
}

export class BoardManager {
  boardId: string;
  doc: Y.Doc;
  objectStore: ObjectStore;
  provider: WebsocketProvider;
  persistence!: IndexeddbPersistence;
  awareness: WebsocketProvider['awareness'];
  onStatusChange: ((status: string) => void) | null;

  constructor(boardId: string, options: BoardManagerOptions = {}) {
    this.boardId = boardId;
    this.doc = new Y.Doc();
    this.objectStore = new ObjectStore(this.doc);

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}/ws`;

    this.persistence = new IndexeddbPersistence(`collabboard-${boardId}`, this.doc);
    this.persistence.once('synced', () => {
      this.objectStore.migrateV1Shapes();
    });

    this.provider = new WebsocketProvider(wsUrl, boardId, this.doc, {
      params: options.token ? { token: options.token } : {},
    });

    this.awareness = this.provider.awareness;
    this.onStatusChange = options.onStatusChange || null;
    const onAccessRevoked = options.onAccessRevoked || null;

    this.provider.on('status', ({ status }: { status: string }) => {
      this.onStatusChange?.(status);
    });

    // Handle access revoked (ws close code 4003)
    if (onAccessRevoked) {
      this.provider.on('connection-close', (event: CloseEvent | null) => {
        if (event?.code === 4003) {
          onAccessRevoked();
        }
      });
    }
  }

  getObjectStore(): ObjectStore {
    return this.objectStore;
  }

  getAwareness() {
    return this.awareness;
  }

  getDoc(): Y.Doc {
    return this.doc;
  }

  destroy(): void {
    this.provider.disconnect();
    this.persistence.destroy();
    this.doc.destroy();
  }
}
