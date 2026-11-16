const express = require('express');
const path = require('path');
const api = require('./app');
const config = require('./config/config.json');

const app = express();
app.use('/api', api);
app.use(express.static(path.join(__dirname, '../dist')));
app.get(/(.*)/, (req, res) => res.sendFile(path.join(__dirname, '../dist/index.html')));
const port = Number(process.env.PORT || config.serverPort || 3123);
app.listen(port, () => console.log(`MOTD: http://localhost:${port}`));
