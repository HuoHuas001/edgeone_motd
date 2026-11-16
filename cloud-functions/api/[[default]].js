import express from 'express';
import { createRequire } from 'node:module';

// Keep CommonJS modules and __dirname asset paths intact via includeFiles.
const require = createRequire(import.meta.url);
const api = require('../../backend/app.js');
const app = express();
app.use(api);

// EdgeOne mounts this Express instance under /api.
export default app;
