// Bridge client: Pi package -> native host WebSocket (127.0.0.1).
// No dependencies: raw TCP + WS handshake + masked text frames.

import { createConnection } from "node:net";
import { randomBytes, createHash } from "node:crypto";

export const BRIDGE_PORT = Number(process.env.PI_BC_PORT || 17832);
export const BRIDGE_HOST = "127.0.0.1";

function wsHandshake(socket, port) {
  return new Promise((resolve, reject) => {
    const key = randomBytes(16).toString("base64");
    const req =
      `GET / HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n` +
      `Upgrade: websocket\r\nConnection: Upgrade\r\n` +
      `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`;
    let head = Buffer.alloc(0);
    const onData = (chunk) => {
      head = Buffer.concat([head, chunk]);
      const s = head.toString("utf8");
      if (!s.includes("\r\n\r\n")) return;
      socket.off("data", onData);
      if (!s.startsWith("HTTP/1.1 101")) return reject(new Error("bridge handshake failed"));
      resolve(Buffer.from(head.slice(s.indexOf("\r\n\r\n") + 4)));
    };
    socket.on("data", onData);
    socket.on("error", reject);
    socket.write(req);
  });
}

function sendFrame(socket, text) {
  const body = Buffer.from(text, "utf8");
  const mask = randomBytes(4);
  const head = Buffer.from([0x81, 0x80 | (body.length < 126 ? body.length : 126)]);
  let frame = head;
  if (body.length >= 126) {
    const ext = Buffer.alloc(2);
    ext.writeUInt16BE(body.length, 0);
    frame = Buffer.concat([head, ext]);
  }
  const out = Buffer.alloc(body.length);
  for (let i = 0; i < body.length; i++) out[i] = body[i] ^ mask[i % 4];
  socket.write(Buffer.concat([frame, mask, out]));
}

export function bridgeSend(msg, { port = BRIDGE_PORT, timeoutMs = 20000 } = {}) {
  const id = Date.now() + Math.floor(Math.random() * 1000);
  return new Promise((resolve) => {
    const done = (res) => { try { socket.destroy(); } catch {} resolve(res); };
    const timer = setTimeout(() => done({ id, ok: false, error: "bridge timeout: is the native host running?" }), timeoutMs);
    const socket = createConnection({ host: BRIDGE_HOST, port }, async () => {
      try {
        const leftover = await wsHandshake(socket, port);
        let buf = leftover;
        socket.on("data", (chunk) => {
          buf = Buffer.concat([buf, chunk]);
          // Server->client frames are unmasked.
          while (buf.length >= 2) {
            const opcode = buf[0] & 0x0f;
            let len = buf[1] & 0x7f;
            let off = 2;
            if (len === 126) { len = buf.readUInt16BE(2); off = 4; }
            else if (len === 127) { clearTimeout(timer); return done({ id, ok: false, error: "frame too large" }); }
            if (buf.length < off + len) break;
            const text = buf.slice(off, off + len).toString("utf8");
            buf = buf.slice(off + len);
            if (opcode === 0x1) {
              try {
                const res = JSON.parse(text);
                if (res.id === id) { clearTimeout(timer); done(res); return; }
              } catch { /* keep waiting */ }
            }
          }
        });
        sendFrame(socket, JSON.stringify({ ...msg, id }));
      } catch (e) {
        clearTimeout(timer);
        done({ id, ok: false, error: String(e && e.message ? e.message : e) });
      }
    });
    socket.on("error", (e) => {
      clearTimeout(timer);
      done({ id, ok: false, error: "cannot reach bridge at 127.0.0.1:" + port + " — start native-host.mjs and install the companion extension" });
    });
  });
}
