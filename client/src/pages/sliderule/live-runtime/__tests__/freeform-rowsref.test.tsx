import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExperienceBlockBoundary } from "../block-registry";
import type { ExperienceBlockInstance, FreeformNode } from "../block-registry";
import type { RuntimeRow } from "../live-runtime";

/**
 * rowsRef 逐行绑定（2026-08-03）。
 *
 * 这是"首页只由 LLM 动态设计"能成立的前提：设计模型自由画列表版式，逐行
 * 数据由这条路喂真的。此前 freeform 只有聚合值（dataRef），逐行内容画出来
 * 是表头加一片空白，只能靠固定积木（blockRef）补——那条通道已随本次改动
 * 整体删除。
 *
 * 钉住四件事：真实行渲染得出来、排序/截断按声明走、白名单外的字段读不到、
 * 没数据时不编造占位行。
 */
describe("FreeformInsight rowsRef → 逐行真实数据", () => {
  const ROWS: RuntimeRow[] = [
    { id: "b1", values: { title: "晚安月亮", borrow: 12, isbn: "X-1" } },
    { id: "b2", values: { title: "好饿的毛毛虫", borrow: 37, isbn: "X-2" } },
    { id: "b3", values: { title: "猜猜我有多爱你", borrow: 5, isbn: "X-3" } },
  ] as unknown as RuntimeRow[];

  function renderTree(
    root: FreeformNode,
    entityRows: Record<string, RuntimeRow[]>
  ): string {
    const block: ExperienceBlockInstance = {
      id: "b1",
      type: "FreeformInsight",
      freeformContent: { root: root as unknown as Record<string, unknown> },
    };
    return renderToStaticMarkup(
      <ExperienceBlockBoundary block={block} entityRows={entityRows} />
    );
  }

  /** 列表容器 + 一行的模板（书名 + 借阅次数） */
  const listRoot = (rowsRef: FreeformNode["rowsRef"]): FreeformNode => ({
    tag: "div",
    rowsRef,
    children: [
      {
        tag: "div",
        children: [
          { tag: "span", fieldRef: "title" },
          { tag: "span", fieldRef: "borrow" },
        ],
      },
    ],
  });

  it("把真实行渲染出来，不是空表身", () => {
    const html = renderTree(
      listRoot({ entityRef: "book", fieldRefs: ["title", "borrow"] }),
      { book: ROWS }
    );
    expect(html).toContain("晚安月亮");
    expect(html).toContain("好饿的毛毛虫");
    expect(html).toContain("猜猜我有多爱你");
  });

  it("按 sortByRef + order 排序，并按 limit 截断", () => {
    const html = renderTree(
      listRoot({
        entityRef: "book",
        fieldRefs: ["title", "borrow"],
        sortByRef: "borrow",
        order: "desc",
        limit: 2,
      }),
      { book: ROWS }
    );
    // 借阅 37 > 12 > 5，取前 2 条且高的在前
    expect(html).toContain("好饿的毛毛虫");
    expect(html).toContain("晚安月亮");
    expect(html).not.toContain("猜猜我有多爱你");
    expect(html.indexOf("好饿的毛毛虫")).toBeLessThan(html.indexOf("晚安月亮"));
  });

  it("asc 反向排序", () => {
    const html = renderTree(
      listRoot({
        entityRef: "book",
        fieldRefs: ["title", "borrow"],
        sortByRef: "borrow",
        order: "asc",
        limit: 2,
      }),
      { book: ROWS }
    );
    expect(html).toContain("猜猜我有多爱你");
    expect(html).not.toContain("好饿的毛毛虫");
  });

  it("fieldRefs 没声明的字段读不到——显示「—」而不是泄露值", () => {
    const html = renderTree(
      {
        tag: "div",
        rowsRef: { entityRef: "book", fieldRefs: ["title"] },
        children: [
          {
            tag: "div",
            children: [
              { tag: "span", fieldRef: "title" },
              { tag: "span", fieldRef: "isbn" },
            ],
          },
        ],
      },
      { book: ROWS }
    );
    expect(html).toContain("晚安月亮");
    expect(html).not.toContain("X-1");
    expect(html).toContain("—");
  });

  it("一行数据都没有时渲染成空，不画一条全是「—」的假行", () => {
    const html = renderTree(
      listRoot({ entityRef: "book", fieldRefs: ["title", "borrow"] }),
      { book: [] }
    );
    expect(html).not.toContain("—");
  });

  it("实体在运行时查不到时同样不编造占位行", () => {
    const html = renderTree(
      listRoot({ entityRef: "ghost", fieldRefs: ["title", "borrow"] }),
      { book: ROWS }
    );
    expect(html).not.toContain("—");
  });

  it("limit 超上限时被夹住——快照恢复不过 Pydantic，这里是第二道", () => {
    const many: RuntimeRow[] = Array.from({ length: 50 }, (_, i) => ({
      id: `r${i}`,
      values: { title: `书${i}`, borrow: i },
    })) as unknown as RuntimeRow[];
    const html = renderTree(
      listRoot({ entityRef: "book", fieldRefs: ["title", "borrow"], limit: 999 }),
      { book: many }
    );
    const hits = (html.match(/书\d+/g) ?? []).length;
    expect(hits).toBeLessThanOrEqual(20);
  });
});
