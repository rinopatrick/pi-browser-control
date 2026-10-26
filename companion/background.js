// pi-browser-control companion — background service worker.
//
// Bridge: chrome.debugger (privileged, in-Chrome CDP) <-> Native Messaging
// host (pi-browser-control-native-host). The host exposes a local WebSocket
// that the Pi package talks to. No remote-debugging flag, no relaunch.
//
// Protocol (JSON lines over the native port):
//   host -> ext : { id, tabId?, op, params? }
//     op: "attach" | "detach" | "command" | "listTabs"
//     command: { domain, method, params? } e.g. {domain:"Page",method:"navigate",params:{url}}
//   ext -> host: { id, ok, result? | error? }
//
// Notes:
// - Only one debugger per tab. If another client (e.g. ChatGPT extension)
//   holds the tab, attach fails with "Another debugger is attached".
//   Use a different tab — never fight over the active one.
// - Chrome shows an infobar "is being debugged" while attached. Required,
//   cannot be hidden.

const NATIVE_HOST = "com.pi_browser_control.host";
const CDP_VERSION = "1.3";

let port = null;
let pending = new Map();

function send(obj) {
  port.postMessage(obj);
}

function reply(id, ok, payload) {
  if (ok) send({ id, ok: true, result: payload });
  else send({ id, ok: false, error: String(payload) });
}

async function handleAttach(id, tabId) {
  const target = tabId ? { tabId } : await pickActiveTab();
  if (!target) return reply(id, false, "no tab available");
  try {
    await chrome.debugger.attach({ tabId: target.id ?? target.tabId }, CDP_VERSION);
    const t = target.id ?? target.tabId;
    reply(id, true, { tabId: t });
  } catch (e) {
    reply(id, false, e && e.message ? e.message : String(e));
  }
}

async function pickActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
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
      tabs: tabs.map((t) => ({ id: t.id, url: t.url || "", title: t.title || "", active: !!t.active })),
    });
  } catch (e) {
    reply(id, false, e && e.message ? e.message : String(e));
  }
}

function onNativeMessage(msg) {
  if (!msg || msg.id === undefined || !msg.op) return;
  const { id, op, tabId, command } = msg;
  if (op === "attach") return void handleAttach(id, tabId);
  if (op === "detach") return void handleDetach(id, tabId);
  if (op === "command") return void handleCommand(id, tabId, command);
  if (op === "listTabs") return void handleListTabs(id);
  reply(id, false, "unknown op: " + op);
}

function connect() {
  try {
    port = chrome.runtime.connectNative(NATIVE_HOST);
  } catch (e) {
    // Host not registered — retry in 10s so installing the host later just works.
    setTimeout(connect, 10000);
    return;
  }
  port.onMessage.addListener(onNativeMessage);
  port.onDisconnect.addListener(() => {
    port = null;
    pending.clear();
    setTimeout(connect, 5000);
  });
}

chrome.runtime.onStartup.addListener(() => {
  if (!port) connect();
});

connect();
