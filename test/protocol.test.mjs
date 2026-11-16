import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import dgram from 'node:dgram';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { fetch: pingJava } = require('../backend/utils/java');
const pingBedrock = require('../backend/utils/bedrock');
const varint = require('varint');

function statusPacket(json) {
  const text = Buffer.from(json);
  const body = Buffer.concat([Buffer.from([0]), Buffer.from(varint.encode(text.length)), text]);
  return Buffer.concat([Buffer.from(varint.encode(body.length)), body]);
}

async function javaServer(t, json, fragment = false) {
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.once('data', () => {
      const packet = statusPacket(json);
      if (fragment) {
        socket.write(packet.subarray(0, 1));
        setImmediate(() => socket.end(packet.subarray(1)));
      } else socket.end(packet);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  });
  return server.address().port;
}

test('Java accepts fragmented status packets including a multibyte frame length', async t => {
  const status = { description: '§a欢迎'.repeat(80), version: { name: '1.21', protocol: 767 }, players: { online: 3, max: 20 } };
  const port = await javaServer(t, JSON.stringify(status), true);
  assert.deepEqual(await pingJava('127.0.0.1', port, 1000), status);
});

test('Java rejects a complete malformed JSON response rather than leaving its promise pending', async t => {
  const port = await javaServer(t, '{invalid');
  await assert.rejects(pingJava('127.0.0.1', port, 1000), SyntaxError);
});

test('Bedrock sends standard 33-byte RakNet ping and decodes UTF-8 pong', async t => {
  const server = dgram.createSocket('udp4');
  const magic = Buffer.from('00ffff00fefefefefdfdfdfd12345678', 'hex');
  let received;
  server.on('message', (ping, peer) => {
    received = ping;
    const text = Buffer.from('MCPE;§a基岩测试;800;1.21;2;10;123;世界;Survival;1;19132;19133;');
    const reply = Buffer.alloc(35 + text.length);
    reply[0] = 0x1c;
    ping.copy(reply, 1, 1, 9);
    reply.writeBigInt64BE(123n, 9);
    magic.copy(reply, 17);
    reply.writeUInt16BE(text.length, 33);
    text.copy(reply, 35);
    server.send(reply, peer.port, peer.address);
  });
  await new Promise(resolve => server.bind(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const data = await new Promise((resolve, reject) => pingBedrock('127.0.0.1', server.address().port, (error, data) => error ? reject(error) : resolve(data), 1000));
  assert.equal(received.length, 33);
  assert.equal(received[0], 1);
  assert.deepEqual(received.subarray(9, 25), magic);
  assert.equal(data.cleanName, '基岩测试');
  assert.equal(data.version, '1.21');
  assert.equal(data.currentPlayers, '2');
});
