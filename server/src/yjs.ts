// Re-export Yjs via CJS require() to match y-websocket's import.
// y-websocket uses require('yjs') which loads yjs.cjs, while ESM import
// loads yjs.mjs — creating two separate Yjs instances. The dual-instance
// breaks constructor checks and corrupts document encoding/decoding.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Y: typeof import('yjs') = require('yjs');
export default Y;
