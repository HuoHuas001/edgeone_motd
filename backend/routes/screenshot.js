const express = require('express');

const router = express.Router();
const { readTemporaryImage } = require('../services/appImageStorage');
const logger = require('../utils/logger');

router.get('/', async (req, res) => {
    try {
        const result = await readTemporaryImage(req.query.file);
        if (!result) {
            return res.status(404).json({
                status: 'error',
                message: '图片不存在或已过期'
            });
        }

        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'no-store');
        return res.send(result.buffer);
    } catch (error) {
        logger.warn('[SCREENSHOT]', '读取 COS 图片失败', error.message);
        return res.status(error.code === 'COS_CONFIG_MISSING' ? 503 : 500).json({
            status: 'error',
            message: error.code === 'COS_CONFIG_MISSING' ? error.message : '读取图片失败'
        });
    }
});

module.exports = router;
