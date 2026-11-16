const crypto = require('node:crypto');
const { getStorage, storageEnabled } = require('../storage');
const config = require('../config/config.json');

function cacheKey(key) {
    return `cache/${crypto.createHash('sha256').update(key).digest('hex')}.json`;
}

async function getCache(key, ttlSeconds) {
    if (!config.caching?.enable || !storageEnabled()) return null;
    const row = await getStorage().getJSON(cacheKey(key));
    if (!row || Date.now() - row.timestamp >= ttlSeconds * 1000) return null;
    // Do not delete an expired mutable key: another instance may have just replaced it.
    return row.data;
}

async function setCache(key, value) {
    if (!config.caching?.enable || !storageEnabled()) return;
    await getStorage().setJSON(cacheKey(key), { data: value, timestamp: Date.now() });
}

module.exports = { getCache, setCache };