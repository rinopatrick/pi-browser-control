// Bridge client: Pi package -> local bridge server over HTTP.
// No dependencies. If the server is not running, start it detached once,
// then retry. The server itself lives independently of Chrome.

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const BRIDGE_PORT = Number(process.env.PI_BC_PORT || 17832);
export const BRIDGE_HOST = "127.0.0.1";

const here = dirname(fileURLToPath(import.meta.url));
const SERVER_SCRIPT = join(here, "..", "native-host", "bridge-server.mjs");

function baseUrl(port) {
  return `http://${BRIDGE_HOST}:${port}`;
}

async function postJson(url, body, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    try {
      return { status: res.status, json: JSON.parse(text) };
    } catch {
      return { status: res.status, json: { ok: false, error: text.slice(0, 300) } };
    }
  } finally {
    clearTimeout(timer);
  }
}

async function health(port) {
  try {
    const res = await fetch(`${baseUrl(port)}/health`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Start the bridge server detached, then wait until /health answers. */
export async function ensureServer({ port = BRIDGE_PORT, waitMs = 4000 } = {}) {
  const already = await health(port);
  if (already) return { started: false, status: already };

  try {
    const child = spawn(process.execPath, [SERVER_SCRIPT, "--port", String(port)], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
  } catch {
    return { started: false, status: null };
  }

  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
    const st = await health(port);
    if (st) return { started: true, status: st };
  }
  return { started: false, status: null };
}

/** Send one bridge command. Auto-starts the server when it is not running. */
export async function bridgeSend(msg, { port = BRIDGE_PORT, timeoutMs = 20000 } = {}) {
  const id = Date.now() + Math.floor(Math.random() * 1000);
  const payload = { ...msg, id };
  const url = `${baseUrl(port)}/command`;

  const attempt = async () => {
    try {
      return await postJson(url, payload, timeoutMs);
    } catch (e) {
      return { status: 0, json: { ok: false, error: String(e && e.message ? e.message : e) } };
    }
  };

  let res = await attempt();

  if (res.status === 0) {
    await ensureServer({ port });
    res = await attempt();
  }

  if (res.status === 0) {
    return {
      id,
      ok: false,
      error: `cannot reach bridge at ${baseUrl(port)} — start it with: node native-host/bridge-server.mjs`,
    };
  }

  const out = res.json && typeof res.json === "object" ? res.json : { ok: false, error: "bad reply" };
  if (out.id === undefined) out.id = id;
  if (out.ok === undefined) out.ok = false;
  return out;
}

/** Read-only status probe; never starts anything. */
export async function bridgeStatus({ port = BRIDGE_PORT } = {}) {
  const st = await health(port);
  return st ? { running: true, ...st } : { running: false };
}

/** Stop the bridge server (dev/test helper). */
export async function bridgeShutdown({ port = BRIDGE_PORT } = {}) {
  try {
    await fetch(`${baseUrl(port)}/shutdown`, { method: "POST", signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}
