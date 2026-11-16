const COS = require('cos-nodejs-sdk-v5');
const crypto = require('crypto');

const config = require('../config/config.json');
const logger = require('../utils/logger');

const DEFAULT_PREFIX = 'mcmotd/app-images/';
const DEFAULT_TTL_SECONDS = 300;
let storage;

function getStorage() {
    if (storage) {
        return storage;
    }

    const required = ['COS_SECRET_ID', 'COS_SECRET_KEY', 'COS_BUCKET', 'COS_REGION'];
    const missing = required.filter(name => !process.env[name] || !process.env[name].trim());
    if (missing.length) {
        const error = new Error(`Temporary image storage is not configured: missing ${missing.join(', ')}`);
        error.code = 'COS_CONFIG_MISSING';
        throw error;
    }

    const prefix = (process.env.COS_PREFIX || DEFAULT_PREFIX).replace(/^\/+|\/+$/g, '');
    storage = {
        client: new COS({
            SecretId: process.env.COS_SECRET_ID.trim(),
            SecretKey: process.env.COS_SECRET_KEY.trim()
        }),
        Bucket: process.env.COS_BUCKET.trim(),
        Region: process.env.COS_REGION.trim(),
        prefix: prefix ? `${prefix}/` : ''
    };
    return storage;
}

function assertTemporaryImageStorageConfigured() {
    getStorage();
}

function requestObject(target, method, fileName, params = {}) {
    return new Promise((resolve, reject) => {
        target.client[method]({
            Bucket: target.Bucket,
            Region: target.Region,
            Key: `${target.prefix}${fileName}`,
            ...params
        }, (error, data) => {
            if (error) {
                reject(error);
            } else {
                resolve(data);
            }
        });
    });
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
    const target = getStorage();
    if (!isValidFileName(fileName)) {
        return;
    }

    await Promise.all([
        requestObject(target, 'deleteObject', fileName),
        requestObject(target, 'deleteObject', fileName.replace(/\.png$/i, '.json'))
    ]);
}

async function saveTemporaryImage(buffer, serverData) {
    const target = getStorage();
    const file = `${crypto.randomBytes(12).toString('hex')}.png`;
    const { ttlSeconds } = getAppImageConfig();
    const createdAt = Date.now();
    const expireAt = createdAt + ttlSeconds * 1000;
    const metadata = JSON.stringify({ file, createdAt, expireAt, serverData });

    await requestObject(target, 'putObject', file, {
        Body: buffer,
        ContentType: 'image/png',
        CacheControl: 'no-store',
        ACL: 'private'
    });
    try {
        await requestObject(target, 'putObject', file.replace(/\.png$/i, '.json'), {
            Body: metadata,
            ContentType: 'application/json; charset=utf-8',
            CacheControl: 'no-store',
            ACL: 'private'
        });
    } catch (error) {
        try {
            await deleteStoredImage(file);
        } catch (deleteError) {
            logger.warn('[APP_IMAGE]', `删除未完成的 COS 图片失败: ${file}`, deleteError.message);
        }
        throw error;
    }

    return { file, createdAt, expireAt };
}

async function readTemporaryImage(fileName) {
    const target = getStorage();
    if (!isValidFileName(fileName)) {
        return null;
    }

    let metadataObject;
    try {
        metadataObject = await requestObject(target, 'getObject', fileName.replace(/\.png$/i, '.json'));
    } catch (error) {
        if (error.code === 'NoSuchKey') {
            return null;
        }
        throw error;
    }

    let metadata;
    try {
        metadata = JSON.parse(metadataObject.Body.toString('utf8'));
    } catch (error) {
        logger.warn('[APP_IMAGE]', `读取 COS 图片元数据失败: ${fileName}`, error.message);
        await deleteStoredImage(fileName);
        return null;
    }

    if (!metadata || metadata.file !== fileName || !Number.isFinite(metadata.expireAt) || metadata.expireAt <= Date.now()) {
        await deleteStoredImage(fileName);
        return null;
    }

    try {
        const image = await requestObject(target, 'getObject', fileName);
        if (metadata.expireAt <= Date.now()) {
            await deleteStoredImage(fileName);
            return null;
        }
        return { metadata, buffer: image.Body };
    } catch (error) {
        if (error.code === 'NoSuchKey') {
            await deleteStoredImage(fileName);
            return null;
        }
        throw error;
    }
}

module.exports = {
    assertTemporaryImageStorageConfigured,
    deleteStoredImage,
    getAppImageConfig,
    readTemporaryImage,
    saveTemporaryImage
};
