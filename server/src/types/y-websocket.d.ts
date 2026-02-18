declare module 'y-websocket/bin/utils' {
  import type { IncomingMessage } from 'node:http';
  import type { WebSocket } from 'ws';
  import type * as Y from 'yjs';

  interface YWebsocketDoc extends Y.Doc {
    whenInitialized?: Promise<void>;
  }

  interface Persistence {
    bindState: (docName: string, doc: Y.Doc) => Promise<void>;
    writeState: (docName: string, doc: Y.Doc) => Promise<void>;
  }

  export function setupWSConnection(
    ws: WebSocket,
    req: IncomingMessage,
    options?: { docName?: string; gc?: boolean },
  ): void;

  export function setPersistence(persistence: Persistence): void;

  export function getYDoc(docName: string, gc?: boolean): YWebsocketDoc;
}
