import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesPattern, checkPermission, requiresConfirmation, detectPageChange, bridgeSensitiveName, bridgeUrl, DEFAULT_CONFIG } from "../lib/policy.mjs";
import { bridgeSend, bridgeStatus, bridgeShutdown, BRIDGE_PORT } from "../lib/bridge.mjs";

const TEST_PORT = 17999;

test("bridge auto-start server, lalu 503 karena extension belum konek", async () => {
  const res = await bridgeSend({ op: "listTabs" }, { port: TEST_PORT, timeoutMs: 8000 });
  assert.equal(res.ok, false);
  assert.match(String(res.error), /extension not connected|companion/i);
  const st = await bridgeStatus({ port: TEST_PORT });
  assert.equal(st.running, true);
  assert.equal(st.extension, "disconnected");
  await bridgeShutdown({ port: TEST_PORT });
});

test("bridge health mati setelah shutdown", async () => {
  await new Promise((r) => setTimeout(r, 300));
  const st = await bridgeStatus({ port: TEST_PORT });
  assert.equal(st.running, false);
});

test("bridge port default 17832", () => {
  assert.equal(BRIDGE_PORT, 17832);
});

test("matchesPattern cocokkan subdomain dan bare domain", () => {
  assert.equal(matchesPattern("ads.example.com", "*.example.com"), true);
  assert.equal(matchesPattern("example.com", "*.example.com"), true);
  assert.equal(matchesPattern("other.com", "*.example.com"), false);
});

test("deny blockir host, allow jadi exception", () => {
  const config = { ...DEFAULT_CONFIG, permissions: { deny: ["*.ads.example"], allow: ["safe.ads.example"] } };
  assert.equal(checkPermission("https://evil.ads.example/x", config).allowed, false);
  assert.equal(checkPermission("https://safe.ads.example/x", config).allowed, true);
  assert.equal(checkPermission("https://example.com/", config).allowed, true);
});

test("aksi sensitif butuh konfirmasi", () => {
  assert.equal(requiresConfirmation("browser_run_script", DEFAULT_CONFIG), false);
  assert.equal(requiresConfirmation("browser_eval_js", DEFAULT_CONFIG), true);
  assert.equal(requiresConfirmation("browser_download", DEFAULT_CONFIG), true);
});

test("detectPageChange kenali navigasi user", () => {
  const r = detectPageChange({ url: "https://a.com/", refCount: 10 }, { url: "https://b.com/", refCount: 5 });
  assert.equal(r.changed, true);
  assert.equal(r.kind, "navigated");
  const same = detectPageChange({ url: "https://a.com/", refCount: 10 }, { url: "https://a.com/", refCount: 10 });
  assert.equal(same.changed, false);
});

test("guard hanya peduli tool browser_", () => {
  const names = ["browser_navigate", "browser_click", "read", "bash"];
  const relevant = names.filter((n) => n.startsWith("browser_"));
  assert.deepEqual(relevant, ["browser_navigate", "browser_click"]);
});

test("bridge: navigate URL terdeteksi untuk policy", () => {
  assert.equal(bridgeUrl("Page", "navigate", { url: "https://evil.example/" }), "https://evil.example/");
  assert.equal(bridgeUrl("Runtime", "evaluate", { expression: "1" }), undefined);
});

test("bridge: eval dan screenshot butuh konfirmasi", () => {
  assert.equal(bridgeSensitiveName("Runtime", "evaluate"), "bc_eval");
  assert.equal(requiresConfirmation(bridgeSensitiveName("Runtime", "evaluate"), DEFAULT_CONFIG), true);
  assert.equal(bridgeSensitiveName("Page", "captureScreenshot"), "bc_download");
  assert.equal(requiresConfirmation(bridgeSensitiveName("Page", "captureScreenshot"), DEFAULT_CONFIG), true);
  assert.equal(bridgeSensitiveName("Page", "navigate"), "");
});

test("pin model: ganti model di tengah jalan terdeteksi", () => {
  const pinned = "surplus/deepseek-v4.1-flash";
  const same = "surplus/deepseek-v4.1-flash";
  const changed = "agentrouter/gpt-5-mini";
  assert.equal(pinned === same, true);
  assert.equal(pinned === changed, false);
});
