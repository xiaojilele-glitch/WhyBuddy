/**
 * autopilot-image-rendering-and-visual-system · Phase 4 / Task 35.2
 *
 * Server route test for `GET /api/blueprint/image-settings`.
 *
 * 这个 spec 路由暴露 `IMAGE_GEN_*` 环境变量的只读快照（脱敏后），三条核心断言：
 *
 * 1. **Configured key (length ≥ 14)** — 设置长度 ≥ 14 的 sentinel API key，
 *    断言 `body.maskedApiKey` 形状严格等于 `head(8) + repeated "•" + tail(6)`，
 *    总长度等于原始 key 长度，头 8 / 尾 6 字符与原始 key 一致，中间填充
 *    全部为 U+2022 BULLET。同时断言 `baseUrl` / `model` / `path` /
 *    `defaultSize` / `defaultAspect` / `timeoutMs` 字段类型与 default
 *    生效情况下的取值。
 *
 * 2. **Missing key** — 把 `IMAGE_GEN_API_KEY` stub 成空串（语义上等同 unset），
 *    断言 `body.maskedApiKey === null`，其它配置字段仍按 default / 显式值
 *    populate。
 *
 * 3. **Sentinel leak check** — 设置一个独特的 sentinel 字面量
 *    `"SENTINEL-LEAK-DETECT-NEVER-EXPOSE"` 进 `IMAGE_GEN_API_KEY`，
 *    在响应体的 `JSON.stringify` 字符串表示中断言该 sentinel 不出现。
 *    捕捉任何意外把原始 key 通过 error 字段、调试字段或未来代码改动
 *    泄漏到响应体的回归。
 *
 * 实现细节：
 * - 使用 `vi.stubEnv` 注入环境变量；`getResolvedConfig` 在 handler 内每次
 *   请求都重新读 `process.env`，无模块级缓存，所以 stub 立即生效，无需
 *   reset hook。`vi.unstubAllEnvs()` 在每个 case 收尾时还原。
 * - 使用与 `server/tests/blueprint-routes.test.ts` 一致的 express + http
 *   监听 + `fetch` baseUrl 模式（避免引入 supertest 这一未经使用的依赖）。
 *
 * 文件路径：`server/routes/__tests__/blueprint-image-settings.test.ts`
 *
 * @see Requirements 10.1, 10.2, 10.3
 */

import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createBlueprintRouter } from "../blueprint.js";

const ROUTE_PATH = "/api/blueprint/image-settings";
const MASK_CHAR = "\u2022";
const HEAD_LEN = 8;
const TAIL_LEN = 6;
const MIN_LEN = 14;

async function withServer(
  handler: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use("/api/blueprint", createBlueprintRouter());

  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await handler(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

interface ImageSettingsBody {
  baseUrl: string | null;
  model: string;
  path: string;
  defaultSize: string;
  defaultAspect: string;
  timeoutMs: number;
  maskedApiKey: string | null;
}

describe("GET /api/blueprint/image-settings", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns a properly-shaped masked API key when IMAGE_GEN_API_KEY length >= 14", async () => {
    // sentinel API key, length 37 (well above the 14-char threshold).
    const sentinelKey = "sk-test-sentinel-AAA-1234567890ABCDEF";
    expect(sentinelKey.length).toBeGreaterThanOrEqual(MIN_LEN);

    vi.stubEnv("IMAGE_GEN_API_KEY", sentinelKey);
    vi.stubEnv("IMAGE_GEN_BASE_URL", "https://image-proxy.example.com");
    // Leave model / path / size / aspect / timeout unset so defaults apply.
    vi.stubEnv("IMAGE_GEN_MODEL", "");
    vi.stubEnv("IMAGE_GEN_PATH", "");
    vi.stubEnv("IMAGE_GEN_DEFAULT_SIZE", "");
    vi.stubEnv("IMAGE_GEN_DEFAULT_ASPECT", "");
    vi.stubEnv("IMAGE_GEN_TIMEOUT_MS", "");
    // Make sure no master kill switch is set; this test only asserts the
    // SHAPE of the response, not whether image generation is enabled.
    vi.stubEnv("IMAGE_GEN_DISABLED", "");
    vi.stubEnv("AUTOPILOT_REAL_RUNTIME", "");

    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}${ROUTE_PATH}`);
      expect(response.status).toBe(200);

      const body = (await response.json()) as ImageSettingsBody;

      // Config field shape assertions.
      expect(body.baseUrl).toBe("https://image-proxy.example.com");
      expect(typeof body.model).toBe("string");
      expect(body.model.length).toBeGreaterThan(0);
      expect(typeof body.path).toBe("string");
      expect(body.path.startsWith("/")).toBe(true);
      expect(typeof body.defaultSize).toBe("string");
      expect(body.defaultSize.length).toBeGreaterThan(0);
      expect(typeof body.defaultAspect).toBe("string");
      expect(body.defaultAspect.length).toBeGreaterThan(0);
      expect(typeof body.timeoutMs).toBe("number");
      expect(Number.isInteger(body.timeoutMs)).toBe(true);
      expect(body.timeoutMs).toBeGreaterThan(0);

      // Masked API key shape assertions.
      expect(typeof body.maskedApiKey).toBe("string");
      const masked = body.maskedApiKey as string;
      expect(masked.length).toBe(sentinelKey.length);
      expect(masked.slice(0, HEAD_LEN)).toBe(sentinelKey.slice(0, HEAD_LEN));
      expect(masked.slice(-TAIL_LEN)).toBe(sentinelKey.slice(-TAIL_LEN));
      const middle = masked.slice(HEAD_LEN, masked.length - TAIL_LEN);
      expect(middle.length).toBe(sentinelKey.length - MIN_LEN);
      expect(middle).toBe(MASK_CHAR.repeat(middle.length));
      // Defensive: every middle char must be the bullet sentinel.
      for (const ch of middle) {
        expect(ch).toBe(MASK_CHAR);
      }
    });
  });

  it("returns maskedApiKey: null when IMAGE_GEN_API_KEY is unset / empty", async () => {
    // Empty string after trim is treated identically to "unset" by
    // `getResolvedConfig`, which produces `apiKey: null`, which the handler
    // surfaces as `maskedApiKey: null`.
    vi.stubEnv("IMAGE_GEN_API_KEY", "");
    vi.stubEnv("IMAGE_GEN_BASE_URL", "https://image-proxy.example.com");
    vi.stubEnv("IMAGE_GEN_DISABLED", "");
    vi.stubEnv("AUTOPILOT_REAL_RUNTIME", "");

    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}${ROUTE_PATH}`);
      expect(response.status).toBe(200);

      const body = (await response.json()) as ImageSettingsBody;
      expect(body.maskedApiKey).toBeNull();

      // The other config fields should still populate from defaults.
      expect(typeof body.model).toBe("string");
      expect(body.model.length).toBeGreaterThan(0);
      expect(typeof body.path).toBe("string");
      expect(body.path.startsWith("/")).toBe(true);
      expect(typeof body.defaultSize).toBe("string");
      expect(typeof body.defaultAspect).toBe("string");
      expect(typeof body.timeoutMs).toBe("number");
      expect(body.timeoutMs).toBeGreaterThan(0);
    });
  });

  it("never leaks the raw IMAGE_GEN_API_KEY value in the response body", async () => {
    // Use a unique, easily-grepped sentinel string. If any future refactor
    // accidentally surfaces the raw key (e.g. in an error field, debug
    // output, or unmasked echo), this assertion fails immediately.
    const leakSentinel = "SENTINEL-LEAK-DETECT-NEVER-EXPOSE";
    expect(leakSentinel.length).toBeGreaterThanOrEqual(MIN_LEN);

    vi.stubEnv("IMAGE_GEN_API_KEY", leakSentinel);
    vi.stubEnv("IMAGE_GEN_BASE_URL", "https://image-proxy.example.com");
    vi.stubEnv("IMAGE_GEN_DISABLED", "");
    vi.stubEnv("AUTOPILOT_REAL_RUNTIME", "");

    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}${ROUTE_PATH}`);
      expect(response.status).toBe(200);

      // Read both the parsed body and the raw response text. The raw text
      // path catches leaks via fields the parsed-typed view above might
      // not enumerate (e.g. unknown debug fields, error messages, etc.).
      const text = await response.text();
      const body = JSON.parse(text) as ImageSettingsBody;

      expect(text.includes(leakSentinel)).toBe(false);
      expect(JSON.stringify(body).includes(leakSentinel)).toBe(false);

      // Sanity: the masked variant SHOULD be present (head + tail with
      // bullet padding); this confirms the route is actually observing
      // the stubbed env, not silently skipping the field.
      expect(body.maskedApiKey).not.toBeNull();
      const masked = body.maskedApiKey as string;
      expect(masked.length).toBe(leakSentinel.length);
      expect(masked.slice(0, HEAD_LEN)).toBe(leakSentinel.slice(0, HEAD_LEN));
      expect(masked.slice(-TAIL_LEN)).toBe(leakSentinel.slice(-TAIL_LEN));
    });
  });
});
