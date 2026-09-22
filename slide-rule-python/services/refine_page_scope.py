# -*- coding: utf-8 -*-
"""精修只重画**指令点到的页面**，其余原样照搬（2026-08-17）。

## 病灶

用户说一句「护理员端小程序那一页的列表是空的，加点模拟数据」，第 3 步把
**全部 5 页重画一遍**。

真正的收益是**别把没让改的页面改坏**：每张重画的页都可能漂或失败——真机
撞到过 p1 因为引了 `images.unsplash.com` 没过校验被整页丢掉，而 p1 **根本
不是用户要改的那页**。「改一句话把整个应用换掉」这件事，页面这一层就是这么
来的。没点到的页不进 LLM，就没有这个窗口。

## ⚠ 省墙钟这个预期是**错的**，别拿它当卖点（2026-08-17 实测）

分开埋点后量到：

    第一轮 画 3 页                 specfirst.pages   27.1s
    第二轮 照搬 2 页、只画 1 页     specfirst.pagescope 3.6s + pages 30.1s

**画 1 页比画 3 页还慢一点。** 页面是并发画的（max_workers=6），墙钟 ≈
最慢那一页，跟页数几乎无关；判作用域还要自己花 3~4 秒。所以在"页数 ≤ 并发数"
这个区间里，按需重画**换不来墙钟**。

省的是别的两样，都是实的：

    · **token / 调用次数**：3 页变 1 页，页面生成的 LLM 调用直接少 2/3
    · **踩雷面**：少画 N 页 = 少 N 次"这页可能画坏/超时/引外链被拦"的机会。
      页面耗时的方差极大（真机量到过 27s ~ 172s，长尾都是落后者拖的），
      少画几页降的是**方差**，不是中位数。

⚠ 这条区分是拿真机数据换来的，别再退回"按需重画所以更快"那句话——
  那正是本仓说的"拿造出来的数替代看一眼"。页数超过并发数时墙钟才会真降，
  而那要另外量。

## 做法取自 Aider 的 ContextCoder

Aider 解决的是同一个问题：让 LLM 改代码时**不要重写整个仓库**。它的关键不是
"求模型自觉"，是三条结构性设计（`aider/coders/context_coder.py` +
`context_prompts.py`）：

    1. **专门一步只判作用域**，不产内容。提示词里写死 `NEVER RETURN CODE!`
       ——判作用域和写内容混在一个提示词里，两件事互相稀释。本仓吃过同款亏：
       「精修提示词的收尾要求"产出一份"，把上面的增量约束整个盖掉」(0f5686e5)。
    2. **区分「要改的」和「只需读懂的」**。原话：
       "Only return files that will need to be modified, not files that contain
       useful/relevant functions."
    3. **不在作用域里的东西结构上碰不到**——Aider 里没 add 到 chat 的文件，
       模型根本改不了。不是约束，是能力边界。

第 3 条是真正起作用的那条，也是本仓四次修复都没做到的：前四次全在
**求模型自觉**（"没被波及的保持稳定"），实测逐段指纹 0/6。

ContextCoder 还有个 `try_again` 不动点：模型报出的集合与当前集合不一致就
替换再问，直到收敛。这里**暂不实现**——那是为"模型需要先看到文件内容才能
判断"设计的，而这里判断依据（页面名 + 用途）在第一次就全给了，没有新信息
可以让它改主意。等真机出现"该改的页没被点到"再加，别提前造机制。

## 语义：三种取值不许混

    None   判不出来（LLM 挂了/答非所问）→ **全量重画**，即这个功能出现前的行为
    []     模型说一页都不用改          → 也全量重画（对精修指令来说这多半是判错，
                                        而"什么都不改"会让用户的要求静默失效）
    [...]  点到的重画，其余照搬

⚠ 别把 `[]` 当成"全部照搬"。那会让一次判错变成"用户说了话但应用一动不动"，
  比多画几页糟得多——这是纪律七的分类：**判作用域属增强，失败要 fail-open
  回全量**，不能 fail 成"什么都不做"。
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

_SYSTEM = (
    "你在判断一条修改要求会影响一个应用里的哪几个页面。"
    "只输出一个 JSON 对象，不要解释、不要 markdown 围栏。"
)

#: 判作用域这一步**绝不产内容**。逐字对应 Aider ContextPrompts 的
#: `system_reminder = "NEVER RETURN CODE!"`——它把"判范围"和"写东西"
#: 彻底切开，两件事混在一个提示词里会互相稀释。
_NEVER_GENERATE = "**不要输出任何 HTML 或页面内容**，这一步只判范围。"


def build_scope_prompt(instruction: str, pages: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    """装配作用域判定对话。pages 是 `[{"id","name","purpose"}]`。"""
    listing = "\n".join(
        f"- {p.get('id')}：{p.get('name')}"
        + (f"（{p.get('purpose')}）" if p.get("purpose") else "")
        for p in pages
    )
    body = f"""这个应用现在有这些页面：

{listing}

用户提出的修改要求是：

{instruction.strip()[:2000]}

请判断**哪几个页面需要被修改**才能满足这条要求。

{_NEVER_GENERATE}

输出这个形状：

{{"pages": ["<页面id>", "..."], "why": "<一句话说清为什么是这几页>"}}

硬性要求：

1. **只列真正需要改的页面**，不要列"跟这件事有关但不用改"的页面。
   判断标准是「不改这一页，用户的要求就没被满足吗」。
2. 页面 id **必须从上面的清单里挑**，不许新造、不许改写。
3. 宁可少列也不要多列：**没列进来的页面会原样保留上一版**，
   列进来的会被整页重画（重画有漂移风险）。
4. 要求明确指名了某一页（"XX 那一页…"），那就**只列那一页**，
   除非另有页面确实必须跟着改。
"""
    return [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": body},
    ]


def _known_ids(pages: List[Dict[str, Any]]) -> List[str]:
    return [str(p.get("id")) for p in pages if isinstance(p, dict) and p.get("id")]


def parse_scope(payload: Any, pages: List[Dict[str, Any]]) -> Optional[List[str]]:
    """把 LLM 的回答收成一份**只含已知页面 id** 的清单。判不出来回 None。

    ⚠ 未知 id 直接丢掉，不做模糊匹配：模糊匹配一旦对错人，会把"改 A 页"
      变成"重画 B 页"，而这类错在日志里长得跟正常一模一样。
    """
    if not isinstance(payload, dict):
        return None
    raw = payload.get("pages")
    if not isinstance(raw, list):
        return None
    known = set(_known_ids(pages))
    got = [str(x).strip() for x in raw if str(x).strip()]
    picked = [x for x in got if x in known]
    dropped = [x for x in got if x not in known]
    if dropped:
        print(f"[refine_page_scope] ⚠ 模型报了清单外的页面 id，已丢弃：{dropped}")
    return picked


def decide_pages_to_regenerate(
    instruction: str,
    pages: List[Dict[str, Any]],
    *,
    llm_json_fn=None,
) -> Optional[List[str]]:
    """判定这条指令要重画哪几页。返回 None = 判不出来，调用方应全量重画。

    ⚠ **fail-open 到全量重画**，不是 fail 到"什么都不改"。判作用域是增强类
      （纪律七）：它挂了最多是慢一点、回到今天的行为；而 fail 成"一页都不改"
      会让用户的要求静默失效，那比慢严重得多。
    """
    if not (instruction or "").strip() or not pages:
        return None
    try:
        from .spec_llm_call import call_spec_json

        outcome = call_spec_json(
            build_scope_prompt(instruction, pages), llm_json_fn, stage="specfirst.pagescope"
        )
        picked = parse_scope(outcome.payload, pages)
    except Exception as exc:  # noqa: BLE001 — 增强类，不许打死主链路
        print(f"[refine_page_scope] ⚠ 判作用域失败，退回全量重画：{str(exc)[:200]}")
        return None

    if picked is None:
        print("[refine_page_scope] ⚠ 判作用域没给出可用清单，退回全量重画")
        return None
    if not picked:
        # 空清单对一条精修指令来说多半是判错。回全量重画（今天的行为），
        # 而不是"全部照搬"——后者会让用户说了话而应用一动不动。
        print("[refine_page_scope] ⚠ 判作用域说一页都不用改，按判错处理，退回全量重画")
        return None
    return picked


def split_pages_for_refine(
    spec_pages: List[Dict[str, Any]],
    prev_pages: Optional[Dict[str, str]],
    scope: Optional[List[str]],
) -> Dict[str, str]:
    """算出**可以原样照搬**的那批页面：`{pageId: html}`。

    照搬的条件是三个都满足，缺一不可：

        · 不在本轮作用域里          —— 指令没点到它
        · 上一版有它的 HTML          —— 照搬得有东西可搬
        · 本轮 SPEC 仍然声明了它      —— SPEC 把它删了就不该再出现

    第三条容易漏：只按前两条搬，会把上一轮已经被 SPEC 拿掉的页面又搬回来，
    表现是「用户让删的页面删不掉」，而且没有任何一处会报错。
    """
    if scope is None or not isinstance(prev_pages, dict) or not prev_pages:
        return {}
    declared = {str(p.get("id")) for p in spec_pages if isinstance(p, dict) and p.get("id")}
    in_scope = set(scope)
    return {
        pid: html
        for pid, html in prev_pages.items()
        if pid not in in_scope and pid in declared and isinstance(html, str) and html.strip()
    }
