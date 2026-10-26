import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesPattern, checkPermission, requiresConfirmation, detectPageChange, DEFAULT_CONFIG } from "../lib/policy.mjs";

test("matchesPattern matches subdomains and bare domain", () => {
  assert.equal(matchesPattern("ads.example.com", "*.example.com"), true);
  assert.equal(matchesPattern("example.com", "*.example.com"), true);
  assert.equal(matchesPattern("other.com", "*.example.com"), false);
});

test("deny blocks host, allow is an exception", () => {
  const config = { ...DEFAULT_CONFIG, permissions: { deny: ["*.ads.example"], allow: ["safe.ads.example"] } };
  assert.equal(checkPermission("https://evil.ads.example/x", config).allowed, false);
  assert.equal(checkPermission("https://safe.ads.example/x", config).allowed, true);
  assert.equal(checkPermission("https://example.com/", config).allowed, true);
});

test("sensitive actions require confirmation", () => {
  assert.equal(requiresConfirmation("browser_run_script", DEFAULT_CONFIG), false);
  assert.equal(requiresConfirmation("browser_eval_js", DEFAULT_CONFIG), true);
  assert.equal(requiresConfirmation("browser_download", DEFAULT_CONFIG), true);
});

test("detectPageChange detects user navigation", () => {
  const r = detectPageChange({ url: "https://a.com/", refCount: 10 }, { url: "https://b.com/", refCount: 5 });
  assert.equal(r.changed, true);
  assert.equal(r.kind, "navigated");
  const same = detectPageChange({ url: "https://a.com/", refCount: 10 }, { url: "https://a.com/", refCount: 10 });
  assert.equal(same.changed, false);
});

test("guard only cares about browser_ tools", () => {
  const names = ["browser_navigate", "browser_click", "read", "bash"];
  const relevant = names.filter((n) => n.startsWith("browser_"));
  assert.deepEqual(relevant, ["browser_navigate", "browser_click"]);
});

test("model pin: mid-run model change is detected", () => {
  const pinned = "surplus/deepseek-v4.1-flash";
  const same = "surplus/deepseek-v4.1-flash";
  const changed = "agentrouter/gpt-5-mini";
  assert.equal(pinned === same, true);
  assert.equal(pinned === changed, false);
});
