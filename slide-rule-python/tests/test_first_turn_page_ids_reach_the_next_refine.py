"""首轮的页面包必须用模型的页面 id 作键，否则第一次迭代必然全量重写。

## 事故（2026-08-24，图书馆借阅那趟，三轮真机对照）

用户只说「读者档案那一页，给列表加一列」。作用域判得很准
（`图判作用域接管重画范围：重画 ['reader_archive_center']`），紧跟着却是
**照搬 0 页**，四页全部重画。第二次迭代同样一句话，照搬 3 页、只改 1 页。

        第一次迭代   重画 1 / 照搬 0  → 实际改 4/4 页   画页 50.1s  bind bound=4 skip=0
        第二次迭代   重画 1 / 照搬 3  → 实际改 1/4 页   画页  4.7s  bind bound=1 skip=3

量渲染后的 DOM（纪律五，不量字节——全量重写同样让 4/4 字节都变）：第一次
迭代里用户没点名的三页，整张表消失、表头 12 列变 7 列、列名全换；连点名那
一页的 data 绑定都从 49 掉到 28。第二次迭代那三页 nodes/th/bind/text 四项
**逐一相等**。

## 病灶

首轮两套 id 各说各话：

    第 2 步 SPEC 铸草稿 id      p1 p2 p3 p4
    第 3 步 按草稿 id 画页      pages = {p1: html, …}
    第 4 步 结构给每页起语义名  reader_archive_center …（sourcePageId 记着来路）
    第 6 步 模型页面 id 取自结构 = 语义 id

于是 `split_pages_for_refine` 的照搬条件 `pid in declared`——pid 来自上一版
页面包（p1..p4），declared 是本轮 SPEC 的页面 id（已被 freeze 拨成语义 id）
——**交集恒空**。第 4 步那句「HTML 键已经是拨回后的 id」只在精修轮成立，
首轮不成立，而全仓没有一处校验过它。

顺带还有第二处：`html_bindings.build_prompt` 的
`this_page_bound = page_id in wf_bound_pages` join 的也是这两套 id，首轮恒
False，于是每页都被告知「这一页没绑流程，别用那三种转移动作」。真机对照：
首轮交付页的 data-* 里没有 data-action / data-entity，第二轮才补齐。

## 判据怎么写

**不盯"有没有调 canonical_page_id_map"**——那种判据把函数改个名就红，把调用
点删了却可能不红。盯的是**跑完之后照搬到底成不成**：首轮产物直接喂给第二轮，
数照搬了几页。这条判据只要错位回来（无论从哪个载体漏的）就必红。

变异验证（写完必做，纪律二）：把第 4.5 步那段改键删掉 → `test_首轮产物喂给第二轮时照搬得上`
与 `test_首轮页面包的键就是模型的页面 id` 一起变红。
"""

import pytest

from services.page_id_freeze import (
    canonical_page_id_map,
    pages_match_model,
    rekey_page_map,
)
from services.refine_page_scope import split_pages_for_refine


# 第 2 步铸的草稿 id；真机首轮就长这样。
SPEC_WIRE = {
    "appName": "借阅通",
    "pages": [
        {"id": "p1", "name": "借还服务台", "purpose": "办理借还", "audience": "馆员"},
        {"id": "p2", "name": "读者档案中心", "purpose": "看读者", "audience": "馆员"},
        {"id": "p3", "name": "逾期催还看板", "purpose": "催还", "audience": "馆员"},
    ],
    "successCriteria": ["借得出还得回"],
    "requirementNodes": [{"id": "n1", "name": "借还", "kind": "capability"}],
}

# 第 4 步 LLM 起的语义名 + 它自己记着的来路。这条对照是被
# html_structure.check_page_coverage 钉成双向全覆盖的，所以拿来即用。
STRUCTURE = {
    "entities": [],
    "pages": [
        {"id": "borrow_return_desk", "name": "借还服务台", "kind": "form",
         "sourcePageId": "p1", "evidence": "e"},
        {"id": "reader_archive_center", "name": "读者档案中心", "kind": "list",
         "sourcePageId": "p2", "evidence": "e"},
        {"id": "overdue_reminder_board", "name": "逾期催还看板", "kind": "monitor",
         "sourcePageId": "p3", "evidence": "e"},
    ],
}

PAGE_IDS = ("p1", "p2", "p3")
SEMANTIC_IDS = ("borrow_return_desk", "reader_archive_center", "overdue_reminder_board")


def _model_from_structure(structure):
    """照 model_assembly.assemble_mechanical 的真实做法：页面 id 取自结构。"""
    pages = [{"id": p["id"], "name": p["name"], "kind": p["kind"]}
             for p in structure["pages"]]
    return {
        "datamodel": {"entities": []},
        "rbac": {"roles": [], "permissions": [], "menus": []},
        "workflow": {"id": "main_flow", "name": "主流程", "nodes": [], "transitions": []},
        "page": {"pages": pages},
        "aigc": {"capabilities": []},
        "appbundle": {
            "pageBindings": [],
            "landingPageRef": pages[0]["id"] if pages else "",
            "preferredDevice": "desktop",
            "appIdentity": {"appName": "借阅通"},
            "invariants": [],
        },
    }


def _run(monkeypatch, *, refine=None, reuse_pages=None, reuse_model=None):
    """跑真实 run_spec_first 控制流（harness 抄自 test_refine_graph_scope）。

    只把 LLM 那几步换成确定性替身；改键、对账、照搬判定全部是真代码。
    """
    import services.html_bindings as hb
    import services.html_structure as hs
    import services.model_assembly as ma
    import services.page_shell as ps
    import services.spec_page_html as sph
    import services.spec_semantics as ss
    import services.spec_tree as spec_tree
    from services import spec_first_pipeline as sfp

    monkeypatch.setattr(spec_tree, "generate_spec_tree", lambda g, **kw: dict(SPEC_WIRE))

    def fake_pages(spec, **kw):
        reused = dict(kw.get("reuse_pages") or {})
        declared = [str(p["id"]) for p in (spec.get("pages") or [])]
        drawn = {pid: f"<html>新画-{pid}</html>" for pid in declared if pid not in reused}
        return {"pages": {**reused, **drawn}, "failed": {}}

    monkeypatch.setattr(sph, "generate_pages_parallel", fake_pages)
    monkeypatch.setattr(
        ps, "unify_shell",
        lambda p, s, **kw: {
            "pages": dict(p),
            # 导航 id 跟着 spec 走——真实 unify_shell 也是按 spec 锚定的。
            "navItems": [{"id": str(q["id"]), "name": q["name"]} for q in (s.get("pages") or [])],
        },
    )
    monkeypatch.setattr(ps, "check_shell_consistency", lambda *a, **kw: [])
    monkeypatch.setattr(ps, "repair_pages_after_bind", lambda p, b, **kw: (dict(p), [], []))
    monkeypatch.setattr(hs, "derive_structure", lambda p, **kw: dict(STRUCTURE))
    monkeypatch.setattr(ss, "derive_semantics", lambda st, sp, **kw: {"roles": []})
    monkeypatch.setattr(
        ma, "assemble",
        lambda structure, *a, **k: {
            "model": _model_from_structure(structure), "gate": {"passed": True}
        },
    )
    monkeypatch.setattr(
        hb, "bind_pages", lambda p, m, **kw: {"pages": dict(p), "failed": {}}
    )
    return sfp.run_spec_first(
        "做一个社区图书馆的借阅系统",
        refine=refine, reuse_pages=reuse_pages, reuse_model=reuse_model,
    )


class Test首轮的页面包用哪套id作键:
    def test_首轮页面包的键就是模型的页面id(self, monkeypatch):
        """★ 病灶本身。改动前这里是 p1/p2/p3，与模型的语义 id 交集为零。"""
        out = _run(monkeypatch)
        assert set(out["pages"]) == set(SEMANTIC_IDS), (
            f"首轮页面包还是草稿 id：{sorted(out['pages'])}"
        )
        ok, only_pages, only_model = pages_match_model(out["pages"], out["model"])
        assert ok, f"页面包 {only_pages} / 模型 {only_model}"

    def test_跟着页面id走的那几样一起改了键(self, monkeypatch):
        """漏掉任何一样就是半新半旧——navItems 漏了导航点不开，
        declaredPages 漏了交付对账天天报缺页。"""
        out = _run(monkeypatch)
        assert {str(n["id"]) for n in out["navItems"]} == set(SEMANTIC_IDS)
        assert set(out["declaredPages"]) == set(SEMANTIC_IDS)
        # 声明集与实交集一致 → 不该报缺页
        assert out["missingPages"] == [], out["missingPages"]

    def test_精修轮这段是no_op(self, monkeypatch):
        """精修轮 SPEC 已被 freeze 拨到上一版模型的 id，sourcePageId == id，
        映射恒空。这条保证修复只治首轮、不去动已经正确的那条路。"""
        structure_same = {
            "entities": [],
            "pages": [{"id": pid, "name": pid, "kind": "list",
                       "sourcePageId": pid, "evidence": "e"} for pid in SEMANTIC_IDS],
        }
        assert canonical_page_id_map(structure_same) == {}

    def test_结构畸形时宁可不动(self):
        """一对多 / 多对一都不动手——按一半的映射改键会把页面包改成半新半旧，
        比原样错着更难查。"""
        assert canonical_page_id_map(
            {"pages": [{"id": "a", "sourcePageId": "p1"},
                       {"id": "b", "sourcePageId": "p1"}]}
        ) == {}
        assert canonical_page_id_map(
            {"pages": [{"id": "same", "sourcePageId": "p1"},
                       {"id": "same", "sourcePageId": "p2"}]}
        ) == {}


class Test首轮产物喂给第二轮:
    def test_首轮产物喂给第二轮时照搬得上(self, monkeypatch):
        """★★ 这条才是用户报的那个 bug。

        真机形状：第一次迭代 `重画 1 页，照搬 0 页`，然后四页全被重写。
        判据不盯任何函数名，只问「把首轮的产物原样喂回去，照搬得上几页」。
        """
        first = _run(monkeypatch)

        # 第二轮：只点名一页，其余两页应当原样照搬。
        scope = ["reader_archive_center"]
        declared_objs = [{"id": pid} for pid in SEMANTIC_IDS]
        carried = split_pages_for_refine(declared_objs, first["pages"], scope)

        assert sorted(carried) == ["borrow_return_desk", "overdue_reminder_board"], (
            f"照搬集 {sorted(carried)}——空集就是全量重写那个 bug 回来了"
        )
        assert len(carried) == 2

    def test_反向_键错位时照搬会落空(self):
        """病灶的反面：**这就是改动前每一次第一次迭代的样子**。

        留着它是为了钉住因果——将来有人怀疑"照搬 0 页"是别的原因，
        这条摆着说明键对不上足以单独造成它。
        """
        stale = {pid: f"<html>{pid}</html>" for pid in PAGE_IDS}  # 草稿 id 的旧包
        declared_objs = [{"id": pid} for pid in SEMANTIC_IDS]
        carried = split_pages_for_refine(declared_objs, stale, ["reader_archive_center"])
        assert carried == {}, "键对不上却照搬到了东西？那因果就不是这条"

    def test_旧会话的存量页面包_改键后照搬得上(self):
        """存量数据：改动之前落库的会话，页面包还是 p1..p4。

        它们不会自己变好——下一轮 run_spec_first 拿到的 reuse_pages 仍是旧键。
        这条记下这个已知让步：**存量会话的下一次迭代仍然会全量重写一次**，
        再之后（新包已按模型 id 落库）才恢复正常。要连存量一起治，得在
        refine 入口按上一版模型的页面清单再拨一次——那是另一件事，
        没做进这次修复里。
        """
        legacy = {pid: f"<html>{pid}</html>" for pid in PAGE_IDS}
        declared_objs = [{"id": pid} for pid in SEMANTIC_IDS]
        assert split_pages_for_refine(declared_objs, legacy, ["reader_archive_center"]) == {}
        # 手动按映射拨一次就能照搬——证明"缺的只是那一次改键"
        mapping = canonical_page_id_map(STRUCTURE)
        assert split_pages_for_refine(
            declared_objs, rekey_page_map(legacy, mapping), ["reader_archive_center"]
        ).keys() == {"borrow_return_desk", "overdue_reminder_board"}


class Test对账不变式:
    def test_对得上时不报(self):
        ok, a, b = pages_match_model(
            {"x": "h"}, {"page": {"pages": [{"id": "x"}]}}
        )
        assert (ok, a, b) == (True, [], [])

    def test_对不上时报出两边各有谁(self):
        ok, only_pages, only_model = pages_match_model(
            {"p1": "h"}, {"page": {"pages": [{"id": "borrow_return_desk"}]}}
        )
        assert ok is False
        assert only_pages == ["p1"] and only_model == ["borrow_return_desk"]

    def test_没得比就不报_空页面包另有闸管(self):
        assert pages_match_model({}, {"page": {"pages": [{"id": "x"}]}})[0] is True
        assert pages_match_model({"x": "h"}, {})[0] is True

    def test_接线_跑一趟真链路会记下对账结果(self, monkeypatch):
        """写对了 ≠ 被调用了（纪律三）。删掉交付前那段对账，这条必红。"""
        out = _run(monkeypatch)
        assert out["stages"].get("pageIdMatch", {}).get("ok") is True
