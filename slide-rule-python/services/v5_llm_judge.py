"""v5_llm_judge — 五系统模型内容质量的 LLM-as-judge 评分（路线 3 · D2）。

确定性启发式（v5_content_quality）管"硬伤"；本模块管三个只有语义理解
才能判的维度，固定量表 1-5 分 + 逐条理由：

  requirement_coverage — 需求覆盖度：意图里明确要求的能力是否都被建模
  domain_sense         — 行业常识：流程/实体/角色是否符合该行业的常规做法
  naming_quality       — 命名质量：命名是否领域特定（而非 generic 模板腔）

诚实边界与噪音控制：
- temperature 0、固定量表锚点；同模型判自己产出存在自恋偏差——分数用于
  **对基线的回归比对**（跌了才报警），不做绝对分数线。
- 每个维度必须给 reasons（judge 的论据），报告原样展示供人工抽查核对；
  requirement_coverage 还必须列 missed（漏建模的明确要求，可为空）。
- LLM 失败/返回不合形状 → 返回 None（fail-closed，报告如实标注"评审失败"，
  绝不编分数）。

纯逻辑 + 可注入 llm_json_fn，便于单测（默认走 sliderule_llm 真通道）。
"""

from __future__ import annotations

import json
from typing import Any, Callable, Dict, List, Optional

from sliderule_llm.config import default_max_tokens

DIMENSIONS = ("requirement_coverage", "domain_sense", "naming_quality")

_JUDGE_INSTRUCTION = """\
You are a strict enterprise-software design reviewer. You will receive a
business intent and a five-system model (entities/roles/permissions/workflow/
pages/AI capabilities) generated for it. Score THREE dimensions on a 1-5 scale.

Anchors (apply to every dimension):
  5 = a seasoned domain architect would ship this design as-is
  4 = solid; minor gaps a reviewer would note but not block on
  3 = usable skeleton; visible gaps that need one revision round
  2 = major gaps; misses core asks or contradicts industry practice
  1 = template-grade output with little relation to the intent

Dimensions:
- requirement_coverage: does the model implement every capability the intent
  EXPLICITLY asks for? List each missed ask in "missed" (empty list if none).
- domain_sense: do the workflow steps, entities and role division match how
  this industry actually operates? Note oddities in "reasons".
- naming_quality: are ids/names domain-specific and consistent (vs generic
  filler like "data_item", "process_step", "manager")?

Output ONLY valid JSON (no prose, no fences), exactly this shape:
{
  "requirement_coverage": {"score": <1-5>, "reasons": ["..."], "missed": ["..."]},
  "domain_sense": {"score": <1-5>, "reasons": ["..."]},
  "naming_quality": {"score": <1-5>, "reasons": ["..."]}
}
Reasons must be concrete (quote the offending/supporting names), in Chinese,
max 3 per dimension.
"""


def _digest_model(model: Dict[str, Any], limit_fields: int = 4) -> str:
    """压缩模型为 judge 可读的结构摘要（控制 token：字段每实体只带前几个）。"""

    def _l(v: Any) -> List[Any]:
        return v if isinstance(v, list) else []

    def _d(v: Any) -> Dict[str, Any]:
        return v if isinstance(v, dict) else {}

    m = _d(model)
    out: Dict[str, Any] = {}
    out["entities"] = [
        {
            "id": _d(e).get("id"),
            "name": _d(e).get("name"),
            "fields": [
                f"{_d(f).get('id')}({_d(f).get('type')})" for f in _l(_d(e).get("fields"))[:limit_fields]
            ]
            + (["…"] if len(_l(_d(e).get("fields"))) > limit_fields else []),
        }
        for e in _l(_d(m.get("datamodel")).get("entities"))
    ]
    rbac = _d(m.get("rbac"))
    # "id:显示名"，与下面 workflow 节点同款写法。直接透传会把 dict 打进
    # 评审提示词，评委看到的是 JSON 噪音而不是"这个角色是干什么的"。
    from .rbac_roles import role_entries

    out["roles"] = [
        r["id"] if r["label"] == r["id"] else f"{r['id']}:{r['label']}"
        for r in role_entries(rbac)
    ]
    out["permissions"] = _l(rbac.get("permissions"))
    wf = _d(m.get("workflow"))
    out["workflow"] = {
        "nodes": [f"{_d(n).get('id')}:{_d(n).get('name')}@{_d(n).get('assigneeRole')}" for n in _l(wf.get("nodes"))],
        "transitions": [
            f"{_d(t).get('from')}->{_d(t).get('to')}[{_d(t).get('condition') or ''}]" for t in _l(wf.get("transitions"))
        ],
    }
    out["pages"] = [
        {"id": _d(p).get("id"), "name": _d(p).get("name"), "actions": _l(p.get("actionPermissions"))}
        for p in _l(_d(m.get("page")).get("pages"))
    ]
    out["aigc"] = [f"{_d(c).get('id')}:{_d(c).get('name')}" for c in _l(_d(m.get("aigc")).get("capabilities"))]
    return json.dumps(out, ensure_ascii=False)


def _clamp_score(v: Any) -> Optional[int]:
    try:
        n = int(v)
    except (TypeError, ValueError):
        return None
    return n if 1 <= n <= 5 else None


def _str_list(v: Any, cap: int = 3) -> List[str]:
    if not isinstance(v, list):
        return []
    return [str(x) for x in v if isinstance(x, (str, int, float))][:cap]


def _parse_judge_response(raw: Any) -> Optional[Dict[str, Any]]:
    """解析 judge 响应；任何维度缺失/越界即整体返回 None（不编分）。"""
    if not isinstance(raw, dict):
        return None
    dims: Dict[str, Dict[str, Any]] = {}
    for dim in DIMENSIONS:
        section = raw.get(dim)
        if not isinstance(section, dict):
            return None  # 缺维度即整体 fail-closed，不编分
        score = _clamp_score(section.get("score"))
        if score is None:
            return None
        entry: Dict[str, Any] = {"score": score, "reasons": _str_list(section.get("reasons"))}
        if dim == "requirement_coverage":
            entry["missed"] = _str_list(section.get("missed"), cap=6)
        dims[dim] = entry
    avg = round(sum(d["score"] for d in dims.values()) / len(dims), 2)
    return {"dims": dims, "avg": avg}


def judge_content_quality(
    model: Dict[str, Any],
    intent: str,
    llm_json_fn: Optional[Callable[..., Any]] = None,
    attempts: int = 2,
) -> Optional[Dict[str, Any]]:
    """三维量表评分。返回 {dims: {dim: {score, reasons, missed?}}, avg}；失败返回 None。

    瞬时错误（空响应/限流/坏形状）重试至多 attempts 次——与生成路径的
    attempt 1/2 对齐；重试后仍失败才 fail-closed。
    """
    if llm_json_fn is None:
        from sliderule_llm.client import call_llm_json

        def llm_json_fn(messages: List[Dict[str, str]]) -> Dict[str, Any]:  # type: ignore[misc]
            parsed, _result = call_llm_json(messages, temperature=0.0, max_tokens=default_max_tokens())
            return parsed

    messages = [
        {"role": "system", "content": _JUDGE_INSTRUCTION},
        {
            "role": "user",
            "content": f"业务意图：{intent}\n\n五系统模型摘要（JSON）：\n{_digest_model(model)}",
        },
    ]
    for _ in range(max(1, attempts)):
        try:
            raw = llm_json_fn(messages)
        except Exception:
            continue
        parsed = _parse_judge_response(raw)
        if parsed is not None:
            return parsed
    return None
