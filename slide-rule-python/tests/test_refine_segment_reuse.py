# -*- coding: utf-8 -*-
"""精修时，指令没点名的模型段必须沿用上一版（2026-08-17）。

## 病灶

用户在已生成的应用上说一句「某一页的列表是空的，加点模拟数据」，整个应用被换掉。
2026-08-16 修了四次，实测（四组真机基线，见 docs/交接-精修增量化-2026-08-16.md）：

        菜单保留    页面数    逐段指纹保留
    前   0 / 4      4 → 3     0 / 6
    后   4 / 4      4 → 4     0 / 6      ← 结构保住了，内容一段没保住

`workflow`、`rbac` 这些跟指令毫不相干的段照样全变。根因不是提示词写得不够狠
（"连续性硬要求"那句话已经在 prompt 里了，四组基线证明求它自觉求不动），
而是 spec-first 天生「从 spec 树重新生成」，出口永远是完整模型——**没有任何
地方说得出「这一段用户根本没提，别动它」**。

## 判据为什么是行为的，不是 grep 的

上一版判据（test_refine_merge_reaches_the_live_path）grep 调用点附近有没有
`merge_patch`。那种写法钉的是"某个标识符出现在某个窗口里"，换个实现方式就
失效——而这一轮恰恰换了实现方式（补丁 → 沿用）。这里改成**驱动真实的
run_spec_first 控制流、量出口那份 model 的逐段指纹**：无论内部怎么写，
"没点名的段没变"这件事都必须成立。

⚠ 判据落在**逐段指纹**上，不是"变没变"。2026-08-16 早上用"四页字节变没变"
  验精修，4/4 变了就判通过——全量重写同样让 4/4 都变，那只能证明"有反应"。
"""

import copy
import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

from services import spec_first_pipeline as sfp  # noqa: E402
from services.spec_first_pipeline import (  # noqa: E402
    REFINE_REUSABLE_SEGMENTS,
    apply_refine_segment_reuse,
)


def _fp(seg) -> str:
    """逐段指纹。判据的尺子——不是"变没变"，是"这一段还是不是原来那一段"。"""
    return hashlib.sha256(
        json.dumps(seg, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()[:16]


def _baseline() -> dict:
    """上一版：一份能过闸的完整六段模型。"""
    return {
        "datamodel": {"entities": [
            {"id": "wo", "name": "工单", "fields": [{"id": "amt", "name": "金额", "type": "number"}]},
        ]},
        "rbac": {"roles": [{"id": "mgr", "name": "主管"}, {"id": "eng", "name": "维修工"}]},
        "workflow": {"nodes": [
            {"id": "s1", "name": "提交", "assigneeRole": "mgr"},
            {"id": "s2", "name": "派工", "assigneeRole": "eng"},
        ]},
        "page": {"pages": [{"id": "p1", "name": "工单页", "fieldBindings": ["wo.amt"]}]},
        "aigc": {"capabilities": [
            {"id": "c1", "name": "工单摘要", "inputFields": ["wo.amt"], "roleRefs": ["mgr"]},
        ]},
        "appbundle": {
            "landingPageRef": "p1", "preferredDevice": "desktop",
            "pageBindings": [{"pageRef": "p1"}], "roleRefs": ["mgr"], "dataModelRefs": ["wo"],
        },
    }


def _fresh() -> dict:
    """这一轮重新生成的：结构同源（SPEC 连续性约束管住了），但每段内容都被重写。"""
    m = _baseline()
    m["rbac"] = {"roles": [{"id": "mgr", "name": "店长"}]}
    m["workflow"] = {"nodes": [{"id": "z9", "name": "重写过的节点", "assigneeRole": "mgr"}]}
    m["aigc"] = {"capabilities": [
        {"id": "c9", "name": "重写过的能力", "inputFields": ["wo.amt"], "roleRefs": ["mgr"]},
    ]}
    return m


def _gate(model):
    from services.v5_model_gate import validate_five_system_model

    return validate_five_system_model(
        model,
        require_landing_page_ref=True,
        require_preferred_device=True,
        require_page_kind_contract=False,
    )


class Test沿用本身:
    def test_一段都没点名时_三段全沿用(self):
        base, fresh = _baseline(), _fresh()
        out = apply_refine_segment_reuse(fresh, base, [], gate_fn=_gate)
        for seg in REFINE_REUSABLE_SEGMENTS:
            assert _fp(out[seg]) == _fp(base[seg]), f"{seg} 被重写了——用户根本没提这一段"

    def test_点名的段重新生成_其余沿用(self):
        base, fresh = _baseline(), _fresh()
        out = apply_refine_segment_reuse(fresh, base, ["workflow"], gate_fn=_gate)
        assert _fp(out["workflow"]) == _fp(fresh["workflow"]), (
            "点名要改 workflow 却沿用了上一版——用户要求的改动静默失效了"
        )
        for seg in ("rbac", "aigc"):
            assert _fp(out[seg]) == _fp(base[seg]), f"{seg} 没被点名却被重写"

    def test_没声明scope时_一段都不敢沿用(self):
        """None ≠ []。反向判据：拿沉默当授权是错的。

        模型没答 / 老 spec / 非精修轮都是 None。当成"全沿用"的话，用户明确要求
        改权限时权限会一声不吭地不生效——比不沿用糟得多。
        """
        base, fresh = _baseline(), _fresh()
        out = apply_refine_segment_reuse(fresh, base, None, gate_fn=_gate)
        for seg in REFINE_REUSABLE_SEGMENTS:
            assert _fp(out[seg]) == _fp(fresh[seg]), f"scope 是 None 却沿用了 {seg}"

    def test_没有上一版时_原样返回(self):
        fresh = _fresh()
        assert apply_refine_segment_reuse(fresh, None, [], gate_fn=_gate) == fresh


class Test静默失效必须说得出话:
    """这个功能最可能的失效方式是「整个没生效」，而那种失效**天生无声**。

    模型不吐 refineScope → scope 恒为 None → 一段都不沿用 → 判据全绿、线上
    照旧全量重写、日志里一个字都没有。所以三条"什么都不做"的出口都得留痕。
    """

    def test_没声明scope时打日志(self, capsys):
        apply_refine_segment_reuse(_fresh(), _baseline(), None, gate_fn=_gate)
        out = capsys.readouterr().out
        assert "refineScope" in out and "不沿用" in out, (
            "SPEC 没声明 refineScope 时一声不吭——线上会出现「修好了但完全没生效」"
            "且无从排查"
        )

    def test_没有上一版时打日志(self, capsys):
        apply_refine_segment_reuse(_fresh(), None, [], gate_fn=_gate)
        assert "上一版" in capsys.readouterr().out

    def test_真沿用时也打日志_并说清沿用了哪几段(self, capsys):
        apply_refine_segment_reuse(_fresh(), _baseline(), [], gate_fn=_gate)
        out = capsys.readouterr().out
        assert "沿用上一版模型段" in out
        for seg in REFINE_REUSABLE_SEGMENTS:
            assert seg in out, f"日志没说沿用了 {seg}——出问题时对不出账"

    def test_退让时说清丢了哪一段(self, capsys):
        """⚠ 判据盯的是**语义**：丢了段就得说出丢的是哪一段、为什么。

        原来写的是 `"重新生成这一段" in out`——盯的是某句话的字面。2026-08-17
        退让算法改成 1-maximal 后文案变成「沿用 X（丢掉 aigc，首次拒绝：…）」，
        这条当场变红，而**行为其实没退化，反而更全**（现在还多说了首次拒绝的
        理由）。CLAUDE.md 点名过这个形态：盯字面的判据在换实现时会误报，
        盯语义的不会。

        所以改成钉三件事，都是"出问题时对得出账"真正需要的：
          · 丢掉的那一段的名字在
          · 说得出这是"丢/退让"而不是正常沿用
          · 带上了拒绝理由（不然只知道丢了、不知道为什么）
        """
        base = _baseline()

        def picky(model):
            if _fp(model["aigc"]) == _fp(base["aigc"]):
                return {"passed": False, "findings": [
                    {"path": "aigc.capabilities[c1]", "message": "悬空"},
                ]}
            return {"passed": True, "findings": []}

        apply_refine_segment_reuse(_fresh(), base, [], gate_fn=picky)
        out = capsys.readouterr().out
        assert "aigc" in out, "没说丢掉的是哪一段"
        assert ("丢掉" in out or "重新生成这一段" in out), (
            "没说清这是退让——只报「沿用了 X」会让人以为一切正常"
        )
        assert "悬空" in out, "没带上拒绝理由，出问题时只知道丢了、不知道为什么"


class Test不许沿用的段:
    """反向判据。纪律三：每写一条"应该有 X"，配一条"不该有 Y"。"""

    @pytest.mark.parametrize("seg", ["datamodel", "page", "appbundle"])
    def test_耦合本轮产物的段_即使一段没点名也不沿用(self, seg):
        base, fresh = _baseline(), _fresh()
        fresh[seg] = {"改过了": True}
        out = apply_refine_segment_reuse(fresh, base, [], gate_fn=_gate)
        assert _fp(out[seg]) == _fp(fresh[seg]), (
            f"{seg} 被沿用了——它指向的是**本轮**刚生成的页面/字段，"
            f"拿上一版的会错位（appbundle.landingPageRef 指向已不存在的页面就是这么来的）"
        )

    def test_可沿用清单不含耦合段(self):
        for seg in ("datamodel", "page", "appbundle"):
            assert seg not in REFINE_REUSABLE_SEGMENTS


class Test过不了闸时逐段退让:
    def test_只丢过不了闸的那段_其余保住(self):
        """一个 aigc 悬空不该把 rbac 和 workflow 的沿用一起赔掉。

        （第一版就是全有全无，被自己的探针咬出来——aigc.inputFields 指 datamodel
        字段，而 datamodel 永远重新生成，字段 id 一飘 aigc 就悬空。）
        """
        base, fresh = _baseline(), _fresh()

        def picky(model):
            reused_aigc = _fp(model["aigc"]) == _fp(base["aigc"])
            if reused_aigc:
                return {"passed": False, "findings": [
                    {"path": "aigc.capabilities[c1].fields", "message": "悬空"},
                ]}
            return {"passed": True, "findings": []}

        out = apply_refine_segment_reuse(fresh, base, [], gate_fn=picky)
        assert _fp(out["aigc"]) == _fp(fresh["aigc"]), "过不了闸的 aigc 还是被沿用了"
        for seg in ("rbac", "workflow"):
            assert _fp(out[seg]) == _fp(base[seg]), (
                f"{seg} 本来能过闸，却被 aigc 连累着一起赔掉了"
            )

    def test_一段都过不了时_整份用重新生成的那份(self):
        base, fresh = _baseline(), _fresh()
        out = apply_refine_segment_reuse(
            fresh, base, [], gate_fn=lambda m: {"passed": False, "findings": []}
        )
        assert out == fresh

    def test_罪魁排在最前时_也要保住后面的段(self):
        """★ 真机 6/6 的形态：卡住的**永远是 rbac**，而它排在退让链最前面。

        新生成的 page 引用了旧 rbac 没有的权限（`service_staff:export` 之类，
        实测 6/6 零例外），所以只要沿用 rbac 就过不了闸。而按顺序从尾巴丢的话：

            丢 aigc     → 还是 rbac 的病，白丢
            丢 workflow → 还是 rbac 的病，白丢
            丢 rbac     → 此时其余早已赔光 → 退让到空

        离线 replay（experiments/refine-fingerprint/replay_reuse_search.py）证实
        冻结臂 3 轮里有 2 轮存在 {workflow, aigc} 这个能过闸的组合，而前缀链
        够不到。赔掉的 workflow 正是用户最初抱怨被换掉的那两段之一。

        ⚠ 这条跟上面 test_只丢过不了闸的那段_其余保住 **不能互相替代**：那条的
          罪魁是 aigc，排在最后，从尾巴丢正好第一下就丢对，前缀退让照样绿。
          必须让罪魁排在最前，判据才咬得住"退让顺序"这件事本身。
        """
        base, fresh = _baseline(), _fresh()

        def rbac_is_the_culprit(model):
            if _fp(model["rbac"]) == _fp(base["rbac"]):
                return {"passed": False, "findings": [
                    {"path": "page.pages[p1].actionPermissions",
                     "message": "page action permission 'x:export' not found in rbac.permissions"},
                ]}
            return {"passed": True, "findings": []}

        out = apply_refine_segment_reuse(fresh, base, [], gate_fn=rbac_is_the_culprit)

        assert _fp(out["rbac"]) == _fp(fresh["rbac"]), "过不了闸的 rbac 还是被沿用了"
        for seg in ("workflow", "aigc"):
            assert _fp(out[seg]) == _fp(base[seg]), (
                f"{seg} 本来能过闸，却因为罪魁 rbac 排在退让链最前面被一起赔掉了"
                f"——这正是真机 on-2/on-3 白丢两段的那个形状"
            )

    def test_整体能过时_只过一次闸(self):
        """反向判据：别为了 1-maximal 把常见路径拖慢。

        绝大多数轮次（冻结生效且本轮没新增权限）是整体一次就过的，那条路径
        必须仍然只调一次闸——退化成"无论如何都逐个试加"会让闸的调用次数
        从 1 涨到 n，而闸虽然不调 LLM，也不是免费的。
        """
        calls = []

        def counting_gate(model):
            calls.append(1)
            return {"passed": True, "findings": []}

        base, fresh = _baseline(), _fresh()
        apply_refine_segment_reuse(fresh, base, [], gate_fn=counting_gate)
        assert len(calls) == 1, f"整体能过却调了 {len(calls)} 次闸"

    def test_闸的调用次数不超过段数加一(self):
        """代价上界不许涨：原来是 n+1，改成 1-maximal 之后仍是 n+1
        （整体试 1 次 + 逐个试加 n 次）。"""
        calls = []

        def always_fail(model):
            calls.append(1)
            return {"passed": False, "findings": []}

        base, fresh = _baseline(), _fresh()
        apply_refine_segment_reuse(fresh, base, [], gate_fn=always_fail)
        assert len(calls) <= len(REFINE_REUSABLE_SEGMENTS) + 1, (
            f"过闸 {len(calls)} 次，超了 n+1={len(REFINE_REUSABLE_SEGMENTS)+1} 的上界"
        )

    def test_闸自己抛异常时_不拖垮主链路(self):
        """纪律七：沿用属增强类，自己炸了不许拖垮主链路。

        把异常放出去的话，一个「少改点东西」的优化会让整轮推演崩掉——而
        fresh 那份在 assemble 里已经过过闸，是已知可用的，退回去就行。
        """
        base, fresh = _baseline(), _fresh()

        def boom(model):
            raise RuntimeError("闸自己炸了")

        out = apply_refine_segment_reuse(fresh, base, [], gate_fn=boom)
        assert out == fresh


class Test不污染上一版:
    def test_改返回值不影响baseline(self):
        base, fresh = _baseline(), _fresh()
        snapshot = copy.deepcopy(base)
        out = apply_refine_segment_reuse(fresh, base, [], gate_fn=_gate)
        out["rbac"]["roles"].append({"id": "x", "name": "污染"})
        assert base == snapshot, (
            "沿用是浅拷贝——改产出会改到上一版那份，而它是 refine 回流上下文里"
            "还在被引用的对象"
        )


class Test端到端接线:
    """★ 纪律一的具象化：判据必须跑**真正在跑的那条链**。

    2026-08-16 同一件事打偏三次，全是"代码本身对、装在不通电的插座上"。上一版
    判据（merge_patch）11 条全绿，把调用点删掉照样全绿——它们只直接调那个函数，
    从没验证它接在链路上。

    这一组不直接调 apply_refine_segment_reuse，而是把七步各自打成桩、**跑真实的
    run_spec_first 控制流**，量它出口那份 model。接线断了这里必红。
    """

    SPEC = {
        "rootNodeId": "n0", "version": 3, "appName": "维保云",
        "personas": [{"id": "u1", "name": "维修主管", "goals": ["派工"]}],
        "successCriteria": [{"id": "sc1", "text": "24 小时内派工率 90%"}],
        "nodes": [], "pages": [{"id": "p1", "name": "工单页"}],
    }

    def _drive(self, monkeypatch, *, scope, refine=True, baseline=None):
        import services.html_bindings as hb
        import services.html_structure as hs
        import services.model_assembly as ma
        import services.page_shell as ps
        import services.spec_page_html as sph
        import services.spec_semantics as ss
        import services.spec_tree as spec_tree

        spec = dict(self.SPEC)
        if scope is not None:
            spec["refineScope"] = scope

        monkeypatch.setattr(spec_tree, "generate_spec_tree", lambda goal, **kw: spec)
        monkeypatch.setattr(
            sph, "generate_pages_parallel",
            lambda s, **kw: {"pages": {"p1": "<html>x</html>"}, "failed": {}},
        )
        monkeypatch.setattr(ps, "unify_shell", lambda pages, s, **kw: {"pages": dict(pages)})
        monkeypatch.setattr(ps, "check_shell_consistency", lambda *a, **kw: [])
        monkeypatch.setattr(
            ps, "repair_pages_after_bind", lambda pages, before, **kw: (dict(pages), [], [])
        )
        monkeypatch.setattr(
            hs, "derive_structure", lambda pages, **kw: {"entities": [], "pages": []}
        )
        monkeypatch.setattr(
            ss, "derive_semantics", lambda st, s, **kw: {"roles": [], "workflowNodes": []}
        )
        monkeypatch.setattr(
            ma, "assemble",
            lambda *a, **k: {"model": _fresh(), "gate": {"passed": True, "findings": []}},
        )
        monkeypatch.setattr(
            hb, "bind_pages", lambda pages, model, **kw: {"pages": dict(pages), "failed": {}}
        )

        return sfp.run_spec_first(
            "做一个维保工单系统",
            refine=(
                {"instruction": "给工单页加点模拟数据", "modelDigest": "实体：工单"}
                if refine else None
            ),
            reuse_model=baseline,
        )

    def test_出口那份model_没点名的段指纹与上一版一致(self, monkeypatch):
        base = _baseline()
        out = self._drive(monkeypatch, scope=[], baseline=base)
        model = out["model"]
        for seg in REFINE_REUSABLE_SEGMENTS:
            assert _fp(model[seg]) == _fp(base[seg]), (
                f"{seg} 在真实链路的出口上仍被重写——沿用没接上，"
                f"或者接在了不通电的那一步"
            )

    def test_点名的段在真实链路上确实被重新生成(self, monkeypatch):
        """反向判据：别把「沿用」做成「什么都不改」。"""
        base = _baseline()
        out = self._drive(monkeypatch, scope=["rbac"], baseline=base)
        assert _fp(out["model"]["rbac"]) == _fp(_fresh()["rbac"]), (
            "点名要改 rbac，真实链路上却沿用了上一版"
        )

    def test_非精修轮不沿用(self, monkeypatch):
        """反向判据：新建应用没有"上一版"，沿用不许漏进这条路。"""
        base = _baseline()
        out = self._drive(monkeypatch, scope=[], refine=False, baseline=base)
        for seg in REFINE_REUSABLE_SEGMENTS:
            assert _fp(out["model"][seg]) == _fp(_fresh()[seg]), (
                f"非精修轮沿用了 {seg}——新建应用被上一轮的残留污染"
            )

    def test_开关关掉时退回旧行为(self, monkeypatch):
        monkeypatch.setenv("SLIDERULE_REFINE_REUSE_SEGMENTS", "0")
        base = _baseline()
        out = self._drive(monkeypatch, scope=[], baseline=base)
        for seg in REFINE_REUSABLE_SEGMENTS:
            assert _fp(out["model"][seg]) == _fp(_fresh()[seg])

    def test_执行器把上一版模型交给了spec_first(self, monkeypatch):
        """再往上一格：v5_capability_executor 真的传了 reuse_model 吗。

        少了这条，上面几条全绿而**执行器压根没传 baseline**，线上依然全量重写——
        正是"函数写对了 ≠ 它被调用了"。
        """
        from services import v5_capability_executor as ex
        from services.v5_llm_generate import set_refine_context

        captured: dict = {}

        def fake_run(goal, **kw):
            captured.update(kw)
            raise RuntimeError("捕获即止")

        monkeypatch.setattr("services.spec_first_pipeline.run_spec_first", fake_run)
        monkeypatch.setattr(
            "services.v5_llm_generate.generate_five_system_model", lambda *a, **k: None
        )
        monkeypatch.setenv("SLIDERULE_SPEC_FIRST", "1")

        set_refine_context(_baseline(), "给工单页加点模拟数据")
        try:
            ex._try_llm_generate_evidence("原始话题", None)
        finally:
            set_refine_context(None)

        assert captured.get("reuse_model") is not None, (
            "执行器没把上一版模型传给 spec-first——沿用在生产路径上等于没有"
        )
        assert _fp(captured["reuse_model"]["workflow"]) == _fp(_baseline()["workflow"])


class Test提示词与实现不许只改一半:
    """纪律四。一边给选项另一边不认，完全静默。"""

    def _scope_paragraph(self) -> str:
        from services.spec_tree import build_spec_prompt

        msgs = build_spec_prompt(
            "做一个维保工单系统",
            refine={"instruction": "给工单页加点模拟数据", "modelDigest": "实体：工单"},
        )
        chunks = [c for c in msgs[-1]["content"].split("\n\n") if "refineScope" in c]
        assert chunks, "refine 模式下 prompt 里没有 refineScope 段——模型永远不会声明"
        return "\n\n".join(chunks)

    def test_prompt给的选项与可沿用清单逐字一致(self):
        para = self._scope_paragraph()
        for seg in REFINE_REUSABLE_SEGMENTS:
            assert f'"{seg}"' in para, f"实现认 {seg}，prompt 却没给这个选项"

    def test_prompt不给耦合段当选项(self):
        para = self._scope_paragraph()
        for seg in ("datamodel", "page", "appbundle"):
            assert f'"{seg}"' not in para, (
                f"prompt 把 {seg} 列成了可选项——给了模型迟早会选，而实现不认它，"
                f"用户会看到「我明明说了改这个」却没反应"
            )

    def test_非精修轮的prompt逐字不变(self):
        """反向判据：新增的段不许漏进新建应用那条路。"""
        from services.spec_tree import build_spec_prompt

        assert build_spec_prompt("做一个订单系统") == build_spec_prompt(
            "做一个订单系统", refine=None
        )
        assert "refineScope" not in build_spec_prompt("做一个订单系统")[-1]["content"]

    def test_SpecTree认这个字段(self):
        from services.spec_tree import SpecTree

        spec = SpecTree.model_validate({
            "rootNodeId": "n0", "appName": "维保云",
            "personas": [{"id": "u1", "name": "维修主管", "goals": ["派工"]}],
            "successCriteria": [{"id": "sc1", "text": "24 小时内派工率 90%"}],
            "nodes": [{
                "id": "n0", "type": "requirement", "title": "派工要快",
                "acceptance": "当工单提交时，系统应在 24 小时内派工",
                "coversCriteria": ["sc1"],
            }],
            "pages": [
                {"id": "p1", "name": "工单页", "purpose": "看工单",
                 "audience": "维修主管", "coversNodes": ["n0"]},
            ],
            "refineScope": ["workflow"],
        })
        assert spec.refineScope == ["workflow"]
        # 缺省是 None（不是 []）——"没声明"和"声明了空"必须分得开
        spec2 = SpecTree.model_validate({
            "rootNodeId": "n0", "appName": "维保云",
            "personas": [{"id": "u1", "name": "维修主管", "goals": ["派工"]}],
            "successCriteria": [{"id": "sc1", "text": "24 小时内派工率 90%"}],
            "nodes": [{
                "id": "n0", "type": "requirement", "title": "派工要快",
                "acceptance": "当工单提交时，系统应在 24 小时内派工",
                "coversCriteria": ["sc1"],
            }],
            "pages": [
                {"id": "p1", "name": "工单页", "purpose": "看工单",
                 "audience": "维修主管", "coversNodes": ["n0"]},
            ],
        })
        assert spec2.refineScope is None


# ══════════════════════════════════════════════════════════════════════
# rbac 吃增量（2026-08-17 深夜）
#
# 病灶：沿用失败 8/9 是同一条——新生成的 page 引用了旧 rbac 没有的权限。
# 现有夹具 _baseline/_fresh 的 rbac 只有 roles、没有 permissions，页面也不带
# actionPermissions，**一条都碰不到这个病**，所以这里另起一套。
# ══════════════════════════════════════════════════════════════════════


def _perm_baseline() -> dict:
    """上一版：两条权限，页面只用到 read。"""
    m = _baseline()
    m["rbac"] = {
        "roles": [{"id": "mgr", "name": "主管"}, {"id": "eng", "name": "维修工"}],
        "permissions": ["wo:read", "wo:create"],
    }
    m["page"] = {"pages": [{
        "id": "p1", "name": "工单页",
        "fieldBindings": ["wo.amt"], "actionPermissions": ["wo:read"],
    }]}
    return m


def _perm_fresh() -> dict:
    """这一轮：页面多引用了 wo:export，新 rbac 自己也铸了它（真机 4/4 就是这样）。

    另外新 rbac 还铸了 wo:archive，但**没有任何页面引用它**——用来区分
    「并页面所需」和「把新权限全并进来」这两种做法。

    ⚠ 新权限里**故意丢掉了 wo:create**（旧的有）。第一版夹具让新的是旧的
      超集，结果「权限用新的、丢旧的」那种退化实现**照样全绿**——超集之下
      根本丢不掉东西，夹具没还原病灶。真机 on-2 正是丢了 work_order:export
      和 work_order:manage 两条，而用户那轮只说了「加点模拟数据」。
    """
    m = _perm_baseline()
    m["rbac"] = {
        "roles": [{"id": "mgr", "name": "店长"}],
        "permissions": ["wo:read", "wo:export", "wo:archive"],
    }
    m["page"] = {"pages": [{
        "id": "p1", "name": "工单页",
        "fieldBindings": ["wo.amt"], "actionPermissions": ["wo:read", "wo:export"],
    }]}
    return m


class Test沿用的rbac要能吃增量:
    def test_页面引用的新权限被并进来(self):
        """真机 8/9 的病灶：不并就过不了闸，整段 rbac 白丢。

        ⚠ **必须先钉住「rbac 确实是沿用来的」再看权限。** 第一版只断言
          `"wo:export" in perms`，而把合并整个删掉时 rbac 会回落到**新生成的
          那份**，新的那份本来就有 wo:export——判据被回落路径白送了绿灯，
          变异咬不动。CLAUDE.md 第三条：正向判据齐全、反向判据缺失。
        """
        base = _perm_baseline()
        out = apply_refine_segment_reuse(_perm_fresh(), base, [], gate_fn=_gate)
        assert _fp(out["rbac"]["roles"]) == _fp(base["rbac"]["roles"]), (
            "rbac 根本没被沿用（回落到新生成的那份了）——下面那条权限断言"
            "会被回落路径白送绿灯，先钉死这里"
        )
        assert "wo:export" in out["rbac"]["permissions"], (
            "页面引用了 wo:export，沿用的旧 rbac 里没有，也没并进来"
            "——闸会拒，整段 rbac 又白丢了"
        )

    def test_页面没引用的新权限不并进来(self):
        """★ 反向判据：修法要跟病灶一样大。

        wo:archive 是新 rbac 铸的，但没有任何页面引用它。并它进来没有依据，
        而且会让权限逐轮单调累积。少了这条，实现退化成「旧 ∪ 新全部」也照样绿。
        """
        out = apply_refine_segment_reuse(
            _perm_fresh(), _perm_baseline(), [], gate_fn=_gate
        )
        assert "wo:archive" not in out["rbac"]["permissions"], (
            "把页面根本没用到的新权限也并进来了——并进来的每一条都该有页面在引用它"
        )

    def test_旧权限一条都不许少(self):
        """★ 反向判据：防止退化成「只沿用 roles、权限用新的」。

        真机 on-2 的新权限丢了 work_order:export 和 work_order:manage，而用户
        那轮只说了「加点模拟数据」。权限凭空消失正是最初被抱怨的形态。
        """
        base = _perm_baseline()
        out = apply_refine_segment_reuse(_perm_fresh(), base, [], gate_fn=_gate)
        assert _fp(out["rbac"]["roles"]) == _fp(base["rbac"]["roles"]), (
            "rbac 根本没被沿用——同上，先钉死这里再看权限"
        )
        for p in base["rbac"]["permissions"]:
            assert p in out["rbac"]["permissions"], (
                f"旧权限 {p} 被弄丢了——用户这轮根本没提权限"
            )

    def test_角色仍然沿用的是上一版(self):
        """并权限不该顺手把角色也换了——角色才是用户抱怨被换掉的东西。"""
        base = _perm_baseline()
        out = apply_refine_segment_reuse(_perm_fresh(), base, [], gate_fn=_gate)
        assert _fp(out["rbac"]["roles"]) == _fp(base["rbac"]["roles"]), (
            "rbac 的角色没沿用上一版"
        )

    def test_用户点名rbac时根本不合并(self):
        """用户明确要改权限时，rbac 压根不进沿用候选，自然也不该被并。

        这是「会不会把用户要删的权限又并回来」那个担心的正面回答。
        """
        base = _perm_baseline()
        out = apply_refine_segment_reuse(
            _perm_fresh(), base, ["rbac"], gate_fn=_gate
        )
        assert _fp(out["rbac"]) == _fp(_perm_fresh()["rbac"]), (
            "用户点名要改 rbac，却给了他一份沿用+合并过的——用户的要求静默失效了"
        )

    def test_权限是字典形态时也能并(self):
        """⚠ 闸的 _collect_permission_ids 两种形态都收（字符串 / {"id":...}）。

        只认字符串的话，字典形态的模型会「一条都没并进来」，而且不报错、判据
        也不红——沿用照旧退让，看起来像「这功能就是没生效」。纪律四的形状。
        """
        from services.spec_first_pipeline import merge_needed_permissions

        base = _perm_baseline()
        base["rbac"]["permissions"] = [{"id": "wo:read"}, {"id": "wo:create"}]
        merged, added = merge_needed_permissions(base["rbac"], _perm_fresh())
        assert added == ["wo:export"], f"字典形态下没并对：{added}"
        assert all(isinstance(p, dict) for p in merged["permissions"]), (
            "把字典列表并成了字典和字符串混合的——落库后下游各自解析会分叉"
        )

    def test_合并结果照样过闸_没有免检通道(self):
        """合并不是特权：并完的整份候选要跟其余段一起再过一遍同一个闸。

        用一个「见到 wo:export 就拒」的闸——如果合并有免检通道，这条会绿。
        """
        def rejects_export(model):
            if "wo:export" in ((model.get("rbac") or {}).get("permissions") or []):
                return {"passed": False, "findings": [
                    {"path": "rbac.permissions", "message": "不许有 export"},
                ]}
            return {"passed": True, "findings": []}

        base = _perm_baseline()
        out = apply_refine_segment_reuse(
            _perm_fresh(), base, [], gate_fn=rejects_export
        )
        assert _fp(out["rbac"]) == _fp(_perm_fresh()["rbac"]), (
            "闸拒了合并结果，却还是把它端了出去——伪造绿灯"
        )

    def test_并了权限要在日志里说出来(self, capsys):
        """「沿用 rbac」读起来是整段照搬，而这里其实动了它的 permissions。
        不说的话就是「东西看着是旧的、其实改过」，出问题时对不出账。"""
        apply_refine_segment_reuse(_perm_fresh(), _perm_baseline(), [], gate_fn=_gate)
        out = capsys.readouterr().out
        assert "wo:export" in out, "并了权限却没在日志里说是哪几条"

    def test_没什么可并时原样返回(self):
        """页面没引用任何新权限时不该无中生有地改 rbac。"""
        from services.spec_first_pipeline import merge_needed_permissions

        base = _perm_baseline()
        merged, added = merge_needed_permissions(base["rbac"], base)
        assert added == [], f"没东西可并却并了 {added}"
        assert merged is base["rbac"], "没可并的还是复制了一份，白费"


class Test两个开关:
    """⚠ 开关最贵的失效方式是**传丢了不报错**：A/B 的两臂悄悄变成同一臂，
    跑出「看起来 n=10 其实 10 个都是同一边」的假数据。所以每条都验正反两向。
    """

    def test_默认两个都开(self, monkeypatch):
        monkeypatch.delenv("SLIDERULE_REFINE_REUSE_1MAXIMAL", raising=False)
        monkeypatch.delenv("SLIDERULE_REFINE_RBAC_MERGE", raising=False)
        monkeypatch.delenv("SLIDERULE_REFINE_REF_ALIGN", raising=False)
        assert sfp.refine_reuse_1maximal_enabled() is True
        assert sfp.refine_rbac_merge_enabled() is True
        assert sfp.refine_ref_align_enabled() is True

    def test_策略状态每轮都说出来_两个开关都在里面(self, capsys):
        apply_refine_segment_reuse(_perm_fresh(), _perm_baseline(), [], gate_fn=_gate)
        out = capsys.readouterr().out
        assert "沿用策略：" in out, "没打策略状态行——A/B 台子没法自证跑的是哪一臂"
        assert "1maximal=on" in out and "rbacmerge=on" in out
        assert "refalign=on" in out

    def test_关掉1maximal时退回按序丢(self, monkeypatch, capsys):
        """罪魁排在最前的场景：老行为必然退到空，这正是要治的病。"""
        monkeypatch.setenv("SLIDERULE_REFINE_REUSE_1MAXIMAL", "0")
        base, fresh = _baseline(), _fresh()

        def rbac_is_the_culprit(model):
            if _fp(model["rbac"]) == _fp(base["rbac"]):
                return {"passed": False, "findings": [{"path": "page", "message": "缺权限"}]}
            return {"passed": True, "findings": []}

        out = apply_refine_segment_reuse(fresh, base, [], gate_fn=rbac_is_the_culprit)
        for seg in ("workflow", "aigc"):
            assert _fp(out[seg]) == _fp(fresh[seg]), (
                f"开关关了却还是保住了 {seg}——老行为没被真正退回，对照臂是假的"
            )
        assert "1maximal=off" in capsys.readouterr().out

    def test_关掉rbac合并时不并权限(self, monkeypatch, capsys):
        monkeypatch.setenv("SLIDERULE_REFINE_RBAC_MERGE", "0")
        out = apply_refine_segment_reuse(
            _perm_fresh(), _perm_baseline(), [], gate_fn=_gate
        )
        assert _fp(out["rbac"]) == _fp(_perm_fresh()["rbac"]), (
            "合并关了，rbac 却不是新生成的那份——关掉后本该过不了闸而回落"
        )
        log = capsys.readouterr().out
        assert "rbacmerge=off" in log
        assert "并入本轮页面需要的权限" not in log, "开关关了日志却还在说并了权限"

    def test_两个开关互相独立(self, monkeypatch, capsys):
        """只关合并时，1-maximal 仍该生效——这正是留两根杆的意义。"""
        monkeypatch.setenv("SLIDERULE_REFINE_RBAC_MERGE", "0")
        base, fresh = _baseline(), _fresh()

        def rbac_is_the_culprit(model):
            if _fp(model["rbac"]) == _fp(base["rbac"]):
                return {"passed": False, "findings": [{"path": "page", "message": "缺权限"}]}
            return {"passed": True, "findings": []}

        out = apply_refine_segment_reuse(fresh, base, [], gate_fn=rbac_is_the_culprit)
        for seg in ("workflow", "aigc"):
            assert _fp(out[seg]) == _fp(base[seg]), (
                f"只关了合并，{seg} 却没保住——两个开关黏在一起了，"
                f"线上想只退合并时会把没问题的 1-maximal 一起赔掉"
            )
        log = capsys.readouterr().out
        assert "1maximal=on rbacmerge=off" in log
        assert "refalign=on" in log


def _allergy_baseline() -> dict:
    """过夜食堂那轮：过敏核验能力指着 resident.age。"""
    return {
        "datamodel": {"entities": [
            {"id": "resident", "name": "住户", "fields": [
                {"id": "name", "name": "姓名", "type": "string"},
                {"id": "age", "name": "年龄", "type": "number"},
            ]},
        ]},
        "rbac": {"roles": [{"id": "chef", "name": "厨师"}]},
        "workflow": {"id": "meal_flow", "nodes": [
            {"id": "n1", "name": "核验", "assigneeRole": "chef"},
        ]},
        "page": {"pages": [{"id": "p1", "name": "订餐页", "fieldBindings": ["resident.name"]}]},
        "aigc": {"capabilities": [
            {"id": "ai_allergy_check", "name": "过敏核验",
             "inputFields": ["resident.age", "resident.name"], "roleRefs": ["chef"]},
        ]},
        "appbundle": {
            "landingPageRef": "p1", "preferredDevice": "desktop",
            "pageBindings": [{"pageRef": "p1", "workflowRef": "meal_flow"}],
            "roleRefs": ["chef"], "dataModelRefs": ["resident"],
        },
    }


def _allergy_fresh() -> dict:
    """本轮 datamodel 丢掉 age；新 aigc / workflow 被重写成更薄的一份。"""
    m = copy.deepcopy(_allergy_baseline())
    m["datamodel"]["entities"][0]["fields"] = [
        {"id": "name", "name": "姓名", "type": "string"},
        {"id": "birth_date", "name": "生日", "type": "date"},
    ]
    m["aigc"] = {"capabilities": [
        {"id": "c9", "name": "重写过的能力", "inputFields": ["resident.name"], "roleRefs": ["chef"]},
    ]}
    m["workflow"] = {"id": "main_flow", "nodes": [
        {"id": "z9", "name": "重写", "assigneeRole": "chef"},
    ]}
    m["appbundle"]["pageBindings"] = [{"pageRef": "p1", "workflowRef": "main_flow"}]
    return m


class Test字段对不上不整段扔:
    """过夜食堂/咖啡馆：一个字段对不上就把整段 aigc 扔了，闭环仍绿灯。

    删掉 apply_refine_segment_reuse.build 里 align_reused_aigc 那一针，下面必红。
    """

    def test_悬空字段剪掉_能力还在(self):
        base, fresh = _allergy_baseline(), _allergy_fresh()
        out = apply_refine_segment_reuse(fresh, base, [], gate_fn=_gate)
        caps = (out.get("aigc") or {}).get("capabilities") or []
        ids = [c.get("id") for c in caps if isinstance(c, dict)]
        assert "ai_allergy_check" in ids, (
            f"aigc 被整段扔了（看到 {ids}）——过夜就是闭环绿灯、过敏核验没了"
        )
        assert "c9" not in ids, "回落到新生成的薄 aigc 了，判据会被回落路径白送绿灯"
        fields = caps[0].get("inputFields") or []
        assert "resident.age" not in fields, "悬空字段没剪掉，闸还会拒、整段再被扔"
        assert "resident.name" in fields

    def test_字段只是改了id_按名字拨回(self):
        base = _allergy_baseline()
        fresh = _allergy_fresh()
        fresh["datamodel"]["entities"][0]["fields"] = [
            {"id": "name", "name": "姓名", "type": "string"},
            {"id": "years", "name": "年龄", "type": "number"},
        ]
        out = apply_refine_segment_reuse(fresh, base, [], gate_fn=_gate)
        fields = out["aigc"]["capabilities"][0]["inputFields"]
        assert "resident.years" in fields, f"同名字段没拨回去：{fields}"
        assert "resident.age" not in fields
        assert out["aigc"]["capabilities"][0]["id"] == "ai_allergy_check"

    def test_workflowRef漂了_旧流程还在(self):
        """咖啡馆第一轮：appbundle 指 main_flow，旧流程是 meal_flow，整段 workflow 被连坐。"""
        base, fresh = _allergy_baseline(), _allergy_fresh()
        out = apply_refine_segment_reuse(fresh, base, [], gate_fn=_gate)
        assert out["workflow"]["id"] == "meal_flow", (
            "workflow 被整段扔了——连接表一个号对不上就连坐"
        )
        wref = (out["appbundle"]["pageBindings"] or [{}])[0].get("workflowRef")
        assert wref == "meal_flow", f"连接表没拨到旧流程：{wref}"

    def test_开关关掉退回整段扔(self, monkeypatch):
        """反向：关掉对齐必须回到过夜行为，否则杆是假的。"""
        monkeypatch.setenv("SLIDERULE_REFINE_REF_ALIGN", "0")
        base, fresh = _allergy_baseline(), _allergy_fresh()
        out = apply_refine_segment_reuse(fresh, base, [], gate_fn=_gate)
        ids = [c.get("id") for c in (out["aigc"].get("capabilities") or [])]
        assert ids == ["c9"], (
            f"关了对齐还保住了旧能力 {ids}——杆没接到真正改内容的那一步"
        )

    def test_对齐时打日志(self, capsys):
        apply_refine_segment_reuse(_allergy_fresh(), _allergy_baseline(), [], gate_fn=_gate)
        out = capsys.readouterr().out
        assert "对齐 aigc" in out and "resident.age" in out, (
            f"剪了字段却不说：{out[:400]}"
        )
        assert "refalign=on" in out

    def test_真实链路出口也不扔(self, monkeypatch):
        """纪律一：只测 helper 会假绿。assemble 出口必须还是旧能力。"""
        import services.html_bindings as hb
        import services.html_structure as hs
        import services.model_assembly as ma
        import services.page_shell as ps
        import services.spec_page_html as sph
        import services.spec_semantics as ss
        import services.spec_tree as spec_tree

        spec = {
            "rootNodeId": "n0", "version": 3, "appName": "食堂",
            "personas": [{"id": "u1", "name": "厨师", "goals": ["核验"]}],
            "successCriteria": [{"id": "sc1", "text": "过敏不漏"}],
            "nodes": [], "pages": [{"id": "p1", "name": "订餐页"}],
            "refineScope": [],
        }
        monkeypatch.setattr(spec_tree, "generate_spec_tree", lambda goal, **kw: spec)
        monkeypatch.setattr(
            sph, "generate_pages_parallel",
            lambda s, **kw: {"pages": {"p1": "<html>x</html>"}, "failed": {}},
        )
        monkeypatch.setattr(ps, "unify_shell", lambda pages, s, **kw: {"pages": dict(pages)})
        monkeypatch.setattr(ps, "check_shell_consistency", lambda *a, **kw: [])
        monkeypatch.setattr(
            ps, "repair_pages_after_bind", lambda pages, before, **kw: (dict(pages), [], [])
        )
        monkeypatch.setattr(
            hs, "derive_structure", lambda pages, **kw: {"entities": [], "pages": []}
        )
        monkeypatch.setattr(
            ss, "derive_semantics", lambda st, s, **kw: {"roles": [], "workflowNodes": []}
        )
        monkeypatch.setattr(
            ma, "assemble",
            lambda *a, **k: {"model": _allergy_fresh(), "gate": {"passed": True, "findings": []}},
        )
        monkeypatch.setattr(
            hb, "bind_pages", lambda pages, model, **kw: {"pages": dict(pages), "failed": {}}
        )
        out = sfp.run_spec_first(
            "食堂订餐过敏",
            refine={"instruction": "加一列过敏原", "modelDigest": "实体：住户"},
            reuse_model=_allergy_baseline(),
        )
        ids = [c.get("id") for c in (out["model"]["aigc"].get("capabilities") or [])]
        assert "ai_allergy_check" in ids, (
            f"真实链路出口把 aigc 扔了（{ids}）——接线断了"
        )
