# -*- coding: utf-8 -*-
"""本轮请求域上下文（技能 / 连接器）—— 叶子模块，**不依赖 services 里任何其它模块**。

## 为什么单独有这个文件（2026-08-29）

这两样东西原来长在 `v5_llm_generate` 里，而 `v5_llm_generate` 是**调 LLM 的生成层**。
于是任何一个想往自己 prompt 里拼这两块的人，都得反过来 import 生成层：

    services.spec_tree          -> services.v5_llm_generate   （拼连接器实体声明）
    services.identity_theme_gen -> services.v5_llm_generate   （取 experience 通道技能）

spec-first 那两个模块本身是**被** v5_llm_generate 这一侧调用的，方向就此成环
（`model_core ⇄ spec_first`）。两边都只能把 import 藏进函数体里绕开——仓里那
462 条「函数体内 import」就是这么攒出来的。

抄的是 grok 的共用叶子（`docs/欠缺模块清单-对照Claude与Grok-build.md` §17）：
**共用件切成叶子，依赖方向就被焊死**——大块能用叶子，叶子永远碰不到大块。

## 为什么只搬「存 + 读」，没搬「洗」

`set_active_connectors` 的清洗要查连接器注册表（`services.connectors`，属
evidence 组），`set_installed_skills` 的绑定形状要查 `schema_legal`。把清洗
一起搬过来，这个文件就不再是叶子了。

所以按 grok 的 `-types` / `-api` 拆法切一刀：
**契约与请求域存储在叶子（这里），带注册表的清洗留在上层**
（`v5_llm_generate.set_active_connectors` / `set_installed_skills`，
洗完调这里的 `*_cleaned`）。读侧（拼 prompt）全在叶子，谁都能直接用。

## ⚠ 这个文件最容易坏在哪：ContextVar 必须只有一份

搬 ContextVar 的失败方式是**静默的**：只要哪天有人在 `v5_llm_generate` 里
"顺手"补一个同名 ContextVar，setter 写的是 A、getter 读的是 B，
`installed_skills_for_channel()` 永远返回空——不报错、不告警，表现只是
「技能注入不生效」「连接器实体没进 prompt，页面每格填『—』」。

所以判据不是「函数在不在」，是 **「从上层 set、从叶子 get，读得到同一份」**
（tests/test_turn_context_leaf.py::Test两个入口读写的是同一个ContextVar）。

⚠ 别把技能和连接器合并：技能给的是"这一页该怎么设计"（影响生成），
连接器给的是"这张表的数据从哪来、有哪些字段"（影响运行时填什么）。
"""

from __future__ import annotations

from contextvars import ContextVar
from typing import Any, Dict, List, Optional

# 已安装技能（技能库六期"推演注入"）：/drive-full(-stream) 在请求进入时设置、
# 结束后清空。请求域隔离——2026-07-27 并发修复：此前是模块级普通全局，
# E25 后台 run 用 asyncio.create_task 并发驱动多会话时会跨会话串。
_installed_skills_var: ContextVar[Optional[List[Dict[str, str]]]] = ContextVar(
    "sliderule_installed_skills", default=None
)

# 本轮挂着的连接器（2026-08-25）。同一请求域模式。
_connectors_var: ContextVar[Optional[List[Dict[str, Any]]]] = ContextVar(
    "sliderule_active_connectors", default=None
)

# 消费通道（2026-07-27）。此前所有已安装技能走同一条硬要求："必须落成一条
# aigc.capabilities，字段绑定到真实实体"。对设计指导类技能这是必然的门禁
# 失败——它们产出的是"这一页该长什么样"，不是某个实体字段的值。128 条技能
# 逐条判定的结果见 docs/skills-triage.jsonl。
SKILL_CHANNELS = ("aigc", "experience", "unbound")
DEFAULT_SKILL_CHANNEL = "unbound"

#: 一轮最多挂几个连接器。跟技能的 6 条同源：prompt 里塞太多，模型会开始
#: 挑着做，而"挑着做"在这里等于悄悄少一张表。
MAX_CONNECTORS = 4

#: 一轮最多注入几条技能。
MAX_INSTALLED_SKILLS = 6


# ---------------------------------------------------------------- 写（洗完再进来）

def set_installed_skills_cleaned(skills: Optional[List[Dict[str, str]]]) -> None:
    """存本轮已安装技能。**入参必须是洗过的**——洗在上层（见模块头）。"""
    _installed_skills_var.set(list(skills or []))


def set_active_connectors_cleaned(connectors: Optional[List[Dict[str, Any]]]) -> None:
    """存本轮挂着的连接器。**入参必须是洗过的**——洗在上层（见模块头）。"""
    _connectors_var.set(list(connectors or []))


# ---------------------------------------------------------------- 读

def installed_skills_for_channel(channel: str) -> List[Dict[str, str]]:
    """按通道取本轮已安装技能。experience 走风格段（design_language），不当种子色。"""
    return [s for s in (_installed_skills_var.get() or []) if s.get("channel") == channel]


def active_connectors() -> List[Dict[str, Any]]:
    return list(_connectors_var.get() or [])


def connector_prompt_block() -> str:
    """挂着的连接器 → 一段"这些实体必须原样收录"的硬要求。

    ⚠ 字段 id 必须**逐字**给出来并要求一字不差。给个"大概有日期和温度"的
      描述，模型会自己起 `temperature` / `maxTemp` 这种名字，取回来的真数据
      （`temp_max`）就对不上孔——页面每格填「—」，而且不报错。
    """
    conns = active_connectors()
    if not conns:
        return ""
    lines = [
        "Live data connectors attached to THIS run. Each one supplies REAL data at "
        "runtime. You MUST include each entity below in datamodel.entities EXACTLY "
        "as declared — same entity id, same field ids, same types. Do NOT rename, "
        "merge, translate or drop any field id: the runtime fills these tables by "
        "field id, and a renamed id silently yields an empty column. You may add "
        "extra fields and extra entities of your own, and you SHOULD build pages "
        "that display these entities."
    ]
    for conn in conns:
        entity = conn["entity"]
        fields = ", ".join(
            f"{f['id']}:{f.get('type', 'text')}" for f in entity.get("fields") or []
        )
        lines.append(
            f"- connector `{conn['id']}` ({conn['name']}, source: {conn['source']}) "
            f"→ entity id `{entity['id']}` (name: {entity['name']}) fields: {fields}"
        )
    return "\n".join(lines)


# ================================================================= 开工前的澄清
#
# 用户在范围卡上答过的那几条问答。跟技能/连接器同一请求域模式，
# 由 drive_full_factory 在开工时 set、结束必清空。
#
# ⚠ 2026-08-29 从 v5_llm_generate 搬过来，**同时接上产品路**。搬之前它只被
#   `_build_user_content` 读，而那是老生成器——spec-first 成功时根本不跑它。
#   也就是说这块的自述（「少了它，前面问得再漂亮也只是让用户多点了几下」）
#   描述的正是它自己当时的处境：卡片答完、缺口关掉、闸变绿，生成侧一个字都没看到。
#   现在 `spec_tree.build_spec_prompt` 跟宪章/连接器一样拼它。

_clarifications_var: ContextVar[Optional[List[Dict[str, str]]]] = ContextVar(
    "sliderule_clarifications", default=None
)


def set_clarifications(pairs: "Optional[List[Dict[str, str]]]") -> None:
    """本轮开工前用户答过的澄清问答。传 None / 空即清空。"""
    cleaned: List[Dict[str, str]] = []
    for row in pairs or []:
        if not isinstance(row, dict):
            continue
        q = str(row.get("q") or "").strip()
        a = str(row.get("a") or "").strip()
        if q and a:
            cleaned.append({"q": q[:240], "a": a[:400]})
    _clarifications_var.set(cleaned or None)


_approved_plan_var: ContextVar[str] = ContextVar("sliderule_approved_plan", default="")


def set_approved_plan(content: Optional[str]) -> None:
    _approved_plan_var.set(str(content or ""))


def approved_plan_prompt_block() -> str:
    content = _approved_plan_var.get()
    return f"User-approved implementation plan. Follow this exact revision:\n{content}" if content else ""


def clarification_prompt_block() -> str:
    """开工前问清楚的那几条 → 一段"用户已经答过，按这个来"的硬约束。

    ⚠ **原样带上问题和答案**，不要压缩成一句概括。压缩之后模型只知道
      "用户提过审批"，不知道用户选的是"主管审批"还是"HR 审批"——而这两个
      在权限与工作流里是完全不同的两张图。

    ⚠ 这块是澄清这条链的**最后一环**。少了它，前面问得再漂亮也只是让用户
      多点了几下：卡片答完、缺口关掉、闸变绿，而生成侧一个字都没多看到。
    """
    pairs = _clarifications_var.get() or []
    if not pairs:
        return ""
    lines = [
        "The user already answered these clarifying questions before this run "
        "started. Treat every answer as a HARD requirement of this app — do not "
        "contradict it, do not re-decide it, and reflect it in the systems it "
        "touches (roles, workflow, pages, fields):"
    ]
    for row in pairs:
        lines.append(f"- Q: {row['q']}\n  A: {row['a']}")
    return "\n".join(lines)


# ================================================================= 产品宪章
#
# 用户自己的行业约束，opt-in 才进推演。**存取那一半留在 services.product_charter**
# （CharterStore 要查 identity_store），这里只放请求域那一半：白名单清洗、
# 两个 ContextVar、以及拼进 prompt 的块。
#
# 搬过来的理由跟上面技能/连接器一模一样（2026-08-29）：`spec_tree.build_spec_prompt`
# 要拼这一块，而 product_charter 属 drive 组、本身又是被 drive 调的，
# `spec_first -> drive` 这条边把三个组间环连在一起。宪章的**读侧**跟连接器实体
# 声明是同一类东西：本轮请求域的一块 prompt 上下文。
#
# ⚠ 三条硬约束里的两条落在这一段（另一条「persist fail-open」在 product_charter）：
#   1. **默认不注入。** opt-in 关着时 charter_prompt_block() 必须返回空串，
#      让 spec-first 的 prompt 跟从前逐字节一致。没勾「下一场沿用」就灌，
#      等于自动沿用——正是这条产品判断要消灭的。
#   2. **只认白名单字段。** 其余键（尤其 datamodel / rbac / workflow / page /
#      aigc / appbundle）一律丢掉，不得变成 priors。
#
CHARTER_MARKER = "产品宪章（约束，不是证据）"

CHARTER_FIELDS = (
    "industry",
    "terms",
    "defaultRoles",
    "hardCompliance",
    "brandConstraints",
)

_FIELD_LABELS = {
    "industry": "行业",
    "terms": "术语",
    "defaultRoles": "默认角色",
    "hardCompliance": "硬性合规",
    "brandConstraints": "品牌约束",
}

# 五系统模型段。出现在宪章 JSON 里必须剥掉——那是「上一场当 priors」的入口。
_FIVE_SYSTEM_KEYS = frozenset(
    {
        "datamodel",
        "rbac",
        "workflow",
        "page",
        "aigc",
        "appbundle",
        "model",
        "fiveSystemModel",
        "specFirstPages",
        "pages",
        "entities",
        "permissions",
    }
)

_MAX_FIELD = 500


_charter_var: ContextVar[Dict[str, str]] = ContextVar(
    "sliderule_product_charter", default={}
)
_opt_in_var: ContextVar[bool] = ContextVar(
    "sliderule_charter_opt_in", default=False
)


def normalize_charter(raw: Any) -> Dict[str, str]:
    """只留白名单字段。五系统模型键、建造者文档路径一律丢掉。"""
    if not isinstance(raw, dict):
        return {}
    # 显式扫一遍五系统键再走白名单。删掉 `_FIVE_SYSTEM_KEYS` 这里会
    # NameError——比「定义了不用」更能被变异咬住。
    stripped = {k: v for k, v in raw.items() if k not in _FIVE_SYSTEM_KEYS}
    out: Dict[str, str] = {}
    for key in CHARTER_FIELDS:
        value = str(stripped.get(key) or "").strip()
        if not value:
            continue
        # 挡住有人把 Claude.md 正文贴进某一栏
        lowered = value.lower()
        if "claude.md" in lowered or "agents.md" in lowered:
            continue
        out[key] = value[:_MAX_FIELD]
    return out


def charter_has_content(charter: Optional[Dict[str, str]]) -> bool:
    return bool(charter) and any(str(v).strip() for v in charter.values())



def charter_prompt_block() -> str:
    """opt-in 关着 → 空串。空串才能让 spec-first prompt 跟从前逐字节一致。"""
    if not _opt_in_var.get():
        return ""
    charter = dict(_charter_var.get() or {})
    if not charter_has_content(charter):
        return ""
    lines = [
        CHARTER_MARKER,
        "这是约束，不是证据。不得当作闭环证据，不得绕过模型闸，"
        "不得把上一场的五系统模型当先验。",
    ]
    for key in CHARTER_FIELDS:
        value = str(charter.get(key) or "").strip()
        if value:
            lines.append(f"{_FIELD_LABELS[key]}：{value}")
    return "\n".join(lines)


def set_charter_context(
    charter: Optional[Dict[str, str]], *, opt_in: bool
) -> None:
    cleaned = normalize_charter(charter or {})
    _charter_var.set(cleaned)
    _opt_in_var.set(bool(opt_in) and charter_has_content(cleaned))


def clear_charter_for_run() -> None:
    _charter_var.set({})
    _opt_in_var.set(False)
