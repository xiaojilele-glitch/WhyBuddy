/**
 * capture-pages-demo — Pages 演示种子捕获器（E18，2026-07-16）。
 *
 * 老模板（2026-07-14）是旧引擎手工装配的；本脚本把「重新捕获」变成
 * 一条命令：对本地完整栈发起真实推演（新引擎：E17 证据管道 + P2a
 * 真搜索 + 并行屏障），从 drive-full-stream 的 SSE 事件流里收集
 * 模板所需全部字段，直接生成 TS 文件。
 *
 * 用法（先起 vite:3000 + python:9700）：
 *   node scripts/capture-pages-demo.mjs --topic "<意图>" \
 *     --template client/src/pages/sliderule/github-pages-demo-template.ts
 *   node scripts/capture-pages-demo.mjs --topic "<意图>" --gallery-out <path.json>
 *     （画廊示例模式：只导出闭环终态的瘦身版）
 */
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const arg = name => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const TOPIC = arg("topic");
const TEMPLATE_OUT = arg("template");
const GALLERY_OUT = arg("gallery-out");
const BASE = arg("base") || "http://localhost:3000";
const AUTH_TOKEN = process.env.SLIDERULE_TEST_AUTH_TOKEN || "";
const requestHeaders = {
  "Content-Type": "application/json",
  ...(AUTH_TOKEN ? { Cookie: `sliderule_token=${AUTH_TOKEN}` } : {}),
};
if (!TOPIC || (!TEMPLATE_OUT && !GALLERY_OUT)) {
  console.error("usage: --topic <意图> (--template <ts路径> | --gallery-out <json路径>)");
  process.exit(2);
}

const sid = `pages-demo-${Date.now()}`;
const log = m => process.stderr.write(`[capture] ${m}\n`);

// 1) 种子会话
const put = await fetch(`${BASE}/api/sliderule/sessions/${sid}`, {
  method: "PUT",
  headers: requestHeaders,
  body: JSON.stringify({
    sessionId: sid,
    goal: { text: TOPIC, status: "clear" },
    runtimePhase: "idle",
  }),
});
if (!put.ok) throw new Error(`seed PUT ${put.status}`);
log(`session ${sid} seeded`);

// 2) 真实推演，逐事件收集
const res = await fetch(`${BASE}/api/sliderule/drive-full-stream`, {
  method: "POST",
  headers: requestHeaders,
  body: JSON.stringify({ sessionId: sid, userText: TOPIC }),
});
if (!res.ok || !res.body) throw new Error(`stream POST ${res.status}`);

const skillLabels = new Map();
const skills = [];
let chatSummary = "";
let publishClosure = null;
let finalState = null;

const reader = res.body.getReader();
const decoder = new TextDecoder();
let buf = "";
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true });
  const lines = buf.split("\n");
  buf = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.startsWith("data:")) continue;
    let event;
    try {
      event = JSON.parse(line.slice(5).trim());
    } catch {
      continue;
    }
    switch (event.type) {
      case "skill_start":
        skillLabels.set(event.skill, event.label);
        break;
      case "skill_result":
        if (event.modelSection && !event.error) {
          skills.push({
            skill: event.skill,
            label: skillLabels.get(event.skill) || event.skill,
            mermaid: event.mermaid || "",
            modelSection: event.modelSection,
          });
          log(`skill_result ${event.skill} (${skills.length}/6)`);
        }
        break;
      case "llm_delta":
        if (event.label === "closure.summary") chatSummary += event.text || "";
        break;
      case "publish_closure":
        publishClosure = event.data;
        break;
      case "complete":
        finalState = event.state || null;
        break;
      default:
        break;
    }
  }
}
log(`stream done: skills=${skills.length} summary=${chatSummary.length}chars closure=${publishClosure ? "yes" : "no"}`);

// 3) 结构不变量自检（与门里的 demo 测试同口径——不合格宁可失败不产出）
const ORDER = ["dataModel", "rbac", "workflow", "page", "aigc", "appBundle"];
const order = skills.map(s => s.skill);
if (JSON.stringify(order) !== JSON.stringify(ORDER)) {
  throw new Error(`skill order mismatch: ${order.join(",")}`);
}
if (!publishClosure || publishClosure.blocked || publishClosure.evidencePresentCount !== 6) {
  throw new Error(`closure not clean: ${JSON.stringify(publishClosure).slice(0, 160)}`);
}
if (chatSummary.trim().length <= 100) throw new Error("chatSummary too short");

if (TEMPLATE_OUT) {
  const now = new Date().toISOString().slice(0, 10);
  const ts = `/**
 * GitHub Pages 演示模板 — 由真实 LLM 全程推演一次性捕获（${now}，
 * gpt-5.5 · 新引擎：E17 证据上下文管道 + P2a 真搜索 + 轮内并行屏障），
 * 非手写数据。生成器：scripts/capture-pages-demo.mjs（一条命令重录）。
 *
 * 用途：Pages 静态演示没有后端，访客点「发送」后由
 * github-pages-demo-playback.ts 按本模板回放推演过程与发布闭环。
 */

export type GithubPagesDemoSkillCapture = {
  skill: string;
  label: string;
  mermaid: string;
  modelSection: Record<string, unknown>;
};

export type GithubPagesDemoTemplate = {
  goal: string;
  skills: GithubPagesDemoSkillCapture[];
  publishClosure: Record<string, unknown>;
  chatSummary: string;
};

export const GITHUB_PAGES_DEMO_TEMPLATE: GithubPagesDemoTemplate = ${JSON.stringify(
    { goal: TOPIC, skills, publishClosure, chatSummary },
    null,
    2
  )};
`;
  writeFileSync(TEMPLATE_OUT, ts);
  log(`template written: ${TEMPLATE_OUT}`);
}

if (GALLERY_OUT) {
  if (!finalState) {
    // complete 事件没带 state 就回读会话
    const got = await fetch(`${BASE}/api/sliderule/sessions/${sid}`);
    finalState = (await got.json())?.state ?? null;
  }
  if (!finalState) throw new Error("no final state for gallery seed");
  // 瘦身：应用可运行所需 = goal + publishClosure(perSkillEvidence)；
  // 报告正文保留（打开示例要能读结论），其余产物内容截断
  const slim = {
    ...finalState,
    sessionId: undefined,
    artifacts: (finalState.artifacts || []).map(a => ({
      ...a,
      content:
        a.kind === "report"
          ? a.content
          : String(a.content || "").slice(0, 400),
    })),
    sessionReplayLog: [],
    reasoningEvents: [],
  };
  writeFileSync(GALLERY_OUT, JSON.stringify({ goal: TOPIC, state: slim }, null, 1));
  log(`gallery seed written: ${GALLERY_OUT}`);
}
