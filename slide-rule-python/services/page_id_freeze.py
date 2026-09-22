"""精修轮把已有页面 id 拨回上一版（2026-08-18 过夜）。

## 事故

提示词冻结（model_id_lexicon +「照抄」硬词表）在第 2 步已经接线，日志也打
「精修 id 冻结：页面 N」。过夜 6 个话题里它**求不动**：

    物业   p1..p4  →  p1_page / p3_page / p4_page，p2 失踪
    活动室 p1..p4  →  equipment_hall / admin_dashboard / …
    快递   p1      →  p1_page  →  p1_page_workbench

id 一漂，图判「重画这一页」、照搬 reuse_pages、版本回退全对不上，而且不报错。
`精修 id 冻结` 那行照常出现——闸全绿但东西没了。

## 做法不是新发明

Reformer（RecLLM）的 identifier freezing：已分配的 item id 跨轮不变，新东西
才领新号。本仓 `v5_model_repair._unique_near_match` 已经是同一套——生成后
确定性对齐，零 LLM，歧义不猜。MCP LFID / 本仓 html_structure 第 5 条也是
「语义信号（名字）和 canonical_id 分开」。

提示词继续喂词表（模型少漂一次是赚的）。**拨回是结构闸**，不求自觉。

判断锚：精确 id → 剥后缀词干（p1_page_workbench → p1）→ 名字唯一命中。
顺序不当锚（SPEC 注释写过：顺序会变，名字不会）。

只在发生过改名/加后缀的那一轮，把对不上的旧页补回去——物业丢 p2 就是
「其余页加了 _page、这一页被当成删掉」。四页都还是原 id、少一页，当作
真删，不补（提示词允许「被迭代要求删掉的页面直接不出现」）。
"""

from __future__ import annotations

import copy
import os
import re
from typing import Any, Dict, List, Optional, Tuple


def refine_id_freeze_enabled() -> bool:
    """`SLIDERULE_REFINE_ID_FREEZE=0` 关掉提示词词表和结构拨回。默认开。

    线上回退杆和对照臂同一根：量"是不是它起的作用"必须同模型同话题跑 A/B。
    """
    from .env_flags import flag

    return flag("SLIDERULE_REFINE_ID_FREEZE", default=True)

# 过夜实测漂法：p1 → p1_page → p1_page_workbench。剥的是装饰后缀，不是
# 业务词干（reservation 不会被剥成空）。
_SUFFIX_TOKENS = frozenset({
    "page", "pages", "workbench", "dashboard", "hall", "board",
    "view", "screen", "panel", "console",
})

_PAGE_REF_KEYS = frozenset({
    "id", "pageRef", "landingPageRef", "sourcePageId", "pageId",
})


def _norm_text(value: Any) -> str:
    return re.sub(r"[\s_\-]+", "", str(value or "").lower())


def _id_stem(pid: Any) -> str:
    parts = [p for p in str(pid or "").split("_") if p]
    while len(parts) > 1 and parts[-1].lower() in _SUFFIX_TOKENS:
        parts.pop()
    return "_".join(parts) if parts else str(pid or "")


def _prev_list(prev_pages: Any) -> List[Dict[str, Any]]:
    if not isinstance(prev_pages, list):
        return []
    return [p for p in prev_pages if isinstance(p, dict) and p.get("id")]


def resolve_prev_page_id(
    page: Dict[str, Any],
    prev_pages: List[Dict[str, Any]],
    taken: set,
) -> Optional[str]:
    """这一页对应上一版哪个 id。对不上就当新页（None）。歧义不猜。"""
    nid = str(page.get("id") or "").strip()
    nname = _norm_text(page.get("name"))

    unused = [p for p in prev_pages if str(p.get("id")) not in taken]
    if not unused:
        return None

    exact = [p for p in unused if str(p.get("id")) == nid]
    if len(exact) == 1:
        return str(exact[0]["id"])

    stem = _id_stem(nid)
    if stem:
        stem_hits = [
            p for p in unused
            if str(p.get("id")) == stem or _id_stem(p.get("id")) == stem
        ]
        if len(stem_hits) == 1:
            return str(stem_hits[0]["id"])

    if nname:
        name_hits = [p for p in unused if _norm_text(p.get("name")) == nname]
        if len(name_hits) == 1:
            return str(name_hits[0]["id"])
        contained = [
            p for p in unused
            if nname in _norm_text(p.get("name")) or _norm_text(p.get("name")) in nname
        ]
        if len(contained) == 1:
            return str(contained[0]["id"])

    return None


def _rewrite_refs(node: Any, mapping: Dict[str, str]) -> Any:
    if not mapping:
        return node
    if isinstance(node, dict):
        out = {}
        for key, value in node.items():
            if key in _PAGE_REF_KEYS and isinstance(value, str) and value in mapping:
                out[key] = mapping[value]
            else:
                out[key] = _rewrite_refs(value, mapping)
        return out
    if isinstance(node, list):
        return [_rewrite_refs(item, mapping) for item in node]
    return node


def _as_spec_page(prev: Dict[str, Any]) -> Dict[str, Any]:
    # purpose / audience 不能空：SpecPage 校验会咬。上一版模型页经常只有
    # id+name，用名字顶上，别为了补洞把整份 SPEC 作废。
    name = prev.get("name") or prev.get("id")
    return {
        "id": prev.get("id"),
        "name": name,
        "purpose": prev.get("purpose") or name or "沿用上一版页面",
        "audience": prev.get("audience") or "使用者",
        "coversNodes": list(prev.get("coversNodes") or []),
    }


def reconcile_pages(
    pages: List[Dict[str, Any]],
    prev_pages: List[Dict[str, Any]],
    prev_page_objs: Optional[List[Dict[str, Any]]] = None,
    *,
    restore: bool = True,
) -> Tuple[List[Dict[str, Any]], Dict[str, str], List[str]]:
    """把本轮页清单拨回上一版 id。返回 (新清单, 新id→旧id, 补回的旧id)。"""
    prev = _prev_list(prev_pages)
    if not prev:
        return pages, {}, []

    taken: set = set()
    mapping: Dict[str, str] = {}
    out: List[Dict[str, Any]] = []
    for page in pages:
        if not isinstance(page, dict):
            continue
        new_id = str(page.get("id") or "").strip()
        old_id = resolve_prev_page_id(page, prev, taken)
        if old_id:
            taken.add(old_id)
            if new_id and new_id != old_id:
                mapping[new_id] = old_id
            page = {**page, "id": old_id}
        out.append(page)

    restored: List[str] = []
    # 只有发生过改名/加后缀才补洞——否则「删掉报修台」会被我们偷偷加回来。
    if mapping and restore:
        by_id = {str(p.get("id")): p for p in out}
        catalog = _prev_list(prev_page_objs) or prev
        ordered: List[Dict[str, Any]] = []
        seen: set = set()
        for old in catalog:
            oid = str(old.get("id"))
            if oid in by_id:
                ordered.append(by_id[oid])
            else:
                ordered.append(_as_spec_page(old))
                restored.append(oid)
            seen.add(oid)
        for page in out:
            pid = str(page.get("id"))
            if pid not in seen:
                ordered.append(page)
                seen.add(pid)
        out = ordered
    return out, mapping, restored


def freeze_spec_pages(
    spec: Any,
    prev_pages: Any,
    prev_page_objs: Optional[List[Dict[str, Any]]] = None,
    *,
    restore: bool = True,
) -> Tuple[Any, Dict[str, Any]]:
    """第 2 步出口：SPEC 页 id 拨回。必须赶在图判 / 照搬 / 画页之前。"""
    if not isinstance(spec, dict):
        return spec, {"mapping": {}, "restored": []}
    spec = copy.deepcopy(spec)
    pages = [p for p in (spec.get("pages") or []) if isinstance(p, dict)]
    pages, mapping, restored = reconcile_pages(
        pages, prev_pages, prev_page_objs, restore=restore
    )
    spec["pages"] = pages
    spec = _rewrite_refs(spec, mapping)
    return spec, {"mapping": mapping, "restored": restored}


def freeze_pages_in_model(model: Any, reuse_model: Any) -> Tuple[Any, Dict[str, Any]]:
    """汇合出口 / GEN5 回落：模型侧 page.pages 与引用一并拨回。"""
    if not isinstance(model, dict) or not isinstance(reuse_model, dict):
        return model, {"mapping": {}, "restored": []}
    prev = _prev_list((reuse_model.get("page") or {}).get("pages"))
    if not prev:
        return model, {"mapping": {}, "restored": []}
    model = copy.deepcopy(model)
    page_block = model.get("page") if isinstance(model.get("page"), dict) else {}
    pages = [p for p in (page_block.get("pages") or []) if isinstance(p, dict)]
    pages, mapping, restored = reconcile_pages(pages, prev, prev)
    page_block = {**page_block, "pages": pages}
    model["page"] = page_block
    model = _rewrite_refs(model, mapping)
    return model, {"mapping": mapping, "restored": restored}


def log_freeze(report: Dict[str, Any], *, where: str) -> None:
    mapping = report.get("mapping") or {}
    restored = report.get("restored") or []
    if not mapping and not restored:
        return
    bits = []
    if mapping:
        bits.append("、".join(f"{n}→{o}" for n, o in mapping.items()))
    if restored:
        bits.append("补回 " + "、".join(restored))
    print(f"[page_id_freeze] {where}：{'；'.join(bits)}")


# ── 首轮：草稿 id → 模型 id（2026-08-24）─────────────────────────────────
#
# 上面那半个文件解决的是**精修轮**的漂移（新一轮铸的 id 拨回上一版）。
# 下面这半个解决的是**首轮**的错位，两者方向相反、成因也不同：
#
#     第 2 步  SPEC 铸草稿 id            p1 p2 p3 p4
#     第 3 步  按草稿 id 画页            pages = {p1: html, ...}
#     第 4 步  从 HTML 反推结构，LLM 给每页起**语义 id**
#              borrow_return_desk / reader_archive_center …
#              （DerivedPage.sourcePageId 记着它是从哪张草稿来的）
#     第 6 步  模型的 page.pages[].id 取自结构 = 语义 id
#
# 于是首轮交付的那一份里，**页面包的键是 p1..p4，模型的页面 id 是语义 id**，
# 交集为空。第 4 步那句注释写着「HTML 键已经是拨回后的 id」——那句话在精修轮
# 成立（第 2 步 freeze 已经把 SPEC 拨到上一版模型的 id 上了），**首轮不成立，
# 而没有任何一处校验它**。
#
# ## 真机后果（2026-08-24，图书馆借阅那趟，三轮对照）
#
# ① 第一次迭代必然全量重写。`split_pages_for_refine` 的照搬条件是
#    `pid in declared`——pid 来自上一版页面包（p1..p4），declared 是本轮 SPEC
#    的页面 id（已被 freeze 拨成语义 id），交集恒空：
#
#        第一次迭代   重画 1 页 / 照搬 0 页 → 实际改了 4/4 页
#                     画页 50.1s、bind 34.2s（bound=4 bindSkipped=0）
#        第二次迭代   重画 1 页 / 照搬 3 页 → 实际改了 1/4 页
#                     画页 4.7s、bind 30.3s（bound=1 bindSkipped=3）
#
#    量的是渲染后的 DOM（纪律五）：第一次迭代里用户没点名的三页，整张表消失、
#    表头 12 列变 7 列、列名全换；连点名那一页的 data 绑定都从 49 掉到 28。
#    第二次迭代那三页 nodes/th/bind/text **四项逐一相等**。
#
# ② 首轮的页面拿不到工作流动作。`html_bindings.build_prompt` 里
#    `this_page_bound = page_id in wf_bound_pages`——page_id 是页面包的键、
#    wf_bound_pages 来自 model.appbundle.pageBindings[].pageRef，首轮恒不相等，
#    于是每一页都被告知「这一页没有绑定流程，不要用那三种转移动作」。
#    真机对照：首轮交付页的 data-* 里没有 data-action / data-entity，
#    第二轮补齐了。
#
# ## 做法
#
# 不是新发明一套对照，**第 4 步的产物里本来就带着这条映射**：
# `DerivedPage.sourcePageId`（"这一页由哪份 HTML 推出来的，不是模型编的"），
# 而且 `html_structure.check_page_coverage` 已经把它钉成双向全覆盖——
# 喂进去的每一页都必须有条目、不许凭空多一个。也就是说
# `sourcePageId → id` 是一条**已经被校验过的双射**，拿来即用。
#
# 口径同 Terraform 的 `moved` 块：改名不是让下游各自去猜，而是把「旧地址→新
# 地址」显式声明在一个地方、在下游动手之前应用掉，并且在 plan 阶段就校验。
# 这里对应的是 `assert_pages_match_model` 那条不变式。
#
# ⚠ 精修轮这条映射恒为空（第 2 步 freeze 已经让 SPEC id == 上一版模型 id，
#   第 4 步的 freeze 又把结构拨了回去，于是 sourcePageId == id）。也就是说
#   这一整段在精修轮是 no-op——它只治首轮。


def canonical_page_id_map(structure: Any) -> Dict[str, str]:
    """草稿 id → 模型 id。取自第 4 步 `DerivedPage.sourcePageId → id`。

    只收**真的改了名**的那些；一个都没改就返回空表（精修轮的常态）。
    同一个 sourcePageId 出现两次（结构畸形）时整条放弃——宁可维持现状，
    也不要按一半的映射改键，那会把页面包改成半新半旧。
    """
    pages = []
    if isinstance(structure, dict):
        pages = [p for p in (structure.get("pages") or []) if isinstance(p, dict)]
    if not pages:
        return {}
    mapping: Dict[str, str] = {}
    for page in pages:
        src = str(page.get("sourcePageId") or "").strip()
        new = str(page.get("id") or "").strip()
        if not src or not new or src == new:
            continue
        if src in mapping:
            return {}  # 一对多 = 结构畸形，不动
        mapping[src] = new
    if len(set(mapping.values())) != len(mapping):
        return {}  # 多对一，同上
    return mapping


def rekey_page_map(value: Any, mapping: Dict[str, str]) -> Any:
    """把 `{pageId: X}` 这种**以页面 id 作键**的表换成新键。非 dict 原样返回。"""
    if not mapping or not isinstance(value, dict):
        return value
    return {mapping.get(str(k), k): v for k, v in value.items()}


#: 已经烧进 HTML 正文的菜单孔。引号卡住，避免 p1 误伤 p10。
_DATA_PAGE_ID_ATTR = re.compile(r'(data-page-id=")([^"]*)(")', re.I)


def rewrite_html_page_ids(pages_html: Any, mapping: Dict[str, str]) -> Any:
    """把已经烧进 HTML 正文的 ``data-page-id`` 换成新 id。

    ``rekey_page_map`` 只换 dict 的键。第 3.5 步 unify_shell 按草稿 id 打的
    孔还在 value 那串 HTML 里。别名表是给存量 / 直播的第二通道；**新生成
    的这一份，孔和键必须同一套**——别名表被某一跳抹掉时，菜单又会静默
    点不动（真机 sr-20260827191954 药房、sr-20260909 菜单再废）。

    选别名而不是重写，当初是为了救已经发出去的存量 HTML。新生成这一份
    两手都做：改键、改孔、别名照记。
    """
    if not mapping or not isinstance(pages_html, dict):
        return pages_html
    out: Dict[str, Any] = {}
    for pid, html in pages_html.items():
        if not isinstance(html, str):
            out[pid] = html
            continue

        def _sub(match: re.Match[str], _map: Dict[str, str] = mapping) -> str:
            old = match.group(2)
            return f"{match.group(1)}{_map.get(old, old)}{match.group(3)}"

        out[pid] = _DATA_PAGE_ID_ATTR.sub(_sub, html)
    return out


def rekey_page_ids(value: Any, mapping: Dict[str, str]) -> Any:
    """把一串页面 id 换成新 id。非 list 原样返回。"""
    if not mapping or not isinstance(value, list):
        return value
    return [mapping.get(str(v), v) if isinstance(v, str) else v for v in value]


def rekey_page_refs(value: Any, mapping: Dict[str, str]) -> Any:
    """把嵌套结构里 id/pageRef/pageId 这类**引用**换成新 id（navItems / spec）。"""
    if not mapping:
        return value
    return _rewrite_refs(value, mapping)


def pages_match_model(pages: Any, model: Any) -> Tuple[bool, List[str], List[str]]:
    """页面包的键与模型的页面 id 对得上吗。返回 (对得上, 只有页面包有, 只有模型有)。

    ⚠ 这条不变式全仓**从来没有人校验过**，而它一旦不成立，坏的东西全是静默的：
      照搬集为空（全量重写）、bind 的流程判定恒 False、按 landingPageRef 取页
      取不到。没有一处会报错，判据也全绿。所以补这一条，宁可吵。

    只报不拦（纪律七）：交付链路上发现错位时，端出去仍然好过整轮作废——
    错位的表现是"下一轮多花 40 秒重画"，作废的表现是"这一轮白跑"。
    """
    keys = set((pages or {}).keys()) if isinstance(pages, dict) else set()
    mids = set()
    if isinstance(model, dict):
        mids = {
            str(p.get("id"))
            for p in ((model.get("page") or {}).get("pages") or [])
            if isinstance(p, dict) and p.get("id")
        }
    if not keys or not mids:
        return True, [], []  # 没得比就不报——空页面包另有闸管
    return keys == mids, sorted(keys - mids), sorted(mids - keys)


def merge_page_id_aliases(prev: Any, incoming: Any) -> Dict[str, str]:
    """合并页面 id 别名表（旧 id → 新 id）。**新的赢。**

    ## 为什么合并规则要收成一处

    别名表有三个写入/读取点，规则必须一致，否则就是半新半旧：

        1. 落库    v5_capability_executor._cache_spec_first_pages
        2. 版本快照 v5_full_driver.record_model_snapshot（随 specFirstPages 整份带走）
        3. 版本回退 routes.sliderule_full._restore_model_version_locked
           （前端 ◀ 按钮的 HTTP 路 与 rehearsal_control 的 restore_version 工具
           **共用这个核**；2026-08-29 之前只补在工具那一侧，HTTP 那条静默失效）

    ## ⚠ 别名是历史，历史不许回退

    第 3 点是 2026-08-28 审计出来的洞：回退把 `state.specFirstPages` 整份
    换成旧快照，而旧快照里的别名表可能是空的（修复之前的存量版本，或者
    某个没改过名的精修轮——`canonical_page_id_map` 一个都没改就返回空表，
    那正是精修轮的常态）。整份替换 = 别名没了 = 菜单又点不动，而且照例
    一声不吭。

    做法照 friendly_id 的 History：slug 历史是**只增的**，回退文章内容不会
    把老 slug 从历史表里删掉——否则老链接当场 404。这里同理：模型版本可以
    回退，"p1 曾经是 remote_rx_audit" 这件事**永远为真**，不该跟着回退。

    冲突时新的赢，对应它的 `order(id: :desc)`：同一个旧 id 被指到两个新 id
    时，最近那次改名才是有效的。
    """
    out: Dict[str, str] = {}
    for source in (prev, incoming):
        if isinstance(source, dict):
            for old, new in source.items():
                old_s, new_s = str(old).strip(), str(new).strip()
                if old_s and new_s and old_s != new_s:
                    out[old_s] = new_s
    return out


#: 交付 HTML 里的菜单锚点：``<a data-page-id="p1">…标签…</a>``。
_NAV_ANCHOR = re.compile(
    r'<a\b[^>]*data-page-id="([^"]*)"[^>]*>(.*?)</a>', re.S | re.I
)


#: 生产侧 `page_shell._set_label` 写的就是 ``{icon}<span>{label}</span>``——
#: 标签**永远在最后一个 span 里**。照这个结构取，别把整段文字揉在一起：
#: 图标是 `<svg>` 时揉了也对（标签被剥空），是**文字/emoji** 时就会在标签
#: 前面粘上一个字符，跟 navItems 的名字永远对不上。2026-08-28 判据当场咬到。
_LAST_SPAN = re.compile(r"<span\b[^>]*>((?:(?!</span>).)*)</span>(?![\s\S]*<span\b)", re.S | re.I)


def _label_text(markup: str) -> str:
    """从菜单锚点里取出标签文字：优先最后一个 span，没有 span 才退回整段。"""
    raw = markup or ""
    m = _LAST_SPAN.search(raw)
    if m:
        raw = m.group(1)
    return re.sub(r"\s+", "", re.sub(r"<[^>]+>", "", raw))


def infer_page_id_aliases(
    pages_html: Any, nav_items: Any, existing: Any = None
) -> Dict[str, str]:
    """给**存量**产物反推页面 id 别名表（旧 id → 新 id）。

    ## 为什么需要它

    别名表是 2026-08-28 才加的。此前生成的应用，HTML 里的孔烧的是草稿 id
    （p1..pN），页键早已被第 4.5 步改成语义 id，而那张映射**当时没人记**。
    宿主查不到就静默回落，表现是四个菜单项全点不动（真机
    sr-20260827191954 / sr-20260827201847）。

    ## ⚠ 按名字锚，**不按顺序**

    `page_id_freeze` 模块头写死了这条：「顺序不当锚（SPEC 注释写过：顺序会变，
    名字不会）」。2026-08-28 真机新跑一轮把这条坐实了——那一场的映射是

        p1→service_desk  p2→book_list  p3→borrow_center
        p4→overdue_penalty_ledger      p5→reader_archive

    而 pages 字典的第一个键是 `book_list`。**按顺序反推会把 p1 判给
    book_list，全盘错位。**

    锚点是每个孔**同一个 `<a>` 里的标签文字**——`build_nav_items` 写它的时候，
    标签和 `data-page-id` 就是一起打上去的，天然同源。

    ## 对不上的宁可不填

    - 标签在 navItems 里找不到 → 不填
    - 同一个标签对应多个页（重名）→ 整个标签作废，不填
    - 同一个孔在不同页里指向不同标签（产物本身就不自洽）→ 那个孔作废
    - 孔本身就是交付页的 id（本来就好的）→ 不需要别名

    留一个点不动的菜单项，好过把用户送到错的那一页。

    ## existing 赢

    已有的别名是**改名当时记下来的**，是事实；这里推出来的是重建。两者冲突
    以事实为准（合并规则见 merge_page_id_aliases）。
    """
    pages = pages_html if isinstance(pages_html, dict) else {}
    delivered = set(pages.keys())

    # ⚠ 比之前先过一遍**生产那一侧同一个函数**（page_shell.nav_tab_label）。
    #   它写标签时会剥掉「某某页」的「页」和产品名前后缀，而 navItems 存的是
    #   spec 里的原名——两边不同源就对不上。
    #   真机 sr-20260827072032：HTML 标签「闭环验真报告」，navItems
    #   「闭环验真报告页」，第一版匹配器就在这一条上少补了一个孔。
    #   两个形态都登记（原名 + 剥过的），别在这里另写一套剥法（CLAUDE.md §4）。
    try:
        from .page_shell import nav_tab_label as _tab_label
    except Exception:  # noqa: BLE001 —— 反推是增强，import 不到就只按原名对
        _tab_label = None

    def _forms(name: str) -> List[str]:
        out = [_label_text(name)]
        if _tab_label is not None:
            # 两种口径都试：桌面（不剥「页」）与手机（剥）。
            #
            # ⚠ 2026-09-05：剥「页」改成设备相关之后，这里只试默认口径就不够了。
            #   这个函数的活儿是**反推老会话**的页面 id——库里存着的 HTML 可能是
            #   旧规则（不分设备一律剥）画出来的，标签是「闭环验真报告」，
            #   而 navItems 里还是「闭环验真报告页」。认不出来就填不上别名，
            #   刷新回放会错页。反推侧宽容不花钱：下面重名整个作废那道闸还在，
            #   宽容匹配不会把两页认成一页。
            for kw in ({}, {"strip_page_suffix": True}):
                try:
                    out.append(_label_text(_tab_label(name, **kw)))
                except Exception:  # noqa: BLE001
                    pass
        return [f for f in dict.fromkeys(out) if f]

    # 标签 → 页面 id。重名的标签整个作废——宁可不填也不猜。
    by_label: Dict[str, str] = {}
    dupe_labels: set = set()
    for item in nav_items if isinstance(nav_items, list) else []:
        if not isinstance(item, dict):
            continue
        pid = str(item.get("id") or "").strip()
        if not pid:
            continue
        for label in _forms(str(item.get("name") or "")):
            if label in by_label and by_label[label] != pid:
                dupe_labels.add(label)
            by_label[label] = pid
    for label in dupe_labels:
        by_label.pop(label, None)

    inferred: Dict[str, str] = {}
    conflicted: set = set()
    for html in pages.values():
        if not isinstance(html, str):
            continue
        for hole, inner in _NAV_ANCHOR.findall(html):
            hole = str(hole).strip()
            if not hole or hole in delivered:
                continue  # 本来就指得到页，不需要别名
            target = by_label.get(_label_text(inner))
            if not target or target not in delivered:
                continue
            if hole in inferred and inferred[hole] != target:
                conflicted.add(hole)  # 同一个孔在不同页里指向不同标签
                continue
            inferred[hole] = target
    for hole in conflicted:
        inferred.pop(hole, None)

    return merge_page_id_aliases(inferred, existing)


def dangling_nav_holes(
    pages_html: Any, aliases: Any = None, nav_items: Any = None
) -> List[str]:
    """这份产物里，点了会**真的没反应**的菜单孔。空 = 菜单是好的。

    ⚠ 全集不是 `pages` 的键，是**前端会渲染出来的那批页**（2026-08-28 写这条
      判定时第一版就错在这儿，把 13 个好会话报成了坏的）。

      `spec-live-pages.specLivePageIds` 先放 navItems 的全部 id，再补
      pages 里多出来的键。所以「导航里有、成品却缺」的那一页**仍然在清单里**，
      只是 html 换成了 missingPageHtml 的骨架——点进去看到的是「这一页没有
      成品界面」，那是**如实降级，不是点了没反应**（2026-08-20 Foclip 那次
      专门修的就是这个）。

      真正点不动的只有一种：孔既不是交付页、也不在导航清单里，别名也接不上。
    """
    pages = pages_html if isinstance(pages_html, dict) else {}
    delivered = set(pages.keys())
    for item in nav_items if isinstance(nav_items, list) else []:
        if isinstance(item, dict) and str(item.get("id") or "").strip():
            delivered.add(str(item["id"]).strip())
    table = aliases if isinstance(aliases, dict) else {}
    holes: set = set()
    for html in pages.values():
        if isinstance(html, str):
            holes.update(h for h, _ in _NAV_ANCHOR.findall(html))
    bad: List[str] = []
    for hole in sorted(holes):
        cur, seen = hole, set()
        while cur not in delivered and cur in table and cur not in seen:
            seen.add(cur)
            cur = table[cur]
        if cur not in delivered:
            bad.append(hole)
    return bad
