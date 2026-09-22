# -*- coding: utf-8 -*-
"""应用级模板骨架（2026-08-11）。

## 这批用例守的是什么

模板要取代内置演示域，而演示域的病就是**写死**。所以这里最要紧的两条不是
"能不能加载"，是：

  ① 骨架里绝不能出现绑定/实体/字段 —— 一旦出现，它就退化成了旧模板库那个
     形态（那些绑定指向组件库的订单夹具，丢进真实话题必被结构闸拦下）。
  ② 匹配的默认值必须是"不套模板" —— `goal_coverage` 判不了时返回
     `passed=True`（放行），那是给"别误杀已生成的模型"用的。套模板是反方向的
     动作，判不了却套上等于把别人的应用扣在用户头上。

另外钉一道真实事故：2026-08-04 的「中小学课后托管家长请假」——旧的关键词机制
认成 `leave_approval`（要靠一道额外的相关性补丁才挡住），新机制应当直接不命中。
"""

import json
from pathlib import Path

import pytest

from services.app_template import (
    SEED_APP_TEMPLATES,
    all_app_templates,
    extract_skeleton,
    match_app_template,
    template_terms,
    validate_app_template,
)
from services.schema_legal import EXPERIENCE_BLOCKS, PAGE_KINDS, block_placement_problem


def _skeleton(**overrides):
    base = {
        "id": "t1",
        "name": "测试骨架",
        "industry": "测试",
        "when": "用来测的",
        "pages": [{"id": "p1", "kind": "workbench", "purpose": "干活的页"}],
    }
    base.update(overrides)
    return base


@pytest.fixture
def placeable():
    """目录里任意一个「放开生成 + 能进 workbench 的 main」的区块 —— 判据取自
    真相源，不写死某个区块名（区块目录天天在动）。"""
    for block in EXPERIENCE_BLOCKS:
        if block_placement_problem(str(block["type"]), "workbench", "main") is None:
            return str(block["type"])
    pytest.skip("目录里没有能进 workbench.main 的区块")


class Test种子:
    def test_四条种子全部合法且能加载(self):
        assert len(SEED_APP_TEMPLATES) == 4
        assert {t["id"] for t in SEED_APP_TEMPLATES} == {
            "purchase_approval",
            "leave_approval",
            "service_ticket",
            "employee_onboarding",
        }
        for template in SEED_APP_TEMPLATES:
            assert validate_app_template(template) == [], template["id"]

    def test_种子里没有任何实体或字段(self):
        """抠骨架抠干净了没有 —— 演示域那四份是带实体和字段的完整模型。"""
        raw = json.loads(
            (Path(__file__).resolve().parent.parent / "services" / "data" / "app_template_seeds.json").read_text(
                encoding="utf-8"
            )
        )
        text = json.dumps(raw["templates"], ensure_ascii=False)
        for leaked in ("entityRef", "FieldRef", "datamodel", "fieldBindings", "leave_request", "purchase_order"):
            assert leaked not in text, f"种子里漏了 {leaked}"

    def test_全集函数至少给出种子(self):
        ids = {t["id"] for t in all_app_templates()}
        assert {t["id"] for t in SEED_APP_TEMPLATES} <= ids


class Test骨架不许带绑定:
    @pytest.mark.parametrize(
        "bad",
        [
            {"binding": {"entityRef": "order"}},
            {"pages": [{"id": "p", "kind": "workbench", "purpose": "x", "binding": {}}]},
            {"pages": [{"id": "p", "kind": "workbench", "purpose": "x", "entityRef": "order"}]},
            {"pages": [{"id": "p", "kind": "workbench", "purpose": "x", "titleFieldRef": "name"}]},
            {"datamodel": {"entities": []}},
            {"entities": [{"id": "order"}]},
            {"pages": [{"id": "p", "kind": "workbench", "purpose": "x", "fieldBindings": ["a.b"]}]},
        ],
    )
    def test_各种绑定痕迹都被拒(self, bad):
        problems = validate_app_template(_skeleton(**bad))
        assert any("不许带绑定" in p for p in problems), problems

    def test_藏在深处也揪得出来(self):
        deep = _skeleton(
            pages=[
                {
                    "id": "p",
                    "kind": "workbench",
                    "purpose": "x",
                    "notes": [{"deeper": {"more": {"descFieldRef": "x"}}}],
                }
            ]
        )
        assert any("不许带绑定" in p for p in validate_app_template(deep))

    def test_干净的骨架不误伤(self, placeable):
        clean = _skeleton(
            roleShape=["申请人", "审批人"],
            workflowShape={"steps": 3, "hasApproval": True, "phases": ["申请", "审批"]},
            pages=[
                {
                    "id": "p1",
                    "kind": "workbench",
                    "purpose": "干活的页",
                    "blocks": [{"type": placeable, "region": "main"}],
                }
            ],
        )
        assert validate_app_template(clean) == []


class Test区块摆放走目录:
    def test_合法摆放通过(self, placeable):
        skeleton = _skeleton(
            pages=[{"id": "p1", "kind": "workbench", "purpose": "x", "blocks": [{"type": placeable, "region": "main"}]}]
        )
        assert validate_app_template(skeleton) == []

    def test_未知区块被拒(self):
        skeleton = _skeleton(
            pages=[{"id": "p1", "kind": "workbench", "purpose": "x", "blocks": [{"type": "并不存在的区块", "region": "main"}]}]
        )
        assert any("未知区块" in p for p in validate_app_template(skeleton))

    def test_区域不允许被拒(self):
        """判据从目录现查：找一个明确不允许 footerBar 的区块。"""
        victim = next(
            (
                str(b["type"])
                for b in EXPERIENCE_BLOCKS
                if b.get("generationEnabled")
                and "workbench" in b.get("pageKinds", [])
                and "footerBar" not in b.get("allowedRegions", [])
            ),
            None,
        )
        assert victim, "目录里找不到一个不允许 footerBar 的 workbench 区块"
        skeleton = _skeleton(
            pages=[{"id": "p1", "kind": "workbench", "purpose": "x", "blocks": [{"type": victim, "region": "footerBar"}]}]
        )
        assert any("不允许放在 footerBar" in p for p in validate_app_template(skeleton))

    def test_未放开生成的区块被拒(self):
        frozen = next(
            (str(b["type"]) for b in EXPERIENCE_BLOCKS if not b.get("generationEnabled")), None
        )
        if not frozen:
            pytest.skip("目录里已经没有未放开生成的区块了")
        skeleton = _skeleton(
            pages=[{"id": "p1", "kind": "workbench", "purpose": "x", "blocks": [{"type": frozen, "region": "main"}]}]
        )
        assert any("未放开生成" in p for p in validate_app_template(skeleton))


class Test基本形状:
    @pytest.mark.parametrize("missing", ["id", "name", "industry", "when"])
    def test_必填缺一不可(self, missing):
        skeleton = _skeleton()
        del skeleton[missing]
        assert any(f"缺 {missing}" in p for p in validate_app_template(skeleton))

    def test_页面形态必须在目录内(self):
        skeleton = _skeleton(pages=[{"id": "p", "kind": "并不存在的页型", "purpose": "x"}])
        assert any("不在页面形态目录内" in p for p in validate_app_template(skeleton))

    def test_每页必须说清干什么(self):
        """purpose 是骨架里唯一能被相关性尺子量到的业务语义，缺了这一页白搭。"""
        skeleton = _skeleton(pages=[{"id": "p", "kind": "workbench"}])
        assert any("缺 purpose" in p for p in validate_app_template(skeleton))

    def test_页面id不许重复(self):
        skeleton = _skeleton(
            pages=[
                {"id": "same", "kind": "workbench", "purpose": "甲"},
                {"id": "same", "kind": "kanban", "purpose": "乙"},
            ]
        )
        assert any("重复的页面 id" in p for p in validate_app_template(skeleton))

    def test_不是对象不炸(self):
        for bad in (None, "字符串", 42, []):
            assert validate_app_template(bad)


class Test匹配:
    def test_真请假题命中请假骨架(self):
        hit = match_app_template(
            "做一个员工请假审批系统，员工提交请假单，主管审批，HR备案，还要看假期余额",
            all_app_templates(),
        )
        assert hit is not None
        assert hit["template"]["id"] == "leave_approval"

    def test_采购题命中采购骨架(self):
        hit = match_app_template(
            "采购申请审批，员工提需求，经理审批，财务确认付款，供应商归档", all_app_templates()
        )
        assert hit is not None and hit["template"]["id"] == "purchase_approval"

    def test_托管请假不命中_钉住20260804那道题(self):
        """旧的关键词机制把这道题认成 leave_approval，靠一道额外补丁才挡住。

        新机制应当**根本不命中**——不需要补丁。真出事时的后果是：套上企业请假
        样板，学生/班次/签到/账单一个没做。
        """
        goal = "给中小学课后托管做家长请假申请，要管学生、班次、签到签退和托管账单"
        assert match_app_template(goal, all_app_templates()) is None

        from services.v5_capability_executor import _recognize_domain

        assert _recognize_domain(goal) == "leave_approval", "前提不成立：旧机制本来就没误判"

    def test_不相干的题不命中(self):
        assert (
            match_app_template(
                "黑灰产情报自动化分析系统，线索采集、研判、归档和风险预警", all_app_templates()
            )
            is None
        )

    def test_判不了就不套模板(self):
        """默认必须是反的 —— goal_coverage 样本不足时返回 passed=True（放行），
        照抄那个默认就会变成"看不清也敢套"。这条用例在 applicable 检查被删掉时变红。"""
        for goal in ("请假", "", "做个系统"):
            assert match_app_template(goal, all_app_templates()) is None, goal

    def test_空模板集给None(self):
        assert match_app_template("员工请假审批，主管审批，HR备案", []) is None

    def test_命中要带得出理由(self):
        hit = match_app_template(
            "做一个员工请假审批系统，员工提交请假单，主管审批，HR备案，还要看假期余额",
            all_app_templates(),
        )
        verdict = hit["verdict"]
        for key in ("score", "threshold", "passed", "matched", "reason"):
            assert key in verdict, key


class Test比对词:
    def test_只收业务词_不收技术词(self):
        terms = template_terms(SEED_APP_TEMPLATES[1])
        joined = " ".join(terms)
        for technical in ("workbench", "kanban", "dashboard", "DataTable"):
            assert technical not in joined, f"技术词 {technical} 混进了比对词——会把所有模板的相关度拉平"
        assert "请假申请与审批" in terms and "我的请假单" in terms

    def test_不重复(self):
        for template in SEED_APP_TEMPLATES:
            terms = template_terms(template)
            assert len(terms) == len(set(terms))


class Test抽公共判据没抽坏:
    def test_页面预设仍然被同一套判据校验(self):
        """`block_placement_problem` 是从 `_load_page_kind_presets` 里抽出来的，
        两边共用。抽坏了预设那边会静默失去校验，这条盯着它。"""
        from services.schema_legal import PAGE_KIND_PRESETS

        assert PAGE_KIND_PRESETS, "页面预设没了"
        for kind, presets in PAGE_KIND_PRESETS.items():
            for preset in presets:
                for item in preset["blocks"]:
                    assert (
                        block_placement_problem(item["type"], kind, item["region"]) is None
                    ), f"{kind}.{preset['id']} 的 {item['type']}@{item['region']} 现在过不了"

    def test_页型词汇两边同源(self):
        assert set(p["kind"] for t in SEED_APP_TEMPLATES for p in t["pages"]) <= set(PAGE_KINDS)


def _generated_model(**overrides):
    """一份「像真生成结果」的五系统模型：区块在 blocks[]，位置在 layout 里。

    这个形状是从 v5_model_gate 的校验反推的——生成出来的区块**自己不带区域**，
    位置记在 page.layout 的「区域 → 区块 id 列表」里。抽骨架必须两边对着看。
    """
    model = {
        "appbundle": {"appIdentity": {"productName": "华东采购协同"}},
        "datamodel": {"entities": [{"id": "purchase_order", "fields": [{"id": "title", "type": "string"}]}]},
        "rbac": {"menus": [{"label": "采购申请"}, {"label": "经理审批"}]},
        "workflow": {
            "nodes": [
                {"name": "填写采购单", "phase": "申请"},
                {"name": "经理审批", "phase": "审批"},
            ]
        },
        "page": {
            "pages": [
                {
                    "id": "po_workbench",
                    "kind": "workbench",
                    "name": "采购申请工作台",
                    "blocks": [
                        {"id": "b1", "type": "FilterBar", "binding": {"targets": ["b2"]}},
                        {"id": "b2", "type": "DataTable", "binding": {"entityRef": "purchase_order", "titleFieldRef": "title"}},
                    ],
                    "layout": {"filters": ["b1"], "main": ["b2"], "grid": {"desktop": []}},
                }
            ]
        },
    }
    model.update(overrides)
    return model


class Test从生成好的应用抽骨架:
    """链路方向：基础组件 → 区块 → 推演组装 → 应用 → **骨架**。

    骨架是沉淀物不是原料，所以这个函数是唯一能产出真骨架的地方——种子那四条
    是从演示域抠的，而演示域根本没走过「用区块搭应用」这一步。
    """

    def test_抽出来的骨架自己能过自检(self):
        out = extract_skeleton(_generated_model(), template_id="po", industry="采购", when="员工提需求、经理审批")
        assert out["problems"] == [], out["problems"]
        assert validate_app_template(out["skeleton"]) == []

    def test_绑定一个都不跟过来(self):
        """输入模型里满是 entityRef / titleFieldRef / targets，骨架里必须一个不剩。

        不是靠事后清洗——抽的时候压根不读那些字段。这条红了说明有人在抽取里
        顺手把 binding 带上了，那会让骨架退回旧模板库那个形态。
        """
        out = extract_skeleton(_generated_model(), template_id="po")
        text = json.dumps(out["skeleton"], ensure_ascii=False)
        for leaked in ("entityRef", "FieldRef", "purchase_order", "targets", "binding"):
            assert leaked not in text, f"骨架里漏了 {leaked}"

    def test_区域从layout反查(self):
        out = extract_skeleton(_generated_model(), template_id="po")
        blocks = out["skeleton"]["pages"][0]["blocks"]
        assert {"type": "FilterBar", "region": "filters"} in [dict(b) for b in blocks]
        assert {"type": "DataTable", "region": "main"} in [dict(b) for b in blocks]

    def test_没进layout的区块丢掉并留痕(self):
        """真实页面上没位置的区块，抽进骨架等于凭空给它安一个——那正是手写预设的错法。

        断言对着**行为**（丢了几个、留了几个），不对着措辞——上一版钉的是
        "位置无从得知"那句原话，改一次文案就红，而它护的东西其实没变。
        """
        model = _generated_model()
        model["page"]["pages"][0]["blocks"].append(
            {"id": "orphan", "type": "ApprovalQueue", "binding": {}}
        )
        out = extract_skeleton(model, template_id="po", industry="采购", when="员工提需求、经理审批")
        kept = [b["type"] for b in out["skeleton"]["pages"][0].get("blocks") or []]
        assert "ApprovalQueue" not in kept, "没位置的区块被抽进骨架了"
        assert len(out["dropped"]) == 1, out["dropped"]
        assert out["problems"] == []

    def test_栅格布局的区块要收下_只是没有region(self):
        """真实模型多数用栅格（x/y/w/h + blockRef），**区域名客观上不存在**。

        2026-08-11 第一份线上收割数据踩到：7 页里 5 页只有栅格，15 个区块被判掉
        10 个，丢的恰好是那一趟最值钱的专用件。所以栅格里的区块要收，region 留空
        ——知道该有什么，不假装知道摆哪。
        """
        model = _generated_model()
        page = model["page"]["pages"][0]
        page["layout"] = {
            "grid": {
                "desktop": [
                    {"blockRef": "b1", "x": 0, "y": 0, "w": 4, "h": 4},
                    {"blockRef": "b2", "x": 4, "y": 0, "w": 8, "h": 4},
                ]
            }
        }
        out = extract_skeleton(model, template_id="po", industry="采购", when="员工提需求、经理审批")
        blocks = out["skeleton"]["pages"][0]["blocks"]
        assert {b["type"] for b in blocks} == {"FilterBar", "DataTable"}, blocks
        assert all("region" not in b for b in blocks), f"栅格没有区域名，不该编一个出来：{blocks}"
        assert out["dropped"] == []
        assert out["problems"] == [], out["problems"]

    def test_没有region的区块仍然要能摆在这种页上(self):
        """region 可选不等于判据取消——推荐一个门禁必拦的组合，模型照做还查不出为什么。"""
        victim = next(
            (
                str(b["type"])
                for b in EXPERIENCE_BLOCKS
                if b.get("generationEnabled") and "wizard" not in (b.get("pageKinds") or [])
            ),
            None,
        )
        assert victim
        skeleton = _skeleton(
            pages=[{"id": "p1", "kind": "wizard", "purpose": "x", "blocks": [{"type": victim}]}]
        )
        assert any("没有任何合法区域" in p for p in validate_app_template(skeleton))

    def test_摆错位置的区块丢掉并留痕(self):
        """目录后来收紧了区域，老应用里那个摆法现在不合法——丢掉，别把坏骨架存进库。"""
        model = _generated_model()
        model["page"]["pages"][0]["layout"] = {"footerBar": ["b2"], "filters": ["b1"]}
        out = extract_skeleton(model, template_id="po", industry="采购", when="员工提需求、经理审批")
        assert any("footerBar" in d["why"] for d in out["dropped"]), out["dropped"]
        assert out["problems"] == []

    def test_同页同类型同区域只留一条(self):
        model = _generated_model()
        model["page"]["pages"][0]["blocks"].append({"id": "b3", "type": "DataTable", "binding": {}})
        model["page"]["pages"][0]["layout"]["main"].append("b3")
        out = extract_skeleton(model, template_id="po")
        blocks = out["skeleton"]["pages"][0]["blocks"]
        assert len(blocks) == len({(b["type"], b["region"]) for b in blocks})

    def test_角色与流程形状抽得出来(self):
        out = extract_skeleton(_generated_model(), template_id="po")
        assert out["skeleton"]["roleShape"] == ["采购申请", "经理审批"]
        shape = out["skeleton"]["workflowShape"]
        assert shape["steps"] == 2 and shape["hasApproval"] is True
        assert shape["phases"] == ["申请", "审批"]

    def test_行业和一句话抽不出来_由调用方给(self):
        """模型里没有这两个概念。它们正好就是贡献时要用户过目的字段。"""
        out = extract_skeleton(_generated_model(), template_id="po")
        assert out["skeleton"]["industry"] == "" and out["skeleton"]["when"] == ""
        assert any("缺 industry" in p for p in out["problems"])
        assert any("缺 when" in p for p in out["problems"])

    def test_老应用没有区块也不炸_只是抽出空骨架(self):
        """线上存量应用是老区块时代生成的，页面里没有 blocks——这正是要重新
        生成的原因。抽这种应用不该崩，但也不该假装抽到了东西。"""
        model = _generated_model()
        for page in model["page"]["pages"]:
            page.pop("blocks", None)
            page.pop("layout", None)
        out = extract_skeleton(model, template_id="old", industry="采购", when="老应用")
        assert out["problems"] == []
        assert "blocks" not in out["skeleton"]["pages"][0], "没有区块就别造一个空数组出来"

    def test_页型不在目录内的页丢掉(self):
        model = _generated_model()
        model["page"]["pages"][0]["kind"] = "并不存在的页型"
        out = extract_skeleton(model, template_id="po", industry="x", when="y")
        assert any("不在目录内" in d["why"] for d in out["dropped"])

    def test_垃圾输入不炸(self):
        for bad in (None, "字符串", 42, [], {}):
            out = extract_skeleton(bad, template_id="x")
            assert isinstance(out["skeleton"], dict) and isinstance(out["dropped"], list)

    def test_抽出来的骨架能被匹配到(self):
        """终判：抽 → 存 → 匹配，整条路走通，而不是只验中间那一段。"""
        out = extract_skeleton(
            _generated_model(),
            template_id="po",
            industry="采购",
            when="员工提采购需求、经理审批、财务确认付款",
        )
        assert out["problems"] == []
        hit = match_app_template(
            "采购申请审批，员工提需求，经理审批，财务确认付款，采购申请工作台", [out["skeleton"]]
        )
        assert hit is not None and hit["template"]["id"] == "po"
