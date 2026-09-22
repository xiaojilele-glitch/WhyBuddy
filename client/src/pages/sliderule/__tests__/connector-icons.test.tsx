/**
 * 连接器图标图稿。
 *
 * 重点在**兜底**：新连接器忘了配图稿时，页面上要是一个中性插头，
 * 不是空白、不是破图、更不是抛错——一排碎图会让人以为连接器本身坏了。
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ConnectorIcon } from "../connector-art/connector-icons";

describe("认得出的图稿", () => {
  it("天气 / 行情各画各的，且都是真图稿（svg），不是字体图标", () => {
    const w = renderToStaticMarkup(<ConnectorIcon icon="weather" />);
    const c = renderToStaticMarkup(<ConnectorIcon icon="chart" />);
    expect(w).toContain('data-art="weather"');
    expect(c).toContain('data-art="chart"');
    expect(w).toContain("<svg");
    expect(c).toContain("<svg");
    // 两张图稿必须真的不一样——同一张图配两个名字等于没配
    expect(w).not.toBe(c);
    const fx = renderToStaticMarkup(<ConnectorIcon icon="fx" />);
    expect(fx).toContain('data-art="fx"');
    expect(fx).toContain("<svg");
    expect(fx).not.toBe(w);
    expect(fx).not.toBe(c);
  });

  it("图稿是多色的（有渐变），不是单色字形", () => {
    const w = renderToStaticMarkup(<ConnectorIcon icon="weather" />);
    expect(w).toContain("linearGradient");
    expect(w).toMatch(/stop-color|stopColor/i);
  });
});

describe("兜底", () => {
  it("认不出的图稿名 → 画插头，不空白也不抛", () => {
    const html = renderToStaticMarkup(<ConnectorIcon icon="还没配图稿的连接器" />);
    expect(html).toContain('data-art="plug"');
    expect(html).toContain("<svg");
  });

  it("空图稿名同样兜底", () => {
    expect(renderToStaticMarkup(<ConnectorIcon icon="" />)).toContain(
      'data-art="plug"'
    );
  });
});

describe("自带 logo 的连接器（iconUrl）", () => {
  it("给了地址就用图片，并且不带 referrer", () => {
    const html = renderToStaticMarkup(
      <ConnectorIcon icon="weather" iconUrl="https://example.com/a.png" />
    );
    expect(html).toContain('data-art="url"');
    expect(html).toContain('src="https://example.com/a.png"');
    // ⚠ 大小写不敏感：React 19 的 SSR 把它原样输出成 referrerPolicy，
    //   钉小写字面量会以一句"看不懂为什么"的报错红掉，而行为完全正确。
    expect(html).toMatch(/referrerpolicy="no-referrer"/i);
  });

  it("组件里留着「图挂了回落图稿」的路径——一排碎图比统一插头难看得多", async () => {
    const src = await import("../connector-art/connector-icons?raw").then(
      m => (m as unknown as { default: string }).default
    );
    // 钉的是语义：有 onError，并且它会把状态翻成"坏了"从而走回图稿分支
    expect(src).toContain("onError");
    expect(src).toMatch(/setBroken\(true\)/);
    expect(src).toMatch(/iconUrl && !broken/);
  });
});
