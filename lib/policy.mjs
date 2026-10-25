import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export const DEFAULT_CONFIG = {
  permissions: { deny: [], allow: [] },
  confirm: { eval: true, download: true, upload: true },
  annotation: { headed: true },
};

export function matchesPattern(host, pattern) {
  const h = String(host).toLowerCase();
  let p = String(pattern).toLowerCase();
  if (p === "*") return true;
  if (p.startsWith("*.")) p = p.slice(2);
  return h === p || h.endsWith("." + p);
}

export function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); }
  catch { return ""; }
}

export function checkPermission(url, config = DEFAULT_CONFIG) {
  const host = hostOf(url);
  const { deny = [], allow = [] } = config.permissions ?? {};
  if (allow.some((p) => matchesPattern(host, p))) return { allowed: true };
  if (deny.some((p) => matchesPattern(host, p))) return { allowed: false, reason: `denied by pattern for ${host}` };
  return { allowed: true };
}

export function requiresConfirmation(toolName, config = DEFAULT_CONFIG) {
  const sensitive = { eval: "confirm.eval", download: "confirm.download", upload: "confirm.upload" };
  const key = Object.keys(sensitive).find((k) => String(toolName).includes(k));
  if (!key) return false;
  return config.confirm?.[key] !== false;
}

export function detectPageChange(before, after) {
  const b = before ?? {};
  const a = after ?? {};
  if (a.url && b.url && a.url !== b.url) return { changed: true, kind: "navigated", url: a.url };
  if (a.refCount !== undefined && b.refCount !== undefined && a.refCount !== b.refCount)
    return { changed: true, kind: "refs-changed", before: b.refCount, after: a.refCount };
  return { changed: false };
}

export function loadConfig(opts = {}) {
  const candidates = [];
  if (opts.cwd) candidates.push(join(opts.cwd, ".pi", "pi-browser-control.json"));
  candidates.push(join(homedir(), ".pi", "agent", "pi-browser-control.json"));
  let merged = structuredClone(DEFAULT_CONFIG);
  for (const f of candidates) {
    if (!isAbsolute(f) || !existsSync(f)) continue;
    try {
      const raw = JSON.parse(readFileSync(f, "utf8"));
      merged = { ...merged, ...raw, permissions: { ...merged.permissions, ...(raw.permissions ?? {}) }, confirm: { ...merged.confirm, ...(raw.confirm ?? {}) } };
    } catch { /* abaikan file rusak */ }
  }
  return merged;
}
