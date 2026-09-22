// 收据必须报满整张名单；失败必须带上归因。
//
// 2026-09-17 生产那趟（pvr-124797421db4de58ab4cb56fee6b040a26bffa06）的原样形态：
// 收据里 10 条断言，而 TASK_ASSERTION_IDS 是 13 条；三条 reader_* 是 failed，
// detail/expected/actual 全 null。少掉的三条是被全局超时切的——但收据里
// "被切掉"和"这套本来就只有 10 条"完全同形，"超时还是真失败"也只能靠猜。
//
// ⚠ 这里的判据**喂真 Playwright 抛出来的 error**，不自己 new 一个带
//    matcherResult 的假对象（§一之二：自己构造的输入只能证明"我抄对了"）。
//
// ⚠ 覆盖是**分裂**的，别以为 CI 绿了就全跑过：
//    "重试到期"那种 error 只有真 web-first 断言给得出（expect.poll 不算，
//    它的 matcherResult 里没有 timeout 字段），所以 5 条要真浏览器。
//    CI 的 server-contract 段跑 test:project-receipt，没浏览器时那 5 条 SKIP，
//    补名单与归因词表那 5 条照跑；收据闸本身由 Python 侧
//    tests/test_verification_receipt_reports_the_whole_roster.py 在 CI 全量看着。
//    要跑满这 10 条：pnpm run test:project-browser（需要能起 chromium 的机器）。
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { classify, makeAssertion, runVerification, DETAIL_CODES, OBSERVED, TASK_SUITE_VERSION, TASK_ASSERTION_IDS, SUITE_VERSION, ASSERTION_IDS } from "./browser-runner.mjs";

const CHROME = process.env.SLIDERULE_CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

// 只为"取一个真的 Playwright error"而开；驱动的是本文件自己的 setContent，
// 不是模型生成的页面。产线 runner 的 chromiumSandbox:true 不受影响。
async function realErrors() {
  const browser = await chromium.launch({ headless: true, chromiumSandbox: false, executablePath: CHROME });
  try {
    const page = await (await browser.newContext()).newPage();
    await page.setContent("<main><h1>hi</h1></main>");
    const caught = {};
    const grab = async (key, run) => { try { await run(); } catch (error) { caught[key] = error; } };
    await grab("webFirst", () => expect(page.getByRole("button", { name: "无" })).toBeVisible({ timeout: 120 }));
    await grab("action", () => page.getByRole("button", { name: "无" }).click({ timeout: 120 }));
    return caught;
  } finally { await browser.close(); }
}

let cached;
const errors = async t => {
  if (cached === undefined) {
    try { cached = await realErrors(); } catch { cached = null; }
  }
  if (cached === null) t.skip("chromium 起不来");
  return cached;
};

test("web-first 断言等不到元素，归因是 timeout", async t => {
  const caught = await errors(t);
  if (!caught) return;
  assert.equal(classify(caught.webFirst), "timeout");
});

test("locator 动作等不到元素，归因也是 timeout", async t => {
  const caught = await errors(t);
  if (!caught) return;
  assert.equal(caught.action.name, "TimeoutError");
  assert.equal(classify(caught.action), "timeout");
});

test("超时的消息并不以 Timed out 开头——所以判据不许盯字面", async t => {
  // ⚠ 反向判据，钉住 2026-09-17 踩的那一脚：第一版 classify 用
  //   /^Timed out/ 匹配 message，实测 pw1.61 的消息是
  //   "expect(locator).toBeVisible() failed"，前缀判据直接打空，
  //   所有超时被归成 assertion，而闸照样绿。
  const caught = await errors(t);
  if (!caught) return;
  assert.ok(!/^Timed out/.test(String(caught.webFirst.message)));
  assert.equal(typeof caught.webFirst.matcherResult.timeout, "number");
});

test("普通值比较不匹配，归因是 assertion 不是 timeout", () => {
  let caught;
  try { expect(1).toBe(2); } catch (error) { caught = error; }
  assert.ok(caught.matcherResult, "这是真 expect 抛的");
  assert.equal(caught.matcherResult.timeout, undefined);
  assert.equal(classify(caught), "assertion");
});

test("其它抛出物归到 error，且归因永远落在封闭词表里", () => {
  assert.equal(classify(new Error("boom")), "error");
  assert.equal(classify(undefined), "error");
  for (const sample of [new Error("boom"), undefined, { matcherResult: {} }])
    assert.ok(DETAIL_CODES.includes(classify(sample)));
});

// —— 名单报满 ——

const brokenInput = suiteVersion => ({
  verificationId: "verification-1", revision: "prv-" + "a".repeat(32), suiteVersion,
  scope: { origin: "https://example.invalid", projectId: "prj-1", runtimeId: "rt-1" },
  entryUrl: "https://example.invalid/_whybuddy/authorize?ticket=" + "b".repeat(32) + "&extra=1",
});

test("套件一条没跑，收据也要把整张名单列出来", async () => {
  // 入参非法 → validateInput 抛 → 走 catch → finally 补名单，全程不开浏览器。
  const report = await runVerification(brokenInput(TASK_SUITE_VERSION));
  assert.equal(report.status, "blocked");
  assert.deepEqual(report.assertions.map(item => item.id).sort(), [...TASK_ASSERTION_IDS].sort());
  assert.ok(report.assertions.every(item => item.status === "not_run"));
});

test("计数器套件同样报满——§4：两套共用一个补名单的地方", async () => {
  const report = await runVerification(brokenInput(SUITE_VERSION));
  assert.deepEqual(report.assertions.map(item => item.id).sort(), [...ASSERTION_IDS].sort());
});

test("补名单不许覆盖已经跑出结论的那几条", async () => {
  // 正向判据说"名单齐了"，这条是配套的反向判据：齐不是靠把结论抹平换来的。
  const report = await runVerification(brokenInput(TASK_SUITE_VERSION));
  const ids = report.assertions.map(item => item.id);
  assert.equal(ids.length, new Set(ids).size, "补名单不许制造重复条目");
});

// —— 产出侧真的会填 ——
// ⚠ 上面那些判据全是拿现成的 error 喂 classify，**证明不了收据里真有 detail**。
//   2026-09-17 实测：把 makeAssertion 里的 detail 删掉，Python 侧 15 条判据
//   一条都不红。下面这两条直接跑产线的 makeAssertion，是那个缺口的补丁。

test("产线的断言工厂：失败条目真的带着归因进收据", async t => {
  const caught = await errors(t);
  if (!caught) return;
  const report = { assertions: [] };
  const assertion = makeAssertion(report, null);
  await assertion("reader_login", () => { throw caught.webFirst; });
  await assertion("task_create", async () => { /* 通过 */ });
  assert.deepEqual(report.assertions, [
    { id: "reader_login", status: "failed", detail: "timeout" },
    { id: "task_create", status: "passed" },
  ]);
});

test("通过的条目不带归因，失败的一定带", async t => {
  const caught = await errors(t);
  if (!caught) return;
  const report = { assertions: [] };
  const assertion = makeAssertion(report, null);
  await assertion("a", () => { throw caught.action; });
  await assertion("b", () => { let e; try { expect(1).toBe(2); } catch (error) { e = error; } throw e; });
  await assertion("c", async () => {});
  const byId = Object.fromEntries(report.assertions.map(item => [item.id, item]));
  assert.equal(byId.a.detail, "timeout");
  assert.equal(byId.b.detail, "assertion");
  assert.equal("detail" in byId.c, false);
  for (const item of report.assertions)
    assert.equal("detail" in item, item.status === "failed");
  assert.ok(report.assertions.filter(i => i.status === "failed").every(i => DETAIL_CODES.includes(i.detail)));
});

// —— 失败断言要说清楚拿到了什么 ——
// ⚠ 2026-09-17 第二趟真机：reader_login 的 detail=assertion 只说明"值不对"，
//    拿到 writer（登录串号）和拿到 none（session 查不到人）分不开。
//    note() 把那个值带进收据，但只带封闭词表里的短标记。

const failing = async (note, want, got) => {
  note(want, got);
  expect(got).toBe(want);   // 真 expect，抛的是真 matcherResult
};

test("值不匹配时，收据带上真正拿到的那个", async () => {
  const report = { assertions: [] };
  const assertion = makeAssertion(report, null);
  await assertion("reader_login", note => failing(note, "reader", "writer"));
  assert.deepEqual(report.assertions[0], {
    id: "reader_login", status: "failed", detail: "assertion",
    expected: "reader", actual: "writer",
  });
});

test("拿到 undefined 记成 none，跟拿到 writer 分得开", async () => {
  const report = { assertions: [] };
  const assertion = makeAssertion(report, null);
  await assertion("reader_login", note => failing(note, "reader", undefined));
  assert.equal(report.assertions[0].actual, "none");
});

test("词表之外的值一律收敛成 unexpected_value，不许原样进收据", async () => {
  const report = { assertions: [] };
  const assertion = makeAssertion(report, null);
  for (const leak of ["provider-secret", "https://private.example/?ticket=secret",
                      "<script>alert(1)</script>", "admin", "writer ", "1234"])
    await assertion("reader_login", note => failing(note, "reader", leak));
  for (const item of report.assertions) assert.equal(item.actual, "unexpected_value");
  const receipt = JSON.stringify(report);
  assert.ok(!receipt.includes("secret") && !receipt.includes("script"));
});

test("通过的断言不带观测值，哪怕断言体记过一笔", async () => {
  // 反向判据：note() 只是记账，通过了就不该出现在收据里。
  const report = { assertions: [] };
  const assertion = makeAssertion(report, null);
  await assertion("writer_login", note => { note("writer", "writer"); });
  assert.deepEqual(report.assertions[0], { id: "writer_login", status: "passed" });
});

test("抛出时用最后一笔——一条断言里连比几个值也认得出是哪个挂的", async () => {
  const report = { assertions: [] };
  const assertion = makeAssertion(report, null);
  await assertion("reader_api_forbidden", async note => {
    note("403", 403); expect(403).toBe(403);      // 第一发过
    note("403", 401); expect(401).toBe(403);      // 第二发挂
  });
  assert.equal(report.assertions[0].actual, "401");
});

test("词表本身只认我们自己产生的短标记", () => {
  for (const ok of ["writer", "reader", "none", "403", "401", "200", "599"])
    assert.ok(OBSERVED.test(ok), ok);
  for (const no of ["admin", "writer ", "WRITER", "", "1234", "99", "600", "provider-secret", "reader\n"])
    assert.ok(!OBSERVED.test(no), no);
});

// —— 产线套件真的在记那一笔 ——
// ⚠ 上面那些判据都是自己造个断言体喂 makeAssertion，**证明不了产线的
//    reader_login 真的调了 note()**——2026-09-17 早些时候同样的漏就让
//    "删掉 detail 填充，15 条判据一条不红"发生过一次（§3）。
//    这条照 arch_graph.py:848 handoff_is_live_from 的路子，直接查真源码。
//    ⚠ 匹配前**先剥注释**：本仓被"标识符同时出现在注释里、变异后照样绿"
//    咬过（§2），而上面那几段注释里正好写满了 note( 和 reader_login。

const SOURCE = readFileSync(fileURLToPath(new URL("./browser-runner.mjs", import.meta.url)), "utf8");
const stripped = SOURCE
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").filter(line => !line.trim().startsWith("//")).join("\n");

const bodyOf = id => {
  const start = stripped.indexOf(`await assertion("${id}"`);
  if (start < 0) return null;
  const next = stripped.indexOf("await assertion(", start + 20);
  return stripped.slice(start, next < 0 ? undefined : next);
};

test("剥注释这一步本身有效——否则下一条会被注释喂饱", () => {
  assert.ok(SOURCE.includes("note("), "注释+代码里都有");
  assert.ok(!stripped.includes("⚠"), "注释已经被剥掉了");
});

test("产线套件里，每条被授权带值的断言都真的记了那一笔", () => {
  // 跟 Python 侧 TASK_EXPECTED 同一张表（§4）。
  for (const id of ["writer_login", "reader_login", "reader_api_session",
                    "reader_api_forbidden", "anonymous_api_forbidden"]) {
    const body = bodyOf(id);
    assert.ok(body, `源码里没有 assertion("${id}")`);
    assert.ok(/\bnote\(/.test(body), `assertion("${id}") 的函数体里没有 note( 调用`);
    assert.ok(/async note\b|\(note\)|note =>/.test(body), `assertion("${id}") 没有接住 note 形参`);
  }
});

test("没被授权带值的断言不许偷偷记——反向", () => {
  for (const id of ["task_create", "task_edit", "task_filter", "task_refresh", "reader_create", "reader_ui_readonly"]) {
    const body = bodyOf(id);
    assert.ok(body, id);
    assert.ok(!/\bnote\(/.test(body), `assertion("${id}") 记了值，但收据闸不放行它`);
  }
});

test("两条只读登录判据必须走**不同**的凭据来源，否则拆了等于没拆", () => {
  // ⚠ 2026-09-18：拆成 reader_login（页面 fetch）与 reader_api_session
  //   （context.request）是为了分辨"哪一侧的凭据没跟上"。如果两条都用同一个
  //   来源，收据里会永远一起红或一起绿，等于白拆——这条反向判据钉住这点。
  const page_ = bodyOf("reader_login");
  const api_ = bodyOf("reader_api_session");
  assert.ok(page_ && api_);
  assert.ok(/page\.evaluate\(/.test(page_), "reader_login 该走页面自己的 fetch");
  assert.ok(!/\bawait api\(/.test(page_), "reader_login 不该再用 context.request");
  assert.ok(/\bawait api\(/.test(api_), "reader_api_session 该走 context.request");
  assert.ok(!/page\.evaluate\(/.test(api_), "reader_api_session 不该走页面");
});
