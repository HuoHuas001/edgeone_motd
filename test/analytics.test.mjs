import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAnalyticsAggregation } = require('../backend/services/analyticsAggregation');
const NOW = Date.parse('2026-11-16T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function log(id, overrides = {}) {
    return {
        id,
        timestamp: new Date(NOW).toISOString(),
        endpoint: '/api/status',
        ip_address: 'play.example.com',
        port: 25565,
        client_ip: '192.0.2.1',
        was_successful: 1,
        server_type: 'java',
        referrer: null,
        from_cache: null,
        ...overrides
    };
}

function aggregate(rows, now = NOW) {
    const aggregation = createAnalyticsAggregation(now);
    for (const row of rows) {
        aggregation.add(row);
    }
    return aggregation.getStats();
}

test('empty analytics retains the existing statistics contract', () => {
    assert.deepEqual(aggregate([]), {
        totalQueries: 0,
        successfulQueries: 0,
        successRate: '0.0',
        queriesLast24h: 0,
        topServers: [],
        topReferrers: [],
        recentQueries: [],
        dailyCounts: []
    });
});

test('mixed timestamp formats use UTC and include exact rolling 24-hour and seven-day boundaries', () => {
    const stats = aggregate([
        log('outside-seven-days', { timestamp: '2026-11-09T11:59:59.999Z' }),
        log('seven-day-boundary', { timestamp: '2026-11-09 12:00:00' }),
        log('day-boundary', { timestamp: '2026-11-15T14:00:00+02:00' }),
        log('outside-day', { timestamp: '2026-11-15T11:59:59.999Z' }),
        log('utc-next-day', { timestamp: '2026-11-15T23:30:00-02:00' }),
        log('now')
    ]);
    assert.equal(stats.totalQueries, 6);
    assert.equal(stats.queriesLast24h, 3);
    assert.deepEqual(stats.dailyCounts, [
        { date: '2026-11-09', count: 1 },
        { date: '2026-11-15', count: 2 },
        { date: '2026-11-16', count: 2 }
    ]);
    assert.equal(stats.recentQueries.find(row => row.id === 'seven-day-boundary').timestamp,
        '2026-11-09T12:00:00.000Z');
    assert.equal(stats.recentQueries.find(row => row.id === 'utc-next-day').timestamp,
        '2026-11-16T01:30:00.000Z');
});

test('a rolling seven-day window is not truncated to seven calendar-date buckets', () => {
    const rows = Array.from({ length: 8 }, (_, index) =>
        log(`day-${index}`, { timestamp: new Date(NOW - index * DAY_MS).toISOString() }));
    const stats = aggregate(rows);
    assert.equal(stats.dailyCounts.length, 8);
    assert.equal(stats.dailyCounts[0].date, '2026-11-09');
    assert.equal(stats.dailyCounts[7].date, '2026-11-16');
    assert.equal(stats.queriesLast24h, 2);
});

test('servers are grouped by both address and port, including an unspecified port', () => {
    const rows = [
        log('a', { ip_address: 'same.example', port: null }),
        log('b', { ip_address: 'same.example', port: 25565 }),
        log('c', { ip_address: 'same.example', port: 25566 }),
        log('d', { ip_address: 'same.example', port: 25566 }),
        log('e', { ip_address: 'other.example', port: 25565 }),
        log('f', { ip_address: '2001:db8::1', port: 25565 })
    ];
    const expected = [
        { ip_address: 'same.example', port: 25566, count: 2 },
        { ip_address: '2001:db8::1', port: 25565, count: 1 },
        { ip_address: 'other.example', port: 25565, count: 1 },
        { ip_address: 'same.example', port: null, count: 1 },
        { ip_address: 'same.example', port: 25565, count: 1 }
    ];
    assert.deepEqual(aggregate(rows).topServers, expected);
    assert.deepEqual(aggregate([...rows].reverse()).topServers, expected);
});

test('success, failure and cache outcomes retain independent query counts and UI row fields', () => {
    const rows = [
        log('cached', { from_cache: 1 }),
        log('uncached', { from_cache: 0 }),
        log('unknown-cache', { from_cache: null }),
        log('failed', { was_successful: 0, server_type: null, client_ip: null })
    ];
    const stats = aggregate(rows);
    assert.equal(stats.totalQueries, 4);
    assert.equal(stats.successfulQueries, 3);
    assert.equal(stats.successRate, '75.0');
    assert.equal(stats.topServers[0].count, 4);
    for (const row of rows) {
        assert.deepEqual(stats.recentQueries.find(recent => recent.id === row.id), row);
    }
    assert.equal(aggregate([rows[3]]).successRate, '0.0');
});

test('top ten limits and tied server/referrer ranks are deterministic, excluding empty referrers', () => {
    const rows = Array.from({ length: 14 }, (_, index) => {
        const suffix = String(index).padStart(2, '0');
        return log(`query-${suffix}`, {
            ip_address: `server-${suffix}.example`,
            referrer: `source-${suffix}.example`
        });
    });
    rows.push(log('extra-13', { ip_address: 'server-13.example', referrer: 'source-13.example' }));
    rows.push(log('no-referrer', { ip_address: 'server-13.example', referrer: '' }));
    rows.push(log('null-referrer', { ip_address: 'server-13.example', referrer: null }));
    const stats = aggregate([...rows].reverse());
    assert.equal(stats.topServers.length, 10);
    assert.equal(stats.topReferrers.length, 10);
    assert.deepEqual(stats.topServers[0], { ip_address: 'server-13.example', port: 25565, count: 4 });
    assert.deepEqual(stats.topReferrers[0], { referrer: 'source-13.example', count: 2 });
    assert.deepEqual(stats.topServers.slice(1).map(row => row.ip_address),
        Array.from({ length: 9 }, (_, index) => `server-${String(index).padStart(2, '0')}.example`));
    assert.deepEqual(stats.topReferrers.slice(1).map(row => row.referrer),
        Array.from({ length: 9 }, (_, index) => `source-${String(index).padStart(2, '0')}.example`));
    assert.deepEqual(stats, aggregate(rows));
});

test('recent twenty queries use timestamp descending then id descending rather than arrival order', () => {
    const rows = Array.from({ length: 45 }, (_, index) => log(`id-${String(index).padStart(2, '0')}`, {
        timestamp: new Date(NOW - DAY_MS + Math.floor(index / 3) * 1000).toISOString()
    }));
    const arrival = [
        ...rows.filter((_, index) => index % 2 === 1).reverse(),
        ...rows.filter((_, index) => index % 2 === 0)
    ];
    const stats = aggregate(arrival);
    assert.equal(stats.totalQueries, 45);
    assert.deepEqual(stats.recentQueries.map(row => row.id),
        Array.from({ length: 20 }, (_, index) => `id-${44 - index}`));
    assert.deepEqual(stats, aggregate([...arrival].reverse()));
});

test('independent same-millisecond immutable logs cannot overwrite each other or returned snapshots', () => {
    const first = Object.freeze(log('1794830400000-first'));
    const second = Object.freeze(log('1794830400000-second', { was_successful: 0 }));
    const aggregation = createAnalyticsAggregation(NOW);
    aggregation.add(first);
    const snapshot = aggregation.getStats();
    aggregation.add(second);
    const stats = aggregation.getStats();
    assert.equal(snapshot.totalQueries, 1);
    assert.equal(snapshot.topServers[0].count, 1);
    assert.equal(stats.totalQueries, 2);
    assert.equal(stats.successfulQueries, 1);
    assert.equal(stats.topServers[0].count, 2);
    assert.deepEqual(stats.recentQueries.map(row => row.id), [second.id, first.id]);
    assert.deepEqual(stats, aggregate([second, first]));
    stats.topServers[0].count = 999;
    stats.recentQueries[0].was_successful = 1;
    assert.equal(aggregation.getStats().topServers[0].count, 2);
    assert.equal(aggregation.getStats().recentQueries[0].was_successful, 0);
    assert.equal(first.was_successful, 1);
    assert.equal(second.was_successful, 0);
});

test('all-time totals retain old independent logs while rolling windows stay bounded by time', () => {
    const rows = Array.from({ length: 1033 }, (_, index) => log(`old-${index}`, {
        timestamp: '2016-01-01T00:00:00.000Z',
        was_successful: index % 2
    }));
    const stats = aggregate(rows);
    assert.equal(stats.totalQueries, 1033);
    assert.equal(stats.successfulQueries, 516);
    assert.equal(stats.topServers[0].count, 1033);
    assert.equal(stats.queriesLast24h, 0);
    assert.deepEqual(stats.dailyCounts, []);
    assert.equal(stats.recentQueries.length, 20);
});

test('deleted null rows are skipped, but malformed rows never produce partial false statistics', () => {
    assert.deepEqual(aggregate([null, log('valid'), null]), aggregate([log('valid')]));
    const malformed = [
        undefined,
        [],
        1,
        {},
        log(''),
        log('bad', { timestamp: 'not-a-date' }),
        log('bad', { timestamp: '2026-02-30T12:00:00.000Z' }),
        log('bad', { timestamp: '2026-11-16T24:00:00.000Z' }),
        log('bad', { timestamp: '2026-11-16T12:00:00+25:00' }),
        log('bad', { endpoint: null }),
        log('bad', { ip_address: '' }),
        log('bad', { port: '25565' }),
        log('bad', { port: 65536 }),
        log('bad', { client_ip: undefined }),
        log('bad', { server_type: {} }),
        log('bad', { referrer: false }),
        log('bad', { was_successful: true }),
        log('bad', { from_cache: 2 })
    ];
    for (const row of malformed) {
        assert.throws(() => aggregate([log('valid'), row]), { code: 'ANALYTICS_DATA_ERROR' });
    }
    assert.doesNotThrow(() => aggregate([log(1, { timestamp: '2024-02-29 00:00:00' })]));
    for (const now of [undefined, NaN, Infinity, '2026-11-16', 1.5]) {
        assert.throws(() => createAnalyticsAggregation(now), TypeError);
    }
});
