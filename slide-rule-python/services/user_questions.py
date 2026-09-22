# -*- coding: utf-8 -*-
"""问用户：一次可以问好几道，每道自带选项。纯函数，吃入参吐字符串。

抄的标准答案：grok-build
`xai-grok-tools/src/implementations/grok_build/ask_user_question/`
（`mod.rs` 的入参形状 + `format.rs` 的四条结果文案）。

──────────────────────────────────────────────────────────────────────────
## 为什么要换掉上一版

上一版 `ask_user` 的入参是 `{question: str, options: string[]}`——一道题、
选项只有一个标签。真机上模型想说清「选这个意味着什么」时无处可写，于是把
解释塞进 question 里，卡上就是一大坨字。而**用户要拿的主意往往不止一件**，
一次只能问一道，就只能连问三轮，或者干脆自己定了不问。

grok 的形状（`AskUserQuestionInput`）：

    questions: [
      {
        question: "…",                         # 一整句问句
        options: [
          {label: "…", description: "…",       # 选项 + 选它意味着什么
           preview: "…"},                      # 焦点时给人看的对照物，单选专用
          …
        ],
        multi_select: false,                   # 缺省单选
      },
      …
    ]

两条规矩写在**工具说明**里，不在代码里（`description_template`）：

    - Every question automatically gets an "Other" choice where the user can
      type their own answer.
    - Put your recommended option first and append "(Recommended)" to its label.

⚠ 第一条是**给客户端的承诺**：Other 由渲染侧补，模型不许自己往 options 里塞
  一个「其他」。这半边在 `AssumptionStrip` 的后继面板里兑现——生成侧/消费侧
  成对（本仓 §四），判据两头都钉。

──────────────────────────────────────────────────────────────────────────
## 四条结果文案：抄的是**语义**，不是英文原文

grok 的四条路径（`format.rs` 头注：「Each function produces the **exact**
model-visible string for one of the four user-action paths.」）：

    accepted        用户选完提交了
    cancelled       用户明确不答（Esc）—— **不是错误**
    chat_about_this 用户想聊聊（部分答案 + 转对话）
    skip_interview  用户不想再被问了，让你直接开干

我们这边控制面全程说中文，所以文案是中文的，但**结构逐条对齐**：
答案回喂必须带上问句原文（模型这一发看不到自己上一发问了什么，只给一个
「A」它无从对应），带上 preview 与用户手打的话。

⚠ cancelled 是一条**正常的用户决定**，不是工具失败。grok 专门为它写了一句
  purpose-built message 而不是复用权限拒绝那串。回成 error 会让模型以为
  自己调错了，下一轮换个花样再问一遍——用户已经说了不想答。
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence, Tuple

#: 一次最多问几道。grok 没有硬上限，靠提示词管；我们给一个——真机上
#: 模型一口气列过 7 道，卡摊开比屏幕还高，用户一道都不想答。
MAX_QUESTIONS = 4

#: 一道题最多几个选项。同上：选项一多，用户就开始滚动而不是决策。
MAX_OPTIONS = 5

#: 选项标签、描述的长度上限。超了截断——长标签会把卡撑成一段文章。
MAX_LABEL_CHARS = 40
MAX_DESCRIPTION_CHARS = 120

#: 「Other」那一项的 label。**渲染侧补，模型不许自己写**。
#: 放在这里是因为两侧都要认它：前端照它渲染，回喂时照它认出"用户手打的"。
OTHER_LABEL = "其他（自己写）"

#: 推荐项的后缀。工具说明要求模型把推荐项排第一并加这个后缀，
#: 渲染侧照它把那一项标出来。抄 grok 的 "(Recommended)"。
RECOMMENDED_SUFFIX = "（推荐）"

#: 用户明确不答。**这不是错误**，是一条正常的用户决定（grok CANCEL_TEXT）。
CANCEL_TEXT = (
    "用户没有回答这些问题。按你自己的判断继续，或者换个问法再问。"
)

#: 没有人可答（脚本跑、无人值守）。说「用户拒绝了」是撒谎（grok NO_OPERATOR_TEXT）。
NO_OPERATOR_TEXT = (
    "这一发没有人可以回答问题。按你自己的判断继续，不要等澄清。"
)


def unanswered_text(non_interactive: bool = False) -> str:
    """没答成时回给模型的那句话。两条路一个出口，免得措辞漂移。"""
    return NO_OPERATOR_TEXT if non_interactive else CANCEL_TEXT


def _clip(text: Any, limit: int) -> str:
    s = str(text or "").strip()
    return s if len(s) <= limit else s[: limit - 1] + "…"


def _coerce_option(raw: Any, index: int) -> Optional[Dict[str, str]]:
    """一个选项归一成 {label, description, preview}。

    ⚠ 认字符串：模型把 options 写成 ["手机号", "工号"] 是真机上最常见的一发
      （上一版 `ask_user` 的入参就是 string[]，模型学过那个形状）。不认就等于
      静默丢掉整道题——`plan_todo` 那个形状本仓已经栽过两次。
    """
    if isinstance(raw, str):
        raw = {"label": raw}
    if not isinstance(raw, dict):
        return None
    label = _clip(
        raw.get("label") or raw.get("text") or raw.get("value") or "", MAX_LABEL_CHARS
    )
    if not label:
        return None
    out: Dict[str, str] = {"label": label}
    description = _clip(
        raw.get("description") or raw.get("desc") or raw.get("why") or "",
        MAX_DESCRIPTION_CHARS,
    )
    if description:
        out["description"] = description
    preview = str(raw.get("preview") or "").strip()
    if preview:
        out["preview"] = preview
    return out


def coerce_questions(raw: Any) -> List[Dict[str, Any]]:
    """模型送来的这一笔归一成一串题。认不出的整题丢掉，认得出的留下。

    ⚠ 丢弃必须是**看得见的**：调用方拿到空列表就该走 fail-closed 那条
      （本仓 §三：接口返回 200 ≠ 它真的做了事）。这个函数只负责认，
      不负责替调用方决定"空了怎么办"。
    """
    if isinstance(raw, dict):
        raw = [raw]
    if isinstance(raw, str):
        raw = [{"question": raw}]
    out: List[Dict[str, Any]] = []
    for i, row in enumerate(list(raw or [])[:MAX_QUESTIONS]):
        if isinstance(row, str):
            row = {"question": row}
        if not isinstance(row, dict):
            continue
        question = str(row.get("question") or row.get("text") or "").strip()
        if not question:
            continue
        options: List[Dict[str, str]] = []
        for j, opt in enumerate(list(row.get("options") or [])[:MAX_OPTIONS]):
            got = _coerce_option(opt, j)
            if got is not None:
                options.append(got)
        item: Dict[str, Any] = {
            "id": str(row.get("id") or "").strip() or f"q{i + 1}",
            "question": question,
            "options": options,
        }
        # grok 的 schema 名是 snake_case，ACP 线上是 camelCase，两个都认。
        multi = row.get("multi_select")
        if multi is None:
            multi = row.get("multiSelect")
        if isinstance(multi, bool) and multi:
            item["multiSelect"] = True
        out.append(item)
    return out


def normalize_answers(raw: Any) -> Dict[str, List[str]]:
    """答案归一成 {问题id: [选中的标签, …]}。

    ⚠ 抄 grok `deserialize_string_or_vec_answers`：
      「Accepts both `"value"` (old wire format) and `["value"]` (new wire
      format) for each answer entry, normalizing strings into single-element
      vectors.」单选送一个裸字符串是真机上会发生的，收窄成只认数组等于
      把单选那一半静默丢掉。
    """
    out: Dict[str, List[str]] = {}
    if not isinstance(raw, dict):
        return out
    for key, value in raw.items():
        qid = str(key or "").strip()
        if not qid:
            continue
        if isinstance(value, str):
            picks = [value]
        elif isinstance(value, (list, tuple)):
            picks = [str(v) for v in value]
        else:
            continue
        picks = [p.strip() for p in picks if str(p or "").strip()]
        if picks:
            out[qid] = picks
    return out


def _question_text(questions: Sequence[Dict[str, Any]], qid: str) -> str:
    for q in questions:
        if str(q.get("id") or "") == qid:
            return str(q.get("question") or "")
    return qid


def _option_preview(
    questions: Sequence[Dict[str, Any]], qid: str, label: str
) -> Optional[str]:
    for q in questions:
        if str(q.get("id") or "") != qid:
            continue
        for opt in q.get("options") or []:
            if str(opt.get("label") or "") == label:
                preview = str(opt.get("preview") or "").strip()
                return preview or None
    return None


def format_accepted(
    questions: Sequence[Dict[str, Any]],
    answers: Dict[str, List[str]],
    notes: Optional[Dict[str, str]] = None,
) -> str:
    """用户选完了 → 回给模型的那段话。抄 grok `format_accepted_tool_result`。

    形状（grok 原文）：

        User has answered your questions: "<q>"="<label>" …, …. You can now
        continue with the user's answers in mind.

    三条规矩一条不少：
      · 只列**答了的**，没答的省掉（不是补一句"未回答"——那会让模型去追问）；
      · 多选把标签用「、」接起来；
      · 有 preview / 用户手打的话就带上，没有就不带。

    ⚠ 必须带问句原文。模型这一发看不到自己上一发问了什么，只回一个「A」
      它无从对应——真机上会当成新信息又问一遍。
    """
    notes = notes or {}
    entries: List[str] = []
    for qid, picks in answers.items():
        parts = [f"「{_question_text(questions, qid)}」= 「{'、'.join(picks)}」"]
        for label in picks:
            preview = _option_preview(questions, qid, label)
            if preview:
                parts.append(f"选中项的对照内容：\n{preview}")
        note = str(notes.get(qid) or "").strip()
        if note:
            parts.append(f"用户补充：{note}")
        entries.append(" ".join(parts))
    if not entries:
        return unanswered_text()
    return "用户回答了你的问题：" + "，".join(entries) + "。接下来按用户的回答继续。"


def format_chat_about_this(
    questions: Sequence[Dict[str, Any]], answers: Dict[str, List[str]]
) -> str:
    """用户想聊聊：部分答案 + 转对话（grok Path B）。

    grok 的语义是「partial answers, agent reformulates questions」——
    答了的算数，没答的**换个问法再问**，不是当没答过。
    """
    answered = [
        f"「{_question_text(questions, qid)}」= 「{'、'.join(picks)}」"
        for qid, picks in answers.items()
    ]
    head = (
        "用户想先聊聊，没有全部选完。" if answered else "用户想先聊聊，一道都没选。"
    )
    if answered:
        head += "已经选了的：" + "，".join(answered) + "。"
    return head + "剩下的换个问法再问，别把已经答过的重新问一遍。"


def format_skip_interview(
    questions: Sequence[Dict[str, Any]], answers: Dict[str, List[str]]
) -> str:
    """用户不想再被问了，直接开干（grok Path C）。

    ⚠ 跟 cancelled 不是一回事：cancelled 是「这些问题我不答」，
      skip 是「别再问了，就按你想的做」。回喂措辞必须能让模型区分——
      混成一句，模型下一轮还会再问一遍。
    """
    answered = [
        f"「{_question_text(questions, qid)}」= 「{'、'.join(picks)}」"
        for qid, picks in answers.items()
    ]
    head = "用户让你别再问了，按现在知道的直接开始。"
    if answered:
        head += "已经选了的：" + "，".join(answered) + "。"
    return head + "不要再调问答工具。"


def summarize_questions(questions: Sequence[Dict[str, Any]]) -> str:
    """一句话摘要，落进 transcript 用。人看得懂就行。"""
    if not questions:
        return "（没有问题）"
    return " / ".join(str(q.get("question") or "").strip() for q in questions)


__all__ = [
    "MAX_QUESTIONS",
    "MAX_OPTIONS",
    "MAX_LABEL_CHARS",
    "MAX_DESCRIPTION_CHARS",
    "OTHER_LABEL",
    "RECOMMENDED_SUFFIX",
    "CANCEL_TEXT",
    "NO_OPERATOR_TEXT",
    "unanswered_text",
    "coerce_questions",
    "normalize_answers",
    "format_accepted",
    "format_chat_about_this",
    "format_skip_interview",
    "summarize_questions",
]
