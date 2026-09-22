/**
 * 面团登录页（2026-08-03）。
 *
 * 版式取自 shadcn/ui 官方 login-02 区块（MIT）。这份测试盯两件事：
 *
 *   ① **回跳地址只认站内路径** —— 这是登录页最容易埋的安全洞。放过外站地址
 *      就是开放重定向：攻击者拿一个你域名下的链接把人骗到钓鱼页，而用户在
 *      点击前看到的域名是你的。
 *   ② 页面在服务端渲染（renderToStaticMarkup）下不炸，且品牌与关键入口都在。
 *
 * 仓库里 React 测试统一用 renderToStaticMarkup（没有 jsdom），所以交互流程
 * （填表、提交、切模式）测不了——那部分逻辑在 lib/auth-client 那份测试里覆盖。
 */

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AuthCard, BrandPanel, safeNextPath } from "../MianTuanAuthPage";
import { MianTuanMark, MianTuanWordmark } from "@/components/brand/MianTuanMark";

describe("回跳地址（开放重定向防护）", () => {
  it("接受站内相对路径", () => {
    expect(safeNextPath("/agent-loop/workbench")).toBe("/agent-loop/workbench");
    expect(safeNextPath("/agent-loop/sliderule?x=1")).toBe("/agent-loop/sliderule?x=1");
  });

  it("拒绝外站绝对地址", () => {
    // 放过去就是开放重定向：钓鱼链接挂在你的域名下
    expect(safeNextPath("https://evil.com")).toBe("/agent-loop/workbench");
    expect(safeNextPath("http://evil.com/x")).toBe("/agent-loop/workbench");
  });

  it("拒绝协议相对地址", () => {
    // `//evil.com` 浏览器当绝对地址处理——最经典的绕过写法
    expect(safeNextPath("//evil.com")).toBe("/agent-loop/workbench");
    expect(safeNextPath("//evil.com/path")).toBe("/agent-loop/workbench");
  });

  it("拒绝反斜杠变体", () => {
    // 部分浏览器把 `\` 等价于 `/`，`/\evil.com` 会被当成协议相对地址
    expect(safeNextPath("/\\evil.com")).toBe("/agent-loop/workbench");
  });

  it("空值回默认页", () => {
    expect(safeNextPath(null)).toBe("/agent-loop/workbench");
    expect(safeNextPath("")).toBe("/agent-loop/workbench");
    expect(safeNextPath("   ")).toBe("/agent-loop/workbench");
  });

  it("不以斜杠开头的一律拒绝", () => {
    // `evil.com` 这种相对路径在某些路由实现下会被拼成外站
    expect(safeNextPath("evil.com")).toBe("/agent-loop/workbench");
    expect(safeNextPath("javascript:alert(1)")).toBe("/agent-loop/workbench");
  });
});

describe("品牌标识", () => {
  it("用的是官方素材，不是手绘复刻", () => {
    // 2026-08-03：这里原本测的是"同页多实例的渐变 id 不撞车"——那是手写 SVG
    // 时代的问题（写死 id 会让第二个实例引用到第一个的定义）。换成官方 PNG
    // 之后不存在 id，那条测试没有对象了。
    //
    // 换成钉住"用的是那份素材"：这个标识同时被 index.html 的 favicon 引用，
    // 走同一份文件才不会出现"标签页和页面里是两个版本"。
    const markup = renderToStaticMarkup(
      <div>
        <MianTuanMark size={40} />
        <MianTuanMark size={20} />
      </div>
    );
    expect(markup).toContain("/brand/miantuan-mark.png");
    // 尺寸由 size 一个数控制，两个实例各自生效
    expect(markup).toContain('width="40"');
    expect(markup).toContain('width="20"');
  });

  it("横版标识用官方素材，不是手排的文字", () => {
    // 2026-08-03：此前是「方标 + 手排两行文字」，字体/字重/字间距全是估的，
    // 跟官方横版摆一起看得出不是同一个东西。现在用官方一体图。
    const markup = renderToStaticMarkup(<MianTuanWordmark />);
    expect(markup).toContain("miantuan-horizontal.png");
    expect(markup).toContain('alt="面团 AI"');
    // 只定高、宽度按比例：写死宽度会把「面团 AI」压扁
    expect(markup).toContain("width:auto");
  });

  it("有无障碍标签", () => {
    // 从 svg 的 aria-label 变成 img 的 alt——语义一样：读屏软件要念出"面团"，
    // 不能是一张没有说明的图。
    expect(renderToStaticMarkup(<MianTuanMark />)).toContain('alt="面团"');
  });
});

describe("登录页", () => {
  it("品牌区有插画、主标语和产品说明", () => {
    // 整页渲染要 wouter 的 window，这里直接测两个展示组件——
    // 它们才是版式与文案的载体，路由不是这份测试的目标。
    const markup = renderToStaticMarkup(<BrandPanel />);
    // 2026-08-03 改版：左侧从"一行标题 + 三条要点"换成"插画 + 主标语"，
    // 对齐用户给的设计稿（此前大屏下左半边几乎是空的）。
    expect(markup).toContain("miantuan-team-illustration.png");
    expect(markup).toContain("不止一面，即刻成团");
    expect(markup).toContain("把一句模糊想法");
    // 2026-08-03 用户反馈"品牌名太多了"：此前左下角一处 miantuan.ai、表单
    // 底下还有一处带图标的，加上左上角标识里的 MIANTUAN.AI 共三遍。现在只
    // 保留标识自带的那一处（大写，是 logo 的一部分），额外的两处小写页脚去掉。
    // 品牌名现在只由左上角那张官方横版标识承载（图里含 miantuan.ai），
    // DOM 里不该再有额外的文字页脚——用户反馈"品牌名出现太多次"。
    expect(markup).toContain("miantuan-horizontal.png");
    expect(markup).not.toContain(">miantuan.ai<");
    // 插画是装饰性的，必须对读屏软件隐藏，否则念出一串无意义的文件名
    expect(markup).toContain('aria-hidden');
  });

  it("「浏览无需登录」这条产品规则有实际出口，不只是一句说明", () => {
    // 改版前这句话只写在左侧要点里，页面上却没有任何地方能走到应用中心——
    // 说了不用登录，却只给了登录一条路。现在是一个真按钮。
    const markup = renderToStaticMarkup(
      <AuthCard onDone={() => {}} onBrowse={() => {}} />
    );
    expect(markup).toContain('data-testid="auth-browse-without-login"');
    expect(markup).toContain("暂不登录，浏览应用市场");
  });

  it("字段有独立标签，不只靠 placeholder", () => {
    // placeholder 一开始填就消失，辅助技术也读不到字段名
    const markup = renderToStaticMarkup(
      <AuthCard onDone={() => {}} onBrowse={() => {}} />
    );
    expect(markup).toContain('for="auth-email"');
    expect(markup).toContain('for="auth-password"');
  });

  it("表单卡有邮箱、密码和切换注册的入口", () => {
    const markup = renderToStaticMarkup(<AuthCard onDone={() => {}} onBrowse={() => {}} />);
    expect(markup).toContain('data-testid="auth-email"');
    expect(markup).toContain('data-testid="auth-password"');
    expect(markup).toContain('data-testid="auth-switch-mode"');
    expect(markup).toContain("还没有账号");
  });

  it("主按钮是设计稿上的纯蓝，不是蓝紫渐变", () => {
    // 2026-08-03：此前是 linear-gradient(135deg,#3B82F6,#7C3AED)，跟设计稿不符，
    // 也跟这一页其余的蓝色链接不是同一个蓝。钉住这条是因为渐变很容易被"顺手
    // 加点视觉效果"改回去。
    const markup = renderToStaticMarkup(<AuthCard onDone={() => {}} onBrowse={() => {}} />);
    expect(markup).toContain("bg-blue-600");
    expect(markup).not.toContain("linear-gradient");
  });

  it("有「忘记密码?」入口，且它真的通向一条流程", () => {
    // 设计稿上一直画着这个入口，但后端此前**没有找回密码的接口**——链接指向
    // 空气。这次是连着后端两个接口一起补的。
    const markup = renderToStaticMarkup(<AuthCard onDone={() => {}} onBrowse={() => {}} />);
    expect(markup).toContain('data-testid="auth-forgot-password"');
    expect(markup).toContain("忘记密码?");
  });

  it("默认是登录模式，不是注册", () => {
    // 回访用户远多于新用户；默认落在注册会让老用户多点一次
    const markup = renderToStaticMarkup(<AuthCard onDone={() => {}} onBrowse={() => {}} />);
    expect(markup).toContain("浏览无需登录；复刻和推演需要账号。");
    expect(markup).not.toContain("至少 8 位");
  });
});
