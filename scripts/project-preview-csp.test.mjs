/**
 * A ready runtime is unusable if the real workbench HTML blocks its iframe.
 * Exercise the Vite serve transform and an actual HTML build, including .env
 * loading, so a correct but unregistered helper cannot keep this suite green.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build, createServer } from "vite";
import {
  PROJECT_PREVIEW_ORIGIN_ENV,
  previewFrameSource,
  workbenchContentSecurityPolicy,
} from "./project-preview-csp.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const htmlFixture = '<!doctype html><html><head><meta charset="utf-8"><title>CSP fixture</title></head><body>Preview fixture</body></html>';
const policyFromHtml = html => {
  const policy = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"\s*\/?\s*>/.exec(html)?.[1];
  assert.ok(policy, "the delivered HTML must contain the workbench CSP");
  return policy;
};
const directives = policy => Object.fromEntries(policy.split(";").map(value => value.trim().split(/\s+/)).filter(([name]) => name).map(([name, ...sources]) => [name, sources]));

test("preview configuration grants only the dedicated frame suffix and preserves other policies", () => {
  const absent = directives(workbenchContentSecurityPolicy(undefined));
  const enabled = directives(workbenchContentSecurityPolicy("https://{runtimeId}.preview.whybuddy.test"));
  assert.deepEqual(absent["frame-src"], ["'self'"]);
  assert.deepEqual(enabled["frame-src"], [
    "'self'",
    "https://*.preview.whybuddy.test",
    "https://*.e2b.app",
    "https://*.e2b.dev",
  ]);
  assert.deepEqual(enabled["default-src"], ["'self'"]);
  for (const [name, sources] of Object.entries(absent)) {
    if (name !== "frame-src") assert.deepEqual(enabled[name], sources, `${name} must not expand`);
  }
  assert.ok(enabled["connect-src"].includes("https://api.openai.com"));
  assert.equal(previewFrameSource(""), undefined);
});

for (const [template, source] of [
  ["https://{runtimeId}.preview.example.com", "https://*.preview.example.com"],
  ["https://{runtimeId}.e2b.app", "https://*.e2b.app"],
  ["https://{runtimeId}.preview.example.com:443", "https://*.preview.example.com"],
  ["https://{runtimeId}.preview.example.com:8443", "https://*.preview.example.com:8443"],
  ["http://{runtimeId}.localhost:80", "http://*.localhost"],
  ["http://{runtimeId}.preview.localhost:5190", "http://*.preview.localhost:5190"],
]) {
  test(`canonical preview origin: ${template}`, () => assert.equal(previewFrameSource(template), source));
}

for (const template of [
  "https://example.com", "https://preview-{runtimeId}.example.com", "https://preview.{runtimeId}.example.com",
  "https://{runtimeId}.{runtimeId}.example.com", "https://{runtimeId}.*.example.com",
  "https://{runtimeId}.preview.example.com/", "https://{runtimeId}.preview.example.com?x=1",
  "https://{runtimeId}.preview.example.com#fragment", "https://user:password@{runtimeId}.preview.example.com",
  "HTTPS://{runtimeId}.preview.example.com", "https://{runtimeId}.Preview.example.com",
  "https://{runtimeId}.preview.example.com:", "https://{runtimeId}.preview.example.com:0443",
  "https://{runtimeId}.preview.example.com:0", "https://{runtimeId}.preview.example.com:65536",
  "https://{runtimeId}.-preview.example.com", "https://{runtimeId}.preview-.example.com",
  "https://{runtimeId}.preview..example.com", "https://{runtimeId}.preview.example.com.",
  `https://{runtimeId}.${"a".repeat(64)}.example.com`,
  `https://{runtimeId}.${Array(4).fill("a".repeat(63)).join(".")}`,
  "http://{runtimeId}.example.com", "http://{runtimeId}.localhost.example.com",
  "https://{runtimeId}.127.0.0.1", "file://{runtimeId}.preview.example.com",
  "https://{runtimeId}.preview.example.com; frame-src https:",
  'https://{runtimeId}.preview.example.com\"><script>bad</script>',
  " https://{runtimeId}.preview.example.com", "https://{runtimeId}.preview.example.com\n",
  "https://{runtimeId}.preview.example.com\\outside.invalid", null, {},
]) {
  test(`invalid preview template is rejected: ${JSON.stringify(template)}`, () => {
    assert.throws(() => previewFrameSource(template), /project_preview_origin_invalid/);
  });
}

test("actual Vite serve and production HTML build load the public origin from mode .env", async t => {
  const mode = `preview-csp-test-${process.pid}-${Date.now()}`;
  const envPath = join(root, `.env.${mode}`);
  const fixtureDirectory = await mkdtemp(join(root, "client", ".preview-csp-test-"));
  const original = process.env[PROJECT_PREVIEW_ORIGIN_ENV];
  delete process.env[PROJECT_PREVIEW_ORIGIN_ENV];
  t.after(async () => {
    if (original === undefined) delete process.env[PROJECT_PREVIEW_ORIGIN_ENV];
    else process.env[PROJECT_PREVIEW_ORIGIN_ENV] = original;
    await rm(envPath, { force: true });
    assert.ok(resolve(fixtureDirectory).startsWith(resolve(root, "client") + sep));
    await rm(fixtureDirectory, { recursive: true, force: true });
  });
  await writeFile(envPath, `${PROJECT_PREVIEW_ORIGIN_ENV}=https://{runtimeId}.preview.from-env.test\nWHYBUDDY_PROJECT_PREVIEW_GATEWAY_KEY=csp-test-secret-must-never-appear\n`);
  const config = { configFile: join(root, "vite.config.ts"), mode, logLevel: "silent" };
  const server = await createServer(config);
  let served;
  try {
    served = await server.transformIndexHtml("/index.html", htmlFixture);
  } finally {
    await server.close();
  }
  assert.deepEqual(directives(policyFromHtml(served))["frame-src"], [
    "'self'",
    "https://*.preview.from-env.test",
    "https://*.e2b.app",
    "https://*.e2b.dev",
  ]);
  assert.ok(!served.includes("csp-test-secret-must-never-appear"));

  const entry = join(fixtureDirectory, "index.html");
  await writeFile(entry, htmlFixture);
  const built = await build({ ...config, build: {
    write: false, emptyOutDir: false, outDir: join(fixtureDirectory, "output"),
    rollupOptions: { input: entry },
  } });
  const outputs = Array.isArray(built) ? built.flatMap(result => result.output) : built.output;
  const builtHtml = outputs.filter(output => output.type === "asset" && output.fileName.endsWith(".html"));
  assert.equal(builtHtml.length, 1);
  const emitted = String(builtHtml[0].source);
  assert.equal(policyFromHtml(emitted), policyFromHtml(served), "dev and production deliver the same CSP");
  assert.ok(!emitted.includes("csp-test-secret-must-never-appear"));

  process.env[PROJECT_PREVIEW_ORIGIN_ENV] = "https://{runtimeId}.preview.process-env.test:443";
  const overridden = await createServer(config);
  try {
    const delivered = await overridden.transformIndexHtml("/index.html", htmlFixture);
    assert.deepEqual(directives(policyFromHtml(delivered))["frame-src"], [
      "'self'",
      "https://*.preview.process-env.test",
      "https://*.e2b.app",
      "https://*.e2b.dev",
    ]);
  } finally {
    await overridden.close();
  }
});
