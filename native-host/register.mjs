// Register the Native Messaging host manifest for Chrome (Windows).
//
// Writes:
//   HKCU\Software\Google\Chrome\NativeMessagingHosts\com.pi_browser_control.host
//     (default) = <this-dir>\host-manifest.json
//
// Run once (admin NOT needed, HKCU):  node register.mjs

import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const hostPath = join(dir, "native-host.mjs").replace(/\\/g, "\\\\");
const manifestPath = join(dir, "host-manifest.json");

const manifest = {
  name: "com.pi_browser_control.host",
  description: "pi-browser-control native host: Chrome debugger bridge to Pi",
  // NOTE: Chrome ignores the "args" field of native host manifests.
  // Keep the launcher .bat as the entry point, never node.exe directly.
  path: join(dir, "native-host.bat"),
  type: "stdio",
  allowed_origins: ["chrome-extension://oinpiamkgncpoekibkgjgobpfeijopcg/"],
};

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log("wrote " + manifestPath);

const key = "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.pi_browser_control.host";
try {
  execSync(`reg add "${key}" /ve /d "${manifestPath}" /f`, { stdio: "inherit" });
  console.log("registered with extension id pinned. Reload the extension in chrome://extensions.");
} catch (e) {
  console.error("reg add failed — run in a normal Windows shell, not sandboxed.");
  process.exitCode = 1;
}
