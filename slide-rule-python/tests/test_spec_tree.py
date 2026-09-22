"""真 spec 的契约与闸（2026-08-13）。

被替换的那份 spec_tree 是 f-string 拼的，底下 G_SCHEMA / G_INV 校验的是
**代码上一行刚拼出来的形状**，所以恒过——那不叫闸，叫留痕。

所以这份用例的重点不是"合法的能过"，而是**每一条校验都能真失败**：
下面每个 `test_拦` 都是拿一份只坏了一处的 spec 去撞，撞不出来就说明那条
校验是摆设。一条闸如果不可能失败，它就不是闸。
"""

from __future__ import annotations

import copy

import pytest

from services.spec_tree import (
    SpecGenerationError,
    SpecTree,
    build_spec_prompt,
    generate_spec_tree,
    spec_to_markdown,
    validate_spec_tree,
)

# 一份合法的最小 spec：两条判据、两个 requirement、一个 design、一个 task、
# 一个 evidence、两页。故意做小——每个用例只在它身上坏一处，坏因才唯一。
GOOD: dict = {
    "rootNodeId": "n0",
    "version": 3,
    "appName": "维保云",
    "personas": [
        {"id": "u1", "name": "维修主管", "goals": ["盯住各车间的未处理工单"]},
        {"id": "u2", "name": "维修工", "goals": ["处理指派给自己的工单"]},
    ],
    "successCriteria": [
        {"id": "sc1", "text": "维修工可在 2 分钟内完成一次报修登记。"},
        {"id": "sc2", "text": "班组长能按车间查看当日未处理工单数量。"},
    ],
    "nodes": [
        {
            "id": "n0",
            "parentId": None,
            "type": "requirement",
            "title": "提供报修登记闭环",
            "acceptance": "当维修工提交报修单时，系统应生成工单并分配初始状态。",
            "coversCriteria": ["sc1"],
            "evidenceRefs": ["nE1"],
        },
        {
            "id": "n1",
            "parentId": "n0",
            "type": "requirement",
            "title": "按车间统计未处理工单",
            "acceptance": "当班组长打开总览页时，系统应按车间展示当日未处理工单数量。",
            "coversCriteria": ["sc2"],
            "evidenceRefs": ["nE1"],
        },
        {
            "id": "n2",
            "parentId": "n0",
            "type": "design",
            "title": "报修登记抽屉表单",
            "notes": "顶部入口打开抽屉，必填设备与故障描述，保存后回到工单详情。",
            "evidenceRefs": ["nE1"],
        },
        {
            "id": "n3",
            "parentId": "n2",
            "type": "task",
            "title": "定义工单数据模型",
            "verify": "提交表单后能在工单列表看到新记录。",
        },
        {
            "id": "nE1",
            "parentId": "n0",
            "type": "evidence",
            "title": "用户要求设备报修工单系统",
            "source": "user_input:设备报修工单系统",
        },
    ],
    "pages": [
        {
            "id": "p1",
            "name": "车间报修总览",
            "audience": "班组长",
            "purpose": "一眼看到各车间当日未处理工单数量和趋势。",
            "coversNodes": ["n1"],
        },
        {
            "id": "p2",
            "name": "报修登记",
            "audience": "维修工",
            "purpose": "填写设备与故障描述，提交一张新的报修工单。",
            "coversNodes": ["n0", "n2"],
        },
    ],
}


def broken(**patch) -> dict:
    """复制一份合法 spec，只按 patch 坏一处。"""
    spec = copy.deepcopy(GOOD)
    for key, value in patch.items():
        spec[key] = value
    return spec


def 失败原因(spec: dict) -> str:
    verdict = validate_spec_tree(spec)
    assert verdict["passed"] is False, "这份应该被拦下来，却过了"
    return "｜".join(f["message"] for f in verdict["findings"])


class Test合法的能过:
    def test_基准件通过(self):
        assert validate_spec_tree(GOOD) == {"passed": True, "findings": []}

    def test_解析成模型后字段都在(self):
        spec = SpecTree.model_validate(GOOD)
        assert spec.rootNodeId == "n0"
        assert len(spec.successCriteria) == 2
        assert len({n.type for n in spec.nodes}) == 4  # 四种类型都覆盖到了
        assert len(spec.pages) == 2


class Test每条闸都能真失败:
    """一条闸如果不可能失败，它就不是闸。逐条撞一遍。"""

    def test_拦_孤儿判据(self):
        # 最核心的一条：写了判据但没有 requirement 认领它
        spec = copy.deepcopy(GOOD)
        spec["nodes"][1]["coversCriteria"] = []
        assert "sc2" in 失败原因(spec)

    def test_拦_requirement_缺验收条件(self):
        spec = copy.deepcopy(GOOD)
        spec["nodes"][0]["acceptance"] = ""
        assert "acceptance" in 失败原因(spec)

    def test_拦_验收条件不是_EARS_形式(self):
        # 「系统会展示工单」这种陈述句判不了真假，验收无从下手
        spec = copy.deepcopy(GOOD)
        spec["nodes"][0]["acceptance"] = "系统会展示工单列表。"
        assert "EARS" in 失败原因(spec)

    def test_接受_EARS_的三种引导词(self):
        for lead in ("当", "若", "如果"):
            spec = copy.deepcopy(GOOD)
            spec["nodes"][0]["acceptance"] = f"{lead}维修工提交报修单，系统应生成工单。"
            assert validate_spec_tree(spec)["passed"], f"「{lead}…应…」应该算 EARS"

    def test_拦_design_缺说明(self):
        spec = copy.deepcopy(GOOD)
        spec["nodes"][2]["notes"] = ""
        assert "notes" in 失败原因(spec)

    def test_拦_task_缺验证方式(self):
        spec = copy.deepcopy(GOOD)
        spec["nodes"][3]["verify"] = ""
        assert "verify" in 失败原因(spec)

    def test_拦_evidence_缺来源(self):
        # 没有 source 的 evidence 就是凭空断言
        spec = copy.deepcopy(GOOD)
        spec["nodes"][4]["source"] = ""
        assert "source" in 失败原因(spec)

    def test_拦_根节点不存在(self):
        assert "rootNodeId" in 失败原因(broken(rootNodeId="n99"))

    def test_拦_根节点带了父引用(self):
        spec = copy.deepcopy(GOOD)
        spec["nodes"][0]["parentId"] = "n1"
        assert "parentId" in 失败原因(spec)

    def test_拦_父引用悬空(self):
        spec = copy.deepcopy(GOOD)
        spec["nodes"][1]["parentId"] = "n404"
        assert "n404" in 失败原因(spec)

    def test_拦_成环(self):
        # 成环是静默挂死（无限循环不报错），比结构不对更难查
        spec = copy.deepcopy(GOOD)
        spec["nodes"][2]["parentId"] = "n3"  # n2→n3，而 n3 的父本来就是 n2
        assert "环" in 失败原因(spec)

    def test_拦_coversCriteria_指向不存在的判据(self):
        spec = copy.deepcopy(GOOD)
        spec["nodes"][0]["coversCriteria"] = ["sc404"]
        assert "sc404" in 失败原因(spec)

    def test_拦_evidenceRefs_指向非_evidence_节点(self):
        spec = copy.deepcopy(GOOD)
        spec["nodes"][0]["evidenceRefs"] = ["n2"]  # n2 是 design
        assert "evidence" in 失败原因(spec)

    def test_拦_id_重复(self):
        spec = copy.deepcopy(GOOD)
        spec["nodes"][1]["id"] = "n0"
        assert "重复" in 失败原因(spec)

    def test_拦_页面清单为空(self):
        # 没有页就没有第 3 步——不知道要出几张图、每张画什么
        assert "pages" in 失败原因(broken(pages=[]))

    def test_拦_页面没有承载节点(self):
        spec = copy.deepcopy(GOOD)
        spec["pages"][0]["coversNodes"] = []
        assert "coversNodes" in 失败原因(spec)

    def test_拦_页面指向_task_或_evidence(self):
        # 拿「定义工单数据模型」去让生图模型画一页，画出来必然是废的
        for bad in ("n3", "nE1"):
            spec = copy.deepcopy(GOOD)
            spec["pages"][0]["coversNodes"] = [bad]
            assert "requirement" in 失败原因(spec)

    def test_拦_整份形状不对(self):
        for junk in ("字符串", 42, [], None):
            assert validate_spec_tree(junk)["passed"] is False


class Test跟被替换那份的差别:
    def test_闸对旧的_f_string_产物不放行(self):
        """旧产物的形状（root/requirements/risks/deliverables/nodes）在新契约下直接不成立。

        这条不是为了羞辱旧代码，是钉住「不会有人把旧产物喂进新链路还以为没事」。
        """
        legacy = {
            "root": {"id": "root-1", "text": "某个目标", "type": "goal"},
            "requirements": [{"id": "r1", "text": "Implement scoped permission checks"}],
            "risks": [{"id": "rsk1", "text": "Privilege escalation"}],
            "deliverables": [{"id": "d1", "text": "SPEC tree + traceability"}],
            "nodes": [{"id": "root-1", "type": "goal", "text": "某个目标"}],
        }
        assert validate_spec_tree(legacy)["passed"] is False


def 放大到真实规模(spec: dict) -> dict:
    """把基准件撑到提示词里要求的常见区间（判据 3~6、需求 3~8、页 3~8）。

    基准件是给「只坏一处」的用例做的，故意做小；量内容契约得用真实规模，
    否则量的是夹具的大小，不是契约。
    """
    out = copy.deepcopy(spec)
    out["successCriteria"] += [
        {"id": "sc3", "text": "工单从受理到关闭全程可追溯，每次流转都留下操作人和时间。"},
        {"id": "sc4", "text": "维修工在移动端可查看指派给自己的工单并回填处理结果。"},
    ]
    out["nodes"] += [
        {
            "id": "n4",
            "parentId": "n0",
            "type": "requirement",
            "title": "工单流转全程留痕",
            "acceptance": "当工单状态发生变化时，系统应记录操作人、时间和变更前后的状态。",
            "coversCriteria": ["sc3"],
            "evidenceRefs": ["nE1"],
        },
        {
            "id": "n5",
            "parentId": "n0",
            "type": "requirement",
            "title": "维修工处理自己的工单",
            "acceptance": "当维修工打开我的工单时，系统应只展示指派给本人且未关闭的工单。",
            "coversCriteria": ["sc4"],
            "evidenceRefs": ["nE1"],
        },
        {
            "id": "n6",
            "parentId": "n4",
            "type": "design",
            "title": "工单详情操作时间轴",
            "notes": "详情页右侧按时间倒序展示每次状态流转，含操作人、时间与备注。",
            "evidenceRefs": ["nE1"],
        },
    ]
    out["pages"] += [
        {
            "id": "p3",
            "name": "工单详情",
            "audience": "班组长与维修工",
            "purpose": "查看一张工单的完整信息与流转记录，并推进到下一个状态。",
            "coversNodes": ["n4", "n6"],
        },
        {
            "id": "p4",
            "name": "我的工单",
            "audience": "维修工",
            "purpose": "只看指派给自己且未关闭的工单，逐条回填处理结果。",
            "coversNodes": ["n5"],
        },
    ]
    return out


class Test渲染成_artifact_正文:
    def test_真实规模满足既有的产物质量契约(self):
        """_STRUCTURE_DECOMPOSE_CONTRACT：earsSections=["requirement"]、minContentChars=800。

        契约本来就在，只是从前被 f-string 轻松糊弄过去。现在 EARS 由真实的
        acceptance 满足，字数由真实内容满足——用信任层**真正会跑的那个正则**
        来验，不自己另写一个宽松版。
        """
        from services.slide_rule_trust import _count_ears_like

        spec = SpecTree.model_validate(放大到真实规模(GOOD))
        assert validate_spec_tree(spec.model_dump())["passed"]
        md = spec_to_markdown(spec)
        assert len(md) >= 800, f"正文只有 {len(md)} 字，达不到契约的 800"
        assert _count_ears_like(md) >= 1, "信任层数不到 EARS 句式"

    def test_最小合法件够不到内容契约_这是真实的接缝(self):
        """⚠ 一份**结构完全合法**的 spec，仍然可能过不了内容契约。

        两道尺子量的不是一回事：schema 闸量「结构对不对」（引用解析得开、
        判据有人认领），内容契约量「够不够厚」（minContentChars=800）。
        基准件 2 判据 2 需求 2 页，结构挑不出毛病，渲染出来只有 585 字。

        钉住它是因为这个接缝会**静默**咬人：spec 本身过了，产物却在信任层
        被打回，而报错说的是「字数不够」，读的人会去查渲染器，不会想到是
        spec 本身太薄。提示词里那句「判据 3~6 条、requirement 3~8 个、
        页面 3~8 页」不是审美建议，是这条契约的下限倒推出来的。
        """
        md = spec_to_markdown(SpecTree.model_validate(GOOD))
        assert validate_spec_tree(GOOD)["passed"], "基准件结构本身是合法的"
        assert len(md) < 800, (
            f"基准件现在有 {len(md)} 字了——如果是渲染器变啰嗦，"
            f"这条用例就失去意义，改夹具而不是改断言"
        )

    def test_五个分段都在(self):
        md = spec_to_markdown(SpecTree.model_validate(GOOD))
        for section in ("成功判据", "需求", "设计", "任务", "页面清单", "依据"):
            assert section in md

    def test_页面清单进了正文(self):
        # 第 3 步要按页出图，页面信息不能只活在 JSON 里、正文看不见
        md = spec_to_markdown(SpecTree.model_validate(GOOD))
        assert "车间报修总览" in md and "班组长" in md


class Test生成与重问:
    def test_一次就对直接返回(self):
        spec = generate_spec_tree("设备报修", llm_json_fn=lambda _m: copy.deepcopy(GOOD))
        assert isinstance(spec, SpecTree)
        assert spec.rootNodeId == "n0"

    def test_先错后对_把校验器原话喂回去(self):
        bad = copy.deepcopy(GOOD)
        bad["nodes"][1]["coversCriteria"] = []  # 孤儿判据
        calls: list[list[dict]] = []

        def fake(messages):
            calls.append(messages)
            return bad if len(calls) == 1 else copy.deepcopy(GOOD)

        spec = generate_spec_tree("设备报修", llm_json_fn=fake)
        assert isinstance(spec, SpecTree)
        assert len(calls) == 2
        # 第二轮的对话里必须带着第一轮的具体错处，不是泛泛的「重来」
        回喂 = calls[1][-1]["content"]
        assert "sc2" in 回喂 and "没通过机械校验" in 回喂

    def test_一直错就抛_不回落占位(self):
        """**失败不许回落成假 spec。**

        被替换那份最大的问题不是写得糙，是它**永远成功**——一份恒定
        1 需求 1 风险 1 交付物的假树，看起来跟真的一样，还能过自己的闸。
        """
        bad = copy.deepcopy(GOOD)
        bad["pages"] = []
        with pytest.raises(SpecGenerationError) as exc:
            generate_spec_tree("设备报修", llm_json_fn=lambda _m: copy.deepcopy(bad))
        assert "pages" in str(exc.value)

    def test_LLM_没产出也抛(self):
        with pytest.raises(SpecGenerationError):
            generate_spec_tree("设备报修", llm_json_fn=lambda _m: None)

    def test_注入的假_LLM_抛错按没产出处理(self):
        def boom(_messages):
            raise RuntimeError("网关抽风")

        with pytest.raises(SpecGenerationError):
            generate_spec_tree("设备报修", llm_json_fn=boom)


class Test精修轮冻结页的coversNodes豁免:
    """2026-08-18 真机（步伴 AI 拐杖）：精修指令只加一列，LLM 照抄沿用页
    'family_monitor' 时漏了 coversNodes，重问 2 次仍漏 → spec-first 整条
    被判失败回落老链路 → 全量重抽。用户看到「发一句精修，整个应用重画」。

    豁免范围必须精确：**只有精修轮的冻结页**（上一版页面 id）允许缺
    coversNodes——它的承载关系上一轮验证过；新页与非精修轮一个字不放宽。
    正反配对：把豁免扩大到所有页（删掉严格检查）会让反向那三条变红。
    """

    def _冻结页缺covers(self) -> dict:
        spec = copy.deepcopy(GOOD)
        spec["pages"][0]["coversNodes"] = []
        return spec

    def test_精修轮冻结页缺coversNodes不拦(self):
        verdict = validate_spec_tree(self._冻结页缺covers(), frozen_page_ids={"p1"})
        assert verdict == {"passed": True, "findings": []}

    def test_反向_非精修轮同一份照拦(self):
        # 有人把严格检查整个删掉的话，这条会红
        assert "coversNodes" in 失败原因(self._冻结页缺covers())

    def test_反向_新页缺coversNodes即使精修轮也拦(self):
        spec = copy.deepcopy(GOOD)
        spec["pages"][1]["coversNodes"] = []  # p2 不在冻结清单里
        verdict = validate_spec_tree(spec, frozen_page_ids={"p1"})
        assert verdict["passed"] is False
        assert any("p2" in f["message"] for f in verdict["findings"])

    def test_反向_冻结页给了引用仍逐条查真(self):
        # 豁免的是「缺声明」，不是「乱声明」：悬空引用照拦
        spec = copy.deepcopy(GOOD)
        spec["pages"][0]["coversNodes"] = ["n404"]
        verdict = validate_spec_tree(spec, frozen_page_ids={"p1"})
        assert verdict["passed"] is False

    def test_端到端_精修轮LLM漏了沿用页的covers也能一次过(self):
        # 真机那次的形状：重问机制救不了它（两次都漏）。现在第一次就该过。
        payload = self._冻结页缺covers()
        spec = generate_spec_tree(
            "步伴拐杖",
            refine={"instruction": "公益申请列表增加年龄列", "modelDigest": "…"},
            prev_pages=[{"id": "p1", "name": "车间报修总览"}],
            llm_json_fn=lambda _m: copy.deepcopy(payload),
        )
        assert isinstance(spec, SpecTree)
        assert spec.pages[0].coversNodes == []

    def test_端到端_冻结页的跨轮悬空引用被剪掉而不是拦死(self):
        """spec 节点 id 每轮重铸：沿用页照抄上一版 coversNodes 必然悬空。
        这是命名空间错位不是模型编造——机械剪掉，剪空了由豁免接住。"""
        payload = copy.deepcopy(GOOD)
        payload["pages"][0]["coversNodes"] = ["prev_n7", "n1"]  # 一真一悬空
        spec = generate_spec_tree(
            "步伴拐杖",
            refine={"instruction": "加一列", "modelDigest": "…"},
            prev_pages=[{"id": "p1", "name": "车间报修总览"}],
            llm_json_fn=lambda _m: copy.deepcopy(payload),
        )
        assert spec.pages[0].coversNodes == ["n1"]  # 真的留下，悬空的剪掉

    def test_反向_新页的悬空引用不剪照旧重问到抛(self):
        payload = copy.deepcopy(GOOD)
        payload["pages"][1]["coversNodes"] = ["prev_n7"]  # p2 是新页
        with pytest.raises(SpecGenerationError):
            generate_spec_tree(
                "步伴拐杖",
                refine={"instruction": "加一列", "modelDigest": "…"},
                prev_pages=[{"id": "p1", "name": "车间报修总览"}],
                llm_json_fn=lambda _m: copy.deepcopy(payload),
            )

    def test_反向_只传prev_pages不传refine不算精修_不豁免(self):
        with pytest.raises(SpecGenerationError):
            generate_spec_tree(
                "步伴拐杖",
                prev_pages=[{"id": "p1", "name": "车间报修总览"}],
                llm_json_fn=lambda _m: self._冻结页缺covers(),
            )

    def test_提示词点名_照抄页也要重给coversNodes(self):
        msgs = build_spec_prompt(
            "步伴拐杖",
            refine={"instruction": "加一列", "modelDigest": "…"},
            prev_pages=[{"id": "p1", "name": "总览"}],
        )
        user = msgs[-1]["content"]
        assert "照抄上一版页面时，coversNodes 也要重新给" in user


class Test提示词:
    def test_吃的是第一步产物_不是原始那句话(self):
        """直接吃原句等于把「从一句话发明」原样往前挪一格，什么也没改善。"""
        msgs = build_spec_prompt(
            "设备报修工单系统",
            clarified="目标用户是车间维修工与班组长；不做移动端",
            evidence="检索到的同类系统通常包含工单状态机",
        )
        user = msgs[-1]["content"]
        assert "车间维修工" in user
        assert "工单状态机" in user

    def test_没有澄清与证据时不塞空段(self):
        user = build_spec_prompt("设备报修工单系统")[-1]["content"]
        assert "澄清与假设" not in user and "外部证据" not in user

    def test_把硬性要求写进提示词(self):
        # 校验器会拦的每一条，提示词里都要先说清楚——否则纯靠重问去撞，浪费调用
        user = build_spec_prompt("x")[-1]["content"]
        for rule in ("coversCriteria", "EARS 形式" if False else "当……时，系统应", "成环", "coversNodes"):
            assert rule in user


class Test换实现时差点埋进去的两个坑:
    """这两条不是契约本身，是换实现时**差一点静默生效**的东西。

    都属于同一类：按具体取值分支、加一个新取值就悄悄失效。本仓踩过三次同型
    （合法域账本抄在四处、手写 uses 声明与实际渲染不符 316 个、pageKinds 从没
    集中评审），所以这次撞出来的两个当场钉住。
    """

    def test_新的_provenance_仍被认作有产出(self):
        """调度核判「这条能力有没有产出」原本写的是 startswith("python-rag")。

        真 spec 的 provenance 是 python-spec，会**静默掉出那个判断**——表现是
        调度核认为 structure.decompose 从没产出过，于是每一轮都重新排它，
        无限重跑，且不报任何错。
        """
        from models.v5_state import Artifact, V5SessionState
        from services.slide_rule_orchestrator import _has_capability_output

        state = V5SessionState(
            sessionId="s1",
            goal={"text": "x"},
            artifacts=[
                # producedBy 是服务端所有，普通构造会被防伪造守卫拒掉——
                # 这条守卫本身是对的，测试跟着走它给的口子。
                Artifact.server_construct(
                    id="a1",
                    title="SPEC Tree",
                    summary="1 条成功判据",
                    content="# SPEC Tree",
                    provenance="python-spec",
                    producedBy={"capabilityId": "structure.decompose", "capabilityRunId": "run-1"},
                )
            ],
            capabilityRuns=[],
        )
        assert _has_capability_output(state, "structure.decompose") is True

    def test_spec_不算外部证据(self):
        """spec 是推导出来的，不是外部证据——不该给「有据可依」这道闸充数。

        跟上一条相反：这一条是**故意不放行**。留着用例是因为将来有人可能顺手
        把 python-spec 加进 is_external_grounding_provenance 的名单里"图个统一"，
        那会让一份自己写的规格冒充外部依据。
        """
        from services.slide_rule_coverage import is_grounded_evidence_artifact

        art = {
            "kind": "spec_tree",
            "provenance": "python-spec",
            "producedBy": {"capabilityId": "structure.decompose"},
            "content": "# SPEC Tree",
            "sources": [{"id": "e1", "source": "x"}],
        }
        assert is_grounded_evidence_artifact(art) is False


class Test产品名与使用者_把外壳也锚住:
    """2026-08-13 补的两项。

    在它们之前，页面外壳上的产品名是**每页各编一个**的——同一份 spec 的三页
    量出来是「智维工单」「维保云」「智维运维平台」，三个产品名三个登录人。
    页面清单能锚住菜单，锚不住这两样，所以补进契约。

    ⚠ 形状照的是本项目自己的参照件（materials/clarified_brief.json 的 personas），
    **不是 spec-kit**——查过了，spec-kit 的 spec-template.md 没有 persona 这一节，
    也没有产品名（只有 `# Feature Specification: [FEATURE NAME]`，那是功能名）。
    这条注在这里，免得下次有人以为它有开源出处。
    """

    def test_拦_没有产品名(self):
        s = copy.deepcopy(GOOD)
        del s["appName"]
        assert validate_spec_tree(s)["passed"] is False

    def test_拦_产品名是空的(self):
        assert "不能为空" in 失败原因(broken(appName="   "))

    @pytest.mark.parametrize("generic", ["系统", "平台", "管理系统", "管理平台", "应用", "工具", "后台"])
    def test_拦_产品名是品类不是名字(self, generic):
        """单独一个「系统」不是名字，是品类——挂在侧栏上等于没起名，而且每次
        生成都会撞脸。这一条是这两个字段里唯一真正会咬人的判据。"""
        assert "品类" in 失败原因(broken(appName=generic))

    def test_品类词做前后缀是允许的(self):
        # 「维保云管理系统」有自己的名字在前面，不该被误伤
        assert validate_spec_tree(broken(appName="维保云管理系统"))["passed"] is True

    def test_拦_产品名是生成方品牌(self):
        """⚠ 2026-08-21 素材雷达：模型把宿主品牌写成 appName，
        unify 之后每一页顶栏 / 面包屑都变成「面团AI系统」。"""
        from services.spec_tree import is_host_brand_name

        assert is_host_brand_name("面团AI系统")
        assert is_host_brand_name("SlideRule")
        assert not is_host_brand_name("内容雷达")
        assert "生成方" in 失败原因(broken(appName="面团AI系统"))
        assert "生成方" in 失败原因(broken(appName="面团 AI"))
        assert validate_spec_tree(broken(appName="内容雷达"))["passed"] is True

    def test_拦_产品名太长(self):
        assert "太长" in 失败原因(broken(appName="设备报修与维修工单全生命周期综合管理服务平台系统"))

    def test_拦_没有使用者(self):
        assert "personas" in 失败原因(broken(personas=[]))

    def test_拦_使用者_id_重复(self):
        s = copy.deepcopy(GOOD)
        s["personas"][1]["id"] = "u1"
        assert "重复" in 失败原因(s)

    def test_拦_使用者没有名字(self):
        s = copy.deepcopy(GOOD)
        s["personas"][0]["name"] = ""
        assert validate_spec_tree(s)["passed"] is False

    def test_排第一的那个是默认登录身份(self):
        """不另设 primaryPersonaRef——少一个旋钮少一处对不齐的机会。"""
        spec = SpecTree.model_validate(GOOD)
        assert spec.personas[0].name == "维修主管"

    def test_两项都进了正文(self):
        # 只活在 JSON 里的话，人查产物时看不见，也没法核对
        md = spec_to_markdown(SpecTree.model_validate(GOOD))
        assert "维保云" in md
        assert "维修主管" in md and "界面默认登录身份" in md

    def test_提示词里说清它们会被挂到侧栏上(self):
        user = build_spec_prompt("设备报修")[-1]["content"]
        assert "appName" in user and "personas" in user
        assert "侧栏" in user, "不说用途，模型不知道为什么要统一"


class Test设备进规格提示词:
    """2026-08-20：点了「应用」SPEC 仍按 PC 后台切页。

    画页契约换成顶栏+底栏不够——purpose 写成「左侧大表 + 右侧新建」时，
    第 3 步只能把那份工作台塞进竖屏壳。设备必须进这一份 user 消息。
    """

    def test_phone把切页约束写进user消息(self):
        user = build_spec_prompt("随访系统", device="phone")[-1]["content"]
        for mark in ("手机 App", "一屏一件主任务", "不要左右分栏", "顶栏", "主工作列表", "个人中心", "手机外框", "TabBar.Item", "不要带「页」"):
            assert mark in user, f"手机 SPEC 提示词少了「{mark}」"
        assert "每一页的侧栏上" not in user
        assert "古籍列表页" in user

    def test_phone规格页名出口剥页字(self):
        """求自觉已经失败过。device=phone 时 generate_spec_tree 必须机械剥。

        反向：desktop 原样保留「页」，证明剥字接在 phone 活路上，不是误伤桌面。
        """
        phone_payload = copy.deepcopy(GOOD)
        phone_payload["pages"][0]["name"] = "古籍列表页"
        spec = generate_spec_tree("设备报修", device="phone", llm_json_fn=lambda _m: phone_payload)
        assert spec.pages[0].name == "古籍列表"

        desk_payload = copy.deepcopy(GOOD)
        desk_payload["pages"][0]["name"] = "古籍列表页"
        desk = generate_spec_tree("设备报修", device="desktop", llm_json_fn=lambda _m: desk_payload)
        assert desk.pages[0].name == "古籍列表页"

    def test_desktop不掺手机切页(self):
        user = build_spec_prompt("随访系统")[-1]["content"]
        assert "一屏一件主任务" not in user
        assert "每一页的侧栏上" in user

    def test_桌面purpose写的是静息态(self):
        """⚠ 2026-08-20 古籍数字资源库：purpose 写成列表+新增+分配角色，
        第 3 步把新增表单画进首屏。手机已禁「左侧大表+右侧新建」，桌面漏了。
        把「静息态」从桌面提示词拿掉，本条必须红。"""
        user = build_spec_prompt("权限管理")[-1]["content"]
        assert "静息态" in user
        assert "第一眼" in user
        assert "左侧列表 + 右侧新建表单" in user
        assert "一屏一件主任务" not in user

    def test_generate_spec_tree把device送进prompt(self):
        """直接测 build_spec_prompt 绿了也不够——调用点漏传 device 会静默回桌面。"""
        seen: dict = {}

        def fake(_messages):
            seen["user"] = _messages[-1]["content"]
            return copy.deepcopy(GOOD)

        generate_spec_tree("设备报修", device="phone", llm_json_fn=fake)
        assert "一屏一件主任务" in seen["user"]
        assert "每一页的侧栏上" not in seen["user"]

    def test_tablet把密度约束写进user消息(self):
        user = build_spec_prompt("巡店点单", device="tablet")[-1]["content"]
        assert "1112×834" in user
        assert "w-52" in user
        assert "每一页的侧栏上" in user
        assert "一屏一件主任务" not in user

    def test_generate_spec_tree把tablet送进prompt(self):
        seen: dict = {}

        def fake(_messages):
            seen["user"] = _messages[-1]["content"]
            return copy.deepcopy(GOOD)

        generate_spec_tree("巡店点单", device="tablet", llm_json_fn=fake)
        assert "1112×834" in seen["user"]
        assert "一屏一件主任务" not in seen["user"]

    def test_content_app把消费端IA写进user消息(self):
        """选了内容原型，SPEC 仍按后台切页的话，第 3 步只能把中台塞进无 aside 的壳。"""
        user = build_spec_prompt(
            "团子的一天", product_archetype="content_app"
        )[-1]["content"]
        assert "消费 / 内容应用" in user
        assert "图是一等公民" in user
        assert "不要左侧 <aside>" in user
        assert "每一页的顶栏上" in user
        assert "每一页的侧栏上" not in user
        assert "w-52" not in user

    def test_content加tablet不领走巡店侧栏(self):
        """平板 + 内容 = 内容壳，不是 w-52 巡店台账。"""
        user = build_spec_prompt(
            "杂志", device="tablet", product_archetype="content_app"
        )[-1]["content"]
        assert "图是一等公民" in user
        assert "不要左侧 <aside>" in user
        assert "w-52" not in user

    def test_content加phone仍是竖屏再加图优先(self):
        user = build_spec_prompt(
            "今日封面", device="phone", product_archetype="content_app"
        )[-1]["content"]
        assert "一屏一件主任务" in user
        assert "图是一等公民" in user
        assert "每一页的侧栏上" not in user

    def test_没选原型时桌面一字不改侧栏口径(self):
        """反向：空原型不得把后台 IA 换成内容壳。"""
        user = build_spec_prompt("请假系统")[-1]["content"]
        assert "每一页的侧栏上" in user
        assert "消费 / 内容应用" not in user

    def test_generate_spec_tree把content_app送进prompt(self):
        seen: dict = {}

        def fake(_messages):
            seen["user"] = _messages[-1]["content"]
            return copy.deepcopy(GOOD)

        generate_spec_tree(
            "团子的一天", product_archetype="content_app", llm_json_fn=fake
        )
        assert "图是一等公民" in seen["user"]
        assert "每一页的侧栏上" not in seen["user"]
