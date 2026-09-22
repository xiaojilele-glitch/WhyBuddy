/**
 * LlmLiveOutput — LLM 输出的活动行。
 *
 * 2026-08-18：摘要行改成和步骤同一套 Cursor 语法（勾/转圈 + 动词 + N 字），
 * 不再写「标题 · N 字符」配一个脉冲点。JSON / 看起来像 JSON 的默认折叠。
 *
 * 尾窗内贴底跟随 + 用户接管：在底部才跟随最新输出；上滚即停。
 */

import React from "react";
import { ArrowDown } from "lucide-react";
import { repairPartialJson } from "./system-screens/five-system-model";
import { Response } from "@/components/ai/response";
import { useSmoothText } from "./use-smooth-text";
import { compactVerb, formatCharMeta } from "./activity-rows";
import { ActivityToggleRow } from "./ActivityList";

/** 轻量 JSON 高亮：按 token 切成着色 span（不引编辑器，流式高频更新便宜）。 */
const JSON_TOKEN_RE =
  /("(?:[^"\\]|\\.)*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

function highlightJson(pretty: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of pretty.matchAll(JSON_TOKEN_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(pretty.slice(last, idx));
    if (m[1] !== undefined) {
      // 字符串：带冒号的是键（深蓝），否则是值（墨绿）
      out.push(
        <span key={key++} style={{ color: m[2] ? "#0958d9" : "#2f6f4f" }}>
          {m[1]}
        </span>
      );
      if (m[2]) out.push(m[2]);
    } else if (m[3] !== undefined) {
      out.push(
        <span key={key++} style={{ color: "#b45309" }}>
          {m[3]}
        </span>
      );
    } else {
      out.push(
        <span key={key++} style={{ color: "#b45309" }}>
          {m[0]}
        </span>
      );
    }
    last = idx + m[0].length;
  }
  if (last < pretty.length) out.push(pretty.slice(last));
  return out;
}

export function LlmLiveOutput({
  title,
  text,
  chars,
  formatJson = false,
  done = false,
  className = "",
}: {
  /** 来源标题（"正在分析风险" / "五系统模型起草中"…） */
  title: string;
  text: string;
  /**
   * 真实字数。**留档回放必须传**——`text` 那时是被落库瘦身截过的，
   * 数它得到的恒是 1201（1200 上限 + 省略号），一排步骤会写着同一个数
   * （用户 2026-08-23 报的就是这个）。直播时不用传：那时 text 就是全文。
   */
  chars?: number;
  /** true = 流式 JSON（五系统起草）：容错解析美化 + 代码块外观 + 高亮 */
  formatJson?: boolean;
  /** true = 归档态（推演结束后的留档）：灰点无光标，默认折叠（Claude
   *  的"Thought for Xs"——留在对话里、要看点开） */
  done?: boolean;
  className?: string;
}) {
  const looksJson = formatJson || /^\s*[{[]/.test(text);
  // 2026-08-27 PR-2：轨迹默认折叠。点开才见 risk.analyze 原文——
  // 进度看推演钟，不靠散文。此前流式纯文字默认展开，用户要读完想法
  // 才知道「现在在哪一步」。
  const [collapsed, setCollapsed] = React.useState(true);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  // 贴底跟随：用户在底部才跟随；往上滚即接管（followRef 存意图，state 控胶囊）
  const followRef = React.useRef(true);
  const [following, setFollowing] = React.useState(true);

  // E16 平滑缓冲：网关突发大块 → 展示层匀速放出（归档态直通）
  const smooth = useSmoothText(text, { enabled: !done });

  // 流式 JSON 美化：每 +200 字符重解一次（容错解析未收尾 JSON）。
  // 只有"美化/高亮结果"走节流 memo；原文本身必须每帧跟随平滑流——
  // 否则非 JSON 流会冻结在第一帧（曾踩过：正文停住、字符数还在涨）。
  const treatAsJson = formatJson || looksJson;
  const formatKey = treatAsJson ? Math.floor(smooth.length / 200) : -1;
  const prettyNodes = React.useMemo(() => {
    if (!treatAsJson || !smooth) return null;
    const parsed = repairPartialJson(smooth);
    if (parsed === null) return null;
    return highlightJson(JSON.stringify(parsed, null, 2));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 按长度桶节流重解
  }, [treatAsJson, formatKey]);
  const body: React.ReactNode =
    treatAsJson && prettyNodes !== null ? prettyNodes : smooth;

  // 新内容到达：仅当用户在底部时窗口内贴底（Claude/终端行为）
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el && followRef.current) el.scrollTop = el.scrollHeight;
  }, [text, prettyNodes, collapsed]);

  const onScroll = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    followRef.current = atBottom;
    setFollowing(atBottom);
  }, []);

  const jumpToLatest = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    followRef.current = true;
    setFollowing(true);
    el.scrollTop = el.scrollHeight;
  }, []);

  return (
    <div data-testid="sliderule-llm-draft" className={`min-w-0 ${className}`}>
      <ActivityToggleRow
        status={done ? "done" : "running"}
        verb={compactVerb(title)}
        meta={formatCharMeta(chars ?? text.length)}
        open={!collapsed}
        testId="sliderule-llm-draft-toggle"
        onClick={() => setCollapsed(v => !v)}
      />
      {/* 点开后的纯文字思考流。默认折叠（PR-2）；滚动由外层聊天列负责。 */}
      {!collapsed && !treatAsJson && (
        <div
          data-testid="sliderule-llm-draft-body"
          aria-live="polite"
          className="mt-1.5 pl-3.5 text-[12.5px] leading-6 text-stone-500 [&_h1]:text-[13px] [&_h1]:font-semibold [&_h1]:text-stone-600 [&_h2]:text-[12.5px] [&_h2]:font-semibold [&_h2]:text-stone-600 [&_h3]:text-[12.5px] [&_h3]:font-medium [&_h3]:text-stone-600"
        >
          {/* 思考流是配角：标题全部降到正文号（Claude 的 thinking 从不喧宾夺主） */}
          <Response parseIncompleteMarkdown={!done}>{smooth}</Response>
          {!done && <span className="sr-caret text-[#1677ff]">▊</span>}
        </div>
      )}
      {/* 代码/JSON 面板：代码块外观 + 260px 尾窗（Claude 的工具活动行为） */}
      {!collapsed && treatAsJson && (
        <div className="relative mt-1.5 overflow-hidden rounded-lg border border-[#e5e7eb] bg-[#fafbfc]">
          <div
            ref={scrollRef}
            onScroll={onScroll}
            data-testid="sliderule-llm-draft-window"
            className="max-h-[260px] overflow-y-auto [scrollbar-gutter:stable]"
          >
            <pre
              data-testid="sliderule-llm-draft-body"
              className="whitespace-pre-wrap break-all px-3 py-2 font-mono text-[11.5px] leading-6 text-[#1f2329]"
            >
              {body}
              {!done && <span className="sr-caret text-[#1677ff]">▊</span>}
            </pre>
          </div>
          {/* 顶部渐隐：提示窗口上方还有已输出内容（可向上滚动回看） */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-[#fafbfc] to-transparent" />
          {/* 用户滚上去回看时：一键回到最新 */}
          {!following && (
            <button
              type="button"
              onClick={jumpToLatest}
              data-testid="sliderule-llm-draft-latest"
              className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full border border-[#e5e7eb] bg-white px-2.5 py-1 text-[11px] font-medium text-stone-600 shadow-sm transition hover:bg-[#eef0f4]"
            >
              <ArrowDown className="h-3 w-3" />
              最新
            </button>
          )}
        </div>
      )}
    </div>
  );
}
