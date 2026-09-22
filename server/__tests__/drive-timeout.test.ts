/**
 * 推演转发不能用通用的 120s 超时。
 *
 * ## 这条测试为什么存在
 *
 * 2026-08-06 实测：一趟 drive-full 要 374~1190s（见 routes/sliderule_full.py 里
 * drive_full 那条注释）。而 Node 转发给 Python 用的是 fetch + AbortController，
 * 超时取 `resolvePythonSlideRuleRuntimeConfig().timeoutMs`——**默认 120 秒**。
 *
 * 后果不是"超时报错"这么干净：AbortController 掐断的只是 Node 这一端，Python
 * 侧那趟推演**还在跑**（drive_full 是 `def` 路由，跑在 Starlette 线程池里，
 * 客户端断开不会取消它）。于是用户第 2 分钟看到 502，后台继续烧 LLM 额度、
 * 十几分钟后还成功落库了。用户多半会再点一次，同一个话题生成两遍。
 *
 * 前端正常走 SSE（drive-full-stream，兜底代理裸 fetch 不设超时），所以这条
 * 非流式路是**回退路径**——回退路径出问题最难发现，正因为平时不走。
 */

import { describe, it, expect } from "vitest";
import {
  resolvePythonDriveTimeoutMs,
  resolvePythonSlideRuleRuntimeConfig,
} from "../sliderule/python-delegation.js";

describe("推演转发超时", () => {
  it("装得下实测最慢的那趟推演（1190s）", () => {
    // 取 2 倍余量：端点变慢、话题更复杂都还有空间。
    expect(resolvePythonDriveTimeoutMs({} as NodeJS.ProcessEnv)).toBeGreaterThanOrEqual(1190 * 2 * 1000);
  });

  it("明显长于通用超时——两者不是一回事，别合并", () => {
    // 通用值同时管着健康检查、llm-channel 这些秒级调用；调大它等于后端真挂了
    // 也要吊二十分钟才报错。慢的只有推演这一条，就只放宽这一条。
    const generic = resolvePythonSlideRuleRuntimeConfig({} as NodeJS.ProcessEnv).timeoutMs;
    expect(resolvePythonDriveTimeoutMs({} as NodeJS.ProcessEnv)).toBeGreaterThan(generic * 5);
  });

  it("可以用 PYTHON_SLIDE_RULE_DRIVE_TIMEOUT_MS 覆盖", () => {
    expect(
      resolvePythonDriveTimeoutMs({ PYTHON_SLIDE_RULE_DRIVE_TIMEOUT_MS: "999000" } as NodeJS.ProcessEnv)
    ).toBe(999000);
  });

  it("坏值回落到默认，不会变成 0（0 = 立刻中断）", () => {
    for (const bad of ["", "abc", "0", "-5"]) {
      const v = resolvePythonDriveTimeoutMs({ PYTHON_SLIDE_RULE_DRIVE_TIMEOUT_MS: bad } as NodeJS.ProcessEnv);
      expect(v).toBeGreaterThan(0);
      expect(v).toBe(resolvePythonDriveTimeoutMs({} as NodeJS.ProcessEnv));
    }
  });
});
