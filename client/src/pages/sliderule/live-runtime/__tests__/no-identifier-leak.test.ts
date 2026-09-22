/**
 * 内部标识符不许漏到终端用户界面（2026-08-11）。
 *
 * ## 线上截图逮到的两处
 *
 *     业务页头挂着蓝标签   student:read   pet:read   redemption:create
 *     流程步骤条底下写着   music_member   collection_curator
 *
 * 生成出来的应用是交付给**业务用户**的（老师看加分记录、学生兑奖品）。权限码和
 * 角色 id 是我们内部的命名，对他们没有意义，还把权限体系的命名暴露了出去。
 *
 * ## 判据分两条，因为泄漏有两种形状
 *
 * ① **权限码**：`page.actions` 是 actionPermissions（`entity:verb` 形状）。
 *    它有三个消费方，只有一个是错的：
 *      · rbac-preview.ts —— 权限判定，合法
 *      · PageScreen.tsx  —— 五系统检查器，**在那儿显示标识符是对的**
 *      · AppRuntimeScreen 的页卡 extra —— 错的，这里管这一处
 *    修法不是删掉而是**收进 X 光模式**：这个仓库早有 probe()/xrayActive 这条
 *    检查通道，信息比三个标签更全（含 granted），且不占版面。
 *
 * ② **角色 id**：区块拿不到 id→名字的映射就只能显示原值。`roleLabels` 早就
 *    存在（角色下拉框一直在用），只是没送到区块层。所以判据是"渲染 assigneeRole
 *    的地方必须先过 roleLabelOf"。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (rel: string) =>
  readFileSync(new URL(rel, import.meta.url), "utf8").replace(/\r\n?/g, "\n");

const runtime = read("../AppRuntimeScreen.tsx");
const registry = read("../block-registry.tsx");

describe("内部标识符不漏到界面", () => {
  it("权限码只在 X 光模式下渲染 —— 交付给业务用户的页面上不该有 entity:verb", () => {
    // 页卡 extra 里那串标签必须被 xrayActive 守着
    expect(runtime).toMatch(/xrayActive &&\s*\n?\s*page\.actions\.map/);
    // 不许再出现"无条件遍历 page.actions 渲染标签"
    expect(runtime).not.toMatch(/\{page\.actions\.slice\(0, 3\)\.map/);
    expect(runtime).not.toMatch(/^\s*\{page\.actions\.map\(/m);
  });

  it("流程步骤显示角色时必须先查显示名，查不到才回落 id", () => {
    // 渲染 assigneeRole 的地方，同一处必须出现 roleLabelOf
    const sites = [...registry.matchAll(/\{[^{}]*node\.assigneeRole[^{}]*\}/g)].map(m => m[0]);
    expect(sites.length, "找不到渲染 assigneeRole 的地方——是不是改名了？").toBeGreaterThan(0);
    const raw = sites.filter(x => !x.includes("roleLabelOf") && !x.includes("&&"));
    expect(
      raw,
      "这些地方直接把角色 id 渲染出去了，业务用户会看到 music_member 这种东西：\n" +
        raw.join("\n")
    ).toEqual([]);
  });

  it("两个宿主都注入了 roleLabelOf —— 只接一个就是「预览好使、真应用漏 id」", () => {
    expect(runtime, "真实运行时没注入").toContain("roleLabelOf:");
    const library = read("../../ComponentsLibraryPage.tsx");
    expect(library, "对照台没注入").toContain("roleLabelOf={");
    // 对照台的夹具要能演示**两条路**：翻译成功 + 查不到回落。
    // 只演示一条的夹具审不出这个特性通没通。
    expect(library).toContain("ROLE_LABELS");
    expect(library, "夹具里没有 snake_case 的角色 id，翻译那条路没被演示").toMatch(
      /assigneeRole: "[a-z]+_[a-z]+"/
    );
  });
});
