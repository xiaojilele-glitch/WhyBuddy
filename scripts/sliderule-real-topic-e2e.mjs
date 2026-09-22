/**
 * 真实话题端到端：登录、新会话、问卷、计划批准、生成与闭环。
 * 2026-09-11：范围回执和专用假设卡已退役。所有问题经通用问卷回答，
 * 计划必须通过真正的批准按钮提交，不能以「已经在跑」替代用户批准。
 * 保留逐节点截图、页面可见性与控制面回执，超时不能作为成功退出。
 *
 * SLIDERULE_SMOKE_EMAIL / SLIDERULE_SMOKE_PASSWORD 配置账号。
 * PLAYWRIGHT_CHROMIUM_EXECUTABLE 可指定浏览器。
 * E2E_TOPIC / E2E_SHOT_DIR / E2E_BASE / E2E_DEADLINE_MIN 可覆盖默认值。
 * 默认选每题推荐项或首项；E2E_CLARIFY_ANSWER 指定「其他」的手写答案。
 */
import { chromium } from "playwright";
import fs from "node:fs";
import {
  answerQuestionnaire,
  approvePlan,
  measureDecision,
  visibleDecision,
} from "./sliderule-e2e-decisions.mjs";

const BASE = process.env.E2E_BASE || "http://localhost:3000";
const OUT = process.env.E2E_SHOT_DIR || ".manus-logs/e2e-shots";
const TOPIC =
  process.env.E2E_TOPIC ||
  "做一个社区诊所的预约与排班系统：医生排班、患者线上预约、到诊登记，管理员首页能看今天的预约量和空闲号源";
const DEADLINE_MS = Number(process.env.E2E_DEADLINE_MIN || 14) * 60 * 1000;
if (!Number.isFinite(DEADLINE_MS) || DEADLINE_MS <= 0)
  throw new Error("E2E_DEADLINE_MIN must be positive");
fs.mkdirSync(OUT, { recursive: true });
const log = (...args) => console.log("[e2e]", ...args);
let shotNumber = 0;
const shot = async (page, tag) => {
  const name = `${String(++shotNumber).padStart(2, "0")}-${tag}.png`;
  await page.screenshot({ path: `${OUT}/${name}`, fullPage: false });
  log("截图:", name);
};

const browser = await chromium.launch({
  args: ["--no-sandbox"],
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
});
const context = await browser.newContext({
  viewport: { width: 1600, height: 950 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(String(error).slice(0, 200)));
page.on("console", message => {
  const text = message.text();
  if (/\[连接器\]|\[control|control_|推演|error/i.test(text))
    log("浏览器:", text.slice(0, 160));
});
const result = {
  topic: TOPIC,
  approvedPlans: 0,
  answeredQuestionnaires: 0,
  done: false,
  errors,
};

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
      process.env.SLIDERULE_SMOKE_EMAIL || process.env.E || "",
      process.env.SLIDERULE_SMOKE_PASSWORD || process.env.P || "",
    ]
  );
  if (status !== 200) throw new Error(`Login returned HTTP ${status}`);

  await page.goto(`${BASE}/agent-loop/sliderule`, {
    waitUntil: "domcontentloaded",
  });
  // The real sidebar command changes session identity; never dismiss an old user's decision.
  await page
    .getByTestId("sidebar-session-new")
    .first()
    .click({ timeout: 60000 });
  const input = page.getByTestId("sliderule-composer-input").first();
  await page.waitForSelector(
    '[data-testid="sliderule-composer-input"]:not([disabled])',
    { timeout: 90000 }
  );
  await shot(page, "新建会话");
  await input.fill(TOPIC);
  await page.waitForSelector(
    '[data-testid="sliderule-composer-send"]:not([disabled])',
    { timeout: 60000 }
  );
  await shot(page, "输入需求");
  const firstTurn = page
    .waitForResponse(
      response =>
        response.url().includes("/control-turn-stream") &&
        response.request().method() === "POST",
      { timeout: 45000 }
    )
    .catch(error => error);
  await page.getByTestId("sliderule-composer-send").first().click();
  const posted = await firstTurn;
  if (posted instanceof Error) throw posted;
  if (!posted.ok())
    throw new Error(`First control turn returned HTTP ${posted.status()}`);
  await shot(page, "发送后");

  const started = Date.now();
  let lastStep = "";
  let nextPeriodicShot = 0;
  let factoryDone = false;
  let speechBeforeFactory = "";
  while (Date.now() - started < DEADLINE_MS) {
    const seconds = Math.round((Date.now() - started) / 1000);
    const decision = await visibleDecision(page);
    if (decision) {
      const measured = await measureDecision(page, decision);
      log(`${seconds}s ${decision}:`, JSON.stringify(measured));
      await shot(page, `${decision}-${seconds}s`);
      if (!measured.painted || !measured.inViewport || measured.covered)
        throw new Error(`${decision} is present but not visible to the user`);
      if (decision === "questionnaire") {
        const answer = await answerQuestionnaire(page, {
          otherAnswer: process.env.E2E_CLARIFY_ANSWER || "",
          onQuestion: async ({ step, question, answer }) => {
            log(`题 ${step}:`, question.slice(0, 160), "答案:", answer);
            await shot(
              page,
              `问卷-${result.answeredQuestionnaires + 1}-题-${step}`
            );
          },
        });
        result.answeredQuestionnaires += 1;
        log("问卷回执:", JSON.stringify(answer));
      } else {
        if (!result.approvedPlans) {
          const previews = await page
            .locator('[data-testid^="sliderule-artboard"], iframe')
            .count();
          if (previews)
            throw new Error(
              "Product previews appeared before the first plan approval"
            );
        }
        const approval = await approvePlan(page);
        result.approvedPlans += 1;
        fs.writeFileSync(
          `${OUT}/approved-plan-${result.approvedPlans}.txt`,
          approval.content,
          "utf8"
        );
        log("批准回执:", JSON.stringify(approval.answer));
        speechBeforeFactory = await page
          .locator('[data-host-speech="true"]')
          .first()
          .innerText()
          .catch(() => "");
      }
      continue;
    }

    const state = await page.evaluate(() => {
      const pick = selector =>
        document.querySelector(selector)?.textContent?.trim() || "";
      return {
        step: pick(
          '[data-testid^="sliderule-rehearsal-step-"][data-status="current"]'
        ),
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
        badge: pick('[data-testid="sliderule-publish-closure-badge"]'),
        step6Done:
          document
            .querySelector('[data-testid="sliderule-rehearsal-step-6"]')
            ?.getAttribute("data-status") === "done",
        interrupted: document.body.innerText.includes("推演中断"),
      };
    });
    log(
      `${seconds}s 页面框=${state.pages} 当前步=${state.step || "无"} 钟=${state.clock || "无"} 闭环=${state.badge || "无"}`
    );
    if (state.interrupted) throw new Error("The workbench shows 推演中断");
    if (!result.approvedPlans && state.pages)
      throw new Error("Product previews appeared without plan approval");
    if (state.step && state.step !== lastStep) {
      lastStep = state.step;
      await shot(
        page,
        `步骤-${state.step.replace(/[\\/:*?"<>|\s]+/g, "-").slice(0, 32)}-${seconds}s`
      );
    } else if (seconds >= nextPeriodicShot) {
      await shot(page, `推演-${seconds}s`);
      nextPeriodicShot = seconds + 40;
    }
    // Scope completion to the current workbench; sidebar titles can contain "闭环".
    if ((state.step6Done || state.badge) && state.pages && !factoryDone) {
      factoryDone = true;
      await shot(page, `工厂收工-${seconds}s`);
      log("工厂收工，等主 Agent 回应");
    }
    if (factoryDone) {
      const speech = await page
        .locator('[data-host-speech="true"]')
        .first()
        .innerText()
        .catch(() => "");
      const idle = !(await page.getByTestId("sliderule-composer-stop").count());
      if (
        idle &&
        speech.trim() &&
        speech !== speechBeforeFactory &&
        !speech.includes("我是面团的推演引擎") &&
        !speech.includes("当前模型摘要")
      ) {
        log("主 Agent 回应:", speech.trim().slice(0, 160));
        result.done = true;
        break;
      }
    }
    await page.waitForTimeout(3000);
  }
  if (!result.approvedPlans)
    throw new Error("No plan was presented and approved");
  if (!result.done)
    throw new Error(
      "Timed out before product generation and host response completed"
    );
  if (errors.length)
    throw new Error(`Browser raised ${errors.length} page errors`);
  await shot(page, "完成");
} catch (error) {
  result.failure = String(error);
  process.exitCode = 1;
  log("失败:", result.failure);
  await shot(page, "失败").catch(() => {});
} finally {
  const body = await page
    .locator("body")
    .innerText()
    .catch(() => "");
  fs.writeFileSync(`${OUT}/final-text.txt`, body, "utf8");
  fs.writeFileSync(
    `${OUT}/result.json`,
    JSON.stringify(result, null, 2),
    "utf8"
  );
  await browser.close();
}
