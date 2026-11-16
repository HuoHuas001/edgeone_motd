const { randomUUID } = require('node:crypto');
const { getStorage, storageEnabled } = require('../storage');
const { createAnalyticsAggregation, validateAnalyticsRow } = require('./analyticsAggregation');
const config = require('../config/config.json');

const logQuery = async (logData) => {
    if (!config.analytics?.enable || !storageEnabled()) {
        return;
    }

    const storage = getStorage();
    const timestamp = Date.now();
    const id = `${String(timestamp).padStart(13, '0')}-${randomUUID()}`;
    const { endpoint, ip, port, clientIp, success, serverType, referrer, from_cache } = logData;
    const row = {
        id,
        timestamp: new Date(timestamp).toISOString(),
        endpoint,
        ip_address: ip,
        port: port ?? null,
        client_ip: clientIp ?? null,
        was_successful: success ? 1 : 0,
        server_type: serverType ?? null,
        referrer: referrer ?? null,
        from_cache: from_cache == null ? null : (from_cache ? 1 : 0)
    };
    validateAnalyticsRow(row);
    await storage.setJSON(`logs/${id}.json`, row);
};

const getStats = async () => {
    if (!config.analytics?.enable || !storageEnabled()) {
        const error = new Error('Persistent storage and analytics must be enabled to read query statistics.');
        error.code = 'STORAGE_CONFIGURATION_ERROR';
        throw error;
    }

    const storage = getStorage();
    const aggregation = createAnalyticsAggregation(Date.now());
    let cursor;
    do {
        const page = await storage.list({ prefix: 'logs/', cursor });
        for (let start = 0; start < page.keys.length; start += 16) {
            const rows = await Promise.all(
                page.keys.slice(start, start + 16).map(key => storage.getJSON(key))
            );
            for (const row of rows) {
                aggregation.add(row);
            }
        }
        cursor = page.cursor;
    } while (cursor);

    return aggregation.getStats();
};

module.exports = { logQuery, getStats };