const { GlobalFonts } = require('@napi-rs/canvas');
const path = require('node:path');
const family = 'Noto Sans CJK SC';
if (!GlobalFonts.registerFromPath(path.join(__dirname, '../fonts/NotoSansCJKsc-Regular.otf'), family)) {
    throw new Error('Bundled Noto Sans CJK font could not be registered');
}
module.exports = family;
