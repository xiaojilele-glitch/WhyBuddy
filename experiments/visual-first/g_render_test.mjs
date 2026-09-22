/**
 * G 组验证：带绑定的 HTML 到底能不能被模型驱动，以及**加字段跟不跟**。
 *
 * 两项，第二项才是关键：
 *
 *   ① 提得动吗   —— 喂 3 行数据，页面渲染出 3 行，且值对得上
 *   ② 加字段跟不跟 —— 往 datamodel 里加一个字段、往数据里加一列，
 *                     UI 会不会自动多出来
 *
 * ②直接对应"改 JSON 就能无限迭代"这个主张。组件路线上 DataTable 天然会多一列
 * （结构是活的）；静态 HTML 里没有那个 <td>（结构是死的）。带了绑定之后是哪一种，
 * 跑一遍就知道——**这一项不该靠推理，靠观察**。
 *
 * data-* 方言的解释器就写在下面（约 40 行），故意写得很小：
 * 要证明的是"绑定标注够用"，不是"我能写个框架"。Alpine 那一路直接用 15KB 的官方包。
 */
import pkg from "/home/user/WhyBuddy/node_modules/@playwright/test/index.js";
const { chromium } = pkg;
import fs from "node:fs";

const [, , file, url, mode] = process.argv;
const R = { file, mode, errors: [], rows: 0, valuesOk: false, newField: false, note: [] };

// 三行测试数据：值故意取得好认，方便断言
const ROWS = [
  { id: "r1", customer_name: "甲方一号", contact_method: "13800000001", customer_status: "跟进中" },
  { id: "r2", customer_name: "乙方二号", contact_method: "13800000002", customer_status: "已成交" },
  { id: "r3", customer_name: "丙方三号", contact_method: "13800000003", customer_status: "待跟进" },
];
// ② 用的：给每行加一个新字段（模拟"往数据模型里加了一列"）
const ROWS2 = ROWS.map(r => ({ ...r, credit_level: "AAA信用等级" }));

/** data-* 方言的最小解释器（约 40 行）——跟自由树的 rowsRef/fieldRef 同语义。 */
const DATA_RUNTIME = `
window.__render = function (data) {
  document.querySelectorAll("[data-rows]").forEach(box => {
    const key = box.getAttribute("data-rows");
    const rows = (data[key] || []);
    if (!box.__tpl) box.__tpl = box.firstElementChild ? box.firstElementChild.cloneNode(true) : null;
    if (!box.__tpl) return;
    box.innerHTML = "";
    rows.forEach(row => {
      const node = box.__tpl.cloneNode(true);
      node.querySelectorAll("[data-field]").forEach(el => {
        const f = el.getAttribute("data-field");
        el.textContent = row[f] != null ? String(row[f]) : "";
      });
      if (node.hasAttribute && node.hasAttribute("data-field")) {
        const f = node.getAttribute("data-field");
        node.textContent = row[f] != null ? String(row[f]) : "";
      }
      node.setAttribute("data-testid", "row");
      box.appendChild(node);
    });
  });
  document.querySelectorAll("[data-value]").forEach(el => {
    const [ent, fld] = (el.getAttribute("data-value") || "").split(".");
    const first = (data[ent] || [])[0];
    if (first && first[fld] != null) el.textContent = String(first[fld]);
  });
};`;

const ALPINE_BOOT = data => `
document.addEventListener("alpine:init", () => {
  Alpine.data("app", () => ({ ...${JSON.stringify(data)},
    create(){}, edit(){}, remove(){} }));
});`;

const b = await chromium.launch({ headless: true, args: ["--no-sandbox"],
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } });
const p = await ctx.newPage();
p.on("pageerror", e => R.errors.push(String(e).slice(0, 130)));

async function drive(rows) {
  const data = { customer: rows };
  if (mode === "data") {
    await p.evaluate(([rt, d]) => {
      if (!window.__render) new Function(rt)();
      window.__render(d);
    }, [DATA_RUNTIME, data]);
  } else {
    await p.evaluate(d => {
      // Alpine 那一路：把根节点挂上 x-data，再让 Alpine 重新扫一遍
      const root = document.querySelector("[x-data]") || document.body;
      root.setAttribute("x-data", JSON.stringify({ ...d, create: null, edit: null, remove: null }));
      if (window.Alpine) window.Alpine.initTree(root);
    }, data);
  }
  await p.waitForTimeout(900);
}

try {
  await p.goto(url, { waitUntil: "networkidle", timeout: 45000 });
  await p.waitForTimeout(1500);

  await drive(ROWS);
  const txt1 = await p.locator("body").innerText();
  R.rows = await p.locator('[data-testid="row"]').count();
  const hit = ["甲方一号", "乙方二号", "丙方三号"].filter(v => txt1.includes(v));
  R.valuesOk = hit.length === 3;
  if (!R.valuesOk) R.note.push(`3 行数据只渲染出 ${hit.length} 个值`);
  // 展开后的占位行有没有被收成模板（还留着"客户A"就说明没收干净）
  if (/客户\s*[A-E]|示意|示例公司/.test(txt1)) R.note.push("原来的写死占位还在，没收成模板");

  // ② 加一个字段：数据里多一列，UI 跟不跟
  await drive(ROWS2);
  const txt2 = await p.locator("body").innerText();
  R.newField = txt2.includes("AAA信用等级");
  if (!R.newField) R.note.push("加了字段但界面上没出现——结构是死的");
} catch (e) {
  R.note.push("中断: " + String(e).slice(0, 150));
}
R.errors = [...new Set(R.errors)].slice(0, 3);
console.log(JSON.stringify(R));
await b.close();
