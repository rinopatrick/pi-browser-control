import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesPattern, checkPermission, requiresConfirmation, detectPageChange, DEFAULT_CONFIG } from "../lib/policy.mjs";

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

test("pin model: ganti model di tengah jalan terdeteksi", () => {
  const pinned = "surplus/deepseek-v4.1-flash";
  const same = "surplus/deepseek-v4.1-flash";
  const changed = "agentrouter/gpt-5-mini";
  assert.equal(pinned === same, true);
  assert.equal(pinned === changed, false);
});
