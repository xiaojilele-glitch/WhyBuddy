# -*- coding: utf-8 -*-
"""精修时 id 必须冻结：同一个概念不许每轮换一个 id（2026-08-17）。

## 病灶（真机实测，量法见 experiments/refine-fingerprint/）

精修第二轮，同一个「社区养老站长」拿到过三套 id：

    station_manager  →  role_station_manager  →  manager_role
    elder:read       →  care_order:read       →  elder_archive:read
    wo_created       →  wf_pending            →  node_pending

后果有两层：

1. **逐段指纹 0/6 里有四段是这个造成的**，不是内容真被重写
   （rbac.roles 名字 3/3 相同、id 0/3 相同；page 甚至 id 和名字都 5/5 相同，
   只因引用了被改名的权限才变）。四次修复的方案选型都被这个读数误导过。
2. 逐段沿用**一段都成功不了**：混合两轮的模型必然违反引用完整性闸——
   沿用 rbac 则新 page 的权限悬空，只沿用别的则新 workflow 的角色悬空。

根因：refine 上下文只到达第 2 步，而铸 id 的是第 4 步（实体/字段）和
第 5 步（角色/流程节点）。`grep -c refine` 在那两个文件里都是 0。

## 做法不是新发明

identifier freezing（RecLLM/Reformer 保证重训练前后 item id 不变）、
MCP 的 LFID 提案（语义信号与稳定 canonical_id 分开）都是同一个路子。
本仓自己也早有同款：`html_structure.build_prompt` 第 5 条「sourcePageId
照抄上面给你的页面 id，不要自己改名」——而实测**唯一 id 保住 5/5 的段
恰好就是 page**。这组测试守的是把它推广到实体/角色/节点这件事。

⚠ 2026-08-18 过夜：提示词接线全绿，页 id 照样漂。结构拨回的单元形状在
`test_page_id_freeze.py`；本文件补的是**调用点**——generate_pages_parallel
必须看到拨回后的 id。把 freeze_spec_pages 那一针拔掉，下面过夜形状必红。
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

from services.spec_first_pipeline import model_id_lexicon  # noqa: E402


BASELINE = {
    "datamodel": {"entities": [
        {"id": "elder", "name": "老人档案", "fields": [
            {"id": "name", "name": "姓名"}, {"id": "age", "name": "年龄"},
        ]},
        {"id": "work_order", "name": "服务工单", "fields": [{"id": "no", "name": "工单编号"}]},
    ]},
    "rbac": {
        "roles": [
            {"id": "station_manager", "name": "社区养老站长"},
            {"id": "nursing_staff", "name": "助老护理员"},
        ],
        "permissions": ["elder:read", "elder:create"],
    },
    "workflow": {"nodes": [
        {"id": "wo_created", "name": "待派单", "assigneeRole": "station_manager"},
        {"id": "wo_closed", "name": "工单关闭", "assigneeRole": "station_manager"},
    ]},
    "page": {"pages": [{"id": "p1", "name": "工单页"}]},
}


class Test词表:
    def test_摘出页面的id与名字(self):
        """★ 页面档（2026-08-17 晚补）。页面 id 在第 2 步（SPEC）铸出来，
        跟实体/角色/节点不同——所以词表带上它，冻结针下在第 2 步。

        真机证据：第二轮页面 id 从 p1..p4 整套重铸成 elder_management 等，
        HTML 侧的键与模型侧交集为空。页面 id 一漂，按需重画的照搬和图判
        作用域的"重画这一页"都对不上号。
        """
        lex = model_id_lexicon(BASELINE)
        assert [(p["id"], p["name"]) for p in lex["pages"]] == [("p1", "工单页")]

    def test_摘出实体字段角色节点的id与名字(self):
        lex = model_id_lexicon(BASELINE)
        assert [(e["id"], e["name"]) for e in lex["entities"]] == [
            ("elder", "老人档案"), ("work_order", "服务工单"),
        ]
        assert [(r["id"], r["name"]) for r in lex["roles"]] == [
            ("station_manager", "社区养老站长"), ("nursing_staff", "助老护理员"),
        ]
        assert [(n["id"], n["name"]) for n in lex["workflowNodes"]] == [
            ("wo_created", "待派单"), ("wo_closed", "工单关闭"),
        ]
        assert [(f["id"], f["name"]) for f in lex["entities"][0]["fields"]] == [
            ("name", "姓名"), ("age", "年龄"),
        ]

    def test_不是模型就返回空(self):
        assert model_id_lexicon(None) == {}
        assert model_id_lexicon("不是字典") == {}  # type: ignore[arg-type]
        assert model_id_lexicon({}) == {}

    def test_词表不含权限(self):
        """权限的形状是 `<实体id>:create`，**由实体 id 决定**，不是独立事实。

        把它也放进词表，就等于对同一件事有两个真相：实体改名时权限表还留着
        旧的，对不上时不知道该信哪个。反向判据钉在**词表**这一层而不是提示词
        那一层——提示词那条挡不住"有人先往词表里加"（2026-08-17 变异实测：
        只改提示词循环是个空操作，因为词表里根本没这个键，判据咬不住）。
        """
        lex = model_id_lexicon(BASELINE)
        assert "permissions" not in lex, (
            "词表带上了权限——它该跟着实体 id 走，两处各说一套迟早对不齐"
        )
        import json
        assert "elder:read" not in json.dumps(lex, ensure_ascii=False)

    def test_不带绑定与主题这些无关细节(self):
        """跟 model_refine_digest 同一条纪律：是摘要不是全量。"""
        big = dict(BASELINE)
        big["appbundle"] = {"themeToken": "深蓝夜色", "landingPageRef": "p1"}
        lex = model_id_lexicon(big)
        import json
        assert "深蓝夜色" not in json.dumps(lex, ensure_ascii=False)


class Test提示词:
    def test_第4步给出实体id并要求照抄(self):
        from services.html_structure import build_prev_ids_block

        block = build_prev_ids_block(model_id_lexicon(BASELINE))
        assert "elder" in block and "老人档案" in block
        assert "照抄" in block, "没要求照抄，摆一堆 id 出来模型不知道要干嘛"
        assert "name" in block or "名字" in block, "没说清判断依据是名字"

    def test_第5步给出角色与节点id并要求照抄(self):
        from services.spec_semantics import build_prev_ids_block

        block = build_prev_ids_block(model_id_lexicon(BASELINE))
        assert "station_manager" in block and "社区养老站长" in block
        assert "wo_created" in block and "待派单" in block
        assert "照抄" in block

    def test_第2步给出页面id并要求照抄(self):
        """页面 id 冻结的硬词表块。此前 SPEC 步对 id 只有一句"保持一致"的
        软约束——求自觉，真机实测求不动（同一个教训第三次了：逐段指纹 0/6、
        角色三套 id、页面整套重铸）。
        """
        from services.spec_tree import build_spec_prompt

        lex = model_id_lexicon(BASELINE)
        user = build_spec_prompt(
            "做个工单系统",
            refine={"instruction": "加点模拟数据", "modelDigest": "d"},
            prev_pages=lex["pages"],
        )[-1]["content"]
        assert "p1" in user and "工单页" in user
        assert "照抄" in user, "没要求照抄，摆一份页面清单出来模型不知道要干嘛"
        assert "名字" in user, "没说清判断锚是名字（顺序会变，名字不会）"
        assert "新增" in user, "没给新页面留出口——全冻死的话加页需求会被憋成改旧页"

    def test_非精修轮不带页面块(self):
        """反向判据：新建应用没有上一版。prev_pages 只在 refine 分支里生效，
        单独传了也必须逐字不变——防止哪天有人把它挪出 refine 分支。
        """
        from services.spec_tree import build_spec_prompt

        lex = model_id_lexicon(BASELINE)
        assert build_spec_prompt("做个工单系统") == build_spec_prompt(
            "做个工单系统", prev_pages=lex["pages"]
        )

    def test_精修但没有页面词表时提示词不变(self):
        from services.spec_tree import build_spec_prompt

        refine = {"instruction": "加点模拟数据", "modelDigest": "d"}
        assert build_spec_prompt("做个工单系统", refine=refine) == build_spec_prompt(
            "做个工单系统", refine=refine, prev_pages=None
        )
        assert "页面 id 冻结" not in build_spec_prompt("做个工单系统", refine=refine)[-1]["content"]

    def test_第5步不列权限(self):
        """反向判据：权限形状是 `<实体id>:create`，**跟着实体 id 走**。

        再单独列一份权限表就是给同一件事两个真相，对不上时不知道信谁。
        """
        from services.spec_semantics import build_prev_ids_block

        block = build_prev_ids_block(model_id_lexicon(BASELINE))
        assert "elder:read" not in block, (
            "第 5 步列了权限——它该由实体 id 决定，两处各说一套迟早对不齐"
        )

    def test_没有上一版时块是空串(self):
        from services.html_structure import build_prev_ids_block as b4
        from services.spec_semantics import build_prev_ids_block as b5

        for b in (b4, b5):
            assert b(None) == ""
            assert b({}) == ""

    def test_非精修轮的提示词逐字不变(self):
        """反向判据。新建应用没有上一版，多这一段等于给它一批无关 id。"""
        from services.html_structure import build_prompt as p4
        from services.spec_semantics import build_prompt as p5

        html = {"p1": "<html><h1>工单</h1></html>"}
        assert p4(html, "做个工单系统") == p4(html, "做个工单系统", prev_ids=None)
        assert p4(html, "做个工单系统") == p4(html, "做个工单系统", prev_ids={})

        structure = {"entities": [], "pages": []}
        spec = {"personas": [], "nodes": []}
        assert p5(structure, spec) == p5(structure, spec, prev_ids=None)
        assert "上一版已经有的" not in p5(structure, spec)[-1]["content"]


class Test接线_三步都要传:
    """★ 纪律四：只改一半必然静默失效。

    第 2 步管页面 id（铸造点在 SPEC），第 4 步管实体/字段 id，第 5 步管
    角色/节点 id。**少接哪一步，那一类 id 就照旧每轮重铸**，而且不会报错
    ——正是本仓反复踩的形状。这组跑真实的 run_spec_first 控制流，
    三步各捕一次实参。（2026-08-17 晚从"两步"升成"三步"：页面档补上时，
    这个类名和下面的判据必须一起动，别只加一条正向的。）
    """

    SPEC = {
        "rootNodeId": "n0", "version": 3, "appName": "维保云",
        "personas": [{"id": "u1", "name": "维修主管", "goals": ["派工"]}],
        "successCriteria": [{"id": "sc1", "text": "24 小时内派工"}],
        "nodes": [], "pages": [{"id": "p1", "name": "工单页"}],
    }

    def _drive(self, monkeypatch, *, refine, reuse_model):
        import services.html_bindings as hb
        import services.html_structure as hs
        import services.model_assembly as ma
        import services.page_shell as ps
        import services.spec_page_html as sph
        import services.spec_semantics as ss
        import services.spec_tree as spec_tree
        from services import spec_first_pipeline as sfp

        seen = {}

        def fake_spec(g, **kw):
            seen["spec_prev_pages"] = kw.get("prev_pages")
            return dict(self.SPEC)

        monkeypatch.setattr(spec_tree, "generate_spec_tree", fake_spec)
        monkeypatch.setattr(
            sph, "generate_pages_parallel",
            lambda s, **kw: {"pages": {"p1": "<html>x</html>"}, "failed": {}},
        )
        monkeypatch.setattr(ps, "unify_shell", lambda p, s, **kw: {"pages": dict(p)})
        monkeypatch.setattr(ps, "check_shell_consistency", lambda *a, **kw: [])
        monkeypatch.setattr(ps, "repair_pages_after_bind", lambda p, b, **kw: (dict(p), [], []))

        def fake_structure(pages, **kw):
            seen["structure_prev_ids"] = kw.get("prev_ids")
            return {"entities": [], "pages": []}

        def fake_semantics(st, sp, **kw):
            seen["semantics_prev_ids"] = kw.get("prev_ids")
            return {"roles": [], "workflowNodes": []}

        monkeypatch.setattr(hs, "derive_structure", fake_structure)
        monkeypatch.setattr(ss, "derive_semantics", fake_semantics)
        monkeypatch.setattr(
            ma, "assemble",
            lambda *a, **k: {"model": {"datamodel": {}}, "gate": {"passed": True}},
        )
        monkeypatch.setattr(hb, "bind_pages", lambda p, m, **kw: {"pages": dict(p), "failed": {}})

        sfp.run_spec_first(
            "做一个维保工单系统",
            refine=({"instruction": "加点模拟数据", "modelDigest": "d"} if refine else None),
            reuse_model=reuse_model,
        )
        return seen

    def test_第2步收到页面id词表(self, monkeypatch, capsys):
        seen = self._drive(monkeypatch, refine=True, reuse_model=BASELINE)
        assert seen["spec_prev_pages"] == [{"id": "p1", "name": "工单页"}], (
            "第 2 步没收到页面词表——页面 id 照旧每轮重铸，"
            "按需重画的照搬和图判作用域的页 id 都会对不上号"
        )
        assert "页面 1" in capsys.readouterr().out, "冻结日志没报页面档，线上无从确认它生效"

    def test_第4步收到实体id词表(self, monkeypatch):
        seen = self._drive(monkeypatch, refine=True, reuse_model=BASELINE)
        lex = seen["structure_prev_ids"]
        assert lex, "第 4 步没收到词表——实体 id 照旧每轮重铸"
        assert [e["id"] for e in lex["entities"]] == ["elder", "work_order"]

    def test_第5步收到角色与节点id词表(self, monkeypatch):
        seen = self._drive(monkeypatch, refine=True, reuse_model=BASELINE)
        lex = seen["semantics_prev_ids"]
        assert lex, "第 5 步没收到词表——角色 id 照旧每轮重铸"
        assert [r["id"] for r in lex["roles"]] == ["station_manager", "nursing_staff"]
        assert [n["id"] for n in lex["workflowNodes"]] == ["wo_created", "wo_closed"]

    def test_非精修轮三步都不带词表(self, monkeypatch):
        seen = self._drive(monkeypatch, refine=False, reuse_model=BASELINE)
        assert not seen["spec_prev_pages"]
        assert not seen["structure_prev_ids"]
        assert not seen["semantics_prev_ids"]

    def test_开关关掉时退回旧行为_且说得出话(self, monkeypatch, capsys):
        """既是线上一键回退，也是量因果用的对照臂开关。

        没有它就只能拿"改之前/改之后"比，而那两次往往还换了模型或话题——
        两个变量混在一起，量出来的数说明不了是谁起的作用。
        """
        monkeypatch.setenv("SLIDERULE_REFINE_ID_FREEZE", "0")
        seen = self._drive(monkeypatch, refine=True, reuse_model=BASELINE)
        assert not seen["spec_prev_pages"], "开关关了页面档还在传——对照臂被污染"
        assert not seen["structure_prev_ids"]
        assert not seen["semantics_prev_ids"]
        assert "开关关掉" in capsys.readouterr().out

    def test_精修但没有上一版时不炸_且说得出话(self, monkeypatch, capsys):
        """反向判据 + 留痕。这是"整个没生效"的那条静默路径。"""
        seen = self._drive(monkeypatch, refine=True, reuse_model=None)
        assert not seen["structure_prev_ids"]
        assert "id 冻结未生效" in capsys.readouterr().out, (
            "精修轮拿不到词表却一声不吭——线上表现是 id 照旧重铸，无从排查"
        )


class Test结构拨回_过夜形状:
    """纪律一：拨回必须赶在第 3 步之前。只测 freeze_spec_pages 本身，
    把调用点删掉照样全绿——过夜就是这个形状。
    """

    def _drive(self, monkeypatch, *, spec_pages, reuse_model, refine=True, reuse_pages=None):
        import services.html_bindings as hb
        import services.html_structure as hs
        import services.model_assembly as ma
        import services.page_shell as ps
        import services.refine_page_scope as rps
        import services.spec_page_html as sph
        import services.spec_semantics as ss
        import services.spec_tree as spec_tree
        from services import spec_first_pipeline as sfp

        seen = {}
        monkeypatch.setenv("SLIDERULE_GRAPH_SCOPE_SHADOW", "0")

        def fake_spec(g, **kw):
            return {
                "rootNodeId": "n0", "version": 3, "appName": "维保云",
                "personas": [{"id": "u1", "name": "维修主管", "goals": ["派工"]}],
                "successCriteria": [{"id": "sc1", "text": "24 小时内派工"}],
                "nodes": [],
                "pages": spec_pages,
            }

        def fake_pages(spec, **kw):
            seen["page_ids"] = [p["id"] for p in (spec.get("pages") or [])]
            seen["reuse_keys"] = sorted((kw.get("reuse_pages") or {}).keys())
            return {
                "pages": {pid: "<html>x</html>" for pid in seen["page_ids"]},
                "failed": {},
            }

        monkeypatch.setattr(spec_tree, "generate_spec_tree", fake_spec)
        monkeypatch.setattr(rps, "decide_pages_to_regenerate", lambda i, p, **kw: ["p2"])
        monkeypatch.setattr(sph, "generate_pages_parallel", fake_pages)
        monkeypatch.setattr(ps, "unify_shell", lambda p, s, **kw: {"pages": dict(p)})
        monkeypatch.setattr(ps, "check_shell_consistency", lambda *a, **kw: [])
        monkeypatch.setattr(ps, "repair_pages_after_bind", lambda p, b, **kw: (dict(p), [], []))
        monkeypatch.setattr(hs, "derive_structure", lambda p, **kw: {"entities": [], "pages": []})
        monkeypatch.setattr(ss, "derive_semantics", lambda st, sp, **kw: {"roles": []})
        monkeypatch.setattr(
            ma, "assemble",
            lambda *a, **k: {"model": {"datamodel": {}, "page": {"pages": []}}, "gate": {"passed": True}},
        )
        monkeypatch.setattr(hb, "bind_pages", lambda p, m, **kw: {"pages": dict(p), "failed": {}})

        sfp.run_spec_first(
            "做一个维保工单系统",
            refine=({"instruction": "把报表改一下", "modelDigest": "d"} if refine else None),
            reuse_model=reuse_model,
            reuse_pages=reuse_pages,
        )
        return seen

    def test_加后缀时第3步看到原id(self, monkeypatch):
        """过夜快递：SPEC 吐 p1_page，画页必须仍按 p1 当键，照搬才对得上。"""
        prev_html = {"p1": "<html>旧</html>", "p2": "<html>旧2</html>"}
        seen = self._drive(
            monkeypatch,
            spec_pages=[
                {"id": "p1_page", "name": "工单页", "purpose": "看工单", "audience": "主管"},
                {"id": "p2_page", "name": "报表页", "purpose": "看报表", "audience": "主管"},
            ],
            reuse_model={
                "page": {"pages": [
                    {"id": "p1", "name": "工单页"},
                    {"id": "p2", "name": "报表页"},
                ]}
            },
            reuse_pages=prev_html,
        )
        assert seen["page_ids"] == ["p1", "p2"], (
            f"第 3 步仍看到漂过的 id {seen['page_ids']}——"
            "结构拨回没接到 generate_spec_tree 出口，照搬/图判键对不上"
        )
        assert seen["reuse_keys"] == ["p1"], (
            f"照搬键是 {seen['reuse_keys']}，说明拨回没赶在 split_pages 之前"
        )

    def test_语义改名第3步看到原id(self, monkeypatch):
        """过夜活动室：equipment_hall 必须拨回 p1。"""
        seen = self._drive(
            monkeypatch,
            spec_pages=[
                {"id": "equipment_hall", "name": "工单页", "purpose": "看工单", "audience": "主管"}
            ],
            reuse_model={"page": {"pages": [{"id": "p1", "name": "工单页"}]}},
        )
        assert seen["page_ids"] == ["p1"]

    def test_加后缀丢页会补回(self, monkeypatch):
        """过夜物业：p2 失踪且其余加后缀 → 补回 p2。"""
        seen = self._drive(
            monkeypatch,
            spec_pages=[
                {"id": "p1_page", "name": "工单页", "purpose": "a", "audience": "u"},
                {"id": "p3_page", "name": "派工页", "purpose": "a", "audience": "u"},
            ],
            reuse_model={
                "page": {"pages": [
                    {"id": "p1", "name": "工单页"},
                    {"id": "p2", "name": "报表页"},
                    {"id": "p3", "name": "派工页"},
                ]}
            },
        )
        assert seen["page_ids"] == ["p1", "p2", "p3"]

    def test_真删不补(self, monkeypatch):
        seen = self._drive(
            monkeypatch,
            spec_pages=[
                {"id": "p1", "name": "工单页", "purpose": "a", "audience": "u"},
                {"id": "p3", "name": "派工页", "purpose": "a", "audience": "u"},
            ],
            reuse_model={
                "page": {"pages": [
                    {"id": "p1", "name": "工单页"},
                    {"id": "p2", "name": "报表页"},
                    {"id": "p3", "name": "派工页"},
                ]}
            },
        )
        assert seen["page_ids"] == ["p1", "p3"]

    def test_开关关掉不拨(self, monkeypatch):
        monkeypatch.setenv("SLIDERULE_REFINE_ID_FREEZE", "0")
        seen = self._drive(
            monkeypatch,
            spec_pages=[
                {"id": "p1_page", "name": "工单页", "purpose": "a", "audience": "u"}
            ],
            reuse_model={"page": {"pages": [{"id": "p1", "name": "工单页"}]}},
        )
        assert seen["page_ids"] == ["p1_page"], "对照臂被结构拨回污染了"

    def test_非精修轮不拨(self, monkeypatch):
        seen = self._drive(
            monkeypatch,
            spec_pages=[
                {"id": "p1_page", "name": "工单页", "purpose": "a", "audience": "u"}
            ],
            reuse_model={"page": {"pages": [{"id": "p1", "name": "工单页"}]}},
            refine=False,
        )
        assert seen["page_ids"] == ["p1_page"]

    def test_spec_first挂了不走GEN5所以也不拨(self, monkeypatch):
        """2026-08-18：spec-first 挂了不许回落 GEN5。拨 id 的那一半不再通电。

        原先钉『回落也要拨』；回落本身没了，再断言拨到 p1 会假绿——
        GEN5 根本没跑，seen 是空的。
        """
        from services import v5_capability_executor as ex
        from services.v5_llm_generate import set_refine_context

        seen = {"gen5": 0}

        def fake_gen5(*a, **k):
            seen["gen5"] += 1
            return {
                "page": {"pages": [{"id": "p1_page", "name": "工单页"}]},
                "appbundle": {"landingPageRef": "p1_page"},
            }

        monkeypatch.setenv("SLIDERULE_SPEC_FIRST", "1")
        monkeypatch.setattr(
            "services.spec_first_pipeline.run_spec_first",
            lambda *a, **k: (_ for _ in ()).throw(RuntimeError("spec-first 挂了")),
        )
        monkeypatch.setattr(
            "services.v5_llm_generate.generate_five_system_model",
            fake_gen5,
        )
        monkeypatch.setattr(
            "services.v5_model_repair.repair_five_system_model",
            lambda m: {"model": m},
        )
        monkeypatch.setattr(
            "services.v5_model_gate.validate_five_system_model",
            lambda *a, **k: {"passed": True},
        )
        monkeypatch.setattr(
            "services.device_policy.normalize_model_preferred_device",
            lambda g, m: m,
        )

        set_refine_context(
            {"page": {"pages": [{"id": "p1", "name": "工单页"}]}},
            "改一下文案",
        )
        try:
            out = ex._try_llm_generate_evidence("做个工单系统", None)
        finally:
            set_refine_context(None)

        assert seen["gen5"] == 0, "spec-first 挂了还走 GEN5——版本涨了页还是空的"
        assert out is None, "没页却交了模型"

