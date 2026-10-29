// pi-browser-control bridge server (Option A).
//
// Persistent localhost server. Nothing in this process is owned by Chrome,
// so Chrome can never kill it -> no more "Native host has exited" loop.
//
// Two sides:
//   - Chrome companion extension connects as a WebSocket client to /ext
//   - Pi connects over plain HTTP POST /command (no WS framing needed)
//
// Server relays: POST /command -> WS to extension -> CDP -> reply -> HTTP response.
//
// Start: node native-host/bridge-server.mjs [--port 17832]
// Health: GET /health

import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PORT = Number(
  process.env.PI_BC_PORT ||
    (process.argv.includes("--port") ? process.argv[process.argv.indexOf("--port") + 1] : 17832)
);
const HOST = "127.0.0.1";
const EXT_TIMEOUT_MS = 15000;
const LOG_DIR = join(homedir(), ".pi", "agent");
const LOG_FILE = join(LOG_DIR, "pi-browser-control-bridge.log");

try {
  mkdirSync(LOG_DIR, { recursive: true });
} catch {}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    appendFileSync(LOG_FILE, line);
  } catch {}
}

// A local bridge should stay up. Log and continue instead of dying, so a bad
// frame or an aborted client cannot take the whole bridge down.
process.on("uncaughtException", (e) => log("uncaughtException: " + (e && e.stack ? e.stack : e)));
process.on("unhandledRejection", (e) => log("unhandledRejection: " + (e && e.stack ? e.stack : e)));

let extSocket = null;
let extSince = 0;
const pending = new Map();
let seq = 1;

function wsAccept(key) {
  return createHash("sha1")
    .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");
}

function encodeFrame(text) {
  const body = Buffer.from(text, "utf8");
  const len = body.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, body]);
}

function attachFrameReader(socket, onText, onClose) {
  let buf = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        len = Number(buf.readBigUInt64BE(2));
        off = 10;
      }
      const maskLen = masked ? 4 : 0;
      if (buf.length < off + maskLen + len) return;
      const mask = masked ? buf.slice(off, off + 4) : null;
      off += maskLen;
      let payload = buf.slice(off, off + len);
      if (mask) {
        const out = Buffer.alloc(len);
        for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i % 4];
        payload = out;
      }
      buf = buf.slice(off + len);
      if (opcode === 0x8) {
        socket.end();
        onClose && onClose();
        return;
      }
      if (opcode === 0x9) {
        try {
          socket.write(Buffer.concat([Buffer.from([0x8a, 0]), Buffer.alloc(0)]));
        } catch {}
        continue;
      }
      if (opcode === 0x1) onText(payload.toString("utf8"));
    }
  });
  socket.on("close", () => onClose && onClose());
  socket.on("error", () => onClose && onClose());
}

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

const EXT_ID = process.env.PI_BC_EXT_ID || "oinpiamkgncpoekibkgjgobpfeijopcg";
const EXT_ORIGIN = `chrome-extension://${EXT_ID}`;
const MAX_BODY = 1024 * 1024;

/** Browsers always send Origin on cross-origin fetches; Node clients do not. */
function isBrowserRequest(req) {
  return typeof req.headers.origin === "string" && req.headers.origin.length > 0;
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = "";
    let tooBig = false;
    req.setEncoding("utf8");
    req.on("data", (c) => {
      if (tooBig) return;
      b += c;
      if (b.length > MAX_BODY) {
        tooBig = true;
        b = "";
      }
    });
    req.on("end", () => resolve(tooBig ? null : b));
  });
}

const server = createServer(async (req, res) => {
  // A client that aborts mid-response must never crash the bridge.
  res.on("error", () => {});
  try {
    await route(req, res);
  } catch (e) {
    log("request error: " + (e && e.stack ? e.stack : e));
    try {
      if (!res.headersSent) json(res, 500, { ok: false, error: "internal error" });
      else res.end();
    } catch {}
  }
});

server.on("clientError", (err, socket) => {
  log("clientError: " + (err && err.message ? err.message : err));
  try {
    socket.destroy();
  } catch {}
});

async function route(req, res) {
  if (req.url === "/health") {
    return json(res, 200, {
      ok: true,
      extension: extSocket ? "connected" : "disconnected",
      connectedSince: extSince || null,
      pending: pending.size,
    });
  }

  if (req.url === "/command" && req.method === "POST") {
    // Reject anything a web page could send. A malicious site can POST
    // text/plain to localhost without a CORS preflight, so Origin + content-type
    // are the real boundary here.
    if (isBrowserRequest(req)) {
      return json(res, 403, { ok: false, error: "browser-originated requests are not allowed" });
    }
    const ctype = String(req.headers["content-type"] || "");
    if (!ctype.startsWith("application/json")) {
      return json(res, 415, { ok: false, error: "content-type must be application/json" });
    }

    const raw = await readBody(req);
    if (raw === null) return json(res, 413, { ok: false, error: "body too large" });
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return json(res, 400, { ok: false, error: "bad json" });
    }
    if (!msg || !msg.op) return json(res, 400, { ok: false, error: "need {op, tabId?, command?}" });

    if (!extSocket) {
      return json(res, 503, {
        ok: false,
        error:
          "companion extension not connected — enable it in chrome://extensions and make sure it can reach ws://127.0.0.1:" +
          PORT +
          "/ext",
      });
    }

    const id = seq++;
    const reply = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({ id, ok: false, error: "timeout waiting for extension (15s)" });
      }, EXT_TIMEOUT_MS);
      pending.set(id, (r) => {
        clearTimeout(timer);
        resolve(r);
      });
      try {
        extSocket.write(encodeFrame(JSON.stringify({ ...msg, id })));
      } catch (e) {
        clearTimeout(timer);
        pending.delete(id);
        resolve({ id, ok: false, error: "write to extension failed" });
      }
    });
    return json(res, 200, reply);
  }

  if (req.url === "/shutdown" && req.method === "POST") {
    if (isBrowserRequest(req)) {
      return json(res, 403, { ok: false, error: "browser-originated requests are not allowed" });
    }
    json(res, 200, { ok: true, stopping: true });
    setTimeout(() => server.close(() => process.exit(0)), 50);
    return;
  }

  json(res, 404, { ok: false, error: "not found" });
}

server.on("upgrade", (req, socket) => {
  if (!req.url || !req.url.startsWith("/ext")) {
    socket.destroy();
    return;
  }
  // Only our own extension may register as the CDP peer. Web pages always
  // send an Origin header; a service worker may omit it, and a local
  // non-browser client can spoof anything anyway (same user = same trust).
  const origin = String(req.headers.origin || "");
  if (origin && origin !== EXT_ORIGIN) {
    socket.destroy();
    return;
  }
  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }
  const accept = wsAccept(Array.isArray(key) ? key[0] : key);
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );

  // One extension at a time: a new connection replaces the old one.
  if (extSocket && extSocket !== socket) {
    try {
      extSocket.end();
    } catch {}
  }
  extSocket = socket;
  extSince = Date.now();
  process.stderr.write(`[bridge] extension connected (${extSince})\n`);

  attachFrameReader(
    socket,
    (text) => {
      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }
      if (!msg || msg.id === undefined) return;
      const resolve = pending.get(msg.id);
      pending.delete(msg.id);
      if (resolve) resolve(msg);
    },
    () => {
      if (extSocket === socket) {
        extSocket = null;
        extSince = 0;
        process.stderr.write("[bridge] extension disconnected\n");
      }
    }
  );
});

server.on("error", (e) => {
  process.stderr.write("[bridge] listen failed: " + (e && e.message) + "\n");
  process.exit(2);
});

server.listen(PORT, HOST, () => {
  process.stderr.write(`[bridge] listening on http://${HOST}:${PORT} (ws /ext, post /command)\n`);
});
