# -*- coding: utf-8 -*-
"""精修短路：图只碰到页面时，规格打补丁、权限/流程直接沿用（2026-08-18）。

## 病灶（洗衣房真机 `sr-20260818044538-5YEYG6C82N`）

催离标红那轮图判已经给出 `seeds=page:p3  graphPages=p3  graphSegments=page`，
第 3 步也只重画了 p3。但后面仍按「从 SPEC 整本重写」走完：

    specfirst.spec        ~4s   整本重写规格（求自觉求不动）
    specfirst.structure  ~11s   四页 HTML 全送去反推
    specfirst.semantics   ~6s   现编 rbac/workflow，出口再被 6.2 盖回上一版
    specfirst.assemble    ~7s   现编绑定，出口再盖

约 24 秒是**先做再盖**。沿用本来就在 6.2（Kubernetes SSA：谁拥有哪一段，
重新生成就不许覆盖），却发生在 LLM 烧完之后——钱花了，产物被扔掉。

## 为什么不是 RFC 7386 Merge Patch

`services/merge_patch.py` 模块头写过：补丁语义跟 spec-first「出口永远是
完整六段」架构不兼容，接在 GEN5 上还不通电。这里也不问模型要增量 JSON。
做法跟 6.2 同一条：**代码按住没被点名的段**，只是把按住的时机从 assemble
出口提前到「图判已经说只碰 page」的那一刻。

## 开源对过，不另拉仓

  Aider ContextCoder   已在 refine_page_scope：LLM 只判范围，不产内容。
                       我们有 app_graph，所以反过来——种子给模型，扩散
                       给确定性闭包（refine_graph_scope 模块头）。
  Nx / Turborepo / Bazel   已在图判：受影响集合算完，任务只跑那一撮。
                       本文件把「只跑受影响的」从「哪几页 HTML」扩到
                       SPEC / 结构 / 语义 / 汇合这几步。
  Kubernetes SSA       已在 apply_refine_segment_reuse。这里提前到入口。

不拉 Aider 源码：ContextCoder 要模型报**完整**文件清单（它没有图），
整仓逻辑我们已经按差异改过，再抄一份会做出第二套作用域。

## 短路条件（宁可不短路）

    图闭包页非空  ∧  segments == {page}  ∧  开关开着

segments 空 / 判失败 / 还带 rbac·workflow·datamodel → **整条老路**。
空清单当 page-only 会让「图判含糊」变成「权限一声不吭不改」——
None ≠ [] 那条纪律的同款。增强类，fail-open（纪律七）。

## 开关

`SLIDERULE_REFINE_PAGE_ONLY_SHORTCIRCUIT=0` 整组退回「先做再盖」。
单独留杆，不跟 REFINE_REUSE_SEGMENTS 绑死——那边关的是 6.2 出口沿用。
"""

from __future__ import annotations

import os
from typing import Any, Dict, Iterable, List, Optional
from . import env_flags as _env_flags

#: 词表只有一份，在 services/env_flags。这里保留别名是因为下面按值判断，
#: 不是按开关名读环境变量。
_OFF = _env_flags.OFF
PAGE_SEGMENT = "page"


def _env_on(name: str, default: str = "1") -> bool:
    return str(os.environ.get(name, default)).strip().lower() not in _OFF


def page_only_shortcircuit_enabled() -> bool:
    """默认开。关了退回今天的「SPEC 整本重写 + 语义先做再盖」。"""
    return _env_on("SLIDERULE_REFINE_PAGE_ONLY_SHORTCIRCUIT")


def is_page_only_verdict(verdict: Optional[Dict[str, Any]]) -> bool:
    """图闭包是不是「只碰到页面段」。

    必须 pages 非空 **且** segments 恰好是 {page}。
    segments 空 = 图没翻出段，按判不清处理，不短路。
    """
    if not isinstance(verdict, dict):
        return False
    pages = [str(p).strip() for p in (verdict.get("pages") or []) if str(p).strip()]
    if not pages:
        return False
    segs = {str(s).strip() for s in (verdict.get("segments") or []) if str(s).strip()}
    return segs == {PAGE_SEGMENT}


def page_objs_from_model(model: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """上一版模型里的页面清单。图判在 SPEC 之前跑时，用它当 split 的声明集。"""
    if not isinstance(model, dict):
        return []
    pages = ((model.get("page") or {}).get("pages") or [])
    return [p for p in pages if isinstance(p, dict) and p.get("id")]


def _app_name_from_model(model: Dict[str, Any]) -> str:
    bundle = model.get("appbundle") if isinstance(model.get("appbundle"), dict) else {}
    identity = bundle.get("appIdentity") if isinstance(bundle.get("appIdentity"), dict) else {}
    for raw in (
        identity.get("appName"),
        bundle.get("appName"),
        ((model.get("page") or {}).get("pages") or [{}])[0].get("name")
        if isinstance((model.get("page") or {}).get("pages"), list)
        else None,
    ):
        name = str(raw or "").strip()
        if name and name not in {"系统", "平台", "管理系统", "管理平台", "应用", "工具", "后台"}:
            return name[:20]
    return "沿用产品"


def _personas_from_model(model: Dict[str, Any]) -> List[Dict[str, Any]]:
    roles = ((model.get("rbac") or {}).get("roles") or [])
    out: List[Dict[str, Any]] = []
    for index, role in enumerate(roles):
        if isinstance(role, str) and role.strip():
            out.append({"id": f"persona_{index + 1}", "name": role.strip(), "goals": []})
            continue
        if not isinstance(role, dict):
            continue
        rid = str(role.get("id") or f"persona_{index + 1}").strip()
        name = str(role.get("name") or rid).strip()
        if rid and name:
            out.append({"id": rid, "name": name, "goals": []})
    if not out:
        out.append({"id": "persona_hold", "name": "使用者", "goals": []})
    return out


def hold_spec_from_reuse(
    reuse_model: Optional[Dict[str, Any]],
    *,
    instruction: str = "",
    scope_pages: Optional[Iterable[str]] = None,
) -> Optional[Dict[str, Any]]:
    """从上一版模型重建一份能过闸的 SPEC，只给作用域页打补丁。

    不是问 LLM 要 RFC 7386 补丁——上一版页面/角色已经过闸，本轮图又说
    只碰 page，整本重写是把必然出错的活儿派给模型（page_id_freeze 头注
    同一句：求自觉求不动）。

    作用域页的 purpose 末尾跟上本轮指令，第 3 步 edit_instruction 才有
    「改哪一页、改什么」可依。refineScope 钉成 []：6.2 把 rbac/workflow/aigc
    按住。None 会让 6.2 一段都不沿用——那是「先做再盖」的另一条静默路。

    过不了 SpecTree 闸就回 None，调用方走 generate_spec_tree（fail-open）。
    """
    if not isinstance(reuse_model, dict):
        return None
    pages_in = page_objs_from_model(reuse_model)
    if not pages_in:
        return None
    scoped = {str(p).strip() for p in (scope_pages or []) if str(p).strip()}
    personas = _personas_from_model(reuse_model)
    audience = personas[0]["name"]
    patch = (instruction or "").strip()
    pages: List[Dict[str, Any]] = []
    for raw in pages_in:
        pid = str(raw.get("id") or "").strip()
        name = str(raw.get("name") or pid).strip()
        purpose = str(raw.get("purpose") or f"沿用上一版「{name}」的职责").strip()
        if pid in scoped and patch:
            purpose = f"{purpose}。本轮改动：{patch[:80]}"
        pages.append({
            "id": pid,
            "name": name,
            "purpose": purpose,
            "audience": str(raw.get("audience") or audience).strip() or audience,
            "coversNodes": [],
        })
    payload = {
        "rootNodeId": "n_hold",
        "version": 3,
        "appName": _app_name_from_model(reuse_model),
        "personas": personas,
        "successCriteria": [{
            "id": "sc_hold",
            "text": "当使用者按已有流程操作时，系统应保持上一版可用能力，并落实本轮页面改动。",
        }],
        "nodes": [{
            "id": "n_hold",
            "parentId": None,
            "type": "requirement",
            "title": "沿用上一版规格",
            "acceptance": "当本轮只改指定页面时，系统应沿用上一版权限、流程与未改页面。",
            "coversCriteria": ["sc_hold"],
        }],
        "pages": pages,
        "refineScope": [],
    }
    from .spec_tree import validate_spec_tree

    frozen = {str(p["id"]) for p in pages}
    verdict = validate_spec_tree(payload, frozen_page_ids=frozen)
    if not verdict.get("passed"):
        return None
    return payload


def _coerce_field_type(raw: Any) -> str:
    from .schema_legal import FIELD_TYPES  # 账本单一入口，不经 spec-first 流水线

    value = str(raw or "string").strip()
    return value if value in FIELD_TYPES else "string"


def _coerce_page_kind(raw: Any) -> str:
    from .schema_legal import PAGE_KINDS  # 同上

    value = str(raw or "workbench").strip()
    return value if value in PAGE_KINDS else "workbench"


def structure_from_reuse_model(reuse_model: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """把上一版五系统模型摊成 HtmlStructure 形状，给没重画的页沿用。

    ⚠ 不跑 validate_structure（那条要回原文找 evidence）。沿用页的 HTML
    本轮根本没重画，拿新 HTML 去 grounding 旧字段会把真字段当臆造剪掉。
    只过 HtmlStructure 的形状闸。过不了就 None，调用方全量反推。
    """
    if not isinstance(reuse_model, dict):
        return None
    from .html_structure import HTML_STRUCTURE_VERSION, HtmlStructure

    entities: List[Dict[str, Any]] = []
    for entity in ((reuse_model.get("datamodel") or {}).get("entities") or []):
        if not isinstance(entity, dict) or not entity.get("id"):
            continue
        fields = []
        for field in entity.get("fields") or []:
            if not isinstance(field, dict) or not field.get("id"):
                continue
            ftype = _coerce_field_type(field.get("type"))
            item: Dict[str, Any] = {
                "id": str(field.get("id")),
                "name": str(field.get("name") or field.get("id")),
                "type": ftype,
                "evidence": "沿用上一版",
            }
            if ftype == "ref" and field.get("refEntity"):
                item["refEntity"] = str(field.get("refEntity"))
            elif ftype == "ref":
                continue
            fields.append(item)
        if not fields:
            continue
        entities.append({
            "id": str(entity.get("id")),
            "name": str(entity.get("name") or entity.get("id")),
            "fields": fields,
            "evidence": "沿用上一版",
        })
    pages: List[Dict[str, Any]] = []
    for page in page_objs_from_model(reuse_model):
        pid = str(page.get("id"))
        pages.append({
            "id": pid,
            "name": str(page.get("name") or pid),
            "kind": _coerce_page_kind(page.get("kind")),
            "sourcePageId": pid,
            "sections": list(page.get("sections") or ["沿用"]),
            "evidence": "沿用上一版",
        })
    if not entities or not pages:
        return None
    payload = {
        "version": HTML_STRUCTURE_VERSION,
        "entities": entities,
        "pages": pages,
    }
    try:
        return HtmlStructure.model_validate(payload).model_dump(mode="json")
    except Exception:  # noqa: BLE001 — 沿用是增强，形状不对就让调用方全量反推
        return None


def _as_structure_dict(structure: Any) -> Dict[str, Any]:
    if hasattr(structure, "model_dump"):
        dumped = structure.model_dump(mode="json")
        return dumped if isinstance(dumped, dict) else {}
    return dict(structure) if isinstance(structure, dict) else {}


def merge_held_structure(
    fresh: Any,
    reuse_model: Optional[Dict[str, Any]],
    reused_page_ids: Iterable[str],
    *,
    required_page_ids: Optional[Iterable[str]] = None,
) -> Optional[Dict[str, Any]]:
    """重画页用新反推，照搬页沿用上一版结构。缺页或过不了形状闸就回 None。

    上一版 comment 说 datamodel 不能整段沿用——那是因为**新 HTML** 的
    data-field 会跟旧字段 id 错位。照搬页的 HTML 没变，字段 id 还对得上。
    真机 11 秒结构步把四页都送进 LLM，三页是白烧。
    """
    reused = {str(pid).strip() for pid in reused_page_ids if str(pid).strip()}
    if not reused:
        return None
    held = structure_from_reuse_model(reuse_model)
    if held is None:
        return None
    from .html_structure import HtmlStructure

    fresh_d = _as_structure_dict(fresh)
    fresh_pages = [
        p for p in (fresh_d.get("pages") or [])
        if isinstance(p, dict) and p.get("id") and str(p.get("id")) not in reused
    ]
    held_pages = [
        p for p in (held.get("pages") or [])
        if isinstance(p, dict) and str(p.get("id")) in reused
    ]
    pages = fresh_pages + held_pages
    fresh_ents = {
        str(e.get("id")): e
        for e in (fresh_d.get("entities") or [])
        if isinstance(e, dict) and e.get("id")
    }
    held_ents = {
        str(e.get("id")): e
        for e in (held.get("entities") or [])
        if isinstance(e, dict) and e.get("id")
    }
    # 新反推的实体盖同 id：重画页可能加了字段。照搬页用到的旧实体还在。
    entities = list({**held_ents, **fresh_ents}.values())
    payload = {
        "version": held.get("version") or fresh_d.get("version"),
        "entities": entities,
        "pages": pages,
    }
    try:
        validated = HtmlStructure.model_validate(payload).model_dump(mode="json")
    except Exception:  # noqa: BLE001
        return None
    if required_page_ids is not None:
        got = {str(p.get("id")) for p in (validated.get("pages") or [])}
        need = {str(pid).strip() for pid in required_page_ids if str(pid).strip()}
        if need - got:
            return None
    return validated


def _as_dm_entity(entity: Dict[str, Any]) -> Dict[str, Any]:
    fields = []
    for field in entity.get("fields") or []:
        if not isinstance(field, dict) or not field.get("id"):
            continue
        item = {
            k: field[k]
            for k in ("id", "name", "type", "refEntity")
            if field.get(k) is not None
        }
        fields.append(item)
    return {
        "id": str(entity.get("id")),
        "name": str(entity.get("name") or entity.get("id")),
        "fields": fields,
    }


def _merge_entity_into(old_entity: Dict[str, Any], fresh_entity: Dict[str, Any]) -> Dict[str, Any]:
    """已存在的实体：把这一页新看到的字段**并进去**，不是整个换成这一页看到的。

    ⚠ 2026-08-24：这条是"整个换成"改成"并进去"的分界线。

    页面-only 精修只送**这一次重画的那一页** HTML 去反推结构（第 4 步
    `_redrawn_html`，照搬页不送）。而一个实体的字段常常**散在好几个页面上**
    ——真机图书馆那趟：「读者」的姓名/电话在档案页，借书证状态在借还台页。
    只重画档案页时，反推结构只看得到档案页那几个字段，看不到借还台页
    用的那些。

    旧写法是`old_ents[id] = 这一页反推出来的实体`——**整个换掉**，不是补充。
    档案页反推出来的「读者」只有它自己看得到的那几个字段，借还台页用的
    「借书证状态」不在这次反推的输出里，于是从 datamodel 上**凭空消失**
    ——不是被删了，是"这一页没提到，重新认的时候把它认丢了"。借还台页的
    HTML 里那个 data-field="reader.card_status" 绑定还在，指向的字段却
    从模型里没了：静默的悬空引用，不报错、不告警。

    修法：按字段 id 做**并集**。这一页反推出来的字段（不管是真的新增，
    还是原有字段被重新描述了一遍）覆盖同 id 的旧字段；**这一页没提到的
    旧字段原样保留**，不因为"这次没看见"就当它不存在。这才是这个函数
    自己文档说的"只把结构步新读到的实体并进 datamodel"——"并"是并集，
    不是替换。
    """
    old_fields = {
        str(f.get("id")): f
        for f in old_entity.get("fields") or []
        if isinstance(f, dict) and f.get("id")
    }
    for f in fresh_entity.get("fields") or []:
        fid = str(f.get("id"))
        if fid:
            old_fields[fid] = f  # 这一页看到的（新增或刷新）覆盖同 id 旧字段；
            # 字典对已存在的 key 赋值不改变其插入位置——顺序稳定，
            # 只有真正新增的字段 id 会被追加到末尾。
    return {
        "id": old_entity.get("id"),
        "name": fresh_entity.get("name") or old_entity.get("name"),
        "fields": list(old_fields.values()),
    }


def overlay_page_only_model(
    reuse_model: Optional[Dict[str, Any]],
    structure: Any = None,
) -> Optional[Dict[str, Any]]:
    """page-only：上一版六段原样留下，只把结构步新读到的实体**并**进 datamodel。

    不调 assemble LLM。page / rbac / workflow / aigc / appbundle 整段按住。
    重画页的 HTML 已经在第 3 步改过；绑定沿用上一版——加按钮这种改动
    不该先编一套权限再盖回去。

    ⚠ "并"不是"换"：已存在的实体走字段级合并（见 `_merge_entity_into`），
      只有 id 在 old_ents 里从没出现过的实体才整个当新的收进来。
    """
    if not isinstance(reuse_model, dict):
        return None
    import copy

    model = copy.deepcopy(reuse_model)
    fresh = _as_structure_dict(structure)
    new_entities = [
        e for e in (fresh.get("entities") or [])
        if isinstance(e, dict) and e.get("id")
    ]
    if not new_entities:
        return model

    old_ents = {
        str(e.get("id")): e
        for e in ((model.get("datamodel") or {}).get("entities") or [])
        if isinstance(e, dict) and e.get("id")
    }
    for entity in new_entities:
        eid = str(entity["id"])
        fresh_entity = _as_dm_entity(entity)
        if eid in old_ents:
            old_ents[eid] = _merge_entity_into(old_ents[eid], fresh_entity)
        else:
            old_ents[eid] = fresh_entity  # 真正的新实体，原样收进来
    model["datamodel"] = {"entities": list(old_ents.values())}
    refs = [e["id"] for e in model["datamodel"]["entities"] if e.get("id")]
    bundle = model.get("appbundle")
    if isinstance(bundle, dict) and refs:
        bundle = dict(bundle)
        bundle["dataModelRefs"] = refs
        model["appbundle"] = bundle
    return model


def format_refine_reuse_note(
    *,
    redrawn_ids: Iterable[str],
    reused_count: int = 0,
    held_spec: bool = False,
    held_semantics: bool = False,
    held_structure: bool = False,
    page_names: Optional[Dict[str, str]] = None,
) -> str:
    """左栏收口句：改了哪一页、沿用了什么。不用步数吓人。"""
    names = page_names or {}
    labels: List[str] = []
    for pid in redrawn_ids:
        key = str(pid).strip()
        if not key:
            continue
        label = str(names.get(key) or "").strip()
        labels.append(f"{label}（{key}）" if label and label != key else key)
    if not labels:
        return ""
    # 首轮 / 全量重画：没有沿用可说，左栏继续用阶段·步，别把「改了四页」
    # 当成精修收口句。
    if not reused_count and not held_spec and not held_semantics and not held_structure:
        return ""
    bits = [f"改了 {'、'.join(labels)}"]
    if reused_count:
        bits.append(f"沿用 {reused_count} 页")
    held: List[str] = []
    if held_spec:
        held.append("规格")
    if held_semantics:
        held.append("权限")
        held.append("流程")
    if held_structure:
        held.append("未改页的数据结构")
    if held:
        bits.append("、".join(held) + "沿用")
    return " · ".join(bits)


def page_names_from_spec_or_model(
    spec: Optional[Dict[str, Any]] = None,
    model: Optional[Dict[str, Any]] = None,
) -> Dict[str, str]:
    names: Dict[str, str] = {}
    for src in (model, spec):
        if not isinstance(src, dict):
            continue
        pages = src.get("pages") if isinstance(src.get("pages"), list) else (
            ((src.get("page") or {}).get("pages") or [])
        )
        for page in pages:
            if isinstance(page, dict) and page.get("id"):
                names[str(page["id"])] = str(page.get("name") or page["id"])
    return names


def env_flag_off_values() -> Set[str]:
    """测试用：跟仓里其它开关同一份词表。"""
    return set(_OFF)
