"""rowsRef 漏 fieldRefs 时，reask **必须让模型有机会改对**（2026-08-04）。

## 为什么要有这条

真机验收那轮：一次首页设计连挂三轮、烧 192 秒，最后降级回固定骨架。三轮报的
都是同一句 `rowsRef.fieldRefs 不能为空`——错误回喂了，但紧跟的固定建议整段在
讲 dataRef 的 key 名和白名单，一个字没提 rowsRef。

改成按错误分诊之后，我又跑了一轮想验收，**结果那轮压根没走到设计这一步**
（六轮跑满没收口，enrich 整段没执行）。也就是说：代码改了、推了，但"修好了"
这个结论一直没有证据。

再靠碰运气跑整轮不是办法——一次十分钟，还不一定跑到那段代码。所以这里把
LLM 打桩，**把那条 reask 回路真跑一遍**：第一次故意交一份漏 fieldRefs 的设计，
断言重问消息里带的是 rowsRef 的建议；第二次交合格的，断言整体成功。

打桩验的是**我们这一侧**：错误抓没抓到、建议对不对、第二次机会给没给。
模型看到正确建议后会不会真改对，那是模型的事，打桩验不了，也不该假装验了。

## 2026-08-07：前面多了一层机械修复，这组测试的入口条件跟着变了

分诊式 reask 加上之后，真机又原样复现了一次（三轮全挂在同一句、整页退回
固定骨架）。于是在校验之前补了一层机械修复（_repair_missing_field_refs）：
模板里 fieldRef 一个不少、只是没誊到 fieldRefs 里的，直接按模板补上。

这层修复把**原来那个 BAD 夹具**接管了——它的模板里有 `fieldRef: "site"`，
现在压根走不到 reask。所以这里分成两条线，两条都要有：

  · BAD_REPAIRABLE   —— 模板里有 fieldRef → 机械补掉，**不该**有第二次调用
  · BAD_UNREPAIRABLE —— 模板里一个 fieldRef 都没有 → 推不出来，照旧走 reask

第二条才是这个文件原本要守的东西：修复层只是把最常见的一种情况提前解决，
reask 回路本身必须还在，不能因为"大部分情况被兜住了"就烂掉。
"""

import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import freeform_block as FB  # noqa: E402

DATAMODEL = {
    "entities": [
        {
            "id": "inspection",
            "name": "巡检记录",
            "fields": [
                {"id": "site", "name": "点位", "type": "string"},
                {"id": "level", "name": "隐患等级", "type": "string"},
                {"id": "checked_at", "name": "巡检时间", "type": "date"},
            ],
        }
    ]
}

#: 真机那次的形状：rowsRef 只写了 entityRef/limit，漏掉 fieldRefs。
#: 模板里写着 fieldRef: "site"——意图明确，2026-08-07 起由机械修复接管。
BAD_REPAIRABLE = {
    "root": {
        "tag": "div",
        "children": [
            {
                "tag": "div",
                "rowsRef": {"entityRef": "inspection", "limit": 5},
                "children": [{"tag": "span", "fieldRef": "site"}],
            }
        ],
    }
}

#: 模板里一个 fieldRef 都没有——机械修复无从推断（绝不替模型编字段），
#: 照旧落回 reask。这是现在唯一还能走到重问回路的形状。
BAD_UNREPAIRABLE = {
    "root": {
        "tag": "div",
        "children": [
            {
                "tag": "div",
                "rowsRef": {"entityRef": "inspection", "limit": 5},
                "children": [{"tag": "span", "text": "写死的一行"}],
            }
        ],
    }
}

GOOD = {
    "root": {
        "tag": "div",
        "children": [
            {
                "tag": "div",
                "rowsRef": {"entityRef": "inspection", "fieldRefs": ["site", "level"], "limit": 5},
                "children": [
                    {"tag": "span", "fieldRef": "site"},
                    {"tag": "span", "fieldRef": "level"},
                ],
            }
        ],
    }
}


class _StubLlm:
    """按顺序吐预设回复，并把每次收到的对话记下来。"""

    def __init__(self, replies):
        self.replies = list(replies)
        self.conversations = []

    def __call__(self, messages, **_kw):
        self.conversations.append([dict(m) for m in messages])
        payload = self.replies.pop(0)

        class _R:
            content = json.dumps(payload, ensure_ascii=False)

        return _R()


@pytest.fixture
def stub(monkeypatch):
    def _install(replies):
        s = _StubLlm(replies)
        # 调用点是**函数内**局部 import（from sliderule_llm.client import ...），
        # 所以必须打到源模块上，打 FB 上没用。
        from sliderule_llm import client as _client

        monkeypatch.setattr(_client, "call_llm_with_retry", s)
        # 出图/视觉参照与本条无关，关掉省得走网络
        monkeypatch.setattr(FB, "_supports_image_content_parts", lambda: False)
        # 「怎么画」那段现在也要过一次 LLM（2026-08-07），它跟这条无关，
        # 但会**吃掉桩里的一条预设回复**，把后面的对话顺序全错开一格。
        # 关掉它走兜底处方——这组测试要数的是设计生成本身调了几次。
        monkeypatch.setattr(FB, "_refine_craft_via_llm", lambda *a, **k: None)
        return s

    return _install


def test_repairable_rowsref_never_reaches_the_reask(stub):
    """模板里有 fieldRef 的，机械补掉就完了——不该再多花一轮重问。

    这就是真机那个形状（entityRef/limit 写了、fieldRefs 漏了、模板里 fieldRef
    一个不少）。原来它要烧三轮 192 秒才降级，现在一次过。
    """
    s = stub([BAD_REPAIRABLE])
    out = FB.generate_freeform_block(
        "画一个巡检记录列表", DATAMODEL, use_reference_image=False
    )
    assert out["root"]["children"][0]["rowsRef"]["fieldRefs"] == ["site"]
    assert len(s.conversations) == 1, "机械能修的就别再问模型"


def test_bad_rowsref_is_caught_and_the_reask_talks_about_rowsref(stub):
    s = stub([BAD_UNREPAIRABLE, GOOD])
    out = FB.generate_freeform_block(
        "画一个巡检记录列表", DATAMODEL, use_reference_image=False
    )
    assert out["root"]["children"][0]["rowsRef"]["fieldRefs"] == ["site", "level"]
    assert len(s.conversations) == 2, "第一次不合格就该有第二次机会"

    reask = s.conversations[1][-1]["content"]
    # ① 真实报错要在里面（不带的话模型不知道错哪了）
    assert "fieldRefs" in reask
    # ② 建议要指向 rowsRef，**不能**再把它往 dataRef 上引——那正是三轮没改对的原因
    assert "rowsRef" in reask
    assert "trendGrain" not in reask
    assert "entity / field" not in reask


def test_the_reask_offers_deleting_the_node_when_the_page_has_no_list(stub):
    """给一条"删掉它"的出路：这一页本来不需要列表时，逼它补个凑数的字段清单
    会得到一个跟业务无关的列表——比没有更差。"""
    s = stub([BAD_UNREPAIRABLE, GOOD])
    FB.generate_freeform_block("随便画点什么", DATAMODEL, use_reference_image=False)
    assert "删掉" in s.conversations[1][-1]["content"]


def test_exhausting_attempts_still_raises_so_the_caller_can_degrade(stub):
    """三次都不合格必须抛——上游靠这个异常把区块摘掉、退回固定骨架。

    吞掉的话会变成"生成成功但内容是空"，比失败更难查（fail-open 的语义就靠
    调用方接得到这个异常）。
    """
    stub([BAD_UNREPAIRABLE] * 4)
    with pytest.raises(FB.FreeformGenerationError):
        FB.generate_freeform_block("画列表", DATAMODEL, use_reference_image=False)


def test_a_good_design_needs_no_reask_at_all(stub):
    """一次就对的时候不该有第二次调用——省得把"能自愈"跟"总要重问"混为一谈。"""
    s = stub([GOOD])
    FB.generate_freeform_block("画列表", DATAMODEL, use_reference_image=False)
    assert len(s.conversations) == 1
