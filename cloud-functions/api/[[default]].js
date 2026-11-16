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
app.use((req, res, next) => {
  const configuredOrigin = req.context?.env?.PUBLIC_ORIGIN || process.env.PUBLIC_ORIGIN;
  const publicHost = req.get('eo-pages-host');
  if (configuredOrigin) {
    const origin = new URL(configuredOrigin);
    req.headers.host = origin.host;
    req.headers['x-forwarded-proto'] = origin.protocol.slice(0, -1);
  } else if (publicHost) {
    req.headers.host = publicHost;
    req.headers['x-forwarded-proto'] = 'https';
  }
  next();
});
app.use(api);

// EdgeOne mounts this Express instance under /api.
export default app;
