/** Dedicated origin/process entrypoint, deliberately not mounted on the main app. */
import { createPreviewService } from "./service";

const authorityUrl = process.env.WHYBUDDY_PROJECT_PREVIEW_AUTHORITY_URL ?? "";
const gatewayKey = process.env.WHYBUDDY_PROJECT_PREVIEW_GATEWAY_KEY ?? "";
const port = Number(process.env.WHYBUDDY_PROJECT_PREVIEW_PORT ?? "3002");
const protocol = process.env.WHYBUDDY_PROJECT_PREVIEW_PUBLIC_PROTOCOL ?? "https:";
if (!Number.isInteger(port) || port < 1024 || port > 65535 || !["http:", "https:"].includes(protocol)) {
  throw new Error("preview_service_config_invalid");
}
const relay = createPreviewService({ authorityUrl, gatewayKey, publicProtocol: protocol as "http:" | "https:",
  workbenchOrigin: process.env.WHYBUDDY_PROJECT_WORKBENCH_ORIGIN });
relay.server.listen(port, "0.0.0.0", () => console.log(`Project preview service listening on ${port}`));
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await relay.close();
}
process.once("SIGINT", () => { void close(); });
process.once("SIGTERM", () => { void close(); });
