const { createClient } = require('@libsql/client');

let initialization;

function configurationError(message) {
    const error = new Error(message);
    error.code = 'LIBSQL_CONFIGURATION_ERROR';
    return error;
}

async function connect() {
    const url = process.env.LIBSQL_URL?.trim();
    if (!url) {
        throw configurationError('LIBSQL_URL is required for persistent analytics and caching.');
    }

    let protocol;
    try {
        protocol = new URL(url).protocol;
    } catch {
        throw configurationError('LIBSQL_URL must be a valid database URL.');
    }
    if (protocol === 'file:') {
        if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
            throw configurationError('file: LIBSQL_URL is allowed only with NODE_ENV=development or NODE_ENV=test.');
        }
    } else if (!['libsql:', 'https:', 'http:', 'wss:', 'ws:'].includes(protocol)) {
        throw configurationError('LIBSQL_URL must reference a remote libSQL database.');
    }

    const client = createClient({
        url,
        authToken: process.env.LIBSQL_AUTH_TOKEN || undefined,
        intMode: 'number'
    });

    try {
        await client.batch([
            `CREATE TABLE IF NOT EXISTS query_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                endpoint TEXT NOT NULL,
                ip_address TEXT NOT NULL,
                port INTEGER,
                client_ip TEXT,
                was_successful BOOLEAN NOT NULL,
                server_type TEXT,
                referrer TEXT,
                from_cache BOOLEAN
            )`,
            `CREATE TABLE IF NOT EXISTS server_cache (
                id TEXT PRIMARY KEY,
                data TEXT NOT NULL,
                timestamp INTEGER NOT NULL
            )`
        ], 'write');
        return client;
    } catch (error) {
        client.close();
        throw error;
    }
}

async function init() {
    if (!initialization) {
        initialization = connect().catch((error) => {
            initialization = undefined;
            throw error;
        });
    }
    return initialization;
}

module.exports = { init };
