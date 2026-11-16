const database = require('./database');
const config = require('../config/config.json');

const init = async () => {
    if (!config.analytics?.enable) {
        return;
    }
    await database.init();
};

const logQuery = async (logData) => {
    if (!config.analytics?.enable) {
        return;
    }

    const db = await database.init();
    const { endpoint, ip, port, clientIp, success, serverType, referrer, from_cache } = logData;
    await db.execute({
        sql: 'INSERT INTO query_logs (endpoint, ip_address, port, client_ip, was_successful, server_type, referrer, from_cache) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        args: [
            endpoint,
            ip,
            port ?? null,
            clientIp ?? null,
            success ? 1 : 0,
            serverType ?? null,
            referrer ?? null,
            from_cache == null ? null : (from_cache ? 1 : 0)
        ]
    });
};

const getStats = async () => {
    const db = await database.init();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const results = await db.batch([
        'SELECT COUNT(*) as count FROM query_logs',
        'SELECT COUNT(*) as count FROM query_logs WHERE was_successful = 1',
        `SELECT COUNT(*) as count FROM query_logs WHERE timestamp >= datetime('now', '-24 hours')`,
        'SELECT ip_address, port, COUNT(*) as count FROM query_logs GROUP BY ip_address, port ORDER BY count DESC LIMIT 10',
        "SELECT referrer, COUNT(*) as count FROM query_logs WHERE referrer IS NOT NULL AND referrer != '' GROUP BY referrer ORDER BY count DESC LIMIT 10",
        'SELECT * FROM query_logs ORDER BY timestamp DESC LIMIT 20',
        {
            sql: `SELECT strftime('%Y-%m-%d', timestamp) as date, COUNT(*) as count FROM query_logs WHERE timestamp >= ? GROUP BY date ORDER BY date ASC`,
            args: [sevenDaysAgo]
        }
    ], 'read');

    const total = results[0].rows[0].count;
    const successful = results[1].rows[0].count;
    return {
        totalQueries: total,
        successfulQueries: successful,
        successRate: total > 0 ? ((successful / total) * 100).toFixed(1) : '0.0',
        queriesLast24h: results[2].rows[0].count,
        topServers: results[3].rows,
        topReferrers: results[4].rows,
        recentQueries: results[5].rows,
        dailyCounts: results[6].rows
    };
};

module.exports = { init, logQuery, getStats };