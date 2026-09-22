# -*- coding: utf-8 -*-
"""会话事件的 wire 形状。抄 grok-build `xai-grok-session-events`：

    Typed per-session event log — 事件自描述，前端不查翻译表。

本文件是叶子：不依赖 services 里任何其它模块。展示字段由调用方传入
（调用方读 stage_legal.describe），这里只冻结要上 SSE 的键。

⚠ 前端 RECIPE_CORE / 推演钟 MODULE_TO_STEP 就是对着这些键删的。
键集变了，前端渲染会空，不许在前端再补一张表。
"""

from __future__ import annotations

from typing import Any, Dict, Mapping, Optional

#: 事件上允许出现的展示键。多一个前端也不认；少一个前端不得猜。
WIRE_KEYS = (
    "stage",
    "label",
    "group",
    "eta",
    "order",
    "of",
    "productStep",
    "refineOnly",
)


def envelope(desc: Optional[Mapping[str, Any]] = None, **extra: Any) -> Dict[str, Any]:
    """从账本描述（或 kwargs）抽出 wire 字段。名单外的键丢掉。"""
    src: Dict[str, Any] = {}
    if desc:
        src.update(desc)
    src.update(extra)
    return {k: src[k] for k in WIRE_KEYS if k in src and src[k] is not None}


class RepeatSuppressor:
    """同一条内容重复上流时只让第一次过去，并且**数出抑制了多少**。

    ## 事故（2026-09-06 第二轮真机）

    一轮里 `quality_notice` 发了 **18 条，去重后只有 6 条**——同一条
    「页面 X：对比度不足」原样重复了三遍。

    根因不在质检本身：`spec_first_pipeline` 每次跑完都把全部页面重检一遍并
    广播，而那条流水线在**一个 turn 里跑多次**（每个 factory 跳一次：
    pages / structure / bind）。流水线内部有自己的 `_quality_notices_var`
    桶，所以单次运行不重复；重复发生在**跨运行**，而 sink 是**流级**的、
    一直装着。所以去重也必须落在流级——跟 `stage_pairing.StagePairTracker`
    同一层，同一个理由。

    ## 抄的是 grok 的哪一处

    `xai-grok-sampling-types/src/conversation.rs:2161+` 的
    `dedup_duplicate_tool_results()`：

        /// Remove duplicate `ToolResult` entries for the same `tool_call_id`.
        /// … If a `tool_call_id` appears more than once, only the **last**
        /// occurrence is kept (the real result), and earlier duplicates are removed.
        /// Returns the number of duplicate entries removed.

    照抄三件事：
      ① 去重键是**稳定身份**（它用 `tool_call_id`），不是"看着差不多"；
      ② 头注写明**为什么必须去重**（它那边是 LLM API 拒绝重复结果）；
      ③ **返回抑制了几条** —— 静默丢弃事件是本仓反复吃亏的形状，
         丢了得有个数说得出来。

    ## ⚠ 跟 grok 差的那一点，以及为什么

    grok 保留**最后一条**（"the real result"），因为它改的是一个**可变的
    conversation 列表**，能把先前那条删掉。SSE 是**发出去就收不回**的流，
    没有"删掉先前那条"这回事。所以等价做法是反过来：**让第一条过去，压住
    后来的原样重复**。

    这不是抄漏了，是同一个目标在不同介质上的写法。写在这里，免得下一个人
    照着 grok 又把它改成"留最后一条"——那在流上等于**先发一条再发一条**，
    去重完全失效。

    ## ⚠ 去重键必须带上内容

    只按身份去重的话，同一页在**打孔之后**重检得出的**不同**结论会被吃掉，
    而那正是新信息。所以键是 `(身份, 内容指纹)`：内容变了就放行。
    """

    __slots__ = ("_seen", "_suppressed", "_passed")

    def __init__(self) -> None:
        #: 身份 → 上一次放行的内容指纹
        self._seen: Dict[str, str] = {}
        self._suppressed = 0
        self._passed = 0

    def allow(self, key: str, payload: str) -> bool:
        """这一条该发出去吗。原样重复返回 False，并记一笔。"""
        k = str(key or "")
        p = str(payload or "")
        if self._seen.get(k) == p:
            self._suppressed += 1
            return False
        self._seen[k] = p
        self._passed += 1
        return True

    @property
    def suppressed(self) -> int:
        return self._suppressed

    def counters(self) -> Dict[str, int]:
        """`passed + suppressed` 就是调用方本来打算发多少条。"""
        return {
            "passed": self._passed,
            "suppressed": self._suppressed,
            "distinct": len(self._seen),
        }


def notice_identity(note: Mapping[str, Any]) -> str:
    """一条 quality_notice 的**稳定身份**。

    `kind` + 它指向的东西（页面 / 键）。文本不进身份——文本是**内容**，
    由 `RepeatSuppressor` 另外比。两者混进一个键的话，文案改一个字就
    被当成另一条通知，去重形同虚设。
    """
    kind = str(note.get("kind") or "")
    for field in ("pageId", "key", "ref", "nodeId"):
        value = note.get(field)
        if value:
            return f"{kind}|{field}={value}"
    # 没有指向物的通知：身份里**带上文本**。
    #
    # ⚠ 这里不能只用 `kind`（第一版就是，真机当场失效）。对比度那类通知
    #   一轮里对六个页面各说一次，如果六条共用 `contrast` 这一个身份，
    #   而内容又轮着变（页面名不同），`RepeatSuppressor` 每次都判成
    #   "内容变了 → 放行"，**一条都压不住**。
    #
    #   带上文本之后，「同一句原样再来」才是同一个身份，压得住；
    #   「换了一句」本来就是另一条通知，本该放行。
    #   代价是这类通知丧失"内容变了要放行"的语义 —— 但对没有指向物的通知，
    #   "换了内容"和"换了一条"本来就分不开，这是诚实的降级。
    text = str(note.get("text") or "")
    return f"{kind}|text={text}" if text else kind


def notice_payload(note: Mapping[str, Any]) -> str:
    """一条 quality_notice 的**内容**指纹。文本变了就是新信息，要放行。"""
    items = note.get("items")
    return f"{note.get('text') or ''}|{len(items) if isinstance(items, list) else ''}"
