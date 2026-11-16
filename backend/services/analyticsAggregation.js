const DAY_MS = 24 * 60 * 60 * 1000;
const TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/;
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function malformed(field) {
    const error = new Error(`Stored analytics row is malformed (${field}).`);
    error.code = 'ANALYTICS_DATA_ERROR';
    return error;
}

function timestampMilliseconds(value) {
    const parts = typeof value === 'string' && TIMESTAMP_PATTERN.exec(value);
    if (!parts) {
        throw malformed('timestamp');
    }
    const year = Number(parts[1]);
    const month = Number(parts[2]);
    const day = Number(parts[3]);
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const daysInMonth = month === 2 && leapYear ? 29 : MONTH_DAYS[month - 1];
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth ||
        Number(parts[4]) > 23 || Number(parts[5]) > 59 || Number(parts[6]) > 59) {
        throw malformed('timestamp');
    }

    // Legacy SQLite timestamps have no zone; interpret them as UTC, never local time.
    const normalized = value.replace(' ', 'T');
    const timestamp = Date.parse(parts[7] ? normalized : `${normalized}Z`);
    if (!Number.isFinite(timestamp)) {
        throw malformed('timestamp');
    }
    return timestamp;
}

function validateAnalyticsRow(row) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
        throw malformed('row');
    }
    if (!(typeof row.id === 'string' && row.id.length > 0) &&
        !(Number.isSafeInteger(row.id) && row.id >= 0)) {
        throw malformed('id');
    }
    for (const field of ['endpoint', 'ip_address']) {
        if (typeof row[field] !== 'string' || row[field].length === 0) {
            throw malformed(field);
        }
    }
    for (const field of ['client_ip', 'server_type', 'referrer']) {
        if (row[field] !== null && typeof row[field] !== 'string') {
            throw malformed(field);
        }
    }
    if (row.port !== null && (!Number.isInteger(row.port) || row.port < 1 || row.port > 65535)) {
        throw malformed('port');
    }
    if (row.was_successful !== 0 && row.was_successful !== 1) {
        throw malformed('was_successful');
    }
    if (row.from_cache !== null && row.from_cache !== 0 && row.from_cache !== 1) {
        throw malformed('from_cache');
    }
    return timestampMilliseconds(row.timestamp);
}

function compareText(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}

function insertRanked(rows, value, compare, limit) {
    const index = rows.findIndex(row => compare(value, row) < 0);
    if (index === -1) {
        if (rows.length < limit) {
            rows.push(value);
        }
    } else {
        rows.splice(index, 0, value);
        if (rows.length > limit) {
            rows.pop();
        }
    }
}

function compareServers(left, right) {
    return right.count - left.count || compareText(left.ip_address, right.ip_address) ||
        (left.port === right.port ? 0 : left.port === null ? -1 : right.port === null ? 1 : left.port - right.port);
}

function compareReferrers(left, right) {
    return right.count - left.count || compareText(left.referrer, right.referrer);
}

function compareRecent(left, right) {
    return right.timestamp - left.timestamp || compareText(String(right.row.id), String(left.row.id));
}

function createAnalyticsAggregation(now) {
    if (!Number.isSafeInteger(now) || !Number.isFinite(new Date(now).getTime())) {
        throw new TypeError('Analytics aggregation requires a valid epoch-millisecond time.');
    }
    let total = 0;
    let successful = 0;
    let last24h = 0;
    const servers = new Map();
    const referrers = new Map();
    const daily = new Map();
    const recent = [];

    function add(row) {
        if (row === null) {
            return;
        }
        const timestamp = validateAnalyticsRow(row);
        total += 1;
        successful += row.was_successful;
        if (timestamp >= now - DAY_MS) {
            last24h += 1;
        }
        if (timestamp >= now - 7 * DAY_MS) {
            const date = new Date(timestamp).toISOString().slice(0, 10);
            daily.set(date, (daily.get(date) || 0) + 1);
        }

        let ports = servers.get(row.ip_address);
        if (!ports) {
            ports = new Map();
            servers.set(row.ip_address, ports);
        }
        const server = ports.get(row.port);
        if (server) {
            server.count += 1;
        } else {
            ports.set(row.port, { ip_address: row.ip_address, port: row.port, count: 1 });
        }
        if (row.referrer !== null && row.referrer !== '') {
            const referrer = referrers.get(row.referrer);
            if (referrer) {
                referrer.count += 1;
            } else {
                referrers.set(row.referrer, { referrer: row.referrer, count: 1 });
            }
        }

        const entry = { timestamp, row };
        if (recent.length < 20 || compareRecent(entry, recent[recent.length - 1]) < 0) {
            entry.row = { ...row, timestamp: new Date(timestamp).toISOString() };
            insertRanked(recent, entry, compareRecent, 20);
        }
    }

    function getStats() {
        const topServers = [];
        for (const ports of servers.values()) {
            for (const server of ports.values()) {
                insertRanked(topServers, server, compareServers, 10);
            }
        }
        const topReferrers = [];
        for (const referrer of referrers.values()) {
            insertRanked(topReferrers, referrer, compareReferrers, 10);
        }
        return {
            totalQueries: total,
            successfulQueries: successful,
            successRate: total > 0 ? ((successful / total) * 100).toFixed(1) : '0.0',
            queriesLast24h: last24h,
            topServers: topServers.map(row => ({ ...row })),
            topReferrers: topReferrers.map(row => ({ ...row })),
            recentQueries: recent.map(entry => ({ ...entry.row })),
            dailyCounts: [...daily].sort(([left], [right]) => compareText(left, right))
                .map(([date, count]) => ({ date, count }))
        };
    }

    return { add, getStats };
}

module.exports = { createAnalyticsAggregation, validateAnalyticsRow };
