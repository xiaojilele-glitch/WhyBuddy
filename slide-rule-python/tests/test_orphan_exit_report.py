# -*- coding: utf-8 -*-
"""断线体检接到交付出口：改完报孤岛，只报不拦（2026-08-17）。

## 病灶

find_orphans 写好之后（test_app_graph.Test断线体检）一直没接线：体检逻辑
服务端有了，但**没有任何一处调它**——生成出来的应用照样可以带着孤岛交付，
只有人打开前端沙盘才看得见。CLAUDE.md 第三条的原话形态：函数写对了 ≠
它被调用了。

## 上报口径：新增与存量分开（baseline-ratchet）

精修轮把「这次修改新产生的孤岛」和「上一版就有的存量」分开报——存量不是
这次修改造成的，混在一起报，"改坏了什么"会被淹没。口径同 SonarQube
Clean as You Code / betterer：只对"新代码"较真，存量另册记账。

## 这组判据守四件事

1. 交付带孤岛时**说得出话**（新建应用也报，不只精修）。
2. 精修轮新增/存量分开，存量不许冒充新增。
3. 体检自己炸了**不拦交付**（纪律七：增强类 fail-open）。
4. 没有孤岛时**一声不吭**——把正常也报出来，这条提示很快会被当噪音忽略。
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


#: 带一个孤岛：entity:lonely 没有任何页面读它、没有 AIGC 写它。
MODEL_WITH_ORPHAN = {
    "datamodel": {"entities": [
        {"id": "used", "name": "用着的", "fields": [{"id": "f", "name": "F"}]},
        {"id": "lonely", "name": "没人读的", "fields": [{"id": "g", "name": "G"}]},
    ]},
    "rbac": {"roles": [], "permissions": []},
    "page": {"pages": [{"id": "p1", "name": "页", "fieldBindings": ["used.f"]}]},
}

#: 全接通：没有孤岛。
MODEL_CLEAN = {
    "datamodel": {"entities": [
        {"id": "used", "name": "用着的", "fields": [{"id": "f", "name": "F"}]},
    ]},
    "rbac": {"roles": [], "permissions": []},
    "page": {"pages": [{"id": "p1", "name": "页", "fieldBindings": ["used.f"]}]},
}

SPEC = {
    "rootNodeId": "n0", "version": 3, "appName": "维保云",
    "personas": [{"id": "u1", "name": "维修主管", "goals": ["派工"]}],
    "successCriteria": [{"id": "sc1", "text": "24 小时内派工"}],
    "nodes": [], "pages": [{"id": "p1", "name": "页"}],
}


def _drive(monkeypatch, *, assembled_model, refine=False, reuse_model=None):
    """跑真实 run_spec_first 控制流（harness 抄自 test_refine_id_freezing）。"""
    import services.html_bindings as hb
    import services.html_structure as hs
    import services.model_assembly as ma
    import services.page_shell as ps
    import services.refine_graph_scope as rgs
    import services.spec_page_html as sph
    import services.spec_semantics as ss
    import services.spec_tree as spec_tree
    from services import spec_first_pipeline as sfp

    monkeypatch.setattr(spec_tree, "generate_spec_tree", lambda g, **kw: dict(SPEC))
    # 图判作用域（影子）与本文件无关，静音省一次假 LLM 往返。
    monkeypatch.setattr(rgs, "decide_seed_nodes", lambda i, g, **kw: None)
    monkeypatch.setattr(
        sph, "generate_pages_parallel",
        lambda s, **kw: {"pages": {"p1": "<html>x</html>"}, "failed": {}},
    )
    monkeypatch.setattr(ps, "unify_shell", lambda p, s, **kw: {"pages": dict(p)})
    monkeypatch.setattr(ps, "check_shell_consistency", lambda *a, **kw: [])
    monkeypatch.setattr(ps, "repair_pages_after_bind", lambda p, b, **kw: (dict(p), [], []))
    monkeypatch.setattr(hs, "derive_structure", lambda p, **kw: {"entities": [], "pages": []})
    monkeypatch.setattr(ss, "derive_semantics", lambda st, sp, **kw: {"roles": []})
    monkeypatch.setattr(
        ma, "assemble",
        lambda *a, **k: {"model": dict(assembled_model), "gate": {"passed": True}},
    )
    monkeypatch.setattr(
        hb, "bind_pages", lambda p, m, **kw: {"pages": dict(p), "failed": {}}
    )

    return sfp.run_spec_first(
        "做个工单系统",
        refine=({"instruction": "改点东西", "modelDigest": "d"} if refine else None),
        reuse_model=reuse_model,
    )


class Test交付时说得出话:
    def test_新建应用带孤岛也报(self, monkeypatch, capsys):
        """体检不只属于精修：新建就带孤岛的应用同样只有沙盘看得见。"""
        out_model = _drive(monkeypatch, assembled_model=MODEL_WITH_ORPHAN)
        text = capsys.readouterr().out
        assert "交付的应用带着 1 个孤岛" in text
        assert "entity:lonely" in text and "孤岛" in text
        assert out_model.get("model"), "只报不拦——报了归报了，交付照常"
        notices = out_model.get("qualityNotices") or []
        assert any(n.get("kind") == "orphan" for n in notices), (
            "孤岛只打了 stderr，交付面拿不到"
        )
        from services import spec_first_pipeline as sfp

        blob = sfp.take_last_pages() or {}
        carrier = blob.get("qualityNotices") or []
        assert any(n.get("kind") == "orphan" for n in carrier), (
            "孤岛没随页面载体落库——刷新后交付面又看不见"
        )

    def test_体检结果记进stages(self, monkeypatch):
        """日志会滚走；stages 落在返回值里，排查时对得上账。"""
        out = _drive(monkeypatch, assembled_model=MODEL_WITH_ORPHAN)
        rec = out["stages"]["orphans"]
        assert rec["total"] == 1 and rec["new"] == 1 and rec["baseline"] is False

    def test_没有孤岛时一声不吭(self, monkeypatch, capsys):
        """反向判据：把正常也报出来，这条提示会被当噪音，真出事时没人看。"""
        out = _drive(monkeypatch, assembled_model=MODEL_CLEAN)
        assert "孤岛" not in capsys.readouterr().out
        notices = out.get("qualityNotices") or []
        assert not any(n.get("kind") == "orphan" for n in notices)


class Test精修轮_新增与存量分开:
    def test_上一版没有这次有_算新增(self, monkeypatch, capsys):
        """「改一页把某实体的最后一个引用删掉」的那种孤岛——这次修改造成的。"""
        _drive(monkeypatch, assembled_model=MODEL_WITH_ORPHAN,
               refine=True, reuse_model=MODEL_CLEAN)
        text = capsys.readouterr().out
        assert "这次修改新产生 1 个孤岛" in text and "entity:lonely" in text

    def test_上一版就有的算存量_不冒充新增(self, monkeypatch, capsys):
        """反向判据：存量混进新增，"改坏了什么"会被淹没（baseline-ratchet 口径）。"""
        _drive(monkeypatch, assembled_model=MODEL_WITH_ORPHAN,
               refine=True, reuse_model=MODEL_WITH_ORPHAN)
        text = capsys.readouterr().out
        assert "新产生" not in text, "上一版就有的孤岛被算成了这次修改的锅"
        assert "存量孤岛 1 个" in text and "非本次造成" in text

    def test_stages里新增与存量各记各的(self, monkeypatch):
        out = _drive(monkeypatch, assembled_model=MODEL_WITH_ORPHAN,
                     refine=True, reuse_model=MODEL_WITH_ORPHAN)
        rec = out["stages"]["orphans"]
        assert rec == {"total": 1, "new": 0, "stale": 1, "baseline": True}


class Test体检在打孔之后:
    def test_源码顺序_先bind再find_orphans(self):
        """⚠ 打孔前体检会把指南页报成孤岛。钉活路径的顺序，不钉措辞。"""
        import inspect
        import re
        from services import spec_first_pipeline as sfp

        src = inspect.getsource(sfp.run_spec_first)
        code = re.sub(r'""".*?"""', "", src, flags=re.S)
        code = re.sub(r"#.*", "", code)
        assert code.index("bound = bind_pages") < code.index("_cur_orphans"), (
            "断线体检又跑到打孔前面了——page 孤岛会谎报"
        )
        assert "page_html=pages" in src, "交付出口没把打过孔的 HTML 传给体检"


class Test只报不拦:
    def test_体检自己炸了不拦交付(self, monkeypatch, capsys):
        """纪律七：体检是增强类。它炸了交付必须照常，且要说得出话。"""
        import services.app_graph as ag

        def boom(graph):
            raise RuntimeError("体检炸了")

        monkeypatch.setattr(ag, "find_orphans", boom)
        out = _drive(monkeypatch, assembled_model=MODEL_WITH_ORPHAN)
        assert out.get("model"), "体检把交付拖死了——增强类写成了 fail-closed"
        assert "不拦交付" in capsys.readouterr().out

    def test_Windows控制台打不出警告符_不拦交付(self, monkeypatch):
        """2026-08-18 真机：⚠ 在 GBK 控制台 UnicodeEncodeError，except 再
        print 一遍 ⚠ 又炸，逃出 try，spec-first 整条回落老链路。

        判据盯的是**交付还在**，不是日志里还有没有那个符号——符号打不出
        是控制台的事，把主链路拖死才是事故。
        """

        class GbkConsole:
            encoding = "gbk"

            def write(self, s):
                s.encode("gbk")  # ⚠ 在这里炸，跟真机控制台同一形状
                return len(s)

            def flush(self):
                return None

        monkeypatch.setattr(sys, "stdout", GbkConsole())
        out = _drive(monkeypatch, assembled_model=MODEL_WITH_ORPHAN)
        assert out.get("model"), "⚠ 打不出就把交付拖死了——跟真机回落老链路同一形状"


class Test图判降级上到交付面:
    def test_精修图判缺席进qualityNotices(self, monkeypatch):
        """drive_on 但种子是空：必须能在交付面看见降级，不只 stderr。"""
        out = _drive(
            monkeypatch,
            assembled_model=MODEL_CLEAN,
            refine=True,
            reuse_model=MODEL_CLEAN,
        )
        notices = out.get("qualityNotices") or []
        assert any(n.get("kind") == "graph_scope_fallback" for n in notices), (
            "图判回落文本判只打了日志，交付面拿不到"
        )
        assert any("回落文本判" in str(n.get("text") or "") for n in notices)

    def test_新建不跑图判就不要冒降级(self, monkeypatch):
        """反向：新建路径没有 graphscope，不许假装降级过。"""
        out = _drive(monkeypatch, assembled_model=MODEL_CLEAN)
        notices = out.get("qualityNotices") or []
        assert not any(n.get("kind") == "graph_scope_fallback" for n in notices)


class Test对比告警上到交付面:
    def test_浅字浅底写进qualityNotices(self, monkeypatch):
        """_ggn 的出口必须接到 _emit_quality_notice。只测 helper 会假绿。"""
        import services.spec_page_html as sph

        seen: list = []

        def fake_ggn(html, **kw):
            seen.append(str(html or ""))
            return ["浅字浅底，对比可能不够"]

        monkeypatch.setattr(sph, "guidelines_gate_notes", fake_ggn)
        out = _drive(monkeypatch, assembled_model=MODEL_CLEAN)
        assert seen, "交付出口没调 guidelines_gate_notes"
        notices = out.get("qualityNotices") or []
        assert any(n.get("kind") == "contrast" for n in notices), (
            "对比告警只在 guidelines_gate_notes 里，没送到交付面"
        )
        assert any("对比" in str(n.get("text") or "") for n in notices)

    def test_反向没有对比二字就不报contrast(self, monkeypatch):
        import services.spec_page_html as sph

        monkeypatch.setattr(
            sph, "guidelines_gate_notes", lambda html, **kw: ["表/列表没有行，也没有空态文案"]
        )
        out = _drive(monkeypatch, assembled_model=MODEL_CLEAN)
        notices = out.get("qualityNotices") or []
        assert not any(n.get("kind") == "contrast" for n in notices)


def test_流式驱动把质量提示送上SSE():
    """函数写对了 ≠ 它被调用了。删 yield quality_notice 必须红。"""
    import inspect
    import re

    from services import v5_full_driver as drv

    src = inspect.getsource(drv.drive_full_v5_session_stream)
    code = re.sub(r'""".*?"""', "", src, flags=re.S)
    code = re.sub(r"#.*", "", code)
    assert "quality_sink_scope" in code
    assert '"quality_notice"' in code
    assert "yield" in code

