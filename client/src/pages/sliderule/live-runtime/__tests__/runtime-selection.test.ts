/**
 * HTML 页的「当前这条」——区块页 PageFocusState 的同一份概念。
 *
 * 变异：把 selectRecord 调用从 handleHtmlAction 删掉，本文件必须红。
 * 变异：applyBindings 不读 source.selected，html-binding-runtime 那组必须红。
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { deriveBindingSource } from "../derive-binding-source";
import {
  addRow,
  addToCart,
  adjustCartQty,
  clearCart,
  deleteRow,
  initRuntimeState,
  selectRecord,
  type RuntimeState,
} from "../live-runtime";
import type { FiveSystemModel } from "../../system-screens/five-system-model";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function readFromCwd(rel: string): string {
  const found = [`client/${rel}`, rel]
    .map(c => resolve(process.cwd(), c))
    .find(c => existsSync(c));
  if (!found) throw new Error(`${rel} not found`);
  return readFileSync(found, "utf8");
}

const MODEL = {
  datamodel: {
    entities: [{ id: "vehicle", name: "车辆", fields: [{ id: "plate" }] }],
  },
} as unknown as FiveSystemModel;

function stateWithRows(): RuntimeState {
  return {
    entities: {
      vehicle: [
        { id: "v1", values: { plate: "京A" }, createdAt: "t" },
        { id: "v2", values: { plate: "京B" }, createdAt: "t" },
      ],
    },
    instances: [],
    seq: 2,
  };
}

describe("selectRecord / addRow / deleteRow", () => {
  it("钉的是表里真有的那一行", () => {
    const next = selectRecord(stateWithRows(), "vehicle", "v2");
    expect(next.selection).toEqual({ vehicle: "v2" });
  });

  it("行不在表里就不动 —— 不许把详情卡指到空气", () => {
    const before = stateWithRows();
    expect(selectRecord(before, "vehicle", "nope")).toBe(before);
    expect(selectRecord(before, "vehicle", "")).toBe(before);
  });

  it("新建保存把新行钉成当前这条", () => {
    const { state, row } = addRow(initRuntimeState(MODEL), "vehicle", { plate: "京C" }, "t");
    expect(state.selection?.vehicle).toBe(row.id);
    expect(state.entities.vehicle.some(r => r.id === row.id)).toBe(true);
  });

  it("删掉当前行会清掉选中；删别的行不动选中", () => {
    const pinned = selectRecord(stateWithRows(), "vehicle", "v2");
    const afterOther = deleteRow(pinned, "vehicle", "v1");
    expect(afterOther.selection).toEqual({ vehicle: "v2" });
    const afterCurrent = deleteRow(pinned, "vehicle", "v2");
    expect(afterCurrent.selection).toBeUndefined();
    expect(afterCurrent.entities.vehicle.map(r => r.id)).toEqual(["v1"]);
  });
});

describe("deriveBindingSource 把选中态交给解释器", () => {
  it("runtime.selection 出现在 BindingSource.selected", () => {
    const runtime = selectRecord(stateWithRows(), "vehicle", "v2");
    const src = deriveBindingSource(MODEL, runtime);
    expect(src.selected).toEqual({ vehicle: "v2" });
    expect(src.rows.vehicle.map(r => r.id)).toEqual(["v1", "v2"]);
  });

  it("没选过就不带 selected —— 空对象也会让解释器走第一行，但别造一份假选中", () => {
    const src = deriveBindingSource(MODEL, stateWithRows());
    expect(src.selected).toBeUndefined();
  });

  it("cartQty 摊成 cartRows 且带 qty；没点过的行不进车", () => {
    const runtime = addToCart(addToCart(stateWithRows(), "vehicle", "v1"), "vehicle", "v1");
    const src = deriveBindingSource(MODEL, runtime);
    expect(src.cartRows.vehicle).toEqual([{ id: "v1", plate: "京A", qty: 2 }]);
    expect(src.rows.vehicle.map(r => r.id)).toEqual(["v1", "v2"]);
  });
});

describe("购物车数量", () => {
  it("addToCart 累加；adjust 到 0 删除；clear 整表", () => {
    let s = addToCart(stateWithRows(), "vehicle", "v1");
    expect(s.cartQty?.vehicle.v1).toBe(1);
    s = addToCart(s, "vehicle", "v1");
    expect(s.cartQty?.vehicle.v1).toBe(2);
    s = adjustCartQty(s, "vehicle", "v1", -2);
    expect(s.cartQty?.vehicle.v1).toBeUndefined();
    s = addToCart(stateWithRows(), "vehicle", "v1");
    s = clearCart(s, "vehicle");
    expect(s.cartQty?.vehicle).toBeUndefined();
  });

  it("行不在表里就不动", () => {
    const before = stateWithRows();
    expect(addToCart(before, "vehicle", "nope")).toBe(before);
  });
});

describe("活路径接上了，不是只写了函数", () => {
  it("SlideRuleStudio 点 openRecord/editRecord 真的调 selectRecord", () => {
    const src = stripComments(
      readFromCwd("src/pages/sliderule/SlideRuleStudio.tsx")
    );
    const from = src.indexOf("const handleHtmlAction");
    expect(from).toBeGreaterThan(-1);
    const body = src.slice(from, from + 4000);
    expect(body).toContain("selectRecord(");
    expect(body).toContain("openRecord");
    expect(body).toContain("editRecord");
    // 反向：不许只 import 不调用。上面已经钉了括号调用。
    expect(body).toMatch(/applyRuntime\(\s*selectRecord\(/);
    expect(body).toMatch(/applyRuntime\(\s*addToCart\(/);
    expect(body).toMatch(/applyRuntime\(\s*adjustCartQty\(/);
    expect(body).toMatch(/applyRuntime\(\s*clearCart\(/);
    expect(body).toContain('ev.kind === "checkout"');
  });

  it("解释器读 source.selected，不是只在类型上有这个字段", () => {
    const src = stripComments(
      readFromCwd("src/pages/sliderule/live-runtime/html-binding-runtime.ts")
    );
    const from = src.indexOf('root.querySelectorAll<HTMLElement>("[data-record]")');
    expect(from).toBeGreaterThan(-1);
    const body = src.slice(from, from + 900);
    expect(body).toContain("source.selected");
    expect(body).toContain("data-record-id");
  });
});
