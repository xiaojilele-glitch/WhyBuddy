# -*- coding: utf-8 -*-
"""点选编辑存库前的体检：这一笔改动**顺手带走**了什么。

## 修的是什么（2026-09-05 真机）

`PATCH /apps/{id}/pages/{pid}`（点选编辑保存）此前只查四件事：应用在不在、
html 空不空、超不超字节上限、这一页存不存在。**内容一个字都不看。**

而客户端存回来的那份，是把「消过毒的 body」拼回文档——消毒器的
`FORBID_TAGS` 里有 `script`（那是给**展示**用的：舞台不跑页面脚本，页面是
数据绑定驱动的木偶）。于是：

    真机 sr-20260904232526（汉字连线消除小游戏）
    三页各带 2~3 个内联 `<script>`，最多 880 字符，整局逻辑全在里面。
    用户去改一个标题 → 存完游戏变成一张死图。
    接口返回 `{"ok": true, "bytes": 12345}`。

客户端那一侧已经修了（`ClickEditStage.preservedScripts`）。但**闸要长在
服务端**：点选编辑不是唯一会 PATCH 这个接口的路（画布、脚本、以后的别的
客户端都会），而"一次无关的编辑把交付物里的东西悄悄带走"这件事，
不该靠每个客户端各自记得。

## 为什么是「只报不拦」（§7）

用户**确实可能**故意删掉一段——他就是来改东西的。拿这个去 403 会挡住正当
编辑。所以：如实记账、随响应透出，让人看得见；不替用户否决他自己的修改。

这跟闭环那类 fail-closed 不一样：闭环判的是"这份产出算不算数"，
这里判的是"你是不是知道自己顺手删了别的"。

## 量什么

三样都是**机器可数**的，不需要读懂业务：

    脚本      `<script>` 段数（游戏/交互逻辑的载体）
    数据孔    带 data-* 的标签数（`scan_bindings`，跟打孔那一步同一把尺子）
    表单控件  input/select/textarea 数（能录数据的地方）

只报**变少**，不报变多——加东西是编辑的常态。
"""

from __future__ import annotations

import re
from typing import Any, Dict, List

# 数数据孔只该有一把尺子（§4）：跟打孔那一步同一个 scan_bindings，
# 不为了「当叶子」另写一个。本模块因此落在 core 层，不在 util。
from .html_bindings import scan_bindings

_SCRIPT_RE = re.compile(r"<script\b[\s\S]*?</script>", re.I)
_CONTROL_RE = re.compile(r"<(?:input|select|textarea)\b", re.I)


def _counts(html: str) -> Dict[str, int]:
    text = str(html or "")
    try:
        holes = len(scan_bindings(text))
    except Exception:  # noqa: BLE001 — 体检自己炸了不许挡住保存
        holes = 0
    return {
        "scripts": len(_SCRIPT_RE.findall(text)),
        "dataHoles": holes,
        "controls": len(_CONTROL_RE.findall(text)),
    }


#: 人话名字，报给用户看的
_LABELS = {"scripts": "页面脚本", "dataHoles": "数据孔", "controls": "表单控件"}


def edit_losses(before_html: str, after_html: str) -> List[Dict[str, Any]]:
    """这一笔编辑让哪几样**变少**了。没有就返回空表。

    只看数量，不看内容：数量是能数的，"改得对不对"不是这道闸该管的事。
    """
    before, after = _counts(before_html), _counts(after_html)
    out: List[Dict[str, Any]] = []
    for key in ("scripts", "dataHoles", "controls"):
        lost = before[key] - after[key]
        if lost > 0:
            out.append({
                "kind": key,
                "label": _LABELS[key],
                "before": before[key],
                "after": after[key],
                "lost": lost,
            })
    return out


def losses_message(losses: List[Dict[str, Any]]) -> str:
    """给人看的一句话。空表 → 空串。"""
    if not losses:
        return ""
    parts = [f"{x['label']} {x['before']}→{x['after']}" for x in losses]
    return (
        "这次保存顺手带走了：" + "、".join(parts) +
        "。如果不是你想删的，撤销后重存；页面脚本被吃掉多半是编辑器的问题，不是你删的。"
    )
