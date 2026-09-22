"""入站判定闸门哨兵（2026-07-27）。

全部离线：LLM 调用走注入的假函数，确定性层直接跑。真实准确率由
scripts/eval_intake_judge.py 对真网关跑 JSONL 用例集来量（当前 35/36，
误拦真需求 0），那个不进 CI。

这里锁的是**不能退化的纪律**，不是准确率：
- fail-open：判定挂了一律放行
- 确定性层绝不误伤真需求/真迭代
- 判决与会话状态矛盾时以状态为准
- 第一版永远不阻断
"""

import collections
import json
import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services import intake_judge as ij


# ── fail-open：闸门坏了不能变成产品坏了 ────────────────────────────

@pytest.mark.parametrize("boom", [
    RuntimeError("gateway 502"),
    ValueError("invalid json"),
    TimeoutError("read timeout"),
])
def test_llm_failure_always_passes_through(boom):
    def raiser(_messages):
        raise boom

    j = ij.judge_turn("一个正经的业务需求描述", has_app=False, llm_json_fn=raiser)
    assert j.action == "proceed"
    assert j.verdict == "real"
    assert j.source == "degraded"
    assert type(boom).__name__ in j.degraded_reason


def test_malformed_llm_payload_passes_through():
    """返回值不是对象、verdict 非法——都不能把用户挡住。"""
    for payload in ({"verdict": "banana", "reason": "", "confidence": 1}, ["not", "a", "dict"], None):
        j = ij.judge_turn("给这个应用加个报表页", has_app=True, llm_json_fn=lambda _m, p=payload: p)
        assert j.action == "proceed", f"payload={payload!r} 把用户挡住了"
        assert j.verdict == "iteration"  # 有应用时的放行侧判决


def test_disabled_by_env_passes_through(monkeypatch):
    monkeypatch.setenv(ij._ENABLED_ENV, "0")
    j = ij.judge_turn("你好", has_app=False)
    assert j.action == "proceed" and j.source == "degraded"


# ── 确定性层：只挡闭眼都知道的，绝不误伤 ──────────────────────────

@pytest.mark.parametrize("text", [
    "做个系统",                      # 模糊但是真意图 → 该交给 LLM
    "把侧栏改成深色",                 # 真迭代
    "我们店里排班总是乱，想弄个东西管一管",  # 真需求（旧启发式漏判过）
    "帮我把公司报销流程数字化",
    "你是谁",                        # 3 字 meta——阈值曾经把它误判成 vague
])
def test_precheck_never_swallows_meaningful_input(text):
    assert ij.precheck(text) is None, f"确定性层误伤了 {text!r}"


@pytest.mark.parametrize("text,verdict", [
    ("你好", "meta"), ("在吗", "meta"), ("hello", "meta"),
    ("？？？", "vague"), ("   ", "vague"), ("", "vague"),
])
def test_precheck_catches_obvious_noise(text, verdict):
    hit = ij.precheck(text)
    assert hit is not None and hit.verdict == verdict
    assert hit.source == "precheck"
    assert hit.guidance, "确定性层拦下也必须给引导，不能只说不行"


# ── 已有应用上的工厂单跳：不许再走新话题审查 ──────────────────────

_HOP_CASES = [
    "继续进行数据模型反推（structure）与权限绑定（bind）",
    "直接执行闭环发布（closure）",
    "直接执行闭环发布",
    "继续进行数据模型反推",
]

#: ⚠ 2026-09-07 真机水果店：芯片「精修（refine）」不是工厂 hop，
#: 旧尺子会放去 LLM 当新话题。闭集括号名必须一起跳过审查。
_CLOSED_CHIP_CASES = [
    "精修（refine）",
    "refine",
    "质疑（challenge）",
]


@pytest.mark.parametrize("text", _HOP_CASES + _CLOSED_CHIP_CASES)
def test_has_app_factory_hop_is_iteration_without_llm(text):
    """2026-09-03 真机：迭代输入 structure/bind/closure 弹出审查需求。

    变异：把 precheck 的 has_app 支路删掉 → 本条红（llm_json_fn 被叫到）。
    """
    called = []

    def spy(_messages):
        called.append(1)
        return {"verdict": "vague", "reason": "should not run", "confidence": 0.99}

    j = ij.judge_turn(text, has_app=True, llm_json_fn=spy)
    assert called == [], f"{text!r} 还去调了 LLM"
    assert j.verdict == "iteration"
    assert j.action == "proceed"
    assert j.source == "precheck"


@pytest.mark.parametrize("text", [
    "闭环发布管理系统",
    "做一个闭环发布管理系统",
    "另外再做一套版本发布流程",
])
def test_empty_session_product_named_like_a_hop_still_goes_to_llm(text):
    """空会话里「闭环发布管理系统」是新产品，不是 hop。"""
    assert ij.precheck(text, has_app=False) is None
    called = []
    j = ij.judge_turn(
        text, has_app=False,
        llm_json_fn=lambda _m: called.append(1) or {
            "verdict": "real", "reason": "新产品", "confidence": 0.9,
        },
    )
    assert called == [1]
    assert j.verdict == "real"



def test_empty_session_cannot_be_iteration():
    """空会话判成 iteration 一定是错的——没有"现有应用"可改，这个方向安全收敛。"""
    payload = {"verdict": "iteration", "reason": "x", "confidence": 0.9}
    assert ij.judge_turn("社区宠物诊所预约系统", has_app=False, llm_json_fn=lambda _m: payload).verdict == "real"


def test_has_app_does_not_force_real_into_iteration():
    """有应用时判 real 必须原样保留。

    回归（2026-07-28）：_coerce 里原本有一句 `real and has_app → iteration`，
    假设"已经有应用就不可能再提新需求"。可用户完全可以在药店进销存应用旁边说
    「另外再给我做一套幼儿园接送打卡」。实测 9/9 跨领域新需求被这行改写掉，
    模型 reason 写着「属于全新需求」而 verdict 是 iteration，自相矛盾；其中 8 条
    进一步退化成 vague 并弹提示条 —— 误拦真需求，本项目最贵的一类错。
    """
    payload = {"verdict": "real", "reason": "另一个业务领域", "confidence": 0.9}
    j = ij.judge_turn(
        "另外再给我做一套幼儿园的接送打卡和过敏原管理",
        has_app=True,
        app_summary="连锁药店进销存系统",
        llm_json_fn=lambda _m: payload,
    )
    assert j.verdict == "real"
    assert j.action == "proceed"  # 真需求不许弹提示条


def test_cross_domain_rule_offered_only_when_app_exists():
    """跨领域新需求这条规则只在"已有应用"时才需要——空会话本来就能判 real。"""
    new_ids = {r.id for r in ij._applicable_rules(has_app=False)}
    app_ids = {r.id for r in ij._applicable_rules(has_app=True)}
    assert "new_unrelated_need" in app_ids and "new_unrelated_need" not in new_ids
    # 两种语境下 real 都必须是可选判定，否则模型无从表达"这是个全新需求"
    assert "real" in {r.verdict for r in ij._applicable_rules(has_app=True)}
    assert "real" in {r.verdict for r in ij._applicable_rules(has_app=False)}


def test_rules_are_scoped_to_session_state():
    """空会话的 prompt 里不该出现迭代规则，反之亦然——这是「每轮只送相关
    规则」的实现依据，规则增长时干扰面才不会扩大。"""
    new_ids = {r.id for r in ij._applicable_rules(has_app=False)}
    app_ids = {r.id for r in ij._applicable_rules(has_app=True)}
    assert "new_business_need" in new_ids and "iteration_on_current_app" not in new_ids
    assert "iteration_on_current_app" in app_ids and "new_business_need" not in app_ids
    assert {"meta_product_question", "off_topic_chitchat"} <= new_ids & app_ids


def test_prompt_carries_app_summary_when_present():
    """判「是不是真迭代」必须知道当前应用是什么，否则「加个杯测记录」无从判断。"""
    msgs = ij.build_messages("加个评分分布图", has_app=True, app_summary="焙鉴工坊：生豆库存与杯测")
    assert "焙鉴工坊" in msgs[0]["content"]
    body = msgs[0]["content"]
    # 有应用时 iteration 与 real 都得在候选里：只给 iteration 的话，用户提了个
    # 全新领域的需求，模型连表达它的标签都没有（2026-07-28 实测根因之一）。
    assert "iteration" in body and "real" in body
    # 并且必须给出领域比对这一步，否则模型默认什么都往 iteration 靠
    assert "业务领域" in body and "焙鉴工坊" in body


# ── 第一版不阻断 ──────────────────────────────────────────────────

@pytest.mark.parametrize("verdict", ["real", "iteration", "vague", "off_topic", "meta"])
def test_first_version_never_blocks(verdict):
    """任何判决都只产出 proceed/hint。要改成硬拦得显式动 _resolve_action，
    不能因为调了个阈值就悄悄把人挡在门外。"""
    assert ij._resolve_action(verdict, 1.0) in ("proceed", "hint")


def test_low_confidence_does_not_nag():
    """模型自己都不确定就别打扰用户——低于地板一律放行。"""
    assert ij._resolve_action("off_topic", 0.2) == "proceed"
    assert ij._resolve_action("off_topic", 0.95) == "hint"
    assert ij._resolve_action("real", 0.1) == "proceed"


# ── 评测用例集本身的完整性 ────────────────────────────────────────

def test_eval_cases_are_wellformed():
    """用例集是判断"能不能开阻断"的唯一依据，它自己坏了就没有依据了。"""
    path = Path(__file__).parent / "data" / "intake_judge_cases.jsonl"
    rows = [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]
    assert len(rows) >= 30, "用例太少，误判率没有统计意义"
    ids = [r["id"] for r in rows]
    assert len(ids) == len(set(ids)), "用例 id 重复"
    for r in rows:
        assert r["expect"] in ij._VALID_VERDICTS, f"{r['id']} 期望值非法"
        assert isinstance(r.get("hasApp"), bool), f"{r['id']} 缺 hasApp"
    # 五类都要有覆盖，且放行侧（真需求/真迭代）样本要够——误拦是最贵的错误
    by = {v: sum(1 for r in rows if r["expect"] == v) for v in ij._VALID_VERDICTS}
    assert all(by[v] >= 3 for v in by), f"某类样本不足: {by}"
    assert by["real"] + by["iteration"] >= 15, f"放行侧样本不足: {by}"


# ── 拒绝档：说清楚了，但这个形态推演不出来（2026-07-29）──────────────

def test_capability_surface_is_derived_not_handwritten():
    """能力面必须现算自合法域账本。手抄一份的后果是：账本加了新页面形态，
    判定器还按旧能力面拒绝本来已经做得到的东西——而且不会有任何报错。"""
    from services.schema_legal import CHART_TYPES, FIELD_TYPES, PAGE_KINDS

    block = ij._capability_block()
    for value in (*FIELD_TYPES, *PAGE_KINDS, *CHART_TYPES):
        assert value in block, f"能力面漏了合法域里的 {value}"


def test_prompt_carries_both_halves_of_the_boundary():
    """判"做不做得了"要两半都在场：做得了什么 + 做不了什么。少任何一半，
    模型都只能凭"听起来像不像正经需求"来判——那正是它给「3D 竞速游戏」
    打 0.95 置信度的原因。"""
    body = ij.build_messages("随便一句", has_app=False)[0]["content"]
    assert "能力边界" in body
    assert "workbench" in body, "能表达的那一半没进 prompt"
    assert "游戏" in body and "硬件" in body, "做不了的那一半没进 prompt"


def test_out_of_scope_ranks_below_real():
    """优先级刻意压在 real 之下。TriageSQL 的数据：超纲是最好判的一类
    （F1 0.90），真需求最难（0.53）——风险在误伤，不在漏判。这条顺序被
    改反了，误伤真需求的概率会立刻上去。"""
    by_id = {r.id: r for r in ij._RULES}
    assert by_id["out_of_scope_form"].priority < by_id["new_business_need"].priority
    assert by_id["out_of_scope_form"].priority < by_id["iteration_on_current_app"].priority
    assert by_id["out_of_scope_form"].priority > by_id["too_vague"].priority


def test_out_of_scope_rule_teaches_the_keyword_trap():
    """这条规则最容易被判错的方式是"看见领域词就往里塞"。硬负样本必须写在
    规则正文里——不是写在注释里，注释进不了 prompt。"""
    cond = {r.id: r for r in ij._RULES}["out_of_scope_form"].condition
    assert "不是关键词" in cond
    assert "录音棚" in cond and "密室逃脱" in cond, "缺硬负样本，模型学不到边界"


def test_out_of_scope_guidance_must_offer_a_way_out():
    """跟别的判词不同：这一类不能说"再多说两句"——用户补再多细节也变不出
    一个游戏引擎。必须给出周边真做得了的那个系统。"""
    body = ij.build_messages("随便一句", has_app=False)[0]["content"]
    assert "out_of_scope" in body
    assert "周边真做得了" in body


def test_out_of_scope_never_blocks():
    """新判词照样只提示不阻断，跟其余判词一个待遇。"""
    assert ij._resolve_action("out_of_scope", 1.0) == "hint"
    assert ij._resolve_action("out_of_scope", 0.2) == "proceed"




def test_prompt_does_not_leak_the_cases_it_is_measured_on():
    """prompt 里的例句不许出现在评测集的 oos_* / real_hard_* 用例里。

    这两组是拒绝档的**成绩单**：oos_* 量召回，real_hard_* 量误伤。例句一旦
    跟用例重合，评测测的就是"背没背过这道题"，不是"判得准不准"——第一版
    实测 100%/100% 就是这么来的（当时规则正文里直接写着「3D 打印工厂的订单
    排产」「电竞俱乐部的选手合同」，而它们正是 real_hard_005 / real_hard_002）。

    只管这两组：更早的规则里有几处跟 vague/real 用例重合（「做个系统」「再搞
    个别的」这类通用短句），那是这套规则写出来时就有的，且短到不构成"泄题"。
    真要收紧应该连那几条一起改，但那是另一件事，不该混在拒绝档这一轮里。
    """
    body = ij.build_messages("随便一句", has_app=False)[0]["content"]
    path = Path(__file__).parent / "data" / "intake_judge_cases.jsonl"
    rows = [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]
    graded = [r for r in rows if r["id"].startswith(("oos_", "real_hard_"))]
    assert graded, "评测集里没有拒绝档用例，这条测试就没有意义了"
    quoted = re.findall(r"「([^」]{4,})」", body)
    for r in graded:
        assert r["text"] not in body, f"{r['id']} 整句出现在 prompt 里"
        for q in quoted:
            assert q not in r["text"], f"{r['id']} 与 prompt 例句「{q}」重合"


# ── 设备档：随判定一起出，零额外调用（2026-07-30）──────────────────

def test_device_defaults_to_unspecified_not_desktop():
    """缺省必须是 unspecified 而不是 desktop。

    这是整件事的支点：「模型没回这个字段」和「模型判成桌面」下游处理完全不同
    ——前者要两档都生成，后者才只生成桌面档。缺省填 desktop 等于把"判不出来"
    伪装成"判出来是桌面"，手机档设计会从此再也不生成，而且不报错。
    """
    payload = {"verdict": "real", "reason": "r", "confidence": 0.9}
    j = ij.judge_turn("社区宠物诊所预约系统", has_app=False, llm_json_fn=lambda _m: payload)
    assert j.device == "unspecified"


@pytest.mark.parametrize("raw", ["watch", "", None, "DESKTOP ", 123])
def test_illegal_device_falls_back_to_unspecified(raw):
    """不合法一律落 unspecified，不猜。watch 仍未接通。"""
    payload = {"verdict": "real", "reason": "r", "confidence": 0.9, "device": raw}
    j = ij.judge_turn("随便一个需求", has_app=False, llm_json_fn=lambda _m: payload)
    assert j.device in ij._VALID_DEVICES
    if raw == "DESKTOP ":
        assert j.device == "desktop", "大小写与空格应被规范化"
    else:
        assert j.device == "unspecified"


def test_tablet_is_a_legal_judge_device():
    payload = {"verdict": "real", "reason": "r", "confidence": 0.9, "device": "tablet"}
    j = ij.judge_turn("餐厅平板点单", has_app=False, llm_json_fn=lambda _m: payload)
    assert j.device == "tablet"


def test_device_rides_the_existing_call_no_extra_roundtrip():
    """设备档必须搭在**同一次** LLM 调用上。单独判一次是一次完整往返，
    而入站判定本来每次输入都已经在调了——多抽一个槽位成本是 0。"""
    calls = []

    def spy(messages):
        calls.append(messages)
        return {"verdict": "real", "reason": "r", "confidence": 0.9, "device": "phone"}

    j = ij.judge_turn("给外卖骑手做个接单 App", has_app=False, llm_json_fn=spy)
    assert len(calls) == 1, f"设备档不该新起调用，实际调了 {len(calls)} 次"
    assert j.device == "phone"


def test_device_rubric_judges_posture_not_keywords():
    """判据必须是姿态，且两个方向的硬负样本都要在 prompt 正文里。

    只写一个方向不够：只教「骑手→桌面」它会把所有现场词都往桌面推，只教
    「工单→手机」反过来。两组都在，模型才学到"判的是谁在什么状态下用"。
    """
    body = ij.build_messages("随便一句", has_app=False)[0]["content"]
    assert "姿态" in body
    assert "骑手" in body and "调度员" in body, "缺「带现场词的后台需求」这一向"
    assert "巡检" in body and "站着走动" in body, "缺「带后台词的现场需求」这一向"
    assert "unspecified" in body and "别硬猜" in body


def test_device_offers_wired_tablet_not_watch():
    """接通的档必须出现在判定槽位；未接通的 watch 不许出现。"""
    from services.archetype_legal import judge_device_domain_bar

    body = ij.build_messages("随便一句", has_app=False)[0]["content"]
    assert f'"device": {judge_device_domain_bar()}' in body
    assert "tablet" in ij._VALID_DEVICES
    assert "watch" not in ij._VALID_DEVICES
    assert "watch" not in body.split("判定纪律")[0]


def test_device_cases_are_wellformed():
    path = Path(__file__).parent / "data" / "intake_device_cases.jsonl"
    rows = [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]
    assert len(rows) >= 30
    ids = [r["id"] for r in rows]
    assert len(ids) == len(set(ids)), "用例 id 重复"
    for r in rows:
        assert r["expect"] in ij._VALID_DEVICES, f"{r['id']} 期望值非法"
    by = collections.Counter(r["expect"] for r in rows)
    assert all(by[d] >= 5 for d in ij._VALID_DEVICES), f"某档样本不足: {dict(by)}"
    # 两个方向的硬负样本都要有——这套判据的考点全在这里
    assert sum(1 for r in rows if r["id"].startswith("dev_hard_phone")) >= 3
    assert sum(1 for r in rows if r["id"].startswith("dev_hard_desk")) >= 3


def test_device_rubric_examples_not_in_the_graded_cases():
    """prompt 例句不许跟评测用例重合——拒绝档那轮栽过一次（100%/100% 是背题）。"""
    body = ij.build_messages("随便一句", has_app=False)[0]["content"]
    path = Path(__file__).parent / "data" / "intake_device_cases.jsonl"
    rows = [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]
    for r in rows:
        assert r["text"] not in body, f"{r['id']} 整句出现在 prompt 里"
