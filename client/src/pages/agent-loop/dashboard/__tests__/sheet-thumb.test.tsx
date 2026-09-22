/**
 * 应用中心卡片封面：贴图 vs 空态。
 *
 * ## 两段历史
 *
 * ① 2026-08-01 之前，卡片一律**活渲染**——每张挂一个真的 AppRuntimeScreen
 *    （antd 表格 + echarts）。那个组件自己的注释记着实测「生产构建下同屏 14 张
 *    卡，最长单任务 4106ms，主线程连续堵四秒」。于是把生成时那张首页参照板
 *    落库当缩略图，活渲染降级成回落路径。
 *
 * ② 2026-08-22，**回落路径整个删掉**（用户："以图片为主，动态渲染就不要了，
 *    如果没图就使用 Ant Design 的暂无图片"）。卡片封面从此只有两档：
 *    有图贴图 / 没图 antd Empty。
 *
 * 这份测试盯三件事：
 *   ① 取舍判据本身（shouldUseSheetThumb）；
 *   ② 有图时**不渲染 fallback**——那正是当初省下来的开销；
 *   ③ 活渲染真的从卡片上消失了，**而采集点没跟着一起消失**——真截图仍由推演
 *      收口那次渲染采（studio-landing-shot）。删一半会让新应用从此永远没图，
 *      而卡片照样"正常"显示空态，没有任何报错。这是本仓第三条（正向判据齐全、
 *      反向判据缺失）最典型的形状，所以下面专门有一条反向判据钉它。
 *
 * 没有 jsdom（仓库里 React 测试统一用 renderToStaticMarkup），所以 onError
 * 触发的回落转换测不了；判据本身抽成了纯函数 shouldUseSheetThumb，转换后要
 * 渲染的东西就是 fallback 那个节点，两头都在下面覆盖到了。
 */
import { readFileSync } from "node:fs";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";

import { DEVICE_ASPECT } from "@/lib/justified-rows";
import { EmptyThumb, SheetThumb, appPreviewUrl, shouldUseSheetThumb } from "../AppsWorkbench";

describe("shouldUseSheetThumb", () => {
  // ⚠ 2026-08-24 判据的入参换了：从 `summary.has_preview` 换成归一后的
  //   `hasPreview`。归一在 mergeGalleryItems 做——app 源来自 AppStoreSummary，
  //   session 源来自会话摘要（后端 session_covers 补的）。
  //   读 summary 的老写法只有 app 源有值，会话卡永远判 false，哪怕它明明绑着
  //   一个有图的应用。下面「会话卡绑了有图的应用」那条就是钉这个的。

  it("卡上有 appId 且后端说有图 → 贴图", () => {
    expect(shouldUseSheetThumb({ appId: "a1", hasPreview: true })).toBe(true);
  });

  it("后端说没图 → 空态（老记录就是这一档）", () => {
    expect(shouldUseSheetThumb({ appId: "a1", hasPreview: false })).toBe(false);
  });

  it("hasPreview 字段缺席 → 空态（老后端就是这一档）", () => {
    // 老 Python 后端不返回预览字段，缺失一律按"没图"。
    // ⚠ 2026-08-22 之前这一档回落活渲染，所以当时的说法是"新能力缺席退回旧
    //   行为"；现在这一档是 antd Empty。判据本身没变，变的是 false 的去处。
    expect(shouldUseSheetThumb({ appId: "a1" })).toBe(false);
  });

  it("没有 app_id → 无图可取，空态", () => {
    // 还没落进 App Store 的会话卡：就算摘要里莫名带了 hasPreview，
    // 也没有能取图的 id。
    expect(shouldUseSheetThumb({ appId: null, hasPreview: true })).toBe(false);
    expect(shouldUseSheetThumb({ appId: "", hasPreview: true })).toBe(false);
  });

  it("**会话卡绑了有图的应用也要贴图** —— 2026-08-24 那次「66 张卡只有 14 张有图」", () => {
    // 会话摘要现在带 appId + hasPreview（后端 session_covers）。这一档要是
    // 判 false，应用中心就回到那天的样子：会话认不到应用那一页，全画空占位。
    expect(shouldUseSheetThumb({ appId: "app-from-session", hasPreview: true })).toBe(true);
  });

  it("spec-first 有图也贴图——不因为它是整页 HTML 就另开一路", () => {
    // 判据本身不看 has_pages：有 appId + hasPreview 就贴。
    expect(shouldUseSheetThumb({ appId: "spec-1", hasPreview: true })).toBe(true);
  });
});

describe("appPreviewUrl", () => {
  it("指向取图接口并对 id 转义", () => {
    expect(appPreviewUrl("abc123")).toBe("/api/sliderule/apps/abc123/preview");
    expect(appPreviewUrl("a/b?c")).toBe("/api/sliderule/apps/a%2Fb%3Fc/preview");
  });

  it("带上 preview_tag 当缓存版本位，并转义", () => {
    expect(appPreviewUrl("abc123", "shot.1754140000123456")).toBe(
      "/api/sliderule/apps/abc123/preview?v=shot.1754140000123456"
    );
    expect(appPreviewUrl("abc", "a b&c")).toBe("/api/sliderule/apps/abc/preview?v=a%20b%26c");
  });

  it("**图变了 URL 必须跟着变** —— 强缓存的正确性就靠这个", () => {
    // 取图响应带 immutable、max-age 一年。而同一个 app_id 的图是会变的：真截图
    // 是事后由前端采集回传的（lib/thumb-capture.ts），卡片会从参照板升级成真
    // 截图。URL 不变，浏览器就永远停在升级前那张——**这不是缓存优化问题，
    // 是用户看到的图是错的**。
    const before = appPreviewUrl("app-9", "sheet.1754140000000000");
    const after = appPreviewUrl("app-9", "shot.1754140060000000");
    expect(after).not.toBe(before);
  });

  it("没有 tag（老后端）退回不带查询串的老 URL", () => {
    // 新能力缺席时退回旧行为：强缓存照旧生效，只是拿不到升级后的新图。
    expect(appPreviewUrl("abc", undefined)).toBe("/api/sliderule/apps/abc/preview");
    expect(appPreviewUrl("abc", null)).toBe("/api/sliderule/apps/abc/preview");
    expect(appPreviewUrl("abc", "")).toBe("/api/sliderule/apps/abc/preview");
  });
});

describe("卡片画幅与出图画布同比", () => {
  it("卡片比例与渲染画布同比（2026-08-03 起）", () => {
    // 这条原先断言的是**两者不相等**——08-01 卡片对齐出图、画布留在 0.462
    // 时的状态。08-03 画布也改成 9:16 之后前提反转了，断言跟着反转。
    //
    // 卡片不再活渲染之后这条仍然有意义：贴上来的真截图就是照这个画布拍的
    // （studio-landing-shot），画幅一旦分叉，图进卡片就会被 object-cover 裁掉
    // 一截或留边。
    const canvas = readFileSync(
      new URL("../../../sliderule/live-runtime/AppRuntimeScreen.tsx", import.meta.url),
      "utf8"
    );
    const m = /phone:\s*\{\s*w:\s*(\d+),\s*h:\s*(\d+)/.exec(canvas);
    expect(m, "AppRuntimeScreen 的 DEVICE_SPECS.phone 没找到").toBeTruthy();
    const canvasAspect = Number(m![1]) / Number(m![2]);
    expect(canvasAspect).toBeCloseTo(DEVICE_ASPECT.phone, 4);
    expect(canvasAspect).toBeCloseTo(0.5625, 4);
  });

});

describe("SheetThumb", () => {
  const fallback = <div data-testid="fallback-live-render">活渲染</div>;

  it("渲染指向取图接口的 img", () => {
    const html = renderToStaticMarkup(
      <SheetThumb appId="app-77" alt="园务通" fallback={fallback} />
    );
    expect(html).toContain(`src="${appPreviewUrl("app-77")}"`);
    expect(html).toContain('alt="园务通"');
  });

  it("有图时**不渲染** fallback —— 省下的就是这一处开销", () => {
    // 这条是整个改动的收益所在：活渲染那棵树一旦被挂上，主线程该堵还是堵，
    // 图贴不贴都白搭。
    const html = renderToStaticMarkup(
      <SheetThumb appId="app-77" alt="园务通" fallback={fallback} />
    );
    expect(html).not.toContain("fallback-live-render");
  });

  it("卡片点击不被图挡住（整张卡是一个可点区域）", () => {
    const html = renderToStaticMarkup(
      <SheetThumb appId="app-77" alt="园务通" fallback={fallback} />
    );
    expect(html).toContain("pointer-events-none");
  });

  it("首屏之外的图不抢带宽/解码（lazy + 低优先级）", () => {
    const html = renderToStaticMarkup(
      <SheetThumb appId="app-77" alt="园务通" fallback={fallback} />
    );
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
  });

  it("previewTag 透传进 img 的 src", () => {
    // 组件不解释这个值、也不关心图是哪一路的——挑图是服务端的事，这里只负责
    // 把缓存版本位原样带上。
    const html = renderToStaticMarkup(
      <SheetThumb appId="app-77" alt="园务通" fallback={fallback} previewTag="shot.17541400001" />
    );
    expect(html).toContain(`src="${appPreviewUrl("app-77", "shot.17541400001")}"`);
  });

  it("**不按来源分支** —— 真截图和参照板走同一条渲染路径", () => {
    // 两个来源画幅一致、同一个接口，前端多一个分支只会多一处要跟后端对齐的
    // 地方。除了 src 上的版本位，两者的产出应当逐字节相同。
    const asSheet = renderToStaticMarkup(
      <SheetThumb appId="app-77" alt="园务通" fallback={fallback} previewTag="sheet.1" />
    );
    const asShot = renderToStaticMarkup(
      <SheetThumb appId="app-77" alt="园务通" fallback={fallback} previewTag="shot.1" />
    );
    expect(asShot.replace("v=shot.1", "v=sheet.1")).toBe(asSheet);
  });
});

describe("卡片封面只有两档：贴图 / 空态", () => {
  const raw = readFileSync(new URL("../AppsWorkbench.tsx", import.meta.url), "utf8");
  // 先剥行注释再剥块注释。反过来会出事：源码里一句
  // `// …不打任何 /api/*。` 的斜杠星号被当成块注释开头，一口吞掉几千字符。
  const stripped = raw.replace(/\/\/[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
  const media = (() => {
    const from = stripped.indexOf("media={(() => {");
    return stripped.slice(from, stripped.indexOf("metrics=", from));
  })();

  it("有图 → SheetThumb；剩下一律 EmptyThumb", () => {
    expect(media).toContain("shouldUseSheetThumb");
    expect(media).toContain("SheetThumb");
    expect(media).toContain("EmptyThumb");
    // SheetThumb 的 fallback（图拉不到时）也必须是空态，不能又摸回活渲染。
    expect(media).toMatch(/fallback=\{<EmptyThumb\s*\/>\}/);
  });

  it("★ 活渲染在卡片上必须彻底消失——留一处就等于没改", () => {
    // 这条盯的是本仓第一条纪律的反面：改了不通电的那一处。三个组件里只要
    // 还剩一个挂在 media 上，同屏几十张卡照样把主线程堵死，而"贴图"这套
    // 判据全绿。整文件级地断言，不只看 media 那一段。
    for (const gone of ["HtmlLiveThumb", "LiveAppThumb", "useThumbMountGate", "PendingAppThumb"]) {
      expect(stripped, `${gone} 还在 AppsWorkbench 里`).not.toContain(gone);
    }
    // 卡片上不许再有应用运行时/整页面。只读预览是另一回事——它在
    // SpecPagesPreview / 预览弹窗里，不在 media 分支。
    expect(media).not.toContain("AppRuntimeScreen");
    expect(media).not.toContain("HtmlAppSurface");
  });

  it("★ 反向：采集点不许跟着一起没——否则新应用从此永远没图", () => {
    // 卡片过去兼着"没图就顺手采一张"的活（captureAndUpload + captureFor）。
    // 删活渲染时把这条支路一起删掉是必然的，**但采集本身必须还有人干**，
    // 否则线上会是：卡片一切正常（空态嘛），而截图从此再也不产生，谁都不会
    // 收到报错。真截图现在由推演收口那次渲染采。
    const shot = readFileSync(
      new URL("../../../sliderule/studio-landing-shot.tsx", import.meta.url),
      "utf8"
    );
    expect(shot).toContain("captureAndUpload");
    // 而卡片这边确实不再是采集点。
    expect(stripped).not.toContain("captureAndUpload(");
  });

  it("会话卡的空态说的是进度，不是「这个应用没图」", () => {
    // 两件事长成一个样，用户就没法从卡片上区分"生成失败"和"还在跑"。
    expect(media).toContain('item.source === "session"');
    expect(media).toContain("推演未闭环");
    expect(media).toContain("待补充信息");
  });

  it("空态用的是 antd Empty（用户指定），且不会把矮卡撑破", () => {
    const html = renderToStaticMarkup(<EmptyThumb />);
    // antd Empty 的类名前缀是它自己的约定，换成手搓 div 这条就红。
    expect(html).toContain("ant-empty");
    expect(html).toContain("暂无预览图");
    // antd 默认 image 高 100px，塞进 146px 高的桌面卡会顶掉文案。
    expect(html).toMatch(/height:\s*44px/);
  });

  it("会话卡的描述能传进空态", () => {
    expect(renderToStaticMarkup(<EmptyThumb description="推演未闭环" />)).toContain("推演未闭环");
  });
});

describe("SheetThumb 图必须铺满格子", () => {
  it("img 绝对定位 + object-cover，固有尺寸不能赢", () => {
    const html = renderToStaticMarkup(
      <SheetThumb appId="app-77" alt="园务通" fallback={<div />} />
    );
    expect(html).toMatch(/class="[^"]*absolute inset-0[^"]*object-cover/);
    expect(html).not.toMatch(/class="h-full w-full object-cover"/);
  });
});
