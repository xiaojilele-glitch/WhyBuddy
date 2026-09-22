/**
 * 画布档**真的接在通电的那条链路上**吗。
 *
 * ## 这个文件为什么存在
 *
 * 本仓第一条纪律（"动手之前先确认哪条链真的在跑"）与第三条（"正向判据齐全、
 * 反向判据缺失"）在这次改动上同时适用：
 *
 *   · SpecPageCanvasStage 自己渲染得再对，没被 SlideRuleStudio 挂上去就是零；
 *   · 顶栏多一片「画布」按钮，不代表点了之后舞台真的换成画布；
 *   · 画布拿到页面了，不代表拿的是**跟页面档同一份**页面。
 *
 * 前两条组件层测不到（SlideRuleStudio 在 jsdom 里要拖起整条推演外壳、
 * SpecPageCanvasStage 要 React Flow 的真实布局与 iframe），所以判据落在
 * **剥掉注释之后的源码**上——这份文件里到处写着 "canvas"、"画布"，
 * 不剥注释的话把实现整段删了判据照样绿（本仓踩过：判据 grep 的标识符
 * 同时出现在文档字符串里）。
 *
 * 第三条落在 livePagesFromSpec 的真实行为上，是个正经单测。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { livePagesFromSpec } from "../spec-live-pages";

/** 剥注释再查：本文件与被查文件里都有大段中文注释提到这些词。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const STUDIO = stripComments(
  readFileSync(resolve(__dirname, "../SlideRuleStudio.tsx"), "utf8")
);

describe("画布档接在 SlideRuleStudio 上（而不是只写了个组件）", () => {
  it("统一页主布局真的挂了 SpecPageCanvasStage", () => {
    // ⚠ 这条**必须**查 JSX 挂载点，不是查 import。只 import 不渲染是
    //   本仓最经典的"装在不通电的插座上"。
    expect(STUDIO).toContain("<SpecPageCanvasStage");
  });

  it("⚠ 画布是顶栏互斥分段的一片，不再是独立开关，也不在页面/代码里", () => {
    /*
     * 2026-08-28：画布不是页面/代码的第三片。
     * 2026-09-01：独立「打开画布」也撤了——它跟隐藏页面 / 最大化并排，
     *   用户指着说推演中识别困难。画布进了 分栏|全屏|画布。
     *
     * ⚠ 正反一起（「沙盘」那次记下的形状）：只查"分段里没有画布"会假绿——
     *   把顶栏那片也删掉，判据照样全绿，而画布再也打不开。
     */
    expect(STUDIO).not.toContain('["canvas", "画布"]');
    const seg = STUDIO.slice(
      STUDIO.indexOf('["page", "页面"]'),
      STUDIO.indexOf('["code", "代码"]') + 20
    );
    expect(seg).not.toContain('"canvas"');
    expect(STUDIO).not.toContain("打开画布");
    expect(STUDIO).not.toContain("sliderule-stage-view-canvas");
    // 顶栏那片还在。testid 是三元表达式，源码里是字面量不是 data-testid="…"
    expect(HUD).toContain('"sliderule-stage-view-canvas"');
    expect(HUD).toContain("STUDIO_WORKBENCH_MODE_OPTIONS");
    expect(HUD).toContain("applyWorkbenchMode");
    expect(STUDIO).toContain("registerCanvasSink");
    expect(STUDIO).toContain('if (on) return "canvas"');
  });

  it("按钮的档位值与舞台的渲染分支用的是同一个字面量", () => {
    // 只加按钮不加分支 → 点了没反应；只加分支不加按钮 → 永远进不去。
    // 两边都要在，且都得是 "canvas"。
    expect(HUD).toContain('"sliderule-stage-view-canvas"');
    expect(STUDIO).toContain('stageView === "canvas" ? (');
    expect(STUDIO).toContain('if (on) return "canvas"');
  });

  it("stageView 的联合类型里有 canvas（否则 TS 之外的分支是死代码）", () => {
    expect(STUDIO).toMatch(/useState<[^>]*"canvas"[^>]*>/);
  });

  it("画布喂的是 displayPages —— 跟页面档同一份，不是 livePages", () => {
    /**
     * ⚠ 这条是本仓第四条纪律的具象化。点选编辑存过的页在 pageOverrides
     *   里，displayPages 叠了覆盖层、livePages 没有。喂错的话画布显示改之前、
     *   页面档显示改之后：**同一个产物两个档位两种内容，而且不报错**。
     */
    const canvasJsx = STUDIO.slice(
      STUDIO.indexOf("<SpecPageCanvasStage"),
      STUDIO.indexOf("<SpecPageCanvasStage") + 900
    );
    expect(canvasJsx).toContain("pages={displayPages}");
    expect(canvasJsx).not.toContain("pages={livePages}");
  });

  it("画布外面套了防崩溃气囊（增强类必须 fail-open）", () => {
    const around = STUDIO.slice(
      Math.max(0, STUDIO.indexOf("<SpecPageCanvasStage") - 400),
      STUDIO.indexOf("<SpecPageCanvasStage")
    );
    expect(around).toContain("<AppStageErrorBoundary");
  });

  it("画布的选中页回喂给 activeSpecPageId —— 透视面板才跟得住", () => {
    const canvasJsx = STUDIO.slice(
      STUDIO.indexOf("<SpecPageCanvasStage"),
      STUDIO.indexOf("<SpecPageCanvasStage") + 900
    );
    expect(canvasJsx).toContain("onActivePageChange={setActiveSpecPageId}");
    expect(canvasJsx).toContain("activePageId={activeSpecPageId}");
  });
});

describe("画板标题的数据真的送到了（不是只在类型里加了个字段）", () => {
  const spec = {
    pages: {
      p1: "<html><body>甲</body></html>",
      p2: "<html><body>乙</body></html>",
    },
    navItems: [
      { id: "p1", name: "团长工作台" },
      { id: "p2", name: "订单核销页" },
    ],
    device: "desktop" as const,
  };

  it("落库那条把导航里的人话名带进 SpecPageLive.name", () => {
    // ⚠ 反向判据：name 以前**算出来了但只喂给 missingPageHtml 就丢掉**。
    //   把 spec-live-pages.ts 里那行 `name,` 删掉，这条必须红。
    const pages = livePagesFromSpec(spec);
    expect(pages.map(p => p.name)).toEqual(["团长工作台", "订单核销页"]);
  });

  it("导航没提到的页不会凭空编一个名字", () => {
    const pages = livePagesFromSpec({
      pages: { pX: "<html><body>x</body></html>" },
      navItems: [],
      device: "desktop",
    });
    expect(pages[0]!.name).toBe("pX");
  });

  it("缺页也带名字——画布上要如实标出「未通过校验」的是哪一页", () => {
    const pages = livePagesFromSpec({
      pages: { p1: "<html><body>甲</body></html>", p2: "" },
      navItems: [
        { id: "p1", name: "团长工作台" },
        { id: "p2", name: "订单核销页" },
      ],
      device: "desktop",
    });
    const missing = pages.find(p => p.missing);
    expect(missing?.name).toBe("订单核销页");
  });
});

/**
 * 第二轮（连线 / 属性面板 / 右键菜单 / 素材图）的链路判据。
 *
 * 同样是**剥注释后查源码**：这四件事的实现文件里到处写着自己的名字，
 * 不剥注释的话把 JSX 整段删了判据照样绿。
 */
const CANVAS = stripComments(
  readFileSync(
    resolve(__dirname, "../live-runtime/SpecPageCanvasStage.tsx"),
    "utf8"
  )
);

describe("四件新东西真的挂在画布上（不是各写了个组件）", () => {
  it("属性面板与右键菜单都被画布渲染", () => {
    expect(CANVAS).toContain("<CanvasInspector");
    expect(CANVAS).toContain("<CanvasBoardMenu");
  });

  it("边真的喂给了 ReactFlow —— 不是算出来放着不用", () => {
    // ⚠ 只算不喂是本仓最经典的形状。判据要落在 `edges={edges}` 这个挂载点上。
    expect(CANVAS).toContain("edges={edges}");
    expect(CANVAS).toContain("deriveDataflowLinks(");
    expect(CANVAS).toContain("onConnect=");
  });

  it("素材节点真的进了 nodes（同上）", () => {
    expect(CANVAS).toContain("extractPageAssets(");
    expect(CANVAS).toContain("layoutAssets(");
    expect(CANVAS).toMatch(/nodeTypes\s*=\s*\{\s*artboard:[^}]*asset:/);
  });

  it("连线把手常挂，不是「连线态才渲染」", () => {
    /**
     * ⚠ 反向判据。把手不在时 React Flow 算不出边的起终点，已有的边直接
     *   画不出来（控制台 #008）。写成 `{linkMode && <Handle …>}` 会让
     *   "关掉连线态之后连线全部消失"——而且不报错。
     */
    expect(CANVAS).toContain("isConnectable={ctx?.linkMode ?? false}");
    expect(CANVAS).not.toMatch(/linkMode\s*&&\s*<Handle/);
  });

  it("把手的 zIndex 在（不是样式，是功能）", () => {
    // 手势层 absolute inset-0 排在把手后面，不提 zIndex 的话把手看得见
    // 却按不下去——真机 L2「拖出一条连线」就是这么失败的。
    const handleBlock = CANVAS.slice(
      CANVAS.indexOf("isConnectable={ctx?.linkMode ?? false}"),
      CANVAS.indexOf("isConnectable={ctx?.linkMode ?? false}") + 400
    );
    expect(handleBlock).toContain("zIndex: 10");
  });

  it("四条边的把手都在，且边按几何挑边（不是写死右出左进）", () => {
    expect(CANVAS).toContain("pickLinkSides(");
    expect(CANVAS).toContain("sourceHandle: sides.source");
    expect(CANVAS).toContain("targetHandle: sides.target");
    expect(CANVAS).not.toContain('sourceHandle: "s"');
  });

  it("「重新生成」与「写进页面」走的是已有的 fill-prompt 事件，且**只填不发**", () => {
    /**
     * ⚠ 这条同时钉两件事：
     *   1. 复用既有链路（不新造 prop），
     *   2. **不许自动开跑**——一轮推演是几分钟 + 真金白银的 token。
     *      出现任何直接提交的调用（submit/send/run）都该让这条红。
     */
    expect(CANVAS).toContain('"sliderule:fill-prompt"');
    expect(CANVAS).toContain("linkToRefineInstruction(");
    const filler = CANVAS.slice(
      CANVAS.indexOf("function fillComposer"),
      CANVAS.indexOf("function fillComposer") + 300
    );
    expect(filler).not.toMatch(/submit|sendMessage|runTurn|drive/i);
  });

  it("手画连线按会话存档（宿主传了 sessionId）", () => {
    expect(CANVAS).toContain("manualLinksStorageKey(sessionId)");
    expect(STUDIO).toContain("sessionId={sessionId}");
  });

  it("导出两种都在，且 PNG 复用仓里那条采集链路", () => {
    expect(CANVAS).toContain("exportBoardPng(");
    expect(CANVAS).toContain("exportBoardHtml(");
    const exportSrc = stripComments(
      readFileSync(
        resolve(__dirname, "../live-runtime/canvas-board-export.ts"),
        "utf8"
      )
    );
    // ⚠ 别在这儿另写一份 snapdom 调用：dpr/embedFonts/backgroundColor/fast
    //   四个参数是 thumb-capture 踩出来的。
    expect(exportSrc).toContain("captureNodeToCanvas");
    expect(exportSrc).not.toContain("snapdom");
  });

  it("导出失败要说话——fail-open 不等于静静地什么都不发生", () => {
    const exportBlock = CANVAS.slice(
      CANVAS.indexOf("const doExportPng"),
      CANVAS.indexOf("const doExportPng") + 600
    );
    expect(exportBlock).toContain("setToast");
    expect(exportBlock).toMatch(/ok \?/);
  });

  it("右键菜单**没有**「删除」——画板不是用户放上去的图元", () => {
    /**
     * ⚠ 参考工具的菜单第四项是「删除」。这里有意不做：在画布上"删掉"一页，
     *   删的到底是画布上的显示（假的，刷新就回来）还是 pages_json 里那一页
     *   （破坏性动作，不该藏在右键菜单第四项）？宁可没有。
     *   哪天真要加，先想清楚删的是哪一个，再回来改这条判据。
     */
    const menu = stripComments(
      readFileSync(
        resolve(__dirname, "../live-runtime/CanvasBoardMenu.tsx"),
        "utf8"
      )
    );
    expect(menu).not.toContain('label="删除"');
    expect(menu).toContain('label="导出 PNG"');
    expect(menu).toContain('label="重新生成这一页…"');
  });
});

/* ================================================== 换图接在通电的链路上吗 */

const STAGE = stripComments(
  readFileSync(
    resolve(__dirname, "../live-runtime/SpecPageCanvasStage.tsx"),
    "utf8"
  )
);
const PANEL = stripComments(
  readFileSync(
    resolve(__dirname, "../live-runtime/AssetReplacePanel.tsx"),
    "utf8"
  )
);
const ROUTES = readFileSync(
  resolve(
    __dirname,
    "../../../../../slide-rule-python/routes/sliderule_full.py"
  ),
  "utf8"
).replace(/"""[\s\S]*?"""/g, "");

describe("换图：纯函数之外，链路真的接上了吗", () => {
  it("画布真的挂了换图面板（不是只写了个组件）", () => {
    expect(STAGE).toContain("<AssetReplacePanel");
  });

  it("换图**真的写回库**——调用点在，且走既有的 updateAppPage", () => {
    // ⚠ 这条钉的是本仓最贵的那条纪律。planAssetReplacement 算得再对，
    //   不落库就只是把画布上的图换了个样子，刷新即打回原形。
    expect(STAGE).toContain("planAssetReplacement(");
    expect(STAGE).toContain("updateAppPage(");
    // 反向：不许自己另起一条 PATCH（那就是同一件事两处实现）
    expect(STAGE).not.toMatch(/method:\s*["']PATCH["']/);
  });

  it("落库成功**真的**回调宿主刷新覆盖层", () => {
    // 少了这一步：库里换了，画布还显示旧图 —— "存了但看着没变"
    // 跟"根本没存上"在屏幕上长得一模一样。
    expect(STAGE).toContain("onPagesReplaced?.(saved)");
  });

  it("Studio 真的把 appId 和覆盖层回调传下去了", () => {
    const call = STUDIO.slice(
      STUDIO.indexOf("<SpecPageCanvasStage"),
      STUDIO.indexOf("<SpecPageCanvasStage") + 1600
    );
    expect(call).toContain("appId={boundAppId}");
    expect(call).toContain("onPagesReplaced=");
    // 反向：回调必须真的写进 pageOverrides，不是个空函数
    expect(call).toContain("setPageOverrides");
  });

  it("面板真的调搜图接口（不是摆个搜索框不发请求）", () => {
    expect(PANEL).toContain("searchStockImages(");
    expect(PANEL).toContain("assetUseGroups(");
  });

  it("换图**不走 LLM**——不许偷偷接成一轮精修", () => {
    // 换 src 是纯字符串替换。接成精修 = 几分钟 + 真金白银的 token，
    // 还可能顺手把整页重写了。
    expect(STAGE).not.toContain("fillComposer(`把这张图");
    expect(PANEL).not.toContain("fill-prompt");
    expect(PANEL).not.toContain("ai-edit-element");
  });

  it("搜图路由真的调了服务函数，且只读不落库", () => {
    expect(ROUTES).toContain("search_replacement_images");
    const route = ROUTES.slice(
      ROUTES.indexOf('@router.post("/stock-images/search")'),
      ROUTES.indexOf('@router.post("/stock-images/search")') + 2000
    );
    expect(route).toContain("_auth(x_internal_key)");
    // 反向：搜图这条**不许**碰 pages_json（写回是 PATCH 那条的事）
    expect(route).not.toContain("update_page_html");
  });

  it("没有 appId 时不摆那颗按钮（而不是摆一颗点了报错的）", () => {
    expect(STAGE).toContain(
      "appId ? (a: CanvasAsset) => setReplacingUrl(a.url) : null"
    );
    expect(STAGE).toContain("ctx?.onReplaceAsset ?");
  });
});

/* ============================================ 画布档锁死最大化：五个口子 */

const LAYOUT_CTX = stripComments(
  readFileSync(resolve(__dirname, "../StudioLayoutContext.tsx"), "utf8")
);
const SPLIT = stripComments(
  readFileSync(resolve(__dirname, "../StudioSplit.tsx"), "utf8")
);
const HUD = stripComments(
  readFileSync(resolve(__dirname, "../SlideRuleTopHud.tsx"), "utf8")
);

describe("画布档锁死最大化：掰开它的五个口子都堵上了吗", () => {
  it("Studio 真的在画布档上锁（不是只写了个 setter）", () => {
    expect(STUDIO).toContain('setMaximizeLocked(stageView === "canvas")');
  });

  it("口子1 顶栏不再是独立最大化钮：互斥分段离开画布", () => {
    /**
     * 旧形状：最大化钮在画布档置灰。新形状：分栏|全屏|画布一次只选一档，
     * 离开画布就是点「分栏」或「全屏」，不再有一颗按了没反应的最大化。
     * 画布锁改堵缝上那四个口子（折对话 / 拖 / 双击 / 隐藏页面）。
     */
    expect(HUD).not.toContain("sliderule-layout-maximize");
    expect(HUD).toContain("applyWorkbenchMode");
    expect(HUD).toContain("sliderule-stage-view-canvas");
    expect(HUD).toContain("sliderule-workbench-mode-${opt.id}");
    // 反向：锁的判定要从 context 来，不许顶栏自己按 stageView 猜一遍
    expect(HUD).toContain("studio.maximizeLocked");
    expect(HUD).not.toContain('stageView === "canvas"');
  });

  it("口子2 分隔条上的折叠对话钮：锁住时置灰", () => {
    expect(SPLIT).toContain("layout.maximizeLocked");
    expect(SPLIT).toContain("layout.layoutLocked");
    expect(SPLIT).toMatch(
      /disabled=\{[\s\S]*collapsed\.stage[\s\S]*layout\.maximizeLocked[\s\S]*layout\.layoutLocked/
    );
  });

  it("口子3 拖分隔条：锁住时整条 handle 不许拖", () => {
    expect(SPLIT).toMatch(/disabled=\{phone \|\| layout\.maximizeLocked\}/);
  });

  it("口子4 双击还原：锁住时不展开对话栏", () => {
    const reset = LAYOUT_CTX.match(
      /const resetLayout[\s\S]*?},\s*\[[^\]]*\]\s*\)/
    )?.[0];
    expect(reset).toBeTruthy();
    expect(reset).toContain("if (!maximizeLocked) setChatCollapsed(false)");
  });

  it("口子5 隐藏页面再显示：锁住时不展开对话栏", () => {
    const toggle = LAYOUT_CTX.match(
      /const toggleStagePage[\s\S]*?},\s*\[[^\]]*\]\s*\)/
    )?.[0];
    expect(toggle).toBeTruthy();
    expect(toggle).toContain("if (!maximizeLocked) setChatCollapsed(false)");
  });

  it("两个 toggle 在锁住时直接 return，不靠 effect 事后扳回来", () => {
    // 靠 effect 兜底会先闪一下再弹回去，用户看到的是"抖了一下"。
    const chat = LAYOUT_CTX.match(
      /const toggleChat[\s\S]*?},\s*\[[^\]]*\]\s*\)/
    )?.[0];
    expect(chat).toContain("if (maximizeLocked) return");
    // toggleMaximize 要把锁**传进** maximizeIntent，而不是自己判一遍。
    // ⚠ 钉语义不钉换行：prettier 一跑格式就变，写死缩进的判据会假红。
    const max = LAYOUT_CTX.match(
      /const toggleMaximize[\s\S]*?},\s*\[[^\]]*\]\s*\)/
    )?.[0];
    expect(max).toBeTruthy();
    expect(max).toMatch(/maximizeIntent\([\s\S]*maximizeLocked[\s\S]*\)/);
  });

  it("兜底 effect 在**拥有 ref 的组件**里，且判定用纯函数", () => {
    /*
     * ⚠ 2026-08-25 真机：第一版把这个 effect 放在 StudioLayoutContext 上，
     *   首屏**一次都没执行**——Provider 的 effect 以 locked=true 跑时
     *   StudioSplit 还没挂载（画布要等页面数据），chatRef 是 null，
     *   之后依赖不再变就没有第二次。钮已置灰、对话栏还占半屏。
     *   所以这条判据钉的是"执行点在 StudioSplit"，不只是"有这么一段代码"。
     */
    expect(SPLIT).toContain(
      "needsMaximizeLockFix(collapsed, layout.maximizeLocked)"
    );
    expect(SPLIT).toContain("chatRef.current?.collapse()");
    // 反向：Provider 里不许再留一份（同一件事两处实现 = 半个锁）
    expect(LAYOUT_CTX).not.toContain("needsMaximizeLockFix");
  });

  it("解锁要还原成用户上锁前的选择，不是一律展开", () => {
    expect(LAYOUT_CTX).toContain("beforeLockRef");
    expect(LAYOUT_CTX).toContain(
      "if (before === false) chatRef.current?.expand()"
    );
  });
});

describe("画布台面：浅灰点阵 + 画板不带投影", () => {
  it("画板/素材卡用平框，不带模糊投影", () => {
    // ⚠ 页面档那份 STAGE_FRAME_SHADOW 是三层投影，跟 STAGE_FRAME_PAD 是一组
    //   联立不等式（见 stage-frame-style 头注），画布**不共用**它：一排画板
    //   平铺时每块都带三层投影，缩到 25% 会糊成一片灰边。
    expect(STAGE).toContain("STAGE_FRAME_FLAT");
    expect(STAGE).not.toContain("STAGE_FRAME_SHADOW");
  });

  it("台面完全透明——画布不许有自己的背景", () => {
    /*
     * ⚠ 2026-08-25 用户裁决："完全透明就行，现在就是有两层点阵背景了"。
     *   画布容器一旦自带底色/点阵，就会跟外壳那层叠成两层背景。
     *   要改画布观感去改外壳（--sr-shell-bg），别在这儿再糊一层。
     *
     * 判据落在**容器那一段**上，不是整份源码：素材卡、药丸、画板自己
     * 该有的白底不在此列。
     */
    const host = STAGE.slice(
      STAGE.indexOf("ref={flowHostRef}"),
      STAGE.indexOf("ref={flowHostRef}") + 700
    );
    expect(host).toBeTruthy();
    expect(host).not.toMatch(/bg-\[#/);
    expect(host).not.toContain("backgroundColor");
    expect(host).not.toContain("backgroundImage");
    // React Flow 自己那层点阵也不许回来（它还会跟着缩放消失）
    expect(STAGE).not.toContain("<Background");
    expect(STAGE).not.toContain("BackgroundVariant");
  });
});

const PANEL_EL = stripComments(
  readFileSync(
    resolve(__dirname, "../live-runtime/CanvasElementPanel.tsx"),
    "utf8"
  )
);

describe("画布点选元素直接改：链路接上了吗", () => {
  it("悬停高亮和选中是**两个独立的** spot", () => {
    // 用户原话："鼠标没有按下去的时候选不中，只是纯高亮"。
    // GrapesJS 也是把 hover / select 做成两个 canvas spot，不是一个状态两种样式。
    expect(STAGE).toContain("data-testid={`sliderule-canvas-element-${kind}`}");
    expect(STAGE).toContain('kind="hover"');
    expect(STAGE).toContain('kind="select"');
    expect(STAGE).toContain("onMouseMove");
  });

  it("Ctrl 才生效，且透过手势层去问 iframe 要元素", () => {
    expect(STAGE).toContain("e.ctrlKey || e.metaKey");
    // ⚠ 手势层盖在 iframe 上，事件落不到页面元素——少了 elementFromPoint
    //   拿到的永远是手势层自己。
    expect(STAGE).toContain("elementFromPoint");
    expect(STAGE).toContain("frameRectToNodeRect(");
  });

  it("高亮框不许吃掉画布手势", () => {
    // 这两个框盖在手势层上面，漏了 pointer-events-none 会把 mousemove/click
    // 全吃掉——高亮会闪、点不中。
    const spot = STAGE.slice(
      STAGE.indexOf("function ElementSpot"),
      STAGE.indexOf("function ElementSpot") + 1200
    );
    expect(spot).toContain("pointer-events-none");
    // 描边要反缩放：25% 下 1px 的框只有 0.25px，亚像素看不见（点阵那次栽过）。
    expect(spot).toContain("1 / zoom");
  });

  it("编辑留在画布上，**不跳页面档**", () => {
    // 用户裁决："而不是跳到页面里面，走那个业内编辑的那个方式"。
    expect(STAGE).toContain("<CanvasElementPanel");
    expect(STAGE).not.toContain('setStageView("page")');
    /*
     * ⚠ 钉的是"不**挂载**第二个编辑器"，不是"不引用那个文件"——画布确实要从
     *   ClickEditStage 里拿 closestEditable（可编辑判定共用一份，见下面那条）。
     *   第一版写成 not.toContain("ClickEditStage") 把共用也一起禁了，
     *   红的是判据自己。
     */
    expect(STAGE).not.toContain("<ClickEditStage");
  });

  it("编辑落在**源 HTML** 上，不是改画布那份渲染文档", () => {
    /*
     * ⚠ 画布里的 iframe 注入过 Tailwind、跑过绑定运行时（表格行是 cloneNode
     *   克隆的）。改那份等于改"给人看的那一版"，存回 pages_json 会把注入的
     *   东西一起存进去——ClickEditStage 头注把这条约束写得很清楚。
     */
    expect(PANEL_EL).toContain("applyElementOp(html, picked.path, op)");
    expect(PANEL_EL).not.toContain("contentDocument");
    expect(PANEL_EL).not.toContain("innerHTML =");
  });

  it("落库走既有写回路径，且成功后要把新 HTML 交回宿主", () => {
    expect(STAGE).toContain("updateAppPage(appId, pageId, nextHtml)");
    // 少了这一步：库里改了、画板还是旧的（"存了但看着没变"）。
    expect(STAGE).toContain("onPagesReplaced?.({ [pageId]: nextHtml })");
    // 反向：不许自己另起一条 PATCH
    expect(STAGE).not.toMatch(/method:\s*["']PATCH["']/);
  });

  it("两套 UI，一套语义：可编辑判定与编辑语义都不许各写一份", () => {
    // 用户原话："和页面档的点选编辑其实都能对这块进行编辑，只是形式不一样"。
    expect(STAGE).toContain("closestEditable");
    expect(PANEL_EL).toContain("applyElementOp");
    expect(PANEL_EL).not.toContain("BLOCK_TAGS");
  });

  it("源码里找不到那个元素要说清是哪一类，不是只丢一句出错了", () => {
    expect(PANEL_EL).toContain(
      'data-testid="sliderule-canvas-element-missing"'
    );
    expect(PANEL_EL).toContain("运行时按数据生成");
    // 定位不到 = 失败，不许把原样 HTML 拿去落库当成功
    expect(PANEL_EL).toContain("if (!res.ok)");
  });
});

describe("⚠ 画布档的顶部不占高度：读数在左下，权限切换悬浮（2026-08-28）", () => {
  const STAGE = stripComments(
    readFileSync(
      new URL("../live-runtime/SpecPageCanvasStage.tsx", import.meta.url),
      "utf8"
    )
  );

  it("说明行**不在顶部**了，画在台面左下角（抄 ComfyUI 左下那组读数）", () => {
    /*
     * 用户原话：「画布模式下顶部信息显示在左下角，可以参考 comfyui 这种方式」
     * ＋「顶部这块不要给高度」。
     *
     * ⚠ 正反一起：只查"左下角有这块"会假绿——顶上那条原样留着照样绿，
     *   而"不占高度"这半根本没做到。
     */
    const meta = STAGE.indexOf('data-testid="sliderule-canvas-meta"');
    expect(meta).toBeGreaterThan(-1);
    // 正向：绝对定位、左下、压在画布上不吃事件
    const box = STAGE.slice(meta - 500, meta);
    expect(box).toContain("absolute");
    /* ⚠ 2026-09-04：Figma/Stitch 浮药丸，内缩 12px。覆盖 08-28「贴边」。
       变异：改回 left-0 / bottom-0，这条红。 */
    expect(box).toContain("left-3");
    expect(box).toContain("bottom-3");
    expect(box).toContain("pointer-events-none");
    // 反向：它必须在**画布宿主里面**（flowHostRef 那一层）而不是外层容器
    expect(meta).toBeGreaterThan(STAGE.indexOf("ref={flowHostRef}"));
  });

  it("外层容器不再为它留一行（shrink-0 的说明行和 gap 都没了）", () => {
    // 变异：把 `flex-col gap-2` 改回去，或把说明行搬回外层，这条红。
    const rootAt = STAGE.indexOf('data-testid="sliderule-canvas-stage"');
    const rootTag = STAGE.slice(rootAt - 400, rootAt);
    expect(rootTag).toContain("flex min-h-0 min-w-0 flex-1 flex-col");
    expect(rootTag).not.toContain("flex-col gap-2");
  });

  it("⚠ 缩放百分比不在读数里重复（正下方的药丸就是它，还能点）", () => {
    // 两处显示同一个数，改一处忘一处就会自相矛盾，而且不报错。
    const meta = STAGE.indexOf('data-testid="sliderule-canvas-meta"');
    const zoomPill = STAGE.indexOf('data-testid="sliderule-canvas-zoom"');
    expect(zoomPill).toBeGreaterThan(meta);
    expect(STAGE.slice(meta, zoomPill)).not.toContain("Math.round(zoom * 100)");
  });

  it("权限切换悬浮在台面右上角，且**不是** pointer-events-none", () => {
    // ⚠ 它是要点的控件，不是读数。跟左下那块读数不能共用一套样式。
    const at = STAGE.indexOf('data-testid="sliderule-canvas-meta-trailing"');
    expect(at).toBeGreaterThan(-1);
    const box = STAGE.slice(at - 300, at);
    // ⚠ 贴边，没有往里的位移（2026-08-28 用户裁决）。
    expect(box).toContain("absolute right-3 top-3");
    expect(box).not.toContain("pointer-events-none");
    expect(at).toBeGreaterThan(STAGE.indexOf("ref={flowHostRef}"));
  });

  it("反向：读数里那几项一个都不许丢（搬家最容易顺手丢内容）", () => {
    // 「闸全绿但东西没了」：位置对了、内容少一半，截图上完全看不出。
    for (const id of [
      "sliderule-canvas-page-count",
      "sliderule-canvas-asset-summary",
      "sliderule-canvas-hint",
    ]) {
      expect(STAGE, id).toContain(id);
    }
    expect(STAGE).toContain("双击画板进入交互 · 右键更多");
  });
});

describe("⚠ 换会话回到默认档：偏好必须带着它属于谁（2026-08-28）", () => {
  const STUDIO_SRC = stripComments(
    readFileSync(new URL("../SlideRuleStudio.tsx", import.meta.url), "utf8")
  );

  it("存档带归属：写进去的是 {sessionId, view}，不是光秃秃一个字符串", () => {
    /*
     * 用户报的是「新建会话／点击会话进入应用，还原默认设置」。根因是这个键
     * 原来存的是裸字符串，跟会话没有绑定关系 —— 它于是变成一份环境变量式的
     * 全局状态，在 A 开了画布，进 B、甚至新建会话都被它接管。
     *
     * 抄 claw-code 的会话卫生（session_control.rs 的 validate_loaded_session）：
     * 存档带 workspace_root，归属对不上就 WorkspaceMismatch，不是照用。
     *
     * 变异：把 saveStageViewPref 改回 `localStorage.setItem(KEY, v)`，这条红。
     */
    expect(STUDIO_SRC).toContain("JSON.stringify({ sessionId, view }");
    expect(STUDIO_SRC).toContain("pref.sessionId !== sessionId");
  });

  it("⚠ 归属对不上就当没有（回 null → 落默认档），不是照用", () => {
    // 这是 WorkspaceMismatch 那一半。回 "canvas" 兜底就等于没改。
    const fn = STUDIO_SRC.slice(
      STUDIO_SRC.indexOf("function loadStageViewPref("),
      STUDIO_SRC.indexOf("function saveStageViewPref(")
    );
    expect(fn.length).toBeGreaterThan(100);
    expect(fn).toContain("if (!pref || pref.sessionId !== sessionId) return null;");
    // 反向：没有会话 id 时也不许照用
    expect(fn).toContain("if (!sessionId) return null;");
  });

  it("⚠ 老格式（裸字符串）一律不认——认它等于留一条后门", () => {
    // 它没有归属信息，证明不了属于当前会话。同 claw-code 对 unbound 的处置。
    expect(STUDIO_SRC).toContain("JSON.parse(raw)");
    expect(STUDIO_SRC).not.toContain('localStorage.getItem(STAGE_VIEW_PREF_KEY) || ""');
  });

  it("⚠ 换会话时组件不重挂，所以还得**主动**还原一次", () => {
    /*
     * 只改存档那一半会假绿：推演壳换会话时 SlideRuleStudio 是原地更新 props 的，
     * 上一个会话的档位/选中页/编辑态原样留在屏幕上，一声不吭。
     * 变异：把这个 effect 删掉，这条红。
     */
    const eff = STUDIO_SRC.slice(
      STUDIO_SRC.indexOf("const lastSessionRef"),
      STUDIO_SRC.indexOf("const toggleXray")
    );
    expect(eff).toContain('setStageView(loadStageViewPref(sessionId) ?? "page")');
    expect(eff).toContain('setActiveSpecPageId("home")');
    expect(eff).toContain("setEditMode(false)");
    expect(eff).toContain("setXrayTarget(null)");
  });

  it("⚠ 用 ref 判断是不是真的换了会话，不是每次 effect 都还原", () => {
    // 首挂时 effect 也会跑；直接 set 会把 useState 初值里刚读出来的归属档位
    // 覆盖掉，刷新当前会话就再也留不住位置了。
    expect(STUDIO_SRC).toContain("if (lastSessionRef.current === sessionId) return;");
  });

  it("初值也走同一条读法（两处各写一套必然分叉）", () => {
    expect(STUDIO_SRC).toContain('>(() => loadStageViewPref(sessionId) ?? "page")');
  });
});

describe("⚠ 台面 chrome 是 Figma/Stitch 浮药丸（2026-09-04）", () => {
  const STAGE = stripComments(
    readFileSync(
      new URL("../live-runtime/SpecPageCanvasStage.tsx", import.meta.url),
      "utf8"
    )
  );

  it("读数+缩放条叠在左下内缩，小地图右下内缩，权限右上内缩", () => {
    /*
     * 用户截图指了四处，要 Stitch/Figma 那种离开边、四角全圆的浮层。
     * 覆盖 2026-08-28「贴边不要往里位移」——那条会把药丸切成直角贴角。
     */
    expect(STAGE).toContain("absolute bottom-3 left-3");
    expect(STAGE).toContain("!bottom-3 !right-3");
    expect(STAGE).toContain("absolute right-3 top-3");
  });

  it("反向：不许再贴边切一角（rounded-tr / border-b-0 border-l-0）", () => {
    const overlays = STAGE.slice(STAGE.indexOf("ref={flowHostRef}"));
    expect(overlays).not.toContain("rounded-tr-lg");
    expect(overlays).not.toContain("border-b-0 border-l-0");
    expect(overlays).not.toContain("!bottom-0 !right-0");
  });

  it("浮层用同一份 CANVAS_CHROME_SHADOW，画板仍用平框", () => {
    expect(STAGE).toContain("CANVAS_CHROME_SHADOW");
    expect(STAGE).toContain("STAGE_FRAME_FLAT");
    expect(STAGE).not.toContain("STAGE_FRAME_SHADOW");
  });

  it("⚠ 台面自己也不许再圆角（不然四个角把浮层各啃掉一块）", () => {
    // overflow-hidden + rounded-md 会把贴边的浮层切角，那种错不报错。
    const host = STAGE.slice(
      STAGE.indexOf("ref={flowHostRef}"),
      STAGE.indexOf("ref={flowHostRef}") + 1200
    );
    expect(host).toContain("overflow-hidden");
    expect(host).not.toContain("rounded-md");
  });
});
