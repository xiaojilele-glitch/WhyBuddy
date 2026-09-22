/// <reference types="vitest/config" />
// jsxLocPlugin removed to avoid R3F data-loc conflicts
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from "vite";
import { vitePluginManusRuntime } from "vite-plugin-manus-runtime";
import { PROJECT_PREVIEW_ORIGIN_ENV, workbenchContentSecurityPolicy } from "./scripts/project-preview-csp.mjs";

// =============================================================================
// Manus Debug Collector - Vite Plugin
// Writes browser logs directly to files, trimmed when exceeding size limit
// =============================================================================

const PROJECT_ROOT = import.meta.dirname;
const LOG_DIR = path.join(PROJECT_ROOT, ".manus-logs");
const MAX_LOG_SIZE_BYTES = 1 * 1024 * 1024; // 1MB per log file
const TRIM_TARGET_BYTES = Math.floor(MAX_LOG_SIZE_BYTES * 0.6); // Trim to 60% to avoid constant re-trimming

type LogSource = "browserConsole" | "networkRequests" | "sessionReplay";

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function trimLogFile(logPath: string, maxSize: number) {
  try {
    if (!fs.existsSync(logPath) || fs.statSync(logPath).size <= maxSize) {
      return;
    }

    const lines = fs.readFileSync(logPath, "utf-8").split("\n");
    const keptLines: string[] = [];
    let keptBytes = 0;

    // Keep newest lines (from end) that fit within 60% of maxSize
    const targetSize = TRIM_TARGET_BYTES;
    for (let i = lines.length - 1; i >= 0; i--) {
      const lineBytes = Buffer.byteLength(`${lines[i]}\n`, "utf-8");
      if (keptBytes + lineBytes > targetSize) break;
      keptLines.unshift(lines[i]);
      keptBytes += lineBytes;
    }

    fs.writeFileSync(logPath, keptLines.join("\n"), "utf-8");
  } catch {
    /* ignore trim errors */
  }
}

function writeToLogFile(source: LogSource, entries: unknown[]) {
  if (entries.length === 0) return;

  ensureLogDir();
  const logPath = path.join(LOG_DIR, `${source}.log`);

  // Format entries with timestamps
  const lines = entries.map(entry => {
    const ts = new Date().toISOString();
    return `[${ts}] ${JSON.stringify(entry)}`;
  });

  // Append to log file
  fs.appendFileSync(logPath, `${lines.join("\n")}\n`, "utf-8");

  // Trim if exceeds max size
  trimLogFile(logPath, MAX_LOG_SIZE_BYTES);
}

/**
 * Vite plugin to collect browser debug logs
 * - POST /__manus__/logs: Browser sends logs, written directly to files
 * - Files: browserConsole.log, networkRequests.log, sessionReplay.log
 * - Auto-trimmed when exceeding 1MB (keeps newest entries)
 */
function vitePluginManusDebugCollector(): Plugin {
  return {
    name: "manus-debug-collector",
    apply: "serve",

    transformIndexHtml(html) {
      return {
        html,
        tags: [
          {
            tag: "script",
            attrs: {
              src: "/__manus__/debug-collector.js",
              defer: true,
            },
            injectTo: "head",
          },
        ],
      };
    },

    configureServer(server: ViteDevServer) {
      // POST /__manus__/logs: Browser sends logs (written directly to files)
      server.middlewares.use("/__manus__/logs", (req, res, next) => {
        if (req.method !== "POST") {
          return next();
        }

        const handlePayload = (payload: any) => {
          // Write logs directly to files
          if (payload.consoleLogs?.length > 0) {
            writeToLogFile("browserConsole", payload.consoleLogs);
          }
          if (payload.networkRequests?.length > 0) {
            writeToLogFile("networkRequests", payload.networkRequests);
          }
          if (payload.sessionEvents?.length > 0) {
            writeToLogFile("sessionReplay", payload.sessionEvents);
          }

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        };

        const reqBody = (req as { body?: unknown }).body;
        if (reqBody && typeof reqBody === "object") {
          try {
            handlePayload(reqBody);
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
          return;
        }

        let body = "";
        req.on("data", chunk => {
          body += chunk.toString();
        });

        req.on("end", () => {
          try {
            const payload = JSON.parse(body);
            handlePayload(payload);
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
        });
      });
    },
  };
}

// Python-first API 路由守卫移至 ./api-target.ts（测试/脚本可直接引，
// 不连带 vite 插件链）；此处 import + re-export：配置体内 proxy 仍在用，
// 且保持既有 `node -e`/脚本的导入路径兼容。
import { resolveApiTarget } from "./api-target";
export { resolveApiTarget };

export default defineConfig(({ mode }) => {
  const repository = process.env.GITHUB_REPOSITORY || "opencroc/sliderule";
  const repositoryName = repository.split("/")[1] || "sliderule";
  const repositoryUrl = `https://github.com/${repository}`;
  const isGitHubPagesBuild =
    process.env.GITHUB_PAGES === "true" ||
    process.env.DEPLOY_TARGET === "github-pages";

  // B5: CSP injection plugin - injects the strict connect-src policy for browser-llm zero-trust.
  // Done via transform (instead of hardcoded in index.html) to prevent Vite html-proxy / transformIndexHtml
  // module resolution errors during `vite build` for GitHub Pages static export.
  // Also applies in dev for the demo.
  // blob: 允许同文档内 createObjectURL（three.js GLTFLoader 解 GLB 内嵌贴图
  // 走 blob URL——Work 模式 3D 角色需要）；blob 只能由本页脚本创建，
  // 不放开任何外联，zero-trust 姿态不变。
  // Vite does not load .env into process.env before this callback. Read the one
  // public template in both serve/build; gateway credentials stay server-only.
  const previewEnv = loadEnv(mode, PROJECT_ROOT, PROJECT_PREVIEW_ORIGIN_ENV);
  const csp = workbenchContentSecurityPolicy(previewEnv[PROJECT_PREVIEW_ORIGIN_ENV]);
  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${csp}" />`;
  const vitePluginCspForByok = {
    name: "csp-for-byok-pages",
    transformIndexHtml(html) {
      // Avoid duplicate if somehow present
      if (html.includes("Content-Security-Policy")) return html;
      // Insert early in <head>
      return html.replace(/<head>/i, `<head>\n    ${cspMeta}`);
    },
  };

  const plugins = [
    react(),
    tailwindcss(),
    // Manus 宿主运行时会向 index.html 内联 ~358KB 脚本（含整份 React 副本）。
    // GitHub Pages 静态演示不在 Manus 宿主里运行，用不到它——排除后 HTML 从
    // ~370KB 回到 ~12KB。本地 dev / 其他构建目标保持不变。
    ...(isGitHubPagesBuild ? [] : [vitePluginManusRuntime()]),
    vitePluginManusDebugCollector(),
    vitePluginCspForByok,
  ];

  return {
    base: isGitHubPagesBuild ? `/${repositoryName}/` : "/",
    define: {
      __GITHUB_PAGES__: JSON.stringify(isGitHubPagesBuild),
      __GITHUB_REPOSITORY__: JSON.stringify(repository),
      __GITHUB_REPOSITORY_URL__: JSON.stringify(repositoryUrl),
    },
    // 测试提速：vmThreads 池在保留"每文件独立模块注册表"隔离语义的前提下
    // 共享编译缓存——本套件 collect 阶段（antd 等重依赖逐文件重载）是大头，
    // 全量 4500+ 例从 ~89s 降到 ~53s。不用 isolate:false：实测 103 例
    // 跨文件全局态污染（fetch/localStorage 模块级 stub），省的时间不值风险。
    test: {
      pool: "vmThreads",
      // antd-mobile 的 `cjs/global/index.js` 是未转译的 TS 语法，node 直接
      // require 会在第 3 行崩「Unexpected token ':'」。任何**导入完整基础组件
      // 目录**的用例都会踩到（目录 = 桌面 + 手机两档）。inline 让 vite 先转译
      // 它再交给测试，跟浏览器里走的是同一条路。
      //
      // 只列这一个包，不开 `inline: true` 全量 —— 全量会把 antd 这类大依赖
      // 也拖进转译，collect 阶段本来就是大头（见上）。
      // 走它的 ESM 产物：node 的 require 条件会挑到 `cjs/`，那份没转译干净。
      // 浏览器里 vite 本来就走 es/，这里只是让测试跟浏览器同路。
      alias: {
        "antd-mobile": path.resolve(
          import.meta.dirname,
          "node_modules/antd-mobile/es/index.js"
        ),
      },
    },
    plugins,
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "client", "src"),
        "@shared": path.resolve(import.meta.dirname, "shared"),
        // E40.1 合法域单一真相源：客户端与 python 门/修复器/生成契约同读一份账本
        "@legal": path.resolve(
          import.meta.dirname,
          "slide-rule-python/services/data/five_system_legal.json"
        ),
        // 体验区块目录：Gate/Repair/Prompt/前端 Registry 共用，不在 TS 手抄区块清单
        "@experience-blocks": path.resolve(
          import.meta.dirname,
          "slide-rule-python/services/data/experience_block_catalog.json"
        ),
        // 意图词表：与 services/block_narrowing.py 共用同一份（见该 JSON 的 _note）
        "@block-intent-lexicon": path.resolve(
          import.meta.dirname,
          "slide-rule-python/services/data/block_intent_lexicon.json"
        ),
        // 身份主题预设 + 生成主题契约：前端 THEMES 与 Python 色板提示/使用判定同读一份
        "@identity-themes": path.resolve(
          import.meta.dirname,
          "slide-rule-python/services/data/identity_theme_presets.json"
        ),
        // 产品原型账本：「什么算闭环」的单一真相源。前端 skills 的六系统清单
        // 由 parity 判据锁在这份账本上（第四条：同一件事的第二处）。
        "@archetypes": path.resolve(
          import.meta.dirname,
          "slide-rule-python/services/data/product_archetypes.json"
        ),
        "@design-systems": path.resolve(
          import.meta.dirname,
          "slide-rule-python/services/data/design_systems.json"
        ),
        "@assets": path.resolve(import.meta.dirname, "attached_assets"),
      },
    },
    envDir: path.resolve(import.meta.dirname),
    root: path.resolve(import.meta.dirname, "client"),
    build: {
      outDir: path.resolve(import.meta.dirname, "dist/public"),
      emptyOutDir: true,
      // 构建入口默认只有 client/index.html（隐式）——三个 dev-only 台子
      // （block-gallery / wall-fixture / app-wall-perf）都靠这一点不进生产产物。
      //
      // SLIDERULE_PERF_HARNESS=1 时额外把作品墙压测台打进来。为什么需要：dev
      // 模式的数比生产偏慢（不压缩 / 模块逐个请求 / React 开发构建带额外校验），
      // 拿它去定版式密度会把设计稿冤枉掉；要拿到生产口径的数，压测台必须**也
      // 走一遍真实构建**。这个开关默认关，`npm run build` 的产物不受影响。
      ...(process.env.SLIDERULE_PERF_HARNESS === "1"
        ? {
            rollupOptions: {
              input: {
                index: path.resolve(import.meta.dirname, "client/index.html"),
                "app-wall-perf": path.resolve(
                  import.meta.dirname,
                  "client/app-wall-perf.html"
                ),
              },
            },
          }
        : {}),
    },
    // vite preview 只是个本地静态服务器（生产走 scripts/start-prod.mjs），
    // 但它默认**不带 server.proxy**——压测台要 fetch /api/sliderule 拿真实
    // 模型，不转发就只能看到一个"一个可运行模型都没拿到"的空态。
    preview: {
      port: 4173,
      strictPort: false,
      proxy: {
        "/api/sliderule": {
          target: resolveApiTarget("/api/sliderule"),
          changeOrigin: true,
        },
      },
    },
    server: {
      port: 3000,
      strictPort: false, // Will find next available port if 3000 is busy
      host: true,
      allowedHosts: [
        ".manuspre.computer",
        ".manus.computer",
        ".manus-asia.computer",
        ".manuscomputer.ai",
        ".manusvm.computer",
        "localhost",
        "127.0.0.1",
      ],
      fs: {
        strict: true,
        deny: ["**/.*"],
      },
      proxy: {
        // Python-first default cutover (105): Vite dev routing now prefers Python backend APIs for owned surfaces.
        // Dedicated entries ensure /api/health, /health, /ready, /api/agent-loop etc target Python via resolve.
        // Unlisted /api/* fall to Node (explicit thin proxy/compat shell only). PYTHON_FIRST env controls listed.
        "/api/agent-loop": {
          target: resolveApiTarget("/api/agent-loop"),
          changeOrigin: true,
        },
        "/api/sliderule": {
          target: resolveApiTarget("/api/sliderule"),
          changeOrigin: true,
        },
        "/api/blueprint/spec-documents": {
          target: resolveApiTarget("/api/blueprint/spec-documents"),
          changeOrigin: true,
        },
        "/api/health": {
          target: resolveApiTarget("/api/health"),
          changeOrigin: true,
        },
        "/health": {
          target: resolveApiTarget("/health"),
          changeOrigin: true,
        },
        "/ready": {
          target: resolveApiTarget("/ready"),
          changeOrigin: true,
        },
        "/api": {
          target: resolveApiTarget("/api"),
          changeOrigin: true,
        },
        "/socket.io": {
          target: "http://localhost:3001",
          ws: true,
          changeOrigin: true,
        },
      },
    },
  };
});
