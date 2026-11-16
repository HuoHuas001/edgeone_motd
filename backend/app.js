const express = require('express');
const cors = require('cors');
const config = require('./config/config.json');

// Environment overrides are applied before routes load the shared config object.
if (process.env.QUERY_TIMEOUT_MS) config.queryTimeout = Number(process.env.QUERY_TIMEOUT_MS);
else config.queryTimeout = 5000;
config.analytics.enable = Boolean(process.env.LIBSQL_URL);
config.caching.enable = Boolean(process.env.LIBSQL_URL);
if (process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD_MD5) {
  config.admins = [{ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD_MD5 }];
}

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use('/status', require('./routes/status'));
app.use('/status_img', require('./routes/status_img'));
app.use('/app_img', require('./routes/appImage'));
app.use('/sync_app_img', require('./routes/sync_appImage'));
app.use('/screenshot', require('./routes/screenshot'));
app.use('/config', require('./routes/config'));
app.use('/login', require('./routes/auth'));
app.use('/admin', require('./routes/admin'));
app.use((req, res) => res.status(404).json({ status: 'error', message: 'API not found' }));
app.use((error, req, res, next) => {
  console.error(error);
  if (!res.headersSent) res.status(500).json({ status: 'error', message: error.message });
});
module.exports = app;
