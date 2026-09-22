"""SPEC assumption schema, prompt, and sanitization contracts.

Driver-to-questionnaire coverage lives in test_spec_decisions_questionnaire.
"""

import pytest

from services.spec_tree import (  # noqa: E402
    SpecTree,
    _sanitize_assumptions,
    build_spec_prompt,
)

GOAL = "做一个连锁药店的门店巡检系统，店长提交巡检单、区域经理审批"




ROWS = [
    {
        "id": "a1",
        "topic": "店长怎么登录",
        "decision": "工号 + 密码",
        "alternatives": ["手机号 + 验证码", "企业微信扫码"],
        "why": "需求里没说身份从哪来，连锁门店通常发工号",
    },
    {
        "id": "a2",
        "topic": "审批几级",
        "decision": "区域经理一级审批",
        "alternatives": ["区域经理 + 总部两级"],
        "why": "原话只提到区域经理",
    },
]


# ── 一、契约：起草的时候顺带声明，不另起一次调用 ─────────────────


def test_提示词真的在要这个字段_而且要的是会改变产品形态的事():
    """判据盯**语义**不盯某句话字面（本仓第二条踩过的形状）。

    钉两件事：字段名进了提示词（下游按 key 取数，这个必须字面对）；
    以及它要的是"换个选项产品就长得不一样"，不是"凡是不确定的都列出来"
    ——第一版就是后者，模型老老实实报回来配色、字号、分页条数。
    """
    content = build_spec_prompt(GOAL)[1]["content"]
    assert "assumptions" in content
    assert "alternatives" in content and "decision" in content
    # 语义：这几样明确点名"不算"
    assert "配色" in content and "字号" in content
    # 语义：不许把它做成一次阻塞提问
    assert "不会打断" in content or "不是在问问题" in content


def test_精修轮也要这个字段_不是只有新建才报():
    """精修同样在替用户做决定（"改成工号"之后，密码规则谁定？）。

    ⚠ 反向：真机上精修是主路径之一，只在新建分支加提示词 = 一半不生效
      （本仓第四条）。
    """
    refine = {"instruction": "登录改成工号", "modelDigest": "上一版：药店巡检"}
    content = build_spec_prompt(GOAL, refine=refine)[1]["content"]
    assert "assumptions" in content


def test_手机轮里_假设段在_而设备改写没有打在它身上():
    """⚠ 这条钉的是一次真实的静默失效（2026-08-27 当天）。

    build_spec_prompt 的手机分支改的是 `parts[-1]`——**按位置认人**。
    第一版把假设说明接在 JSON 形状块后面，`parts[-1]` 当场变成了它，
    于是「每一页的侧栏上 → 顶栏上」那两针全打在假设说明上，手机 SPEC
    提示词静静地退回桌面措辞。不报错、不告警。

    修法是把它挂到最后（设备改写之后）。这条判据把「假设段在」和
    「设备改写仍然到位」钉在同一个断言里——分开写的话，下一个人
    只看自己那条绿了就以为没事。
    """
    phone = build_spec_prompt(GOAL, device="phone")[1]["content"]
    assert "assumptions" in phone, "手机轮丢了假设段"
    assert "每一页的顶栏上" in phone, "设备改写打歪了——它改的是位置，不是内容"
    assert "每一页的侧栏上" not in phone


def test_模型里认这个字段_而且缺了不算错():
    """增强类字段：整份 spec 没有 assumptions 必须照样通过（本仓第七条）。"""
    tree = SpecTree.model_validate(_MIN_SPEC)
    assert tree.assumptions is None

    with_rows = SpecTree.model_validate({**_MIN_SPEC, "assumptions": ROWS})
    assert [a.topic for a in with_rows.assumptions] == ["店长怎么登录", "审批几级"]
    assert with_rows.assumptions[0].alternatives == ["手机号 + 验证码", "企业微信扫码"]


# ── 二、脏数据在进模型之前就被剥掉，剥不出东西就当没写 ────────────


def test_脏行被剥掉_而不是把整份spec拖下水():
    """⚠ 这条是 fail-open 的具象化。

    reverse：把 _sanitize_assumptions 从 generate_spec_tree 里摘掉，
    下面这份 payload 会让 SpecTree 校验直接失败——一份 pages/nodes/判据
    全对的 spec，因为顺带报出来的假设少写了一个 decision 就整轮重问，
    白烧 90 秒。那正是本仓第七条说的"把优化写成 fail-closed"。
    """
    payload = {
        **_MIN_SPEC,
        "assumptions": [
            {"topic": "登录", "decision": ""},          # 没定成什么 → 空壳
            {"topic": "", "decision": "两级"},           # 没说是什么事
            "这不是一个对象",
            {"topic": "登录", "decision": "工号"},       # 同一件事说两遍
            {"topic": "登录", "decision": "手机号"},     # dup topic
            {"topic": "扣库存", "decision": "下单扣",
             "alternatives": ["下单扣", "发货扣"]},      # 第一个"其他做法"跟已定的一样
            {"topic": "多余的第四条", "decision": "x"},
        ],
    }
    _sanitize_assumptions(payload)
    rows = payload["assumptions"]
    assert [r["topic"] for r in rows] == ["登录", "扣库存", "多余的第四条"]
    assert rows[0]["decision"] == "工号"
    # 点了等于没改的选项不许留在面板上
    assert rows[1]["alternatives"] == ["发货扣"]
    # 剥干净之后仍是一份能过闸的 spec
    assert SpecTree.model_validate(payload).assumptions is not None


def test_脏假设不许把一份好spec拖去重问():
    """⚠ 上一条验的是"洗衣机会转"，这一条验"脏衣服真的进了洗衣机"。

    只有上一条的话，是本仓第一条的经典形状：函数写对了 ≠ 它被调用了。
    变异（把 generate_spec_tree 里的 _sanitize_assumptions(payload) 摘掉）
    在上一条下面照样全绿——因为那条根本没走生成路径。

    这里让假 LLM 吐一份 pages/nodes/判据全对、只有 assumptions 写歪了的
    payload：洗了就一次通过，不洗就校验失败、白转两轮重问再抛。
    """
    from services.spec_tree import generate_spec_tree

    dirty = {
        **_MIN_SPEC,
        "assumptions": [
            {"topic": "登录", "decision": ""},
            {"没有topic这个键": 1},
            {"topic": "审批几级", "decision": "一级", "alternatives": "本该是数组"},
        ],
    }
    calls = {"n": 0}

    def fake_llm(_messages):
        calls["n"] += 1
        return dict(dirty)

    tree = generate_spec_tree(GOAL, llm_json_fn=fake_llm)
    assert calls["n"] == 1, "为了一个附带字段转了重问——那一转是整份 spec 重来"
    assert [a.topic for a in (tree.assumptions or [])] == ["审批几级"]
    # ⚠ 2026-08-27 改判：这一行原来断言的是 `== []`，也就是把裸字符串**丢掉**。
    #   那不是"洗干净"，是把模型给的那条备选静静扔了——卡退化成一句"知会
    #   一声"，用户想改都没得点。改抄 grok-build `serde_lenient.rs`：裸字符串
    #   → 单元素列表（口径与判据见 test_lenient_string_list.py）。
    #   逐字符那口仍然堵着：str 走的是"单元素"分支，不是 for 循环。
    assert tree.assumptions[0].alternatives == ["本该是数组"]


def test_一条都没剩就把键删掉_不留空壳():
    """空数组会让前端渲染一个"我替你定了 0 件事"的空面板。"""
    payload = {"assumptions": [{"topic": "  "}, {"decision": "x"}]}
    _sanitize_assumptions(payload)
    assert "assumptions" not in payload

    absent = {"pages": []}
    _sanitize_assumptions(absent)
    assert "assumptions" not in absent


def test_最多三条():
    payload = {"assumptions": [{"topic": f"t{i}", "decision": "d"} for i in range(9)]}
    _sanitize_assumptions(payload)
    assert len(payload["assumptions"]) == 3




_MIN_SPEC = {
    "rootNodeId": "n0",
    "version": 3,
    "appName": "巡检通",
    "personas": [{"id": "u1", "name": "店长", "goals": ["提交巡检单"]}],
    "successCriteria": [{"id": "sc1", "text": "店长 3 分钟内提交完一张巡检单"}],
    "nodes": [
        {
            "id": "n0",
            "parentId": None,
            "type": "requirement",
            "title": "提交巡检单",
            "acceptance": "当店长完成巡检时，系统应生成一张待审批的巡检单。",
            "coversCriteria": ["sc1"],
            "evidenceRefs": [],
        }
    ],
    "pages": [
        {
            "id": "p1",
            "name": "巡检单列表",
            "audience": "店长",
            "purpose": "看自己提交过的巡检单和它们的审批状态",
            "coversNodes": ["n0"],
        }
    ],
}
