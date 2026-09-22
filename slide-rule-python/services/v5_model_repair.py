"""
门禁前确定性修复（不变式引用近邻修复 + 悬挂不变式剔除降级）。

背景：真实生成三次有两次栽在 invariants.refs——LLM 在长 JSON 末尾回忆自己
前文起的几十个 id，是整个契约里幻觉率最高的部位（见
docs/reverse-eval-ai-artist-saas.md 实验 A 与线上截图案例
`generate_fall_risk_explanation`）。此前一个 ref 拼错 → 门禁硬拦 → 整个
模型报废 0/6，惩罚粒度不对称：不变式是增强注释层，不是结构骨架。

本模块在 generate 之后、gate 之前跑一次**确定性**修复（零 LLM、可解释）：
  1. 近邻修复：ref 解析失败时，在模型已知 id 集里找唯一近邻
     （词干包含 / difflib 相似度），唯一命中才改写并留痕；歧义不猜。
  2. 剔除降级：修不好的不变式整条剔除并留痕——坏引用不展示（诚实性不丢），
     但一条注释级内容不再株连骨架六系统。
骨架五段（datamodel/rbac/workflow/page/aigc/appbundle 业务绑定）不在修复范围，
悬挂仍由门禁硬拦；唯一例外是纯展示入口 `landingPageRef`，修不好就清除并
回退旧工作台——fail-closed 语义只对不变式/展示层降级。

E37 扩展：page.charts / page.stats（图表与统计卡声明）与不变式同理——
可选的展示增强层，不是结构骨架。用户实测案例：LLM 在 chart.metric 写了
`avg:word_card.mastery_score`（stats 合法、charts 非法的枚举陷阱）→ 门禁
硬拦 → 整个模型 0/6 报废。此处同款处方：字段引用近邻修复（唯一命中才改）、
形态非法（type/metric 枚举违规）整条剔除留痕、非法 format 清除回默认渲染。

留痕写进 appbundle.invariantNotes = {"repaired": [...], "dropped": [...]} 与
appbundle.presentationNotes = {"repaired","droppedCharts","droppedStats",
"clearedFormats"}，随 per-skill 证据通道原样到达客户端（AppBundle 屏如实展示）。
"""

from __future__ import annotations

import copy
import difflib
from typing import Any, Dict, List

from .v5_model_gate import (
    STAT_FORMATS,
    _as_dict,
    _as_list,
    _collect_datamodel_field_refs,
    collect_invariant_ref_ids,
)

# difflib 相似度阈值：0.75 能接住"多/少一个前缀词"级别的拼错
# （generate_fall_risk_explanation ↔ fall_risk_explanation ≈ 0.86），
# 又不至于把不相干 id 拉郎配。
_SIMILARITY_CUTOFF = 0.75


def _unique_near_match(ref: str, known: set) -> str | None:
    # A model may flatten a canonical ``entity.field`` reference to
    # ``entity_field``. Restore it only when the mapping is unique.
    flattened = [
        k for k in known if str(k).replace(".", "_").replace(":", "_") == ref
    ]
    if len(flattened) == 1:
        return flattened[0]
    if len(flattened) > 1:
        return None
    """唯一近邻：词干包含（唯一）→ difflib 相似度（唯一且过阈值）→ None。"""
    # 1) 词干包含：ref 是某已知 id 的子串 / 超串（去掉动词前缀这类拼错）
    containment = [k for k in known if (ref in k or k in ref) and k != ref]
    if len(containment) == 1:
        return containment[0]
    if len(containment) > 1:
        return None  # 歧义不猜
    # 2) difflib 近邻（cutoff 内唯一命中才算）
    close = difflib.get_close_matches(ref, list(known), n=2, cutoff=_SIMILARITY_CUTOFF)
    return close[0] if len(close) == 1 else None


# 合法域来自单一真相源（经 gate re-export，E40.1）——与门永远同一本账
from .v5_model_gate import CHART_TYPES as _CHART_TYPES


def _repair_binding_field_types(
    block: dict, model: dict, notes: dict, page_id: str
) -> dict:
    """把 `binding.*FieldRef` 指到**类型对得上**的字段上。

    ## 为什么补这一条：门拦下来的全是它

    2026-08-10 线上一趟推演（黑灰产情报），容器日志里结构闸的 4 条裁决**无一
    例外**都是这个形状：

        descFieldRef      'analyst_note' must be a text   field (got 'string')
        actionFieldRef    'action'       must be a string field (got 'enum')
        descFieldRef      'risk_level'   must be a text   field (got 'enum')
        applicantFieldRef 'owner_role'   must be a string field (got 'ref')
        summaryFieldRef   'risk_level'   must be a text   field (got 'enum')

    不是悬空引用、不是结构错——模型挑了个语义上完全合理的字段，只是类型不对。

    而这类**此前没有任何确定性修复**：`_repair_block_binding` 只修 entityRef 的
    拼写。于是每次都得走一轮 LLM 回喂重生成，**172~208 秒买一个"把 string 改成
    text"**。那趟里 loop-1 甚至回喂完仍未过（换了个区块报错），收口直接 0/6。

    这类必然反复发生：目录里 entityFieldRefs 一共要求 708 处类型，
    string 285 / enum 197 / number 155 / date 56 / **text 12** / ref 3。
    `text` 是 12/708 的少数派，而 `analyst_note` 这种字段人来标也会标 string。

    ## 判据：类型先过滤，再套本文件既有的"歧义不猜"

    候选只在**同实体、类型正好等于 schema 要求**的字段里挑：

      · 0 个   → 不动，留给门硬拦（fail-closed 不变）
      · 1 个   → 直接改，留痕
      · 多个   → 交给 `_unique_near_match`（词干包含唯一 → difflib 过阈值唯一），
                仍然歧义就不动

    最后这一步是刻意复用本文件既有的那把尺，而不是另发明一个打分：
    AJV 的 `coerceTypes` 用的是同一条哲学——只沿一张**显式枚举**的表转换，
    表外的一律判失败而不是猜（docs/coercion.md 里 `⇘` 标的就是"不转，直接
    失败"）。这里的"显式枚举"就是类型相等，"不猜"就是歧义时原样留给门。

    ## 边界

      · 悬空字段（entity 里压根没有）**不碰** —— 门已有 DANGLING 判据，
        在这儿再猜一次只会把"引用错了"伪装成"引用对了但选得怪"。
      · 类型账本与门共用 `_collect_field_types`，不另起一份 —— 本文件顶部那条
        "合法域来自单一真相源"的纪律；两边各自维护过一次，结果是奇偶不齐。
    """
    from .v5_model_gate import EXPERIENCE_BLOCK_BINDING_SCHEMAS, _collect_field_types

    schema = EXPERIENCE_BLOCK_BINDING_SCHEMAS.get(str(block.get("type") or "").strip())
    if not schema:
        return block
    wants = schema.get("entityFieldRefs") or {}
    if not wants:
        return block
    binding = block.get("binding")
    if not isinstance(binding, dict):
        return block
    entity_ref = str(binding.get("entityRef") or "").strip()
    if not entity_ref:
        return block

    all_types = _collect_field_types(_as_dict(model.get("datamodel")))
    prefix = f"{entity_ref}."
    own = {k[len(prefix):]: v for k, v in all_types.items() if k.startswith(prefix)}
    if not own:
        return block

    new_binding = None
    for field, want in wants.items():
        cur = str(binding.get(field) or "").strip()
        if not cur:
            continue
        got = own.get(cur)
        if got is None or got == want:
            continue  # 悬空交给门；类型已经对的不动
        candidates = [f for f, t in own.items() if t == want]
        if len(candidates) == 1:
            fixed = candidates[0]
        else:
            fixed = _unique_near_match(cur, set(candidates))
        if not fixed:
            continue
        if new_binding is None:
            new_binding = dict(binding)
        new_binding[field] = fixed
        notes.setdefault("repaired", []).append({
            "pageId": page_id,
            "path": f"blocks[{block.get('id') or '<unnamed>'}].binding.{field}",
            "from": cur,
            "to": fixed,
            "reason": f"类型要 {want}，'{cur}' 是 {got}",
        })
    if new_binding is not None:
        block = dict(block)
        block["binding"] = new_binding
    return block


def _repair_block_binding(block: dict, model: dict) -> dict:
    """修复 block.binding.entityRef 的近邻拼写错误。

    若 entityRef 在已知实体 id 集中找到唯一近邻则自动改写；歧义或无近邻则
    原样保留（留给 gate 硬拦）。纯函数——返回新 dict，不修改入参。
    """
    binding = block.get("binding")
    if not isinstance(binding, dict):
        return block
    entity_ref = binding.get("entityRef")
    if not entity_ref:
        return block
    known_ids = [
        e.get("id", "")
        for e in _as_list(model.get("datamodel", {}).get("entities"))
        if e.get("id")
    ]
    if entity_ref in known_ids:
        return block
    # 近邻匹配：词干包含 或 长度差 ≤ 2
    close = [
        eid for eid in known_ids
        if eid and (
            entity_ref in eid or eid in entity_ref or
            abs(len(entity_ref) - len(eid)) <= 2
        )
    ]
    if len(close) == 1:
        block = dict(block)
        block["binding"] = dict(binding)
        block["binding"]["entityRef"] = close[0]
    return block


def _repair_presentation_layer(m: Dict[str, Any]) -> Dict[str, Any]:
    """page.charts / page.stats 的确定性修复（E37，与门禁同一套合法域）。

    返回留痕 {"repaired","droppedCharts","droppedStats","clearedFormats"}，
    并原地改写 m["page"]["pages"]（调用方已深拷贝）。规则与 gate 的
    charts/stats 校验一一对应：能近邻修复的字段引用修掉，形态非法
    （枚举违规）的整条剔除——展示层小违规不再株连整模型 0/6。
    """
    field_refs = _collect_datamodel_field_refs(_as_dict(m.get("datamodel")))
    entity_ids = {r for r in field_refs if "." not in r}
    dotted_refs = field_refs - entity_ids
    from .v5_model_gate import _collect_field_types

    field_types = _collect_field_types(_as_dict(m.get("datamodel")))
    number_refs = {r for r, t in field_types.items() if t == "number"}
    date_refs = {r for r, t in field_types.items() if t == "date"}
    enum_refs = {r for r, t in field_types.items() if t == "enum"}
    rbac = _as_dict(m.get("rbac"))
    permission_refs = {
        str(value).strip() for value in _as_list(rbac.get("permissions")) if str(value).strip()
    }
    role_refs = set()
    for value in _as_list(rbac.get("roles")):
        role_id = _as_dict(value).get("id") if isinstance(value, dict) else value
        if str(role_id or "").strip():
            role_refs.add(str(role_id).strip())
    notes: Dict[str, List[Dict[str, Any]]] = {
        "repaired": [], "droppedCharts": [], "droppedStats": [],
        "droppedRankings": [], "droppedFeeds": [],
        "droppedPipelines": [],
        "clearedFormats": [], "clearedIdentity": [], "clearedLandingPage": [],
        "droppedBlocks": [],
    }

    # Field format is optional renderer metadata. Clearing an out-of-domain
    # value is deterministic and preserves the entity/field contract, so it
    # must not force an expensive datamodel regeneration.
    from .schema_legal import NUMBER_FORMATS, STRING_FORMATS

    for entity in _as_list(_as_dict(m.get("datamodel")).get("entities")):
        entity_dict = _as_dict(entity)
        entity_id = str(entity_dict.get("id") or "").strip()
        for field in _as_list(entity_dict.get("fields")):
            field_dict = _as_dict(field)
            fmt = str(field_dict.get("format") or "").strip()
            if not fmt:
                continue
            field_type = str(field_dict.get("type") or "string").strip()
            allowed = (
                NUMBER_FORMATS
                if field_type == "number"
                else STRING_FORMATS
                if field_type in ("string", "text")
                else ()
            )
            if fmt not in allowed:
                field_dict.pop("format", None)
                notes["clearedFormats"].append(
                    {"entityId": entity_id, "fieldId": field_dict.get("id"), "format": fmt}
                )

    def _fix_ref(container: Dict[str, Any], key: str, ref: str, known: set, pid: str) -> bool:
        """近邻修复 container[key]（引用 ref）。修成返回 True 并留痕。"""
        if not ref:
            return False  # 缺失的引用没有"近邻"，修它是瞎猜——留给剔除
        # 带点的字段引用只在带点集合里找近邻：裸实体 id 是任何 entity.* 的
        # 子串，混进候选会把明显的字段拼错误判成"歧义不猜"
        if "." in ref and known is field_refs:
            known = dotted_refs
        fixed = _unique_near_match(ref, known)
        if fixed is None:
            return False
        container[key] = fixed
        notes["repaired"].append({"pageId": pid, "path": key, "from": ref, "to": fixed})
        return True

    def _fix_ref_list(container: Dict[str, Any], key: str, known: set, owner: str) -> None:
        values = container.get(key)
        if not isinstance(values, list):
            return
        repaired_values = []
        for value in values:
            ref = str(value or "").strip()
            fixed = ref if ref in known else _unique_near_match(ref, known)
            repaired_values.append(fixed or value)
            if fixed and fixed != ref:
                notes["repaired"].append(
                    {"pageId": owner, "path": key, "from": ref, "to": fixed}
                )
        container[key] = repaired_values

    page = _as_dict(m.get("page"))
    pages = _as_list(page.get("pages"))
    new_pages: List[Any] = []
    for p in pages:
        if not isinstance(p, dict):
            new_pages.append(p)
            continue
        pd = dict(p)
        pid = str(pd.get("id") or pd.get("name") or "<unnamed>")

        for key, known_refs in (
            ("statusField", enum_refs),
            ("dateField", date_refs),
            ("colorBy", enum_refs),
        ):
            ref = str(pd.get(key) or "").strip()
            if ref and ref not in known_refs:
                _fix_ref(pd, key, ref, known_refs, pid)
        _fix_ref_list(pd, "fieldBindings", dotted_refs, pid)
        _fix_ref_list(pd, "actionPermissions", permission_refs, pid)
        for action in _as_list(pd.get("actions")):
            action_dict = _as_dict(action)
            permission_ref = str(action_dict.get("permissionRef") or "").strip()
            if permission_ref and permission_ref not in permission_refs:
                _fix_ref(action_dict, "permissionRef", permission_ref, permission_refs, pid)

        # 二阶段体验区块目录：type 拼写近邻唯一命中才修；无法解析的整块
        # 剔除并留痕。绑定/布局/动作仍属后续步骤，本步只守住选材合法域。
        from .schema_legal import EXPERIENCE_BLOCK_TYPES

        kept_blocks: List[Any] = []
        if "blocks" in pd and not isinstance(pd.get("blocks"), list):
            notes["droppedBlocks"].append({
                "pageId": pid,
                "blockId": "<collection>",
                "type": "<invalid>",
                "reason": "blocks 不是数组，已清空",
            })
        for block in _as_list(pd.get("blocks")):
            bd = dict(_as_dict(block))
            bid = str(bd.get("id") or "<unnamed>")
            block_type = str(bd.get("type") or "").strip()
            if block_type in EXPERIENCE_BLOCK_TYPES:
                bd = _repair_block_binding(bd, m)
                # 顺序要紧：字段类型修复要按 entityRef 去查该实体的字段表，
                # 所以必须排在 entityRef 近邻修复**之后**。
                bd = _repair_binding_field_types(bd, m, notes, pid)
                kept_blocks.append(bd)
                continue
            fixed_type = _unique_near_match(block_type, set(EXPERIENCE_BLOCK_TYPES))
            if fixed_type:
                bd["type"] = fixed_type
                notes["repaired"].append({
                    "pageId": pid,
                    "path": f"blocks[{bid}].type",
                    "from": block_type,
                    "to": fixed_type,
                })
                bd = _repair_block_binding(bd, m)
                bd = _repair_binding_field_types(bd, m, notes, pid)
                kept_blocks.append(bd)
            else:
                notes["droppedBlocks"].append({
                    "pageId": pid,
                    "blockId": bid,
                    "type": block_type,
                    "reason": "区块类型不在体验区块目录，且无法唯一修复",
                })
        if "blocks" in pd:
            pd["blocks"] = kept_blocks

        kept_charts: List[Any] = []
        for chart in _as_list(pd.get("charts")):
            cd = dict(_as_dict(chart))
            cid = str(cd.get("id") or cd.get("name") or "<unnamed>")
            drop_reason = ""
            ctype = str(cd.get("type") or "").strip()
            if not isinstance(chart, dict):
                drop_reason = "声明不是对象"
            elif ctype and ctype not in _CHART_TYPES:
                drop_reason = f"图表形态 '{ctype}' 渲染层不支持"
            if not drop_reason:
                dim = str(cd.get("dimension") or "").strip()
                if (not dim or dim not in field_refs) and not _fix_ref(cd, "dimension", dim, field_refs, pid):
                    drop_reason = f"维度 '{dim or '<缺失>'}' 无法解析到数据模型"
            if not drop_reason:
                metric = str(cd.get("metric") or "").strip()
                if metric.startswith("sum:"):
                    mref = metric[4:].strip()
                    if mref not in field_refs:
                        fixed = _unique_near_match(mref, dotted_refs if "." in mref else field_refs)
                        if fixed is None:
                            drop_reason = f"指标字段 '{mref}' 无法解析到数据模型"
                        else:
                            cd["metric"] = f"sum:{fixed}"
                            notes["repaired"].append({"pageId": pid, "path": "metric", "from": mref, "to": fixed})
                elif metric and metric != "count":
                    # charts 只认 count/sum:*（avg: 是 stats 专属）——改写会撒谎，剔除留痕
                    drop_reason = f"图表指标 '{metric}' 只能是 count 或 sum:<entity.field>"
            if drop_reason:
                notes["droppedCharts"].append({"pageId": pid, "chartId": cid, "reason": drop_reason})
            else:
                kept_charts.append(cd)
        if "charts" in pd:
            pd["charts"] = kept_charts

        kept_stats: List[Any] = []
        for stat in _as_list(pd.get("stats")):
            sd = dict(_as_dict(stat))
            sid = str(sd.get("id") or sd.get("name") or "<unnamed>")
            drop_reason = ""
            if not isinstance(stat, dict):
                drop_reason = "声明不是对象"
            if not drop_reason:
                entity_ref = str(sd.get("entity") or "").strip()
                if (not entity_ref or entity_ref not in entity_ids) and not _fix_ref(sd, "entity", entity_ref, entity_ids, pid):
                    drop_reason = f"实体 '{entity_ref or '<缺失>'}' 无法解析到数据模型"
            if not drop_reason:
                metric = str(sd.get("metric") or "").strip()
                if metric.startswith("sum:") or metric.startswith("avg:"):
                    mref = metric[4:].strip()
                    if mref not in field_refs:
                        fixed = _unique_near_match(mref, dotted_refs if "." in mref else field_refs)
                        if fixed is None:
                            drop_reason = f"指标字段 '{mref}' 无法解析到数据模型"
                        else:
                            sd["metric"] = f"{metric[:4]}{fixed}"
                            notes["repaired"].append({"pageId": pid, "path": "metric", "from": mref, "to": fixed})
                elif metric != "count":
                    drop_reason = f"统计指标 '{metric or '<缺失>'}' 只能是 count/sum:/avg:"
            if not drop_reason:
                sfmt = str(sd.get("format") or "").strip()
                if sfmt and sfmt not in STAT_FORMATS:
                    sd.pop("format", None)  # 非法 format 清除，回默认渲染（stat 本体保留）
                    notes["clearedFormats"].append({"pageId": pid, "statId": sid, "format": sfmt})
            if drop_reason:
                notes["droppedStats"].append({"pageId": pid, "statId": sid, "reason": drop_reason})
            else:
                kept_stats.append(sd)
        if "stats" in pd:
            pd["stats"] = kept_stats

        # E40.4 排行榜/动态流：与图表同款处方——引用近邻修复（唯一命中），
        # 修不好整条剔除留痕。类型不匹配（sortBy 非 number / timeField 非
        # date / levelField 非 enum）由门硬拦，这里只治悬空引用。
        kept_rankings: List[Any] = []
        for rank in _as_list(pd.get("rankings")):
            rd = dict(_as_dict(rank))
            rid = str(rd.get("id") or rd.get("name") or "<unnamed>")
            drop_reason = ""
            if not isinstance(rank, dict):
                drop_reason = "声明不是对象"
            if not drop_reason:
                entity_ref = str(rd.get("entity") or "").strip()
                if (not entity_ref or entity_ref not in entity_ids) and not _fix_ref(rd, "entity", entity_ref, entity_ids, pid):
                    drop_reason = f"实体 '{entity_ref or '<缺失>'}' 无法解析到数据模型"
            if not drop_reason:
                sort_ref = str(rd.get("sortBy") or "").strip()
                if (sort_ref not in number_refs) and not _fix_ref(rd, "sortBy", sort_ref, number_refs, pid):
                    drop_reason = f"排序字段 '{sort_ref or '<缺失>'}' 无法解析到数值字段"
            if drop_reason:
                notes["droppedRankings"].append({"pageId": pid, "rankingId": rid, "reason": drop_reason})
            else:
                kept_rankings.append(rd)
        if "rankings" in pd:
            pd["rankings"] = kept_rankings

        kept_feeds: List[Any] = []
        for feed in _as_list(pd.get("feeds")):
            fd2 = dict(_as_dict(feed))
            fid = str(fd2.get("id") or fd2.get("name") or "<unnamed>")
            drop_reason = ""
            if not isinstance(feed, dict):
                drop_reason = "声明不是对象"
            if not drop_reason:
                entity_ref = str(fd2.get("entity") or "").strip()
                if (not entity_ref or entity_ref not in entity_ids) and not _fix_ref(fd2, "entity", entity_ref, entity_ids, pid):
                    drop_reason = f"实体 '{entity_ref or '<缺失>'}' 无法解析到数据模型"
            if not drop_reason:
                time_ref = str(fd2.get("timeField") or "").strip()
                if (time_ref not in date_refs) and not _fix_ref(fd2, "timeField", time_ref, date_refs, pid):
                    drop_reason = f"时间字段 '{time_ref or '<缺失>'}' 无法解析到日期字段"
            if not drop_reason:
                level_ref = str(fd2.get("levelField") or "").strip()
                if level_ref and level_ref not in enum_refs and not _fix_ref(fd2, "levelField", level_ref, enum_refs, pid):
                    fd2.pop("levelField", None)  # 级别是可选增强——修不好清掉，流本体保留
                    notes["clearedFormats"].append({"pageId": pid, "statId": fid, "format": f"levelField:{level_ref}"})
            if drop_reason:
                notes["droppedFeeds"].append({"pageId": pid, "feedId": fid, "reason": drop_reason})
            else:
                kept_feeds.append(fd2)
        if "feeds" in pd:
            pd["feeds"] = kept_feeds

        new_pages.append(pd)

    if pages:
        page = dict(page)
        page["pages"] = new_pages
        m["page"] = page

    aigc = _as_dict(m.get("aigc"))
    capabilities = _as_list(aigc.get("capabilities"))
    repaired_capabilities: List[Any] = []
    for capability in capabilities:
        if not isinstance(capability, dict):
            repaired_capabilities.append(capability)
            continue
        cap = dict(capability)
        cap_id = str(cap.get("id") or cap.get("name") or "<unnamed>")
        _fix_ref_list(cap, "inputFields", dotted_refs, f"aigc:{cap_id}")
        _fix_ref_list(cap, "roleRefs", role_refs, f"aigc:{cap_id}")
        output_ref = str(cap.get("outputField") or "").strip()
        if output_ref and output_ref not in dotted_refs:
            _fix_ref(cap, "outputField", output_ref, dotted_refs, f"aigc:{cap_id}")
        repaired_capabilities.append(cap)
    if capabilities:
        aigc = dict(aigc)
        aigc["capabilities"] = repaired_capabilities
        cap_by_id = {
            str(cap.get("id") or "").strip(): cap
            for cap in repaired_capabilities
            if isinstance(cap, dict) and str(cap.get("id") or "").strip()
        }
        kept_pipelines: List[Any] = []
        for pipeline in _as_list(aigc.get("pipelines")):
            pipe = _as_dict(pipeline)
            pipe_id = str(pipe.get("id") or pipe.get("name") or "<unnamed>")
            steps = [str(step or "").strip() for step in _as_list(pipe.get("steps"))]
            reason = ""
            if len(steps) < 2:
                reason = "pipeline has fewer than two capabilities"
            elif any(step not in cap_by_id for step in steps):
                reason = "pipeline references an unknown capability"
            else:
                for previous, current in zip(steps, steps[1:]):
                    output = str(cap_by_id[previous].get("outputField") or "").strip()
                    inputs = {
                        str(value or "").strip()
                        for value in _as_list(cap_by_id[current].get("inputFields"))
                    }
                    if not output or output not in inputs:
                        reason = f"pipeline handoff is not wired between {previous} and {current}"
                        break
            if reason:
                notes["droppedPipelines"].append(
                    {"pipelineId": pipe_id, "reason": reason}
                )
            else:
                kept_pipelines.append(pipeline)
        if "pipelines" in aigc:
            if kept_pipelines:
                aigc["pipelines"] = kept_pipelines
            else:
                aigc.pop("pipelines", None)
        m["aigc"] = aigc

    # 落地页是可选展示增强：拼错时只在 page id 中做唯一近邻修复；无唯一
    # 候选时清除并回退旧工作台，不让一个首页引用株连整个五系统模型。
    appbundle_i = _as_dict(m.get("appbundle"))
    landing_ref = str(appbundle_i.get("landingPageRef") or "").strip()
    if landing_ref:
        page_ids = {
            str(_as_dict(p).get("id") or "").strip()
            for p in new_pages
            if str(_as_dict(p).get("id") or "").strip()
        }
        if landing_ref not in page_ids:
            fixed_ref = _unique_near_match(landing_ref, page_ids)
            appbundle_i = dict(appbundle_i)
            if fixed_ref:
                appbundle_i["landingPageRef"] = fixed_ref
                notes["repaired"].append({
                    "pageId": "appbundle",
                    "path": "landingPageRef",
                    "from": landing_ref,
                    "to": fixed_ref,
                })
            else:
                appbundle_i.pop("landingPageRef", None)
                notes["clearedLandingPage"].append({
                    "value": landing_ref,
                    "reason": "无法唯一解析到已有页面，已回退旧工作台",
                })
            m["appbundle"] = appbundle_i

    # E40.2 应用身份段：非法枚举值清除回默认（渲染层会用缺省主题/图标/导航），
    # 产品名空串清除。身份是纯展示增强层——与 format 同款处方，绝不株连。
    from .schema_legal import IDENTITY_ICONS, IDENTITY_NAVS, IDENTITY_THEMES

    appbundle_i = _as_dict(m.get("appbundle"))
    identity = appbundle_i.get("appIdentity")
    if isinstance(identity, dict):
        fixed_identity = dict(identity)
        for key, legal in (("theme", IDENTITY_THEMES), ("icon", IDENTITY_ICONS), ("nav", IDENTITY_NAVS)):
            value = str(fixed_identity.get(key) or "").strip()
            if key in fixed_identity and (not value or value not in legal):
                fixed_identity.pop(key, None)
                notes["clearedIdentity"].append({"key": key, "value": value})
        if "productName" in fixed_identity and not str(fixed_identity.get("productName") or "").strip():
            fixed_identity.pop("productName", None)
            notes["clearedIdentity"].append({"key": "productName", "value": ""})
        # 2026-08-04：chartColors 非法就整段清掉（不是逐个挑好的留下）。
        # 图表色是**一套**，区分度是按整套的相邻关系验的（见 sheet_palette），
        # 从一套里捡几个剩下的拼起来，那个"剩下的组合"谁都没验过。清掉即回落
        # 账本里那 8 套验过的色序，比留半套强。
        raw_colors = fixed_identity.get("chartColors")
        if "chartColors" in fixed_identity:
            import re as _re

            from .sheet_palette import MIN_USABLE_COLORS

            ok = (
                isinstance(raw_colors, list)
                and len(raw_colors) >= MIN_USABLE_COLORS
                and all(
                    isinstance(c, str) and _re.fullmatch(r"#[0-9a-fA-F]{6}", c)
                    for c in raw_colors
                )
            )
            if not ok:
                fixed_identity.pop("chartColors", None)
                notes["clearedIdentity"].append(
                    {"key": "chartColors", "value": str(raw_colors)[:80]}
                )
        if fixed_identity != identity:
            appbundle_i = dict(appbundle_i)
            appbundle_i["appIdentity"] = fixed_identity
            m["appbundle"] = appbundle_i
    return notes


def _repair_page_workflow_refs(model: Dict[str, Any]) -> Dict[str, Any]:
    """把 appbundle.pageBindings[].workflowRef 修到合法工作流 id 上；修不好就**摘掉**。

    ## 为什么补这一条

    2026-08-10 度量（scripts/block_selection_metrics.py，control 臂 10 趟）：首轮
    过闸失败里这一族占 4/6 趟、条数最多，是当下最大的阻塞。模型把这个字段当成
    "这一页属于哪个流程"的自由文本，一页编一个：

        pageRef=oncall_calendar  workflowRef='oncall_shifts'       ← 凭空造的
        pageRef=silence_windows  workflowRef='silence_windows'     ← 直接抄了 pageRef
        pageRef=audit_log        workflowRef='audit_page'          ← 凭空造的

    ⚠️ 合法域**必须**取自门禁的 `_collect_workflow_ids`，不能在这儿自己算一份。
    第一版就是自己算的（只收 workflow.id + chains[].id），结果比门**更严**——门
    明确也认**节点 id**（那个函数的文档原文："referenced by its top-level id,
    chain ids, and/or node ids"）。于是修复把门本来放行的引用摘掉了，直接弄红
    三条既有用例（library 夹具里 workflowRef='review' 是个节点名）。这正是本
    文件顶部那条纪律要防的事：合法域两边各自维护，必然奇偶不齐。

    ## 为什么可以确定性地摘掉

    `workflowRef` 是**可选**字段（门禁第 6 节只在 `kind=wizard` 时要求必填），
    而且下游明确处理了缺省：pageSkill.createWorkflowTaskViewAppBundleBindingEvidence
    里 `bindingAligned = !wfRef || ...`，没有它就是"不声明流程绑定"，不是错误。

    所以摘掉一个**已证伪的可选断言**跟本文件"歧义不猜"的纪律是一致的：我们没有
    去猜它到底属于哪条流程（那才是编造），只是删掉一句明确写错的话。代价对比很
    悬殊——留着就是一轮 172~208 秒的 LLM 回喂重生成。

    ## 边界

      · 先试唯一近邻（复用 `_unique_near_match`）：真是拼错就改对，不浪费信息；
      · `kind=wizard` 的页**不摘**。那里 workflowRef 是必填，摘了会从"引用错了"
        变成"假向导"——渲染器没有步骤可画。这种必须让门硬拦。
    """
    appbundle = _as_dict(model.get("appbundle"))
    bindings = _as_list(appbundle.get("pageBindings"))
    if not bindings:
        return {}

    # 合法域与门禁第 6 节共用同一函数——见上面头注里那条教训
    from .v5_model_gate import _collect_workflow_ids

    legal = _collect_workflow_ids(_as_dict(model.get("workflow")))
    if not legal:
        return {}  # 压根没有工作流可指——交给门，不在这儿造

    wizard_pages = {
        str(_as_dict(pd).get("id") or "").strip()
        for pd in _as_list(_as_dict(model.get("page")).get("pages"))
        if str(_as_dict(pd).get("kind") or "").strip() == "wizard"
    }

    repaired: List[Dict[str, Any]] = []
    dropped: List[Dict[str, Any]] = []
    new_bindings: List[Any] = []
    for raw in bindings:
        bd = _as_dict(raw)
        wref = str(bd.get("workflowRef") or "").strip()
        if not wref or wref in legal:
            new_bindings.append(raw)
            continue
        page_ref = str(bd.get("pageRef") or "").strip()
        fixed = _unique_near_match(wref, legal)
        if fixed is not None:
            nb = dict(bd)
            nb["workflowRef"] = fixed
            new_bindings.append(nb)
            repaired.append({"pageRef": page_ref, "from": wref, "to": fixed})
            continue
        if page_ref in wizard_pages:
            new_bindings.append(raw)  # 向导页必填，留给门硬拦
            continue
        nb = dict(bd)
        nb.pop("workflowRef", None)
        new_bindings.append(nb)
        dropped.append({"pageRef": page_ref, "workflowRef": wref})

    if not repaired and not dropped:
        return {}
    ab = dict(appbundle)
    ab["pageBindings"] = new_bindings
    ab["pageWorkflowRefNotes"] = {"repaired": repaired, "dropped": dropped}
    model["appbundle"] = ab
    return {"repaired": repaired, "dropped": dropped}


def _repair_layout_slot_violations(model: Dict[str, Any]) -> Dict[str, Any]:
    """把放错槽位的区块**挪到**它自己声明的首选槽位。

    ## 为什么补这一条

    2026-08-10 开了目录窄化之后（services/block_narrowing），对题区块的选中数从
    0.5 涨到 3.5，但首轮过闸从 2/6 掉到 1/6——残余裁决 4/6 趟都是这个形状：

        block 'silence_form' (type MuteTimingSchedule) is not allowed in slot 'overlay';
            catalog allows: main/aside/supplement
        block 'overview_timeline' (type WorkflowTimeline) is not allowed in slot 'metrics'
        block 'triage_panel' (type AlertTriagePanel) is not allowed in slot 'headerExtra'

    说得通：模型现在真在用大量特定场景件，而这些件的槽位约束比泛用件紧。病从
    "够不到对的区块"变成了"拿对了区块放错位置"——后者确定性可修。

    ## 为什么是「挪」而不是「摘」

    跟 pageBindings.workflowRef 那次相反。那个字段可选、缺省语义明确，所以摘掉
    一句写错的话是安全的。这里不行：客户端
    AppRuntimeScreen.tsx 里 `main: regionSource?.main ?? (page.layout ? [] : …)`
    ——**声明了 layout 时，没进任何槽位的区块压根不渲染**。摘掉 ref 等于把这个
    区块从页面上抹掉，而它恰恰是窄化辛苦捞进来的那种对题件。

    ## 挪到哪：用目录自己声明的顺序，不是我猜的

    `allowedRegions` 是**有序**的，而且顺序是authored 的——
    MuteTimingSchedule 是 (main, aside, supplement)，ActivityFeed 是
    (aside, main, supplement)。第一个就是这个区块的首选位置。所以取
    `allowedRegions[0]`（且它必须也在合法槽位表里）。

    这跟本文件既有的处方是同一条哲学（见 _repair_binding_field_types 里引的
    AJV coerceTypes）：只沿一张**显式枚举**的表转换，表外的不猜。这里那张表就是
    allowedRegions，"不猜"体现在——类型不认识、或 allowedRegions 为空时原样留给门。
    """
    page = _as_dict(model.get("page"))
    pages = _as_list(page.get("pages"))
    if not pages:
        return {}

    from .schema_legal import (
        EXPERIENCE_BLOCK_ALLOWED_REGIONS,
        EXPERIENCE_BLOCK_ALLOWED_REGIONS_BY_TYPE,
    )

    legal_slots = set(EXPERIENCE_BLOCK_ALLOWED_REGIONS)
    moved: List[Dict[str, Any]] = []
    dropped_panels: List[Dict[str, Any]] = []
    new_pages: List[Any] = []
    changed = False

    for raw_page in pages:
        pd = _as_dict(raw_page)
        layout = pd.get("layout")
        if not isinstance(layout, dict) or not layout:
            new_pages.append(raw_page)
            continue

        types_by_id = {
            str(_as_dict(b).get("id") or "").strip(): str(_as_dict(b).get("type") or "").strip()
            for b in _as_list(pd.get("blocks"))
        }
        page_id = str(pd.get("id") or "<unnamed>")

        # 同页的 stats/charts/rankings/feeds 的 id。它们**不是区块**，但槽位名
        # 恰好叫 metrics / charts，所以模型会往里塞——见下面 _panel_ids 的用法。
        panel_ids = {
            str(_as_dict(x).get("id") or "").strip()
            for key in ("stats", "charts", "rankings", "feeds")
            for x in _as_list(pd.get(key))
        } - {""}

        # 先算出每个槽位要保留哪些、以及谁要搬到哪去
        keep: Dict[str, List[str]] = {}
        pending: List[tuple] = []  # (target_slot, block_id)
        for slot_key, refs in layout.items():
            if not isinstance(refs, list):
                keep[str(slot_key)] = refs  # 形状不对（含 slots 嵌套）交给门
                continue
            kept: List[str] = []
            for ref in refs:
                rid = str(ref or "").strip()
                btype = types_by_id.get(rid)
                allowed = EXPERIENCE_BLOCK_ALLOWED_REGIONS_BY_TYPE.get(btype or "")
                if rid and not btype and rid in panel_ids:
                    # ── 槽位名撞车：metrics/charts 槽 vs page.stats/page.charts ──
                    #
                    # 2026-08-10 两趟独立出现、形态一模一样（都是 monitor 页）：
                    #     slot=metrics ← 三个 page.stats 的 id
                    #     slot=charts  ← 两个 page.charts 的 id
                    # 槽位名就叫 metrics/charts，模型的读法**完全合乎字面**，这是
                    # 命名撞车不是马虎。但门要求 layout 的 ref 只能是 page.blocks 的
                    # id，于是整份模型被拒、走一轮重生成。
                    #
                    # 摘掉是**严格安全**的：总览页的 stats/charts 归 freeformOverview
                    # 那条通道渲染（AppRuntimeScreen「总览页归 freeformOverview…设计树
                    # 就是这一页的全部内容」，stats 另有 schema.home.stats 渲染路径），
                    # layout 槽位压根不参与。也就是说**运行时本来就忽略这些 ref，
                    # 只有门在硬拦**——摘掉它一点内容都不丢。
                    #
                    # 纪律：只摘**已证实是 stats/charts/rankings/feeds 的 id**。纯粹
                    # 认不出来的 ref（拼错、凭空造）不碰，门有 DANGLING 判据管它。
                    dropped_panels.append({"pageId": page_id, "slot": str(slot_key), "ref": rid})
                    continue
                if not rid or not btype or not allowed:
                    kept.append(ref)  # 悬空 ref / 不认识的类型 → 门去管
                    continue
                if str(slot_key) in allowed:
                    kept.append(ref)
                    continue
                target = next((r for r in allowed if r in legal_slots), None)
                if target is None:
                    kept.append(ref)  # 声明的槽位一个都不合法 → 门去管
                    continue
                pending.append((target, rid))
                moved.append(
                    {
                        "pageId": page_id,
                        "blockId": rid,
                        "type": btype,
                        "from": str(slot_key),
                        "to": target,
                    }
                )
                changed = True
            keep[str(slot_key)] = kept

        if not changed and not pending and not dropped_panels:
            new_pages.append(raw_page)
            continue

        for target, rid in pending:
            bucket = keep.get(target)
            if not isinstance(bucket, list):
                bucket = []
                keep[target] = bucket
            if rid not in bucket:
                bucket.append(rid)

        new_page = dict(pd)
        new_page["layout"] = keep
        new_pages.append(new_page)

    if not moved and not dropped_panels:
        return {}
    new_page_section = dict(page)
    new_page_section["pages"] = new_pages
    model["page"] = new_page_section
    out: Dict[str, Any] = {}
    if moved:
        out["moved"] = moved
    if dropped_panels:
        out["droppedPanelRefs"] = dropped_panels
    return out


def _observe_page_kind_violations(model: Dict[str, Any]) -> List[Dict[str, str]]:
    """**只观测，不改模型**：区块被摆在了目录不允许的页型上。

    ## 为什么先观测

    目录里每个区块都声明了 `pageKinds`（这种区块适合放在哪几种页上），而生成
    路径上从来没人查过它——提示词不说（2026-08-11 才补上 `pages=`）、结构闸不查。
    第一份线上真骨架收割时照出来：告警值班那趟 15 个区块里有 2 个越界。

    但**这条约束本身经不起推敲**，所以这一轮不上闸只留痕：

        AlertSilenceForm    capability=form        pages=monitor,dashboard,workbench
        AlertRuleEditor     capability=form        pages=monitor,dashboard      ← 同族同能力，规则相反
        AlertRoutingPolicy  capability=entityRows  pages=monitor,dashboard

    而「路由策略管理页」天然就是个工作台。全目录 304/358 都允许 workbench，
    这几个被卡住更像是随手标窄，不像有依据。拿一条可能标错的规则去硬拒模型，
    是把"违规发出去"换成"合规的也发不出去"。

    先把提示词补上（模型此前根本不知道有这条），再攒几趟真实数据，然后才谈
    是收紧模型还是放宽目录。这条留痕就是攒证据的地方。

    与 `_repair_layout_slot_violations` 的区别：那条改模型（把区块挪回合法槽位），
    因为槽位摆错会真的把页面搞坏（PageHeader 钉在底部操作条上是实测过的）；
    页型摆错**不影响渲染**，所以不该由修复器擅自动手。
    """
    from .schema_legal import EXPERIENCE_BLOCK_PAGE_KINDS_BY_TYPE

    notes: List[Dict[str, str]] = []
    for page in _as_list(_as_dict(model.get("page")).get("pages")):
        pd = _as_dict(page)
        kind = str(pd.get("kind") or "").strip()
        page_id = str(pd.get("id") or "").strip() or "<unnamed>"
        for block in _as_list(pd.get("blocks")):
            bd = _as_dict(block)
            btype = str(bd.get("type") or "").strip()
            allowed = EXPERIENCE_BLOCK_PAGE_KINDS_BY_TYPE.get(btype)
            if not btype or not kind or not allowed or kind in allowed:
                continue
            notes.append({
                "pageId": page_id,
                "pageKind": kind,
                "blockId": str(bd.get("id") or "").strip(),
                "blockType": btype,
                "allowed": ",".join(allowed),
            })
    if notes:
        # no silent observation：留痕不打印等于没留——这条链路上没人会去翻
        # repair 的返回值。同 freeform 的 "enrich budget hit" 那条纪律。
        print(
            f"[v5_model_repair] 页型越界 {len(notes)} 处（只记不改，见 pageKinds 声明）："
            + "；".join(
                f"{n['pageId']}({n['pageKind']}) ← {n['blockType']}[只允许 {n['allowed']}]"
                for n in notes[:3]
            ),
            flush=True,
        )
    return notes


def repair_five_system_model(model: Dict[str, Any]) -> Dict[str, Any]:
    """返回 {"model": 修复后的深拷贝, "repaired": [...], "dropped": [...],
    "presentation": {...}}。

    动两层：appbundle.invariants（refs 近邻修复，修不好的整条剔除）与
    page.charts/stats 与 landingPageRef 展示层声明（E37 同款处方）。都没内容时原样返回
    （老模型零变化）。纯函数。
    """
    m = copy.deepcopy(_as_dict(model))

    presentation = _repair_presentation_layer(m)
    if any(presentation.values()):
        appbundle_p = dict(_as_dict(m.get("appbundle")))
        appbundle_p["presentationNotes"] = {k: v for k, v in presentation.items() if v}
        m["appbundle"] = appbundle_p

    # ⚠️ 必须排在下面 invariants 的提前 return **之前**：没有 invariants 的模型
    #    照样会写错 pageBindings.workflowRef（实测那几趟正是这样），排在后面等于
    #    这条修复对它们永不生效。
    page_workflow_notes = _repair_page_workflow_refs(m)
    layout_slot_notes = _repair_layout_slot_violations(m)
    # 只观测不改（见函数头注：这条约束本身还没核实，先攒证据）。
    page_kind_notes = _observe_page_kind_violations(m)

    appbundle = _as_dict(m.get("appbundle"))
    invariants = _as_list(appbundle.get("invariants"))
    if not invariants:
        return {
            "model": m,
            "repaired": [],
            "dropped": [],
            "presentation": presentation,
            "pageWorkflowRefs": page_workflow_notes,
            "layoutSlots": layout_slot_notes,
            "pageKindViolations": page_kind_notes,
        }

    # 合法解析域与门禁第 7 节共享同一函数（曾因两边各自维护导致奇偶不齐：
    # 修复器认 AIGC 能力 id、门禁不认 → 合法不变式被误拦）
    known = collect_invariant_ref_ids(m)
    repaired: List[Dict[str, Any]] = []
    dropped: List[Dict[str, Any]] = []
    kept: List[Any] = []

    for inv in invariants:
        iv = _as_dict(inv)
        iid = str(iv.get("id") or iv.get("statement") or "").strip()[:60] or "<unnamed>"
        refs = [str(r).strip() for r in _as_list(iv.get("refs")) if str(r).strip()]
        new_refs: List[str] = []
        unresolved: List[str] = []
        for ref in refs:
            if ref in known:
                new_refs.append(ref)
                continue
            fixed = _unique_near_match(ref, known)
            if fixed is not None:
                new_refs.append(fixed)
                repaired.append({"invariantId": iid, "from": ref, "to": fixed})
            else:
                unresolved.append(ref)
        if not refs or unresolved:
            # 无 refs 的口号式不变式、或修不好的引用 → 整条剔除（留痕，不展示坏引用）
            dropped.append({
                "invariantId": iid,
                "statement": str(iv.get("statement") or "")[:120],
                "unresolvedRefs": unresolved,
            })
            continue
        fixed_inv = dict(iv)
        fixed_inv["refs"] = new_refs
        kept.append(fixed_inv)

    appbundle = dict(appbundle)
    appbundle["invariants"] = kept
    if repaired or dropped:
        appbundle["invariantNotes"] = {"repaired": repaired, "dropped": dropped}
    m["appbundle"] = appbundle
    return {
        "model": m,
        "repaired": repaired,
        "dropped": dropped,
        "presentation": presentation,
        "pageWorkflowRefs": page_workflow_notes,
        "layoutSlots": layout_slot_notes,
        "pageKindViolations": page_kind_notes,
    }
