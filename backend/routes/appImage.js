const express = require('express');

const router = express.Router();
const logger = require('../utils/logger');
const { queryServerStatus } = require('../services/queryService');
const { generateAppImage } = require('../services/appImageRenderer');
const parseHost = require('../utils/parsehost');
const { logQuery } = require('../services/analyticsService');

router.get('/', async (req, res) => {
    const clientIP = req.ip === '::1' ? '127.0.0.1' : req.ip.replace(/^::ffff:/, '');
    const { ip, port, host, stype, icon, srv, lang, dark } = req.query;
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
    logger.debug('[APP_IMAGE]', `${clientIP} 查询 ${fullAddress}`);

    try {
        let serverData;
        let imageBuffer;
        let success = true;
        try {
            serverData = await queryServerStatus(preHost.ip, preHost.port, icon, stype, Boolean(srv === 'true'), isInternalRequest);
            imageBuffer = await generateAppImage({ ...serverData, displayHost }, { lang, imageUrl: icon, dark });
        } catch (error) {
            logger.warn('[APP_IMAGE]', `实时查服失败: ${fullAddress}`, error.message);
            success = false;
            serverData = { status: 'offline', host: fullAddress, displayHost };
            imageBuffer = await generateAppImage(serverData, { lang, imageUrl: icon, dark });
        }

        await logQuery({
            endpoint: '/api/app_img',
            ip: preHost.ip,
            port: preHost.port,
            clientIp: clientIP,
            success,
            serverType: success ? serverData.type : null,
            referrer,
            from_cache: serverData.cached
        });

        return res.type('png').send(imageBuffer);
    } catch (error) {
        logger.warn('[APP_IMAGE]', `生成图片或记录查询失败: ${fullAddress}`, error.message);
        return res.status(500).json({
            status: 'error',
            message: '生成 appImage 或记录查询失败'
        });
    }
});

module.exports = router;
