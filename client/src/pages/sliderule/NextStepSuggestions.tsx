/**
 * NextStepSuggestions —— 结果卡下面那几行「接着可以做什么」。
 *
 * ## 为什么是**整行**而不是小 chip（2026-09-14，对照 Manus 截图）
 *
 * 上一版把模型的下一步塞进了输入条上方的 hint chip 行。对照 Manus 才看明白
 * 位置和形态都不对：
 *
 *   · **位置**：建议是关于「刚做出来的这个东西」的，应该贴着结果；混进输入条
 *     的通用提示里，它跟「路线对比一下」这种万能词长得一样，读起来像装饰。
 *   · **形态**：Manus 是整行可点。一眼就知道「点它就接着干」。小 pill 只能
 *     塞半句话，长一点就截断成「联调 check/build/test，确…」，等于没说。
 *
 * 所以这里是整行，输入条那边**退回通用提示**（两者各管各的，不再互相顶替）。
 *
 * ## 2026-09-19 对照 Manus 完成态：聊天图标整行，不要白底卡
 *
 * 上午那版去掉对话气泡，却给每行铺了 `bg-white` + 边框。三条叠在一起
 * 又是一张白卡。下午空心圆 → 方标 → 圆形前进箭头，用户最后要
 * 「聊天信息」图标。左边 `MessageSquare`，右边仍是箭头。
 * 判断还是 `deriveNextStepChips`。
 *
 * ## 边界
 *
 *   · 判断仍在 `next-step-chips.ts`（纯函数），这里只画。
 *   · 一条都没有就整块不画——不摆一个空壳，也不拿通用词凑数。
 *   · 点一下是**填进输入框可再编辑**，跟现有 hint chip 的契约一致；
 *     不直接发出去（模型写的待办常带工具名，用户多半想改一句再发）。
 */

import React from "react";
import { ArrowRight, MessageSquare } from "lucide-react";
import { deriveNextStepChips } from "./next-step-chips";
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";

export function NextStepSuggestions({
  state,
  onPick,
}: {
  state: Pick<V5SessionState, "controlTodo"> | null | undefined;
  onPick?: (text: string) => void;
}) {
  const items = deriveNextStepChips(state);
  if (!items.length || !onPick) return null;

  return (
    <div className="my-2 space-y-1.5" data-testid="next-step-suggestions">
      {items.map(text => (
        <button
          key={text}
          type="button"
          onClick={() => onPick(text)}
          data-testid="next-step-suggestion"
          title="填入输入框，可再编辑"
          className="flex w-full items-center gap-2.5 py-1.5 text-left text-[#333] hover:text-[#171717]"
        >
          <MessageSquare
            className="h-4 w-4 shrink-0 text-[#8a8a8a]"
            aria-hidden
          />
          {/* ⚠ 不截断：整行的意义就是把话说完。挤不下就换行，不给省略号。 */}
          <span className="min-w-0 flex-1 text-[13px] leading-5">
            {text}
          </span>
          <ArrowRight
            className="h-3.5 w-3.5 shrink-0 text-[#c4c4c4]"
            aria-hidden
          />
        </button>
      ))}
    </div>
  );
}
