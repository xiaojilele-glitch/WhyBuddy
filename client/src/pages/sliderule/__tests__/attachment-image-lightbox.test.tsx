/**
 * 附件图片点击放大（2026-08-20）。
 *
 * 锁三件事：
 *   1. 放大层真的是大图（不是把 40×40 缩略图再画一遍）；
 *   2. 点遮罩 / 关钮 / Esc 都能关（关钮在 SSR HTML 里，另两个在组件源码）；
 *   3. 缩略图 onClick 接在 ComposerDock 通电的那条链上，并且 portal 到
 *      document.body——首页输入条嵌在 Studio overflow-hidden 里，写在内部
 *      会被裁掉，点了像没反应。
 *
 * 仓库约定：react-dom/server renderToStaticMarkup + 剥注释后的源码判据，
 * 不引 jsdom。每条正向配一条反向，避免「testid 还在但 onClick 没了」假绿。
 */
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AttachmentImageLightbox } from "../ComposerDock";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function dockSource(): string {
  return stripComments(
    readFileSync(new URL("../ComposerDock.tsx", import.meta.url), "utf8")
  );
}

describe("AttachmentImageLightbox", () => {
  it("开灯态画出大图，不是 40×40 缩略图", () => {
    const html = renderToStaticMarkup(
      <AttachmentImageLightbox
        src="blob:preview-media"
        name="media-image-1.png"
        onClose={() => {}}
      />
    );
    expect(html).toContain('data-testid="sliderule-attachment-lightbox"');
    expect(html).toContain('data-testid="sliderule-attachment-lightbox-image"');
    expect(html).toContain('src="blob:preview-media"');
    expect(html).toContain("media-image-1.png");
    expect(html).toContain("max-h-[90vh]");
    expect(html).toContain("max-w-[90vw]");
    // 反向：放大层若还带着缩略图尺寸，点开等于没放大
    expect(html).not.toContain("h-10 w-10");
  });

  it("关钮在层上，遮罩点击和 Esc 写在组件里（SSR 不序列化 onClick）", () => {
    const html = renderToStaticMarkup(
      <AttachmentImageLightbox
        src="blob:preview-media"
        name="shot.png"
        onClose={() => {}}
      />
    );
    expect(html).toContain('data-testid="sliderule-attachment-lightbox-close"');
    expect(html).toContain("关闭预览");

    const src = dockSource();
    const lb = src.slice(
      src.indexOf("export function AttachmentImageLightbox"),
      src.indexOf("function looksLikeUrl")
    );
    expect(lb).toContain("onClick={onClose}");
    expect(lb).toContain("e.stopPropagation()");
    expect(lb).toContain('e.key === "Escape"');
    // 反向：点图片本身不该关掉——否则刚点开就关
    expect(lb).not.toMatch(/lightbox-image[\s\S]*onClick=\{onClose\}/);
  });
});

describe("ComposerDock 缩略图接通电的放大链", () => {
  it("图片预览卡能点开，非图片文件卡不能", () => {
    const src = dockSource();
    const card = src.slice(
      src.indexOf("sliderule-attachment-card"),
      src.indexOf("sliderule-attachment-remove")
    );
    const fileText = card.indexOf("<FileText");
    expect(card.indexOf("att.previewUrl ?")).toBeGreaterThan(-1);
    expect(fileText).toBeGreaterThan(-1);

    const imageBranch = card.slice(0, fileText);
    expect(imageBranch).toContain(
      'data-testid="sliderule-attachment-preview-open"'
    );
    expect(imageBranch).toContain("setLightbox");
    expect(imageBranch).toContain("onClick");
    expect(imageBranch).toContain("att.previewUrl");

    const fileBranch = card.slice(fileText);
    expect(fileBranch).not.toContain("sliderule-attachment-preview-open");
    expect(fileBranch).not.toContain("setLightbox");
  });

  it("放大层 portal 到 document.body，关了把 lightbox 清掉", () => {
    const src = dockSource();
    expect(src).toContain("{lightbox &&");
    const portalCall = src.match(/createPortal\([\s\S]*?document\.body/)?.[0];
    expect(portalCall).toBeTruthy();
    expect(portalCall).toContain("AttachmentImageLightbox");
    expect(portalCall).toContain("setLightbox(null)");
    // 反向：{lightbox && <AttachmentImageLightbox />} 写在输入条内部
    // 会被 Studio overflow-hidden 裁掉，点了像没反应
    const live = src.slice(src.indexOf("{lightbox &&"));
    expect(live).toContain("createPortal");
    expect(live).toContain("document.body");
  });
});
