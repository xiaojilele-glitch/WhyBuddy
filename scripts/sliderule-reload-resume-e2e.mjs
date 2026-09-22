/**
 * 问卷和计划审批停泊时，真实刷新后仍能看见、作答，并继续生成页面。
 *
 * 2026-09-10 的旧探针曾错误地使用 ?session=<sid> 新开页面，测到另一会话；
 * 又在多题第一页查最后一页的提交按钮，误报刷新后不可用。这里保留同一浏览器
 * context 的 page.reload()，逐题选择并翻页，再检查真实 HTTP 决定回执。
 * 2026-09-11：计划批准和通用问卷取代 scope/assumption 专用卡。
 *
 * SLIDERULE_SMOKE_EMAIL / SLIDERULE_SMOKE_PASSWORD 配置账号。
 * E2E_TOPIC / E2E_SHOT_DIR / E2E_BASE / E2E_DEADLINE_MIN 可覆盖默认值。
 * 默认选推荐项或首项；E2E_CLARIFY_ANSWER 指定每题「其他」的手写答案。
 */
import { chromium } from "playwright";
import fs from "node:fs";
import {
  DECISIONS,
  answerQuestionnaire,
  approvePlan,
  measureDecision,
  visibleDecision,
} from "./sliderule-e2e-decisions.mjs";

const BASE = process.env.E2E_BASE || "http://localhost:3000";
const OUT = process.env.E2E_SHOT_DIR || ".manus-logs/reload-shots";
const TOPIC =
  process.env.E2E_TOPIC ||
  "做一个健身房的会员卡与私教排课系统：会员办卡、私教排课、到店签到，前台首页看今天的课表和到店人数";
const DEADLINE_MS = Number(process.env.E2E_DEADLINE_MIN || 14) * 60 * 1000;
if (!Number.isFinite(DEADLINE_MS) || DEADLINE_MS <= 0)
  throw new Error("E2E_DEADLINE_MIN must be positive");
fs.mkdirSync(OUT, { recursive: true });
const log = (...args) => console.log("[reload]", ...args);
const result = {
  topic: TOPIC,
  reloaded: [],
  questionnaires: 0,
  approvedPlans: 0,
  moved: false,
  failures: [],
  pageErrors: [],
};
const check = (ok, message) => {
  log(`${ok ? "PASS" : "FAIL"} ${message}`);
  if (!ok) result.failures.push(message);
};
const browser = await chromium.launch({
  args: ["--no-sandbox"],
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
});
const context = await browser.newContext({
  viewport: { width: 1600, height: 950 },
});
const page = await context.newPage();
page.on("pageerror", error => result.pageErrors.push(String(error)));
const screenshot = tag => page.screenshot({ path: `${OUT}/${tag}.png` });

async function reloadDecision(kind) {
  const before = await measureDecision(page, kind);
  log(`${kind} 刷新前:`, JSON.stringify(before));
  await screenshot(`${kind}-1-刷新前`);
  check(
    before.present && before.painted && before.inViewport && !before.covered,
    `${kind} 刷新前看得见`
  );
  const oldUrl = page.url();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page
    .getByTestId(DECISIONS[kind])
    .waitFor({ state: "visible", timeout: 90000 });
  const after = await measureDecision(page, kind);
  log(`${kind} 刷新后:`, JSON.stringify(after));
  await screenshot(`${kind}-2-刷新后`);
  check(page.url() === oldUrl, "刷新仍在原页面");
  check(
    after.present && after.painted && after.inViewport && !after.covered,
    `${kind} 刷新后看得见`
  );
  check(
    Boolean(before.content) && after.content === before.content,
    `${kind} 刷新后完整内容一致`
  );
  if (kind === "questionnaire")
    check(after.pager === before.pager, "问卷刷新后题数和停泊状态一致");
  result.reloaded.push(kind);
}

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  const status = await page.evaluate(
    async ([email, password]) =>
      (
        await fetch("/api/sliderule/account/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, password }),
        })
      ).status,
    [
      process.env.SLIDERULE_SMOKE_EMAIL || "",
      process.env.SLIDERULE_SMOKE_PASSWORD || "",
    ]
  );
  if (status !== 200) throw new Error(`Login returned HTTP ${status}`);
  await page.goto(`${BASE}/agent-loop/sliderule`, {
    waitUntil: "domcontentloaded",
  });
  await page
    .getByTestId("sidebar-session-new")
    .first()
    .click({ timeout: 60000 });
  await page.waitForSelector(
    '[data-testid="sliderule-composer-input"]:not([disabled])',
    { timeout: 90000 }
  );
  await page.getByTestId("sliderule-composer-input").first().fill(TOPIC);
  await page.waitForSelector(
    '[data-testid="sliderule-composer-send"]:not([disabled])',
    { timeout: 60000 }
  );
  await page.getByTestId("sliderule-composer-send").first().click();
  log("需求已发送，等待问卷与计划审批");

  const started = Date.now();
  let nextScreenshot = 0;
  while (Date.now() - started < DEADLINE_MS) {
    const kind = await visibleDecision(page);
    if (kind) {
      if (!result.reloaded.includes(kind)) await reloadDecision(kind);
      if (kind === "questionnaire") {
        const answer = await answerQuestionnaire(page, {
          otherAnswer: process.env.E2E_CLARIFY_ANSWER || "",
          onQuestion: async ({ step, question, answer }) => {
            log(`题 ${step}:`, question.slice(0, 160), "答案:", answer);
            await screenshot(
              `questionnaire-${result.questionnaires + 1}-题-${step}`
            );
          },
        });
        result.questionnaires += 1;
        log("刷新后问卷回执:", JSON.stringify(answer));
      } else {
        if (!result.approvedPlans)
          check(
            !(await page
              .locator('[data-testid^="sliderule-artboard"], iframe')
              .count()),
            "首次计划批准前没有生成页面"
          );
        const approval = await approvePlan(page);
        result.approvedPlans += 1;
        fs.writeFileSync(
          `${OUT}/approved-plan-${result.approvedPlans}.txt`,
          approval.content,
          "utf8"
        );
        log("刷新后批准回执:", JSON.stringify(approval.answer));
      }
      continue;
    }
    const state = await page.evaluate(() => ({
      clock: [
        ...document.querySelectorAll(
          '[data-testid^="sliderule-rehearsal-step-"]'
        ),
      ]
        .map(
          element =>
            `${element.getAttribute("data-step")}:${element.getAttribute("data-status")}`
        )
        .join(","),
      pages: document.querySelectorAll(
        '[data-testid^="sliderule-artboard"], iframe'
      ).length,
      interrupted: document.body.innerText.includes("推演中断"),
    }));
    const seconds = Math.round((Date.now() - started) / 1000);
    log(`${seconds}s 钟=${state.clock || "无"} 页面框=${state.pages}`);
    if (state.interrupted) throw new Error("The workbench shows 推演中断");
    if (state.pages) {
      check(result.approvedPlans > 0, "页面生成前已真实提交计划批准");
      result.moved = result.approvedPlans > 0;
      break;
    }
    if (seconds >= nextScreenshot) {
      await screenshot(`继续生成-${seconds}s`);
      nextScreenshot = seconds + 30;
    }
    await page.waitForTimeout(3000);
  }
  check(
    result.reloaded.includes("questionnaire"),
    "本次真实覆盖了问卷刷新恢复"
  );
  check(result.reloaded.includes("plan"), "本次真实覆盖了计划批准刷新恢复");
  check(result.questionnaires > 0, "刷新后的问卷成功提交结构化答案");
  check(result.approvedPlans > 0, "刷新后的计划成功提交批准");
  check(result.moved, "批准后生成继续，页面实际出现");
  check(result.pageErrors.length === 0, "浏览器无页面异常");
  await screenshot("3-操作后");
} catch (error) {
  result.failures.push(String(error));
  log("失败:", String(error));
  await screenshot("失败").catch(() => {});
} finally {
  fs.writeFileSync(
    `${OUT}/result.json`,
    JSON.stringify(result, null, 2),
    "utf8"
  );
  fs.writeFileSync(
    `${OUT}/final-text.txt`,
    await page
      .locator("body")
      .innerText()
      .catch(() => ""),
    "utf8"
  );
  await browser.close();
}
log(result.failures.length ? `${result.failures.length} 条未通过` : "全部通过");
process.exitCode = result.failures.length ? 1 : 0;
