const database = require('./database');
const config = require('../config/config.json');

const init = async () => {
    if (!config.caching?.enable || !process.env.LIBSQL_URL?.trim()) {
        return;
    }
    await database.init();
};

const getCache = async (key, ttlSeconds) => {
    if (!config.caching?.enable || !process.env.LIBSQL_URL?.trim()) {
        return null;
    }
    const db = await database.init();
    const result = await db.execute({
        sql: 'SELECT data, timestamp FROM server_cache WHERE id = ?',
        args: [key]
    });
    const row = result.rows[0];
    if (!row) {
        return null;
    }

    const isExpired = (Date.now() - row.timestamp) / 1000 > ttlSeconds;
    if (isExpired) {
        await db.execute({
            sql: 'DELETE FROM server_cache WHERE id = ? AND timestamp = ?',
            args: [key, row.timestamp]
        });
        return null;
    }

    return JSON.parse(row.data);
};

const setCache = async (key, value) => {
    if (!config.caching?.enable || !process.env.LIBSQL_URL?.trim()) {
        return;
    }
    const db = await database.init();
    await db.execute({
        sql: 'REPLACE INTO server_cache (id, data, timestamp) VALUES (?, ?, ?)',
        args: [key, JSON.stringify(value), Date.now()]
    });
};

module.exports = { init, getCache, setCache };