"""builtin_examples — 官方示例库的数据源（E41）。

示例 = 过门冻结模型（builtin_domain_models.json）的提炼投影：产品身份 +
真实指标（页面/角色/AI 能力数 = 模型里数出来的，不发明）+ 起手意图
（点卡即预填的话题原文）。

北极星纪律：示例永远来自过门冻结模型——没有过门模型就没有示例卡，
数量如实（有几个摆几个，不摆假货架）。

⚑ 2026-08-14 数据清空（用户裁决：「只是清数据，不是删除这个功能」）：
  原四条示例（采购审批/请假审批/服务工单/员工入职）诞生于老区块链路，
  spec-first 成为默认链路后不再代表现在的生成效果，从货架撤下。
  功能骨架（本模块 + GET /builtin-examples + 前端示例 tab）原样保留，
  等新链路产出可展示的示例后往 _EXAMPLE_META 里加条目即可重新上架。
  冻结模型本体（builtin_domain_models.json）未动——域识别近路与
  组件库还在用。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

_MODELS_PATH = Path(__file__).resolve().parent / "data" / "builtin_domain_models.json"

# 起手意图与场景分类（点「使用模板」预填的话题原文；分类按域如实标注）。
# 当前为空 = 货架如实空着（见模块 docstring 的清空说明）。上架格式：
#   "<domain>": {"intent": "<预填话题原文>", "category": "<场景分类>"}
# 其中 <domain> 必须是 builtin_domain_models.json 里存在的键。
_EXAMPLE_META: Dict[str, Dict[str, str]] = {}

_cache: Optional[List[Dict[str, Any]]] = None


def list_builtin_examples() -> List[Dict[str, Any]]:
    """示例摘要列表（缓存；夹具缺失返回空列表——没有真模型就没有示例）。"""
    global _cache
    if _cache is not None:
        return _cache
    try:
        models = json.loads(_MODELS_PATH.read_text(encoding="utf-8"))
    except Exception:
        _cache = []
        return _cache
    out: List[Dict[str, Any]] = []
    for domain, meta in _EXAMPLE_META.items():
        model = models.get(domain)
        if not isinstance(model, dict):
            continue  # 夹具缺失 → 该示例如实不出现
        identity = (model.get("appbundle") or {}).get("appIdentity") or {}
        pages = (model.get("page") or {}).get("pages") or []
        roles = (model.get("rbac") or {}).get("roles") or []
        caps = (model.get("aigc") or {}).get("capabilities") or []
        out.append({
            "domain": domain,
            "productName": identity.get("productName") or domain,
            "theme": identity.get("theme") or "azure",
            "icon": identity.get("icon") or "boxes",
            "nav": identity.get("nav") or "side",
            "intent": meta["intent"],
            "category": meta["category"],
            "pages": len(pages),
            "roles": len(roles),
            "aiCapabilities": len(caps),
            # 能力标签 = 真实页面名前三（模型里真有的，不编营销词）
            "tags": [
                str(p.get("name") or p.get("id") or "").strip()
                for p in pages[:3]
                if str(p.get("name") or p.get("id") or "").strip()
            ],
        })
    _cache = out
    return _cache
