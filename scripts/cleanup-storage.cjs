const { cleanupExpiredImages } = require('../backend/services/appImageStorage');

cleanupExpiredImages()
    .then(result => console.log(`Scanned ${result.scanned} screenshots; deleted ${result.deleted} expired screenshots`))
    .catch(error => {
        console.error(error.message);
        process.exitCode = 1;
    });
