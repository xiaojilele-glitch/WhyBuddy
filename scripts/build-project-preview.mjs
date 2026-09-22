import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createRequire } from "node:module";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const output = join(root, "dist/project-preview");
await mkdir(output, { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: { gateway: "server/project-preview/main.ts", agent: "server/project-preview/agent-main.ts" },
  outdir: output, outExtension: { ".js": ".cjs" }, bundle: true, platform: "node", format: "cjs",
  target: "node22", external: ["bufferutil", "utf-8-validate"],
  banner: { js: "process.env.WS_NO_BUFFER_UTIL='1';process.env.WS_NO_UTF_8_VALIDATE='1';" },
});
await copyFile(join(require.resolve("ws/package.json"), "../LICENSE"), join(output, "ws-LICENSE.txt"));
console.log("Built isolated project preview gateway and tunnel agent in dist/project-preview");
