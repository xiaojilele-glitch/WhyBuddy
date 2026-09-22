/** Installed by the runtime owner outside the generated project's served root. */
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { startPreviewTunnelAgent } from "./tunnel-agent";

async function main() {
  const config = JSON.parse(readFileSync(process.argv[2], "utf8"));
  if (!Number.isFinite(config.expiresAt) || config.expiresAt <= Date.now() ||
      config.expiresAt > Date.now() + 901000) throw new Error("preview_agent_config_invalid");
  let stopping = false;
  let active: Awaited<ReturnType<typeof startPreviewTunnelAgent>> | undefined;
  const stop = () => { stopping = true; active?.close(); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  let retry = 250;
  while (!stopping && Date.now() < config.expiresAt) {
    try {
      active = await startPreviewTunnelAgent({ relayOrigin: config.relayOrigin,
        token: config.token, localPort: config.localPort });
      if (stopping) { active.close(); break; }
      retry = 250;
      while (!stopping && !active.closed && Date.now() < config.expiresAt) await delay(250);
      active.close();
    } catch { /* Never log credentials, URLs, provider responses or generated content. */ }
    if (stopping) break;
    await delay(Math.min(retry, Math.max(0, config.expiresAt - Date.now())));
    retry = Math.min(5000, retry * 2);
  }
  active?.close();
}
main().catch(() => { console.error("preview_tunnel_agent_failed"); process.exitCode = 1; });
