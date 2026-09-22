import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ExperienceBlockBoundary } from "../live-runtime/block-registry";
import type { ExperienceBlockRendererProps } from "../live-runtime/block-registry";
import { demoFor, ENTITY_ROWS, HAS_ANY_DEMO } from "../ComponentsLibraryPage";
import catalog from "@experience-blocks";

/**
 * 组件库墙上不许大面积「还没为它准备示例数据」（2026-08-11）。
 *
 * 用户看着「主体区」「补充说明」两个筛选说「怎么还全是表格」。去重砍掉 91 个
 * 之后再看那两屏，剩下的仍然一片一样——但那**不是重复**，是每张卡都在说
 * 「这一页还没为它准备示例数据」。**没东西可看，当然看着都一样。**
 *
 * 手写夹具只覆盖 229/316。补的办法不是再手写 87 份（会一直欠着），是按目录里
 * 本来就有的 `bindingSchema` 现合成绑定、值仍取这一页原有的中文示例数据。
 *
 * 这条用例守的是**结果**：合成之后真能渲染出内容的比例不许掉下去。
 * 只断言"有夹具"是不够的——合成出来的绑定照样可能喂不饱区块（缺日期字段之类），
 * 那时它渲染的还是空态，墙上看着没有任何区别。
 */
type Entry = { type: string };

describe("组件库墙", () => {
  const types = (catalog as { blocks: Entry[] }).blocks.map(b => b.type);

  it("每个区块要么有手写夹具，要么合成得出来", () => {
    const naked = types.filter(t => !HAS_ANY_DEMO(t));
    expect(naked, `这些区块墙上是一张空卡：${naked.slice(0, 10).join(", ")}`).toEqual([]);
  });

  it("墙上真渲染出内容的比例不许掉下去", () => {
    // 判据取**结果**不取"有没有夹具"：合成出来的绑定照样可能喂不饱区块
    // （缺日期字段之类），那时它渲染的还是空态，墙上看着没有任何区别。
    let real = 0;
    const empty: string[] = [];
    for (const type of types) {
      const d = demoFor(type);
      let html = "";
      try {
        html = renderToStaticMarkup(
          <ExperienceBlockBoundary
            {...({ block: d.block, entityRows: ENTITY_ROWS, onAction: () => undefined, ...d.extra } as unknown as ExperienceBlockRendererProps)}
          />
        );
      } catch {
        empty.push(type);
        continue;
      }
      if (/ant-empty|adm-error-block|尚未绑定|不支持此区块|还没为它准备/.test(html)) empty.push(type);
      else real += 1;
    }
    const ratio = real / types.length;
    // eslint-disable-next-line no-console
    console.log(`墙上真渲染出内容：${real}/${types.length}（${(ratio * 100).toFixed(1)}%），空态 ${empty.length}`);
    expect(ratio, `只有 ${real}/${types.length} 张卡有东西看，其余是空卡：${empty.slice(0, 8).join(", ")}`)
      .toBeGreaterThan(0.9);
  });
});
