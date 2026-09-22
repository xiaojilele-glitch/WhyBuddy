"""收口压力必须**随轮次递进**，而且不能自相矛盾（2026-08-04）。

## 这条防的是一次真实的"跑了九分钟什么都没有"

同一个题连跑三轮，第三轮：loop-4 / loop-5 连着两轮写「当前证据不足，不进入
运行时装配」，六轮跑满一次都没选收口，最后 awaitReason=max_loops 强停——
evidence 0/6、blocked、应用库一条记录都没有。前两轮同样的输入是出了应用的，
**两成一败**。

查出来两个原因，都在提示词里：

### ① 两句话直接打架，而劝退的那句挂在能力本身上

能力清单里写的是「…证据不齐会被门拦下——**收口前先确保证据充分**」，
而状态摘要里写的是「提案收口没有惩罚，拖到轮次耗尽才有」。模型正是在决定
**要不要选这个能力**的时候读到前一句。

### ② 进度提醒从第 1 轮到第 6 轮一模一样

最后一轮的紧迫程度显然不同于第 1 轮——那时候"再补一轮证据"这个选项**已经
不存在了**，可原措辞完全没体现。
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.v5_agentic_pick import CAPABILITY_VOCAB, _progress_line  # noqa: E402


def test_closure_capability_no_longer_reads_as_a_warning_off():
    """收口能力的描述不能再劝退。

    它是模型决定要不要收口时读到的那一句，写成"先确保证据充分"等于告诉它
    "还不到时候"——而系统真正的取舍是：blocked 的收口也是交付，什么都没有才最差。
    """
    desc = CAPABILITY_VOCAB["appbundle.runtimeclosure"]
    assert "收口前先确保证据充分" not in desc
    assert "blocked" in desc
    # 要说清楚 blocked 也是一种交付，否则模型仍会把它当失败来规避
    assert "交付" in desc


def test_progress_pressure_escalates_with_remaining_loops():
    early = _progress_line(0, 6)
    late = _progress_line(4, 6)
    final = _progress_line(5, 6)
    assert early != late != final, "三档必须真的不同，否则等于没分档"
    assert "只剩 1 轮" in late
    assert "最后一轮" in final


def test_final_loop_states_the_consequence_in_concrete_terms():
    """最后一轮要把后果说具体。

    "应认真考虑收口"这种措辞留了余地，而那一轮已经没有余地了：不收就是
    max_loops 强停、evidence 0/6、用户什么都拿不到。
    """
    final = _progress_line(5, 6)
    assert "没有下一轮" in final
    assert "max_loops" in final


def test_early_loops_are_not_pressured_into_closing_too_soon():
    """早轮不能反过来被逼着收口——那会把"想清楚再动手"也一起毁掉。"""
    early = _progress_line(0, 6)
    assert "最后一轮" not in early and "只剩" not in early


def test_the_two_messages_no_longer_contradict_each_other():
    """能力描述与进度提醒必须朝同一个方向。

    这是这次事故的根因：一句说"先确保证据充分"，另一句说"收口没有惩罚"。
    模型只能挑一个信，它挑了劝退那句。
    """
    desc = CAPABILITY_VOCAB["appbundle.runtimeclosure"]
    for loop in range(6):
        line = _progress_line(loop, 6)
        # 两处都不该出现"先补够证据再收"这类把收口往后推的说法
        assert "收口前先确保" not in desc + line


# ── 闭环状态必须回传给模型（2026-08-04）──────────────────────────
#
# 真机：模型 **loop-3 选了收口（成功出 v1）、loop-4 又选了一次（出 v2）**。
# 每选一次是一整套——重新生成五系统模型、生图（实测 100~260s）、取色、设计
# 首页、落库。两次就是两套，一轮推演时间翻倍（B 组 28.1 分钟 / C 组 27.8 分钟，
# 而只收一次口的那两轮是 13.6 / 18.2 分钟）。
#
# 它不是乱选：`_progress_line` 正在按剩余轮次催它收口，而状态摘要里**没有任何
# 一处说"你已经收过了、成功了"**——`【已执行能力序列】`只给能力名不带结果。
# 催促加强了，"已经做完"这个事实没同步过去。这是上面那次措辞改动留下的缺口。


def _state(closure):
    class S:
        goal = {"text": "做个食堂系统", "status": "clear"}
        capabilityRuns = []
        openQuestions = []
        coverageGaps = []
        staleArtifactIds = []
        artifacts = []
        publishClosure = closure

    return S()


def test_digest_says_closure_already_succeeded():
    """已收口时必须明说"不需要再选一次"——这是防重复构建的唯一信息来源。"""
    from services.v5_agentic_pick import _state_digest

    digest = _state_digest(
        _state({"blocked": False, "evidencePresentCount": 6, "skillCount": 6}),
        "做个食堂系统", 3, 6,
    )
    line = [l for l in digest.splitlines() if l.startswith("【闭环状态】")]
    assert line, "状态摘要里没有闭环状态这一行"
    assert "已成功收口" in line[0]
    assert "不需要再选一次" in line[0]
    assert "6/6" in line[0]


def test_closure_line_sits_right_after_the_progress_line():
    """两句必须挨着。

    隔开了模型容易只看见催促——真机连收两次就是这么来的。
    """
    from services.v5_agentic_pick import _state_digest

    lines = _state_digest(
        _state({"blocked": False, "evidencePresentCount": 6, "skillCount": 6}),
        "x", 3, 6,
    ).splitlines()
    idx_progress = next(i for i, l in enumerate(lines) if l.startswith("【进度】"))
    assert lines[idx_progress + 1].startswith("【闭环状态】")


def test_blocked_closure_keeps_the_door_open():
    """被拦下的要说清"补齐了可以再来"——不能把 blocked 也说成"别再收了"。

    那会把 fail-closed 变成 fail-forever：证据补齐之后也没人去收口了。
    """
    from services.v5_agentic_pick import _closure_line

    line = _closure_line(_state({"blocked": True, "evidencePresentCount": 2, "skillCount": 6}))
    assert "blocked" in line and "2/6" in line
    assert "可以再收一次" in line
    assert "不需要再选一次" not in line


def test_no_closure_yet_is_stated_plainly():
    from services.v5_agentic_pick import _closure_line

    assert "尚未收口" in _closure_line(_state(None))
    assert "尚未收口" in _closure_line(_state({}))


def test_success_wording_leaves_an_exit_for_real_new_requirements():
    """要挡的是"没有新需求却重复收口"，不是所有的第二次。

    用户带着新要求继续推演时，精修出 v2 是正当的（v5_full_driver 的 refine 分支
    本来就在）。所以措辞里必须留这个出口，不能写成"禁止再选"。
    """
    from services.v5_agentic_pick import _closure_line

    line = _closure_line(_state({"blocked": False, "evidencePresentCount": 6, "skillCount": 6}))
    assert "除非" in line and "新的补充需求" in line


# ── 那句提示词得**真读得到**闭环状态（2026-08-05）────────────────
#
# 上面整组测试都绿，可真机照样连收两次口：09:39 那轮 loop-4 选收口（210.1s
# 起、682.2s 完），682.9s 又开一轮规划，701.3s **再选一次收口**。
#
# 根因不在措辞，在数据来源：`state.publishClosure` 原本只在**循环整个结束
# 之后**才赋值（v5_full_driver 末尾），循环里 `_closure_line` 永远读到 None，
# 于是每一轮都报「尚未收口」——包括刚刚收口成功的那一轮。
#
# 上面的 `_state()` 是手搓的、字段直接给好，所以它测的是"拿到状态之后怎么
# 措辞"，测不到"状态压根没人往里写"。这两条补的就是这一半：驱动器必须在
# 收过口的那一轮把结果写回 state。


def _driver_source():
    import inspect

    from services import v5_full_driver

    return inspect.getsource(v5_full_driver)


def test_closure_result_is_written_back_within_the_loop():
    """收口跑完要当场写回 state，不能等整个循环结束。

    等到最后才写 = 循环里那句防重复收口的提示词永远是空的。一次多余的收口
    是整套重来（重新建模 + 生参照图 + 取色 + 设计版式 + 落库），真机 472 秒。
    """
    src = _driver_source()
    # 末尾那次赋值不算——它在循环外，正是原来的写法
    in_loop_writes = src.count("state.publishClosure = _round_closure")
    assert in_loop_writes == 2, (
        "流式驱动和同步驱动都要写回；漏一条那条路径上的重复收口就没人挡"
    )


def test_write_back_only_happens_on_rounds_that_actually_closed():
    """没收口的轮次不许写。

    E37 之后 derive_publish_closure_response **永不返回 None**（拿不到证据
    会回落成 blocked 闭环）。无条件写回会让还没收过口的轮次报
    「blocked 0/6，可以再收一次」，把"还没做"说成"做了没成"——模型据此
    以为自己试过了。
    """
    src = _driver_source()
    assert src.count("_is_closure_cap(p.get(\"capabilityId\", \"\"))") == 2


def test_closure_cap_detector_does_not_over_match():
    """判"这轮收过口没有"只能认收口本身。

    `_is_commit_order_sensitive_cap` 还包含 synthesis / report（它们同样要当
    屏障），拿它来判会把只跑了综合的轮次也标成已收口。
    """
    from services.v5_full_driver import _is_closure_cap, _is_commit_order_sensitive_cap

    assert _is_closure_cap("appbundle.runtimeClosure")
    assert _is_closure_cap("appbundle.runtimeclosure")
    assert _is_closure_cap("factory.closure")
    assert not _is_closure_cap("factory.pages")
    assert not _is_closure_cap("factory.structure")
    assert not _is_closure_cap("factory.bind")
    assert not _is_closure_cap("factory.spec")
    assert not _is_closure_cap("synthesis.merge")
    assert not _is_closure_cap("evidence.search")
    # 屏障判据认得更宽是对的，两者不能混用
    assert _is_commit_order_sensitive_cap("synthesis.merge")
    assert not _is_closure_cap("synthesis.merge")
