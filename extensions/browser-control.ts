/**
 * pi-browser-control — browser control ala Codex untuk Pi.
 *
 * Engine CDP: pi-browser-harness (dependensi, credit di README).
 * Lapisan ini: guard policy per-site, command bc-view (live view),
 * command bc-policy (tampilkan policy efektif).
 */

import { type ExtensionAPI, defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { checkPermission, loadConfig, requiresConfirmation, type PolicyConfig } from "../lib/policy.mjs";
import { bridgeSend, bridgeStatus, BRIDGE_PORT } from "../lib/bridge.mjs";

const MARKER = "pi-browser-control:";

export default function browserControl(pi: ExtensionAPI) {
  let config: PolicyConfig = loadConfig();
  let pinnedModel: string | null = null;

  pi.on("before_agent_start", async (_event, ctx) => {
    const m = ctx.model as { id?: string; provider?: string } | undefined;
    pinnedModel = m?.id ? `${m.provider ?? "?"}/${m.id}` : null;
  });

  pi.registerCommand("bc-view", {
    description: "[pi-browser-control] Live view read-only tab agent agar user bisa menonton",
    handler: async (_args: string) => {
      pi.sendUserMessage(
        "Panggil tool browser_snapshot milik harness dengan includeScreenshot=true, lalu tampilkan ringkas apa yang terlihat di tab agent.",
      );
    },
  });

  pi.registerCommand("bc-policy", {
    description: "[pi-browser-control] Show the effective browser policy",
    handler: async (_args: string, ctx) => {
      config = loadConfig({ cwd: ctx.cwd });
      pi.sendUserMessage(
        `Policy deny=[${config.permissions.deny.join(", ") || "none"}] allow=[${config.permissions.allow.join(", ") || "none"}]`,
      );
    },
  });

  pi.registerCommand("bc-attach", {
    description: "[pi-browser-control] Attach to the running Chrome via the companion extension (no relaunch, no flag)",
    handler: async (_args: string) => {
      pi.sendUserMessage(
        `Call the bc_bridge tool with op="listTabs" (port ${BRIDGE_PORT}). Pick a tab that is not held by another debugger, then attach with op="attach".`,
      );
    },
  });

  const bridgeTool = defineTool({
    name: "bc_bridge",
    label: "Browser Bridge",
    description:
      "Control the running Chrome through the companion extension bridge (chrome.debugger). " +
      "Ops: status, listTabs, attach, detach, command {domain, method, params}. " +
      "The bridge server auto-starts on first use; the companion extension must be enabled in chrome://extensions.",
    parameters: Type.Object({
      op: Type.Union([
        Type.Literal("status"),
        Type.Literal("listTabs"),
        Type.Literal("attach"),
        Type.Literal("detach"),
        Type.Literal("command"),
      ]),
      tabId: Type.Optional(Type.Number()),
      command: Type.Optional(Type.Object({
        domain: Type.String(),
        method: Type.String(),
        params: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
      })),
    }),
    async execute(_id, params) {
      if (params.op === "status") {
        const st = await bridgeStatus();
        return {
          content: [{ type: "text", text: `bridge ${st.running ? "running" : "stopped"}: ${JSON.stringify(st)}` }],
          details: st,
        };
      }
      const res = await bridgeSend({
        op: params.op,
        tabId: params.tabId,
        command: params.command,
      });
      const text = res.ok
        ? `bridge ok: ${JSON.stringify(res.result).slice(0, 2000)}`
        : `bridge failed: ${res.error}`;
      return {
        content: [{ type: "text", text }],
        details: res,
      };
    },
  });

  pi.registerTool(bridgeTool);

  pi.on("tool_call", async (event, ctx) => {
    const name = String(event.toolName ?? "");
    if (!name.startsWith("browser_")) return;
    const m = ctx.model as { id?: string; provider?: string } | undefined;
    const current = m?.id ? `${m.provider ?? "?"}/${m.id}` : null;
    if (pinnedModel && current && pinnedModel !== current) {
      return { block: true, reason: `${MARKER} model berubah di tengah jalan (${pinnedModel} -> ${current}). Ulangi dari snapshot baru agar konteks konsisten.` };
    }
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
