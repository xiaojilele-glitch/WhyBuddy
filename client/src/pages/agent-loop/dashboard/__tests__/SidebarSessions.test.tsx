/**
 * SidebarSessions 单测：纯函数 + 静态结构。
 * 列表数据靠 effect 拉取，静态渲染只断言骨架（新建 + 搜索 + 列表容器）。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AppStoreSummary } from "../app-store-client";
import {
  createSessionId,
  filterSessionsByPhase,
  filterSessionsByQuery,
  groupSessionsByAge,
  sessionAgeGroup,
  sessionPhaseBucket,
  SessionRowMeta,
  sessionRowDevice,
  sessionRowVisibility,
  sessionRowVisibilityLabel,
  sessionWhen,
  SIDEBAR_RECENT_LIMIT,
  SIDEBAR_WEEK_LIMIT,
  SidebarSessions,
  sortSessions,
  sortSessionsByRecency,
  splitSidebarSessions,
} from "../SidebarSessions";

function summary(partial: Partial<AppStoreSummary>): AppStoreSummary {
  return {
    id: "app-1",
    root_id: "root-1",
    parent_id: null,
    version: 1,
    session_id: "sr-1",
    goal: "做一个社区团购站",
    gate_passed: true,
    created_at: "2026-08-19",
    product_name: "安康随访通",
    theme_id: "azure",
    theme_label: "Azure",
    device: "desktop",
    landing_page_ref: "p1",
    entity_count: 4,
    page_count: 4,
    ...partial,
  };
}

describe("createSessionId", () => {
  // 2026-08-06：id 从本地生成改成**向服务端要**。
  //
  // 原来是 `sr-${Date.now().toString(36)}-${Math.random()...slice(2,7)}`——
  // 5 位 base36 ≈ 25 位熵，且 Math.random() 不是加密安全的；服务端那份是
  // 50 位 Crockford Base32 + 存在性检查。更要紧的是权威归属：id 由谁生成，
  // 就决定了"这条会话是谁的"由谁说了算。客户端生成时服务端只能被动接受，
  // 实测出过劫持漏洞（拿别人的 sessionId 发一次 POST 就能夺走整条会话）。
  const withFetch = async (impl: typeof fetch, run: () => Promise<void>) => {
    const original = globalThis.fetch;
    globalThis.fetch = impl;
    try {
      await run();
    } finally {
      globalThis.fetch = original;
    }
  };

  it("拿服务端返回的 sessionId，不在本地铸", async () => {
    let sentTo = "";
    await withFetch(
      (async (url: any, init: any) => {
        sentTo = String(url);
        expect(init?.method).toBe("POST");
        return new Response(JSON.stringify({ sessionId: "sr-20260806180527-K2Y58BC5EM" }), {
          status: 200,
        });
      }) as unknown as typeof fetch,
      async () => {
        expect(await createSessionId()).toBe("sr-20260806180527-K2Y58BC5EM");
      }
    );
    expect(sentTo).toBe("/api/sliderule/sessions");
  });

  it("401 给「请先登录」，不回落到本地生成", async () => {
    // 静默回落等于把刚拆掉的弱路径留个后门；而且失败的真实原因通常就是
    // 没登录（建会话已要求登录），给个用不了的本地 id 只会让用户在下一步
    // 撞得更莫名其妙。
    await withFetch(
      (async () => new Response("", { status: 401 })) as unknown as typeof fetch,
      async () => {
        await expect(createSessionId()).rejects.toThrow(/登录/);
      }
    );
  });

  it("服务端没给 sessionId 也要抛，不能返回空串", async () => {
    await withFetch(
      (async () => new Response(JSON.stringify({}), { status: 200 })) as unknown as typeof fetch,
      async () => {
        await expect(createSessionId()).rejects.toThrow(/sessionId/);
      }
    );
  });
});

describe("sortSessionsByRecency", () => {
  it("按 lastActive 倒序，缺时间戳回退 createdAt，全缺沉底；不改原数组", () => {
    const input = [
      { sessionId: "old", goal: "旧", lastActive: "2026-07-01T10:00:00" },
      { sessionId: "none", goal: "无时间" },
      { sessionId: "new", goal: "新", lastActive: "2026-07-08T10:00:00" },
      { sessionId: "created-only", goal: "仅创建", createdAt: "2026-07-05T10:00:00" },
    ];
    const sorted = sortSessionsByRecency(input);
    expect(sorted.map((s) => s.sessionId)).toEqual(["new", "created-only", "old", "none"]);
    expect(input[0].sessionId).toBe("old"); // 原数组未被排序
  });
});

describe("sortSessions · 创建时间", () => {
  it("按 createdAt 排，不被 lastActive 带偏（不该有：创建序仍走活跃时间）", () => {
    const input = [
      { sessionId: "old-but-hot", goal: "老", createdAt: "2026-07-01T10:00:00", lastActive: "2026-08-18T10:00:00" },
      { sessionId: "new-quiet", goal: "新", createdAt: "2026-08-10T10:00:00", lastActive: "2026-08-10T10:00:00" },
    ];
    expect(sortSessions(input, "active").map(s => s.sessionId)).toEqual(["old-but-hot", "new-quiet"]);
    expect(sortSessions(input, "created").map(s => s.sessionId)).toEqual(["new-quiet", "old-but-hot"]);
  });
});

describe("sessionPhaseBucket / filterSessionsByPhase", () => {
  it("只认 runtimePhase 三档，done/failed 不得混进推演中", () => {
    expect(sessionPhaseBucket("orchestrating")).toBe("running");
    expect(sessionPhaseBucket("awaiting")).toBe("running");
    expect(sessionPhaseBucket("idle")).toBe("running");
    expect(sessionPhaseBucket(null)).toBe("running");
    expect(sessionPhaseBucket("done")).toBe("done");
    expect(sessionPhaseBucket("concluded")).toBe("done");
    expect(sessionPhaseBucket("failed")).toBe("failed");

    const rows = [
      { sessionId: "r", goal: "跑", phase: "orchestrating" },
      { sessionId: "d", goal: "完", phase: "done" },
      { sessionId: "f", goal: "挂", phase: "failed" },
    ];
    expect(filterSessionsByPhase(rows, "all").map(s => s.sessionId)).toEqual(["r", "d", "f"]);
    expect(filterSessionsByPhase(rows, "running").map(s => s.sessionId)).toEqual(["r"]);
    expect(filterSessionsByPhase(rows, "done").map(s => s.sessionId)).toEqual(["d"]);
    expect(filterSessionsByPhase(rows, "failed").map(s => s.sessionId)).toEqual(["f"]);
    expect(filterSessionsByPhase(rows, "running").some(s => s.phase === "done")).toBe(false);
  });
});

describe("sessionAgeGroup / groupSessionsByAge", () => {
  it("按本地日历分桶，缺时间戳进更早；空桶不出现", () => {
    const now = Date.parse("2026-08-18T12:00:00.000Z");
    const today0 = (() => {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    })();
    const at = (days: number) => new Date(today0 + days * 86400000 + 3600000).toISOString();
    expect(sessionAgeGroup(at(0), now)).toBe("today");
    expect(sessionAgeGroup(at(-1), now)).toBe("yesterday");
    expect(sessionAgeGroup(at(-3), now)).toBe("week");
    expect(sessionAgeGroup(at(-10), now)).toBe("month");
    expect(sessionAgeGroup(at(-40), now)).toBe("older");
    expect(sessionAgeGroup(null, now)).toBe("older");

    const groups = groupSessionsByAge(
      [
        { sessionId: "t", goal: "今", lastActive: at(0) },
        { sessionId: "y", goal: "昨", lastActive: at(-1) },
        { sessionId: "w", goal: "周", lastActive: at(-3) },
        { sessionId: "none", goal: "无" },
      ],
      now,
    );
    expect(groups.map(g => [g.id, g.label, g.sessions.map(s => s.sessionId)])).toEqual([
      ["today", "今天", ["t"]],
      ["yesterday", "昨天", ["y"]],
      ["week", "近 7 天", ["w"]],
      ["older", "更早", ["none"]],
    ]);
    expect(groups.some(g => g.id === "month")).toBe(false);
  });
});

describe("filterSessionsByQuery", () => {
  const rows = [
    { sessionId: "a", goal: "社区快递代收" },
    { sessionId: "b", goal: "养老服务平台" },
  ];
  it("空串原样返回（不该有：空搜索搜出空表）", () => {
    expect(filterSessionsByQuery(rows, "  ").map(s => s.sessionId)).toEqual(["a", "b"]);
  });
  it("只按标题匹配，大小写不敏感", () => {
    expect(filterSessionsByQuery(rows, "养老").map(s => s.sessionId)).toEqual(["b"]);
    expect(filterSessionsByQuery(rows, "XYZ")).toEqual([]);
  });
});

describe("splitSidebarSessions / sessionWhen", () => {
  it("最近 4 条，近七天再取 6 条，更早的进 hiddenCount", () => {
    const now = Date.parse("2026-08-19T12:00:00");
    const today0 = (() => {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    })();
    const at = (days: number) => new Date(today0 + days * 86400000 + 3600000).toISOString();
    const rows = [
      ...Array.from({ length: 4 }, (_, i) => ({
        sessionId: `r${i}`,
        goal: `近${i}`,
        lastActive: at(0),
      })),
      ...Array.from({ length: 7 }, (_, i) => ({
        sessionId: `w${i}`,
        goal: `周${i}`,
        lastActive: at(-3),
      })),
      { sessionId: "old", goal: "更早", lastActive: at(-20) },
    ];
    const { recent, week, hiddenCount } = splitSidebarSessions(rows, now);
    expect(SIDEBAR_RECENT_LIMIT).toBe(4);
    expect(SIDEBAR_WEEK_LIMIT).toBe(6);
    expect(recent.map(s => s.sessionId)).toEqual(["r0", "r1", "r2", "r3"]);
    expect(week).toHaveLength(6);
    expect(week[0].sessionId).toBe("w0");
    expect(hiddenCount).toBe(2);
    expect(week.some(s => s.sessionId === "old")).toBe(false);

    const few = splitSidebarSessions(rows.slice(0, 3), now);
    expect(few.recent).toHaveLength(3);
    expect(few.week).toHaveLength(0);
    expect(few.hiddenCount).toBe(0);
  });

  it("副行日期：今天 / 昨天 / 同年月日", () => {
    const now = Date.parse("2026-08-19T12:00:00");
    const today0 = (() => {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    })();
    const at = (days: number) => new Date(today0 + days * 86400000 + 3600000).toISOString();
    expect(sessionWhen(at(0), now)).toBe("今天");
    expect(sessionWhen(at(-1), now)).toBe("昨天");
    expect(sessionWhen(at(-10), now)).toBe("8月9日");
    expect(sessionWhen("2025-12-01T00:00:00", now)).toBe("2025年12月1日");
    expect(sessionWhen(null, now)).toBe("");
  });

});

describe("sessionRowDevice / sessionRowVisibility", () => {
  it("设备只认 desktop/phone，无 app 或空字段不默认成 Web", () => {
    expect(sessionRowDevice(null)).toBeNull();
    expect(sessionRowDevice(summary({ device: "phone" }))).toBe("phone");
    expect(sessionRowDevice(summary({ device: "desktop" }))).toBe("desktop");
    expect(sessionRowDevice(summary({ device: "" }))).toBeNull();
    expect(sessionRowDevice(summary({ device: "tablet" }))).toBeNull();
  });

  it("可见性来自关联应用：公开→已分享，私有→私有；无 app 不伪造", () => {
    expect(sessionRowVisibility(null)).toBeNull();
    expect(sessionRowVisibility(summary({}))).toBeNull();
    expect(sessionRowVisibility(summary({ visibility: "public" }))).toBe("public");
    expect(sessionRowVisibility(summary({ visibility: "unlisted" }))).toBe("public");
    expect(sessionRowVisibility(summary({ visibility: "private" }))).toBe("private");
    expect(sessionRowVisibilityLabel("public")).toBe("已分享");
    expect(sessionRowVisibilityLabel("private")).toBe("私有");
    expect(sessionRowVisibility(summary({ visibility: "private" }))).not.toBe("public");
  });
});

describe("SessionRowMeta", () => {
  it("公开应用副行有设备 + 已分享，没有私有", () => {
    const html = renderToStaticMarkup(
      <SessionRowMeta when="今天" device="phone" visibility="public" />,
    );
    expect(html).toContain("native-agent-session-meta");
    expect(html).toContain('data-device="phone"');
    expect(html).toContain("今天");
    expect(html).toContain("已分享");
    expect(html).toContain('data-visibility="public"');
    expect(html).not.toContain("私有");
  });

  it("私有应用副行写私有，不该有已分享", () => {
    const html = renderToStaticMarkup(
      <SessionRowMeta when="昨天" device="desktop" visibility="private" />,
    );
    expect(html).toContain("私有");
    expect(html).toContain('data-device="desktop"');
    expect(html).toContain('data-visibility="private"');
    expect(html).not.toContain("已分享");
  });

  it("没有关联应用：只有日期，不该出现已分享/私有/设备", () => {
    const html = renderToStaticMarkup(
      <SessionRowMeta when="8月9日" device={null} visibility={null} />,
    );
    expect(html).toContain("8月9日");
    expect(html).not.toContain("已分享");
    expect(html).not.toContain("私有");
    expect(html).not.toContain("sidebar-session-device");
    expect(html).not.toContain("sidebar-session-visibility");
  });

  it("三项全空不渲染副行", () => {
    expect(
      renderToStaticMarkup(
        <SessionRowMeta when="" device={null} visibility={null} />,
      ),
    ).toBe("");
  });
});

describe("SidebarSessions 静态渲染", () => {
  it("骨架：新建 + 搜索 + 筛选，没有 PR 空壳", () => {
    const html = renderToStaticMarkup(<SidebarSessions />);
    expect(html).toContain('data-testid="sidebar-sessions"');
    expect(html).toContain('data-testid="sidebar-session-new"');
    expect(html).toContain("新建会话");
    expect(html).toContain('data-testid="sidebar-session-search"');
    expect(html).toContain("搜索会话");
    expect(html).toContain('data-testid="sidebar-session-list"');
    expect(html).toContain('data-testid="sidebar-session-filter"');
    expect(html).toContain("最近活跃");
    expect(html).toContain("创建时间");
    expect(html).toContain("推演中");
    expect(html).toContain("已完成");
    expect(html).toContain("失败");
    expect(html).not.toContain("PR");
    expect(html).not.toContain("Environment");
    expect(html).not.toContain("Archived");
    expect(html).not.toContain("仓库");
  });

  it("活路径先筛再拆最近/近七天，多了链到应用中心", () => {
    const src = readFileSync(new URL("../SidebarSessions.tsx", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    expect(src).toContain("splitSidebarSessions(");
    expect(src).toContain("sortSessions(");
    expect(src).toContain("filterSessionsByPhase");
    expect(src).toContain("sidebar-session-filter");
    expect(src).toContain(">近七天<");
    expect(src).toContain('href="/agent-loop/workbench"');
    expect(src).toContain("sidebar-session-more");
    expect(src).toContain("listApps");
    expect(src).toContain("SessionThumb");
    expect(src).toContain("phase={s.phase}");
    expect(src).toContain("goal={s.goal}");
    expect(src).toContain("SessionRowMeta");
    expect(src).toContain("sessionRowDevice(app)");
    expect(src).toContain("sessionRowVisibility(app)");
    expect(src).not.toContain("groupSessionsByAge(shown");
    expect(src).not.toContain("AppsWorkbench");
    expect(src).toMatch(/setSessions\(remaining\);\s*notifySessionsUpdated\(\)/);
  });

  it("列表超高可滚，搜索在横排里可以 flex:1", () => {
    const css = readFileSync(new URL("../dashboard.css", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const list = css.match(/\.native-agent-sessions-list\s*\{([^}]*)\}/);
    expect(list?.[1]).toMatch(/overflow-y:\s*auto/);
    expect(list?.[1]).toMatch(/margin-right:\s*-12px/);
    expect(list?.[1]).toMatch(/padding-right:\s*12px/);
    expect(list?.[1]).toMatch(/scrollbar-color:\s*rgba\(15,\s*23,\s*42,\s*0\.14\)/);
  });

  it("行图标槽 18px，不是 48px 灰底方块", () => {
    const css = readFileSync(new URL("../dashboard.css", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const thumb = css.match(/\.native-agent-session-thumb\s*\{([^}]*)\}/);
    expect(thumb?.[1]).toMatch(/width:\s*18px/);
    expect(thumb?.[1]).toMatch(/height:\s*18px/);
    expect(thumb?.[1]).toMatch(/background:\s*transparent/);
    expect(thumb?.[1]).not.toMatch(/width:\s*48px/);
    expect(thumb?.[1]).not.toMatch(/aspect-ratio/);
    expect(css).toMatch(/object-fit:\s*cover/);
    const copy = css.match(/\.native-agent-session-copy\s*\{([^}]*)\}/);
    expect(copy?.[1]).toMatch(/gap:\s*8px/);
    const meta = css.match(/\.native-agent-session-meta\s*\{([^}]*)\}/);
    expect(meta?.[1]).not.toMatch(/margin-top:\s*2px/);
  });
});

describe("切换会话必须改地址栏，不许只写 localStorage", () => {
  const strip = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

  it("activateSession 把 id 推进历史；SlideRule 首屏听 URL", () => {
    const activate = strip(
      readFileSync(new URL("../SidebarSessions.tsx", import.meta.url), "utf8")
    );
    expect(activate).toContain("applySessionToHistory");
    expect(activate).toContain("sessionIdFromHref");
    // 反向：只 setItem 不写地址栏 = 刷新仍丢
    const write = activate.slice(activate.indexOf("export function activateSession"));
    expect(write).toMatch(/applySessionToHistory\([\s\S]*hrefFromWindow\(window\)/);

    const shell = strip(
      readFileSync(new URL("../../../SlideRule.tsx", import.meta.url), "utf8")
    );
    expect(shell).toContain("sessionIdFromHref(hrefFromWindow(window))");
    expect(shell).toContain("resolveActiveSessionId");
    expect(shell).toContain("popstate");
  });

  it("应用中心整页跳和复刻链接带着 ?session=", () => {
    const workbench = strip(
      readFileSync(new URL("../AppsWorkbench.tsx", import.meta.url), "utf8")
    );
    expect(workbench).toContain("slideruleSessionPath(sessionId)");
    expect(workbench).not.toMatch(
      /location\.href = `\$\{base\}\/agent-loop\/sliderule`/
    );
    const workspace = strip(
      readFileSync(
        new URL(
          "../../../sliderule/project-runtime/ProjectWorkspacePanel.tsx",
          import.meta.url
        ),
        "utf8"
      )
    );
    expect(workspace).toContain("slideruleSessionPath(fork.sessionId)");
    expect(workspace).not.toContain('href="/agent-loop/sliderule"');
  });
});
