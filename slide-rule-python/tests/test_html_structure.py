"""第 4 步：HTML → 实体/字段/关联/页面结构（2026-08-13）。

用例重点跟第 2 步一样：**每一条校验都要能真失败**。但这一步多一件事——
grounding（借自 google/langextract 的 char_interval）。那条判据有两个方向都
会咬人，所以两头都要钉：

  · 编出来的 evidence 必须被拦下（漏判 → 臆造混进数据模型）
  · 画面上真有的 evidence 必须放行（误判 → 逼人把 grounding 关掉，比漏判更贵）
"""

from __future__ import annotations

import copy

import pytest

from services.html_structure import (
    FIELD_TYPES,
    PAGE_KINDS,
    HtmlStructure,
    HtmlStructureError,
    build_prompt,
    check_grounding,
    derive_structure,
    prune_ungrounded,
    strip_for_schema,
    to_datamodel,
    validate_structure,
    visible_text,
)

# 一份第 3 步风格的 HTML：Tailwind class、图标 svg、真实中文列头都有。
HTML_LIST = """<!DOCTYPE html>
<html lang="zh-CN"><head><script src="https://cdn.tailwindcss.com"></script></head>
<body class="bg-slate-50">
  <!-- 侧栏 -->
  <aside class="w-56 bg-white shadow-sm"><nav>
    <a class="px-4 py-2 rounded-lg" href="#">工单工作台</a>
    <a class="px-4 py-2" href="#">设备台账</a>
  </nav></aside>
  <main class="p-6">
    <h1 class="text-2xl font-bold">工单工作台</h1>
    <div class="flex gap-2"><input placeholder="搜索工单编号" class="border rounded"/></div>
    <table class="min-w-full">
      <thead><tr>
        <th class="px-3 py-2">工单编号</th>
        <th class="px-3 py-2">设备</th>
        <th class="px-3 py-2">所属车间</th>
        <th class="px-3 py-2">报修时间</th>
        <th class="px-3 py-2">状态</th>
      </tr></thead>
      <tbody><tr>
        <td>WO-20XX-XXXX</td><td>空压机 A1</td><td>一车间</td>
        <td>20XX-XX-XX</td><td>待处理</td>
      </tr></tbody>
    </table>
    <svg class="w-4 h-4" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5"/></svg>
  </main>
</body></html>"""

HTML_DETAIL = """<!DOCTYPE html>
<html lang="zh-CN"><head><script src="https://cdn.tailwindcss.com"></script></head>
<body><main>
  <h1 class="text-xl">工单详情</h1>
  <label class="block">故障描述</label>
  <label class="block">负责人</label>
  <label class="block">设备编号</label>
</main></body></html>"""

PAGES = {"p1": HTML_LIST, "p2": HTML_DETAIL}

GOOD: dict = {
    "version": "html-structure-v1",
    "entities": [
        {
            "id": "work_order",
            "name": "报修工单",
            "evidence": "工单工作台",
            "fields": [
                {"id": "order_no", "name": "工单编号", "type": "string", "evidence": "工单编号"},
                {"id": "equipment_ref", "name": "设备", "type": "ref",
                 "refEntity": "equipment", "evidence": "设备"},
                {"id": "reported_at", "name": "报修时间", "type": "date", "evidence": "报修时间"},
                {"id": "status", "name": "状态", "type": "enum", "evidence": "状态"},
                {"id": "fault_desc", "name": "故障描述", "type": "text", "evidence": "故障描述"},
            ],
        },
        {
            "id": "equipment",
            "name": "设备",
            "evidence": "设备台账",
            "fields": [
                {"id": "equip_no", "name": "设备编号", "type": "string", "evidence": "设备编号"},
            ],
        },
    ],
    "pages": [
        {"id": "work_order_board", "name": "工单工作台", "kind": "workbench",
         "sourcePageId": "p1", "sections": ["筛选栏", "工单表格"], "evidence": "工单工作台"},
        {"id": "work_order_detail", "name": "工单详情", "kind": "workbench",
         "sourcePageId": "p2", "sections": ["基础信息"], "evidence": "工单详情"},
    ],
}


def 失败原因(payload: dict, pages=PAGES) -> str:
    v = validate_structure(payload, pages)
    assert v["passed"] is False, "这份该被拦下来，却过了"
    return "｜".join(f["message"] for f in v["findings"])


class Test表示_剥掉零信号的部分:
    """借自 llm-scraper 的「先选表示再喂」，但**不**用 Readability.js。"""

    def test_剥掉_class_与内联_svg(self):
        out = strip_for_schema(HTML_LIST)
        assert "bg-slate-50" not in out and "px-3 py-2" not in out
        assert "<path" not in out and "viewBox" not in out

    def test_保留结构_文字_与语义属性(self):
        out = strip_for_schema(HTML_LIST)
        for keep in ("<table", "<thead", "<th>", "工单编号", "所属车间", "placeholder="):
            assert keep in out, f"剥过头了，{keep} 不该被剥掉"

    def test_不像_Readability_那样剥掉导航与侧栏(self):
        """Readability 专门剥导航侧栏——那正是我们要的东西，所以不能用它。"""
        out = strip_for_schema(HTML_LIST)
        assert "<aside" in out and "<nav" in out
        assert "设备台账" in out, "菜单项是认实体的重要线索，不能剥"

    def test_真能砍掉一半以上(self):
        # 实测 9 份第 3 步产物：class 39.6% + 内联 svg 17.7% = 57.4%
        before, after = len(HTML_LIST), len(strip_for_schema(HTML_LIST))
        assert after < before * 0.75, f"只砍到 {after}/{before}，跟实测的降幅对不上"

    def test_注释与_script_也剥(self):
        out = strip_for_schema(HTML_LIST)
        assert "侧栏" not in out.split("<aside")[0] or "<!--" not in out
        assert "cdn.tailwindcss.com" not in out


class Test接地_编出来的依据必须被拦:
    """借自 langextract 的 char_interval：定位不到 = 幻觉。"""

    def test_合法件通过(self):
        assert validate_structure(GOOD, PAGES) == {"passed": True, "findings": []}

    def test_拦_字段依据是编的(self):
        s = copy.deepcopy(GOOD)
        s["entities"][0]["fields"][0]["evidence"] = "优先级等级"  # 画面上没有
        assert "臆造" in 失败原因(s)

    def test_拦_实体依据是编的(self):
        s = copy.deepcopy(GOOD)
        s["entities"][1]["evidence"] = "供应商管理"
        assert "臆造" in 失败原因(s)

    def test_拦_页面依据是编的(self):
        s = copy.deepcopy(GOOD)
        s["pages"][0]["evidence"] = "数据大屏"
        assert "臆造" in 失败原因(s)

    def test_拦_依据为空(self):
        s = copy.deepcopy(GOOD)
        s["entities"][0]["fields"][0]["evidence"] = "   "
        assert "空" in 失败原因(s)

    def test_跨页回查_不按页锁死(self):
        """一个实体的字段可能分散在多页（编号在列表页、描述在详情页）。

        按页锁死会把**正确**的抽取判成臆造——那种误判最贵，会逼人把整条
        grounding 关掉。
        """
        # fault_desc 的依据只在 p2，work_order 却是从 p1 认出来的
        assert validate_structure(GOOD, PAGES)["passed"] is True

    def test_归一化_全角与空格不算臆造(self):
        """模型抄回来多个空格或用了全角标点就判臆造，那是误判不是防线。"""
        s = copy.deepcopy(GOOD)
        s["entities"][0]["fields"][2]["evidence"] = "报修 时间"
        assert validate_structure(s, PAGES)["passed"] is True
        s["entities"][0]["fields"][2]["evidence"] = "报修时间："
        assert validate_structure(s, PAGES)["passed"] is True

    def test_没给_HTML_时只查形状不查接地(self):
        s = copy.deepcopy(GOOD)
        s["entities"][0]["evidence"] = "画面上根本没有这句"
        assert validate_structure(s)["passed"] is True  # 没语料，接地这一段跳过

    def test_check_grounding_报得出是哪一条(self):
        s = HtmlStructure.model_validate(copy.deepcopy(GOOD))
        s.entities[0].fields[1].evidence = "凭空捏造的列"
        probs = check_grounding(s, PAGES)
        assert len(probs) == 1
        assert probs[0]["path"] == "entities[work_order].fields[equipment_ref]"


class Test契约_每条都能真失败:
    def test_拦_字段类型不在合法域(self):
        s = copy.deepcopy(GOOD)
        s["entities"][0]["fields"][0]["type"] = "boolean"
        assert "合法域" in 失败原因(s)

    def test_合法域是从账本派生的_不是手抄(self):
        # 手抄的代价这个仓付过：账本记在四处靠人肉对齐
        import json
        from pathlib import Path

        legal = json.loads(
            (Path(__file__).resolve().parent.parent / "services" / "data" /
             "five_system_legal.json").read_text(encoding="utf-8")
        )
        assert list(FIELD_TYPES) == legal["fieldTypes"]
        assert list(PAGE_KINDS) == legal["pageKinds"]

    def test_拦_页型不在合法域(self):
        s = copy.deepcopy(GOOD)
        s["pages"][0]["kind"] = "report"
        assert "合法域" in 失败原因(s)

    def test_拦_ref_没写目标(self):
        s = copy.deepcopy(GOOD)
        del s["entities"][0]["fields"][1]["refEntity"]
        assert "悬空" in 失败原因(s)

    def test_拦_ref_指向不存在的实体(self):
        s = copy.deepcopy(GOOD)
        s["entities"][0]["fields"][1]["refEntity"] = "supplier"
        assert "supplier" in 失败原因(s)

    def test_拦_非ref_却带了_refEntity(self):
        s = copy.deepcopy(GOOD)
        s["entities"][0]["fields"][0]["refEntity"] = "equipment"
        assert "refEntity" in 失败原因(s)

    def test_拦_实体没有字段(self):
        s = copy.deepcopy(GOOD)
        s["entities"][1]["fields"] = []
        assert "一个字段都没有" in 失败原因(s)

    def test_拦_id_不合规(self):
        for bad in ("Work_Order", "1order", "work-order", "工单"):
            s = copy.deepcopy(GOOD)
            s["entities"][0]["id"] = bad
            # ref 会跟着悬空，但只要拦下来就算数
            assert validate_structure(s, PAGES)["passed"] is False

    def test_拦_实体_id_重复(self):
        s = copy.deepcopy(GOOD)
        s["entities"][1]["id"] = "work_order"
        assert "重复" in 失败原因(s)

    def test_拦_字段_id_重复(self):
        s = copy.deepcopy(GOOD)
        s["entities"][0]["fields"][1]["id"] = "order_no"
        assert "重复" in 失败原因(s)

    def test_拦_空产出(self):
        assert "不能为空" in 失败原因({**copy.deepcopy(GOOD), "entities": []})
        assert "不能为空" in 失败原因({**copy.deepcopy(GOOD), "pages": []})

    def test_拦_整份形状不对(self):
        for junk in ("字符串", 42, [], None):
            assert validate_structure(junk)["passed"] is False


class Test这一步不许越界:
    """权限/工作流/不变式从画面里推不出来——实测：4 份 HTML 里角色权限词 0 次，
    五组推出来的流程拓扑完全相同（5 节点 6 转移），那是行业常识不是证据。"""

    def test_契约里根本没有权限与工作流这两段(self):
        assert set(HtmlStructure.model_fields) == {"version", "entities", "pages"}

    def test_提示词明说不要产出那些(self):
        user = build_prompt(PAGES, "设备报修")[-1]["content"]
        for word in ("权限", "角色", "工作流", "审批流", "状态机"):
            assert word in user, f"提示词里没点名禁止「{word}」"

    def test_提示词喂的是剥过的_HTML(self):
        user = build_prompt(PAGES)[-1]["content"]
        assert "bg-slate-50" not in user, "原件的 class 汤混进提示词了"
        assert "工单编号" in user

    def test_提示词把合法域写进去_不靠模型猜(self):
        user = build_prompt(PAGES)[-1]["content"]
        for t in FIELD_TYPES:
            assert t in user
        for k in PAGE_KINDS:
            assert k in user


class Test生成与重问:
    def test_一次就对(self):
        s = derive_structure(PAGES, llm_json_fn=lambda _m: copy.deepcopy(GOOD))
        assert isinstance(s, HtmlStructure)
        assert len(s.entities) == 2

    def test_先错后对_把校验器原话喂回去(self):
        bad = copy.deepcopy(GOOD)
        bad["entities"][0]["fields"][0]["evidence"] = "根本没有的列名"
        calls: list = []

        def fake(messages):
            calls.append(messages)
            return bad if len(calls) == 1 else copy.deepcopy(GOOD)

        s = derive_structure(PAGES, llm_json_fn=fake)
        assert isinstance(s, HtmlStructure)
        assert len(calls) == 2
        回喂 = calls[1][-1]["content"]
        assert "臆造" in 回喂
        # 抄不回来就该删字段，不是换句话硬凑——否则重问只会诱导它编得更像
        assert "就把整个字段删掉" in 回喂

    def test_一直错就抛_不回落占位(self):
        bad = copy.deepcopy(GOOD)
        bad["entities"] = []
        with pytest.raises(HtmlStructureError) as exc:
            derive_structure(PAGES, llm_json_fn=lambda _m: copy.deepcopy(bad))
        assert "不能为空" in str(exc.value)

    def test_重问尽了剪掉臆造字段_其余过闸(self):
        """咖啡馆 R5：模型给工单加了「所需积分」，画面上没有。

        重问提示已经写了「抄不回来就把字段删掉」，它不听。剪完必须留下
        画面上真有的 order_no。删掉 derive_structure 里 prune 那一针，这条必红。
        """
        bait = copy.deepcopy(GOOD)
        bait["entities"][0]["fields"].append({
            "id": "points_required",
            "name": "所需积分",
            "type": "string",
            "evidence": "所需积分",
        })
        calls: list = []

        def fake(_messages):
            calls.append(1)
            return copy.deepcopy(bait)

        s = derive_structure(PAGES, llm_json_fn=fake)
        assert len(calls) == 3, f"没走到重问尽：只调了 {len(calls)} 次"
        work_order = next(e for e in s.entities if e.id == "work_order")
        field_ids = [f.id for f in work_order.fields]
        assert "points_required" not in field_ids
        assert "order_no" in field_ids

    def test_全是臆造剪完仍失败(self):
        """反向：剪的是臆造条，不是「过不了闸就整份放行」。"""
        bad = copy.deepcopy(GOOD)
        for ent in bad["entities"]:
            ent["evidence"] = "根本没有的实体名"
            for field in ent["fields"]:
                field["evidence"] = "根本没有的列名"
        with pytest.raises(HtmlStructureError):
            derive_structure(PAGES, llm_json_fn=lambda _m: copy.deepcopy(bad))

    def test_页面依据臆造不靠删页过闸(self):
        bad = copy.deepcopy(GOOD)
        bad["pages"][0]["evidence"] = "数据大屏"
        with pytest.raises(HtmlStructureError):
            derive_structure(PAGES, llm_json_fn=lambda _m: copy.deepcopy(bad))

    def test_prune_ungrounded_只剪字段留下其余(self):
        bait = copy.deepcopy(GOOD)
        bait["entities"][0]["fields"].append({
            "id": "points_required",
            "name": "所需积分",
            "type": "string",
            "evidence": "所需积分",
        })
        pruned, dropped = prune_ungrounded(bait, PAGES)
        assert pruned is not None
        assert any("points_required" in d for d in dropped)
        assert "order_no" in [f.id for e in pruned.entities if e.id == "work_order" for f in e.fields]

    def test_没有_HTML_直接抛(self):
        with pytest.raises(HtmlStructureError):
            derive_structure({}, llm_json_fn=lambda _m: copy.deepcopy(GOOD))

    def test_LLM_抛错按没产出处理(self):
        def boom(_m):
            raise RuntimeError("网关抽风")

        with pytest.raises(HtmlStructureError):
            derive_structure(PAGES, llm_json_fn=boom)


class Test转成_datamodel:
    def test_形状跟五系统模型对得上(self):
        dm = to_datamodel(HtmlStructure.model_validate(GOOD))
        ent = dm["entities"][0]
        assert set(ent) == {"id", "name", "fields"}
        assert ent["fields"][1] == {
            "id": "equipment_ref", "name": "设备", "type": "ref", "refEntity": "equipment",
        }

    def test_evidence_不带进下游(self):
        """evidence 是**这一步的校验依据**，不是数据模型的一部分。

        带过去会污染下游形状校验——结构闸不认识这个键。
        """
        dm = to_datamodel(HtmlStructure.model_validate(GOOD))
        assert "evidence" not in str(dm)

    def test_非ref_字段不带空的_refEntity(self):
        dm = to_datamodel(HtmlStructure.model_validate(GOOD))
        assert "refEntity" not in dm["entities"][0]["fields"][0]


class Test可见文字:
    def test_把语义属性也算进原文(self):
        # placeholder 里的「搜索工单编号」是画面上看得见的字，该能当依据
        txt = visible_text(HTML_LIST)
        assert "搜索工单编号" in txt.replace(" ", "")

    def test_标签名不算原文(self):
        # 不然模型写 evidence="table" 也能过，grounding 就废了
        txt = visible_text(HTML_LIST)
        assert "thead" not in txt and "aside" not in txt


class Test闸不是摆设_反向对照:
    """「真实产物零 findings」也可能意味着**闸太松**。

    2026-08-13 拿第 3 步真实产物跑第 4 步，26 条 evidence 全部接地、零 findings。
    好消息，但单看这个数分不清是「模型没编」还是「闸拦不住」。所以补一组
    反向对照：拿这个领域里**最像真、页面上却没有**的字段去撞，实测 8/8 全拦。

    这一组守的是判据本身——哪天有人把 _normalize 放宽到把标点连同汉字一起
    剔掉、或者把回查语料改成包含标签名，闸会静默失效，而正向用例全都还是绿的。
    """

    诱饵 = ("维修成本", "备件编号", "SLA 时限", "客户满意度",
            "停机时长", "工单来源渠道", "质保到期日", "班组长审批意见")

    @pytest.mark.parametrize("bait", 诱饵)
    def test_像真的臆造也要拦住(self, bait):
        s = copy.deepcopy(GOOD)
        s["entities"][0]["fields"].append(
            {"id": "bait_x", "name": bait, "type": "string", "evidence": bait}
        )
        assert validate_structure(s, PAGES)["passed"] is False, f"「{bait}」被放行了"

    def test_归一化不许宽到把汉字也剔掉(self):
        """_normalize 只该剔空白与标点。要是哪天它把汉字也剔了，回查会恒真。"""
        from services.html_structure import _normalize

        assert _normalize("工单编号：") == "工单编号"
        assert _normalize(" 报修 时间 ") == "报修时间"
        assert _normalize("（设备）") == "设备"
        # 汉字一个都不能少，否则 needle 会退化成空串、恒命中
        assert len(_normalize("维修成本")) == 4


class Test页面覆盖_喂几页就要出几页:
    """2026-08-13 全链路实测撞到的：spec 5 页、第 3 步出 5 份 HTML，
    第 4 步只产出 4 个页面，`p5 权限与审计` 被整页丢掉，而**闸全绿**。

    根因是提示词里「不要产出权限、角色、工作流」写得太宽——模型看到一个叫
    「权限与审计」的页面就把整页跳过了。那条本意是"别产出权限**内容**"，
    页面本身是结构，该留。

    提示词已收窄，但**光靠改提示词不够**：这类"东西悄悄少了、判据照样绿"的
    形状今天出现过不止一次，所以补判据兜住。
    """

    def test_拦_少了一页(self):
        s = copy.deepcopy(GOOD)
        s["pages"] = [s["pages"][0]]  # 喂了 p1/p2，只产出 p1
        msg = 失败原因(s)
        assert "p2" in msg and "整页被丢了" in msg

    def test_拦_多出一个不存在的源页(self):
        s = copy.deepcopy(GOOD)
        s["pages"][1]["sourcePageId"] = "p99"
        assert "p99" in 失败原因(s)

    def test_没给_HTML_时不查覆盖(self):
        # 没有输入语料就无从谈覆盖，跳过而不是误报
        s = copy.deepcopy(GOOD)
        s["pages"] = [s["pages"][0]]
        assert validate_structure(s)["passed"] is True

    def test_提示词把这条写进去了(self):
        user = build_prompt(PAGES, "x")[-1]["content"]
        assert "一页都不许少" in user
        assert "权限与审计" in user, "要点名这个具体反例，泛泛说一句拦不住"
        # 原来那条禁令要收窄成只管内容，别再把整页带走
        assert "这些内容" in user
