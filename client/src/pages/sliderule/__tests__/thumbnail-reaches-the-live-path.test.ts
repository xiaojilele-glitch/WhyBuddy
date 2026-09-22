/**
 * 缩略图接在真跑的那条链路上（CLAUDE.md §1 / §3）。
 *
 * §3「闸全绿但东西没了」在这一块的具体形态：
 *   `useProjectThumbnail` 单测全绿、`resultCardModel` 单测全绿，
 *   而取到的地址在 SlideRule → ClaudeChatSurface → TurnResultCard
 *   这一路上**断在任何一节**，缩略图都永远是 null——不报错、不告警。
 *
 * 所以这里钉的不是函数对不对，是**传参真的一路传到了底**。
 * 判据扫的是剥掉注释的源码：注释里写这些名字不算数（§2 踩过）。
 *
 * ⚠ 2026-09-14 第二版：取数从卡片里提到了页面上。原因是结果卡**每轮一张**，
 *   卡片自己取就等于同一个工程的 /verification 被重复 GET N 次。所以现在
 *   钉的是「页面只调一次 hook」+「只有最新那一轮拿得到图」。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const read = (relative: string) =>
  stripComments(readFileSync(resolve(__dirname, relative), "utf8"));

const PAGE = read("../../SlideRule.tsx");
const CARD = read("../TurnResultCard.tsx");

/**
 * 取某个 JSX 元素**自己那段开标签**。
 *
 * ⚠ 2026-09-14 第一版判据是「整页里 match 得到 projectId={sessionState.projectId}」，
 *   变异测试当场打脸：把 ClaudeChatSurface 那一节的 projectId 删掉，判据**照样绿**——
 *   因为同一页的 <SlideRuleStudio 上也有一个同样的字面量。这正是 §2 那条
 *   「判据没被变异咬住就是没用」。所以必须按调用点切。
 */
function openingTag(source: string, tag: string): string {
  const start = source.indexOf(`<${tag}`);
  expect(start, `${tag} 的调用点必须在`).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (ch === ">" && depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`${tag} 的开标签没闭合`);
}

describe("验收截图一路传到结果卡", () => {
  it("SlideRule 把会话里的 projectId 交给聊天面（钉在 ClaudeChatSurface 那一节）", () => {
    expect(openingTag(PAGE, "ClaudeChatSurface")).toMatch(
      /projectId=\{sessionState\.projectId\}/
    );
  });

  it("页面只调一次 hook，卡片自己不取数", () => {
    expect(PAGE.match(/useProjectThumbnail\(/g) ?? []).toHaveLength(1);
    // ⚠ 反向：这条就是那 N 次重复 GET。卡片里再出现一次 hook 就红。
    expect(CARD).not.toMatch(/useProjectThumbnail/);
  });

  it("取到的地址进了 context，再从 context 交给结果卡", () => {
    expect(PAGE).toMatch(/thumbnailUrl:\s*verifiedThumbnail/);
    expect(openingTag(PAGE, "TurnResultCard")).toMatch(/thumbnailUrl=\{/);
  });

  it("只挂在最新那一轮：老卡片配一张今天的截图是错的", () => {
    const call = openingTag(PAGE, "TurnResultCard");
    expect(call).toMatch(/turn\.id\s*===\s*ctx\.latestTurnId/);
  });

  it("结果卡把 thumbnailUrl 喂进了 resultCardModel（收了不用等于没收）", () => {
    const start = CARD.indexOf("resultCardModel(");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(CARD.slice(start, start + 400)).toMatch(/^\s*thumbnailUrl,\s*$/m);
  });

  it("只在工程档取缩略图：HTML 推演档没有验收产物，不该白发一次请求", () => {
    const start = PAGE.indexOf("useProjectThumbnail(");
    const call = PAGE.slice(start, PAGE.indexOf(")", start) + 1);
    expect(call).toMatch(/runtimeKind\s*===\s*"project"/);
  });

  it("反向：拿不到缩略图整块不画，不许挂占位图", () => {
    const start = CARD.indexOf("data-testid=\"turn-result-thumb\"");
    expect(start).toBeGreaterThanOrEqual(0);
    const block = CARD.slice(Math.max(0, start - 400), start);
    expect(block).toMatch(/model\.thumbnailUrl\s*\?/);
    // 占位图的两种常见凑法，一种都不许有。
    expect(CARD).not.toMatch(/placeholder\.(png|svg|jpg)/i);
    expect(CARD).not.toMatch(/src=\{model\.thumbnailUrl\s*\|\|/);
  });
});
