const net = require('net')
const varint = require('varint')

class MCBuffer {
  constructor(buffer) {
    this._buffer = buffer
    this._offset = 0
  }

  readVarInt() {
    let val = 0
    let count = 0

    while (true) {
      if (count === 5) throw new Error('Invalid VarInt');
      const b = this._buffer.readUInt8(this._offset++)

      val |= (b & 0x7F) << count++ * 7;

      if ((b & 0x80) != 128) {
        break
      }
    }

    return val
  }

  readString() {
    const length = this.readVarInt()
    const val = this._buffer.toString('UTF-8', this._offset, this._offset + length)
    this._offset += length

    return val
  }

  offset() {
    return this._offset
  }
}

// https://wiki.vg/Protocol#Packet_format
function create_packet(packetId, data) {
  let pid = Buffer.from(varint.encode(packetId))
  return Buffer.concat([Buffer.from(varint.encode(data.length + pid.length)), pid, data])
}

function fetch(host, port, timeout = 10000) {
  return new Promise((resolve, reject) => {
    // [核心改动 1] 创建一个状态标志位，防止 Promise 被多次处理
    let settled = false;

    const client = new net.Socket();
    client.setNoDelay(true);

    const connectionTimeoutId = setTimeout(() => {
      // 如果 Promise 已被处理，则什么都不做
      if (settled) return;

      // [核心改动 2] 手动超时后，立即、主动地 reject Promise
      settled = true; // 立即将状态置为“已处理”
      client.destroy(); // 销毁 socket 以释放资源
      reject(new Error(`Connection timed out after ${timeout}ms`));
    }, timeout);

    const cleanup = () => {
      clearTimeout(connectionTimeoutId);
    };

    client.on('error', (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    });

    client.on('connect', () => {
      if (settled) return;
      // Keep the total deadline active through the status response.

      // 后续的Minecraft协议交互逻辑...
      let portBuf = Buffer.from([port >> 8, port & 0xFF]);
      let buf = create_packet(0x00, Buffer.concat([
        Buffer.from(varint.encode(-1)),
        Buffer.from(varint.encode(Buffer.byteLength(host, 'utf8'))),
        Buffer.from(host, 'utf-8'),
        portBuf,
        Buffer.from(varint.encode(1))
      ]));
      client.write(buf);
      client.write(create_packet(0x00, Buffer.from([])));
    });

    // 'close' 事件可以作为最终的保障，处理意外断开的情况
    client.on('close', () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Socket closed unexpectedly before response.'));
    });

    // 保留 'timeout' 事件用于处理空闲超时
    client.on('timeout', () => {
      if (settled) return;
      settled = true;
      cleanup();
      client.destroy();
      reject(new Error('Socket inactivity timeout.'));
    });

    let responseBuffer = Buffer.alloc(0);
    client.on('data', (data) => {
      if (settled) return;
      responseBuffer = Buffer.concat([responseBuffer, data]);
      try {
        const reader = new MCBuffer(responseBuffer);
        const length = reader.readVarInt();

        if (responseBuffer.length - reader.offset() >= length) {
          const packetId = reader.readVarInt();
          if (packetId === 0x00) {
            const responseData = reader.readString();
            let result;
            try {
              result = JSON.parse(responseData);
            } catch (error) {
              settled = true;
              cleanup();
              client.destroy();
              reject(error);
              return;
            }
            settled = true;
            cleanup();
            resolve(result);
            client.destroy();
          }
        }
      } catch (e) {
        if (!(e instanceof RangeError)) {
          settled = true;
          cleanup();
          client.destroy();
          reject(e);
        }
      }
    });

    client.connect({ host, port });
  });
}

module.exports = {
  fetch
}