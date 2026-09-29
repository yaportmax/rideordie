// Second dev server for automated tests: no HMR websocket, so edits by other tools never reload a page mid-test.
import base from './vite.config.js';
export default { ...base, server: { ...base.server, port: 5180, strictPort: true, hmr: false } };
