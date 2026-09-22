import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ExperienceBlockBoundary } from "../block-registry";
import type { ExperienceBlockRendererProps } from "../block-registry";
import catalog from "@experience-blocks";

/**
 * 两个区块不许渲染出同一个东西（2026-08-11，第二刀）。
 *
 * ## 为什么换判据
 *
 * 同一天早些时候已经有一道闸（`no-filler-blocks.test.ts`），判据是**源码形状**：
 * 同一个工厂被多个区块调用时，参数不能只差 testid 和中文标题。它砍掉了 57 个。
 *
 * 用户看了之后说：**「我看着主体区、补充说明，怎么还全是表格」**。他是对的，
 * 那道闸漏了两大类，而且漏得很典型：
 *
 *     ① ContextPanelRenderer 那 16 个**挤在同一行源码里**
 *        const KeyboardCommandPaletteRenderer=ContextPanelRenderer("palette"); const Notif…
 *        行锚定的正则只匹到第一个，另外 15 个当场隐身。
 *
 *     ② 16 个向导根本不是调用点，是**策略表条目**
 *        CONFIGURATION_WIZARD_POLICIES = { SurveyBuilderWizard: { title, testid, confirm, … } }
 *        16 个条目里行为标志位只有 4 种组合 —— 也就是 4 个区块穿了 16 件马甲。
 *
 * 教训不是"正则写得不够全"，是**判据挂在源码怎么写上，就永远追不完写法**。
 * 所以这道闸换成地基真相：
 *
 *     把每个区块用一份**按它自己 bindingSchema 合成的夹具**真渲染一遍，
 *     把 DOM 归一化（扔掉文本、id、testid、内联样式，class 只留骨架）之后比对。
 *     结构全等 = 同一个区块，不管源码写成什么样。
 *
 * ## 度量本身也会骗人，排掉了两类假重复
 *
 * 头一版量出 114 个"重复"，其中大部分是假的：
 *
 *   · **图表**：ECharts 在 SSR 下只吐一个空容器，漏斗图和热力图的 DOM 一模一样。
 *     它们的差异在 option 里，服务端渲染看不见 → 整类排除（宁可漏判）。
 *   · **空态**：合成夹具喂不饱的区块会渲染 antd `Empty` / adm `ErrorBlock`，
 *     彼此当然全等。差点因此把 SankeyFlow 和 RadarComparison 判成同款删掉。
 *
 * 排掉这两类之后是 18 组 52 个，删 34。**判据宁可漏判，绝不误判**——
 * 误判会逼人删掉真有用的区块，那比留几个凑数的贵得多。
 */

type Entry = {
  type: string;
  bindingSchema?: {
    required?: string[];
    optional?: string[];
    entityFieldRefs?: Record<string, string>;
  };
};

const FIELD_VALUE: Record<string, unknown> = {
  string: "示例文本",
  number: 42,
  date: "2026-08-11",
  datetime: "2026-08-11T09:00:00Z",
  enum: "pending",
  boolean: true,
};

/** 按区块自己的 bindingSchema 合成一份刚好喂得饱它的夹具。 */
function fixtureFor(entry: Entry): ExperienceBlockRendererProps {
  const schema = entry.bindingSchema ?? {};
  const refs = [...(schema.required ?? []), ...(schema.optional ?? [])];
  const types = schema.entityFieldRefs ?? {};
  const binding: Record<string, unknown> = { entityRef: "demo", targets: ["demo"] };
  const values: Record<string, unknown> = {};
  const fieldTypes: Record<string, string> = {};
  for (const ref of refs) {
    if (ref === "entityRef" || ref === "targets") continue;
    if (ref.endsWith("FieldRefs")) {
      const f = ref.replace("FieldRefs", "");
      binding[ref] = [`${f}_a`, `${f}_b`];
      for (const k of [`${f}_a`, `${f}_b`]) {
        values[k] = "示例文本";
        fieldTypes[k] = "string";
      }
      continue;
    }
    if (ref.endsWith("FieldRef")) {
      const f = ref.replace("FieldRef", "");
      binding[ref] = f;
      const t = String(types[ref] ?? "string");
      values[f] = FIELD_VALUE[t] ?? "示例文本";
      fieldTypes[f] = t;
      continue;
    }
    binding[ref] = ref === "limit" ? 5 : "示例";
  }
  return {
    block: { id: entry.type, type: entry.type, props: { surface: "plain" }, binding },
    entityRows: { demo: [1, 2, 3].map(i => ({ id: `r${i}`, createdAt: "2026-08-01", values: { ...values } })) },
    fieldLabelOf: (_e: string, f: string) => f,
    fieldTypeOf: (_e: string, f: string) => fieldTypes[f],
    enumOptionsOf: () => [{ id: "pending", label: "待处理", tone: "default" as const }],
    chartPalette: { primary: "#5b6cff", categorical: ["#5b6cff", "#22c55e"] },
    onAction: () => undefined,
  } as unknown as ExperienceBlockRendererProps;
}

/** 只留结构：标签名 + class 骨架。文本、id、testid、内联样式全扔掉。 */
function shape(html: string): string {
  return html
    .replace(/>[^<]*</g, "><")
    .replace(/\s(data-testid|id|style|title|aria-label|for|href|value|placeholder)="[^"]*"/g, "")
    .replace(/\s(class|className)="([^"]*)"/g, (_m, _k, v) =>
      ` c="${String(v).split(/\s+/).filter(x => !/\d/.test(x)).sort().join(" ")}"`)
    .replace(/\s+/g, " ");
}

/** 看不见差异的两类，整类跳过。放宽的理由见文件头。 */
function opaque(html: string): boolean {
  return (
    /ant-empty|adm-error-block|尚未绑定|暂无|还没有|没有可|不支持此区块/.test(html) ||
    /echarts/i.test(html) ||
    html.length < 400
  );
}

describe("两个区块不许渲染出同一个东西", () => {
  const blocks = (catalog as { blocks: Entry[] }).blocks;

  it("结构全等的区块组必须为空", () => {
    const groups = new Map<string, string[]>();
    for (const entry of blocks) {
      let html: string;
      try {
        html = renderToStaticMarkup(<ExperienceBlockBoundary {...fixtureFor(entry)} />);
      } catch {
        continue; // 合成夹具喂不了的（个别区块要求数组形状），不在本判据范围内
      }
      if (opaque(html)) continue;
      const key = shape(html);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(entry.type);
    }

    const dups = [...groups.values()].filter(g => g.length > 1).sort((a, b) => b.length - a.length);
    expect(
      dups.map(g => g.join(" = ")),
      "这些区块渲染出来的 DOM 结构完全一样 —— 它们是同一个区块穿了几件马甲。\n" +
        "要么给它真的形态差异，要么合并成一个 type：\n" +
        dups.map(g => `  ${g.length} 个 | ${g.join(", ")}`).join("\n")
    ).toEqual([]);
  });

  it("这条闸真的在比东西 —— 参与比对的区块不能太少", () => {
    // 没有这一条，上面那条会在"全被 opaque 跳过"时变成永远绿的空断言。
    let compared = 0;
    for (const entry of blocks) {
      try {
        const html = renderToStaticMarkup(<ExperienceBlockBoundary {...fixtureFor(entry)} />);
        if (!opaque(html)) compared += 1;
      } catch {
        /* 同上 */
      }
    }
    expect(compared, `只有 ${compared}/${blocks.length} 个区块真参与了比对，判据快空转了`).toBeGreaterThan(
      blocks.length * 0.6
    );
  });
});
