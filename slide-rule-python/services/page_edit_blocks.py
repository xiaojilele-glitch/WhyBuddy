# -*- coding: utf-8 -*-
"""在已经画好的页面上**改一小块**，而不是整页重画（2026-08-17）。

## 病灶

用户的迭代要求绝大多数是**局部的**：

    「菜单栏那个图标换一个」
    「客户看板下面那个模块加点数据」
    「这一步的流程不合理，调一下顺序」

而系统的做法是把那一页从零重画。为了换一个图标重画整页，两个后果：

1. **慢**：整页出图是这条链上最贵的单步。
2. **容易把别处改坏**：重画等于让模型重新发明这一页的**每一个**元素——
   用户没提的部分照样会变。这就是「改一句话整个应用被换掉」在页面这一层
   的形态，而按需重画只把它从"所有页"缩到"一页"，没有解决"一页之内"。

## 做法取自 Aider 的 SEARCH/REPLACE edit block

`aider/coders/editblock_prompts.py` + `editblock_coder.py`。核心是**不让模型
重写整份文件，只让它交出"把这段换成那段"**：

    <<<<<<< SEARCH
    （原文里一段一字不差的内容）
    =======
    （替换成什么）
    >>>>>>> REPLACE

Aider 对这套的硬规则，逐条抄过来（原文见 `system_reminder`）：

  · SEARCH 段必须**逐字符匹配**原文（"EXACTLY MATCH ... character for character"）
  · 只替换**第一处**匹配（"only replace the first match occurrence"）
  · 块要小（"Include just the changing lines, and a few surrounding lines
    if needed for uniqueness"）——大块既难匹配又把不该动的内容卷进来

## ⚠ 最该抄的一条：**不做模糊匹配**

`replace_most_similar_chunk` 里降级是有顺序的：

    1. 完全一致
    2. 只差缩进（whitespace-tolerant）
    3. 处理模型用 `...` 省略中间部分的写法
    4. ── 编辑距离模糊匹配 ── **被一个裸 `return` 短路掉了，代码留着不执行**

Aider 是**故意**关掉第 4 层的。理由不难想：模糊匹配一旦对错地方，改动会
落在一个看起来相似但语义不同的位置上，而这种错**在日志和判据里都长得跟
成功一模一样**。宁可如实失败、把真实原文回喂给模型重问。

本仓对未标定的启发式一贯保守，这里照办：**匹配不上就是失败，不猜**。

## fail 的方向：回落整页重画

匹配失败 / 改完过不了页面校验 → **回落到整页重画**（也就是今天的行为）。
不能 fail 成"这一页不改了"——那会让用户说了话而页面一动不动。同
refine_page_scope 那条纪律。
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

#: 三行围栏标记，逐字对齐 Aider。别自创符号——这套写法在模型的训练数据里
#: 出现过无数次，换一个自造的分隔符等于放弃这份先验。
_SEARCH = "<<<<<<< SEARCH"
_DIVIDER = "======="
_REPLACE = ">>>>>>> REPLACE"

_SYSTEM = (
    "你在修改一份已经写好的 HTML 页面。只输出 SEARCH/REPLACE 块，"
    "不要解释、不要输出整页 HTML。"
)


def build_edit_prompt(page_id: str, html: str, instruction: str) -> List[Dict[str, str]]:
    """装配"改一小块"的对话。

    ⚠ 整页原文**必须**喂进去：SEARCH 段要求逐字符匹配，模型手里没有原文就
      只能凭记忆编，编出来的必然匹配不上。这跟 Aider 要求"文件必须先 add 到
      chat 才能改"是同一件事。
    """
    body = f"""下面是页面 `{page_id}` 现在的完整 HTML：

```html
{html}
```

用户提出的修改要求：

{instruction.strip()[:2000]}

请**只改需要改的那几处**，用 SEARCH/REPLACE 块表达。格式严格如下：

{_SEARCH}
（原文里一段一字不差的内容）
{_DIVIDER}
（替换成什么）
{_REPLACE}

硬性要求：

1. **SEARCH 段必须与原文逐字符一致**，包括空格、缩进、标点、中文全半角。
   一个字符对不上这一块就会被丢弃。从上面的原文里**复制**，不要凭记忆写。
2. 每块只替换**第一处**匹配。所以 SEARCH 段要**足够独特**——如果一段内容
   在页面里出现多次，多带几行上下文把它框住。
3. **块要小**。只包含要改的那几行，加上为了唯一定位必需的少量上下文。
   不要把大段不变的内容抄进来。
4. 要改多处就写**多个块**，一个块只干一件事。
5. **不要输出整页 HTML**，不要输出解释文字，只要这些块。
6. 改动要落在用户提的那件事上；**用户没提的地方一个字都不要动**。
"""
    return [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": body},
    ]


def parse_edit_blocks(text: str) -> List[Tuple[str, str]]:
    """从模型回复里抠出 [(search, replace), ...]。抠不出来返回空表。

    ⚠ 容忍围栏：模型常把块包在 ```html 里，Aider 也是这么处理的。但**不容忍
      标记本身写错**——`<<<<<<<` 少一个 `<` 就当没有这个块，别去猜。
    """
    # ⚠ 这句里的 `_SEARCH not in text` 跟下面正则里的 `re.escape(_SEARCH)`
    #   **是两道各自都够用的防线**（2026-08-17 变异实测发现的）：单拆任何一道，
    #   另一道都还拦得住写错的标记，所以单点变异杀不掉这条判据——两道同时拆
    #   才会红。留着两道无害，删掉其中一道也不会坏；写在这里是免得下一个人
    #   看到"变异咬不住"就以为判据没用。
    if not isinstance(text, str) or _SEARCH not in text:
        return []
    out: List[Tuple[str, str]] = []
    pattern = re.compile(
        re.escape(_SEARCH) + r"\n(.*?)\n?" + re.escape(_DIVIDER) + r"\n(.*?)\n?" + re.escape(_REPLACE),
        re.S,
    )
    for m in pattern.finditer(text):
        search, replace = m.group(1), m.group(2)
        if search.strip():
            out.append((search, replace))
    return out


def _strip_trailing_ws(lines: List[str]) -> List[str]:
    return [ln.rstrip() for ln in lines]


def apply_one(whole: str, search: str, replace: str) -> Optional[str]:
    """把 whole 里第一处 search 换成 replace。匹配不上返回 None。

    降级顺序照 Aider 的 `replace_most_similar_chunk`：

        1. 完全一致
        2. 只差行尾空白 / 缩进
        3. 模型多加了一个开头空行（Aider issue #25 记的实测形态）

    ⚠ **到此为止，不做模糊匹配。** Aider 自己把编辑距离那一层用裸 `return`
      短路掉了——模糊匹配对错地方时，改动会落在一个"看起来像"的位置上，
      而这种错在日志和判据里跟成功长得一模一样。宁可如实失败。
    """
    if not search:
        return None

    # 1. 完全一致
    if search in whole:
        return whole.replace(search, replace, 1)

    whole_lines = whole.splitlines()
    search_lines = search.splitlines()
    replace_lines = replace.splitlines()
    if not search_lines:
        return None

    # 2. 只差行尾空白：逐行 rstrip 后按行窗口找
    w_stripped = _strip_trailing_ws(whole_lines)
    s_stripped = _strip_trailing_ws(search_lines)
    n = len(s_stripped)
    for i in range(len(w_stripped) - n + 1):
        if w_stripped[i:i + n] == s_stripped:
            merged = whole_lines[:i] + replace_lines + whole_lines[i + n:]
            return "\n".join(merged)

    # 3. 模型多加了一个开头空行（Aider issue #25）
    if len(s_stripped) > 1 and not s_stripped[0].strip():
        return apply_one(whole, "\n".join(search_lines[1:]), replace)

    return None


def apply_edit_blocks(html: str, blocks: List[Tuple[str, str]]) -> Dict[str, Any]:
    """按顺序套用所有块。返回 {"html", "applied", "failed"}。

    ⚠ **一块都没套上就算整体失败**（`applied == 0`）：那说明模型给的 SEARCH
      段跟原文根本对不上，产出等同于没改——调用方该回落整页重画，而不是
      把原样 HTML 当成"改好了"交出去。「东西看着在，其实没动」是本仓数得
      最多的形状之一。

    ⚠ 部分成功**照样返回**：三块套上两块，那两处改动是真的。剩下的记进
      failed 由调用方决定要不要重问。这跟 Aider 一致（它把失败的块连同
      "Did you mean these lines?" 回喂给模型）。
    """
    cur = html
    applied: List[Tuple[str, str]] = []
    failed: List[Tuple[str, str]] = []
    for search, replace in blocks:
        got = apply_one(cur, search, replace)
        if got is None:
            failed.append((search, replace))
        else:
            cur = got
            applied.append((search, replace))
    return {"html": cur, "applied": applied, "failed": failed}


def find_similar_lines(search: str, html: str, top: int = 3) -> List[str]:
    """原文里跟 SEARCH 首行最像的几行，**只用来写报错提示**。

    ⚠ 这里用相似度，跟"不做模糊匹配"**不矛盾**，因为两者用途完全不同：

        apply_one    决定**改哪里** → 只认逐字符/空白等价，绝不用相似度。
                     猜错的代价是"改到别处去了，而且看起来像成功"。
        本函数        决定**报错时提示什么** → 用相似度正合适。
                     猜错的代价只是提示不够准，模型下一轮照样能自己找。

    ⚠ 必须用相似度而不是子串包含：最需要这个提示的场景恰恰是**差一两个
      字符**（`class="cart"` vs `class="card"`），子串包含在那种时候必然
      一条都找不到——2026-08-17 写判据时当场撞到。
    """
    from difflib import SequenceMatcher

    first = (search.splitlines() or [""])[0].strip()
    if not first:
        return []
    scored = [
        (SequenceMatcher(None, first, ln.strip()).ratio(), ln)
        for ln in html.splitlines()
        if ln.strip()
    ]
    scored.sort(key=lambda x: x[0], reverse=True)
    return [ln for score, ln in scored[:top] if score >= 0.6]


def describe_failures(html: str, failed: List[Tuple[str, str]], limit: int = 3) -> str:
    """把没套上的块整理成回喂给模型的话，带上原文里最像的几行。

    照 Aider 的 `SearchReplaceNoExactMatch` + `find_similar_lines`：**光说
    "没匹配上"没用**，模型不知道自己差在哪；把原文里最接近的几行贴回去，
    它才改得动。
    """
    if not failed:
        return ""
    parts = ["以下 SEARCH 块没能在原文里找到逐字符一致的内容，**没有被应用**："]
    for search, _ in failed[:limit]:
        parts.append(f"\n{_SEARCH}\n{search}\n{_DIVIDER}\n…\n{_REPLACE}")
        near = find_similar_lines(search, html)
        if near:
            parts.append("原文里最接近的几行是（请从这里逐字符复制）：\n" + "\n".join(near))
    parts.append("\n请只重发这些没成功的块，SEARCH 段必须从上面给你的原文里复制。")
    return "\n".join(parts)
