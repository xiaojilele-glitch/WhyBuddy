/**
 * 手机档：区块要真渲染，PC 组件不许再混进来（2026-07-28）。
 *
 * 背景是两个盘点结论：
 *
 * ① `page.layout.mobile` 曾是死字段。区块摆法内联在 defaultPageContent 里，
 *    而那段只在桌面壳跑（手机壳走 phonePageContent），里面读的 `isPhone`
 *    恒为 false——LLM 在生成这个字段、Gate 在校验它，运行时永远读不到。
 *    改成抽出 renderExperienceBlockScaffold(forPhone)，两个壳共用。
 *
 * ② phone-mobile/ 下的组件一律走 React.lazy。不是风格偏好：antd-mobile 的
 *    CJS 入口一被静态引入，node 环境的测试就在收集期炸（Unexpected token
 *    ':'）——我把 AdmButton/ProgressBar 直接 import 进来时，8 个测试文件
 *    当场起不来。这条约定破了，跟组件本身写得对不对无关。
 *
 * 用源码断言而不是渲染断言：仓库没有 jsdom，AppRuntimeScreen 这种带一堆
 * hook 的组件跑不起来；而这两条恰恰是"编译能过、测试能过、线上无声失效"
 * 的类型，值得单独钉住。
 */
import { describe, it, expect } from "vitest";

const screenSrc = await import("../AppRuntimeScreen.tsx?raw").then(
  m => (m as unknown as { default: string }).default
);
const fieldValueSrc = await import("../FieldValue.tsx?raw").then(
  m => (m as unknown as { default: string }).default
);

describe("手机档体验区块", () => {
  it("槽位来源由参数决定，不再读那个恒为 false 的 isPhone", () => {
    expect(screenSrc).toMatch(
      /const renderExperienceBlockScaffold = \(\s*forPhone: boolean/
    );
    expect(screenSrc).toContain("forPhone && page.layout?.mobile");
    // 旧写法：内联在桌面壳里读 isPhone —— 恢复它就等于把 layout.mobile 重新写死
    expect(screenSrc).not.toContain("isPhone && page.layout.mobile");
  });

  it("两个壳都渲染区块 —— 手机档不再是一个裸列表", () => {
    expect(screenSrc).toContain("renderExperienceBlockScaffold(true)");
    expect(screenSrc).toContain("renderExperienceBlockScaffold(false)");
  });

  it("helper 定义在两个消费点之前（const 有 TDZ，JSX 是即时构造的）", () => {
    const def = screenSrc.indexOf("const renderExperienceBlockScaffold");
    const phoneUse = screenSrc.indexOf("renderExperienceBlockScaffold(true)");
    const deskUse = screenSrc.indexOf("renderExperienceBlockScaffold(false)");
    expect(def).toBeGreaterThan(-1);
    expect(def).toBeLessThan(phoneUse);
    expect(def).toBeLessThan(deskUse);
  });
});

describe("antd-mobile 只走懒加载", () => {
  it("运行时主文件不静态 import antd-mobile", () => {
    // 静态引入会把 antd-mobile 拉进每个测试的依赖图，收集期直接炸
    expect(screenSrc).not.toMatch(/^import .* from "antd-mobile"/m);
    expect(fieldValueSrc).not.toMatch(/^import .* from "antd-mobile"/m);
  });

  it("手机档专用组件都在 phone-mobile/ 下且 lazy", () => {
    for (const name of [
      "PhoneDetailFields",
      "PhoneActionButton",
      "PhonePageList",
    ]) {
      expect(screenSrc).toContain(`import("./phone-mobile/${name}")`);
    }
    expect(fieldValueSrc).toContain('import("./phone-mobile/PhoneProgress")');
  });
});

describe("详情正文分档", () => {
  it("手机走 antd-mobile 字段表，桌面留 Descriptions", () => {
    expect(screenSrc).toContain("LazyPhoneDetailFields");
    // 桌面档仍要有 Descriptions —— 这次改的是"手机也用它"，不是把它删了
    expect(screenSrc).toContain("<Descriptions");
    // 字段节点只构造一份，两档共用（标签上的 X 光探针不能只有一档有）
    expect(screenSrc).toContain("const detailFieldNodes");
  });

  it("进度字段在手机档换成 ProgressBar", () => {
    expect(fieldValueSrc).toContain("phone?: boolean");
    expect(fieldValueSrc).toContain("LazyPhoneProgress");
  });
});
