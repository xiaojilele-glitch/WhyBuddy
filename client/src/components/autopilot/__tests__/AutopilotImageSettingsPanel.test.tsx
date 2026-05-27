/**
 * autopilot-image-rendering-and-visual-system · Phase 1 / Task 12.8
 *
 * Feature: autopilot-image-rendering-and-visual-system
 * Property 9: Masked API key display correctness
 * Validates: Requirements 10.2, 10.3
 *
 * 实现口径（与本仓库现有 React 组件 / property 测试一致）：
 *
 *   本仓库 *未* 集成 `@testing-library/react`、`jsdom` 或 `happy-dom`；
 *   现有 React 组件 PBT（例如 `client/src/components/tasks/__tests__/RouteCard.test.tsx`）
 *   走 `renderToStaticMarkup` SSR 路径，使用稳定的 `data-testid` / `data-role`
 *   anchor 在产物 HTML 上做断言。本测试沿用同一惯例：
 *     - 渲染：`renderToStaticMarkup(<AutopilotImageSettingsPanel … />)`
 *     - 取值：通过 `data-testid="masked-api-key"` 与 `data-testid="retry-button"`
 *       小型字符串 helper 提取目标元素文本与 disabled 状态。
 *
 * 实现契约（来自 `AutopilotImageSettingsPanel.tsx`）：
 *
 *   - `settings.apiKey` 是 **未脱敏** 的真值（`null` 表示未配置），脱敏在组件
 *     内部完成。`apiKey.length >= 14` 时渲染
 *     `slice(0,8) + "•".repeat(length - 14) + slice(-6)`；否则渲染字面量
 *     `"未配置"` 并禁用「重试」按钮。
 *   - 颜色取色与本测试无关，因此只覆盖文本与禁用语义。
 *
 *   因此本测试 *不* 修改实现，也不 patch `resolveToken` / `visualTokens`。
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import * as fc from "fast-check";

import {
  AutopilotImageSettingsPanel,
  MASKED_API_KEY_FILL_CHAR,
  MASKED_API_KEY_MIN_LENGTH,
  UNCONFIGURED_API_KEY_TEXT,
  type ImageSettingsViewModel,
} from "../AutopilotImageSettingsPanel";

// ─── Render helpers ─────────────────────────────────────────────────────────

function makeSettings(
  overrides?: Partial<ImageSettingsViewModel>,
): ImageSettingsViewModel {
  return {
    baseUrl: "https://image-proxy.example.com",
    model: "gpt-image-2",
    path: "/v1/images/generations",
    defaultSize: "1K",
    defaultAspect: "1:1",
    timeoutMs: 60000,
    apiKey: null,
    ...overrides,
  };
}

function renderPanel(
  settings: ImageSettingsViewModel,
  theme: "light" | "dark" = "light",
): string {
  return renderToStaticMarkup(
    <AutopilotImageSettingsPanel settings={settings} theme={theme} />,
  );
}

// ─── HTML extraction helpers ────────────────────────────────────────────────

/**
 * Extract the inner text of the (assumed-leaf) element identified by
 * `data-testid`. Anchors on the literal marker, walks back to the open tag,
 * forward to its closing `>`, then slices up to `</tagName>`.
 */
function extractTestIdInner(
  html: string,
  testId: string,
  tagName: string,
): string {
  const marker = `data-testid="${testId}"`;
  const markerIdx = html.indexOf(marker);
  expect(
    markerIdx,
    `data-testid=${testId} not found in html`,
  ).toBeGreaterThanOrEqual(0);

  const tagStart = html.lastIndexOf(`<${tagName}`, markerIdx);
  expect(
    tagStart,
    `<${tagName}> open tag not found before testid=${testId}`,
  ).toBeGreaterThanOrEqual(0);

  const tagEnd = html.indexOf(">", markerIdx);
  expect(
    tagEnd,
    `closing > of ${tagName} not found`,
  ).toBeGreaterThanOrEqual(0);

  const closeTag = `</${tagName}>`;
  const closeIdx = html.indexOf(closeTag, tagEnd);
  expect(
    closeIdx,
    `</${tagName}> not found after testid=${testId}`,
  ).toBeGreaterThanOrEqual(0);

  return html.slice(tagEnd + 1, closeIdx);
}

function getRetryButtonOpenTag(html: string): string {
  const marker = `data-testid="retry-button"`;
  const markerIdx = html.indexOf(marker);
  expect(markerIdx, "retry-button testid not found").toBeGreaterThanOrEqual(0);
  const tagStart = html.lastIndexOf("<button", markerIdx);
  const tagEnd = html.indexOf(">", markerIdx);
  return html.slice(tagStart, tagEnd + 1);
}

/**
 * React SSR normalizes a `true` boolean prop to either `disabled=""` or
 * just bare `disabled` followed by whitespace / `>`. Match both forms.
 */
function isRetryButtonDisabled(html: string): boolean {
  const open = getRetryButtonOpenTag(html);
  return /\sdisabled(?:=""|(?=[\s>]))/.test(open);
}

// ─── fast-check generators ──────────────────────────────────────────────────

/**
 * HTML-safe API key alphabet. We avoid `<`, `>`, `&`, `"`, `'` because SSR
 * would entity-encode them in the rendered span text and break a byte-equal
 * comparison against `apiKey.slice(...)`. Real-world API keys are
 * alphanumeric / urlsafe anyway, so this is faithful to the property under
 * test (the masking shape, not the encoding pipeline).
 */
const SAFE_API_KEY_ALPHABET = (
  "abcdefghijklmnopqrstuvwxyz" +
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ" +
  "0123456789" +
  "-_=.+/~"
).split("");

const safeApiKeyChar = fc.constantFrom(...SAFE_API_KEY_ALPHABET);

/** length >= 14 with a generous upper bound to exercise non-trivial mask widths. */
const longApiKeyArb = fc
  .array(safeApiKeyChar, { minLength: MASKED_API_KEY_MIN_LENGTH, maxLength: 80 })
  .map((chars) => chars.join(""));

// ─── Tests ──────────────────────────────────────────────────────────────────

describe(
  "Feature: autopilot-image-rendering-and-visual-system, " +
    "Property 9: Masked API key display correctness",
  () => {
    describe("apiKey.length >= 14 (property)", () => {
      it(
        "renders apiKey.slice(0,8) + repeated U+2022 + apiKey.slice(-6) " +
          "and enables the retry button",
        () => {
          fc.assert(
            fc.property(longApiKeyArb, (apiKey) => {
              const html = renderPanel(makeSettings({ apiKey }));
              const rendered = extractTestIdInner(
                html,
                "masked-api-key",
                "span",
              );

              // overall length matches the input
              expect(rendered.length).toBe(apiKey.length);

              // head: first 8 characters identical to apiKey.slice(0, 8)
              expect(rendered.slice(0, 8)).toBe(apiKey.slice(0, 8));

              // tail: last 6 characters identical to apiKey.slice(-6)
              expect(rendered.slice(-6)).toBe(apiKey.slice(-6));

              // middle: rendered.length - 14 characters, all the single mask char
              const middle = rendered.slice(8, rendered.length - 6);
              expect(middle.length).toBe(
                apiKey.length - MASKED_API_KEY_MIN_LENGTH,
              );
              if (middle.length > 0) {
                const uniqueChars = new Set(middle.split(""));
                expect(uniqueChars.size).toBe(1);
                expect([...uniqueChars][0]).toBe(MASKED_API_KEY_FILL_CHAR);
              }

              // retry button stays enabled when key is configured
              expect(isRetryButtonDisabled(html)).toBe(false);
            }),
            { numRuns: 100 },
          );
        },
      );
    });

    describe("apiKey.length < 14 or apiKey === null (examples)", () => {
      const cases: ReadonlyArray<{
        readonly name: string;
        readonly apiKey: string | null;
      }> = [
        { name: "null", apiKey: null },
        { name: 'empty string ""', apiKey: "" },
        { name: 'short string "short" (length 5)', apiKey: "short" },
        {
          name: "boundary length 13 (one shy of threshold)",
          apiKey: "1234567890123",
        },
      ];

      for (const { name, apiKey } of cases) {
        it(`renders 「${UNCONFIGURED_API_KEY_TEXT}」and disables retry for ${name}`, () => {
          const html = renderPanel(makeSettings({ apiKey }));
          const rendered = extractTestIdInner(html, "masked-api-key", "span");
          expect(rendered).toBe(UNCONFIGURED_API_KEY_TEXT);
          expect(isRetryButtonDisabled(html)).toBe(true);
        });
      }
    });
  },
);
