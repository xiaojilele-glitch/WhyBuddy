import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import catalogJson from "@experience-blocks";
import usageJson from "../generated/block-component-usage.json";
import { BASE_COMPONENTS } from "../base-components/base-catalog";

const blockRegistrySource = readFileSync(
  new URL("../live-runtime/block-registry.tsx", import.meta.url),
  "utf8"
);
const BASE_COMPONENT_NAMES = new Set(
  BASE_COMPONENTS.map(component => component.name)
);

const phoneBlockSource = readFileSync(
  new URL("../live-runtime/phone-mobile/PhoneExperienceBlock.tsx", import.meta.url),
  "utf8"
);
import legalDomains from "@legal";
import themePresets from "@identity-themes";
import {
  BLOCK_DEFINITIONS,
  EXPERIENCE_BLOCK_CATALOG,
  EXPERIENCE_BLOCK_RENDERERS,
  ExistingContentAdapter,
  FREEFORM_ICON_NAME_RE,
  PHONE_BLOCK_TYPES,
} from "../live-runtime/block-registry";
import { LAYOUT_REGION_KEYS } from "../live-runtime/app-runtime-schema";
import { LEGAL_THEME_IDS, resolveIdentityTheme } from "../live-runtime/identity-themes";

/** 2026-07-26 手抄清单收编哨兵。
 *
 * 此前四处"两边各一份、靠人肉记得同步"的平行拷贝：图标形状正则、legacy
 * 图标别名表、布局槽位键、8 套主题色板 + 生成主题合格标准。现在真相源收进
 * 共享 JSON（vite alias 跨语言直读），这里锁住"派生没有被人重新硬编码"，
 * 以及唯一一处因类型系统保留的字面量（LAYOUT_REGION_KEYS）与目录一致。 */
describe("SSOT parity（手抄清单收编）", () => {
  it("图标形状正则从目录派生", () => {
    expect(FREEFORM_ICON_NAME_RE.source).toBe(
      (catalogJson as { freeformIconNamePattern: string }).freeformIconNamePattern
    );
  });

  it("legacy 图标别名表从目录派生且映射值都是合法组件名形状", () => {
    const aliases = EXPERIENCE_BLOCK_CATALOG.freeformLegacyIconAliases;
    expect(Object.keys(aliases).length).toBeGreaterThan(0);
    for (const [alias, componentName] of Object.entries(aliases)) {
      expect(alias).not.toMatch(FREEFORM_ICON_NAME_RE); // kebab 名不是组件名
      expect(componentName).toMatch(FREEFORM_ICON_NAME_RE);
    }
  });

  it("LAYOUT_REGION_KEYS 与目录 pageRegions 一致（唯一保留的字面量拷贝）", () => {
    expect([...LAYOUT_REGION_KEYS]).toEqual(
      Object.keys((catalogJson as { pageRegions: Record<string, unknown> }).pageRegions)
    );
  });

  // 2026-07-30 起不再有"8 套主题从 presets JSON 构建"这件事——presets JSON
  // 不再有 themes 键（手工色值收到 1 个 FALLBACK_SEED），这条哨兵锁的结构
  // 已经不存在了。identityThemes 的 8 个合法 id 仍在账本里、仍被 gate/repair
  // 校验（那两处没有改），下面这条只锁"导出的合法 id 清单跟账本一致"，
  // 不再要求它们各自对应一套色板。
  it("LEGAL_THEME_IDS 与合法域账本一致", () => {
    expect(LEGAL_THEME_IDS).toEqual(
      (legalDomains as { identityThemes: string[] }).identityThemes
    );
  });

  it("全站一个颜色：任何 generatedTheme 都不再影响配色", () => {
    // 2026-08-03 用户裁决。这条锁的是"不会有半套新半套旧"——库里的存量应用
    // 各自带着 generatedTheme，如果它们还能影响配色，同一个应用中心里就会
    // 既有品牌色的新应用、又有五颜六色的老应用，而外壳（白菜单/白 Header）
    // 是统一的，混在一起比全都不统一更难看。
    const brand = resolveIdentityTheme();
    for (const input of [
      { label: "只有标签没有种子色" },
      { label: "测试主题", seed: "#123456" },
      // 2026-07-30 之前的 11 字段旧格式
      {
        primary: "#e05d38", primaryHover: "#c2410c", gradTo: "#fdba74",
        primaryFg: "#ffffff", contentBg: "#f8fafc", accentBg: "#fff0eb",
        accentFg: "#b23c17", sidebarText: "#e8d9d1", sidebarBg: "#271a15",
        charts: ["#e05d38", "#f59e0b", "#3b82f6"],
      },
      undefined,
    ]) {
      expect(resolveIdentityTheme("tangerine", input)).toEqual(brand);
    }
  });

  it("品牌色来自前后端同读的那份账本，不在前端写死", () => {
    // 写死的话改一次颜色要记得改两个地方；漏掉一边的症状是"生成提示词里
    // 说的颜色和实际渲染的颜色不一样"，只有肉眼比对才看得出来。
    expect(resolveIdentityTheme().primary.toLowerCase()).toBe(
      (themePresets as { brandSeed: { seed: string } }).brandSeed.seed.toLowerCase()
    );
  });

  it("菜单与 Header 是白的", () => {
    const t = resolveIdentityTheme();
    expect(t.sidebarBg.toLowerCase()).toBe("#ffffff");
    // 白底上必须是深字，否则菜单直接隐形
    expect(t.sidebarText.toLowerCase()).not.toBe("#ffffff");
  });
});

// ── 区块渲染器状态与目录对账（2026-07-27）─────────────────────
// 历史事故：QuickActionPanel/FilterBar（07-22）、WorkflowTimeline/FreeformInsight
// （07-23）陆续接了真实渲染器，但生成侧 prompt 里那句"渲染器还没上线，不要输出
// page.blocks"没人回头取下来——能用的区块一次都没被渲染过。现在放开名单由目录的
// generationEnabled 决定，而它以 rendererStatus 为前提，所以 rendererStatus 必须
// 与这张渲染表逐条对得上，否则"放开了却渲染成惰性占位卡"会重演。
describe("体验区块渲染器状态 SSOT", () => {
  it("目录 rendererStatus 与渲染表逐条一致", () => {
    for (const entry of EXPERIENCE_BLOCK_CATALOG.blocks) {
      const renderer = EXPERIENCE_BLOCK_RENDERERS[entry.rendererKey];
      expect(renderer, `${entry.type} 未登记渲染器`).toBeDefined();
      const actual = renderer === ExistingContentAdapter ? "placeholder" : "real";
      expect(
        entry.rendererStatus,
        `${entry.type}: 目录写 ${entry.rendererStatus}，渲染表实际是 ${actual}`
      ).toBe(actual);
    }
  });

  it("放开生成的区块必须有真渲染器", () => {
    for (const entry of EXPERIENCE_BLOCK_CATALOG.blocks) {
      if (!entry.generationEnabled) continue;
      expect(
        entry.rendererStatus,
        `${entry.type} 放开了生成，但渲染器是占位——用户会看到死卡片`
      ).toBe("real");
    }
  });

  it("不放开的名单是显式的（灰度哨兵）", () => {
    // 2026-07-28 建这条哨兵时列的是**放开**的那一批，逼每次扩量变成显式决定。
    // 它真拦下过三次（表单族四个、ContentCard、页面形态预设）。
    //
    // 2026-08-08 反过来列：用户要把组件扩到三五百个，列 500 个放开的名字既
    // 写不完也没人读得下去，那时哨兵只会被当成噪音一路加名字——反而失去
    // 意义。而**不放开**的始终是少数、且每一个都该说得出理由，列它才有信息量。
    //
    // 安全性不靠这条：上面那条"放开生成的区块必须有真渲染器"才是兜底，
    // 它对 500 个和对 14 个一样有效。
    const schemaOnly = EXPERIENCE_BLOCK_CATALOG.blocks
      .filter(b => !b.generationEnabled)
      .map(b => b.type)
      .sort();
    expect(schemaOnly).toEqual(["FreeformInsight"]);
  });

  it("契约（JSON）与渲染定义（TS）逐条对账 —— 只剩这两处，不许再长第三处", () => {
    // 2026-08-08：加一个组件此前要手写 8 处（目录 / 渲染器 / 注册表 / 示例
    // 数据 / HAS_DEMO / IMPL_BY_TYPE / 本文件的放开哨兵 / 手机档名单）。
    // 14 个时这套很好，用户要扩到三五百个，500×8 就成了路障。
    //
    // 照 measuredco/puck 的 ComponentConfig 收敛成一条 TS 记录
    // （render + impl + label + phone 装在一起）。但 Puck 只有 TS 一边，
    // 我们的契约要跨语言——Python 拿 propsSchema/bindingSchema 拼 prompt、
    // 跑门禁，所以契约留在共享 JSON 里。
    //
    // 于是稳态是**两处**：JSON 一条（契约）+ TS 一条（渲染）。这条用例就是
    // 钉住"只有两处、且两处一一对应"，任何一边多了少了都当场红。
    const catalogTypes = EXPERIENCE_BLOCK_CATALOG.blocks.map(b => b.type).sort();
    const definedTypes = Object.keys(BLOCK_DEFINITIONS).sort();
    expect(definedTypes, "目录里有、渲染定义里没有 → 界面会显示「暂不支持此区块」").toEqual(
      catalogTypes
    );

    // "这个区块背后是哪些基础组件"由 block-component-usage.json 回答——它从
    // 渲染器 AST 生成，不再是注册表上手写的 uses（那个字段 2026-08-10 删了，
    // 理由见 BlockDefinition 的注释：316 个区块的声明全部与实际渲染对不上）。
    //
    // 唯一允许一个基础组件都追不到的是**不放开生成**的那个：FreeformInsight 直接把
    // freeformContent 那棵树渲染成 DOM，不是拿基础组件搭的，所以它没有第一
    // 层。判据用的是 generationEnabled 而不是写死名字——真放开它生成的那天，
    // 这条会立刻要求它说清自己用了什么。
    const rawDom = new Set(
      EXPERIENCE_BLOCK_CATALOG.blocks.filter(b => !b.generationEnabled).map(b => b.type)
    );
    for (const [type, def] of Object.entries(BLOCK_DEFINITIONS)) {
      if (!rawDom.has(type)) {
        // 2026-08-10：判据从"有没有写 uses"改成"依赖图里追到了没有"。
        // 写了什么只能证明有人打过字；追到了才说明它真是拿基础组件搭的。
        const traced = usageJson.blocks[type];
        expect(
          [...(traced?.desktop ?? []), ...(traced?.phone ?? [])].length,
          `${type} 在依赖图里一个基础组件都没有（要么真没用，要么生成器没追到）`
        ).toBeGreaterThan(0);
      }
      expect(def.label, `${type} 缺 label（中文名）`).toBeTruthy();
      expect(typeof def.render, `${type} 的 render 必须是组件`).toBe("function");
    }
  });

  it("surface 开关必须真的接上 —— 每个 BlockShell 调用点都要把 block 传进去", () => {
    // 2026-08-08 踩到的坑：给 BlockShell 加了 `block` 参数用来读
    // props.surface，**却没有更新那 23 个调用点**。于是 surface 从头到尾
    // 没生效过，而我当时"验证"的是"默认观感不变"——参数根本没被读的时候，
    // 那当然不变。用户一眼看出组件库里还是卡里套卡。
    //
    // 这条用源码断言钉住：BlockShell 的调用点数量必须与传了 block 的数量
    // 相等。少一个就是那一个区块的 surface 是死的，而界面上看不出来
    // （多一层白底和本来就该有一层，长得一样）。
    const src = blockRegistrySource;
    const calls = (src.match(/<BlockShell(?=[\s>])/g) ?? []).length;
    const withBlock = (src.match(/<BlockShell block=\{block\}/g) ?? []).length;
    expect(calls, "BlockShell 调用点数量").toBeGreaterThan(0);
    expect(withBlock, `${calls - withBlock} 个 BlockShell 没传 block，surface 对它们是死的`).toBe(
      calls
    );
  });

  it("区块真正渲染的基础组件必须都在目录里 —— 三层链路的第一环不许断", () => {
    // 2026-08-08 用户把三层说清楚了：「基础组件相当于底层能力，就是素材；
    // 区块就是区域……区块它也是基础组件组装的。流程就是先有基础组件，再组装
    // 成区块，再组装成模板。」
    //
    // 2026-08-10 换判据。此前这条读的是注册表上手写的 `uses` 声明，只能校验
    // "写下来的名字拼对了没有"。而给 316 个区块逐条对账的结果是：**全部**与
    // 实际渲染的对不上——84 条声称用了却没渲染，974 条渲染了却没声称。校验
    // 一份没人读、也没人维护的名单，抓不到任何真实问题。`uses` 已删除。
    //
    // 现在读从渲染器 AST 生成的依赖图，断言的是"真的渲染了这个组件，而它在
    // 目录里"。生成器本身也会因为 renderedButNotCataloged 非空而直接报错，
    // 这里是同一件事在测试侧的兜底。
    expect(usageJson.audit.renderedButNotCataloged).toEqual([]);
    for (const [type, usage] of Object.entries(usageJson.blocks)) {
      for (const name of [...usage.desktop, ...usage.phone]) {
        expect(
          BASE_COMPONENT_NAMES.has(name),
          `${type} 渲染了「${name}」，但基础组件库里没有这个`
        ).toBe(true);
      }
    }
  });

  it("能算出「多少基础组件还没接进区块」—— 这是覆盖缺口，得看得见", () => {
    // 覆盖统计必须读取真实桌面/手机渲染器生成的依赖图。BLOCK_DEFINITIONS.uses
    // 只是旧的部分桌面声明，不能再拿它充当组件覆盖率。
    const used = new Set(
      Object.values(usageJson.blocks).flatMap(usage => [
        ...usage.desktop,
        ...usage.phone,
      ])
    );
    const unlinked = [...BASE_COMPONENT_NAMES].filter(n => !used.has(n));
    expect(used.size).toBeGreaterThan(0);
    expect(unlinked.length + used.size).toBe(BASE_COMPONENT_NAMES.size);
  });

  it("区块渲染器不许再出现裸 <img —— 图片走 antd Image", () => {
    // 2026-08-10。此前 CardGridList 的封面和表格里的图片缩略图都是裸 `<img>`，
    // 而两处的区块定义都写着 `uses: [… "Image" …]`——声明和实现对不上，对不上
    // 的正好是让 Image 成为正确选择的那三样：点开看大图、加载占位、失败兜底。
    // 目录里那条的说明就是「带预览、加载占位与失败兜底的图片」。
    //
    // 附带的是 `alt=""`：那是"纯装饰"的意思，而卡片封面和表格里的图是内容。
    // axe 只查 alt 在不在、不查写得对不对，所以这一类它扫不出来。
    //
    // 唯一放行的是 FreeformInsight 的落地页大图：那是一整块铺满容器的背景式
    // 视觉，套一层 Image 的预览遮罩反而不对。
    const code = blockRegistrySource
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter(line => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
      .join("\n");
    const rawImages = (code.match(/<img(?=[\s>/])/g) ?? []).length;
    expect(rawImages, "新增图片请用 antd Image；确实要裸标签的在这里说明理由").toBe(1);
  });

  it("生成器看到的目录 = 运行时的目录 —— 覆盖率的分母不许各算各的", () => {
    // 2026-08-10。这条是补一个**已经三次给出错误结论**的盲区。
    //
    // 覆盖率是「被用到的 / 目录总数」。分子分母都来自 generate-block-component-
    // usage.mjs 用 AST 读出来的名单，而那份读法一直只认对象字面量：
    //
    //   · `formItem("ProFormText", …)` 工厂调用产的 32 条 —— 读不到
    //   · `...[…].map(…)` 展开产的 10 条 ProField —— 读不到
    //
    // 218 条目录只读出 176 条。漏掉的 42 条不是"少统计一点"：`knownNames`
    // 同时是"渲染了但目录里没有"这条护栏的判据，缺失的名字会让护栏把真实
    // 存在的条目判成不存在，同时让它们在统计里永远是零引用。我据此报过
    // 「ProForm 家族 36 个控件零引用」——那是假的，block-registry.tsx 一直
    // 在渲染 ProFormText / ProFormDigit。
    //
    // 所以这里拿运行时真正 import 出来的 BASE_COMPONENTS 跟生成器的名单对账。
    // 目录以后再多一种写法，红的是这条用例，而不是某个基于它下的结论。
    expect([...usageJson.audit.catalogComponents].sort()).toEqual(
      [...BASE_COMPONENT_NAMES].sort()
    );
  });

  it("手机档也走 surface —— 两个档位不许在这件事上分叉", () => {
    // 2026-08-08 连着踩两次的同一个坑：桌面那边把 surface 接好之后，
    // **手机档完全没被碰到**——它走的是 PhoneExperienceBlock 这套独立代码，
    // 四个渲染器各自直接套 antd-mobile 的 <Card title=…>，标题又一次由壳提供。
    //
    // 分叉了在界面上看不出来：多一层白底和本来就该有一层长得一样，得逐个
    // 数 DOM 才知道。所以用源码断言钉死——手机档不许再出现裸 <Card，
    // 一律走 PhoneShell（它和桌面 BlockShell 读的是同一个判据）。
    const code = phoneBlockSource
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter(l => !l.trim().startsWith("//"))
      .join("\n");
    // PhoneShell 自己内部那一处是唯一允许的 <Card
    const cardOpens = (code.match(/<Card(?=[\s>])/g) ?? []).length;
    expect(cardOpens, "手机档渲染器不该再直接套 Card，走 PhoneShell").toBe(1);
    expect(code).toContain('block?.props?.surface === "plain"');
  });

  it("手机档名单从定义表派生 —— 不许再有第二张手写名单", () => {
    // 此前 PhoneExperienceBlock 里另有一张 PHONE_BLOCK_TYPES 手写名单，
    // 与渲染侧各写各的。两处对不上时**没有任何东西会报错**：手机档会静静地
    // 拿桌面渲染器顶上，而"顶上了"和"本来就该这样"在界面上长得一模一样。
    const fromDefs = Object.entries(BLOCK_DEFINITIONS)
      .filter(([, d]) => d.phone)
      .map(([t]) => t)
      .sort();
    expect([...PHONE_BLOCK_TYPES].sort()).toEqual(fromDefs);
    // 手机档的每一个都必须真的在目录里，否则名单指向一个不存在的区块
    const catalogTypes = new Set(EXPERIENCE_BLOCK_CATALOG.blocks.map(b => b.type));
    for (const t of fromDefs) expect(catalogTypes.has(t), `${t} 不在目录里`).toBe(true);
  });

  it("FreeformInsight 仍不放开 —— 它不是 LLM 往 page.blocks 里写的东西", () => {
    // 总览版式由 enrich_monitor_page_overviews 读 page.stats/charts 之后合成，
    // 属于过门之后的增强步骤。放开它等于允许 LLM 绕过那条流程直接塞版式，
    // 方案 C 的归属划分会立刻失效（总览页会同时有两份设计）。
    const ff = EXPERIENCE_BLOCK_CATALOG.blocks.find(
      b => b.type === "FreeformInsight"
    );
    expect(ff?.generationEnabled).toBe(false);
  });
});
