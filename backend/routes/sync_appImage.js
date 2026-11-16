const express = require('express');

const router = express.Router();
const logger = require('../utils/logger');
const { queryServerStatus } = require('../services/queryService');
const { generateAppImage } = require('../services/appImageRenderer');
const { assertTemporaryImageStorageConfigured, saveTemporaryImage } = require('../services/appImageStorage');
const parseHost = require('../utils/parsehost');
const { logQuery } = require('../services/analyticsService');

async function handleSync(req, res) {
    const clientIP = req.ip === '::1' ? '127.0.0.1' : req.ip.replace(/^::ffff:/, '');
    const params = req.method === 'POST' ? { ...req.query, ...req.body } : req.query;
    const { ip, port, host, stype, icon, srv, lang, dark } = params;
    const isInternalRequest = req.headers['x-internal-request'] === 'true';

    let referrer = req.headers.referer || null;
    if (referrer) {
        try {
            referrer = new URL(referrer).hostname;
        } catch {
            referrer = null;
        }
    }

    const preHost = parseHost(ip, port, host);
    if (!preHost.success) {
        return res.status(400).json({
            status: 'error',
            message: preHost.message || preHost.error
        });
    }

    const fullAddress = preHost.port ? `${preHost.ip}:${preHost.port}` : preHost.ip;
    const displayHost = typeof host === 'string' && host.trim() ? host.trim() : fullAddress;
    logger.debug('[SYNC_APP_IMAGE]', `${clientIP} 同步 ${fullAddress}`);

    let serverData;
    let responseData;
    let stored;
    try {
        assertTemporaryImageStorageConfigured();
        serverData = await queryServerStatus(preHost.ip, preHost.port, icon, stype, Boolean(srv === 'true'), isInternalRequest);
        responseData = { ...serverData, displayHost };
        delete responseData.cached;

        const imageBuffer = await generateAppImage(responseData, { lang, imageUrl: icon, dark });
        stored = await saveTemporaryImage(imageBuffer, responseData);
    } catch (error) {
        logger.warn('[SYNC_APP_IMAGE]', `生成失败: ${fullAddress}`, error.message);
        if (error.code === 'COS_CONFIG_MISSING') {
            return res.status(503).json({ status: 'error', message: error.message });
        }

        try {
            await logQuery({
                endpoint: '/api/sync_app_img',
                ip: preHost.ip,
                port: preHost.port,
                clientIp: clientIP,
                success: false,
                serverType: null,
                referrer
            });
        } catch (analyticsError) {
            logger.warn('[SYNC_APP_IMAGE]', `记录查询失败: ${fullAddress}`, analyticsError.message);
            return res.status(500).json({ status: 'error', message: '记录查询失败' });
        }

        return res.status(500).json({
            status: 'error',
            message: '生成 appImage 失败'
        });
    }

    try {
        await logQuery({
            endpoint: '/api/sync_app_img',
            ip: preHost.ip,
            port: preHost.port,
            clientIp: clientIP,
            success: true,
            serverType: responseData.type,
            referrer,
            from_cache: serverData.cached
        });
    } catch (error) {
        logger.warn('[SYNC_APP_IMAGE]', `记录查询失败: ${fullAddress}`, error.message);
        return res.status(500).json({ status: 'error', message: '记录查询失败' });
    }

    const screenshotUrl = `${req.protocol}://${req.get('host')}/api/screenshot?file=${stored.file}`;
    return res.json({
        serverData: responseData,
        screenshotUrl,
        expireAt: stored.expireAt
    });
}

router.get('/', handleSync);
router.post('/', handleSync);

module.exports = router;
