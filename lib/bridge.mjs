// Bridge client: Pi package -> native host over one-shot TCP (127.0.0.1).
// No dependencies: open TCP, send one JSON line, read one JSON line, close.
// Matches native-host.mjs rewritten protocol (no WebSocket anymore).

import { createConnection } from "node:net";

export const BRIDGE_PORT = Number(process.env.PI_BC_PORT || 17832);
export const BRIDGE_HOST = "127.0.0.1";

export function bridgeSend(msg, { port = BRIDGE_PORT, timeoutMs = 20000 } = {}) {
  const id = Date.now() + Math.floor(Math.random() * 1000);
  return new Promise((resolve) => {
    const done = (res) => { try { socket.destroy(); } catch {} resolve(res); };
    const timer = setTimeout(
      () => done({ id, ok: false, error: "bridge timeout: is the native host running?" }),
      timeoutMs
    );
    const socket = createConnection({ host: BRIDGE_HOST, port }, () => {
      socket.write(JSON.stringify({ ...msg, id }) + "\n");
    });
    let buf = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      buf += chunk;
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      clearTimeout(timer);
      try {
        const res = JSON.parse(buf.slice(0, nl).trim());
        if (res.id === undefined) res.id = id;
        done(res);
      } catch {
        done({ id, ok: false, error: "bad bridge reply" });
      }
    });
    socket.on("error", () => {
      clearTimeout(timer);
      done({ id, ok: false, error: "cannot reach bridge at 127.0.0.1:" + port + " — the companion extension spawns the host on demand; reload it in chrome://extensions if this persists" });
    });
  });
}
