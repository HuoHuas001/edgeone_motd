const { getStore } = require('@edgeone/pages-blob');

function storageError(error) {
    const normalized = new Error(`EdgeOne Blob: ${error.message}`, { cause: error });
    normalized.code = ['MISSING_ENVIRONMENT', 'MISSING_PROJECT_ID', 'INVALID_STORE_NAME'].includes(error.code)
        ? 'STORAGE_CONFIGURATION_ERROR' : 'STORAGE_UNAVAILABLE';
    return normalized;
}

function createEdgeOneBlobStorage({ name, projectId, token }) {
    let store;
    try {
        // On Pages, the SDK uses the deployment credential. Local access needs both fields.
        store = projectId || token ? getStore({ name, projectId, token }) : getStore(name);
    } catch (error) {
        throw storageError(error);
    }

    const execute = async operation => {
        try { return await operation(); }
        catch (error) { throw storageError(error); }
    };
    return {
        getJSON: key => execute(() => store.get(key, { type: 'json', consistency: 'strong' })),
        setJSON: (key, value) => execute(() => store.setJSON(key, value, { cacheControl: 'no-store' })),
        getBytes: key => execute(async () => {
            const data = await store.get(key, { type: 'arrayBuffer', consistency: 'strong' });
            return data === null ? null : new Uint8Array(data);
        }),
        setBytes: (key, bytes) => execute(() => {
            // Node Buffer often shares a larger pool. Never upload bytes outside its view.
            const body = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
                ? bytes.buffer : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
            return store.set(key, body, { cacheControl: 'no-store' });
        }),
        delete: key => execute(() => store.delete(key)),
        list: ({ prefix = '', cursor } = {}) => execute(async () => {
            const page = await store.list({ prefix, cursor, limit: 100, paginate: false, consistency: 'strong' });
            return { keys: page.blobs.map(blob => blob.key), cursor: page.cursor };
        })
    };
}

module.exports = { createEdgeOneBlobStorage };
