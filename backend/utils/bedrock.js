const dgram = require('node:dgram');
const dns = require('node:dns');
const crypto = require('node:crypto');

const MAGIC = Buffer.from('00ffff00fefefefefdfdfdfd12345678', 'hex');

// RakNet unconnected ping; no game connection or third-party HTTP query.
module.exports = function ping(host, port, callback, timeout = 5000) {
    let socket;
    let settled = false;
    const finish = (error, data) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (socket) socket.close();
        callback(error, data);
    };
    const timer = setTimeout(() => finish(new Error('Bedrock query timed out')), timeout);
    dns.lookup(host, (error, address, family) => {
        if (settled) return;
        if (error) return finish(error);
        socket = dgram.createSocket(family === 6 ? 'udp6' : 'udp4');
        socket.on('error', finish);
        socket.on('message', (packet, rinfo) => {
            if (settled || packet.length < 35 || packet[0] !== 0x1c) return;
            if (!packet.subarray(17, 33).equals(MAGIC)) return;
            const length = packet.readUInt16BE(33);
            if (packet.length < 35 + length) return;
            const advertise = packet.toString('utf8', 35, 35 + length);
            const fields = advertise.split(';');
            if (fields.length < 6) return finish(new Error('Invalid Bedrock advertisement'));
            finish(null, {
                rinfo, advertise, name: fields[1],
                cleanName: fields[1].replace(/§[0-9a-fk-or]/ig, ''),
                version: fields[3], currentPlayers: fields[4], maxPlayers: fields[5]
            });
        });
        // Connected UDP accepts replies only from the queried peer.
        socket.connect(port, address, () => {
            if (settled) return;
            const packet = Buffer.alloc(33);
            packet[0] = 0x01;
            packet.writeBigInt64BE(BigInt(Date.now()), 1);
            MAGIC.copy(packet, 9);
            crypto.randomBytes(8).copy(packet, 25);
            socket.send(packet, error => { if (error) finish(error); });
        });
    });
};