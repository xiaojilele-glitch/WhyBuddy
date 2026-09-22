"""闭环拦截理由：是数据，且只有一个出口把它变成人话。

抄的标准答案：
  grok-build `xai-grok-pager/src/app/startup_failure.rs`
      //! Startup failures as data. [`StartupFailure::user_report`] is the only
      //! place they become the text a reader sees.
  claw-code `runtime/src/lane_events.rs`
      pub struct LaneEventBlocker { failure_class, detail, subphase }
  grok-build `xai-tool-protocol/src/frames.rs::IdleWithholdReason::Unknown`
      /// A reason this build does not recognise — a newer sender.

本文件的判据分两层：
  「说对了」—— 拿真事故那组数据，出来的必须是相关度那句，不是证据缺口；
  「通电」  —— 三个渲染处**都**得真的走这一份，且仓里不许再有第二处
              自己拼拦截理由的地方（CLAUDE.md §3：正向齐全 ≠ 埋点在）。
"""
from __future__ import annotations

import ast
import os
import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.closure_block_reason import (  # noqa: E402
    ClosureBlockClass,
    classify_blockers,
    user_report,
)

_SERVICES = Path(__file__).resolve().parents[1] / "services"

#: 2026-08-27 智能工单那趟的真实形状：证据 6/6 全齐，却因为「产出跟题对不上」
#: 被拦。老代码在这组数据上会说"证据缺口拦截"——和 6/6 自相矛盾。
_REAL_INCIDENT = {
    "blocked": True,
    "evidencePresentCount": 6,
    "skillCount": 6,
    "perSkillEvidence": {
        k: {"evidencePresent": True}
        for k in ("datamodel", "rbac", "workflow", "page", "aigc", "appbundle")
    },
    # ⚠ 两条 blocker，顺序也照真的来。第一条是 v5_capability_executor.py:1671
    #   `if blocked` 无条件落的**笼统总标记**——它的 path 写着 perSkillEvidence，
    #   但这一轮证据是 6/6 齐的。库里 20 条真 blocked 会话，20 条都是这个形状。
    "topBlockers": [
        {
            "code": "APPBUNDLE_RUNTIME_CLOSURE_BLOCKED",
            "path": "runtimeClosure.perSkillEvidence",
            "affectedSkill": "",
            "ref": "",
        },
        {
            "code": "CLOSURE_GOAL_RELEVANCE_FAILED",
            "path": "runtimeClosure.goalRelevance",
            "affectedSkill": "",
            "ref": "",
        },
    ],
    "goalRelevance": {
        "passed": False,
        "score": 0.4,
        "reason": "产出与题目不符：目标的 5 个业务点只覆盖了 2 个（40% < 50%）。未见落实：负载路由、脱敏。",
    },
}


# ── 说对了 ────────────────────────────────────────────────────────


def test_the_real_incident_now_reports_the_actual_reason():
    """真事故那组数据：说的必须是「对不上题」，不是「证据缺口」。"""
    text = user_report(_REAL_INCIDENT)
    assert "对不上" in text, text
    assert "40%" in text and "负载路由" in text, "相关度自己写好的那句话没带出来"
    # 反向：老那句写死的话不许再出现——它和同屏的 6/6 自相矛盾，正是幻觉的动机。
    assert "证据缺口" not in text, text


def test_the_umbrella_blocker_is_not_reported_as_an_evidence_gap():
    """笼统总标记不许被说成"证据没交齐"。

    ⚠ 2026-08-27 拿库里 **20 条真 blocked 会话**验的时候逮到的，夹具全绿时它
      还在（CLAUDE.md §5：真机 > 机械指标）。
      `APPBUNDLE_RUNTIME_CLOSURE_BLOCKED` 的 path 写着
      `runtimeClosure.perSkillEvidence`，看着就是证据缺口；实际
      v5_capability_executor.py:1671 是 `if blocked` 就落，**任何**原因触发的
      blocked 它都跟着出现。20 条里 20 条证据都是 6/6 齐。

      照 path 归类的话，这份"修复"会原地复刻它要修的那次事故：屏幕上同时写着
      「证据 6/6」和「证据没交齐」，用户照样被指去补一个不缺的东西。
    """
    text = user_report(_REAL_INCIDENT)
    assert "证据没交齐" not in text, f"证据 6/6 却说没交齐：{text}"
    assert "对不上" in text


def test_the_umbrella_upgrades_only_when_something_is_really_missing():
    """反向：真有 skill 没交证据时，它**必须**升格成证据缺口并点名。

    没有这一条，把笼统标记一律丢掉也能让上一条绿——那样真的证据缺口就没人报了
    （CLAUDE.md §3）。
    """
    pc = {
        "blocked": True,
        "topBlockers": [
            {"code": "APPBUNDLE_RUNTIME_CLOSURE_BLOCKED", "path": "runtimeClosure.perSkillEvidence", "ref": ""}
        ],
        "perSkillEvidence": {
            "datamodel": {"evidencePresent": True},
            "aigc": {"evidencePresent": False},
        },
    }
    text = user_report(pc)
    assert "证据没交齐" in text and "AI 能力" in text, text


def test_only_the_umbrella_says_so_plainly():
    """只落了笼统标记、又什么都不缺：明说"只落了笼统标记"，不许编。"""
    text = user_report(
        {
            "blocked": True,
            "topBlockers": [{"code": "APPBUNDLE_RUNTIME_CLOSURE_BLOCKED", "ref": ""}],
            "perSkillEvidence": {"aigc": {"evidencePresent": True}},
        }
    )
    assert "笼统" in text, text
    assert "证据没交齐" not in text


def test_the_reason_does_not_stutter():
    """类别开头和 detail 自带的开头不许叠着说。

    相关度那句自己就是"产出与题目不符：…"，直接拼会变成
    「产出跟你要的题对不上：产出与题目不符：…」——真数据里就是这样，
    读起来像结巴，也让人以为是两条原因。
    """
    text = user_report(_REAL_INCIDENT)
    assert "产出与题目不符" not in text, text
    assert text.count("对不上") == 1, text


def test_unknown_code_is_never_dressed_up_as_something_familiar():
    """不认识的 code 说不认识，并原样带出 code。

    抄 IdleWithholdReason::Unknown。这条是本次事故的**反面镜像**：把不认识的
    原因归成"证据缺口"，用户就会去补一个根本不缺的东西。
    """
    text = user_report({"blocked": True, "topBlockers": [{"code": "SOMETHING_NEW"}]})
    assert "不认识" in text and "SOMETHING_NEW" in text, text
    assert "证据" not in text, "把不认识的原因说成了证据问题——正是要防的那件事"
    [row] = classify_blockers({"blocked": True, "topBlockers": [{"code": "SOMETHING_NEW"}]})
    assert row.klass is ClosureBlockClass.UNKNOWN
    assert row.code == "SOMETHING_NEW", "原始 code 被吞了，事故复盘就没得查"


def test_blocked_without_blockers_says_so_instead_of_inventing_one():
    """拦了却没记原因：明说没记，**不许**编一个听起来合理的。"""
    text = user_report({"blocked": True, "topBlockers": []})
    assert "没有记下" in text or "没落" in text, text
    for invented in ("证据缺口", "对不上", "降级"):
        assert invented not in text, f"无原因时编出了「{invented}」"


def test_missing_evidence_names_which_systems_are_missing():
    """证据缺口要说清缺哪几个——ref 是空的，得去 perSkillEvidence 捞。

    照 `BlockedSubphase::TestHang { elapsed_secs, test_name }`：变体名说类别，
    变体字段说这一次。只说"证据缺口"就退回事故前那句没有下文的空话。
    """
    text = user_report(
        {
            "blocked": True,
            "topBlockers": [{"code": "APPBUNDLE_RUNTIME_CLOSURE_BLOCKED", "ref": ""}],
            "perSkillEvidence": {
                "datamodel": {"evidencePresent": True},
                "rbac": {"evidencePresent": False},
                "aigc": {"evidencePresent": False},
            },
        }
    )
    assert "角色权限" in text and "AI 能力" in text, text
    # 反向：交齐了的那个不许混进"缺"的名单里。
    assert "数据模型" not in text, text


def test_closed_closure_gets_no_reason_line():
    """没被拦就没有拦截原因。闭环结论是另一件事，别在这儿说。"""
    assert user_report({"blocked": False, "topBlockers": []}) == ""
    assert user_report(None) == ""
    assert user_report({"blocked": True, "topBlockers": "坏形状"}) != ""  # 不抛


# ── 通电：光有 user_report 不算数 ──────────────────────────────────


def _src(name: str) -> str:
    """剥掉注释和文档字符串的源码。

    ⚠ 必须剥：本仓这几个文件的注释里**大段引用**了老那句写死的话（就是为了
      记住不能再写回去）。不剥的话下面 grep 到的是注释，变异后照样绿——
      CLAUDE.md §2 明写过这个坑。
    """
    text = (_SERVICES / name).read_text(encoding="utf-8")
    text = re.sub(r'"""[\s\S]*?"""', "", text)
    text = re.sub(r"#[^\n]*", "", text)
    return text


@pytest.mark.parametrize(
    "module",
    ["v5_closure_summary.py", "v5_agentic_pick.py"],
)
def test_every_render_site_goes_through_the_single_report(module: str):
    """三个渲染处都得真的调这一份。

    变异：把任一处改回自己拼字符串 → 本条红。
    """
    assert "closure_block_reason" in _src(module), (
        f"{module} 没接上唯一的渲染出口，还在自己拼拦截理由"
    )


def test_the_mechanical_fallback_carries_the_reason_too():
    """零 LLM 那条路也得带原因。

    ⚠ 这条不是凑数：回声兜底走的就是 _mechanical_summary，用户看到的就是它。
      只改喂模型的那一处、不改这一处，是 CLAUDE.md §4 说的「成对的东西改一条
      等于一半不生效」——而且坏的那一半恰好是模型不听话时的兜底。
    """
    from services.v5_closure_summary import _mechanical_summary

    pc = dict(_REAL_INCIDENT)
    pc["perSkillEvidence"] = {
        **pc["perSkillEvidence"],
        "datamodel": {
            "evidencePresent": True,
            "modelSection": {"entities": [{"name": "工单", "fields": ["id"]}]},
        },
    }
    text = _mechanical_summary(pc)
    assert text and "对不上" in text, text


def test_nobody_hardcodes_a_blocked_reason_anymore():
    """仓里不许再有第二处自己发明拦截理由的地方。

    这是「唯一出口」那条纪律的判据形态。名单盯的是**当年真写过的那几句**，
    不是所有含"缺口"的字符串——盯泛词会把正常措辞一起误伤，然后被人加白名单
    加到失效。

    变异：把 "证据缺口拦截" 写回 v5_closure_summary → 本条红。
    """
    banned = ("证据缺口拦截", "补齐缺的那几项")
    hits = []
    for path in sorted(_SERVICES.glob("*.py")):
        if path.name == "closure_block_reason.py":
            continue  # 事故记录本身写在这份注释里，且它是唯一出口
        body = _src(path.name)
        for phrase in banned:
            if phrase in body:
                hits.append(f"{path.name}:{phrase}")
    assert not hits, "又有人把拦截理由写死了：" + "、".join(hits)


def test_class_table_and_head_table_stay_in_step():
    """每个类别都得有一句人话，反过来也不许多出没人用的。

    少一条会在 one_line() 里 KeyError——那是运行时才炸，而这条链挂在收口
    总结上（增强类，fail-open），炸了会被吞掉，用户只是"什么都没看到"。
    """
    from services.closure_block_reason import _CLASS_HEAD

    assert set(_CLASS_HEAD) == set(ClosureBlockClass)


def test_skill_labels_are_not_copied_a_second_time():
    """五系统中文名只有一份（CLAUDE.md §4）。

    变异：在 closure_block_reason 里自己抄一份 {"datamodel": "数据模型", ...}
    → 本条红。
    """
    tree = ast.parse((_SERVICES / "closure_block_reason.py").read_text(encoding="utf-8"))
    imported = any(
        isinstance(node, ast.ImportFrom)
        and node.module
        and "turn_narration" in node.module
        and any(a.name == "_SKILL_LABELS" for a in node.names)
        for node in ast.walk(tree)
    )
    assert imported, "没复用 turn_narration._SKILL_LABELS"
    body = _src("closure_block_reason.py")
    assert '"数据模型"' not in body, "又抄了一份五系统中文名"


# ── 2026-09-09：真机逮到的那一条，以及让它不会再发生的那道闸 ──────────────


def test_交付面那道闸的拦截理由说得出人话():
    """真机 done3-1788946492 的原样载荷（CLAUDE.md §一之二：喂真机那一发）。

    模型报完工 → 闭环拿 `CLOSURE_SUBMIT_INTENT_UNSERVED` 拦下 →
    这个模块回的却是「本版本不认识这个拦截原因」。那道闸 2026-09-06 就上线了，
    人话这一侧一直没跟上——判定侧和叙述侧只改了一半（§4）。
    """
    said = user_report(
        {
            "blocked": True,
            "topBlockers": [
                {
                    "code": "CLOSURE_SUBMIT_INTENT_UNSERVED",
                    "ref": "页面：2 条需要用户录入/提交的需求，其承载页面上"
                    "**没有任何落笔的地方**：n1→p1；n2→p2",
                }
            ],
        }
    )
    assert "不认识" not in said, said
    assert "做不了事" in said, said
    assert "n1→p1" in said, said


def test_首轮账没清完也说得出人话():
    said = user_report(
        {
            "blocked": True,
            "topBlockers": [
                {"code": "CLOSURE_FACTORY_TODO_OPEN", "ref": "structure,bind"}
            ],
        }
    )
    assert "不认识" not in said, said
    assert "structure,bind" in said, said


def test_闸码注册表里的闭环码都得认识():
    """**这一条才是真修复**，上面两条只是今天这一笔。

    `architecture.toml [gate_codes]` 是本仓的闸码权威注册表（arch_graph 逼人
    回答"谁体检它"的那个机制）。以后新加一道闸、人话表没跟上，本条当场红——
    不会再像交付面那五条一样，静静渲染成「本版本不认识这个拦截原因」几个月。

    不进 topBlockers 的码走 `_NOT_A_CLOSURE_BLOCKER` 显式豁免，**每条带理由**。
    往那份名单里加东西 = 声明"这个码不是闭环拦截理由"，加错的代价跟这次
    要修的是同一个病，所以要写下为什么。
    """
    import tomllib

    from services.closure_block_reason import (
        _CLASS_BY_CODE,
        _NOT_A_CLOSURE_BLOCKER,
    )

    toml = Path(__file__).resolve().parents[1] / "architecture.toml"
    registry = tomllib.loads(toml.read_text(encoding="utf-8")).get("gate_codes") or {}
    assert registry, "注册表读空了——这条判据就成了空转"

    unknown = sorted(
        code
        for code in registry
        if code not in _CLASS_BY_CODE and code not in _NOT_A_CLOSURE_BLOCKER
    )
    assert not unknown, (
        f"这些闸码人话表不认识，会渲染成「本版本不认识这个拦截原因」：{unknown}。"
        "要么在 _CLASS_BY_CODE 里给它归类，要么在 _NOT_A_CLOSURE_BLOCKER 里"
        "写清为什么它不是闭环拦截理由。"
    )

    # 反向：豁免名单不许收留注册表里已经没有的码（那是没人扫的死条目），
    # 也不许跟正表打架（同一个码两处都有，改一处不报错、只有一半生效）。
    stale = sorted(c for c in _NOT_A_CLOSURE_BLOCKER if c not in registry)
    assert not stale, f"豁免名单里有注册表已经没有的码：{stale}"
    both = sorted(set(_NOT_A_CLOSURE_BLOCKER) & set(_CLASS_BY_CODE))
    assert not both, f"这些码正表和豁免名单里都有：{both}"

    # 每条豁免都要有理由，不许空着糊过去。
    empty = sorted(c for c, why in _NOT_A_CLOSURE_BLOCKER.items() if not str(why).strip())
    assert not empty, f"这些豁免没写理由：{empty}"
