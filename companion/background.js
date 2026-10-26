// pi-browser-control companion — background service worker (Option A).
//
// Transport: the extension is a WebSocket CLIENT to the local bridge server
// (ws://127.0.0.1:17832/ext). No Native Messaging, so Chrome can never kill a
// host process and we never see "Native host has exited".
//
// Privileged CDP: chrome.debugger.attach + sendCommand on the target tab.
//
// Commands arrive as {id, op, tabId?, command?}:
//   op: "attach" | "detach" | "command" | "listTabs" | "ping"
//   command: {domain, method, params?}
// Replies: {id, ok, result? | error?}
//
// Notes:
// - One debugger per tab. If another client holds the tab, attach fails.
// - Chrome shows an infobar "is being debugged" while attached. Required.

const BRIDGE_URL = "ws://127.0.0.1:17832/ext";
const CDP_VERSION = "1.3";

let ws = null;
let retryMs = 1000;
let helloTimer = null;

function send(obj) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  try {
    ws.send(JSON.stringify(obj));
    return true;
  } catch {
    return false;
  }
}

function reply(id, ok, payload) {
  if (ok) send({ id, ok: true, result: payload });
  else send({ id, ok: false, error: String(payload) });
}

async function pickActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function handleAttach(id, tabId) {
  try {
    let target = tabId;
    if (!target) {
      const tab = await pickActiveTab();
      if (!tab) return reply(id, false, "no active tab");
      target = tab.id;
    }
    await chrome.debugger.attach({ tabId: target }, CDP_VERSION);
    reply(id, true, { tabId: target });
  } catch (e) {
    reply(id, false, e && e.message ? e.message : String(e));
  }
}

async function handleDetach(id, tabId) {
  try {
    await chrome.debugger.detach({ tabId });
    reply(id, true, {});
  } catch (e) {
    reply(id, false, e && e.message ? e.message : String(e));
  }
}

async function handleCommand(id, tabId, command) {
  try {
    if (!command || !command.domain || !command.method) {
      return reply(id, false, "command needs {domain, method, params?}");
    }
    const res = await chrome.debugger.sendCommand(
      { tabId },
      `${command.domain}.${command.method}`,
      command.params || {}
    );
    reply(id, true, res || {});
  } catch (e) {
    reply(id, false, e && e.message ? e.message : String(e));
  }
}

async function handleListTabs(id) {
  try {
    const tabs = await chrome.tabs.query({});
    reply(id, true, {
      tabs: tabs.map((t) => ({
        id: t.id,
        url: t.url || "",
        title: t.title || "",
        active: !!t.active,
        windowId: t.windowId,
      })),
    });
  } catch (e) {
    reply(id, false, e && e.message ? e.message : String(e));
  }
}

function onBridgeMessage(ev) {
  let msg;
  try {
    msg = JSON.parse(ev.data);
  } catch {
    return;
  }
  if (!msg || msg.id === undefined) return;
  if (msg.op === "ping") return reply(msg.id, true, { pong: true, ts: Date.now() });
  if (msg.op === "attach") return void handleAttach(msg.id, msg.tabId);
  if (msg.op === "detach") return void handleDetach(msg.id, msg.tabId);
  if (msg.op === "command") return void handleCommand(msg.id, msg.tabId, msg.command);
  if (msg.op === "listTabs") return void handleListTabs(msg.id);
  reply(msg.id, false, "unknown op: " + msg.op);
}

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  try {
    ws = new WebSocket(BRIDGE_URL);
  } catch {
    scheduleReconnect();
    return;
  }

  ws.addEventListener("open", () => {
    retryMs = 1000;
    send({ id: "hello-" + Date.now(), op: "ping" });
    // Wake the server-side pairing immediately so /health flips to connected.
    chrome.action.setTitle({ title: "pi-browser-control: bridge connected" }).catch(() => {});
  });

  ws.addEventListener("message", onBridgeMessage);

  ws.addEventListener("close", () => {
    ws = null;
    scheduleReconnect();
  });

  ws.addEventListener("error", () => {
    // close fires right after error; nothing to do here.
  });
}

function scheduleReconnect() {
  chrome.action.setTitle({ title: "pi-browser-control: bridge offline" }).catch(() => {});
  setTimeout(connect, retryMs);
  retryMs = Math.min(retryMs * 2, 15000);
}

// Keep the service worker warm so the socket reconnects promptly.
chrome.alarms.create("pi-bc-heartbeat", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== "pi-bc-heartbeat") return;
  if (!ws || ws.readyState === WebSocket.CLOSED) {
    retryMs = 1000;
    connect();
  } else if (ws.readyState === WebSocket.OPEN) {
    send({ id: "hb-" + Date.now(), op: "ping" });
  }
});

chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
chrome.tabs.onUpdated.addListener((_tabId, info) => {
  if (info.status === "complete" && (!ws || ws.readyState === WebSocket.CLOSED)) connect();
});

connect();
