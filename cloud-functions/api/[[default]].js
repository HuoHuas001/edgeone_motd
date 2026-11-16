import express from 'express';
import { createRequire } from 'node:module';
import { getStore } from '@edgeone/pages-blob';

// Keep CommonJS modules and __dirname asset paths intact via includeFiles.
const require = createRequire(import.meta.url);
const { createEdgeOneBlobStorage } = require('../../backend/storage/edgeoneBlob.js');
const { configureStorageFactory } = require('../../backend/storage/index.js');
// Static SDK import lets Makers inject the deployment credential; namespace only.
configureStorageFactory(() => createEdgeOneBlobStorage({ name: process.env.STORAGE_NAMESPACE || 'mcmotd' }, getStore));
const api = require('../../backend/app.js');
const app = express();
app.use(api);

// EdgeOne mounts this Express instance under /api.
export default app;
