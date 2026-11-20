'use strict';

// Minimal zero-dependency WebSocket (RFC 6455) server-side implementation.
// Supports text/binary messages, fragmentation, ping/pong and close frames.

const crypto = require('crypto');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function acceptKey(key) {
  return crypto.createHash('sha1').update(key + GUID).digest('base64');
}

class WSConn extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.closed = false;
    this.frags = [];
    socket.on('data', (d) => this._onData(d));
    socket.on('close', () => this._dead());
    socket.on('end', () => this._dead());
    socket.on('error', () => this._dead());
  }

  _dead() {
    if (this.closed) return;
    this.closed = true;
    this.emit('close');
    try { this.socket.destroy(); } catch { /* ignore */ }
  }

  _onData(d) {
    if (this.closed) return;
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0;
      const op = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        len = Number(this.buf.readBigUInt64BE(2));
        off = 10;
      }
      const maskOff = off;
      if (masked) off += 4;
      if (this.buf.length < off + len) return;
      let payload = this.buf.subarray(off, off + len);
      if (masked) {
        const mask = this.buf.subarray(maskOff, maskOff + 4);
        const out = Buffer.allocUnsafe(len);
        for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i & 3];
        payload = out;
      } else {
        payload = Buffer.from(payload);
      }
      this.buf = this.buf.subarray(off + len);

      if (op === 8) { this.close(); return; }
      if (op === 9) { this._sendFrame(0xA, payload); continue; }
      if (op === 0xA) continue;
      if (op === 1 || op === 2 || op === 0) {
        this.frags.push({ op, payload });
        if (fin) {
          const full = Buffer.concat(this.frags.map((f) => f.payload));
          const op0 = this.frags[0].op;
          this.frags = [];
          if (op0 === 1) this.emit('message', full.toString('utf8'));
          else this.emit('message', full);
        }
      }
    }
  }

  _sendFrame(op, payload) {
    if (this.closed) return;
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.from([0x80 | op, len]);
    } else if (len < 65536) {
      header = Buffer.allocUnsafe(4);
      header[0] = 0x80 | op;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.allocUnsafe(10);
      header[0] = 0x80 | op;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    try {
      this.socket.write(Buffer.concat([header, payload]));
    } catch {
      this._dead();
    }
  }

  send(str) {
    this._sendFrame(0x1, Buffer.from(String(str), 'utf8'));
  }

  close() {
    if (this.closed) return;
    try { this._sendFrame(0x8, Buffer.alloc(0)); } catch { /* ignore */ }
    this._dead();
  }
}

function attach(server, onConnection) {
  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    const upgrade = (req.headers.upgrade || '').toLowerCase();
    if (!key || upgrade !== 'websocket') {
      socket.destroy();
      return;
    }
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`
    );
    socket.setNoDelay(true);
    onConnection(new WSConn(socket), req);
  });
}

module.exports = { attach, WSConn, acceptKey };
