/**
 * 2026-09-13: the real Studio rendered a ready E2B preview, but its iframe never
 * requested a ticket: the workbench CSP fell back to default-src 'self'. Keep
 * that policy for other resources and authorize only the configured preview
 * hostname suffix for frames. This is the public origin template used by the
 * Python authority, never the gateway credential or an iframe-supplied URL.
 *
 * CSP cannot express exactly one wildcard DNS label. The dedicated preview
 * suffix limits this transport permission; the API, ticket and gateway still
 * authorize the exact runtime, source revision and account on every request.
 */

export const PROJECT_PREVIEW_ORIGIN_ENV = "WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE";

/** @param {string | undefined} template */
export function previewFrameSource(template) {
  if (template === undefined || template === "") return undefined;
  if (typeof template !== "string") throw new Error("project_preview_origin_invalid");

  // Validate the unparsed spelling first: WHATWG URLs silently normalize case,
  // whitespace, leading-zero ports and backslashes which the authority rejects.
  const parsed = /^(https?):\/\/\{runtimeId\}\.([a-z0-9.-]+)(?::([1-9][0-9]{0,4}))?$/.exec(template);
  if (!parsed) throw new Error("project_preview_origin_invalid");
  const [, scheme, suffix, portText] = parsed;
  const labels = suffix.split(".");
  if (labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
      || `rt-configuration-probe.${suffix}`.length > 253
      || (portText !== undefined && Number(portText) > 65535)
      || (scheme === "http" && suffix !== "localhost" && !suffix.endsWith(".localhost"))) {
    throw new Error("project_preview_origin_invalid");
  }

  // Browser URL.origin and the authority both omit :443/:80 for their scheme.
  let port;
  try {
    port = new URL(template.replace("{runtimeId}", "rt-configuration-probe")).port;
  } catch {
    throw new Error("project_preview_origin_invalid");
  }
  return `${scheme}://*.${suffix}${port ? `:${port}` : ""}`;
}

/** @param {string | undefined} previewOriginTemplate */
export function workbenchContentSecurityPolicy(previewOriginTemplate) {
  const preview = previewFrameSource(previewOriginTemplate);
  // Internal fallback iframes E2B's published host (sandbox.get_host).
  // Only added when the dedicated preview suffix is already configured.
  const published = preview ? " https://*.e2b.app https://*.e2b.dev" : "";
  return `default-src 'self'; frame-src 'self'${preview ? ` ${preview}` : ""}${published}; connect-src 'self' blob: https://api.openai.com https://api.deepseek.com https://openrouter.ai https://api.anthropic.com https://api.groq.com data:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:;`;
}
