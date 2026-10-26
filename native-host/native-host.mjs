// pi-browser-control native host.
//
// Stdin/stdout: Native Messaging framing (u32LE length + UTF-8 JSON).
// One side: Chrome companion extension (chrome.debugger bridge).
// Other side: local WebSocket server that the Pi package talks to.
//
// Usage: node native-host.mjs [--port 17832]
// Register first: node register.mjs  (writes the Chrome manifest)

import { stdin, stdout, exit } from "node:process";
import { createServer } from "node:http";

const PORT = Number(process.env.PI_BC_PORT || process.argv.includes("--port")
  ? process.argv[process.argv.indexOf("--port") + 1]
  : 17832);

const pending = new Map();
let seq = 1;
let wsClients = new Set();

function readStdin() {
  let buf = Buffer.alloc(0);
  stdin.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 4) {
      const len = buf.readUInt32LE(0);
      if (buf.length < 4 + len) break;
      const msg = JSON.parse(buf.slice(4, 4 + len).toString("utf8"));
      buf = buf.slice(4 + len);
      onExtensionMessage(msg);
    }
  });
}

function sendToExtension(obj) {
  const body = Buffer.from(JSON.stringify(obj), "utf8");
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  stdout.write(Buffer.concat([head, body]));
}

function onExtensionMessage(msg) {
  const resolve = pending.get(msg.id);
  pending.delete(msg.id);
  if (!resolve) return;
  resolve(msg);
  broadcast({ from: "extension", ...msg });
}

function broadcast(obj) {
  const text = JSON.stringify(obj);
  for (const ws of wsClients) {
    try { ws.send(text); } catch { /* drop dead client */ }
  }
}

// Minimal WebSocket server (no dependency): handshake + text frames.
import { createHash } from "node:crypto";
import { Socket } from "node:net";

function wsAccept(key) {
  return createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
}

const server = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, pending: pending.size }));
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

server.on("upgrade", (req, socket) => {
  const key = req.headers["sec-websocket-key"];
  if (!key) { socket.destroy(); return; }
  const accept = wsAccept(Array.isArray(key) ? key[0] : key);
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\nConnection: Upgrade\r\n" +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  const client = makeWsClient(socket);
  wsClients.add(client);
  socket.on("close", () => wsClients.delete(client));
});

function makeWsClient(socket) {
  let buf = Buffer.alloc(0);
  const api = {
    send(text) {
      const body = Buffer.from(text, "utf8");
      const head = Buffer.from([0x81, body.length < 126 ? body.length : 126]);
      let frame = head;
      if (body.length >= 126) {
        const ext = Buffer.alloc(2);
        ext.writeUInt16BE(body.length, 0);
        frame = Buffer.concat([head, ext]);
      }
      socket.write(Buffer.concat([frame, body]));
    },
  };
  socket.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    // Minimal masked text-frame parser (client->server frames are masked).
    while (buf.length >= 6) {
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) { len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { socket.destroy(); return; }
      const mask = masked ? buf.slice(off, off + 4) : null;
      off += masked ? 4 : 0;
      if (buf.length < off + len) break;
      let payload = buf.slice(off, off + len);
      if (mask) {
        const out = Buffer.alloc(len);
        for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i % 4];
        payload = out;
      }
      buf = buf.slice(off + len);
      if (opcode === 0x8) { socket.end(); return; }
      if (opcode === 0x1) onPiMessage(payload.toString("utf8"), api);
    }
  });
  return api;
}

function onPiMessage(text, ws) {
  let msg;
  try { msg = JSON.parse(text); } catch { return; }
  if (!msg || msg.id === undefined || !msg.op) return;
  // Forward to extension via Native Messaging; reply routes back via pending.
  pending.set(msg.id, (res) => ws.send(JSON.stringify(res)));
  sendToExtension({ id: msg.id, op: msg.op, tabId: msg.tabId, command: msg.command });
  setTimeout(() => {
    if (pending.has(msg.id)) {
      pending.delete(msg.id);
      ws.send(JSON.stringify({ id: msg.id, ok: false, error: "timeout waiting for extension" }));
    }
  }, 15000);
}

readStdin();
server.listen(PORT, "127.0.0.1", () => {
  process.stderr.write(`pi-browser-control native host on 127.0.0.1:${PORT}\n`);
});
