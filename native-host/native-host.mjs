// pi-browser-control native host (rewritten fix).
//
// Chrome launches ONE instance per connected extension and kills it when the
// last extension port closes. The old design kept an independent WebSocket
// server alive forever, so if Chrome killed the host the socket died with
// the wrong owner, and if the host outlived Chrome the pipe broke.
// New design: the process lifetime == the extension connection lifetime.
//
// Protocol is still two-sided:
// - stdin/stdout: Native Messaging framing (u32LE length + UTF-8 JSON)
//   toward the companion extension.
// - TCP on 127.0.0.1:17832: one-shot JSON-RPC-ish bridge toward the Pi side:
//   client opens TCP, sends one JSON line {id, op, tabId?, command?},
//   reads one JSON line reply, closes. No WebSocket, no dependencies,
//   no background server to go stale.
//
// Lifecycle: connectNative spawns us -> we listen on TCP -> extension talks
// CDP -> host forwards answers to TCP clients -> extension disconnects ->
// we exit. Next connectNative spawns a fresh host. No orphans.

import { stdin, stdout, exit, env, argv } from "node:process";
import { createServer } from "node:net";

const PORT = Number(env.PI_BC_PORT || (argv.includes("--port") ? argv[argv.indexOf("--port") + 1] : 17832));

const pending = new Map();
let extensionDead = false;

function readStdin() {
  let buf = Buffer.alloc(0);
  stdin.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 4) {
      const len = buf.readUInt32LE(0);
      if (buf.length < 4 + len) break;
      let msg;
      try {
        msg = JSON.parse(buf.slice(4, 4 + len).toString("utf8"));
      } catch {
        buf = buf.slice(4 + len);
        continue;
      }
      buf = buf.slice(4 + len);
      onExtensionMessage(msg);
    }
  });
  stdin.on("end", () => shutdown());
  stdin.on("close", () => shutdown());
}

function sendToExtension(obj) {
  if (extensionDead) return false;
  try {
    const body = Buffer.from(JSON.stringify(obj), "utf8");
    const head = Buffer.alloc(4);
    head.writeUInt32LE(body.length, 0);
    stdout.write(Buffer.concat([head, body]));
    return true;
  } catch {
    return false;
  }
}

function onExtensionMessage(msg) {
  if (!msg || msg.id === undefined) return;
  if (msg.op === "hello") {
    // Extension announcing itself; reply so it knows the host is fresh.
    sendToExtension({ id: msg.id, ok: true, result: { host: "pi-browser-control", pid: process.pid } });
    return;
  }
  const resolve = pending.get(msg.id);
  pending.delete(msg.id);
  if (resolve) resolve(msg);
}

function shutdown() {
  extensionDead = true;
  for (const [, resolve] of pending) {
    try { resolve({ ok: false, error: "extension disconnected" }); } catch {}
  }
  pending.clear();
  server.close(() => exit(0));
  setTimeout(() => exit(0), 1000).unref();
}

// One-shot TCP bridge: one JSON line in, one JSON line out, then close.
const server = createServer((socket) => {
  let buf = "";
  socket.setEncoding("utf8");
  const timer = setTimeout(() => socket.destroy(), 20000);
  socket.on("data", (chunk) => {
    buf += chunk;
    const nl = buf.indexOf("\n");
    if (nl < 0) return;
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    let msg;
    try { msg = JSON.parse(line); } catch {
      clearTimeout(timer);
      socket.end(JSON.stringify({ ok: false, error: "bad json" }) + "\n");
      return;
    }
    if (!msg || msg.id === undefined || !msg.op) {
      clearTimeout(timer);
      socket.end(JSON.stringify({ id: msg && msg.id, ok: false, error: "need {id, op}" }) + "\n");
      return;
    }
    pending.set(msg.id, (res) => {
      clearTimeout(timer);
      try { socket.end(JSON.stringify(res) + "\n"); } catch {}
    });
    if (!sendToExtension({ id: msg.id, op: msg.op, tabId: msg.tabId, command: msg.command })) {
      pending.delete(msg.id);
      clearTimeout(timer);
      socket.end(JSON.stringify({ id: msg.id, ok: false, error: "extension not connected" }) + "\n");
      return;
    }
    setTimeout(() => {
      if (pending.has(msg.id)) {
        pending.delete(msg.id);
        clearTimeout(timer);
        try { socket.end(JSON.stringify({ id: msg.id, ok: false, error: "timeout waiting for extension (15s)" }) + "\n"); } catch {}
      }
    }, 15000).unref();
  });
  socket.on("error", () => { clearTimeout(timer); });
});

server.on("error", (e) => {
  // Port taken by a stale host: fail fast so the caller sees it, instead of
  // silently running a second bridge nobody talks to.
  process.stderr.write("bridge listen failed: " + (e && e.message) + "\n");
  exit(2);
});

readStdin();
server.listen(PORT, "127.0.0.1", () => {
  process.stderr.write(`pi-browser-control native host on 127.0.0.1:${PORT} pid=${process.pid}\n`);
});
