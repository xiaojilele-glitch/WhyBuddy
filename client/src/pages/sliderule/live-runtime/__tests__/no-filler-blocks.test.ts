import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 不许再靠"同一个工厂换个中文名"来充区块数（2026-08-11）。
 *
 * ## 这条闸是怎么来的
 *
 * 用户在组件库那面墙上一眼看出来的：「现在的组件有很多是糊弄出来的，是表格」。
 * 量了一遍，407 个区块里有 57 个是这个形状：
 *
 *     const QueryModeTabsRenderer     = stableTabsRenderer("query-mode-tabs", "查询模式", "itemSelect");
 *     const DatasetEditorTabsRenderer = stableTabsRenderer("dataset-editor-tabs", "数据集编辑", "itemSelect");
 *     … 一共 17 个 Tabs，**第三个参数全是同一个值**
 *
 *     const WorkItemContextSummaryRenderer = compactSummaryRenderer("work-item-context-summary", "工作项摘要");
 *     const DocumentContextSummaryRenderer = compactSummaryRenderer("document-context-summary", "文档摘要");
 *     … 一共 14 个，渲染出来是同一张 ProDescriptions 键值**表格**
 *
 * 整个实现就是一行工厂调用，参数只有 testid 和一句中文标题。它们在目录里各占
 * 一个 `type`、各有一个 `rendererKey`、各有一个 `XxxRenderer` 常量——**看起来
 * 处处不同，跑起来处处一样**。
 *
 * ## 为什么老的防线没拦住
 *
 * `test_independent_structure_blocks_batch8.py` 早就有一条叫
 * `..._without_alias_counting` 的棘轮，防的是"同一个渲染器挂两个名字"。但它的
 * 判据是 `rendererKey` 唯一——而这批凑数**每个都有自己的 rendererKey**。
 * 唯一性检查对"内容相同、标识不同"天然无感。
 *
 * 所以这条闸换个地方下手：**看实现，不看标识**。
 *
 * ## 判据
 *
 * 同一个工厂被 N 个区块调用时，调用参数里必须有**除 testid / 展示文案之外**的
 * 差异——也就是至少一个参数真的改变了行为（换绑定字段、换 variant、换事件名、
 * 换列定义…）。全是文案 = 这 N 个应该是 1 个。
 *
 * 允许的例外写在 `SHARED_SHELLS` 里：那些是"壳"不是"区块工厂"（Shell / Missing
 * 这类每个渲染器都要用的小组件），点名放行，加一个要写一句为什么。
 */

// ⚠ fileURLToPath 而不是 .pathname：URL.pathname 在 Windows 上是 "/C:/…"，
//   丢给 fs 会被拼成 "C:\C:\…"，整个文件在 Windows 机器上必红。
const DIR = fileURLToPath(new URL("..", import.meta.url));

/** 每个区块渲染器都会用的通用外壳/工具，不是"一个区块工厂"，不适用本判据。 */
const SHARED_SHELLS = new Set([
  "Shell", "BlockShell", "Missing", "BlockEmpty", "React", "String", "Number",
  "Boolean", "Object", "Array", "useMemo", "useState", "field", "bound", "targets",
]);

/**
 * 只影响 testid / 显示文案的参数名——这些一律不算"行为差异"。
 *
 * ⚠ 判据认的是**参数名**，不是"看起来像不像文案"。第一版按"是不是裸字符串"剥，
 * 结果把三族真有差异的也判成了凑数：
 *   · matureKanbanRenderer(variant)                  —— variant 在函数体里被读 24 次（排序会变）
 *   · diagnosticDrawer(testid, fallback, refKey, …)  —— 后三个是绑定字段名
 *   · multiSeriesChart(testid, fallback, defs, unit) —— defs 是列定义
 * 它们的差异**恰好都长成字符串**。所以必须去读工厂签名里的形参名，
 * 而不是猜字符串的用途。
 */
const COSMETIC_KEYS = new Set(["testid", "fallback", "title", "label", "confirm", "hint", "empty"]);

type Call = { block: string; factory: string; args: string };

function sources(): string[] {
  return readdirSync(DIR)
    .filter(f => f.endsWith(".tsx"))
    .map(f => readFileSync(DIR + f, "utf8"));
}

function collectFactoryCalls(all: string[]): Call[] {
  const calls: Call[] = [];
  for (const src of all) {
    // 形如：const XxxRenderer = factory(...)   /   const XxxRenderer = p => factory(p, {...})
    const re =
      /^(?:export )?const (\w+)Renderer(?:\s*:[^=]*)?\s*=\s*(?:\(?\w+\)?\s*=>\s*)?(\w+)\(([\s\S]*?)\);?\s*$/gm;
    for (const m of src.matchAll(re)) {
      if (SHARED_SHELLS.has(m[2])) continue;
      calls.push({ block: m[1], factory: m[2], args: m[3] });
    }
  }
  return calls;
}

/** 从工厂定义里取形参名，取不到就返回 null（此时退回"全部算行为差异"，宁可漏判不误判）。 */
function paramNames(factory: string, all: string[]): string[] | null {
  for (const src of all) {
    const m =
      new RegExp(`(?:function|const)\\s+${factory}\\s*(?::[^=]*)?=?\\s*\\(([^)]*)\\)`).exec(src);
    if (!m) continue;
    return m[1]
      .split(",")
      .map(p => p.trim().split(/[:=]/)[0].trim())
      .filter(Boolean);
  }
  return null;
}

/** 按顶层逗号切分实参（`defs: [["a","b","c"]]` 里的逗号不能切）。 */
function splitArgs(args: string): string[] {
  const out: string[] = [];
  let depth = 0, quote = "", cur = "";
  for (const ch of args) {
    if (quote) { cur += ch; if (ch === quote) quote = ""; continue; }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; cur += ch; continue; }
    if ("([{".includes(ch)) depth += 1;
    if (")]}".includes(ch)) depth -= 1;
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** 把调用参数剥成"只剩会改变行为的部分"。 */
function behavioralArgs(args: string, params: string[] | null): string {
  const parts = splitArgs(args).filter(a => !/^(props|p)$/.test(a)); // 第一个恒为 props
  const kept: string[] = [];
  parts.forEach((arg, i) => {
    if (arg.startsWith("{")) {
      // 对象字面量：按键名剥
      let s = arg;
      for (const key of COSMETIC_KEYS) {
        s = s.replace(new RegExp(`\\b${key}\\s*:\\s*("[^"]*"|'[^']*'|\`[^\`]*\`)\\s*,?`, "g"), "");
      }
      kept.push(s);
      return;
    }
    // 位置参数：看形参名。签名读不到就一律保留（宁可漏判）。
    const name = params?.[i];
    if (name && COSMETIC_KEYS.has(name)) return;
    kept.push(arg);
  });
  return kept.join("|").replace(/[\s,{}]/g, "");
}

describe("区块目录不许靠换名字充数", () => {
  it("同一个工厂的多个区块，参数差异不能只有 testid 和中文标题", () => {
    const all = sources();
    const byFactory = new Map<string, Call[]>();
    for (const c of collectFactoryCalls(all)) {
      if (!byFactory.has(c.factory)) byFactory.set(c.factory, []);
      byFactory.get(c.factory)!.push(c);
    }

    const filler: string[] = [];
    for (const [factory, calls] of byFactory) {
      if (calls.length < 2) continue;
      const params = paramNames(factory, all);
      const shapes = new Set(calls.map(c => behavioralArgs(c.args, params)));
      if (shapes.size === 1) {
        filler.push(
          `${factory}：${calls.length} 个区块（${calls.map(c => c.block).join(", ")}）` +
            `剥掉 testid/文案之后参数完全一样 —— 它们应该是 1 个区块`
        );
      }
    }

    expect(
      filler,
      "又出现只换文案的凑数区块了。\n" +
        "要么给它一个真的行为差异（换绑定字段/变体/事件），要么就别单开一个 type：\n" +
        filler.join("\n")
    ).toEqual([]);
  });

  it("目录数量与渲染器数量对得上 —— 删了区块没删干净会在这儿露出来", () => {
    const catalog = JSON.parse(
      readFileSync(
        new URL("../../../../../../slide-rule-python/services/data/experience_block_catalog.json", import.meta.url),
        "utf8"
      )
    ) as { version: number; blocks: Array<{ type: string }> };
    expect(catalog.blocks.length).toBe(catalog.version);
    expect(new Set(catalog.blocks.map(b => b.type)).size).toBe(catalog.blocks.length);
  });

  it("这条闸真的抓得住 —— 拿删掉的那批复现一次", () => {
    // 反向自检：如果判据写松了，上面那条会变成永远绿的空断言。
    // 这里手工喂进 2026-08-11 删掉的真实调用，它必须被判为凑数。
    const shapes = new Set(
      [
        `"query-mode-tabs", "查询模式", "itemSelect"`,
        `"dataset-editor-tabs", "数据集编辑", "itemSelect"`,
        `"document-history-tabs", "文档历史", "itemSelect"`,
      ].map(a => behavioralArgs(a, ["testid", "fallback", "event"]))
    );
    expect(shapes.size, "判据没抓住已知的凑数样本").toBe(1);

    // 而真有行为差异的（换了绑定字段）必须放过
    const real = new Set(
      [
        `p, { testid: "leave-calendar", secondary: "memberFieldRef", extra: "typeFieldRef", edit: true }`,
        `p, { testid: "exam-schedule-calendar", secondary: "resourceFieldRef", edit: true }`,
      ].map(a => behavioralArgs(a, ["p", "config"]))
    );
    expect(real.size, "把真有差异的也判成凑数了 —— 判据太紧").toBeGreaterThan(1);
  });
});
