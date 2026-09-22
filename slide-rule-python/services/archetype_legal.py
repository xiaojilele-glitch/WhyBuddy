# -*- coding: utf-8 -*-
"""产品原型账本——「什么算闭环」的单一真相源加载器（2026-08-30）。

## 为什么有这个文件

2026-08-29 夜真机跑通一条完整推演之后量出来的瓶颈：

    REQUIRED_EVIDENCE_KEYS = ["datamodel","rbac","workflow","page","aigc","appbundle"]
    RUNTIME_CLOSURE_EDGES  = datamodel→rbac, datamodel→page, rbac→workflow,
                             workflow→page, page→appbundle, aigc→appbundle

这两个常量写死在 `v5_capability_executor` 里，而**六样缺一样就不算闭环**。
后果不是"生成得不好看"，是**结构性封顶**：

    小游戏      没有实体表、没有角色权限、没有审批流   → 永远 0/6，不可能 gate_passed
    手表表盘    没有页面导航壳、没有工作流             → 同上

**不是不允许它生成，是不允许它闭环。** 而闭环是这个产品的全部意义
（北极星：AI 说做完了不算数，过了闸的产物才算数）。

`v5_capability_executor` 的模块头自己写着「the metamodel is domain-agnostic」
——那句话是对的但不完整：**它对领域无关（采购/工单/翻译都能套），对产品原型
不是无关的**（游戏套不上）。六系统是「有数据表、有角色、有流程、有页面」那类
东西的正确定义，错的是把一个原型的定义写成了全局常量。

## 抄的是本仓自己的账本模式

`schema_legal.py` 把「什么写法合法」从四处手抄收成一本账（E40.1）。这里同一套路：
把「什么算闭环」从跨两门语言的 10 处手抄收成一本账。

    Python 侧 5 处   v5_capability_executor(REQUIRED_EVIDENCE_KEYS / RUNTIME_CLOSURE_EDGES)
                     v5_full_driver(_SKILL_EMIT_ORDER)
                     turn_narration(_SKILL_EMIT_ORDER)   ← 第二份 _SKILL_EMIT_ORDER
                     v5_llm_generate(_REQUIRED_SECTIONS)
    TS 侧 5+ 处      client/src/lib/skills/page/pageSkill.ts
                     client/src/lib/skills/appbundle/appBundleSkill.ts

**对外名字一律不变**（`REQUIRED_EVIDENCE_KEYS` 等仍在原处、仍是 list），
老引用零改动——跟 `schema_legal` 当初一样。变的只是它们的**来源**。

## ⚠ wired=false 的原型不许被选中

`casual_game` / `glance_app` 今天是 **契约声明，生成侧未接**。选中它们会
fail-closed 并说清原因，**不许静静退回默认原型**——那就是本仓踩了三次的
「装在不通电的插座上」：契约有了、测试有了、看着像能用，实际什么也没接。

判据 `test_未接通的原型选中即失败` 钉着这一条。

## 用法

    from .archetype_legal import required_evidence, closure_edges
    required_evidence()                  # 默认原型的六样
    required_evidence("casual_game")     # 抛 ArchetypeNotWired

加设备只改账本 + 版式。`device_policy` / `page_reconstruction` /
`intake_judge` 不许再手抄 Literal["desktop", "phone"]。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Tuple

_PATH = Path(__file__).resolve().parent / "data" / "product_archetypes.json"

with _PATH.open(encoding="utf-8") as _f:
    _LEDGER: Dict[str, Any] = json.load(_f)

ARCHETYPE_LEDGER_VERSION: int = int(_LEDGER.get("version", 0))

#: 默认原型 = 没有显式声明时用哪一个。今天的产品链路全部走它。
DEFAULT_ARCHETYPE: str = str(_LEDGER.get("defaultArchetype") or "")

_ARCHETYPES: Dict[str, Dict[str, Any]] = {
    k: v for k, v in (_LEDGER.get("archetypes") or {}).items() if not k.startswith("$")
}

if not DEFAULT_ARCHETYPE or DEFAULT_ARCHETYPE not in _ARCHETYPES:
    raise ValueError(
        f"product_archetypes.json 的 defaultArchetype 无效：{DEFAULT_ARCHETYPE!r}"
    )


class ArchetypeNotWired(ValueError):
    """选了一个契约已声明、但生成侧还产不出这些段的原型。

    ⚠ 这条**故意是异常而不是回落默认**。回落会让「游戏跑出了一个后台系统」
      看起来像成功——那正是这仓最贵的一类事故（第一条：装在不通电的插座上，
      三次都靠真机日志才发现）。宁可当场失败，也不端出一个假的绿灯。
    """


class UnknownArchetype(ValueError):
    """账本里没有这个原型。拼错的原型名不许静静退回默认。"""


def archetype_names() -> Tuple[str, ...]:
    """账本里声明过的全部原型，含未接通的。"""
    return tuple(sorted(_ARCHETYPES))


CONTENT_ARCHETYPE = "content_app"
FREE_ARCHETYPE = "free_app"


def wired_archetypes() -> Tuple[str, ...]:
    """生成侧真的能产出的原型。"""
    return tuple(sorted(k for k, v in _ARCHETYPES.items() if v.get("wired") is True))


def is_content_app(name: str | None) -> bool:
    """消费 / 内容壳：无 aside、图是一等公民。未声明时不是。"""
    return str(name or "").strip() == CONTENT_ARCHETYPE


def is_free_app(name: str | None) -> bool:
    """自由类型：不套后台中台，也不套杂志四页。未声明时不是。"""
    return str(name or "").strip() == FREE_ARCHETYPE


def is_open_chrome(name: str | None) -> bool:
    """顶栏横栏、不要 aside。content_app 和 free_app 共用这条壳。

    SPEC / 密度 / 绑洞仍分叉：杂志四页只走 is_content_app，自由类型走
    is_free_app。壳统一问这一处，免得 page_shell 再手抄两个名字。
    """
    raw = str(name or "").strip()
    return raw in (CONTENT_ARCHETYPE, FREE_ARCHETYPE)


def is_wired(name: str) -> bool:
    return bool(_spec_raw(name).get("wired") is True)


def label(name: str | None = None) -> str:
    return str(_spec_raw(name or DEFAULT_ARCHETYPE).get("label") or "")


def _spec_raw(name: str) -> Dict[str, Any]:
    """不检查 wired——给 `is_wired` / `label` 这类元数据查询用。"""
    spec = _ARCHETYPES.get(name)
    if spec is None:
        raise UnknownArchetype(
            f"未知的产品原型 {name!r}；账本里有：{', '.join(archetype_names())}"
        )
    return spec


def _spec(name: str | None) -> Dict[str, Any]:
    """取原型定义，未接通的当场失败。"""
    key = name or DEFAULT_ARCHETYPE
    spec = _spec_raw(key)
    if spec.get("wired") is not True:
        raise ArchetypeNotWired(
            f"产品原型 {key!r}（{spec.get('label')}）契约已声明，但生成侧还产不出它的段："
            f"{', '.join(spec.get('requiredEvidence') or [])}。"
            f"今天能用的：{', '.join(wired_archetypes())}。"
        )
    return spec


def required_evidence(name: str | None = None) -> List[str]:
    """这个原型闭环要哪几样证据。**返回新 list**——调用方切片、追加都不该污染账本。"""
    return list(_spec(name).get("requiredEvidence") or [])


def closure_edges(name: str | None = None) -> List[Dict[str, Any]]:
    """技能之间的闭环边。深拷贝，理由同上。"""
    return [dict(e) for e in (_spec(name).get("closureEdges") or [])]


def resolve(state: Any = None, payload: Dict[str, Any] | None = None) -> str:
    """这一轮该按哪个原型闭环。

    选择通道是范围卡（`control_scope_card` → 确认 POST 的 `productArchetype`
    → `goal.productArchetype`）。没人选时回默认原型。

    ⚠ 选中未接通的原型**当场失败**（`ArchetypeNotWired`），不许静静退回
      `business_app`——那就是「要个游戏、拿到一个后台系统」。拼错同理
      （`UnknownArchetype`）。这是控制面点火前的 fail-closed 闸，不是生成器
      里换一套五系统段——五系统内核这轮不动。
    """
    for src in (payload or {}, getattr(state, "goal", None) or {}):
        if isinstance(src, dict):
            raw = str(src.get("productArchetype") or src.get("product_archetype") or "").strip()
            if raw:
                # 拼错 / 未接通都不许静静退回默认（同 §14.6）
                _spec(raw)
                return raw
    return DEFAULT_ARCHETYPE


# ── 设备形态 ────────────────────────────────────────────────────────────────
#
# 与产品原型同账本、不同小节：两者都是「这个产品能做出什么形状」，
# 但**互相正交**——同一个 archetype 可以有手机档和桌面档。
#
# 手抄现场（2026-08-30 数）：
#     v5_model_gate:1205   supported_devices = ("desktop", "phone")     闸的合法域
#     intake_judge:425     _VALID_DEVICES = {"desktop","phone","unspecified"}  判定输出域
#     intake_judge:233     _DEVICE_RUBRIC                                提示词里的姿态描述
# 三处形态各异（元组 / 集合＋哨兵 / 散文），所以"搜同一串字面量"根本对不上，
# 加一个 watch 必然漏。现在同源。

_DEVICES: Dict[str, Any] = _LEDGER.get("deviceForms") or {}
_FORMS: Dict[str, Dict[str, Any]] = {
    k: v for k, v in (_DEVICES.get("forms") or {}).items() if not k.startswith("$")
}

#: 判定专用哨兵：「没有姿态信号」。**不是设备**——闸不接受它，只有判定输出用。
JUDGE_UNSPECIFIED: str = str(_DEVICES.get("judgeSentinel") or "unspecified")


def device_order() -> Tuple[str, ...]:
    """提示词里的条目顺序。**只含接通的**，且顺序来自账本。

    ⚠ 改这个顺序 = 改提示词 = 可能改判定结果。判据 `test_rubric_逐字不变` 会红。
    """
    order = [str(x) for x in (_DEVICES.get("$order") or [])]
    wired = {k for k, v in _FORMS.items() if v.get("wired") is True}
    # 账本里 $order 没列到的接通设备也要出现，否则加了设备却不进提示词 = 白加
    return tuple([d for d in order if d in wired] + sorted(wired - set(order)))


def supported_devices() -> Tuple[str, ...]:
    """闸的合法域：接通的设备，**不含哨兵**。"""
    return tuple(sorted(k for k, v in _FORMS.items() if v.get("wired") is True))


def valid_judge_devices() -> set:
    """判定输出域 = 接通的设备 + 哨兵。"""
    return set(supported_devices()) | {JUDGE_UNSPECIFIED}


def device_rubric_bullets() -> str:
    """提示词里的设备条目，从账本生成。

    ⚠ 只生成**条目**。rubric 里那五行「容易判错的例子」是标定过的，
      手写留在 `intake_judge`——生成它等于把标定丢给了模板。
    """
    lines = [
        f"  · {name} —— {_FORMS[name].get('posture', '')}"
        for name in device_order()
    ]
    lines.append(f"  · {JUDGE_UNSPECIFIED} —— {_DEVICES.get('sentinelPosture', '')}")
    return "\n".join(lines)


def default_device() -> str:
    """判不出姿态时的兜底档。**必须是接通的**，判据钉着。"""
    return str(_DEVICES.get("defaultDevice") or "desktop")


def device_label(name: str) -> str:
    form = _FORMS.get(name) or {}
    return str(form.get("label") or name)


def device_domain_bar() -> str:
    """生成契约 / 闸报错用的合法域：`desktop|phone|tablet`。加设备只改账本。"""
    return "|".join(supported_devices())


def judge_device_domain_bar() -> str:
    """判定 JSON 槽位：接通的设备（提示词顺序）+ 哨兵。"""
    return "|".join(list(device_order()) + [JUDGE_UNSPECIFIED])


def device_domain_or() -> str:
    """英文报错：`desktop, phone or tablet`。"""
    names = list(supported_devices())
    if not names:
        return ""
    if len(names) == 1:
        return names[0]
    if len(names) == 2:
        return f"{names[0]} or {names[1]}"
    return ", ".join(names[:-1]) + f" or {names[-1]}"


def historic_preferred_devices() -> Tuple[str, ...]:
    """宽容闸：旧快照可能带的档。含已接通的 + 账本声明 historicAccepted 的。

    不含哨兵。watch 从未进过生成契约（historicAccepted=false），宽容闸也不认。
    """
    accepted = {
        k
        for k, v in _FORMS.items()
        if v.get("wired") is True or v.get("historicAccepted") is True
    }
    return tuple(sorted(accepted))


def layout_device(preferred: Any) -> str:
    """版式用档：接通的就用，否则兜底。

    ⚠ 2026-08-30 真机形状：`phone if … else desktop` 把 tablet 折叠成桌面，
      账本接通了平板、生图/总览仍走桌面提示词——装在不通电的插座上。
      版式侧只问这一处，不许再手写二分。
    """
    raw = str(preferred or "").strip()
    if raw in set(supported_devices()):
        return raw
    return default_device()


def device_viewport_css(device: Any) -> Tuple[int, int]:
    """生成 / 画布共用的 CSS 像素视口。只从账本 `viewportCss` 读。

    ⚠ 2026-08-30 夜：goal 已是 tablet，五页 HTML 仍按 1920×1080 + w-64 画。
      视口再手抄一份，改账本数字舞台对不上。缺字段才回落到历史三档。
    """
    name = layout_device(device)
    form = _FORMS.get(name) or {}
    raw = form.get("viewportCss") or {}
    try:
        width = int(raw["w"])
        height = int(raw["h"])
    except (KeyError, TypeError, ValueError):
        width = height = 0
    if width > 0 and height > 0:
        return width, height
    if name == "phone":
        return 390, 844
    if name == "tablet":
        return 1112, 834
    return 1920, 1080


def wired_device_choices() -> List[Dict[str, str]]:
    """范围卡设备档选项。只含接通的——未接通的不许出现在可选项里。"""
    return [{"id": name, "label": device_label(name)} for name in supported_devices()]


def wired_archetype_choices() -> List[Dict[str, str]]:
    """范围卡原型选项。只含接通的。"""
    return [{"id": name, "label": label(name)} for name in wired_archetypes()]


def policy_pack(name: str | None = None, device: str | None = None) -> Dict[str, Any]:
    """原型×设备的政策包。形状抄 SKILL.md frontmatter（name / description /
    whenToUse / allowedTools），不是 TRAE `skill_runtime`。

    读 `_spec_raw`：未接通的原型也可以亮出政策，但选中仍走
    `ArchetypeNotWired`。缺字段返回空清单，调用方（flow）再归一成默认五件套。
    """
    spec = _spec_raw(name or DEFAULT_ARCHETYPE)
    policy = dict(spec.get("policy") or {})
    overlay = dict((policy.get("devices") or {}).get(str(device or "").strip()) or {})
    tools = overlay.get("allowedTools") or policy.get("allowedTools") or []
    out: Dict[str, Any] = {
        "name": str(policy.get("name") or (name or DEFAULT_ARCHETYPE)),
        "description": str(policy.get("description") or ""),
        "whenToUse": str(policy.get("whenToUse") or ""),
        "allowedTools": [str(item).strip() for item in tools if str(item).strip()],
    }
    density = overlay.get("density") or policy.get("density")
    if density:
        out["density"] = str(density)
    return out


def allowed_tools(name: str | None = None, device: str | None = None) -> Tuple[str, ...]:
    """这个原型×设备默认跑哪几件公开工具。空清单不是「什么都不跑」。"""
    return tuple(policy_pack(name, device).get("allowedTools") or ())


def device_generation_bullets() -> str:
    """生成契约 Step 8b 的英文姿态条目，从账本 postureEn 生成。"""
    lines = []
    for name in supported_devices():
        form = _FORMS.get(name) or {}
        posture = str(form.get("postureEn") or form.get("posture") or "").strip()
        lines.append(f"  · '{name}' — {posture}")
    return "\n".join(lines)


def fill_device_placeholders(text: str) -> str:
    """叶子模块只留占位符，调用方（core/flow）在通电的插座上填账本。

    ⚠ 2026-08-30：`schema_legal` 是 util 叶子，闸钉着「不依赖 services 内
    任何模块」。叶子里 import 本模块 = 不再是叶子；叶子里手抄
    `desktop|phone` = 下一笔加档漏接。占位符是第三条路。
    """
    return (
        text.replace("__PREFERRED_DEVICES__", device_domain_bar())
        .replace("__PREFERRED_DEVICES_OR__", device_domain_or())
        .replace("__DEVICE_GENERATION_BULLETS__", device_generation_bullets())
    )
