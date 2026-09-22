/**
 * F 组的六步真交互验证——**在浏览器里点，不读代码**。
 *
 * 读代码判断"看起来能跑"没有意义：语法错、事件没绑上、数据没落住，
 * 都要真点一遍才暴露。每一步失败都如实记 false，不做"看起来实现了就算过"。
 */
import pkg from "/home/user/WhyBuddy/node_modules/@playwright/test/index.js";
const { chromium } = pkg;
import fs from "node:fs";

const [, , file, url] = process.argv;
const R = { file, open: false, errors: [], res404: [], rows0: 0, create: false, persist: false,
            validate: false, edit: false, del: false, note: [] };

const b = await chromium.launch({ headless: true, args: ["--no-sandbox"],
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
// 每份用**全新 context**：三份跑在同一个 origin 上，localStorage 会互相串——
// 上一份存进去的行会变成下一份的"初始数据"。第一轮就被这个污染过。
// 每份用**全新 context**。Playwright 的 context 本身就是存储隔离的——
// 这一条就够了。第一版我又加了 addInitScript 清 storage，结果**每次导航都清**，
// 连刷新那次也清，等于亲手把"持久化"这项测没了（三份全 false）。过度纠正比
// 原来的污染更糟：污染让数偏高，这个让数直接归零。
const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } });
const p = await ctx.newPage();
// open 只看**真的 JS 异常**（pageerror）。资源 404（favicon 之类）单独记，
// 不混进来——第一版拿 console error 判，favicon 把三份全判失败了。
p.on("pageerror", e => R.errors.push("JS异常: " + String(e).slice(0, 130)));
p.on("response", r => { if (r.status() >= 400) R.res404.push(`${r.status()} ${r.url().split("/").pop()}`); });

const rows = async () => p.locator('[data-testid="row"]').count();
const click = async (sel, ms = 700) => {
  const el = p.locator(sel).first();
  if (!(await el.count())) return false;
  await el.click({ timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(ms);
  return true;
};

try {
  await p.goto(url, { waitUntil: "networkidle", timeout: 45000 });
  await p.waitForTimeout(2500);
  R.rows0 = await rows();
  // open 只问"有没有报错"。初始 0 行不算失败——空库的 CRM 本来就该是空的，
  // 是不是"渲染得出来"由后面的新建那步验（0→1 就说明渲染管道是通的）。
  R.open = R.errors.length === 0;
  if (R.rows0 === 0) R.note.push("初始 0 行（可能是刻意空库）");

  // ④ 校验先测：空表单直接提交（放前面，免得被后面的新建污染）
  if (await click('[data-testid="btn-create"]')) {
    const before = await rows();
    await click('[data-testid="btn-submit"]');
    const errShown = (await p.locator('[data-testid="error"]:visible').count()) > 0;
    const blocked = (await rows()) === before;
    R.validate = errShown || blocked;
    if (!R.validate) R.note.push("空表单直接存进去了");
    await p.keyboard.press("Escape").catch(() => {});
    await p.waitForTimeout(400);
  } else R.note.push("找不到 btn-create");

  // ② 新建
  if (await click('[data-testid="btn-create"]')) {
    const fields = await p.locator('[data-testid^="field-"]').all();
    for (const f of fields.slice(0, 8)) {
      const tag = await f.evaluate(e => e.tagName.toLowerCase());
      if (tag === "select") {
        const opts = await f.locator("option").all();
        if (opts.length > 1) await f.selectOption({ index: 1 }).catch(() => {});
      } else {
        const type = await f.evaluate(e => e.getAttribute("type") || "text");
        const v = type === "number" ? "42" : type === "date" ? "2026-08-13" : "验证客户XYZ";
        await f.fill(v).catch(() => {});
      }
    }
    const before = await rows();
    await click('[data-testid="btn-submit"]', 1000);
    const after = await rows();
    R.create = after === before + 1;
    if (!R.create) R.note.push(`新建后行数 ${before}→${after}`);
  }

  // ③ 持久化：刷新再看
  if (R.create) {
    await p.reload({ waitUntil: "networkidle", timeout: 45000 });
    await p.waitForTimeout(2500);
    const txt = await p.locator("body").innerText();
    R.persist = txt.includes("验证客户XYZ");
    if (!R.persist) R.note.push("刷新后新建的那条不见了");
  }

  // ⑤ 编辑
  const beforeEdit = await p.locator("body").innerText();
  if (await click('[data-testid="btn-edit"]')) {
    const f = p.locator('[data-testid^="field-"]').first();
    if (await f.count()) {
      await f.fill("改过的名字ABC").catch(() => {});
      await click('[data-testid="btn-submit"]', 1000);
      R.edit = (await p.locator("body").innerText()).includes("改过的名字ABC");
      if (!R.edit) R.note.push("编辑提交后值没变");
    } else R.note.push("编辑表单里没有 field-*");
  } else R.note.push("找不到 btn-edit");

  // ⑥ 删除
  const beforeDel = await rows();
  p.on("dialog", d => d.accept().catch(() => {}));
  if (await click('[data-testid="btn-delete"]', 1000)) {
    R.del = (await rows()) === beforeDel - 1;
    if (!R.del) R.note.push(`删除后行数 ${beforeDel}→${await rows()}`);
  } else R.note.push("找不到 btn-delete");
} catch (e) {
  R.note.push("测试中断: " + String(e).slice(0, 160));
}
R.errors = [...new Set(R.errors)].slice(0, 4);
R.res404 = [...new Set(R.res404)].slice(0, 3);
console.log(JSON.stringify(R));
await b.close();
