import { createRequire } from 'node:module';

// Keep CommonJS modules and __dirname asset paths intact via includeFiles.
const require = createRequire(import.meta.url);
const app = require('../../backend/app.js');

// EdgeOne mounts this Express instance under /api.
export default app;
