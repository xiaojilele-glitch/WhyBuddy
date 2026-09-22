/**
 * G2 验证：字段清单驱动结构，加字段列会不会自己长出来。
 *
 * 跟 G 的关键差别在②：G 只是往**数据**里加一列（模板没那个 <td>，必然不跟）；
 * G2 是往**数据模型**里加一个字段定义，然后看运行时会不会按新的字段清单
 * 多渲染一列。这才是"改 JSON 就能迭代"的真判据。
 *
 * 解释器（约 55 行）比 G 那版多做一件事：表头和单元格都按 fields 清单展开，
 * 而不是按模板里画好的格子。这正是 DataTable 的契约，只是搬进了属性。
 */
import pkg from "/home/user/WhyBuddy/node_modules/@playwright/test/index.js";
const { chromium } = pkg;
import fs from "node:fs";

const [, , file, url] = process.argv;
const R = { file, errors: [], cols0: 0, rows: 0, valuesOk: false,
            colsAfter: 0, newColumn: false, note: [] };

const FIELDS = [
  { id: "customer_name", name: "客户姓名" },
  { id: "contact_method", name: "联系方式" },
  { id: "customer_status", name: "客户状态" },
  { id: "next_follow_up_at", name: "下次跟进时间" },
];
const NEW_FIELD = { id: "credit_level", name: "信用等级" };
const ROWS = [
  { customer_name: "甲方一号", contact_method: "13800000001", customer_status: "跟进中",
    next_follow_up_at: "2026-08-15", credit_level: "AAA" },
  { customer_name: "乙方二号", contact_method: "13800000002", customer_status: "已成交",
    next_follow_up_at: "2026-08-18", credit_level: "BBB" },
  { customer_name: "丙方三号", contact_method: "13800000003", customer_status: "待跟进",
    next_follow_up_at: "2026-08-20", credit_level: "CCC" },
];

/** 字段清单驱动的解释器：表头和单元格都按 fields 展开，不按模板里画好的格子。 */
const RT = `
window.__render = function (fields, rows) {
  document.querySelectorAll("[data-head]").forEach(head => {
    const tpl = head.querySelector("[data-col]");
    if (!tpl) return;
    if (!head.__tpl) head.__tpl = tpl.cloneNode(true);
    const tr = tpl.parentElement;
    tr.innerHTML = "";
    fields.forEach(f => {
      const th = head.__tpl.cloneNode(true);
      th.textContent = f.name;
      tr.appendChild(th);
    });
  });
  document.querySelectorAll("[data-rows]").forEach(box => {
    let rowTpl = box.__rowTpl;
    if (!rowTpl) {
      rowTpl = box.querySelector("tr") || box.firstElementChild;
      if (!rowTpl) return;
      box.__rowTpl = rowTpl.cloneNode(true);
      rowTpl = box.__rowTpl;
    }
    const cellTpl = rowTpl.querySelector("[data-cell]");
    box.innerHTML = "";
    rows.forEach(row => {
      const tr = rowTpl.cloneNode(true);
      const anchor = tr.querySelector("[data-cell]");
      if (anchor && cellTpl) {
        const parent = anchor.parentElement;
        const rest = Array.from(parent.children).filter(c => !c.hasAttribute("data-cell"));
        parent.innerHTML = "";
        fields.forEach(f => {
          const cell = cellTpl.cloneNode(true);
          cell.textContent = row[f.id] != null ? String(row[f.id]) : "";
          parent.appendChild(cell);
        });
        rest.forEach(c => parent.appendChild(c));   // 操作列之类保持在最后
      }
      tr.setAttribute("data-testid", "row");
      box.appendChild(tr);
    });
  });
};`;

const b = await chromium.launch({ headless: true, args: ["--no-sandbox"],
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } });
const p = await ctx.newPage();
p.on("pageerror", e => R.errors.push(String(e).slice(0, 130)));

const headCols = () => p.locator("[data-head] th, [data-head] [data-col]").count();

try {
  await p.goto(url, { waitUntil: "networkidle", timeout: 45000 });
  await p.waitForTimeout(1200);

  // ① 4 个字段驱动
  await p.evaluate(([rt, f, r]) => { new Function(rt)(); window.__render(f, r); },
                   [RT, FIELDS, ROWS]);
  await p.waitForTimeout(700);
  R.cols0 = await headCols();
  R.rows = await p.locator('[data-testid="row"]').count();
  const t1 = await p.locator("body").innerText();
  R.valuesOk = ["甲方一号", "乙方二号", "丙方三号"].every(v => t1.includes(v));
  if (!R.valuesOk) R.note.push("3 行值没全渲染出来");
  if (t1.includes("信用等级") || t1.includes("AAA")) R.note.push("第 4 个字段之外的列提前出现了");

  // ② 往字段清单里加一个字段 —— 列会不会自己长出来
  await p.evaluate(([f, r]) => window.__render(f, r), [[...FIELDS, NEW_FIELD], ROWS]);
  await p.waitForTimeout(700);
  R.colsAfter = await headCols();
  const t2 = await p.locator("body").innerText();
  R.newColumn = t2.includes("信用等级") && t2.includes("AAA") && R.colsAfter === R.cols0 + 1;
  if (!R.newColumn) {
    R.note.push(`加字段后：表头 ${R.cols0}→${R.colsAfter} 列，`
      + `表头出现"信用等级"=${t2.includes("信用等级")}，单元格出现"AAA"=${t2.includes("AAA")}`);
  }
} catch (e) {
  R.note.push("中断: " + String(e).slice(0, 150));
}
R.errors = [...new Set(R.errors)].slice(0, 3);
console.log(JSON.stringify(R));
await b.close();
