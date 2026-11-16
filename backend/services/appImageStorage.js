const { getStorage, storageEnabled } = require('../storage');
const crypto = require('crypto');

const config = require('../config/config.json');
const logger = require('../utils/logger');

const IMAGE_PREFIX = 'images/';
const DEFAULT_TTL_SECONDS = 300;
const CLEANUP_CONCURRENCY = 8;

function assertTemporaryImageStorageConfigured() {
    if (!storageEnabled()) {
        const error = new Error('Temporary image storage is disabled');
        error.code = 'STORAGE_CONFIGURATION_ERROR';
        throw error;
    }
    return getStorage();
}

function getAppImageConfig() {
    const appImageConfig = config.appImage || {};

    return {
        width: appImageConfig.width || 700,
        height: appImageConfig.height || 1000,
        ttlSeconds: appImageConfig.ttlSeconds || DEFAULT_TTL_SECONDS
    };
}

function isValidFileName(fileName) {
    return typeof fileName === 'string' && /^[a-f0-9]{24}\.png$/i.test(fileName);
}

async function deleteStoredImage(fileName) {
    const target = assertTemporaryImageStorageConfigured();
    if (!isValidFileName(fileName)) {
        return;
    }

    await target.delete(`${IMAGE_PREFIX}${fileName}`);
    await target.delete(`${IMAGE_PREFIX}${fileName.replace(/\.png$/i, '.json')}`);
}

async function saveTemporaryImage(buffer, serverData) {
    const target = assertTemporaryImageStorageConfigured();
    const file = `${crypto.randomBytes(12).toString('hex')}.png`;
    const { ttlSeconds } = getAppImageConfig();
    const createdAt = Date.now();
    const expireAt = createdAt + ttlSeconds * 1000;
    const metadata = { file, createdAt, expireAt, serverData };

    await target.setBytes(`${IMAGE_PREFIX}${file}`, buffer);
    try {
        await target.setJSON(`${IMAGE_PREFIX}${file.replace(/\.png$/i, '.json')}`, metadata);
    } catch (error) {
        try {
            await deleteStoredImage(file);
        } catch (deleteError) {
            logger.warn('[APP_IMAGE]', `删除未完成的图片失败: ${file}`, deleteError.message);
        }
        throw error;
    }

    return { file, createdAt, expireAt };
}

async function readTemporaryImage(fileName) {
    const target = assertTemporaryImageStorageConfigured();
    if (!isValidFileName(fileName)) {
        return null;
    }

    const metadata = await target.getJSON(`${IMAGE_PREFIX}${fileName.replace(/\.png$/i, '.json')}`);
    if (metadata === null) {
        return null;
    }

    if (!metadata || metadata.file !== fileName || !Number.isFinite(metadata.expireAt) || metadata.expireAt <= Date.now()) {
        await deleteStoredImage(fileName);
        return null;
    }

    const image = await target.getBytes(`${IMAGE_PREFIX}${fileName}`);
    if (image === null || metadata.expireAt <= Date.now()) {
        await deleteStoredImage(fileName);
        return null;
    }
    return {
        metadata,
        buffer: Buffer.from(image.buffer, image.byteOffset, image.byteLength)
    };
}

async function cleanupExpiredImages() {
    const target = assertTemporaryImageStorageConfigured();
    let cursor;
    let scanned = 0;
    let deleted = 0;

    do {
        const page = await target.list({ prefix: IMAGE_PREFIX, cursor });
        const metadataKeys = page.keys.filter(key => /^images\/[a-f0-9]{24}\.json$/i.test(key));
        for (let offset = 0; offset < metadataKeys.length; offset += CLEANUP_CONCURRENCY) {
            const results = await Promise.allSettled(metadataKeys.slice(offset, offset + CLEANUP_CONCURRENCY).map(async key => {
                const metadata = await target.getJSON(key);
                const file = key.slice(IMAGE_PREFIX.length).replace(/\.json$/i, '.png');
                if (!metadata || metadata.file !== file || !Number.isFinite(metadata.expireAt) || metadata.expireAt > Date.now()) {
                    return false;
                }
                await deleteStoredImage(file);
                return true;
            }));
            let failure;
            for (const result of results) {
                scanned++;
                if (result.status === 'rejected') {
                    failure = result;
                } else if (result.value) {
                    deleted++;
                }
            }
            if (failure) {
                throw failure.reason;
            }
        }
        cursor = page.cursor;
    } while (cursor);

    return { scanned, deleted };
}

module.exports = {
    assertTemporaryImageStorageConfigured,
    cleanupExpiredImages,
    deleteStoredImage,
    getAppImageConfig,
    readTemporaryImage,
    saveTemporaryImage
};
