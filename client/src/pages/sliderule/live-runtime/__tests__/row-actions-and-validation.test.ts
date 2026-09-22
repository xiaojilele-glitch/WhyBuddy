/**
 * 行内「查看 / 编辑」各归各位 + 表单校验只验声明过的东西（2026-08-13）。
 *
 * ## 这三条是怎么来的
 *
 * 线上一个生成出来的应用（音乐收藏库），用户一眼看出三个毛病：
 *
 *   1. 点「查看」没反应
 *   2. 点「编辑」弹出来的是**详情**弹窗
 *   3. 表单能存进一整行 "1"，没有任何校验
 *
 * 三个都不是渲染 bug，是接线和契约的问题：
 *
 * - 「查看」发的是 `rowSelect`。那是"换一条看"的行选中语义，**故意不弹抽屉**
 *   （AppRuntimeScreen 里写着理由）。而那一页右边已经摆了详情面板，焦点设成
 *   同一条 → 界面纹丝不动 → 用户看到的就是"点了没反应"。
 * - 「编辑」发 `editRequest`，而它被接在 `openRecordById` 上——打开详情抽屉。
 *   根子是**表单只有"新建"一个入口**（`openCreate` 恒 `setFormValues({})`），
 *   编辑压根没有落点，于是被将就着接到了详情上。
 * - 校验只有一条：number 字段能不能转成数。enum 的 options、date 的可解析性、
 *   ref 的目标存在性——**模型全都声明了，只是没人去对**。
 *
 * ## 判据钉在哪
 *
 * 前两条钉在"事件名不同"上：只要「查看」和「编辑」发同一个事件，就必然有一个
 * 是错的——这是这次事故的形状本身。第三条钉在"验的是声明过的东西"，同时
 * 明确钉住**不验必填**：`FiveSystemField` 里没有 required 这一维，猜出来的
 * 必填会把用户拦在一个他看不懂的地方。
 */

import { describe, it, expect } from "vitest";
import { validateRowFields, validateRowValues } from "../live-runtime";
import type { FiveSystemModel } from "../../system-screens/five-system-model";
import REGISTRY_SRC from "../block-registry.tsx?raw";

const MODEL: FiveSystemModel = {
  datamodel: {
    entities: [
      {
        id: "track",
        name: "曲目",
        fields: [
          { id: "title", name: "曲名", type: "string" },
          { id: "plays", name: "播放次数", type: "number" },
          {
            id: "genre",
            name: "音乐类型",
            type: "enum",
            options: [
              { id: "rock", label: "摇滚" },
              { id: "jazz", label: "爵士" },
            ],
          },
          { id: "added_at", name: "加入时间", type: "date" },
          { id: "album_id", name: "专辑", type: "ref", refEntity: "album" },
          { id: "legacy_ref", name: "旧引用", type: "ref" },
        ],
      },
      { id: "album", name: "专辑", fields: [{ id: "name", name: "名称", type: "string" }] },
    ],
  },
  rbac: { roles: [], permissions: [], menus: [] },
  workflow: { id: "w", name: "w", nodes: [], transitions: [] },
  page: { pages: [] },
  aigc: { capabilities: [], pipelines: [] },
  appbundle: {},
} as unknown as FiveSystemModel;

const ROWS = { album: [{ id: "row-1", values: { name: "专辑一" } }], track: [] };

describe("表单校验 · 只验模型声明过的东西", () => {
  it("enum 值不在 options 里要拦，并把合法值报出来", () => {
    const [p] = validateRowFields(MODEL, "track", { genre: "民谣" });
    expect(p.fieldId).toBe("genre");
    // 报的是 label 不是 id——拦住用户就得告诉他能填什么
    expect(p.message).toContain("摇滚");
    expect(p.message).toContain("爵士");
    expect(validateRowFields(MODEL, "track", { genre: "rock" })).toEqual([]);
  });

  it("date 字段存不进「昨天下午」这种", () => {
    expect(validateRowFields(MODEL, "track", { added_at: "昨天下午" })).toHaveLength(1);
    expect(validateRowFields(MODEL, "track", { added_at: "2026-08-13" })).toEqual([]);
  });

  it("ref 指向不存在的记录要拦——但只在拿得到行数据时", () => {
    expect(
      validateRowFields(MODEL, "track", { album_id: "row-999" }, ROWS)
    ).toHaveLength(1);
    expect(validateRowFields(MODEL, "track", { album_id: "row-1" }, ROWS)).toEqual([]);
    // 不传 rows 就验不了"存在性"，那就别假装验过（旧调用方走的正是这条）
    expect(validateRowFields(MODEL, "track", { album_id: "row-999" })).toEqual([]);
  });

  it("refEntity 缺席时不判——猜出来的目标实体验不准", () => {
    expect(
      validateRowFields(MODEL, "track", { legacy_ref: "row-999" }, ROWS)
    ).toEqual([]);
  });

  it("number 那条老规则没丢", () => {
    expect(validateRowFields(MODEL, "track", { plays: "abc" })).toHaveLength(1);
    expect(validateRowFields(MODEL, "track", { plays: "42" })).toEqual([]);
  });

  it("整条全空要拦，但**不做逐字段必填**", () => {
    const empty = validateRowFields(MODEL, "track", {});
    expect(empty).toHaveLength(1);
    expect(empty[0].fieldId).toBe(""); // 整表级，不指向某一栏

    // 只填一个字段就放行——契约里没有 required，多一个字段都不许猜
    expect(validateRowFields(MODEL, "track", { title: "只填了曲名" })).toEqual([]);
  });

  it("字符串视图与字段视图同源，老调用方不受影响", () => {
    const fields = validateRowFields(MODEL, "track", { genre: "民谣" });
    const strings = validateRowValues(MODEL, "track", { genre: "民谣" });
    expect(strings).toEqual(fields.map(p => p.message));
  });

  it("实体不存在时静默返回空，不炸", () => {
    expect(validateRowFields(MODEL, "no_such_entity", {})).toEqual([]);
  });
});

describe("行内操作 · 「查看」和「编辑」不能是同一个事件", () => {
  /**
   * 源码级断言用 Vite 的 `?raw`，不用 readFileSync：jsdom 环境下
   * `import.meta.url` 是 http:// 开头，fs 那条路直接报「URL must be of
   * scheme file」。这个坑本仓踩过，别再踩第二次。
   */
  it("操作列里两个链接发的事件名不同", () => {
    // 窗口收紧到 columns.push({...}) 这一个对象里——放宽会把后面别处正当的
    // rowSelect（行点击、rowSelection）扫进来，那条 not.toContain 就成了误报。
    const start = REGISTRY_SRC.indexOf('key: "__actions"');
    const block = REGISTRY_SRC.slice(start, REGISTRY_SRC.indexOf("\n    });", start));
    expect(start).toBeGreaterThan(0);
    expect(block).toContain('onAction("viewRequest"');
    expect(block).toContain('onAction("editRequest"');
    // 复用 rowSelect 正是那次"点了没反应"的成因
    expect(block).not.toContain('onAction("rowSelect"');
  });
});
