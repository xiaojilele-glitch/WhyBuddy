import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dedupeDenormalizedColumns, dedupeDenormalizedFieldIds } from "../app-runtime-schema";
import { semanticOf } from "../demo-seed-semantics";
import { seedRuntimeState } from "../demo-seed";
import type { AppFormFieldSchema } from "../app-runtime-schema";

/**
 * 反规范化字段对，以及"占位文本"那一档（2026-08-11）。
 *
 * ## 这三条为什么放在一起
 *
 * 都出自线上产物的同一张截图，而且**根子是同一个**：模型在数据层做了
 * 反规范化（存 `pickup_point_ref` 的同时冗余一份 `pickup_point_name`，
 * 免得每次关联查），这是常规设计；出问题的是下游两处各自把它当成
 * "两个互不相干的字段"：
 *
 *     种子   两个格子各起一个随机流各填各的 → 「自提点: 精选自提点」
 *                                            「自提点名称: 定制自提点」互相矛盾
 *     表格   两列并排都摆出来               → 同一件事说两遍
 *
 * 第三条（"经营表现摘要 1"）是另一个来源但同一类伤害：字段名当值用。
 *
 * ## 共同的判据纪律：词干必须完全相同
 *
 * 两处都只认 `X_ref` ↔ `X_name|X_title|X_label` 的**完全同词干**。
 * 同一个模型里还有 `group_buy_ref` 配 `group_title`，词干对不上，两处都放过它。
 * **宁可漏一个，不许把不相干的字段改写掉/摘掉**——摘错列比多一列贵得多。
 */

const f = (id: string, type = "string"): AppFormFieldSchema =>
  ({ id, label: id, type }) as AppFormFieldSchema;

describe("a. 反规范化副本不占表格列", () => {
  it("X_ref 在场时摘掉 X_name", () => {
    const out = dedupeDenormalizedColumns([
      f("name"),
      f("pickup_point_ref", "ref"),
      f("pickup_point_name"),
      f("status", "enum"),
    ]);
    expect(out.map(x => x.id)).toEqual(["name", "pickup_point_ref", "status"]);
  });

  it("留的是 ref 那一列 —— 关系挂在它身上，name 只是快照文本", () => {
    const out = dedupeDenormalizedColumns([f("leader_name"), f("leader_ref", "ref")]);
    expect(out.map(x => x.id)).toEqual(["leader_ref"]);
  });

  it("词干对不上的不许摘 —— group_buy_ref 配 group_title 就放过", () => {
    const ids = ["group_buy_ref", "group_title"];
    const out = dedupeDenormalizedColumns([f("group_buy_ref", "ref"), f("group_title")]);
    expect(out.map(x => x.id), "把词干不同的字段也摘了 —— 判据太松").toEqual(ids);
  });

  it("没有 ref 字段时原样返回（同一个数组，不白拷一份）", () => {
    const input = [f("name"), f("phone")];
    expect(dedupeDenormalizedColumns(input)).toBe(input);
  });

  it("孤立的 xxx_name 不受影响 —— 没有对应 ref 就不是副本", () => {
    const out = dedupeDenormalizedColumns([f("community_name"), f("status", "enum")]);
    expect(out.map(x => x.id)).toEqual(["community_name", "status"]);
  });

  it("**它真的被接上了** —— 上面几条只测函数本身，测不出有没有人调它", () => {
    // 写完这一组时做变异验证：把调用点改回 `allFields.slice(0, 6)`，
    // 上面五条**全绿**。函数测得再细，没接线就是零。
    // 这条盯的是接线本身。
    const src = readFileSync(new URL("../app-runtime-schema.ts", import.meta.url), "utf8");
    expect(
      src,
      "columns 没走去重 —— 冗余副本会照样并排摆出来"
    ).toContain("columns: dedupeDenormalizedColumns(allFields)");
    // detailFields 必须**不**走去重：摘列是为了别在一屏里说两遍，
    // 不是要把字段藏起来。点进某一行仍然看得到。
    expect(
      src,
      "detailFields 也去重了 —— 渲染层没有资格决定「你看不到」"
    ).toContain("detailFields: allFields,");
  });

  it("积木画的表格也得去重 —— 页面内置表格只是两条渲染路径之一", () => {
    // 2026-08-12：用户的截图上「自提点 / 自提点名称」照样并排。那张表不是
    // 页面内置的，是 DataTable 积木画的，它自己从行的键里派生列，
    // 压根不经过 dedupeDenormalizedColumns。判据钉在一个调用点上就是这个下场。
    const src = readFileSync(new URL("../block-registry.tsx", import.meta.url), "utf8");
    const i = src.indexOf("function boundFieldIds(");
    expect(i, "boundFieldIds 没了 —— 这条断言的锚点要重找").toBeGreaterThan(-1);
    const body = src.slice(i, i + 900);
    expect(body, "积木的派生列没走去重").toContain("dedupeDenormalizedFieldIds");
    // 顺序：先去重再截断，否则副本白占一格、把第 8 列挤下榜
    expect(
      body.indexOf("dedupeDenormalizedFieldIds"),
      "先 slice 再去重 —— 副本占掉的那一格补不回来"
    ).toBeLessThan(body.indexOf(".slice(0, fallbackCap)"));
  });

  it("模型明说要哪几列时不摘 —— 那是它的选择", () => {
    const ids = dedupeDenormalizedFieldIds(["pickup_point_ref", "pickup_point_name"]);
    expect(ids).toEqual(["pickup_point_ref"]);
    // 但 binding.fieldRefs 那条路不经过它（判据写在 boundFieldIds 的分支里）
    const src = readFileSync(new URL("../block-registry.tsx", import.meta.url), "utf8");
    const body = src.slice(src.indexOf("function boundFieldIds("), src.indexOf("function boundFieldIds(") + 900);
    expect(
      body.indexOf("return declared.map"),
      "声明路径也被去重了 —— 模型明说的东西不该被渲染层删掉"
    ).toBeLessThan(body.indexOf("dedupeDenormalizedFieldIds"));
  });
});

describe("b. 种子给冗余副本填的值必须跟 ref 一致", () => {
  const model = {
    datamodel: {
      entities: [
        {
          id: "pickup_point",
          name: "自提点",
          fields: [{ id: "name", name: "名称", type: "string" }],
        },
        {
          id: "leader",
          name: "团长",
          fields: [
            { id: "name", name: "姓名", type: "string" },
            { id: "pickup_point_ref", name: "自提点", type: "ref" },
            { id: "pickup_point_name", name: "自提点名称", type: "string" },
          ],
        },
      ],
    },
  } as never;

  it("同一行里 X_ref 与 X_name 是同一个值", () => {
    const state = seedRuntimeState({ entities: {} } as never, model, Date.UTC(2026, 7, 11));
    const rows = state.entities.leader ?? [];
    expect(rows.length, "种子没铺出来，下面就是空断言").toBeGreaterThan(0);
    for (const row of rows) {
      expect(
        row.values.pickup_point_name,
        `同一行里两个格子对不上：ref=${row.values.pickup_point_ref} name=${row.values.pickup_point_name}`
      ).toBe(row.values.pickup_point_ref);
    }
  });

  it("对齐用的是真实存在的目标行显示名，不是凭空编的", () => {
    const state = seedRuntimeState({ entities: {} } as never, model, Date.UTC(2026, 7, 11));
    const names = new Set((state.entities.pickup_point ?? []).map(r => String(r.values.name)));
    for (const row of state.entities.leader ?? []) {
      expect(names.has(String(row.values.pickup_point_ref))).toBe(true);
    }
  });
});

describe("c. 摘要/说明这类字段不许把字段名当值", () => {
  it("认得出散文档", () => {
    for (const id of ["performance_summary", "growth_advice", "remark", "reject_reason"]) {
      expect(semanticOf(id, undefined), `${id} 没被认成散文`).toBe("prose");
    }
    for (const label of ["经营表现摘要", "整改说明", "评价", "备注"]) {
      expect(semanticOf(undefined, label), `${label} 没被认成散文`).toBe("prose");
    }
  });

  it("更具体的规则先判 —— 说明书编号还是单号，负责人说明还是人名", () => {
    expect(semanticOf("manual_code", "说明书编号")).toBe("code");
    expect(semanticOf("owner_note", "负责人说明")).toBe("person");
  });

  it("散文档填出来的是一句话，不是「字段名 + 序号」", () => {
    const model = {
      datamodel: {
        entities: [
          {
            id: "leader",
            name: "团长",
            fields: [{ id: "performance_summary", name: "经营表现摘要", type: "string" }],
          },
        ],
      },
    } as never;
    const state = seedRuntimeState({ entities: {} } as never, model, Date.UTC(2026, 7, 11));
    const values = (state.entities.leader ?? []).map(r => String(r.values.performance_summary));
    expect(values.length).toBeGreaterThan(0);
    for (const v of values) {
      expect(v, `又变回「字段名 + 序号」了：${v}`).not.toMatch(/^经营表现摘要 \d+$/);
      expect(v).toContain("示例");
    }
    // 12 行不能是同一句话——全一样时表格看着像渲染坏了
    expect(new Set(values).size, "12 行摘要一模一样").toBeGreaterThan(1);
  });
});
