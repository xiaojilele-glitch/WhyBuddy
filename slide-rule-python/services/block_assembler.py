"""按需组装：让大模型现场从区块目录里挑积木、排槽位、绑字段，拼出一页。

## 这个模块解决什么

2026-08-07 用户的原话：「顶部有个按钮……你点了之后，AI 大模型会自动给你组队，
按需组团，从不同的组件进行拼装，出来一个完整的页面，里面既有 filter 筛选、
还有表格、还有新增表单……点了之后就真的可以进行录入数据了。」

在这之前我做的是**静态预设**——10 套手写在 JSON 里的固定组合。那是错的形状：
组合是死的，每次都一样，而且没经过任何"这套到底能不能用"的检验（实测里三套
工作台预设推荐的 DataTable 会被渲染层直接丢掉，因为它绑的是本页主实体）。

**括号里那条 2026-08-08 已经不成立了**：三步走的第②步把默认翻过来——声明了
blocks 的页面由积木画、内置表格不再渲染，那个 DataTable 现在是这一页唯一的表，
渲染层不再摘它。留着这段是因为它记录了"静态预设为什么是错的形状"，那个判断
仍然成立；只是它举的那个例子已经被修好了。

这里换成**现场组装**：目录是活的（组件库显示什么，模型就从什么里面挑），
组装结果是一份自洽的页面规格，前端拿它挂真渲染器 + 真运行时状态，能真录数据。

## 为什么组装完还要自己再验一遍

模型会犯三类错，而且都不会自己报错：

  ① 挑了目录里没有的积木类型（幻觉）
  ② 把积木放进它不允许的槽位（按语义直觉猜，实测最稳定的一类错）
  ③ 绑了数据模型里不存在的实体或字段

这三类在真实推演里由 v5_model_gate 拦。这条路径不走完整推演，所以在这里
按同一份账本（schema_legal 的 allowedRegions / bindingSchema）复验一遍——
**不合格的积木直接剔除，而不是整页失败**：拼出 3 个积木里有 1 个不合格时，
把那 1 个丢掉仍然是一个能用的页面，整页报错则什么都没有。

剔除必须**如实告诉调用方**（dropped 里带原因），否则就是静默降级：用户以为
模型只拼了 2 个，实际是拼了 3 个被我们吃掉 1 个。
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Tuple

from services import schema_legal as L

#: 一页最多几个积木。上限不是性能考虑，是版面：桌面网格 12 列，超过 5 个
#: 积木必然有人被挤进 4/12 窄列或者掉到第三屏，那时"拼得合理"就无从谈起。
MAX_BLOCKS = 5


def _catalog_for_prompt(page_kind: str, allowed_types: List[str]) -> List[Dict[str, Any]]:
    """把可选积木压成给模型看的最小面：类型 + 干什么 + 能放哪 + 要绑什么。

    只给这一页真正可选的（页面形态过滤 + 调用方传来的可见集合求交），
    模型就不必先自己排除一遍——**能选的都摆出来，不能选的一个都不摆**。
    """
    out: List[Dict[str, Any]] = []
    for b in L.EXPERIENCE_BLOCKS:
        t = str(b["type"])
        if not b.get("generationEnabled"):
            continue
        if page_kind not in b.get("pageKinds", []):
            continue
        if allowed_types and t not in allowed_types:
            continue
        bs = b.get("bindingSchema") or {}
        out.append({
            "type": t,
            "does": b.get("description", ""),
            "regions": list(b.get("allowedRegions", [])),
            "bindingRequired": list(bs.get("required", [])),
            "bindingOptional": list(bs.get("optional", [])),
            "props": sorted((b.get("propsSchema") or {}).get("properties", {})),
        })
    return out


def _prompt(page_kind: str, catalog: List[Dict[str, Any]], datamodel: Dict[str, Any]) -> List[Dict[str, str]]:
    entities = datamodel.get("entities") or []
    entity_lines = []
    for e in entities:
        fields = ", ".join(
            f"{f.get('id')}({f.get('type')})" for f in (e.get("fields") or [])
        )
        entity_lines.append(f"- {e.get('id')}: {fields}")

    system = (
        "You assemble ONE working business page out of a closed set of UI blocks. "
        "You are not designing new components — every block already exists and renders. "
        "Your job is picking which ones this page needs, where each goes, and what data "
        "each is bound to."
    )
    user = (
        f"PAGE KIND: {page_kind}\n\n"
        f"DATA MODEL (the only entities and fields that exist):\n"
        + "\n".join(entity_lines)
        + "\n\nAVAILABLE BLOCKS:\n"
        + json.dumps(catalog, ensure_ascii=False, indent=1)
        + "\n\nSLOT WIDTHS (this is the only physical difference between slots):\n"
        "  summary  — full width strip at the top, for scanning; too short for a table or a form\n"
        "  primary  — full width main area\n"
        "  secondary / activity / content — the narrow right column (4 of 12)\n"
        "A table, a form, or a horizontal step bar in the narrow column is unusable. "
        "Put those in primary.\n\n"
        "RULES\n"
        f"1. Between 2 and {MAX_BLOCKS} blocks. A page with one block is not a page; "
        "more than that and they start squeezing each other.\n"
        "2. Every block type MUST come from AVAILABLE BLOCKS, every region from that "
        "block's own 'slots' list.\n"
        "3. Every entityRef MUST be an entity id above; every field ref MUST be a field "
        "of THAT entity. Never invent one.\n"
        "4. Give each block a Chinese props.title that says what it is FOR in this "
        "business — not the block's type name.\n"
        "5. Compose something a real user could work in: usually a way to narrow down, "
        "a way to see the records, and a way to add one.\n"
        "6. Blocks are NOT wrapped in a card for you. Each one renders as exactly what it "
        "is — its own title and actions come with the block, not with a frame around it. "
        "If — and only if — two or three blocks belong to the same thing and should read "
        "as one panel, add a ContentCard and list their ids in its \"children\". "
        "Wrapping everything in cards is worse than wrapping nothing: it buries the page "
        "in boxes. Most pages need no ContentCard at all.\n"
        "7. props.surface controls whether a block paints its own white panel. Leave it "
        "out (default \"card\") for a block standing on its own. Set \"plain\" for a "
        "block you put INSIDE a ContentCard — the card already provides the surface, and "
        "a panel inside a panel reads as a mistake.\n\n"
        "Also say which industry this page belongs to (\"industry\"), in Chinese, "
        "2-6 characters — 餐饮 / 医疗 / 物流 / 零售 / 教育 / 制造 / 政务 / 金融 / "
        "人力 / 通用 and the like. Judge it from what the page actually does, not from "
        "the entity names alone. Use 通用 only when it genuinely fits every industry; "
        "an over-used 通用 makes the whole library unbrowsable.\n\n"
        "Return JSON only. Give every block an \"id\" so a container can refer to it:\n"
        '{"name":"<页面中文名>","industry":"<行业>","blocks":['
        '{"id":"b1","type":"...","region":"...","props":{"title":"..."},'
        '"binding":{"entityRef":"...","fieldRefs":["..."]}},'
        '{"id":"b2","type":"ContentCard","region":"aside",'
        '"props":{"title":"..."},"children":["b3"]}]}'
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def _validate(
    page_kind: str, raw_blocks: Any, datamodel: Dict[str, Any]
) -> Tuple[List[Dict[str, Any]], List[Dict[str, str]]]:
    """按同一份账本复验，逐个剔除不合格的，并如实记下原因。"""
    by_type = {str(b["type"]): b for b in L.EXPERIENCE_BLOCKS}
    entities = {
        str(e.get("id")): {str(f.get("id")) for f in (e.get("fields") or [])}
        for e in (datamodel.get("entities") or [])
    }
    kept: List[Dict[str, Any]] = []
    dropped: List[Dict[str, str]] = []

    for i, raw in enumerate(raw_blocks if isinstance(raw_blocks, list) else []):
        if not isinstance(raw, dict):
            dropped.append({"block": f"#{i}", "why": "不是对象"})
            continue
        t = str(raw.get("type") or "").strip()
        region = str(raw.get("region") or "").strip()
        entry = by_type.get(t)
        if entry is None or not entry.get("generationEnabled"):
            dropped.append({"block": t or f"#{i}", "why": "不在目录里（模型编的）"})
            continue
        if page_kind not in entry.get("pageKinds", []):
            dropped.append({"block": t, "why": f"这种积木不能放在 {page_kind} 页"})
            continue
        if region not in entry.get("allowedRegions", []):
            dropped.append({"block": t, "why": f"区域 {region or '(空)'} 不在它的允许列表里"})
            continue

        binding = raw.get("binding") if isinstance(raw.get("binding"), dict) else {}
        bs = entry.get("bindingSchema") or {}
        needs_binding = bool(bs.get("required")) or bool(bs.get("optional"))
        if not needs_binding:
            binding = {}
        else:
            ref = str(binding.get("entityRef") or "").strip()
            if "entityRef" in bs.get("required", []) and ref not in entities:
                dropped.append({"block": t, "why": f"绑了不存在的实体 {ref or '(空)'}"})
                continue
            # 字段引用逐个核，**留下核得过的，而不是整个丢掉**：模型多写一个
            # 字段名不该让这个积木整个消失。
            fields = binding.get("fieldRefs")
            if isinstance(fields, list):
                legal = entities.get(ref, set())
                good = [str(f) for f in fields if str(f) in legal]
                if good:
                    binding = {**binding, "fieldRefs": good}
                else:
                    binding = {k: v for k, v in binding.items() if k != "fieldRefs"}

        props = raw.get("props") if isinstance(raw.get("props"), dict) else {}
        allowed_props = set((entry.get("propsSchema") or {}).get("properties", {}))
        props = {k: v for k, v in props.items() if k in allowed_props}

        # children **只有容器能有**。这不是洁癖：渲染侧多数积木把 children
        # 当成"遗留适配内容"直接原样返回（block-registry 里每个渲染器开头那句
        # `if (children != null) return <>{children}</>`），所以给 DataTable
        # 塞 children 会让它变成一个只显示别人、自己什么都不画的空壳——
        # 页面上看着像那个表格坏了。模型确实会这么写，所以在这里剥掉。
        raw_children = [str(c) for c in (raw.get("children") or []) if isinstance(c, str)]
        if raw_children and not entry.get("container"):
            dropped.append({
                "block": t,
                "why": "只有容器类积木能装 children，已剥掉",
            })
            raw_children = []

        kept.append({
            "id": str(raw.get("id") or f"b{i + 1}"),
            "type": t,
            "region": region,
            "props": props,
            "binding": binding,
            "children": raw_children,
        })

    # children 只能指向**同一批里真实留下来的** id：模型可能引用一个被剔除的
    # 积木，或者干脆编一个 id。悬空引用留着会让容器渲染成空卡片，而空卡片
    # 看起来像"这里本来该有东西但坏了"——比不放这个容器更糟。
    kept_ids = {b["id"] for b in kept}
    for b in kept:
        bad = [c for c in b["children"] if c not in kept_ids or c == b["id"]]
        if bad:
            dropped.append({
                "block": b["type"],
                "why": f"容器引用了不存在的积木 {bad}，已断开",
            })
            b["children"] = [c for c in b["children"] if c in kept_ids and c != b["id"]]

    # 被装进容器的积木不再单独占槽位——否则同一个积木会出现两次（一次在
    # 容器里，一次在网格上）。
    nested = {c for b in kept for c in b["children"]}
    for b in kept:
        if b["id"] in nested:
            b["nested"] = True
            # 装进容器的积木一律 plain：容器已经提供了表面，里面再来一层白底
            # 就是卡里套卡。模型经常忘了写，这里直接兜住——**不是覆盖它的选择**，
            # 而是这个位置根本没有第二种合理选择。
            if b["props"].get("surface") != "plain":
                b["props"]["surface"] = "plain"
    return kept, dropped


def assemble_page(
    page_kind: str,
    allowed_types: List[str],
    datamodel: Dict[str, Any],
) -> Dict[str, Any]:
    """现场组装一页。返回 {ok, name, blocks, dropped, error}。

    失败不伪造：模型挂了或一个积木都没留下，就如实报 ok=False 加原因——
    造一个假页面出来比报错更糟，用户会以为这就是模型的水平。
    """
    from sliderule_llm.client import LlmError, call_llm_json_with_shape

    catalog = _catalog_for_prompt(page_kind, allowed_types)
    if not catalog:
        return {"ok": False, "error": f"{page_kind} 页没有可用的积木"}

    try:
        parsed, _ = call_llm_json_with_shape(
            _prompt(page_kind, catalog, datamodel),
            required_keys=("blocks",),
            max_shape_retries=1,
        )
    except LlmError as exc:
        return {"ok": False, "error": f"模型没能给出可用的组装：{str(exc)[:160]}"}
    except Exception as exc:  # noqa: BLE001 — 组装失败不该把这条路由打成 500
        return {"ok": False, "error": f"组装失败：{str(exc)[:160]}"}

    kept, dropped = _validate(page_kind, parsed.get("blocks"), datamodel)
    if not kept:
        return {
            "ok": False,
            "error": "模型给出的积木一个都没通过校验",
            "dropped": dropped,
        }
    # 行业收窄到一小串：模型偶尔会写成一整句话（"适用于餐饮连锁门店管理"），
    # 那样每次都是一个新"行业"，筛选就废了。截断 + 兜底成"通用"。
    industry = str(parsed.get("industry") or "").strip()[:12] or "通用"
    return {
        "ok": True,
        "name": str(parsed.get("name") or "").strip() or "组装页面",
        "industry": industry,
        "blocks": kept[:MAX_BLOCKS],
        "dropped": dropped,
    }


# ── 基础组件的组装（2026-08-08）──────────────────────────────────────
#
# 与上面那条路径的**根本区别**：业务积木有 bindingSchema，能绑到实体和字段，
# 所以组装出来的页面是真能录数据的；基础组件没有——它们是 antd / antd-mobile
# 的官方通用示例，render 是一段写死的 demo，不接受外部数据。
#
# 所以这条路径抽出来的是**结构**：哪些组件、按什么顺序、分几栏。内容仍是各
# 组件自带的示例内容。这一点必须对调用方说清楚，不能让人以为抽出来就是一个
# 能用的页面。
#
# 用户要的"配上模拟的行业数据"要再往前一步：得先让基础组件的 render 接受
# props。那是另一件事，见本函数末尾的说明。

BASE_MAX = 6


def _base_prompt(
    industry_hint: str, components: List[Dict[str, Any]]
) -> List[Dict[str, str]]:
    lines = [
        f"- {c.get('name')} ({c.get('label')}, {c.get('group')}): {c.get('description')}"
        for c in components
    ]
    system = (
        "You lay out ONE screen by picking from a closed set of UI components. "
        "Every component already exists and renders — you are choosing which ones this "
        "screen needs and in what order, not designing new ones."
    )
    user = (
        "AVAILABLE COMPONENTS:\n"
        + "\n".join(lines)
        + "\n\nRULES\n"
        f"1. Pick between 3 and {BASE_MAX} components that together form a screen a real "
        "user could work in — typically: a way to navigate or filter, the main content, "
        "and a way to act.\n"
        "2. Do NOT mix platforms. Components whose name starts with 'M.' are mobile; "
        "the rest are desktop. Pick one platform and stay in it — a desktop Table next to "
        "a mobile TabBar is not a screen, it is a pile.\n"
        "3. Order matters: list them top to bottom as they should appear.\n"
        "4. width: \"full\" for the main content and anything wide (tables, forms, "
        "navigation bars); \"half\" for things that read fine at half width.\n"
        "5. Say which industry this screen suits (\"industry\"), Chinese, 2-6 characters. "
        "Judge it from the combination you picked, not from the component names."
        + (f" A hint from the caller: {industry_hint}." if industry_hint else "")
        + "\n\nReturn JSON only:\n"
        '{"name":"<页面中文名>","industry":"<行业>","platform":"pc|mobile",'
        '"components":[{"name":"...","width":"full|half"}]}'
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def assemble_base_screen(
    components: List[Dict[str, Any]], industry_hint: str = ""
) -> Dict[str, Any]:
    """从基础组件里抽一屏。

    校验跟业务积木那条一样是**逐个剔除、如实上报**：模型会挑出目录里没有的
    名字（幻觉），也会把 PC 和移动端混着挑（提示里明确禁了，仍然会犯）。
    混平台尤其要拦——一个桌面 Table 挨着一个手机 TabBar 不是一屏，是一堆。
    """
    from sliderule_llm.client import LlmError, call_llm_json_with_shape

    if not components:
        return {"ok": False, "error": "没有可用的基础组件"}

    try:
        parsed, _ = call_llm_json_with_shape(
            _base_prompt(industry_hint, components),
            required_keys=("components",),
            max_shape_retries=1,
        )
    except LlmError as exc:
        return {"ok": False, "error": f"模型没能给出可用的组装：{str(exc)[:160]}"}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"组装失败：{str(exc)[:160]}"}

    by_name = {str(c.get("name")): c for c in components}
    platform = str(parsed.get("platform") or "").strip()
    kept: List[Dict[str, Any]] = []
    dropped: List[Dict[str, str]] = []

    for i, raw in enumerate(parsed.get("components") or []):
        if not isinstance(raw, dict):
            dropped.append({"block": f"#{i}", "why": "不是对象"})
            continue
        name = str(raw.get("name") or "").strip()
        entry = by_name.get(name)
        if entry is None:
            dropped.append({"block": name or f"#{i}", "why": "不在组件库里（模型编的）"})
            continue
        # 平台一致性：以第一个留下来的为准，后面不一致的剔掉。**不按模型自己
        # 报的 platform 判**——它报的和它挑的常常对不上，挑出来的才是事实。
        p = "mobile" if name.startswith("M.") else "pc"
        if not kept:
            platform = p
        elif p != platform:
            dropped.append({"block": name, "why": f"跟这一屏的平台（{platform}）不一致"})
            continue
        width = "half" if str(raw.get("width") or "").strip() == "half" else "full"
        kept.append({"name": name, "width": width, "group": entry.get("group")})

    if not kept:
        return {"ok": False, "error": "模型挑的组件一个都没通过校验", "dropped": dropped}

    return {
        "ok": True,
        "name": str(parsed.get("name") or "").strip() or "组装页面",
        "industry": str(parsed.get("industry") or "").strip()[:12] or "通用",
        "platform": platform or "pc",
        "components": kept[:BASE_MAX],
        "dropped": dropped,
        # 如实标注这条路径的边界：抽出来的是**结构**，内容仍是各组件自带的
        # 示例内容。基础组件的 render 不接受外部数据（它就是官方 demo），
        # 要"配上模拟的行业数据"得先让 render 接受 props，那是下一步。
        "contentIsDemo": True,
    }
