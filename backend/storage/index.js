/**
 * Platform-neutral storage contract (keys relative to one namespace):
 * getJSON/getBytes return null only when missing; I/O failures reject.
 * Writes replace a key and resolve only after persistence.
 * Reads must provide read-after-write consistency.
 * list returns one bounded page and an opaque cursor; follow cursors to completion.
 * No atomic counters, conditional writes, transactions, or native TTL are assumed.
 */

let storage;

function storageEnabled() {
    return process.env.STORAGE_ENABLED !== 'false';
}

function createStorage(options = {}) {
    const provider = options.provider || process.env.STORAGE_PROVIDER || 'edgeone-blob';
    if (provider !== 'edgeone-blob') {
        const error = new Error(`Storage provider is not implemented: ${provider}`);
        error.code = 'STORAGE_CONFIGURATION_ERROR';
        throw error;
    }
    return require('./edgeoneBlob').createEdgeOneBlobStorage({
        name: options.namespace || process.env.STORAGE_NAMESPACE || 'mcmotd',
        projectId: process.env.EDGEONE_BLOB_PROJECT_ID,
        token: process.env.EDGEONE_BLOB_API_TOKEN
    });
}

// A platform entry can inject its own adapter before serving requests.
function configureStorage(adapter) {
    storage = adapter;
}

function getStorage() {
    if (!storageEnabled()) {
        const error = new Error('Persistent storage is disabled by STORAGE_ENABLED=false');
        error.code = 'STORAGE_CONFIGURATION_ERROR';
        throw error;
    }
    if (!storage) storage = createStorage();
    return storage;
}

module.exports = { configureStorage, createStorage, getStorage, storageEnabled };
