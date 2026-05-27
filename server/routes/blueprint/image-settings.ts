/**
 * autopilot-image-rendering-and-visual-system · Phase 4 / Task 35.1
 *
 * `GET /api/blueprint/image-settings` 路由 handler。
 *
 * 暴露 `IMAGE_GEN_*` 环境变量当前生效配置的只读快照，用于让运维 / 排障人员
 * 在 autopilot 右栏 `AutopilotImageSettingsPanel` 中快速判断「是配置缺失
 * 还是上游失败」。
 *
 * 安全约束（spec requirements §10、§7.1、§7.2）：
 *
 * - 原始 `IMAGE_GEN_API_KEY` MUST NEVER 出现在响应体里。本 handler 把
 *   `getResolvedConfig()` 读出来的 `apiKey` 真值就地用 {@link maskApiKey}
 *   脱敏成 `maskedApiKey: string | null`，原始值不写入任何 `JSON.stringify`
 *   能触达的字段。
 * - 脱敏算法与客户端 `client/src/components/autopilot/AutopilotImageSettingsPanel.tsx`
 *   中的 `maskApiKey` 严格一致（byte-for-byte）：
 *     - `apiKey === null` 或 `apiKey.length < 14` → `null`
 *     - `apiKey.length >= 14` →
 *       `apiKey.slice(0, 8) + "•".repeat(apiKey.length - 14) + apiKey.slice(-6)`，
 *       中间填充字符为 U+2022 BULLET。
 *   两侧的 14 阈值、`slice(0, 8)` 头、`slice(-6)` 尾、`•` 填充字符必须保持一致；
 *   任何一方变更时必须同步更新另一侧并补回归。
 *
 * 路由约束：
 * - 只读：handler 不触发任何 outgoing 网络调用，也不修改运行时状态。
 * - 不鉴权：与 `/api/blueprint/diagnostics` 等只读端点保持一致策略（spec
 *   不引入新的鉴权中间件）。
 * - 故障隔离：`getResolvedConfig` 是纯函数且永不抛错；handler 仍包一层
 *   try/catch 防御以保证内部异常不会以 500 崩溃影响其它路由。
 *
 * 文件路径：`server/routes/blueprint/image-settings.ts`
 *
 * @see Requirements 10.1, 10.2, 10.3
 */

import type { Request, Response } from "express";

import { getResolvedConfig } from "./effect-preview/image-api-client.js";

/**
 * Minimum length below which the raw API key is treated as "未配置" and
 * masked to `null` on the wire. Mirrors the constant
 * {@code MASKED_API_KEY_MIN_LENGTH} in
 * `client/src/components/autopilot/AutopilotImageSettingsPanel.tsx`.
 */
export const MASKED_API_KEY_MIN_LENGTH = 14;

/**
 * Single-character padding used in the masked output (U+2022 BULLET).
 * Mirrors {@code MASKED_API_KEY_FILL_CHAR} on the client.
 */
export const MASKED_API_KEY_FILL_CHAR = "\u2022";

/**
 * Compute the masked, wire-safe representation of a raw API key.
 *
 * Returns `null` when the input is `null` OR shorter than
 * {@link MASKED_API_KEY_MIN_LENGTH}; otherwise returns
 * `head(8) + "•".repeat(length - 14) + tail(6)` so the resulting string
 * has the same total length as the input but reveals only the first 8
 * and last 6 characters.
 *
 * Pure function — no side effects, no logging, no `process.env` reads.
 */
export function maskApiKey(apiKey: string | null): string | null {
  if (apiKey === null || apiKey.length < MASKED_API_KEY_MIN_LENGTH) {
    return null;
  }
  const head = apiKey.slice(0, 8);
  const tail = apiKey.slice(-6);
  const fill = MASKED_API_KEY_FILL_CHAR.repeat(
    apiKey.length - MASKED_API_KEY_MIN_LENGTH,
  );
  return head + fill + tail;
}

/**
 * Wire shape of the `GET /api/blueprint/image-settings` response.
 *
 * - `baseUrl`: `null` when `IMAGE_GEN_BASE_URL` is unset / empty after trim.
 * - `model` / `path` / `defaultSize` / `defaultAspect`: always one of the
 *   documented enum values (resolver applies defaults on invalid input).
 * - `timeoutMs`: always a positive integer.
 * - `maskedApiKey`: see {@link maskApiKey}.
 *
 * Notice that the raw `apiKey` is intentionally absent from this type —
 * the wire contract has no slot for it, so any future refactor that
 * accidentally stuffs the raw value into a different field would still
 * be caught by the sentinel-leak test (Task 35.2 case 3).
 */
export interface BlueprintImageSettingsResponse {
  readonly baseUrl: string | null;
  readonly model: string;
  readonly path: string;
  readonly defaultSize: string;
  readonly defaultAspect: string;
  readonly timeoutMs: number;
  readonly maskedApiKey: string | null;
}

/**
 * Build a `GET /api/blueprint/image-settings` Express handler.
 *
 * The handler reads {@link getResolvedConfig} on every request (pure,
 * no module-level cache) so `vi.stubEnv` style env mutations between
 * tests are picked up without any cache-reset hook.
 */
export function createImageSettingsHandler(): (
  req: Request,
  res: Response,
) => void {
  return (_req, res) => {
    try {
      const config = getResolvedConfig();
      const body: BlueprintImageSettingsResponse = {
        baseUrl: config.baseUrl,
        model: config.model,
        path: config.path,
        defaultSize: config.defaultSize,
        defaultAspect: config.defaultAspect,
        timeoutMs: config.timeoutMs,
        maskedApiKey: maskApiKey(config.apiKey),
      };
      res.status(200).json(body);
    } catch {
      res.status(500).json({ error: "image settings unavailable" });
    }
  };
}
