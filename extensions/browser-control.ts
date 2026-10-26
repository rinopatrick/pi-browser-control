/**
 * pi-browser-control — Codex-style browser control for Pi.
 *
 * CDP engine: pi-browser-harness (dependency, credited in README).
 * This layer: per-site policy guard, bc-view command (live view),
 * bc-policy command (show effective policy).
 */

import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { checkPermission, loadConfig, requiresConfirmation, type PolicyConfig } from "../lib/policy.mjs";

const MARKER = "pi-browser-control:";

export default function browserControl(pi: ExtensionAPI) {
  let config: PolicyConfig = loadConfig();
  let pinnedModel: string | null = null;

  pi.on("before_agent_start", async (_event, ctx) => {
    const m = ctx.model as { id?: string; provider?: string } | undefined;
    pinnedModel = m?.id ? `${m.provider ?? "?"}/${m.id}` : null;
  });

  pi.registerCommand("bc-view", {
    description: "[pi-browser-control] Read-only live view of the agent tab so the user can watch",
    handler: async (_args: string) => {
      pi.sendUserMessage(
        "Call the harness browser_snapshot tool with includeScreenshot=true, then briefly show what is visible in the agent tab.",
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

  pi.on("tool_call", async (event, ctx) => {
    const name = String(event.toolName ?? "");
    if (!name.startsWith("browser_")) return;
    const m = ctx.model as { id?: string; provider?: string } | undefined;
    const current = m?.id ? `${m.provider ?? "?"}/${m.id}` : null;
    if (pinnedModel && current && pinnedModel !== current) {
      return { block: true, reason: `${MARKER} model changed mid-run (${pinnedModel} -> ${current}). Restart from a fresh snapshot to keep context consistent.` };
    }
    const url = typeof event.input?.url === "string" ? event.input.url : undefined;
    if (url) {
      const verdict = checkPermission(url, config);
      if (!verdict.allowed) return { block: true, reason: `${MARKER} ${verdict.reason}` };
    }
    if (requiresConfirmation(name, config)) {
      if (!ctx.hasUI) return { block: true, reason: `${MARKER} ${name} needs user confirmation (no UI, blocked)` };
      const ok = await ctx.ui.confirm(`Run ${name}?`, name);
      if (!ok) return { block: true, reason: `${MARKER} user rejected ${name}` };
    }
  });
}
