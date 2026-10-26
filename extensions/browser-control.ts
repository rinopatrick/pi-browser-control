/**
 * pi-browser-control — browser control ala Codex untuk Pi.
 *
 * Engine CDP: pi-browser-harness (dependensi, credit di README).
 * Lapisan ini: guard policy per-site, command bc-view (live view),
 * command bc-policy (tampilkan policy efektif).
 */

import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { checkPermission, loadConfig, requiresConfirmation, type PolicyConfig } from "../lib/policy.mjs";

const MARKER = "pi-browser-control:";

export default function browserControl(pi: ExtensionAPI) {
  let config: PolicyConfig = loadConfig();

  pi.registerCommand("bc-view", {
    description: "[pi-browser-control] Live view read-only tab agent agar user bisa menonton",
    handler: async (_args: string) => {
      pi.sendUserMessage(
        "Panggil tool browser_snapshot milik harness dengan includeScreenshot=true, " +
        "lalu tampilkan ringkas apa yang terlihat di tab agent saat ini.",
      );
    },
  });

  pi.registerCommand("bc-policy", {
    description: "[pi-browser-control] Tampilkan policy browser yang berlaku",
    handler: async (_args: string, ctx) => {
      config = loadConfig({ cwd: ctx.cwd });
      pi.sendUserMessage(
        `Policy: deny=[${config.permissions.deny.join(", ") || "none"}] ` +
        `allow=[${config.permissions.allow.join(", ") || "none"}]. ` +
        "Tampilkan ke user apa adanya.",
      );
    },
  });

  pi.on("tool_call", async (event, ctx) => {
    const name = String(event.toolName ?? "");
    if (!name.startsWith("browser_")) return;
    const url = typeof event.input?.url === "string" ? event.input.url : undefined;
    if (url) {
      const verdict = checkPermission(url, config);
      if (!verdict.allowed) return { block: true, reason: `${MARKER} ${verdict.reason}` };
    }
    if (requiresConfirmation(name, config)) {
      if (!ctx.hasUI) return { block: true, reason: `${MARKER} ${name} butuh konfirmasi user (tanpa UI, diblokir)` };
      const ok = await ctx.ui.confirm(`Jalankan ${name}?`, name);
      if (!ok) return { block: true, reason: `${MARKER} user menolak ${name}` };
    }
  });
}
