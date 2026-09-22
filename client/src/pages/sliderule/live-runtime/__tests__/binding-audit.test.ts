// @vitest-environment jsdom
import { expect, it } from "vitest";
import { applyBindings, implicitActionFromClick } from "../html-binding-runtime";

it("two ordinary lists stay ordinary lists and clicking opens the record", () => {
  const root = document.createElement("div");
  root.innerHTML = '<div data-rows="item"><p data-field="price"></p></div>'.repeat(2);
  applyBindings(root, { source: { rows: { item: [{ id: "a", price: 12 }] }, fields: { item: [{ id: "price", name: "Price" }] } } });
  expect(root.querySelectorAll('[data-row-id="a"]')).toHaveLength(2);
  expect(implicitActionFromClick(root.querySelector("p"), root)?.kind).toBe("openRecord");
});

it("ordinary aggregates do not multiply a domain qty column or turn missing prices into zero", () => {
  const root = document.createElement("div");
  root.innerHTML = '<span data-value="item" data-aggregate="sum" data-field="price"></span><span data-value="item" data-aggregate="avg" data-field="price"></span>';
  applyBindings(root, { source: { rows: { item: [{ price: 12, qty: 3 }, { price: 8, qty: 2 }, { price: null }, { price: "" }] }, fields: {} } });
  expect([...root.children].map(el => el.textContent)).toEqual(["20", "10"]);
});

it("cart quantities never overwrite an unbound numeric badge", () => {
  const root = document.createElement("div");
  root.innerHTML = '<div data-rows="item" data-view="cart"><p><b data-field="price"></b><span>123</span></p></div>';
  applyBindings(root, { source: { rows: { item: [] }, cartRows: { item: [{ id: "a", price: 12, qty: 3 }] }, fields: { item: [{ id: "price", name: "Price" }] } } });
  expect(root.querySelector("span")?.textContent).toBe("123");
});

it.each(["div", "table"])("%s cart quantities update only explicit quantity holes", tag => {
  const root = document.createElement("div");
  const row = '<b data-field="price"></b><span data-cart-qty>0</span><span class="badge">123</span>';
  root.innerHTML = tag === "table"
    ? `<table><tbody data-rows="item" data-view="cart"><tr><td>${row}</td></tr></tbody></table>`
    : `<div data-rows="item" data-view="cart"><p>${row}</p></div>`;
  const source = { rows: { item: [] }, cartRows: { item: [{ id: "a", price: 12, qty: 3 }] }, fields: { item: [{ id: "price", name: "Price" }] } };
  applyBindings(root, { source });
  expect(root.querySelector("[data-cart-qty]")?.textContent).toBe("3");
  source.cartRows.item[0].qty = 4;
  applyBindings(root, { source });
  expect(root.querySelector("[data-cart-qty]")?.textContent).toBe("4");
  expect(root.querySelector(".badge")?.textContent).toBe("123");
});
