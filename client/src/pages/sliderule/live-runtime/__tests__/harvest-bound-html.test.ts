// @vitest-environment jsdom
/**
 * 从打孔 HTML 收回来的数，才是这一份应用的运行时。
 *
 * 变异：仍走 seedRuntimeState 的「高原成品」，下面名字对不上、配方原料
 * 在档案里找不到。
 */
import { describe, expect, it } from "vitest";
import {
  adoptHarvestedRows,
  harvestBoundHtml,
  lockSeedDecisions,
} from "../harvest-bound-html";
import { seedRuntimeState } from "../demo-seed";
import { initRuntimeState } from "../live-runtime";
import type { FiveSystemModel } from "../../system-screens/five-system-model";

const MODEL: FiveSystemModel = {
  datamodel: {
    entities: [
      {
        id: "product",
        name: "烘焙成品",
        fields: [
          { id: "product_name", name: "成品名", type: "string" },
          { id: "spec", name: "规格", type: "string" },
          { id: "price", name: "售价", type: "number" },
        ],
      },
      {
        id: "material",
        name: "原料档案",
        fields: [
          { id: "material_name", name: "原料名", type: "string" },
          { id: "unit", name: "单位", type: "string" },
        ],
      },
      {
        id: "recipe",
        name: "配方",
        fields: [
          { id: "product_ref", name: "成品", type: "ref", refEntity: "product" },
          { id: "material_name", name: "原料名", type: "string" },
        ],
      },
    ],
  },
};

const CASHIER = `
  <div data-rows="product">
    <div class="grid grid-cols-4">
      <article>
        <h3 data-field="product_name">日式北海道奶油吐司</h3>
        <p data-field="spec">配方原料: 面粉/黄油/鲜奶</p>
        <span data-field="price">¥ 22.00</span>
      </article>
    </div>
  </div>
  <div class="space-y-3" data-rows="product">
    <div>
      <h4 data-field="product_name">日式北海道奶油吐司</h4>
      <span data-field="price">¥ 22.00</span>
    </div>
  </div>`;

const RECIPE = `
  <div data-rows="product">
    <div data-field="product_name">法式经典原味牛角颂</div>
    <div data-field="price">12.00</div>
  </div>
  <tbody data-rows="recipe">
    <tr>
      <td data-field="material_name">法国进口T55烘焙面粉</td>
      <td data-field="product_ref">法式经典原味牛角颂</td>
    </tr>
  </tbody>`;

const STOCK = `
  <tbody data-rows="material">
    <tr>
      <td data-field="material_name">特级法国面包粉 (T65)</td>
      <td data-field="unit">公斤</td>
    </tr>
  </tbody>`;

describe("harvestBoundHtml 收回页面上的数，不另编", () => {
  it("货架和购物车同一条吐司只留一行，价格是数字", () => {
    const got = harvestBoundHtml([CASHIER], MODEL, Date.UTC(2026, 8, 7));
    expect(got.product).toHaveLength(1);
    expect(got.product[0].values.product_name).toBe("日式北海道奶油吐司");
    expect(got.product[0].values.price).toBe(22);
    expect(JSON.stringify(got)).not.toContain("高原成品");
  });

  it("配方点到的牛角和 T55 面粉，档案里都有", () => {
    const got = harvestBoundHtml([CASHIER, RECIPE, STOCK], MODEL, Date.UTC(2026, 8, 7));
    const products = got.product.map(r => r.values.product_name);
    expect(products).toEqual(
      expect.arrayContaining(["日式北海道奶油吐司", "法式经典原味牛角颂"])
    );
    const materials = got.material.map(r => r.values.material_name);
    expect(materials).toEqual(
      expect.arrayContaining(["特级法国面包粉 (T65)", "法国进口T55烘焙面粉"])
    );
    expect(got.recipe[0].values.product_ref).toBe("法式经典原味牛角颂");
    expect(got.recipe[0].values.material_name).toBe("法国进口T55烘焙面粉");
  });

  it("adopt 换掉已有种子，不碰用户自己写的行", () => {
    const harvested = harvestBoundHtml([CASHIER], MODEL, Date.UTC(2026, 8, 7));
    const seeded = seedRuntimeState(initRuntimeState(MODEL), MODEL, Date.UTC(2026, 8, 7));
    expect(seeded.entities.product.some(r => String(r.values.product_name).includes("成品"))).toBe(
      true
    );
    const adopted = adoptHarvestedRows(seeded, harvested, MODEL);
    expect(adopted.entities.product.map(r => r.values.product_name)).toEqual([
      "日式北海道奶油吐司",
    ]);

    const withReal = {
      ...seeded,
      entities: {
        ...seeded.entities,
        product: [
          {
            id: "mine",
            values: { product_name: "我刚建的", price: 9 },
            createdAt: "",
          },
        ],
      },
    };
    expect(adoptHarvestedRows(withReal, harvested, MODEL).entities.product[0].id).toBe(
      "mine"
    );
  });

  it("有 HTML 之后 lock，再 seed 不许长出高原成品", () => {
    const harvested = harvestBoundHtml([CASHIER], MODEL, Date.UTC(2026, 8, 7));
    const locked = lockSeedDecisions(
      adoptHarvestedRows(initRuntimeState(MODEL), harvested, MODEL),
      MODEL
    );
    const again = seedRuntimeState(locked, MODEL, Date.UTC(2026, 8, 7));
    expect(again).toBe(locked);
    expect(JSON.stringify(again.entities)).not.toContain("高原");
  });
});
