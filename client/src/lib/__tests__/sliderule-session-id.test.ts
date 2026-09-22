import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SESSION_ID,
  SESSION_QUERY_KEY,
  SessionIdMismatchError,
  applySessionToHistory,
  assertDriveSessionMatchesShell,
  hrefFromWindow,
  hrefWithSession,
  isSliderulePath,
  resolveActiveSessionId,
  sessionIdFromHref,
  sessionIdFromSearch,
  slideruleSessionPath,
} from "../sliderule-session-id";

describe("assertDriveSessionMatchesShell", () => {
  it("对齐时返回壳上的 sessionId", () => {
    expect(assertDriveSessionMatchesShell("sr-1", "sr-1")).toBe("sr-1");
    expect(assertDriveSessionMatchesShell("", "sr-1")).toBe("sr-1");
  });

  it("反向：推演会话和当前会话不等必须抛，不许静默择一", () => {
    expect(() =>
      assertDriveSessionMatchesShell("sr-clinic", "sr-library")
    ).toThrow(SessionIdMismatchError);
  });
});

describe("DEFAULT_SESSION_ID 只许定义一次", () => {
  it("字面量只出现在本文件（生产代码，剥注释）", () => {
    const { readdirSync, readFileSync, statSync } = require("node:fs") as typeof import("node:fs");
    const { join, relative } = require("node:path") as typeof import("node:path");
    const root = join(__dirname, "..", "..");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === "__tests__") continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          walk(p);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(name) || /\.test\.(ts|tsx)$/.test(name)) continue;
        const stripped = readFileSync(p, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/^[ \t]*\/\/.*$/gm, "");
        if (stripped.includes("sliderule-v51-product")) {
          hits.push(relative(root, p).replace(/\\/g, "/"));
        }
      }
    };
    walk(root);
    expect(hits).toEqual(["lib/sliderule-session-id.ts"]);
  });

  it("常量就是那个历史兜底桶", () => {
    expect(DEFAULT_SESSION_ID).toBe("sliderule-v51-product");
    const src = readFileSync(new URL("../sliderule-session-id.ts", import.meta.url), "utf8");
    expect(src).toContain(`export const DEFAULT_SESSION_ID = "${DEFAULT_SESSION_ID}"`);
  });
});

describe("地址栏才是会话权威", () => {
  it("查询键只许叫 session，跟开发态 /sliderule/dev 同一字", () => {
    expect(SESSION_QUERY_KEY).toBe("session");
  });

  it("URL 有 session 就听 URL，存储只是 fallback", () => {
    expect(
      resolveActiveSessionId({
        urlSession: "sr-ticket",
        stored: "sr-old",
      })
    ).toBe("sr-ticket");
    expect(resolveActiveSessionId({ stored: "sr-old" })).toBe("sr-old");
    expect(resolveActiveSessionId({})).toBe(DEFAULT_SESSION_ID);
  });

  it("反向：残缺 window 不许去读 location.href", () => {
    expect(hrefFromWindow(undefined)).toBe("");
    expect(hrefFromWindow({ location: {} })).toBe("");
    expect(hrefFromWindow({ location: { href: "https://app.local/?session=sr-1" } })).toBe(
      "https://app.local/?session=sr-1"
    );
  });

  it("反向：空查询 / 空 id 不许冒充一条会话", () => {
    expect(sessionIdFromSearch("")).toBeNull();
    expect(sessionIdFromSearch("?tab=workbench")).toBeNull();
    expect(sessionIdFromHref("/agent-loop/sliderule")).toBeNull();
    expect(resolveActiveSessionId({ urlSession: "  ", stored: "" })).toBe(
      DEFAULT_SESSION_ID
    );
  });

  it("相对路径和绝对地址都能读出 id，并保住其它查询", () => {
    expect(sessionIdFromSearch("?session=sr-1&tab=x")).toBe("sr-1");
    expect(
      sessionIdFromHref("https://app.local/agent-loop/sliderule?session=sr-2")
    ).toBe("sr-2");
    expect(hrefWithSession("/agent-loop/sliderule?tab=x", "sr-3")).toBe(
      "/agent-loop/sliderule?tab=x&session=sr-3"
    );
    expect(slideruleSessionPath("sr-4")).toBe(
      "/agent-loop/sliderule?session=sr-4"
    );
  });

  it("只改推演页的地址栏，工作台不许被切换会话顺手改掉", () => {
    expect(isSliderulePath("/agent-loop/sliderule")).toBe(true);
    expect(isSliderulePath("/agent-loop")).toBe(true);
    expect(isSliderulePath("/repo/agent-loop/sliderule")).toBe(true);
    expect(isSliderulePath("/agent-loop/workbench")).toBe(false);
    const pushed: string[] = [];
    const next = applySessionToHistory(
      {
        state: null,
        pushState: (_data, _unused, url) => {
          pushed.push(String(url));
        },
        replaceState: () => {
          throw new Error("工作台不该 replace");
        },
      },
      "https://app.local/agent-loop/workbench",
      "sr-5",
      "push"
    );
    expect(next).toBeNull();
    expect(pushed).toEqual([]);
  });

  it("推演页缺 session 时 replace 补上，已经有了就不动历史", () => {
    const replaced: string[] = [];
    const href = "https://app.local/agent-loop/sliderule";
    expect(
      applySessionToHistory(
        {
          state: { keep: true },
          pushState: () => {
            throw new Error("首屏补 id 不许 push 多一条历史");
          },
          replaceState: (_data, _unused, url) => {
            replaced.push(String(url));
          },
        },
        href,
        "sr-6",
        "replace"
      )
    ).toBe("https://app.local/agent-loop/sliderule?session=sr-6");
    expect(replaced).toEqual([
      "https://app.local/agent-loop/sliderule?session=sr-6",
    ]);
    expect(
      applySessionToHistory(
        {
          state: null,
          pushState: () => {
            throw new Error("已经写过就不该再推");
          },
          replaceState: () => {
            throw new Error("已经写过就不该再替");
          },
        },
        "https://app.local/agent-loop/sliderule?session=sr-6",
        "sr-6",
        "replace"
      )
    ).toBeNull();
  });
});
